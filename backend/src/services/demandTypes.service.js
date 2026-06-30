import { query, getClient } from '#config/database.js'
import cache from '#services/cache.service.js'

// ═══════════════════════════════════════════════════════════════════════════════
// DEMAND TYPES — LEITURA PÚBLICA (todos os usuários autenticados)
// Separado das funções admin que exigem assertDeptScope com role elevado.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista tipos de demanda acessíveis ao actor (leitura pública).
 * Qualquer usuário autenticado pode listar os tipos do seu departamento.
 * super_admin vê todos.
 */
export async function listTypesForBoard(actor) {
  const isAdmin = actor.role === 'super_admin'
  const { rows } = await query(
    `SELECT dt.id, dt.name, dt.department_id, d.name AS department_name
     FROM demand_types dt
     JOIN departments d ON d.id = dt.department_id
     WHERE ($1 OR dt.department_id = ANY($2::uuid[]))
       AND dt.archived_at IS NULL
     ORDER BY d.name, dt.name`,
    [isAdmin, actor.deptIds]
  )
  return rows
}

/**
 * Retorna um tipo de demanda com suas etapas ATIVAS (não arquivadas),
 * ordenadas por display_order.
 *
 * Usado pelo boardStore.fetchBoard() — acessível a qualquer usuário
 * autenticado que pertença ao departamento do tipo de demanda.
 *
 * Defensive: Se não houver etapas, retorna array vazio (nunca null).
 */
export async function getTypeWithStages(actor, demandTypeId) {
  const isAdmin = actor.role === 'super_admin'

  const { rows: dtRows } = await query(
    `SELECT dt.id, dt.name, dt.department_id, d.name AS department_name
     FROM demand_types dt
     JOIN departments d ON d.id = dt.department_id
     WHERE dt.id = $1
       AND ($2 OR dt.department_id = ANY($3::uuid[]))
       AND dt.archived_at IS NULL`,
    [demandTypeId, isAdmin, actor.deptIds]
  )

  if (!dtRows[0]) {
    throw Object.assign(
      new Error('Tipo de demanda não encontrado ou fora do seu escopo.'),
      { status: 404 }
    )
  }

  const { rows: stageRows } = await query(
    `SELECT id, name, display_order, is_final, requires_note, requires_assignee, wip_limit
     FROM workflow_stages
     WHERE demand_type_id = $1
       AND archived_at IS NULL
     ORDER BY display_order`,
    [demandTypeId]
  )

  return { ...dtRows[0], stages: stageRows }
}

/**
 * Retorna um tipo de demanda com seus CAMPOS ATIVOS (não arquivados),
 * ordenados por display_order.
 *
 * Usado pelo formulário /demands/new — acessível a qualquer usuário
 * autenticado que pertença ao departamento do tipo de demanda.
 *
 * Campos incluem: id, label, field_type, required, options, display_order.
 * options é array JSON — ex: [{ id: 'uuid', label: 'Texto' }] para type='select'.
 */
export async function getTypeWithFields(actor, demandTypeId) {
  const isAdmin = actor.role === 'super_admin'

  const { rows: dtRows } = await query(
    `SELECT dt.id, dt.name, dt.department_id, d.name AS department_name
     FROM demand_types dt
     JOIN departments d ON d.id = dt.department_id
     WHERE dt.id = $1
       AND ($2 OR dt.department_id = ANY($3::uuid[]))
       AND dt.archived_at IS NULL`,
    [demandTypeId, isAdmin, actor.deptIds]
  )

  if (!dtRows[0]) {
    throw Object.assign(
      new Error('Tipo de demanda não encontrado ou fora do seu escopo.'),
      { status: 404 }
    )
  }

  // getFields usa cache em memória — zero query extra se já carregado
  const fields = await getFields(demandTypeId, { activeOnly: true })

  return { ...dtRows[0], fields }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMAND TYPES — ADMIN (dept_admin / super_admin)
// ═══════════════════════════════════════════════════════════════════════════════

function assertDeptScope(actor, departmentId) {
  if (actor.role === 'super_admin') return
  if (!actor.deptIds.includes(departmentId)) {
    throw Object.assign(
      new Error('Tipo de demanda fora do seu escopo de departamento.'),
      { status: 403 }
    )
  }
}

export async function listDemandTypes(actor) {
  const isAdmin = actor.role === 'super_admin'
  const { rows } = await query(
    `SELECT dt.id, dt.name, dt.description, dt.sla_hours, dt.department_id,
            d.name AS department_name, dt.archived_at, dt.created_at
     FROM demand_types dt
     JOIN departments d ON d.id = dt.department_id
     WHERE ($1 OR dt.department_id = ANY($2::uuid[]))
     ORDER BY dt.archived_at NULLS FIRST, d.name, dt.name`,
    [isAdmin, actor.deptIds]
  )
  return rows
}

export async function createDemandType(actor, data) {
  assertDeptScope(actor, data.department_id)
  const { rows } = await query(
    `INSERT INTO demand_types (name, description, sla_hours, department_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, sla_hours, department_id, created_at`,
    [data.name, data.description ?? null, data.sla_hours ?? null, data.department_id]
  )
  return rows[0]
}

export async function updateDemandType(actor, id, data) {
  // Verifica ownership antes de alterar
  const { rows: existing } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, existing[0].department_id)

  // sla_hours aceita null explícito para remover o SLA do tipo
  // Diferente de description/name, que usam COALESCE (null = não alterar).
  // Para sla_hours: null enviado = remover SLA, undefined = não alterar.
  const hasSla  = data.sla_hours !== undefined
  const slaExpr = hasSla ? '$4' : 'sla_hours'

  const { rows } = await query(
    `UPDATE demand_types
     SET name        = COALESCE($1, name),
         description = COALESCE($2, description),
         sla_hours   = ${slaExpr},
         updated_at  = NOW()
     WHERE id = $3
     RETURNING id, name, description, sla_hours, department_id`,
    hasSla
      ? [data.name ?? null, data.description ?? null, id, data.sla_hours]
      : [data.name ?? null, data.description ?? null, id]
  )
  return rows[0]
}

