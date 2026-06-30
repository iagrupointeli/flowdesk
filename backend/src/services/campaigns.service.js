import { query, getClient }        from '#config/database.js'
import { createNotification }      from '#services/notifications.service.js'
import { logger }                  from '#lib/logger.js'

const log = logger.child({ module: 'campaigns' })

/**
 * Campaigns Service — calendário de ocupação dos pontos OOH.
 *
 * O anti-double-booking é garantido pela exclusion constraint
 * `no_double_booking` (migration 027). Aqui apenas convertemos o erro
 * 23P01 do PostgreSQL em um 409 legível para o frontend.
 */

function translateExclusionError(err, asset_id) {
  if (err.code === '23P01') {
    return Object.assign(
      new Error('Conflito de ocupação: este ponto já possui campanha no período selecionado.'),
      { status: 409 }
    )
  }
  return err
}

/**
 * Lista campanhas que TOCAM o intervalo [from, to] (datas ISO yyyy-mm-dd).
 * Usado pela view de calendário mensal.
 */
export async function listCampaigns({ from, to, asset_id } = {}) {
  const params = []
  const where  = ['c.archived_at IS NULL']

  if (from && to) {
    params.push(from, to)
    where.push(`daterange(c.starts_on, c.ends_on, '[]') && daterange($1::date, $2::date, '[]')`)
  }
  if (asset_id) {
    params.push(asset_id)
    where.push(`c.asset_id = $${params.length}`)
  }

  const { rows } = await query(
    `SELECT
       c.id, c.asset_id, c.client_name, c.title,
       c.starts_on, c.ends_on, c.notes, c.demand_id, c.created_at,
       c.approval_status, c.approval_note, c.expires_at,
       a.name AS asset_name, a.code AS asset_code, a.is_premium,
       u.name AS created_by_name,
       d.title AS demand_title
     FROM campaigns c
     JOIN assets a ON a.id = c.asset_id
     JOIN users  u ON u.id = c.created_by
     LEFT JOIN demands d ON d.id = c.demand_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.starts_on ASC
     LIMIT 1000`,
    params
  )
  return rows
}

export async function expireHolds() {
  const { rows } = await query(
    `UPDATE campaigns
     SET approval_status = 'rejected', approval_note = 'Expirado automaticamente', archived_at = NOW()
     WHERE approval_status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
     RETURNING id, title, client_name, created_by`,
  )
  for (const c of rows) {
    createNotification(
      c.created_by,
      `⏰ Hold "${c.client_name} — ${c.title}" expirou e foi liberado automaticamente.`,
      '/admin/campaigns',
      'system'
    ).catch(err => log.error({ err }, 'Falha ao notificar expiração de hold'))
  }
  if (rows.length) log.info({ expired: rows.length }, 'Holds expirados arquivados')
  return rows.length
}

export async function createCampaign(actor, data) {
  const { asset_id, client_name, title, starts_on, ends_on,
          notes = null, demand_id = null, expires_at = null } = data

  const { rows: assetRows } = await query(
    'SELECT id, name, code, is_premium FROM assets WHERE id = $1 AND archived_at IS NULL', [asset_id]
  )
  if (!assetRows[0]) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 })
  const asset = assetRows[0]

  const durationDays = Math.ceil(
    (new Date(ends_on) - new Date(starts_on)) / (1000 * 60 * 60 * 24)
  )
  const needsApproval  = asset.is_premium || durationDays > 30
  const approvalStatus = needsApproval ? 'pending' : 'approved'

  let campaign
  try {
    const { rows } = await query(
      `INSERT INTO campaigns (asset_id, client_name, title, starts_on, ends_on, notes, demand_id, created_by, approval_status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, asset_id, client_name, title, starts_on, ends_on, demand_id, approval_status, expires_at, created_at`,
      [asset_id, client_name, title, starts_on, ends_on, notes, demand_id, actor.id, approvalStatus,
       needsApproval ? (expires_at ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) : null]
    )
    campaign = rows[0]
  } catch (err) {
    throw translateExclusionError(err, asset_id)
  }

  if (needsApproval) {
    const assetLabel = asset.code ? `[${asset.code}] ${asset.name}` : asset.name
    const reason     = asset.is_premium ? 'ponto premium' : `período longo (${durationDays} dias)`
    const message    = `⏳ Campanha "${client_name} — ${title}" (${assetLabel}) aguarda aprovação — ${reason}.`
    const { rows: managers } = await query(
      `SELECT id FROM users WHERE role IN ('super_admin', 'dept_admin') AND archived_at IS NULL`
    )
    for (const m of managers) {
      createNotification(m.id, message, '/admin/campaigns', 'system')
        .catch(err => log.error({ err }, 'Falha ao notificar hold de campanha'))
    }
  }

  return campaign
}

export async function updateCampaign(actor, id, data) {
  const sets   = []
  const params = []
  for (const key of ['client_name', 'title', 'starts_on', 'ends_on', 'notes', 'demand_id']) {
    if (data[key] !== undefined) {
      params.push(data[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (!sets.length) throw Object.assign(new Error('Nada para atualizar.'), { status: 422 })

  params.push(id)
  try {
    const { rows } = await query(
      `UPDATE campaigns SET ${sets.join(', ')}
       WHERE id = $${params.length} AND archived_at IS NULL
       RETURNING id, asset_id, client_name, title, starts_on, ends_on`,
      params
    )
    if (!rows[0]) throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 })
    return rows[0]
  } catch (err) {
    throw translateExclusionError(err)
  }
}

export async function archiveCampaign(actor, id) {
  const { rowCount } = await query(
    `UPDATE campaigns SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL`,
    [id]
  )
  if (!rowCount) throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 })
}

export async function approveCampaign(actor, campaignId, { action, note = null }) {
  if (!['approved', 'rejected'].includes(action)) {
    throw Object.assign(new Error('Ação inválida. Use "approved" ou "rejected".'), { status: 422 })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE campaigns
       SET approval_status = $1, approval_note = $2, approved_by = $3
       WHERE id = $4 AND approval_status = 'pending'
       RETURNING id, title, client_name, approval_status`,
      [action, note, actor.id, campaignId]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Campanha não encontrada ou já processada.'), { status: 404 })
    }

    if (action === 'rejected') {
      await client.query(
        'UPDATE campaigns SET archived_at = NOW() WHERE id = $1',
        [campaignId]
      )
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
