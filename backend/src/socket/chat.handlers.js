import * as chatService from '#services/chat.service.js'
import { logger }       from '#lib/logger.js'

export function registerChatHandlers(io, socket) {
  const user = socket.user   // injetado pelo socketAuthMiddleware

  // Child logger com contexto permanente do socket
  const log = logger.child({ userId: user.id, transport: 'socket.io' })

  socket.on('chat:join', async ({ channelId }) => {
    try {
      await chatService.assertMember(channelId, user.id)
      socket.join(channelId)
    } catch (err) {
      // 403 é esperado (usuário não é membro) → warn.
      // Qualquer outro status (5xx, banco caiu) → error para não passar em branco.
      const level = (err.status ?? 500) === 403 ? 'warn' : 'error'
      log[level]({ err, channelId }, 'chat:join negado')
    }
  })

  socket.on('chat:send', async ({ channelId, body, replyTo }) => {
    try {
      await chatService.assertMember(channelId, user.id)
      const message = await chatService.saveMessage({
        channelId, senderId: user.id, body, replyTo: replyTo || null,
      })
      io.to(channelId).emit('chat:message', message)
    } catch (err) {
      log.error({ err, channelId }, 'chat:send falhou')
      socket.emit('chat:error', { event: 'chat:send', error: err.message })
    }
  })

  socket.on('chat:typing', ({ channelId }) => {
    socket.to(channelId).emit('chat:typing', {
      channelId,
      userId:   user.id,
      userName: user.name ?? null,
    })
  })

  socket.on('chat:read', async ({ channelId }) => {
    try {
      await chatService.markAsRead(channelId, user.id)
      const lastReadAt = new Date()
      io.to(channelId).emit('chat:read_ack', { channelId, userId: user.id, lastReadAt })
    } catch (err) {
      log.warn({ err, channelId }, 'chat:read falhou')
    }
  })
}
