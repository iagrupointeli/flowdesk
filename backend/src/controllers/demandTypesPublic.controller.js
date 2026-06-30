import * as svc from '#services/demandTypes.service.js'

/**
 * GET /api/demand-types
 * Lista tipos de demanda acessíveis ao usuário autenticado.
 * Qualquer role pode acessar (filtrado por departamento).
 */
export async function listTypesForBoard(req, res) {
  try {
    return res.json(await svc.listTypesForBoard(req.user))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * GET /api/demand-types/:id
 * Retorna o tipo de demanda com suas etapas ativas (não arquivadas).
 * Consumido pelo boardStore.fetchBoard() para montar as colunas do Kanban.
 */
export async function getTypeWithStages(req, res) {
  try {
    return res.json(await svc.getTypeWithStages(req.user, req.params.id))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

/**
 * GET /api/demand-types/:id/fields
 * Retorna o tipo de demanda com seus CAMPOS ATIVOS.
 * Consumido pelo formulário /demands/new para gerar os inputs dinâmicos.
 */
export async function getTypeWithFields(req, res) {
  try {
    return res.json(await svc.getTypeWithFields(req.user, req.params.id))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
