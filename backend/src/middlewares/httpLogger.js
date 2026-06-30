/**
 * httpLogger — middleware pino-http para log automático de requisições.
 *
 * Cada requisição gera um log de entrada (debug) e um de saída (nível variável):
 *   - 2xx → info
 *   - 3xx → info
 *   - 4xx → warn  (erros do cliente, esperados)
 *   - 5xx → error (erros do servidor, inesperados)
 *
 * Campos logados por requisição:
 *   requestId, method, url, statusCode, responseTime (ms), userId (se autenticado)
 *
 * Campos explicitamente OMITIDOS (privacidade):
 *   req.body, req.headers.authorization, req.headers.cookie
 *   (esses já são cobertos pelo redact do logger, mas não incluímos
 *    nem a chave para evitar o campo [REDACTED] desnecessário no log HTTP)
 *
 * Health check é ignorado para não poluir os logs com pings constantes
 * de load balancers e readiness probes.
 */

import pinoHttp from 'pino-http'
import { logger } from '#lib/logger.js'

export const httpLogger = pinoHttp({
  logger,

  // Reutiliza o requestId injetado pelo requestContext middleware
  genReqId: (req) => req.requestId ?? req.headers['x-request-id'] ?? 'no-id',

  // Nível de log por status code
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400)        return 'warn'
    return 'info'
  },

  // Mensagem de log de saída
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} → ${res.statusCode}`,

  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} → ${res.statusCode} | ${err?.message ?? 'erro desconhecido'}`,

  // Serializa req e res sem dados sensíveis
  serializers: {
    req: (req) => ({
      id:     req.id,
      method: req.method,
      url:    req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  // Adiciona userId ao log quando o usuário já foi autenticado
  customProps: (req) => ({
    userId: req.user?.id ?? null,
  }),

  // Ignora health check (gerado por load balancers / k8s readiness probes)
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },
})
