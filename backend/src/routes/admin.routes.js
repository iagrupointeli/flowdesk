import { Router } from 'express'
import { authenticate }  from '#middlewares/authenticate.js'
import { authorize }     from '#middlewares/authorize.js'
import * as deptsCtrl    from '#controllers/departments.controller.js'
import * as dtCtrl       from '#controllers/demandTypes.controller.js'
import * as whCtrl       from '#controllers/webhooks.controller.js'
import * as auditCtrl    from '#controllers/audit.controller.js'
import { runSlaCheck }   from '#services/sla.service.js'
import * as recCtrl      from '#controllers/recurring.controller.js'
import * as snCtrl       from '#controllers/stageNotifications.controller.js'
import * as snSvc        from '#services/stageNotifications.service.js'
import * as adCtrl       from '#controllers/assetDocuments.controller.js'
import * as assetSvc     from '#services/assets.service.js'
import * as intakeSvc    from '#services/intake.service.js'
import { runScoutdoorSync, syncStatus } from '#services/scoutdoor.scraper.js'

const router = Router()

// Todos os endpoints admin exigem autenticação
router.use(authenticate)

// ── Departamentos (apenas super_admin cria/edita/arquiva) ───────────────────
// ATENÇÃO: /departments/archived DEVE vir ANTES de /:id para não ser capturado como param
router.get(  '/departments',              authorize('super_admin', 'dept_admin'), deptsCtrl.list)
router.get(  '/departments/archived',     authorize('super_admin'),               deptsCtrl.listArchived)
router.post( '/departments',              authorize('super_admin'),               deptsCtrl.create)
router.patch('/departments/:id',          authorize('super_admin'),               deptsCtrl.update)
router.post( '/departments/:id/archive',  authorize('super_admin'),               deptsCtrl.archive)
router.post( '/departments/:id/restore',  authorize('super_admin'),               deptsCtrl.restore)

// ── Tipos de demanda ─────────────────────────────────────────────────────────
router.get (  '/demand-types',              authorize('super_admin', 'dept_admin'), dtCtrl.listTypes)
router.post(  '/demand-types',              authorize('super_admin', 'dept_admin'), dtCtrl.createType)
router.patch( '/demand-types/:id',          authorize('super_admin', 'dept_admin'), dtCtrl.updateType)
router.post(  '/demand-types/:id/archive',  authorize('super_admin', 'dept_admin'), dtCtrl.archiveType)
router.post(  '/demand-types/:id/restore',  authorize('super_admin', 'dept_admin'), dtCtrl.restoreType)
router.delete('/demand-types/:id',          authorize('super_admin'),               dtCtrl.deleteType)

// ── Campos dinâmicos ─────────────────────────────────────────────────────────
// ATENÇÃO: /reorder DEVE vir ANTES de /:fieldId para evitar que Express
// capture a string literal "reorder" como um UUID de fieldId.
router.get (  '/demand-types/:typeId/fields',          authorize('super_admin', 'dept_admin'), dtCtrl.listFields)
router.post(  '/demand-types/:typeId/fields',          authorize('super_admin', 'dept_admin'), dtCtrl.createField)
router.patch( '/demand-types/:typeId/fields/reorder',  authorize('super_admin', 'dept_admin'), dtCtrl.reorderFields)
router.patch( '/demand-types/:typeId/fields/:fieldId', authorize('super_admin', 'dept_admin'), dtCtrl.updateField)
router.delete('/demand-types/:typeId/fields/:fieldId', authorize('super_admin', 'dept_admin'), dtCtrl.archiveField)

// ── Etapas do workflow ───────────────────────────────────────────────────────
router.get (  '/demand-types/:typeId/stages',                    authorize('super_admin', 'dept_admin'), dtCtrl.listStages)
router.post(  '/demand-types/:typeId/stages',                    authorize('super_admin', 'dept_admin'), dtCtrl.createStage)
router.patch( '/demand-types/:typeId/stages/reorder',            authorize('super_admin', 'dept_admin'), dtCtrl.reorderStages)
router.patch( '/demand-types/:typeId/stages/:stageId',           authorize('super_admin', 'dept_admin'), dtCtrl.updateStage)
router.post(  '/demand-types/:typeId/stages/:stageId/archive',   authorize('super_admin', 'dept_admin'), dtCtrl.archiveStage)

// ── Webhooks ─────────────────────────────────────────────────────────────────
// ATENÇÃO: /webhooks/:id/test DEVE vir ANTES de /webhooks/:id para evitar que
// Express capture a string literal "test" como um UUID de id.
router.get(   '/webhooks',              authorize('super_admin', 'dept_admin'), whCtrl.list)
router.post(  '/webhooks',              authorize('super_admin', 'dept_admin'), whCtrl.create)
router.post(  '/webhooks/:id/test',     authorize('super_admin', 'dept_admin'), whCtrl.test)
router.patch( '/webhooks/:id',          authorize('super_admin', 'dept_admin'), whCtrl.update)
router.delete('/webhooks/:id',          authorize('super_admin', 'dept_admin'), whCtrl.remove)

