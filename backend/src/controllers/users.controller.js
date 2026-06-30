import { z } from 'zod'
import * as usersService from '#services/users.service.js'

// ── Schemas de validação ──────────────────────────────────────────────────────

const createSchema = z.object({
  name:          z.string().min(2).max(255),
  email:         z.string().email(),
  role:          z.enum(['super_admin', 'dept_admin', 'user']),
  departmentIds: z.array(z.string().uuid()).min(1),
  primaryDeptId: z.string().uuid(),
})

/**
 * Schema de atualização admin — permite alterar role e departamentos.
 * (Diferente de updateMe, que só permite name/notify_*)
 */
const updateAdminSchema = z.object({
  name:          z.string().min(2).max(255).optional(),
  role:          z.enum(['super_admin', 'dept_admin', 'user']).optional(),
  departmentIds: z.array(z.string().uuid()).min(1).optional(),
  primaryDeptId: z.string().uuid().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' })

const notificationsSchema = z.object({
  notify_email:    z.boolean().optional(),
  notify_platform: z.boolean().optional(),
})

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/users
 * Query: q, department_id, status (active|inactive), role, page, per_page
 * Retorna: { items, total, page, perPage, hasMore }
 */
export async function list(req, res) {
  try {
    const { q, department_id, status, role, page, per_page } = req.query
    const result = await usersService.listUsers(req.user, {
      q,
      departmentId: department_id,
      status,
      role,
      page,
      perPage: per_page,
    })
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * POST /api/users
 * Body: { name, email, role, departmentIds, primaryDeptId }
 * Retorna: { user, firstAccessToken }
 */
export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const result = await usersService.createUser(req.user, parsed.data)
    return res.status(201).json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * PATCH /api/users/:id
 * Body: { name?, role?, departmentIds?, primaryDeptId? }
 *
 * Admin-level update — permite alterar role e departamentos (com RBAC).
 */
export async function update(req, res) {
  const parsed = updateAdminSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const user = await usersService.updateUserAdmin(req.user, req.params.id, parsed.data)
    return res.json(user)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * PATCH /api/users/:id/status
 * Body: { active: boolean }
 *
 * Ativa (true) ou desativa (false) um usuário.
 * Desativar libera todas as demandas atribuídas ao usuário.
 */
export async function setActive(req, res) {
  const { active } = req.body
  if (typeof active !== 'boolean') {
    return res.status(422).json({ error: 'Campo "active" (boolean) é obrigatório.' })
  }
  try {
    const result = active
      ? await usersService.reactivateUser(req.user, req.params.id)
      : await usersService.deactivateUser(req.user, req.params.id)
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * POST /api/users/:id/reset-password
 * Retorna: { firstAccessToken }
 */
export async function resetPassword(req, res) {
  try {
    const result = await usersService.resetPassword(req.user, req.params.id)
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * DELETE /api/users/:id  (soft-delete — alias para setActive false)
 * Mantido para compatibilidade com código existente.
 */
export async function deactivate(req, res) {
  try {
    const result = await usersService.deactivateUser(req.user, req.params.id)
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * GET /api/users/search?q=<term>
 */
export async function search(req, res) {
  try {
    const q = (req.query.q ?? '').trim()
    if (q.length < 2) return res.json([])
    const { query } = await import('#config/database.js')
    const { rows } = await query(
      `SELECT id, name, email
       FROM users
       WHERE active = true AND (name ILIKE $1 OR email ILIKE $1)
       ORDER BY name ASC
       LIMIT 20`,
      [`%${q}%`]
    )
    return res.json(rows)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function getMe(req, res) {
  try {
    const user = await usersService.getMe(req.user.id)
    return res.json(user)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * PATCH /api/users/me/notifications
 * Body: { notify_email?, notify_platform? }
 */
export async function updateMe(req, res) {
  const parsed = notificationsSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const result = await usersService.updateMe(req.user.id, parsed.data)
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8, 'A nova senha deve ter ao menos 8 caracteres.'),
})

/**
 * PATCH /api/users/me/password
 * Body: { currentPassword, newPassword }
 */
export async function changePassword(req, res) {
  const parsed = changePasswordSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const result = await usersService.changeOwnPassword(req.user.id, parsed.data)
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
