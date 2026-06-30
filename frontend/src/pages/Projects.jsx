import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState({ name: '', description: '', color: '#6366f1' })
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/projects')
      .then(r => setProjects(r.data))
      .catch(e => setError(e?.response?.data?.error ?? e.message ?? 'Erro ao carregar projetos.'))
      .finally(() => setLoading(false))
  }, [])

  function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    api.post('/projects', form).then(r => {
      setProjects(prev => [r.data, ...prev])
      setModal(false)
      setForm({ name: '', description: '', color: '#6366f1' })
      navigate(`/projects/${r.data.id}`)
    })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Projetos</h1>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Novo Projeto
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <svg className="h-12 w-12 mb-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
          <p className="text-sm">Nenhum projeto. Crie o primeiro!</p>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="text-left rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="h-8 w-8 rounded-lg flex-shrink-0" style={{ backgroundColor: p.color }} />
                <span className="font-semibold text-gray-900 truncate">{p.name}</span>
              </div>
              {p.description && (
                <p className="text-xs text-gray-500 line-clamp-2 mb-3">{p.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>{p.task_count} tarefa{p.task_count !== 1 ? 's' : ''}</span>
                <span>{p.done_count} concluída{p.done_count !== 1 ? 's' : ''}</span>
                <span>{p.member_count} membro{p.member_count !== 1 ? 's' : ''}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-gray-900">Novo Projeto</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nome</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do projeto"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Opcional"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`h-7 w-7 rounded-full transition-transform ${form.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button type="submit" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
