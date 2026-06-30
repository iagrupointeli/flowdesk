import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

const VISIBILITY_LABELS = {
  public:  { label: 'Público',  color: 'text-green-600 bg-green-50' },
  limited: { label: 'Limitado', color: 'text-yellow-700 bg-yellow-50' },
  private: { label: 'Privado',  color: 'text-gray-600 bg-gray-100' },
}

// ── Componente de aba Membros ─────────────────────────────────────────────────

function MembersTab({ areaId }) {
  const [members,  setMembers]  = useState(null)  // null = não carregado ainda
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const searchTimer = useRef(null)

  useEffect(() => {
    const ctrl = new AbortController()
    api.get(`/areas/${areaId}/members`, { signal: ctrl.signal })
      .then(r => setMembers(r.data))
      .catch(() => {})
    return () => ctrl.abort()
  }, [areaId])

  useEffect(() => {
    clearTimeout(searchTimer.current)
    if (query.length < 2) { setResults([]); return }
    searchTimer.current = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(query)}`).then(r => {
        const memberIds = new Set((members ?? []).map(m => m.user_id))
        setResults(r.data.filter(u => !memberIds.has(u.id)))
      }).catch(() => {})
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [query, members])

  function addMember(user) {
    api.post(`/areas/${areaId}/members`, { user_id: user.id }).then(() => {
      setMembers(prev => [...(prev ?? []), {
        user_id: user.id, user_name: user.name, user_email: user.email, invited_at: new Date().toISOString()
      }])
      setQuery('')
      setResults([])
    }).catch(() => {})
  }

  function removeMember(userId) {
    api.delete(`/areas/${areaId}/members/${userId}`).then(() => {
      setMembers(prev => prev.filter(m => m.user_id !== userId))
    }).catch(() => {})
  }

  if (!members) return <div className="px-5 py-6 text-center text-sm text-gray-400">Carregando...</div>

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Lista de membros */}
      {members.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Nenhum membro. Membros da área podem ver projetos "Limitado".</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm">
              <span className="font-medium text-gray-800">{m.user_name}</span>
              <button
                onClick={() => removeMember(m.user_id)}
                className="text-gray-400 hover:text-red-500 transition-colors leading-none"
                title="Remover"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Busca para adicionar */}
      <div className="relative">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por nome ou e-mail para adicionar..."
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
        />
        {results.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
            {results.map(u => (
              <li key={u.id}>
                <button
                  onClick={() => addMember(u)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 transition-colors"
                >
                  <span className="font-medium text-gray-900">{u.name}</span>
                  <span className="ml-2 text-gray-400 text-xs">{u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Membros da área visualizam todos os projetos com visibilidade "Limitado" nesta área.
      </p>
    </div>
  )
}

// ── Componente de aba Tarefas ─────────────────────────────────────────────────

function TasksTab({ areaId }) {
  const [tasks,   setTasks]   = useState(null)
  const [filter,  setFilter]  = useState('all')  // 'all' | 'todo' | 'done'

  useEffect(() => {
    const ctrl = new AbortController()
    api.get(`/areas/${areaId}/tasks`, { signal: ctrl.signal })
      .then(r => setTasks(r.data))
      .catch(() => {})
    return () => ctrl.abort()
  }, [areaId])

  function toggleDone(task) {
    const next = task.status === 'done' ? 'todo' : 'done'
    api.patch(`/projects/${task.project_id}/tasks/${task.id}`, { status: next }).then(() => {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t))
    }).catch(() => {})
  }

  if (!tasks) return <div className="px-5 py-6 text-center text-sm text-gray-400">Carregando...</div>

  const shown = filter === 'all' ? tasks : tasks.filter(t => t.status === (filter === 'done' ? 'done' : 'todo'))

  // agrupar por projeto
  const byProject = shown.reduce((acc, t) => {
    if (!acc[t.project_id]) acc[t.project_id] = { name: t.project_name, color: t.project_color, tasks: [] }
    acc[t.project_id].tasks.push(t)
    return acc
  }, {})

  return (
    <div className="px-5 py-4 space-y-4">
      {/* filtro */}
      <div className="flex gap-1">
        {[['all','Todas'],['todo','A fazer'],['done','Concluídas']].map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === v ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">{shown.length} tarefa{shown.length !== 1 ? 's' : ''}</span>
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-gray-400 italic text-center py-4">Nenhuma tarefa.</p>
      )}

      {Object.entries(byProject).map(([projId, proj]) => (
        <div key={projId}>
          <div className="flex items-center gap-2 mb-2">
            <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: proj.color }} />
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{proj.name}</span>
          </div>
          <div className="space-y-1">
            {proj.tasks.map(t => (
              <div key={t.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${t.status === 'done' ? 'opacity-50' : ''}`}>
                <button onClick={() => toggleDone(t)} className="flex-shrink-0">
                  {t.status === 'done'
                    ? <span className="h-4 w-4 rounded-full bg-primary-500 flex items-center justify-center text-white text-[10px]">✓</span>
                    : <span className="h-4 w-4 rounded-full border-2 border-gray-300 block" />
                  }
                </button>
                <span className={`flex-1 truncate text-gray-800 ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</span>
                {t.assignee_name && (
                  <span className="text-xs text-gray-400 flex-shrink-0">{t.assignee_name.split(' ')[0]}</span>
                )}
                {t.due_date && (
                  <span className={`text-xs flex-shrink-0 ${new Date(t.due_date) < new Date() && t.status !== 'done' ? 'text-red-500' : 'text-gray-400'}`}>
                    {new Date(t.due_date).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function Areas() {
  const navigate = useNavigate()
  const [areas,      setAreas]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [activeTab,  setActiveTab]  = useState({})  // { [areaId]: 'projetos' | 'membros' | 'tarefas' }
  const [areaModal,  setAreaModal]  = useState(false)
  const [projModal,  setProjModal]  = useState(null)
  const [areaForm,   setAreaForm]   = useState({ name: '', description: '', color: '#6366f1' })
  const [projForm,   setProjForm]   = useState({ name: '', description: '', color: '#6366f1', visibility: 'private' })
  const [formError,  setFormError]  = useState(null)

  useEffect(() => { load() }, [])

  function load() {
    setLoading(true)
    api.get('/areas').then(r => setAreas(r.data)).finally(() => setLoading(false))
  }

  function tab(areaId) { return activeTab[areaId] ?? 'projetos' }
  function setTab(areaId, t) { setActiveTab(prev => ({ ...prev, [areaId]: t })) }

  function handleCreateArea(e) {
    e.preventDefault()
    if (!areaForm.name.trim()) return
    setFormError(null)
    api.post('/areas', areaForm).then(() => {
      setAreaModal(false)
      setAreaForm({ name: '', description: '', color: '#6366f1' })
      load()
    }).catch(err => setFormError(err?.response?.data?.error ?? 'Erro ao criar área.'))
  }

  function handleCreateProject(e) {
    e.preventDefault()
    if (!projForm.name.trim()) return
    setFormError(null)
    api.post('/projects', { ...projForm, area_id: projModal }).then(r => {
      setProjModal(null)
      setProjForm({ name: '', description: '', color: '#6366f1', visibility: 'private' })
      navigate(`/projects/${r.data.id}`)
    }).catch(err => setFormError(err?.response?.data?.error ?? 'Erro ao criar projeto.'))
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Áreas</h1>
        <button
          onClick={() => setAreaModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Nova Área
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      )}

      {!loading && areas.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <svg className="h-12 w-12 mb-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <p className="text-sm">Nenhuma área. Crie a primeira!</p>
        </div>
      )}

      <div className="space-y-6">
        {areas.map(area => (
          <div key={area.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-lg flex-shrink-0" style={{ backgroundColor: area.color }} />
                <div>
                  <h2 className="font-semibold text-gray-900">{area.name}</h2>
                  {area.description && <p className="text-xs text-gray-500">{area.description}</p>}
                </div>
              </div>
              <button
                onClick={() => setProjModal(area.id)}
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Novo Projeto
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 px-5">
              {[['projetos','Projetos'],['membros','Membros'],['tarefas','Tarefas']].map(([t, label]) => (
                <button key={t} onClick={() => setTab(area.id, t)}
                  className={`mr-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${tab(area.id) === t ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                  {t === 'projetos' && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{area.projects.length}</span>}
                </button>
              ))}
            </div>

            {/* Conteúdo da tab */}
            {tab(area.id) === 'projetos' && (
              area.projects.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-gray-400 italic">Nenhum projeto nesta área.</div>
              ) : (
                <div className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
                  {area.projects.map(p => {
                    const vis = VISIBILITY_LABELS[p.visibility] ?? VISIBILITY_LABELS.private
                    return (
                      <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                        className="text-left rounded-lg border border-gray-100 bg-gray-50 p-4 hover:bg-white hover:shadow-sm transition-all">
                        <div className="flex items-center gap-2.5 mb-2">
                          <span className="h-6 w-6 rounded flex-shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="font-medium text-gray-900 truncate text-sm">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>{p.task_count} tarefa{p.task_count !== 1 ? 's' : ''}</span>
                          <span>{p.member_count} membro{p.member_count !== 1 ? 's' : ''}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${vis.color}`}>{vis.label}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            )}

            {tab(area.id) === 'membros' && <MembersTab areaId={area.id} />}
            {tab(area.id) === 'tarefas' && <TasksTab  areaId={area.id} />}
          </div>
        ))}
      </div>

      {/* Modal Nova Área */}
      {areaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-gray-900">Nova Área</h2>
            <form onSubmit={handleCreateArea} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nome</label>
                <input autoFocus value={areaForm.name}
                  onChange={e => setAreaForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: TI, Financeiro, SCOutdoor"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descrição</label>
                <textarea value={areaForm.description}
                  onChange={e => setAreaForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Opcional" rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setAreaForm(f => ({ ...f, color: c }))}
                      className={`h-7 w-7 rounded-full transition-transform ${areaForm.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setAreaModal(false); setFormError(null) }}
                  className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button type="submit"
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Novo Projeto */}
      {projModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-gray-900">Novo Projeto</h2>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nome</label>
                <input autoFocus value={projForm.name}
                  onChange={e => setProjForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do projeto"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descrição</label>
                <textarea value={projForm.description}
                  onChange={e => setProjForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Opcional" rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Visibilidade</label>
                <select value={projForm.visibility}
                  onChange={e => setProjForm(f => ({ ...f, visibility: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400">
                  <option value="public">Público — visível para todos</option>
                  <option value="limited">Limitado — membros da área podem ver</option>
                  <option value="private">Privado — apenas membros do projeto</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Cor</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setProjForm(f => ({ ...f, color: c }))}
                      className={`h-7 w-7 rounded-full transition-transform ${projForm.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setProjModal(null); setFormError(null) }}
                  className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button type="submit"
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
