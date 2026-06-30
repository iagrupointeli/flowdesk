import { z } from 'zod'
import * as svc from '#services/webhooks.service.js'

// ── Schemas ───────────────────────────────────────────────────────────────────

const VALID_EVENTS = ['demand.created', 'demand.stage_changed', 'demand.blocked']

const webhookCreateSchema = z.object({
  department_id: z.string().uuid().nullable().optional(),
  url:           z.string().url({ message: 'URL inválida. Use https://...' }),
  events:        z.array(z.enum(VALID_EVENTS)).min(1, 'Selecione pelo menos um evento.'),
})

const webhookUpdateSchema = z.object({
  url:       z.string().url({ message: 'URL inválida.' }).optional(),
  events:    z.array(z.enum(VALID_EVENTS)).min(1).optional(),
  is_active: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function list(req, res) {
  try { return res.json(await svc.listWebhooks(req.user)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function create(req, res) {
  const parsed = webhookCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try { return res.status(201).json(await svc.createWebhook(req.user, parsed.data)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function update(req, res) {
  const parsed = webhookUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try { return res.json(await svc.updateWebhook(req.user, req.params.id, parsed.data)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function remove(req, res) {
  try { return res.json(await svc.deleteWebhook(req.user, req.params.id)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function test(req, res) {
  try { return res.json(await svc.testWebhook(req.user, req.params.id)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}
