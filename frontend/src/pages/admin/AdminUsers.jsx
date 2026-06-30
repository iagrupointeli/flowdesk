import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import api from '../../lib/api'

/**
 * Painel de gestão de usuários — /admin/users
 *
 * ── Funcionalidades ───────────────────────────────────────────────────────────
 *
 *   Tabela com paginação offset, busca com debounce (400ms), filtros de
 *   role e status, e ações por linha (editar, ativar/desativar, resetar senha).
 *
 * ── RBAC ─────────────────────────────────────────────────────────────────────
 *
 *   super_admin → vê e edita todos os usuários; pode atribuir qualquer role
 *   dept_admin  → vê/edita apenas usuários do seu departamento;
 *                 opção "super_admin" ocultada no select de role
 *
 * ── Paginação ─────────────────────────────────────────────────────────────────
 *
 *   Offset-based (adequado para tabela admin com volume controlado).
 *   Backend retorna { items, total, page, perPage, hasMore }.
 *
 * ── Criação de usuário ────────────────────────────────────────────────────────
 *
 *   Após criação, o backend retorna { user, firstAccessToken }.
 *   O admin deve compartilhar o link /first-access?token=<firstAccessToken>
 *   com o novo usuário para que ele defina sua senha.
 *   O link é exibido no modal com botão de cópia.
 */