// ── Audit log ────────────────────────────────────────────────────────────────
router.get('/audit',        authorize('super_admin', 'dept_admin'), auditCtrl.listEvents)
router.get('/audit/actors', authorize('super_admin', 'dept_admin'), auditCtrl.listActors)

// ── Demandas recorrentes ─────────────────────────────────────────────────────
router.get(   '/recurring',     authorize('super_admin', 'dept_admin'), recCtrl.list)
router.post(  '/recurring',     authorize('super_admin', 'dept_admin'), recCtrl.create)
router.patch( '/recurring/:id', authorize('super_admin', 'dept_admin'), recCtrl.update)
router.delete('/recurring/:id', authorize('super_admin', 'dept_admin'), recCtrl.archive)

// ── Automações de etapa ───────────────────────────────────────────────────────
router.get(   '/stage-notifications/:stageId', authorize('super_admin', 'dept_admin'), async (req, res, next) => {
  try {
    const rule = await snSvc.getByStage(req.params.stageId)
    res.json(rule ?? null)
  } catch (err) { next(err) }
})
router.put   ('/stage-notifications/:stageId', authorize('super_admin', 'dept_admin'), snCtrl.upsert)
router.delete('/stage-notifications/:stageId', authorize('super_admin', 'dept_admin'), snCtrl.remove)

// ── Documentos de pontos OOH (alvarás, contratos, etc.) ─────────────────────
router.get   ('/assets/:assetId/documents',            authorize('super_admin', 'dept_admin'), adCtrl.list)
router.post  ('/assets/:assetId/documents',            authorize('super_admin', 'dept_admin'), adCtrl.create)
router.patch ('/assets/:assetId/documents/:docId',     authorize('super_admin', 'dept_admin'), adCtrl.update)
router.delete('/assets/:assetId/documents/:docId',     authorize('super_admin', 'dept_admin'), adCtrl.remove)

// ── Ciclo de vida dos pontos OOH ─────────────────────────────────────────────
router.get   ('/assets/:assetId/lifecycle',         authorize('super_admin', 'dept_admin'), async (req, res, next) => {
  try { res.json(await assetSvc.listLifecycleLogs(req.params.assetId)) } catch (err) { next(err) }
})
router.post  ('/assets/:assetId/lifecycle',         authorize('super_admin', 'dept_admin'), async (req, res, next) => {
  try {
    const { event_type, description, performed_at, next_date } = req.body
    if (!event_type || !description?.trim() || !performed_at)
      return res.status(422).json({ error: 'event_type, description e performed_at são obrigatórios.' })
    res.status(201).json(await assetSvc.createLifecycleLog(req.params.assetId, req.user.id, { event_type, description: description.trim(), performed_at, next_date }))
  } catch (err) { next(err) }
})
router.delete('/assets/:assetId/lifecycle/:logId',  authorize('super_admin', 'dept_admin'), async (req, res, next) => {
  try { await assetSvc.deleteLifecycleLog(req.params.logId); res.status(204).end() } catch (err) { next(err) }
})

// ── Intake links — links públicos para criação de demandas sem login ──────────
router.get   ('/demand-types/:typeId/intake-links', authorize('super_admin', 'dept_admin'), async (req, res) => {
  try {
    return res.json(await intakeSvc.listIntakeLinks(req.params.typeId))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
})

router.post  ('/demand-types/:typeId/intake-links', authorize('super_admin', 'dept_admin'), async (req, res) => {
  try {
    const { label, expires_at } = req.body
    if (!label?.trim()) return res.status(422).json({ error: 'label é obrigatório.' })
    return res.status(201).json(await intakeSvc.createIntakeLink(req.user, req.params.typeId, { label, expires_at }))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
})

router.delete('/intake-links/:linkId', authorize('super_admin', 'dept_admin'), async (req, res) => {
  try {
    await intakeSvc.deleteIntakeLink(req.params.linkId)
    return res.status(204).end()
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
})

// ── Sincronização Scoutdoor ───────────────────────────────────────────────────
router.post('/assets/sync-scoutdoor', authorize('super_admin'), async (req, res) => {
  const result = await runScoutdoorSync()
  if (result.already) return res.status(409).json({ error: 'Sync já está em execução.' })
  res.status(202).json({ message: 'Sync iniciado.' })
})

router.get('/assets/sync-scoutdoor/status', authorize('super_admin'), (_req, res) => {
  res.json(syncStatus)
})

// ── SLA check manual ─────────────────────────────────────────────────────────
router.post('/sla-check', authorize('super_admin'), async (req, res, next) => {
  try {
    const result = await runSlaCheck()
    res.json(result)
  } catch (err) { next(err) }
})

export default router
