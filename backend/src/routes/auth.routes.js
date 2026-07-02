import { Router } from 'express'
import * as authController from '#controllers/auth.controller.js'
import { loginLimiter, registerLimiter, authLimiter } from '#middlewares/rateLimiter.js'

const router = Router()

router.post('/login',        loginLimiter,    authController.login)
router.post('/register',     registerLimiter, authController.register)
router.post('/refresh',      authLimiter,     authController.refresh)
router.post('/logout',       authController.logout)      // limpa cookie httpOnly
router.post('/first-access', authLimiter,     authController.firstAccess)

export default router
