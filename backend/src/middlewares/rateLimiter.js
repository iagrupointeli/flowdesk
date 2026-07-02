import rateLimit from 'express-rate-limit'

/**
 * Login: janela de 15min, 10 tentativas por IP. Sucessos não contam contra o
 * limite (skipSuccessfulRequests) — só tentativas falhas/erros acumulam.
 * Defesa em camada complementar ao lockout por conta em auth.service.js.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
})

/**
 * Cadastro público: 1h, 5 por IP — contém spam de contas.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitos cadastros a partir deste IP. Tente novamente mais tarde.' },
})

/**
 * Genérico para o restante das rotas de auth públicas (first-access, refresh) —
 * defesa de base contra abuso, sem afetar uso normal.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
})
