import { useState } from 'react'
import UserSelect from './UserSelect'

/**
 * Modal de confirmação de movimentação entre colunas do Kanban.
 *
 * Regra do Zero Snapback:
 *   Este modal é exibido APENAS quando a coluna de destino exige
 *   nota (requires_note) ou responsável (requires_assignee).
 *   O card NÃO foi movido no Zustand quando este modal abre —
 *   permanece visualmente na coluna de origem.
 *   A store só é atualizada quando o usuário clicar em "Confirmar".
 *   Cancelar limpa o pendingMove sem tocar na store.
 *
 * Props:
 *   pendingMove  — { demandId, fromStageId, toStageId, targetStage }
 *   onConfirm(payload) — async; chamado com { ...pendingMove, note, assigneeId }
 *   onCancel()   — limpa pendingMove (card não move)
 *
 * UserSelect:
 *   Campo de busca assíncrona de usuários (GET /users?q=...).
 *   Retorna { id, name, email }; o payload usa apenas o `id`.
 *   Exibido apenas quando targetStage.requires_assignee = true.
 */
export default function MoveModal({ pendingMove, onConfirm, onCancel }) {
  const [note,          setNote]          = useState('')
  const [selectedUser,  setSelectedUser]  = useState(null)
  const [isLoading,     setIsLoading]     = useState(false)
  const [error,         setError]         = useState(null)

  const { targetStage } = pendingMove
  const requiresNote     = targetStage?.requires_note     ?? false
  const requiresAssignee = targetStage?.requires_assignee ?? false

  // department_id da demanda para filtrar usuários no UserSelect
  // pendingMove pode não ter este dado ainda — UserSelect aceita undefined
  const departmentId = pendingMove.demand?.department_id

  // ── Validação ──────────────────────────────────────────────────────────────
  function validate() {
    if (requiresNote     && !note.trim())           return 'A justificativa é obrigatória para esta coluna.'
    if (requiresAssignee && !selectedUser)          return 'O responsável é obrigatório para esta coluna.'
    return null
  }

  // ── Confirmar ─────────────────────────────────────────────────────────────
  async function handleConfirm() {
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setIsLoading(true)
    setError(null)

    try {
      await onConfirm({
        ...pendingMove,
        note:       note.trim() || undefined,
        assigneeId: selectedUser?.id ?? undefined,
      })
      // onConfirm bem-sucedido → Board.jsx limpa pendingMove e fecha o modal
    } catch (err) {
      // A store já reverteu o estado otimista (moveCardOptimistic)
      setError(err?.response?.data?.message ?? err?.response?.data?.error ?? 'Erro ao mover a demanda.')
      setIsLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' && !isLoading) onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        {/* Título */}
        <h2 id="move-modal-title" className="text-lg font-semibold text-gray-900">
          Mover para &ldquo;{targetStage?.name}&rdquo;
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {requiresNote || requiresAssignee
            ? 'Preencha as informações obrigatórias para confirmar.'
            : 'Confirme a movimentação desta demanda.'}
        </p>

        {/* Erro */}
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Campos */}
        <div className="mt-4 space-y-4">

          {/* Nota — sempre oferecida, obrigatória só se requires_note */}
          <div>
            <label htmlFor="move-note" className="mb-1 block text-sm font-medium text-gray-700">
              Justificativa{' '}
              {requiresNote
                ? <span className="text-red-500">*</span>
                : <span className="font-normal text-gray-400">(opcional)</span>}
            </label>
            <textarea
              id="move-note"
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={isLoading}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm
                         placeholder-gray-400
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                         disabled:bg-gray-50"
              placeholder="Descreva o motivo da movimentação…"
            />
          </div>

          {/* Responsável — exibido apenas se requires_assignee */}
          {requiresAssignee && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Responsável <span className="text-red-500">*</span>
              </label>
              <UserSelect
                departmentId={departmentId}
                value={selectedUser}
                onChange={setSelectedUser}
                disabled={isLoading}
                required={true}
              />
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                       text-gray-600 transition-colors hover:bg-gray-50
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                       text-white transition-colors hover:bg-primary-700
                       disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
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
