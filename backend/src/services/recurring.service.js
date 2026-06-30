import { query }                          from '#config/database.js'
import { createDemand, validatePayload } from '#services/demands.service.js'
import { getFields }                      from '#services/demandTypes.service.js'
import { createNotification }             from '#services/notifications.service.js'
import { logger }                         from '#lib/logger.js'

const log = logger.child({ module: 'recurring' })

// ── Helpers ───────────────────────────────────────────────────────────────────

function assertScope(actor, departmentId) {
  if (actor.role === 'super_admin') return
  if (!actor.deptIds.includes(departmentId)) {
    throw Object.assign(new Error('Tipo de demanda fora do seu escopo.'), { status: 403 })
  }
}

/**
 * Valida que o tipo existe, está no escopo do ator e que o payload do
 * template passa na validação dos campos ativos do tipo.
 * Retorna o department_id do tipo.
 */
async function assertTypeAndPayload(actor, demandTypeId, payload) {
  const { rows } = await query(
    'SELECT id, department_id FROM demand_types WHERE id = $1 AND archived_at IS NULL',
    [demandTypeId]
  )
  if (!rows[0]) throw Object.assign(new Error('Tipo de demanda não encontrado.'), { status: 404 })
  assertScope(actor, rows[0].department_id)

  const allFields = await getFields(demandTypeId, { activeOnly: false })
  const snapshot  = allFields.filter(f => !f.archived_at)
  validatePayload(snapshot, payload)   // lança 422 com fieldErrors se inválido

  return rows[0].department_id
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listTemplates(actor) {
  const params = []
  let scope = ''
  if (actor.role !== 'super_admin') {
    params.push(actor.deptIds)
    scope = `AND dt.department_id = ANY($1::uuid[])`
  }

  const { rows } = await query(
    `SELECT
       rt.id, rt.title, rt.description, rt.payload, rt.interval_days,
       rt.next_run_at, rt.last_run_at, rt.created_at,
       rt.demand_type_id, dt.name   AS demand_type_name,
       dt.department_id,  dept.name AS department_name,
       rt.assignee_id,    u.name    AS assignee_name,
       creator.name                 AS created_by_name
     FROM recurring_templates rt
     JOIN demand_types dt   ON dt.id   = rt.demand_type_id
     JOIN departments  dept ON dept.id = dt.department_id
     LEFT JOIN users u       ON u.id       = rt.assignee_id
     LEFT JOIN users creator ON creator.id = rt.created_by
     WHERE rt.archived_at IS NULL
     ${scope}
     ORDER BY rt.next_run_at ASC`,
    params
  )
  return rows
}

export async function createTemplate(actor, data) {
  const { title, description, demand_type_id, payload = {},
          assignee_id = null, interval_days, next_run_at } = data

  await assertTypeAndPayload(actor, demand_type_id, payload)

  const { rows } = await query(
    `INSERT INTO recurring_templates
       (title, description, demand_type_id, payload, assignee_id,
        interval_days, next_run_at, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     RETURNING id, title, interval_days, next_run_at, created_at`,
    [title, description, demand_type_id, JSON.stringify(payload),
     assignee_id, interval_days, next_run_at, actor.id]
  )
  return rows[0]
}

export async function updateTemplate(actor, id, data) {
  // Carrega o template + escopo
  const { rows: existing } = await query(
    `SELECT rt.id, rt.demand_type_id, rt.payload, dt.department_id
     FROM recurring_templates rt
     JOIN demand_types dt ON dt.id = rt.demand_type_id
     WHERE rt.id = $1 AND rt.archived_at IS NULL`,
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Template não encontrado.'), { status: 404 })
  assertScope(actor, existing[0].department_id)

  // Se payload mudou, revalida contra os campos atuais do tipo
  if (data.payload !== undefined) {
    const allFields = await getFields(existing[0].demand_type_id, { activeOnly: false })
    validatePayload(allFields.filter(f => !f.archived_at), data.payload)
  }

  const sets   = []
  const params = []
  for (const key of ['title', 'description', 'interval_days', 'next_run_at', 'assignee_id']) {
    if (data[key] !== undefined) {
      params.push(data[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (data.payload !== undefined) {
    params.push(JSON.stringify(data.payload))
    sets.push(`payload = $${params.length}::jsonb`)
  }
  if (!sets.length) throw Object.assign(new Error('Nada para atualizar.'), { status: 422 })

  params.push(id)
  const { rows } = await query(
    `UPDATE recurring_templates SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING id, title, interval_days, next_run_at`,
    params
  )
  return rows[0]
}

export async function archiveTemplate(actor, id) {
  const { rows: existing } = await query(
    `SELECT rt.id, dt.department_id
     FROM recurring_templates rt
     JOIN demand_types dt ON dt.id = rt.demand_type_id
     WHERE rt.id = $1 AND rt.archived_at IS NULL`,
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Template não encontrado.'), { status: 404 })
  assertScope(actor, existing[0].department_id)

  await query(
    `UPDATE recurring_templates SET archived_at = NOW() WHERE id = $1`,
    [id]
  )
}

// ── Job de materialização ─────────────────────────────────────────────────────

/**
 * Avança next_run_at em múltiplos de interval_days até passar de NOW().
 * Preserva o "dia âncora": se o job atrasar 3 dias num ciclo semanal,
 * a próxima execução continua caindo no dia da semana original.
 * Cria apenas UMA demanda por ciclo do job mesmo com execuções perdidas
 * (catch-up sem flood).
 */
function advanceNextRun(nextRunAt, intervalDays) {
  const stepMs = intervalDays * 24 * 60 * 60 * 1000
  let next = new Date(nextRunAt).getTime()
  const now = Date.now()
  while (next <= now) next += stepMs
  return new Date(next).toISOString()
}

/**
 * Materializa demandas dos templates vencidos.
 *
 * Ator sintético: o escopo do tipo foi validado na CRIAÇÃO do template
 * (assertTypeAndPayload) e o department de um tipo é imutável. O job roda
 * como super_admin em nome do created_by — a demanda nasce com
 * requester_id = created_by, preservando a autoria real.
 *
 * Falha em um template não interrompe os demais; o ciclo avança mesmo em
 * erro de validação (payload obsoleto) para não travar o job em loop.
 */
export async function runRecurringCheck() {
  const { rows: due } = await query(
    `SELECT id, title, description, demand_type_id, payload,
            assignee_id, interval_days, next_run_at, created_by
     FROM recurring_templates
     WHERE archived_at IS NULL AND next_run_at <= NOW()
     ORDER BY next_run_at ASC`
  )

  let created = 0
  for (const t of due) {
    const syntheticActor = { id: t.created_by, role: 'super_admin', deptIds: [] }

    try {
      const demand = await createDemand(syntheticActor, {
        title:          t.title,
        description:    t.description,
        demand_type_id: t.demand_type_id,
        payload:        t.payload ?? {},
      })

      // Atribuição automática do responsável do template
      if (t.assignee_id) {
        await query(
          `UPDATE demands SET current_assignee_id = $1 WHERE id = $2`,
          [t.assignee_id, demand.id]
        )
        await query(
          `INSERT INTO demand_history
             (demand_id, event_type, actor_id, stage_id, assignee_id, entered_at)
           VALUES ($1, 'assignee_changed', $2, $3, $4, NOW())`,
          [demand.id, t.created_by, demand.current_stage_id, t.assignee_id]
        )
        createNotification(
          t.assignee_id,
          `Demanda recorrente criada para você: "${t.title.slice(0, 80)}"`,
          `/demands/${demand.id}`,
          'assignment'
        ).catch(err => log.error({ err }, 'Falha ao notificar assignee de recorrência'))
      }

      created++
      log.info({ templateId: t.id, demandId: demand.id }, 'Demanda recorrente criada')
    } catch (err) {
      log.error({ err, templateId: t.id }, 'Falha ao materializar template recorrente')
    } finally {
      // Avança o ciclo SEMPRE — um payload obsoleto não pode travar o job
      await query(
        `UPDATE recurring_templates
         SET next_run_at = $1, last_run_at = NOW()
         WHERE id = $2`,
        [advanceNextRun(t.next_run_at, t.interval_days), t.id]
      ).catch(err => log.error({ err, templateId: t.id }, 'Falha ao avançar next_run_at'))
    }
  }

  if (due.length) log.info({ created, due: due.length }, 'Recurring check concluído')
  return { created, due: due.length }
}
