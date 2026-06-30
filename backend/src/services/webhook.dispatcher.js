/**
 * webhook.dispatcher.js
 *
 * Utilitário de dispatch de webhooks de saída (fire-and-forget).
 *
 * ── Contrato ─────────────────────────────────────────────────────────────────
 *   • dispatchWebhooks() retorna void — nunca lança, nunca bloqueia resposta HTTP.
 *   • Erros de rede/timeout são logados em stderr; não causam rollback.
 *   • DEVE ser chamado somente APÓS client.release(), fora de qualquer transação.
 *   • Timeout por envio: 5 000 ms (AbortController).
 *   • Assinatura: x-signature-256: sha256=<hmac-hex> (padrão GitHub Webhooks).
 *   • Filtro: events @> $2::jsonb garante que apenas webhooks inscritos recebem.
 *   • Escopo: department_id = $1 OU department_id IS NULL (webhooks globais).
 *
 * ── Eventos suportados ───────────────────────────────────────────────────────
 *   demand.created        demand.stage_changed        demand.blocked
 */

import crypto from 'node:crypto'
import { query }                              from '#config/database.js'
import { resolveToSafeIp, makeSecureRequest } from '#utils/ssrf-guard.js'

const TIMEOUT_MS = 5_000

/**
 * Carrega webhooks ativos para o evento/departamento (+ globais) e dispara em background.
 *
 * @param {'demand.created'|'demand.stage_changed'|'demand.blocked'} eventName
 * @param {string} departmentId   UUID do departamento
 * @param {object} payload        Dados do evento (sem informações sensíveis)
 */
export function dispatchWebhooks(eventName, departmentId, payload) {
  _run(eventName, departmentId, payload).catch(err =>
    console.error('[webhook.dispatcher] erro inesperado:', err.message)
  )
}

// ── Implementação interna ─────────────────────────────────────────────────────

async function _run(eventName, departmentId, payload) {
  // Inclui webhooks do departamento E webhooks globais (department_id IS NULL)
  const { rows } = await query(
    `SELECT id, url, secret_key
     FROM webhooks
     WHERE (department_id = $1 OR department_id IS NULL)
       AND is_active = true
       AND events @> $2::jsonb`,
    [departmentId, JSON.stringify([eventName])]
  )

  if (rows.length === 0) return

  const enriched = await _enrichPayload(eventName, payload)

  const body = JSON.stringify({
    event:   eventName,
    sent_at: new Date().toISOString(),
    payload: enriched,
  })

  await Promise.allSettled(rows.map(wh => _sendOne(wh, body)))
}

/**
 * Enriquece o payload com campos legíveis (nomes em vez de UUIDs brutos).
 * Nunca lança — falha silenciosa mantém o dispatch com payload original.
 */
async function _enrichPayload(eventName, payload) {
  try {
    if (eventName === 'demand.created' && payload.id) {
      const { rows } = await query(
        `SELECT dt.name  AS demand_type_name,
                dept.name AS department_name,
                u.name    AS requester_name
         FROM demands d
         JOIN demand_types  dt   ON dt.id   = d.demand_type_id
         JOIN departments   dept ON dept.id = dt.department_id
         LEFT JOIN users    u    ON u.id    = $2
         WHERE d.id = $1`,
        [payload.id, payload.requester_id ?? null]
      )
      if (rows[0]) return { ...payload, ...rows[0] }
    }

    if (eventName === 'demand.stage_changed') {
      const parts = await Promise.all([
        payload.actor_id
          ? query('SELECT name AS actor_name FROM users WHERE id = $1', [payload.actor_id])
              .then(r => r.rows[0] ?? {})
          : Promise.resolve({}),
        payload.from_stage_id
          ? query('SELECT name AS from_stage_name FROM workflow_stages WHERE id = $1', [payload.from_stage_id])
              .then(r => r.rows[0] ?? {})
          : Promise.resolve({}),
      ])
      return { ...payload, ...Object.assign({}, ...parts) }
    }

    if (eventName === 'demand.blocked' && payload.actor_id) {
      const { rows } = await query(
        'SELECT name AS actor_name FROM users WHERE id = $1',
        [payload.actor_id]
      )
      if (rows[0]) return { ...payload, actor_name: rows[0].actor_name }
    }
  } catch (err) {
    console.warn('[webhook.dispatcher] enriquecimento falhou, usando payload bruto:', err.message)
  }

  return payload
}

async function _sendOne(webhook, body) {
  // Resolve + valida DNS em um passo; IP fixo previne DNS rebinding no envio real
  let conn
  try {
    conn = await resolveToSafeIp(webhook.url)
  } catch (err) {
    console.warn(`[webhook] ${webhook.id} → SSRF bloqueado: ${err.message}`)
    return
  }

  const sig = crypto
    .createHmac('sha256', webhook.secret_key)
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
    if (statusCode >= 300) {
      console.warn(`[webhook] ${webhook.id} → ${webhook.url} respondeu HTTP ${statusCode}`)
    }
  } catch (err) {
    console.warn(`[webhook] ${webhook.id} → ${webhook.url}: ${err.message}`)
  }
}
