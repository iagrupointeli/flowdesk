import { forwardRef, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore }                 from '../../stores/authStore'
import { useNotificationStore }         from '../../stores/notificationStore'
import { useTheme }                     from '../../hooks/useTheme'
import IdeaModal                        from '../shared/IdeaModal'

// O antigo dropdown "Administração" (engrenagem) saiu daqui — Dashboard/
// Usuários/Departamentos/Workflows/Webhooks foram promovidos pra Sidebar,
// o resto foi pro backlog (rotas continuam vivas, só sem entrada de menu).
// Ver Track R1 em docs/superpowers/plans/2026-07-02-one-asana-refocus.md.

export default function Header({ onToggleSidebar, sidebarPinned }) {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const logout   = useAuthStore(s => s.logout)
  const { dark, toggle: toggleDark } = useTheme()

  const notifications = useNotificationStore(s => s.notifications)
  const unreadCount   = useNotificationStore(s => s.unreadCount)
  const hasMore       = useNotificationStore(s => s.hasMore)
  const isLoading     = useNotificationStore(s => s.isLoading)

  const [notifOpen,     setNotifOpen]     = useState(false)
  const [userOpen,      setUserOpen]      = useState(false)
  const [showIdeaModal, setShowIdeaModal] = useState(false)

  const notifRef   = useRef(null)
  const bellRef    = useRef(null)
  const userRef    = useRef(null)
  const userBtnRef = useRef(null)

  // Ctrl+K → /search
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); navigate('/search') }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  // Fechar notificações ao clicar fora
  useEffect(() => {
    if (!notifOpen) return
    function handler(e) {
      if (notifRef.current?.contains(e.target) || bellRef.current?.contains(e.target)) return
      setNotifOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setNotifOpen(false) }
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', handler); document.removeEventListener('keydown', onKey) }
  }, [notifOpen])

  // Fechar user menu ao clicar fora
  useEffect(() => {
    if (!userOpen) return
    function handler(e) {
      if (userRef.current?.contains(e.target) || userBtnRef.current?.contains(e.target)) return
      setUserOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setUserOpen(false) }
    document.addEventListener('pointerdown', handler)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', handler); document.removeEventListener('keydown', onKey) }
  }, [userOpen])

  return (
    <header className={`flex h-14 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 transition-[margin] duration-200 ease-in-out ${sidebarPinned ? 'ml-56' : 'ml-0'}`}>

      {/* Esquerda — menu toggle + ideias */}
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleSidebar}
          title={sidebarPinned ? 'Recolher sidebar' : 'Fixar sidebar'}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <IconMenu />
        </button>
        <button
          onClick={() => setShowIdeaModal(true)}
          title="Tive uma ideia"
          className="group rounded-lg p-2 text-gray-400 transition-colors hover:bg-amber-50"
        >
          <IconLightbulb className="h-5 w-5 transition-colors group-hover:text-amber-500" />
        </button>
      </div>

      {showIdeaModal && <IdeaModal onClose={() => setShowIdeaModal(false)} />}

      {/* Direita */}
      <div className="flex items-center gap-2">

        {/* Busca global */}
        <Link
          to="/search"
          title="Busca global (Ctrl+K)"
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5
                     text-xs text-gray-400 transition-colors hover:border-gray-300 hover:bg-gray-50
                     hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <IconSearch className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Buscar</span>
          <kbd className="hidden rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] leading-none text-gray-400 sm:inline-block">
            Ctrl+K
          </kbd>
        </Link>

        {/* Sino de notificações */}
        <div className="relative">
          <button
            ref={bellRef}
            onClick={() => {
              const next = !notifOpen
              setNotifOpen(next)
              if (next && unreadCount > 0) useNotificationStore.getState().markAllRead()
            }}
            aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ''}`}
            className="relative rounded-lg p-1.5 text-gray-500 transition-colors
                       hover:bg-gray-100 hover:text-gray-700
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <IconBell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center
                               rounded-full bg-red-500 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <NotificationPopover
              ref={notifRef}
              notifications={notifications}
              unreadCount={unreadCount}
              hasMore={hasMore}
              isLoading={isLoading}
              onClose={() => setNotifOpen(false)}
            />
          )}
        </div>

        <div className="h-5 w-px bg-gray-200" aria-hidden="true" />

        {/* Avatar — user settings dropdown */}
        <div className="relative">
          <button
            ref={userBtnRef}
            onClick={() => setUserOpen(o => !o)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-gray-100"
            title="Configurações do usuário"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
              {(user?.name ?? user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium leading-tight text-gray-800">
                {user?.name ?? user?.email}
              </p>
              {user?.role !== 'user' && (
                <p className="text-xs leading-tight text-primary-600 font-medium">
                  {user.role === 'super_admin' ? 'Super Admin' : 'Administrador'}
                </p>
              )}
            </div>
            <svg className={`h-3.5 w-3.5 text-gray-400 transition-transform ${userOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {userOpen && (
            <div
              ref={userRef}
              className="absolute right-0 top-full z-50 mt-1.5 w-56
                         rounded-xl border border-gray-200
                         bg-white shadow-[0_20px_40px_-15px_rgba(37,99,235,0.2)] py-1.5"
            >
              {/* Perfil */}
              <Link
                to="/profile"
                onClick={() => setUserOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <IconUser className="h-4 w-4 text-gray-400" />
                Meu perfil
              </Link>

              {/* Alterar senha */}
              <Link
                to="/change-password"
                onClick={() => setUserOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <IconLock className="h-4 w-4 text-gray-400" />
                Alterar senha
              </Link>

              {/* Dark mode toggle */}
              <button
                onClick={toggleDark}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {dark ? <IconSun className="h-4 w-4 text-yellow-400" /> : <IconMoon className="h-4 w-4 text-gray-400" />}
                {dark ? 'Modo claro' : 'Modo escuro'}
                <span className={`ml-auto flex h-5 w-9 items-center rounded-full transition-colors ${dark ? 'bg-primary-600' : 'bg-gray-200'}`}>
                  <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </span>
              </button>

              <div className="my-1 h-px bg-gray-100 mx-2" />

              {/* Logout */}
              <button
                onClick={() => { setUserOpen(false); logout() }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <IconLogout className="h-4 w-4" />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// ── NotificationPopover ───────────────────────────────────────────────────────

const NotificationPopover = forwardRef(function NotificationPopover(
  { notifications, unreadCount, hasMore, isLoading, onClose }, ref
) {
  const navigate = useNavigate()

  function handleItemClick(n) {
    if (!n.is_read) useNotificationStore.getState().markAsRead(n.id)
    if (n.link) navigate(n.link)
    onClose()
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Notificações"
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-gray-200
                 bg-white shadow-[0_20px_40px_-15px_rgba(37,99,235,0.2)] sm:w-96"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Notificações
          {unreadCount > 0 && (
            <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-100 px-1.5 text-xs font-bold text-red-600">
              {unreadCount}
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={() => useNotificationStore.getState().markAllRead()}
            className="text-xs font-medium text-primary-600 hover:text-primary-800"
          >
            Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {isLoading && notifications.length === 0 && (
          <div className="space-y-3 p-4">
            {[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
          </div>
        )}

        {!isLoading && notifications.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400">
            <IconBellSlash className="h-8 w-8" />
            <p className="text-sm">Nenhuma notificação</p>
          </div>
        )}

        {notifications.map(n => (
          <button
            key={n.id}
            onClick={() => handleItemClick(n)}
            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50
                        ${!n.is_read ? 'bg-blue-50' : 'bg-white'}`}
          >
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${!n.is_read ? 'bg-blue-500' : 'bg-transparent'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm leading-snug ${!n.is_read ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                {n.message}
              </p>
              <time dateTime={n.created_at} className="mt-0.5 block text-xs text-gray-400">
                {formatRelativeTime(n.created_at)}
              </time>
            </div>
          </button>
        ))}

        {hasMore && (
          <div className="border-t border-gray-100 px-4 py-2">
            <button
              onClick={() => useNotificationStore.getState().fetchMore()}
              disabled={isLoading}
              className="w-full text-center text-xs font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
            >
              {isLoading ? 'Carregando…' : 'Carregar mais'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 60)  return 'Agora mesmo'
  const m = Math.round(s / 60)
  if (m < 60)  return `${m} min atrás`
  const h = Math.round(m / 60)
  if (h < 24)  return `${h}h atrás`
  const d = Math.round(h / 24)
  if (d < 7)   return `${d}d atrás`
  return new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })
}

// ── Ícones ────────────────────────────────────────────────────────────────────

function IconMenu() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
    </svg>
  )
}

function IconLightbulb({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 2a6 6 0 00-3.815 10.631C7.237 13.516 7.5 14.386 7.5 15v.5A1.5 1.5 0 009 17h2a1.5 1.5 0 001.5-1.5V15c0-.614.263-1.484 1.315-2.369A6 6 0 0010 2zM8.5 18.5A.5.5 0 019 18h2a.5.5 0 01.5.5v.25a.75.75 0 01-.75.75h-2a.75.75 0 01-.75-.75v-.25z" clipRule="evenodd" />
    </svg>
  )
}

function IconSearch({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
    </svg>
  )
}

function IconBell({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 2a6 6 0 00-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 00.515 1.076 32.91 32.91 0 003.256.508 3.5 3.5 0 006.972 0 32.903 32.903 0 003.256-.508.75.75 0 00.515-1.076A11.448 11.448 0 0116 8a6 6 0 00-6-6zm0 14.5a2 2 0 01-1.95-1.557 33.54 33.54 0 003.9 0A2 2 0 0110 16.5z" clipRule="evenodd" />
    </svg>
  )
}

function IconBellSlash({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22z" />
    </svg>
  )
}

function IconUser({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
    </svg>
  )
}

function IconLock({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
    </svg>
  )
}

function IconSun({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  )
}

function IconMoon({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

function IconLogout({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
    </svg>
  )
}
