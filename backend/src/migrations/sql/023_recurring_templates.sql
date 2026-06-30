-- ─── 023: recurring_templates — demandas recorrentes ─────────────────────────
--
-- Templates que materializam demandas automaticamente em ciclo fixo.
-- Casos de uso OOH: checking mensal, manutenção preventiva de ponto,
-- renovação de cessão — processos que hoje dependem de alguém lembrar.
--
-- Funcionamento:
--   Job periódico (index.js, mesmo padrão do SLA check) busca templates com
--   next_run_at <= NOW() e archived_at IS NULL, cria a demanda via
--   createDemand e avança next_run_at em múltiplos de interval_days
--   (preserva o "dia âncora" — sem drift por atraso do job).
--
-- payload:
--   Snapshot JSONB validado contra os campos do tipo NO MOMENTO DA CRIAÇÃO
--   do template. Se os campos do tipo mudarem depois e o payload ficar
--   inválido, o job loga o erro e avança o próximo ciclo (não trava).
--
-- archived_at:
--   Soft-delete padrão do projeto (TIMESTAMPTZ, nunca boolean).

CREATE TABLE IF NOT EXISTS recurring_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_type_id  UUID NOT NULL REFERENCES demand_types(id) ON DELETE CASCADE,
  title           VARCHAR(500) NOT NULL,
  description     TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  assignee_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  interval_days   INTEGER NOT NULL CHECK (interval_days > 0),
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ NULL,
  created_by      UUID NOT NULL REFERENCES users(id),
  archived_at     TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice parcial: o job só varre templates ativos vencidos
CREATE INDEX IF NOT EXISTS idx_recurring_templates_due
  ON recurring_templates (next_run_at)
  WHERE archived_at IS NULL;
