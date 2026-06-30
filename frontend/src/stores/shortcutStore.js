import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// byUser: { [userId]: Shortcut[] }
// Shortcut: { id, label, to, icon, color? }
// Não há método "shortcuts" — componentes selecionam s.byUser[userId] diretamente
// para que Zustand detecte mudanças e dispare re-renders.

export const useShortcutStore = create(
  persist(
    (set, get) => ({
      byUser: {},

      add(userId, shortcut) {
        const current = get().byUser[userId] ?? []
        if (current.some(s => s.to === shortcut.to)) return
        set(state => ({
          byUser: {
            ...state.byUser,
            [userId]: [...current, { ...shortcut, id: crypto.randomUUID() }],
          },
        }))
      },

      remove(userId, id) {
        set(state => ({
          byUser: {
            ...state.byUser,
            [userId]: (state.byUser[userId] ?? []).filter(s => s.id !== id),
          },
        }))
      },

      reorder(userId, shortcuts) {
        set(state => ({ byUser: { ...state.byUser, [userId]: shortcuts } }))
      },
    }),
    { name: 'flowdesk-shortcuts' }
  )
)
