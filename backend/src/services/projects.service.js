import { query }              from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'

// ── Projetos ─────────────────────────────────────────────────────────────────

export async function listProjects(userId, role) {
  const { rows } = await query(
    `SELECT p.id, p.name, p.description, p.color, p.area_id, p.visibility, p.created_at,
            COUNT(DISTINCT pm2.user_id)::int AS member_count,
            COUNT(DISTINCT pt.id)::int       AS task_count,
            COUNT(DISTINCT pt.id) FILTER (WHERE pt.status = 'done')::int AS done_count
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
     ORDER BY p.created_at DESC`,
    [role, userId]
  )
  return rows
}

export async function createProject(userId, data) {
  const { name, description, color, area_id, visibility } = data
  const { rows: [proj] } = await query(
    `INSERT INTO projects (name, description, color, owner_id, area_id, visibility)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, description ?? null, color ?? '#6366f1', userId, area_id ?? null, visibility ?? 'private']
  )
  await query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, 'proprietário') ON CONFLICT DO NOTHING`,
    [proj.id, userId]
  )
  await query(
    `INSERT INTO project_sections (project_id, name, position)
     VALUES ($1, 'A fazer', 0)`,
    [proj.id]
  )
  return proj
}

export async function getProject(id, userId, role) {
  const { rows: [proj] } = await query(
    `SELECT p.*
     FROM projects p
     WHERE p.id = $1 AND p.archived_at IS NULL
       AND (
         $2 = 'super_admin'
         OR p.visibility = 'public'
         OR EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = p.id AND pm.user_id = $3
         )
       )`,
    [id, role, userId]
  )
  if (!proj) { const e = new Error('Projeto não encontrado.'); e.status = 404; throw e }
  return proj
}

export async function updateProject(id, userId, role, data) {
  await assertProjectAccess(id, userId, role, ['proprietário'])
  const { name, description, color, area_id, visibility } = data
  const { rows: [proj] } = await query(
    `UPDATE projects SET
       name        = COALESCE($1, name),
       description = COALESCE($2, description),
       color       = COALESCE($3, color),
       area_id     = COALESCE($4, area_id),
       visibility  = COALESCE($5, visibility)
     WHERE id = $6 RETURNING *`,
    [name ?? null, description ?? null, color ?? null, area_id ?? null, visibility ?? null, id]
  )
  return proj
}

export async function archiveProject(id, userId, role) {
  await assertProjectAccess(id, userId, role, ['proprietário'])
  await query(`UPDATE projects SET archived_at = NOW() WHERE id = $1`, [id])
}

// ── Seções (kanban columns) ───────────────────────────────────────────────────

export async function listSections(projectId, userId, role) {
  await assertProjectAccess(projectId, userId, role)
  const { rows } = await query(
    `SELECT * FROM project_sections WHERE project_id = $1 ORDER BY position ASC`,
    [projectId]
  )
  return rows
}

export async function createSection(projectId, userId, role, name) {
  await assertProjectAccess(projectId, userId, role)
  const { rows: [{ max_pos }] } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS max_pos FROM project_sections WHERE project_id = $1`,
    [projectId]
  )
  const { rows: [sec] } = await query(
    `INSERT INTO project_sections (project_id, name, position)
     VALUES ($1, $2, $3) RETURNING *`,
    [projectId, name, max_pos]
  )
  return sec
}

export async function renameSection(projectId, sectionId, userId, role, newName) {
  await assertProjectAccess(projectId, userId, role)
  const { rows: [sec] } = await query(
    `SELECT name FROM project_sections WHERE id = $1 AND project_id = $2`,
    [sectionId, projectId]
  )
  if (!sec) { const e = new Error('Seção não encontrada.'); e.status = 404; throw e }
  const oldName = sec.name
  await query(`UPDATE project_sections SET name = $1 WHERE id = $2`, [newName, sectionId])
  await query(
    `UPDATE personal_tasks SET section = $1 WHERE project_id = $2 AND section = $3`,
    [newName, projectId, oldName]
  )
  return { id: sectionId, name: newName }
}

export async function deleteSection(projectId, sectionId, userId, role) {
  await assertProjectAccess(projectId, userId, role)
  await query(
    `UPDATE personal_tasks SET section = NULL WHERE project_id = $1 AND section = (
       SELECT name FROM project_sections WHERE id = $2
     )`,
    [projectId, sectionId]
  )
  await query(`DELETE FROM project_sections WHERE id = $1 AND project_id = $2`, [sectionId, projectId])
}

// ── Membros ───────────────────────────────────────────────────────────────────

export async function listMembers(projectId, userId, role) {
  await assertProjectAccess(projectId, userId, role)
  const { rows } = await query(
    `SELECT pm.id, pm.user_id, pm.role, pm.invited_at,
            u.name  AS user_name,
            u.email AS user_email
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY pm.invited_at ASC`,
    [projectId]
  )
  return rows
}

export async function addMember(projectId, targetUserId, memberRole, invitedBy) {
  const [{ rows: [proj] }, { rows: [inviter] }] = await Promise.all([
    query(`SELECT name FROM projects WHERE id = $1`, [projectId]),
    query(`SELECT name FROM users   WHERE id = $1`, [invitedBy]),
  ])
  const { rows: [member] } = await query(
    `INSERT INTO project_members (project_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [projectId, targetUserId, memberRole, invitedBy]
  )
  createNotification(
    targetUserId,
    `${inviter?.name ?? 'Alguém'} te adicionou ao projeto "${proj?.name}" como ${memberRole}.`,
    `/projects/${projectId}`,
    'system'
  ).catch(() => {})
  return member
}

