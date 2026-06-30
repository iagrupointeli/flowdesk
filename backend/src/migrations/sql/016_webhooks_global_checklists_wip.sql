-- ── 1. webhooks: department_id nullable (suporte a webhooks globais) ──────────
ALTER TABLE webhooks
  ALTER COLUMN department_id DROP NOT NULL;

DROP INDEX IF EXISTS idx_webhooks_dept_active;

CREATE INDEX IF NOT EXISTS idx_webhooks_active
  ON webhooks (department_id, is_active)
  WHERE is_active = true;

-- ── 2. demand_checklists ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demand_checklists (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id     UUID        NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  is_completed  BOOLEAN     NOT NULL DEFAULT false,
  display_order INTEGER     NOT NULL DEFAULT 0,
  completed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demand_checklists_demand
  ON demand_checklists (demand_id);

-- ── 3. wip_limit em workflow_stages ────────────────────────────────────────
ALTER TABLE workflow_stages
  ADD COLUMN IF NOT EXISTS wip_limit INTEGER NULL
    CONSTRAINT chk_wip_limit_positive CHECK (wip_limit IS NULL OR wip_limit > 0);
