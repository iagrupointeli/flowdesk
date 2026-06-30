import api from './api'

/**
 * Injeta os interceptores do Axios em tempo de execução.
 * Chamado UMA vez em App.jsx (nível de módulo, fora do componente)
 * com `useAuthStore.getState` como argumento.
 *
 * Por que recebe getAuthState em vez de importar a store diretamente?
 * → api.js e authStore.js se importam mutuamente se a store for importada aqui.
 *   No ESM, um dos dois chegaria como {} (objeto vazio) — bug silencioso e fatal.
 *   Passando getAuthState como parâmetro, a resolução ocorre em runtime,
 *   não no grafo estático de módulos.
 *
 * @param {() => import('../stores/authStore').AuthState} getAuthState
 *   Referência estável a useAuthStore.getState (não a chamada getState())
 */
export function setupInterceptors(getAuthState) {

  // ── Interceptor de REQUEST ──────────────────────────────────────────────────
  // Injeta o header Authorization em toda request que não seja a própria
  // /auth/login ou /auth/refresh (que não precisam de token).
  api.interceptors.request.use(config => {
    const { accessToken } = getAuthState()
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  })

  // ── Interceptor de RESPONSE (401) ───────────────────────────────────────────
  api.interceptors.response.use(
    // Respostas bem-sucedidas passam direto
    res => res,

    async err => {
      // ── Guard 1: ejeção imediata se /auth/refresh falhou ──────────────────
      // Sem isso: refresh retorna 401 → interceptor chama refresh → 401 → loop ∞
      // Com isso: qualquer falha do próprio /auth/refresh vai direto para logout.
      if (err.config?.url?.includes('/auth/refresh')) {
        getAuthState().logout()
        return Promise.reject(err)
      }

      // Só interessa tratar 401; outros erros (403, 422, 500…) passam direto
      if (err.response?.status !== 401) return Promise.reject(err)

      // ── Guard 2: flag _retry ──────────────────────────────────────────────
      // Garante no máximo UMA tentativa de refresh por request.
      // Evita o caso onde o refresh funciona mas a request retorna 401 novamente
      // (sessão revogada no servidor, token corrompido, etc.).
      if (err.config?._retry) {
        getAuthState().logout()
        return Promise.reject(err)
      }
      err.config._retry = true

      try {
        // Tenta renovar o accessToken via cookie httpOnly.
        // O interceptor de REQUEST já injeta o novo token no retry abaixo.
        await getAuthState().refresh()

        // Retry da request original — o header Authorization será reinjetado
        // automaticamente pelo interceptor de request com o novo token.
        return api(err.config)
      } catch {
        // refresh() falhou (token expirado, cookie ausente, servidor indisponível)
        // → logout definitivo, usuário volta para /login
        getAuthState().logout()
        return Promise.reject(err)
      }
    }
  )
}
