import { query } from '#config/database.js'

export async function listPortfolios({ q } = {}) {
  const params = []
  let whereExtra = ''
  if (q?.trim()) {
    params.push(`%${q.trim()}%`)
    whereExtra = `AND c.client_name ILIKE $1`
  }

  const { rows } = await query(
    `SELECT
       c.client_name,
       COUNT(DISTINCT c.id)::int           AS campaign_count,
       COUNT(DISTINCT c.asset_id)::int     AS asset_count,
       MIN(c.starts_on)                    AS earliest_start,
       MAX(c.ends_on)                      AS latest_end,
       array_agg(DISTINCT a.code
                 ORDER BY a.code)
         FILTER (WHERE a.code IS NOT NULL) AS asset_codes
     FROM campaigns c
     JOIN assets a ON a.id = c.asset_id
     WHERE c.archived_at IS NULL ${whereExtra}
     GROUP BY c.client_name
     ORDER BY c.client_name ASC`,
    params
  )
  return rows
}

export async function getPortfolioDetail(clientName) {
  const { rows } = await query(
    `SELECT
       c.id, c.title, c.starts_on, c.ends_on, c.notes,
       a.id AS asset_id, a.code AS asset_code,
       a.name AS asset_name, a.city AS asset_city,
       u.name AS created_by_name
     FROM campaigns c
     JOIN assets a ON a.id = c.asset_id
     JOIN users  u ON u.id = c.created_by
     WHERE c.client_name = $1 AND c.archived_at IS NULL
     ORDER BY c.starts_on DESC`,
    [clientName]
  )
  return rows
}
