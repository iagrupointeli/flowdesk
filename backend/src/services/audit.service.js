import { query } from '#config/database.js'

/**
 * Lista eventos do histórico de demandas com JOINs enriquecidos.
 *
 * RBAC:
 *   super_admin → vê todos os departamentos
 *   dept_admin  → escopo limitado a actor.deptIds
 *
 * Paginação offset — adequada para uso admin com volume controlado.
 *
 * NOTA: department_id fica em demand_types, não em demands.
 * O JOIN correto é: demands → demand_types → departments.
 */
export async function listAuditEvents(actor, filters) {
  const {
    department_id,
    actor_id,
    event_type,
    date_from,
    date_to,
    page    = 1,
    perPage = 20,
  } = filters

  const params = []
  const where  = []

  // ── Escopo de departamento por role ────────────────────────────────────────
  if (actor.role !== 'super_admin') {
    params.push(actor.deptIds)
    where.push(`dt.department_id = ANY($${params.length}::uuid[])`)
  }

  // ── Filtros opcionais ──────────────────────────────────────────────────────
  if (department_id) {
    if (actor.role === 'super_admin' || actor.deptIds.includes(department_id)) {
      params.push(department_id)
      where.push(`dt.department_id = $${params.length}`)
    }
  }

  if (actor_id) {
    params.push(actor_id)
    where.push(`dh.actor_id = $${params.length}`)
  }

  if (event_type) {
    params.push(event_type)
    where.push(`dh.event_type = $${params.length}`)
  }

  if (date_from) {
    params.push(date_from)
    where.push(`dh.entered_at >= $${params.length}`)
  }

  if (date_to) {
    params.push(date_to)
    where.push(`dh.entered_at <= $${params.length}`)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // JOINs base compartilhados por COUNT e ITEMS
  const baseJoins = `
    FROM demand_history dh
    JOIN demands      d    ON d.id    = dh.demand_id
    JOIN demand_types dt   ON dt.id   = d.demand_type_id
    JOIN departments  dept ON dept.id = dt.department_id
  `

  // ── COUNT ──────────────────────────────────────────────────────────────────
  const { rows: [{ total }] } = await query(
    `SELECT COUNT(*) AS total ${baseJoins} ${whereClause}`,
    params
  )

  // ── ITEMS ─────────────────────────────────────────────────────────────────
  const offset = (page - 1) * perPage
  params.push(perPage, offset)

  const { rows: items } = await query(
    `SELECT
       dh.id,
       dh.demand_id,
       dh.event_type,
       dh.exception_state,
       dh.notes,
       dh.entered_at,
       d.title               AS demand_title,
       dept.id               AS department_id,
       dept.name             AS department_name,
       a.id                  AS actor_id,
       a.name                AS actor_name,
       ws.id                 AS stage_id,
       ws.name               AS stage_name,
       assignee.id           AS assignee_id,
       assignee.name         AS assignee_name
     ${baseJoins}
     LEFT JOIN users           a        ON a.id        = dh.actor_id
     LEFT JOIN workflow_stages ws       ON ws.id       = dh.stage_id
     LEFT JOIN users           assignee ON assignee.id = dh.assignee_id
     ${whereClause}
     ORDER BY dh.entered_at DESC
     LIMIT  $${params.length - 1}
     OFFSET $${params.length}`,
    params
  )

  return {
    items,
    total:   Number(total),
    page,
    perPage,
    hasMore: page * perPage < Number(total),
  }
}

/**
 * Lista atores únicos visíveis ao actor (para o filtro de usuário no frontend).
 */
export async function listAuditActors(actor) {
  const params = []
  let scopeClause = ''

  if (actor.role !== 'super_admin') {
    params.push(actor.deptIds)
    scopeClause = `WHERE dt.department_id = ANY($1::uuid[])`
  }

  const { rows } = await query(
    `SELECT DISTINCT ON (a.id)
       a.id,
       a.name
     FROM demand_history dh
     JOIN demands      d  ON d.id  = dh.demand_id
     JOIN demand_types dt ON dt.id = d.demand_type_id
     JOIN users        a  ON a.id  = dh.actor_id
     ${scopeClause}
     ORDER BY a.id, a.name`,
    params
  )
  return rows
}
