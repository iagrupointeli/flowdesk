import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../lib/api'

/**
 * Inventário de Pontos OOH — /admin/assets
 *
 * Registro estruturado dos ativos físicos da empresa (painéis, empenas,
 * LED, lonas). Cada ponto acumula a timeline de demandas vinculadas a ele
 * (instalações, manutenções, checkings).
 *
 * Leitura é liberada a todos os roles (o select do NewDemand usa GET /assets);
 * esta página de gestão é restrita a admins via rota protegida.
 */

const TYPE_LABELS = {
  painel:  'Painel',
  empena:  'Empena',
  led:     'LED',
  lona:    'Lona',
  outdoor: 'Outdoor',
  mub:     'MUB',
  outro:   'Outro',
}

const SEARCH_FIELD_LABELS = {
  '':           'Todos os campos',
  code:         'Código',
  name:         'Nome',
  address:      'Endereço',
  dimensions:   'Dimensões',
}

const EMPTY_FORM = {
  code: '', name: '', asset_type: 'painel',
  address: '', city: '', dimensions: '', notes: '',
}

const PAGE_SIZE = 500

// Janela de páginas: 1 … (atual-2 … atual+2) … N, com reticências.
function pageList(current, totalPages) {
  const out = []
  const lo = Math.max(1, current - 2)
  const hi = Math.min(totalPages, current + 2)
  if (lo > 1)            { out.push(1); if (lo > 2) out.push('…') }
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi < totalPages)   { if (hi < totalPages - 1) out.push('…'); out.push(totalPages) }
  return out
}

