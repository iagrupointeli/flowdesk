import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

/**
 * Guarda de rota para toda a área autenticada do FlowDesk.
 *
 * Lógica em cascata:
 *
 *   1. Sem sessão (accessToken ou user ausentes) → /login
 *      Preserva `state.from` para que o Login redirecione de volta após autenticação.
 *
 *   2. Primeiro acesso pendente (user.requires_password_change = true)
 *      O campo é derivado no backend: `password_changed_at IS NULL`.
 *      Quando true, o usuário nunca definiu a própria senha — a conta foi criada
 *      pelo admin com senha temporária. Força /change-password.
 *
 *      Como o loop infinito é evitado:
 *        - /change-password está nas rotas PÚBLICAS (fora deste guard)
 *        - A flag vem do backend (getMe / login), não de estado local
 *        - Após PATCH /users/me/password, o backend seta password_changed_at = NOW()
 *          e patchUser({ requires_password_change: false }) é chamado na store
 *          → ProtectedRoute deixa passar normalmente
 *
 *   3. RBAC opcional: se `roles` for fornecido e o role do usuário não estiver
 *      na lista → /board (não expõe a tela restrita)
 *
 *   4. Tudo ok → renderiza <Outlet/> (rotas filhas)
 *
 * @param {{ roles?: string[] }} props
 */
export default function ProtectedRoute({ roles }) {
  const accessToken = useAuthStore(s => s.accessToken)
  const user        = useAuthStore(s => s.user)
  const location    = useLocation()

  // ── Guarda 1: não autenticado ────────────────────────────────────────────
  if (!accessToken || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // ── Guarda 2: primeiro acesso pendente ───────────────────────────────────
  // user.requires_password_change vem de getMe() / login() do backend.
  // /change-password é rota pública (auto-guarda internamente) — não há loop.
  if (user.requires_password_change) {
    return <Navigate to="/change-password" replace />
  }

  // ── Guarda 3: RBAC — role insuficiente ──────────────────────────────────
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/board" replace />
  }

  return <Outlet />
}
