// TZ=UTC garantido via --env-file antes deste módulo ser carregado (Node 20+)
// Ver package.json scripts: node --env-file=../.env src/index.js
import http         from 'http'
import express      from 'express'
import helmet       from 'helmet'
import cors         from 'cors'
import cookieParser from 'cookie-parser'
import { Server as SocketServer } from 'socket.io'
import { socketAuthMiddleware }   from '#lib/socketAuth.js'
import { registerChatHandlers }  from '#socket/chat.handlers.js'
import { setIo }                 from '#lib/socketInstance.js'
import { logger }                from '#lib/logger.js'
import { requestContext }        from '#middlewares/requestContext.js'
import { httpLogger }            from '#middlewares/httpLogger.js'
import { query }                 from '#config/database.js'
import { activeConnectionsCount } from '#lib/sseManager.js'

import { runSlaCheck }            from '#services/sla.service.js'
import { runRecurringCheck }      from '#services/recurring.service.js'
import { runDocumentExpiryCheck }  from '#services/assetDocuments.service.js'
import { runMaterialDeadlineCheck } from '#services/materialDeadlines.service.js'
import { expireHolds }              from '#services/campaigns.service.js'
import authRoutes           from '#routes/auth.routes.js'
import usersRoutes          from '#routes/users.routes.js'
import adminRoutes          from '#routes/admin.routes.js'
import demandsRoutes        from '#routes/demands.routes.js'
import demandTypesRoutes    from '#routes/demandTypes.routes.js'
import dashboardRoutes      from '#routes/dashboard.routes.js'
import notificationsRoutes  from '#routes/notifications.routes.js'
import tagsRoutes           from '#routes/tags.routes.js'
import departmentsRoutes    from '#routes/departments.routes.js'
import chatRoutes           from '#routes/chat.routes.js'
import assetsRoutes         from '#routes/assets.routes.js'
import externalRoutes       from '#routes/external.routes.js'
import campaignsRoutes      from '#routes/campaigns.routes.js'
import portfoliosRoutes     from '#routes/portfolios.routes.js'
import reportRoutes         from '#routes/report.routes.js'
import intakeRoutes         from '#routes/intake.routes.js'
import tasksRoutes          from '#routes/tasks.routes.js'
import projectsRoutes       from '#routes/projects.routes.js'
import areasRoutes          from '#routes/areas.routes.js'

const app    = express()
const server = http.createServer(app)

const ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173'

export const io = new SocketServer(server, {
  cors:              { origin: ORIGIN, credentials: true },
  transports:        ['websocket', 'polling'],
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
})

setIo(io)
io.use(socketAuthMiddleware)

io.on('connection', socket => {
  registerChatHandlers(io, socket)
})

app.use(helmet())

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: ORIGIN, credentials: true }))

// ── Observabilidade: requestId + HTTP logging ─────────────────────────────────
// Ordem crítica: requestContext ANTES de httpLogger para que o requestId
// já esteja disponível quando pinoHttp montar o log de entrada.
app.use(requestContext)
app.use(httpLogger)

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cookieParser())
app.use(express.json())

// ── Health check com verificação real de dependências ─────────────────────────
// Retorna 503 se o banco estiver inacessível.
// Usado por load balancers e readiness probes — autoLogging ignorado no httpLogger.
app.get('/health', async (_req, res) => {
  const checks = {}
  let httpStatus = 200

  try {
    await query('SELECT 1')
    checks.database = 'ok'
  } catch (err) {
    checks.database = 'error'
    logger.error({ err }, 'Health check: banco inacessível')
    httpStatus = 503
  }

  checks.sse_connections = activeConnectionsCount()

  res.status(httpStatus).json({
    status:    httpStatus === 200 ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  })
})

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes)
app.use('/api/users',        usersRoutes)
app.use('/api/admin',        adminRoutes)
app.use('/api/demands',      demandsRoutes)
app.use('/api/demand-types', demandTypesRoutes)
app.use('/api/dashboard',      dashboardRoutes)
app.use('/api/notifications',  notificationsRoutes)
app.use('/api/tags',           tagsRoutes)
app.use('/api/departments',    departmentsRoutes)
app.use('/api/chat',           chatRoutes)
app.use('/api/assets',         assetsRoutes)
app.use('/api/external',       externalRoutes)   // PÚBLICO — segurança via token opaco
app.use('/api/intake',         intakeRoutes)      // PÚBLICO — formulário de intake tokenizado
app.use('/api/campaigns',      campaignsRoutes)
app.use('/api/portfolios',     portfoliosRoutes)
app.use('/api/reports',        reportRoutes)
app.use('/api/tasks',          tasksRoutes)
app.use('/api/projects',      projectsRoutes)
app.use('/api/areas',         areasRoutes)

