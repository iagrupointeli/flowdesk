import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuthStore } from '../../stores/authStore'
import api from '../../lib/api'

/**
 * Construtor de Workflows — /admin/workflows
 *
 * ── Funcionalidades ───────────────────────────────────────────────────────────
 *
 *   Gerenciamento completo de tipos de demanda e suas etapas de workflow.
 *
 *   Tipos de demanda:
 *     - Listar (agrupados por departamento)
 *     - Criar / Renomear
 *     - Expandir para gerenciar etapas (accordion)
 *
 *   Etapas:
 *     - Listar (ativas + arquivadas, separadas visualmente)
 *     - Criar / Editar (nome + 3 toggles: exige resp., exige nota, é final)
 *     - Reordenar via drag-and-drop (@dnd-kit) → PATCH /reorder atômico
 *     - Arquivar — TRAVA ABSOLUTA: bloqueado se qualquer demanda vinculada
 *
 * ── RBAC ─────────────────────────────────────────────────────────────────────
 *
 *   super_admin → todos os tipos de demanda + criar em qualquer departamento
 *   dept_admin  → apenas tipos do seu departamento + criar no seu departamento
 *
 * ── Reordenação ───────────────────────────────────────────────────────────────
 *
 *   Otimista: a ordem é atualizada localmente no estado imediatamente.
 *   Em caso de falha do backend, o estado é revertido para a ordem anterior.
 *   Apenas etapas ATIVAS (archived_at IS NULL) são incluídas no DnD.
 */

