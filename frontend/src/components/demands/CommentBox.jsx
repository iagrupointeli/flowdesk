import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore }         from '../../stores/authStore'
import { useDemandDetailStore } from '../../stores/demandDetailStore'
import api from '../../lib/api'

/**
 * Caixa de comentários com suporte a @mentions.
 *
 * @mention flow:
 *   1. Usuário digita @  → popover abre com lista de usuários do departamento
 *   2. Usuário digita mais caracteres → lista filtra por nome
 *   3. Ao selecionar → injeta @[Nome Completo] no texto
 *   4. Backend (addComment) parseia @[...] e notifica via SSE
 *
 * Props:
 *   demandId     — UUID da demanda
 *   currentStage — { id, name }
 *   disabled     — true se a demanda está cancelada
 */
const SLASH_COMMANDS = [
  {
    id: 'bug',
    label: '/bug',
    desc: 'Template de reporte de bug',
    template: '[BUG]\n\nReprodução:\n1. \n\nComportamento esperado:\n\nComportamento atual:\n',
  },
  {
    id: 'solicitacao',
    label: '/solicitação',
    desc: 'Template de solicitação',
    template: '[SOLICITAÇÃO]\n\nNecessidade:\n\nJustificativa:\n\nUrgência:\n',
  },
  {
    id: 'urgente',
    label: '/urgente',
    desc: 'Marcar como urgente',
    template: '🚨 URGENTE: ',
  },
]

