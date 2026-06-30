import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../../lib/api'

/**
 * Construtor de Formulários Dinâmicos — /admin/workflows/:id/fields
 *
 * ── Funcionalidades ───────────────────────────────────────────────────────────
 *
 *   - Listar campos ativos e arquivados de um tipo de demanda
 *   - Criar / Editar campos (rótulo, tipo, obrigatoriedade, opções para select)
 *   - Reordenar campos ativos via drag-and-drop (@dnd-kit, mesmo padrão das etapas)
 *   - Arquivar campos — dados históricos preservados (demands.fields_snapshot)
 *
 * ── Compatibilidade com buildDemandSchema (Fase 8) ───────────────────────────
 *
 *   Cada campo retornado pelo backend tem a forma:
 *     { id, label, field_type, required, options: [{id, label}], archived_at }
 *   Compatível diretamente com buildDemandSchema / buildDefaultValues.
 *
 * ── Tipos de campo suportados ─────────────────────────────────────────────────
 *
 *   text     → Texto curto (input)
 *   textarea → Texto longo (textarea)
 *   number   → Número
 *   date     → Data (date picker)
 *   select   → Seleção (lista de opções com chip UI)
 *   cpf      → CPF (11 dígitos, com máscara)
 *
 *   field_type é IMUTÁVEL após criação.
 */

const FIELD_TYPE_LABELS = {
  text:     'Texto curto',
  textarea: 'Texto longo',
  number:   'Número',
  date:     'Data',
  select:   'Seleção',
  cpf:      'CPF',
}

const FIELD_TYPE_COLORS = {
  text:     'bg-sky-100 text-sky-700',
  textarea: 'bg-sky-100 text-sky-700',
  number:   'bg-violet-100 text-violet-700',
  date:     'bg-amber-100 text-amber-700',
  select:   'bg-emerald-100 text-emerald-700',
  cpf:      'bg-orange-100 text-orange-700',
}

