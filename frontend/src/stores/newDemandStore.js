import axios    from 'axios'
import { create } from 'zustand'
import api from '../lib/api'

/**
 * Store para o formulário de criação de demanda (/demands/new).
 *
 * Responsabilidade única: buscar e cachear o typeDetail (campos + metadados)
 * do tipo de demanda selecionado.
 *
 * Regras:
 *   - AbortController cancela fetches anteriores (evita race condition ao
 *     navegar rapidamente entre tipos).
 *   - reset() é chamado pelo cleanup do useEffect em NewDemand.jsx ao desmontar.
 *   - Submit e upload NÃO estão na store — são mutações pontuais chamadas
 *     diretamente do componente via api (não são estado global reativo).
 *
 * typeDetail shape:
 *   { id, name, department_id, department_name,
 *     fields: [{ id, label, field_type, required, options, display_order }] }
 */
export const useNewDemandStore = create((set, get) => ({

  // ── Estado ─────────────────────────────────────────────────────────────────
  typeDetail:       null,
  isLoading:        false,
  error:            null,
  _abortController: null,

  // ── fetchTypeDetail(typeId) ────────────────────────────────────────────────
  // GET /api/demand-types/:id/fields
  fetchTypeDetail: async (typeId) => {
    // Aborta eventual chamada anterior em voo
    const prev = get()._abortController
    if (prev) prev.abort()

    const controller = new AbortController()
    set({ isLoading: true, error: null, typeDetail: null, _abortController: controller })

    try {
      const { data } = await api.get(`/demand-types/${typeId}/fields`, {
        signal: controller.signal,
      })
      set({ typeDetail: data, isLoading: false, _abortController: null })
    } catch (err) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return

      set({
        isLoading:        false,
        error:            err?.response?.data?.error ?? 'Erro ao carregar o tipo de demanda.',
        _abortController: null,
      })
    }
  },

  // ── reset() ────────────────────────────────────────────────────────────────
  // Chamado no cleanup do useEffect de NewDemand.jsx.
  reset: () => {
    const { _abortController } = get()
    if (_abortController) _abortController.abort()
    set({ typeDetail: null, isLoading: false, error: null, _abortController: null })
  },
}))
