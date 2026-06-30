import { Router }      from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/notifications.controller.js'

const router = Router()

/**
 * CRÍTICO — ordem das rotas:
 *   /ticket     deve ser declarado ANTES de /stream e /:id/read
 *   /stream     deve ser declarado ANTES de /:id/read
 *   /read-all   deve ser declarado ANTES de /:id/read
 *   Caso contrário, Express interpretaria os segmentos fixos como :id.
 */

// ── Ticket SSE (curta duração, 15s) ───────────────────────────────────────────
// Requer autenticação via Bearer token — authenticate lê o header Authorization.
// O ticket emitido é passado via ?ticket= na abertura do EventSource.
router.post('/ticket', authenticate, ctrl.issueTicket)

// ── SSE Stream ─────────────────────────────────────────────────────────────────
// SEM authenticate aqui — EventSource não suporta headers customizados.
// A autenticação é feita pelo controller via ?ticket= (vide issueTicket).
router.get('/stream', ctrl.stream)

// ── Demais rotas — autenticação obrigatória ────────────────────────────────────
router.use(authenticate)
router.use(authorize('super_admin', 'dept_admin', 'user'))

router.get('/',             ctrl.list)
router.patch('/read-all',   ctrl.markAllRead)
router.patch('/:id/read',   ctrl.markRead)

export default router
