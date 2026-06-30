import axios    from 'axios'
import { create } from 'zustand'
import api from '../lib/api'

/**
 * Store de tipos de demanda (leitura para navegação e seleção).
 *
 * Usado por:
 *   - Sidebar (links dinâmicos por tipo de demanda)
 *   - NewDemandModal (seletor de tipo ao criar nova demanda)
 *
 * Carregado uma única vez na montagem do AppLayout (useEffect → store action).
 * AbortController cancela chamadas anteriores se fetchDemandTypes() for
 * invocado novamente (ex: troca de usuário sem reload da página).
 */
export const useDemandTypeStore = create((set, get) => ({

  // ── Estado ─────────────────────────────────────────────────────────────────
  demandTypes:      [],    // [{ id, name, department_id, department_name }]
  isLoading:        false,
  error:            null,
  _abortController: null,

  // ── fetchDemandTypes() ─────────────────────────────────────────────────────
  fetchDemandTypes: async () => {
    // Aborta eventual chamada anterior em voo
    const prev = get()._abortController
    if (prev) prev.abort()

    const controller = new AbortController()
    set({ isLoading: true, error: null, _abortController: controller })

    try {
      const { data } = await api.get('/demand-types', { signal: controller.signal })
      const demandTypes = Array.isArray(data) ? data : []

      set({ demandTypes, isLoading: false, _abortController: null })
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return

      set({
        isLoading:        false,
        error:            err?.response?.data?.error ?? 'Erro ao carregar tipos de demanda.',
        _abortController: null,
      })
    }
  },
}))