const PER_PAGE = 20

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  dept_admin:  'Administrador',
  user:        'Usuário',
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const actorRole = useAuthStore(s => s.user?.role)

  // ── Estado da tabela ────────────────────────────────────────────────────────
  const [users,     setUsers]     = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState(null)

  // ── Filtros ─────────────────────────────────────────────────────────────────
  const [localQ,       setLocalQ]       = useState('')
  const [q,            setQ]            = useState('')
  const [roleFilter,   setRoleFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // ── Modais ──────────────────────────────────────────────────────────────────
  const [editingUser,    setEditingUser]    = useState(null)   // null | user
  const [creatingUser,   setCreatingUser]   = useState(false)
  const [firstAccessInfo, setFirstAccessInfo] = useState(null) // { name, token }

  // ── Debounce da busca ───────────────────────────────────────────────────────
  const debounceRef = useRef(null)
  const handleQChange = useCallback((value) => {
    setLocalQ(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setQ(value)
      setPage(1)
    }, 400)
  }, [])

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const abortRef = useRef(null)

  const fetchUsers = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/users', {
        signal: ctrl.signal,
        params: {
          page,
          per_page: PER_PAGE,
          ...(q            && { q }),
          ...(roleFilter   && { role: roleFilter }),
          ...(statusFilter && { status: statusFilter }),
        },
      })
      setUsers(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      if (err?.code === 'ERR_CANCELED') return
      setError(err?.response?.data?.error ?? 'Erro ao carregar usuários.')
    } finally {
      setIsLoading(false)
    }
  }, [page, q, roleFilter, statusFilter])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  // ── Ações ───────────────────────────────────────────────────────────────────

  async function handleToggleActive(user) {
    const newActive = !user.is_active
    const confirmed = window.confirm(
      newActive
        ? `Reativar "${user.name}"?`
        : `Desativar "${user.name}"? As demandas atribuídas a ele serão devolvidas para a fila.`
    )
    if (!confirmed) return

    try {
      await api.patch(`/users/${user.id}/status`, { active: newActive })
      setUsers(prev => prev.map(u =>
        u.id === user.id ? { ...u, is_active: newActive } : u
      ))
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao alterar status do usuário.')
    }
  }

  async function handleResetPassword(user) {
    const confirmed = window.confirm(`Resetar senha de "${user.name}"? Um novo link de primeiro acesso será gerado.`)
    if (!confirmed) return

    try {
      const { data } = await api.post(`/users/${user.id}/reset-password`)
      setFirstAccessInfo({ name: user.name, token: data.firstAccessToken })
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao resetar senha.')
    }
  }

  function handleEditSave(updatedUser) {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? { ...u, ...updatedUser } : u))
    setEditingUser(null)
  }

  function handleCreateSave({ user: newUser, firstAccessToken }) {
    setUsers(prev => [{ ...newUser, is_active: true, departments: [] }, ...prev])
    setTotal(t => t + 1)
    setCreatingUser(false)
    setFirstAccessInfo({ name: newUser.name, token: firstAccessToken })
  }

  // ── Paginação ───────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Usuários</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {total > 0 ? `${total} usuário${total !== 1 ? 's' : ''}` : 'Nenhum resultado'}
          </p>
        </div>
        <button
          onClick={() => setCreatingUser(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm
                     font-semibold text-white transition-colors hover:bg-primary-700
                     focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <span aria-hidden="true">+</span>
          Novo Usuário
        </button>
      </div>

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail…"
            value={localQ}
            onChange={e => handleQChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm
                       placeholder:text-gray-400 focus:border-primary-500 focus:outline-none
                       focus:ring-1 focus:ring-primary-500"
          />
          <IconSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
        </div>

        <select
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1) }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="">Todos os papéis</option>
          {actorRole === 'super_admin' && <option value="super_admin">Super Admin</option>}
          <option value="dept_admin">Administrador</option>
          <option value="user">Usuário</option>
        </select>

        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          <option value="">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {/* ── Tabela ────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {error && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th>Nome</Th>
                <Th>E-mail</Th>
                <Th>Papel</Th>
                <Th>Departamentos</Th>
                <Th>Status</Th>
                <Th>Criado em</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading && users.length === 0 && (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-100" />
                      </td>
                    ))}
                  </tr>
                ))
              )}

              {!isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}

              {users.map(user => (
                <UserRow
                  key={user.id}
                  user={user}
                  actorRole={actorRole}
                  onEdit={() => setEditingUser(user)}
                  onToggleActive={() => handleToggleActive(user)}
                  onResetPassword={() => handleResetPassword(user)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Paginação ─────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-500">
              Página {page} de {totalPages} · {total} total
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || isLoading}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium
                           text-gray-600 transition-colors hover:bg-gray-50
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || isLoading}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium
                           text-gray-600 transition-colors hover:bg-gray-50
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                Próximo →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modais ────────────────────────────────────────────────────────── */}
      {creatingUser && (
        <UserFormModal
          mode="create"
          actorRole={actorRole}
          onSave={handleCreateSave}
          onClose={() => setCreatingUser(false)}
        />
      )}

      {editingUser && (
        <UserFormModal
          mode="edit"
          user={editingUser}
          actorRole={actorRole}
          onSave={handleEditSave}
          onClose={() => setEditingUser(null)}
        />
      )}

      {firstAccessInfo && (
        <FirstAccessLinkModal
          userName={firstAccessInfo.name}
          token={firstAccessInfo.token}
          onClose={() => setFirstAccessInfo(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UserRow
// ─────────────────────────────────────────────────────────────────────────────

function UserRow({ user, actorRole, onEdit, onToggleActive, onResetPassword }) {
  const deptNames = (user.departments ?? [])
    .map(d => d.name ?? d.department_id?.slice(0, 8))
    .filter(Boolean)
    .join(', ')

  return (
    <tr className={user.is_active ? '' : 'bg-gray-50 opacity-70'}>
      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full
                          bg-primary-100 text-xs font-semibold text-primary-700">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <span className="truncate max-w-[160px]" title={user.name}>{user.name}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-gray-600 truncate max-w-[200px]">
        {user.email}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <RoleBadge role={user.role} />
      </td>
      <td className="px-4 py-3 text-gray-600 text-xs max-w-[160px] truncate" title={deptNames}>
        {deptNames || <span className="text-gray-400 italic">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge active={user.is_active} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-gray-500 text-xs">
        {new Date(user.created_at).toLocaleDateString('pt-BR')}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <ActionBtn onClick={onEdit}>Editar</ActionBtn>
          <ActionBtn onClick={onToggleActive} variant={user.is_active ? 'danger' : 'success'}>
            {user.is_active ? 'Desativar' : 'Ativar'}
          </ActionBtn>
          {user.requires_password_change && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 font-medium">
              Aguarda 1º acesso
            </span>
          )}
          <ActionBtn onClick={onResetPassword} variant="secondary">Resetar senha</ActionBtn>
        </div>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UserFormModal — cria ou edita um usuário
// ─────────────────────────────────────────────────────────────────────────────

function UserFormModal({ mode, user, actorRole, onSave, onClose }) {
  const [name,          setName]          = useState(user?.name ?? '')
  const [email,         setEmail]         = useState(user?.email ?? '')
  const [role,          setRole]          = useState(user?.role ?? 'user')
  const [departments,   setDepartments]   = useState([])   // opções carregadas da API
  const [selectedDepts, setSelectedDepts] = useState(
    (user?.departments ?? []).map(d => d.department_id)
  )
  const [primaryDept,   setPrimaryDept]   = useState(
    (user?.departments ?? []).find(d => d.is_primary)?.department_id ?? ''
  )
  const [isLoading,     setIsLoading]     = useState(false)
  const [error,         setError]         = useState(null)
  const [depsLoading,   setDepsLoading]   = useState(true)

  // Carrega lista de departamentos
  useEffect(() => {
    api.get('/admin/departments')
      .then(({ data }) => setDepartments(data ?? []))
      .catch(() => setDepartments([]))
      .finally(() => setDepsLoading(false))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedDepts.length === 0) {
      setError('Selecione pelo menos um departamento.')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      if (mode === 'create') {
        const { data } = await api.post('/users', {
          name: name.trim(),
          email: email.trim(),
          role,
          departmentIds: selectedDepts,
          primaryDeptId: primaryDept || selectedDepts[0],
        })
        onSave(data)
      } else {
        const { data } = await api.patch(`/users/${user.id}`, {
          name: name.trim(),
          role,
          departmentIds: selectedDepts,
          primaryDeptId: primaryDept || selectedDepts[0],
        })
        onSave(data)
      }
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao salvar usuário.')
    } finally {
      setIsLoading(false)
    }
  }

  function toggleDept(id) {
    setSelectedDepts(prev =>
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    )
    if (primaryDept === id) setPrimaryDept('')
  }

  // Roles disponíveis para o ator (dept_admin não pode atribuir super_admin)
  const availableRoles = actorRole === 'super_admin'
    ? ['super_admin', 'dept_admin', 'user']
    : ['dept_admin', 'user']

  return (
    <Modal
      title={mode === 'create' ? 'Novo Usuário' : 'Editar Usuário'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {/* Nome */}
        <Field label="Nome">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            minLength={2}
            className={inputCls}
            placeholder="Nome completo"
          />
        </Field>

        {/* E-mail (somente criação) */}
        {mode === 'create' && (
          <Field label="E-mail">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className={inputCls}
              placeholder="nome@empresa.com"
            />
          </Field>
        )}

        {/* Role */}
        <Field label="Papel">
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className={inputCls}
          >
            {availableRoles.map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </Field>

        {/* Departamentos */}
        <Field label="Departamentos">
          {depsLoading ? (
            <div className="h-8 animate-pulse rounded bg-gray-100" />
          ) : departments.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum departamento disponível.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-gray-200 p-2">
              {departments.map(d => (
                <label key={d.id} className="flex items-center gap-2 cursor-pointer
                                             rounded px-2 py-1 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedDepts.includes(d.id)}
                    onChange={() => toggleDept(d.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600"
                  />
                  <span className="text-sm text-gray-700 flex-1">{d.name}</span>
                  {selectedDepts.includes(d.id) && selectedDepts.length > 1 && (
                    <button
                      type="button"
                      onClick={ev => { ev.stopPropagation(); setPrimaryDept(d.id) }}
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        primaryDept === d.id
                          ? 'bg-primary-100 text-primary-700 font-semibold'
                          : 'text-gray-400 hover:text-primary-600'
                      }`}
                    >
                      {primaryDept === d.id ? '★ Principal' : 'Principal'}
                    </button>
                  )}
                </label>
              ))}
            </div>
          )}
        </Field>

        {/* Botões */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                       text-gray-600 hover:bg-gray-50 focus:outline-none
                       focus:ring-2 focus:ring-primary-500"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-primary-700 focus:outline-none focus:ring-2
                       focus:ring-primary-500 disabled:opacity-60"
          >
            {isLoading ? 'Salvando…' : mode === 'create' ? 'Criar Usuário' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FirstAccessLinkModal — exibe o link de primeiro acesso para o admin copiar
// ─────────────────────────────────────────────────────────────────────────────

function FirstAccessLinkModal({ userName, token, onClose }) {
  const link = `${window.location.origin}/first-access?token=${token}`
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Modal title="Usuário criado" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Compartilhe o link abaixo com <strong>{userName}</strong> para que ele
          defina sua senha. O link expira em <strong>24 horas</strong>.
        </p>

        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="flex-1 break-all text-xs text-gray-700 font-mono select-all">{link}</p>
          <button
            onClick={handleCopy}
            className="flex-shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs
                       font-medium text-gray-600 hover:bg-white transition-colors"
          >
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos de UI
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  // Fecha com Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return (
    <th className={`whitespace-nowrap px-4 py-3 text-left text-xs font-semibold
                    uppercase tracking-wider text-gray-500 ${className}`}>
      {children}
    </th>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}

function ActionBtn({ onClick, children, variant = 'default' }) {
  const cls = {
    default:   'border-gray-300 text-gray-600 hover:bg-gray-50',
    danger:    'border-red-200 text-red-600 hover:bg-red-50',
    success:   'border-green-200 text-green-600 hover:bg-green-50',
    secondary: 'border-gray-200 text-gray-500 hover:bg-gray-50',
  }[variant]

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${cls}
                  focus:outline-none focus:ring-1 focus:ring-primary-500`}
    >
      {children}
    </button>
  )
}

function RoleBadge({ role }) {
  const cfg = {
    super_admin: 'bg-purple-100 text-purple-700',
    dept_admin:  'bg-blue-100 text-blue-700',
    user:        'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg[role] ?? cfg.user}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

function StatusBadge({ active }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium
                      ${active ? 'text-green-700' : 'text-gray-400'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
      {active ? 'Ativo' : 'Inativo'}
    </span>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-primary-500 focus:outline-none ' +
  'focus:ring-1 focus:ring-primary-500'

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────────

function IconSearch({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  )
}

function IconX({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}