// ── Error handler global ──────────────────────────────────────────────────────
// Captura exceções não tratadas pelos controllers.
// req.log é o child logger com requestId já injetado pelo requestContext.
// Loga apenas 5xx — erros 4xx são tratados pelos controllers individualmente.
app.use((err, req, res, _next) => {
  const status = err.status ?? 500
  const log    = req.log ?? logger

  if (status >= 500) {
    log.error({
      err,
      requestId: req.requestId,
      userId:    req.user?.id ?? null,
      method:    req.method,
      url:       req.originalUrl,
      status,
    }, 'Erro não tratado')
  }

  if (res.headersSent) return
  res.status(status).json({ error: err.message ?? 'Erro interno do servidor.' })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV, tz: process.env.TZ }, 'FlowDesk API iniciada')

  // ── Job de verificação de SLA ─────────────────────────────────────────────
  // Roda imediatamente ao iniciar e depois a cada SLA_CHECK_INTERVAL_MS (1h padrão).
  // Env vars relevantes:
  //   SLA_WARN_HOURS          — janela de aviso antes do vencimento (padrão: 24)
  //   SLA_CHECK_INTERVAL_MS   — intervalo entre execuções em ms (padrão: 3600000)
  const SLA_INTERVAL = Number(process.env.SLA_CHECK_INTERVAL_MS ?? 60 * 60 * 1000)
  const runSla = () => runSlaCheck().catch(err => logger.error({ err }, 'SLA check falhou'))
  runSla()
  setInterval(runSla, SLA_INTERVAL)

  // ── Job de demandas recorrentes ───────────────────────────────────────────
  // Materializa templates vencidos. Intervalo menor que o SLA (10 min padrão)
  // para que a demanda nasça próxima do horário agendado no template.
  //   RECURRING_CHECK_INTERVAL_MS — intervalo em ms (padrão: 600000)
  const REC_INTERVAL = Number(process.env.RECURRING_CHECK_INTERVAL_MS ?? 10 * 60 * 1000)
  const runRecurring = () => runRecurringCheck().catch(err => logger.error({ err }, 'Recurring check falhou'))
  runRecurring()
  setInterval(runRecurring, REC_INTERVAL)

  // ── Job de vencimento de documentos ──────────────────────────────────────
  // Roda uma vez por dia. Notifica super_admins sobre documentos
  // (alvarás, contratos) que vencem em 30, 15, 7 ou 1 dia.
  const runDocExpiry = () =>
    runDocumentExpiryCheck().catch(err => logger.error({ err }, 'Document expiry check falhou'))
  runDocExpiry()
  setInterval(runDocExpiry, 24 * 60 * 60 * 1000)

  // ── Job de prazos de materiais criativos ──────────────────────────────────
  // Alerta quando campanha começa em 7, 3 ou 1 dia sem arte criativa anexada.
  const runMaterialDeadlines = () =>
    runMaterialDeadlineCheck().catch(err => logger.error({ err }, 'Material deadline check falhou'))
  runMaterialDeadlines()
  setInterval(runMaterialDeadlines, 24 * 60 * 60 * 1000)

  // ── Job de expiração de holds ─────────────────────────────────────────────
  // Arquiva campanhas com approval_status='pending' cujo expires_at já passou.
  const runExpireHolds = () =>
    expireHolds().catch(err => logger.error({ err }, 'Expire holds check falhou'))
  runExpireHolds()
  setInterval(runExpireHolds, 24 * 60 * 60 * 1000)
})

export default app
