-- ─── 036: personal_tasks — módulo de tarefas pessoais ───────────────────────

CREATE TABLE IF NOT EXISTS personal_tasks (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT         NOT NULL,
  notes        TEXT,
  project      VARCHAR(100),
  section      VARCHAR(100),
  assignee_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
  due_date     DATE,
  status       VARCHAR(20)  NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo', 'done')),
  position     INTEGER      NOT NULL DEFAULT 0,
  created_by   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  archived_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_personal_tasks_assignee   ON personal_tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_created_by ON personal_tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_due_date   ON personal_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_active     ON personal_tasks(archived_at);
