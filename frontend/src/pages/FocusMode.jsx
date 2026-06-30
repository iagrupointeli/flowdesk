import { useEffect, useRef, useState } from 'react'
import { Link }         from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import SLABadge         from '../components/SLABadge'
import api              from '../lib/api'

/**
 * Modo Foco — /foco
 *
 * Exibe apenas as demandas atribuídas ao usuário logado,
 * ordenadas por urgência de SLA (vencidas primeiro, depois por due_date).
 *
 * Layout split-screen:
 *   Esquerda — lista de cards filtrada e priorizada
 *   Direita  — painel de detalhes (redireciona para DemandDetail ao clicar "Abrir completo")
 */
export default function FocusMode() {
  const user    = useAuthStore(s => s.user)
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!user?.id) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)

    api.get('/demands', {
      params: { assignee_id: user.id, limit: 100 },
      signal: ctrl.signal,
    })
      .then(res => {
        const raw = res.data.items ?? res.data ?? []
        // Filtra demandas ativas (não finalizadas, não canceladas)
        const active = raw.filter(d => !d.is_final && d.exception_state !== 'cancelled')
        // Ordena: vencidas primeiro, depois mais urgentes por due_date
        active.sort((a, b) => {
          const da = a.due_date ? new Date(a.due_date) : null
          const db = b.due_date ? new Date(b.due_date) : null
          if (!da && !db) return 0
          if (!da) return 1
          if (!db) return -1
          return da - db
        })
        setItems(active)
        if (active.length > 0) setSelected(active[0])
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    return () => ctrl.abort()
  }, [user?.id])

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Painel esquerdo: lista ──────────────────────────────────────────── */}
      <aside className="flex w-72 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <IconFocus className="h-4 w-4 text-primary-600" />
            <h1 className="text-sm font-semibold text-gray-800">Modo Foco</h1>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            {loading ? 'Carregando…' : `${items.length} demanda${items.length !== 1 ? 's' : ''} para você`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <div className="space-y-2 px-3 py-2">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <IconCheck className="h-10 w-10 text-green-400" />
              <p className="text-sm font-medium text-gray-600">Tudo em dia!</p>
              <p className="text-xs text-gray-400">Nenhuma demanda atribuída a você.</p>
            </div>
          )}

          {items.map(item => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-gray-50
                ${selected?.id === item.id ? 'bg-primary-50 border-r-2 border-primary-600' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`flex-1 truncate text-sm font-medium leading-snug
                  ${selected?.id === item.id ? 'text-primary-700' : 'text-gray-800'}`}>
                  {item.title}
                </p>
                <SLABadge demand={item} compact />
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="max-w-[120px] truncate text-[11px] text-gray-400">
                  {item.demand_type_name}
                </span>
                <span className="text-gray-300">·</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium
                  ${stageColor(item.exception_state)}`}>
                  {item.current_stage_name ?? 'Sem etapa'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Painel direito: detalhes ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
        {selected ? (
          <DemandPreview demand={selected} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-gray-400">Selecione uma demanda.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── DemandPreview — painel de detalhes rápidos ────────────────────────────────

function DemandPreview({ demand }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 leading-snug">
              {demand.title}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {demand.department_name} · {demand.demand_type_name}
            </p>
          </div>
          <Link
            to={`/demands/${demand.id}`}
            className="flex-shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs
                       font-semibold text-white transition-colors hover:bg-primary-700"
          >
            Abrir completo →
          </Link>
        </div>

        {/* Badges de estado */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SLABadge demand={demand} />
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stageColor(demand.exception_state)}`}>
            {demand.current_stage_name ?? 'Sem etapa'}
          </span>
          {demand.exception_state && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {exceptionLabel(demand.exception_state)}
            </span>
          )}
        </div>
      </div>

      {/* Corpo */}
      <div className="flex-1 px-6 py-4 space-y-4">
        {/* Solicitante + responsável */}
        <div className="grid grid-cols-2 gap-4">
          <InfoField label="Solicitante" value={demand.requester_name ?? '—'} />
          <InfoField label="Responsável" value={demand.assignee_name ?? 'Não atribuído'} />
        </div>

        {/* Descrição */}
        {demand.description && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Descrição</p>
            <p className="rounded-lg bg-white border border-gray-100 px-3 py-2.5
                          text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {demand.description}
            </p>
          </div>
        )}

        {/* Tags */}
        {demand.tags?.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {demand.tags.map(tag => (
                <span
                  key={tag.id}
                  style={{ backgroundColor: tag.color_hex + '22', color: tag.color_hex }}
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Data de criação */}
        <InfoField
          label="Aberta em"
          value={new Date(demand.created_at).toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric',
          })}
        />
      </div>
    </div>
  )
}

// ── Helpers e sub-componentes ─────────────────────────────────────────────────

function InfoField({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-700">{value}</p>
    </div>
  )
}

function stageColor(exceptionState) {
  if (exceptionState === 'cancelled') return 'bg-gray-100 text-gray-500'
  if (exceptionState === 'on_hold')   return 'bg-amber-100 text-amber-700'
  return 'bg-primary-50 text-primary-700'
}

function exceptionLabel(state) {
  if (state === 'on_hold')   return 'Bloqueada'
  if (state === 'cancelled') return 'Cancelada'
  return state
}

function IconFocus({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

function IconCheck({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
    </svg>
  )
}
