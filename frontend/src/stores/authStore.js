import { create } from 'zustand'
import api from '../lib/api'

/**
 * Store central de autenticação do FlowDesk.
 *
 * Fluxo de vida do token:
 *   1. App monta  → hydrate() tenta renovar o token via cookie httpOnly
 *   2. Sessão ativa → interceptor chama refresh() quando recebe 401
 *   3. Login explícito → login(email, password) — caso de primeiro acesso / relogin
 *   4. Logout → limpa tudo + cookie é invalidado pelo backend
 *
 * Regras inegociáveis:
 *   - accessToken NUNCA vai para localStorage/sessionStorage (XSS)
 *   - isHydrating = true bloqueia TODAS as rotas até a hidratação terminar
 *   - _hydrationStarted previne chamada dupla de hydrate() sob React 18 StrictMode
 */

/**
 * @typedef {Object} AuthState
 * @property {string|null}  accessToken
 * @property {Object|null}  user
 * @property {boolean}      isHydrating          - true = aguarda resultado de /auth/refresh
 * @property {boolean}      _hydrationStarted    - flag interna, nunca use em views
 * @property {() => Promise<void>} hydrate
 * @property {() => Promise<void>} refresh
 * @property {(email: string, password: string) => Promise<void>} login
 * @property {() => Promise<void>} logout
 */

export const useAuthStore = create((set, get) => ({
  // ── Estado inicial ──────────────────────────────────────────────────────────
  accessToken:       null,
  user:              null,
  isHydrating:       true,   // começa true → UI fica bloqueada até resolução
  _hydrationStarted: false,

  // ── hydrate() ───────────────────────────────────────────────────────────────
  // Chamado uma única vez em App.jsx via useEffect.
  // Verifica se há um refreshToken válido em cookie httpOnly e, se sim,
  // popula o accessToken e os dados do usuário sem pedir login.
  hydrate: async () => {
    // Guard StrictMode: React 18 desmonta+remonta em dev — esse flag impede
    // que a segunda invocação refaça a call de /auth/refresh enquanto a primeira
    // ainda está em voo (ou já concluiu).
    if (get()._hydrationStarted) return
    set({ _hydrationStarted: true })

    try {
      const { data: refreshData } = await api.post('/auth/refresh')
      const { data: userData }    = await api.get('/users/me', {
        headers: { Authorization: `Bearer ${refreshData.accessToken}` },
      })
      set({
        accessToken: refreshData.accessToken,
        user:        userData,
        isHydrating: false,
      })
    } catch {
      // Cookie ausente, expirado ou inválido — usuário não estava logado.
      // Não é erro: é o estado normal de um visitante não autenticado.
      set({
        accessToken: null,
        user:        null,
        isHydrating: false,
      })
    }
  },

  // ── refresh() ───────────────────────────────────────────────────────────────
  // Chamado pelo interceptor 401 de setupInterceptors.js.
  // Renova APENAS o accessToken — não toca em `user` nem em `isHydrating`.
  // NÃO tem guard de _hydrationStarted: o interceptor pode chamar em qualquer
  // momento durante a sessão, não apenas na montagem.
  refresh: async () => {
    const { data } = await api.post('/auth/refresh')
    set({ accessToken: data.accessToken })
  },

  // ── login() ─────────────────────────────────────────────────────────────────
  // Fluxo explícito (página /login).
  // 1. POST /auth/login   → backend retorna { accessToken, user } e seta
  //                          cookie httpOnly com refreshToken
  // 2. GET  /users/me     → perfil completo (inclui departments, notify_*)
  //
  // Por que chamamos /users/me separado?
  //   A resposta de /auth/login retorna um `user` mínimo { id, name, email, role }.
  //   O perfil completo (departamentos, preferências) só vem de /users/me.
  //   Passamos o accessToken explicitamente no header porque o interceptor de
  //   request ainda leria null da store (set() não foi chamado ainda).
  login: async (email, password) => {
    const { data: loginData } = await api.post('/auth/login', { email, password })
    // loginData = { accessToken, user: { id, name, email, role } }
    const { data: userData }  = await api.get('/users/me', {
      headers: { Authorization: `Bearer ${loginData.accessToken}` },
    })
    set({
      accessToken: loginData.accessToken,
      user:        userData,
      isHydrating: false,
    })
  },

  // ── patchUser() ──────────────────────────────────────────────────────────────
  // Mescla campos parciais no objeto user sem recarregar do servidor.
  patchUser: (data) => set(state => ({
    user: state.user ? { ...state.user, ...data } : state.user,
  })),

  // ── logout() ────────────────────────────────────────────────────────────────
  // Envia POST /auth/logout para que o backend limpe o cookie httpOnly.
  // Best-effort: mesmo que o servidor esteja indisponível, o estado local
  // é limpo e o usuário é desconectado da SPA.
  // _hydrationStarted resetado para permitir hydrate() num re-login futuro.
  logout: async () => {
    try {
      await api.post('/auth/logout')   // POST — limpa cookie no servidor
    } catch {
      // Logout best-effort: mesmo que o backend falhe (offline, token já expirado)
      // limpamos o estado local para não deixar o usuário "preso".
    } finally {
      set({
        accessToken:       null,
        user:              null,
        isHydrating:       false,
        _hydrationStarted: false,
      })
    }
  },
}))
