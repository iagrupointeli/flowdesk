import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Portal do Prestador Externo — /external/:token (PÚBLICO, sem login)
 *
 * Página mínima e mobile-first para o instalador em campo:
 *   1. Vê o serviço (título, descrição, endereço do ponto)
 *   2. Sobe fotos da instalação direto do celular
 *   3. Marca "Serviço concluído" com observação opcional
 *
 * IMPORTANTE: usa fetch puro — NÃO usa o client axios da aplicação,
 * que tem interceptors de autenticação/refresh e redirecionaria para /login.
 */

const API = '/api/external'

export default function ExternalPortal() {
  const { token } = useParams()

  const [data,      setData]      = useState(null)
  const [error,     setError]     = useState(null)
  const [files,     setFiles]     = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploaded,  setUploaded]  = useState(0)
  const [notes,     setNotes]     = useState('')
  const [completing, setCompleting] = useState(false)
  const [completed,  setCompleted]  = useState(false)
  const [photos,     setPhotos]     = useState([])

  const inputRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/${token}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Link inválido ou expirado.')
      }
      setData(await res.json())
    } catch (err) {
      setError(err.message)
    }
  }, [token])

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`${API}/${token}/photos`)
      if (res.ok) setPhotos(await res.json())
    } catch { /* galeria opcional — falha silenciosa */ }
  }, [token])

  useEffect(() => { load(); loadPhotos() }, [load, loadPhotos])

  async function handleUpload() {
    if (!files.length || uploading) return
    setUploading(true)
    let ok = 0
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await fetch(`${API}/${token}/photos`, { method: 'POST', body: fd })
        if (res.ok) ok++
      } catch { /* segue para o próximo */ }
    }
    setUploaded(u => u + ok)
    setFiles([])
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
    load()       // atualiza contador de fotos
    loadPhotos() // atualiza galeria
  }

  async function handleComplete() {
    if (completing) return
    setCompleting(true)
    try {
      const res = await fetch(`${API}/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      if (!res.ok) throw new Error()
      setCompleted(true)
    } catch {
      setError('Falha ao registrar conclusão. Tente novamente.')
    } finally {
      setCompleting(false)
    }
  }

  // ── Estados de página ────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow">
          <p className="text-4xl">🔒</p>
          <h1 className="mt-3 text-lg font-semibold text-gray-900">Link inválido ou expirado</h1>
          <p className="mt-1 text-sm text-gray-500">
            Solicite um novo link à empresa que contratou o serviço.
          </p>
        </div>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell>
        <div className="space-y-3">
          <div className="h-32 animate-pulse rounded-2xl bg-white/60" />
          <div className="h-48 animate-pulse rounded-2xl bg-white/60" />
        </div>
      </Shell>
    )
  }

  if (completed) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white p-8 text-center shadow">
          <p className="text-4xl">✅</p>
          <h1 className="mt-3 text-lg font-semibold text-gray-900">Serviço registrado!</h1>
          <p className="mt-1 text-sm text-gray-500">
            A equipe foi notificada. Você já pode fechar esta página.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      {/* Cabeçalho do serviço */}
      <div className="rounded-2xl bg-white p-5 shadow">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary-600">
          Ordem de serviço
        </p>
        <h1 className="mt-1 text-lg font-bold text-gray-900">{data.title}</h1>
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{data.description}</p>

        {data.asset_name && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-500">📍 Local</p>
            <p className="mt-0.5 text-sm font-medium text-gray-900">
              {data.asset_code && <span className="font-mono text-xs">[{data.asset_code}] </span>}
              {data.asset_name}
            </p>
            {(data.asset_address || data.asset_city) && (
              <p className="text-sm text-gray-600">
                {[data.asset_address, data.asset_city].filter(Boolean).join(' — ')}
              </p>
            )}
          </div>
        )}

        <p className="mt-3 text-xs text-gray-400">
          Etapa atual: {data.stage_name ?? '—'} · {data.photo_count} foto(s) enviada(s)
        </p>
      </div>

      {/* Upload de fotos */}
      <div className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-sm font-semibold text-gray-900">📷 Fotos da instalação</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tire fotos da peça instalada e envie aqui — elas vão direto para o sistema.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={e => setFiles(Array.from(e.target.files ?? []))}
          className="mt-3 block w-full text-xs text-gray-500
                     file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50
                     file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-700"
        />

        {files.length > 0 && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-bold text-white
                       active:bg-primary-800 disabled:opacity-50"
          >
            {uploading ? 'Enviando…' : `Enviar ${files.length} foto${files.length > 1 ? 's' : ''}`}
          </button>
        )}

        {uploaded > 0 && (
          <p className="mt-2 text-center text-xs font-medium text-green-600">
            ✓ {uploaded} foto(s) enviada(s) com sucesso
          </p>
        )}
      </div>

      {/* Galeria de evidências já enviadas */}
      {photos.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow">
          <h2 className="text-sm font-semibold text-gray-900">
            📸 Evidências registradas ({photos.length})
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {photos.map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt={p.file_name}
                  className="h-32 w-full rounded-xl object-cover border border-gray-100"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Conclusão */}
      <div className="rounded-2xl bg-white p-5 shadow">
        <h2 className="text-sm font-semibold text-gray-900">✅ Finalizar serviço</h2>
        <textarea
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Observações (opcional)"
          className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm
                     focus:border-primary-500 focus:outline-none"
        />
        <button
          onClick={handleComplete}
          disabled={completing}
          className="mt-2 w-full rounded-xl bg-green-600 py-3 text-sm font-bold text-white
                     active:bg-green-800 disabled:opacity-50"
        >
          {completing ? 'Registrando…' : 'Marcar serviço como concluído'}
        </button>
        {error && <p className="mt-2 text-center text-xs text-red-600">{error}</p>}
      </div>

      <p className="pb-4 text-center text-[10px] text-gray-400">
        InteliONE · acesso restrito a esta ordem de serviço
      </p>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">{children}</div>
    </div>
  )
}
