import { create }    from 'zustand'
import { io }        from 'socket.io-client'
import api           from '../lib/api'
import { useAuthStore } from './authStore'

export const useChatStore = create((set, get) => ({

  // ── Estado ──────────────────────────────────────────────────────────────────
  channels:              [],   // { id, type, name, unread_count, last_msg_body, last_msg_at, last_msg_sender }
  activeChannelId:       null,
  messagesByChannel:     {},   // { [channelId]: Message[] }
  typingByChannel:       {},   // { [channelId]: { [userId]: { userName, timer } } }
  _socket:               null,

  // ── Derivado ─────────────────────────────────────────────────────────────────
  get totalUnread() {
    return get().channels.reduce((sum, c) => sum + (c.unread_count ?? 0), 0)
  },

  // ── initSocket ───────────────────────────────────────────────────────────────
  initSocket: () => {
    if (get()._socket?.connected) return

    const accessToken = useAuthStore.getState().accessToken
    if (!accessToken) return

    const socket = io('/', {
      path:              '/socket.io',
      auth:              { token: accessToken },
      transports:        ['websocket', 'polling'],
      reconnectionDelay: 2000,
    })

    socket.on('chat:message', (msg) => {
      set(state => {
        const prev = state.messagesByChannel[msg.channel_id] ?? []
        // Evita duplicata por re-emit
        if (prev.some(m => m.id === msg.id)) return {}
        const updated = [...prev, msg]

        // Incrementa unread se não está no canal ativo
        const channels = state.activeChannelId === msg.channel_id
          ? state.channels
          : state.channels.map(c =>
              c.id === msg.channel_id
                ? { ...c, unread_count: (c.unread_count ?? 0) + 1,
                    last_msg_body: msg.body, last_msg_at: msg.created_at,
                    last_msg_sender: msg.sender_name }
                : c
            )

        return {
          messagesByChannel: { ...state.messagesByChannel, [msg.channel_id]: updated },
          channels,
        }
      })
    })

    socket.on('chat:typing', ({ channelId, userId, userName }) => {
      set(state => {
        const prev = state.typingByChannel[channelId] ?? {}
        // Limpa timer anterior se existir
        if (prev[userId]?.timer) clearTimeout(prev[userId].timer)
        const timer = setTimeout(() => {
          set(s => {
            const { [userId]: _, ...rest } = s.typingByChannel[channelId] ?? {}
            return { typingByChannel: { ...s.typingByChannel, [channelId]: rest } }
          })
        }, 3000)
        return {
          typingByChannel: {
            ...state.typingByChannel,
            [channelId]: { ...prev, [userId]: { userName, timer } },
          },
        }
      })
    })

    socket.on('chat:read_ack', ({ channelId, userId }) => {
      // Zera unread do próprio usuário ao receber ack
      if (userId === useAuthStore.getState().user?.id) {
        set(state => ({
          channels: state.channels.map(c =>
            c.id === channelId ? { ...c, unread_count: 0 } : c
          ),
        }))
      }
    })

    socket.on('connect', () => {
      get().channels.forEach(c => socket.emit('chat:join', { channelId: c.id }))
    })

    socket.on('chat:message_deleted', ({ channelId, messageId }) => {
      set(state => ({
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: (state.messagesByChannel[channelId] ?? []).filter(m => m.id !== messageId),
        },
      }))
    })

    socket.on('disconnect', () => {
      // Só nula se ainda somos o socket ativo (evita StrictMode race condition)
      if (get()._socket === socket) set({ _socket: null })
    })

    set({ _socket: socket })
  },

  // ── disconnectSocket ─────────────────────────────────────────────────────────
  disconnectSocket: () => {
    get()._socket?.disconnect()
    set({ _socket: null, channels: [], activeChannelId: null, messagesByChannel: {}, typingByChannel: {} })
  },

  // ── fetchChannels ─────────────────────────────────────────────────────────────
  fetchChannels: async () => {
    try {
      const { data } = await api.get('/chat')
      set({ channels: data })
      // Entra nas rooms de todos os canais
      const socket = get()._socket
      if (socket) data.forEach(c => socket.emit('chat:join', { channelId: c.id }))
    } catch { /* silencioso — canal vazio */ }
  },

  // ── setActiveChannel ─────────────────────────────────────────────────────────
  setActiveChannel: async (channelId) => {
    set({ activeChannelId: channelId })
    // Garante que o socket está na room (idempotente no servidor)
    const socket = get()._socket
    if (socket) socket.emit('chat:join', { channelId })
    // Carrega mensagens se ainda não tem
    if (!get().messagesByChannel[channelId]) {
      await get().fetchMessages(channelId)
    }
    // Marca como lido
    if (socket) socket.emit('chat:read', { channelId })
    // Zera unread localmente (otimista)
    set(state => ({
      channels: state.channels.map(c =>
        c.id === channelId ? { ...c, unread_count: 0 } : c
      ),
    }))
  },

  // ── fetchMessages (histórico paginado) ───────────────────────────────────────
  fetchMessages: async (channelId, cursor = null) => {
    try {
      const params = { limit: 50 }
      if (cursor) params.cursor = cursor
      const { data } = await api.get(`/chat/${channelId}/messages`, { params })
      set(state => {
        const prev = state.messagesByChannel[channelId] ?? []
        // Prepend histórico mais antigo; evita duplicatas
        const existingIds = new Set(prev.map(m => m.id))
        const fresh = data.filter(m => !existingIds.has(m.id))
        return { messagesByChannel: { ...state.messagesByChannel, [channelId]: [...fresh, ...prev] } }
      })
      return data
    } catch { return [] }
  },

  // ── sendMessage ───────────────────────────────────────────────────────────────
  sendMessage: async ({ channelId, body, replyTo }) => {
    try {
      const { data: message } = await api.post(`/chat/${channelId}/messages`, {
        body,
        reply_to: replyTo || null,
      })
      set(state => {
        const prev = state.messagesByChannel[channelId] ?? []
        if (prev.some(m => m.id === message.id)) return {}
        return { messagesByChannel: { ...state.messagesByChannel, [channelId]: [...prev, message] } }
      })
    } catch { /* silencioso */ }
  },

  // ── deleteMessage ─────────────────────────────────────────────────────────────
  deleteMessage: async (channelId, messageId) => {
    // Optimistic
    set(state => ({
      messagesByChannel: {
        ...state.messagesByChannel,
        [channelId]: (state.messagesByChannel[channelId] ?? []).filter(m => m.id !== messageId),
      },
    }))
    try {
      await api.delete(`/chat/messages/${messageId}`)
    } catch {
      get().fetchMessages(channelId)
    }
  },

  // ── sendTyping ────────────────────────────────────────────────────────────────
  sendTyping: (channelId) => {
    get()._socket?.emit('chat:typing', { channelId })
  },
}))
