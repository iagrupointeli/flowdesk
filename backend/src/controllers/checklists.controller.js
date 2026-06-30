import { z } from 'zod'
import * as svc from '#services/checklists.service.js'

// ── Schemas ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().min(1).max(500),
})

const updateSchema = z.object({
  title:        z.string().min(1).max(500).optional(),
  is_completed: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function list(req, res) {
  try { return res.json(await svc.listChecklists(req.user, req.params.id)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createChecklist(req.user, req.params.id, parsed.data))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(
      await svc.updateChecklist(req.user, req.params.id, req.params.itemId, parsed.data)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function remove(req, res) {
  try {
    return res.json(await svc.deleteChecklist(req.user, req.params.id, req.params.itemId))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}
