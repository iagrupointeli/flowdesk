import { z } from 'zod'
import * as authService from '#services/auth.service.js'

// ── Constantes de cookie ─────────────────────────────────────────────────────
// Centralizadas aqui para manter consistência entre login e logout.
const COOKIE_NAME = 'refreshToken'

/**
 * Opções do cookie de refreshToken.
 *
 * httpOnly  → inacessível via JavaScript (mitiga XSS)
 * secure    → apenas HTTPS em produção
 * sameSite  → 'lax' evita CSRF em cross-site requests mantendo cookies em
 *             navegações diretas (cliques em links)
 * path      → '/api/auth' restringe o cookie ao namespace de autenticação,
 *             evitando que seja enviado em todos os endpoints
 * maxAge    → 7 dias em ms (alinhado com JWT_REFRESH_EXPIRES do .env)
 */
function cookieOpts() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/api/auth',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  }
}

// clearCookie não deve receber maxAge (deprecated no Express 5)
function clearCookieOpts() {
  const { maxAge: _, ...opts } = cookieOpts()
  return opts
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  name:          z.string().min(2, 'Nome deve ter no mínimo 2 caracteres.').max(255),
  email:         z.string().email('E-mail inválido.'),
  password:      z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
  department_id: z.string().uuid('Setor inválido.'),
})

const firstAccessSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
})

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 *
 * Autentica o usuário e retorna:
 *   - Body: { accessToken, user }
 *   - Cookie httpOnly: refreshToken (7 dias)
 *
 * O refreshToken NÃO vai mais no body — cookie httpOnly elimina exposição via JS.
 */
export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const result = await authService.login(parsed.data.email, parsed.data.password)

    // Seta o refreshToken como cookie httpOnly — inacessível pelo frontend JS
    res.cookie(COOKIE_NAME, result.refreshToken, cookieOpts())

    // Retorna apenas accessToken + perfil mínimo do usuário
    // O refreshToken foi movido para o cookie e não deve mais aparecer aqui
    return res.json({
      accessToken: result.accessToken,
      user:        result.user,
    })
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * POST /api/auth/refresh
 *
 * Lê o refreshToken do cookie httpOnly (enviado automaticamente pelo browser
 * com `withCredentials: true` no Axios).
 * Retorna novo accessToken.
 *
 * Guard de loop infinito (setupInterceptors.js):
 *   Se este endpoint retornar 401, o interceptor faz logout imediato — sem retry.
 */
export async function refresh(req, res) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' })
  }

  try {
    const accessToken = await authService.refresh(token)
    return res.json({ accessToken })
  } catch (err) {
    // Token expirado ou inválido → limpa o cookie stale e retorna 401
    res.clearCookie(COOKIE_NAME, clearCookieOpts())
    return res.status(err.status ?? 401).json({ error: err.message })
  }
}

/**
 * POST /api/auth/logout
 *
 * Invalida a sessão no lado do cliente limpando o cookie httpOnly.
 * Não há revogação de token no servidor (stateless JWT) — implementar
 * blocklist na Fase 11 se necessário.
 * Responde 204 mesmo sem cookie ativo (idempotente).
 */
export async function logout(req, res) {
  res.clearCookie(COOKIE_NAME, clearCookieOpts())
  return res.status(204).end()
}

/**
 * POST /api/auth/register
 *
 * Auto-cadastro de colaborador — endpoint PÚBLICO.
 * Cria usuário com role 'user' e vincula ao setor primário informado.
 * O usuário fica ativo imediatamente (sem aprovação).
 *
 * Body: { name, email, password, department_id }
 */
export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    await authService.register(parsed.data)
    return res.status(201).end()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * POST /api/auth/first-access
 *
 * Troca de senha no primeiro acesso via token one-time (recebido por e-mail).
 * Endpoint PÚBLICO — o usuário ainda não está autenticado.
 *
 * Body: { token: string, newPassword: string }
 *
 * O token é um JWT assinado com type: 'first_access' e TTL de 24h,
 * gerado pelo serviço quando o admin cria o usuário ou reseta a senha.
 */
export async function firstAccess(req, res) {
  const parsed = firstAccessSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })

  try {
    const result = await authService.firstAccess(parsed.data.token, parsed.data.newPassword)
    return res.json(result)
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
