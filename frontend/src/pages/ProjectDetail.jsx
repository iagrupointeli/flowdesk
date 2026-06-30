import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor,
  useSensor, useSensors, closestCorners,
} from '@dnd-kit/core'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

const TODAY    = new Date().toISOString().slice(0, 10)
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const ROLES    = ['proprietário','desenvolvedor','conselheiro','observador','membro']

function dueDateColor(d, status) {
  if (!d || status === 'done') return 'text-gray-400'
  const day = typeof d === 'string' ? d.slice(0, 10) : d
  if (day < TODAY)     return 'text-red-600 font-semibold'
  if (day <= TOMORROW) return 'text-amber-500 font-semibold'
  return 'text-gray-500'
}

function fmtDate(d) {
  if (!d) return null
  return d.slice(0, 10).split('-').reverse().join('/')
}

// ── Kanban card (sortable, sem select de coluna) ──────────────────────────────

function KanbanCard({ task, onToggle, onUpdate, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const draggedRef = useRef(false)
  const [editing,   setEditing]   = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const inputRef = useRef(null)
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    const t = editTitle.trim()
    setEditing(false)
    if (t && t !== task.title) onUpdate(t)
    else setEditTitle(task.title)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      onClick={() => { if (!draggedRef.current) onOpen() }}
      onPointerDown={() => { draggedRef.current = false }}
      onPointerMove={() => { draggedRef.current = true }}
      className={`rounded-xl border border-gray-200 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing ${task.status === 'done' ? 'opacity-60' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-2">
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onToggle(task) }}
          className={`mt-0.5 flex-shrink-0 flex h-4 w-4 items-center justify-center rounded border-2 transition-colors ${
            task.status === 'done' ? 'border-primary-500 bg-primary-500' : 'border-gray-300 hover:border-primary-400'
          }`}
        >
          {task.status === 'done' && (
            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="currentColor">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 1.414l-6 6a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L5 8.586l5.293-5.293z" clipRule="evenodd" />
            </svg>
          )}
        </button>
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onPointerDown={e => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditTitle(task.title); setEditing(false) } }}
            className="flex-1 rounded border border-primary-300 px-1 py-0 text-sm focus:outline-none"
          />
        ) : (
          <p
            onDoubleClick={e => { e.stopPropagation(); setEditTitle(task.title); setEditing(true) }}
            className={`flex-1 text-sm leading-snug ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}
          >
            {task.title}
          </p>
        )}
      </div>
      {task.due_date && (
        <p className={`mt-1.5 ml-6 text-xs ${dueDateColor(task.due_date, task.status)}`}>
          {fmtDate(task.due_date)}
        </p>
      )}
    </div>
  )
}

// ── Coluna droppable (visual de destino durante drag) ────────────────────────

function DroppableColumn({ id, isOver, children }) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`min-h-16 space-y-2 pb-1 rounded-lg transition-colors duration-100 ${isOver ? 'bg-primary-50/60' : ''}`}
    >
      {children}
    </div>
  )
}

// ── Row sortável (Lista) ──────────────────────────────────────────────────────

function SortableTaskRow({ task, onToggle, onUpdate, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const [editing,   setEditing]   = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const inputRef = useRef(null)
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    const t = editTitle.trim()
    setEditing(false)
    if (t && t !== task.title) onUpdate(t)
    else setEditTitle(task.title)
  }

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`border-b border-gray-100 hover:bg-gray-50 ${task.status === 'done' ? 'opacity-60' : ''}`}
    >
      {/* drag handle */}
      <td className="w-6 pl-3 py-2 cursor-grab text-gray-300 hover:text-gray-400" {...attributes} {...listeners}>
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </td>
      {/* checkbox */}
      <td className="w-8 py-2">
        <button
          onClick={() => onToggle(task)}
          className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
            task.status === 'done' ? 'border-primary-500 bg-primary-500' : 'border-gray-300 hover:border-primary-400'
          }`}
        >
          {task.status === 'done' && (
            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 1.414l-6 6a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L5 8.586l5.293-5.293z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </td>
      <td className="py-2 pr-4 w-full cursor-pointer" onClick={onOpen}>
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={commit}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditTitle(task.title); setEditing(false) } }}
            className="w-full rounded border border-primary-300 px-1 py-0 text-sm focus:outline-none"
          />
        ) : (
          <span
            onDoubleClick={e => { e.stopPropagation(); setEditTitle(task.title); setEditing(true) }}
            className={`text-sm ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}
          >
            {task.title}
          </span>
        )}
      </td>
      <td className="py-2 pr-4 whitespace-nowrap">
        {task.assignee_name
          ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[10px] font-semibold text-primary-700">
              {task.assignee_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          : <span className="text-xs text-gray-300">—</span>
        }
      </td>
      <td className={`py-2 pr-4 whitespace-nowrap text-xs ${dueDateColor(task.due_date, task.status)}`}>
        {fmtDate(task.due_date) ?? '—'}
      </td>
    </tr>
  )
}

