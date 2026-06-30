-- ─── 014: SLA — sla_hours em demand_types, due_date em demands ───────────────
--
-- sla_hours (demand_types):
--   Prazo de resolução configurado pelo admin por tipo de demanda.
--   NULL = sem SLA (padrão). CHECK > 0 impede valores absurdos.
--
-- due_date (demands):
--   Calculado na criação: NOW() + (sla_hours * INTERVAL '1 hour').
--   NULL quando o tipo não possui SLA ou era NULL ao criar a demanda.
--   Imutável após a criação — não é recalculado quando sla_hours muda.
--
-- Rationale de imutabilidade:
--   Alterar sla_hours de um tipo não deve mover retroativamente o prazo de
--   demandas já abertas — isso criaria ambiguidade para o responsável e para
--   o cálculo histórico de SLA.

ALTER TABLE demand_types
  ADD COLUMN IF NOT EXISTS sla_hours INTEGER NULL
    CHECK (sla_hours IS NULL OR sla_hours > 0);

ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ NULL;

-- Índice parcial: queries de alertas de prazo (dashboard, badge) só olham
-- demandas com due_date definido.
CREATE INDEX IF NOT EXISTS idx_demands_due_date
  ON demands (due_date)
  WHERE due_date IS NOT NULL;
