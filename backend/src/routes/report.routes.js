import { Router } from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/report.controller.js'

const router = Router()

router.use(authenticate)
router.use(authorize('super_admin', 'dept_admin'))

// GET /api/reports/monthly → PDF mensal on-demand
router.get('/monthly', ctrl.monthly)

export default router