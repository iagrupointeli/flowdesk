import axios    from 'axios'
import { create } from 'zustand'
import api from '../lib/api'
import { useAuthStore } from './authStore'

/**
 * Store da página de detalhes de uma demanda (/demands/:id).
 *
 * ── Responsabilidades ──────────────────────────────────────────────────────────
 *   fetchDemand          GET /demands/:id
 *   fetchTimeline        GET /demands/:id/timeline  (primeira página, reseta itens)
 *   fetchMoreTimeline    GET /demands/:id/timeline?cursor=...  (acumula — paginação keyset)
 *   addCommentToTimeline injeta comentário recém-criado no INÍCIO do array (DESC)
 *   fetchStages          GET /demand-types/:typeId  (stages para MoveStageModal)
 *   moveStage            PATCH /demands/:id/stage  → injeta event retornado
 *   assignUser           PATCH /demands/:id/stage  → injeta event retornado
 *   setExceptionState    PATCH /demands/:id/exception  → injeta event retornado
 *   reset                aborta in-flight + ZERA TODO O ESTADO (anti-flash)
 *
 * ── Ordem cronológica DESC (newest first) ─────────────────────────────────────
 *   timelineItems é mantido em ordem DESC — índice 0 = evento mais recente.
 *   Backend retorna as páginas já em DESC (ORDER BY entered_at DESC).
 *   fetchTimeline:      usa os items diretamente (sem .reverse())
 *   fetchMoreTimeline:  "load more" = itens mais ANTIGOS → APPEND ao array DESC
 *   addCommentToTimeline: [newItem, ...state.timelineItems] → comentário no topo
 *
 * ── Zero refetch após mutações ────────────────────────────────────────────────
 *   moveStage, assignUser e setExceptionState recebem { demand, event } do backend.
 *   O event é injetado diretamente em timelineItems[0] sem chamar fetchTimeline.
 *   Isso preserva scroll position e estado de paginação do usuário.
 *
 * ── Enriquecimento de actor_name ─────────────────────────────────────────────
 *   O backend retorna actor_name: null (JWT não carrega name).
 *   O frontend enriquece com useAuthStore.getState().user.name.
 *
 * ── Prevenção de flash de demanda anterior ────────────────────────────────────
 *   reset() zera demand: null, timelineItems: [] SINCRONICAMENTE antes do novo fetch.
 *
 * ── AbortController ───────────────────────────────────────────────────────────
 *   Dois controllers independentes:
 *     _demandController   — protege fetchDemand
 *     _timelineController — protege fetchTimeline + fetchMoreTimeline
 *   Ambos abortados em reset().
 */
