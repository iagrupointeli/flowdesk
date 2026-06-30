import axios   from 'axios'
import { create } from 'zustand'
import api from '../lib/api'

export const useComercialStore = create((set, get) => ({

  byClient:    [],
  occupancy:   null,
  isLoading:   false,
  error:       null,
  _controller: null,

  fetch: async (filters = {}) => {
    const prev = get()._controller
    if (prev) prev.abort()

    const controller = new AbortController()
    set({ isLoading: true, error: null, _controller: controller })

    try {
      const params = {}
      if (filters.date_from) params.date_from = filters.date_from
      if (filters.date_to)   params.date_to   = filters.date_to

      const { data } = await api.get('/dashboard/commercial', { params, signal: controller.signal })
      set({
        byClient:    data.by_client ?? [],
        occupancy:   data.occupancy ?? null,
        isLoading:   false,
        _controller: null,
      })
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED' || err?.name === 'AbortError') return
      set({
        isLoading:   false,
        error:       err?.response?.data?.error ?? 'Erro ao carregar dados comerciais.',
        _controller: null,
      })
    }
  },

  reset: () => {
    const { _controller } = get()
    if (_controller) _controller.abort()
    set({ byClient: [], occupancy: null, isLoading: false, error: null, _controller: null })
  },
}))