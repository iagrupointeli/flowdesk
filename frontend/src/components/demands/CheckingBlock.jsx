import { useCallback, useEffect, useRef, useState } from 'react'
import FileDropzone     from './FileDropzone'
import FilePreviewModal from '../shared/FilePreviewModal'
import api from '../../lib/api'

/**
 * CheckingBlock — evidências fotográficas de veiculação/instalação.
 *
 * Diferente do AttachmentBlock (anexos genéricos), este bloco:
 *   - sobe arquivos com ?kind=checking
 *   - exibe galeria de miniaturas (presigned URLs em paralelo)
 *   - oferece o botão "Relatório PDF" que baixa o checking pronto
 *     para enviar ao anunciante (GET /demands/:id/checking-report)
 *
 * Props:
 *   demandId — UUID da demanda
 *   isFrozen — bloqueia upload quando true
 */
export default function CheckingBlock({ demandId, isFrozen = false }) {
  const [evidences,  setEvidences]  = useState([])     // attachments kind='checking'
  const [thumbs,     setThumbs]     = useState({})      // { [attachmentId]: presignedUrl }
  const [loading,    setLoading]    = useState(true)
  const [files,      setFiles]      = useState([])
  const [uploading,  setUploading]  = useState(false)
  const [error,      setError]      = useState(null)
  const [preview,    setPreview]    = useState(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingZip, setIsExportingZip] = useState(false)

  const abortRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await api.get(`/demands/${demandId}/attachments`, { signal: ctrl.signal })
      const checking = res.data.filter(a => a.kind === 'checking')
      setEvidences(checking)

      // Miniaturas: presigned URLs em paralelo (galeria pequena, aceitável)
      const pairs = await Promise.all(
        checking.map(async a => {
          try {
            const r = await api.get(`/demands/attachments/${a.id}/download`, { signal: ctrl.signal })
            return [a.id, r.data.url]
          } catch { return [a.id, null] }
        })
      )
      setThumbs(Object.fromEntries(pairs))
    } catch (err) {
      if (err.name !== 'CanceledError' && err.name !== 'AbortError') { /* silent */ }
    } finally {
      setLoading(false)
    }
  }, [demandId])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  async function handleUpload() {
    if (files.length === 0 || uploading) return
    setUploading(true)
    setError(null)
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/demands/${demandId}/attachments?kind=checking`, form)
      }
      setFiles([])
      load()
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro no upload. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  async function handlePdf() {
    if (isExportingPdf) return
    setIsExportingPdf(true)
    setError(null)
    try {
      const { data } = await api.get(`/demands/${demandId}/checking-report`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `checking-${demandId.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Falha ao gerar o relatório PDF.')
    } finally {
      setIsExportingPdf(false)
    }
  }

  async function handleZip() {
    if (isExportingZip) return
    setIsExportingZip(true)
    setError(null)
    try {
      const { data } = await api.get(`/demands/${demandId}/checking-zip`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `pop-${demandId.slice(0, 8)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Falha ao exportar o ZIP de provas.')
    } finally {
      setIsExportingZip(false)
    }
  }

  function isImage(fileName) {
    const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)
  }

  return (
    <>
      {preview && (
        <FilePreviewModal
          url={preview.url}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
          onDownload={() => {
            const a = document.createElement('a')
            a.href = preview.url
            a.download = preview.fileName
            a.click()
          }}
        />
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Checking fotográfico
          </h2>
          {evidences.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleZip}
                disabled={isExportingZip}
                className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1
                           text-xs text-gray-700 hover:bg-gray-50
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExportingZip ? 'Exportando…' : '↓ Exportar provas (.zip)'}
              </button>
              <button
                onClick={handlePdf}
                disabled={isExportingPdf}
                className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white
                           hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExportingPdf ? 'Gerando…' : '📄 Relatório PDF'}
              </button>
            </div>
          )}
        </div>

        {/* Galeria */}
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map(i => <div key={i} className="aspect-square animate-pulse rounded-lg bg-gray-100" />)}
          </div>
        ) : evidences.length === 0 ? (
          <p className="mb-3 text-xs text-gray-400">
            Nenhuma evidência anexada. Suba fotos da peça instalada para gerar o relatório.
          </p>
        ) : (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {evidences.map(ev => (
              <button
                key={ev.id}
                onClick={() => thumbs[ev.id] && setPreview({ url: thumbs[ev.id], fileName: ev.file_name })}
                className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200
                           bg-gray-50 hover:border-primary-400"
                title={`${ev.file_name} · ${ev.uploaded_by_name}`}
              >
                {thumbs[ev.id] && isImage(ev.file_name) ? (
                  <img
                    src={thumbs[ev.id]}
                    alt={ev.file_name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-2xl">📎</span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5 text-[9px] text-white">
                  {new Date(ev.entered_at).toLocaleDateString('pt-BR')}
                </span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

        {/* Upload */}
        {!isFrozen && (
          <div className="space-y-2">
            <FileDropzone files={files} onChange={setFiles} />
            {files.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white
                             hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? 'Enviando…' : `Enviar ${files.length} evidência${files.length > 1 ? 's' : ''}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
