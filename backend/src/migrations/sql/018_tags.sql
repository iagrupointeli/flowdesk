-- ─── 018: tags e demand_tags ────────────────────────────────────────────────
--
-- tags        — catálogo de tags por departamento
-- demand_tags — vínculo N:M entre demandas e tags

CREATE TABLE IF NOT EXISTS tags (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID         NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  color_hex     CHAR(7)      NOT NULL DEFAULT '#6366f1',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_department
  ON tags (department_id);

CREATE TABLE IF NOT EXISTS demand_tags (
  demand_id  UUID        NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  tag_id     UUID        NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (demand_id, tag_id)
);

-- Consultas por tag (ex: listar todas as demandas de uma tag)
CREATE INDEX IF NOT EXISTS idx_demand_tags_tag
  ON demand_tags (tag_id);
