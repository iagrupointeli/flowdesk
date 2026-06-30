import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? '/api'

function FieldInput({ field, value, onChange }) {
  const base = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500'

  if (field.field_type === 'select') {
    return (
      <select className={base} value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required}>
        <option value="">Selecione...</option>
        {(field.options ?? []).map(opt => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    )
  }
  if (field.field_type === 'textarea') {
    return (
      <textarea className={base} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required} />
    )
  }
  const inputType = { number: 'number', date: 'date', cpf: 'text' }[field.field_type] ?? 'text'
  return (
    <input
      type={inputType}
      className={base}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      required={field.required}
      placeholder={field.field_type === 'cpf' ? '000.000.000-00' : undefined}
    />
  )
}

export default function IntakeForm() {
  const { token } = useParams()
  const [form,       setForm]       = useState(null)
  const [status,     setStatus]     = useState('loading') // loading | form | submitted | error
  const [errorMsg,   setErrorMsg]   = useState('')
  const [title,      setTitle]      = useState('')
  const [name,       setName]       = useState('')
  const [email,      setEmail]      = useState('')
  const [notes,      setNotes]      = useState('')
  const [payload,    setPayload]    = useState({})
  const [submitting, setSubmitting] = useState(false)

  const loadForm = useCallback(async () => {
    try {
      const res = await fetch(`${API}/intake/${token}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setErrorMsg(body.error ?? 'Link inválido ou expirado.')
        setStatus('error')
        return
      }
      setForm(await res.json())
      setStatus('form')
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.')
      setStatus('error')
    }
  }, [token])

  useEffect(() => { loadForm() }, [loadForm])

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/intake/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, requester_name: name, requester_email: email, notes, payload }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? 'Erro ao enviar formulário.')
        return
      }
      setStatus('submitted')
    } catch {
      alert('Erro de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Carregando formulário...</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm text-center">
          <p className="text-2xl mb-2">🔗</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Link inválido</h1>
          <p className="text-sm text-gray-500">{errorMsg}</p>
        </div>
      </div>
    )
  }

  if (status === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm text-center">
          <p className="text-3xl mb-3">✅</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Pedido enviado!</h1>
          <p className="text-sm text-gray-500">Seu pedido foi registrado e será processado em breve.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">{form.link_label}</h1>
          <p className="text-sm text-gray-500 mt-1">Tipo: {form.demand_type_name}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Título do pedido *</label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Ex: Arte para campanha de verão"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Seu nome *</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {(form.fields ?? []).map(field => (
            <div key={field.id}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                {field.label}{field.required && ' *'}
              </label>
              <FieldInput
                field={field}
                value={payload[field.id] ?? ''}
                onChange={val => setPayload(p => ({ ...p, [field.id]: val }))}
              />
            </div>
          ))}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Informações adicionais..."
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 text-white text-sm font-semibold py-2.5 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Enviando...' : 'Enviar pedido'}
          </button>
        </form>
      </div>
    </div>
  )
}
