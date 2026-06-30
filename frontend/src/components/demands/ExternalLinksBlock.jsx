import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../lib/api'

/**
 * ExternalLinksBlock — links do portal do prestador externo.
 *
 * Gera links tokenizados que dão a prestadores (sem conta) acesso restrito
 * a esta demanda: ver o essencial, subir fotos de checking e registrar
 * conclusão. O token completo só aparece UMA vez, na criação — copie na hora.
 */
export default function ExternalLinksBlock({ demandId, isFrozen = false }) {
  const [links,     setLinks]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [creating,  setCreating]  = useState(false)
  const [newLink,   setNewLink]   = useState(null)   // { url } — exibido uma vez
  const [label,     setLabel]     = useState('')
  const [days,      setDays]      = useState(15)
  const [copied,    setCopied]    = useState(false)
  const [showForm,  setShowForm]  = useState(false)

  const abortRef = useRef(null)

  const load = useCallback(async () => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await api.get(`/demands/${demandId}/external-links`, { signal: ctrl.signal })
      setLinks(res.data)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [demandId])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load])

  async function handleCreate(e) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const { data } = await api.post(`/demands/${demandId}/external-links`, {
        label: label.trim() || null,
        expires_in_days: Number(days),
      })
      const url = `${window.location.origin}/external/${data.token}`
      setNewLink({ url })
      setLabel('')
      setShowForm(false)
      load()
    } catch { /* silent */ } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(linkId) {
    const prev = links
    setLinks(ls => ls.map(l => l.id === linkId ? { ...l, is_active: false, revoked_at: new Date().toISOString() } : l))
    try {
      await api.delete(`/demands/${demandId}/external-links/${linkId}`)
    } catch {
      setLinks(prev)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(newLink.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const activeLinks = links.filter(l => l.is_active)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Prestador externo
        </h2>
        {!isFrozen && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs font-medium text-primary-600 hover:text-primary-800"
          >
            + Gerar link
          </button>
        )}
      </div>

      {/* Link recém-criado — única chance de copiar */}
      {newLink && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1.5 text-xs font-medium text-amber-800">
            ⚠ Copie agora — este link não será exibido novamente:
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={newLink.url}
              className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-1
                         font-mono text-[10px] text-gray-700"
              onFocus={e => e.target.select()}
            />
            <button
              onClick={handleCopy}
              className="flex-shrink-0 rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold
                         text-white hover:bg-amber-700"
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <button
            onClick={() => setNewLink(null)}
            className="mt-1.5 text-[10px] text-amber-600 underline"
          >
            já copiei, fechar
          </button>
        </div>
      )}

      {/* Form de criação */}
      {showForm && (
        <form onSubmit={handleCreate} className="mb-3 space-y-2 rounded-lg bg-gray-50 p-3">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Identificação (ex.: João — Instalador)"
            maxLength={200}
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs
                       focus:border-primary-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={e => setDays(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs"
            >
              <option value={7}>Válido por 7 dias</option>
              <option value={15}>Válido por 15 dias</option>
              <option value={30}>Válido por 30 dias</option>
            </select>
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white
                         hover:bg-primary-700 disabled:opacity-50"
            >
              {creating ? 'Gerando…' : 'Gerar'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              cancelar
            </button>
          </div>
        </form>
      )}

      {/* Lista */}
      {loading ? (
        <div className="h-8 animate-pulse rounded bg-gray-100" />
      ) : links.length === 0 ? (
        <p className="text-xs text-gray-400">
          Nenhum link gerado. Crie um link para o instalador enviar fotos direto do campo.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {links.map(l => (
            <li key={l.id} className="flex items-center gap-2 text-xs">
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full
                ${l.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="min-w-0 flex-1 truncate text-gray-600">
                {l.label ?? 'Sem identificação'}
                <span className="text-gray-400">
                  {' '}· expira {new Date(l.expires_at).toLocaleDateString('pt-BR')}
                  {l.last_used_at && ` · usado ${new Date(l.last_used_at).toLocaleDateString('pt-BR')}`}
                </span>
              </span>
              {l.is_active ? (
                <button
                  onClick={() => handleRevoke(l.id)}
                  className="flex-shrink-0 text-gray-400 hover:text-red-600 hover:underline"
                >
                  Revogar
                </button>
              ) : (
                <span className="flex-shrink-0 text-gray-300">
                  {l.revoked_at ? 'revogado' : 'expirado'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {activeLinks.length > 0 && (
        <p className="mt-2 text-[10px] text-gray-400">
          O link completo só é exibido na criação. Para um novo acesso, gere outro link.
        </p>
      )}
    </div>
  )
}
