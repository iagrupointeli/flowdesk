import { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import api from '../lib/api'

/**
 * Página de perfil do usuário: /profile
 *
 * Seções:
 *   - Informações (nome, email, role, departamentos) — somente leitura
 *   - Notificações — toggles notify_email / notify_platform
 *   - Segurança — troca de senha (currentPassword + newPassword + confirm)
 */
export default function Profile() {
  const user      = useAuthStore(s => s.user)
  const patchUser = useAuthStore(s => s.patchUser)

  // ── Notificações ──────────────────────────────────────────────────────────
  const [notifyEmail,    setNotifyEmail]    = useState(user?.notify_email    ?? true)
  const [notifyPlatform, setNotifyPlatform] = useState(user?.notify_platform ?? true)
  const [notifySaving,   setNotifySaving]   = useState(false)
  const [notifySuccess,  setNotifySuccess]  = useState(false)
  const [notifyError,    setNotifyError]    = useState(null)

  async function handleNotifySave() {
    setNotifySaving(true)
    setNotifyError(null)
    setNotifySuccess(false)
    try {
      const { data } = await api.patch('/users/me/notifications', {
        notify_email:    notifyEmail,
        notify_platform: notifyPlatform,
      })
      patchUser({ notify_email: data.notify_email, notify_platform: data.notify_platform })
      setNotifySuccess(true)
      setTimeout(() => setNotifySuccess(false), 3000)
    } catch (err) {
      setNotifyError(err?.response?.data?.error ?? 'Erro ao salvar preferências.')
    } finally {
      setNotifySaving(false)
    }
  }

  // ── Troca de senha ────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwdSaving,       setPwdSaving]       = useState(false)
  const [pwdSuccess,      setPwdSuccess]      = useState(false)
  const [pwdError,        setPwdError]        = useState(null)

  async function handlePasswordSave(e) {
    e.preventDefault()
    setPwdError(null)
    setPwdSuccess(false)

    if (newPassword !== confirmPassword) {
      setPwdError('As senhas não coincidem.')
      return
    }
    if (newPassword.length < 8) {
      setPwdError('A nova senha deve ter ao menos 8 caracteres.')
      return
    }

    setPwdSaving(true)
    try {
      await api.patch('/users/me/password', { currentPassword, newPassword })
      patchUser({ requires_password_change: false })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPwdSuccess(true)
      setTimeout(() => setPwdSuccess(false), 4000)
    } catch (err) {
      const msg = err?.response?.data?.error
      setPwdError(msg ?? 'Erro ao alterar a senha. Verifique a senha atual.')
    } finally {
      setPwdSaving(false)
    }
  }

  const roleLabel = user?.role === 'super_admin'
    ? 'Super Admin'
    : user?.role === 'dept_admin'
    ? 'Administrador'
    : 'Usuário'

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Meu Perfil</h1>

      {/* ── Informações ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Informações
        </h2>
        <dl className="space-y-3">
          <Row label="Nome"  value={user?.name  ?? '—'} />
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Perfil" value={roleLabel} />
          <div>
            <dt className="text-xs font-medium text-gray-500">Departamentos</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {(user?.departments ?? []).length === 0 ? (
                <span className="text-sm text-gray-400">—</span>
              ) : (
                (user.departments).map(d => (
                  <span
                    key={d.id}
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
                                ${d.is_primary
                                  ? 'bg-primary-100 text-primary-700'
                                  : 'bg-gray-100 text-gray-600'}`}
                  >
                    {d.name}{d.is_primary ? ' ★' : ''}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Notificações ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Notificações
        </h2>
        <div className="space-y-3">
          <Toggle
            id="notify-email"
            label="Notificações por e-mail"
            description="Receber alertas de demandas no seu e-mail"
            checked={notifyEmail}
            onChange={setNotifyEmail}
          />
          <Toggle
            id="notify-platform"
            label="Notificações na plataforma"
            description="Receber alertas em tempo real no sino"
            checked={notifyPlatform}
            onChange={setNotifyPlatform}
          />
        </div>
        {notifyError && (
          <p className="mt-3 text-xs text-red-500">{notifyError}</p>
        )}
        {notifySuccess && (
          <p className="mt-3 text-xs text-green-600">Preferências salvas.</p>
        )}
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleNotifySave}
            disabled={notifySaving}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                       text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {notifySaving ? 'Salvando…' : 'Salvar preferências'}
          </button>
        </div>
      </section>

      {/* ── Segurança ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Segurança
        </h2>
        <form onSubmit={handlePasswordSave} noValidate className="space-y-4">
          {pwdError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              <span className="mt-0.5">⚠️</span>
              <span>{pwdError}</span>
            </div>
          )}
          {pwdSuccess && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              Senha alterada com sucesso.
            </div>
          )}

          <PasswordField
            id="current-password"
            label="Senha atual"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField
            id="new-password"
            label="Nova senha"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            hint="Mínimo 8 caracteres"
          />
          <PasswordField
            id="confirm-password"
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pwdSaving || !currentPassword || !newPassword || !confirmPassword}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                         text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pwdSaving ? 'Salvando…' : 'Alterar senha'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function Row({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800">{value}</dd>
    </div>
  )
}

function Toggle({ id, label, description, checked, onChange }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`h-5 w-9 rounded-full transition-colors ${
            checked ? 'bg-primary-600' : 'bg-gray-300'
          }`}
        />
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
    </label>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete, hint }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type="password"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                   text-gray-900 placeholder-gray-400
                   focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
        placeholder={hint ?? ''}
      />
    </div>
  )
}
