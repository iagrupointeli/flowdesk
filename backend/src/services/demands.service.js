// TZ=UTC garantido via --env-file (ver package.json)
import { Transform }    from 'node:stream'
import { randomUUID }   from 'node:crypto'
import http             from 'node:http'
import https            from 'node:https'
import busboy           from 'busboy'
import { fileTypeStream } from 'file-type'
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const archiver = _require('archiver')

import { query, getClient }                                   from '#config/database.js'
import { dispatchWebhooks }                                   from '#services/webhook.dispatcher.js'
import { getFields }                                          from '#services/demandTypes.service.js'
import { uploadStream, confirmObject, deleteObject,
         presignedDownloadUrl }                               from '#services/storage.service.js'
import { createNotification }                                 from '#services/notifications.service.js'
import { getByStage }                                         from '#services/stageNotifications.service.js'

/**
 * Cria uma notificação de forma fire-and-forget.
 * Nunca lança exceção — erros são logados mas não propagados ao usuário.
 */
function notify(userId, message, link, type = 'system') {
  createNotification(userId, message, link, type).catch(err =>
    console.error('[notify] falha ao criar notificação:', err.message)
  )
}

// ── Constantes ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip',
])

// ── Access helpers ────────────────────────────────────────────────────────────

function assertScope(actor, departmentId) {
  if (actor.role === 'super_admin') return
  if (!actor.deptIds.includes(departmentId)) {
    throw Object.assign(
      new Error('Demanda fora do seu escopo de departamento.'),
      { status: 403 }
    )
  }
}

/**
 * Acesso à demanda: super_admin OU departamento no escopo OU colaborador.
 * O fallback de colaborador só dispara uma query extra quando o escopo de
 * departamento falha — o caminho comum (dono do departamento) continua 1 query.
 * É isto que permite a um colaborador de OUTRO departamento abrir a demanda
 * que recebeu por notificação sem tomar 403.
 */
async function assertDemandAccess(actor, demand) {
  if (actor.role === 'super_admin') return
  if (actor.deptIds.includes(demand.department_id)) return

  const { rows } = await query(
    'SELECT 1 FROM demand_collaborators WHERE demand_id = $1 AND user_id = $2',
    [demand.id, actor.id]
  )
  if (rows[0]) return

  throw Object.assign(
    new Error('Demanda fora do seu escopo de departamento.'),
    { status: 403 }
  )
}

/**
 * Notifica todos os colaboradores de uma demanda (fire-and-forget).
 * Deduplica contra excludeIds (tipicamente: ator, responsável, solicitante —
 * que já recebem notificações por outros caminhos).
 */
async function notifyCollaborators(demandId, message, link, type, excludeIds = []) {
  const { rows } = await query(
    'SELECT user_id FROM demand_collaborators WHERE demand_id = $1',
    [demandId]
  )
  const exclude = new Set(excludeIds.filter(Boolean).map(String))
  for (const { user_id } of rows) {
    if (!exclude.has(String(user_id))) {
      notify(user_id, message, link, type)
    }
  }
}

function assertAdminRole(actor) {
  if (actor.role === 'user') {
    throw Object.assign(
      new Error('Apenas administradores podem realizar esta operação.'),
      { status: 403 }
    )
  }
}

/**
 * Permite mover etapa se o ator for admin OU se for o responsável atual da demanda.
 * Chamado APÓS carregarmos a demanda (que já validou o escopo de departamento).
 */
function assertMoveStagePermission(actor, demand) {
  if (actor.role !== 'user') return   // admins (dept_admin, super_admin) sempre permitidos
  if (!demand.current_assignee_id || String(demand.current_assignee_id) !== String(actor.id)) {
    throw Object.assign(
      new Error('Você só pode mover etapas de demandas atribuídas a você.'),
      { status: 403 }
    )
  }
}

// ── Payload validation ────────────────────────────────────────────────────────

/**
 * Valida o payload do usuário contra o fields_snapshot.
 * Lança erro 422 com `fieldErrors` detalhado se inválido.
 * Exportado para reuso em recurring.service (validação de template).
 * @param {Array} snapshot - Array de campos do demand_type
 * @param {Object} payload - Valores fornecidos pelo usuário (chave = field.id)
 */
export function validatePayload(snapshot, payload) {
  const errors = {}

  for (const field of snapshot) {
    if (field.archived_at) continue // ignora campos arquivados

    const val = payload[field.id]
    const empty = val === undefined || val === null || val === ''

    if (field.required && empty) {
      errors[field.id] = `O campo "${field.label}" é obrigatório.`
      continue
    }
    if (empty) continue // opcional e vazio → ok

    switch (field.field_type) {
      case 'number':
        if (isNaN(Number(val))) errors[field.id] = `"${field.label}" deve ser um número.`
        break
      case 'date':
        if (isNaN(Date.parse(val))) errors[field.id] = `"${field.label}" deve ser uma data válida (ISO 8601).`
        break
      case 'select': {
        const validIds = (field.options ?? []).map(o => o.id)
        if (!validIds.includes(val)) errors[field.id] = `"${field.label}" deve ser uma das opções válidas.`
        break
      }
      case 'cpf': {
        const digits = String(val).replace(/\D/g, '')
        if (digits.length !== 11) errors[field.id] = `"${field.label}" deve conter 11 dígitos de CPF.`
        break
      }
      // 'text' → qualquer string aceita
    }
  }

  if (Object.keys(errors).length > 0) {
    throw Object.assign(new Error('Campos com valores inválidos.'), { status: 422, fieldErrors: errors })
  }
}

// peekMimeType removido — usa-se fileTypeStream diretamente no uploadAttachment.
// fileTypeStream lê os primeiros bytes para detecção e passa TODOS os dados adiante,
// sem consumir o stream nem usar unshift (mais robusto com streams do busboy).

// ── Transform de contagem de bytes (zero-copy overhead) ───────────────────────

