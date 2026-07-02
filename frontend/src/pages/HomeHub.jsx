import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../lib/api'

const FOLDER_KEY = 'folder:estados'

const CATEGORY_COLOR = {
  internal: 'bg-primary-100 text-primary-700',
  site:     'bg-gray-100 text-gray-600',
  folder:   'bg-amber-100 text-amber-600',
}

/**
 * Tela inicial — painel de acessos (Track F1/R1, 2026-07-02).
 *
 * Cada usuário pode favoritar qualquer item (inclusive estados de dentro da
 * pasta "Estados", que aí também aparecem fora dela) e reordenar tudo
 * livremente no modo "Configurar" — mesma lógica de tela inicial de celular.
 * Ver getHomeLayout em backend/src/services/home.service.js pro contrato
 * "auto" (favorito/estrela) vs "manual" (posição arrastada) de ordenação.
 */
export default function HomeHub() {
  const navigate = useNavigate()
  const [layout,        setLayout]        = useState(null)
  const [error,         setError]         = useState(null)
  const [isConfiguring, setIsConfiguring] = useState(false)
  const [showFolder,    setShowFolder]    = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    api.get('/home', { signal: ctrl.signal })
      .then(r => setLayout(r.data))
      .catch(err => { if (err?.code !== 'ERR_CANCELED') setError('Erro ao carregar seus acessos.') })
    return () => ctrl.abort()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleToggleFavorite(key, current) {
    setLayout(prev => {
      if (!prev) return prev
      const states = prev.states.map(s => s.key === key ? { ...s, isFavorited: !current } : s)
      const isState = prev.states.some(s => s.key === key)

      let items
      if (!isState) {
        // Item comum (interno/site/pasta): sempre visível, só alterna a flag.
        items = prev.items.map(i => i.key === key ? { ...i, isFavorited: !current } : i)
      } else if (!current) {
        // Estado virando favorito: entra na grade principal (cópia, não sai
        // da pasta). Evita duplicar se já estiver lá por algum motivo.
        const favoritedState = states.find(s => s.key === key)
        items = prev.items.some(i => i.key === key)
          ? prev.items.map(i => i.key === key ? { ...i, isFavorited: true } : i)
          : [...prev.items, favoritedState]
      } else {
        // Estado deixando de ser favorito: sai da grade principal, continua
        // navegável dentro da pasta.
        items = prev.items.filter(i => i.key !== key)
      }

      return { items, states }
    })
    api.post('/home/favorite', { key, favorited: !current }).catch(() => {
      setError('Erro ao favoritar. Tente de novo.')
      api.get('/home').then(r => setLayout(r.data)).catch(() => {})
    })
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id || !layout) return
    const oldIndex = layout.items.findIndex(i => i.key === active.id)
    const newIndex = layout.items.findIndex(i => i.key === over.id)
    const reordered = arrayMove(layout.items, oldIndex, newIndex)
    setLayout(prev => ({ ...prev, items: reordered }))
    api.post('/home/reorder', { orderedKeys: reordered.map(i => i.key) }).catch(() => {
      setError('Erro ao salvar a nova ordem.')
    })
  }

  function handleCardClick(item) {
    if (isConfiguring) return
    if (item.isFolder) { setShowFolder(true); return }
    if (item.category === 'internal') { navigate(item.url); return }
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Seus acessos</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {isConfiguring ? 'Arraste pra reorganizar. Toque de novo em "Pronto" quando terminar.' : 'Favorite com a estrela ou reorganize em "Configurar".'}
            </p>
          </div>
          <button
            onClick={() => setIsConfiguring(o => !o)}
            className={`flex-shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors
              ${isConfiguring
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {isConfiguring ? 'Pronto' : 'Configurar'}
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {!layout && !error && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        )}

        {layout && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={layout.items.map(i => i.key)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {layout.items.map(item => (
                  <HubCard
                    key={item.key}
                    item={item}
                    isConfiguring={isConfiguring}
                    onClick={() => handleCardClick(item)}
                    onToggleFavorite={() => handleToggleFavorite(item.key, item.isFavorited)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {showFolder && layout && (
        <FolderModal
          states={layout.states}
          onClose={() => setShowFolder(false)}
          onToggleFavorite={handleToggleFavorite}
        />
      )}
    </div>
  )
}

// ── HubCard ──────────────────────────────────────────────────────────────────

function HubCard({ item, isConfiguring, onClick, onToggleFavorite }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.5 : 1,
    zIndex:     isDragging ? 10 : 'auto',
  }

  const colorClass = CATEGORY_COLOR[item.isFolder ? 'folder' : item.category] ?? CATEGORY_COLOR.site

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isConfiguring ? { ...attributes, ...listeners } : {})}
      onClick={onClick}
      className={`group relative flex h-28 flex-col items-center justify-center gap-2 rounded-xl border
                  border-gray-200 bg-white p-3 text-center shadow-sm transition-all
                  ${isConfiguring ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md'}
                  ${isDragging ? 'ring-2 ring-primary-400' : ''}`}
    >
      {!isConfiguring && !item.isFolder && (
        <button
          onClick={e => { e.stopPropagation(); onToggleFavorite() }}
          title={item.isFavorited ? 'Remover dos favoritos' : 'Favoritar'}
          className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full
                      transition-colors
                      ${item.isFavorited ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100 hover:text-amber-400'}`}
        >
          <IconStar filled={item.isFavorited} />
        </button>
      )}

      <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${colorClass}`}>
        {item.isFolder ? <IconFolder /> : item.label.charAt(0).toUpperCase()}
      </span>
      <span className="line-clamp-2 text-xs font-medium leading-tight text-gray-700">{item.label}</span>
    </div>
  )
}

// ── FolderModal ──────────────────────────────────────────────────────────────

function FolderModal({ states, onClose, onToggleFavorite }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <IconFolder />
            </span>
            <h2 className="text-base font-semibold text-gray-900">Estados</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <IconX />
          </button>
        </div>

        <p className="mb-4 text-xs text-gray-400">
          Favorite um estado pra ele aparecer também fora da pasta, na tela inicial.
        </p>

        <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
          {states.map(state => (
            <button
              key={state.key}
              onClick={() => onToggleFavorite(state.key, state.isFavorited)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left
                         text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <span className={state.isFavorited ? 'text-amber-500' : 'text-gray-300'}>
                <IconStar filled={state.isFavorited} />
              </span>
              <span className="flex-1 truncate">{state.label}</span>
              <a
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title="Abrir site"
                className="text-gray-300 hover:text-primary-600"
              >
                <IconExternal />
              </a>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Ícones ───────────────────────────────────────────────────────────────────

function IconStar({ filled }) {
  return filled
    ? (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    )
    : (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    )
}

function IconFolder() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}

function IconExternal() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v9c0 .414.336.75.75.75h9a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0113.25 17.5h-9A2.25 2.25 0 012 15.25v-9A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
      <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.81l-9.246 8.367a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
    </svg>
  )
}

function IconX() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}
