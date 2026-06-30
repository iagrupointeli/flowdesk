import { Router } from 'express'
import * as authController from '#controllers/auth.controller.js'

const router = Router()

router.post('/login',        authController.login)
router.post('/register',     authController.register)
router.post('/refresh',      authController.refresh)
router.post('/logout',       authController.logout)      // limpa cookie httpOnly
router.post('/first-access', authController.firstAccess)

export default router
