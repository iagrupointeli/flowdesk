/**
 * SSE Connection Manager — registro e despacho de eventos em tempo real.
 *
 * ── Arquitetura ───────────────────────────────────────────────────────────────
 *
 *   Map em memória: userId (string) → Set<Express Response>.
 *   Suporte a múltiplas abas simultâneas do mesmo usuário (multi-tab).
 *   Adequado para implantação em servidor único (sem clustering).
 *   Para escalonamento horizontal seria necessário um broker externo (Redis pub/sub).
 *
 * ── Ciclo de vida da conexão ─────────────────────────────────────────────────
 *
 *   1. addConnection(userId, res)     — chamado no handler do SSE ao conectar
 *   2. dispatch(userId, eventData)    — chamado por serviços após mutações
 *   3. removeConnection(userId, res)  — chamado no evento 'close'; remove só ESTA res
 *
 * ── Multi-tab ────────────────────────────────────────────────────────────────
 *
 *   Cada aba abre uma conexão SSE independente (Map → Set).
 *   Ao fechar uma aba, apenas aquela Response é removida — as demais permanecem.
 *   dispatch() itera todo o Set e envia o evento para cada conexão ativa.
 *
 * ── Formato do evento SSE ─────────────────────────────────────────────────────
 *
 *   data: <JSON>\n\n
 *
 *   Exemplos:
 *     {"type":"connected"}                                  — handshake inicial
 *     {"type":"notification","data":{id, message, link, is_read, created_at}}
 *
 * ── Robustez ──────────────────────────────────────────────────────────────────
 *
 *   dispatch() verifica res.writableEnded e captura erros de escrita.
 *   Conexões mortas são removidas lazily durante o despacho.
 */

/** @type {Map<string, Set<import('express').Response>>} */
const connections = new Map()

/**
 * Registra uma nova conexão SSE para o usuário.
 * Suporta múltiplas conexões simultâneas (multi-tab) — não fecha conexões anteriores.
 *
 * @param {string}                     userId
 * @param {import('express').Response} res
 */
export function addConnection(userId, res) {
  const uid = String(userId)
  if (!connections.has(uid)) connections.set(uid, new Set())
  connections.get(uid).add(res)
}

/**
 * Remove uma conexão SSE específica (chamado quando o cliente desconecta).
 * Remove apenas a `res` fornecida — outras abas do mesmo usuário permanecem ativas.
 *
 * @param {string}                     userId
 * @param {import('express').Response} res
 */
export function removeConnection(userId, res) {
  const uid = String(userId)
  const set = connections.get(uid)
  if (!set) return
  set.delete(res)
  if (set.size === 0) connections.delete(uid)
}

/**
 * Despacha um evento SSE para TODAS as conexões ativas do usuário.
 * Silencioso se o usuário não tiver conexão ativa.
 * Conexões mortas (writableEnded ou erro de escrita) são removidas lazily.
 *
 * @param {string} userId
 * @param {object} eventData  — deve ser serializável em JSON
 */
export function dispatch(userId, eventData) {
  const uid = String(userId)
  const set = connections.get(uid)
  if (!set || set.size === 0) return

  const payload = `data: ${JSON.stringify(eventData)}\n\n`
  const dead = []

  for (const res of set) {
    if (res.writableEnded) {
      dead.push(res)
      continue
    }
    try {
      res.write(payload)
    } catch (err) {
      console.error('[SSE] falha ao despachar evento:', err.message)
      dead.push(res)
    }
  }

  // Limpeza lazy de conexões mortas detectadas durante o despacho
  for (const res of dead) set.delete(res)
  if (set.size === 0) connections.delete(uid)
}

/**
 * Retorna o número de usuários únicos com conexão SSE ativa.
 * (Cada usuário pode ter múltiplas abas — conta usuários, não total de conexões.)
 * @returns {number}
 */
export function activeConnectionsCount() {
  return connections.size
}
