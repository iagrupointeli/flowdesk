-- ─── 027: campaigns — calendário de ocupação dos pontos ──────────────────────
--
-- Veiculações comerciais por ponto: qual anunciante ocupa qual painel em
-- qual período. O pesadelo clássico de OOH é o double-booking — vender o
-- mesmo ponto para dois anunciantes em períodos sobrepostos.
--
-- A proteção é FÍSICA, no banco: exclusion constraint com daterange.
-- Nenhum código de aplicação consegue burlar — o INSERT/UPDATE conflitante
-- falha com erro 23P01 (exclusion_violation), convertido em 409 na API.
--
-- daterange(starts_on, ends_on, '[]') — intervalo FECHADO nos dois lados:
-- uma campanha que termina dia 10 conflita com outra que começa dia 10
-- (o ponto precisa de pelo menos 1 dia livre para troca de lona).

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  client_name VARCHAR(200) NOT NULL,
  title       VARCHAR(300) NOT NULL,
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  notes       TEXT NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  archived_at TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ends_on >= starts_on),

  CONSTRAINT no_double_booking EXCLUDE USING gist (
    asset_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  ) WHERE (archived_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_period
  ON campaigns (starts_on, ends_on)
  WHERE archived_at IS NULL;
