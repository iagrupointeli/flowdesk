import { useRef, useState } from 'react'

// Tipos permitidos pelo backend (baseados em ALLOWED_MIME_TYPES de demands.service.js)
const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  'pdf',
  'doc', 'docx',
  'xls', 'xlsx',
  'txt', 'csv',
  'zip',
])

const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB (mesmo limite do backend)

/**
 * Dropzone controlado de arquivos — ZERO upload automático.
 * Os arquivos ficam em fila local (prop `files`) até o submit do formulário,
 * onde são enviados um a um para POST /api/demands/:id/attachments.
 *
 * Props:
 *   files:    File[]                — lista atual de arquivos na fila
 *   onChange: (files: File[]) => void — callback para atualizar o estado no pai
 *
 * Validações client-side:
 *   - Extensão deve estar em ALLOWED_EXTENSIONS
 *   - Tamanho máximo: 20 MB
 *   - Duplicatas (mesmo nome + tamanho) são ignoradas silenciosamente
 */
export default function FileDropzone({ files = [], onChange }) {
  const inputRef  = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [validationErrors, setValidationErrors] = useState([])

  // ── Validação + deduplicação ───────────────────────────────────────────────
  function addFiles(newFiles) {
    const errors = []
    const accepted = []

    for (const file of newFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

      if (!ALLOWED_EXTENSIONS.has(ext)) {
        errors.push(`"${file.name}": tipo não permitido (.${ext}).`)
        continue
      }
      if (file.size > MAX_SIZE_BYTES) {
        errors.push(`"${file.name}": excede 20 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`)
        continue
      }

      // Deduplicação por nome + tamanho
      const alreadyExists = files.some(f => f.name === file.name && f.size === file.size)
      if (alreadyExists) continue

      accepted.push(file)
    }

    setValidationErrors(errors)
    if (accepted.length > 0) {
      onChange([...files, ...accepted])
    }
  }

  function removeFile(index) {
    const next = files.filter((_, i) => i !== index)
    onChange(next)
    setValidationErrors([])
  }

  // ── Drag events ───────────────────────────────────────────────────────────
  function onDragOver(e) {
    e.preventDefault()
    setIsDragging(true)
  }

  function onDragLeave(e) {
    // Só desativa se o mouse saiu para fora do elemento (não para um filho)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  function onInputChange(e) {
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = '' // permite re-selecionar o mesmo arquivo
  }

  return (
    <div>
      {/* Área de drop */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Área para upload de arquivos. Clique ou arraste arquivos para adicionar."
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className={[
          'flex cursor-pointer flex-col items-center justify-center gap-2',
          'rounded-xl border-2 border-dashed px-6 py-8',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500',
          isDragging
            ? 'border-primary-400 bg-primary-50 text-primary-700'
            : 'border-gray-300 bg-gray-50 text-gray-500 hover:border-gray-400 hover:bg-gray-100',
        ].join(' ')}
      >
        <svg
          className="h-8 w-8 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.632-8.664 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
        </svg>
        <p className="text-sm font-medium">
          Arraste arquivos aqui ou <span className="text-primary-600 underline">clique para selecionar</span>
        </p>
        <p className="text-xs opacity-70">
          PDF, DOCX, XLSX, imagens, TXT, CSV, ZIP — máx. 20 MB por arquivo
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={[...ALLOWED_EXTENSIONS].map(e => `.${e}`).join(',')}
        onChange={onInputChange}
        aria-hidden="true"
      />

      {/* Erros de validação client-side */}
      {validationErrors.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {validationErrors.map((msg, i) => (
            <li key={i} className="text-xs text-red-600">
              ⚠ {msg}
            </li>
          ))}
        </ul>
      )}

      {/* Fila de arquivos */}
      {files.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Arquivos selecionados">
          {files.map((file, idx) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200
                         bg-white px-3 py-2 text-sm"
            >
              <FileIcon name={file.name} />
              <span className="min-w-0 flex-1 truncate text-gray-700">{file.name}</span>
              <span className="flex-shrink-0 text-xs text-gray-400">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                aria-label={`Remover ${file.name}`}
                className="flex-shrink-0 rounded p-0.5 text-gray-400 transition-colors
                           hover:bg-red-50 hover:text-red-500"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function FileIcon({ name }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const colorMap = {
    pdf: 'text-red-500',
    doc: 'text-blue-600', docx: 'text-blue-600',
    xls: 'text-green-600', xlsx: 'text-green-600',
    png: 'text-purple-500', jpg: 'text-purple-500', jpeg: 'text-purple-500',
    gif: 'text-purple-500', webp: 'text-purple-500',
    zip: 'text-yellow-600',
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
