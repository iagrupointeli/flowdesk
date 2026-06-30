import { useDraggable } from '@dnd-kit/core'
import { CSS }          from '@dnd-kit/utilities'
import { useNavigate }  from 'react-router-dom'
import SLABadge         from '../SLABadge'

/**
 * Card arrastável do Kanban.
 *
 * Props:
 *   demand  — objeto de demanda (id, title, department_id, requester, priority, …)
 *   stageId — ID da coluna onde o card reside atualmente
 *
 * Dados expostos via `data` do useDraggable (acessíveis em onDragEnd e no MoveModal):
 *   stageId      → fromStageId no onDragEnd
 *   departmentId → passado ao MoveModal para que o UserSelect filtre usuários
 *                  pelo departamento correto da demanda (sem vazar escopo)
 *
 * Regra anti-colisão:
 *   O id do draggable é sempre o demand.id (string).
 *   stageId e departmentId vêm de data.current — NUNCA de active.id.
 */
export default function Card({ demand, stageId, selectionMode = false, isSelected = false, onToggle }) {
  const navigate = useNavigate()

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id:   String(demand.id),   // id deve ser string para evitar colisões com IDs numéricos
    data: {
      stageId,
      // departmentId escopa o UserSelect no MoveModal ao departamento da demanda
      // Sem isso, o UserSelect buscaria usuários de todos os departamentos
      departmentId: demand.department_id ?? null,
      // Referência ao objeto demand completo — usado pelo MoveModal para exibir contexto
      demand,
    },
  })

  // CSS.Translate preserva o espaço ocupado pelo card original enquanto arrasta
  // (não usa CSS.Transform pois causaria scaling indesejado)
  const style = {
    transform: CSS.Translate.toString(transform),
    // Opacidade reduzida no original enquanto o ghost está sendo arrastado
    opacity:   isDragging ? 0.35 : 1,
    zIndex:    isDragging ? 999  : undefined,
  }

  const priorityColors = {
    low:      'bg-gray-100 text-gray-500',
    medium:   'bg-yellow-100 text-yellow-700',
    high:     'bg-red-100 text-red-600',
    critical: 'bg-red-600 text-white',
  }
  const priorityLabel = {
    low:      'Baixa',
    medium:   'Média',
    high:     'Alta',
    critical: 'Crítica',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => { if (!isDragging) navigate(`/demands/${demand.id}`) }}
      className={`
        relative rounded-lg border border-gray-200 bg-white p-3 shadow-sm
        select-none transition-shadow
        ${isDragging ? 'cursor-grabbing shadow-lg' : 'cursor-pointer hover:shadow-md hover:border-primary-200'}
      `}
      aria-roledescription="card arrastável"
    >
      {selectionMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(demand.id)}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          className="absolute top-2 left-2 z-10 h-4 w-4 accent-blue-600 cursor-pointer"
        />
      )}

      {/* Título */}
      <p className="text-sm font-medium leading-snug text-gray-800 line-clamp-2">
        {demand.title}
      </p>

      {/* Metadados */}
      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Solicitante */}
        {(demand.requester_name ?? demand.requester?.name) && (
          <span className="truncate text-xs text-gray-400">
            {demand.requester_name ?? demand.requester?.name}
          </span>
        )}

        {/* Prioridade */}
        {demand.priority && priorityColors[demand.priority] && (
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              priorityColors[demand.priority]
            }`}
          >
            {priorityLabel[demand.priority] ?? demand.priority}
          </span>
        )}
      </div>

      {/* SLA badge (só exibido se houver due_date) */}
      {demand.due_date && (
        <div className="mt-2">
          <SLABadge demand={demand} compact />
        </div>
      )}

      {/* Tags */}
      {Array.isArray(demand.tags) && demand.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {demand.tags.map(tag => (
            <span
              key={tag.id}
              title={tag.name}
              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: tag.color_hex }}
            />
          ))}
          <span className="text-[10px] text-gray-400 leading-none self-center">
            {demand.tags.map(t => t.name).join(', ')}
          </span>
        </div>
      )}

      {/* Número de protocolo (opcional) */}
      {demand.protocol_number && (
        <p className="mt-1.5 text-xs text-gray-300">#{demand.protocol_number}</p>
      )}
    </div>
  )
}
