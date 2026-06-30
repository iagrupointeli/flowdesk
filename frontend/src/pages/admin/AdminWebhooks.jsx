/**
 * AdminWebhooks — Gerenciamento de webhooks de saída.
 *
 * Acessível por dept_admin e super_admin.
 *
 * ── Fluxo de criação ─────────────────────────────────────────────────────────
 *   1. Admin preenche URL + eventos + departamento (super_admin escolhe; dept_admin usa o seu).
 *   2. Backend retorna { id, ..., secret_key } — único momento em que a chave é exposta.
 *   3. SecretKeyModal exibe a chave com botão de cópia e aviso de "guarde agora".
 *   4. Listagem subsequente NÃO expõe secret_key — armazenado apenas no backend.
 *
 * ── Teste de conexão ─────────────────────────────────────────────────────────
 *   POST /admin/webhooks/:id/test → disparo síncrono com HMAC assinado.
 *   Resultado exibido inline na linha do webhook.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../../stores/authStore'
import api from '../../lib/api'

// ── Constantes ────────────────────────────────────────────────────────────────

const ALL_EVENTS = [
  {
    id:    'demand.created',
    label: 'Demanda criada',
    desc:  'Disparado ao criar uma nova demanda no sistema.',
  },
  {
    id:    'demand.stage_changed',
    label: 'Etapa alterada',
    desc:  'Disparado ao mover uma demanda para outra etapa no Kanban.',
  },
  {
    id:    'demand.blocked',
    label: 'Demanda bloqueada',
    desc:  'Disparado ao bloquear (pausar) uma demanda com exception_state = on_hold.',
  },
]

const EVENT_STYLES = {
  'demand.created':       'bg-emerald-100 text-emerald-700',
  'demand.stage_changed': 'bg-blue-100 text-blue-700',
  'demand.blocked':       'bg-amber-100 text-amber-700',
}
const EVENT_LABELS = {
  'demand.created':       'criada',
  'demand.stage_changed': 'etapa',
  'demand.blocked':       'bloqueada',
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function AdminWebhooks() {
  const user         = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'super_admin'

  const [webhooks,    setWebhooks]    = useState([])
  const [departments, setDepartments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(null)

  // Modal CRUD
  const [showModal,  setShowModal]  = useState(false)
  const [editingWh,  setEditingWh]  = useState(null)   // null = criação
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState(null)
  const [form,       setForm]       = useState({ department_id: '', url: '', events: [], is_active: true })

  // Modal exibição de secret (pós-criação, uma única vez)
  const [createdSecret, setCreatedSecret] = useState(null)
  const [secretCopied,  setSecretCopied]  = useState(false)

  // Teste de conexão por webhook id
  const [testResults, setTestResults] = useState({})   // { [id]: { success, status, message } }
  const [testingIds,  setTestingIds]  = useState(new Set())

  // ── Load inicial ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [whRes, deptRes] = await Promise.all([
        api.get('/admin/webhooks'),
        api.get('/admin/departments'),
      ])
      setWebhooks(whRes.data)
      setDepartments(deptRes.data)
    } catch (err) {
      setLoadError(err.response?.data?.error ?? 'Erro ao carregar webhooks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Ações modal ─────────────────────────────────────────────────────────────
  function openCreate() {
    setEditingWh(null)
    setForm({
      department_id: isSuperAdmin ? '' : (user?.deptIds?.[0] ?? ''),
      url:           '',
      events:        [],
      is_active:     true,
    })
    setSaveError(null)
    setShowModal(true)
  }

  function openEdit(wh) {
    setEditingWh(wh)
    setForm({ department_id: wh.department_id, url: wh.url, events: wh.events ?? [], is_active: wh.is_active })
    setSaveError(null)
    setShowModal(true)
  }

  function toggleEvent(eventId) {
    setForm(f => ({
      ...f,
      events: f.events.includes(eventId)
        ? f.events.filter(e => e !== eventId)
        : [...f.events, eventId],
    }))
  }

  async function handleSave() {
    if (!form.url.trim())    return setSaveError('URL é obrigatória.')
    if (form.events.length === 0) return setSaveError('Selecione pelo menos um evento.')
    if (!editingWh && !form.department_id) return setSaveError('Selecione um departamento.')

    setSaving(true)
    setSaveError(null)
    try {
      if (editingWh) {
        const res = await api.patch(`/admin/webhooks/${editingWh.id}`, {
          url:       form.url,
          events:    form.events,
          is_active: form.is_active,
        })
        setWebhooks(prev => prev.map(w => w.id === editingWh.id ? { ...w, ...res.data } : w))
        setShowModal(false)
      } else {
        // '__global__' → null (webhook global, sem departamento específico)
        const deptId = form.department_id === '__global__' ? null : form.department_id
        const res = await api.post('/admin/webhooks', {
          department_id: deptId,
          url:           form.url,
          events:        form.events,
        })
        // Insere no topo da lista (sem secret_key — não exposto na lista)
        const { secret_key, ...whWithoutSecret } = res.data
        setWebhooks(prev => [whWithoutSecret, ...prev])
        setShowModal(false)
        // Exibe o secret UMA VEZ
        setCreatedSecret(secret_key)
      }
    } catch (err) {
      setSaveError(err.response?.data?.error ?? 'Erro ao salvar webhook.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(wh) {
    if (!window.confirm(`Remover webhook para "${wh.url}"?\nEsta ação é irreversível.`)) return
    try {
      await api.delete(`/admin/webhooks/${wh.id}`)
      setWebhooks(prev => prev.filter(w => w.id !== wh.id))
    } catch (err) {
      alert(err.response?.data?.error ?? 'Erro ao remover webhook.')
    }
  }

  async function handleToggleActive(wh) {
    try {
      const res = await api.patch(`/admin/webhooks/${wh.id}`, { is_active: !wh.is_active })
      setWebhooks(prev => prev.map(w => w.id === wh.id ? { ...w, is_active: res.data.is_active } : w))
    } catch (err) {
      alert(err.response?.data?.error ?? 'Erro ao alterar status.')
    }
  }

  async function handleTest(wh) {
    setTestingIds(prev => new Set([...prev, wh.id]))
    try {
      const res = await api.post(`/admin/webhooks/${wh.id}/test`)
      setTestResults(prev => ({ ...prev, [wh.id]: res.data }))
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [wh.id]: { success: false, status: null, message: err.response?.data?.error ?? 'Erro ao testar.' },
      }))
    } finally {
      setTestingIds(prev => { const s = new Set(prev); s.delete(wh.id); return s })
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(createdSecret).then(() => {
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 2000)
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Notifique sistemas externos (Teams, Slack, ERPs, Zapier) em tempo real
            quando eventos críticos ocorrerem no Kanban.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary-600
                     px-4 py-2 text-sm font-semibold text-white shadow-sm
                     hover:bg-primary-700 focus:outline-none focus:ring-2
                     focus:ring-primary-500 focus:ring-offset-1"
        >
          <span aria-hidden>+</span>
          Novo Webhook
        </button>
      </div>

      {/* Erro de carregamento */}
      {loadError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* Skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && webhooks.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-20 text-center">
          <IconWebhook className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">Nenhum webhook configurado</p>
          <p className="mt-1 text-xs text-gray-400">
            Crie um webhook para integrar o FlowDesk com sistemas externos.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                       text-white hover:bg-primary-700"
          >
            Criar primeiro webhook
          </button>
        </div>
      )}

      {/* Lista de webhooks */}
      {!loading && webhooks.length > 0 && (
        <div className="space-y-3">
          {webhooks.map(wh => (
            <WebhookCard
              key={wh.id}
              webhook={wh}
              testResult={testResults[wh.id]}
              isTesting={testingIds.has(wh.id)}
              onEdit={() => openEdit(wh)}
              onDelete={() => handleDelete(wh)}
              onTest={() => handleTest(wh)}
              onToggleActive={() => handleToggleActive(wh)}
            />
          ))}
        </div>
      )}

      {/* Modal criar/editar */}
      {showModal && (
        <WebhookModal
          editing={editingWh}
          form={form}
          setForm={setForm}
          departments={departments}
          isSuperAdmin={isSuperAdmin}
          saving={saving}
          error={saveError}
          onToggleEvent={toggleEvent}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Modal exibição de secret (pós-criação, uma única vez) */}
      {createdSecret && (
        <SecretKeyModal
          secret={createdSecret}
          copied={secretCopied}
          onCopy={copySecret}
          onClose={() => { setCreatedSecret(null); setSecretCopied(false) }}
        />
      )}
    </div>
  )
}

