import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import api from '../lib/api'

export default function Register() {
  const accessToken = useAuthStore(s => s.accessToken)
  const user        = useAuthStore(s => s.user)

  const navigate = useNavigate()

  const [name,         setName]         = useState('')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [departments,  setDepartments]  = useState([])
  const [isLoading,    setIsLoading]    = useState(false)
  const [error,        setError]        = useState(null)

  // ── Carrega setores ativos — todos os hooks ANTES de qualquer early return ──
  const abortRef = useRef(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    api.get('/departments', { signal: ctrl.signal })
      .then(({ data }) => setDepartments(data))
      .catch(err => { if (err.name !== 'CanceledError') setError('Não foi possível carregar os setores.') })

    return () => ctrl.abort()
  }, [])

  // ── Redireciona se já autenticado ───────────────────────────────────────────
  if (accessToken && user) {
    return <Navigate to="/board" replace />
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      await api.post('/auth/register', {
        name:          name.trim(),
        email:         email.trim(),
        password,
        department_id: departmentId,
      })
      navigate('/login', {
        replace: true,
        state: { successMessage: 'Cadastro realizado! Faça login para continuar.' },
      })
    } catch (err) {
      const status = err?.response?.status
      if (status === 409) {
        setError('Este e-mail já está cadastrado. Faça login ou recupere sua senha.')
      } else if (status === 422) {
        const fieldErrors = err?.response?.data?.errors?.fieldErrors ?? {}
        const first = Object.values(fieldErrors).flat()[0]
        setError(first ?? 'Verifique os campos e tente novamente.')
      } else if (!err?.response) {
        setError('Sem conexão com o servidor. Verifique sua rede.')
      } else {
        setError(err?.response?.data?.error ?? 'Erro inesperado. Tente novamente.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const canSubmit = name.trim() && email.trim() && password.length >= 8 && departmentId && !isLoading

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo / título */}
        <div className="mb-8 text-center">
          <img src="/logo-azul.png" alt="InteliONE" className="mx-auto mb-2 h-11 w-11 object-contain" />
          <h1 className="text-3xl font-bold text-primary-600">InteliONE</h1>
          <p className="mt-1 text-sm text-gray-500">Gestão de demandas interdepartamentais</p>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-md">
          <h2 className="mb-6 text-xl font-semibold text-gray-900">Criar conta</h2>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
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

            {/* Nome completo */}
            <div>
              <label htmlFor="reg-name" className="mb-1 block text-sm font-medium text-gray-700">
                Nome completo
              </label>
              <input
                id="reg-name"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           placeholder-gray-400 transition-colors
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50 disabled:text-gray-400"
                placeholder="Seu nome"
              />
            </div>

            {/* E-mail */}
            <div>
              <label htmlFor="reg-email" className="mb-1 block text-sm font-medium text-gray-700">
                E-mail
              </label>
              <input
                id="reg-email"
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
              <label htmlFor="reg-password" className="mb-1 block text-sm font-medium text-gray-700">
                Senha
              </label>
              <input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           transition-colors
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50 disabled:text-gray-400"
              />
              {password.length > 0 && password.length < 8 && (
                <p className="mt-1 text-xs text-red-500">Mínimo de 8 caracteres.</p>
              )}
            </div>

            {/* Setor principal */}
            <div>
              <label htmlFor="reg-dept" className="mb-1 block text-sm font-medium text-gray-700">
                Setor principal
              </label>
              <select
                id="reg-dept"
                required
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                disabled={isLoading || departments.length === 0}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           transition-colors
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500
                           disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {departments.length === 0 ? 'Carregando setores…' : 'Selecione seu setor'}
                </option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold
                         text-white transition-colors hover:bg-primary-700
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Criando conta…
                </span>
              ) : (
                'Criar conta'
              )}
            </button>
          </form>

          {/* Link para login */}
          <p className="mt-5 text-center text-sm text-gray-500">
            Já tem conta?{' '}
            <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700">
              Fazer login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
