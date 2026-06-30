import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../lib/api'

/**
 * Página de Primeiro Acesso — troca de senha via token one-time.
 *
 * Fluxo completo:
 *   1. Admin cria usuário → backend gera JWT type:'first_access' (TTL 24h)
 *   2. Usuário recebe e-mail com link: /first-access?token=<jwt>
 *   3. Usuário preenche nova senha nesta página (NÃO está autenticado ainda)
 *   4. POST /auth/first-access { token, newPassword } → 200 + message
 *   5. Usuário é redirecionado para /login para entrar com a nova senha
 *
 * Por que NÃO está atrás de ProtectedRoute?
 *   O endpoint /auth/first-access é público e recebe um token one-time.
 *   O usuário não tem accessToken neste momento — está pré-autenticação.
 *
 * Por que não há loop de redirecionamento?
 *   Não há navegação programática que passe por ProtectedRoute.
 *   Após sucesso, o usuário vai para /login (página pública).
 *   O ProtectedRoute já não redireciona para /first-access (campo
 *   `requires_password_change` não existe na resposta de /users/me).
 *
 * Tratamento de token ausente/inválido:
 *   - Sem token na URL: mostra mensagem orientando o usuário
 *   - Token expirado: o backend retorna 401, exibido como erro no form
 */
export default function FirstAccess() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error,           setError]           = useState(null)
  const [isLoading,       setIsLoading]       = useState(false)
  const [succeeded,       setSucceeded]       = useState(false)

  // ── Sem token na URL ─────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md text-center">
          <p className="text-lg font-semibold text-gray-800">Link inválido</p>
          <p className="mt-2 text-sm text-gray-500">
            Este link de acesso é inválido ou foi utilizado. Solicite um novo ao administrador.
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm text-primary-600 hover:underline">
            Ir para o Login
          </Link>
        </div>
      </div>
    )
  }

  // ── Tela de sucesso ───────────────────────────────────────────────────────
  if (succeeded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-lg font-semibold text-gray-800">Senha definida com sucesso!</p>
          <p className="mt-2 text-sm text-gray-500">
            Agora você pode entrar com sua nova senha.
          </p>
          <Link
            to="/login"
            className="mt-5 block w-full rounded-lg bg-primary-600 px-4 py-2.5 text-center
                       text-sm font-semibold text-white hover:bg-primary-700"
          >
            Ir para o Login
          </Link>
        </div>
      </div>
    )
  }

  // ── Validação client-side ─────────────────────────────────────────────────
  function validate() {
    if (newPassword.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
    if (newPassword !== confirmPassword) return 'As senhas não coincidem.'
    return null
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setError(null)
    setIsLoading(true)

    try {
      // POST /auth/first-access { token, newPassword }
      // Backend: verifica JWT type:'first_access', atualiza password_hash
      // Responde: { message: 'Senha definida com sucesso.' }
      await api.post('/auth/first-access', { token, newPassword })

      // Marca sucesso — mostra tela de confirmação (sem navigate programático)
      setSucceeded(true)
    } catch (err) {
      const status = err?.response?.status
      if (status === 401) {
        setError('Link expirado (válido por 24h). Solicite um novo ao administrador.')
      } else if (status === 403) {
        setError('Token inválido para esta operação.')
      } else if (status === 422) {
        const fieldErrors = err?.response?.data?.errors?.fieldErrors
        const firstMsg = fieldErrors
          ? Object.values(fieldErrors).flat()[0]
          : err?.response?.data?.message
        setError(firstMsg ?? 'Senha inválida. Verifique os requisitos.')
      } else {
        setError(err?.response?.data?.error ?? 'Erro ao salvar a senha. Tente novamente.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary-600">InteliONE</h1>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-md">
          <h2 className="mb-1 text-xl font-semibold text-gray-900">Defina sua senha</h2>
          <p className="mb-6 text-sm text-gray-500">
            Bem-vindo ao InteliONE. Crie uma senha segura para ativar sua conta.
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
              <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-gray-700">
                Nova senha
              </label>
              <input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50"
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
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !newPassword || !confirmPassword}
              className="mt-2 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold
                         text-white transition-colors hover:bg-primary-700
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Salvando…
                </span>
              ) : (
                'Definir senha e ativar conta'
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            Já tem senha?{' '}
            <Link to="/login" className="text-primary-600 hover:underline">
              Fazer login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