function makeCounter() {
  let total = 0
  const t = new Transform({
    transform(chunk, _enc, cb) { total += chunk.length; this.push(chunk); cb() },
  })
  Object.defineProperty(t, 'total', { get: () => total })
  return t
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST DEMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista demandas com filtros e paginação cursor-based (created_at DESC, id DESC).
 *
 * Filtros: demand_type_id, current_stage_id, current_assignee_id,
 *          exception_state ('on_hold'|'cancelled'|'null' para IS NULL),
 *          requester_id
 * Cursor:  after_created_at + after_id (ambos obrigatórios juntos)
 */
export async function listDemands(actor, filters = {}) {
  const {
    demand_type_id,
    current_stage_id,
    // Aceita tanto 'current_assignee_id' (interno) quanto 'assignee_id' (query param da URL)
    current_assignee_id = filters.assignee_id,
    exception_state,
    requester_id,
    q,              // busca por texto: título, id (UUID) ou nome do solicitante
    tag_id,         // filtra demandas que possuem esta tag específica
    after_created_at,
    after_id,
    limit = 50,
  } = filters

  const conditions = []
  const params = []
  const isAdmin = actor.role === 'super_admin'

  if (!isAdmin) {
    params.push(actor.deptIds)
    conditions.push(`dt.department_id = ANY($${params.length}::uuid[])`)
  }
  if (demand_type_id) {
    params.push(demand_type_id)
    conditions.push(`d.demand_type_id = $${params.length}`)
  }
  if (current_stage_id) {
    params.push(current_stage_id)
    conditions.push(`d.current_stage_id = $${params.length}`)
  }
  if (current_assignee_id) {
    params.push(current_assignee_id)
    conditions.push(`d.current_assignee_id = $${params.length}`)
  }
  if (exception_state === 'null') {
    conditions.push('d.exception_state IS NULL')
  } else if (exception_state) {
    params.push(exception_state)
    conditions.push(`d.exception_state = $${params.length}`)
  }
  if (requester_id) {
    params.push(requester_id)
    conditions.push(`d.requester_id = $${params.length}`)
  }
  // Busca por texto (título ILIKE, UUID ILIKE, nome do solicitante ILIKE)
  // O mesmo parâmetro $N é referenciado 3× — válido em PostgreSQL.
  if (q?.trim()) {
    params.push(`%${q.trim()}%`)
    conditions.push(
      `(d.title ILIKE $${params.length}` +
      ` OR d.id::text ILIKE $${params.length}` +
      ` OR u_req.name ILIKE $${params.length})`
    )
  }
  // Filtro por tag — usa EXISTS para evitar duplicatas via JOIN (N:M)
  if (tag_id) {
    params.push(tag_id)
    conditions.push(
      `EXISTS (SELECT 1 FROM demand_tags dt_f WHERE dt_f.demand_id = d.id AND dt_f.tag_id = $${params.length})`
    )
  }
  // cursor: (created_at, id) < ($after_created_at, $after_id)
  if (after_created_at && after_id) {
    params.push(after_created_at, after_id)
    conditions.push(
      `(d.created_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
    )
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const safeLimit = Math.min(Number(limit) || 50, 200)
  params.push(safeLimit + 1) // +1 para detectar hasMore

  const { rows } = await query(
    // CTE tags_agg: agrega tags por demanda em uma única passagem (zero N+1).
    // LEFT JOIN no resultado garante [] para demandas sem tags.
    // stage_id é alias de current_stage_id para compatibilidade com boardStore.
    `WITH tags_agg AS (
       SELECT dt2.demand_id,
         json_agg(
           json_build_object('id', t.id, 'name', t.name, 'color_hex', t.color_hex)
           ORDER BY t.name
         ) AS tags
       FROM demand_tags dt2
       JOIN tags t ON t.id = dt2.tag_id
       GROUP BY dt2.demand_id
     )
     SELECT
       d.id, d.title, d.description, d.exception_state,
       d.due_date,
       d.finalized_at,
       d.created_at, d.updated_at,
       d.demand_type_id,    dt.name   AS demand_type_name,
       dt.department_id,    dept.name AS department_name,
       d.current_stage_id,
       d.current_stage_id   AS stage_id,
       ws.name              AS current_stage_name,
       ws.is_final,
       d.requester_id,      u_req.name  AS requester_name,
       d.current_assignee_id, u_asgn.name AS assignee_name,
       COALESCE(ta.tags, '[]'::json) AS tags
     FROM demands d
     JOIN  demand_types    dt    ON dt.id   = d.demand_type_id
     JOIN  departments     dept  ON dept.id = dt.department_id
     LEFT JOIN workflow_stages ws    ON ws.id   = d.current_stage_id
     LEFT JOIN users       u_req    ON u_req.id  = d.requester_id
     LEFT JOIN users       u_asgn   ON u_asgn.id = d.current_assignee_id
     LEFT JOIN tags_agg    ta       ON ta.demand_id = d.id
     ${where}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT $${params.length}`,
    params
  )

  const hasMore = rows.length > safeLimit
  return {
    items: hasMore ? rows.slice(0, safeLimit) : rows,
    hasMore,
    nextCursor: hasMore
      ? { after_created_at: rows[safeLimit - 1].created_at, after_id: rows[safeLimit - 1].id }
      : null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT DEMANDS (CSV)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna até 5000 demandas para exportação CSV.
 * Aceita os mesmos filtros que listDemands, mas sem cursor e sem paginação.
 */
export async function exportDemands(actor, filters = {}) {
  const {
    demand_type_id,
    current_assignee_id = filters.assignee_id,
    exception_state,
    q,
    tag_id,
  } = filters

  const conditions = []
  const params = []
  const isAdmin = actor.role === 'super_admin'

  if (!isAdmin) {
    params.push(actor.deptIds)
    conditions.push(`dt.department_id = ANY($${params.length}::uuid[])`)
  }
  if (demand_type_id) {
    params.push(demand_type_id)
    conditions.push(`d.demand_type_id = $${params.length}`)
  }
  if (current_assignee_id) {
    params.push(current_assignee_id)
    conditions.push(`d.current_assignee_id = $${params.length}`)
  }
  if (exception_state === 'null') {
    conditions.push('d.exception_state IS NULL')
  } else if (exception_state) {
    params.push(exception_state)
    conditions.push(`d.exception_state = $${params.length}`)
  }
  if (q?.trim()) {
    params.push(`%${q.trim()}%`)
    conditions.push(
      `(d.title ILIKE $${params.length}` +
      ` OR d.id::text ILIKE $${params.length}` +
      ` OR u_req.name ILIKE $${params.length})`
    )
  }
  if (tag_id) {
    params.push(tag_id)
    conditions.push(
      `EXISTS (SELECT 1 FROM demand_tags dt_f WHERE dt_f.demand_id = d.id AND dt_f.tag_id = $${params.length})`
    )
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(5000)

  const { rows } = await query(
    `SELECT
       d.id, d.title, d.exception_state,
       d.due_date, d.finalized_at, d.created_at, d.updated_at,
       dt.name    AS demand_type_name,
       dept.name  AS department_name,
       ws.name    AS current_stage_name,
       ws.is_final,
       u_req.name   AS requester_name,
       u_asgn.name  AS assignee_name
     FROM demands d
     JOIN  demand_types    dt    ON dt.id    = d.demand_type_id
     JOIN  departments     dept  ON dept.id  = dt.department_id
     LEFT JOIN workflow_stages ws    ON ws.id    = d.current_stage_id
     LEFT JOIN users       u_req    ON u_req.id  = d.requester_id
     LEFT JOIN users       u_asgn   ON u_asgn.id = d.current_assignee_id
     ${where}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT $${params.length}`,
    params
  )

  return rows
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET DEMAND
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDemand(actor, id) {
  const { rows } = await query(
    `SELECT
       d.id, d.title, d.description, d.exception_state,
       d.fields_snapshot, d.payload,
       d.due_date,
       d.finalized_at,
       d.created_at, d.updated_at,
       d.demand_type_id,    dt.name   AS demand_type_name,
       dt.department_id,    dept.name AS department_name,
       d.current_stage_id,
       ws.name AS current_stage_name, ws.is_final,
       ws.requires_note,    ws.requires_assignee,
       d.requester_id,      u_req.name  AS requester_name,
       d.current_assignee_id, u_asgn.name AS assignee_name,
       d.asset_id,          a.name      AS asset_name,
       a.code               AS asset_code,
       COALESCE(
         (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color_hex', t.color_hex) ORDER BY t.name)
          FROM demand_tags dt2 JOIN tags t ON t.id = dt2.tag_id WHERE dt2.demand_id = d.id),
         '[]'::json
       ) AS tags
     FROM demands d
     JOIN  demand_types    dt    ON dt.id   = d.demand_type_id
     JOIN  departments     dept  ON dept.id = dt.department_id
     LEFT JOIN workflow_stages ws    ON ws.id   = d.current_stage_id
     LEFT JOIN users       u_req    ON u_req.id  = d.requester_id
     LEFT JOIN users       u_asgn   ON u_asgn.id = d.current_assignee_id
     LEFT JOIN assets      a        ON a.id      = d.asset_id
     WHERE d.id = $1`,
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Demanda não encontrada.'), { status: 404 })
  await assertDemandAccess(actor, rows[0])
  return rows[0]
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE DEMAND
// ═══════════════════════════════════════════════════════════════════════════════

export async function createDemand(actor, data) {
  const { title, description, demand_type_id, payload = {}, asset_id = null } = data

  // 1. Verifica se o tipo existe e pertence ao escopo do ator
  const { rows: dtRows } = await query(
    'SELECT id, department_id, sla_hours FROM demand_types WHERE id = $1',
    [demand_type_id]
  )
  if (!dtRows[0]) throw Object.assign(new Error('Tipo de demanda não encontrado.'), { status: 404 })
  assertScope(actor, dtRows[0].department_id)

  // 1b. Ponto OOH (opcional): precisa existir e estar ativo
  if (asset_id) {
    const { rows: assetRows } = await query(
      'SELECT id FROM assets WHERE id = $1 AND archived_at IS NULL',
      [asset_id]
    )
    if (!assetRows[0]) {
      throw Object.assign(new Error('Ponto não encontrado ou arquivado.'), { status: 404 })
    }
  }

  // 2. Obtém a primeira etapa ativa (menor display_order)
  const { rows: stageRows } = await query(
    `SELECT id FROM workflow_stages
     WHERE demand_type_id = $1 AND archived_at IS NULL
     ORDER BY display_order
     LIMIT 1`,
    [demand_type_id]
  )
  if (!stageRows[0]) {
    throw Object.assign(
      new Error('Este tipo de demanda não possui etapas ativas. Configure etapas antes de criar demandas.'),
      { status: 422 }
    )
  }
  const firstStageId = stageRows[0].id

  // 3. Snapshot imutável: apenas campos ativos no momento da criação
  const allFields = await getFields(demand_type_id, { activeOnly: false })
  const snapshot  = allFields.filter(f => !f.archived_at)

  // 4. Valida payload contra snapshot
  validatePayload(snapshot, payload)

  // 5. Inserção atômica: demand + demand_history('created')
  //    due_date calculado a partir do sla_hours do tipo (imutável após criação).
  //    Usar aritmética de intervalo no SQL garante fuso UTC correto.
  const slaHours = dtRows[0].sla_hours ?? null

  const client = await getClient()
  let demand
  try {
    await client.query('BEGIN')

    const { rows: demandRows } = await client.query(
      `INSERT INTO demands
         (title, description, requester_id, demand_type_id, current_stage_id,
          fields_snapshot, payload, due_date, asset_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
               CASE WHEN $8::int IS NOT NULL
                    THEN NOW() + ($8::int * INTERVAL '1 hour')
                    ELSE NULL END,
               $9)
       RETURNING id, title, description, demand_type_id, current_stage_id,
                 due_date, created_at`,
      [
        title, description, actor.id, demand_type_id, firstStageId,
        JSON.stringify(snapshot),
        JSON.stringify(payload),
        slaHours,
        asset_id,
      ]
    )
    demand = demandRows[0]

    await client.query(
      `INSERT INTO demand_history
         (demand_id, event_type, actor_id, stage_id, assignee_id, exception_state, entered_at)
       VALUES ($1, 'created', $2, $3, NULL, NULL, NOW())`,
      [demand.id, actor.id, firstStageId]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Dispatch webhook: demand.created (fire-and-forget, pós-commit)
  dispatchWebhooks('demand.created', dtRows[0].department_id, {
    id:             demand.id,
    title:          demand.title,
    demand_type_id: demand.demand_type_id,
    department_id:  dtRows[0].department_id,
    requester_id:   actor.id,
    created_at:     demand.created_at,
  })

  return demand
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVE STAGE (Kanban)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Move a demanda para outra etapa.
 * Requer role dept_admin ou super_admin.
 * Valida requires_note e requires_assignee da etapa destino.
 * Atualiza current_assignee se assignee_id for fornecido.
 */
export async function moveStage(actor, demandId, data) {
  const { stage_id, assignee_id, notes } = data

  // Carrega demanda (valida escopo de departamento)
  const demand = await getDemand(actor, demandId)

  // RBAC: admins sempre; role=user somente se for o responsável atual
  assertMoveStagePermission(actor, demand)

  if (demand.exception_state === 'cancelled') {
    throw Object.assign(new Error('Não é possível mover uma demanda cancelada.'), { status: 422 })
  }

  // Valida etapa destino
  const { rows: stageRows } = await query(
    `SELECT id, name, is_final, requires_note, requires_assignee, requires_attachment, archived_at
     FROM workflow_stages
     WHERE id = $1 AND demand_type_id = $2`,
    [stage_id, demand.demand_type_id]
  )
  if (!stageRows[0]) {
    throw Object.assign(new Error('Etapa não encontrada neste tipo de demanda.'), { status: 404 })
  }
  if (stageRows[0].archived_at) {
    throw Object.assign(new Error('A etapa de destino está arquivada.'), { status: 422 })
  }
  const stage = stageRows[0]

  // Guard: bloqueia movimentação para etapa final se há itens de checklist pendentes
  if (stage.is_final) {
    const { rows: pending } = await query(
      `SELECT COUNT(*)::int AS total
       FROM demand_checklists
       WHERE demand_id = $1 AND is_completed = false`,
      [demandId]
    )
    if (pending[0].total > 0) {
      throw Object.assign(
        new Error(
          `Existem ${pending[0].total} item(s) de checklist não concluído(s). ` +
          `Conclua-os antes de finalizar a demanda.`
        ),
        { status: 422 }
      )
    }
  }

  // Verifica requisitos da etapa destino
  if (stage.requires_note && !notes?.trim()) {
    throw Object.assign(new Error('Esta etapa requer uma nota de transição.'), { status: 422 })
  }

  const effectiveAssignee = assignee_id !== undefined ? assignee_id : demand.current_assignee_id
  if (stage.requires_assignee && !effectiveAssignee) {
    throw Object.assign(
      new Error('Esta etapa requer um responsável. Informe assignee_id.'),
      { status: 422 }
    )
  }

  if (stage.requires_attachment) {
    const { rows: attRows } = await query(
      'SELECT 1 FROM attachments WHERE demand_id = $1 LIMIT 1',
      [demandId]
    )
    if (!attRows[0]) {
      throw Object.assign(
        new Error('Esta etapa requer o upload de um documento (NF ou PI) antes de avançar.'),
        { status: 422 }
      )
    }
  }

  // Valida o assignee (deve existir e pertencer ao dept, se fornecido)
  if (assignee_id) {
    const { rows: userRows } = await query(
      `SELECT u.id FROM users u
       JOIN user_departments ud ON ud.user_id = u.id
       WHERE u.id = $1 AND ud.department_id = $2 AND u.deactivated_at IS NULL`,
      [assignee_id, demand.department_id]
    )
    if (!userRows[0]) {
      throw Object.assign(
        new Error('Responsável não encontrado ou inativo neste departamento.'),
        { status: 422 }
      )
    }
  }

  const client = await getClient()
  let histRow
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE demands
       SET current_stage_id     = $1,
           current_assignee_id  = $2,
           updated_at           = NOW(),
           finalized_at         = CASE WHEN $4 THEN NOW() ELSE NULL END
       WHERE id = $3`,
      [stage_id, effectiveAssignee ?? null, demandId, stage.is_final]
    )

    // RETURNING id + entered_at para construir o evento de timeline sem refetch
    const { rows: histRows } = await client.query(
      `INSERT INTO demand_history
         (demand_id, event_type, actor_id, stage_id, assignee_id, exception_state, notes, entered_at)
       VALUES ($1, 'stage_changed', $2, $3, $4, $5, $6, NOW())
       RETURNING id, entered_at`,
      [demandId, actor.id, stage_id, effectiveAssignee ?? null, demand.exception_state, notes ?? null]
    )
    histRow = histRows[0]

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const updatedDemand = await getDemand(actor, demandId)

  // ── Notificações (fire-and-forget, estritamente pós-commit) ─────────────────
  // GARANTIA: notify() é chamado APÓS client.release() + getDemand() acima.
  // Se o COMMIT falhou, o catch re-lança o erro antes de chegar aqui.
  // Se getDemand() falhou (improvável, mas possível), também re-lança antes de notificar.
  // Portanto: chegar neste ponto = transação confirmada com sucesso.
  const link = `/demands/${demandId}`
  if (assignee_id && String(assignee_id) !== String(actor.id)) {
    // Nova atribuição: notifica o novo responsável
    notify(assignee_id, `Você foi designado à demanda: "${demand.title}"`, link, 'assignment')
  } else if (effectiveAssignee && String(effectiveAssignee) !== String(actor.id)) {
    // Mudança de etapa sem troca de responsável: notifica o responsável atual
    notify(effectiveAssignee, `A demanda "${demand.title}" foi movida para "${stage.name}"`, link, 'stage_change')
  }

  // Colaboradores acompanham mudanças de etapa (exclui ator e responsável já notificado)
  notifyCollaborators(
    demandId,
    `A demanda "${demand.title}" foi movida para "${stage.name}"`,
    link, 'stage_change',
    [actor.id, effectiveAssignee],
  ).catch(err => console.error('[notifyCollaborators] stage:', err.message))

  // Dispatch webhook: demand.stage_changed (fire-and-forget, pós-commit)
  dispatchWebhooks('demand.stage_changed', updatedDemand.department_id, {
    id:            demandId,
    title:         demand.title,
    department_id: updatedDemand.department_id,
    from_stage_id: demand.current_stage_id,
    to_stage_id:   stage_id,
    to_stage_name: stage.name,
    actor_id:      actor.id,
    changed_at:    histRow.entered_at,
  })

  // Automação de notificação por etapa (fire-and-forget)
  getByStage(stage_id).then(rule => {
    if (!rule) return
    const message = rule.message_template.replace('{title}', demand.title)
    const link    = `/demands/${demandId}`
    if (rule.notify_requester && demand.requester_id) {
      notify(demand.requester_id, message, link, 'system')
    }
    if (rule.notify_assignee && effectiveAssignee && effectiveAssignee !== demand.requester_id) {
      notify(effectiveAssignee, message, link, 'system')
    }
  }).catch(err => console.error('[stage-automation]', err.message))

  // Evento no shape da timeline — actor_name é null; o frontend o enriquece
  // com o nome do usuário logado (disponível no authStore).
  const event = {
    entered_at:      histRow.entered_at,
    source:          'history',
    row_id:          String(histRow.id),
    sort_key:        String(histRow.id).padStart(20, '0'),
    event_type:      'stage_changed',
    actor_id:        actor.id,
    actor_name:      null,
    stage_id,
    stage_name:      stage.name,
    assignee_id:     effectiveAssignee ?? null,
    exception_state: demand.exception_state,
    notes:           notes ?? null,
    body:            null,
    file_name:       null,
    file_size:       null,
    attachment_id:   null,
  }

  return { demand: updatedDemand, event }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH MOVE STAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Move várias demandas para a mesma etapa em sequência.
 * Demandas que falham (escopo, regras) são relatadas em `failed` sem abortar o lote.
 * @returns {{ succeeded: string[], failed: Array<{id:string, error:string}> }}
 */
export async function batchMoveStage(actor, demandIds, data) {
  const succeeded = []
  const failed    = []

  for (const id of demandIds) {
    try {
      await moveStage(actor, id, data)
      succeeded.push(id)
    } catch (err) {
      failed.push({ id, error: err.message })
    }
  }

  return { succeeded, failed }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SET EXCEPTION STATE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Altera o exception_state da demanda (on_hold | cancelled | null para retomar).
 * Requer role dept_admin ou super_admin.
 * Não pode alterar demandas já canceladas.
 */
export async function setException(actor, demandId, data) {
  const { exception_state, notes } = data

  assertAdminRole(actor)

  const demand = await getDemand(actor, demandId)

  if (demand.exception_state === 'cancelled') {
    throw Object.assign(new Error('Demandas canceladas não podem ter seu estado alterado.'), { status: 422 })
  }
  if (demand.exception_state === exception_state) {
    throw Object.assign(new Error('A demanda já está neste estado.'), { status: 422 })
  }

  const client = await getClient()
  let histRow
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE demands SET exception_state = $1, updated_at = NOW() WHERE id = $2`,
      [exception_state ?? null, demandId]
    )

    const { rows: histRows } = await client.query(
      `INSERT INTO demand_history
         (demand_id, event_type, actor_id, stage_id, assignee_id, exception_state, notes, entered_at)
       VALUES ($1, 'exception_changed', $2, $3, $4, $5, $6, NOW())
       RETURNING id, entered_at`,
      [
        demandId, actor.id,
        demand.current_stage_id, demand.current_assignee_id,
        exception_state ?? null,
        notes ?? null,
      ]
    )
    histRow = histRows[0]

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const updatedDemand = await getDemand(actor, demandId)

  // Dispatch webhook: demand.blocked (fire-and-forget; somente ao bloquear)
  if (exception_state === 'on_hold') {
    dispatchWebhooks('demand.blocked', updatedDemand.department_id, {
      id:              demandId,
      title:           demand.title,
      department_id:   updatedDemand.department_id,
      exception_state: 'on_hold',
      actor_id:        actor.id,
      blocked_at:      histRow.entered_at,
    })
  }

  // Colaboradores acompanham bloqueio/desbloqueio/cancelamento
  const stateLabel = exception_state === 'on_hold'   ? 'colocada em espera'
                   : exception_state === 'cancelled' ? 'cancelada'
                   : 'retomada'
  notifyCollaborators(
    demandId,
    `A demanda "${demand.title}" foi ${stateLabel}`,
    `/demands/${demandId}`, 'system',
    [actor.id, demand.current_assignee_id],
  ).catch(err => console.error('[notifyCollaborators] exception:', err.message))

  const event = {
    entered_at:      histRow.entered_at,
    source:          'history',
    row_id:          String(histRow.id),
    sort_key:        String(histRow.id).padStart(20, '0'),
    event_type:      'exception_changed',
    actor_id:        actor.id,
    actor_name:      null,
    stage_id:        demand.current_stage_id,
    stage_name:      null,   // não disponível sem query extra; frontend usa cache/store
    assignee_id:     demand.current_assignee_id,
    exception_state: exception_state ?? null,
    notes:           notes ?? null,
    body:            null,
    file_name:       null,
    file_size:       null,
    attachment_id:   null,
  }

  return { demand: updatedDemand, event }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD COMMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function addComment(actor, demandId, data) {
  const { body } = data

  const demand = await getDemand(actor, demandId)

  if (demand.exception_state === 'cancelled') {
    throw Object.assign(new Error('Não é possível comentar em demandas canceladas.'), { status: 422 })
  }

  const { rows } = await query(
    `INSERT INTO demand_feed
       (demand_id, event_type, actor_id, stage_id, assignee_id, body, entered_at)
     VALUES ($1, 'comment_added', $2, $3, $4, $5, NOW())
     RETURNING id, demand_id, event_type, body, stage_id, assignee_id, entered_at`,
    [demandId, actor.id, demand.current_stage_id, demand.current_assignee_id ?? null, body]
  )

  // Notifica usuários mencionados com @[Nome Completo]
  const mentionRegex = /@\[([^\]]+)\]/g
  const mentionedNames = [...body.matchAll(mentionRegex)].map(m => m[1].toLowerCase())
  if (mentionedNames.length > 0) {
    const { rows: mentioned } = await query(
      `SELECT id FROM users
       WHERE LOWER(name) = ANY($1::text[])
         AND is_active = true
         AND id != $2`,
      [mentionedNames, actor.id]
    )
    for (const { id } of mentioned) {
      notify(id, `Você foi mencionado em um comentário: "${demand.title}"`, `/demands/${demandId}`, 'mention')
    }
  }

  // Notifica o responsável atual se não for o próprio comentarista
  if (demand.current_assignee_id && String(demand.current_assignee_id) !== String(actor.id)) {
    notify(
      demand.current_assignee_id,
      `Novo comentário na demanda: "${demand.title}"`,
      `/demands/${demandId}`,
      'comment'
    )
  }
  // Notifica o criador da demanda se não for o comentarista nem o responsável
  if (
    demand.requester_id &&
    String(demand.requester_id) !== String(actor.id) &&
    String(demand.requester_id) !== String(demand.current_assignee_id)
  ) {
    notify(
      demand.requester_id,
      `Novo comentário na sua demanda: "${demand.title}"`,
      `/demands/${demandId}`,
      'comment'
    )
  }

  // Colaboradores acompanham novos comentários (exclui ator, responsável e solicitante)
  notifyCollaborators(
    demandId,
    `Novo comentário na demanda: "${demand.title}"`,
    `/demands/${demandId}`, 'comment',
    [actor.id, demand.current_assignee_id, demand.requester_id],
  ).catch(err => console.error('[notifyCollaborators] comment:', err.message))

  return rows[0]
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD ATTACHMENT (busboy streaming)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Processa upload de arquivo via busboy.
 * Fluxo: busboy → peekMimeType (magic bytes) → counter Transform → MinIO
 * Confirma objeto no MinIO somente APÓS commit no banco.
 *
 * @param {import('express').Request} req
 */
export async function uploadAttachment(actor, demandId, req) {
  const demand = await getDemand(actor, demandId)

  if (demand.exception_state === 'cancelled') {
    throw Object.assign(new Error('Não é possível anexar arquivos a demandas canceladas.'), { status: 422 })
  }

  // kind via query param: 'generic' (padrão), 'checking' (evidência) ou 'creative' (arte)
  const VALID_KINDS = new Set(['generic', 'checking', 'creative'])
  const kind = VALID_KINDS.has(req.query?.kind) ? req.query.kind : 'generic'

  // Pré-calcula próxima versão para peças criativas (antes do stream busboy)
  let nextVersion = 1
  if (kind === 'creative') {
    const { rows: vRows } = await query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM attachments WHERE demand_id = $1 AND kind = 'creative'`,
      [demandId]
    )
    nextVersion = vRows[0].next_version
  }

  return new Promise((resolve, reject) => {
    let fileProcessed = false
    /** @type {Promise<{objectName:string,filename:string,mime:string,size:number}>|null} */
    let filePromise = null

    const bb = busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_FILE_SIZE },
    })

    bb.on('file', (fieldname, fileStream, info) => {
      fileProcessed = true
      const objectName = randomUUID()
      let truncated    = false

      fileStream.on('limit', () => { truncated = true })

      filePromise = (async () => {
        // fileTypeStream lê magic bytes do início do stream e passa TODOS os dados adiante.
        // É seguro com streams busboy pois não usa peek/unshift — internamente bufferiza
        // e re-emite os bytes lidos junto com o restante.
        const typedStream = await fileTypeStream(fileStream)
        const detectedMime = typedStream.fileType?.mime ?? 'application/octet-stream'

        if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
          typedStream.resume() // drena para liberar busboy
          throw Object.assign(
            new Error(`Tipo de arquivo não permitido: ${detectedMime}`),
            { status: 415 }
          )
        }

        // Transform que conta bytes (pass-through, sem buffer adicional)
        const counter = makeCounter()
        typedStream.pipe(counter)

        // Upload: stream direto para MinIO sem disco/RAM intermediária
        await uploadStream(objectName, counter, detectedMime)

        if (truncated) {
          // Remove objeto parcial do MinIO (lifecycle faria isso em 24h, mas limpamos agora)
          await deleteObject(objectName).catch(() => {})
          throw Object.assign(
            new Error(`Arquivo excede o limite de ${MAX_FILE_SIZE / 1024 / 1024} MB.`),
            { status: 413 }
          )
        }

        return {
          objectName,
          filename: info.filename || 'arquivo',
          mime: detectedMime,
          size: counter.total,
        }
      })()
    })

    bb.on('filesLimit', () =>
      reject(Object.assign(new Error('Apenas 1 arquivo por requisição.'), { status: 400 }))
    )

    bb.on('finish', async () => {
      if (!fileProcessed || !filePromise) {
        return reject(Object.assign(new Error('Nenhum arquivo enviado.'), { status: 400 }))
      }

      try {
        const { objectName, filename, mime: _mime, size } = await filePromise

        // Insere no banco APÓS upload concluído com sucesso
        const { rows } = await query(
          `INSERT INTO attachments
             (demand_id, uploaded_by, stage_id, assignee_id, file_path, file_name, file_size, kind, version, entered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           RETURNING id, file_name, file_size, kind, version, entered_at`,
          [
            demandId, actor.id,
            demand.current_stage_id, demand.current_assignee_id ?? null,
            objectName, filename, size, kind, nextVersion,
          ]
        )

        // Confirma objeto no MinIO apenas após o COMMIT implícito da query acima
        // (sem transação explícita aqui — se o confirmObject falhar, lifecycle policy
        //  remove o objeto em 24h, o que é aceitável)
        await confirmObject(objectName)

        // Notifica ao registrar evidência fotográfica (checking)
        if (kind === 'checking') {
          const link = `/demands/${demandId}`
          const msg  = `📸 Checking registrado em "${demand.title}" — veiculação confirmada.`

          if (demand.requester_id && String(demand.requester_id) !== String(actor.id)) {
            notify(demand.requester_id, msg, link, 'system')
          }
          if (demand.current_assignee_id && String(demand.current_assignee_id) !== String(actor.id)) {
            notify(demand.current_assignee_id, msg, link, 'system')
          }
          // Colaboradores (fire-and-forget, deduplica ator + requester + assignee)
          notifyCollaborators(demandId, msg, link, 'system', [
            actor.id, demand.requester_id, demand.current_assignee_id,
          ]).catch(err => console.error('[checking-notify] colaboradores:', err.message))
        }

        resolve(rows[0])
      } catch (err) {
        reject(err)
      }
    })

    bb.on('error', reject)
    req.pipe(bb)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKING ZIP EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transmite um ZIP com todos os anexos kind='checking' da demanda.
 * @param {object} actor
 * @param {string} demandId
 * @param {import('express').Response} res - response do Express para pipe direto
 */
export async function exportCheckingZip(actor, demandId, res) {
  const demand = await getDemand(actor, demandId)

  const { rows: attachments } = await query(
    `SELECT file_path, file_name FROM attachments
     WHERE demand_id = $1 AND kind = 'checking'
     ORDER BY entered_at ASC`,
    [demandId]
  )

  if (attachments.length === 0) {
    throw Object.assign(new Error('Esta demanda não possui evidências de checking.'), { status: 404 })
  }

  const safeName = demand.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="pop_${safeName}.zip"`)

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('error', err => {
    if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar ZIP.' })
    else res.destroy(err)
  })
  archive.pipe(res)

  for (const att of attachments) {
    const url    = await presignedDownloadUrl(att.file_path)
    const client = url.startsWith('https') ? https : http

    await new Promise((resolve, reject) => {
      client.get(url, stream => {
        archive.append(stream, { name: att.file_name })
        stream.on('end', resolve)
        stream.on('error', reject)
      }).on('error', reject)
    })
  }

  await archive.finalize()
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE (UNION ALL com cursor composto)
// ═══════════════════════════════════════════════════════════════════════════════

const TIMELINE_PAGE = 30

/**
 * Retorna eventos da demanda em ordem DESC (mais recente primeiro).
 * Paginação keyset — cursor aponta para o MAIS ANTIGO da página atual.
 * "Carregar mais" busca itens ainda mais antigos (entered_at < cursor_ts).
 *
 * Ordenação global: (entered_at DESC, source DESC, sort_key DESC)
 *   source DESC: 'history' > 'feed' > 'attachment'
 *
 * Cursor lógica DESC — row R vem após cursor (T, S, X) ⟺
 *   R.entered_at < T
 *   OR R.entered_at = T AND R.source < S   (source alfa menor → posterior em DESC)
 *   OR R.entered_at = T AND R.source = S AND R.sort_key < X
 *
 * Índices utilizados:
 *   idx_history_cursor    ON demand_history (demand_id, entered_at, id)
 *   idx_feed_cursor       ON demand_feed    (demand_id, entered_at, id)
 *   idx_attachments_cursor ON attachments   (demand_id, entered_at, id)
 */
export async function getTimeline(actor, demandId, cursor) {
  await getDemand(actor, demandId) // valida escopo

  // ── Parse do cursor ──────────────────────────────────────────────────────────
  let hasCursor    = false
  let cursorTs     = null
  let cursorSource = null
  let cursorIdInt  = null   // BIGINT: usado para source='history' e source='feed'
  let cursorIdUuid = null   // UUID:   usado para source='attachment'

  if (cursor) {
    const parts = cursor.split('|')
    if (parts.length !== 3) throw Object.assign(new Error('Cursor inválido.'), { status: 400 })
    const [ts, src, rawId] = parts

    if (!['history', 'feed', 'attachment'].includes(src)) {
      throw Object.assign(new Error('Cursor inválido: source desconhecido.'), { status: 400 })
    }

    hasCursor    = true
    cursorTs     = ts
    cursorSource = src

    if (src === 'history' || src === 'feed') {
      cursorIdInt = parseInt(rawId, 10)
      if (isNaN(cursorIdInt)) throw Object.assign(new Error('Cursor inválido: id não numérico.'), { status: 400 })
    } else {
      // source = 'attachment' → UUID
      cursorIdUuid = rawId
    }
  }

  // $1=demand_id $2=has_cursor $3=cursor_ts $4=cursor_source
  // $5=cursor_id_int(bigint|null) $6=cursor_id_uuid(uuid|null) $7=limit
  const params = [demandId, hasCursor, cursorTs, cursorSource, cursorIdInt, cursorIdUuid, TIMELINE_PAGE + 1]

  const { rows } = await query(
    // NOT $2 = fast-path primeira página (sem cursor).
    // Em DESC, "vir depois do cursor" = ser mais antigo:
    //   entered_at < T
    //   OR entered_at = T AND source < cursor_source  (alfa menor → posterior em DESC)
    //   OR entered_at = T AND source = cursor_source AND sort_key < X
    `SELECT * FROM (

       -- ── demand_history ('history' = maior em alfa, PRIMEIRO em DESC) ────────
       -- Case 2 nunca se aplica ('history' é o mais alto → nada vem antes dele)
       -- Case 3: cursor='history' → inclui somente id < cursor_id (mais antigos)
       SELECT
         entered_at,
         'history'                   AS source,
         id::text                    AS row_id,
         LPAD(id::text, 20, '0')     AS sort_key,
         event_type, actor_id, stage_id, assignee_id, exception_state, notes,
         NULL::text                  AS body,
         NULL::text                  AS file_name,
         NULL::int                   AS file_size,
         NULL::uuid                  AS attachment_id
       FROM demand_history
       WHERE demand_id = $1
         AND (
           NOT $2
           OR entered_at < $3::timestamptz
           OR (entered_at = $3::timestamptz AND $4 = 'history' AND id < $5::bigint)
         )

       UNION ALL

       -- ── demand_feed ('feed' = médio em DESC) ─────────────────────────────────
       -- Case 2: cursor='history' → 'feed' < 'history' → inclui TODOS os feed neste ts
       -- Case 3: cursor='feed' → inclui somente id < cursor_id
       SELECT
         entered_at,
         'feed'                      AS source,
         id::text                    AS row_id,
         LPAD(id::text, 20, '0')     AS sort_key,
         event_type, actor_id, stage_id, assignee_id,
         NULL::varchar               AS exception_state,
         NULL::text                  AS notes,
         body,
         NULL::text                  AS file_name,
         NULL::int                   AS file_size,
         NULL::uuid                  AS attachment_id
       FROM demand_feed
       WHERE demand_id = $1
         AND (
           NOT $2
           OR entered_at < $3::timestamptz
           OR (entered_at = $3::timestamptz AND $4 = 'history')
           OR (entered_at = $3::timestamptz AND $4 = 'feed' AND id < $5::bigint)
         )

       UNION ALL

       -- ── attachments ('attachment' = menor em alfa, ÚLTIMO em DESC) ────────────
       -- Case 2: cursor='history' ou cursor='feed' → 'attachment' < ambos → inclui TODOS
       -- Case 3: cursor='attachment' → inclui somente id < cursor_id_uuid
       SELECT
         entered_at,
         'attachment'                AS source,
         id::text                    AS row_id,
         id::text                    AS sort_key,
         'attachment_added'          AS event_type,
         uploaded_by                 AS actor_id,
         stage_id, assignee_id,
         NULL::varchar               AS exception_state,
         NULL::text                  AS notes,
         NULL::text                  AS body,
         file_name, file_size,
         id                          AS attachment_id
       FROM attachments
       WHERE demand_id = $1
         AND (
           NOT $2
           OR entered_at < $3::timestamptz
           OR (entered_at = $3::timestamptz AND $4 IN ('history', 'feed'))
           OR (entered_at = $3::timestamptz AND $4 = 'attachment' AND id < $6::uuid)
         )

     ) t
     ORDER BY t.entered_at DESC, t.source DESC, t.sort_key DESC
     LIMIT $7`,
    params
  )

  const hasMore = rows.length > TIMELINE_PAGE
  const items   = hasMore ? rows.slice(0, TIMELINE_PAGE) : rows

  // Enriquece com nomes de ator e etapa em batch (2 queries extras máximo)
  const actorIds = [...new Set(items.map(r => r.actor_id).filter(Boolean))]
  const stageIds = [...new Set(items.map(r => r.stage_id).filter(Boolean))]

  const [actorMap, stageMap] = await Promise.all([
    actorIds.length
      ? query('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [actorIds])
          .then(r => Object.fromEntries(r.rows.map(a => [a.id, a.name])))
      : {},
    stageIds.length
      ? query('SELECT id, name FROM workflow_stages WHERE id = ANY($1::uuid[])', [stageIds])
          .then(r => Object.fromEntries(r.rows.map(s => [s.id, s.name])))
      : {},
  ])

  const enriched = items.map(r => ({
    ...r,
    actor_name: actorMap[r.actor_id] ?? null,
    stage_name: stageMap[r.stage_id] ?? null,
  }))

  // Cursor usa row_id (id nativo como texto), NÃO o sort_key (LPAD)
  const last       = enriched[enriched.length - 1]
  const nextCursor = hasMore
    ? `${last.entered_at}|${last.source}|${last.row_id}`
    : null

  return { items: enriched, hasMore, nextCursor }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLA
// ═══════════════════════════════════════════════════════════════════════════════

export async function getSla(actor, demandId) {
  await getDemand(actor, demandId) // valida escopo

  const { rows } = await query(
    `SELECT
       SUM(active_duration)   AS total_active,
       SUM(paused_duration)   AS total_paused,
       SUM(interval_duration) AS total_elapsed
     FROM demand_sla
     WHERE demand_id = $1
     GROUP BY demand_id`,
    [demandId]
  )

  if (!rows[0]) {
    return { total_active: null, total_paused: null, total_elapsed: null }
  }
  return rows[0]
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTACHMENT DOWNLOAD (presigned URL)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getDownloadUrl(actor, attachmentId) {
  const { rows } = await query(
    `SELECT a.id, a.file_path, a.file_name, a.file_size,
            dt.department_id
     FROM attachments a
     JOIN demands      d  ON d.id  = a.demand_id
     JOIN demand_types dt ON dt.id = d.demand_type_id
     WHERE a.id = $1`,
    [attachmentId]
  )
  if (!rows[0]) throw Object.assign(new Error('Anexo não encontrado.'), { status: 404 })

  assertScope(actor, rows[0].department_id)

  const url = await presignedDownloadUrl(rows[0].file_path)
  return { url, file_name: rows[0].file_name, file_size: rows[0].file_size }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIST ATTACHMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function listAttachments(actor, demandId, { kind } = {}) {
  await getDemand(actor, demandId)  // valida acesso (throws 403/404 se fora do escopo)

  const params = [demandId]
  let kindFilter = ''
  if (kind) { params.push(kind); kindFilter = `AND a.kind = $${params.length}` }

  const { rows } = await query(
    `SELECT a.id, a.file_name, a.file_size, a.kind, a.version, a.entered_at,
            u.name AS uploaded_by_name
     FROM attachments a
     JOIN users u ON u.id = a.uploaded_by
     WHERE a.demand_id = $1 ${kindFilter}
     ORDER BY a.entered_at DESC`,
    params
  )
  return rows
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENTIONABLE USERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMentionableUsers(actor, demandId) {
  const demand = await getDemand(actor, demandId)  // valida acesso + retorna department_id

  const { rows } = await query(
    `SELECT DISTINCT u.id, u.name
     FROM users u
     JOIN user_departments ud ON ud.user_id = u.id
     WHERE ud.department_id = $1
       AND u.deactivated_at IS NULL
     ORDER BY u.name`,
    [demand.department_id]
  )
  return rows
}

// ═══════════════════════════════════════════════════════════════════════════════
// COLABORADORES (Opção B — seguidores cross-department)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Lista os colaboradores atuais de uma demanda (com nome + departamento primário
 * para contexto cross-department). Valida acesso à demanda.
 */
export async function listCollaborators(actor, demandId) {
  await getDemand(actor, demandId) // valida acesso

  const { rows } = await query(
    `SELECT u.id, u.name, u.email, dep.name AS department_name
     FROM demand_collaborators dc
     JOIN users u ON u.id = dc.user_id
     LEFT JOIN user_departments ud ON ud.user_id = u.id AND ud.is_primary = true
     LEFT JOIN departments dep ON dep.id = ud.department_id
     WHERE dc.demand_id = $1
     ORDER BY u.name`,
    [demandId]
  )
  return rows
}

/**
 * Busca candidatos a colaborador — usuários ativos de QUALQUER departamento
 * (o ponto central da Opção B é colaboração cross-department). Escopo é dado
 * pelo acesso à demanda: quem pode abrir a demanda pode buscar candidatos.
 * Exclui quem já é colaborador. Requer q com ao menos 2 caracteres.
 */
export async function searchCollaboratorCandidates(actor, demandId, q) {
  await getDemand(actor, demandId) // valida acesso

  const term = (q ?? '').trim()
  if (term.length < 2) return []

  const { rows } = await query(
    `SELECT DISTINCT u.id, u.name, u.email, dep.name AS department_name
     FROM users u
     LEFT JOIN user_departments ud  ON ud.user_id = u.id AND ud.is_primary = true
     LEFT JOIN departments      dep ON dep.id = ud.department_id
     WHERE u.deactivated_at IS NULL
       AND (u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
       AND NOT EXISTS (
         SELECT 1 FROM demand_collaborators dc
         WHERE dc.demand_id = $2 AND dc.user_id = u.id
       )
     ORDER BY u.name
     LIMIT 10`,
    [term, demandId]
  )
  return rows
}

/**
 * Adiciona um colaborador à demanda. Idempotente (ON CONFLICT DO NOTHING).
 * O usuário adicionado pode ser de qualquer departamento. Notifica o adicionado.
 * Retorna o colaborador com nome/departamento para a UI montar o chip sem refetch.
 */
export async function addCollaborator(actor, demandId, userId) {
  const demand = await getDemand(actor, demandId) // valida acesso

  if (demand.exception_state === 'cancelled') {
    throw Object.assign(new Error('Não é possível adicionar colaboradores a demandas canceladas.'), { status: 422 })
  }

  // Usuário-alvo deve existir e estar ativo
  const { rows: userRows } = await query(
    `SELECT u.id, u.name, u.email, dep.name AS department_name
     FROM users u
     LEFT JOIN user_departments ud  ON ud.user_id = u.id AND ud.is_primary = true
     LEFT JOIN departments      dep ON dep.id = ud.department_id
     WHERE u.id = $1 AND u.deactivated_at IS NULL`,
    [userId]
  )
  if (!userRows[0]) {
    throw Object.assign(new Error('Usuário não encontrado ou inativo.'), { status: 404 })
  }

  const { rowCount } = await query(
    `INSERT INTO demand_collaborators (demand_id, user_id, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (demand_id, user_id) DO NOTHING`,
    [demandId, userId, actor.id]
  )

  // Notifica o novo colaborador (somente se houve inserção e não é o próprio ator)
  if (rowCount > 0 && String(userId) !== String(actor.id)) {
    notify(
      userId,
      `Você foi adicionado como colaborador da demanda: "${demand.title}"`,
      `/demands/${demandId}`,
      'assignment',
    )
  }

  return userRows[0]
}

/**
 * Remove um colaborador da demanda. Idempotente.
 */
export async function removeCollaborator(actor, demandId, userId) {
  await getDemand(actor, demandId) // valida acesso

  await query(
    'DELETE FROM demand_collaborators WHERE demand_id = $1 AND user_id = $2',
    [demandId, userId]
  )
}
