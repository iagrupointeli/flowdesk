import { useCallback, useEffect, useRef, useState } from 'react'
import FileDropzone      from './FileDropzone'
import FilePreviewModal  from '../shared/FilePreviewModal'
import api from '../../lib/api'

/**
 * AttachmentBlock — lista e upload de anexos por demanda.
 *
 * Usa FileDropzone para enfileirar arquivos localmente (sem auto-upload).
 * O envio ocorre ao clicar "Enviar" — um arquivo por request ao endpoint existente.
 * Download via presigned URL do MinIO (GET /demands/attachments/:id/download).
 *
 * Props:
 *   demandId    — UUID da demanda
 *   isFrozen — bloqueia upload quando true
 */
export default function AttachmentBlock({ demandId, isFrozen = false }) {
  const [attachments, setAttachments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [files,       setFiles]       = useState([])
  const [uploading,   setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [preview,     setPreview]     = useState(null) // { url, fileName }

  const abortRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await api.get(`/demands/${demandId}/attachments`, { signal: ctrl.signal })
      // Evidências de checking têm bloco próprio (CheckingBlock) — aqui só genéricos
      setAttachments(res.data.filter(a => a.kind !== 'checking'))
    } catch (err) {
      if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
        // silent — não bloqueia renderização da página
      }
    } finally {
      setLoading(false)
    }
  }, [demandId])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  // Recarrega quando CommentBox colar uma imagem via Ctrl+V
  useEffect(() => {
    function onPasted(e) {
      if (e.detail?.demandId === demandId) load()
    }
    window.addEventListener('attachment:uploaded', onPasted)
    return () => window.removeEventListener('attachment:uploaded', onPasted)
  }, [demandId, load])

  async function handleUpload() {
    if (files.length === 0 || uploading) return
    setUploading(true)
    setUploadError(null)
    try {
      const uploaded = []
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        const res = await api.post(`/demands/${demandId}/attachments`, form)
        uploaded.push(res.data)
      }
      // Prepend novos anexos (mais recentes primeiro)
      setAttachments(prev => [...uploaded.reverse(), ...prev])
      setFiles([])
    } catch (err) {
      setUploadError(err?.response?.data?.error ?? 'Erro no upload. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  async function handlePreview(attachment) {
    try {
      const res = await api.get(`/demands/attachments/${attachment.id}/download`)
      setPreview({ url: res.data.url, fileName: attachment.file_name, attachmentId: attachment.id })
    } catch { /* silent */ }
  }

  async function handleDownload(attachment) {
    try {
      const res = await api.get(`/demands/attachments/${attachment.id}/download`)
      const a = document.createElement('a')
      a.href = res.data.url
      a.download = attachment.file_name
      a.click()
    } catch { /* silent */ }
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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Anexos
      </h2>

      {/* Lista de anexos existentes */}
      {loading ? (
        <div className="mb-3 space-y-2">
          {[1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}
        </div>
      ) : attachments.length === 0 ? (
        <p className="mb-3 text-xs text-gray-400">Nenhum arquivo anexado ainda.</p>
      ) : (
        <ul className="mb-3 space-y-1">
          {attachments.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-gray-50">
              <AttachFileIcon fileName={a.file_name} />
              <button
                onClick={() => handlePreview(a)}
                className="min-w-0 flex-1 text-left"
                title="Visualizar arquivo"
              >
                <p className="truncate text-sm font-medium text-gray-700 hover:text-primary-600">
                  {a.file_name}
                </p>
                <p className="text-[10px] text-gray-400">
                  {formatBytes(a.file_size)} · {a.uploaded_by_name} · {formatDate(a.entered_at)}
                </p>
              </button>
              <button
                onClick={() => handleDownload(a)}
                title="Baixar arquivo"
                className="flex-shrink-0 rounded p-1 text-gray-400
                           hover:text-primary-600 hover:bg-primary-50"
              >
                <IconDownload />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Upload — oculto quando cancelada */}
      {!isFrozen && (
        <div className="space-y-2">
          <FileDropzone files={files} onChange={setFiles} />
          {files.length > 0 && (
            <>
              {uploadError && (
                <p className="text-xs text-red-500">{uploadError}</p>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold
                             text-white hover:bg-primary-700 disabled:opacity-50
                             disabled:cursor-not-allowed"
                >
                  {uploading
                    ? 'Enviando…'
                    : `Enviar ${files.length} arquivo${files.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function AttachFileIcon({ fileName }) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''
  const colorMap = {
    pdf:  'text-red-500',
    doc:  'text-blue-600', docx: 'text-blue-600',
    xls:  'text-green-600', xlsx: 'text-green-600',
    png:  'text-purple-500', jpg: 'text-purple-500', jpeg: 'text-purple-500',
    gif:  'text-purple-500', webp: 'text-purple-500',
    zip:  'text-yellow-600',
  }
  const color = colorMap[ext] ?? 'text-gray-400'

  return (
    <svg className={`h-4 w-4 flex-shrink-0 ${color}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd"
        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function IconDownload() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  )
}
