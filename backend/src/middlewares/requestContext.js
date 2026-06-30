/**
 * requestContext — injeta requestId e child logger em cada requisição.
 *
 * requestId:
 *   Aceita o header `x-request-id` de upstream (API gateway, load balancer,
 *   Vite proxy de dev) para preservar rastreabilidade entre camadas.
 *   Se ausente, gera um ID local compacto (8 hex chars — suficiente para
 *   correlação dentro de um serviço único sem o overhead de UUID completo).
 *
 * req.log:
 *   Child logger do Pino com requestId fixo. Usar req.log nos controllers
 *   e services (passado como parâmetro ou via AsyncLocalStorage no futuro)
 *   garante que todos os logs de uma requisição compartilhem o mesmo ID.
 *
 * res.setHeader:
 *   Devolve o requestId no response para que o cliente (e testes) possam
 *   referenciar o ID ao reportar um problema.
 */

import { randomBytes } from 'node:crypto'
import { logger }      from '#lib/logger.js'

export function requestContext(req, res, next) {
  const requestId = req.headers['x-request-id'] ?? randomBytes(4).toString('hex')

  req.requestId = requestId
  res.setHeader('x-request-id', requestId)

  // Child logger: todos os campos deste contexto propagam automaticamente
  req.log = logger.child({ requestId })

  next()
}
