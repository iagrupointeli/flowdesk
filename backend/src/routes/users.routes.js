import { Router } from 'express'
import { authenticate }  from '#middlewares/authenticate.js'
import { authorize }     from '#middlewares/authorize.js'
import * as usersCtrl    from '#controllers/users.controller.js'

const router = Router()

// ── Perfil do próprio usuário ─────────────────────────────────────────────────
// /me e /me/notifications DEVEM ser declarados ANTES de /:id para evitar
// que Express interprete "me" como um UUID.

router.get('/me',                  authenticate,                                     usersCtrl.getMe)
router.get('/search',              authenticate,                                     usersCtrl.search)
router.patch('/me/notifications',  authenticate,                                     usersCtrl.updateMe)
router.patch('/me/password',       authenticate,                                     usersCtrl.changePassword)

// ── Perfil público de terceiros (ex: clicar num nome no chat) ────────────────
// Qualquer usuário autenticado pode ver — não é gestão admin, por isso sem
// authorize() aqui. Precisa vir antes das rotas /:id de baixo (mesmo método
// GET, então a ordem de declaração decide).
router.get('/:id',                 authenticate,                                     usersCtrl.getPublicProfile)

// ── Gestão de usuários (admin) ────────────────────────────────────────────────

router.get(
  '/',
  authenticate, authorize('super_admin', 'dept_admin'),
  usersCtrl.list
)
router.post(
  '/',
  authenticate, authorize('super_admin', 'dept_admin'),
  usersCtrl.create
)

// PATCH /status ANTES de PATCH /:id para que "status" não seja interpretado como :id
router.patch(
  '/:id/status',
  authenticate, authorize('super_admin', 'dept_admin'),
  usersCtrl.setActive
)
router.patch(
  '/:id',
  authenticate, authorize('super_admin', 'dept_admin'),
  usersCtrl.update
)
router.post(
  '/:id/reset-password',
  authenticate, authorize('super_admin', 'dept_admin'),
  usersCtrl.resetPassword
)
router.delete(
  '/:id',
  authenticate, authorize('super_admin', 'dept_admin'),
  usersCtrl.deactivate
)

export default router
