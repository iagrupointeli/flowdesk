/**
 * SLABadge — badge visual de prazo de resolução (SLA).
 *
 * ── Lógica visual ────────────────────────────────────────────────────────────
 *
 *   Sem due_date         → renderiza null (nenhum badge)
 *   Demanda congelada    → badge histórico (não atualiza com o tempo):
 *     - is_final = true ou exception_state = 'cancelled'
 *     - Compara `finalized_at` (quando disponível, do getDemand) OU `updated_at`
 *       com `due_date` para determinar "Concluída no prazo" vs "Concluída com atraso"
 *   Demanda ativa:
 *     - Verde:   folga > 24h restantes
 *     - Âmbar:   0–24h restantes (atenção)
 *     - Vermelho: vencido (now > due_date)
 *
 * ── Props ────────────────────────────────────────────────────────────────────
 *
 *   demand   — objeto de demanda com: due_date, is_final, exception_state,
 *              updated_at, finalized_at (opcional, mais preciso)
 *   compact  — bool (default false). true → badge menor sem ícone, para uso
 *              inline em tabelas/listas
 */
export default function SLABadge({ demand, compact = false }) {
  const { due_date, is_final, exception_state } = demand

  if (!due_date) return null

  const due     = new Date(due_date)
  const now     = new Date()
  const isFrozen = is_final || exception_state === 'cancelled'

  // ── Estado congelado: demanda finalizada ou cancelada ───────────────────────
  if (isFrozen) {
    // finalized_at (subquery em getDemand, mais preciso) ou updated_at (Kanban)
    const resolvedAt = demand.finalized_at
      ? new Date(demand.finalized_at)
      : new Date(demand.updated_at)
    const onTime = resolvedAt <= due

    if (exception_state === 'cancelled') {
      // Canceladas: exibe apenas se havia prazo configurado
      return (
        <Badge
          compact={compact}
          colorCls="bg-gray-100 text-gray-500"
          icon={<IconMinus />}
        >
          {compact ? 'Cancelada' : 'SLA — Cancelada'}
        </Badge>
      )
    }

    return onTime ? (
      <Badge
        compact={compact}
        colorCls="bg-green-100 text-green-700"
        icon={<IconCheck />}
      >
        {compact ? 'No prazo' : 'Concluída no prazo'}
      </Badge>
    ) : (
      <Badge
        compact={compact}
        colorCls="bg-red-100 text-red-600"
        icon={<IconX />}
      >
        {compact ? 'Com atraso' : 'Concluída com atraso'}
      </Badge>
    )
  }

  // ── Estado bloqueado: demanda pausada (on_hold) ──────────────────────────────
  // O banco mantém due_date intocado — apenas a percepção visual é adaptada.
  // Exibir alertas de atraso enquanto a demanda aguarda resolução externa seria
  // ruído: o responsável não pode agir até o desbloqueio.
  if (exception_state !== null) {
    return (
      <Badge
        compact={compact}
        colorCls="bg-blue-100 text-blue-600"
        icon={<IconPause />}
      >
        {compact ? 'Pausado' : 'SLA Pausado'}
      </Badge>
    )
  }

  // ── Estado ativo: calcula tempo restante ─────────────────────────────────────
  const msRemaining = due - now

  if (msRemaining < 0) {
    // Vencido
    const hoursLate = Math.ceil(Math.abs(msRemaining) / (1000 * 60 * 60))
    return (
      <Badge
        compact={compact}
        colorCls="bg-red-100 text-red-700"
        icon={<IconClock />}
      >
        {compact
          ? `+${hoursLate}h`
          : `Atrasado há ${formatDuration(Math.abs(msRemaining))}`}
      </Badge>
    )
  }

  const hoursRemaining = msRemaining / (1000 * 60 * 60)

  if (hoursRemaining < 24) {
    // Atenção: vence em menos de 24h
    const label = hoursRemaining < 1
      ? `${Math.ceil(hoursRemaining * 60)}min`
      : `${Math.ceil(hoursRemaining)}h`
    return (
      <Badge
        compact={compact}
        colorCls="bg-amber-100 text-amber-700"
        icon={<IconClock />}
      >
        {compact ? label : `Vence em ${label}`}
      </Badge>
    )
  }

  // No prazo com folga
  const daysRemaining = Math.ceil(hoursRemaining / 24)
  return (
    <Badge
      compact={compact}
      colorCls="bg-green-50 text-green-700"
      icon={<IconClock />}
    >
      {compact
        ? `${daysRemaining}d`
        : `Prazo: ${daysRemaining} dia${daysRemaining !== 1 ? 's' : ''}`}
    </Badge>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivo de badge
// ─────────────────────────────────────────────────────────────────────────────

function Badge({ colorCls, icon, compact, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${colorCls} ${
        compact
          ? 'px-1.5 py-0.5 text-[10px]'
          : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      {!compact && <span className="flex-shrink-0 opacity-70">{icon}</span>}
      {children}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formata duração em ms para "Xd Yh" ou "Xh" ou "Xmin".
 */
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / (1000 * 60))
  if (totalMinutes < 60) return `${totalMinutes}min`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `${hours}h`
  const days  = Math.floor(hours / 24)
  const remH  = hours % 24
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`
}

// ─────────────────────────────────────────────────────────────────────────────
// Ícones inline (sem dependência externa)
// ─────────────────────────────────────────────────────────────────────────────

function IconClock() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
    </svg>
  )
}

function IconX() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
    </svg>
  )
}

function IconMinus() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z" clipRule="evenodd" />
    </svg>
  )
}

function IconPause() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
    </svg>
  )
}
