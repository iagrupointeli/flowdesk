import { Transform }      from 'node:stream'
import { randomUUID }     from 'node:crypto'
import busboy             from 'busboy'
import { fileTypeStream } from 'file-type'
import { query, getClient }                         from '#config/database.js'
import { uploadStream, confirmObject, deleteObject,
         presignedDownloadUrl }                     from '#services/storage.service.js'

const MAX_FILE_SIZE = 20 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv', 'application/zip',
  'application/octet-stream',
])

export async function saveMessage({ channelId, senderId, body, replyTo }) {
  const { rows } = await query(
    `INSERT INTO chat_messages (channel_id, sender_id, body, reply_to)
     VALUES ($1, $2, $3, $4)
     RETURNING id, channel_id, sender_id, body, reply_to, created_at`,
    [channelId, senderId, body ?? null, replyTo ?? null]
  )
  const msg = rows[0]

  const { rows: uRows } = await query(
    `SELECT name FROM users WHERE id = $1`,
    [senderId]
  )
  return { ...msg, sender_name: uRows[0]?.name ?? null }
}

export async function markAsRead(channelId, userId) {
  await query(
    `UPDATE chat_members SET last_read_at = NOW()
     WHERE channel_id = $1 AND user_id = $2`,
    [channelId, userId]
  )
}

export async function assertMember(channelId, userId) {
  const { rows } = await query(
    `SELECT role FROM chat_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, userId]
  )
  if (!rows[0]) throw Object.assign(new Error('Acesso negado ao canal.'), { status: 403 })
  return rows[0].role
}

// ── getChatableUsers ──────────────────────────────────────────────────────────
// Retorna usuários ativos nos mesmos departamentos do solicitante (exceto ele
// mesmo). super_admin não é escopado por departamento — vê a holding inteira,
// inclusive contas (como a do próprio Ruan) sem nenhum departamento atribuído.
export async function getChatableUsers(userId, deptIds, role) {
  if (role === 'super_admin') {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, NULL::uuid AS department_id
       FROM users u
       WHERE u.id <> $1
         AND u.deactivated_at IS NULL
       ORDER BY u.name`,
      [userId]
    )
    return rows
  }
  if (!deptIds?.length) return []
  const placeholders = deptIds.map((_, i) => `$${i + 2}`).join(', ')
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.name, u.email, ud.department_id
     FROM users u
     JOIN user_departments ud ON ud.user_id = u.id
     WHERE ud.department_id IN (${placeholders})
       AND u.id <> $1
       AND u.deactivated_at IS NULL
     ORDER BY u.name`,
    [userId, ...deptIds]
  )
  return rows
}

// ── getUserChannels ────────────────────────────────────────────────────────────
export async function getUserChannels(userId) {
  const { rows } = await query(
    `SELECT
       c.id, c.type, c.name, c.department_id,
       cm.role AS my_role,
       dm_peer.id   AS peer_id,
       dm_peer.name AS peer_name,
       -- última mensagem (preview)
       lm.id         AS last_msg_id,
       lm.body       AS last_msg_body,
       lm.created_at AS last_msg_at,
       lu.name       AS last_msg_sender,
       -- não lidas: mensagens após last_read_at
       COALESCE((
         SELECT COUNT(*)::int
         FROM chat_messages msg
         WHERE msg.channel_id = c.id
           AND msg.deleted_at IS NULL
           AND (cm.last_read_at IS NULL OR msg.created_at > cm.last_read_at)
       ), 0) AS unread_count
     FROM chat_members cm
     JOIN chat_channels c ON c.id = cm.channel_id
     LEFT JOIN LATERAL (
       SELECT u2.id, u2.name
       FROM chat_members cm2
       JOIN users u2 ON u2.id = cm2.user_id
       WHERE cm2.channel_id = c.id AND cm2.user_id <> $1
       LIMIT 1
     ) dm_peer ON c.type = 'dm'
     LEFT JOIN LATERAL (
       SELECT m.id, m.body, m.created_at, m.sender_id
       FROM chat_messages m
       WHERE m.channel_id = c.id AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC LIMIT 1
     ) lm ON true
     LEFT JOIN users lu ON lu.id = lm.sender_id
     WHERE cm.user_id = $1
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [userId]
  )
  return rows
}

// ── createChannel ─────────────────────────────────────────────────────────────
// members: [{ userId, role }] — createdBy is added with role 'owner' automatically
export async function createChannel({ type, name, departmentId, members, createdBy }) {
  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows: [channel] } = await client.query(
      `INSERT INTO chat_channels (type, name, department_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, name ?? null, departmentId ?? null, createdBy]
    )

    // Garante que o criador entra como owner
    const allMembers = [
      { userId: createdBy, role: 'owner' },
      ...members.filter(m => m.userId !== createdBy),
    ]

    for (const m of allMembers) {
      await client.query(
        `INSERT INTO chat_members (channel_id, user_id, role)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [channel.id, m.userId, m.role ?? 'member']
      )
    }

    await client.query('COMMIT')
    return channel
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── getMessages ───────────────────────────────────────────────────────────────
// cursor = ISO datetime string; returns up to `limit` messages before cursor (DESC)
export async function getMessages(channelId, { cursor, limit = 50 } = {}) {
  const params = [channelId, limit]
  const cursorClause = cursor
    ? `AND m.created_at < $3`
    : ''
  if (cursor) params.push(cursor)

  const { rows } = await query(
    `SELECT m.id, m.channel_id, m.sender_id, u.name AS sender_name,
            m.body, m.reply_to, m.created_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', ca.id, 'file_name', ca.file_name,
                  'file_size', ca.file_size, 'mime_type', ca.mime_type
                )
              ) FILTER (WHERE ca.id IS NOT NULL),
              '[]'
            ) AS attachments
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN chat_attachments ca ON ca.message_id = m.id
     WHERE m.channel_id = $1
       AND m.deleted_at IS NULL
       ${cursorClause}
     GROUP BY m.id, u.name
     ORDER BY m.created_at DESC
     LIMIT $2`,
    params
  )
  // Retorna na ordem cronológica (mais antigo primeiro)
  return rows.reverse()
}

