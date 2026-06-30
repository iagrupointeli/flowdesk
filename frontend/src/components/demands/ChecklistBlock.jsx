import { useCallback, useEffect, useState } from 'react'
import api from '../../lib/api'

/**
 * ChecklistBlock — bloco de checklist por demanda.
 *
 * Permite listar, adicionar, marcar/desmarcar e remover itens.
 * Toggle de is_completed usa mutação otimista — reverte em caso de erro.
 * Guard no backend (moveStage) bloqueia finalização com pendências.
 */
export default function ChecklistBlock({ demandId, isFrozen = false }) {
  const [items,    setItems]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [adding,   setAdding]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/demands/${demandId}/checklists`)
      setItems(res.data)
    } catch {
      // silent — erro não bloqueia renderização do restante da página
    } finally {
      setLoading(false)
    }
  }, [demandId])

  useEffect(() => { load() }, [load])

  async function handleToggle(item) {
    const next = !item.is_completed
    // Mutação otimista
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_completed: next } : i))
    try {
      const res = await api.patch(`/demands/${demandId}/checklists/${item.id}`, {
        is_completed: next,
      })
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...res.data } : i))
    } catch {
      // Reverte
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_completed: item.is_completed } : i))
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!newTitle.trim()) return
    setAdding(true)
    try {
      const res = await api.post(`/demands/${demandId}/checklists`, { title: newTitle.trim() })
      setItems(prev => [...prev, res.data])
      setNewTitle('')
      setShowAdd(false)
    } catch {
      // silent
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(itemId) {
    setItems(prev => prev.filter(i => i.id !== itemId))
    try {
      await api.delete(`/demands/${demandId}/checklists/${itemId}`)
    } catch {
      load() // recarga em caso de falha
    }
  }

  const total     = items.length
  const completed = items.filter(i => i.is_completed).length
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header com contagem */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Checklist
        </h2>
        {total > 0 && (
          <span className="text-xs font-medium text-gray-500">
            {completed}/{total}
          </span>
        )}
      </div>

      {/* Barra de progresso */}
      {total > 0 && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              pct === 100 ? 'bg-green-500' : 'bg-primary-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Badge somente leitura quando finalizada ou cancelada */}
      {isFrozen && (
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-red-400">
          somente leitura — demanda finalizada ou cancelada
        </p>
      )}

      {/* Itens */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-5 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map(item => (
            <li key={item.id} className="group flex items-center gap-2">
              <input
                type="checkbox"
                id={`chk-${item.id}`}
                checked={item.is_completed}
                onChange={() => !isFrozen && handleToggle(item)}
                disabled={isFrozen}
                className="h-4 w-4 flex-shrink-0 rounded border-gray-300
                           text-primary-600 focus:ring-primary-500
                           disabled:cursor-not-allowed disabled:opacity-60"
              />
              <label
                htmlFor={`chk-${item.id}`}
                className={`flex-1 text-sm leading-snug ${
                  isFrozen ? 'cursor-default' : 'cursor-pointer'
                } ${
                  item.is_completed ? 'text-gray-400 line-through' : 'text-gray-700'
                }`}
              >
                {item.title}
              </label>
              {!isFrozen && (
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  title="Remover item"
                  className="invisible flex-shrink-0 rounded p-0.5 text-gray-300
                             hover:text-red-500 group-hover:visible"
                >
                  <IconX />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Adicionar item — oculto quando cancelada */}
      {!isFrozen && (
        showAdd ? (
          <form onSubmit={handleAdd} className="mt-3 flex gap-1.5">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Novo item…"
              autoFocus
              className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1
                         focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={adding || !newTitle.trim()}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold
                         text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {adding ? '…' : 'OK'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewTitle('') }}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs
                         text-gray-600 hover:bg-gray-50"
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="mt-3 flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600"
          >
            <span className="text-base leading-none">+</span>
            <span>Adicionar item</span>
          </button>
        )
      )}
    </div>
  )
}

function IconX() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}
