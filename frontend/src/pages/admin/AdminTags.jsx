import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import api from '../../lib/api'

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#64748b',
]

export default function AdminTags() {
  const user      = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'super_admin'

  const [tags,        setTags]        = useState([])
  const [departments, setDepartments] = useState([])
  const [isLoading,   setIsLoading]   = useState(false)
  const [error,       setError]       = useState(null)

  // Filtro de departamento (super_admin pode filtrar; dept_admin não precisa)
  const [deptFilter, setDeptFilter] = useState('')

  // Modal criação
  const [showCreate, setShowCreate] = useState(false)
  const [isSaving,   setIsSaving]   = useState(false)
  const [saveError,  setSaveError]  = useState(null)

  // Dialog exclusão
  const [deleteTarget, setDeleteTarget] = useState(null)   // { id, name }
  const [isDeleting,   setIsDeleting]   = useState(false)

  // ── Fetch departamentos (para filtro e form de criação) ─────────────────────
  useEffect(() => {
    api.get('/admin/departments')
      .then(({ data }) => setDepartments(data))
      .catch(() => {})
  }, [])

  // ── Fetch tags ──────────────────────────────────────────────────────────────
  const abortRef = useRef(null)

  const fetchTags = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsLoading(true)
    setError(null)
    try {
      const params = deptFilter ? { department_id: deptFilter } : {}
      const { data } = await api.get('/tags', { params, signal: ctrl.signal })
      setTags(data)
    } catch (err) {
      if (err.name !== 'CanceledError') setError('Erro ao carregar tags.')
    } finally {
      setIsLoading(false)
    }
  }, [deptFilter])

  useEffect(() => {
    fetchTags()
    return () => abortRef.current?.abort()
  }, [fetchTags])

  // ── Criar tag ───────────────────────────────────────────────────────────────
  async function handleCreate({ name, color_hex, department_id }) {
    setIsSaving(true)
    setSaveError(null)
    try {
      const { data: created } = await api.post('/tags', { name, color_hex, department_id })
      setTags(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setShowCreate(false)
    } catch (err) {
      setSaveError(err.response?.data?.error ?? 'Erro ao criar tag.')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Deletar tag (otimista) ──────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    const prev = tags
    setTags(ts => ts.filter(t => t.id !== deleteTarget.id))
    setDeleteTarget(null)
    try {
      await api.delete(`/tags/${deleteTarget.id}`)
    } catch {
      setTags(prev)
    } finally {
      setIsDeleting(false)
    }
  }

  // ── Agrupa tags por departamento ────────────────────────────────────────────
  const deptMap = Object.fromEntries(departments.map(d => [d.id, d.name]))
  const grouped = tags.reduce((acc, tag) => {
    const key = tag.department_id
    if (!acc[key]) acc[key] = []
    acc[key].push(tag)
    return acc
  }, {})

  return (
    <div className="p-6">
      {/* Cabeçalho */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tags</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Etiquetas de classificação por departamento.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setSaveError(null); setShowCreate(true) }}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                     transition-colors hover:bg-primary-700
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
        >
          + Nova Tag
        </button>
      </div>

      {/* Filtro de departamento (super_admin) */}
      {isSuperAdmin && departments.length > 0 && (
        <div className="mb-5">
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm
                       transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">Todos os departamentos</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Skeleton */}
      {isLoading && (
        <div className="space-y-6">
          {[1, 2].map(i => (
            <div key={i}>
              <div className="mb-3 h-4 w-32 animate-pulse rounded bg-gray-200" />
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4].map(j => (
                  <div key={j} className="h-7 w-20 animate-pulse rounded-full bg-gray-200" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tags agrupadas por departamento */}
      {!isLoading && Object.keys(grouped).length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm text-gray-400">Nenhuma tag cadastrada.</p>
          <p className="mt-1 text-xs text-gray-400">
            Crie tags para classificar as demandas do departamento.
          </p>
        </div>
      )}

      {!isLoading && Object.entries(grouped).map(([deptId, deptTags]) => (
        <div key={deptId} className="mb-6">
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {deptMap[deptId] ?? 'Departamento'}
          </h2>
          <div className="flex flex-wrap gap-2">
            {deptTags.map(tag => (
              <TagChip
                key={tag.id}
                tag={tag}
                onDelete={() => setDeleteTarget(tag)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Modal criação */}
      {showCreate && (
        <CreateTagModal
          departments={isSuperAdmin
            ? departments
            : departments.filter(d => user?.departments?.some(ud => ud.id === d.id))}
          defaultDeptId={!isSuperAdmin
            ? (user?.departments?.find(ud => ud.is_primary)?.id ?? user?.departments?.[0]?.id ?? '')
            : ''}
          isSaving={isSaving}
          error={saveError}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Dialog exclusão */}
      {deleteTarget && (
        <DeleteDialog
          name={deleteTarget.name}
          color={deleteTarget.color_hex}
          isLoading={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── TagChip ──────────────────────────────────────────────────────────────────

function TagChip({ tag, onDelete }) {
  return (
    <span
      className="group flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-white"
      style={{ backgroundColor: tag.color_hex }}
    >
      {tag.name}
      <button
        type="button"
        onClick={onDelete}
        title="Excluir tag"
        className="flex h-4 w-4 items-center justify-center rounded-full
                   opacity-60 transition-opacity hover:opacity-100 focus:outline-none"
      >
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </span>
  )
}

// ── Modal de criação ─────────────────────────────────────────────────────────

function CreateTagModal({ departments, defaultDeptId, isSaving, error, onSubmit, onClose }) {
  const [name,         setName]         = useState('')
  const [colorHex,     setColorHex]     = useState(COLOR_PRESETS[0])
  const [customColor,  setCustomColor]  = useState('')
  const [departmentId, setDepartmentId] = useState(defaultDeptId)

  const activeColor = customColor.match(/^#[0-9a-fA-F]{6}$/) ? customColor : colorHex

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !departmentId) return
    onSubmit({ name: name.trim(), color_hex: activeColor, department_id: departmentId })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Nova Tag</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Nome */}
          <div>
            <label htmlFor="tag-name" className="mb-1 block text-sm font-medium text-gray-700">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="tag-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                         disabled:bg-gray-50"
              placeholder="ex: Urgente"
              autoFocus
            />
          </div>

          {/* Departamento (se houver mais de 1 opção) */}
          {departments.length > 1 && (
            <div>
              <label htmlFor="tag-dept" className="mb-1 block text-sm font-medium text-gray-700">
                Departamento <span className="text-red-500">*</span>
              </label>
              <select
                id="tag-dept"
                required
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                disabled={isSaving}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50"
              >
                <option value="">Selecione</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Cor */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Cor</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setColorHex(c); setCustomColor('') }}
                  className="h-7 w-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1"
                  style={{
                    backgroundColor: c,
                    outline: c === activeColor && !customColor ? `2px solid ${c}` : 'none',
                    outlineOffset: '2px',
                    transform: c === activeColor && !customColor ? 'scale(1.15)' : undefined,
                  }}
                />
              ))}
            </div>

            {/* Hex personalizado */}
            <div className="mt-2 flex items-center gap-2">
              <div
                className="h-7 w-7 flex-shrink-0 rounded-full border border-gray-200"
                style={{ backgroundColor: activeColor }}
              />
              <input
                type="text"
                placeholder="#rrggbb"
                value={customColor}
                onChange={e => setCustomColor(e.target.value)}
                maxLength={7}
                className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-xs
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Preview */}
          {name && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Preview:</span>
              <span
                className="rounded-full px-3 py-0.5 text-sm font-medium text-white"
                style={{ backgroundColor: activeColor }}
              >
                {name}
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700
                         hover:bg-gray-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim() || !departmentId}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                         hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Criando…
                </span>
              ) : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Dialog de exclusão ───────────────────────────────────────────────────────

function DeleteDialog({ name, color, isLoading, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Excluir tag?</h2>
        <p className="mb-1 text-sm text-gray-600">
          A tag{' '}
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {name}
          </span>{' '}
          será removida de todas as demandas vinculadas.
        </p>
        <p className="mb-5 text-sm text-gray-500">Esta ação não pode ser desfeita.</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700
                       hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-red-700 disabled:opacity-60"
          >
            {isLoading ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  )
}
