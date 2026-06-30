import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useDemandDetailStore } from '../stores/demandDetailStore'
import { useAuthStore }         from '../stores/authStore'
import Timeline                 from '../components/demands/Timeline'
import MoveStageModal           from '../components/demands/MoveStageModal'
import AssignModal              from '../components/demands/AssignModal'
import SLABadge                 from '../components/SLABadge'
import ChecklistBlock           from '../components/demands/ChecklistBlock'
import AttachmentBlock          from '../components/demands/AttachmentBlock'
import CheckingBlock            from '../components/demands/CheckingBlock'
import CreativeBlock            from '../components/demands/CreativeBlock'
import ExternalLinksBlock       from '../components/demands/ExternalLinksBlock'
import TagsBlock                from '../components/demands/TagsBlock'
import CollaboratorsBlock       from '../components/demands/CollaboratorsBlock'

/**
 * Página de detalhes da demanda: /demands/:demandId
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ ← Voltar   TÍTULO                           [Stage badge]     │
 *   │ Departamento · Tipo · Solicitante · Data                       │
 *   │ [Mover Etapa] [Atribuir Responsável] [Bloquear/Desbloquear]   │ ← admins only
 *   ├──────────────────────────┬─────────────────────────────────────┤
 *   │ Informações              │ Atividade (Timeline)                │
 *   │  Responsável             │  [CommentBox]                       │
 *   │  Estado                  │  [Carregar atividade recente]       │
 *   │  Campos dinâmicos        │  ○ evento mais recente              │
 *   │                          │  ○ evento antigo                    │
 *   └──────────────────────────┴─────────────────────────────────────┘
 *
 * ── Regras de fetch ──────────────────────────────────────────────────────────
 *   useEffect → store.fetchDemand(id) + store.fetchTimeline(id)
 *   cleanup   → store.reset() → aborta in-flight + zera estado (anti-flash)
 *
 * ── Ações administrativas (Fase 10) ─────────────────────────────────────────
 *   Mover Etapa:          abre MoveStageModal (reusa requires_note/assignee logic)
 *   Atribuir Responsável: abre AssignModal (UserSelect scoped ao departamento)
 *   Bloquear:             painel inline com notas opcionais → PATCH /exception
 *   Desbloquear:          ação direta → PATCH /exception { exception_state: null }
 *   Todas as mutações: demandDetailStore.* (PATCH + recarrega demand + timeline)
 */
