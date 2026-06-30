/**
 * Logger centralizado — Pino estruturado.
 *
 * Produção: JSON puro em stdout (parseable por Loki/ELK/Datadog).
 * Dev:      pino-pretty com cores e timestamp legível.
 *
 * Redact automático:
 *   Campos listados em `redact.paths` são substituídos por '[REDACTED]'
 *   antes de qualquer serialização, garantindo que senhas, tokens e
 *   chaves secretas nunca apareçam em logs — mesmo em erros inesperados.
 *
 * Child loggers:
 *   logger.child({ requestId, userId, action }) cria um logger derivado
 *   que propaga os campos base sem copiar o objeto logger inteiro.
 *   Usar req.log (injetado por requestContext middleware) em vez de
 *   importar logger diretamente sempre que o contexto de request
 *   estiver disponível.
 */

import pino from 'pino'

const isDev   = process.env.NODE_ENV !== 'production'
const level   = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info')

export const logger = pino(
  {
    level,

    // Campos presentes em todos os logs deste serviço
    base: {
      service: 'flowdesk-api',
      env:     process.env.NODE_ENV ?? 'development',
    },

    // ECS / OpenTelemetry usa "message" em vez de "msg"
    messageKey: 'message',

    // Timestamp em epoch ms (padrão Pino) — compatível com Loki/ELK.
    // Para ISO legível em dev o pino-pretty converte automaticamente.
    timestamp: pino.stdTimeFunctions.epochTime,

    // Serializers: garante que req, res e err sejam serializados de forma
    // segura e completa, incluindo stack trace nos erros.
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },

    // Mascaramento automático de PII e dados sensíveis.
    // Censor aplicado ANTES da serialização — não há janela de exposição.
    redact: {
      paths: [
        // Headers HTTP
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        // Campos de corpo de request (login, troca de senha, criação de usuário)
        'body.password',
        'body.currentPassword',
        'body.newPassword',
        // Campos de banco / objetos internos
        '*.password_hash',
        '*.secret_key',          // secret_key do webhook
        '*.JWT_ACCESS_SECRET',
        '*.JWT_REFRESH_SECRET',
        '*.POSTGRES_PASSWORD',
        '*.MINIO_ROOT_PASSWORD',
      ],
      censor: '[REDACTED]',
    },
  },

  // Transport: pino-pretty em dev, stdout JSON em produção.
  // O transport fica no segundo argumento (destination) para que o redact
  // seja aplicado antes de qualquer serialização de transport.
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize:      true,
          translateTime: 'HH:MM:ss.l',
          ignore:        'pid,hostname,service,env',
          messageKey:    'message',
        },
      })
    : process.stdout
)
