import { useState } from 'react'
import { useDemandDetailStore } from '../../stores/demandDetailStore'
import CommentBox               from './CommentBox'
import api                      from '../../lib/api'

/**
 * Timeline da demanda + caixa de comentários.
 *
 * ── Paginação keyset ─────────────────────────────────────────────────────────
 *   - Primeira página carregada por fetchTimeline() no DemandDetail.jsx
 *   - "Carregar mais" chama fetchMoreTimeline(demandId) da store
 *     → acumula items no estado (não substitui), envia nextCursor como param
 *     → AbortController na store cancela fetches duplicados
 *
 * ── Ordem de exibição (DESC — newest first) ─────────────────────────────────
 *   A store mantém timelineItems em DESC: índice 0 = evento mais recente.
 *   "Carregar mais" usa paginação forward (itens mais recentes) → exibido no TOPO.
 *   Novos comentários injetados por CommentBox aparecem imediatamente no topo.
 *
 * ── Download de anexos ───────────────────────────────────────────────────────
 *   GET /api/demands/attachments/:id/download → { url } → window.open()
 *   É user-triggered (não fetch background), portanto chamada direta via api.
 *
 * Props:
 *   demandId      — UUID da demanda
 *   currentStage  — { id, name } passado ao CommentBox para enriquecer item injetado
 *   isCancelled   — desabilita caixa de comentários se true
 */
export default function Timeline({ demandId, currentStage, isCancelled }) {
  const items           = useDemandDetailStore(s => s.timelineItems)
  const hasMore         = useDemandDetailStore(s => s.hasMore)
  const isLoadingTimeline = useDemandDetailStore(s => s.isLoadingTimeline)
  const isLoadingMore   = useDemandDetailStore(s => s.isLoadingMore)
  const errorTimeline   = useDemandDetailStore(s => s.errorTimeline)

  return (
    <section aria-label="Atividade da demanda">
      <h2 className="mb-4 text-base font-semibold text-gray-900">Atividade</h2>

      {/* ── Caixa de comentários (topo — novo comentário vai ao índice 0 DESC) ── */}
      <CommentBox
        demandId={demandId}
        currentStage={currentStage}
        disabled={isCancelled}
      />

      {/* ── Estado de carregamento inicial ──────────────────────────────── */}
      {isLoadingTimeline && <TimelineSkeleton />}

      {/* ── Erro de timeline ────────────────────────────────────────────── */}
      {!isLoadingTimeline && errorTimeline && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorTimeline}
          <button
            onClick={() => useDemandDetailStore.getState().fetchTimeline(demandId)}
            className="ml-2 underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Lista de eventos (DESC: índice 0 = mais recente no topo) ─────── */}
      {!isLoadingTimeline && items.length > 0 && (
        <ol className="relative mt-4 space-y-0" aria-label="Eventos da timeline">
          {items.map((item, idx) => (
            <TimelineItem
              key={`${item.source}-${item.row_id}`}
              item={item}
              isLast={idx === items.length - 1 && !hasMore}
            />
          ))}
        </ol>
      )}

      {/* ── Carregar atividade mais antiga (bottom — paginação DESC = mais antigos) ── */}
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => useDemandDetailStore.getState().fetchMoreTimeline(demandId)}
            disabled={isLoadingMore}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                       text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingMore ? 'Carregando…' : 'Carregar atividade mais antiga'}
          </button>
        </div>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TimelineItem — renderiza um único evento por tipo
// ─────────────────────────────────────────────────────────────────────────────

function TimelineItem({ item, isLast }) {
  return (
    <li className="relative flex gap-3 pb-6">
      {/* Linha vertical conectando os eventos */}
      {!isLast && (
        <div
          aria-hidden="true"
          className="absolute left-3.5 top-7 -bottom-1 w-px bg-gray-200"
        />
      )}

      {/* Ícone do evento */}
      <EventIcon item={item} />

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 pt-0.5">
        <EventContent item={item} />
        <time
          dateTime={item.entered_at}
          className="mt-1 block text-xs text-gray-400"
          title={new Date(item.entered_at).toLocaleString('pt-BR')}
        >
          {formatRelativeTime(item.entered_at)}
        </time>
      </div>
    </li>
  )
}

// ── Ícone por tipo de evento ──────────────────────────────────────────────────

function EventIcon({ item }) {
  const base = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-white'

  const configs = {
    created:           { bg: 'bg-green-100',  color: 'text-green-600',  Icon: IconPlus },
    stage_changed:     { bg: 'bg-blue-100',   color: 'text-blue-600',   Icon: IconArrow },
    exception_changed: { bg: 'bg-amber-100',  color: 'text-amber-600',  Icon: IconAlert },
    comment_added:     { bg: 'bg-gray-100',   color: 'text-gray-500',   Icon: IconChat },
    attachment_added:  { bg: 'bg-purple-100', color: 'text-purple-600', Icon: IconPaperclip },
  }

  const { bg, color, Icon } = configs[item.event_type] ?? configs.comment_added

  return (
    <div className={`${base} ${bg}`}>
      <Icon className={`h-3.5 w-3.5 ${color}`} />
    </div>
  )
}