export default function CommentBox({ demandId, currentStage, disabled = false }) {
  const user        = useAuthStore(s => s.user)
  const textareaRef = useRef(null)
  const abortRef    = useRef(null)

  const [body,             setBody]             = useState('')
  const [isSubmitting,     setIsSubmitting]     = useState(false)
  const [error,            setError]            = useState(null)
  const [mentionableUsers, setMentionableUsers] = useState([])
  const [mentionQuery,     setMentionQuery]     = useState(null)
  const [atIndex,          setAtIndex]          = useState(-1)
  const [slashQuery,       setSlashQuery]       = useState(null)
  const [slashIndex,       setSlashIndex]       = useState(-1)
  const [draftSavedAt,     setDraftSavedAt]     = useState(null)
  const [isPasting,        setIsPasting]        = useState(false)

  const draftTimer = useRef(null)
  const DRAFT_KEY  = `comment_draft_${demandId}`

  const isEmpty = !body.trim()

  // Restaura rascunho do localStorage ao montar
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY)
    if (saved) { setBody(saved); setDraftSavedAt(true) }
  }, [DRAFT_KEY])

  // Carrega usuários mencionáveis uma vez ao montar
  useEffect(() => {
    if (disabled) return
    const ctrl = new AbortController()
    abortRef.current = ctrl

    api.get(`/demands/${demandId}/mentionable-users`, { signal: ctrl.signal })
      .then(res => setMentionableUsers(res.data))
      .catch(() => {})

    return () => ctrl.abort()
  }, [demandId, disabled])

  // Usuários filtrados para o popover
  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return []
    if (!mentionQuery) return mentionableUsers.slice(0, 8)
    return mentionableUsers
      .filter(u => u.name.toLowerCase().includes(mentionQuery))
      .slice(0, 8)
  }, [mentionableUsers, mentionQuery])

  // Comandos filtrados para o slash popover
  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return []
    if (!slashQuery) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(c => c.id.startsWith(slashQuery.toLowerCase()))
  }, [slashQuery])

  // ── Detecção de @mention e /slash na posição do cursor ────────────────────
  function handleChange(e) {
    const val    = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setBody(val)

    const before = val.slice(0, cursor)

    // @mention
    const atMatch = before.match(/@([^@\[\]\s]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase())
      setAtIndex(cursor - atMatch[0].length)
    } else {
      setMentionQuery(null)
      setAtIndex(-1)
    }

    // /slash command — ativo no início da string ou após espaço/quebra de linha
    const slashMatch = before.match(/(^|[\n ])\/([a-záàâãéêíóôõúüç]*)$/i)
    if (slashMatch) {
      setSlashQuery(slashMatch[2].toLowerCase())
      // slashIndex aponta para o '/' no val (ignora o separador antes)
      setSlashIndex(cursor - slashMatch[2].length - 1)
    } else {
      setSlashQuery(null)
      setSlashIndex(-1)
    }

    // Auto-save rascunho (debounce 800ms)
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      if (val.trim()) {
        localStorage.setItem(DRAFT_KEY, val)
        setDraftSavedAt(new Date())
      } else {
        localStorage.removeItem(DRAFT_KEY)
        setDraftSavedAt(null)
      }
    }, 800)
  }

  function selectSlashCommand(cmd) {
    const beforeSlash = body.slice(0, slashIndex)
    const afterQuery  = body.slice(slashIndex + 1 + slashQuery.length)
    setBody(beforeSlash + cmd.template + afterQuery)
    setSlashQuery(null)
    setSlashIndex(-1)
    textareaRef.current?.focus()
  }

  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items ?? [])
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (!imgItem) return

    e.preventDefault()
    const file = imgItem.getAsFile()
    if (!file) return

    setIsPasting(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post(`/demands/${demandId}/attachments`, form)
      // Força recarga dos anexos pelo próprio AttachmentBlock via evento customizado
      window.dispatchEvent(new CustomEvent('attachment:uploaded', { detail: { demandId } }))
    } catch { /* silent */ } finally {
      setIsPasting(false)
    }
  }

  function selectMention(user) {
    const before  = body.slice(0, atIndex)
    const after   = body.slice(atIndex + 1 + mentionQuery.length)
    setBody(`${before}@[${user.name}] ${after}`)
    setMentionQuery(null)
    setAtIndex(-1)
    textareaRef.current?.focus()
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    if (isEmpty || isSubmitting || disabled) return

    setIsSubmitting(true)
    setError(null)
    setMentionQuery(null)

    try {
      const { data } = await api.post(`/demands/${demandId}/comments`, { body: body.trim() })

      const newItem = {
        entered_at:      data.entered_at,
        source:          'feed',
        row_id:          String(data.id),
        sort_key:        String(data.id).padStart(20, '0'),
        event_type:      'comment_added',
        actor_id:        user?.id    ?? null,
        actor_name:      user?.name  ?? null,
        stage_id:        data.stage_id ?? currentStage?.id   ?? null,
        stage_name:      currentStage?.name ?? null,
        assignee_id:     data.assignee_id ?? null,
        exception_state: null,
        notes:           null,
        body:            data.body,
        file_name:       null,
        file_size:       null,
        attachment_id:   null,
      }

      useDemandDetailStore.getState().addCommentToTimeline(newItem)
      setBody('')
      localStorage.removeItem(DRAFT_KEY)
      setDraftSavedAt(null)
      clearTimeout(draftTimer.current)
      textareaRef.current?.focus()
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao enviar o comentário. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleKeyDown(e) {
    // Ctrl+Enter / Cmd+Enter: envia
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSubmit(e)
      return
    }
    // Escape: fecha popovers
    if (e.key === 'Escape') {
      if (mentionQuery !== null) { setMentionQuery(null); setAtIndex(-1) }
      if (slashQuery   !== null) { setSlashQuery(null);   setSlashIndex(-1) }
    }
    // Fecha popover mention se setas sem itens
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filteredMentions.length === 0) {
      setMentionQuery(null)
      setAtIndex(-1)
    }
  }

  return (
    <div className="pt-6 border-t border-gray-200">
      <div className="flex gap-3">
        <UserAvatar name={user?.name} />

        <form onSubmit={handleSubmit} className="relative flex-1 space-y-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled || isSubmitting || isPasting}
            rows={3}
            placeholder={
              disabled
                ? 'Demanda cancelada — comentários desabilitados.'
                : 'Adicionar comentário… (Ctrl+Enter · @ mencionar · / comandos · Ctrl+V imagem)'
            }
            className={[
              'block w-full resize-y rounded-lg border px-3 py-2 text-sm',
              'transition-colors focus:outline-none focus:ring-2',
              disabled
                ? 'cursor-not-allowed bg-gray-100 text-gray-400 border-gray-200'
                : 'bg-white border-gray-300 hover:border-gray-400',
              error
                ? 'border-red-400 focus:ring-red-400'
                : 'focus:ring-primary-500 focus:border-primary-400',
            ].join(' ')}
          />

          {/* Popover de @mentions */}
          {mentionQuery !== null && filteredMentions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto
                           rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
              {filteredMentions.map(u => (
                <li key={u.id}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectMention(u) }}
                    className="flex w-full items-center gap-2.5 px-3 py-2
                               text-left text-sm text-gray-700
                               hover:bg-primary-50 hover:text-primary-700"
                  >
                    <MiniAvatar name={u.name} />
                    <span>{u.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Popover de /slash commands */}
          {slashQuery !== null && filteredSlashCommands.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden
                           rounded-xl border border-gray-200 bg-white shadow-lg">
              {filteredSlashCommands.map(cmd => (
                <li key={cmd.id}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectSlashCommand(cmd) }}
                    className="flex w-full items-center gap-3 px-3 py-2.5
                               text-left transition-colors
                               hover:bg-primary-50"
                  >
                    <span className="min-w-[90px] text-sm font-mono font-medium text-primary-600">
                      {cmd.label}
                    </span>
                    <span className="text-xs text-gray-400">{cmd.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 select-none">
              {isPasting
                ? <span className="text-primary-500">Enviando imagem…</span>
                : draftSavedAt instanceof Date
                  ? <span className="text-gray-300">
                      Rascunho salvo às {draftSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  : draftSavedAt
                    ? <span className="text-gray-300">Rascunho restaurado</span>
                    : !disabled && 'Ctrl+Enter para enviar · @ para mencionar'
              }
            </p>
            <button
              type="submit"
              disabled={isEmpty || isSubmitting || disabled || isPasting}
              className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5
                         text-sm font-semibold text-white transition-colors
                         hover:bg-primary-700
                         disabled:cursor-not-allowed disabled:opacity-50
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
            >
              {isSubmitting
                ? <><Spinner /> Enviando…</>
                : 'Comentar'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name) {
  return (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

function UserAvatar({ name }) {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center
                    rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
      {initials(name)}
    </div>
  )
}

function MiniAvatar({ name }) {
  return (
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center
                    rounded-full bg-primary-100 text-[10px] font-semibold text-primary-700">
      {initials(name)}
    </div>
  )
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
