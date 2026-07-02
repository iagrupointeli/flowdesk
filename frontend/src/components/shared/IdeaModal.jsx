import { useState } from 'react'
import api from '../../lib/api'

/**
 * Modal "Tive uma ideia" — cria uma Tarefa direto no projeto "Ideias -
 * Geral" da área "Inovação" (resolvido pelo backend, não pelo cliente).
 * Aberto pelo botão de lâmpada no Header, ao lado do toggle da sidebar.
 */
export default function IdeaModal({ onClose }) {
  const [title,     setTitle]     = useState('')
  const [notes,     setNotes]     = useState('')
  const [isSaving,  setIsSaving]  = useState(false)
  const [error,     setError]     = useState(null)
  const [success,   setSuccess]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('Descreva sua ideia em uma frase.'); return }

    setIsSaving(true)
    setError(null)
    try {
      await api.post('/ideas', { title: title.trim(), notes: notes.trim() || undefined })
      setSuccess(true)
      setTimeout(onClose, 1400)
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao enviar ideia.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {success
          ? (
            <div className="flex flex-col items-center py-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                <IconLightbulbCheck />
              </span>
              <p className="mt-3 text-sm font-medium text-gray-800">Ideia registrada!</p>
              <p className="mt-1 text-xs text-gray-400">Foi pro quadro Ideias - Geral, na área Inovação.</p>
            </div>
          )
          : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-500">
                  <IconLightbulbOutline />
                </span>
                <h2 className="text-base font-semibold text-gray-900">Tive uma ideia</h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {error && (
                  <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <input
                  type="text"
                  autoFocus
                  placeholder="Sua ideia em uma frase *"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={200}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />

                <textarea
                  placeholder="Quer detalhar? (opcional)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />

                <p className="text-xs text-gray-400">
                  Vira uma tarefa no quadro <span className="font-medium text-gray-500">Ideias - Geral</span>, na área Inovação.
                </p>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                               text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || !title.trim()}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white
                               hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? 'Enviando…' : 'Enviar ideia'}
                  </button>
                </div>
              </form>
            </>
          )
        }
      </div>
    </div>
  )
}

function IconLightbulbOutline() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 2a6 6 0 00-3.815 10.631C7.237 13.516 7.5 14.386 7.5 15v.5A1.5 1.5 0 009 17h2a1.5 1.5 0 001.5-1.5V15c0-.614.263-1.484 1.315-2.369A6 6 0 0010 2zM8.5 18.5A.5.5 0 019 18h2a.5.5 0 01.5.5v.25a.75.75 0 01-.75.75h-2a.75.75 0 01-.75-.75v-.25z" clipRule="evenodd" />
    </svg>
  )
}

function IconLightbulbCheck() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
    </svg>
  )
}
