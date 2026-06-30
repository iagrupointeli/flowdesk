-- 032: campaigns — vínculo opcional com demanda de produção
--
-- Um demand_id opcional associa a campanha à demanda de produção dos
-- materiais (arte, lona). O job `runMaterialDeadlineCheck` usa esse link
-- para alertar quando a campanha está prestes a começar sem arte criativa.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS demand_id UUID REFERENCES demands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_demand
  ON campaigns (demand_id)
  WHERE demand_id IS NOT NULL;
