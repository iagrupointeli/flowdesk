import { z } from 'zod'
import * as svc from '#services/tags.service.js'

const createSchema = z.object({
  name:          z.string().min(1).max(100),
  color_hex:     z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (ex: #6366f1)').default('#6366f1'),
  department_id: z.string().uuid(),
})

const addToDemandSchema = z.object({
  tag_id: z.string().uuid(),
})

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

// ── Tags (CRUD) ───────────────────────────────────────────────────────────────

export async function list(req, res) {
  try {
    const tags = await svc.listTags(req.user, req.query.department_id ?? null)
    return res.json(tags)
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createTag(req.user, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function remove(req, res) {
  try {
    await svc.deleteTag(req.user, req.params.tagId)
    return res.json({ ok: true })
  } catch (err) { return handleError(err, res) }
}

// ── Demand-Tag link ───────────────────────────────────────────────────────────

export async function addToDemand(req, res) {
  const parsed = addToDemandSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    const tag = await svc.addTagToDemand(req.user, req.params.id, parsed.data.tag_id)
    return res.status(201).json(tag)
  } catch (err) { return handleError(err, res) }
}

export async function removeFromDemand(req, res) {
  try {
    await svc.removeTagFromDemand(req.user, req.params.id, req.params.tagId)
    return res.json({ ok: true })
  } catch (err) { return handleError(err, res) }
}
