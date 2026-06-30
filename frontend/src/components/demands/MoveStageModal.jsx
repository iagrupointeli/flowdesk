import { useEffect, useState } from 'react'
import { useDemandDetailStore } from '../../stores/demandDetailStore'
import UserSelect               from '../kanban/UserSelect'

/**
 * Modal de movimentação de etapa — contexto da página de detalhes.
 *
 * Reaplica a MESMA inteligência do MoveModal do Kanban:
 *   - Se a etapa destino requer nota (requires_note) → exibe textarea obrigatória
 *   - Se a etapa destino requer responsável (requires_assignee) → exibe UserSelect
 * Não duplica lógica — o check vem direto dos campos requires_* do objeto stage.
 *
 * Fluxo:
 *   1. Usuário clica "Mover Etapa" em DemandDetail
 *   2. Este modal busca os stages do tipo de demanda (lazy, na montagem)
 *   3. Usuário escolhe a etapa destino no <select>
 *   4. Campos opcionais/obrigatórios aparecem conforme requires_note / requires_assignee
 *   5. Confirmar → chama demandDetailStore.moveStage (PATCH + reload demand + timeline)
 *
 * Props:
 *   demand   — objeto completo da demanda (current_stage_id, demand_type_id, department_id…)
 *   onClose  — fecha o modal (nenhuma ação tomada)
 */
export default function MoveStageModal({ demand, onClose }) {
  const stages         = useDemandDetailStore(s => s.stages)
  const isLoadingStages = useDemandDetailStore(s => s.isLoadingStages)

  const [selectedStage, setSelectedStage] = useState(null)
  const [assignee,      setAssignee]      = useState(null)
  const [notes,         setNotes]         = useState('')
  const [isSubmitting,  setIsSubmitting]  = useState(false)
  const [error,         setError]         = useState(null)

  // Carrega as etapas do tipo ao montar (só se ainda não carregadas)
  useEffect(() => {
    useDemandDetailStore.getState().fetchStages(demand.demand_type_id)
  }, [demand.demand_type_id])

  // Fecha com Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !isSubmitting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, isSubmitting])

  // Etapas disponíveis: exclui a etapa atual
  const movableStages = stages.filter(s => s.id !== demand.current_stage_id)

  const requiresNote     = selectedStage?.requires_note     ?? false
  const requiresAssignee = selectedStage?.requires_assignee ?? false

  function validate() {
    if (!selectedStage)                        return 'Selecione a etapa de destino.'
    if (requiresNote && !notes.trim())         return 'A justificativa é obrigatória para esta etapa.'
    if (requiresAssignee && !assignee)         return 'O responsável é obrigatório para esta etapa.'
    return null
  }

  async function handleConfirm() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setIsSubmitting(true)
    setError(null)

    try {
      await useDemandDetailStore.getState().moveStage(demand.id, {
        stage_id:    selectedStage.id,
        assignee_id: assignee?.id ?? undefined,
        notes:       notes.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error ?? err?.response?.data?.message ?? 'Erro ao mover a demanda.')
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-stage-title"
      onClick={e => { if (e.target === e.currentTarget && !isSubmitting) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">

        {/* Título */}
        <h2 id="move-stage-title" className="text-lg font-semibold text-gray-900">
          Mover Etapa
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Etapa atual:{' '}
          <span className="font-medium text-gray-700">{demand.current_stage_name ?? '—'}</span>
        </p>

        {/* Erro */}
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">

          {/* Selector de etapa destino */}
          <div>
            <label htmlFor="stage-select" className="mb-1 block text-sm font-medium text-gray-700">
              Etapa de destino <span className="text-red-500">*</span>
            </label>

            {isLoadingStages ? (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-primary-500 inline-block" />
                Carregando etapas…
              </div>
            ) : movableStages.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma outra etapa disponível.</p>
            ) : (
              <select
                id="stage-select"
                value={selectedStage?.id ?? ''}
                onChange={e => {
                  const stage = movableStages.find(s => s.id === e.target.value) ?? null
                  setSelectedStage(stage)
                  setAssignee(null)
                  setNotes('')
                  setError(null)
                }}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50"
              >
                <option value="">Selecione a etapa de destino…</option>
                {movableStages.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Justificativa — sempre opcional exceto se requires_note */}
          {selectedStage && (
            <div>
              <label htmlFor="move-notes" className="mb-1 block text-sm font-medium text-gray-700">
                Justificativa{' '}
                {requiresNote
                  ? <span className="text-red-500">*</span>
                  : <span className="font-normal text-gray-400">(opcional)</span>}
              </label>
              <textarea
                id="move-notes"
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={isSubmitting}
                placeholder="Descreva o motivo da movimentação…"
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm
                           placeholder-gray-400
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50"
              />
            </div>
          )}

          {/* Responsável — exibido se requires_assignee */}
          {selectedStage && requiresAssignee && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Responsável <span className="text-red-500">*</span>
              </label>
              <UserSelect
                departmentId={demand.department_id}
                value={assignee}
                onChange={setAssignee}
                disabled={isSubmitting}
                required
              />
            </div>
          )}
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
            disabled={isSubmitting || !selectedStage || isLoadingStages}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                       text-white transition-colors hover:bg-primary-700
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Movendo…
              </span>
            ) : 'Confirmar movimentação'}
          </button>
        </div>
      </div>
    </div>
  )
}
