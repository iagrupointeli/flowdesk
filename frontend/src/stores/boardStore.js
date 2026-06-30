import axios    from 'axios'
import { create } from 'zustand'
import api from '../lib/api'

/**
 * Store do Quadro Kanban (FlowDesk — boardStore).
 *
 * ── Estrutura de dados ────────────────────────────────────────────────────────
 *
 *   stages         : Stage[]    → colunas ordenadas do tipo de demanda
 *   demandsByStage : Record<stageId, Demand[]>  → fonte da verdade dos cards
 *
 * ── Segregação de loading ─────────────────────────────────────────────────────
 *
 *   isLoadingInitial  true enquanto fetchBoard() carrega pela PRIMEIRA vez
 *                     (exibe skeleton de colunas, sem dados antigos)
 *   isFetchingMore    true durante recargas/filtros (dados antigos ainda visíveis)
 *
 * ── AbortController ───────────────────────────────────────────────────────────
 *
 *   fetchBoard() aborta automaticamente qualquer requisição anterior ainda em voo
 *   antes de iniciar a nova. Isso garante que filtros rápidos ou troca de tipo
 *   de demanda não produzam race conditions.
 *
 * ── Otimismo controlado ───────────────────────────────────────────────────────
 *
 *   moveCardOptimistic():
 *     1. Captura backup de demandsByStage
 *     2. Move o card localmente (UI instantânea)
 *     3. PATCH /demands/:id/stage  →  atualiza com dados reais do servidor
 *     4. Se o PATCH falhar  →  reverte para o backup
 *     Lança o erro para que o componente possa exibir feedback ao usuário.
 */

