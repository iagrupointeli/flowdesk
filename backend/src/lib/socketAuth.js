import jwt         from 'jsonwebtoken'
import cookieParse from 'cookie'

/**
 * Middleware Socket.io — autentica o handshake via accessToken.
 *
 * Ordem de busca do token:
 *   1. Cookie "accessToken" (quando o cliente envia cookies no handshake)
 *   2. Header Authorization: Bearer <token>
 *   3. Query-string ?token=<token> (fallback para ambientes sem CORS+cookie)
 *
 * Injeta socket.user = { id, role, deptIds, primaryDeptId } ou rejeita com
 * erro 'unauthorized' que o cliente Socket.io expõe como connect_error.
 */
export function socketAuthMiddleware(socket, next) {
  try {
    let token

    // 1. cookie
    const rawCookies = socket.handshake.headers.cookie ?? ''
    const cookies    = cookieParse.parse(rawCookies)
    if (cookies.accessToken) {
      token = cookies.accessToken
    }

    // 2. Authorization header
    if (!token) {
      const auth = socket.handshake.headers.authorization ?? ''
      if (auth.startsWith('Bearer ')) token = auth.slice(7)
    }

    // 3. query-string
    if (!token) token = socket.handshake.query.token

    if (!token) return next(new Error('unauthorized'))

    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
    socket.user = {
      id:            payload.sub,
      name:          payload.name          ?? null,
      role:          payload.role,
      deptIds:       payload.deptIds       ?? [],
      primaryDeptId: payload.primaryDeptId ?? null,
    }
    next()
  } catch {
    next(new Error('unauthorized'))
  }
}
