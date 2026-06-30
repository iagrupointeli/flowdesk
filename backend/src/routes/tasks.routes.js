import { Router }      from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import * as ctrl        from '#controllers/personal_tasks.controller.js'

const router = Router()
router.use(authenticate)

router.get('/',              ctrl.list)
router.post('/',             ctrl.create)
router.patch('/:id',         ctrl.update)
router.patch('/:id/reorder', ctrl.reorder)
router.delete('/:id',        ctrl.archive)

export default router
