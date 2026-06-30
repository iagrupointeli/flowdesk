import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

/**
 * Página de Login.
 *
 * Comportamento:
 *  - Se já autenticado → redireciona para /board (evita re-login desnecessário)
 *  - Erros HTTP são mapeados para mensagens legíveis, sem vazar detalhes técnicos
 *  - Após login bem-sucedido, redireciona para `location.state.from` (rota que
 *    tentou ser acessada antes do redirecionamento pelo ProtectedRoute) ou /board
 */
export default function Login() {
  const accessToken = useAuthStore(s => s.accessToken)
  const user        = useAuthStore(s => s.user)
  const login       = useAuthStore(s => s.login)

  const navigate = useNavigate()
  const location = useLocation()
  const from            = location.state?.from?.pathname || '/board'
  const successMessage  = location.state?.successMessage ?? null

  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [error,     setError]     = useState(null)
  const [isLoading, setIsLoading] = useState(false)

  // ── Já autenticado: bypass ──────────────────────────────────────────────
  if (accessToken && user) {
    return <Navigate to={from} replace />
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      const status = err?.response?.status
      if (status === 401) {
        setError('E-mail ou senha incorretos.')
      } else if (status === 403) {
        setError('Sua conta está desativada. Contate o administrador.')
      } else if (!err?.response) {
        setError('Sem conexão com o servidor. Verifique sua rede.')
      } else {
        setError('Erro inesperado. Tente novamente.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo / título */}
        <div className="mb-8 text-center">
          <img src="/logo-azul.png" alt="InteliONE" className="mx-auto mb-3 h-[83px] w-[83px] object-contain" />
          <h1 className="text-3xl font-bold text-primary-600">InteliONE</h1>
          <p className="mt-1 text-sm text-gray-500">Gestão de demandas interdepartamentais</p>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-md">
          <h2 className="mb-6 text-xl font-semibold text-gray-900">Entrar na sua conta</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Banner de sucesso (ex: cadastro realizado) */}
            {successMessage && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700"
              >
                <span className="mt-0.5 flex-shrink-0">✓</span>
                <span>{successMessage}</span>
              </div>
            )}

            {/* Mensagem de erro inline */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                <span className="mt-0.5 flex-shrink-0">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* E-mail */}
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           placeholder-gray-400 transition-colors
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50 disabled:text-gray-400"
                placeholder="voce@empresa.com"
              />
            </div>

            {/* Senha */}
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           transition-colors
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !email || !password}
              className="mt-2 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold
                         text-white transition-colors hover:bg-primary-700
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Entrando…
                </span>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          {/* Link para cadastro */}
          <p className="mt-5 text-center text-sm text-gray-500">
            Não tem conta?{' '}
            <Link to="/register" className="font-medium text-primary-600 hover:text-primary-700">
              Cadastrar-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