export const useBoardStore = create((set, get) => ({

  // ── Estado ─────────────────────────────────────────────────────────────────
  demandTypeId:    null,
  stages:          [],      // [{ id, name, color, position, requires_note, requires_assignee }]
  demandsByStage:  {},      // { [stageId]: demand[] }
  isLoadingInitial: true,
  isFetchingMore:   false,
  error:            null,
  _abortController: null,

  // ── fetchBoard(demandTypeId) ────────────────────────────────────────────────
  //
  // Carrega colunas e demandas em paralelo.
  //
  // Endpoints (montados em index.js):
  //   GET /api/demand-types/:id    → { id, name, stages: Stage[] }
  //                                   (etapas ativas, ordenadas por display_order)
  //   GET /api/demands             → { demands: Demand[] }
  //     query: demand_type_id, limit
  //
  // Defensive:
  //   stages pode ser [] se o tipo não tiver etapas configuradas.
  //   demands pode usar envelopes diferentes: { demands }, { items }, array direto.
  fetchBoard: async (demandTypeId, filters = {}) => {
    // ── Abort de requisição anterior ────────────────────────────────────────
    const prev = get()._abortController
    if (prev) prev.abort()

    const controller = new AbortController()
    const isFirstLoad = get().demandTypeId !== demandTypeId

    set({
      _abortController:  controller,
      error:             null,
      isLoadingInitial:  isFirstLoad,
      isFetchingMore:    !isFirstLoad,
    })

    try {
      // Carrega tipo de demanda (com stages) e demandas em paralelo
      const [dtRes, demandsRes] = await Promise.all([
        api.get(`/demand-types/${demandTypeId}`, { signal: controller.signal }),
        api.get('/demands', {
          params: {
            demand_type_id: demandTypeId,
            limit:          200,
            ...(filters.q?.trim()         ? { q:                   filters.q.trim()    } : {}),
            ...(filters.assignee_id       ? { current_assignee_id:  filters.assignee_id } : {}),
            ...(filters.tag_id            ? { tag_id:               filters.tag_id      } : {}),
          },
          signal: controller.signal,
        }),
      ])

      // Defensive: stages pode ser absent se o tipo não tiver etapas ainda
      const stages  = Array.isArray(dtRes.data.stages) ? dtRes.data.stages : []
      // Suporta diferentes envelopes: { demands }, { items }, array direto
      const demands = demandsRes.data.demands
                   ?? demandsRes.data.items
                   ?? (Array.isArray(demandsRes.data) ? demandsRes.data : [])

      // ── Agrupa demandas por stage_id ──────────────────────────────────────
      // Inicializa todas as colunas com array vazio para que colunas vazias
      // sejam renderizadas corretamente (não desapareçam do quadro).
      const demandsByStage = Object.fromEntries(stages.map(s => [s.id, []]))

      for (const demand of demands) {
        // Ignora cards cujo stage_id não pertence a este demand type
        if (Object.prototype.hasOwnProperty.call(demandsByStage, demand.stage_id)) {
          demandsByStage[demand.stage_id].push(demand)
        }
      }

      set({
        demandTypeId,
        stages,
        demandsByStage,
        isLoadingInitial:  false,
        isFetchingMore:    false,
        _abortController:  null,
      })
    } catch (err) {
      // Aborto silencioso — não é erro de negócio
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED' || err?.name === 'AbortError') return

      set({
        isLoadingInitial: false,
        isFetchingMore:   false,
        error:            err?.response?.data?.message ?? 'Erro ao carregar o quadro.',
        _abortController: null,
      })
    }
  },

  // ── moveCardOptimistic ─────────────────────────────────────────────────────
  //
  // Parâmetros:
  //   demandId    — ID da demanda a ser movida
  //   fromStageId — coluna de origem
  //   toStageId   — coluna de destino
  //   note        — justificativa (string | undefined)
  //   assigneeId  — ID do responsável (string | undefined)
  //
  // Lança o erro do PATCH para que o componente Board possa exibir feedback.
  //
  // ── Isolamento de revert concorrente ─────────────────────────────────────
  //
  // Problema com backup global:
  //   Move A e Move B disparam quase simultaneamente.
  //   A falha, reverte para backup_A → apaga o otimismo de B.
  //
  // Solução — revert por ID específico:
  //   Em vez de restaurar o snapshot inteiro, a falha localiza o card por ID
  //   em `toStageId` e o move de volta para `fromStageId` usando o estado
  //   ATUAL da store (que pode já ter sido modificado por B).
  //   Se o card não for encontrado em `toStageId` (porque B o moveu para C),
  //   o revert é abortado silenciosamente — não clobberamos o estado de B.
  moveCardOptimistic: async ({ demandId, fromStageId, toStageId, note, assigneeId }) => {

    // ── 1. Atualização otimista ────────────────────────────────────────────
    // Lê o estado atual via get() no momento do set para garantir que
    // operações concorrentes não leiam estado stale.
    set(state => {
      const fromList  = [...(state.demandsByStage[fromStageId] ?? [])]
      const toList    = [...(state.demandsByStage[toStageId]   ?? [])]
      const cardIndex = fromList.findIndex(d => String(d.id) === String(demandId))

      if (cardIndex === -1) return {}   // card não encontrado — nada a fazer

      const [card] = fromList.splice(cardIndex, 1)
      toList.push({ ...card, stage_id: toStageId })

      return {
        demandsByStage: {
          ...state.demandsByStage,
          [fromStageId]: fromList,
          [toStageId]:   toList,
        },
      }
    })

    // Verifica se o card estava lá (caso set() retornou {} por not-found)
    const afterOptimistic = get().demandsByStage
    const cardInDest = (afterOptimistic[toStageId] ?? []).find(
      d => String(d.id) === String(demandId)
    )
    if (!cardInDest) return   // card não existia — estado inconsistente, nada a fazer

    // ── 2. Chamada ao backend ───────────────────────────────────────────────
    try {
      const body = { stage_id: toStageId }
      if (note)       body.notes       = note
      if (assigneeId) body.assignee_id = assigneeId

      const { data } = await api.patch(`/demands/${demandId}/stage`, body)
      // Suporta resposta nova { demand, event } e resposta legada (objeto direto)
      const rawDemand    = data.demand ?? data
      const updatedDemand = {
        ...rawDemand,
        stage_id: rawDemand.stage_id ?? rawDemand.current_stage_id,
      }

      // Substitui o card otimista pelo dado real do servidor
      set(state => ({
        demandsByStage: {
          ...state.demandsByStage,
          [toStageId]: (state.demandsByStage[toStageId] ?? []).map(d =>
            String(d.id) === String(demandId) ? updatedDemand : d
          ),
        },
      }))
    } catch (err) {
      // ── 3. Revert ID-isolado ──────────────────────────────────────────────
      // Usa estado ATUAL (não snapshot antigo) para não clobber moves concorrentes.
      // Se o card foi movido novamente por outra ação enquanto este PATCH estava
      // em voo, ele não estará mais em `toStageId` e o revert é silencioso.
      set(state => {
        const currentToList   = [...(state.demandsByStage[toStageId]   ?? [])]
        const currentFromList = [...(state.demandsByStage[fromStageId] ?? [])]

        const cardIdx = currentToList.findIndex(d => String(d.id) === String(demandId))
        // Card não está mais aqui — foi movido por outra ação. Não toca.
        if (cardIdx === -1) return {}

        const [revertedCard] = currentToList.splice(cardIdx, 1)
        // Reinsere na origem; position aproximada (no topo para visibilidade)
        currentFromList.unshift({ ...revertedCard, stage_id: fromStageId })

        return {
          demandsByStage: {
            ...state.demandsByStage,
            [fromStageId]: currentFromList,
            [toStageId]:   currentToList,
          },
        }
      })

      throw err   // propaga para que Board possa exibir feedback ao usuário
    }
  },

  // ── reset() ────────────────────────────────────────────────────────────────
  // Chamado quando o componente Board desmonta (cleanup do useEffect).
  // Aborta requisições em voo e limpa o estado para evitar dados obsoletos
  // quando o usuário trocar de tipo de demanda.
  reset: () => {
    const controller = get()._abortController
    if (controller) controller.abort()

    set({
      demandTypeId:     null,
      stages:           [],
      demandsByStage:   {},
      isLoadingInitial: true,
      isFetchingMore:   false,
      error:            null,
      _abortController: null,
    })
  },
}))
