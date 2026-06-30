import { useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

/**
 * Modal de criação de conversa (DM ou grupo).
 * Props:
 *   onClose()                  — fecha o modal
 *   onCreated(channel)         — callback com o canal criado
 */
export default function NewChatModal({ onClose, onCreated }) {
  const [type,       setType]       = useState('dm')   // 'dm' | 'group'
  const [groupName,  setGroupName]  = useState('')
  const [users,      setUsers]      = useState([])     // lista disponível
  const [selected,   setSelected]   = useState([])     // ids selecionados
  const [query,      setQuery]      = useState('')
  const [isSaving,   setIsSaving]   = useState(false)
  const [error,      setError]      = useState(null)
  const abortRef = useRef(null)

  // Carrega colegas de departamento
  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    api.get('/chat/users', { signal: ctrl.signal })
      .then(r => setUsers(Array.isArray(r.data) ? r.data : []))
      .catch(err => { if (err?.code !== 'ERR_CANCELED') setError('Erro ao carregar usuários.') })
    return () => ctrl.abort()
  }, [])

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(query.toLowerCase()) ||
    u.email.toLowerCase().includes(query.toLowerCase())
  )

  function toggleUser(id) {
    if (type === 'dm') {
      setSelected([id])
      return
    }
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selected.length === 0) { setError('Selecione ao menos um usuário.'); return }
    if (type === 'group' && !groupName.trim()) { setError('Nome do grupo é obrigatório.'); return }

    setIsSaving(true)
    setError(null)
    try {
      const { data } = await api.post('/chat', {
        type,
        name:    type === 'group' ? groupName.trim() : null,
        members: selected.map(id => ({ userId: id, role: 'member' })),
      })
      onCreated(data)
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao criar conversa.')
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
        <h2 className="mb-4 text-base font-semibold text-gray-900">Nova conversa</h2>

        {/* Tipo */}
        <div className="mb-4 flex gap-2">
          {['dm', 'group'].map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); setSelected([]) }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors
                ${type === t
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              {t === 'dm' ? 'Mensagem direta' : 'Grupo'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {type === 'group' && (
            <input
              type="text"
              placeholder="Nome do grupo *"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          )}

          {/* Busca de usuários */}
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />

          {/* Lista */}
          <ul className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-sm text-gray-400">
                {users.length === 0 ? 'Carregando…' : 'Nenhum usuário encontrado.'}
              </li>
            )}
            {filtered.map(u => {
              const isSelected = selected.includes(u.id)
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => toggleUser(u.id)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left
                      transition-colors hover:bg-gray-50
                      ${isSelected ? 'bg-primary-50' : ''}`}
                  >
                    {/* Avatar */}
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center
                                     rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                      {u.name[0].toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">{u.name}</p>
                      <p className="truncate text-xs text-gray-400">{u.email}</p>
                    </div>
                    {isSelected && (
                      <span className="flex-shrink-0 text-primary-600">
                        <IconCheck />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

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
              disabled={isSaving || selected.length === 0}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                         hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Criando…' : 'Iniciar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function IconCheck() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
    </svg>
  )
}
