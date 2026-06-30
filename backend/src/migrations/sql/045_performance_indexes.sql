-- ─── 045: performance — GIN indexes + geographic coverage ────────────────────
--
-- Pilar 3: Escalabilidade e Performance Nacional
--
-- Contexto: importação de 180k pontos + 42 marcas acessando simultaneamente.
-- Sem estes índices, queries JSONB e buscas geográficas fazem full table scan
-- que degrada de <50ms para >8s conforme o volume cresce.
--
-- GIN (Generalized Inverted Index): estrutura de índice do PostgreSQL otimizada
-- para dados compostos (arrays, JSONB). Habilita o operador @> ("contains")
-- em O(log n) em vez de O(n).
--
-- IMPORTANTE: GIN indexes aumentam o tempo de INSERT/UPDATE em ~15%.
-- Aceitável para o volume de escrita esperado no FlowDesk.
-- Se no futuro o volume de escrita superar 1k demands/hora, reavaliar.

-- ── 1. GIN em demands.payload ────────────────────────────────────────────────
-- Habilita queries como:
--   SELECT * FROM demands WHERE payload @> '{"<field_uuid>": "12345678900"}'
--   SELECT * FROM demands WHERE payload @> '{"<field_uuid>": "São Paulo"}'
--
-- Caso de uso Grupo Inteli: "encontrar todas as demandas onde o cliente é X"
-- ou "todas as demandas com CPF Y" (para atender solicitação LGPD de acesso).
CREATE INDEX IF NOT EXISTS idx_demands_payload_gin
  ON demands USING GIN (payload);

-- Partial GIN: apenas demandas ativas (não finalizadas, não canceladas).
-- Kanban queries operam quase exclusivamente sobre este subconjunto.
-- Reduz o tamanho do índice e acelera as queries mais frequentes.
CREATE INDEX IF NOT EXISTS idx_demands_payload_active_gin
  ON demands USING GIN (payload)
  WHERE finalized_at IS NULL AND exception_state IS NULL;

-- ── 2. GIN em demands.fields_snapshot ───────────────────────────────────────
-- Habilita queries analíticas de admin:
--   "Quais tipos de demanda têm um campo CPF?" → snapshot @> '{"field_type":"cpf"}'
-- Usado no job de anonimização LGPD para localizar demands com CPF no payload.
CREATE INDEX IF NOT EXISTS idx_demands_snapshot_gin
  ON demands USING GIN (fields_snapshot);

-- ── 3. Cobertura geográfica de assets (pós-import Dataprisma) ───────────────
-- Busca por cidade: "todos os pontos em Pindamonhangaba"
-- NOTA: idx_assets_city_state já criado na migration 043.
-- Este bloco está aqui como documentação — não recriar se 043 rodou antes.

-- Busca por UF: "todos os pontos em SC" (visão regional da marca)
CREATE INDEX IF NOT EXISTS idx_assets_state
  ON assets (state)
  WHERE archived_at IS NULL AND state IS NOT NULL;

-- Busca por tipo de ativo + UF: "todos os LEDs em SP" (ocupação por tipo)
CREATE INDEX IF NOT EXISTS idx_assets_type_state
  ON assets (asset_type, state)
  WHERE archived_at IS NULL;

-- ── 4. Campaigns por período (query de grade de disponibilidade) ─────────────
-- Suporta a view v_asset_occupancy e o calendário de ocupação bi-semanas.
-- Operação mais frequente no módulo de campanhas:
--   WHERE starts_on <= $end AND ends_on >= $start (sobreposição de intervalo)
CREATE INDEX IF NOT EXISTS idx_campaigns_period_dept
  ON campaigns (starts_on, ends_on)
  WHERE archived_at IS NULL AND approval_status <> 'rejected';

-- ── 5. Demands por asset + período ──────────────────────────────────────────
-- Timeline do ativo: "todas as demandas do ponto X nos últimos 6 meses"
-- Combinação mais comum na tela de histórico do ativo.
CREATE INDEX IF NOT EXISTS idx_demands_asset_date
  ON demands (asset_id, created_at DESC)
  WHERE asset_id IS NOT NULL;

-- ── 6. Personal tasks — busca por seção dentro de projeto ───────────────────
-- Kanban de projetos: renderiza tasks por seção e posição.
-- Índice composto cobre ORDER BY section, position sem sort adicional.
CREATE INDEX IF NOT EXISTS idx_tasks_project_section
  ON personal_tasks (project_id, section, position)
  WHERE project_id IS NOT NULL AND archived_at IS NULL;

-- ── Nota: PgBouncer ─────────────────────────────────────────────────────────
-- Esta migration não configura PgBouncer (mudança de infraestrutura, não de schema).
-- Configuração via docker-compose.pgbouncer.yml (ver improvement-plan-2026.md §Pilar 3).
-- Backend deve apontar DATABASE_URL para porta 6432 após PgBouncer estar up.
-- Pool mode recomendado: 'transaction' (compatível com o padrão de queries do Express).
