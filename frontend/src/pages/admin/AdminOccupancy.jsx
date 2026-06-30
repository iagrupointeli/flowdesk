import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

const STATUS_COLOR = {
  approved: 'bg-red-400 text-white',
  pending:  'bg-amber-300 text-amber-900',
}

// ── Calendário de bi-semanas ───────────────────────────────────────────────────
// Referência 2026: BS 02 inicia em 29/12/2025 (Puracor / Grupo Inteli).
// Cada bi-semana = 14 dias corridos. 26 bi-semanas por ano (numeração par: 02–52).
// Outros anos: deslocamento de 364 dias (26 × 14) por ano em relação à referência.

const BS_REF_YEAR  = 2026
const BS_REF_START = '2025-12-29' // início de BS 02/2026

function bisemanaRanges(year) {
  const ref  = new Date(BS_REF_START + 'T00:00:00')
  const diff = year - BS_REF_YEAR
  ref.setDate(ref.getDate() + diff * 364)

  return Array.from({ length: 26 }, (_, i) => {
    const s = new Date(ref); s.setDate(s.getDate() + i * 14)
    const e = new Date(s);   e.setDate(e.getDate() + 13)
    return {
      number: String((i + 1) * 2).padStart(2, '0'),
      from:   s.toISOString().slice(0, 10),
      to:     e.toISOString().slice(0, 10),
    }
  })
}

// ── Helpers gerais ─────────────────────────────────────────────────────────────

function weekRanges(from, to) {
  const ranges = []
  let cur = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (cur <= end) {
    const wEnd = new Date(cur)
    wEnd.setDate(wEnd.getDate() + 6)
    if (wEnd > end) wEnd.setTime(end.getTime())
    ranges.push({ from: cur.toISOString().slice(0, 10), to: wEnd.toISOString().slice(0, 10) })
    cur = new Date(wEnd); cur.setDate(cur.getDate() + 1)
  }
  return ranges
}

function isoToday() { return new Date().toISOString().slice(0, 10) }

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const ASSET_TYPES = ['painel', 'empena', 'led', 'lona', 'outdoor', 'mub', 'outro']

// ── Componente principal ───────────────────────────────────────────────────────

