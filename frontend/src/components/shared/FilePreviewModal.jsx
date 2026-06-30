import { useEffect } from 'react'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'])
const PDF_EXTS   = new Set(['pdf'])

function getPreviewType(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (PDF_EXTS.has(ext))   return 'pdf'
  return 'other'
}

/**
 * Modal de visualização inline de arquivos.
 *
 * Props:
 *   url        — URL presignada do MinIO
 *   fileName   — nome do arquivo (usado para detectar tipo e exibir)
 *   onClose()  — callback de fechamento
 *   onDownload — callback opcional para botão de download
 */
export default function FilePreviewModal({ url, fileName, onClose, onDownload }) {
  const type = getPreviewType(fileName)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizando ${fileName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex max-h-[92vh] max-w-[92vw] flex-col rounded-xl overflow-hidden shadow-2xl">
        {/* Barra superior */}
        <div className="flex items-center justify-between gap-4 bg-gray-900 px-4 py-2.5">
          <span className="max-w-[60vw] truncate text-sm text-white/80">{fileName}</span>
          <div className="flex items-center gap-1">
            {onDownload && (
              <button
                onClick={onDownload}
                title="Baixar arquivo"
                className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <IconDownload />
              </button>
            )}
            <button
              onClick={onClose}
              title="Fechar (Esc)"
              className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconX />
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        {type === 'image' && (
          <img
            src={url}
            alt={fileName}
            className="max-h-[85vh] max-w-[88vw] object-contain bg-gray-950"
          />
        )}

        {type === 'pdf' && (
          <iframe
            src={url}
            title={fileName}
            className="h-[85vh] w-[80vw] bg-white"
          />
        )}

        {type === 'other' && (
          <div className="flex flex-col items-center justify-center gap-3 bg-gray-900 px-16 py-12 text-center">
            <IconFileGeneric className="h-14 w-14 text-gray-500" />
            <p className="text-sm font-medium text-gray-200">{fileName}</p>
            <p className="text-xs text-gray-500">
              Pré-visualização não disponível para este formato.
            </p>
            {onDownload && (
              <button
                onClick={onDownload}
                className="mt-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold
                           text-white transition-colors hover:bg-primary-700"
              >
                Baixar arquivo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
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

function IconX() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}

function IconFileGeneric({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  )
}
