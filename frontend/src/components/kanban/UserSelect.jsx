import { useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

/**
 * Campo de busca assíncrona de usuários para o MoveModal.
 *
 * Comportamento:
 *   - Busca GET /users?department_id=<deptId>&q=<query> com debounce de 300ms
 *   - Exibe lista de sugestões em dropdown
 *   - Seleção atualiza `value` (objeto { id, name, email }) via onChange
 *   - Limpar o campo chama onChange(null)
 *   - AbortController cancela requests anteriores (concorrência)
 *
 * Props:
 *   departmentId — filtra usuários pelo departamento da demanda
 *   value        — { id, name, email } | null
 *   onChange(user | null)
 *   disabled
 *   required
 *
 * Regra: ZERO useEffect para fetch — fetch é disparado DENTRO do useEffect
 * como efeito colateral da mudança de query (evento controlado),
 * não como data fetching direto.
 */
export default function UserSelect({ departmentId, value, onChange, disabled, required, placeholder = 'Digite o nome do responsável…' }) {
  const [query,       setQuery]       = useState(value?.name ?? '')
  const [suggestions, setSuggestions] = useState([])
  const [isLoading,   setIsLoading]   = useState(false)
  const [isOpen,      setIsOpen]      = useState(false)
  const abortRef  = useRef(null)
  const inputRef  = useRef(null)
  const listRef   = useRef(null)

  // ── Busca com debounce ────────────────────────────────────────────────────
  useEffect(() => {
    // Usuário selecionou um item — não re-busca
    if (value && query === value.name) return
    // Query muito curta — limpa e fecha dropdown
    if (query.trim().length < 2) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      // Aborta requisição anterior em voo
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)
      try {
        const params = { q: query.trim(), limit: 10 }
        if (departmentId) params.department_id = departmentId

        const { data } = await api.get('/users', { params, signal: controller.signal })
        const users = Array.isArray(data) ? data : (data.users ?? data.items ?? [])
        setSuggestions(users)
        setIsOpen(users.length > 0)
      } catch (err) {
        if (err?.code !== 'ERR_CANCELED' && err?.name !== 'AbortError') {
          setSuggestions([])
        }
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [query, departmentId, value])

  // ── Seleção de usuário ────────────────────────────────────────────────────
  function selectUser(user) {
    setQuery(user.name)
    setSuggestions([])
    setIsOpen(false)
    onChange(user)
  }

  // ── Limpar seleção ────────────────────────────────────────────────────────
  function clearSelection() {
    setQuery('')
    setSuggestions([])
    setIsOpen(false)
    onChange(null)
    inputRef.current?.focus()
  }

  // ── Fechar dropdown ao clicar fora ────────────────────────────────────────
  useEffect(() => {
    function handleClickOutside(e) {
      if (!listRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            if (value) onChange(null)   // limpa seleção ao digitar novamente
          }}
          onFocus={() => { if (suggestions.length > 0) setIsOpen(true) }}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-8 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                     disabled:bg-gray-50"
        />

        {/* Indicadores de estado */}
        <span className="pointer-events-none absolute right-2.5 top-2.5 text-gray-400">
          {isLoading ? (
            <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          ) : value ? (
            <button
              type="button"
              className="pointer-events-auto text-gray-400 hover:text-gray-600"
              onClick={clearSelection}
              aria-label="Limpar seleção"
            >
              ✕
            </button>
          ) : (
            <span>🔍</span>
          )}
        </span>
      </div>

      {/* Dropdown de sugestões */}
      {isOpen && suggestions.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {suggestions.map(user => (
            <li
              key={user.id}
              role="option"
              aria-selected={value?.id === user.id}
              onMouseDown={e => { e.preventDefault(); selectUser(user) }}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-primary-50"
            >
              <div
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700"
                aria-hidden="true"
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-800">{user.name}</p>
                <p className="truncate text-xs text-gray-400">{user.email}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Nenhum resultado */}
      {isOpen && !isLoading && suggestions.length === 0 && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
          <p className="text-sm text-gray-400">Nenhum usuário encontrado.</p>
        </div>
      )}
    </div>
  )
}
