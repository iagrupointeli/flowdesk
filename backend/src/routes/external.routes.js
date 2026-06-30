import { Router } from 'express'
import * as ctrl  from '#controllers/external.controller.js'

/**
 * Rotas PÚBLICAS do portal do prestador — sem authenticate.
 * A segurança vem do token opaco de 256 bits (hash no banco, expirável,
 * revogável) + rate limiter em memória contra enumeração.
 */
const router = Router()

// ── Rate limiter simples em memória ──────────────────────────────────────────
// 30 requisições/minuto por IP. Token de 256 bits torna brute-force
// matematicamente inviável; o limiter protege contra abuso/scraping casual.
const WINDOW_MS  = 60_000
const MAX_PER_IP = 30
const hits = new Map()   // ip → { count, windowStart }

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [ip, rec] of hits) {
    if (rec.windowStart < cutoff) hits.delete(ip)
  }
}, WINDOW_MS).unref()

function rateLimit(req, res, next) {
  const ip  = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
  const now = Date.now()
  const rec = hits.get(ip)

  if (!rec || now - rec.windowStart >= WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now })
    return next()
  }
  if (++rec.count > MAX_PER_IP) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' })
  }
  next()
}

router.use(rateLimit)

router.get( '/:token',          ctrl.view)
router.get( '/:token/photos',   ctrl.photos)
router.post('/:token/photos',   ctrl.uploadPhoto)
router.post('/:token/complete', ctrl.complete)

export default router
