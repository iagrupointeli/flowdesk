-- ─── 005: demand_history ──────────────────────────────────────────────────────
-- Registra APENAS transições de estado — alimenta cálculo de SLA.
-- Eventos neutros (comentários, anexos) ficam em demand_feed e attachments.

CREATE TABLE demand_history (
  id              BIGSERIAL    PRIMARY KEY,  -- SEQUENCE estrito: base de ordenação e paginação
  demand_id       UUID         NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
  event_type      VARCHAR(30)  NOT NULL
                  CHECK (event_type IN (
                    'created',           -- marco zero: inserido automaticamente na criação da demanda
                    'stage_changed',     -- movimentação de coluna no Kanban
                    'exception_changed', -- pausa, retomada ou cancelamento
                    'assignee_changed'   -- troca de responsável sem mudança de etapa
                  )),
  actor_id        UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- quem fez
  stage_id        UUID         NULL     REFERENCES workflow_stages(id) ON DELETE RESTRICT,
  assignee_id     UUID         NULL     REFERENCES users(id) ON DELETE RESTRICT,   -- com quem ficou
  exception_state VARCHAR(20)  NULL
                  CHECK (exception_state IN ('on_hold', 'cancelled')),
  notes           TEXT         NULL,
  entered_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice composto ideal para a window function de SLA:
-- PARTITION BY demand_id ORDER BY id
-- Cobre também buscas por demand_id isoladas.
CREATE INDEX idx_history_sla    ON demand_history (demand_id, id);

-- Índice para paginação cursor-based: WHERE (demand_id, entered_at, id) > ($1, $2, $3)
CREATE INDEX idx_history_cursor ON demand_history (demand_id, entered_at, id);

-- FKs não cobertas por PK
CREATE INDEX idx_history_actor    ON demand_history (actor_id);
CREATE INDEX idx_history_stage    ON demand_history (stage_id)    WHERE stage_id IS NOT NULL;
CREATE INDEX idx_history_assignee ON demand_history (assignee_id) WHERE assignee_id IS NOT NULL;