function PagerBtn({ active, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[2rem] rounded-md border px-2 py-1 text-xs font-medium transition-colors
        ${active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}
        disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}

export default function AdminAssets() {
  const [assets,    setAssets]    = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState(null)

  const [localQ,     setLocalQ]     = useState('')
  const [q,          setQ]          = useState('')
  const [qField,     setQField]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [incompleteOnly, setIncompleteOnly] = useState(false)

  const scrollRef = useRef(null)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [editing,     setEditing]     = useState(null)   // null | 'new' | asset
  const [timelineOf,  setTimelineOf]  = useState(null)   // null | asset
  const [docsOf,      setDocsOf]      = useState(null)   // null | asset
  const [lifecycleOf, setLifecycleOf] = useState(null)   // null | asset

  const [sync,       setSync]       = useState(null)   // null | status object
  const [previewUrl, setPreviewUrl] = useState(null)  // null | foto URL
  const syncPollRef  = useRef(null)

  const debounceRef = useRef(null)
  const abortRef    = useRef(null)

  const handleQChange = useCallback((value) => {
    setLocalQ(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setQ(value); setPage(1) }, 400)
  }, [])

  const fetchAssets = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    try {
      const params = { page, page_size: PAGE_SIZE }
      if (q.trim())    params.q          = q.trim()
      if (q.trim() && qField) params.q_field = qField
      if (typeFilter)  params.asset_type = typeFilter
      if (incompleteOnly) params.incomplete = 'true'
      const res = await api.get('/assets', { params, signal: ctrl.signal })
      setAssets(res.data)
      setTotal(Number(res.headers['x-total-count'] ?? res.data.length))
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return
      setError('Falha ao carregar o inventário de pontos.')
    } finally {
      setIsLoading(false)
    }
  }, [q, qField, typeFilter, incompleteOnly, page])

  useEffect(() => {
    fetchAssets()
    return () => abortRef.current?.abort()
  }, [fetchAssets])

  // Ao trocar de página, rola a tabela de volta ao topo.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [page])

  // Se o total encolher (ex.: arquivamento) e a página atual ficar fora do
  // intervalo, recua para a última página válida.
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [totalPages, page])

  function startSyncPoll() {
    clearInterval(syncPollRef.current)
    syncPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/admin/assets/sync-scoutdoor/status')
        setSync(data)
        if (data.done) {
          clearInterval(syncPollRef.current)
          fetchAssets()
        }
      } catch { /* ignora falha de poll */ }
    }, 2000)
  }

  async function handleStartSync() {
    try {
      await api.post('/admin/assets/sync-scoutdoor')
      const { data } = await api.get('/admin/assets/sync-scoutdoor/status')
      setSync(data)
      startSyncPoll()
    } catch (err) {
      alert(err.response?.data?.error ?? 'Falha ao iniciar sync.')
    }
  }

  async function handleArchive(id) {
    const prev = assets
    setAssets(a => a.filter(x => x.id !== id))
    try {
      await api.delete(`/assets/${id}`)
    } catch {
      setAssets(prev)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventário de Pontos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Ativos físicos da empresa — {total.toLocaleString('pt-BR')} ponto(s)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleStartSync}
            disabled={sync?.running}
            className="rounded-lg border border-primary-300 bg-primary-50 px-4 py-2 text-sm
                       font-semibold text-primary-700 transition-colors hover:bg-primary-100
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sync?.running ? 'Sincronizando…' : 'Sincronizar Scoutdoor'}
          </button>
          <button
            onClick={() => setEditing('new')}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                       transition-colors hover:bg-primary-700"
          >
            + Novo ponto
          </button>
        </div>
      </div>

      {/* Painel de status do sync */}
      {sync && (
        <div className={`flex items-center gap-4 border-b px-6 py-3 text-sm ${
          sync.error   ? 'border-red-200 bg-red-50'
          : sync.done  ? 'border-green-200 bg-green-50'
          : 'border-blue-200 bg-blue-50'
        }`}>
          {sync.running && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {sync.running && (
              <span className="text-blue-700">
                Sincronizando… {sync.processed} de {sync.total || '?'} pontos processados
              </span>
            )}
            {sync.done && !sync.error && (
              <span className="text-green-700 font-medium">
                Sync concluído — {sync.created} criados · {sync.updated} atualizados · {sync.errors} erros
              </span>
            )}
            {sync.error && (
              <span className="text-red-700">Sync falhou: {sync.error}</span>
            )}
          </div>
          {sync.done && (
            <button onClick={() => setSync(null)} className="text-gray-400 hover:text-gray-600 text-xs flex-shrink-0">
              ✕ Fechar
            </button>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-3 border-b border-gray-200 bg-gray-50 px-6 py-3">
        <input
          type="text"
          value={localQ}
          onChange={e => handleQChange(e.target.value)}
          placeholder={qField
            ? `Buscar por ${SEARCH_FIELD_LABELS[qField].toLowerCase()}…`
            : 'Buscar por nome, código, endereço ou cidade…'}
          className="w-80 rounded-lg border border-gray-300 px-3 py-1.5 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
        <select
          value={qField}
          onChange={e => { setQField(e.target.value); setPage(1) }}
          title="Restringir busca a um campo específico"
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          {Object.entries(SEARCH_FIELD_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={e => { setIncompleteOnly(e.target.checked); setPage(1) }}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-400"
          />
          Apenas pontos incompletos
        </label>
      </div>

      {/* Tabela */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : assets.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <p className="text-gray-500">Nenhum ponto cadastrado.</p>
            <p className="mt-1 text-sm text-gray-400">
              Cadastre os painéis, empenas e LEDs da empresa para vincular demandas a eles.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['', 'Código', 'Nome', 'Tipo', 'Endereço', 'Dimensões', 'Demandas', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assets.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      {a.photo_url
                        ? <img src={a.photo_url} alt="" loading="lazy" onClick={() => setPreviewUrl(a.photo_url)} className="h-12 w-20 cursor-zoom-in rounded object-contain bg-gray-50 hover:opacity-80 transition-opacity" />
                        : <div className="h-12 w-20 rounded bg-gray-100" />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                      {a.code ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <button
                        onClick={() => setTimelineOf(a)}
                        className="text-left hover:text-primary-600 hover:underline"
                        title="Ver histórico do ponto"
                      >
                        {a.name}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                        {TYPE_LABELS[a.asset_type] ?? a.asset_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[260px]">
                      <span className="line-clamp-1">
                        {[a.address, a.city].filter(Boolean).join(' — ') || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {a.dimensions ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm">
                      <span className="font-semibold text-gray-900">{a.open_demand_count}</span>
                      <span className="text-gray-400"> aberta(s) / {a.demand_count} total</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-base">
                      <button
                        onClick={() => setEditing(a)}
                        className="mr-3 text-gray-400 hover:text-primary-600"
                        title="Editar"
                      >
                        ✎
                      </button>
                      <button
                        onClick={async () => {
                          await api.patch(`/assets/${a.id}`, { is_premium: !a.is_premium })
                          fetchAssets()
                        }}
                        className={`mr-3 ${a.is_premium ? 'text-amber-500 hover:text-amber-700' : 'text-gray-400 hover:text-amber-500'}`}
                        title={a.is_premium ? 'Remover flag premium' : 'Marcar como premium'}
                      >
                        {a.is_premium ? '⭐' : '☆'}
                      </button>
                      <button
                        onClick={() => setDocsOf(a)}
                        className="mr-3 text-gray-400 hover:text-amber-600"
                        title="Documentos"
                      >
                        📄
                      </button>
                      <button
                        onClick={() => setLifecycleOf(a)}
                        className="mr-3 text-gray-400 hover:text-teal-600"
                        title="Ciclo de vida"
                      >
                        🔧
                      </button>
                      <button
                        onClick={() => handleArchive(a.id)}
                        className="text-gray-400 hover:text-red-600"
                        title="Arquivar"
                      >
                        🗄
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginação */}
      {!isLoading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-6 py-3 text-sm">
          <span className="text-gray-500">
            Mostrando{' '}
            <b className="text-gray-700">{((page - 1) * PAGE_SIZE + 1).toLocaleString('pt-BR')}</b>–
            <b className="text-gray-700">{Math.min(page * PAGE_SIZE, total).toLocaleString('pt-BR')}</b>
            {' '}de{' '}
            <b className="text-gray-700">{total.toLocaleString('pt-BR')}</b> ponto(s)
          </span>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <PagerBtn onClick={() => setPage(1)}              disabled={page <= 1}>« Primeira</PagerBtn>
              <PagerBtn onClick={() => setPage(p => p - 1)}     disabled={page <= 1}>‹</PagerBtn>
              {pageList(page, totalPages).map((p, i) =>
                p === '…'
                  ? <span key={`gap-${i}`} className="px-2 text-gray-400">…</span>
                  : <PagerBtn key={p} onClick={() => setPage(p)} active={p === page}>{p}</PagerBtn>
              )}
              <PagerBtn onClick={() => setPage(p => p + 1)}     disabled={page >= totalPages}>›</PagerBtn>
              <PagerBtn onClick={() => setPage(totalPages)}     disabled={page >= totalPages}>Última »</PagerBtn>
            </div>
          )}
        </div>
      )}

      {editing && (
        <AssetFormModal
          asset={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchAssets() }}
        />
      )}

      {timelineOf && (
        <TimelineModal asset={timelineOf} onClose={() => setTimelineOf(null)} />
      )}

      {docsOf && (
        <DocumentsModal asset={docsOf} onClose={() => setDocsOf(null)} />
      )}

      {lifecycleOf && (
        <LifecycleModal asset={lifecycleOf} onClose={() => setLifecycleOf(null)} />
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Preview"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute right-5 top-5 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// ── Modal de criação/edição ──────────────────────────────────────────────────

function AssetFormModal({ asset, onClose, onSaved }) {
  const isEdit = !!asset
  const [form, setForm] = useState(isEdit
    ? { code: asset.code ?? '', name: asset.name, asset_type: asset.asset_type,
        address: asset.address ?? '', city: asset.city ?? '',
        dimensions: asset.dimensions ?? '', notes: asset.notes ?? '' }
    : EMPTY_FORM)
  const [submitError, setSubmitError] = useState(null)
  const [isSaving,    setIsSaving]    = useState(false)

  const [photoPreview,   setPhotoPreview]   = useState(asset?.photo_url ?? null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError,     setPhotoError]     = useState(null)
  const photoInputRef = useRef(null)

  function set(key) {
    return e => setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await api.post(`/assets/${asset.id}/photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPhotoPreview(data.photo_url)
    } catch (err) {
      setPhotoError(err.response?.data?.error ?? 'Falha ao enviar a imagem.')
    } finally {
      setPhotoUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setIsSaving(true)
    try {
      const body = { ...form, code: form.code.trim() || null }
      if (isEdit) await api.patch(`/assets/${asset.id}`, body)
      else        await api.post('/assets', body)
      onSaved()
    } catch (err) {
      setSubmitError(err.response?.data?.error ?? 'Falha ao salvar o ponto.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">
          {isEdit ? 'Editar ponto' : 'Novo ponto'}
        </h2>

        {isEdit && (
          <div className="mt-4 flex items-center gap-4">
            {photoPreview
              ? <img src={photoPreview} alt="" className="h-20 w-32 rounded-lg object-cover bg-gray-50 border border-gray-200" />
              : <div className="flex h-20 w-32 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-xs text-gray-400">
                  Sem foto
                </div>}
            <div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoChange}
                disabled={photoUploading}
                className="hidden"
                id="asset-photo-input"
              />
              <label
                htmlFor="asset-photo-input"
                className={`inline-block cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${photoUploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {photoUploading ? 'Enviando…' : photoPreview ? 'Trocar foto' : '+ Adicionar foto'}
              </label>
              {photoError && <p className="mt-1 text-xs text-red-600">{photoError}</p>}
              <p className="mt-1 text-xs text-gray-400">JPEG, PNG ou WebP — até 8 MB</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Código</label>
              <input
                type="text" maxLength={50} placeholder="PT-001"
                value={form.code} onChange={set('code')}
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Nome *</label>
              <input
                type="text" required minLength={2} maxLength={200}
                placeholder="Painel LED Av. Paulista"
                value={form.name} onChange={set('name')}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Tipo *</label>
              <select value={form.asset_type} onChange={set('asset_type')} className={inputCls}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Dimensões</label>
              <input
                type="text" maxLength={80} placeholder="9×3m"
                value={form.dimensions} onChange={set('dimensions')}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Endereço</label>
              <input
                type="text" maxLength={500}
                value={form.address} onChange={set('address')}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Cidade</label>
              <input
                type="text" maxLength={120}
                value={form.city} onChange={set('city')}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Observações</label>
            <textarea
              rows={2} maxLength={2000}
              value={form.notes} onChange={set('notes')}
              className={inputCls}
            />
          </div>

          {submitError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSaving}
                    className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                               hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Cadastrar ponto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal de timeline ────────────────────────────────────────────────────────

function TimelineModal({ asset, onClose }) {
  const [data,      setData]      = useState(null)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    const ctrl = new AbortController()
    api.get(`/assets/${asset.id}/timeline`, { signal: ctrl.signal })
      .then(res => setData(res.data))
      .catch(err => {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError')
          setError('Falha ao carregar o histórico.')
      })
    return () => ctrl.abort()
  }, [asset.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
           onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{asset.name}</h2>
          <p className="text-sm text-gray-500">
            {asset.code && <span className="font-mono">{asset.code} · </span>}
            {[asset.address, asset.city].filter(Boolean).join(' — ') || 'Sem endereço'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          )}
          {data && data.demands.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              Nenhuma demanda vinculada a este ponto ainda.
            </p>
          )}
          {data && data.demands.map(d => (
            <Link
              key={d.id}
              to={`/demands/${d.id}`}
              className="flex items-center gap-3 border-b border-gray-100 py-3 hover:bg-gray-50"
            >
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${
                d.exception_state === 'cancelled' ? 'bg-gray-300'
                : d.is_final ? 'bg-green-500'
                : 'bg-blue-500'
              }`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{d.title}</p>
                <p className="text-xs text-gray-500">
                  {d.demand_type_name} · {d.department_name} · {d.current_stage_name ?? 'sem etapa'}
                </p>
              </div>
              <span className="flex-shrink-0 text-xs text-gray-400">
                {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                  .format(new Date(d.created_at))}
              </span>
            </Link>
          ))}
        </div>

        <div className="border-t border-gray-200 px-6 py-3 text-right">
          <button onClick={onClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400'

// ── Modal de documentos do ponto ─────────────────────────────────────────────

const EMPTY_DOC = { title: '', doc_type: 'alvara', expires_at: '', notes: '' }
const DOC_TYPES = ['alvara', 'contrato', 'seguro', 'licenca', 'outro']

function DocumentsModal({ asset, onClose }) {
  const [docs,    setDocs]    = useState([])
  const [form,    setForm]    = useState(null)   // null | doc-para-editar | EMPTY_DOC
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  const loadDocs = useCallback(async () => {
    const { data } = await api.get(`/admin/assets/${asset.id}/documents`)
    setDocs(data)
  }, [asset.id])

  useEffect(() => { loadDocs() }, [loadDocs])

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      const { id, ...payload } = form
      if (id) await api.patch(`/admin/assets/${asset.id}/documents/${id}`, payload)
      else    await api.post(`/admin/assets/${asset.id}/documents`, payload)
      setForm(null)
      await loadDocs()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Falha ao salvar.')
    } finally { setSaving(false) }
  }

  async function handleDelete(docId) {
    if (!confirm('Remover documento?')) return
    await api.delete(`/admin/assets/${asset.id}/documents/${docId}`)
    await loadDocs()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Documentos — {asset.name}</h2>
            <p className="text-xs text-gray-400">Alvarás, contratos, seguros, licenças</p>
          </div>
          <button onClick={() => setForm({ ...EMPTY_DOC })}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">
            + Novo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {docs.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-400">Nenhum documento cadastrado.</p>
          )}
          {docs.map(doc => {
            const d   = doc.days_remaining
            const isLicense = ['alvara', 'licenca'].includes(doc.doc_type)
            const rowCls = doc.expired
              ? 'border-red-200 bg-red-50'
              : (isLicense && d <= 30) || (!isLicense && d <= 7)
                ? 'border-amber-200 bg-amber-50'
                : isLicense && d <= 60
                  ? 'border-yellow-100 bg-yellow-50'
                  : 'border-gray-100 bg-gray-50'
            const dot = doc.expired
              ? 'bg-red-500'
              : d <= 30 ? 'bg-amber-400'
              : d <= 60 ? 'bg-yellow-300'
              : 'bg-green-400'
            return (
              <div key={doc.id}
                   className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs border ${rowCls}`}>
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dot}`} title={doc.expired ? 'Vencido' : `${d} dias`} />
                <div className="flex-1 min-w-0">
                  <p className={`font-medium truncate ${doc.expired ? 'text-red-700' : 'text-gray-900'}`}>
                    {doc.title}
                  </p>
                  <p className="text-gray-400">{doc.doc_type} · vence {doc.expires_at}</p>
                </div>
                {doc.expired
                  ? <span className="text-red-500 font-bold shrink-0">VENCIDO</span>
                  : <span className={`font-semibold shrink-0 ${d <= 30 ? 'text-amber-600' : d <= 60 ? 'text-yellow-600' : 'text-green-600'}`}>{d}d</span>
                }
                <button onClick={() => setForm({ ...doc })} className="text-gray-400 hover:text-primary-600">✎</button>
                <button onClick={() => handleDelete(doc.id)} className="text-gray-400 hover:text-red-600">✕</button>
              </div>
            )
          })}
        </div>

        {form && (
          <div className="border-t border-gray-200 px-6 py-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-600">{form.id ? 'Editar documento' : 'Novo documento'}</h3>
            <input className={inputCls} placeholder="Título (ex: Alvará Municipal 2025)"
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3">
              <select className={inputCls} value={form.doc_type}
                onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" className={inputCls} value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </div>
            <textarea className={inputCls} rows={2} placeholder="Observações"
              value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                      className="flex-1 rounded-lg bg-primary-600 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              <button onClick={() => { setForm(null); setError(null) }}
                      className="flex-1 rounded-lg border border-gray-300 py-1.5 text-sm text-gray-600">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 px-6 py-3 text-right">
          <button onClick={onClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal de ciclo de vida do ponto ─────────────────────────────────────────

const EVENT_TYPES = [
  { value: 'manutencao',     label: 'Manutenção' },
  { value: 'vistoria',       label: 'Vistoria' },
  { value: 'reparo',         label: 'Reparo' },
  { value: 'troca_material', label: 'Troca de material' },
  { value: 'outro',          label: 'Outro' },
]
const EMPTY_LOG = { event_type: 'manutencao', description: '', performed_at: '', next_date: '' }

function LifecycleModal({ asset, onClose }) {
  const [logs,   setLogs]   = useState([])
  const [form,   setForm]   = useState(null)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const loadLogs = useCallback(async () => {
    const { data } = await api.get(`/admin/assets/${asset.id}/lifecycle`)
    setLogs(data)
  }, [asset.id])

  useEffect(() => { loadLogs() }, [loadLogs])

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      await api.post(`/admin/assets/${asset.id}/lifecycle`, form)
      setForm(null)
      await loadLogs()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Falha ao salvar.')
    } finally { setSaving(false) }
  }

  async function handleDelete(logId) {
    if (!confirm('Remover registro?')) return
    await api.delete(`/admin/assets/${asset.id}/lifecycle/${logId}`)
    await loadLogs()
  }

  const eventLabel = v => EVENT_TYPES.find(e => e.value === v)?.label ?? v

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Ciclo de vida — {asset.name}</h2>
            <p className="text-xs text-gray-400">Manutenções, vistorias, reparos e outros eventos físicos</p>
          </div>
          <button onClick={() => setForm({ ...EMPTY_LOG })}
                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700">
            + Novo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {logs.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-400">Nenhum registro de ciclo de vida.</p>
          )}
          {logs.map(log => (
            <div key={log.id}
                 className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-teal-700">{eventLabel(log.event_type)}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-500">{log.performed_at}</span>
                  {log.next_date && (
                    <span className="text-gray-400">→ próx. {log.next_date}</span>
                  )}
                </div>
                <p className="text-gray-700 line-clamp-2">{log.description}</p>
                <p className="mt-0.5 text-gray-400">{log.created_by_name}</p>
              </div>
              <button onClick={() => handleDelete(log.id)} className="text-gray-400 hover:text-red-600 flex-shrink-0">✕</button>
            </div>
          ))}
        </div>

        {form && (
          <div className="border-t border-gray-200 px-6 py-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-600">Novo registro</h3>
            <div className="grid grid-cols-2 gap-3">
              <select className={inputCls} value={form.event_type}
                onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input type="date" className={inputCls} value={form.performed_at}
                onChange={e => setForm(f => ({ ...f, performed_at: e.target.value }))} />
            </div>
            <textarea className={inputCls} rows={2} placeholder="Descrição do evento"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">Próxima data</label>
              <input type="date" className={inputCls} value={form.next_date}
                onChange={e => setForm(f => ({ ...f, next_date: e.target.value }))} />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving}
                      className="flex-1 rounded-lg bg-teal-600 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              <button onClick={() => { setForm(null); setError(null) }}
                      className="flex-1 rounded-lg border border-gray-300 py-1.5 text-sm text-gray-600">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 px-6 py-3 text-right">
          <button onClick={onClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
