import { Router }    from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/portfolios.controller.js'

const router = Router()
router.use(authenticate)
router.use(authorize('super_admin', 'dept_admin'))

router.get('/',               ctrl.list)
router.get('/:clientName',    ctrl.detail)

export default router