// ── Conteúdo por tipo de evento ───────────────────────────────────────────────

function EventContent({ item }) {
  switch (item.event_type) {
    case 'created':
      return (
        <p className="text-sm text-gray-700">
          <ActorName name={item.actor_name} /> abriu esta demanda
          {item.stage_name && <> na etapa <strong className="font-medium">{item.stage_name}</strong></>}.
        </p>
      )

    case 'stage_changed':
      return (
        <div>
          <p className="text-sm text-gray-700">
            <ActorName name={item.actor_name} /> moveu para{' '}
            <strong className="font-medium">{item.stage_name ?? '—'}</strong>.
          </p>
          {item.notes && (
            <blockquote className="mt-1.5 rounded-md border-l-2 border-blue-300 bg-blue-50 px-3 py-1.5 text-sm text-gray-700 italic">
              {item.notes}
            </blockquote>
          )}
        </div>
      )

    case 'exception_changed':
      return (
        <div>
          <p className="text-sm text-gray-700">
            <ActorName name={item.actor_name} />{' '}
            {exceptionLabel(item.exception_state)}.
          </p>
          {item.notes && (
            <blockquote className="mt-1.5 rounded-md border-l-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-gray-700 italic">
              {item.notes}
            </blockquote>
          )}
        </div>
      )

    case 'comment_added':
      return (
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">
            <ActorName name={item.actor_name} />
          </p>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap shadow-sm">
            {item.body}
          </div>
        </div>
      )

    case 'attachment_added':
      return (
        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-700">
            <ActorName name={item.actor_name} /> adicionou um anexo:
          </p>
          <AttachmentChip
            attachmentId={item.attachment_id}
            fileName={item.file_name}
            fileSize={item.file_size}
          />
        </div>
      )

    default:
      return <p className="text-sm text-gray-500">{item.event_type}</p>
  }
}

// ── Componente de chip de anexo com download ──────────────────────────────────

function AttachmentChip({ attachmentId, fileName, fileSize }) {
  const [isLoading, setIsLoading] = useState(false)

  async function handleDownload() {
    if (isLoading) return
    setIsLoading(true)
    // CORREÇÃO POPUP BLOCKER:
    // window.open() após await é bloqueado pelo browser (não é user-gesture direto).
    // Abrimos uma aba vazia SINCRONICAMENTE no clique, depois navegamos ela para a URL.
    // Se o request falhar, fechamos a aba para não deixar aba em branco aberta.
    const tab = window.open('', '_blank')
    try {
      const { data } = await api.get(`/demands/attachments/${attachmentId}/download`)
      if (tab) tab.location.href = data.url
    } catch (err) {
      tab?.close()
      console.error('[Timeline] falha ao gerar URL de download:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={isLoading}
      className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50
                 px-2.5 py-1 text-xs text-gray-600 transition-colors
                 hover:bg-gray-100 hover:text-primary-700
                 disabled:opacity-60 disabled:cursor-wait"
    >
      <IconPaperclip className="h-3 w-3 flex-shrink-0" />
      <span className="max-w-[180px] truncate">{fileName}</span>
      {fileSize != null && <span className="text-gray-400">({formatBytes(fileSize)})</span>}
      {isLoading && <Spinner />}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex gap-3">
          <div className="h-7 w-7 flex-shrink-0 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-1.5 pt-1">
            <div className="h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ActorName({ name }) {
  return <strong className="font-semibold text-gray-900">{name ?? 'Usuário'}</strong>
}

function exceptionLabel(state) {
  if (!state) return 'retomou a demanda'
  if (state === 'on_hold') return 'colocou a demanda em espera'
  if (state === 'cancelled') return 'cancelou a demanda'
  return `alterou o estado para "${state}"`
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

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
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Spinner() {
  return (
    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ── Ícones SVG ────────────────────────────────────────────────────────────────

function IconPlus({ className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" /></svg>
}

function IconArrow({ className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" /></svg>
}

function IconAlert({ className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
}

function IconChat({ className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 001.28.53l3.58-3.58A28.3 28.3 0 0010 14c2.236 0 4.43-.18 6.57-.524 1.437-.231 2.43-1.49 2.43-2.902V5.426c0-1.413-.993-2.67-2.43-2.902A41.202 41.202 0 0010 2z" clipRule="evenodd" /></svg>
}

function IconPaperclip({ className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a1.5 1.5 0 002.122 2.121l6.5-6.5a.75.75 0 111.061 1.061l-6.5 6.5A3 3 0 015.44 14.44l7-7a4.5 4.5 0 016.364 6.364l-6 6a6 6 0 01-8.485-8.485l5.5-5.5a.75.75 0 111.061 1.06l-5.5 5.5a4.5 4.5 0 006.363 6.363l6-6a3 3 0 000-4.242z" clipRule="evenodd" /></svg>
}
