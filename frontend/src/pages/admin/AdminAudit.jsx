import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import api from '../../lib/api'

const PER_PAGE = 25

const EVENT_LABELS = {
  created:            { label: 'Criada',               color: 'bg-green-100 text-green-800'  },
  stage_changed:      { label: 'Etapa alterada',        color: 'bg-blue-100 text-blue-800'    },
  exception_changed:  { label: 'Exceção alterada',      color: 'bg-orange-100 text-orange-800'},
  assignee_changed:   { label: 'Responsável alterado',  color: 'bg-purple-100 text-purple-800'},
}

const EXCEPTION_LABELS = {
  none:     'Nenhuma',
  paused:   'Pausada',
  critical: 'Crítica',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminAudit() {
  const actorRole = useAuthStore(s => s.user?.role)

  // ── Estado da tabela ────────────────────────────────────────────────────────
  const [items,     setItems]     = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState(null)

  // ── Dados para filtros ───────────────────────────────────────────────────────
  const [departments, setDepartments] = useState([])
  const [actors,      setActors]      = useState([])

  // ── Filtros ─────────────────────────────────────────────────────────────────
  const [deptFilter,      setDeptFilter]      = useState('')
  const [actorFilter,     setActorFilter]     = useState('')
  const [eventFilter,     setEventFilter]     = useState('')
  const [dateFrom,        setDateFrom]        = useState('')
  const [dateTo,          setDateTo]          = useState('')

  const abortRef = useRef(null)

  // ── Carrega listas para os selects ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [deptsRes, actorsRes] = await Promise.all([
          actorRole === 'super_admin' ? api.get('/admin/departments') : Promise.resolve({ data: [] }),
          api.get('/admin/audit/actors'),
        ])
        setDepartments(deptsRes.data?.items ?? deptsRes.data ?? [])
        setActors(actorsRes.data)
      } catch {
        // silencia — os selects ficam vazios, não é bloqueante
      }
    }
    load()
  }, [actorRole])

  // ── Fetch principal ─────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsLoading(true)
    setError(null)

    try {
      const params = { page, per_page: PER_PAGE }
      if (deptFilter)  params.department_id = deptFilter
      if (actorFilter) params.actor_id      = actorFilter
      if (eventFilter) params.event_type    = eventFilter
      if (dateFrom)    params.date_from     = new Date(dateFrom).toISOString()
      if (dateTo) {
        // fim do dia selecionado
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        params.date_to = end.toISOString()
      }

      const { data } = await api.get('/admin/audit', { params, signal: ctrl.signal })
      setItems(data.items)
      setTotal(data.total)
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return
      setError('Falha ao carregar o log de auditoria.')
    } finally {
      setIsLoading(false)
    }
  }, [page, deptFilter, actorFilter, eventFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchEvents()
    return () => abortRef.current?.abort()
  }, [fetchEvents])

  // ── Reset de página ao mudar filtros ────────────────────────────────────────
  function applyFilter(setter) {
    return (value) => {
      setter(value)
      setPage(1)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Log de Auditoria</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Histórico de eventos em demandas — {total.toLocaleString('pt-BR')} registros
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 border-b border-gray-200 bg-gray-50 px-6 py-3">
        {/* Departamento — só super_admin enxerga o select */}
        {actorRole === 'super_admin' && departments.length > 0 && (
          <select
            value={deptFilter}
            onChange={e => applyFilter(setDeptFilter)(e.target.value)}
            className={filterSelectCls}
          >
            <option value="">Todos os departamentos</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}

        {/* Ator */}
        <select
          value={actorFilter}
          onChange={e => applyFilter(setActorFilter)(e.target.value)}
          className={filterSelectCls}
        >
          <option value="">Todos os usuários</option>
          {actors.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {/* Tipo de evento */}
        <select
          value={eventFilter}
          onChange={e => applyFilter(setEventFilter)(e.target.value)}
          className={filterSelectCls}
        >
          <option value="">Todos os eventos</option>
          {Object.entries(EVENT_LABELS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* Período */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={e => applyFilter(setDateFrom)(e.target.value)}
            className={filterInputCls}
            placeholder="De"
          />
          <span className="text-xs text-gray-400">até</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => applyFilter(setDateTo)(e.target.value)}
            className={filterInputCls}
            placeholder="Até"
          />
        </div>

        {/* Limpar filtros */}
        {(deptFilter || actorFilter || eventFilter || dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setDeptFilter(''); setActorFilter(''); setEventFilter('')
              setDateFrom(''); setDateTo(''); setPage(1)
            }}
            className="text-xs text-gray-400 hover:text-gray-700 underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="m-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading && items.length === 0 ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-gray-400">
            Nenhum evento encontrado para os filtros selecionados.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="sticky top-0 bg-white z-10">
              <tr>
                {['Data / Hora', 'Evento', 'Demanda', 'Departamento', 'Ator', 'Detalhe', 'Notas'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {items.map(ev => (
                <tr key={ev.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatDate(ev.entered_at)}
                  </td>
                  <td className="px-4 py-3">
                    <EventBadge type={ev.event_type} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Link
                      to={`/demands/${ev.demand_id}`}
                      className="text-primary-600 hover:underline line-clamp-2 max-w-[200px] block"
                      title={ev.demand_title}
                    >
                      {ev.demand_title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {ev.department_name ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                    {ev.actor_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <EventDetail ev={ev} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px]">
                    <span className="line-clamp-2">{ev.notes ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginação */}
      {!isLoading && total > PER_PAGE && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
          <span className="text-xs text-gray-500">
            Exibindo {Math.min((page - 1) * PER_PAGE + 1, total)}–{Math.min(page * PER_PAGE, total)} de {total.toLocaleString('pt-BR')}
          </span>
          <div className="flex items-center gap-1">
            <PageBtn disabled={page === 1}            onClick={() => setPage(1)}           label="«" />
            <PageBtn disabled={page === 1}            onClick={() => setPage(p => p - 1)}  label="‹" />
            <span className="px-3 py-1 text-xs text-gray-700">{page} / {totalPages}</span>
            <PageBtn disabled={page === totalPages}   onClick={() => setPage(p => p + 1)}  label="›" />
            <PageBtn disabled={page === totalPages}   onClick={() => setPage(totalPages)}  label="»" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function EventBadge({ type }) {
  const { label, color } = EVENT_LABELS[type] ?? { label: type, color: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

function EventDetail({ ev }) {
  if (ev.event_type === 'stage_changed') {
    return <span>{ev.stage_name ?? '—'}</span>
  }
  if (ev.event_type === 'assignee_changed') {
    return <span>{ev.assignee_name ?? 'Removido'}</span>
  }
  if (ev.event_type === 'exception_changed') {
    return <span>{EXCEPTION_LABELS[ev.exception_state] ?? ev.exception_state ?? '—'}</span>
  }
  return <span className="text-gray-400">—</span>
}

function LoadingRows() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b border-gray-100 px-4 py-3">
          {[120, 100, 180, 120, 100, 100, 140].map((w, j) => (
            <div
              key={j}
              className="h-4 animate-pulse rounded bg-gray-100"
              style={{ width: w }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function PageBtn({ onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600
                 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  )
}

// ── Estilos reutilizáveis ────────────────────────────────────────────────────
const filterSelectCls =
  'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500'

const filterInputCls =
  'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500'
