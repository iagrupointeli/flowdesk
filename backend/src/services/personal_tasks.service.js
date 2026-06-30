import { query } from '#config/database.js'

export async function listTasks(userId, role, { assigneeId } = {}) {
  const params = []
  const conditions = ['t.archived_at IS NULL']

  if (role === 'super_admin' && assigneeId) {
    params.push(assigneeId)
    conditions.push(`t.assignee_id = $${params.length}`)
  } else if (role !== 'super_admin') {
    params.push(userId)
    conditions.push(`(t.assignee_id = $${params.length} OR t.created_by = $${params.length})`)
  }

  const where = conditions.join(' AND ')

  const { rows } = await query(
    `SELECT
       t.id, t.title, t.notes, t.project, t.section,
       t.due_date, t.status, t.position,
       t.created_at, t.completed_at,
       t.assignee_id,
       u.name  AS assignee_name,
       u.email AS assignee_email
     FROM personal_tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE ${where}
     ORDER BY t.project NULLS LAST, t.section NULLS LAST, t.position ASC NULLS LAST, t.due_date ASC NULLS LAST, t.created_at ASC`,
    params
  )
  return rows
}

export async function createTask(userId, data) {
  const { title, notes, project, section, assignee_id, due_date } = data

  const { rows: [task] } = await query(
    `INSERT INTO personal_tasks
       (title, notes, project, section, assignee_id, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      title,
      notes ?? null,
      project ?? null,
      section ?? null,
      assignee_id ?? userId,
      due_date ?? null,
      userId,
    ]
  )
  return task
}

export async function updateTask(id, userId, role, data) {
  const { title, notes, project, section, assignee_id, due_date, status } = data

  const { rows: [existing] } = await query(
    'SELECT * FROM personal_tasks WHERE id = $1 AND archived_at IS NULL',
    [id]
  )
  if (!existing) {
    const err = new Error('Tarefa não encontrada.')
    err.status = 404
    throw err
  }
  if (role !== 'super_admin' && existing.created_by !== userId && existing.assignee_id !== userId) {
    const err = new Error('Sem permissão para editar esta tarefa.')
    err.status = 403
    throw err
  }

  const newStatus = status ?? existing.status
  const completedAt =
    newStatus === 'done' && existing.status !== 'done'
      ? new Date()
      : newStatus === 'todo'
      ? null
      : existing.completed_at

  const { rows: [updated] } = await query(
    `UPDATE personal_tasks SET
       title        = COALESCE($1, title),
       notes        = $2,
       project      = $3,
       section      = $4,
       assignee_id  = $5,
       due_date     = $6,
       status       = $7,
       completed_at = $8
     WHERE id = $9
     RETURNING *`,
    [
      title ?? null,
      notes !== undefined ? notes : existing.notes,
      project !== undefined ? project : existing.project,
      section !== undefined ? section : existing.section,
      assignee_id !== undefined ? assignee_id : existing.assignee_id,
      due_date !== undefined ? due_date : existing.due_date,
      newStatus,
      completedAt,
      id,
    ]
  )
  return updated
}

export async function reorderTask(id, userId, role, newPosition) {
  const { rows: [existing] } = await query(
    'SELECT * FROM personal_tasks WHERE id = $1 AND archived_at IS NULL',
    [id]
  )
  if (!existing) {
    const err = new Error('Tarefa não encontrada.')
    err.status = 404
    throw err
  }
  if (role !== 'super_admin' && existing.created_by !== userId && existing.assignee_id !== userId) {
    const err = new Error('Sem permissão para reordenar esta tarefa.')
    err.status = 403
    throw err
  }

  const { rows: [updated] } = await query(
    'UPDATE personal_tasks SET position = $1 WHERE id = $2 RETURNING *',
    [newPosition, id]
  )
  return updated
}

export async function archiveTask(id, userId, role) {
  const { rows: [existing] } = await query(
    'SELECT * FROM personal_tasks WHERE id = $1 AND archived_at IS NULL',
    [id]
  )
  if (!existing) {
    const err = new Error('Tarefa não encontrada.')
    err.status = 404
    throw err
  }
  if (role !== 'super_admin' && existing.created_by !== userId) {
    const err = new Error('Sem permissão para arquivar esta tarefa.')
    err.status = 403
    throw err
  }

  await query(
    'UPDATE personal_tasks SET archived_at = NOW() WHERE id = $1',
    [id]
  )
}
