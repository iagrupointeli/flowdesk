/**
 * checklists.service.js — CRUD de itens de checklist por demanda.
 *
 * Acesso: qualquer usuário autenticado que pertença ao departamento da demanda.
 * Guard de finalização: moveStage verifica pendências antes de etapas finais.
 */

import { query } from '#config/database.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertDemandScope(actor, demand) {
  if (actor.role === 'super_admin') return
  if (!actor.deptIds.includes(demand.department_id)) {
    throw Object.assign(new Error('Acesso negado.'), { status: 403 })
  }
}

async function getDemandWithDept(demandId) {
  const { rows } = await query(
    `SELECT d.id, dt.department_id, d.exception_state,
            COALESCE(ws.is_final, false) AS is_final
     FROM demands d
     JOIN demand_types dt ON dt.id = d.demand_type_id
     LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
     WHERE d.id = $1`,
    [demandId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('Demanda não encontrada.'), { status: 404 })
  }
  return rows[0]
}

function assertNotFrozen(demand) {
  if (demand.exception_state === 'cancelled' || demand.is_final) {
    throw Object.assign(
      new Error('Não é possível modificar checklists de demandas finalizadas ou canceladas.'),
      { status: 422 }
    )
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listChecklists(actor, demandId) {
  const demand = await getDemandWithDept(demandId)
  assertDemandScope(actor, demand)

  const { rows } = await query(
    `SELECT ci.id, ci.title, ci.is_completed, ci.display_order,
            ci.completed_at, u.name AS completed_by_name
     FROM demand_checklists ci
     LEFT JOIN users u ON u.id = ci.completed_by
     WHERE ci.demand_id = $1
     ORDER BY ci.display_order, ci.created_at`,
    [demandId]
  )
  return rows
}

export async function createChecklist(actor, demandId, data) {
  const demand = await getDemandWithDept(demandId)
  assertDemandScope(actor, demand)
  assertNotFrozen(demand)

  const { rows: maxRows } = await query(
    `SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order
     FROM demand_checklists WHERE demand_id = $1`,
    [demandId]
  )

  const { rows } = await query(
    `INSERT INTO demand_checklists (demand_id, title, display_order)
     VALUES ($1, $2, $3)
     RETURNING id, title, is_completed, display_order, completed_at,
               NULL::text AS completed_by_name`,
    [demandId, data.title, maxRows[0].next_order]
  )
  return rows[0]
}

/**
 * Atualiza título e/ou estado de conclusão de um item.
 *
 * Lógica de completed_by / completed_at:
 *   is_completed = true  → registra actor + NOW()
 *   is_completed = false → limpa ambos
 *   is_completed ausente → mantém valor existente (ao editar apenas o título)
 */
export async function updateChecklist(actor, demandId, itemId, data) {
  const { rows: existing } = await query(
    `SELECT ci.id, dt.department_id, d.exception_state,
            COALESCE(ws.is_final, false) AS is_final
     FROM demand_checklists ci
     JOIN demands d ON d.id = ci.demand_id
     JOIN demand_types dt ON dt.id = d.demand_type_id
     LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
     WHERE ci.id = $1 AND ci.demand_id = $2`,
    [itemId, demandId]
  )
  if (!existing[0]) {
    throw Object.assign(new Error('Item não encontrado.'), { status: 404 })
  }
  assertDemandScope(actor, existing[0])
  assertNotFrozen(existing[0])

  const { rows } = await query(
    `UPDATE demand_checklists
     SET title         = COALESCE($3, title),
         is_completed  = COALESCE($4, is_completed),
         completed_by  = CASE
                           WHEN $4 = true  THEN $5
                           WHEN $4 = false THEN NULL
                           ELSE completed_by
                         END,
         completed_at  = CASE
                           WHEN $4 = true  THEN NOW()
                           WHEN $4 = false THEN NULL
                           ELSE completed_at
                         END
     WHERE id = $1 AND demand_id = $2
     RETURNING id, title, is_completed, display_order, completed_at`,
    [
      itemId,
      demandId,
      data.title        ?? null,
      data.is_completed ?? null,
      actor.id,
    ]
  )
  return rows[0]
}

export async function deleteChecklist(actor, demandId, itemId) {
  const { rows } = await query(
    `SELECT ci.id, dt.department_id, d.exception_state,
            COALESCE(ws.is_final, false) AS is_final
     FROM demand_checklists ci
     JOIN demands d ON d.id = ci.demand_id
     JOIN demand_types dt ON dt.id = d.demand_type_id
     LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
     WHERE ci.id = $1 AND ci.demand_id = $2`,
    [itemId, demandId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('Item não encontrado.'), { status: 404 })
  }
  assertDemandScope(actor, rows[0])
  assertNotFrozen(rows[0])

  await query('DELETE FROM demand_checklists WHERE id = $1', [itemId])
  return { message: 'Item removido.' }
}
