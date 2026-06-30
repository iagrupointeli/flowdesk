import { Router } from 'express'
import * as deptsCtrl from '#controllers/departments.controller.js'

const router = Router()

// GET /api/departments — público, sem autenticação, apenas setores ativos
// Usado no formulário de cadastro de colaborador
router.get('/', deptsCtrl.listPublic)

export default router
