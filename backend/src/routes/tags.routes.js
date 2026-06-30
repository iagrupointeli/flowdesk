import { Router }      from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/tags.controller.js'

const router = Router()

router.use(authenticate)
router.use(authorize('super_admin', 'dept_admin', 'user'))

// GET  /api/tags?department_id=uuid  — lista tags (todos os roles)
router.get('/', ctrl.list)

// POST /api/tags                     — cria tag (admin only — service valida)
router.post('/', ctrl.create)

// DELETE /api/tags/:tagId            — remove tag (admin only — service valida)
router.delete('/:tagId', ctrl.remove)

export default router
