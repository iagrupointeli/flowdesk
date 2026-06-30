import { createHash, randomBytes } from 'node:crypto'
import { query }                  from '#config/database.js'
import { getDemand, uploadAttachment } from '#services/demands.service.js'
import { createNotification }     from '#services/notifications.service.js'
import { presignedDownloadUrl }   from '#services/storage.service.js'
import { logger }                 from '#lib/logger.js'

const log = logger.child({ module: 'external-portal' })

function sha256(token) {
  return createHash('sha256').update(token).digest('hex')
}

// ── Gestão de links (área autenticada) ────────────────────────────────────────

/**
 * Cria um link externo para a demanda. O token em claro só existe no retorno
 * desta função — o banco guarda apenas o hash.
 */
export async function createExternalLink(actor, demandId, { label = null, expires_in_days = 15 }) {
  await getDemand(actor, demandId)   // valida acesso (403/404)

  const token = randomBytes(32).toString('base64url')
  const { rows } = await query(
    `INSERT INTO external_links (demand_id, token_hash, label, created_by, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5::int * INTERVAL '1 day'))
     RETURNING id, label, expires_at, created_at`,
    [demandId, sha256(token), label, actor.id, expires_in_days]
  )

  return { ...rows[0], token }   // token aparece UMA única vez
}

export async function listExternalLinks(actor, demandId) {
  await getDemand(actor, demandId)

  const { rows } = await query(
    `SELECT el.id, el.label, el.expires_at, el.revoked_at, el.last_used_at,
            el.created_at, u.name AS created_by_name,
            (el.revoked_at IS NULL AND el.expires_at > NOW()) AS is_active
     FROM external_links el
     JOIN users u ON u.id = el.created_by
     WHERE el.demand_id = $1
     ORDER BY el.created_at DESC`,
    [demandId]
  )
  return rows
}

export async function revokeExternalLink(actor, demandId, linkId) {
  await getDemand(actor, demandId)

  const { rowCount } = await query(
    `UPDATE external_links SET revoked_at = NOW()
     WHERE id = $1 AND demand_id = $2 AND revoked_at IS NULL`,
    [linkId, demandId]
  )
  if (!rowCount) throw Object.assign(new Error('Link não encontrado ou já revogado.'), { status: 404 })
}

// ── Acesso público via token ──────────────────────────────────────────────────

/**
 * Resolve um token externo. Lança 404 genérico para token inválido,
 * expirado OU revogado — sem distinguir o motivo (não vaza estado).
 */
async function resolveToken(token) {
  if (!token || token.length > 64) {
    throw Object.assign(new Error('Link inválido ou expirado.'), { status: 404 })
  }

  const { rows } = await query(
    `SELECT el.id, el.demand_id, el.created_by, el.label
     FROM external_links el
     WHERE el.token_hash = $1
       AND el.revoked_at IS NULL
       AND el.expires_at > NOW()`,
    [sha256(token)]
  )
  if (!rows[0]) throw Object.assign(new Error('Link inválido ou expirado.'), { status: 404 })

  // fire-and-forget: marca último uso
  query(`UPDATE external_links SET last_used_at = NOW() WHERE id = $1`, [rows[0].id])
    .catch(err => log.warn({ err }, 'Falha ao registrar last_used_at'))

  return rows[0]
}

/**
 * Visão pública da demanda — APENAS o essencial para o prestador executar:
 * título, descrição, etapa, ponto (endereço incluso) e contagem de fotos já
 * enviadas. NUNCA expor: comentários internos, payload, nomes de outros
 * usuários, valores.
 */
export async function getExternalView(token) {
  const link = await resolveToken(token)

  const { rows } = await query(
    `SELECT
       d.id, d.title, d.description,
       ws.name  AS stage_name,
       ws.is_final,
       d.exception_state,
       a.name   AS asset_name,
       a.code   AS asset_code,
       a.address AS asset_address,
       a.city   AS asset_city,
       (SELECT COUNT(*)::int FROM attachments at2
         WHERE at2.demand_id = d.id AND at2.kind = 'checking') AS photo_count
     FROM demands d
     LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
     LEFT JOIN assets a           ON a.id  = d.asset_id
     WHERE d.id = $1`,
    [link.demand_id]
  )
  if (!rows[0]) throw Object.assign(new Error('Link inválido ou expirado.'), { status: 404 })

  return { ...rows[0], contractor_label: link.label }
}

/**
 * Fotos de checking com URLs assinadas para exibição no portal externo.
 * Expõe apenas: id, file_name, entered_at, url (presigned 15 min).
 * file_path nunca sai na resposta.
 */
export async function getExternalPhotos(token) {
  const link = await resolveToken(token)

  const { rows } = await query(
    `SELECT id, file_name, file_path, entered_at
     FROM attachments
     WHERE demand_id = $1 AND kind = 'checking'
     ORDER BY entered_at ASC`,
    [link.demand_id]
  )

  return Promise.all(
    rows.map(async r => ({
      id:         r.id,
      file_name:  r.file_name,
      entered_at: r.entered_at,
      url:        await presignedDownloadUrl(r.file_path),
    }))
  )
}

/**
 * Upload de foto de checking pelo prestador.
 * Internamente reusa uploadAttachment com um ator sintético baseado no
 * created_by do link — quem gerou o link responde pelo material.
 */
export async function externalUpload(token, req) {
  const link = await resolveToken(token)

  // força kind=checking independente do que vier na query
  req.query = { ...req.query, kind: 'checking' }

  const syntheticActor = { id: link.created_by, role: 'super_admin', deptIds: [] }
  const attachment = await uploadAttachment(syntheticActor, link.demand_id, req)

  log.info({ linkId: link.id, demandId: link.demand_id, attachmentId: attachment.id },
    'Upload externo de evidência')
  return attachment
}

/**
 * Prestador registra conclusão do serviço: comentário no feed + notificações
 * para o responsável da demanda e para quem criou o link.
 */
export async function externalComplete(token, notes = '') {
  const link = await resolveToken(token)

  const who  = link.label ? `Prestador externo (${link.label})` : 'Prestador externo'
  const body = `🔧 ${who} marcou o serviço como concluído.`
    + (notes.trim() ? `\n\nObservações: ${notes.trim().slice(0, 1000)}` : '')

  const { rows: demandRows } = await query(
    `SELECT d.id, d.title, d.current_stage_id, d.current_assignee_id
     FROM demands d WHERE d.id = $1`,
    [link.demand_id]
  )
  const demand = demandRows[0]
  if (!demand) throw Object.assign(new Error('Link inválido ou expirado.'), { status: 404 })

  await query(
    `INSERT INTO demand_feed (demand_id, event_type, actor_id, stage_id, assignee_id, body, entered_at)
     VALUES ($1, 'comment_added', $2, $3, $4, $5, NOW())`,
    [demand.id, link.created_by, demand.current_stage_id,
     demand.current_assignee_id ?? null, body]
  )

  // Notifica responsável e criador do link (sem duplicar se forem a mesma pessoa)
  const targets = new Set(
    [demand.current_assignee_id, link.created_by].filter(Boolean).map(String)
  )
  for (const userId of targets) {
    createNotification(
      userId,
      `${who} concluiu o serviço em: "${demand.title.slice(0, 80)}"`,
      `/demands/${demand.id}`,
      'system'
    ).catch(err => log.error({ err }, 'Falha ao notificar conclusão externa'))
  }

  log.info({ linkId: link.id, demandId: demand.id }, 'Conclusão registrada pelo prestador')
  return { ok: true }
}
