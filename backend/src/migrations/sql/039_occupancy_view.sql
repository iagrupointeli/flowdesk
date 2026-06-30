-- ─── 039: view de ocupação de ativos ─────────────────────────────────────────
--
-- v_asset_occupancy: cruza assets com campanhas ativas para alimentar
-- a grade de disponibilidade (/admin/occupancy).

CREATE OR REPLACE VIEW v_asset_occupancy AS
SELECT
  a.id          AS asset_id,
  a.name        AS asset_name,
  a.code        AS asset_code,
  a.city,
  a.asset_type,
  c.id          AS campaign_id,
  c.title       AS campaign_title,
  c.client_name,
  c.starts_on,
  c.ends_on,
  c.approval_status
FROM assets a
LEFT JOIN campaigns c
  ON  c.asset_id    = a.id
  AND c.archived_at IS NULL
  AND c.approval_status <> 'rejected'
WHERE a.archived_at IS NULL;
