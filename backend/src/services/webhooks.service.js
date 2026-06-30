/**
 * webhooks.service.js — CRUD e teste de webhooks de saída.
 *
 * ── Regras de negócio ────────────────────────────────────────────────────────
 *   • Escopo: dept_admin gerencia apenas seus departamentos.
 *     super_admin gerencia todos, incluindo webhooks globais (department_id IS NULL).
 *   • secret_key: gerado (randomBytes 32) SOMENTE na criação; não exposto
 *     em listWebhooks — o cliente deve guardar no momento da criação.
 *   • testWebhook: disparo síncrono (aguarda resposta) com timeout 5 s.
 *     Retorna { success, status, message } — não é fire-and-forget.
 *   • SSRF: URL validada antes de qualquer requisição de saída.
 */

import crypto, { randomBytes } from 'node:crypto'
import { query }                              from '#config/database.js'
import { assertSafeUrl, resolveToSafeIp, makeSecureRequest } from '#utils/ssrf-guard.js'

const VALID_EVENTS = Object.freeze([
  'demand.created',
  'demand.stage_changed',
  'demand.blocked',
])
const TIMEOUT_MS = 5_000

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verifica escopo de acesso.
 * Webhooks globais (departmentId = null) são exclusivos de super_admin.
 */
function assertScope(actor, departmentId) {
  if (actor.role === 'super_admin') return
  if (!departmentId) {
    throw Object.assign(
      new Error('Apenas super_admin pode gerenciar webhooks globais.'),
      { status: 403 }
    )
  }
  if (!actor.deptIds.includes(departmentId)) {
    throw Object.assign(
      new Error('Webhook fora do seu escopo de departamento.'),
      { status: 403 }
    )
  }
}

function validateEvents(events) {
  const invalid = events.filter(e => !VALID_EVENTS.includes(e))
  if (invalid.length > 0) {
    throw Object.assign(
      new Error(`Eventos inválidos: ${invalid.join(', ')}`),
      { status: 422 }
    )
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Lista webhooks no escopo do ator.
 * dept_admin vê seus departamentos + webhooks globais.
 * secret_key NÃO é incluído — evita exposição acidental em listagens.
 */
export async function listWebhooks(actor) {
  const params = []
  let where = ''

  if (actor.role !== 'super_admin') {
    params.push(actor.deptIds)
    where = `WHERE (w.department_id = ANY($1::uuid[]) OR w.department_id IS NULL)`
  }

  const { rows } = await query(
    `SELECT w.id, w.department_id, dept.name AS department_name,
            w.url, w.events, w.is_active, w.created_at, w.updated_at
     FROM webhooks w
     LEFT JOIN departments dept ON dept.id = w.department_id
     ${where}
     ORDER BY dept.name NULLS LAST, w.created_at DESC`,
    params
  )
  return rows
}

/**
 * Cria um webhook.
 * Retorna secret_key UMA VEZ — não pode ser recuperado posteriormente.
 */
export async function createWebhook(actor, data) {
  const { department_id = null, url, events = [] } = data
  assertScope(actor, department_id)
  validateEvents(events)
  await assertSafeUrl(url)

  const secretKey = randomBytes(32).toString('hex')

  const { rows } = await query(
    `INSERT INTO webhooks (department_id, url, secret_key, events)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, department_id, url, secret_key, events, is_active, created_at`,
    [department_id, url, secretKey, JSON.stringify(events)]
  )
  return rows[0]
}

export async function updateWebhook(actor, id, data) {
  const { rows: existing } = await query(
    'SELECT id, department_id FROM webhooks WHERE id = $1',
    [id]
  )
  if (!existing[0]) throw Object.assign(new Error('Webhook não encontrado.'), { status: 404 })
  assertScope(actor, existing[0].department_id)

  if (data.events !== undefined) validateEvents(data.events)
  if (data.url !== undefined) await assertSafeUrl(data.url)

  const { rows } = await query(
    `UPDATE webhooks
     SET url        = COALESCE($2,        url),
         events     = COALESCE($3::jsonb, events),
         is_active  = COALESCE($4,        is_active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, department_id, url, events, is_active, created_at, updated_at`,
    [
      id,
      data.url       ?? null,
      data.events    != null ? JSON.stringify(data.events) : null,
      data.is_active ?? null,
    ]
  )
  return rows[0]
}

export async function deleteWebhook(actor, id) {
  const { rows } = await query(
    'SELECT department_id FROM webhooks WHERE id = $1',
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Webhook não encontrado.'), { status: 404 })
  assertScope(actor, rows[0].department_id)

  await query('DELETE FROM webhooks WHERE id = $1', [id])
  return { message: 'Webhook removido.' }
}

/**
 * Disparo de teste SÍNCRONO (aguarda resposta).
 * Diferente do dispatcher fire-and-forget — retorna resultado imediatamente.
 */
export async function testWebhook(actor, id) {
  const { rows } = await query(
    'SELECT id, department_id, url, secret_key FROM webhooks WHERE id = $1',
    [id]
  )
  if (!rows[0]) throw Object.assign(new Error('Webhook não encontrado.'), { status: 404 })
  assertScope(actor, rows[0].department_id)

  const wh = rows[0]

  // Resolve DNS e valida em um passo; IP fixo previne rebinding no envio real
  let conn
  try {
    conn = await resolveToSafeIp(wh.url)
  } catch (err) {
    return { success: false, status: null, message: err.message }
  }

  const body = JSON.stringify({
    event:   'test',
    sent_at: new Date().toISOString(),
    payload: {
      id:      `test-${Date.now()}`,
      message: 'Teste de conexão — FlowDesk Webhook',
    },
  })

  const sig = crypto
    .createHmac('sha256', wh.secret_key)
    .update(body)
    .digest('hex')

  try {
    const { statusCode } = await makeSecureRequest(
      conn,
      {
        'Content-Type':    'application/json',
        'x-signature-256': `sha256=${sig}`,
      },
      body,
      TIMEOUT_MS,
    )
    const ok = statusCode >= 200 && statusCode < 300
    return {
      success: ok,
      status:  statusCode,
      message: ok
        ? 'Conexão testada com sucesso.'
        : `Servidor respondeu HTTP ${statusCode}.`,
    }
  } catch (err) {
    return {
      success: false,
      status:  null,
      message: err.isTimeout
        ? `Timeout: servidor não respondeu em ${TIMEOUT_MS / 1000}s.`
        : `Falha na conexão: ${err.message}`,
    }
  }
}