// ── WebhookCard ───────────────────────────────────────────────────────────────

function WebhookCard({ webhook, testResult, isTesting, onEdit, onDelete, onTest, onToggleActive }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm transition-opacity ${
      webhook.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Informações */}
        <div className="min-w-0 flex-1">
          {/* Tags: departamento + eventos */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${
              webhook.department_id == null
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {webhook.department_name ?? 'Global'}
            </span>
            {(webhook.events ?? []).map(ev => (
              <span
                key={ev}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  EVENT_STYLES[ev] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {EVENT_LABELS[ev] ?? ev}
              </span>
            ))}
            {!webhook.is_active && (
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-500">
                Inativo
              </span>
            )}
          </div>

          {/* URL */}
          <p
            className="mt-1.5 truncate text-sm font-medium text-gray-800"
            title={webhook.url}
          >
            {webhook.url}
          </p>

          {/* Resultado do teste (inline) */}
          {testResult && (
            <p className={`mt-1 text-xs font-medium ${
              testResult.success ? 'text-green-600' : 'text-red-600'
            }`}>
              {testResult.success ? '✓' : '✗'} {testResult.message}
              {testResult.status != null && ` (HTTP ${testResult.status})`}
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* Toggle ativo/inativo */}
          <button
            type="button"
            onClick={onToggleActive}
            title={webhook.is_active ? 'Desativar webhook' : 'Ativar webhook'}
            className={`relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2
                        border-transparent transition-colors focus:outline-none focus:ring-2
                        focus:ring-primary-500 focus:ring-offset-1 ${
              webhook.is_active ? 'bg-primary-600' : 'bg-gray-300'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow
                              transition-transform ${webhook.is_active ? 'translate-x-4' : 'translate-x-0'}`}
            />
          </button>

          <button
            type="button"
            onClick={onTest}
            disabled={isTesting}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs
                       font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed
                       disabled:opacity-50"
          >
            {isTesting ? 'Testando…' : 'Testar'}
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs
                       font-medium text-gray-700 hover:bg-gray-50"
          >
            Editar
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs
                       font-medium text-red-600 hover:bg-red-50"
          >
            Remover
          </button>
        </div>
      </div>
    </div>
  )
}

// ── WebhookModal ──────────────────────────────────────────────────────────────

function WebhookModal({ editing, form, setForm, departments, isSuperAdmin, saving, error, onToggleEvent, onSave, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {editing ? 'Editar Webhook' : 'Novo Webhook'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <IconX />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto px-6 py-5" style={{ maxHeight: '70vh' }}>

          {/* Departamento (criação; super_admin seleciona; dept_admin usa o seu) */}
          {!editing && isSuperAdmin && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Departamento <span className="text-red-500">*</span>
              </label>
              <select
                value={form.department_id}
                onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-primary-500 focus:outline-none focus:ring-1
                           focus:ring-primary-500"
              >
                <option value="">Selecione um departamento…</option>
                <option value="__global__">— Todos os Departamentos (Global)</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* URL */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              URL de destino <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              placeholder="https://hooks.example.com/flowdesk"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1
                         focus:ring-primary-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              Deve responder HTTP 2xx em até 5 segundos.
            </p>
          </div>

          {/* Eventos */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Eventos <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {ALL_EVENTS.map(ev => (
                <label
                  key={ev.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border
                             border-gray-200 p-3 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev.id)}
                    onChange={() => onToggleEvent(ev.id)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600
                               focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{ev.label}</p>
                    <p className="text-xs text-gray-500">{ev.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Toggle ativo/inativo — somente edição */}
          {editing && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">Webhook ativo</span>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                className={`relative inline-flex h-5 w-9 rounded-full border-2 border-transparent
                            transition-colors ${form.is_active ? 'bg-primary-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow
                                  transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </button>
            </div>
          )}

          {/* Erro */}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium
                       text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : (editing ? 'Salvar alterações' : 'Criar Webhook')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SecretKeyModal ────────────────────────────────────────────────────────────

function SecretKeyModal({ secret, copied, onCopy, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">

        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Chave Secreta do Webhook</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <IconX />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Aviso único */}
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">⚠ Copie agora — não será exibida novamente</p>
            <p className="mt-0.5 text-xs text-amber-700">
              A chave secreta é gerada uma única vez e não pode ser recuperada depois.
              Guarde-a em um gerenciador de senhas ou variável de ambiente.
            </p>
          </div>

          <label className="mb-1 block text-sm font-medium text-gray-700">
            <code className="rounded bg-gray-100 px-1 text-xs">secret_key</code>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={secret}
              className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2
                         font-mono text-xs text-gray-800 focus:outline-none select-all"
              onClick={e => e.target.select()}
            />
            <button
              type="button"
              onClick={onCopy}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                copied
                  ? 'border-green-300 bg-green-50 text-green-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Use esta chave para verificar a assinatura no header{' '}
            <code className="rounded bg-gray-100 px-1">x-signature-256</code> de cada requisição
            recebida. O valor é <code className="rounded bg-gray-100 px-1">sha256=&lt;hmac-hex&gt;</code>.
          </p>
        </div>

        <div className="border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold
                       text-white hover:bg-primary-700"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ícones ────────────────────────────────────────────────────────────────────

function IconWebhook({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
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
