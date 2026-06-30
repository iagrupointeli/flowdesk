import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../lib/api'
import UserSelect from '../../components/kanban/UserSelect'

/**
 * Painel de demandas recorrentes — /admin/recurring
 *
 * Templates que materializam demandas automaticamente em ciclo fixo
 * (checking mensal, manutenção preventiva, renovação de cessão).
 *
 * O job no backend roda a cada RECURRING_CHECK_INTERVAL_MS (10 min padrão)
 * e cria a demanda quando next_run_at vence. O ciclo avança em múltiplos
 * de interval_days preservando o dia âncora.
 *
 * Payload: tipos com campos obrigatórios exigem JSON válido no campo
 * avançado — o backend valida na criação do template (422 + fieldErrors).
 */

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function intervalLabel(days) {
  if (days === 1)   return 'Diária'
  if (days === 7)   return 'Semanal'
  if (days === 15)  return 'Quinzenal'
  if (days === 30)  return 'Mensal'
  if (days === 90)  return 'Trimestral'
  if (days === 365) return 'Anual'
  return `A cada ${days} dias`
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminRecurring() {
  const [templates, setTemplates] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState(null)
  const [showModal, setShowModal] = useState(false)

  const abortRef = useRef(null)

  const fetchTemplates = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    try {
      const { data } = await api.get('/admin/recurring', { signal: ctrl.signal })
      setTemplates(data)
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return
      setError('Falha ao carregar templates recorrentes.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
    return () => abortRef.current?.abort()
  }, [fetchTemplates])

  // Arquivar — otimista com revert
  async function handleArchive(id) {
    const prev = templates
    setTemplates(t => t.filter(x => x.id !== id))
    try {
      await api.delete(`/admin/recurring/${id}`)
    } catch {
      setTemplates(prev)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Demandas Recorrentes</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Templates que criam demandas automaticamente em ciclo fixo
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                     transition-colors hover:bg-primary-700"
        >
          + Novo template
        </button>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <p className="text-gray-500">Nenhum template recorrente configurado.</p>
            <p className="mt-1 text-sm text-gray-400">
              Crie um template para automatizar checking mensal, manutenções e renovações.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Título', 'Tipo / Departamento', 'Frequência', 'Próxima execução', 'Última execução', 'Responsável', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {templates.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[220px]">
                      <span className="line-clamp-2">{t.title}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {t.demand_type_name}
                      <span className="block text-xs text-gray-400">{t.department_name}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                        {intervalLabel(t.interval_days)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      {formatDateTime(t.next_run_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {formatDateTime(t.last_run_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {t.assignee_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleArchive(t.id)}
                        title="Arquivar template"
                        className="text-xs text-gray-400 hover:text-red-600 hover:underline"
                      >
                        Arquivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <NewTemplateModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchTemplates() }}
        />
      )}
    </div>
  )
}

// ── Modal de criação ─────────────────────────────────────────────────────────

function NewTemplateModal({ onClose, onCreated }) {
  const [demandTypes, setDemandTypes] = useState([])
  const [form, setForm] = useState({
    demand_type_id: '',
    title:          '',
    description:    '',
    interval_days:  30,
    next_run_at:    '',
    payloadText:    '',
  })
  const [assignee,    setAssignee]    = useState(null)
  const [showPayload, setShowPayload] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [isSaving,    setIsSaving]    = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    api.get('/admin/demand-types', { signal: ctrl.signal })
      .then(res => {
        const types = Array.isArray(res.data) ? res.data : (res.data.items ?? [])
        setDemandTypes(types.filter(t => !t.archived_at))
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  const selectedType = demandTypes.find(t => t.id === form.demand_type_id)

  function set(key) {
    return e => setForm(f => ({ ...f, [key]: e.target?.value ?? e }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)

    let payload = {}
    if (form.payloadText.trim()) {
      try {
        payload = JSON.parse(form.payloadText)
      } catch {
        setSubmitError('Payload JSON inválido — verifique a sintaxe.')
        return
      }
    }

    setIsSaving(true)
    try {
      await api.post('/admin/recurring', {
        demand_type_id: form.demand_type_id,
        title:          form.title,
        description:    form.description,
        interval_days:  Number(form.interval_days),
        next_run_at:    new Date(form.next_run_at).toISOString(),
        assignee_id:    assignee?.id ?? null,
        payload,
      })
      onCreated()
    } catch (err) {
      const data = err.response?.data
      if (data?.fieldErrors) {
        setSubmitError('Este tipo possui campos obrigatórios — preencha o payload JSON (campo avançado).')
        setShowPayload(true)
      } else {
        setSubmitError(data?.error ?? data?.errors?.formErrors?.[0] ?? 'Falha ao criar template.')
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
         onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
           onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">Novo template recorrente</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Tipo */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Tipo de demanda *</label>
            <select
              required
              value={form.demand_type_id}
              onChange={set('demand_type_id')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
            >
              <option value="">Selecione…</option>
              {demandTypes.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.department_name ? `(${t.department_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Título */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Título da demanda *</label>
            <input
              type="text" required minLength={3} maxLength={500}
              value={form.title} onChange={set('title')}
              placeholder="Ex.: Checking mensal — Painel Av. Paulista"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Descrição *</label>
            <textarea
              required rows={3}
              value={form.description} onChange={set('description')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
            />
          </div>

          {/* Frequência + primeira execução */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Frequência *</label>
              <select
                value={form.interval_days} onChange={set('interval_days')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
              >
                <option value={1}>Diária</option>
                <option value={7}>Semanal</option>
                <option value={15}>Quinzenal</option>
                <option value={30}>Mensal</option>
                <option value={90}>Trimestral</option>
                <option value={365}>Anual</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Primeira execução *</label>
              <input
                type="datetime-local" required
                value={form.next_run_at} onChange={set('next_run_at')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
            </div>
          </div>

          {/* Responsável */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Responsável automático <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <UserSelect
              departmentId={selectedType?.department_id ?? null}
              value={assignee}
              onChange={setAssignee}
              placeholder="Buscar usuário…"
            />
          </div>

          {/* Payload avançado */}
          <div>
            <button
              type="button"
              onClick={() => setShowPayload(s => !s)}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              {showPayload ? 'Ocultar' : 'Avançado:'} payload JSON dos campos dinâmicos
            </button>
            {showPayload && (
              <textarea
                rows={4}
                value={form.payloadText}
                onChange={set('payloadText')}
                placeholder='{"<field_id>": "valor"}'
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs
                           focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
            )}
          </div>

          {submitError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
          )}

          {/* Ações */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button" onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600
                         hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={isSaving}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white
                         hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Salvando…' : 'Criar template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
