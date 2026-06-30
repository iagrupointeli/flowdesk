import { z } from 'zod'
import * as svc from '#services/intake.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function getForm(req, res) {
  try {
    return res.json(await svc.resolveIntakeToken(req.params.token))
  } catch (err) { return handleError(err, res) }
}

const submitSchema = z.object({
  title:           z.string().min(1).max(500),
  requester_name:  z.string().min(1).max(200),
  requester_email: z.string().email().optional().or(z.literal('')),
  notes:           z.string().max(2000).optional(),
  payload:         z.record(z.unknown()).optional().default({}),
})

export async function submit(req, res) {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    const result = await svc.submitIntake(req.params.token, parsed.data)
    return res.status(201).json(result)
  } catch (err) { return handleError(err, res) }
}
