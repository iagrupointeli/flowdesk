import { useEffect, useState } from 'react'
import { useDemandDetailStore } from '../../stores/demandDetailStore'
import UserSelect               from '../kanban/UserSelect'

/**
 * Modal de atribuição de responsável — contexto da página de detalhes.
 *
 * Usa UserSelect scoped ao department_id da demanda (mesmo componente do Board).
 * Internamente chama demandDetailStore.assignUser, que faz PATCH /demands/:id/stage
 * mantendo o stage_id atual e atualizando apenas o assignee_id.
 *
 * Props:
 *   demand   — objeto completo da demanda (id, department_id, current_assignee_name…)
 *   onClose  — fecha o modal
 */
export default function AssignModal({ demand, onClose }) {
  const [assignee,     setAssignee]     = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error,        setError]        = useState(null)

  // Fecha com Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !isSubmitting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, isSubmitting])

  async function handleConfirm() {
    if (!assignee) { setError('Selecione um responsável.'); return }

    setIsSubmitting(true)
    setError(null)

    try {
      await useDemandDetailStore.getState().assignUser(demand.id, assignee.id)
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error ?? err?.response?.data?.message ?? 'Erro ao atribuir responsável.')
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-modal-title"
      onClick={e => { if (e.target === e.currentTarget && !isSubmitting) onClose() }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">

        {/* Título */}
        <h2 id="assign-modal-title" className="text-lg font-semibold text-gray-900">
          Atribuir Responsável
        </h2>
        {demand.assignee_name && (
          <p className="mt-1 text-sm text-gray-500">
            Responsável atual:{' '}
            <span className="font-medium text-gray-700">{demand.assignee_name}</span>
          </p>
        )}

        {/* Erro */}
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* UserSelect scoped ao departamento da demanda */}
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Novo responsável <span className="text-red-500">*</span>
          </label>
          <UserSelect
            departmentId={demand.department_id}
            value={assignee}
            onChange={setAssignee}
            disabled={isSubmitting}
            required
          />
        </div>

        {/* Ações */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                       text-gray-600 transition-colors hover:bg-gray-50
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !assignee}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                       text-white transition-colors hover:bg-primary-700
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Atribuindo…
              </span>
            ) : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
