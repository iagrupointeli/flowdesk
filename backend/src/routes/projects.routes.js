import { Router }       from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import * as ctrl        from '#controllers/projects.controller.js'

const router = Router()
router.use(authenticate)

// Projetos
router.get('/',    ctrl.list)
router.post('/',   ctrl.create)
router.get('/:id',    ctrl.get)
router.patch('/:id',  ctrl.update)
router.delete('/:id', ctrl.archive)

// Seções (kanban columns)
router.get('/:id/sections',         ctrl.listSections)
router.post('/:id/sections',        ctrl.createSection)
router.patch('/:id/sections/:sid',  ctrl.renameSection)
router.delete('/:id/sections/:sid', ctrl.deleteSection)

// Membros
router.get('/:id/members',        ctrl.listMembers)
router.post('/:id/members',       ctrl.addMember)
router.patch('/:id/members/:uid', ctrl.updateMember)
router.delete('/:id/members/:uid',ctrl.removeMember)

// Tarefas
router.get('/:id/tasks',  ctrl.listTasks)
router.post('/:id/tasks', ctrl.createTask)

export default router
