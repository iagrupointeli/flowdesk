import { z } from 'zod'
import * as ideasService from '#services/ideas.service.js'

const submitSchema = z.object({
  title: z.string().min(3).max(200),
  notes: z.string().max(2000).optional(),
})

// POST /api/ideas
export async function submit(req, res) {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const task = await ideasService.submitIdea(req.user.id, parsed.data)
    return res.status(201).json(task)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
