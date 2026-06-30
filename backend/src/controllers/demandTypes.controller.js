import { z } from 'zod'
import * as svc from '#services/demandTypes.service.js'

// ── Schemas ──────────────────────────────────────────────────────────────────

const demandTypeCreateSchema = z.object({
  name:          z.string().min(2).max(255),
  description:   z.string().max(2000).optional(),
  sla_hours:     z.number().int().positive().optional(),
  department_id: z.string().uuid(),
})

const demandTypeUpdateSchema = z.object({
  name:        z.string().min(2).max(255).optional(),
  description: z.string().max(2000).optional(),
  // null = remover SLA; número positivo = definir/atualizar; ausente = não alterar
  sla_hours:   z.number().int().positive().nullable().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

const fieldCreateSchema = z.object({
  label:         z.string().min(1).max(255),
  // 'textarea' adicionado na migration 013 ao CHECK constraint do banco
  field_type:    z.enum(['text', 'textarea', 'number', 'date', 'select', 'cpf']),
  required:      z.boolean().optional(),
  options:       z.array(z.object({ id: z.string().uuid(), label: z.string() })).optional(),
  display_order: z.number().int().optional(),
})

const fieldUpdateSchema = z.object({
  label:         z.string().min(1).max(255).optional(),
  // field_type intencionalmente ausente — tentativa de envio será detectada no service
  required:      z.boolean().optional(),
  options:       z.array(z.object({ id: z.string().uuid(), label: z.string() })).optional(),
  display_order: z.number().int().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

const stageCreateSchema = z.object({
  name:                z.string().min(1).max(255),
  display_order:       z.number().int().optional(),
  is_final:            z.boolean().optional(),
  requires_note:       z.boolean().optional(),
  requires_assignee:   z.boolean().optional(),
  requires_attachment: z.boolean().optional(),
  wip_limit:           z.number().int().positive().nullable().optional(),
})

const stageUpdateSchema = stageCreateSchema.partial()
  .refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
})

// ── Demand Types ─────────────────────────────────────────────────────────────

export async function listTypes(req, res) {
  try { return res.json(await svc.listDemandTypes(req.user)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function createType(req, res) {
  const parsed = demandTypeCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try { return res.status(201).json(await svc.createDemandType(req.user, parsed.data)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function updateType(req, res) {
  const parsed = demandTypeUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try { return res.json(await svc.updateDemandType(req.user, req.params.id, parsed.data)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function archiveType(req, res) {
  try {
    return res.json(await svc.archiveDemandType(req.user, req.params.id))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function restoreType(req, res) {
  try {
    await svc.restoreDemandType(req.user, req.params.id)
    return res.status(204).end()
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function deleteType(req, res) {
  try {
    await svc.deleteDemandType(req.user, req.params.id)
    return res.status(204).end()
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

// ── Fields ───────────────────────────────────────────────────────────────────

export async function listFields(req, res) {
  try {
    const fields = await svc.getFields(req.params.typeId, { activeOnly: false })
    return res.json(fields)
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function createField(req, res) {
  const parsed = fieldCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(
      await svc.createField(req.user, req.params.typeId, parsed.data)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function updateField(req, res) {
  // Rejeita field_type explicitamente antes do schema — mensagem clara para o cliente
  if (req.body.field_type !== undefined) {
    return res.status(422).json({
      error: 'field_type é imutável após criação. Arquive este campo e crie um novo para alterar o tipo.',
    })
  }
  const parsed = fieldUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(
      await svc.updateField(req.user, req.params.typeId, req.params.fieldId, parsed.data)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function archiveField(req, res) {
  try {
    return res.json(
      await svc.archiveField(req.user, req.params.typeId, req.params.fieldId)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function reorderFields(req, res) {
  const parsed = reorderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    await svc.reorderFields(req.user, req.params.typeId, parsed.data.orderedIds)
    return res.json({ message: 'Campos reordenados.' })
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

// ── Workflow Stages ──────────────────────────────────────────────────────────

export async function listStages(req, res) {
  try { return res.json(await svc.listStages(req.user, req.params.typeId)) }
  catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function createStage(req, res) {
  const parsed = stageCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(
      await svc.createStage(req.user, req.params.typeId, parsed.data)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function updateStage(req, res) {
  const parsed = stageUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(
      await svc.updateStage(req.user, req.params.typeId, req.params.stageId, parsed.data)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function reorderStages(req, res) {
  const parsed = reorderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    await svc.reorderStages(req.user, req.params.typeId, parsed.data.orderedIds)
    return res.json({ message: 'Etapas reordenadas.' })
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}

export async function archiveStage(req, res) {
  try {
    return res.json(
      await svc.archiveStage(req.user, req.params.typeId, req.params.stageId)
    )
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
}
