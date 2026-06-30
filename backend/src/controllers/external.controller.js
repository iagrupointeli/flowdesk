import { z }    from 'zod'
import * as svc from '#services/external.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

// ── Gestão (autenticada) ──────────────────────────────────────────────────────

const createLinkSchema = z.object({
  label:           z.string().max(200).optional().nullable(),
  expires_in_days: z.coerce.number().int().min(1).max(90).default(15),
})

export async function createLink(req, res) {
  const parsed = createLinkSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createExternalLink(req.user, req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function listLinks(req, res) {
  try {
    return res.json(await svc.listExternalLinks(req.user, req.params.id))
  } catch (err) { return handleError(err, res) }
}

export async function revokeLink(req, res) {
  try {
    await svc.revokeExternalLink(req.user, req.params.id, req.params.linkId)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}

// ── Portal público (token, sem autenticação) ─────────────────────────────────

export async function view(req, res) {
  try {
    return res.json(await svc.getExternalView(req.params.token))
  } catch (err) { return handleError(err, res) }
}

export async function photos(req, res) {
  try {
    return res.json(await svc.getExternalPhotos(req.params.token))
  } catch (err) { return handleError(err, res) }
}

export async function uploadPhoto(req, res) {
  try {
    return res.status(201).json(await svc.externalUpload(req.params.token, req))
  } catch (err) { return handleError(err, res) }
}

const completeSchema = z.object({
  notes: z.string().max(1000).optional().default(''),
})

export async function complete(req, res) {
  const parsed = completeSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.externalComplete(req.params.token, parsed.data.notes))
  } catch (err) { return handleError(err, res) }
}
