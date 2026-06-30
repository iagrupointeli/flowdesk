import { Router }       from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/assets.controller.js'

const router = Router()

router.use(authenticate)

// ── Leitura: todos os roles (select de ponto no NewDemand) ───────────────────
router.get('/',                    authorize('super_admin', 'dept_admin', 'user'), ctrl.list)
router.get('/occupancy-grid',      authorize('super_admin', 'dept_admin'),        ctrl.occupancyGrid)
router.get('/idle',                authorize('super_admin', 'dept_admin'),        ctrl.idleAssets)
router.get('/:id/availability',    authorize('super_admin', 'dept_admin', 'user'), ctrl.availability)
router.get('/:id/timeline',        authorize('super_admin', 'dept_admin', 'user'), ctrl.timeline)

// ── Escrita: apenas admins ────────────────────────────────────────────────────
router.post(  '/',        authorize('super_admin', 'dept_admin'), ctrl.create)
router.patch( '/:id',     authorize('super_admin', 'dept_admin'), ctrl.update)
router.post(  '/:id/photo', authorize('super_admin', 'dept_admin'), ctrl.uploadPhoto)
router.delete('/:id',     authorize('super_admin', 'dept_admin'), ctrl.archive)

export default router
