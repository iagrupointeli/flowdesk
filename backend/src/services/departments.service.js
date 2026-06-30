import { query } from '#config/database.js'

export async function listDepartments() {
  const { rows } = await query(
    `SELECT id, name, description, created_at
     FROM departments
     WHERE archived_at IS NULL
     ORDER BY name`
  )
  return rows
}

export async function createDepartment(data) {
  const { rows } = await query(
    `INSERT INTO departments (name, description)
     VALUES ($1, $2)
     RETURNING id, name, description, created_at`,
    [data.name, data.description ?? null]
  )
  return rows[0]
}

export async function updateDepartment(id, data) {
  const { rows } = await query(
    `UPDATE departments
     SET name        = COALESCE($1, name),
         description = COALESCE($2, description),
         updated_at  = NOW()
     WHERE id = $3 AND archived_at IS NULL
     RETURNING id, name, description`,
    [data.name ?? null, data.description ?? null, id]
  )
  if (!rows[0]) throw Object.assign(new Error('Departamento não encontrado.'), { status: 404 })
  return rows[0]
}

export async function archiveDepartment(id) {
  const { rows } = await query(
    `UPDATE departments
     SET archived_at = NOW()
     WHERE id = $1 AND archived_at IS NULL
     RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Departamento não encontrado ou já arquivado.'), { status: 404 })
}

export async function listArchivedDepartments() {
  const { rows } = await query(
    `SELECT id, name, description, archived_at
     FROM departments
     WHERE archived_at IS NOT NULL
     ORDER BY archived_at DESC`
  )
  return rows
}

export async function restoreDepartment(id) {
  const { rows } = await query(
    `UPDATE departments
     SET archived_at = NULL, updated_at = NOW()
     WHERE id = $1 AND archived_at IS NOT NULL
     RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Departamento não encontrado ou não está arquivado.'), { status: 404 })
}
