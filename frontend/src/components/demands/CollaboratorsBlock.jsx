import { useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

/**
 * CollaboratorsBlock — colaboradores (seguidores) no painel lateral da demanda.
 *
 * Opção B: a demanda continua pertencendo a UM departamento, mas usuários de
 * QUALQUER departamento podem ser adicionados como colaboradores. Eles recebem
 * notificações (mudança de etapa, comentários, bloqueio) e podem comentar, sem
 * assumir a propriedade do fluxo.
 *
 * ── Busca cross-department ────────────────────────────────────────────────────
 *   GET /demands/:id/collaborator-candidates?q=  (escopo = acesso à demanda)
 *   Endpoint dedicado porque /users é restrito a admins e limitado ao próprio
 *   departamento — o oposto do propósito cross-department dos colaboradores.
 *
 * ── Mutação otimista ─────────────────────────────────────────────────────────
 *   Adicionar: insere o chip localmente → POST → reverte em erro.
 *   Remover:   remove localmente → DELETE → reverte em erro.
 */
export default function CollaboratorsBlock({ demandId, isFrozen = false }) {
  const [collaborators, setCollaborators] = useState([])
  const [isLoading,     setIsLoading]     = useState(true)
  const [showSearch,    setShowSearch]    = useState(false)

  // Busca de candidatos
  const [query,       setQuery]       = useState('')
  const [candidates,  setCandidates]  = useState([])
  const [isSearching, setIsSearching] = useState(false)

  const wrapRef   = useRef(null)
  const searchAbort = useRef(null)

  // ── Carrega colaboradores atuais ─────────────────────────────────────────────
  useEffect(() => {
    if (!demandId) return
    const ctrl = new AbortController()
    setIsLoading(true)
    api.get(`/demands/${demandId}/collaborators`, { signal: ctrl.signal })
      .then(res => setCollaborators(Array.isArray(res.data) ? res.data : []))
      .catch(err => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
      })
      .finally(() => setIsLoading(false))
    return () => ctrl.abort()
  }, [demandId])

  // ── Busca de candidatos (debounce 300ms) ─────────────────────────────────────
  useEffect(() => {
    if (!showSearch) return
    if (query.trim().length < 2) {
      setCandidates([])
      return
    }
    const timer = setTimeout(async () => {
      if (searchAbort.current) searchAbort.current.abort()
      const ctrl = new AbortController()
      searchAbort.current = ctrl
      setIsSearching(true)
      try {
        const { data } = await api.get(`/demands/${demandId}/collaborator-candidates`, {
          params: { q: query.trim() },
          signal: ctrl.signal,
        })
        setCandidates(Array.isArray(data) ? data : [])
      } catch (err) {
        if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') setCandidates([])
      } finally {
        setIsSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      if (searchAbort.current) searchAbort.current.abort()
    }
  }, [query, showSearch, demandId])

  // ── Fecha a busca ao clicar fora ─────────────────────────────────────────────
  useEffect(() => {
    if (!showSearch) return
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) closeSearch()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showSearch])

  function closeSearch() {
    setShowSearch(false)
    setQuery('')
    setCandidates([])
  }

  async function handleAdd(user) {
    if (collaborators.some(c => c.id === user.id)) return
    // Otimista
    setCollaborators(prev => [...prev, user].sort((a, b) => a.name.localeCompare(b.name)))
    closeSearch()
    try {
      await api.post(`/demands/${demandId}/collaborators`, { user_id: user.id })
    } catch {
      setCollaborators(prev => prev.filter(c => c.id !== user.id))
    }
  }

  async function handleRemove(userId) {
    const removed = collaborators.find(c => c.id === userId)
    setCollaborators(prev => prev.filter(c => c.id !== userId))
    try {
      await api.delete(`/demands/${demandId}/collaborators/${userId}`)
    } catch {
      if (removed) {
        setCollaborators(prev => [...prev, removed].sort((a, b) => a.name.localeCompare(b.name)))
      }
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Colaboradores
      </h2>

      {isLoading ? (
        <p className="text-xs text-gray-400">Carregando…</p>
      ) : (
        <div className="space-y-2">
          {/* Lista de colaboradores */}
          {collaborators.map(c => (
            <div key={c.id} className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full
                           bg-primary-100 text-xs font-semibold text-primary-700"
                aria-hidden="true"
              >
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-700">{c.name}</p>
                {c.department_name && (
                  <p className="truncate text-xs text-gray-400">{c.department_name}</p>
                )}
              </div>
              {!isFrozen && (
                <button
                  onClick={() => handleRemove(c.id)}
                  aria-label={`Remover ${c.name}`}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full
                             text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  <IconX className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          {collaborators.length === 0 && (
            <p className="text-xs text-gray-400">
              Nenhum colaborador. Adicione pessoas de outros setores para acompanharem esta demanda.
            </p>
          )}

          {/* Adicionar + busca */}
          {!isFrozen && (
            <div className="relative pt-1" ref={wrapRef}>
              {showSearch ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Buscar por nome ou e-mail…"
                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm
                               focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  {(candidates.length > 0 || isSearching || query.trim().length >= 2) && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden
                                    rounded-lg border border-gray-200 bg-white shadow-lg">
                      {isSearching ? (
                        <p className="px-3 py-2 text-xs text-gray-400">Buscando…</p>
                      ) : candidates.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-gray-400">Nenhum usuário encontrado.</p>
                      ) : (
                        <ul className="max-h-52 overflow-y-auto py-1">
                          {candidates.map(u => (
                            <li key={u.id}>
                              <button
                                onMouseDown={e => { e.preventDefault(); handleAdd(u) }}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-left
                                           transition-colors hover:bg-primary-50"
                              >
                                <div
                                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center
                                             rounded-full bg-primary-100 text-xs font-semibold text-primary-700"
                                  aria-hidden="true"
                                >
                                  {u.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-800">{u.name}</p>
                                  <p className="truncate text-xs text-gray-400">
                                    {u.department_name ?? u.email}
                                  </p>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={() => setShowSearch(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed
                             border-gray-300 px-2.5 py-0.5 text-xs text-gray-400
                             transition-colors hover:border-gray-400 hover:text-gray-600"
                >
                  <IconPlus className="h-3 w-3" />
                  Adicionar colaborador
                </button>
              )}
            </div>
          )}
        </div>
      )}
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
