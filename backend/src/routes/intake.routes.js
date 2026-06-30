import { Router } from 'express'
import * as ctrl  from '#controllers/intake.controller.js'

// Rotas PÚBLICAS — sem authenticate (qualquer um com o token pode acessar)
const router = Router()

router.get ('/:token',        ctrl.getForm)
router.post('/:token/submit', ctrl.submit)

export default router
