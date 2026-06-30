import { z }   from 'zod'
import * as svc from '#services/assetDocuments.service.js'

const schema = z.object({
  title:      z.string().min(1).max(200),
  doc_type:   z.enum(['alvara', 'contrato', 'seguro', 'licenca', 'outro']),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use formato YYYY-MM-DD'),
  notes:      z.string().max(2000).optional().nullable(),
})

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function list(req, res) {
  try {
    return res.json(await svc.listByAsset(req.params.assetId))
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.create(req.user, req.params.assetId, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function update(req, res) {
  const parsed = schema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.update(req.params.docId, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function remove(req, res) {
  try {
    await svc.remove(req.params.docId)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}
