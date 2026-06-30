import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core'
import { useBoardStore }      from '../stores/boardStore'
import { useDemandTypeStore } from '../stores/demandTypeStore'
import Column                 from '../components/kanban/Column'
import Card                   from '../components/kanban/Card'
import MoveModal              from '../components/kanban/MoveModal'
import UserSelect             from '../components/kanban/UserSelect'

/**
 * Página principal do Quadro Kanban.
 *
 * ── Drag-and-drop ────────────────────────────────────────────────────────────
 *
 *   onDragEnd não toca na store diretamente.
 *   1. Card solto → toStageId via over.data.current?.stageId
 *   2a. targetStage.requires_note OU requires_assignee → modal, card na origem
 *   2b. Caso contrário → moveCardOptimistic() direto
 *
 * ── Filtros Avançados (Phase 11) ─────────────────────────────────────────────
 *
 * URL é a fonte da verdade (SSoT) dos filtros: ?q=texto&assignee_id=uuid
 *
 * Fluxo — debounce sem useEffect de sincronização:
 *   1. Usuário digita → handleQChange(value)
 *   2. clearTimeout(debounceRef) + setTimeout 400ms → setSearchParams (replace)
 *   3. Único useEffect([demandTypeId, qParam, assigneeParam]) detecta URL mutada
 *   4. fetchBoard(demandTypeId, filters) — AbortController cancela req. anterior
 *
 * Cleanup isolado:
 *   Um segundo useEffect([demandTypeId]) cuida APENAS do reset() no unmount/troca
 *   de quadro. Cleanup de filtro NÃO deve chamar reset() (isso causaria flash de
 *   skeleton toda vez que o usuário digita). Dois useEffects com responsabilidades
 *   distintas são preferíveis a um efeito com lógica misturada.
 *
 * Eliminado:
 *   ✕ useEffect([localQ]) { debounce → setSearchParams }  ← substituído pelo handler
 */
