import { query, getClient } from '#config/database.js'
import { hashPassword, verifyPassword, buildFirstAccessToken } from '#services/auth.service.js'
import { randomBytes }  from 'crypto'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Retorna todos os department_ids de um usuário.
 * Usado para validar o escopo do dept_admin antes de mutações.
 */
async function getUserDeptIds(userId) {
  const { rows } = await query(
    'SELECT department_id FROM user_departments WHERE user_id = $1',
    [userId]
  )
  return rows.map(r => r.department_id)
}

/**
 * Valida que o dept_admin só manipula usuários que pertencem
 * EXCLUSIVAMENTE ao seu próprio departamento.
 * Lança 403 se o usuário-alvo tiver vínculo com outros departamentos.
 */
export async function assertDeptAdminScope(actorUser, targetUserId) {
  if (actorUser.role === 'super_admin') return  // sem restrição

  const targetDeptIds = await getUserDeptIds(targetUserId)

  // Usuário sem departamento ou com múltiplos → escopo exclusivo do super_admin
  const isExclusivelyOwned =
    targetDeptIds.length === 1 &&
    actorUser.deptIds.includes(targetDeptIds[0])

  if (!isExclusivelyOwned) {
    throw Object.assign(
      new Error(
        targetDeptIds.length > 1
          ? 'Usuário pertence a múltiplos departamentos. Gestão exclusiva do super_admin.'
          : 'Usuário não pertence ao seu departamento.'
      ),
      { status: 403 }
    )
  }
}

// ─── Listagem ────────────────────────────────────────────────────────────────

/**
 * Lista usuários com filtros opcionais e paginação por offset.
 *
 * @param {Object} actorUser   — usuário autenticado (role, deptIds)
 * @param {Object} opts
 * @param {string}  [opts.q]            — busca ILIKE em name OU email
 * @param {string}  [opts.departmentId] — filtra por departamento específico
 * @param {string}  [opts.status]       — 'active' | 'inactive' | undefined (ambos)
 * @param {string}  [opts.role]         — filtra por role exato
 * @param {number}  [opts.page=1]       — página (1-based)
 * @param {number}  [opts.perPage=20]   — itens por página (máx 100)
 *
 * Retorna: { items, total, page, perPage, hasMore }
 *
 * Escopo:
 *   super_admin → vê todos os usuários
 *   dept_admin  → vê apenas usuários dos seus departamentos
 */
export async function listUsers(actorUser, { q, departmentId, status, role, page = 1, perPage = 20 } = {}) {
  const isAdmin       = actorUser.role === 'super_admin'
  const hasQ          = typeof q === 'string' && q.trim().length > 0
  const hasDeptFilter = typeof departmentId === 'string' && departmentId.length > 0
  const hasStatus     = status === 'active' || status === 'inactive'
  const hasRole       = typeof role === 'string' && role.length > 0
  const safePage      = Math.max(1, parseInt(page, 10) || 1)
  const safePerPage   = Math.min(Math.max(1, parseInt(perPage, 10) || 20), 100)
  const offset        = (safePage - 1) * safePerPage

  // Parâmetros compartilhados entre COUNT e SELECT
  const filterParams = [
    isAdmin,
    actorUser.deptIds,
    hasDeptFilter ? departmentId : null,
    !hasQ,
    hasQ ? q.trim() : '',
    hasStatus ? (status === 'active') : null,   // null = sem filtro de status
    hasRole ? role : null,
  ]

  const WHERE = `
    ($1 OR ud.department_id = ANY($2::uuid[]))
    AND ($3::uuid IS NULL OR ud.department_id = $3::uuid)
    AND ($4 OR u.name ILIKE '%' || $5 || '%' OR u.email ILIKE '%' || $5 || '%')
    AND ($6::boolean IS NULL OR (u.deactivated_at IS NULL) = $6)
    AND ($7::varchar IS NULL OR u.role = $7)
  `

  // Contagem total (sem LIMIT/OFFSET)
  const { rows: countRows } = await query(
    `SELECT COUNT(DISTINCT u.id) AS total
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     WHERE ${WHERE}`,
    filterParams
  )
  const total = parseInt(countRows[0].total, 10)

  // Itens da página
  const { rows } = await query(
    `SELECT
       u.id, u.name, u.email, u.role,
       (u.deactivated_at IS NULL)     AS is_active,
       (u.password_changed_at IS NULL) AS requires_password_change,
       u.deactivated_at, u.created_at,
       COALESCE(
         json_agg(
           json_build_object(
             'department_id', ud.department_id,
             'is_primary',    ud.is_primary
           )
           ORDER BY ud.is_primary DESC
         ) FILTER (WHERE ud.department_id IS NOT NULL),
         '[]'
       ) AS departments
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     WHERE ${WHERE}
     GROUP BY u.id
     ORDER BY u.name
     LIMIT $8 OFFSET $9`,
    [...filterParams, safePerPage, offset]
  )

  return {
    items:   rows,
    total,
    page:    safePage,
    perPage: safePerPage,
    hasMore: offset + rows.length < total,
  }
}

