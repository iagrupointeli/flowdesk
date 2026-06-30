-- ─── 015: finalized_at em demands + tabela webhooks ──────────────────────────
--
-- finalized_at (demands):
--   Desnormalização de performance — substitui subquery correlacionada em
--   demand_history que crescia O(n) com o histórico de cada demanda.
--   Atualizado transacionalmente em moveStage:
--     → etapa is_final = true  : SET finalized_at = NOW()
--     → etapa is_final = false : SET finalized_at = NULL  (demanda retornou)
--   O SLABadge usa finalized_at para calcular "no prazo" vs "com atraso"
--   com precisão exata sem subquery.
--
-- webhooks:
--   Notificações de saída para serviços externos (Teams, Slack, ERPs, Zapier).
--   Eventos suportados: demand.created, demand.stage_changed, demand.blocked.
--   Dispatch: fire-and-forget com timeout 5 s + HMAC SHA-256.
--   secret_key: 32 bytes aleatórios (hex), gerado no backend na criação.
--   events: array JSONB — filtrado com operador @> no dispatch.

ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS webhooks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  url           TEXT        NOT NULL,
  secret_key    TEXT        NOT NULL,
  events        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice parcial: queries de dispatch carregam apenas webhooks ativos.
-- Índice GIN no JSONB seria necessário para tabelas grandes (>100k rows),
-- mas para a quantidade esperada o índice b-tree parcial é suficiente.
CREATE INDEX IF NOT EXISTS idx_webhooks_dept_active
  ON webhooks (department_id)
  WHERE is_active = true;