export const useDemandDetailStore = create((set, get) => ({

  // ── Estado público ─────────────────────────────────────────────────────────
  demand:          null,
  timelineItems:   [],   // DESC: índice 0 = mais recente
  hasMore:         false,
  nextCursor:      null,

  stages:          [],   // etapas do tipo de demanda (para MoveStageModal)
  isLoadingStages: false,

  isLoadingDemand:   false,
  isLoadingTimeline: false,
  isLoadingMore:     false,

  errorDemand:    null,
  errorTimeline:  null,

  // ── Estado interno (controllers) ───────────────────────────────────────────
  _demandController:   null,
  _timelineController: null,

  // ── fetchDemand ────────────────────────────────────────────────────────────
  fetchDemand: async (id) => {
    const prev = get()._demandController
    if (prev) prev.abort()

    const controller = new AbortController()
    set({ isLoadingDemand: true, errorDemand: null, demand: null, _demandController: controller })

    try {
      const { data } = await api.get(`/demands/${id}`, { signal: controller.signal })
      set({ demand: data, isLoadingDemand: false, _demandController: null })
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return
      set({
        isLoadingDemand: false,
        errorDemand:     err?.response?.data?.error ?? 'Erro ao carregar a demanda.',
        _demandController: null,
      })
    }
  },

  // ── fetchTimeline (primeira página — reseta itens) ──────────────────────────
  // Backend retorna DESC nativamente — sem .reverse() aqui.
  fetchTimeline: async (id) => {
    const prev = get()._timelineController
    if (prev) prev.abort()

    const controller = new AbortController()
    set({
      isLoadingTimeline: true, errorTimeline: null,
      timelineItems: [], hasMore: false, nextCursor: null,
      _timelineController: controller,
    })

    try {
      const { data } = await api.get(`/demands/${id}/timeline`, { signal: controller.signal })
      set({
        timelineItems:     data.items ?? [],
        hasMore:           data.hasMore    ?? false,
        nextCursor:        data.nextCursor ?? null,
        isLoadingTimeline: false,
        _timelineController: null,
      })
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return
      set({
        isLoadingTimeline: false,
        errorTimeline:     err?.response?.data?.error ?? 'Erro ao carregar a timeline.',
        _timelineController: null,
      })
    }
  },

  // ── fetchMoreTimeline (páginas seguintes — itens mais ANTIGOS → APPEND) ──────
  // O cursor aponta para o item mais antigo da página atual.
  // O backend retorna a próxima página (ainda mais antiga) também em DESC.
  // Append ao array: [...existentes, ...novasPágina] → mantém DESC correto.
  fetchMoreTimeline: async (id) => {
    const { nextCursor, isLoadingMore, _timelineController } = get()
    if (!nextCursor || isLoadingMore) return

    const prev = _timelineController
    if (prev) prev.abort()

    const controller = new AbortController()
    set({ isLoadingMore: true, _timelineController: controller })

    try {
      const { data } = await api.get(`/demands/${id}/timeline`, {
        params: { cursor: nextCursor },
        signal: controller.signal,
      })

      // APPEND: itens mais antigos vão ao final do array DESC
      set(state => ({
        timelineItems:    [...state.timelineItems, ...(data.items ?? [])],
        hasMore:          data.hasMore    ?? false,
        nextCursor:       data.nextCursor ?? null,
        isLoadingMore:    false,
        _timelineController: null,
      }))
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return
      set({ isLoadingMore: false, _timelineController: null })
    }
  },

  // ── addCommentToTimeline ───────────────────────────────────────────────────
  // PREPEND: comentário recém-criado vai ao índice 0 (topo da lista DESC).
  // Chamado por CommentBox após POST /demands/:id/comments bem-sucedido.
  addCommentToTimeline: (item) => {
    set(state => ({ timelineItems: [item, ...state.timelineItems] }))
  },

  // ── fetchStages ────────────────────────────────────────────────────────────
  fetchStages: async (demandTypeId) => {
    if (get().isLoadingStages) return
    set({ isLoadingStages: true })
    try {
      const { data } = await api.get(`/demand-types/${demandTypeId}`)
      set({ stages: data.stages ?? [], isLoadingStages: false })
    } catch {
      set({ isLoadingStages: false })
    }
  },

  // ── moveStage ──────────────────────────────────────────────────────────────
  // PATCH /demands/:id/stage → { demand, event }
  // Injeta event em timelineItems[0] sem chamar fetchTimeline (zero refetch).
  // actor_name enriquecido com nome do usuário logado (JWT não carrega name).
  moveStage: async (demandId, payload) => {
    const { data } = await api.patch(`/demands/${demandId}/stage`, payload)
    const demand   = data.demand ?? data
    const rawEvent = data.event
    set({ demand })
    if (rawEvent) {
      const user  = useAuthStore.getState().user
      const event = { ...rawEvent, actor_name: rawEvent.actor_name ?? user?.name ?? null }
      // IMUTÁVEL: cria novo array — NUNCA modifica state.timelineItems in-place.
      // Zustand detecta a mudança pela referência; atribuição direta (items[0]=x)
      // não notificaria os subscribers e causaria re-render inconsistente.
      set(state => ({ timelineItems: [event, ...state.timelineItems] }))
    }
  },

  // ── assignUser ─────────────────────────────────────────────────────────────
  // Atribui responsável mantendo a etapa atual.
  assignUser: async (demandId, userId) => {
    const demand = get().demand
    if (!demand) throw new Error('Demanda não carregada')
    const { data } = await api.patch(`/demands/${demandId}/stage`, {
      stage_id:    demand.current_stage_id,
      assignee_id: userId,
    })
    const updatedDemand = data.demand ?? data
    const rawEvent      = data.event
    set({ demand: updatedDemand })
    if (rawEvent) {
      const user  = useAuthStore.getState().user
      const event = { ...rawEvent, actor_name: rawEvent.actor_name ?? user?.name ?? null }
      // IMUTÁVEL: spread cria novo array sem tocar em state.timelineItems
      set(state => ({ timelineItems: [event, ...state.timelineItems] }))
    }
  },

  // ── setExceptionState ──────────────────────────────────────────────────────
  // PATCH /demands/:id/exception → { demand, event }
  setExceptionState: async (demandId, exceptionState, notes) => {
    const { data } = await api.patch(`/demands/${demandId}/exception`, {
      exception_state: exceptionState,
      ...(notes ? { notes } : {}),
    })
    const updatedDemand = data.demand ?? data
    const rawEvent      = data.event
    set({ demand: updatedDemand })
    if (rawEvent) {
      const user  = useAuthStore.getState().user
      const event = { ...rawEvent, actor_name: rawEvent.actor_name ?? user?.name ?? null }
      // IMUTÁVEL: spread cria novo array sem tocar em state.timelineItems
      set(state => ({ timelineItems: [event, ...state.timelineItems] }))
    }
  },

  // ── reset ──────────────────────────────────────────────────────────────────
  reset: () => {
    const { _demandController, _timelineController } = get()
    if (_demandController)   _demandController.abort()
    if (_timelineController) _timelineController.abort()
    set({
      demand:          null,
      timelineItems:   [],
      hasMore:         false,
      nextCursor:      null,
      stages:          [],
      isLoadingStages: false,
      isLoadingDemand:   false,
      isLoadingTimeline: false,
      isLoadingMore:     false,
      errorDemand:    null,
      errorTimeline:  null,
      _demandController:   null,
      _timelineController: null,
    })
  },
}))
