import { useDroppable } from '@dnd-kit/core'
import Card from './Card'

/**
 * Coluna do Quadro Kanban.
 *
 * Props:
 *   stage    — { id, name, color, requires_note, requires_assignee, wip_limit }
 *   demands  — demand[] para esta coluna
 *
 * WIP Limit:
 *   Quando stage.wip_limit é definido e demands.length > wip_limit,
 *   o cabeçalho fica vermelho e o contador exibe "atual/limite".
 *
 * Regra anti-colisão (CRÍTICA):
 *   O `id` do droppable usa prefixo "col-" para evitar colisão com IDs de cards.
 *   O stageId REAL é exposto via `data.current.stageId`.
 *
 *   Em onDragEnd no Board:
 *     over.data.current.stageId  →  toStageId  ✅  (correto)
 *     over.id                    →  "col-<uuid>"  ❌ (não usar diretamente)
 *
 *   Sem esse padrão, quando o usuário solta o card sobre um Card-filho
 *   em vez do drop zone da coluna, `over.id` seria o ID do card, não da coluna.
 */
export default function Column({ stage, demands, selectionMode = false, selectedIds = new Set(), onToggleSelect }) {
  const { setNodeRef, isOver } = useDroppable({
    id:   `col-${stage.id}`,
    data: { stageId: stage.id },  // CRÍTICO: extraído via over.data.current em onDragEnd
  })

  const accentColor = stage.color ?? '#94a3b8'
  const isOverWip   = stage.wip_limit != null && demands.length > stage.wip_limit

  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-xl bg-gray-100">
      {/* Cabeçalho da coluna */}
      <div className={`flex items-center justify-between rounded-t-xl px-4 py-3 ${
        isOverWip ? 'bg-red-50' : ''
      }`}>
        <div className="flex items-center gap-2">
          {/* Indicador de cor */}
          <span
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: accentColor }}
            aria-hidden="true"
          />
          <h3 className="text-sm font-semibold text-gray-700 leading-none">{stage.name}</h3>
        </div>

        {/* Contador — exibe atual/limite quando wip_limit está definido */}
        <span
          title={isOverWip ? `Limite WIP excedido (${demands.length}/${stage.wip_limit})` : undefined}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isOverWip
              ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
              : 'bg-gray-200 text-gray-500'
          }`}
        >
          {demands.length}{stage.wip_limit != null ? `/${stage.wip_limit}` : ''}
        </span>
      </div>

      {/* Área de drop */}
      <div
        ref={setNodeRef}
        className={`
          mx-2 mb-2 flex flex-1 flex-col gap-2 rounded-lg p-2
          min-h-[120px] transition-colors duration-150
          ${isOver ? 'bg-primary-50 ring-2 ring-primary-300' : 'bg-transparent'}
        `}
      >
        {demands.map(demand => (
          <Card
            key={demand.id}
            demand={demand}
            stageId={stage.id}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(demand.id)}
            onToggle={onToggleSelect}
          />
        ))}

        {/* Placeholder visual quando coluna vazia */}
        {demands.length === 0 && !isOver && (
          <div className="flex flex-1 items-center justify-center rounded-md border-2 border-dashed border-gray-200">
            <span className="text-xs text-gray-300">Sem demandas</span>
          </div>
        )}
      </div>
    </div>
  )
}
