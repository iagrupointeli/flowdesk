-- 042: area_members — controla visibilidade de projetos "limited"
-- Projetos com visibility='limited' só aparecem para membros da área (+ membros do projeto + super_admin)

CREATE TABLE IF NOT EXISTS area_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id    UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (area_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_area_members_area_id ON area_members(area_id);
CREATE INDEX IF NOT EXISTS idx_area_members_user_id ON area_members(user_id);