// ── Painel de detalhes da tarefa ─────────────────────────────────────────────

function TaskDetailPanel({ task, members, onUpdate, onToggle, onClose }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const notesTimer = useRef(null)

  useEffect(() => { setTitle(task.title) }, [task.title])
  useEffect(() => { setNotes(task.notes ?? '') }, [task.notes])
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  useEffect(() => () => clearTimeout(notesTimer.current), [])

  function commitTitle() {
    const trimmed = title.trim()
    if (!trimmed) { setTitle(task.title); return }
    if (trimmed !== task.title) onUpdate(task.id, { title: trimmed })
  }

  function handleNotesChange(val) {
    setNotes(val)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => onUpdate(task.id, { notes: val || null }), 800)
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-40 flex h-full w-[440px] flex-col border-l border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => onToggle(task)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              task.status === 'done'
                ? 'border-primary-200 bg-primary-50 text-primary-700'
                : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-700'
            }`}
          >
            {task.status === 'done' ? 'Concluída' : 'Marcar como concluída'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            className="mb-5 w-full text-xl font-bold text-gray-900 focus:outline-none bg-transparent border-b-2 border-transparent focus:border-primary-300 transition-colors pb-1"
            placeholder="Nome da tarefa"
          />
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-3">
              <span className="w-32 flex-shrink-0 text-sm text-gray-500">Responsável</span>
              <span className="text-sm text-gray-700">
                {members.find(m => m.user_id === task.assignee_id)?.user_name ?? task.assignee_name ?? '—'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-32 flex-shrink-0 text-sm text-gray-500">Data de conclusão</span>
              <input
                type="date"
                value={task.due_date?.slice(0,10) ?? ''}
                onChange={e => onUpdate(task.id, { due_date: e.target.value || null })}
                className={`rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:border-primary-400 ${dueDateColor(task.due_date, task.status)}`}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-32 flex-shrink-0 text-sm text-gray-500">Seção</span>
              <span className="text-sm text-gray-700">{task.section ?? '—'}</span>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-gray-700">Descrição</p>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder="Adicionar mais detalhes..."
              rows={6}
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-primary-400 placeholder-gray-300"
            />
            <p className="mt-1 text-xs text-gray-300">Salvo automaticamente</p>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Visão Geral ──────────────────────────────────────────────────────────────

function OverviewTab({ project, members, isAdmin, onProjectChange, onMembersChange, projectId, user }) {
  const [inviteModal, setInviteModal] = useState(false)
  const [invForm,     setInvForm]     = useState({ user_id: '', role: 'membro' })
  const [editDesc,    setEditDesc]    = useState(false)
  const [desc,        setDesc]        = useState(project.description ?? '')
  const [searchQ,     setSearchQ]     = useState('')
  const [searchRes,   setSearchRes]   = useState([])
  const [selected,    setSelected]    = useState(null) // { id, name, email }
  const searchTimer = useRef(null)

  function saveDesc() {
    setEditDesc(false)
    api.patch(`/projects/${projectId}`, { description: desc })
       .then(r => onProjectChange(r.data))
  }

  function onSearchChange(val) {
    setSearchQ(val)
    setSelected(null)
    clearTimeout(searchTimer.current)
    if (val.trim().length < 2) { setSearchRes([]); return }
    searchTimer.current = setTimeout(() => {
      api.get(`/users/search?q=${encodeURIComponent(val.trim())}`)
        .then(r => {
          const memberIds = new Set(members.map(m => m.user_id))
          setSearchRes(r.data.filter(u => !memberIds.has(u.id)))
        })
    }, 300)
  }

  function invite(e) {
    e.preventDefault()
    if (!selected) return
    api.post(`/projects/${projectId}/members`, { user_id: selected.id, role: invForm.role }).then(r => {
      onMembersChange(prev => [
        ...prev.filter(m => m.user_id !== selected.id),
        { ...r.data, user_name: selected.name, user_email: selected.email },
      ])
      setInviteModal(false)
      setSearchQ(''); setSearchRes([]); setSelected(null)
      setInvForm({ user_id: '', role: 'membro' })
    })
  }

  function openInvite() {
    setSearchQ(''); setSearchRes([]); setSelected(null)
    setInviteModal(true)
  }

  function changeRole(uid, newRole) {
    api.patch(`/projects/${projectId}/members/${uid}`, { role: newRole })
       .then(r => onMembersChange(prev => prev.map(m => m.user_id === uid ? { ...m, role: r.data.role } : m)))
  }

  function removeMember(uid) {
    api.delete(`/projects/${projectId}/members/${uid}`)
       .then(() => onMembersChange(prev => prev.filter(m => m.user_id !== uid)))
  }

  const isOwner   = members.some(m => m.user_id === user?.id && m.role === 'proprietário')
  const canManage = isAdmin || isOwner

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Descrição</h2>
        {editDesc ? (
          <div>
            <textarea
              autoFocus
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-primary-300 px-3 py-2 text-sm focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button onMouseDown={e => { e.preventDefault(); saveDesc() }}
                className="rounded bg-primary-600 px-3 py-1 text-xs text-white hover:bg-primary-700">Salvar</button>
              <button onMouseDown={e => { e.preventDefault(); setEditDesc(false); setDesc(project.description ?? '') }}
                className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
            </div>
          </div>
        ) : (
          <p onClick={() => setEditDesc(true)}
            className={`cursor-pointer rounded-lg p-2 text-sm hover:bg-gray-50 ${desc ? 'text-gray-700' : 'text-gray-300 italic'}`}>
            {desc || 'Adicionar descrição...'}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Membros</h2>
          {canManage && (
            <button onClick={openInvite}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Convidar membro
            </button>
          )}
        </div>
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 flex-shrink-0">
                {(m.user_name ?? '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span className="flex-1 text-sm text-gray-800">{m.user_name}</span>
              {canManage ? (
                <select value={m.role} onChange={e => changeRole(m.user_id, e.target.value)}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 focus:outline-none">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <span className="text-xs text-gray-400">{m.role}</span>
              )}
              {canManage && m.role !== 'proprietário' && (
                <button onClick={() => removeMember(m.user_id)} className="text-gray-300 hover:text-red-400 transition-colors">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {inviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-base font-bold text-gray-900">Convidar membro</h3>
            <form onSubmit={invite} className="space-y-3">
              <div className="relative">
                <input
                  autoFocus
                  value={searchQ}
                  onChange={e => onSearchChange(e.target.value)}
                  placeholder="Buscar por nome ou e-mail…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
                />
                {searchRes.length > 0 && !selected && (
                  <ul className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                    {searchRes.map(u => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onMouseDown={() => { setSelected(u); setSearchQ(`${u.name} — ${u.email}`); setSearchRes([]) }}
                          className="flex w-full flex-col px-3 py-2 text-left hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-900">{u.name}</span>
                          <span className="text-xs text-gray-400">{u.email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searchQ.length >= 2 && searchRes.length === 0 && !selected && (
                  <p className="mt-1 text-xs text-gray-400 px-1">Nenhum resultado.</p>
                )}
              </div>
              <select value={invForm.role} onChange={e => setInvForm(f => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setInviteModal(false)} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button type="submit" disabled={!selected} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">Convidar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Lista (com DnD de reordenação) ───────────────────────────────────────────

function ListaTab({ tasks, sections, setSections, onUpdateTask, onAddTask, onOpenDetail, projectId }) {
  const [localTasks,    setLocalTasks]    = useState(tasks)
  const [newTitle,      setNewTitle]      = useState('')
  const [newSection,    setNewSection]    = useState(null)
  const [adding,        setAdding]        = useState(false)
  const [editingSec,    setEditingSec]    = useState(null)
  const [secEditName,   setSecEditName]   = useState('')
  const inputRef   = useRef(null)
  const secInputRef = useRef(null)

  useEffect(() => setLocalTasks(tasks), [tasks])
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])
  useEffect(() => { if (editingSec) secInputRef.current?.focus() }, [editingSec])

  function startSecRename(secName) { setEditingSec(secName); setSecEditName(secName) }
  function commitSecRename(secName) {
    const name = secEditName.trim()
    setEditingSec(null)
    if (!name || name === secName) return
    const sec = sections.find(s => s.name === secName)
    if (!sec) return
    api.patch(`/projects/${projectId}/sections/${sec.id}`, { name })
       .then(() => {
         setSections(prev => prev.map(s => s.id === sec.id ? { ...s, name } : s))
         setLocalTasks(prev => prev.map(t => t.section === secName ? { ...t, section: name } : t))
       })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIdx = localTasks.findIndex(t => t.id === active.id)
    const newIdx = localTasks.findIndex(t => t.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    if (localTasks[oldIdx].section !== localTasks[newIdx].section) return
    const reordered = arrayMove(localTasks, oldIdx, newIdx)
    setLocalTasks(reordered)
    api.patch(`/tasks/${active.id}/reorder`, { position: newIdx })
       .catch(() => setLocalTasks(tasks))
  }

  function commitAdd() {
    const t = newTitle.trim()
    if (t) onAddTask({ title: t, section: newSection })
    setNewTitle(''); setNewSection(null); setAdding(false)
  }

  const sectionNames = sections.length > 0 ? sections.map(s => s.name) : [...new Set(localTasks.map(t => t.section).filter(Boolean))]
  const allGroups    = [...sectionNames, null]

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-1 grid grid-cols-[1.5rem_2rem_1fr_8rem_7rem] px-3">
        <span /><span />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Nome</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Responsável</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Conclusão</span>
      </div>
      <div className="border-t border-gray-200 mb-3" />

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        {allGroups.map(sec => {
          const secTasks = localTasks.filter(t => (t.section ?? null) === sec)
          if (secTasks.length === 0 && sec !== null) return null
          return (
            <div key={sec ?? '__none'} className="mb-6">
              {sec && (
                editingSec === sec ? (
                  <input
                    ref={secInputRef}
                    value={secEditName}
                    onChange={e => setSecEditName(e.target.value)}
                    onBlur={() => commitSecRename(sec)}
                    onKeyDown={e => { if (e.key === 'Enter') commitSecRename(sec); if (e.key === 'Escape') setEditingSec(null) }}
                    className="mb-1 rounded border border-primary-300 px-2 py-0.5 text-sm font-semibold focus:outline-none"
                  />
                ) : (
                  <p
                    onDoubleClick={() => startSecRename(sec)}
                    className="mb-1 text-sm font-semibold text-gray-700 cursor-default select-none"
                    title="Duplo clique para renomear"
                  >{sec}</p>
                )
              )}
              {!sec && sectionNames.length > 0 && <p className="mb-1 text-xs text-gray-400 italic">Sem seção</p>}
              <table className="w-full">
                <tbody>
                  <SortableContext items={secTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {secTasks.map(t => (
                      <SortableTaskRow
                        key={t.id}
                        task={t}
                        onToggle={task => onUpdateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })}
                        onUpdate={title => onUpdateTask(t.id, { title })}
                        onOpen={() => onOpenDetail(t.id)}
                      />
                    ))}
                  </SortableContext>
                  <tr>
                    <td colSpan={5} className="pl-9 py-1">
                      {adding && newSection === sec ? (
                        <div className="flex items-center gap-2">
                          <input
                            ref={inputRef}
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setNewTitle(''); setAdding(false) } }}
                            placeholder="Nome da tarefa..."
                            className="flex-1 rounded border border-primary-300 px-2 py-1 text-sm focus:outline-none"
                          />
                          <button onMouseDown={e => { e.preventDefault(); commitAdd() }} className="rounded bg-primary-600 px-2 py-1 text-xs text-white">Salvar</button>
                          <button onMouseDown={e => { e.preventDefault(); setAdding(false) }} className="text-xs text-gray-400">Cancelar</button>
                        </div>
                      ) : (
                        <button onClick={() => { setNewSection(sec); setAdding(true) }}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600">
                          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                          </svg>
                          Adicionar tarefa
                        </button>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}
      </DndContext>
    </div>
  )
}

// ── Quadro / Kanban (com DnD multi-container) ────────────────────────────────

function buildColMap(tasksList, sectionList) {
  const map = {}
  sectionList.forEach(s => {
    map[s.name] = tasksList
      .filter(t => t.section === s.name)
      .sort((a, b) => a.position - b.position)
  })
  return map
}

function QuadroTab({ tasks, sections, setSections, onUpdateTask, onAddTask, onRenameTasks, onOpenDetail, projectId }) {
  const [colMap,       setColMap]       = useState(() => buildColMap(tasks, sections))
  const [activeTask,   setActiveTask]   = useState(null)
  const [overColId,    setOverColId]    = useState(null)
  const [editingCol,   setEditingCol]   = useState(null)
  const [colName,      setColName]      = useState('')
  const [addColMode,   setAddColMode]   = useState(false)
  const [newColName,   setNewColName]   = useState('')
  const [addTaskCol,   setAddTaskCol]   = useState(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const colInput  = useRef(null)
  const taskInput = useRef(null)
  const colMapRef = useRef(colMap)
  const originSecRef = useRef(null)

  useEffect(() => { colMapRef.current = colMap }, [colMap])
  useEffect(() => { setColMap(buildColMap(tasks, sections)) }, [tasks, sections])
  useEffect(() => { if (editingCol !== null) colInput.current?.focus() }, [editingCol])
  useEffect(() => { if (addTaskCol !== null) taskInput.current?.focus() }, [addTaskCol])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function findContainer(taskId) {
    for (const [name, items] of Object.entries(colMapRef.current)) {
      if (items.some(t => t.id === taskId)) return name
    }
    return null
  }

  function handleDragStart({ active }) {
    const task = tasks.find(t => t.id === active.id)
    setActiveTask(task ?? null)
    originSecRef.current = task?.section ?? null
  }

  function handleDragOver({ active, over }) {
    if (!over || active.id === over.id) return

    const activeCon = findContainer(active.id)
    // over.id can be a column name (droppable) or a task id (sortable)
    const overCon = colMapRef.current[over.id] !== undefined
      ? over.id
      : findContainer(over.id)

    setOverColId(overCon)
    if (!activeCon || !overCon || activeCon === overCon) return

    setColMap(prev => {
      const task = prev[activeCon]?.find(t => t.id === active.id)
      if (!task) return prev
      return {
        ...prev,
        [activeCon]: prev[activeCon].filter(t => t.id !== active.id),
        [overCon]:   [...(prev[overCon] ?? []), task],
      }
    })
  }

  function handleDragEnd({ active, over }) {
    const origin = originSecRef.current
    setActiveTask(null)
    setOverColId(null)
    originSecRef.current = null

    if (!over) {
      // Aborted — reset
      setColMap(buildColMap(tasks, sections))
      return
    }

    const finalCon = findContainer(active.id)

    if (finalCon && finalCon !== origin) {
      // Cross-column move — persist section change
      onUpdateTask(active.id, { section: finalCon })
    } else if (finalCon && active.id !== over.id) {
      // Same-column reorder
      const items  = colMapRef.current[finalCon] ?? []
      const oldIdx = items.findIndex(t => t.id === active.id)
      const newIdx = items.findIndex(t => t.id === over.id)
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        const reordered = arrayMove(items, oldIdx, newIdx)
        setColMap(prev => ({ ...prev, [finalCon]: reordered }))
        api.patch(`/tasks/${active.id}/reorder`, { position: newIdx })
           .catch(() => setColMap(buildColMap(tasks, sections)))
      }
    }
  }

  function startRename(sec) { setEditingCol(sec.name); setColName(sec.name) }

  function commitRename(sec) {
    const name = colName.trim()
    if (!name || name === sec.name) { setEditingCol(null); return }
    api.patch(`/projects/${projectId}/sections/${sec.id}`, { name })
       .then(() => {
         onRenameTasks?.(sec.name, name)
         setSections(prev => prev.map(s => s.id === sec.id ? { ...s, name } : s))
         setColMap(prev => {
           const items = (prev[sec.name] ?? []).map(t => ({ ...t, section: name }))
           const next  = { ...prev }
           delete next[sec.name]
           next[name] = items
           return next
         })
       })
       .catch(() => setColMap(buildColMap(tasks, sections)))
    setEditingCol(null)
  }

  function addColumn() {
    const name = newColName.trim()
    if (!name) { setAddColMode(false); return }
    api.post(`/projects/${projectId}/sections`, { name })
       .then(r => setSections(prev => [...prev, r.data]))
    setNewColName(''); setAddColMode(false)
  }

  function deleteColumn(sec) {
    if (!window.confirm(`Deletar coluna "${sec.name}"? As tarefas perderão a seção.`)) return
    api.delete(`/projects/${projectId}/sections/${sec.id}`)
       .then(() => setSections(prev => prev.filter(s => s.id !== sec.id)))
  }

  function addTaskToCol(secName) {
    const title = newTaskTitle.trim()
    if (title) onAddTask({ title, section: secName })
    setNewTaskTitle(''); setAddTaskCol(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 p-6 overflow-x-auto min-h-full items-start">
        {sections.map(sec => {
          const colTasks = colMap[sec.name] ?? []
          return (
            <div key={sec.id} className="w-64 flex-shrink-0">
              {/* Cabeçalho */}
              <div className="group flex items-center justify-between mb-3">
                {editingCol === sec.name ? (
                  <input
                    ref={colInput}
                    value={colName}
                    onChange={e => setColName(e.target.value)}
                    onBlur={() => commitRename(sec)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(sec); if (e.key === 'Escape') setEditingCol(null) }}
                    className="flex-1 rounded border border-primary-300 px-2 py-0.5 text-sm font-semibold focus:outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={() => startRename(sec)}
                    className="text-sm font-semibold text-gray-700 select-none cursor-default"
                    title="Duplo clique para renomear"
                  >
                    {sec.name} <span className="font-normal text-gray-400">({colTasks.length})</span>
                  </span>
                )}
                <button onClick={() => deleteColumn(sec)}
                  className="opacity-0 group-hover:opacity-100 ml-2 text-gray-300 hover:text-red-400 transition-all">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {/* Cards */}
              <DroppableColumn id={sec.name} isOver={overColId === sec.name}>
                <SortableContext items={colTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  {colTasks.map(task => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      onToggle={t => onUpdateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
                      onUpdate={title => onUpdateTask(task.id, { title })}
                      onOpen={() => onOpenDetail(task.id)}
                    />
                  ))}
                </SortableContext>
              </DroppableColumn>

              {/* Adicionar tarefa */}
              <div className="mt-2">
                {addTaskCol === sec.id ? (
                  <div className="rounded-xl border border-primary-200 bg-white p-3">
                    <input
                      ref={taskInput}
                      value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTaskToCol(sec.name); if (e.key === 'Escape') { setNewTaskTitle(''); setAddTaskCol(null) } }}
                      placeholder="Nome da tarefa..."
                      className="w-full text-sm focus:outline-none"
                    />
                    <div className="mt-2 flex gap-2">
                      <button onMouseDown={e => { e.preventDefault(); addTaskToCol(sec.name) }} className="rounded bg-primary-600 px-2 py-0.5 text-xs text-white">Salvar</button>
                      <button onMouseDown={e => { e.preventDefault(); setNewTaskTitle(''); setAddTaskCol(null) }} className="text-xs text-gray-400">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAddTaskCol(sec.id)}
                    className="flex w-full items-center gap-1 rounded-xl border border-dashed border-gray-200 p-2 text-xs text-gray-400 hover:border-primary-300 hover:text-primary-600 transition-colors">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    Adicionar tarefa
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* Adicionar coluna */}
        <div className="w-64 flex-shrink-0">
          {addColMode ? (
            <div className="rounded-xl border border-primary-200 bg-white p-3">
              <input
                autoFocus
                value={newColName}
                onChange={e => setNewColName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setNewColName(''); setAddColMode(false) } }}
                placeholder="Nome da coluna..."
                className="w-full text-sm font-semibold focus:outline-none"
              />
              <div className="mt-2 flex gap-2">
                <button onMouseDown={e => { e.preventDefault(); addColumn() }} className="rounded bg-primary-600 px-2 py-0.5 text-xs text-white">Salvar</button>
                <button onMouseDown={e => { e.preventDefault(); setNewColName(''); setAddColMode(false) }} className="text-xs text-gray-400">Cancelar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddColMode(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 p-3 text-sm text-gray-400 hover:border-primary-300 hover:text-primary-600 transition-colors">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Adicionar seção
            </button>
          )}
        </div>
      </div>

      {/* Ghost card durante drag */}
      <DragOverlay>
        {activeTask ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xl opacity-90 w-64 cursor-grabbing">
            <p className="text-sm text-gray-800">{activeTask.title}</p>
            {activeTask.due_date && (
              <p className={`mt-1.5 text-xs ${dueDateColor(activeTask.due_date, activeTask.status)}`}>
                {fmtDate(activeTask.due_date)}
              </p>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ── + (futuras views) ─────────────────────────────────────────────────────────

function PlusTab() {
  const OPTIONS = [
    { label: 'Gantt',             desc: 'Monitore dependências e linhas de base' },
    { label: 'Calendário',        desc: 'Planeje o trabalho semanal ou mensal' },
    { label: 'Cronograma',        desc: 'Agende trabalhos ao longo do tempo' },
    { label: 'Painel',            desc: 'Monitore métricas e insights do projeto' },
    { label: 'Mensagens',         desc: 'Comunique-se com os membros do projeto' },
    { label: 'Fluxo de trabalho', desc: 'Automatize com regras' },
  ]
  return (
    <div className="p-6 max-w-2xl">
      <p className="mb-4 text-sm text-gray-500">Adicionar visualização ao projeto</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(o => (
          <div key={o.label} className="rounded-xl border border-gray-200 p-4 opacity-50 cursor-not-allowed">
            <p className="font-semibold text-gray-700 text-sm">{o.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{o.desc}</p>
            <span className="mt-2 inline-block text-xs text-gray-300">Em breve</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Container principal ───────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useParams()
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'super_admin'

  const [project,  setProject]  = useState(null)
  const [sections, setSections] = useState([])
  const [members,  setMembers]  = useState([])
  const [tasks,    setTasks]    = useState([])
  const [tab,            setTab]            = useState('lista')
  const [loading,        setLoading]        = useState(true)
  const [selectedTaskId, setSelectedTaskId] = useState(null)

  const refetch = useCallback(async () => {
    const [proj, secs, mems, tsk] = await Promise.all([
      api.get(`/projects/${id}`).then(r => r.data),
      api.get(`/projects/${id}/sections`).then(r => r.data),
      api.get(`/projects/${id}/members`).then(r => r.data),
      api.get(`/projects/${id}/tasks`).then(r => r.data),
    ])
    setProject(proj); setSections(secs); setMembers(mems); setTasks(tsk)
  }, [id])

  useEffect(() => {
    setLoading(true)
    refetch().finally(() => setLoading(false))
  }, [refetch])


  function updateTask(taskId, data) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...data } : t))
    api.patch(`/tasks/${taskId}`, data).catch(refetch)
  }

  function addTask(data) {
    api.post(`/projects/${id}/tasks`, data).then(r => setTasks(prev => [...prev, r.data]))
  }

  if (loading) return (
    <div className="p-6 space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}
    </div>
  )
  if (!project) return <div className="p-6 text-gray-400">Projeto não encontrado.</div>

  const TABS = [
    { key: 'overview', label: 'Visão geral' },
    { key: 'lista',    label: 'Lista' },
    { key: 'quadro',   label: 'Quadro' },
    { key: 'plus',     label: '+' },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-200 px-6 pt-5 pb-0">
        <div className="flex items-center gap-3 mb-3">
          <span className="h-8 w-8 rounded-lg flex-shrink-0" style={{ backgroundColor: project.color }} />
          <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
        </div>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <OverviewTab
            project={project} members={members}
            isAdmin={isAdmin} user={user} projectId={id}
            onProjectChange={setProject} onMembersChange={setMembers}
          />
        )}
        {tab === 'lista' && (
          <ListaTab tasks={tasks} sections={sections} setSections={setSections} onUpdateTask={updateTask} onAddTask={addTask} projectId={id} onOpenDetail={setSelectedTaskId} />
        )}
        {tab === 'quadro' && (
          <QuadroTab
            tasks={tasks} sections={sections} setSections={setSections}
            onUpdateTask={updateTask} onAddTask={addTask} projectId={id}
            onOpenDetail={setSelectedTaskId}
            onRenameTasks={(oldName, newName) =>
              setTasks(prev => prev.map(t => t.section === oldName ? { ...t, section: newName } : t))
            }
          />
        )}
        {tab === 'plus' && <PlusTab />}
      </div>

      {selectedTaskId && (() => {
        const t = tasks.find(t => t.id === selectedTaskId)
        return t ? (
          <TaskDetailPanel
            task={t}
            members={members}
            onUpdate={updateTask}
            onToggle={t => updateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
            onClose={() => setSelectedTaskId(null)}
          />
        ) : null
      })()}
    </div>
  )
}
