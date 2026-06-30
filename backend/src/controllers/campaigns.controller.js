import { z }    from 'zod'
import * as svc from '#services/campaigns.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use yyyy-mm-dd)')

const createSchema = z.object({
  asset_id:    z.string().uuid(),
  client_name: z.string().min(2).max(200),
  title:       z.string().min(2).max(300),
  starts_on:   dateStr,
  ends_on:     dateStr,
  notes:       z.string().max(2000).optional().nullable(),
}).refine(d => d.ends_on >= d.starts_on, {
  message: 'A data final deve ser igual ou posterior à inicial.',
  path: ['ends_on'],
})

const updateSchema = z.object({
  client_name: z.string().min(2).max(200).optional(),
  title:       z.string().min(2).max(300).optional(),
  starts_on:   dateStr.optional(),
  ends_on:     dateStr.optional(),
  notes:       z.string().max(2000).optional().nullable(),
})

export async function list(req, res) {
  try {
    return res.json(await svc.listCampaigns(req.query))
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createCampaign(req.user, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.updateCampaign(req.user, req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function archive(req, res) {
  try {
    await svc.archiveCampaign(req.user, req.params.id)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}

export async function approve(req, res) {
  try {
    const { action, note } = req.body
    if (!action) return res.status(422).json({ error: '"action" é obrigatório (approved | rejected).' })
    return res.json(await svc.approveCampaign(req.user, req.params.id, { action, note }))
  } catch (err) { return handleError(err, res) }
}
