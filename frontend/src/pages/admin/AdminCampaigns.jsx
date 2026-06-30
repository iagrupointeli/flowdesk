import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../lib/api'

/**
 * Calendário de Ocupação — /admin/campaigns
 *
 * Timeline mensal por ponto: cada linha é um ponto OOH, as barras coloridas
 * são campanhas (anunciante + período). Visual de disponibilidade imediato.
 *
 * Anti-double-booking: o PostgreSQL rejeita fisicamente períodos sobrepostos
 * no mesmo ponto (exclusion constraint). A API devolve 409 e o modal exibe
 * o conflito de forma clara.
 */

const BAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-lime-600', 'bg-fuchsia-500',
]

function colorFor(id) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return BAR_COLORS[h % BAR_COLORS.length]
}

function ym(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function fmtShort(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function AdminCampaigns() {
  const [month,     setMonth]     = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [campaigns, setCampaigns] = useState([])
  const [assets,    setAssets]    = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState(null)
  const [showModal,       setShowModal]       = useState(false)
  const [selectedIds,     setSelectedIds]     = useState(new Set())
  const [batchProcessing, setBatchProcessing] = useState(false)

  const abortRef = useRef(null)

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const monthStart  = `${ym(month)}-01`
  const monthEnd    = `${ym(month)}-${String(daysInMonth).padStart(2, '0')}`

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    try {
      const [cRes, aRes] = await Promise.all([
        api.get('/campaigns', { params: { from: monthStart, to: monthEnd }, signal: ctrl.signal }),
        api.get('/assets', { signal: ctrl.signal }),
      ])
      setCampaigns(cRes.data)
      setAssets(aRes.data)
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return
      setError('Falha ao carregar a ocupação.')
    } finally {
      setIsLoading(false)
    }
  }, [monthStart, monthEnd])

  useEffect(() => {
    fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  // Agrupa campanhas por ponto
  const byAsset = useMemo(() => {
    const map = new Map()
    for (const c of campaigns) {
      if (!map.has(c.asset_id)) map.set(c.asset_id, [])
      map.get(c.asset_id).push(c)
    }
    return map
  }, [campaigns])

  // Linhas: pontos com campanha no mês primeiro, depois os livres
  const rows = useMemo(() => {
    const occupied = assets.filter(a => byAsset.has(a.id))
    const free     = assets.filter(a => !byAsset.has(a.id))
    return [...occupied, ...free]
  }, [assets, byAsset])

  function shiftMonth(delta) {
    setMonth(m => {
      const next = new Date(m)
      next.setMonth(next.getMonth() + delta)
      return next
    })
  }

  // Converte campanha em posição de grid (colunas 1..daysInMonth, clampada ao mês)
  function gridPos(c) {
    const s = c.starts_on.slice(0, 7) === ym(month) ? Number(c.starts_on.slice(8, 10)) : 1
    const e = c.ends_on.slice(0, 7)   === ym(month) ? Number(c.ends_on.slice(8, 10))   : daysInMonth
    return { start: s, end: e }
  }

  async function handleArchive(id) {
    const prev = campaigns
    setCampaigns(cs => cs.filter(c => c.id !== id))
    try {
      await api.delete(`/campaigns/${id}`)
    } catch {
      setCampaigns(prev)
    }
  }

  const monthLabel = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const today = new Date()
  const todayCol = ym(today) === ym(month) ? today.getDate() : null

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Ocupação de Pontos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Campanhas por ponto — conflitos de período são bloqueados automaticamente
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                     transition-colors hover:bg-primary-700"
        >
          + Nova campanha
        </button>
      </div>

      {/* Navegação de mês */}
      <div className="flex items-center justify-center gap-4 border-b border-gray-200 bg-gray-50 px-6 py-2.5">
        <button onClick={() => shiftMonth(-1)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-white">
          ←
        </button>
        <span className="w-48 text-center text-sm font-semibold capitalize text-gray-900">
          {monthLabel}
        </span>
        <button onClick={() => shiftMonth(1)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-white">
          →
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Painel de campanhas aguardando aprovação ──────────────────────── */}
        {(() => {
          const pending   = campaigns.filter(c => c.approval_status === 'pending')
          if (!pending.length) return null

          const allSelected = pending.length > 0 && pending.every(c => selectedIds.has(c.id))
          const anySelected = pending.some(c => selectedIds.has(c.id))

          function toggleAll() {
            setSelectedIds(allSelected
              ? new Set()
              : new Set(pending.map(c => c.id))
            )
          }

          function toggleOne(id) {
            setSelectedIds(prev => {
              const next = new Set(prev)
              next.has(id) ? next.delete(id) : next.add(id)
              return next
            })
          }

          async function batchApprove() {
            if (!anySelected || batchProcessing) return
            setBatchProcessing(true)
            try {
              await Promise.all(
                [...selectedIds].map(id => api.post(`/campaigns/${id}/approval`, { action: 'approved' }))
              )
              setSelectedIds(new Set())
              fetchData()
            } finally { setBatchProcessing(false) }
          }

          async function batchReject() {
            if (!anySelected || batchProcessing) return
            const note = prompt('Motivo da reprovação (opcional, vale para todas):') ?? ''
            setBatchProcessing(true)
            try {
              await Promise.all(
                [...selectedIds].map(id => api.post(`/campaigns/${id}/approval`, { action: 'rejected', note }))
              )
              setSelectedIds(new Set())
              fetchData()
            } finally { setBatchProcessing(false) }
          }

          return (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              {/* Header do painel */}
              <div className="mb-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-amber-400 accent-amber-600 cursor-pointer"
                  title="Selecionar todas"
                />
                <h2 className="flex-1 text-sm font-semibold text-amber-800">
                  ⏳ Aguardando aprovação ({pending.length})
                  {anySelected && (
                    <span className="ml-2 font-normal text-amber-600">
                      — {selectedIds.size} selecionada{selectedIds.size !== 1 ? 's' : ''}
                    </span>
                  )}
                </h2>
                {anySelected && (
                  <div className="flex gap-2">
                    <button
                      onClick={batchApprove}
                      disabled={batchProcessing}
                      className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {batchProcessing ? '…' : `✓ Aprovar ${selectedIds.size}`}
                    </button>
                    <button
                      onClick={batchReject}
                      disabled={batchProcessing}
                      className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {batchProcessing ? '…' : `✕ Reprovar ${selectedIds.size}`}
                    </button>
                  </div>
                )}
              </div>

              {/* Linhas */}
              <div className="space-y-2">
                {pending.map(c => (
                  <div
                    key={c.id}
                    onClick={() => toggleOne(c.id)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors
                      ${selectedIds.has(c.id)
                        ? 'border-amber-300 bg-amber-100'
                        : 'border-amber-100 bg-white hover:bg-amber-50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      onClick={e => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 accent-amber-600 cursor-pointer flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{c.client_name} — {c.title}</p>
                      <p className="text-xs text-gray-500">
                        {c.asset_name}{c.asset_code ? ` [${c.asset_code}]` : ''} · {c.starts_on} → {c.ends_on}
                        {c.is_premium && <span className="ml-2 text-amber-600 font-semibold">⭐ Premium</span>}
                        {c.expires_at && (() => {
                          const days = Math.ceil((new Date(c.expires_at) - Date.now()) / 86400000)
                          return days <= 0
                            ? <span className="ml-2 text-red-600 font-semibold">Expirado</span>
                            : <span className={`ml-2 font-semibold ${days <= 2 ? 'text-red-600' : 'text-amber-600'}`}>
                                ⏱ {days}d
                              </span>
                        })()}
                      </p>
                    </div>
                    <button
                      onClick={async e => {
                        e.stopPropagation()
                        await api.post(`/campaigns/${c.id}/approval`, { action: 'approved' })
                        setSelectedIds(prev => { const n = new Set(prev); n.delete(c.id); return n })
                        fetchData()
                      }}
                      className="flex-shrink-0 rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      ✓
                    </button>
                    <button
                      onClick={async e => {
                        e.stopPropagation()
                        const note = prompt('Motivo da reprovação (opcional):') ?? ''
                        await api.post(`/campaigns/${c.id}/approval`, { action: 'rejected', note })
                        setSelectedIds(prev => { const n = new Set(prev); n.delete(c.id); return n })
                        fetchData()
                      }}
                      className="flex-shrink-0 rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : assets.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <p className="text-gray-500">Nenhum ponto cadastrado.</p>
            <p className="mt-1 text-sm text-gray-400">
              Cadastre pontos no Inventário para gerenciar a ocupação.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {/* Header de dias */}
            <div className="flex border-b border-gray-200 bg-gray-50">
              <div className="w-48 flex-shrink-0 border-r border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500">
                Ponto
              </div>
              <div className="grid flex-1"
                   style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))` }}>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <div key={i}
                       className={`py-2 text-center text-[10px] tabular-nums
                         ${todayCol === i + 1 ? 'bg-primary-50 font-bold text-primary-700' : 'text-gray-400'}`}>
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>

            {/* Linhas por ponto */}
            {rows.map(asset => {
              const assetCampaigns = byAsset.get(asset.id) ?? []
              return (
                <div key={asset.id} className="flex border-b border-gray-100 last:border-0">
                  <div className="w-48 flex-shrink-0 border-r border-gray-100 px-3 py-2.5">
                    <p className="truncate text-xs font-medium text-gray-900" title={asset.name}>
                      {asset.code && <span className="font-mono text-gray-400">[{asset.code}] </span>}
                      {asset.name}
                    </p>
                  </div>
                  <div className="relative grid flex-1 items-center py-1.5"
                       style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))` }}>
                    {/* coluna do dia atual */}
                    {todayCol && (
                      <div className="pointer-events-none absolute inset-y-0 bg-primary-50/60"
                           style={{
                             left:  `${((todayCol - 1) / daysInMonth) * 100}%`,
                             width: `${(1 / daysInMonth) * 100}%`,
                           }} />
                    )}
                    {assetCampaigns.length === 0 ? (
                      <span className="col-span-full px-2 text-[10px] text-gray-300">livre</span>
                    ) : (
                      assetCampaigns.map(c => {
                        const { start, end } = gridPos(c)
                        return (
                          <div
                            key={c.id}
                            className={`group relative z-10 mx-px flex h-6 cursor-default items-center
                                        overflow-hidden rounded px-1.5 ${colorFor(c.id)}`}
                            style={{ gridColumn: `${start} / ${end + 1}` }}
                            title={`${c.client_name} — ${c.title}\n${fmtShort(c.starts_on)} a ${fmtShort(c.ends_on)}`}
                          >
                            <span className="truncate text-[10px] font-semibold text-white">
                              {c.client_name}
                            </span>
                            <button
                              onClick={() => handleArchive(c.id)}
                              title="Remover campanha"
                              className="ml-auto hidden flex-shrink-0 text-white/70 hover:text-white group-hover:block"
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <NewCampaignModal
          assets={assets}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchData() }}
        />
      )}
    </div>
  )
}

// ── Modal de criação ─────────────────────────────────────────────────────────

function NewCampaignModal({ assets, onClose, onCreated }) {
  const [form, setForm] = useState({
    asset_id: '', client_name: '', title: '', starts_on: '', ends_on: '', notes: '',
    demand_id: null,
  })
  const [submitError,    setSubmitError]    = useState(null)
  const [isConflict,     setIsConflict]     = useState(false)
  const [isSaving,       setIsSaving]       = useState(false)
  const [demandSearch,   setDemandSearch]   = useState('')
  const [demandResults,  setDemandResults]  = useState([])
  const [selectedDemand, setSelectedDemand] = useState(null)
  const [availability,   setAvailability]   = useState(null) // null | { available, conflicts }

  const searchDebounce = useRef(null)
  const availDebounce  = useRef(null)

  function set(key) {
    return e => {
      const val = e.target.value
      setForm(f => {
        const next = { ...f, [key]: val }
        if (key === 'asset_id' || key === 'starts_on' || key === 'ends_on') {
          checkAvail(next)
        }
        return next
      })
    }
  }

  function checkAvail(f) {
    clearTimeout(availDebounce.current)
    if (!f.asset_id || !f.starts_on || !f.ends_on) { setAvailability(null); return }
    availDebounce.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/assets/${f.asset_id}/availability`, {
          params: { from: f.starts_on, to: f.ends_on },
        })
        setAvailability(data)
      } catch { setAvailability(null) }
    }, 400)
  }

  function handleDemandSearch(q) {
    setDemandSearch(q)
    clearTimeout(searchDebounce.current)
    if (!q.trim()) { setDemandResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/demands', { params: { q: q.trim(), limit: 8 } })
        setDemandResults(Array.isArray(data) ? data : (data.demands ?? []))
      } catch { /* silencioso */ }
    }, 300)
  }

  function selectDemand(d) {
    setSelectedDemand(d)
    setForm(f => ({ ...f, demand_id: d.id }))
    setDemandSearch('')
    setDemandResults([])
  }

  function clearDemand() {
    setSelectedDemand(null)
    setForm(f => ({ ...f, demand_id: null }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setIsConflict(false)
    setIsSaving(true)
    try {
      await api.post('/campaigns', { ...form, notes: form.notes.trim() || null })
      onCreated()
    } catch (err) {
      const status = err.response?.status
      setIsConflict(status === 409)
      setSubmitError(err.response?.data?.error
        ?? err.response?.data?.errors?.fieldErrors?.ends_on?.[0]
        ?? 'Falha ao criar a campanha.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Nova campanha</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Ponto *</label>
            <select required value={form.asset_id} onChange={set('asset_id')} className={inputCls}>
              <option value="">Selecione…</option>
              {assets.map(a => (
                <option key={a.id} value={a.id}>
                  {a.code ? `[${a.code}] ` : ''}{a.name}{a.city ? ` — ${a.city}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Anunciante *</label>
              <input type="text" required minLength={2} maxLength={200}
                     placeholder="Ex.: Ambev"
                     value={form.client_name} onChange={set('client_name')} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Campanha *</label>
              <input type="text" required minLength={2} maxLength={300}
                     placeholder="Ex.: Verão 2026"
                     value={form.title} onChange={set('title')} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Início *</label>
              <input type="date" required value={form.starts_on} onChange={set('starts_on')} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fim *</label>
              <input type="date" required value={form.ends_on} onChange={set('ends_on')} className={inputCls} />
            </div>
          </div>

          {availability && (
            availability.available ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                ✓ Ponto disponível no período selecionado
              </div>
            ) : (
              <div className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                <p className="font-semibold">⚠ Ponto ocupado no período</p>
                {availability.conflicts.map(c => (
                  <p key={c.id} className="mt-0.5 text-xs">
                    {c.client_name} — {c.title} ({c.starts_on} → {c.ends_on})
                  </p>
                ))}
              </div>
            )
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Demanda de produção <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            {selectedDemand ? (
              <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
                <span className="flex-1 truncate text-blue-800">{selectedDemand.title}</span>
                <button type="button" onClick={clearDemand}
                        className="text-gray-400 hover:text-red-500">✕</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="search"
                  value={demandSearch}
                  onChange={e => handleDemandSearch(e.target.value)}
                  placeholder="Buscar demanda por título…"
                  className={inputCls}
                />
                {demandResults.length > 0 && (
                  <ul className="absolute z-10 top-full left-0 right-0 bg-white border rounded-b-lg shadow text-sm max-h-40 overflow-y-auto">
                    {demandResults.map(d => (
                      <li key={d.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-800"
                          onClick={() => selectDemand(d)}
                        >
                          {d.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Observações</label>
            <textarea rows={2} maxLength={2000} value={form.notes} onChange={set('notes')} className={inputCls} />
          </div>

          {submitError && (
            <div className={`rounded-lg px-3 py-2 text-sm
              ${isConflict ? 'border border-orange-300 bg-orange-50 text-orange-800' : 'bg-red-50 text-red-700'}`}>
              {isConflict && <p className="font-semibold">⚠ Ponto ocupado</p>}
              {submitError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSaving}
                    className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                               hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? 'Salvando…' : 'Criar campanha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400'
