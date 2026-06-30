-- ─── 008: notifications ───────────────────────────────────────────────────────

CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  demand_id  UUID        NULL     REFERENCES demands(id)  ON DELETE CASCADE,
  message    TEXT        NOT NULL,
  read       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice parcial: query mais frequente é "não lidas por usuário"
CREATE INDEX idx_notifications_unread  ON notifications (user_id, created_at DESC)
  WHERE read = false;

-- FK demand_id não coberta por PK
CREATE INDEX idx_notifications_demand ON notifications (demand_id)
  WHERE demand_id IS NOT NULL;
