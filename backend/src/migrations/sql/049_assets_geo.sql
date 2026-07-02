-- ─── 049: geo — lat/lng nativos + backfill de assets.notes ────────────────────
--
-- Coordenadas hoje vivem presas em texto livre dentro de notes (ex:
-- "geo:-26.84,-48.71", às vezes com outro conteúdo antes: "ref: X | geo:...").
-- Extrai pra colunas reais sem apagar notes original.
--
-- earthdistance/cube são extensões nativas do contrib do Postgres (grátis,
-- sem PostGIS) — suficiente pra filtro de raio e ordenação por distância.

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION NULL;

-- Backfill: só preenche onde ainda não tem lat/lng e o padrão geo: existe em notes.
UPDATE assets
SET lat = (regexp_match(notes, 'geo:(-?[0-9]+\.?[0-9]*),(-?[0-9]+\.?[0-9]*)'))[1]::double precision,
    lng = (regexp_match(notes, 'geo:(-?[0-9]+\.?[0-9]*),(-?[0-9]+\.?[0-9]*)'))[2]::double precision
WHERE lat IS NULL
  AND notes ~ 'geo:-?[0-9]+\.?[0-9]*,-?[0-9]+\.?[0-9]*';

-- Índice GiST pra filtro de raio eficiente via earth_box() @> ll_to_earth().
CREATE INDEX IF NOT EXISTS idx_assets_earth
  ON assets USING gist (ll_to_earth(lat, lng))
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND archived_at IS NULL;
