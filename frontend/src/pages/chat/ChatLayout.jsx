import { useEffect, useRef, useState } from 'react'
import { useChatStore }     from '../../stores/chatStore'
import { useAuthStore }     from '../../stores/authStore'
import NewChatModal         from '../../components/chat/NewChatModal'
import FilePreviewModal     from '../../components/shared/FilePreviewModal'
import api                  from '../../lib/api'

export default function ChatLayout() {
  const initSocket       = useChatStore(s => s.initSocket)
  const fetchChannels    = useChatStore(s => s.fetchChannels)
  const channels         = useChatStore(s => s.channels)
  const activeChannelId  = useChatStore(s => s.activeChannelId)
  const setActiveChannel = useChatStore(s => s.setActiveChannel)
  const disconnectSocket = useChatStore(s => s.disconnectSocket)
  const [showNewChat, setShowNewChat] = useState(false)

  useEffect(() => {
    initSocket()
    fetchChannels()
    return () => disconnectSocket()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function handleChannelCreated(channel) {
    // Recarrega lista e abre o novo canal
    fetchChannels().then(() => setActiveChannel(channel.id))
    setShowNewChat(false)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Painel esquerdo: lista de canais ─────────────────────────────── */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Mensagens</h2>
          <button
            onClick={() => setShowNewChat(true)}
            title="Nova conversa"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <IconPencilPlus />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {channels.length === 0 && (
            <p className="px-4 py-3 text-xs text-gray-400">Nenhuma conversa ainda.</p>
          )}
          {channels.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveChannel(c.id)}
              className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-gray-50
                ${activeChannelId === c.id ? 'bg-primary-50' : ''}`}
            >
              {/* Avatar inicial */}
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center
                               rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                {((c.type === 'dm' ? c.peer_name : c.name) ?? '?')[0].toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium text-gray-800">
                    {c.type === 'dm' ? (c.peer_name ?? 'Conversa') : (c.name ?? 'Conversa')}
                  </span>
                  {(c.unread_count ?? 0) > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-primary-600 px-1.5 py-0.5
                                     text-[10px] font-semibold text-white">
                      {c.unread_count}
                    </span>
                  )}
                </div>
                {c.last_msg_body && (
                  <p className="truncate text-xs text-gray-400">
                    {c.last_msg_sender ? `${c.last_msg_sender}: ` : ''}{c.last_msg_body}
                  </p>
                )}
              </div>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Painel direito: mensagens ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
        {activeChannelId
          ? <ChatPanel channelId={activeChannelId} />
          : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-gray-400">Selecione uma conversa.</p>
            </div>
          )
        }
      </div>

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onCreated={handleChannelCreated}
        />
      )}
    </div>
  )
}

// ── ChatPanel ────────────────────────────────────────────────────────────────

function ChatPanel({ channelId }) {
  const myId          = useAuthStore(s => s.user?.id)
  const messages      = useChatStore(s => s.messagesByChannel[channelId] ?? [])
  const typingUsers   = useChatStore(s => s.typingByChannel[channelId] ?? {})
  const sendMessage   = useChatStore(s => s.sendMessage)
  const sendTyping    = useChatStore(s => s.sendTyping)
  const fetchMessages = useChatStore(s => s.fetchMessages)
  const deleteMessage = useChatStore(s => s.deleteMessage)

  const [body,        setBody]        = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const bottomRef   = useRef(null)
  const typingTimer = useRef(null)
  const fileInputRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  function handleSend(e) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    sendMessage({ channelId, body: text })
    setBody('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { handleSend(e); return }
    if (!typingTimer.current) {
      sendTyping(channelId)
      typingTimer.current = setTimeout(() => { typingTimer.current = null }, 2000)
    }
  }

  async function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items ?? [])
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (!imgItem) return
    e.preventDefault()
    const file = imgItem.getAsFile()
    if (!file) return
    await uploadFile(channelId, file)
  }

  async function uploadFile(channelId, file) {
    setIsUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const params = body.trim() ? `?body=${encodeURIComponent(body.trim())}` : ''
      const { data: message } = await api.post(`/chat/${channelId}/messages/attachments${params}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (body.trim()) setBody('')
      const { messagesByChannel } = useChatStore.getState()
      const prev = messagesByChannel[channelId] ?? []
      if (!prev.some(m => m.id === message.id)) {
        useChatStore.setState(s => ({
          messagesByChannel: { ...s.messagesByChannel, [channelId]: [...(s.messagesByChannel[channelId] ?? []), message] },
        }))
      }
    } catch (err) {
      setUploadError(err?.response?.data?.error ?? 'Erro ao enviar arquivo.')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    await uploadFile(channelId, file)
  }

  const typingNames = Object.values(typingUsers)
    .filter(t => t)
    .map(t => t.userName ?? 'Alguém')

  return (
    <>
      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.map(msg => {
          const isMe = String(msg.sender_id) === String(myId)
          return (
            <div key={msg.id} className={`group flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`relative max-w-[70%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm
                ${isMe
                  ? 'rounded-br-sm bg-primary-600 text-white'
                  : 'rounded-bl-sm bg-white text-gray-800 border border-gray-200'}`}
              >
                {isMe && (
                  <button
                    onClick={() => deleteMessage(channelId, msg.id)}
                    title="Apagar"
                    className="absolute -top-1.5 -left-1.5 hidden group-hover:flex h-4 w-4
                               items-center justify-center rounded-full bg-gray-200
                               text-gray-500 hover:bg-red-100 hover:text-red-500"
                  >
                    <IconX />
                  </button>
                )}
                {!isMe && (
                  <p className="mb-0.5 text-[11px] font-semibold text-primary-600">
                    {msg.sender_name}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                {/* Anexos */}
                {(msg.attachments ?? []).map(att => (
                  <AttachmentChip key={att.id} attachment={att} />
                ))}
                <p className={`mt-1 text-[10px] ${isMe ? 'text-primary-200' : 'text-gray-400'}`}>
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Indicador de digitação */}
      {typingNames.length > 0 && (
        <div className="px-4 pb-1 text-xs text-gray-400 italic">
          {typingNames.join(', ')} {typingNames.length === 1 ? 'está digitando…' : 'estão digitando…'}
        </div>
      )}

      {/* Erro de upload */}
      {uploadError && (
        <div className="mx-4 mb-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5
                        text-xs text-red-700">
          {uploadError}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-end gap-2 border-t border-gray-200 bg-white px-4 py-3"
      >
        {/* Botão anexo */}
        <button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          title="Anexar arquivo"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full
                     text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isUploading
            ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            : <IconPaperclip className="h-4 w-4" />
          }
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />

        <textarea
          rows={1}
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Mensagem… (Ctrl+V para colar imagem)"
          className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm
                     leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-1
                     focus:ring-primary-500 max-h-32 overflow-y-auto"
        />
        <button
          type="submit"
          disabled={!body.trim() || isUploading}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full
                     bg-primary-600 text-white transition-colors hover:bg-primary-700
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconSend />
        </button>
      </form>
    </>
  )
}

// ── AttachmentChip ────────────────────────────────────────────────────────────

function AttachmentChip({ attachment }) {
  const [preview, setPreview] = useState(null)

  async function handleClick() {
    const { data } = await api.get(`/chat/attachments/${attachment.id}/url`)
    setPreview({ url: data.url, fileName: attachment.file_name })
  }

  return (
    <>
      {preview && (
        <FilePreviewModal
          url={preview.url}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
          onDownload={() => {
            const a = document.createElement('a')
            a.href = preview.url
            a.download = preview.fileName
            a.click()
          }}
        />
      )}
      <button
        onClick={handleClick}
        className="mt-1 flex items-center gap-1.5 rounded-lg border border-white/30
                   bg-black/10 px-2 py-1 text-xs hover:bg-black/20"
      >
        <IconPaperclip className="h-3 w-3 flex-shrink-0" />
        <span className="truncate max-w-[140px]">{attachment.file_name}</span>
      </button>
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function IconSend() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
    </svg>
  )
}

function IconPaperclip({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a1.5 1.5 0 002.122 2.121L14 5.879a.75.75 0 011.121 1l-7.5 7.5a3 3 0 01-4.243-4.242l7-7a4.5 4.5 0 016.364 6.364l-7 7a6 6 0 01-8.486-8.486l9.5-9.5a.75.75 0 011.06 1.061l-9.5 9.5a4.5 4.5 0 006.364 6.364l7-7a3 3 0 000-4.243z" clipRule="evenodd" />
    </svg>
  )
}

function IconX() {
  return (
    <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}

function IconPencilPlus() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343zM15 2a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0V6h-1a1 1 0 110-2h1V3a1 1 0 011-1z" />
    </svg>
  )
}
