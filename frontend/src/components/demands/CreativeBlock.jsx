import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

export default function CreativeBlock({ demandId, isFrozen }) {
  const [creatives, setCreatives] = useState([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  const load = useCallback(async () => {
    const { data } = await api.get(`/demands/${demandId}/attachments`, {
      params: { kind: 'creative' },
    })
    setCreatives([...data].sort((a, b) => b.version - a.version))
  }, [demandId])

  useEffect(() => { load() }, [load])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`/demands/${demandId}/attachments?kind=creative`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await load()
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">🎨 Peças Criativas</h3>
        {!isFrozen && (
          <label className="cursor-pointer text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 text-gray-700">
            {uploading ? 'Enviando…' : '+ Upload'}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.ai,.psd,.eps"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      {creatives.length === 0 && (
        <p className="text-xs text-gray-400">Nenhuma peça criativa anexada.</p>
      )}

      <div className="space-y-2">
        {creatives.map((c, i) => (
          <div
            key={c.id}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${
              i === 0
                ? 'bg-blue-50 border border-blue-200'
                : 'bg-gray-50 border border-gray-100 opacity-60'
            }`}
          >
            <span className={`font-mono font-bold ${i === 0 ? 'text-blue-700' : 'text-gray-400'}`}>
              v{c.version}
            </span>
            {i === 0 && (
              <span className="rounded-full bg-blue-600 text-white px-1.5 py-0.5 text-[10px] font-semibold">
                atual
              </span>
            )}
            <span className="flex-1 truncate text-gray-700">{c.file_name}</span>
            <span className="text-gray-400 whitespace-nowrap">
              {new Date(c.entered_at).toLocaleDateString('pt-BR')}
            </span>
            <a
              href={`/api/demands/${demandId}/attachments/${c.id}/download`}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-blue-600"
              title="Download"
            >
              ↓
            </a>
          </div>
        ))}
      </div>

      {creatives.length > 1 && (
        <p className="mt-2 text-[10px] text-gray-400">
          {creatives.length - 1} versão{creatives.length > 2 ? 'ões' : ''} anterior{creatives.length > 2 ? 'es' : ''} arquivada{creatives.length > 2 ? 's' : ''}.
        </p>
      )}
    </section>
  )
}
