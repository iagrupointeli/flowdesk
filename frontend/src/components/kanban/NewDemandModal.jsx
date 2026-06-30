import { useNavigate } from 'react-router-dom'
import { useDemandTypeStore } from '../../stores/demandTypeStore'

/**
 * Modal de seleção de Tipo de Demanda para criar uma nova demanda.
 *
 * Fluxo:
 *   1. Usuário clica "Nova Demanda" na Sidebar
 *   2. Modal lista os tipos disponíveis (do demandTypeStore — já carregados)
 *   3. Usuário seleciona um tipo → navega para /demands/new?type=<id>
 *      (Fase 8: formulário de criação com campos dinâmicos)
 *
 * Props:
 *   onClose() — fecha o modal
 *
 * Por que não buscamos os tipos aqui?
 *   demandTypeStore.fetchDemandTypes() já foi chamado pelo AppLayout na montagem.
 *   Reutilizamos o cache em memória — zero request duplicado.
 *   Se os tipos ainda estiverem carregando, exibimos skeleton.
 */
export default function NewDemandModal({ onClose }) {
  const demandTypes = useDemandTypeStore(s => s.demandTypes)
  const isLoading   = useDemandTypeStore(s => s.isLoading)
  const error       = useDemandTypeStore(s => s.error)
  const navigate    = useNavigate()

  function handleSelect(demandTypeId) {
    onClose()
    navigate(`/demands/new?type=${demandTypeId}`)
  }

  // Agrupa por departamento para facilitar a leitura
  const grouped = demandTypes.reduce((acc, dt) => {
    const key = dt.department_name ?? 'Sem departamento'
    if (!acc[key]) acc[key] = []
    acc[key].push(dt)
    return acc
  }, {})

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-demand-modal-title"
      onKeyDown={e => e.key === 'Escape' && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="new-demand-modal-title" className="text-lg font-semibold text-gray-900">
            Nova Demanda
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-500">
          Selecione o tipo de demanda para continuar.
        </p>

        {/* Estado de carregamento */}
        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        )}

        {/* Erro */}
        {!isLoading && error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button
              onClick={() => useDemandTypeStore.getState().fetchDemandTypes()}
              className="ml-2 underline hover:no-underline"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Lista agrupada por departamento */}
        {!isLoading && !error && (
          <div className="max-h-80 overflow-y-auto space-y-4">
            {Object.keys(grouped).length === 0 ? (
              <p className="text-center text-sm text-gray-400">
                Nenhum tipo de demanda disponível.
              </p>
            ) : (
              Object.entries(grouped).map(([deptName, types]) => (
                <div key={deptName}>
                  <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {deptName}
                  </p>
                  <div className="space-y-1">
                    {types.map(dt => (
                      <button
                        key={dt.id}
                        type="button"
                        onClick={() => handleSelect(dt.id)}
                        className="flex w-full items-center rounded-lg px-3 py-2.5 text-left
                                   text-sm font-medium text-gray-700 transition-colors
                                   hover:bg-primary-50 hover:text-primary-700
                                   focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <span className="mr-2 flex-shrink-0 text-gray-400">📋</span>
                        {dt.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                       text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
