import jwt from 'jsonwebtoken'

/**
 * Verifica o Access Token JWT e injeta req.user.
 * O payload contém role e deptIds para evitar queries de RBAC a cada request.
 *
 * req.user = { id, role, deptIds: string[], primaryDeptId: string | null }
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido.' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
    req.user = {
      id:           payload.sub,
      role:         payload.role,
      deptIds:      payload.deptIds   ?? [],
      primaryDeptId: payload.primaryDeptId ?? null,
    }
    next()
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expirado.' : 'Token inválido.'
    return res.status(401).json({ error: msg })
  }
}
