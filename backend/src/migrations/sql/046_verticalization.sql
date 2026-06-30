-- ─── 046: verticalização IA — manutenção preditiva, ordens de serviço, checking ──
--
-- Pilar 4: Gatilhos de Verticalização (Inteli Estruturas + MovePro + Vision AI)
--
-- Loop de automação implementado por esta migration:
--
--   Inteli Estruturas instala mastro
--       → asset_lifecycle_log criado (event_type='manutencao', next_date=+180d)
--       → Job noturno avalia maintenance_rules
--       → service_order criado para MovePro
--       → Demanda de manutenção gerada automaticamente
--       → MovePro executa + sobe foto de checking
--       → checking_validation_queue criado (trigger na camada app)
--       → Vision AI valida a foto
--       → Demanda finalizada → ciclo reinicia
--
-- Este schema não contém lógica de AI — apenas a estrutura de dados que
-- o job e a API de Vision AI consultam e atualizam.

-- ── 1. Regras de Manutenção Preditiva ────────────────────────────────────────
--
-- Cada regra define: "quando um ativo do tipo X tiver seu último evento Y
-- há mais de Z dias, gerar automaticamente uma demanda do tipo W para o
-- departamento MovePro."
--
-- Exemplos:
--   mastro_metalico → vistoria → 180 dias → "Vistoria Estrutural Preventiva"
--   led            → manutencao → 90 dias  → "Manutenção de Display Digital"
--   lona           → troca_material → 365 dias → "Renovação de Lona"
CREATE TABLE IF NOT EXISTS maintenance_rules (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(200) NOT NULL,

  -- Filtros opcionais: NULL = regra se aplica a todos os valores do campo
  asset_type           VARCHAR(30)  NULL
    CHECK (asset_type IS NULL OR asset_type IN ('painel','empena','led','lona','outdoor','mub','outro')),
  structure_type       VARCHAR(30)  NULL
    CHECK (structure_type IS NULL OR structure_type IN ('mastro_metalico','totem','parede','cobertura','digital','outro')),

  -- Tipo de evento que esta regra monitora em asset_lifecycle_logs
  event_type           VARCHAR(30)  NOT NULL
    CHECK (event_type IN ('manutencao','vistoria','reparo','troca_material')),

  -- Intervalo desde o último evento para disparar a ordem
  interval_days        INTEGER      NOT NULL CHECK (interval_days > 0),

  -- Tipo de demanda a ser criado automaticamente (deve existir no banco)
  demand_type_id       UUID         NOT NULL REFERENCES demand_types(id) ON DELETE RESTRICT,

  -- Departamento responsável pela execução (ex: MovePro)
  -- NULL = demanda criada sem departamento específico (herdará o do demand_type)
  assignee_department_id UUID       NULL REFERENCES departments(id) ON DELETE SET NULL,

  priority             VARCHAR(10)  NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),

  -- Soft-disable: regras desativadas não são avaliadas pelo job
  is_active            BOOLEAN      NOT NULL DEFAULT true,
  created_by           UUID         NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Job busca apenas regras ativas — índice parcial reduz varredura
CREATE INDEX IF NOT EXISTS idx_maintenance_rules_active
  ON maintenance_rules (asset_type, event_type)
  WHERE is_active = true;

-- ── 2. Ordens de Serviço (MovePro) ──────────────────────────────────────────
--
-- Registro formal de cada trabalho de campo gerado pelas regras ou
-- manualmente pelo gestor. Ciclo de vida:
--
--   pending    → assigned   → in_progress → completed
--                         ↘ cancelled
--
-- created_by = NULL → gerado automaticamente pelo job (não por um humano).
-- demand_id é populado quando o job cria a demanda correspondente, fechando
-- o loop: service_order → demand → checking → finalização.
CREATE TABLE IF NOT EXISTS service_orders (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  rule_id              UUID        NULL REFERENCES maintenance_rules(id) ON DELETE SET NULL,
  demand_id            UUID        NULL REFERENCES demands(id) ON DELETE SET NULL,

  order_type           VARCHAR(30) NOT NULL
    CHECK (order_type IN ('manutencao','vistoria','reparo','troca_material','outro')),

  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','assigned','in_progress','completed','cancelled')),

  scheduled_date       DATE        NOT NULL,

  -- Equipe responsável (departamento MovePro ou similar)
  assigned_team_dept   UUID        NULL REFERENCES departments(id) ON DELETE SET NULL,

  notes                TEXT        NULL,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ NULL,

  -- NULL = gerado automaticamente; NOT NULL = criado manualmente por um usuário
  created_by           UUID        NULL REFERENCES users(id) ON DELETE SET NULL
);