export default function AdminFieldBuilder() {
  const { id: typeId } = useParams()
  const navigate       = useNavigate()

  const [demandType, setDemandType] = useState(null)
  const [fields,     setFields]     = useState([])
  const [isLoading,  setIsLoading]  = useState(false)
  const [error,      setError]      = useState(null)
  const [fieldModal, setFieldModal] = useState(null) // null | { mode: 'create'|'edit', field? }

  useEffect(() => { loadData() }, [typeId])

  async function loadData() {
    setIsLoading(true)
    setError(null)
    try {
      const [typesRes, fieldsRes] = await Promise.all([
        api.get('/admin/demand-types'),
        api.get(`/admin/demand-types/${typeId}/fields`),
      ])
      const found = (typesRes.data ?? []).find(t => t.id === typeId)
      setDemandType(found ?? { id: typeId, name: 'Tipo desconhecido' })
      setFields(fieldsRes.data ?? [])
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao carregar campos.')
    } finally {
      setIsLoading(false)
    }
  }

  const activeFields   = fields.filter(f => !f.archived_at)
  const archivedFields = fields.filter(f =>  f.archived_at)

  // ── CRUD de campos ───────────────────────────────────────────────────────────

  function handleFieldSaved(savedField, mode) {
    if (mode === 'create') {
      setFields(prev => [...prev, savedField])
    } else {
      setFields(prev => prev.map(f => f.id === savedField.id ? { ...f, ...savedField } : f))
    }
    setFieldModal(null)
  }

  async function handleArchiveField(field) {
    if (!window.confirm(
      `Arquivar o campo "${field.label}"?\n\n` +
      `O campo será removido do formulário de criação. ` +
      `Demandas históricas continuam exibindo o campo normalmente.`
    )) return

    try {
      const { data } = await api.delete(`/admin/demand-types/${typeId}/fields/${field.id}`)
      setFields(prev => prev.map(f =>
        f.id === field.id ? { ...f, archived_at: data.archived_at } : f
      ))
    } catch (err) {
      alert(err?.response?.data?.error ?? 'Erro ao arquivar campo.')
    }
  }

  // ── Reordenação otimista + revert ────────────────────────────────────────────

  async function handleReorder(newActiveOrder) {
    const previous = [...fields]
    // Substitui os ativos pela nova ordem, mantém arquivados ao final
    setFields([...newActiveOrder, ...archivedFields])

    try {
      await api.patch(`/admin/demand-types/${typeId}/fields/reorder`, {
        orderedIds: newActiveOrder.map(f => f.id),
      })
    } catch {
      setFields(previous)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">

      {/* ── Breadcrumbs ───────────────────────────────────────────────────── */}
      <nav aria-label="breadcrumb" className="mb-5 flex items-center gap-1.5 text-sm">
        <button
          onClick={() => navigate('/admin/workflows')}
          className="flex items-center gap-1 text-gray-400 hover:text-primary-600
                     transition-colors focus:outline-none"
        >
          <IconGear className="h-3.5 w-3.5" />
          Workflows
        </button>
        <IconChevron className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
        <span className="max-w-[260px] truncate font-medium text-gray-700">
          {demandType?.name ?? '…'}
        </span>
        <IconChevron className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
        <span className="text-gray-500">Formulário</span>
      </nav>

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {demandType?.name ?? '…'}
            <span className="ml-2 align-middle text-sm font-normal text-gray-400">
              — Formulário
            </span>
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Campos exibidos ao criar demandas deste tipo
          </p>
          {demandType?.description && (
            <p className="mt-1 text-sm text-gray-400 italic">
              {demandType.description}
            </p>
          )}
          {demandType?.sla_hours && (
            <p className="mt-1 text-xs font-medium text-blue-600">
              SLA: {demandType.sla_hours}h de resolução
            </p>
          )}
        </div>
        <button
          onClick={() => setFieldModal({ mode: 'create' })}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-primary-600
                     px-4 py-2 text-sm font-semibold text-white transition-colors
                     hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <span aria-hidden="true">+</span>
          Novo Campo
        </button>
      </div>

      {/* ── Conteúdo ──────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

          {/* ── Campos ativos (DnD) ─────────────────────────────────────── */}
          {activeFields.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <IconForm className="mb-3 h-10 w-10 opacity-40" />
              <p className="font-medium">Nenhum campo ativo</p>
              <p className="mt-1 text-sm">
                Adicione campos para personalizar o formulário de criação
              </p>
            </div>
          ) : (
            <SortableFieldList
              fields={activeFields}
              onEdit={(f) => setFieldModal({ mode: 'edit', field: f })}
              onArchive={handleArchiveField}
              onReorder={handleReorder}
            />
          )}

          {/* ── Campos arquivados (colapsível) ──────────────────────────── */}
          {archivedFields.length > 0 && (
            <ArchivedFields fields={archivedFields} />
          )}
        </div>
      )}

      {/* ── Modal de campo ────────────────────────────────────────────────── */}
      {fieldModal && (
        <FieldModal
          mode={fieldModal.mode}
          field={fieldModal.field}
          typeId={typeId}
          onSave={handleFieldSaved}
          onClose={() => setFieldModal(null)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SortableFieldList — lista de campos reordenável via @dnd-kit
// ─────────────────────────────────────────────────────────────────────────────

function SortableFieldList({ fields, onEdit, onArchive, onReorder }) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIndex = fields.findIndex(f => f.id === active.id)
    const newIndex = fields.findIndex(f => f.id === over.id)
    onReorder(arrayMove(fields, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={fields.map(f => f.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y divide-gray-50">
          {fields.map((field, index) => (
            <SortableFieldItem
              key={field.id}
              field={field}
              index={index}
              onEdit={() => onEdit(field)}
              onArchive={() => onArchive(field)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SortableFieldItem — linha de campo arrastável
// ─────────────────────────────────────────────────────────────────────────────

function SortableFieldItem({ field, index, onEdit, onArchive }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id })

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.5 : 1,
    zIndex:     isDragging ? 10 : 'auto',
  }

  const typeCls = FIELD_TYPE_COLORS[field.field_type] ?? 'bg-gray-100 text-gray-600'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-3 transition-colors
                  ${isDragging ? 'bg-primary-50 shadow-md' : 'bg-white hover:bg-gray-50/50'}`}
    >
      {/* Número de ordem */}
      <span className="w-5 flex-shrink-0 text-center text-xs font-mono text-gray-300 select-none">
        {index + 1}
      </span>

      {/* Handle de drag */}
      <button
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab text-gray-300 hover:text-gray-500
                   focus:outline-none active:cursor-grabbing"
        aria-label="Arrastar para reordenar"
        tabIndex={0}
      >
        <IconGrip className="h-4 w-4" />
      </button>

      {/* Rótulo do campo */}
      <span className="flex-1 text-sm font-medium text-gray-800">{field.label}</span>

      {/* Badges */}
      <div className="flex items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeCls}`}>
          {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
        </span>
        {field.required && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600"
                title="Campo obrigatório">
            Obrig.
          </span>
        )}
        {field.field_type === 'select' && Array.isArray(field.options) && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                title={`${field.options.length} opção(ões)`}>
            {field.options.length} op.
          </span>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button
          onClick={onEdit}
          className="rounded border border-gray-200 px-2 py-1 text-xs font-medium
                     text-gray-600 transition-colors hover:bg-gray-100
                     focus:outline-none focus:ring-1 focus:ring-primary-500"
        >
          Editar
        </button>
        <button
          onClick={onArchive}
          className="rounded border border-red-100 px-2 py-1 text-xs font-medium
                     text-red-500 transition-colors hover:bg-red-50
                     focus:outline-none focus:ring-1 focus:ring-red-400"
        >
          Arquivar
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ArchivedFields — seção colapsável de campos arquivados
// ─────────────────────────────────────────────────────────────────────────────

function ArchivedFields({ fields }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-dashed border-gray-100">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-gray-400
                   hover:text-gray-600 focus:outline-none"
      >
        <IconChevron className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {fields.length} campo{fields.length !== 1 ? 's' : ''} arquivado{fields.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="divide-y divide-gray-50 bg-gray-50/50">
          {fields.map(field => (
            <div key={field.id} className="flex items-center gap-3 px-4 py-2.5 opacity-60">
              <span className="flex-1 text-xs text-gray-500 line-through">{field.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium
                               ${FIELD_TYPE_COLORS[field.field_type] ?? 'bg-gray-100 text-gray-500'}`}>
                {FIELD_TYPE_LABELS[field.field_type] ?? field.field_type}
              </span>
              <span className="text-xs text-gray-400">
                Arquivado em {new Date(field.archived_at).toLocaleDateString('pt-BR')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FieldModal — criar / editar campo dinâmico
// ─────────────────────────────────────────────────────────────────────────────

function FieldModal({ mode, field, typeId, onSave, onClose }) {
  const [label,       setLabel]       = useState(field?.label ?? '')
  const [fieldType,   setFieldType]   = useState(field?.field_type ?? 'text')
  const [required,    setRequired]    = useState(field?.required ?? false)
  const [options,     setOptions]     = useState(field?.options ?? [])
  const [optionInput, setOptionInput] = useState('')
  const [isLoading,   setIsLoading]   = useState(false)
  const [error,       setError]       = useState(null)

  // Tipo efetivo (para edição: sempre o tipo original do campo)
  const effectiveType = mode === 'edit' ? field?.field_type : fieldType
  const isSelectType  = effectiveType === 'select'

  function addOption() {
    const trimmed = optionInput.trim()
    if (!trimmed) return
    setOptions(prev => [...prev, { id: crypto.randomUUID(), label: trimmed }])
    setOptionInput('')
  }

  function removeOption(id) {
    setOptions(prev => prev.filter(o => o.id !== id))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (isSelectType && options.length === 0) {
      setError('Adicione pelo menos uma opção para campos do tipo "Seleção".')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const payload = {
        label:    label.trim(),
        required,
        ...(isSelectType ? { options } : {}),
      }
      if (mode === 'create') {
        payload.field_type = fieldType
      }

      const { data } = mode === 'create'
        ? await api.post(`/admin/demand-types/${typeId}/fields`, payload)
        : await api.patch(`/admin/demand-types/${typeId}/fields/${field.id}`, payload)

      onSave(data, mode)
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Erro ao salvar campo.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      title={mode === 'create' ? 'Novo Campo' : `Editar Campo`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {/* ── Rótulo ─────────────────────────────────────────────────────── */}
        <Field label="Rótulo do campo">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            required
            autoFocus
            placeholder="Ex: CPF do solicitante, Data de entrega…"
            className={inputCls}
          />
        </Field>

        {/* ── Tipo (apenas na criação) ─────────────────────────────────── */}
        {mode === 'create' ? (
          <Field label="Tipo do campo">
            <select
              value={fieldType}
              onChange={e => setFieldType(e.target.value)}
              className={inputCls}
            >
              <option value="text">Texto curto</option>
              <option value="textarea">Texto longo</option>
              <option value="number">Número</option>
              <option value="date">Data</option>
              <option value="select">Seleção (lista de opções)</option>
              <option value="cpf">CPF</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              O tipo não pode ser alterado após a criação do campo.
            </p>
          </Field>
        ) : (
          <div className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2.5">
            <p className="text-xs text-gray-500">
              Tipo:{' '}
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium
                               ${FIELD_TYPE_COLORS[field?.field_type] ?? 'bg-gray-100 text-gray-600'}`}>
                {FIELD_TYPE_LABELS[field?.field_type] ?? field?.field_type}
              </span>
              <span className="ml-2 text-gray-400">(imutável após criação)</span>
            </p>
          </div>
        )}

        {/* ── Obrigatório ──────────────────────────────────────────────── */}
        <Toggle
          checked={required}
          onChange={setRequired}
          label="Campo obrigatório"
          description="O preenchimento deste campo é obrigatório ao criar uma demanda."
        />

        {/* ── Opções (apenas para select) ─────────────────────────────── */}
        {isSelectType && (
          <div>
            <label className="mb-2 block text-xs font-medium text-gray-700">
              Opções de seleção
            </label>

            {/* Chips das opções existentes */}
            {options.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {options.map(opt => (
                  <span
                    key={opt.id}
                    className="flex items-center gap-1.5 rounded-full border border-emerald-200
                               bg-emerald-50 px-3 py-1 text-sm text-emerald-800"
                  >
                    {opt.label}
                    <button
                      type="button"
                      onClick={() => removeOption(opt.id)}
                      className="flex-shrink-0 text-emerald-400 hover:text-emerald-700
                                 focus:outline-none"
                      aria-label={`Remover opção ${opt.label}`}
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mb-3 text-xs text-gray-400 italic">
                Nenhuma opção adicionada ainda.
              </p>
            )}

            {/* Input para nova opção */}
            <div className="flex gap-2">
              <input
                type="text"
                value={optionInput}
                onChange={e => setOptionInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addOption() }
                }}
                placeholder="Digite uma opção e pressione Enter…"
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={addOption}
                disabled={!optionInput.trim()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium
                           text-gray-700 transition-colors hover:bg-gray-50
                           disabled:cursor-not-allowed disabled:opacity-40
                           focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                Adicionar
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={cancelBtnCls}>
            Cancelar
          </button>
          <button type="submit" disabled={isLoading} className={submitBtnCls}>
            {isLoading ? 'Salvando…' : mode === 'create' ? 'Criar Campo' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos de UI (copiados de AdminWorkflows para independência do módulo)
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600
                       focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <div className="relative flex-shrink-0 pt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`h-5 w-9 rounded-full transition-colors
                         ${checked ? 'bg-primary-600' : 'bg-gray-200'}`}>
          <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform
                           ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-gray-500">{description}</p>
        )}
      </div>
    </label>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 ' +
  'placeholder:text-gray-400 focus:border-primary-500 focus:outline-none ' +
  'focus:ring-1 focus:ring-primary-500'

const cancelBtnCls =
  'rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 ' +
  'hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500'

const submitBtnCls =
  'rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white ' +
  'hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60'

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────────

function IconGrip({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
    </svg>
  )
}

function IconChevron({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  )
}

function IconChevronLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
    </svg>
  )
}

function IconX({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  )
}

function IconForm({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  )
}

function IconGear({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  )
}
