-- ─── 041: areas — nível acima dos projetos ────────────────────────────────────
--
-- Hierarquia: Área > Projeto > Tarefa
-- Exemplo: SCOutdoor > Inovação IA > Tarefas
--
-- Visibilidade do projeto:
--   public  — aparece para todos os usuários autenticados
--   limited — aparece apenas para quem está em project_members (qualquer role)
--   private — aparece apenas para membros do projeto (igual ao limited por ora,
--              mas semântica futura: private não aparece nem na busca)

CREATE TABLE IF NOT EXISTS areas (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  color       VARCHAR(7)   NOT NULL DEFAULT '#6366f1',
  created_by  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

-- FK em projects para área
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES areas(id) ON DELETE SET NULL;

-- Visibilidade do projeto
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('public', 'limited', 'private'));

CREATE INDEX IF NOT EXISTS idx_areas_created_by  ON areas(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_area      ON projects(area_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);
