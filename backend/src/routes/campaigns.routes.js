import { Router }       from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/campaigns.controller.js'

const router = Router()

router.use(authenticate)

// Leitura: todos os roles (Comercial consulta disponibilidade)
router.get('/', authorize('super_admin', 'dept_admin', 'user'), ctrl.list)

// Escrita: apenas admins
router.post(  '/',    authorize('super_admin', 'dept_admin'), ctrl.create)
router.patch( '/:id', authorize('super_admin', 'dept_admin'), ctrl.update)
router.delete('/:id',          authorize('super_admin', 'dept_admin'), ctrl.archive)
router.post  ('/:id/approval', authorize('super_admin', 'dept_admin'), ctrl.approve)

export default router
