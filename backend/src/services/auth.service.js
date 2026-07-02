import bcrypt   from 'bcrypt'
import jwt      from 'jsonwebtoken'
import { query, getClient } from '#config/database.js'

const SALT_ROUNDS = 12

// ─── Lockout de login ────────────────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES     = 15

// ─── Helpers de token ────────────────────────────────────────────────────────

function buildAccessToken(user, deptIds, primaryDeptId) {
  return jwt.sign(
    {
      sub:           user.id,
      name:          user.name,
      role:          user.role,
      deptIds,
      primaryDeptId,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES ?? '1h' }
  )
}

function buildRefreshToken(userId) {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES ?? '7d' }
  )
}

/**
 * Token de uso único para primeiro acesso (TTL 24h).
 * Inclui type: 'first_access' para que a rota de troca de senha
 * rejeite access tokens comuns.
 */
export function buildFirstAccessToken(userId) {
  return jwt.sign(
    { sub: userId, type: 'first_access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '24h' }
  )
}

// ─── Serviços ────────────────────────────────────────────────────────────────

/**
 * Hash de senha — sempre assíncrono, nunca bloqueia o Event Loop.
 */
export function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS)
}

/**
 * Comparação de senha — assíncrona para não bloquear o Event Loop.
 */
export function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

/**
 * Login: verifica credenciais e retorna par de tokens.
 */
export async function login(email, password) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.deactivated_at,
            u.password_changed_at, u.failed_login_attempts, u.locked_until,
            COALESCE(
              json_agg(ud.department_id ORDER BY ud.is_primary DESC) FILTER (WHERE ud.department_id IS NOT NULL),
              '[]'
            ) AS dept_ids,
            (SELECT ud2.department_id FROM user_departments ud2
             WHERE ud2.user_id = u.id AND ud2.is_primary = true LIMIT 1) AS primary_dept_id
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     WHERE u.email = $1
     GROUP BY u.id`,
    [email.toLowerCase().trim()]
  )

  const user = rows[0]
  if (!user) throw Object.assign(new Error('Credenciais inválidas.'), { status: 401 })
  if (user.deactivated_at) throw Object.assign(new Error('Conta desativada.'), { status: 403 })

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60_000)
    throw Object.assign(
      new Error(`Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${minutesLeft} min.`),
      { status: 429 }
    )
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    // Incremento atômico — evita race condition sob tentativas concorrentes.
    // Ao atingir o limite, zera o contador e define o bloqueio de uma vez.
    await query(
      `UPDATE users
       SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0
                                         ELSE failed_login_attempts + 1 END,
           locked_until          = CASE WHEN failed_login_attempts + 1 >= $2
                                         THEN NOW() + ($3 || ' minutes')::interval
                                         ELSE locked_until END
       WHERE id = $1`,
      [user.id, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES]
    )
    throw Object.assign(new Error('Credenciais inválidas.'), { status: 401 })
  }

  // Login bem-sucedido: reseta o contador se havia tentativas falhas registradas.
  if (user.failed_login_attempts > 0 || user.locked_until) {
    await query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [user.id]
    )
  }

  const accessToken  = buildAccessToken(user, user.dept_ids, user.primary_dept_id)
  const refreshToken = buildRefreshToken(user.id)

  return {
    accessToken,
    refreshToken,
    user: {
      id:                      user.id,
      name:                    user.name,
      email:                   user.email,
      role:                    user.role,
      // true  = senha nunca foi definida pelo usuário (primeiro acesso pendente)
      // false = usuário já definiu a senha pelo menos uma vez
      requires_password_change: user.password_changed_at === null,
    },
  }
}

/**
 * Renova o access token a partir de um refresh token válido.
 */
export async function refresh(refreshToken) {
  let payload
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
  } catch {
    throw Object.assign(new Error('Refresh token inválido ou expirado.'), { status: 401 })
  }

  if (payload.type !== 'refresh') {
    throw Object.assign(new Error('Token inválido.'), { status: 401 })
  }

  const { rows } = await query(
    `SELECT u.id, u.role, u.deactivated_at,
            COALESCE(
              json_agg(ud.department_id ORDER BY ud.is_primary DESC) FILTER (WHERE ud.department_id IS NOT NULL),
              '[]'
            ) AS dept_ids,
            (SELECT ud2.department_id FROM user_departments ud2
             WHERE ud2.user_id = u.id AND ud2.is_primary = true LIMIT 1) AS primary_dept_id
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [payload.sub]
  )

  const user = rows[0]
  if (!user || user.deactivated_at) {
    throw Object.assign(new Error('Usuário inativo.'), { status: 401 })
  }

  return buildAccessToken(user, user.dept_ids, user.primary_dept_id)
}

/**
 * Auto-cadastro de colaborador.
 * Cria usuário com role 'user' e vincula ao setor primário.
 * password_changed_at = NOW() porque o usuário define a própria senha no ato.
 */
export async function register({ name, email, password, department_id }) {
  const normalizedEmail = email.toLowerCase().trim()

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    )
    if (existing[0]) throw Object.assign(new Error('E-mail já cadastrado.'), { status: 409 })

    const { rows: dept } = await client.query(
      'SELECT id FROM departments WHERE id = $1 AND archived_at IS NULL',
      [department_id]
    )
    if (!dept[0]) throw Object.assign(new Error('Setor não encontrado.'), { status: 404 })

    const hash = await hashPassword(password)

    const { rows: [user] } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, password_changed_at)
       VALUES ($1, $2, $3, 'user', NOW())
       RETURNING id`,
      [name.trim(), normalizedEmail, hash]
    )

    await client.query(
      `INSERT INTO user_departments (user_id, department_id, is_primary)
       VALUES ($1, $2, true)`,
      [user.id, department_id]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Troca de senha no primeiro acesso.
 * Exige token com type === 'first_access'.
 */
export async function firstAccess(token, newPassword) {
  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
  } catch {
    throw Object.assign(new Error('Token inválido ou expirado.'), { status: 401 })
  }

  if (payload.type !== 'first_access') {
    throw Object.assign(new Error('Token não autorizado para esta operação.'), { status: 403 })
  }

  const hash = await hashPassword(newPassword)  // assíncrono

  // password_changed_at = NOW() marca que o usuário já definiu a própria senha.
  // A partir daqui, requires_password_change retornará false no login/getMe.
  await query(
    `UPDATE users
     SET password_hash        = $1,
         password_changed_at  = NOW(),
         updated_at           = NOW()
     WHERE id = $2`,
    [hash, payload.sub]
  )

  return { message: 'Senha definida com sucesso.' }
}
