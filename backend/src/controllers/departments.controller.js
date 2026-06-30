import { z } from 'zod'
import * as deptService from '#services/departments.service.js'

const createSchema = z.object({
  name:        z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
})

const updateSchema = z.object({
  name:        z.string().min(2).max(255).optional(),
  description: z.string().max(1000).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

export async function list(_req, res) {
  try {
    return res.json(await deptService.listDepartments())
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

// Endpoint público — usado no formulário de cadastro de colaborador
export async function listPublic(_req, res) {
  try {
    return res.json(await deptService.listDepartments())
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await deptService.createDepartment(parsed.data))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await deptService.updateDepartment(req.params.id, parsed.data))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function archive(req, res) {
  try {
    await deptService.archiveDepartment(req.params.id)
    return res.status(204).end()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function listArchived(_req, res) {
  try {
    return res.json(await deptService.listArchivedDepartments())
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function restore(req, res) {
  try {
    await deptService.restoreDepartment(req.params.id)
    return res.status(204).end()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
