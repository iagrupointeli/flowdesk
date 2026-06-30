import { Router }        from 'express'
import { authenticate }   from '#middlewares/authenticate.js'
import { authorize }      from '#middlewares/authorize.js'
import * as ctrl          from '#controllers/demands.controller.js'
import * as chkCtrl       from '#controllers/checklists.controller.js'
import * as tagsCtrl      from '#controllers/tags.controller.js'
import * as extCtrl       from '#controllers/external.controller.js'

const router = Router()

// Todas as rotas exigem autenticação
router.use(authenticate)

// ── Demandas ──────────────────────────────────────────────────────────────────
router.get (  '/',                     authorize('super_admin', 'dept_admin', 'user'), ctrl.list)
router.post(  '/',                     authorize('super_admin', 'dept_admin', 'user'), ctrl.create)
// ATENÇÃO: /export/csv ANTES de /:id para não ser capturado como param UUID
router.get (  '/export/csv',           authorize('super_admin', 'dept_admin', 'user'), ctrl.exportCsv)
// Movimentação em lote (admins)
router.patch('/batch-stage', authorize('super_admin', 'dept_admin'), ctrl.batchMoveStage)
router.get (  '/:id',                  authorize('super_admin', 'dept_admin', 'user'), ctrl.getOne)

// Movimentação de etapa (admins + assignee — RBAC granular no service)
router.patch( '/:id/stage',            authorize('super_admin', 'dept_admin', 'user'), ctrl.moveStage)

// Exceção (apenas admins)
router.patch( '/:id/exception',        authorize('super_admin', 'dept_admin'), ctrl.setException)

// Comentários (todos os roles)
router.post(  '/:id/comments',         authorize('super_admin', 'dept_admin', 'user'), ctrl.addComment)

// Anexos
router.get (  '/:id/attachments',      authorize('super_admin', 'dept_admin', 'user'), ctrl.listAttachments)
router.post(  '/:id/attachments',      authorize('super_admin', 'dept_admin', 'user'), ctrl.uploadAttachment)

// Usuários mencionáveis (para @mentions no CommentBox)
router.get (  '/:id/mentionable-users', authorize('super_admin', 'dept_admin', 'user'), ctrl.mentionableUsers)

// Colaboradores (seguidores cross-department) — todos os roles com acesso à demanda
// /collaborator-candidates ANTES de /collaborators/:userId (rota literal vs param)
router.get (  '/:id/collaborator-candidates', authorize('super_admin', 'dept_admin', 'user'), ctrl.collaboratorCandidates)
router.get (  '/:id/collaborators',           authorize('super_admin', 'dept_admin', 'user'), ctrl.listCollaborators)
router.post(  '/:id/collaborators',           authorize('super_admin', 'dept_admin', 'user'), ctrl.addCollaborator)
router.delete('/:id/collaborators/:userId',   authorize('super_admin', 'dept_admin', 'user'), ctrl.removeCollaborator)

// Relatório de Checking em PDF (evidências kind='checking')
router.get (  '/:id/checking-report',  authorize('super_admin', 'dept_admin', 'user'), ctrl.checkingReport)

// Exportação ZIP das provas de exibição (PoP)
router.get (  '/:id/checking-zip',     authorize('super_admin', 'dept_admin', 'user'), ctrl.checkingZip)

// Links externos (portal do prestador) — gestão autenticada
router.get (  '/:id/external-links',          authorize('super_admin', 'dept_admin', 'user'), extCtrl.listLinks)
router.post(  '/:id/external-links',          authorize('super_admin', 'dept_admin', 'user'), extCtrl.createLink)
router.delete('/:id/external-links/:linkId',  authorize('super_admin', 'dept_admin', 'user'), extCtrl.revokeLink)

// Timeline (cursor-based)
router.get (  '/:id/timeline',         authorize('super_admin', 'dept_admin', 'user'), ctrl.getTimeline)

// SLA
router.get (  '/:id/sla',              authorize('super_admin', 'dept_admin', 'user'), ctrl.getSla)

// ── Checklists ────────────────────────────────────────────────────────────────
router.get (  '/:id/checklists',           authorize('super_admin', 'dept_admin', 'user'), chkCtrl.list)
router.post(  '/:id/checklists',           authorize('super_admin', 'dept_admin', 'user'), chkCtrl.create)
router.patch( '/:id/checklists/:itemId',   authorize('super_admin', 'dept_admin', 'user'), chkCtrl.update)
router.delete('/:id/checklists/:itemId',   authorize('super_admin', 'dept_admin', 'user'), chkCtrl.remove)

// Tags da demanda (todos os roles com escopo de departamento)
router.post(  '/:id/tags',          authorize('super_admin', 'dept_admin', 'user'), tagsCtrl.addToDemand)
router.delete('/:id/tags/:tagId',   authorize('super_admin', 'dept_admin', 'user'), tagsCtrl.removeFromDemand)

// Download de anexo (por attachment UUID)
router.get (  '/attachments/:attachmentId/download',
              authorize('super_admin', 'dept_admin', 'user'), ctrl.downloadAttachment)

export default router
