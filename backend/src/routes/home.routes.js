import { Router }        from 'express'
import { authenticate }  from '#middlewares/authenticate.js'
import * as ctrl         from '#controllers/home.controller.js'

const router = Router()
router.use(authenticate)

router.get ('/',          ctrl.getLayout)
router.post('/favorite',  ctrl.favorite)
router.post('/reorder',   ctrl.reorder)

export default router
