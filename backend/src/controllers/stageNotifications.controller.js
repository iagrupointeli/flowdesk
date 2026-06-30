// backend/src/controllers/stageNotifications.controller.js
import { z } from 'zod'
import * as svc from '#services/stageNotifications.service.js'

const schema = z.object({
  notify_requester: z.boolean(),
  notify_assignee:  z.boolean(),
  message_template: z.string().min(5).max(500),
})

export async function upsert(req, res) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.upsert(req.params.stageId, parsed.data))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function remove(req, res) {
  try {
    await svc.remove(req.params.stageId)
    return res.status(204).end()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
