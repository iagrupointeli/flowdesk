import { Router }      from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/dashboard.controller.js'

const router = Router()

router.use(authenticate)
router.use(authorize('super_admin', 'dept_admin'))

// GET /api/dashboard          → KPIs + chart data
router.get('/',        ctrl.stats)

// GET /api/dashboard/commercial → Dashboard Comercial por cliente
router.get('/commercial', ctrl.commercial)

// GET /api/dashboard/tv       → Modo TV (painel ao vivo, polling)
router.get('/tv',      ctrl.tv)

// GET /api/dashboard/export   → CSV download
router.get('/export',  ctrl.exportCsv)

export default router