// ─── Criação ────────────────────────────────────────────────────────────────

/**
 * Cria um novo usuário com senha temporária.
 *
 * RBAC:
 *   super_admin → pode criar em qualquer departamento, qualquer role
 *   dept_admin  → apenas no seu próprio departamento (1 dept), não pode criar super_admin
 *
 * Retorna: { user, firstAccessToken }
 *   firstAccessToken: JWT type:'first_access' (TTL 24h) para a troca de senha inicial
 */
export async function createUser(actorUser, data) {
  const { name, email, role, departmentIds, primaryDeptId } = data

  // RBAC: dept_admin não pode criar super_admin
  if (actorUser.role === 'dept_admin' && role === 'super_admin') {
    throw Object.assign(
      new Error('dept_admin não pode criar usuários com papel super_admin.'),
      { status: 403 }
    )
  }

  // RBAC: dept_admin só pode criar usuários no seu próprio departamento
  if (actorUser.role === 'dept_admin') {
    const allowed = departmentIds.every(id => actorUser.deptIds.includes(id))
    if (!allowed || departmentIds.length > 1) {
      throw Object.assign(
        new Error('dept_admin só pode criar usuários no seu próprio departamento.'),
        { status: 403 }
      )
    }
  }

  // Senha temporária aleatória — usuário troca no primeiro acesso
  const tempPassword = randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(tempPassword)

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [name, email.toLowerCase().trim(), passwordHash, role]
    )
    const user = rows[0]

    for (const deptId of departmentIds) {
      await client.query(
        `INSERT INTO user_departments (user_id, department_id, is_primary)
         VALUES ($1, $2, $3)`,
        [user.id, deptId, deptId === primaryDeptId]
      )
    }

    await client.query('COMMIT')

    // Token de primeiro acesso (24h) — gerado após o commit para garantir atomicidade
    const firstAccessToken = buildFirstAccessToken(user.id)
    return { user, firstAccessToken }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Atualização (admin) ─────────────────────────────────────────────────────

/**
 * Atualiza um usuário como administrador.
 * Permite alterar: name, role, departmentIds, primaryDeptId.
 *
 * RBAC:
 *   super_admin → pode editar qualquer usuário, qualquer role
 *   dept_admin  → escopo restrito ao seu departamento; não pode promover a super_admin
 *
 * Nota: para editar apenas name/notify_*, use updateMe (perfil próprio).
 */
