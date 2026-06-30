-- ─── 037: projects — módulo de projetos pessoais ────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  color       VARCHAR(7)   NOT NULL DEFAULT '#6366f1',
  owner_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       VARCHAR(50) NOT NULL DEFAULT 'membro',
  invited_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Seções do kanban, ordenadas por posição dentro de cada projeto
CREATE TABLE IF NOT EXISTS project_sections (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  position   INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, name)
);

-- FK em personal_tasks apontando para o projeto formal
ALTER TABLE personal_tasks
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner       ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_members_prj  ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_usr  ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_sections_prj ON project_sections(project_id, position);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_prj   ON personal_tasks(project_id);

-- ─── Migração de dados: criar projects a partir do campo project (VARCHAR) ──
DO $$
DECLARE
  r          RECORD;
  r2         RECORD;
  proj_id    UUID;
  admin_id   UUID;
  sec_pos    INTEGER;
BEGIN
  -- Pega o primeiro super_admin como dono dos projetos migrados
  SELECT id INTO admin_id FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN
    SELECT id INTO admin_id FROM users ORDER BY created_at LIMIT 1;
  END IF;

  IF admin_id IS NULL THEN
    RETURN; -- banco vazio, nada a migrar
  END IF;

  -- Para cada nome de projeto distinto
  FOR r IN
    SELECT DISTINCT project AS proj_name
    FROM personal_tasks
    WHERE project IS NOT NULL AND project_id IS NULL
  LOOP
    -- Cria o projeto
    INSERT INTO projects (name, owner_id)
    VALUES (r.proj_name, admin_id)
    RETURNING id INTO proj_id;

    -- Adiciona o dono como membro proprietário
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (proj_id, admin_id, 'proprietário')
    ON CONFLICT DO NOTHING;

    -- Linka as tarefas ao projeto
    UPDATE personal_tasks
    SET project_id = proj_id
    WHERE project = r.proj_name AND project_id IS NULL;

    -- Cria project_sections a partir das sections distintas das tarefas
    sec_pos := 0;
    FOR r2 IN
      SELECT DISTINCT section AS sec_name
      FROM personal_tasks
      WHERE project_id = proj_id AND section IS NOT NULL
      ORDER BY section
    LOOP
      INSERT INTO project_sections (project_id, name, position)
      VALUES (proj_id, r2.sec_name, sec_pos)
      ON CONFLICT DO NOTHING;
      sec_pos := sec_pos + 1;
    END LOOP;

  END LOOP;
END $$;
