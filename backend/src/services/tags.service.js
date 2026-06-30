/**
 * Tags Service.
 *
 * Responsabilidades:
 *   listTags           — lista tags do(s) departamento(s) do ator
 *   createTag          — cria tag (admin only, escopo de departamento)
 *   deleteTag          — remove tag e todos os vínculos em cascata (admin only)
 *   addTagToDemand     — vincula tag a demanda (valida mesma dept)
 *   removeTagFromDemand — desvincula tag de demanda
 */
import { query } from '#config/database.js'

function assertAdmin(actor) {
  if (actor.role === 'user') {
    throw Object.assign(
      new Error('Apenas administradores podem gerenciar tags.'),
      { status: 403 }
    )
  }
}

function assertDeptScope(actor, departmentId) {
  if (actor.role === 'super_admin') return
  if (!actor.deptIds.includes(departmentId)) {
    throw Object.assign(
      new Error('Operação fora do seu escopo de departamento.'),
      { status: 403 }
    )
  }
}

/**
 * Lista tags filtradas por departamento.
 * Se department_id fornecido → filtra por ele (valida escopo).
 * Sem department_id → retorna todas as tags dos departamentos do ator.
 */
export async function listTags(actor, departmentId = null) {
  const conditions = []
  const params = []

  if (departmentId) {
    assertDeptScope(actor, departmentId)
    params.push(departmentId)
    conditions.push(`t.department_id = $${params.length}`)
  } else if (actor.role !== 'super_admin') {
    params.push(actor.deptIds)
    conditions.push(`t.department_id = ANY($${params.length}::uuid[])`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await query(
    `SELECT t.id, t.department_id, t.name, t.color_hex, t.created_at
     FROM tags t
     ${where}
     ORDER BY t.name ASC`,
    params
  )
  return rows
}

/**
 * Cria uma nova tag para um departamento.
 * Admin only; valida escopo de departamento.
 */
export async function createTag(actor, { name, color_hex = '#6366f1', department_id }) {
  assertAdmin(actor)
  assertDeptScope(actor, department_id)

  const { rows } = await query(
    `INSERT INTO tags (department_id, name, color_hex)
     VALUES ($1, $2, $3)
     RETURNING id, department_id, name, color_hex, created_at`,
    [department_id, name.trim().slice(0, 100), color_hex]
  )
  return rows[0]
}

/**
 * Remove uma tag (e todos os vínculos demand_tags em cascata).
 * Admin only; valida escopo de departamento.
 */
export async function deleteTag(actor, tagId) {
  assertAdmin(actor)

  const { rows } = await query(
    `SELECT department_id FROM tags WHERE id = $1`,
    [tagId]
  )
  if (!rows[0]) throw Object.assign(new Error('Tag não encontrada.'), { status: 404 })
  assertDeptScope(actor, rows[0].department_id)

  await query(`DELETE FROM tags WHERE id = $1`, [tagId])
}

/**
 * Vincula uma tag a uma demanda.
 * Valida que tag e demanda pertencem ao mesmo departamento.
 * Idempotente (ON CONFLICT DO NOTHING).
 * Retorna o objeto tag para uso otimista no frontend.
 */
export async function addTagToDemand(actor, demandId, tagId) {
  const { rows: demandRows } = await query(
    `SELECT dt.department_id
     FROM demands d
     JOIN demand_types dt ON dt.id = d.demand_type_id
     WHERE d.id = $1`,
    [demandId]
  )
  if (!demandRows[0]) throw Object.assign(new Error('Demanda não encontrada.'), { status: 404 })
  assertDeptScope(actor, demandRows[0].department_id)

  const { rows: tagRows } = await query(
    `SELECT id, department_id, name, color_hex FROM tags WHERE id = $1`,
    [tagId]
  )
  if (!tagRows[0]) throw Object.assign(new Error('Tag não encontrada.'), { status: 404 })

  if (demandRows[0].department_id !== tagRows[0].department_id) {
    throw Object.assign(
      new Error('A tag não pertence ao mesmo departamento da demanda.'),
      { status: 422 }
    )
  }

  await query(
    `INSERT INTO demand_tags (demand_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [demandId, tagId]
  )
  return tagRows[0]
}

/**
 * Desvincula uma tag de uma demanda.
 * Silencioso se o vínculo já não existir (idempotente).
 */
export async function removeTagFromDemand(actor, demandId, tagId) {
  const { rows: demandRows } = await query(
    `SELECT dt.department_id
     FROM demands d
     JOIN demand_types dt ON dt.id = d.demand_type_id
     WHERE d.id = $1`,
    [demandId]
  )
  if (!demandRows[0]) throw Object.assign(new Error('Demanda não encontrada.'), { status: 404 })
  assertDeptScope(actor, demandRows[0].department_id)

  await query(
    `DELETE FROM demand_tags WHERE demand_id = $1 AND tag_id = $2`,
    [demandId, tagId]
  )
}