/**
 * Arquiva um tipo de demanda (soft-delete).
 *
 * ── Trava de integridade ─────────────────────────────────────────────────────
 *
 *   Bloqueado se houver demandas deste tipo que NÃO estejam concluídas
 *   (etapa final) NEM canceladas (exception_state = 'cancelled').
 *
 *   Demandas concluídas ou canceladas não bloqueiam o arquivamento — o tipo
 *   pode ser retirado de circulação sem perda de dados históricos.
 *
 *   Após arquivamento:
 *     - O tipo desaparece do board e do formulário de criação.
 *     - Demandas existentes continuam funcionando normalmente.
 *     - Stages e fields permanecem intactos (para referência histórica).
 */
export async function archiveDemandType(actor, id) {
  const { rows: existing } = await query(
    'SELECT id, name, department_id, archived_at FROM demand_types WHERE id = $1',
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  if (existing[0].archived_at) {
    throw Object.assign(new Error('Tipo já está arquivado.'), { status: 422 })
  }
  assertDeptScope(actor, existing[0].department_id)

  // ── Trava: demandas ativas ou em espera bloqueiam o arquivamento ────────────
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total
     FROM demands d
     LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
     WHERE d.demand_type_id = $1
       AND (d.exception_state IS DISTINCT FROM 'cancelled')
       AND (ws.id IS NULL OR ws.is_final = false)`,
    [id]
  )
  if (countRows[0].total > 0) {
    throw Object.assign(
      new Error(
        `Não é possível arquivar o tipo "${existing[0].name}": ` +
        `${countRows[0].total} demanda(s) ativa(s) ou em pausa vinculada(s). ` +
        `Finalize ou cancele todas as demandas antes de arquivar.`
      ),
      { status: 422 }
    )
  }

  const { rows } = await query(
    `UPDATE demand_types
     SET archived_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, archived_at`,
    [id]
  )
  return rows[0]
}

export async function restoreDemandType(actor, id) {
  const { rows: existing } = await query(
    'SELECT id, name, department_id FROM demand_types WHERE id = $1',
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, existing[0].department_id)
  const { rows } = await query(
    `UPDATE demand_types SET archived_at = NULL, updated_at = NOW()
     WHERE id = $1 AND archived_at IS NOT NULL
     RETURNING id`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Tipo não está arquivado.'), { status: 409 })
}

export async function deleteDemandType(actor, id) {
  const { rows: existing } = await query(
    'SELECT id, name, department_id FROM demand_types WHERE id = $1',
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, existing[0].department_id)

  // Bloqueia se houver qualquer demanda ligada (mesmo cancelada — preserva histórico)
  const { rows: countRows } = await query(
    'SELECT COUNT(*)::int AS total FROM demands WHERE demand_type_id = $1',
    [id]
  )
  if (countRows[0].total > 0) {
    throw Object.assign(
      new Error(
        `Não é possível deletar o workflow "${existing[0].name}": ` +
        `${countRows[0].total} demanda(s) vinculada(s). ` +
        `Use Arquivar para ocultá-lo sem perder o histórico.`
      ),
      { status: 409 }
    )
  }

  // Cascade manual: campos, etapas, depois o tipo
  await query('DELETE FROM demand_type_fields WHERE demand_type_id = $1', [id])
  await query('DELETE FROM workflow_stages WHERE demand_type_id = $1', [id])
  await query('DELETE FROM demand_types WHERE id = $1', [id])
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMAND TYPE FIELDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna os campos de um demand_type_id.
 * Usa cache — popula se ausente.
 */
export async function getFields(demandTypeId, { activeOnly = false } = {}) {
  // Cache só armazena todos os campos; filtros aplicados após
  let fields = cache.get(demandTypeId)

  if (!fields) {
    const { rows } = await query(
      `SELECT id, demand_type_id, label, field_type, required, options, display_order, archived_at
       FROM demand_type_fields
       WHERE demand_type_id = $1
       ORDER BY display_order`,
      [demandTypeId]
    )
    fields = rows
    cache.set(demandTypeId, fields)
  }

  return activeOnly ? fields.filter(f => !f.archived_at) : fields
}

export async function createField(actor, demandTypeId, data) {
  // Verifica ownership do demand_type
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  const { rows } = await query(
    `INSERT INTO demand_type_fields
       (demand_type_id, label, field_type, required, options, display_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, label, field_type, required, options, display_order`,
    [
      demandTypeId,
      data.label,
      data.field_type,
      data.required ?? false,
      data.options ? JSON.stringify(data.options) : null,
      data.display_order ?? 0,
    ]
  )

  // Invalida cache ANTES de retornar — próxima leitura lerá do banco
  cache.invalidate(demandTypeId)
  return rows[0]
}

export async function updateField(actor, demandTypeId, fieldId, data) {
  // Verifica ownership
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  // Busca campo atual para verificar imutabilidade do field_type
  const { rows: existing } = await query(
    'SELECT field_type FROM demand_type_fields WHERE id = $1 AND demand_type_id = $2',
    [fieldId, demandTypeId]
  )
  if (!existing[0]) throw Object.assign(new Error('Campo não encontrado.'), { status: 404 })

  // IMUTABILIDADE: field_type jamais pode ser alterado após criação
  if (data.field_type !== undefined && data.field_type !== existing[0].field_type) {
    throw Object.assign(
      new Error(
        `field_type é imutável após criação. ` +
        `Valor atual: "${existing[0].field_type}". ` +
        `Para mudar o tipo, arquive este campo e crie um novo.`
      ),
      { status: 422 }
    )
  }

  const { rows } = await query(
    `UPDATE demand_type_fields
     SET label         = COALESCE($1, label),
         required      = COALESCE($2, required),
         options       = COALESCE($3, options),
         display_order = COALESCE($4, display_order)
     WHERE id = $5 AND demand_type_id = $6
     RETURNING id, label, field_type, required, options, display_order, archived_at`,
    [
      data.label       ?? null,
      data.required    ?? null,
      data.options     ? JSON.stringify(data.options) : null,
      data.display_order ?? null,
      fieldId,
      demandTypeId,
    ]
  )

  cache.invalidate(demandTypeId)   // invalida ANTES de retornar
  return rows[0]
}

export async function archiveField(actor, demandTypeId, fieldId) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  const { rows } = await query(
    `UPDATE demand_type_fields
     SET archived_at = NOW()
     WHERE id = $1 AND demand_type_id = $2 AND archived_at IS NULL
     RETURNING id, label, archived_at`,
    [fieldId, demandTypeId]
  )
  if (!rows[0]) throw Object.assign(new Error('Campo não encontrado ou já arquivado.'), { status: 404 })

  cache.invalidate(demandTypeId)   // invalida ANTES de retornar
  return rows[0]
}

/**
 * Reordena os campos de um demand_type.
 * Semelhante a reorderStages — atualiza display_order em transação.
 * Invalida o cache do tipo após commitar.
 */
export async function reorderFields(actor, demandTypeId, orderedIds) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  const client = await getClient()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE demand_type_fields
         SET display_order = $1
         WHERE id = $2 AND demand_type_id = $3 AND archived_at IS NULL`,
        [i, orderedIds[i], demandTypeId]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Invalida cache após commit — próxima leitura lerá do banco
  cache.invalidate(demandTypeId)
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW STAGES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listStages(actor, demandTypeId) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  const { rows } = await query(
    `SELECT id, name, display_order, is_final, requires_note, requires_assignee,
            wip_limit, archived_at
     FROM workflow_stages
     WHERE demand_type_id = $1
     ORDER BY display_order`,
    [demandTypeId]
  )
  return rows
}

export async function createStage(actor, demandTypeId, data) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  const { rows } = await query(
    `INSERT INTO workflow_stages
       (demand_type_id, name, display_order, is_final, requires_note, requires_assignee, requires_attachment, wip_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, display_order, is_final, requires_note, requires_assignee, requires_attachment, wip_limit`,
    [
      demandTypeId,
      data.name,
      data.display_order ?? 0,
      data.is_final             ?? false,
      data.requires_note        ?? false,
      data.requires_assignee    ?? false,
      data.requires_attachment  ?? false,
      data.wip_limit            ?? null,
    ]
  )
  return rows[0]
}

export async function reorderStages(actor, demandTypeId, orderedIds) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  // Reordenação é sempre livre — não bloqueia mesmo com demandas na etapa
  const client = await getClient()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE workflow_stages
         SET display_order = $1, updated_at = NOW()
         WHERE id = $2 AND demand_type_id = $3`,
        [i, orderedIds[i], demandTypeId]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function updateStage(actor, demandTypeId, stageId, data) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  const hasWipLimit = data.wip_limit !== undefined
  const wipExpr    = hasWipLimit ? '$8' : 'wip_limit'

  const { rows } = await query(
    `UPDATE workflow_stages
     SET name                = COALESCE($1, name),
         is_final            = COALESCE($2, is_final),
         requires_note       = COALESCE($3, requires_note),
         requires_assignee   = COALESCE($4, requires_assignee),
         requires_attachment = COALESCE($5, requires_attachment),
         wip_limit           = ${wipExpr},
         updated_at          = NOW()
     WHERE id = $6 AND demand_type_id = $7 AND archived_at IS NULL
     RETURNING id, name, display_order, is_final, requires_note, requires_assignee, requires_attachment, wip_limit`,
    hasWipLimit
      ? [data.name ?? null, data.is_final ?? null, data.requires_note ?? null, data.requires_assignee ?? null, data.requires_attachment ?? null, stageId, demandTypeId, data.wip_limit]
      : [data.name ?? null, data.is_final ?? null, data.requires_note ?? null, data.requires_assignee ?? null, data.requires_attachment ?? null, stageId, demandTypeId]
  )
  if (!rows[0]) throw Object.assign(new Error('Etapa não encontrada ou arquivada.'), { status: 404 })
  return rows[0]
}

/**
 * Arquiva uma etapa do workflow.
 *
 * ── Trava absoluta de integridade ────────────────────────────────────────────
 *
 *   É PROIBIDO arquivar uma etapa se houver qualquer demanda vinculada a ela,
 *   independentemente do estado (ativa, em pausa ou cancelada).
 *
 *   Rationale:
 *     - Demandas ativas na etapa perderiam o contexto de posicionamento.
 *     - Demandas canceladas/finalizadas ainda registram current_stage_id
 *       como referência histórica — alterar isso comprometeria a auditoria.
 *
 *   O admin DEVE mover todas as demandas para outra etapa antes de arquivar.
 *   Não há migração automática (fallback_stage_id foi removido) para forçar
 *   uma decisão consciente sobre cada demanda.
 *
 *   Hard delete é impossível por FK ON DELETE RESTRICT em:
 *     demands.current_stage_id → workflow_stages.id
 *     demand_history.stage_id  → workflow_stages.id
 */
export async function archiveStage(actor, demandTypeId, stageId) {
  const { rows: dt } = await query(
    'SELECT department_id FROM demand_types WHERE id = $1',
    [demandTypeId]
  )
  if (!dt[0]) throw Object.assign(new Error('Tipo não encontrado.'), { status: 404 })
  assertDeptScope(actor, dt[0].department_id)

  // Verifica: etapa existe, pertence ao tipo e não está já arquivada
  const { rows: stageRows } = await query(
    `SELECT id, name, archived_at FROM workflow_stages
     WHERE id = $1 AND demand_type_id = $2`,
    [stageId, demandTypeId]
  )
  if (!stageRows[0]) {
    throw Object.assign(new Error('Etapa não encontrada neste tipo de demanda.'), { status: 404 })
  }
  if (stageRows[0].archived_at) {
    throw Object.assign(new Error('Etapa já está arquivada.'), { status: 422 })
  }

  // ── TRAVA ABSOLUTA: qualquer demanda vinculada bloqueia o arquivamento ──────
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total FROM demands WHERE current_stage_id = $1`,
    [stageId]
  )
  if (countRows[0].total > 0) {
    throw Object.assign(
      new Error(
        `Não é possível arquivar a etapa "${stageRows[0].name}": ` +
        `${countRows[0].total} demanda(s) ativa(s) ou finalizada(s) estão vinculadas. ` +
        `Mova todas as demandas para outra etapa antes de arquivar.`
      ),
      { status: 422 }
    )
  }

  await query(
    `UPDATE workflow_stages SET archived_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [stageId]
  )
  return { message: `Etapa "${stageRows[0].name}" arquivada com sucesso.` }
}