export default function Board() {
  const { demandTypeId }                  = useParams()
  const [searchParams, setSearchParams]   = useSearchParams()

  // ── URL SSoT — derivados direto dos search params ──────────────────────────
  const qParam          = searchParams.get('q')           ?? ''
  const assigneeParam   = searchParams.get('assignee_id') ?? null
  const tagParam        = searchParams.get('tag_id')      ?? null

  // ── Estado local de UI ─────────────────────────────────────────────────────
  // localQ: controla o input de texto; sincroniza com URL via handler (não useEffect)
  const [localQ,       setLocalQ]       = useState(qParam)
  const [assigneeObj,  setAssigneeObj]  = useState(null)
  const [boardTags,    setBoardTags]    = useState([])
  const debounceRef = useRef(null)

  // ── Visualizações Salvas ───────────────────────────────────────────────────
  const VIEWS_KEY = demandTypeId ? `board_saved_views_${demandTypeId}` : null

  const [savedViews, setSavedViews] = useState(() => {
    if (!demandTypeId) return []
    try { return JSON.parse(localStorage.getItem(`board_saved_views_${demandTypeId}`) ?? '[]') }
    catch { return [] }
  })

  function persistViews(views) {
    setSavedViews(views)
    if (VIEWS_KEY) localStorage.setItem(VIEWS_KEY, JSON.stringify(views))
  }

  function handleSaveView() {
    const params = searchParams.toString()
    if (!params) return
    const name = window.prompt('Nome para esta vista:')?.trim()
    if (!name) return
    const updated = [...savedViews.filter(v => v.name !== name), { name, params }]
    persistViews(updated)
  }

  function handleDeleteView(name) {
    persistViews(savedViews.filter(v => v.name !== name))
  }

  function handleApplyView(view) {
    const params = new URLSearchParams(view.params)
    setSearchParams(params, { replace: true })
    setLocalQ(params.get('q') ?? '')
    setAssigneeObj(null)
  }

  // Recarrega vistas ao trocar de board
  useEffect(() => {
    if (!demandTypeId) return
    try {
      setSavedViews(JSON.parse(localStorage.getItem(`board_saved_views_${demandTypeId}`) ?? '[]'))
    } catch { setSavedViews([]) }
  }, [demandTypeId])

  const [isExporting, setIsExporting] = useState(false)

  async function handleExportCsv() {
    if (!demandTypeId || isExporting) return
    setIsExporting(true)
    try {
      const params = { demand_type_id: demandTypeId }
      if (qParam)          params.q           = qParam
      if (assigneeParam)   params.assignee_id = assigneeParam
      if (tagParam)        params.tag_id      = tagParam

      const { data, headers } = await api.get('/demands/export/csv', {
        params,
        responseType: 'blob',
      })

      const disposition = headers['content-disposition'] ?? ''
      const match = disposition.match(/filename="?([^";\r\n]+)"?/)
      const filename = match ? match[1] : `demandas-${new Date().toISOString().slice(0, 10)}.csv`

      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }))
      const a   = document.createElement('a')
      a.href  = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      // erro de rede — não bloqueia o usuário
    } finally {
      setIsExporting(false)
    }
  }

  const stages           = useBoardStore(s => s.stages)
  const demandsByStage   = useBoardStore(s => s.demandsByStage)
  const isLoadingInitial = useBoardStore(s => s.isLoadingInitial)
  const isFetchingMore   = useBoardStore(s => s.isFetchingMore)
  const error            = useBoardStore(s => s.error)

  const demandTypes      = useDemandTypeStore(s => s.demandTypes)
  const boardDepartmentId = demandTypes.find(dt => dt.id === demandTypeId)?.department_id ?? null

  const actorRole = useAuthStore(s => s.user?.role)

  const [pendingMove,    setPendingMove]    = useState(null)
  const [activeDragCard, setActiveDragCard] = useState(null)
  const [moveError,      setMoveError]      = useState(null)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [batchStageId,  setBatchStageId]  = useState('')
  const [batchLoading,  setBatchLoading]  = useState(false)

  // ── Handlers de seleção em lote ───────────────────────────────────────────
  const handleToggleSelect = useCallback((demandId) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(demandId) ? next.delete(demandId) : next.add(demandId)
      return next
    })
  }, [])

  const handleBatchMove = useCallback(async () => {
    if (!batchStageId || selectedIds.size === 0) return
    setBatchLoading(true)
    try {
      const { data } = await api.patch('/demands/batch-stage', {
        demand_ids: [...selectedIds],
        stage_id:   batchStageId,
      })
      if (data.succeeded.length > 0) {
        await useBoardStore.getState().fetchBoard(demandTypeId, {
          q:           qParam       || undefined,
          assignee_id: assigneeParam || undefined,
          tag_id:      tagParam      || undefined,
        })
      }
      setSelectedIds(new Set())
      setSelectionMode(false)
      if (data.failed.length > 0) {
        alert(`${data.succeeded.length} movidas. ${data.failed.length} falharam:\n${data.failed.map(f => f.error).join('\n')}`)
      }
    } catch (err) {
      alert('Erro ao mover em lote: ' + (err.response?.data?.error ?? err.message))
    } finally {
      setBatchLoading(false)
    }
  }, [batchStageId, selectedIds, demandTypeId, qParam, assigneeParam, tagParam])

  // ── Handler de texto: debounce → URL (sem useEffect) ──────────────────────
  const handleQChange = useCallback((value) => {
    setLocalQ(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (value.trim()) next.set('q', value.trim())
        else               next.delete('q')
        return next
      }, { replace: true })
    }, 400)
  }, [setSearchParams])

  // ── Handler de assignee ───────────────────────────────────────────────────
  function handleAssigneeChange(obj) {
    setAssigneeObj(obj)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (obj?.id) next.set('assignee_id', obj.id)
      else          next.delete('assignee_id')
      return next
    }, { replace: true })
  }

  // ── Handler: limpar filtros ───────────────────────────────────────────────
  function handleClearFilters() {
    clearTimeout(debounceRef.current)
    setLocalQ('')
    setAssigneeObj(null)
    setSearchParams({}, { replace: true })
  }

  // ── Carrega tags do departamento para o filtro ─────────────────────────────
  useEffect(() => {
    if (!boardDepartmentId) { setBoardTags([]); return }
    const ctrl = new AbortController()
    api.get('/tags', { params: { department_id: boardDepartmentId }, signal: ctrl.signal })
      .then(res => setBoardTags(Array.isArray(res.data) ? res.data : []))
      .catch(() => {})
    return () => ctrl.abort()
  }, [boardDepartmentId])

  // ── Único useEffect: URL → fetchBoard ─────────────────────────────────────
  // Dispara ao montar e sempre que os filtros ou o tipo de demanda mudam.
  // AbortController na store cancela automaticamente qualquer request anterior.
  useEffect(() => {
    if (!demandTypeId) return
    useBoardStore.getState().fetchBoard(demandTypeId, {
      q:           qParam       || undefined,
      assignee_id: assigneeParam || undefined,
      tag_id:      tagParam      || undefined,
    })
  }, [demandTypeId, qParam, assigneeParam, tagParam])

  // ── Cleanup isolado: reset apenas ao trocar de quadro / desmontar ─────────
  // Intencionalmente separado do efeito de fetch: mudar um filtro não deve
  // chamar reset() (seria um flash de skeleton desnecessário).
  useEffect(() => {
    return () => useBoardStore.getState().reset()
  }, [demandTypeId])

  // ── Sensors dnd-kit ───────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor,  { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,  { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  // ── Handlers de drag ──────────────────────────────────────────────────────

  function handleDragStart({ active }) {
    const stageId = active.data.current?.stageId
    const card    = stageId ? (demandsByStage[stageId] ?? []).find(d => String(d.id) === active.id) : null
    setActiveDragCard(card ?? null)
    setMoveError(null)
  }

  function handleDragCancel() { setActiveDragCard(null) }

  function handleDragEnd({ active, over }) {
    setActiveDragCard(null)
    if (!over) return

    const fromStageId  = active.data.current?.stageId
    const toStageId    = over.data.current?.stageId
    const departmentId = active.data.current?.departmentId
    const activeDemand = active.data.current?.demand

    if (!fromStageId || !toStageId || fromStageId === toStageId) return

    const targetStage = stages.find(s => String(s.id) === String(toStageId))

    if (targetStage?.requires_note || targetStage?.requires_assignee) {
      setPendingMove({ demandId: active.id, fromStageId, toStageId, targetStage, departmentId, demand: activeDemand })
    } else {
      useBoardStore.getState()
        .moveCardOptimistic({ demandId: active.id, fromStageId, toStageId })
        .catch(err => setMoveError(err?.response?.data?.message ?? 'Não foi possível mover a demanda.'))
    }
  }

  async function handleModalConfirm(payload) {
    await useBoardStore.getState().moveCardOptimistic(payload)
    setPendingMove(null)
  }

  const hasFilters    = !!qParam || !!assigneeParam || !!tagParam
  const totalVisible  = Object.values(demandsByStage).reduce((sum, cards) => sum + cards.length, 0)
  const showEmptyHint = hasFilters && !isFetchingMore && !isLoadingInitial && totalVisible === 0

  // ── Renders de estado ─────────────────────────────────────────────────────

  if (!demandTypeId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-500">Nenhum quadro selecionado</p>
          <p className="mt-1 text-sm text-gray-400">Selecione um tipo de demanda na barra lateral.</p>
        </div>
      </div>
    )
  }

  if (isLoadingInitial) return <BoardSkeleton />

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-md">
          <p className="font-medium text-red-700">Erro ao carregar o quadro</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
          <button
            onClick={() => useBoardStore.getState().fetchBoard(demandTypeId, {
              q: qParam || undefined, assignee_id: assigneeParam || undefined,
            })}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col">

        {/* ── Barra de filtros ───────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-gray-200 bg-white px-6 py-3">

          {/* Visualizações Salvas */}
          {(savedViews.length > 0 || hasFilters) && (
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              {savedViews.map(view => {
                const isActive = searchParams.toString() === view.params
                return (
                  <span
                    key={view.name}
                    className={`inline-flex items-center gap-1 rounded-full border pl-3 pr-1.5 py-0.5 text-xs font-medium
                      transition-colors cursor-pointer
                      ${isActive
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}
                    onClick={() => handleApplyView(view)}
                    title={`Aplicar vista: ${view.name}`}
                  >
                    {view.name}
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteView(view.name) }}
                      title="Remover vista"
                      className="flex h-4 w-4 items-center justify-center rounded-full
                                 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                      </svg>
                    </button>
                  </span>
                )
              })}
              {hasFilters && (
                <button
                  onClick={handleSaveView}
                  title="Salvar filtros atuais como vista"
                  className="inline-flex items-center gap-1 rounded-full border border-dashed
                             border-gray-300 px-2.5 py-0.5 text-xs text-gray-400
                             transition-colors hover:border-primary-400 hover:text-primary-600"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                  </svg>
                  Salvar vista
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                <IconSearch className="h-4 w-4 text-gray-400" />
              </span>
              <input
                type="text"
                value={localQ}
                onChange={e => handleQChange(e.target.value)}
                placeholder="Buscar por título, ID ou solicitante…"
                className="w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-9 pr-3
                           text-sm text-gray-700 placeholder-gray-400
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
            </div>

            <div className="w-52">
              <UserSelect
                departmentId={boardDepartmentId}
                value={assigneeObj}
                onChange={handleAssigneeChange}
                placeholder="Responsável…"
              />
            </div>

            {/* Filtro por tag */}
            {boardTags.length > 0 && (
              <div className="relative w-44">
                <select
                  value={tagParam ?? ''}
                  onChange={e => {
                    const val = e.target.value
                    setSearchParams(prev => {
                      const next = new URLSearchParams(prev)
                      if (val) next.set('tag_id', val)
                      else     next.delete('tag_id')
                      return next
                    }, { replace: true })
                  }}
                  className="w-full appearance-none rounded-lg border border-gray-300 bg-white
                             py-1.5 pl-3 pr-7 text-sm text-gray-700
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                >
                  <option value="">Tags…</option>
                  {boardTags.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {tagParam && (
                  <span
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: boardTags.find(t => t.id === tagParam)?.color_hex ?? '#6366f1' }}
                  />
                )}
              </div>
            )}

            {hasFilters && (
              <button
                onClick={handleClearFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300
                           px-3 py-1.5 text-sm font-medium text-gray-500
                           transition-colors hover:bg-gray-50 hover:text-gray-700"
              >
                <IconX className="h-3.5 w-3.5" />
                Limpar filtros
              </button>
            )}

            {demandTypeId && (
              <button
                onClick={handleExportCsv}
                disabled={isExporting}
                title="Exportar demandas visíveis como CSV"
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300
                           px-3 py-1.5 text-sm font-medium text-gray-500
                           transition-colors hover:bg-gray-50 hover:text-gray-700
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconDownload className="h-3.5 w-3.5" />
                {isExporting ? 'Exportando…' : 'Exportar CSV'}
              </button>
            )}

            {isFetchingMore && (
              <span className="ml-auto text-xs text-primary-600 font-medium animate-pulse">
                Atualizando…
              </span>
            )}
          </div>
        </div>

        {/* Dica de busca global quando filtros ativos não retornam nada */}
        {showEmptyHint && (
          <div className="flex-shrink-0 flex items-center gap-2 bg-gray-50 px-6 py-2 text-sm text-gray-500 border-b border-gray-200">
            <span>Nenhuma demanda encontrada neste quadro.</span>
            <Link
              to={`/search?q=${encodeURIComponent(qParam)}`}
              className="font-medium text-primary-600 hover:text-primary-800 hover:underline"
            >
              Buscar em todos os quadros →
            </Link>
          </div>
        )}

        {/* Erro de movimentação */}
        {moveError && (
          <div className="flex-shrink-0 flex items-center justify-between bg-red-50 px-6 py-2 text-sm text-red-700">
            <span>⚠️ {moveError}</span>
            <button onClick={() => setMoveError(null)} className="ml-4 text-red-400 hover:text-red-600" aria-label="Fechar">✕</button>
          </div>
        )}

        {/* Barra de seleção em lote */}
        {actorRole !== 'user' && (
          <div className="flex-shrink-0 flex items-center gap-3 px-6 py-2 border-b border-gray-100 bg-white flex-wrap">
            <button
              onClick={() => { setSelectionMode(v => !v); setSelectedIds(new Set()); setBatchStageId('') }}
              className={`text-xs px-3 py-1 rounded border transition-colors ${
                selectionMode
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {selectionMode ? `Selecionando (${selectedIds.size})` : 'Selecionar em lote'}
            </button>
            {selectionMode && selectedIds.size > 0 && (
              <>
                <select
                  value={batchStageId}
                  onChange={e => setBatchStageId(e.target.value)}
                  className="text-xs border rounded px-2 py-1 bg-white"
                >
                  <option value="">Mover para etapa...</option>
                  {stages.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleBatchMove}
                  disabled={!batchStageId || batchLoading}
                  className="text-xs px-3 py-1 rounded bg-green-600 text-white disabled:opacity-50"
                >
                  {batchLoading ? 'Movendo...' : `Aplicar (${selectedIds.size})`}
                </button>
              </>
            )}
          </div>
        )}

        {/* Quadro */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="flex h-full gap-4 p-6">
              {stages.map(stage => (
                <Column
                  key={stage.id}
                  stage={stage}
                  demands={demandsByStage[stage.id] ?? []}
                  selectionMode={selectionMode}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                />
              ))}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeDragCard ? (
                <div className="rotate-1 opacity-90 scale-105">
                  <Card demand={activeDragCard} stageId={activeDragCard.stage_id} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {pendingMove && (
        <MoveModal
          pendingMove={pendingMove}
          onConfirm={handleModalConfirm}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BoardSkeleton() {
  return (
    <div className="flex gap-4 p-6">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="w-72 flex-shrink-0 rounded-xl bg-gray-100 p-3">
          <div className="mb-3 flex items-center gap-2 px-1">
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-gray-300" />
            <div className="h-4 w-24 animate-pulse rounded bg-gray-300" />
          </div>
          <div className="space-y-2 p-2">
            {[1, 2, 3].map(j => (
              <div key={j} className="h-16 animate-pulse rounded-lg bg-white border border-gray-100" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Ícones ─────────────────────────────────────────────────────────────────────

function IconSearch({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
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

function IconDownload({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  )
}
