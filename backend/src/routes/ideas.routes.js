import { Router }        from 'express'
import { authenticate }  from '#middlewares/authenticate.js'
import * as ctrl         from '#controllers/ideas.controller.js'

const router = Router()
router.use(authenticate)

// Qualquer usuário autenticado pode submeter — não é gestão admin.
router.post('/', ctrl.submit)

export default router
