import { z } from 'zod'
import * as svc from '#services/demands.service.js'

// ── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  title:          z.string().min(3).max(500),
  description:    z.string().min(1),
  demand_type_id: z.string().uuid(),
  payload:        z.record(z.unknown()).optional().default({}),
  asset_id:       z.string().uuid().nullable().optional(),
})

const moveStageSchema = z.object({
  stage_id:    z.string().uuid(),
  assignee_id: z.string().uuid().nullable().optional(),
  notes:       z.string().max(2000).optional(),
})

const exceptionSchema = z.object({
  exception_state: z.enum(['on_hold', 'cancelled']).nullable(),
  notes:           z.string().max(2000).optional(),
})

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
})

const collaboratorSchema = z.object({
  user_id: z.string().uuid(),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function handleError(err, res) {
  if (err.fieldErrors) {
    return res.status(422).json({ error: err.message, fieldErrors: err.fieldErrors })
  }
  return res.status(err.status ?? 500).json({ error: err.message })
}

// ── Controllers ───────────────────────────────────────────────────────────────

export async function list(req, res) {
  try {
    const result = await svc.listDemands(req.user, req.query)
    return res.json(result)
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createDemand(req.user, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function getOne(req, res) {
  try {
    return res.json(await svc.getDemand(req.user, req.params.id))
  } catch (err) { return handleError(err, res) }
}

export async function moveStage(req, res) {
  const parsed = moveStageSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.moveStage(req.user, req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function setException(req, res) {
  const parsed = exceptionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.setException(req.user, req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function addComment(req, res) {
  const parsed = commentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.addComment(req.user, req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function uploadAttachment(req, res) {
  // busboy lida com o multipart — não usa express.json() aqui
  try {
    const attachment = await svc.uploadAttachment(req.user, req.params.id, req)
    return res.status(201).json(attachment)
  } catch (err) { return handleError(err, res) }
}

export async function getTimeline(req, res) {
  const { cursor } = req.query
  try {
    return res.json(await svc.getTimeline(req.user, req.params.id, cursor))
  } catch (err) { return handleError(err, res) }
}

export async function getSla(req, res) {
  try {
    return res.json(await svc.getSla(req.user, req.params.id))
  } catch (err) { return handleError(err, res) }
}

export async function downloadAttachment(req, res) {
  try {
    return res.json(await svc.getDownloadUrl(req.user, req.params.attachmentId))
  } catch (err) { return handleError(err, res) }
}

export async function listAttachments(req, res) {
  try {
    const kind = ['generic', 'checking', 'creative'].includes(req.query.kind)
      ? req.query.kind : undefined
    return res.json(await svc.listAttachments(req.user, req.params.id, { kind }))
  } catch (err) { return handleError(err, res) }
}

export async function mentionableUsers(req, res) {
  try {
    return res.json(await svc.getMentionableUsers(req.user, req.params.id))
  } catch (err) { return handleError(err, res) }
}

// ── Colaboradores ─────────────────────────────────────────────────────────────

export async function listCollaborators(req, res) {
  try {
    return res.json(await svc.listCollaborators(req.user, req.params.id))
  } catch (err) { return handleError(err, res) }
}

export async function collaboratorCandidates(req, res) {
  try {
    return res.json(await svc.searchCollaboratorCandidates(req.user, req.params.id, req.query.q))
  } catch (err) { return handleError(err, res) }
}

export async function addCollaborator(req, res) {
  const parsed = collaboratorSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.addCollaborator(req.user, req.params.id, parsed.data.user_id))
  } catch (err) { return handleError(err, res) }
}

export async function removeCollaborator(req, res) {
  try {
    await svc.removeCollaborator(req.user, req.params.id, req.params.userId)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}

// ── Ações em Lote ─────────────────────────────────────────────────────────────

const batchStageSchema = z.object({
  demand_ids:  z.array(z.string().uuid()).min(1).max(100),
  stage_id:    z.string().uuid(),
  assignee_id: z.string().uuid().nullable().optional(),
  notes:       z.string().max(2000).optional(),
})

export async function batchMoveStage(req, res) {
  const parsed = batchStageSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    const { demand_ids, ...stageData } = parsed.data
    return res.json(await svc.batchMoveStage(req.user, demand_ids, stageData))
  } catch (err) { return handleError(err, res) }
}

// ── Exportação ZIP de Checking ────────────────────────────────────────────────

export async function checkingZip(req, res) {
  try {
    await svc.exportCheckingZip(req.user, req.params.id, res)
  } catch (err) {
    if (res.headersSent) return res.end()
    return handleError(err, res)
  }
}

// ── Relatório de Checking (PDF) ───────────────────────────────────────────────

export async function checkingReport(req, res) {
  try {
    const { generateCheckingReport } = await import('#services/checking.service.js')
    await generateCheckingReport(req.user, req.params.id, res)
  } catch (err) {
    // Se o PDF já começou a ser transmitido, não há como enviar JSON de erro
    if (res.headersSent) return res.end()
    return handleError(err, res)
  }
}

// ── Exportação CSV ────────────────────────────────────────────────────────────

const EXCEPTION_PT = { on_hold: 'Pausada', cancelled: 'Cancelada' }

function csvEscape(val) {
  if (val == null) return '""'
  const s = String(val).replace(/"/g, '""')
  return `"${s}"`
}

function formatDatePt(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

export async function exportCsv(req, res, next) {
  try {
    const rows = await svc.exportDemands(req.user, req.query)

    const headers = [
      'ID', 'Título', 'Tipo de Demanda', 'Departamento', 'Etapa Atual',
      'Finalizada', 'Responsável', 'Solicitante', 'Exceção',
      'Prazo', 'Criada em', 'Atualizada em',
    ]

    const lines = [headers.map(csvEscape).join(',')]

    for (const r of rows) {
      lines.push([
        csvEscape(r.id),
        csvEscape(r.title),
        csvEscape(r.demand_type_name),
        csvEscape(r.department_name),
        csvEscape(r.current_stage_name),
        csvEscape(r.is_final ? 'Sim' : 'Não'),
        csvEscape(r.assignee_name),
        csvEscape(r.requester_name),
        csvEscape(r.exception_state ? (EXCEPTION_PT[r.exception_state] ?? r.exception_state) : ''),
        csvEscape(r.due_date ? formatDatePt(r.due_date) : ''),
        csvEscape(formatDatePt(r.created_at)),
        csvEscape(formatDatePt(r.updated_at)),
      ].join(','))
    }

    const today  = new Date().toISOString().slice(0, 10)
    const csv    = '﻿' + lines.join('\r\n') // UTF-8 BOM para Excel

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="demandas-${today}.csv"`)
    res.send(csv)
  } catch (err) {
    next(err)
  }
}