export default function AdminWorkflows() {
  const actorRole = useAuthStore(s => s.user?.role)
  const navigate  = useNavigate()

  // ── Dados ───────────────────────────────────────────────────────────────────
  const [demandTypes, setDemandTypes] = useState([])
  const [departments, setDepartments] = useState([])
  const [stagesByType, setStagesByType] = useState({})    // typeId → stages[]
  const [expandedTypes, setExpandedTypes] = useState(new Set())
  const [loadingStages, setLoadingStages] = useState(new Set()) // typeId em loading

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]         = useState(null)

  // ── Modais ──────────────────────────────────────────────────────────────────
  const [typeModal,  setTypeModal]  = useState(null) // null | { mode:'create'|'edit', type? }
  const [stageModal, setStageModal] = useState(null) // null | { mode, typeId, stage? }

  // ── Carregamento inicial ────────────────────────────────────────────────────
  useEffect(() => { loadInitialData() }, [])

  async function loadInitialData() {
    setIsLoading(true)
    setError(null)
    try {
      const [typesRes, deptsRes] = await Promise.all([
        api.get('/admin/demand-types'),
        api.get('/admin/departments'),
      ])
      setDemandTypes(typesRes.data ?? [])
      setDepartments(deptsRes.data ?? [])
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao carregar dados.')
    } finally {
      setIsLoading(false)
    }
  }

  // ── Toggle de expansão de tipo ──────────────────────────────────────────────
  async function toggleExpand(typeId) {
    const isOpen = expandedTypes.has(typeId)

    if (isOpen) {
      setExpandedTypes(prev => { const s = new Set(prev); s.delete(typeId); return s })
      return
    }

    // Abre + carrega etapas se ainda não carregadas
    setExpandedTypes(prev => new Set(prev).add(typeId))

    if (stagesByType[typeId] !== undefined) return  // já carregado

    setLoadingStages(prev => new Set(prev).add(typeId))
    try {
      const { data } = await api.get(`/admin/demand-types/${typeId}/stages`)
      setStagesByType(prev => ({ ...prev, [typeId]: data ?? [] }))
    } catch {
      setStagesByType(prev => ({ ...prev, [typeId]: [] }))
    } finally {
      setLoadingStages(prev => { const s = new Set(prev); s.delete(typeId); return s })
    }
  }

  // ── CRUD de tipos ───────────────────────────────────────────────────────────
  function handleTypeSaved(savedType, mode) {
    if (mode === 'create') {
      setDemandTypes(prev => [...prev, savedType])
    } else {
      setDemandTypes(prev => prev.map(t => t.id === savedType.id ? { ...t, ...savedType } : t))
    }
    setTypeModal(null)
  }

  async function handleArchiveType(type) {
    if (!window.confirm(
      `Arquivar o tipo "${type.name}"?\n\n` +
      `O tipo será removido do board e do formulário de novas demandas. ` +
      `Demandas existentes não serão afetadas.\n\n` +
      `Só é permitido se não houver demandas ativas ou em pausa.`
    )) return

    try {
      const { data } = await api.post(`/admin/demand-types/${type.id}/archive`)
      setDemandTypes(prev =>
        prev.map(t => t.id === type.id ? { ...t, archived_at: data.archived_at } : t)
      )
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao arquivar tipo.')
    }
  }

  async function handleDeleteType(type) {
    if (!window.confirm(
      `DELETAR permanentemente o workflow "${type.name}"?\n\n` +
      `Esta ação é irreversível. Todas as etapas e campos serão apagados.\n` +
      `Só é permitido se não houver nenhuma demanda vinculada.`
    )) return

    try {
      await api.delete(`/admin/demand-types/${type.id}`)
      setDemandTypes(prev => prev.filter(t => t.id !== type.id))
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao deletar workflow.')
    }
  }

  async function handleRestoreType(type) {
    try {
      await api.post(`/admin/demand-types/${type.id}/restore`)
      setDemandTypes(prev =>
        prev.map(t => t.id === type.id ? { ...t, archived_at: null } : t)
      )
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao restaurar tipo.')
    }
  }

  // ── CRUD de etapas ──────────────────────────────────────────────────────────
  function handleStageSaved(typeId, savedStage, mode) {
    if (mode === 'create') {
      setStagesByType(prev => ({
        ...prev,
        [typeId]: [...(prev[typeId] ?? []), savedStage],
      }))
    } else {
      setStagesByType(prev => ({
        ...prev,
        [typeId]: (prev[typeId] ?? []).map(s =>
          s.id === savedStage.id ? { ...s, ...savedStage } : s
        ),
      }))
    }
    setStageModal(null)
  }

  async function handleArchiveStage(typeId, stage) {
    if (!window.confirm(
      `Arquivar a etapa "${stage.name}"?\n\n` +
      `Esta ação é irreversível. Só é permitida se não houver demandas nesta etapa.`
    )) return

    try {
      await api.post(`/admin/demand-types/${typeId}/stages/${stage.id}/archive`)
      setStagesByType(prev => ({
        ...prev,
        [typeId]: (prev[typeId] ?? []).map(s =>
          s.id === stage.id ? { ...s, archived_at: new Date().toISOString() } : s
        ),
      }))
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao arquivar etapa.')
    }
  }

  // ── Reordenação de etapas (otimista + revert) ─────────────────────────────
  async function handleReorderStages(typeId, newOrder) {
    const previous = stagesByType[typeId] ?? []
    // Otimismo: atualiza estado imediatamente (UX responsivo)
    setStagesByType(prev => ({ ...prev, [typeId]: newOrder }))

    try {
      await api.patch(`/admin/demand-types/${typeId}/stages/reorder`, {
        orderedIds: newOrder.filter(s => !s.archived_at).map(s => s.id),
      })
    } catch {
      // Reverte para a ordem anterior em caso de falha
      setStagesByType(prev => ({ ...prev, [typeId]: previous }))
    }
  }

  // ── Agrupamento por departamento (apenas ativos) ────────────────────────────
  const activeTypes   = demandTypes.filter(dt => !dt.archived_at)
  const archivedTypes = demandTypes.filter(dt =>  dt.archived_at)

  const grouped = activeTypes.reduce((acc, dt) => {
    const key = dt.department_name ?? 'Sem departamento'
    if (!acc[key]) acc[key] = []
    acc[key].push(dt)
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workflows</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Gerencie tipos de demanda e suas etapas de workflow
          </p>
        </div>
        <button
          onClick={() => setTypeModal({ mode: 'create' })}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm
                     font-semibold text-white transition-colors hover:bg-primary-700
                     focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <span aria-hidden="true">+</span>
          Novo Tipo
        </button>
      </div>

      {/* ── Conteúdo ──────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!isLoading && !error && activeTypes.length === 0 && archivedTypes.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2
                        border-dashed border-gray-200 py-16 text-gray-400">
          <IconGear className="mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">Nenhum tipo de demanda</p>
          <p className="mt-1 text-sm">Crie o primeiro tipo para começar a modelar o workflow</p>
        </div>
      )}

      {!isLoading && Object.entries(grouped).map(([deptName, types]) => (
        <div key={deptName} className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {deptName}
          </h2>
          <div className="space-y-2">
            {types.map(dt => (
              <DemandTypeCard
                key={dt.id}
                type={dt}
                isExpanded={expandedTypes.has(dt.id)}
                isLoadingStages={loadingStages.has(dt.id)}
                stages={stagesByType[dt.id]}
                onToggle={() => toggleExpand(dt.id)}
                onEdit={() => setTypeModal({ mode: 'edit', type: dt })}
                onArchive={() => handleArchiveType(dt)}
                onDelete={() => handleDeleteType(dt)}
                onManageFields={() => navigate(`/admin/workflows/${dt.id}/fields`)}
                onAddStage={() => setStageModal({ mode: 'create', typeId: dt.id })}
                onEditStage={(stage) => setStageModal({ mode: 'edit', typeId: dt.id, stage })}
                onArchiveStage={(stage) => handleArchiveStage(dt.id, stage)}
                onReorderStages={(newOrder) => handleReorderStages(dt.id, newOrder)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* ── Lixeira de 30 Dias ────────────────────────────────────────────── */}
      {!isLoading && archivedTypes.length > 0 && (
        <TrashSection
          types={archivedTypes}
          actorRole={actorRole}
          onRestore={handleRestoreType}
          onDelete={handleDeleteType}
        />
      )}

      {/* ── Modais ────────────────────────────────────────────────────────── */}
      {typeModal && (
        <DemandTypeModal
          mode={typeModal.mode}
          type={typeModal.type}
          departments={departments}
          actorRole={actorRole}
          onSave={handleTypeSaved}
          onClose={() => setTypeModal(null)}
        />
      )}

      {stageModal && (
        <StageModal
          mode={stageModal.mode}
          typeId={stageModal.typeId}
          stage={stageModal.stage}
          onSave={(s) => handleStageSaved(stageModal.typeId, s, stageModal.mode)}
          onClose={() => setStageModal(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TrashSection — lixeira de 30 dias para tipos arquivados
// ─────────────────────────────────────────────────────────────────────────────

function TrashSection({ types, actorRole, onRestore, onDelete }) {
  const [open, setOpen] = useState(false)
  const isSuperAdmin = actorRole === 'super_admin'

  function daysLeft(archivedAt) {
    const ms = Date.now() - new Date(archivedAt).getTime()
    return Math.max(0, 30 - Math.floor(ms / 86_400_000))
  }

  return (
    <div className="mt-8 rounded-xl border border-dashed border-gray-200">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm text-gray-500
                   hover:text-gray-700 focus:outline-none"
      >
        <IconTrash className="h-4 w-4 text-gray-400" />
        <span className="font-medium">Lixeira</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          {types.length}
        </span>
        <IconChevron className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-dashed border-gray-200 divide-y divide-gray-100">
          {types.map(type => (
            <div key={type.id}
                 className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50/50">
              <span className="flex-1 text-sm font-medium text-gray-500">
                {type.name}
                <span className="ml-2 text-xs text-gray-400">
                  ({type.department_name ?? 'Sem depto'})
                </span>
              </span>
              <span className={`text-xs font-medium tabular-nums
                ${daysLeft(type.archived_at) <= 3
                  ? 'text-red-500'
                  : daysLeft(type.archived_at) <= 7
                    ? 'text-amber-500'
                    : 'text-gray-400'}`}>
                {daysLeft(type.archived_at)}d restantes
              </span>
              {isSuperAdmin && (
                <>
                  <button
                    onClick={() => onRestore(type)}
                    className="rounded border border-green-200 bg-green-50 px-2.5 py-1 text-xs
                               font-medium text-green-700 transition-colors hover:bg-green-100
                               focus:outline-none focus:ring-1 focus:ring-green-400"
                  >
                    Restaurar
                  </button>
                  <button
                    onClick={() => onDelete(type)}
                    className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium
                               text-red-500 transition-colors hover:bg-red-50
                               focus:outline-none focus:ring-1 focus:ring-red-400"
                  >
                    Deletar
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DemandTypeCard — accordion com lista de etapas
// ─────────────────────────────────────────────────────────────────────────────

function DemandTypeCard({
  type, isExpanded, isLoadingStages, stages,
  onToggle, onEdit, onArchive, onDelete, onManageFields,
  onAddStage, onEditStage, onArchiveStage, onReorderStages,
}) {
  const activeStages   = (stages ?? []).filter(s => !s.archived_at)
  const archivedStages = (stages ?? []).filter(s =>  s.archived_at)
  const isArchived     = !!type.archived_at

  return (
    <div className={`overflow-hidden rounded-xl border shadow-sm
                     ${isArchived
                       ? 'border-gray-100 bg-gray-50 opacity-60'
                       : 'border-gray-200 bg-white'}`}>
      {/* ── Header do card ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex flex-1 items-center gap-3 text-left"
          disabled={isArchived}
        >
          <span
            className={`flex-shrink-0 text-gray-400 transition-transform duration-200
                        ${isExpanded ? 'rotate-90' : ''}`}
          >
            <IconChevron className="h-4 w-4" />
          </span>
          <span className={`font-semibold ${isArchived ? 'line-through text-gray-400' : 'text-gray-900'}`}>
            {type.name}
          </span>
          {isArchived && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
              Arquivado
            </span>
          )}
          {!isArchived && stages !== undefined && (
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {activeStages.length} etapa{activeStages.length !== 1 ? 's' : ''}
            </span>
          )}
          {!isArchived && type.sla_hours && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600"
                  title={`SLA: ${type.sla_hours}h de resolução`}>
              SLA {type.sla_hours}h
            </span>
          )}
        </button>

        {!isArchived && (
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button
              onClick={onEdit}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium
                         text-gray-600 transition-colors hover:bg-gray-50
                         focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              Editar
            </button>
            <button
              onClick={onManageFields}
              className="rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs
                         font-medium text-indigo-700 transition-colors hover:bg-indigo-100
                         focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              Formulário
            </button>
            <button
              onClick={onArchive}
              className="rounded border border-red-100 px-2.5 py-1 text-xs font-medium
                         text-red-500 transition-colors hover:bg-red-50
                         focus:outline-none focus:ring-1 focus:ring-red-400"
            >
              Arquivar
            </button>
            {!isArchived && (
              <button
                onClick={onDelete}
                className="rounded border border-red-300 bg-red-50 px-2.5 py-1 text-xs
                           font-medium text-red-700 transition-colors hover:bg-red-100
                           focus:outline-none focus:ring-1 focus:ring-red-500"
                title="Deleção permanente — só disponível se não há demandas"
              >
                Deletar
              </button>
            )}
            {isExpanded && (
              <button
                onClick={onAddStage}
                className="rounded border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs
                           font-medium text-primary-700 transition-colors
                           hover:bg-primary-100
                           focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                + Nova Etapa
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Body expansível ───────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {isLoadingStages && (
            <div className="space-y-2 p-4">
              {[1, 2].map(i => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-50" />
              ))}
            </div>
          )}

          {!isLoadingStages && stages !== undefined && activeStages.length === 0 && (
            <p className="px-5 py-4 text-sm text-gray-400 italic">
              Nenhuma etapa ativa. Crie a primeira etapa para este workflow.
            </p>
          )}

          {!isLoadingStages && stages !== undefined && activeStages.length > 0 && (
            <SortableStageList
              stages={activeStages}
              onEdit={onEditStage}
              onArchive={onArchiveStage}
              onReorder={onReorderStages}
            />
          )}

          {/* Etapas arquivadas (collapsible secundário) */}
          {!isLoadingStages && archivedStages.length > 0 && (
            <ArchivedStages stages={archivedStages} />
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SortableStageList — lista reordenável via @dnd-kit
// ─────────────────────────────────────────────────────────────────────────────

function SortableStageList({ stages, onEdit, onArchive, onReorder }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Ativa o drag apenas após mover 5px — evita interferir com cliques
      activationConstraint: { distance: 5 },
    })
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIndex = stages.findIndex(s => s.id === active.id)
    const newIndex = stages.findIndex(s => s.id === over.id)
    onReorder(arrayMove(stages, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={stages.map(s => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y divide-gray-50">
          {stages.map((stage, index) => (
            <SortableStageItem
              key={stage.id}
              stage={stage}
              index={index}
              onEdit={() => onEdit(stage)}
              onArchive={() => onArchive(stage)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SortableStageItem — linha de etapa arrastável
// ─────────────────────────────────────────────────────────────────────────────

function SortableStageItem({ stage, index, onEdit, onArchive }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id })

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.5 : 1,
    zIndex:     isDragging ? 10 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-3 transition-colors
                  ${isDragging ? 'bg-primary-50 shadow-md' : 'bg-white hover:bg-gray-50/50'}`}
    >
      {/* Número de ordem */}
      <span className="w-5 flex-shrink-0 text-center text-xs font-mono text-gray-300 select-none">
        {index + 1}
      </span>

      {/* Handle de drag */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab text-gray-300 hover:text-gray-500
                   focus:outline-none active:cursor-grabbing"
        aria-label="Arrastar para reordenar"
        tabIndex={0}
      >
        <IconGrip className="h-4 w-4" />
      </button>

      {/* Nome da etapa */}
      <span className="flex-1 text-sm font-medium text-gray-800">{stage.name}</span>

      {/* Badges de configuração */}
      <div className="flex items-center gap-1.5">
        {stage.is_final && (
          <StageBadge color="green" title="É etapa final">Final</StageBadge>
        )}
        {stage.requires_assignee && (
          <StageBadge color="blue" title="Exige responsável">Resp.</StageBadge>
        )}
        {stage.requires_note && (
          <StageBadge color="amber" title="Exige justificativa">Nota</StageBadge>
        )}
        {stage.requires_attachment && (
          <StageBadge color="amber" title="Exige documento anexado">Anexo</StageBadge>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button
          onClick={onEdit}
          className="rounded border border-gray-200 px-2 py-1 text-xs font-medium
                     text-gray-600 transition-colors hover:bg-gray-100
                     focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          Editar
        </button>
        <button
          onClick={onArchive}
          className="rounded border border-red-100 px-2 py-1 text-xs font-medium
                     text-red-500 transition-colors hover:bg-red-50
                     focus:outline-none focus:ring-1 focus:ring-red-400"
        >
          Arquivar
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ArchivedStages — seção colapsável de etapas arquivadas
// ─────────────────────────────────────────────────────────────────────────────

function ArchivedStages({ stages }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-dashed border-gray-100">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-gray-400
                   hover:text-gray-600 focus:outline-none"
      >
        <IconChevron className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {stages.length} etapa{stages.length !== 1 ? 's' : ''} arquivada{stages.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="divide-y divide-gray-50 bg-gray-50/50">
          {stages.map(stage => (
            <div key={stage.id}
                 className="flex items-center gap-3 px-4 py-2.5 opacity-60">
              <span className="flex-1 text-xs text-gray-500 line-through">{stage.name}</span>
              <span className="text-xs text-gray-400">
                Arquivada em {new Date(stage.archived_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DemandTypeModal — criar / renomear tipo de demanda
// ─────────────────────────────────────────────────────────────────────────────

function DemandTypeModal({ mode, type, departments, actorRole, onSave, onClose }) {
  const [name,        setName]        = useState(type?.name ?? '')
  const [description, setDescription] = useState(type?.description ?? '')
  const [slaHours,    setSlaHours]    = useState(
    type?.sla_hours != null ? String(type.sla_hours) : ''
  )
  const [deptId,      setDeptId]      = useState(type?.department_id ?? departments[0]?.id ?? '')
  const [isLoading,   setIsLoading]   = useState(false)
  const [error,       setError]       = useState(null)

  function parseSlaHours() {
    const n = parseInt(slaHours, 10)
    return !isNaN(n) && n > 0 ? n : null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      if (mode === 'create') {
        const body = { name: name.trim(), department_id: deptId }
        if (description.trim()) body.description = description.trim()
        const sla = parseSlaHours()
        if (sla) body.sla_hours = sla
        const { data } = await api.post('/admin/demand-types', body)
        const dept = departments.find(d => d.id === deptId)
        onSave({ ...data, department_name: dept?.name }, 'create')
      } else {
        const body = { name: name.trim() }
        if (description.trim() !== (type?.description ?? '').trim()) {
          body.description = description.trim() || undefined
        }
        // sla_hours: envia null para remover, número para definir, omite se não mudou
        const sla = parseSlaHours()
        const prevSla = type?.sla_hours ?? null
        if (sla !== prevSla) body.sla_hours = sla  // null remove o SLA
        const { data } = await api.patch(`/admin/demand-types/${type.id}`, body)
        onSave(data, 'edit')
      }
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao salvar.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'Novo Tipo de Demanda' : 'Editar Tipo'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Field label="Nome">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={2}
            autoFocus
            placeholder="Ex: Solicitação de Compra"
            className={inputCls}
          />
        </Field>

        <Field label="Descrição (opcional)">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Descreva quando este tipo deve ser usado…"
            className={`${inputCls} resize-none`}
          />
        </Field>

        <Field label="SLA de resolução (horas)">
          <input
            type="number"
            value={slaHours}
            onChange={e => setSlaHours(e.target.value)}
            min="1"
            max="8760"
            placeholder="Ex: 48 (2 dias) — deixe vazio para sem prazo"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-gray-400">
            Prazo contado a partir da abertura da demanda. Deixe vazio para sem SLA.
          </p>
        </Field>

        {mode === 'create' && (
          <Field label="Departamento">
            {departments.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhum departamento disponível.</p>
            ) : (
              <select
                value={deptId}
                onChange={e => setDeptId(e.target.value)}
                required
                className={inputCls}
              >
                {/* dept_admin: mostra apenas seus depts; super_admin: todos */}
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </Field>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={cancelBtnCls}>
            Cancelar
          </button>
          <button type="submit" disabled={isLoading} className={submitBtnCls}>
            {isLoading ? 'Salvando…' : mode === 'create' ? 'Criar Tipo' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// StageModal — criar / editar etapa do workflow
// ─────────────────────────────────────────────────────────────────────────────

function StageModal({ mode, typeId, stage, onSave, onClose }) {
  const [name,                setName]                = useState(stage?.name ?? '')
  const [isFinal,             setIsFinal]             = useState(stage?.is_final ?? false)
  const [requiresNote,        setRequiresNote]        = useState(stage?.requires_note ?? false)
  const [requiresAssignee,    setRequiresAssignee]    = useState(stage?.requires_assignee ?? false)
  const [requiresAttachment,  setRequiresAttachment]  = useState(stage?.requires_attachment ?? false)
  const [wipLimit,            setWipLimit]            = useState(stage?.wip_limit ?? '')
  const [isLoading,           setIsLoading]           = useState(false)
  const [error,               setError]               = useState(null)

  // Automação de notificação por etapa
  const [autoNotifyRequester, setAutoNotifyRequester] = useState(false)
  const [autoNotifyAssignee,  setAutoNotifyAssignee]  = useState(false)
  const [autoMessage,         setAutoMessage]         = useState('Demanda "{title}" avançou de etapa.')

  // Carrega regra de automação existente ao editar
  useEffect(() => {
    if (mode !== 'edit' || !stage?.id) return
    api.get(`/admin/stage-notifications/${stage.id}`)
      .then(({ data }) => {
        if (!data) return
        setAutoNotifyRequester(data.notify_requester ?? false)
        setAutoNotifyAssignee(data.notify_assignee ?? false)
        setAutoMessage(data.message_template ?? 'Demanda "{title}" avançou de etapa.')
      })
      .catch(() => {}) // falha silenciosa — regra simplesmente não existe
  }, [mode, stage?.id])

  async function handleSubmit(e) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const wipValue = wipLimit !== '' ? parseInt(wipLimit, 10) : null

    try {
      let savedStage
      if (mode === 'create') {
        const { data } = await api.post(`/admin/demand-types/${typeId}/stages`, {
          name:                 name.trim(),
          is_final:             isFinal,
          requires_note:        requiresNote,
          requires_assignee:    requiresAssignee,
          requires_attachment:  requiresAttachment,
          wip_limit:            wipValue,
        })
        savedStage = data
      } else {
        const { data } = await api.patch(
          `/admin/demand-types/${typeId}/stages/${stage.id}`,
          {
            name:                 name.trim(),
            is_final:             isFinal,
            requires_note:        requiresNote,
            requires_assignee:    requiresAssignee,
            requires_attachment:  requiresAttachment,
            wip_limit:            wipValue,
          }
        )
        savedStage = data
      }

      // Persiste regra de automação
      if (autoNotifyRequester || autoNotifyAssignee) {
        await api.put(`/admin/stage-notifications/${savedStage.id}`, {
          notify_requester: autoNotifyRequester,
          notify_assignee:  autoNotifyAssignee,
          message_template: autoMessage || 'Demanda "{title}" avançou de etapa.',
        })
      } else {
        await api.delete(`/admin/stage-notifications/${savedStage.id}`).catch(() => {})
      }

      onSave(savedStage)
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao salvar etapa.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'Nova Etapa' : `Editar Etapa: ${stage?.name}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <Field label="Nome da etapa">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={1}
            autoFocus
            placeholder="Ex: Em Análise, Aguardando Aprovação…"
            className={inputCls}
          />
        </Field>

        {/* Toggles de regras de negócio */}
        <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Regras da etapa
          </p>

          <Toggle
            checked={requiresAssignee}
            onChange={setRequiresAssignee}
            label="Exige responsável"
            description="A demanda deve ter um responsável atribuído ao entrar nesta etapa."
          />

          <Toggle
            checked={requiresNote}
            onChange={setRequiresNote}
            label="Exige justificativa"
            description="Um campo de nota obrigatório é apresentado ao mover para esta etapa."
          />

          <Toggle
            checked={requiresAttachment}
            onChange={setRequiresAttachment}
            label="Exige documento anexado (NF / PI)"
            description="Bloqueia a movimentação para esta etapa se a demanda não tiver nenhum anexo upado."
          />

          <Toggle
            checked={isFinal}
            onChange={setIsFinal}
            label="É etapa final"
            description="Demandas nesta etapa são consideradas concluídas no cálculo de SLA."
          />
        </div>

        {/* WIP Limit */}
        <Field label="Limite WIP (opcional)">
          <input
            type="number"
            min="1"
            value={wipLimit}
            onChange={e => setWipLimit(e.target.value)}
            placeholder="Sem limite"
            className={inputCls}
          />
          <p className="mt-1 text-xs text-gray-400">
            Número máximo de demandas simultâneas nesta etapa. Deixe em branco para sem limite.
          </p>
        </Field>

        {/* Automação de notificação */}
        <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Automação ao entrar nesta etapa
          </p>
          <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoNotifyRequester}
              onChange={e => setAutoNotifyRequester(e.target.checked)}
              className="h-4 w-4 accent-primary-600"
            />
            <span className="text-gray-700">Notificar solicitante</span>
          </label>
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoNotifyAssignee}
              onChange={e => setAutoNotifyAssignee(e.target.checked)}
              className="h-4 w-4 accent-primary-600"
            />
            <span className="text-gray-700">Notificar responsável</span>
          </label>
          {(autoNotifyRequester || autoNotifyAssignee) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Mensagem (use <code className="rounded bg-gray-200 px-1">{'{title}'}</code> para o título)
              </label>
              <input
                type="text"
                value={autoMessage}
                onChange={e => setAutoMessage(e.target.value)}
                placeholder='Ex: Demanda "{title}" entrou em Produção.'
                className={inputCls}
              />
            </div>
          )}
          {!autoNotifyRequester && !autoNotifyAssignee && (
            <p className="text-xs text-gray-400 italic">
              Nenhuma notificação automática configurada.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={cancelBtnCls}>
            Cancelar
          </button>
          <button type="submit" disabled={isLoading} className={submitBtnCls}>
            {isLoading ? 'Salvando…' : mode === 'create' ? 'Criar Etapa' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos de UI
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <div className="relative flex-shrink-0 pt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`h-5 w-9 rounded-full transition-colors ${
            checked ? 'bg-primary-600' : 'bg-gray-200'
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-gray-500">{description}</p>
        )}
      </div>
    </label>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}

function StageBadge({ color, title, children }) {
  const cls = {
    green: 'bg-green-100 text-green-700',
    blue:  'bg-blue-100 text-blue-700',
    amber: 'bg-amber-100 text-amber-700',
  }[color]
  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-primary-500 focus:outline-none ' +
  'focus:ring-1 focus:ring-primary-500'

const cancelBtnCls =
  'rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 ' +
  'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500'

const submitBtnCls =
  'rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white ' +
  'hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60'

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────────

function IconGrip({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
    </svg>
  )
}

function IconChevron({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  )
}

function IconGear({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  )
}

function IconX({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}

function IconTrash({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
    </svg>
  )
}
