import { useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

/**
 * TagsBlock — bloco de tags no painel lateral da demanda.
 *
 * ── Mutação otimista ─────────────────────────────────────────────────────────
 *   Adicionar: insere a tag localmente → POST /demands/:id/tags → reverte em erro.
 *   Remover:   remove localmente → DELETE /demands/:id/tags/:tagId → reverte em erro.
 *
 * ── AbortController ──────────────────────────────────────────────────────────
 *   Fetch de tags disponíveis aborta no cleanup do useEffect.
 *
 * ── Dropdown ─────────────────────────────────────────────────────────────────
 *   Abre ao clicar em "Adicionar"; fecha ao clicar fora (pointerdown no document).
 *   Filtra tags já vinculadas à demanda para mostrar apenas as disponíveis.
 */
export default function TagsBlock({ demandId, departmentId, initialTags = [], isFrozen = false }) {
  const [tags,         setTags]         = useState(initialTags)
  const [availableTags, setAvailableTags] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [isLoadingAvail, setIsLoadingAvail] = useState(false)
  const dropdownRef = useRef(null)

  // Sincroniza com o pai quando a demanda recarrega (ex: após fetchDemand)
  useEffect(() => { setTags(initialTags) }, [initialTags])

  // Carrega tags disponíveis do departamento quando o dropdown abre
  useEffect(() => {
    if (!showDropdown || !departmentId) return
    const ctrl = new AbortController()
    setIsLoadingAvail(true)
    api.get('/tags', { params: { department_id: departmentId }, signal: ctrl.signal })
      .then(res => setAvailableTags(Array.isArray(res.data) ? res.data : []))
      .catch(err => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
      })
      .finally(() => setIsLoadingAvail(false))
    return () => ctrl.abort()
  }, [showDropdown, departmentId])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!showDropdown) return
    function onPointerDown(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showDropdown])

  async function handleAdd(tag) {
    if (tags.some(t => t.id === tag.id)) return
    // Otimista
    setTags(prev => [...prev, tag])
    setShowDropdown(false)
    try {
      await api.post(`/demands/${demandId}/tags`, { tag_id: tag.id })
    } catch {
      setTags(prev => prev.filter(t => t.id !== tag.id))
    }
  }

  async function handleRemove(tagId) {
    const removed = tags.find(t => t.id === tagId)
    // Otimista
    setTags(prev => prev.filter(t => t.id !== tagId))
    try {
      await api.delete(`/demands/${demandId}/tags/${tagId}`)
    } catch {
      if (removed) setTags(prev => [...prev, removed])
    }
  }

  const unlinkedTags = availableTags.filter(t => !tags.some(lt => lt.id === t.id))

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</h2>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${tag.color_hex}22`,
              color: tag.color_hex,
              border: `1px solid ${tag.color_hex}44`,
            }}
          >
            {tag.name}
            {!isFrozen && (
              <button
                onClick={() => handleRemove(tag.id)}
                aria-label={`Remover tag ${tag.name}`}
                className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full
                           opacity-60 transition-opacity hover:opacity-100"
              >
                <IconX className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}

        {/* Botão Adicionar + dropdown */}
        {!isFrozen && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowDropdown(v => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed
                         border-gray-300 px-2 py-0.5 text-xs text-gray-400
                         transition-colors hover:border-gray-400 hover:text-gray-600"
            >
              <IconPlus className="h-3 w-3" />
              Adicionar
            </button>

            {showDropdown && (
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg
                              border border-gray-200 bg-white shadow-lg">
                {isLoadingAvail ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Carregando…</p>
                ) : unlinkedTags.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    {availableTags.length === 0
                      ? 'Nenhuma tag cadastrada para este departamento.'
                      : 'Todas as tags já foram adicionadas.'}
                  </p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto py-1">
                    {unlinkedTags.map(tag => (
                      <li key={tag.id}>
                        <button
                          onClick={() => handleAdd(tag)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left
                                     text-xs text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color_hex }}
                          />
                          {tag.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {tags.length === 0 && isFrozen && (
          <p className="text-xs text-gray-400">Nenhuma tag.</p>
        )}
      </div>
    </div>
  )
}

function IconX({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}

function IconPlus({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
    </svg>
  )
}
