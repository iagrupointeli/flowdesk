/**
 * Notifications Service.
 *
 * Responsabilidades:
 *   createNotification  — insere no banco + despacha via SSE (fire-and-forget)
 *   listNotifications   — paginação keyset (created_at DESC)
 *   markAsRead          — marca uma notificação como lida (valida ownership)
 *   markAllRead         — marca todas como lidas para um usuário
 *   getUnreadCount      — COUNT rápido (usa idx_notifications_unread)
 */
import { query } from '#config/database.js'
import { dispatch } from '#lib/sseManager.js'

const PAGE_SIZE = 20

/**
 * Cria uma notificação no banco e despacha via SSE para o usuário.
 * Deve ser chamado com fire-and-forget (.catch(logger)) em serviços de mutação.
 *
 * @param {string}      userId
 * @param {string}      message   — texto visível ao usuário (max 500 chars)
 * @param {string|null} link      — rota relativa do frontend (ex: /demands/:id)
 * @returns {Promise<object>}     — linha inserida
 */
export async function createNotification(userId, message, link = null, type = 'system') {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, message, link, type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, message, link, type, is_read, created_at`,
    [String(userId), message.slice(0, 500), link, type]
  )
  const notification = rows[0]

  // Despacho SSE — não bloqueia nem falha a notificação se o usuário estiver offline
  dispatch(String(userId), { type: 'notification', data: notification })

  return notification
}

/**
 * Lista as notificações de um usuário (paginação keyset DESC por created_at).
 *
 * @param {string}      userId
 * @param {string|null} cursor   — ISO string do último created_at visto (ou null)
 * @param {string|null} cursorId — UUID do último id visto (desempate)
 * @returns {{ items, hasMore, nextCursor, nextCursorId, unreadCount }}
 */
export async function listNotifications(userId, cursor = null, cursorId = null) {
  const limit  = PAGE_SIZE + 1
  const params = [String(userId), !!cursor, cursor, cursorId, limit]

  const { rows } = await query(
    `SELECT id, message, link, is_read, created_at
     FROM notifications
     WHERE user_id = $1
       AND (NOT $2
            OR (created_at, id::text) < ($3::timestamptz, $4))
     ORDER BY created_at DESC, id DESC
     LIMIT $5`,
    params
  )

  const hasMore = rows.length > PAGE_SIZE
  const items   = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  // unreadCount só para a primeira página (cursor = null)
  let unreadCount = null
  if (!cursor) {
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM notifications WHERE user_id = $1 AND is_read = false`,
      [String(userId)]
    )
    unreadCount = countRows[0].cnt
  }

  const last = items[items.length - 1]
  return {
    items,
    hasMore,
    nextCursor:   hasMore ? last.created_at : null,
    nextCursorId: hasMore ? last.id         : null,
    unreadCount,
  }
}

/**
 * Marca uma notificação específica como lida.
 * Valida que a notificação pertence ao usuário antes de atualizar.
 *
 * @param {string} userId
 * @param {string} notificationId
 */
export async function markAsRead(userId, notificationId) {
  const { rowCount } = await query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1 AND user_id = $2 AND is_read = false`,
    [notificationId, String(userId)]
  )
  if (!rowCount) {
    // Pode ser already-read (idempotente) ou not-found/not-owned
    const { rows } = await query(
      `SELECT id FROM notifications WHERE id = $1 AND user_id = $2`,
      [notificationId, String(userId)]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Notificação não encontrada.'), { status: 404 })
    }
    // Já estava lida — retorna sucesso (idempotência)
  }
}

/**
 * Marca TODAS as notificações não lidas do usuário como lidas.
 *
 * @param {string} userId
 * @returns {number} quantidade atualizada
 */
export async function markAllRead(userId) {
  const { rowCount } = await query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [String(userId)]
  )
  return rowCount ?? 0
}

/**
 * Retorna a contagem de notificações não lidas.
 * Usa índice parcial idx_notifications_unread para performance.
 *
 * @param {string} userId
 * @returns {number}
 */
export async function getUnreadCount(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS cnt FROM notifications WHERE user_id = $1 AND is_read = false`,
    [String(userId)]
  )
  return rows[0].cnt
}
