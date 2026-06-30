import { z }           from 'zod'
import * as chatService from '#services/chat.service.js'
import { getIo }        from '#lib/socketInstance.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message })
}

// GET /api/chat/users  — colegas de departamento disponíveis para chat
export async function listChatableUsers(req, res) {
  try {
    return res.json(await chatService.getChatableUsers(req.user.id, req.user.deptIds))
  } catch (err) { return handleError(err, res) }
}

// GET /api/chat/channels
export async function listChannels(req, res) {
  try {
    return res.json(await chatService.getUserChannels(req.user.id))
  } catch (err) { return handleError(err, res) }
}

// POST /api/chat/channels
const createChannelSchema = z.object({
  type:          z.enum(['dm', 'group', 'broadcast']),
  name:          z.string().min(1).max(100).nullish(),
  department_id: z.string().uuid().nullish(),
  members:       z.array(z.object({
    userId: z.string().uuid(),
    role:   z.enum(['member', 'admin']).default('member'),
  })).min(1),
})

export async function createChannel(req, res) {
  const parsed = createChannelSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    const channel = await chatService.createChannel({
      ...parsed.data,
      departmentId: parsed.data.department_id,
      createdBy: req.user.id,
    })
    return res.status(201).json(channel)
  } catch (err) { return handleError(err, res) }
}

// POST /api/chat/:id/messages  — envia mensagem de texto via REST
export async function sendTextMessage(req, res) {
  const channelId = req.params.id
  try {
    await chatService.assertMember(channelId, req.user.id)
    const body    = req.body.body?.trim() || null
    const replyTo = req.body.reply_to    || null
    if (!body) return res.status(422).json({ error: 'body é obrigatório.' })
    const message = await chatService.saveMessage({ channelId, senderId: req.user.id, body, replyTo })
    getIo()?.to(channelId).emit('chat:message', message)
    return res.status(201).json(message)
  } catch (err) { return handleError(err, res) }
}

// GET /api/chat/channels/:id/messages?cursor=<ISO>&limit=<n>
export async function listMessages(req, res) {
  try {
    await chatService.assertMember(req.params.id, req.user.id)
    const { cursor, limit } = req.query
    const messages = await chatService.getMessages(req.params.id, {
      cursor: cursor ?? null,
      limit:  limit  ? Math.min(parseInt(limit, 10), 100) : 50,
    })
    return res.json(messages)
  } catch (err) { return handleError(err, res) }
}

// POST /api/chat/channels/:id/messages/attachments  (multipart)
export async function uploadAttachment(req, res) {
  try {
    await chatService.assertMember(req.params.id, req.user.id)
    const message = await chatService.uploadAttachmentToMessage(req, {
      channelId: req.params.id,
      senderId:  req.user.id,
      body:      req.query.body ?? null,
      replyTo:   req.query.reply_to ?? null,
    })
    getIo()?.to(req.params.id).emit('chat:message', message)
    return res.status(201).json(message)
  } catch (err) { return handleError(err, res) }
}

// DELETE /api/chat/messages/:messageId
export async function deleteMessage(req, res) {
  try {
    const result = await chatService.deleteMessage(req.params.messageId, req.user.id)
    getIo()?.to(result.channelId).emit('chat:message_deleted', {
      messageId: result.messageId,
      channelId: result.channelId,
    })
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}

// GET /api/chat/attachments/:attachmentId/url
export async function getAttachmentUrl(req, res) {
  try {
    const url = await chatService.getAttachmentUrl(req.params.attachmentId, req.user.id)
    return res.json({ url })
  } catch (err) { return handleError(err, res) }
}
