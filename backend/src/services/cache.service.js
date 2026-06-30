/**
 * Cache em memória para schemas de validação de demand_type_fields.
 *
 * Chave: demand_type_id (UUID)
 * Valor: array de demand_type_fields ativos no momento do cache
 *
 * Regras de invalidação:
 *   - Campo adicionado    → invalida o tipo
 *   - Campo atualizado    → invalida o tipo
 *   - Campo arquivado     → invalida o tipo
 *   - Tipo de demanda deletado → invalida o tipo
 *
 * A invalidação é SÍNCRONA (delete do Map) para que a próxima
 * requisição sempre leia o estado real do banco — sem janela de inconsistência.
 */

const store = new Map()

/**
 * Retorna os campos em cache para um demand_type_id,
 * ou null se não houver entrada válida.
 */
export function get(demandTypeId) {
  return store.get(demandTypeId) ?? null
}

/**
 * Armazena os campos de um demand_type_id no cache.
 */
export function set(demandTypeId, fields) {
  store.set(demandTypeId, fields)
}

/**
 * Remove imediatamente a entrada do cache para um demand_type_id.
 * Deve ser chamado de forma síncrona ANTES de retornar a resposta
 * de qualquer operação que altere demand_type_fields.
 */
export function invalidate(demandTypeId) {
  store.delete(demandTypeId)
}

/**
 * Limpa todo o cache — usado em testes ou restart lógico.
 */
export function clear() {
  store.clear()
}

export default { get, set, invalidate, clear }
