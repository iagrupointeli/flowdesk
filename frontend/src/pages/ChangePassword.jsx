import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import api from '../lib/api'

/**
 * Página de troca obrigatória de senha (primeiro acesso via login direto).
 *
 * Acessada quando ProtectedRoute detecta requires_password_change = true.
 * Rota PÚBLICA (fora de ProtectedRoute) para evitar loop de redirecionamento.
 *
 * Auto-guardas:
 *   - Não autenticado → /login
 *   - Já trocou a senha → /home
 *
 * Após sucesso: patchUser({ requires_password_change: false }) + navega para /home.
 */
export default function ChangePassword() {
  const accessToken = useAuthStore(s => s.accessToken)
  const user        = useAuthStore(s => s.user)
  const patchUser   = useAuthStore(s => s.patchUser)
  const navigate    = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error,           setError]           = useState(null)
  const [isLoading,       setIsLoading]       = useState(false)

  if (!accessToken || !user) return <Navigate to="/login" replace />
  if (!user.requires_password_change) return <Navigate to="/home" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    if (newPassword.length < 8) {
      setError('A nova senha deve ter ao menos 8 caracteres.')
      return
    }

    setIsLoading(true)
    try {
      await api.patch('/users/me/password', { currentPassword, newPassword })
      patchUser({ requires_password_change: false })
      navigate('/home', { replace: true })
    } catch (err) {
      const msg = err?.response?.data?.error
      setError(msg ?? 'Erro ao alterar a senha. Tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary-600">InteliONE</h1>
          <p className="mt-1 text-sm text-gray-500">Defina sua senha para continuar</p>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-md">
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Criar nova senha</h2>
          <p className="mb-6 text-sm text-gray-500">
            Sua conta exige que você defina uma senha pessoal antes de continuar.
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                <span className="mt-0.5 flex-shrink-0">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="currentPassword" className="mb-1 block text-sm font-medium text-gray-700">
                Senha atual (temporária)
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           text-gray-900 placeholder-gray-400
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                placeholder="Senha que você usou para entrar"
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-gray-700">
                Nova senha
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           text-gray-900 placeholder-gray-400
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                placeholder="Mínimo 8 caracteres"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-gray-700">
                Confirmar nova senha
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           text-gray-900 placeholder-gray-400
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
                placeholder="Repita a nova senha"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold
                         text-white transition-colors hover:bg-primary-700
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Salvando…' : 'Definir senha e entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
