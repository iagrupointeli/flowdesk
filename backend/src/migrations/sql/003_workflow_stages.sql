-- ─── 003: workflow_stages ─────────────────────────────────────────────────────

CREATE TABLE workflow_stages (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_type_id    UUID         NOT NULL REFERENCES demand_types(id) ON DELETE RESTRICT,
  name              VARCHAR(255) NOT NULL,
  display_order     INTEGER      NOT NULL DEFAULT 0,
  is_final          BOOLEAN      NOT NULL DEFAULT false,
  requires_note     BOOLEAN      NOT NULL DEFAULT false,
  requires_assignee BOOLEAN      NOT NULL DEFAULT false,
  archived_at       TIMESTAMPTZ  NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- UNIQUE composta habilita a FK composta em demands(current_stage_id, demand_type_id)
  -- garante em nível de schema que a etapa pertence ao tipo da demanda, sem triggers
  UNIQUE (id, demand_type_id)
);

CREATE INDEX idx_workflow_stages_type ON workflow_stages (demand_type_id);
-- índice parcial para etapas ativas ordenadas (renderização do Kanban)
CREATE INDEX idx_workflow_stages_active ON workflow_stages (demand_type_id, display_order)
  WHERE archived_at IS NULL;
