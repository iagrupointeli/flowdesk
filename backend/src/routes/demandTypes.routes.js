import { Router }        from 'express'
import { authenticate }  from '#middlewares/authenticate.js'
import * as ctrl         from '#controllers/demandTypesPublic.controller.js'

const router = Router()

// Todos os endpoints exigem autenticação (qualquer role)
router.use(authenticate)

// GET /api/demand-types            → lista tipos acessíveis ao usuário
// GET /api/demand-types/:id        → tipo + etapas ativas (para o Kanban)
// GET /api/demand-types/:id/fields → tipo + campos ativos (para /demands/new)
router.get('/',           ctrl.listTypesForBoard)
router.get('/:id/fields', ctrl.getTypeWithFields)   // mais específico antes de /:id
router.get('/:id',        ctrl.getTypeWithStages)

export default router
