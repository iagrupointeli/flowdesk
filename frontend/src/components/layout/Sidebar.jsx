import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore }       from '../../stores/authStore'
import { useDemandTypeStore } from '../../stores/demandTypeStore'
import { useChatStore }       from '../../stores/chatStore'
import NewDemandModal         from '../kanban/NewDemandModal'
import api                    from '../../lib/api'

const ADMIN_ROLES = ['dept_admin', 'super_admin']

export default function Sidebar({ pinned, onTogglePin }) {
  const user           = useAuthStore(s => s.user)
  const demandTypes    = useDemandTypeStore(s => s.demandTypes)
  const isLoadingTypes = useDemandTypeStore(s => s.isLoading)
  const isAdmin        = user && ADMIN_ROLES.includes(user.role)
  const chatChannels   = useChatStore(s => s.channels)
  const chatUnread     = chatChannels.reduce((sum, c) => sum + (c.unread_count ?? 0), 0)
  const navigate       = useNavigate()

  const [isOpen,             setIsOpen]             = useState(false)
  const [showNewDemandModal, setShowNewDemandModal] = useState(false)
  const [areas,              setAreas]              = useState([])
  const [areasOpen,          setAreasOpen]          = useState(true)
  const [expandedAreas,      setExpandedAreas]      = useState({})
  const hideTimer = useRef(null)

  useEffect(() => {
    const ctrl = new AbortController()
    api.get('/areas', { signal: ctrl.signal }).then(r => setAreas(r.data)).catch(() => {})
    return () => ctrl.abort()
  }, [])

  function open() {
    clearTimeout(hideTimer.current)
    setIsOpen(true)
  }

  function scheduleClose() {
    if (pinned) return
    hideTimer.current = setTimeout(() => setIsOpen(false), 250)
  }

  // limpa timer no unmount
  useEffect(() => () => clearTimeout(hideTimer.current), [])

  // Quando o pin é removido (clique no hambúrguer), fecha imediatamente
  // sem esperar o mouse sair — evita o "2 cliques" para recolher
  useEffect(() => {
    if (!pinned) {
      clearTimeout(hideTimer.current)
      setIsOpen(false)
    }
  }, [pinned])

  const visible = isOpen || pinned

  // Agrupa tipos por departamento
  const grouped = demandTypes.reduce((acc, dt) => {
    const key = dt.department_name ?? 'Geral'
    if (!acc[key]) acc[key] = []
    acc[key].push(dt)
    return acc
  }, {})
  const hasMultipleDepts = Object.keys(grouped).length > 1

  function toggleArea(id) {
    setExpandedAreas(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <>
      {/* Hotzone invisível — 8px no canto esquerdo */}
      <div
        className="fixed left-0 top-0 h-screen w-2 z-40"
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
      />

      {/* Overlay escuro ao fundo quando sidebar flutuante está aberta */}
      {visible && !pinned && (
        <div
          className="fixed inset-0 z-20 bg-black/20"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        className={`fixed left-0 top-0 h-screen z-30 w-56 flex flex-col
                    border-r border-gray-200
                    bg-white
                    transition-transform duration-200 ease-in-out
                    ${visible ? 'translate-x-0 shadow-[0_20px_40px_-15px_rgba(37,99,235,0.25)]' : '-translate-x-full shadow-none'}`}
      >
        {/* Logo + pin */}
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div className="flex items-center gap-2">
            <img src="/logo-azul.png" alt="" className="h-6 w-6 object-contain" />
            <span className="text-lg font-bold tracking-tight text-primary-600">InteliONE</span>
          </div>
          <button
            onClick={onTogglePin}
            title={pinned ? 'Desafixar sidebar' : 'Fixar sidebar aberta'}
            className="rounded p-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            {pinned ? <IconPinFilled /> : <IconPin />}
          </button>
        </div>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto px-2 py-4">

          {/* Nova Demanda */}
          <button
            type="button"
            onClick={() => setShowNewDemandModal(true)}
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg
                       bg-primary-600 px-3 py-2 text-sm font-semibold text-white
                       shadow-sm shadow-primary-600/20
                       transition-all hover:bg-primary-700 hover:shadow-md hover:shadow-primary-600/25 active:scale-[0.98]
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
          >
            <span aria-hidden="true">+</span>
            Nova Demanda
          </button>

          <SectionLabel className="mt-3">Quadros</SectionLabel>

          {isLoadingTypes && (
            <div className="space-y-1 px-1">
              {[1,2,3].map(i => <div key={i} className="h-8 animate-pulse rounded-lg bg-gray-100" />)}
            </div>
          )}

          {!isLoadingTypes && demandTypes.length === 0 && (
            <p className="px-3 py-1 text-xs text-gray-400">Nenhum tipo de demanda disponível.</p>
          )}

          {!isLoadingTypes && Object.entries(grouped).map(([deptName, types]) => (
            <div key={deptName}>
              {hasMultipleDepts && (
                <p className="mt-2 mb-0.5 px-3 text-xs text-gray-400 truncate" title={deptName}>{deptName}</p>
              )}
              {types.map(dt => (
                <NavItem key={dt.id} to={`/board/${dt.id}`} label={dt.name} icon={<IconBoard />} />
              ))}
            </div>
          ))}

          {/* Áreas */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setAreasOpen(o => !o)}
              className="flex w-full items-center justify-between px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
            >
              <span>Áreas</span>
              <svg className={`h-3 w-3 transition-transform ${areasOpen ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0L14.414 10l-5.707 5.707a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {areasOpen && (
              <div className="mt-0.5 space-y-0.5">
                {areas.length === 0 && (
                  <p className="px-3 py-1 text-xs text-gray-400 italic">Nenhuma área.</p>
                )}
                {areas.map(area => (
                  <div key={area.id}>
                    <button
                      type="button"
                      onClick={() => toggleArea(area.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                    >
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: area.color }} />
                      <span className="flex-1 truncate text-left">{area.name}</span>
                      <svg className={`h-3 w-3 flex-shrink-0 text-gray-400 transition-transform ${expandedAreas[area.id] ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0L14.414 10l-5.707 5.707a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>

                    {expandedAreas[area.id] && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-200 pl-2">
                        {area.projects.length === 0 && (
                          <p className="px-2 py-1 text-xs text-gray-400 italic">Sem projetos.</p>
                        )}
                        {area.projects.map(p => (
                          <NavLink
                            key={p.id}
                            to={`/projects/${p.id}`}
                            title={p.name}
                            className={({ isActive }) =>
                              `flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                                isActive
                                  ? 'bg-primary-50 text-primary-700 font-medium'
                                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                              }`
                            }
                          >
                            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                            <span className="truncate">{p.name}</span>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => navigate('/areas')}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  Gerenciar áreas
                </button>
              </div>
            )}
          </div>
        </nav>

        {/* Atalhos fixos */}
        <div className="border-t border-gray-200 px-2 py-2 space-y-0.5">
          <NavItem to="/foco"  label="Modo Foco"  icon={<IconFocus />} />
          <NavItem
            to="/chat"
            label="Mensagens"
            icon={<IconChat />}
            badge={chatUnread > 0 ? chatUnread : null}
          />
        </div>

        {/* Rodapé */}
        <div className="border-t border-gray-200 px-4 py-3">
          <p className="truncate text-xs font-medium text-gray-700">{user?.name ?? '—'}</p>
          <p className="truncate text-xs text-gray-500">{user?.email}</p>
          {user?.role !== 'user' && (
            <span className="mt-1 inline-block rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
              {user.role === 'super_admin' ? 'Super Admin' : 'Admin'}
            </span>
          )}
        </div>
      </aside>

      {showNewDemandModal && (
        <NewDemandModal onClose={() => setShowNewDemandModal(false)} />
      )}
    </>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function SectionLabel({ children, className = '' }) {
  return (
    <p className={`mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 ${className}`}>
      {children}
    </p>
  )
}

function NavItem({ to, label, icon, badge }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-primary-50 text-primary-700'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`
      }
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badge != null && (
        <span className="flex-shrink-0 rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

// ── Ícones ───────────────────────────────────────────────────────────────────

function IconPin() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M5 15L15 5" />
      <circle cx="10" cy="10" r="6" />
    </svg>
  )
}

function IconPinFilled() {
  return (
    <svg className="h-4 w-4 text-primary-600" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 14a6 6 0 110-12 6 6 0 010 12zm0-9a1 1 0 00-1 1v3a1 1 0 002 0V8a1 1 0 00-1-1zm0 6a1 1 0 100 2 1 1 0 000-2z" />
    </svg>
  )
}

function IconFocus() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
    </svg>
  )
}

function IconChat() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
      <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
    </svg>
  )
}

function IconBoard() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 4a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V4zm6 0a1 1 0 011-1h3a1 1 0 011 1v7a1 1 0 01-1 1H9a1 1 0 01-1-1V4zm7-1a1 1 0 00-1 1v4a1 1 0 001 1h1a1 1 0 001-1V4a1 1 0 00-1-1h-1z" />
    </svg>
  )
}