export default function AdminOccupancy() {
  const today = isoToday()
  const curYear = new Date().getFullYear()

  const [mode,      setMode]      = useState('bisemana') // 'weekly' | 'bisemana'
  const [bsYear,    setBsYear]    = useState(curYear)
  const [from,      setFrom]      = useState(today)
  const [to,        setTo]        = useState(addDays(today, 41))
  const [city,      setCity]      = useState('')
  const [assetType, setAssetType] = useState('')
  const [rows,      setRows]      = useState([])
  const [cities,    setCities]    = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState(null)
  const abortRef = useRef(null)

  // Períodos exibidos no grid
  const bsRanges   = bisemanaRanges(bsYear)
  const periods    = mode === 'bisemana'
    ? bsRanges
    : weekRanges(from, to)

  // Intervalo de datas para a query (cobre todos os períodos visíveis)
  const queryFrom = periods[0]?.from  ?? from
  const queryTo   = periods[periods.length - 1]?.to ?? to

  const fetchGrid = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    setIsLoading(true)
    try {
      const { data } = await api.get('/assets/occupancy-grid', {
        params: { from: queryFrom, to: queryTo, city: city || undefined, asset_type: assetType || undefined },
        signal: ctrl.signal,
      })
      setRows(data)
      const uniqueCities = [...new Set(data.map(r => r.city).filter(Boolean))].sort()
      setCities(uniqueCities)
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return
      setError('Falha ao carregar a grade de ocupação.')
    } finally {
      setIsLoading(false)
    }
  }, [queryFrom, queryTo, city, assetType])

  useEffect(() => {
    fetchGrid()
    return () => abortRef.current?.abort()
  }, [fetchGrid])

  function campaignForPeriod(campaigns, period) {
    return campaigns.filter(c => c.starts_on <= period.to && c.ends_on >= period.from)
  }

  // Bi-semana atual (destaque visual)
  const todayBs = mode === 'bisemana'
    ? bsRanges.find(bs => bs.from <= today && bs.to >= today)
    : null

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Grade de Ocupação</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {mode === 'bisemana'
              ? `Bi-semanas ${bsYear} — calendário Grupo Inteli (14 dias / período)`
              : 'Visão semanal de disponibilidade por ponto'}
          </p>
        </div>

        {/* Toggle de modo */}
        <div className="flex overflow-hidden rounded-lg border border-gray-300 text-sm">
          <button
            onClick={() => setMode('bisemana')}
            className={`px-4 py-1.5 font-medium transition-colors ${
              mode === 'bisemana'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Bi-semanas
          </button>
          <button
            onClick={() => setMode('weekly')}
            className={`border-l border-gray-300 px-4 py-1.5 font-medium transition-colors ${
              mode === 'weekly'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Semanas
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-6 py-3">

        {/* Controles de período — diferentes por modo */}
        {mode === 'bisemana' ? (
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-600">Ano</label>
            <select value={bsYear} onChange={e => setBsYear(Number(e.target.value))}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
              {[curYear - 1, curYear, curYear + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-gray-600">De</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                     className="rounded border border-gray-300 px-2 py-1 text-xs" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-gray-600">Até</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                     className="rounded border border-gray-300 px-2 py-1 text-xs" />
            </div>
          </>
        )}

        <select value={city} onChange={e => setCity(e.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
          <option value="">Todas as cidades</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={assetType} onChange={e => setAssetType(e.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
          <option value="">Todos os tipos</option>
          {ASSET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Legenda */}
        <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-green-100 border border-green-300" /> Livre
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-amber-300" /> Hold
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-red-400" /> Ocupado
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">Nenhum ponto encontrado.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {/* Header períodos */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              <div className="w-52 flex-shrink-0 border-r border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500">
                Ponto
              </div>
              <div className="grid flex-1"
                   style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
                {periods.map(p => {
                  const isCurrentBs = mode === 'bisemana' && todayBs?.number === p.number
                  return (
                    <div key={p.from}
                         className={`border-r border-gray-100 py-1.5 text-center last:border-0
                           ${isCurrentBs ? 'bg-primary-50' : ''}`}>
                      {mode === 'bisemana' ? (
                        <>
                          <p className={`text-[10px] font-bold leading-none ${isCurrentBs ? 'text-primary-700' : 'text-gray-700'}`}>
                            BS {p.number}
                          </p>
                          <p className="mt-0.5 text-[9px] leading-none text-gray-400">
                            {fmtDate(p.from)}–{fmtDate(p.to)}
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] text-gray-500">{fmtDate(p.from)}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Linhas */}
            {rows.map(asset => (
              <div key={asset.id} className="flex border-b border-gray-100 last:border-0">
                <div className="w-52 flex-shrink-0 border-r border-gray-100 px-3 py-2">
                  <p className="truncate text-xs font-medium text-gray-900" title={asset.name}>
                    {asset.code && <span className="font-mono text-gray-400">[{asset.code}] </span>}
                    {asset.name}
                  </p>
                  {asset.city && (
                    <p className="truncate text-[10px] text-gray-400">{asset.city}</p>
                  )}
                </div>
                <div className="grid flex-1 gap-px p-1"
                     style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
                  {periods.map(p => {
                    const hits = campaignForPeriod(asset.campaigns, p)
                    const isCurrentBs = mode === 'bisemana' && todayBs?.number === p.number
                    if (!hits.length) {
                      return (
                        <div key={p.from}
                             className={`rounded border flex items-center justify-center h-7
                               ${isCurrentBs
                                 ? 'bg-primary-50 border-primary-200'
                                 : 'bg-green-50 border-green-100'}`} />
                      )
                    }
                    const first = hits[0]
                    return (
                      <div key={p.from}
                           title={`${first.client_name} — ${first.campaign_title ?? first.title}\n${first.starts_on} → ${first.ends_on}`}
                           className={`rounded flex items-center justify-center h-7 text-[9px] font-semibold truncate px-0.5
                             ${STATUS_COLOR[first.status] ?? 'bg-gray-200 text-gray-700'}`}>
                        {hits.length > 1 ? `${hits.length}×` : (first.client_name?.slice(0, 6) ?? '—')}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
