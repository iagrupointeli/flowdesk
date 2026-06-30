import axios    from 'axios'
import { create } from 'zustand'
import api from '../lib/api'

/**
 * Store do Dashboard de Métricas (/dashboard).
 *
 * ── Responsabilidades ──────────────────────────────────────────────────────────
 *   fetch(filters)   GET /dashboard → { metrics, charts }
 *   reset()          aborta in-flight + zera estado
 *
 * ── AbortController ──────────────────────────────────────────────────────────
 *   fetchDashboard aborta qualquer request anterior antes de iniciar um novo.
 *   Garante que filtros rápidos (ex: trocar departamento várias vezes) não
 *   produzam race conditions — apenas o último resultado é aplicado ao estado.
 *
 * ── Isolamento de loading ─────────────────────────────────────────────────────
 *   isLoading  true durante qualquer fetch (inicial ou re-fetch por filtro)
 *   error      string | null
 *
 * ── Forma dos dados ───────────────────────────────────────────────────────────
 *   metrics:
 *     total_demands, on_hold_count, cancelled_count, finalized_count,
 *     finalization_rate (0–100), avg_resolution_hours (null se sem dados)
 *
 *   charts:
 *     by_stage:      [{ stage_name, count }]
 *     by_department: [{ dept_name,  count }]
 */
export const useDashboardStore = create((set, get) => ({

  // ── Estado ─────────────────────────────────────────────────────────────────
  metrics:   null,
  charts:    null,
  isLoading: false,
  error:     null,
  _controller: null,

  // ── fetch(filters) ─────────────────────────────────────────────────────────
  // filters: { dept_id?, date_from?, date_to? }
  fetch: async (filters = {}) => {
    const prev = get()._controller
    if (prev) prev.abort()

    const controller = new AbortController()
    set({ isLoading: true, error: null, _controller: controller })

    try {
      const params = {}
      if (filters.dept_id)   params.dept_id   = filters.dept_id
      if (filters.date_from) params.date_from  = filters.date_from
      if (filters.date_to)   params.date_to    = filters.date_to

      const { data } = await api.get('/dashboard', { params, signal: controller.signal })
      set({
        metrics:     data.metrics ?? null,
        charts:      data.charts  ?? null,
        isLoading:   false,
        _controller: null,
      })
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED' || err?.name === 'AbortError') return
      set({
        isLoading:   false,
        error:       err?.response?.data?.error ?? 'Erro ao carregar o dashboard.',
        _controller: null,
      })
    }
  },

  // ── reset ──────────────────────────────────────────────────────────────────
  reset: () => {
    const { _controller } = get()
    if (_controller) _controller.abort()
    set({ metrics: null, charts: null, isLoading: false, error: null, _controller: null })
  },
}))
