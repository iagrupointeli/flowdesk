import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../lib/api'

/**
 * Página de Busca Global — /search?q=...
 *
 * ── URL como SSoT ────────────────────────────────────────────────────────────
 *   qParam (URL) é a fonte da verdade. localQ controla o input.
 *   Debounce via handler → setSearchParams (sem useEffect intermediário).
 *
 * ── AbortController ──────────────────────────────────────────────────────────
 *   Cada mudança de qParam cria um novo AbortController e aborta o anterior.
 *   O cleanup do useEffect aborta requisições em voo ao desmontar a página.
 *   Race condition eliminada: resultados de queries antigas nunca sobrescrevem
 *   resultados de queries novas.
 *
 * ── Paginação cursor-based ────────────────────────────────────────────────────
 *   Mesmo contrato de listDemands: nextCursor = { after_created_at, after_id }.
 *   "Carregar mais" faz append sem AbortController (ação deliberada, sem race).
 *
 * ── Campos exibidos por resultado ────────────────────────────────────────────
 *   id, title, exception_state, is_final, demand_type_name, department_name,
 *   current_stage_name, assignee_name, requester_name, created_at
 */
export default function Search() {
  const navigate                      = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const qParam = searchParams.get('q') ?? ''

  const [localQ,        setLocalQ]        = useState(qParam)
  const [results,       setResults]       = useState([])
  const [nextCursor,    setNextCursor]    = useState(null)
  const [hasMore,       setHasMore]       = useState(false)
  const [isLoading,     setIsLoading]     = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error,         setError]         = useState(null)

  const debounceRef = useRef(null)
  const abortRef    = useRef(null)
  const inputRef    = useRef(null)

  // Auto-foco no mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // ── Debounce: input → URL ─────────────────────────────────────────────────
  const handleQChange = useCallback((value) => {
    setLocalQ(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (value.trim()) next.set('q', value.trim())
        else              next.delete('q')
        return next
      }, { replace: true })
    }, 350)
  }, [setSearchParams])

  // ── Fetch: qParam → resultados ────────────────────────────────────────────
  useEffect(() => {
    if (!qParam.trim()) {
      setResults([])
      setNextCursor(null)
      setHasMore(false)
      setIsLoading(false)
      return
    }

    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsLoading(true)
    setError(null)
    setResults([])
    setNextCursor(null)
    setHasMore(false)

    api.get('/demands', {
      params: { q: qParam, limit: 20 },
      signal: ctrl.signal,
    }).then(res => {
      setResults(res.data.items ?? [])
      setNextCursor(res.data.nextCursor ?? null)
      setHasMore(res.data.hasMore ?? false)
    }).catch(err => {
      if (err.name === 'CanceledError' || err.name === 'AbortError' || err?.code === 'ERR_CANCELED') return
      setError('Erro ao buscar demandas. Tente novamente.')
    }).finally(() => {
      setIsLoading(false)
    })

    return () => ctrl.abort()
  }, [qParam])

  // ── "Carregar mais" ───────────────────────────────────────────────────────
  async function handleLoadMore() {
    if (!nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await api.get('/demands', {
        params: {
          q:                qParam,
          limit:            20,
          after_created_at: nextCursor.after_created_at,
          after_id:         nextCursor.after_id,
        },
      })
      setResults(prev => [...prev, ...(res.data.items ?? [])])
      setNextCursor(res.data.nextCursor ?? null)
      setHasMore(res.data.hasMore ?? false)
    } catch {
      // silent — usuário pode tentar novamente
    } finally {
      setIsLoadingMore(false)
    }
  }

  const showEmpty     = !isLoading && !error && qParam.trim() && results.length === 0
  const showInitial   = !qParam.trim()
  const showResults   = results.length > 0

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">

      {/* ── Campo de busca ───────────────────────────────────────────────── */}
      <div className="relative mb-6">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
          <IconSearch className="h-5 w-5 text-gray-400" />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={localQ}
          onChange={e => handleQChange(e.target.value)}
          placeholder="Buscar demandas por título, ID ou solicitante…"
          className="w-full rounded-xl border border-gray-300 bg-white py-3 pl-12 pr-10
                     text-sm text-gray-800 placeholder-gray-400 shadow-sm
                     focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
        {localQ && (
          <button
            onClick={() => handleQChange('')}
            className="absolute inset-y-0 right-3 flex items-center px-1 text-gray-400
                       hover:text-gray-600"
            aria-label="Limpar busca"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Estado inicial — sem query ───────────────────────────────────── */}
      {showInitial && (
        <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
          <IconSearchLarge className="h-12 w-12 text-gray-200" />
          <p className="text-base font-medium text-gray-500">Busca Global</p>
          <p className="text-sm text-center">
            Digite para pesquisar demandas em todos os departamentos e quadros.
            <br />
            Pesquise por título, ID (UUID) ou nome do solicitante.
          </p>
          <p className="mt-1 text-xs text-gray-300">
            Atalho: <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-400">Ctrl+K</kbd>
          </p>
        </div>
      )}

      {/* ── Skeleton de carregamento ─────────────────────────────────────── */}
      {isLoading && (
        <ul className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <li key={i} className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 h-4 w-2/3 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-100" />
            </li>
          ))}
        </ul>
      )}

      {/* ── Erro ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ── Sem resultados ───────────────────────────────────────────────── */}
      {showEmpty && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium text-gray-500">
            Nenhuma demanda encontrada para{' '}
            <span className="font-semibold text-gray-700">"{qParam}"</span>
          </p>
          <p className="text-xs text-gray-400">
            Tente outro termo ou verifique se a demanda pertence a um departamento ao qual você tem acesso.
          </p>
        </div>
      )}

      {/* ── Resultados ───────────────────────────────────────────────────── */}
      {showResults && (
        <>
          <p className="mb-3 text-xs text-gray-400">
            {results.length} resultado{results.length !== 1 ? 's' : ''}{hasMore ? '+' : ''} para{' '}
            <span className="font-medium text-gray-600">"{qParam}"</span>
          </p>

          <ul className="space-y-2">
            {results.map(demand => (
              <ResultCard key={demand.id} demand={demand} navigate={navigate} />
            ))}
          </ul>

          {/* Carregar mais */}
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium
                           text-gray-600 transition-colors hover:bg-gray-50 hover:border-gray-400
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                    Carregando…
                  </span>
                ) : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ResultCard
// ─────────────────────────────────────────────────────────────────────────────

function ResultCard({ demand, navigate }) {
  const stateInfo = getStateInfo(demand)

  return (
    <li>
      <button
        onClick={() => navigate(`/demands/${demand.id}`)}
        className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left
                   shadow-sm transition-all hover:border-primary-300 hover:shadow-md
                   focus:outline-none focus:ring-2 focus:ring-primary-400"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Título + badge de estado */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-800 leading-tight">
                {demand.title}
              </span>
              {stateInfo && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateInfo.className}`}>
                  {stateInfo.label}
                </span>
              )}
            </div>

            {/* Tipo · Departamento */}
            <p className="mt-1 text-xs text-gray-500">
              {demand.demand_type_name}
              {demand.department_name ? (
                <> · <span className="text-gray-400">{demand.department_name}</span></>
              ) : null}
            </p>

            {/* Etapa + Responsável */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              {demand.current_stage_name && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
                  {demand.current_stage_name}
                </span>
              )}
              {demand.assignee_name && (
                <span className="flex items-center gap-1 text-gray-400">
                  <IconUser className="h-3 w-3" />
                  {demand.assignee_name}
                </span>
              )}
              {demand.requester_name && (
                <span className="text-gray-400">
                  Solicitante: {demand.requester_name}
                </span>
              )}
            </div>
          </div>

          {/* Data */}
          <time
            dateTime={demand.created_at}
            className="flex-shrink-0 text-xs text-gray-400 mt-0.5"
          >
            {formatDate(demand.created_at)}
          </time>
        </div>
      </button>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getStateInfo(demand) {
  if (demand.exception_state === 'cancelled') {
    return { label: 'Cancelada', className: 'bg-red-100 text-red-600' }
  }
  if (demand.exception_state === 'on_hold') {
    return { label: 'Bloqueada', className: 'bg-amber-100 text-amber-600' }
  }
  if (demand.is_final) {
    return { label: 'Finalizada', className: 'bg-green-100 text-green-700' }
  }
  return null
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────────

function IconSearch({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  )
}

function IconSearchLarge({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}

function IconX({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}

function IconUser({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.125-2.095.39-.31.54-.843.41-1.412a6.957 6.957 0 00-13.07 0z" />
    </svg>
  )
}
