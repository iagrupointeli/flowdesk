import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import api from '../../lib/api'

export default function AdminDepartments() {
  const userRole = useAuthStore(s => s.user?.role)
  const isSuperAdmin = userRole === 'super_admin'

  const [departments,         setDepartments]         = useState([])
  const [archivedDepartments, setArchivedDepartments] = useState([])
  const [isLoading,           setIsLoading]           = useState(false)
  const [error,               setError]               = useState(null)

  // Modal criar / editar
  const [modal,       setModal]       = useState(null)   // null | 'create' | 'edit'
  const [editingDept, setEditingDept] = useState(null)   // { id, name, description }
  const [isSaving,    setIsSaving]    = useState(false)
  const [saveError,   setSaveError]   = useState(null)

  // Confirmação de arquivamento
  const [archiveTarget, setArchiveTarget] = useState(null)  // { id, name }
  const [isArchiving,   setIsArchiving]   = useState(false)

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const abortRef = useRef(null)

  const fetchDepartments = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsLoading(true)
    setError(null)
    try {
      const [activeRes, archivedRes] = await Promise.all([
        api.get('/admin/departments',          { signal: ctrl.signal }),
        isSuperAdmin
          ? api.get('/admin/departments/archived', { signal: ctrl.signal })
          : Promise.resolve({ data: [] }),
      ])
      setDepartments(activeRes.data)
      setArchivedDepartments(archivedRes.data)
    } catch (err) {
      if (err.name !== 'CanceledError') setError('Erro ao carregar departamentos.')
    } finally {
      setIsLoading(false)
    }
  }, [isSuperAdmin])

  useEffect(() => {
    fetchDepartments()
    return () => abortRef.current?.abort()
  }, [fetchDepartments])

  // ── Criar ───────────────────────────────────────────────────────────────────
  function openCreate() {
    setEditingDept(null)
    setSaveError(null)
    setModal('create')
  }

  async function handleCreate(formData) {
    setIsSaving(true)
    setSaveError(null)
    try {
      const { data: created } = await api.post('/admin/departments', formData)
      setDepartments(prev => [created, ...prev].sort((a, b) => a.name.localeCompare(b.name)))
      setModal(null)
    } catch (err) {
      setSaveError(err.response?.data?.error ?? 'Erro ao criar departamento.')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Editar ──────────────────────────────────────────────────────────────────
  function openEdit(dept) {
    setEditingDept(dept)
    setSaveError(null)
    setModal('edit')
  }

  async function handleEdit(formData) {
    setIsSaving(true)
    setSaveError(null)
    const prev = departments
    // Mutação otimista
    setDepartments(ds =>
      ds.map(d => d.id === editingDept.id ? { ...d, ...formData } : d)
    )
    try {
      await api.patch(`/admin/departments/${editingDept.id}`, formData)
      setModal(null)
    } catch (err) {
      setDepartments(prev)
      setSaveError(err.response?.data?.error ?? 'Erro ao atualizar departamento.')
    } finally {
      setIsSaving(false)
    }
  }

  // ── Arquivar ────────────────────────────────────────────────────────────────
  async function handleArchive() {
    if (!archiveTarget) return
    setIsArchiving(true)
    const prev = departments
    const target = archiveTarget
    setDepartments(ds => ds.filter(d => d.id !== target.id))
    setArchiveTarget(null)
    try {
      await api.post(`/admin/departments/${target.id}/archive`)
      // Adiciona na lixeira localmente
      setArchivedDepartments(prev => [
        { id: target.id, name: target.name, description: target.description, archived_at: new Date().toISOString() },
        ...prev,
      ])
    } catch {
      setDepartments(prev)
    } finally {
      setIsArchiving(false)
    }
  }

  // ── Restaurar ────────────────────────────────────────────────────────────────
  async function handleRestore(dept) {
    const prevArchived = archivedDepartments
    setArchivedDepartments(ds => ds.filter(d => d.id !== dept.id))
    try {
      await api.post(`/admin/departments/${dept.id}/restore`)
      // Recarrega ativos para obter dados completos (created_at etc.)
      const { data } = await api.get('/admin/departments')
      setDepartments(data)
    } catch {
      setArchivedDepartments(prevArchived)
      alert('Erro ao restaurar departamento.')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      {/* Cabeçalho */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Departamentos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Gerencie os setores da organização.
          </p>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                       transition-colors hover:bg-primary-700
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
          >
            + Novo Setor
          </button>
        )}
      </div>

      {/* Erro de fetch */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Nome
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Descrição
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                Criado em
              </th>
              {isSuperAdmin && (
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Ações
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading && (
              [1, 2, 3].map(i => (
                <tr key={i}>
                  <td className="px-6 py-4"><div className="h-4 w-40 animate-pulse rounded bg-gray-200" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-64 animate-pulse rounded bg-gray-200" /></td>
                  <td className="px-6 py-4"><div className="h-4 w-24 animate-pulse rounded bg-gray-200" /></td>
                  {isSuperAdmin && <td className="px-6 py-4" />}
                </tr>
              ))
            )}

            {!isLoading && departments.length === 0 && (
              <tr>
                <td colSpan={isSuperAdmin ? 4 : 3} className="px-6 py-8 text-center text-sm text-gray-400">
                  Nenhum departamento cadastrado.
                </td>
              </tr>
            )}

            {!isLoading && departments.map(dept => (
              <tr key={dept.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{dept.name}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{dept.description || '—'}</td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {new Date(dept.created_at).toLocaleDateString('pt-BR')}
                </td>
                {isSuperAdmin && (
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(dept)}
                        title="Editar"
                        className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchiveTarget(dept)}
                        title="Arquivar"
                        className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <IconArchive />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lixeira de departamentos */}
      {isSuperAdmin && archivedDepartments.length > 0 && (
        <DeptTrashSection depts={archivedDepartments} onRestore={handleRestore} />
      )}

      {/* Modal criar / editar */}
      {modal && (
        <DeptModal
          mode={modal}
          initial={editingDept}
          isSaving={isSaving}
          error={saveError}
          onSubmit={modal === 'create' ? handleCreate : handleEdit}
          onClose={() => setModal(null)}
        />
      )}

      {/* Dialog de confirmação de arquivamento */}
      {archiveTarget && (
        <ArchiveDialog
          name={archiveTarget.name}
          isLoading={isArchiving}
          onConfirm={handleArchive}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </div>
  )
}

// ── Lixeira ──────────────────────────────────────────────────────────────────

function DeptTrashSection({ depts, onRestore }) {
  const [open, setOpen] = useState(false)

  function daysLeft(archivedAt) {
    return Math.max(0, 30 - Math.floor((Date.now() - new Date(archivedAt).getTime()) / 86_400_000))
  }

  return (
    <div className="mt-6 rounded-xl border border-dashed border-gray-200">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm text-gray-500
                   hover:text-gray-700 focus:outline-none"
      >
        <span className="font-medium">Lixeira de departamentos</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          {depts.length}
        </span>
        <svg className={`ml-auto h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
             viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="overflow-hidden rounded-b-xl border-t border-dashed border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-100">
            <tbody>
              {depts.map(dept => (
                <tr key={dept.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-500">{dept.name}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{dept.description || '—'}</td>
                  <td className={`px-4 py-3 text-xs font-medium tabular-nums
                    ${daysLeft(dept.archived_at) <= 3
                      ? 'text-red-500'
                      : daysLeft(dept.archived_at) <= 7
                        ? 'text-amber-500'
                        : 'text-gray-400'}`}>
                    {daysLeft(dept.archived_at)}d restantes
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onRestore(dept)}
                      className="rounded border border-green-200 bg-green-50 px-2.5 py-1 text-xs
                                 font-medium text-green-700 transition-colors hover:bg-green-100"
                    >
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Modal criar/editar ───────────────────────────────────────────────────────

function DeptModal({ mode, initial, isSaving, error, onSubmit, onClose }) {
  const [name,        setName]        = useState(initial?.name        ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')

  function handleSubmit(e) {
    e.preventDefault()
    const payload = { name: name.trim() }
    if (description.trim()) payload.description = description.trim()
    onSubmit(payload)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          {mode === 'create' ? 'Novo Setor' : 'Editar Setor'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="dept-name" className="mb-1 block text-sm font-medium text-gray-700">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="dept-name"
              type="text"
              required
              minLength={2}
              maxLength={255}
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isSaving}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                         disabled:bg-gray-50 disabled:text-gray-400"
              placeholder="ex: Tecnologia da Informação"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="dept-desc" className="mb-1 block text-sm font-medium text-gray-700">
              Descrição
            </label>
            <textarea
              id="dept-desc"
              rows={3}
              maxLength={1000}
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={isSaving}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm
                         transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                         disabled:bg-gray-50 disabled:text-gray-400"
              placeholder="Opcional — descreva o setor brevemente"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700
                         transition-colors hover:bg-gray-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                         transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Salvando…
                </span>
              ) : (
                mode === 'create' ? 'Criar' : 'Salvar'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Dialog de arquivamento ───────────────────────────────────────────────────

function ArchiveDialog({ name, isLoading, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Arquivar setor?</h2>
        <p className="mb-5 text-sm text-gray-600">
          O setor <span className="font-medium text-gray-900">"{name}"</span> será arquivado e
          deixará de aparecer para novos colaboradores. Esta ação não pode ser desfeita.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700
                       transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white
                       transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Arquivando…' : 'Arquivar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ícones ───────────────────────────────────────────────────────────────────

function IconPencil() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  )
}

function IconArchive() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
      <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
    </svg>
  )
}