// ── uploadAttachmentToMessage ──────────────────────────────────────────────────
// Cria message (body pode ser null) + faz upload do arquivo + insere chat_attachments
export async function uploadAttachmentToMessage(req, { channelId, senderId, body, replyTo }) {
  return new Promise((resolve, reject) => {
    let fileProcessed = false
    let filePromise   = null

    const bb = busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_FILE_SIZE },
    })

    bb.on('file', (_field, fileStream, info) => {
      fileProcessed = true
      const objectName = `chat/${randomUUID()}`
      let truncated    = false

      fileStream.on('limit', () => { truncated = true })

      filePromise = (async () => {
        const typedStream = await fileTypeStream(fileStream)
        const detectedMime = typedStream.fileType?.mime ?? 'application/octet-stream'

        if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
          typedStream.resume()
          throw Object.assign(
            new Error(`Tipo de arquivo não permitido: ${detectedMime}`),
            { status: 415 }
          )
        }

        // Counter Transform — zero overhead
        const counter = new Transform({
          transform(chunk, _enc, cb) { this.total = (this.total ?? 0) + chunk.length; cb(null, chunk) },
        })
        typedStream.pipe(counter)

        await uploadStream(objectName, counter, detectedMime)

        if (truncated) {
          await deleteObject(objectName).catch(() => {})
          throw Object.assign(
            new Error(`Arquivo excede o limite de ${MAX_FILE_SIZE / 1024 / 1024} MB.`),
            { status: 413 }
          )
        }

        return { objectName, filename: info.filename || 'arquivo', mime: detectedMime, size: counter.total }
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
        const { objectName, filename, mime, size } = await filePromise

        // Cria mensagem + attachment em sequência (sem transação — mesma tolerância do demand upload)
        const { rows: [msg] } = await query(
          `INSERT INTO chat_messages (channel_id, sender_id, body, reply_to)
           VALUES ($1, $2, $3, $4)
           RETURNING id, channel_id, sender_id, body, reply_to, created_at`,
          [channelId, senderId, body ?? null, replyTo ?? null]
        )

        const { rows: [att] } = await query(
          `INSERT INTO chat_attachments (message_id, file_path, file_name, file_size, mime_type)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, file_name, file_size, mime_type`,
          [msg.id, objectName, filename, size, mime]
        )

        await confirmObject(objectName)

        const { rows: [u] } = await query(`SELECT name FROM users WHERE id = $1`, [senderId])
        resolve({ ...msg, sender_name: u?.name ?? null, attachments: [att] })
      } catch (err) {
        reject(err)
      }
    })

    bb.on('error', reject)
    req.pipe(bb)
  })
}

// ── deleteMessage ─────────────────────────────────────────────────────────────
export async function deleteMessage(messageId, userId) {
  const { rows: [msg] } = await query(
    `SELECT m.id, m.channel_id, m.sender_id,
            COALESCE(json_agg(a.file_path) FILTER (WHERE a.id IS NOT NULL), '[]') AS paths
     FROM chat_messages m
     LEFT JOIN chat_attachments a ON a.message_id = m.id
     WHERE m.id = $1 AND m.deleted_at IS NULL
     GROUP BY m.id, m.channel_id, m.sender_id`,
    [messageId]
  )
  if (!msg)               throw Object.assign(new Error('Mensagem não encontrada.'), { status: 404 })
  if (msg.sender_id !== userId) throw Object.assign(new Error('Sem permissão.'),     { status: 403 })

  await query(`UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1`, [messageId])

  if (msg.paths?.length) {
    await Promise.all(msg.paths.map(p => deleteObject(p).catch(() => {})))
  }

  return { messageId, channelId: msg.channel_id }
}

// ── getAttachmentUrl ──────────────────────────────────────────────────────────
export async function getAttachmentUrl(attachmentId, userId) {
  const { rows } = await query(
    `SELECT ca.file_path, cm.user_id
     FROM chat_attachments ca
     JOIN chat_messages   msg ON msg.id = ca.message_id
     JOIN chat_members    cm  ON cm.channel_id = msg.channel_id AND cm.user_id = $2
     WHERE ca.id = $1`,
    [attachmentId, userId]
  )
  if (!rows[0]) throw Object.assign(new Error('Anexo não encontrado.'), { status: 404 })
  return presignedDownloadUrl(rows[0].file_path)
}
