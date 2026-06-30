import { Router }      from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import * as svc         from '#services/areas.service.js'

const router = Router()
router.use(authenticate)

router.get('/', async (req, res, next) => {
  try { res.json(await svc.listAreas(req.user.id, req.user.role)) } catch (e) { next(e) }
})

router.post('/', async (req, res, next) => {
  try { res.status(201).json(await svc.createArea(req.user.id, req.body)) } catch (e) { next(e) }
})

router.patch('/:id', async (req, res, next) => {
  try { res.json(await svc.updateArea(req.params.id, req.user.id, req.user.role, req.body)) } catch (e) { next(e) }
})

router.delete('/:id', async (req, res, next) => {
  try { await svc.archiveArea(req.params.id, req.user.id, req.user.role); res.json({ ok: true }) } catch (e) { next(e) }
})

// Tarefas de todos os projetos visíveis na área
router.get('/:id/tasks', async (req, res, next) => {
  try { res.json(await svc.listAreaTasks(req.params.id, req.user.id, req.user.role)) } catch (e) { next(e) }
})

// Membros da área (controla visibilidade de projetos "limited")
router.get('/:id/members', async (req, res, next) => {
  try { res.json(await svc.listAreaMembers(req.params.id)) } catch (e) { next(e) }
})

router.post('/:id/members', async (req, res, next) => {
  try {
    const member = await svc.addAreaMember(req.params.id, req.body.user_id, req.user.id)
    res.status(201).json(member)
  } catch (e) { next(e) }
})

router.delete('/:id/members/:uid', async (req, res, next) => {
  try { await svc.removeAreaMember(req.params.id, req.params.uid); res.status(204).end() } catch (e) { next(e) }
})

export default router
