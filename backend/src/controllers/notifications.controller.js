import jwt from 'jsonwebtoken'
import * as svc from '#services/notifications.service.js'
import { addConnection, removeConnection } from '#lib/sseManager.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

// ── Emissão de ticket SSE ─────────────────────────────────────────────────────

/**
 * POST /api/notifications/ticket
 *
 * Emite um mini-token de curta duração (15s) para autenticar a conexão SSE.
 *
 * Motivação de segurança:
 *   EventSource não suporta headers customizados — o token de auth precisa ir
 *   via query param. Passar o access token completo (TTL 1h) em ?token= expõe
 *   a credencial em logs de servidor (Nginx, Cloudflare, ALB, etc.).
 *
 *   O ticket expira em 15s: tempo suficiente para o front abrir a conexão SSE,
 *   mas inútil se capturado de um log minutos depois.
 *
 * Fluxo:
 *   1. Frontend faz POST /ticket com Bearer access token (via Axios + interceptor)
 *   2. Middleware authenticate valida o Bearer token normalmente → req.user
 *   3. Controller assina mini-token { sub, type:'sse_ticket', exp: +15s }
 *   4. Frontend abre EventSource(?ticket=<mini-token>)
 *   5. stream controller valida o ticket e o campo type antes de aceitar
 *
 * Requer: middleware authenticate (aplicado na rota)
 */
export async function issueTicket(req, res) {
  const ticket = jwt.sign(
    { sub: req.user.id, type: 'sse_ticket' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15s' }
  )
  return res.json({ ticket })
}

// ── SSE Stream ────────────────────────────────────────────────────────────────

/**
 * GET /api/notifications/stream
 *
 * Endpoint SSE (Server-Sent Events).
 *
 * Autenticação via query param ?ticket=<mini-token> (emitido por POST /ticket).
 * O ticket tem payload { sub, type:'sse_ticket' } e expira em 15s.
 * Mesmo que capturado em logs de acesso, já terá expirado antes de ser utilizável.
 *
 * Multi-tab:
 *   addConnection() adiciona ao Set — não fecha conexões anteriores do mesmo usuário.
 *   removeConnection() remove apenas ESTA res ao fechar.
 *
 * Fluxo:
 *   1. Valida ticket (assinatura + expiração + type === 'sse_ticket')
 *   2. Define headers SSE (Content-Type: text/event-stream)
 *   3. Registra conexão no sseManager
 *   4. Envia heartbeat a cada 25s (browsers encerram SSE sem dados após ~30-45s)
 *   5. Remove esta conexão específica no evento 'close'
 */
export async function stream(req, res) {
  // ── Autenticação pelo ticket de curta duração ─────────────────────────────
  const ticket = req.query.ticket
  if (!ticket) {
    return res.status(401).json({ error: 'Ticket SSE não fornecido.' })
  }

  let payload
  try {
    payload = jwt.verify(ticket, process.env.JWT_ACCESS_SECRET)
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Ticket SSE expirado.' : 'Ticket SSE inválido.'
    return res.status(401).json({ error: msg })
  }

  // Garante que este token foi emitido especificamente para SSE
  // (rejeita access tokens normais mesmo que a assinatura seja válida)
  if (payload.type !== 'sse_ticket') {
    return res.status(401).json({ error: 'Token inválido para SSE.' })
  }

  const userId = String(payload.sub)

  // ── Headers SSE ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control',     'no-cache, no-transform')
  res.setHeader('Connection',        'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')   // desabilita buffering no nginx
  res.flushHeaders()

  // ── Registra conexão (multi-tab: adiciona ao Set, não substitui) ──────────
  addConnection(userId, res)

  // ── Handshake inicial ─────────────────────────────────────────────────────
  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`)

  // ── Heartbeat a cada 25s ──────────────────────────────────────────────────
  // Comentários SSE (": ...") não disparam onmessage no cliente.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':heartbeat\n\n')
    } else {
      clearInterval(heartbeat)
    }
  }, 25_000)

  // ── Cleanup: remove apenas ESTA conexão ao fechar ─────────────────────────
  // Outras abas do mesmo usuário continuam recebendo eventos normalmente.
  req.on('close', () => {
    clearInterval(heartbeat)
    removeConnection(userId, res)
  })
}

// ── Listar notificações ───────────────────────────────────────────────────────

/**
 * GET /api/notifications
 * Query params: cursor (ISO timestamptz), cursor_id (UUID)
 */
export async function list(req, res) {
  try {
    const { cursor, cursor_id } = req.query
    const result = await svc.listNotifications(req.user.id, cursor ?? null, cursor_id ?? null)
    return res.json(result)
  } catch (err) { return handleError(err, res) }
}

// ── Marcar como lida ──────────────────────────────────────────────────────────

/**
 * PATCH /api/notifications/:id/read
 */
export async function markRead(req, res) {
  try {
    await svc.markAsRead(req.user.id, req.params.id)
    return res.json({ ok: true })
  } catch (err) { return handleError(err, res) }
}

// ── Marcar todas como lidas ───────────────────────────────────────────────────

/**
 * PATCH /api/notifications/read-all
 */
export async function markAllRead(req, res) {
  try {
    const count = await svc.markAllRead(req.user.id)
    return res.json({ ok: true, updated: count })
  } catch (err) { return handleError(err, res) }
}
