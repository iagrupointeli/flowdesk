import crypto               from 'crypto'
import { query, getClient } from '#config/database.js'

const sha256 = token => crypto.createHash('sha256').update(token, 'utf8').digest('hex')

export async function createIntakeLink(actor, demandTypeId, { label, expires_at = null }) {
  const { rows: dtRows } = await query(
    'SELECT id FROM demand_types WHERE id = $1 AND archived_at IS NULL',
    [demandTypeId]
  )
  if (!dtRows[0]) throw Object.assign(new Error('Tipo de demanda não encontrado.'), { status: 404 })

  const token     = crypto.randomBytes(32).toString('base64url')
  const tokenHash = sha256(token)

  await query(
    `INSERT INTO intake_links (demand_type_id, label, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [demandTypeId, label, tokenHash, expires_at ?? null, actor.id]
  )

  return { token, url: `/intake/${token}` }
}

export async function listIntakeLinks(demandTypeId) {
  const { rows } = await query(
    `SELECT il.id, il.label, il.expires_at, il.created_at,
            u.name AS created_by_name
     FROM intake_links il
     JOIN users u ON u.id = il.created_by
     WHERE il.demand_type_id = $1
     ORDER BY il.created_at DESC`,
    [demandTypeId]
  )
  return rows
}

export async function deleteIntakeLink(id) {
  const { rowCount } = await query('DELETE FROM intake_links WHERE id = $1', [id])
  if (!rowCount) throw Object.assign(new Error('Link não encontrado.'), { status: 404 })
}

export async function resolveIntakeToken(token) {
  const tokenHash = sha256(token)

  const { rows } = await query(
    `SELECT il.id, il.demand_type_id, il.label, il.expires_at,
            il.created_by,
            dt.name AS demand_type_name
     FROM intake_links il
     JOIN demand_types dt ON dt.id = il.demand_type_id
     WHERE il.token_hash = $1`,
    [tokenHash]
  )

  if (!rows[0]) throw Object.assign(new Error('Link inválido ou expirado.'), { status: 404 })
  const link = rows[0]

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    throw Object.assign(new Error('Link inválido ou expirado.'), { status: 410 })
  }

  const { rows: fields } = await query(
    `SELECT id, label, field_type, required, options, display_order
     FROM demand_type_fields
     WHERE demand_type_id = $1 AND archived_at IS NULL
     ORDER BY display_order`,
    [link.demand_type_id]
  )

  return {
    link_label:       link.label,
    demand_type_id:   link.demand_type_id,
    demand_type_name: link.demand_type_name,
    fields,
    created_by:       link.created_by,
  }
}

export async function submitIntake(token, { title, requester_name, requester_email = '', notes = '', payload = {} }) {
  const form = await resolveIntakeToken(token)

  const snapshot = form.fields

  const errors = []
  for (const field of snapshot) {
    if (!field.required) continue
    const val = payload[field.id]
    if (val === undefined || val === null || val === '') {
      errors.push(`Campo "${field.label}" é obrigatório.`)
    }
  }
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 422 })

  const { rows: stageRows } = await query(
    `SELECT id FROM workflow_stages
     WHERE demand_type_id = $1 AND archived_at IS NULL
     ORDER BY display_order LIMIT 1`,
    [form.demand_type_id]
  )
  if (!stageRows[0]) throw Object.assign(new Error('Tipo de demanda sem etapas configuradas.'), { status: 422 })

  const { rows: dtRows } = await query(
    'SELECT sla_hours FROM demand_types WHERE id = $1',
    [form.demand_type_id]
  )
  const slaHours = dtRows[0]?.sla_hours ?? null

  const description = [
    `Submetido por: ${requester_name}${requester_email ? ` <${requester_email}>` : ''}`,
    notes ? `\nObservações: ${notes}` : '',
    `\n[Via formulário de intake: ${form.link_label}]`,
  ].join('')

  const client = await getClient()
  let demandId
  try {
    await client.query('BEGIN')

    const { rows: demandRows } = await client.query(
      `INSERT INTO demands
         (title, description, requester_id, demand_type_id, current_stage_id,
          fields_snapshot, payload, due_date)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
               CASE WHEN $8::int IS NOT NULL
                    THEN NOW() + ($8::int * INTERVAL '1 hour')
                    ELSE NULL END)
       RETURNING id`,
      [
        title,
        description,
        form.created_by,
        form.demand_type_id,
        stageRows[0].id,
        JSON.stringify(snapshot),
        JSON.stringify(payload),
        slaHours,
      ]
    )
    demandId = demandRows[0].id

    await client.query(
      `INSERT INTO demand_history
         (demand_id, actor_id, action, stage_id, snapshot)
       VALUES ($1, $2, 'created', $3, '{}'::jsonb)`,
      [demandId, form.created_by, stageRows[0].id]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { demand_id: demandId }
}
