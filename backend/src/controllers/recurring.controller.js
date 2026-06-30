import { z }    from 'zod'
import * as svc from '#services/recurring.service.js'

function handleError(err, res) {
  const status = err.status ?? 500
  const body   = { error: err.message ?? 'Erro interno.' }
  if (err.fieldErrors) body.fieldErrors = err.fieldErrors
  return res.status(status).json(body)
}

const createSchema = z.object({
  title:          z.string().min(3).max(500),
  description:    z.string().min(1),
  demand_type_id: z.string().uuid(),
  payload:        z.record(z.unknown()).optional().default({}),
  assignee_id:    z.string().uuid().nullable().optional(),
  interval_days:  z.coerce.number().int().min(1).max(365),
  next_run_at:    z.string().datetime({ offset: true }),
})

const updateSchema = createSchema.partial().omit({ demand_type_id: true })

export async function list(req, res) {
  try {
    return res.json(await svc.listTemplates(req.user))
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createTemplate(req.user, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.updateTemplate(req.user, req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function archive(req, res) {
  try {
    await svc.archiveTemplate(req.user, req.params.id)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}