export async function updateMemberRole(projectId, targetUserId, userId, role, newRole) {
  await assertProjectAccess(projectId, userId, role, ['proprietário'])
  const { rows: [m] } = await query(
    `UPDATE project_members SET role = $1
     WHERE project_id = $2 AND user_id = $3 RETURNING *`,
    [newRole, projectId, targetUserId]
  )
  return m
}

export async function removeMember(projectId, targetUserId, userId, role) {
  await assertProjectAccess(projectId, userId, role, ['proprietário'])
  await query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, targetUserId]
  )
}

// ── Tarefas do projeto ────────────────────────────────────────────────────────

export async function listProjectTasks(projectId, userId, role) {
  await assertProjectAccess(projectId, userId, role)
  const { rows } = await query(
    `SELECT pt.*,
            u.name  AS assignee_name,
            u.email AS assignee_email
     FROM personal_tasks pt
     LEFT JOIN users u ON u.id = pt.assignee_id
     WHERE pt.project_id = $1 AND pt.archived_at IS NULL
     ORDER BY pt.section NULLS LAST, pt.position ASC, pt.created_at ASC`,
    [projectId]
  )
  return rows
}

export async function createProjectTask(projectId, userId, userRole, data) {
  await assertProjectAccess(projectId, userId, userRole)
  const { title, section, due_date, assignee_id } = data
  const { rows: [{ next_pos }] } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
     FROM personal_tasks
     WHERE project_id = $1 AND (section IS NOT DISTINCT FROM $2) AND archived_at IS NULL`,
    [projectId, section ?? null]
  )
  const { rows: [proj] } = await query(`SELECT name FROM projects WHERE id = $1`, [projectId])
  const { rows: [task] } = await query(
    `INSERT INTO personal_tasks
       (title, section, project_id, assignee_id, due_date, position, created_by, project)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [title, section ?? null, projectId, assignee_id ?? userId, due_date ?? null, next_pos, userId, proj?.name ?? null]
  )
  return task
}

// ── Helper de autorização ─────────────────────────────────────────────────────

async function assertProjectAccess(projectId, userId, role, allowedRoles = null) {
  if (role === 'super_admin') return
  const { rows: [row] } = await query(
    `SELECT pm.role, p.visibility, p.area_id,
            (SELECT 1 FROM area_members am WHERE am.area_id = p.area_id AND am.user_id = $2) AS is_area_member
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1 AND p.archived_at IS NULL`,
    [projectId, userId]
  )
  if (!row) { const e = new Error('Projeto não encontrado.'); e.status = 404; throw e }
  const isAreaMember = !!row.is_area_member
  // leitura livre: public, membros do projeto ou membros da área (para limited)
  if (!allowedRoles) {
    if (row.visibility === 'public' || row.role || (row.visibility === 'limited' && isAreaMember)) return
    const e = new Error('Sem acesso a este projeto.'); e.status = 403; throw e
  }
  const m = row.role ? row : null
  if (!m) { const e = new Error('Sem acesso a este projeto.'); e.status = 403; throw e }
  if (allowedRoles && !allowedRoles.includes(m.role)) {
    const e = new Error('Permissão insuficiente no projeto.'); e.status = 403; throw e
  }
}
