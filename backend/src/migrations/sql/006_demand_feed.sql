-- ─── 006: demand_feed ─────────────────────────────────────────────────────────
-- Feed de comunicação: comentários e interações que NÃO impactam o SLA.
-- Armazena stage_id e assignee_id como contexto no momento da inserção,
-- permitindo responder "em qual etapa e com quem estava quando este comentário foi feito?"
-- sem joins temporais complexos com demand_history.

CREATE TABLE demand_feed (
  id          BIGSERIAL    PRIMARY KEY,
  demand_id   UUID         NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
  event_type  VARCHAR(30)  NOT NULL DEFAULT 'comment_added'
              CHECK (event_type IN ('comment_added')),
  actor_id    UUID         NOT NULL REFERENCES users(id)             ON DELETE RESTRICT,
  -- contexto operacional no momento do comentário
  stage_id    UUID         NULL     REFERENCES workflow_stages(id)   ON DELETE RESTRICT,
  assignee_id UUID         NULL     REFERENCES users(id)             ON DELETE RESTRICT,
  body        TEXT         NOT NULL CHECK (LENGTH(TRIM(body)) > 0),
  entered_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice para paginação cursor-based no UNION ALL da timeline
CREATE INDEX idx_feed_cursor ON demand_feed (demand_id, entered_at, id);

-- FKs não cobertas por PK
CREATE INDEX idx_feed_actor    ON demand_feed (actor_id);
CREATE INDEX idx_feed_stage    ON demand_feed (stage_id)    WHERE stage_id IS NOT NULL;
CREATE INDEX idx_feed_assignee ON demand_feed (assignee_id) WHERE assignee_id IS NOT NULL;
