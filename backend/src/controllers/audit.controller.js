import { z }                from 'zod'
import * as auditService   from '#services/audit.service.js'

const EVENT_TYPES = ['created', 'stage_changed', 'exception_changed', 'assignee_changed']

const querySchema = z.object({
  department_id: z.string().uuid().optional(),
  actor_id:      z.string().uuid().optional(),
  event_type:    z.enum(EVENT_TYPES).optional(),
  date_from:     z.string().datetime({ offset: true }).optional(),
  date_to:       z.string().datetime({ offset: true }).optional(),
  page:          z.coerce.number().int().min(1).default(1),
  per_page:      z.coerce.number().int().min(1).max(100).default(20),
})

export async function listEvents(req, res, next) {
  try {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message })
    }

    const { page, per_page, ...rest } = parsed.data
    const result = await auditService.listAuditEvents(req.user, { ...rest, page, perPage: per_page })
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function listActors(req, res, next) {
  try {
    const actors = await auditService.listAuditActors(req.user)
    res.json(actors)
  } catch (err) {
    next(err)
  }
}
