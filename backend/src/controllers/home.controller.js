import { z } from 'zod'
import * as homeService from '#services/home.service.js'

// GET /api/home
export async function getLayout(req, res) {
  try {
    const layout = await homeService.getHomeLayout(req.user.id)
    return res.json(layout)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

const favoriteSchema = z.object({
  key:       z.string().min(1),
  favorited: z.boolean(),
})

// POST /api/home/favorite
export async function favorite(req, res) {
  const parsed = favoriteSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    await homeService.toggleFavorite(req.user.id, parsed.data.key, parsed.data.favorited)
    return res.status(204).send()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

const reorderSchema = z.object({
  orderedKeys: z.array(z.string().min(1)).min(1),
})

// POST /api/home/reorder
export async function reorder(req, res) {
  const parsed = reorderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    await homeService.saveLayout(req.user.id, parsed.data.orderedKeys)
    return res.status(204).send()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