export default function DemandDetail() {
  const { demandId } = useParams()
  const navigate     = useNavigate()

  const demand          = useDemandDetailStore(s => s.demand)
  const isLoadingDemand = useDemandDetailStore(s => s.isLoadingDemand)
  const errorDemand     = useDemandDetailStore(s => s.errorDemand)

  const user = useAuthStore(s => s.user)

  // ── Estado dos modais + ação de bloqueio inline ──────────────────────────
  const [showMoveStageModal, setShowMoveStageModal] = useState(false)
  const [showAssignModal,    setShowAssignModal]    = useState(false)
  const [showBlockPanel,     setShowBlockPanel]     = useState(false)
  const [blockNotes,         setBlockNotes]         = useState('')
  const [actionLoading,      setActionLoading]      = useState(false)
  const [actionError,        setActionError]        = useState(null)

  useEffect(() => {
    if (!demandId) return
    // Dois fetches paralelos — cada um tem seu AbortController próprio na store
    useDemandDetailStore.getState().fetchDemand(demandId)
    useDemandDetailStore.getState().fetchTimeline(demandId)
    return () => useDemandDetailStore.getState().reset()
  }, [demandId])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoadingDemand) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <DemandDetailSkeleton />
      </div>
    )
  }

  // ── Erro ─────────────────────────────────────────────────────────────────
  if (errorDemand) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="font-semibold text-red-700">Erro ao carregar a demanda</p>
          <p className="mt-1 text-sm text-red-500">{errorDemand}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => useDemandDetailStore.getState().fetchDemand(demandId)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Tentar novamente
            </button>
            <button
              onClick={() => navigate(-1)}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!demand) return null

  const isCancelled = demand.exception_state === 'cancelled'
  const isOnHold    = demand.exception_state === 'on_hold'
  const isFinal     = demand.is_final
  const isFrozen    = isCancelled || isFinal
  const isAdmin     = user?.role === 'super_admin' || user?.role === 'dept_admin'
  const isAssignee  = demand.current_assignee_id != null &&
                      user?.id != null &&
                      String(demand.current_assignee_id) === String(user.id)
  // canMoveStage: admin OU responsável atribuído (RBAC granular — service valida também)
  const canMoveStage = (isAdmin || isAssignee) && !isCancelled && !isFinal
  // canAssign e canException: apenas admins
  const canAssign    = isAdmin && !isCancelled && !isFinal
  const canException = isAdmin && !isCancelled

  const currentStage = {
    id:   demand.current_stage_id,
    name: demand.current_stage_name,
  }
  // Campos ativos do snapshot — exibidos normalmente
  const activeFields = (demand.fields_snapshot ?? []).filter(f => !f.archived_at)

  // Campos arquivados do snapshot que possuem um valor salvo no payload.
  // Exibidos como somente leitura para preservar visibilidade histórica.
  // Um campo pode aparecer aqui se o admin o arquivou DEPOIS da criação da demanda.
  const archivedFieldsWithValues = (demand.fields_snapshot ?? []).filter(
    f => f.archived_at && demand.payload?.[f.id] != null && demand.payload?.[f.id] !== ''
  )

  // ── Handler: Bloquear ─────────────────────────────────────────────────────
  async function handleBlock() {
    setActionLoading(true)
    setActionError(null)
    try {
      await useDemandDetailStore.getState().setExceptionState(
        demandId,
        'on_hold',
        blockNotes.trim() || undefined,
      )
      setShowBlockPanel(false)
      setBlockNotes('')
    } catch (err) {
      setActionError(err?.response?.data?.error ?? 'Erro ao bloquear a demanda.')
    } finally {
      setActionLoading(false)
    }
  }

  // ── Handler: Desbloquear ──────────────────────────────────────────────────
  async function handleUnblock() {
    setActionLoading(true)
    setActionError(null)
    try {
      await useDemandDetailStore.getState().setExceptionState(demandId, null)
    } catch (err) {
      setActionError(err?.response?.data?.error ?? 'Erro ao desbloquear a demanda.')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">

      {/* ── Navegação ─────────────────────────────────────────────────────── */}
      <div className="mb-5 flex items-center gap-2 text-sm text-gray-500">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 hover:text-gray-700">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          Voltar
        </button>
        <span>/</span>
        <Link to={`/board/${demand.demand_type_id}`} className="hover:text-primary-600 truncate max-w-[140px]">
          {demand.demand_type_name}
        </Link>
        <span>/</span>
        <span className="truncate max-w-[200px] text-gray-700">{demand.title}</span>
      </div>

      {/* ── Cabeçalho da demanda ──────────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <StageBadge stage={demand.current_stage_name} isFinal={isFinal} />
              <ExceptionBadge state={demand.exception_state} />
              <SLABadge demand={demand} />
            </div>
            <h1 className="text-xl font-bold text-gray-900">{demand.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {demand.department_name} · {demand.demand_type_name}
            </p>
          </div>
          <div className="flex-shrink-0 text-right text-xs text-gray-400 space-y-0.5">
            <p>Aberta {formatDate(demand.created_at)}</p>
            {demand.updated_at !== demand.created_at && (
              <p>Atualizada {formatDate(demand.updated_at)}</p>
            )}
          </div>
        </div>

        {/* ── Action bar (admin ou responsável atribuído) ──────────────────── */}
        {(isAdmin || isAssignee) && (
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {/* Mover Etapa — admin OU assignee */}
              <button
                onClick={() => { setActionError(null); setShowMoveStageModal(true) }}
                disabled={!canMoveStage || actionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300
                           px-3 py-1.5 text-sm font-medium text-gray-700
                           transition-colors hover:bg-gray-50 hover:border-gray-400
                           disabled:cursor-not-allowed disabled:opacity-50"
                title={!canMoveStage ? (isFinal ? 'Demanda já finalizada' : isCancelled ? 'Demanda cancelada' : '') : ''}
              >
                <IconArrowRight className="h-3.5 w-3.5 text-blue-500" />
                Mover Etapa
              </button>

              {/* Atribuir Responsável — apenas admins */}
              {isAdmin && (
                <button
                  onClick={() => { setActionError(null); setShowAssignModal(true) }}
                  disabled={!canAssign || actionLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300
                             px-3 py-1.5 text-sm font-medium text-gray-700
                             transition-colors hover:bg-gray-50 hover:border-gray-400
                             disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconUser className="h-3.5 w-3.5 text-violet-500" />
                  Atribuir Responsável
                </button>
              )}

              {/* Bloquear / Desbloquear — apenas admins, não exibido se cancelada */}
              {isAdmin && !isCancelled && (
                isOnHold ? (
                  <button
                    onClick={handleUnblock}
                    disabled={actionLoading || isFinal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300
                               bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700
                               transition-colors hover:bg-amber-100
                               disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                    ) : (
                      <IconLockOpen className="h-3.5 w-3.5" />
                    )}
                    Desbloquear
                  </button>
                ) : (
                  <button
                    onClick={() => { setActionError(null); setShowBlockPanel(v => !v) }}
                    disabled={!canException || actionLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300
                               px-3 py-1.5 text-sm font-medium text-gray-700
                               transition-colors hover:bg-gray-50 hover:border-gray-400
                               disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <IconLock className="h-3.5 w-3.5 text-amber-500" />
                    Bloquear
                  </button>
                )
              )}
            </div>

            {/* Painel de bloqueio inline */}
            {showBlockPanel && !isOnHold && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-800">
                  Bloquear demanda (colocar em espera)
                </p>
                <textarea
                  rows={2}
                  value={blockNotes}
                  onChange={e => setBlockNotes(e.target.value)}
                  disabled={actionLoading}
                  placeholder="Motivo do bloqueio (opcional)…"
                  className="w-full resize-none rounded-lg border border-amber-300 bg-white
                             px-3 py-2 text-sm placeholder-gray-400
                             focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-400
                             disabled:bg-gray-50"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowBlockPanel(false); setBlockNotes('') }}
                    disabled={actionLoading}
                    className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800
                               disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleBlock}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500
                               px-3 py-1.5 text-sm font-semibold text-white
                               hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : null}
                    Confirmar bloqueio
                  </button>
                </div>
              </div>
            )}

            {/* Erro de ação */}
            {actionError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {actionError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Corpo: 2 colunas em md+ ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">

        {/* Coluna esquerda: metadados + campos */}
        <aside className="space-y-4">

          {/* Descrição */}
          <Section title="Descrição">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {demand.description}
            </p>
          </Section>

          {/* Metadados */}
          <Section title="Informações">
            <dl className="space-y-2 text-sm">
              <MetaRow label="Solicitante"  value={demand.requester_name ?? '—'} />
              <MetaRow label="Responsável"  value={demand.assignee_name ?? 'Não atribuído'} />
              <MetaRow label="Departamento" value={demand.department_name} />
              <MetaRow label="Etapa atual"  value={demand.current_stage_name ?? '—'} />
              {demand.asset_name && (
                <MetaRow
                  label="Ponto"
                  value={demand.asset_code
                    ? `[${demand.asset_code}] ${demand.asset_name}`
                    : demand.asset_name}
                />
              )}
              {demand.due_date && (
                <MetaRow
                  label="Prazo SLA"
                  value={
                    <span className="flex items-center gap-2">
                      <span>{formatDate(demand.due_date)}</span>
                      <SLABadge demand={demand} compact />
                    </span>
                  }
                />
              )}
            </dl>
          </Section>

          {/* Tags */}
          <TagsBlock
            demandId={demandId}
            departmentId={demand.department_id}
            initialTags={demand.tags ?? []}
            isFrozen={isFrozen}
          />

          {/* Colaboradores (seguidores cross-department) */}
          <CollaboratorsBlock demandId={demandId} isFrozen={isFrozen} />

          {/* Checklist */}
          <ChecklistBlock demandId={demandId} isFrozen={isFrozen} />

          {/* Anexos */}
          <AttachmentBlock demandId={demandId} isFrozen={isFrozen} />

          {/* Peças criativas com controle de versão */}
          <CreativeBlock demandId={demandId} isFrozen={isFrozen} />

          {/* Checking fotográfico (evidências + relatório PDF) */}
          <CheckingBlock demandId={demandId} isFrozen={isFrozen} />

          {/* Portal do prestador externo */}
          <ExternalLinksBlock demandId={demandId} isFrozen={isFrozen} />

          {/* Campos dinâmicos (ativos + arquivados com valor histórico) */}
          {(activeFields.length > 0 || archivedFieldsWithValues.length > 0) && (
            <Section title="Campos específicos">
              <dl className="space-y-2 text-sm">
                {activeFields.map(field => (
                  <MetaRow
                    key={field.id}
                    label={field.label}
                    value={formatFieldValue(demand.payload?.[field.id], field)}
                  />
                ))}
                {archivedFieldsWithValues.map(field => (
                  <MetaRow
                    key={field.id}
                    label={
                      <span className="flex items-center gap-1">
                        <span className="line-through text-gray-300">{field.label}</span>
                        <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px]
                                         font-medium text-gray-400 no-underline">
                          arquivado
                        </span>
                      </span>
                    }
                    value={
                      <span className="text-gray-400 italic">
                        {formatFieldValue(demand.payload?.[field.id], field)}
                      </span>
                    }
                  />
                ))}
              </dl>
            </Section>
          )}
        </aside>

        {/* Coluna direita: timeline + comentários */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <Timeline
            demandId={demandId}
            currentStage={currentStage}
            isCancelled={isCancelled}
          />
        </div>
      </div>

      {/* ── Modais ────────────────────────────────────────────────────────── */}
      {showMoveStageModal && (
        <MoveStageModal
          demand={demand}
          onClose={() => setShowMoveStageModal(false)}
        />
      )}

      {showAssignModal && (
        <AssignModal
          demand={demand}
          onClose={() => setShowAssignModal(false)}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h2>
      {children}
    </div>
  )
}

function MetaRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-700">{value ?? '—'}</dd>
    </div>
  )
}

function StageBadge({ stage, isFinal }) {
  if (!stage) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
      isFinal
        ? 'bg-green-100 text-green-700'
        : 'bg-blue-100 text-blue-700'
    }`}>
      {stage}
    </span>
  )
}

function ExceptionBadge({ state }) {
  if (!state) return null
  const configs = {
    on_hold:   { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Em espera' },
    cancelled: { bg: 'bg-red-100',   text: 'text-red-700',   label: 'Cancelada' },
  }
  const c = configs[state]
  if (!c) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

function DemandDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-6 w-64 rounded bg-gray-200" />
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="h-5 w-24 rounded bg-gray-200" />
        <div className="h-7 w-3/4 rounded bg-gray-200" />
        <div className="h-4 w-48 rounded bg-gray-100" />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 rounded-xl bg-gray-100" />)}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-3">
              <div className="h-7 w-7 rounded-full bg-gray-200 flex-shrink-0" />
              <div className="flex-1 space-y-1.5 pt-1">
                <div className="h-4 w-3/4 rounded bg-gray-200" />
                <div className="h-3 w-20 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatadores
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

/**
 * Formata o valor de um campo dinâmico para exibição legível.
 *   - select: resolve a label da option pelo id
 *   - cpf:    aplica máscara ###.###.###-##
 *   - date:   formata para pt-BR
 *   - outros: retorna o valor como string
 */
function formatFieldValue(value, field) {
  if (value === undefined || value === null || value === '') return '—'

  switch (field.field_type) {
    case 'select': {
      const opt = (field.options ?? []).find(o => String(o.id) === String(value))
      return opt?.label ?? String(value)
    }
    case 'cpf': {
      const digits = String(value).replace(/\D/g, '').padEnd(11, '0').slice(0, 11)
      return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`
    }
    case 'date': {
      const d = new Date(value)
      return isNaN(d.getTime())
        ? String(value)
        : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    }
    case 'number':
      return Number(value).toLocaleString('pt-BR')
    default:
      return String(value)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG inline
// ─────────────────────────────────────────────────────────────────────────────

function IconArrowRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
    </svg>
  )
}

function IconUser({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
    </svg>
  )
}

function IconLock({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
    </svg>
  )
}

function IconLockOpen({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M14.5 1A4.5 4.5 0 0010 5.5V9H3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1.5V5.5a3 3 0 116 0v2.75a.75.75 0 001.5 0V5.5A4.5 4.5 0 0014.5 1z" clipRule="evenodd" />
    </svg>
  )
}
