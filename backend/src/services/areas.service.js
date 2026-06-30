import { query } from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'

export async function listAreas(userId, role) {
  const { rows: areas } = await query(
    `SELECT a.id, a.name, a.description, a.color, a.created_at
     FROM areas a
     WHERE a.archived_at IS NULL
     ORDER BY a.name ASC`,
    []
  )

  if (areas.length === 0) return []

  const { rows: projects } = await query(
    `SELECT p.id, p.name, p.color, p.area_id, p.visibility,
            COUNT(DISTINCT pm2.user_id)::int AS member_count,
            COUNT(DISTINCT pt.id)::int       AS task_count
     FROM projects p
     LEFT JOIN project_members pm  ON pm.project_id  = p.id AND pm.user_id = $2
     LEFT JOIN project_members pm2 ON pm2.project_id = p.id
     LEFT JOIN personal_tasks pt   ON pt.project_id  = p.id AND pt.archived_at IS NULL
     LEFT JOIN area_members am     ON am.area_id = p.area_id AND am.user_id = $2
     WHERE p.archived_at IS NULL
       AND (
         $1 = 'super_admin'
         OR p.visibility = 'public'
         OR pm.user_id   IS NOT NULL
         OR (p.visibility = 'limited' AND am.user_id IS NOT NULL)
       )
     GROUP BY p.id
     ORDER BY p.name ASC`,
    [role, userId]
  )

  const projectsByArea = projects.reduce((acc, p) => {
    const key = p.area_id ?? '__sem_area__'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  const mapped = areas.map(a => ({ ...a, projects: projectsByArea[a.id] ?? [] }))
  if (role === 'super_admin') return mapped
  return mapped.filter(a => a.projects.length > 0)
}

export async function listAreaTasks(areaId, userId, role) {
  const { rows } = await query(
    `SELECT pt.*,
            u.name  AS assignee_name,
            p.name  AS project_name,
            p.color AS project_color
     FROM personal_tasks pt
     JOIN projects p ON p.id = pt.project_id
     LEFT JOIN users u ON u.id = pt.assignee_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $3
     LEFT JOIN area_members am    ON am.area_id = p.area_id AND am.user_id = $3
     WHERE p.area_id = $1
       AND pt.archived_at IS NULL
       AND p.archived_at  IS NULL
       AND (
         $2 = 'super_admin'
         OR p.visibility = 'public'
         OR pm.user_id   IS NOT NULL
         OR (p.visibility = 'limited' AND am.user_id IS NOT NULL)
       )
     ORDER BY p.name ASC, pt.section NULLS LAST, pt.position ASC`,
    [areaId, role, userId]
  )
  return rows
}

export async function listAreaMembers(areaId) {
  const { rows } = await query(
    `SELECT am.id, am.user_id, am.invited_at,
            u.name  AS user_name,
            u.email AS user_email
     FROM area_members am
     JOIN users u ON u.id = am.user_id
     WHERE am.area_id = $1
     ORDER BY am.invited_at ASC`,
    [areaId]
  )
  return rows
}

export async function addAreaMember(areaId, targetUserId, invitedBy) {
  const [{ rows: [area] }, { rows: [inviter] }] = await Promise.all([
    query(`SELECT name FROM areas WHERE id = $1`, [areaId]),
    query(`SELECT name FROM users WHERE id = $1`, [invitedBy]),
  ])
  const { rows: [member] } = await query(
    `INSERT INTO area_members (area_id, user_id, invited_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (area_id, user_id) DO NOTHING
     RETURNING *`,
    [areaId, targetUserId, invitedBy]
  )
  if (member) {
    createNotification(
      targetUserId,
      `${inviter?.name ?? 'Alguém'} te adicionou à área "${area?.name}".`,
      '/areas',
      'system'
    ).catch(() => {})
  }
  return member ?? null
}

export async function removeAreaMember(areaId, targetUserId) {
  await query(
    `DELETE FROM area_members WHERE area_id = $1 AND user_id = $2`,
    [areaId, targetUserId]
  )
}

export async function createArea(userId, data) {
  const { name, description, color } = data
  const { rows: [area] } = await query(
    `INSERT INTO areas (name, description, color, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description ?? null, color ?? '#6366f1', userId]
  )
  return area
}

export async function updateArea(id, userId, role, data) {
  if (role !== 'super_admin') {
    const { rows: [a] } = await query(`SELECT created_by FROM areas WHERE id = $1`, [id])
    if (!a || a.created_by !== userId) {
      const e = new Error('Sem permissão para editar esta área.'); e.status = 403; throw e
    }
  }
  const { name, description, color } = data
  const { rows: [area] } = await query(
    `UPDATE areas SET
       name        = COALESCE($1, name),
       description = COALESCE($2, description),
       color       = COALESCE($3, color)
     WHERE id = $4 RETURNING *`,
    [name ?? null, description ?? null, color ?? null, id]
  )
  return area
}

export async function archiveArea(id, userId, role) {
  if (role !== 'super_admin') {
    const { rows: [a] } = await query(`SELECT created_by FROM areas WHERE id = $1`, [id])
    if (!a || a.created_by !== userId) {
      const e = new Error('Sem permissão para arquivar esta área.'); e.status = 403; throw e
    }
  }
  await query(`UPDATE areas SET archived_at = NOW() WHERE id = $1`, [id])
}
