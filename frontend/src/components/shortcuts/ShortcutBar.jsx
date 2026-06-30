import { useState, useEffect } from 'react'
import { NavLink }            from 'react-router-dom'
import { useAuthStore }       from '../../stores/authStore'
import { useDemandTypeStore } from '../../stores/demandTypeStore'
import { useShortcutStore }   from '../../stores/shortcutStore'
import api                    from '../../lib/api'

// ── Barra de atalhos ──────────────────────────────────────────────────────────
// Posição fixa: left-0, top-14 (abaixo do header), bottom-0, w-56.
// z-10: fica abaixo da sidebar (z-30) e do header (z-40).
// Visível quando a sidebar está recolhida; coberta quando ela abre.

export default function ShortcutBar() {
  const user   = useAuthStore(s => s.user)
  const userId = user?.id

  const shortcuts      = useShortcutStore(s => (userId ? s.byUser[userId] : null) ?? [])
  const removeShortcut = useShortcutStore(s => s.remove)

  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <div className="fixed left-0 top-14 bottom-0 w-56 z-10 flex flex-col bg-white border-r border-gray-100 select-none">
        {/* Lista de atalhos */}
        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {shortcuts.length === 0 ? (
            <EmptyState />
          ) : (
            shortcuts.map(s => (
              <ShortcutItem
                key={s.id}
                shortcut={s}
                onRemove={() => removeShortcut(userId, s.id)}
              />
            ))
          )}
        </div>

        {/* Botão de adicionar */}
        <div className="border-t border-gray-100 p-2">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-gray-400
                       hover:text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            <span>Adicionar atalho</span>
          </button>
        </div>
      </div>

      {showModal && userId && (
        <AddShortcutModal userId={userId} onClose={() => setShowModal(false)} />
      )}
    </>
  )
}

// ── Item de atalho ────────────────────────────────────────────────────────────

function ShortcutItem({ shortcut, onRemove }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="relative group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NavLink
        to={shortcut.to}
        title={shortcut.label}
        className={({ isActive }) =>
          `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
            isActive
              ? 'bg-primary-50 text-primary-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`
        }
      >
        <ShortcutIcon type={shortcut.icon} color={shortcut.color} />
        <span className="flex-1 truncate">{shortcut.label}</span>
      </NavLink>

      {hovered && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onRemove() }}
          title="Remover atalho"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5
                     text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ── Estado vazio ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full pb-12 gap-3 px-4">
      <svg className="h-10 w-10 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h14M5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2M5 3l7 9 7-9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v5m0 0l-2-2m2 2l2-2" />
      </svg>
      <p className="text-xs text-center text-gray-300 leading-relaxed">
        Seus atalhos aparecem aqui. Use o botão abaixo para adicionar.
      </p>
    </div>
  )
}

// ── Ícone do atalho ───────────────────────────────────────────────────────────

function ShortcutIcon({ type, color }) {
  if (type === 'project' && color) {
    return (
      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
    )
  }
  const icons = {
    board:   <IconBoard />,
    focus:   <IconFocus />,
    chat:    <IconChat />,
    areas:   <IconAreas />,
    admin:   <IconAdmin />,
    rooms:   <IconRooms />,
    project: <IconProject />,
  }
  return (
    <span className="flex-shrink-0 text-gray-400">
      {icons[type] ?? <IconPage />}
    </span>
  )
}

// ── Modal de adicionar atalho ─────────────────────────────────────────────────

function AddShortcutModal({ userId, onClose }) {
  const current        = useShortcutStore(s => s.byUser[userId] ?? [])
  const addShortcut    = useShortcutStore(s => s.add)
  const removeShortcut = useShortcutStore(s => s.remove)
  const demandTypes    = useDemandTypeStore(s => s.demandTypes)
  const user           = useAuthStore(s => s.user)

  const [areas, setAreas] = useState([])

  useEffect(() => {
    const ctrl = new AbortController()
    api.get('/areas', { signal: ctrl.signal }).then(r => setAreas(r.data)).catch(() => {})
    return () => ctrl.abort()
  }, [])

  const isAdded = (to) => current.some(s => s.to === to)

  function toggle(shortcut) {
    const existing = current.find(s => s.to === shortcut.to)
    if (existing) removeShortcut(userId, existing.id)
    else addShortcut(userId, shortcut)
  }

  const fixedPages = [
    { label: 'Modo Foco',       to: '/foco',  icon: 'focus' },
    { label: 'Mensagens',       to: '/chat',  icon: 'chat'  },
    { label: 'Áreas & Projetos',to: '/areas', icon: 'areas' },
    ...(user?.role !== 'user' ? [{ label: 'Administração', to: '/admin', icon: 'admin' }] : []),
  ]

  const allProjects = areas.flatMap(a =>
    (a.projects ?? []).map(p => ({ ...p, area_name: a.name }))
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-96 max-h-[72vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Adicionar atalho</h2>
            <p className="text-xs text-gray-400 mt-0.5">Clique para fixar ou remover da barra lateral</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Páginas */}
          <PickerSection title="Páginas">
            {fixedPages.map(p => (
              <PickerItem
                key={p.to}
                label={p.label}
                icon={<ShortcutIcon type={p.icon} />}
                added={isAdded(p.to)}
                onToggle={() => toggle(p)}
              />
            ))}
          </PickerSection>

          {/* Quadros */}
          {demandTypes.length > 0 && (
            <PickerSection title="Quadros de demandas">
              {demandTypes.map(dt => {
                const s = { label: dt.name, to: `/board/${dt.id}`, icon: 'board' }
                return (
                  <PickerItem
                    key={dt.id}
                    label={dt.name}
                    sublabel={dt.department_name}
                    icon={<ShortcutIcon type="board" />}
                    added={isAdded(s.to)}
                    onToggle={() => toggle(s)}
                  />
                )
              })}
            </PickerSection>
          )}

          {/* Projetos */}
          {allProjects.length > 0 && (
            <PickerSection title="Projetos">
              {allProjects.map(p => {
                const s = { label: p.name, to: `/projects/${p.id}`, icon: 'project', color: p.color }
                return (
                  <PickerItem
                    key={p.id}
                    label={p.name}
                    sublabel={p.area_name}
                    icon={<ShortcutIcon type="project" color={p.color} />}
                    added={isAdded(s.to)}
                    onToggle={() => toggle(s)}
                  />
                )
              })}
            </PickerSection>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-componentes do modal ──────────────────────────────────────────────────

function PickerSection({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function PickerItem({ label, sublabel, icon, added, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors text-left
                  ${added
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-700 hover:bg-gray-50'}`}
    >
      <span className={added ? 'text-primary-600' : 'text-gray-400'}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate font-medium">{label}</span>
        {sublabel && <span className="block text-xs text-gray-400 truncate">{sublabel}</span>}
      </span>
      {added ? (
        <svg className="h-4 w-4 flex-shrink-0 text-primary-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="h-4 w-4 flex-shrink-0 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

// ── Ícones SVG ────────────────────────────────────────────────────────────────

function IconBoard() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 4a1 1 0 011-1h3a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V4zm6 0a1 1 0 011-1h3a1 1 0 011 1v7a1 1 0 01-1 1H9a1 1 0 01-1-1V4zm7-1a1 1 0 00-1 1v4a1 1 0 001 1h1a1 1 0 001-1V4a1 1 0 00-1-1h-1z" />
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
function IconAreas() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
    </svg>
  )
}
function IconAdmin() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  )
}
function IconRooms() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
    </svg>
  )
}
function IconProject() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}
function IconPage() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
    </svg>
  )
}
