import { create } from 'zustand'
import api from '../lib/api'
import { useAuthStore } from './authStore'

/**
 * Store de Notificações — SSE + estado local.
 *
 * ── Ciclo de vida ─────────────────────────────────────────────────────────────
 *
 *   AppLayout monta  → connect()    → solicita ticket → abre EventSource
 *   AppLayout desmonta → disconnect() → fecha ES + cancela timer de reconexão
 *
 * ── Estratégia de ticket SSE ──────────────────────────────────────────────────
 *
 *   O access token (TTL 1h) nunca vai na URL. Um mini-token (ticket, 15s) é
 *   solicitado via POST /notifications/ticket antes de cada abertura de EventSource.
 *
 * ── Reconexão manual (anti-loop de 401) ──────────────────────────────────────
 *
 *   PROBLEMA: EventSource reconecta automaticamente com a MESMA URL.
 *   Como o ?ticket= expira em 15s, a reconexão nativa gera um loop de 401s.
 *
 *   SOLUÇÃO: no onerror, cancelamos a reconexão nativa explicitamente (es.close()),
 *   limpamos a referência e agendamos connect() via setTimeout(4s).
 *   connect() solicita um novo ticket antes de abrir o EventSource,
 *   quebrando o loop completamente.
 *
 *   Guard de logout: o timer verifica useAuthStore().accessToken antes de
 *   reconectar. disconnect() cancela o timer pendente via clearTimeout.
 *
 * ── Estado ────────────────────────────────────────────────────────────────────
 *
 *   notifications   — lista paginada; novas chegam no topo
 *   unreadCount     — contador independente (incrementado pelo SSE)
 *   hasMore         — há páginas anteriores (mais antigas) a carregar
 *   nextCursor/nextCursorId — cursores para fetchMore()
 *   _eventSource    — instância atual do EventSource (interno)
 *   _reconnectTimer — handle do setTimeout de reconexão (interno)
 */

export const useNotificationStore = create((set, get) => ({

  // ── Estado público ─────────────────────────────────────────────────────────
  notifications:   [],
  unreadCount:     0,
  hasMore:         false,
  nextCursor:      null,
  nextCursorId:    null,
  isLoading:       false,
  error:           null,

  // ── Estado interno ─────────────────────────────────────────────────────────
  _eventSource:    null,
  _reconnectTimer: null,

  // ── connect ────────────────────────────────────────────────────────────────
  connect: async () => {
    // Cancela qualquer reconexão pendente antes de iniciar uma nova
    const { _reconnectTimer } = get()
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer)
      set({ _reconnectTimer: null })
    }

    // Fecha conexão anterior se existir
    const existing = get()._eventSource
    if (existing) existing.close()

    // ── Passo 1: solicita mini-token SSE (ticket de 15s) ────────────────────
    // Axios interceptor envia o Bearer access token normalmente.
    // Passamos apenas o ticket de curta duração na URL — access token nunca
    // aparece em logs de servidor (Nginx, Cloudflare, ALB…).
    let ticket
    try {
      const { data } = await api.post('/notifications/ticket')
      ticket = data.ticket
    } catch {
      // Usuário não autenticado ou erro de rede — não conecta.
      // O interceptor Axios cuida de renovar o token; se falhar, faz logout.
      return
    }

    // ── Passo 2: abre EventSource com o ticket ───────────────────────────────
    const url = `/api/notifications/stream?ticket=${encodeURIComponent(ticket)}`
    const es  = new EventSource(url, { withCredentials: true })

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.type === 'notification' && payload.data) {
          set(state => ({
            notifications: [payload.data, ...state.notifications],
            unreadCount:   state.unreadCount + 1,
          }))
        }
      } catch {
        // JSON parse error — ignorar evento malformado
      }
    }

    // ── onerror: CANCELA a reconexão nativa e agenda uma manual com novo ticket
    //
    // Por que cancelar a nativa? O EventSource tentaria reconectar com a mesma
    // URL (?ticket=<expirado>) → 401 em loop.
    //
    // Por que 4s? Suficiente para o backend reiniciar em caso de crash,
    // e pouco o suficiente para o usuário não perceber a interrupção.
    es.onerror = () => {
      // 1. Cancela a reconexão automática do browser
      es.close()
      set({ _eventSource: null })

      // 2. Não reconecta se o usuário já fez logout
      if (!useAuthStore.getState().accessToken) return

      // 3. Agenda reconexão manual com novo ticket
      const timer = setTimeout(() => {
        set({ _reconnectTimer: null })
        // Guard duplo: verifica de novo quando o timer disparar
        if (useAuthStore.getState().accessToken) {
          get().connect()
        }
      }, 4_000)

      set({ _reconnectTimer: timer })
    }

    set({ _eventSource: es })

    // Carrega lista inicial de notificações após abrir o stream
    get().fetchNotifications()
  },

  // ── disconnect ─────────────────────────────────────────────────────────────
  disconnect: () => {
    const { _eventSource, _reconnectTimer } = get()
    if (_eventSource)    _eventSource.close()
    if (_reconnectTimer) clearTimeout(_reconnectTimer)
    set({
      notifications:   [],
      unreadCount:     0,
      hasMore:         false,
      nextCursor:      null,
      nextCursorId:    null,
      isLoading:       false,
      error:           null,
      _eventSource:    null,
      _reconnectTimer: null,
    })
  },

  // ── fetchNotifications (primeira página) ───────────────────────────────────
  fetchNotifications: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data } = await api.get('/notifications')
      set({
        notifications: data.items ?? [],
        unreadCount:   data.unreadCount  ?? 0,
        hasMore:       data.hasMore      ?? false,
        nextCursor:    data.nextCursor   ?? null,
        nextCursorId:  data.nextCursorId ?? null,
        isLoading:     false,
      })
    } catch (err) {
      set({ isLoading: false, error: err?.response?.data?.error ?? 'Erro ao carregar notificações.' })
    }
  },

  // ── fetchMore (páginas seguintes — itens mais antigos) ─────────────────────
  fetchMore: async () => {
    const { hasMore, nextCursor, nextCursorId, isLoading } = get()
    if (!hasMore || isLoading) return
    set({ isLoading: true })
    try {
      const { data } = await api.get('/notifications', {
        params: { cursor: nextCursor, cursor_id: nextCursorId },
      })
      set(state => ({
        notifications: [...state.notifications, ...(data.items ?? [])],
        hasMore:       data.hasMore      ?? false,
        nextCursor:    data.nextCursor   ?? null,
        nextCursorId:  data.nextCursorId ?? null,
        isLoading:     false,
      }))
    } catch {
      set({ isLoading: false })
    }
  },

  // ── markAsRead (otimista) ──────────────────────────────────────────────────
  markAsRead: async (id) => {
    set(state => ({
      notifications: state.notifications.map(n =>
        n.id === id ? { ...n, is_read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - (
        state.notifications.find(n => n.id === id && !n.is_read) ? 1 : 0
      )),
    }))
    try {
      await api.patch(`/notifications/${id}/read`)
    } catch {
      get().fetchNotifications()
    }
  },

  // ── markAllRead (otimista) ─────────────────────────────────────────────────
  markAllRead: async () => {
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, is_read: true })),
      unreadCount:   0,
    }))
    try {
      await api.patch('/notifications/read-all')
    } catch {
      get().fetchNotifications()
    }
  },
}))