export async function updateUserAdmin(actorUser, targetUserId, data) {
  const { name, role, departmentIds, primaryDeptId } = data

  // RBAC: dept_admin não pode promover a super_admin
  if (actorUser.role === 'dept_admin' && role === 'super_admin') {
    throw Object.assign(
      new Error('dept_admin não pode promover usuários a super_admin.'),
      { status: 403 }
    )
  }

  // Valida escopo antes de qualquer mutação
  await assertDeptAdminScope(actorUser, targetUserId)

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           role = COALESCE($2, role),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, email, role`,
      [name ?? null, role ?? null, targetUserId]
    )
    if (!rows[0]) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 })

    // Atualiza departamentos se fornecidos
    if (departmentIds && departmentIds.length > 0) {
      // RBAC: dept_admin não pode atribuir departamentos fora do seu escopo
      if (actorUser.role === 'dept_admin') {
        const allowed = departmentIds.every(id => actorUser.deptIds.includes(id))
        if (!allowed || departmentIds.length > 1) {
          throw Object.assign(
            new Error('dept_admin só pode atribuir usuários ao seu próprio departamento.'),
            { status: 403 }
          )
        }
      }
      await client.query('DELETE FROM user_departments WHERE user_id = $1', [targetUserId])
      for (const deptId of departmentIds) {
        await client.query(
          `INSERT INTO user_departments (user_id, department_id, is_primary) VALUES ($1, $2, $3)`,
          [targetUserId, deptId, deptId === (primaryDeptId ?? departmentIds[0])]
        )
      }
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Ativação / Desativação ──────────────────────────────────────────────────

/**
 * Reativa um usuário previamente desativado.
 *
 * @param {Object} actorUser
 * @param {string} targetUserId
 */
export async function reactivateUser(actorUser, targetUserId) {
  await assertDeptAdminScope(actorUser, targetUserId)

  const { rows } = await query(
    `UPDATE users
     SET deactivated_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deactivated_at IS NOT NULL
     RETURNING id`,
    [targetUserId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('Usuário não encontrado ou já está ativo.'), { status: 404 })
  }
  return { message: 'Usuário reativado com sucesso.' }
}

/**
 * Desativa o usuário e libera todas as demandas atribuídas a ele.
 *
 * A CTE garante atomicidade:
 *   1. Desativa o usuário
 *   2. Libera demandas (current_assignee_id → NULL) via RETURNING
 *   3. Insere em demand_history (event: assignee_changed) usando os dados
 *      retornados pelo RETURNING — sem risco de anomalia de visibilidade.
 *
 * O SLA não é corrompido: cada demanda liberada recebe uma linha de histórico
 * com entered_at = NOW(), o que fecha o intervalo anterior e abre um novo
 * com assignee_id = NULL (fila geral).
 */
export async function deactivateUser(actorUser, targetUserId) {
  await assertDeptAdminScope(actorUser, targetUserId)

  const client = await getClient()
  try {
    await client.query('BEGIN')

    // Passo 1: desativa o usuário
    const { rows: deactivated } = await client.query(
      `UPDATE users
       SET deactivated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deactivated_at IS NULL
       RETURNING id`,
      [targetUserId]
    )
    if (!deactivated[0]) {
      throw Object.assign(new Error('Usuário não encontrado ou já desativado.'), { status: 404 })
    }

    // Passo 2 + 3: libera demandas e registra em demand_history atomicamente
    // RETURNING captura os dados ANTES do UPDATE alterar current_assignee_id,
    // garantindo que o INSERT no histórico tenha os valores corretos.
    // CTE atômica: libera demandas + registra trilha de auditoria no demand_history.
    // RETURNING captura dados ANTES do UPDATE, garantindo valores corretos no INSERT.
    // notes documenta o motivo da remoção automática — visível na timeline da demanda.
    await client.query(
      `WITH freed AS (
         UPDATE demands
         SET current_assignee_id = NULL,
             updated_at = NOW()
         WHERE current_assignee_id = $1
         RETURNING id, current_stage_id, exception_state
       )
       INSERT INTO demand_history
         (demand_id, event_type, actor_id, stage_id, assignee_id, exception_state, notes, entered_at)
       SELECT
         id,
         'assignee_changed',
         $2,
         current_stage_id,
         NULL,
         exception_state,
         'Responsável removido automaticamente devido à inativação da conta.',
         NOW()
       FROM freed`,
      [targetUserId, actorUser.id]
    )

    await client.query('COMMIT')
    return { message: 'Usuário desativado e demandas liberadas para a fila.' }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Reset de senha ──────────────────────────────────────────────────────────

export async function resetPassword(actorUser, targetUserId) {
  await assertDeptAdminScope(actorUser, targetUserId)

  const tempPassword = randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(tempPassword)

  await query(
    `UPDATE users SET password_hash = $1, password_changed_at = NULL, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, targetUserId]
  )

  const firstAccessToken = buildFirstAccessToken(targetUserId)
  return { firstAccessToken }
}

// ─── Perfil próprio ──────────────────────────────────────────────────────────

export async function getMe(userId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.notify_email, u.notify_platform,
            (u.password_changed_at IS NULL) AS requires_password_change,
            COALESCE(
              json_agg(
                json_build_object('id', d.id, 'name', d.name, 'is_primary', ud.is_primary)
                ORDER BY ud.is_primary DESC
              ) FILTER (WHERE d.id IS NOT NULL),
              '[]'
            ) AS departments
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     LEFT JOIN departments d ON d.id = ud.department_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  )
  if (!rows[0]) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 })
  return rows[0]
}

export async function updateMe(userId, data) {
  const { notify_email, notify_platform } = data
  const { rows } = await query(
    `UPDATE users
     SET notify_email = COALESCE($1, notify_email),
         notify_platform = COALESCE($2, notify_platform),
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, notify_email, notify_platform`,
    [notify_email, notify_platform, userId]
  )
  return rows[0]
}

export async function changeOwnPassword(userId, { currentPassword, newPassword }) {
  const { rows } = await query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  )
  if (!rows[0]) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 })

  const valid = await verifyPassword(currentPassword, rows[0].password_hash)
  if (!valid) {
    throw Object.assign(new Error('Senha atual incorreta.'), { status: 422 })
  }

  const newHash = await hashPassword(newPassword)
  await query(
    `UPDATE users
     SET password_hash       = $1,
         password_changed_at = NOW(),
         updated_at          = NOW()
     WHERE id = $2`,
    [newHash, userId]
  )
  return { message: 'Senha alterada com sucesso.' }
}
