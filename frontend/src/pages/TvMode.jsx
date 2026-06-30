import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'

/**
 * Modo TV — painel de operação ao vivo (/tv)
 *
 * Pensado para rodar em fullscreen num monitor fixo no escritório:
 *   - Fundo escuro, números grandes, zero interação necessária
 *   - Polling de 60s no endpoint agregador /dashboard/tv
 *   - Relógio em tempo real no topo
 *   - Sem sidebar (rota fora do AppLayout)
 *
 * Acesso: super_admin e dept_admin (mesma autorização do dashboard).
 * dept_admin enxerga apenas seus departamentos (escopo aplicado no backend).
 */

const POLL_MS = 60_000

const EVENT_LABELS = {
  created:           'criou',
  stage_changed:     'moveu',
  exception_changed: 'alterou exceção de',
  assignee_changed:  'alterou responsável de',
}

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function relativeTime(iso) {
  const diffMs  = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)   return 'agora'
  if (diffMin < 60)  return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)    return `há ${diffH}h`
  return `há ${Math.floor(diffH / 24)}d`
}

function formatHoursRemaining(h) {
  const n = Number(h)
  if (n <= 0) {
    const overdue = Math.abs(n)
    return overdue < 1 ? 'vencida' : `vencida há ${Math.round(overdue)}h`
  }
  return n < 1 ? '< 1h restante' : `${Math.round(n)}h restantes`
}

// ─────────────────────────────────────────────────────────────────────────────

export default function TvMode() {
  const [data,  setData]  = useState(null)
  const [error, setError] = useState(false)
  const now = useClock()
  const abortRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const { data } = await api.get('/dashboard/tv', { signal: ctrl.signal })
        if (!cancelled) { setData(data); setError(false) }
      } catch (err) {
        if (err.name === 'CanceledError' || err.name === 'AbortError') return
        if (!cancelled) setError(true)
      }
    }

    fetchData()
    const id = setInterval(fetchData, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
      abortRef.current?.abort()
    }
  }, [])

  const kpis = data?.kpis

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-gray-100">

      {/* ── Topo: título + relógio ─────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-gray-800 px-8 py-4">
        <div className="flex items-center gap-3">
          <img src="/logo-branco.png" alt="" className="h-[30px] w-[30px] object-contain" />
          <span className="text-2xl font-bold tracking-tight text-primary-400">InteliONE</span>
          <span className="text-lg text-gray-500">· Operação ao Vivo</span>
          {error && (
            <span className="ml-3 rounded-full bg-red-900/60 px-3 py-1 text-xs font-medium text-red-300">
              sem conexão — exibindo últimos dados
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="font-mono text-4xl font-bold tabular-nums">
            {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-sm capitalize text-gray-500">
            {now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
        </div>
      </header>

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-6 gap-4 px-8 py-5">
        <Kpi label="Abertas"          value={kpis?.open_count}      color="text-gray-100" />
        <Kpi label="Vencidas"         value={kpis?.overdue_count}   color="text-red-400"
             pulse={kpis?.overdue_count > 0} />
        <Kpi label="Críticas (24h)"   value={kpis?.critical_count}  color="text-orange-400" />
        <Kpi label="Pausadas"         value={kpis?.on_hold_count}   color="text-yellow-400" />
        <Kpi label="Criadas hoje"     value={kpis?.created_today}   color="text-blue-400" />
        <Kpi label="Concluídas hoje"  value={kpis?.finalized_today} color="text-green-400" />
      </div>

      {/* ── Corpo: críticas + atividade ────────────────────────────────────── */}
      <div className="grid flex-1 grid-cols-2 gap-6 overflow-hidden px-8 pb-4">

        {/* Demandas críticas */}
        <section className="flex flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
          <h2 className="border-b border-gray-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            ⚠ Atenção imediata
          </h2>
          <div className="flex-1 overflow-y-auto">
            {!data ? (
              <TvSkeleton rows={4} />
            ) : data.critical.length === 0 ? (
              <p className="flex h-full items-center justify-center text-lg text-gray-600">
                ✓ Nenhuma demanda crítica
              </p>
            ) : (
              data.critical.map(d => {
                const overdue = Number(d.hours_remaining) <= 0
                return (
                  <div key={d.id}
                       className={`flex items-center gap-4 border-b border-gray-800/60 px-5 py-3
                                   ${overdue ? 'bg-red-950/30' : ''}`}>
                    <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full
                                      ${overdue ? 'animate-pulse bg-red-500' : 'bg-orange-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{d.title}</p>
                      <p className="text-sm text-gray-500">
                        {d.department_name} · {d.stage_name ?? 'sem etapa'} ·{' '}
                        {d.assignee_name ?? 'sem responsável'}
                      </p>
                    </div>
                    <span className={`flex-shrink-0 text-sm font-semibold
                                      ${overdue ? 'text-red-400' : 'text-orange-300'}`}>
                      {formatHoursRemaining(d.hours_remaining)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>

        {/* Atividade recente */}
        <section className="flex flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
          <h2 className="border-b border-gray-800 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            Últimas movimentações
          </h2>
          <div className="flex-1 overflow-y-auto">
            {!data ? (
              <TvSkeleton rows={6} />
            ) : (
              data.recent_activity.map(ev => (
                <div key={ev.id} className="flex items-center gap-3 border-b border-gray-800/60 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium text-gray-300">{ev.actor_name ?? 'Sistema'}</span>
                      {' '}<span className="text-gray-500">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>{' '}
                      <span className="font-medium text-gray-300">{ev.demand_title}</span>
                      {ev.event_type === 'stage_changed' && ev.stage_name && (
                        <span className="text-gray-500"> → {ev.stage_name}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-600">{ev.department_name}</p>
                  </div>
                  <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">
                    {relativeTime(ev.entered_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Rodapé: abertas por departamento ───────────────────────────────── */}
      <footer className="flex items-center gap-3 border-t border-gray-800 px-8 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Abertas por setor
        </span>
        {data?.by_department.map(d => (
          <span key={d.dept_name}
                className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-sm">
            <span className="text-gray-400">{d.dept_name}</span>{' '}
            <span className="font-bold text-gray-100">{d.count}</span>
          </span>
        ))}
        <span className="ml-auto text-xs text-gray-600">
          atualiza a cada 60s
          {data && ` · último: ${new Date(data.generated_at).toLocaleTimeString('pt-BR')}`}
        </span>
      </footer>
    </div>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function Kpi({ label, value, color, pulse }) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900/50 px-5 py-4
                     ${pulse ? 'animate-pulse border-red-900' : ''}`}>
      <p className={`font-mono text-5xl font-bold tabular-nums ${color}`}>
        {value ?? '–'}
      </p>
      <p className="mt-1 text-sm text-gray-500">{label}</p>
    </div>
  )
}

function TvSkeleton({ rows }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800/60" />
      ))}
    </div>
  )
}
