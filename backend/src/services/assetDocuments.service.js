import { query }              from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'
import { logger }             from '#lib/logger.js'

const log = logger.child({ module: 'asset-documents' })

export async function listByAsset(assetId) {
  const { rows } = await query(
    `SELECT id, title, doc_type, expires_at, notes, created_at,
            (expires_at < CURRENT_DATE)                          AS expired,
            (expires_at - CURRENT_DATE)::int                     AS days_remaining
     FROM asset_documents
     WHERE asset_id = $1
     ORDER BY expires_at ASC`,
    [assetId]
  )
  return rows
}

export async function create(actor, assetId, { title, doc_type, expires_at, notes = null }) {
  const { rows } = await query(
    `INSERT INTO asset_documents (asset_id, title, doc_type, expires_at, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, doc_type, expires_at, notes, created_at`,
    [assetId, title, doc_type, expires_at, notes, actor.id]
  )
  return rows[0]
}

export async function update(id, { title, doc_type, expires_at, notes }) {
  const sets   = []
  const params = []
  for (const [key, val] of Object.entries({ title, doc_type, expires_at, notes })) {
    if (val !== undefined) { params.push(val); sets.push(`${key} = $${params.length}`) }
  }
  if (!sets.length) throw Object.assign(new Error('Nada para atualizar.'), { status: 422 })
  params.push(id)
  const { rows } = await query(
    `UPDATE asset_documents SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING id, title, doc_type, expires_at, notes`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 })
  return rows[0]
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM asset_documents WHERE id = $1', [id])
  if (!rowCount) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 })
}

/**
 * Job diário: notifica super_admins quando documentos vencem em 30, 15, 7 ou 1 dia.
 */
export async function runDocumentExpiryCheck() {
  const thresholds = [30, 15, 7, 1]

  const { rows: admins } = await query(
    `SELECT id FROM users WHERE role = 'super_admin' AND deactivated_at IS NULL`
  )
  if (!admins.length) return

  for (const days of thresholds) {
    const { rows: docs } = await query(
      `SELECT ad.id, ad.title, ad.doc_type,
              a.name AS asset_name, a.code AS asset_code
       FROM asset_documents ad
       JOIN assets a ON a.id = ad.asset_id
       WHERE (ad.expires_at - CURRENT_DATE) = $1`,
      [days]
    )

    for (const doc of docs) {
      const label   = doc.asset_code ? `[${doc.asset_code}] ${doc.asset_name}` : doc.asset_name
      const message = `⚠ Documento "${doc.title}" (${doc.doc_type}) do ponto ${label} vence em ${days} dia${days > 1 ? 's' : ''}.`
      for (const admin of admins) {
        createNotification(admin.id, message, '/admin/assets', 'system')
          .catch(err => log.error({ err }, 'Falha ao notificar vencimento de documento'))
      }
    }
  }

  log.info('Document expiry check concluído')
}
