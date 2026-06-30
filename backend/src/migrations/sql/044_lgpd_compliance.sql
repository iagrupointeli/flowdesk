-- ─── 044: LGPD compliance — consentimento, anonimização e gestão de direitos ──
--
-- Pilar 2: Blindagem de Compliance (LGPD + RMD Compliance)
--
-- Lacunas identificadas na auditoria:
--   1. Sem rastreio de consentimento (LGPD Art. 7)
--   2. Sem workflow de anonimização (LGPD Art. 18 — direito ao apagamento)
--   3. Sem log de auditoria das ações de tratamento de dados
--
-- Esta migration NÃO criptografa dados existentes (operação de aplicação).
-- A criptografia de campos CPF em demands.payload deve ser executada como
-- job separado em janela de manutenção usando AES-256-GCM na camada Express.

-- ── 1. Consentimento do usuário (LGPD Art. 7) ───────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS consent_given_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS consent_type      VARCHAR(50)  NULL
    CHECK (consent_type IS NULL OR consent_type IN (
      'explicit',             -- consentimento expresso (clique em "Aceito")
      'legitimate_interest',  -- interesse legítimo (Art. 7, IX)
      'contract'              -- execução de contrato (Art. 7, V)
    )),
  ADD COLUMN IF NOT EXISTS consent_ip        VARCHAR(45) NULL;  -- IPv4 ou IPv6

-- ── 2. Anonimização de usuários (LGPD Art. 18 — direito ao apagamento) ──────
-- anonymized_at NOT NULL sinaliza que o PII foi removido.
-- Após SET anonymized_at, os campos name/email/password_hash foram sobrescritos
-- com valores neutros pelo job de anonimização (nunca por esta migration).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ NULL;

-- Índice parcial: job de anonimização busca usuários desativados há >90 dias
-- e ainda não anonimizados. Esta é a única query recorrente nessa coluna.
CREATE INDEX IF NOT EXISTS idx_users_pending_anonymization
  ON users (deactivated_at)
  WHERE anonymized_at IS NULL AND deactivated_at IS NOT NULL;

-- ── 3. Anonimização de demandas ─────────────────────────────────────────────
-- Quando o solicitante é anonimizado, demands.payload pode conter CPF dele.
-- O job de anonimização seta este campo e sobrescreve os valores sensíveis
-- no JSONB (aplica máscara ou remove chaves de campos tipo 'cpf').
ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_demands_pending_anonymization
  ON demands (requester_id)
  WHERE anonymized_at IS NULL;

-- ── 4. Anonimização de comentários (demand_feed) ────────────────────────────
-- Comentários podem conter PII digitado pelo usuário no corpo do texto.
-- Após anonimização: body sobrescrito com '[conteúdo removido por solicitação LGPD]'.
ALTER TABLE demand_feed
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ NULL;

-- ── 5. Registro de solicitações LGPD ────────────────────────────────────────
-- Formaliza o fluxo de atendimento de direitos do titular (Art. 18):
--   access       — acesso aos dados tratados
--   rectification — correção de dado incompleto/incorreto
--   erasure      — exclusão/anonimização
--   portability  — exportação em formato estruturado
--   restriction  — limitação do tratamento
CREATE TABLE IF NOT EXISTS lgpd_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_type  VARCHAR(30) NOT NULL
    CHECK (request_type IN ('access','rectification','erasure','portability','restriction')),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','denied')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ NULL,
  resolved_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT        NULL
);

-- Fila de trabalho do DPO: solicitações abertas ordenadas por chegada
CREATE INDEX IF NOT EXISTS idx_lgpd_requests_open
  ON lgpd_requests (requested_at)
  WHERE status IN ('pending', 'processing');

-- Histórico por usuário: "todas as solicitações do titular X"
CREATE INDEX IF NOT EXISTS idx_lgpd_requests_user
  ON lgpd_requests (user_id, requested_at DESC);

-- ── 6. Log de auditoria de tratamento de dados ──────────────────────────────
-- Registra TODA ação de tratamento: anonimização, exclusão, exportação.
-- Imutável por design: nunca faça UPDATE ou DELETE nesta tabela.
-- Evidência jurídica em caso de auditoria RMD / ANPD.
CREATE TABLE IF NOT EXISTS data_retention_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  VARCHAR(100) NOT NULL,
  record_id   TEXT         NOT NULL,  -- UUID do registro tratado (TEXT para flexibilidade)
  action      VARCHAR(30)  NOT NULL
    CHECK (action IN ('anonymized','deleted','exported','restricted')),
  requested_by UUID        REFERENCES users(id) ON DELETE SET NULL,  -- DPO ou job
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason      TEXT         NULL,  -- ex: 'retention_policy_90d', 'user_request_#uuid'
  lgpd_request_id UUID    REFERENCES lgpd_requests(id) ON DELETE SET NULL
);

-- Busca por tabela + período: relatório mensal de tratamento para a RMD
CREATE INDEX IF NOT EXISTS idx_retention_log_table_date
  ON data_retention_log (table_name, processed_at DESC);

-- Rastreio por solicitação LGPD: "o que foi feito para a solicitação X"
CREATE INDEX IF NOT EXISTS idx_retention_log_request
  ON data_retention_log (lgpd_request_id)
  WHERE lgpd_request_id IS NOT NULL;

-- ── Nota: Criptografia de CPF ────────────────────────────────────────────────
-- A criptografia de valores CPF em demands.payload NÃO ocorre nesta migration.
-- Deve ser executada como job Node.js em janela de manutenção:
--
--   1. Para cada demand com field_type='cpf' no fields_snapshot:
--      payload[field_id] = AES256GCM.encrypt(payload[field_id], FIELD_KEY)
--
--   2. FIELD_KEY fica em .env (FIELD_ENCRYPTION_KEY=<32 bytes hex>)
--      Nunca armazenar no banco.
--
--   3. No serviço de leitura (getDemand, listDemands), descriptografar antes
--      de retornar ao frontend apenas se o usuário tiver permissão.
--
--   4. O campo cpf no frontend exibe sempre mascarado: "***.***.***-**"
--      O valor completo só é exposto para super_admin e dept_admin.