-- Job de avaliação: "ordens pendentes agendadas para os próximos 30 dias"
CREATE INDEX IF NOT EXISTS idx_service_orders_pending
  ON service_orders (scheduled_date)
  WHERE status IN ('pending', 'assigned');

-- Timeline do ativo: todas as OSs de um ponto ordenadas por data
CREATE INDEX IF NOT EXISTS idx_service_orders_asset
  ON service_orders (asset_id, scheduled_date DESC);

-- Prevenção de duplicata: antes de criar uma nova OS, o job verifica se já
-- existe uma OS ativa para este ativo + regra + status ainda pendente
CREATE INDEX IF NOT EXISTS idx_service_orders_rule_asset
  ON service_orders (rule_id, asset_id)
  WHERE status IN ('pending', 'assigned', 'in_progress') AND rule_id IS NOT NULL;

-- ── 3. Fila de Validação de Checking (Vision AI) ─────────────────────────────
--
-- Cada attachment com kind='checking' é enfileirado aqui pela camada de
-- aplicação (uploadAttachment) após o INSERT em attachments.
--
-- O job de Vision AI consome registros com status='queued', processa via API
-- (ex: OpenAI Vision, Google Vision, modelo local via Ollama) e atualiza:
--   status      → 'approved' | 'flagged' | 'error'
--   ai_score    → confiança 0–100
--   ai_findings → {"panel_visible":true,"brand_correct":true,"obstruction":false}
--   flagged_reason → descrição do problema se status='flagged'
--
-- Itens 'flagged' exigem revisão humana — não rejeitam a demanda automaticamente.
CREATE TABLE IF NOT EXISTS checking_validation_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id   UUID        NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  asset_id        UUID        NULL REFERENCES assets(id) ON DELETE SET NULL,

  status          VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','approved','flagged','error')),

  -- Score de confiança do modelo: 0.00–100.00
  ai_score        NUMERIC(5,2) NULL,

  -- Estrutura livre: o shape depende do modelo de Vision AI escolhido.
  -- Exemplo com checklist básico:
  -- {
  --   "panel_visible": true,
  --   "brand_correct": true,
  --   "obstruction": false,
  --   "luminosity": "adequate",
  --   "installation_quality": "good"
  -- }
  ai_findings     JSONB       NULL,

  flagged_reason  TEXT        NULL,  -- descrição humano-legível se status='flagged'
  processed_at    TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Job de Vision AI: fila de trabalho ordenada por chegada
CREATE INDEX IF NOT EXISTS idx_checking_queue_pending
  ON checking_validation_queue (created_at)
  WHERE status IN ('queued', 'processing');

-- Lookup: "qual é o resultado da validação deste anexo?"
CREATE INDEX IF NOT EXISTS idx_checking_queue_attachment
  ON checking_validation_queue (attachment_id);

-- Dashboard de moderação: "todos os checkings flagged pendentes de revisão"
CREATE INDEX IF NOT EXISTS idx_checking_queue_flagged
  ON checking_validation_queue (created_at DESC)
  WHERE status = 'flagged';

-- ── Nota: Integração com ai-monitor ─────────────────────────────────────────
-- O stack ai-monitor (Ollama + n8n + DuckDB) já está rodando na mesma máquina.
-- O job de Vision AI pode usar Ollama diretamente (ex: modelo llava) via
-- http://localhost:11434 para processar imagens sem custo de API externa.
-- n8n pode orquestrar o fluxo: poll checking_queue → chamar Ollama → UPDATE.
-- DuckDB pode agregar os resultados para o dashboard de qualidade de checking.
