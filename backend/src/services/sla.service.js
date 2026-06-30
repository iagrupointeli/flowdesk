import { query }              from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'
import { logger }             from '#lib/logger.js'

const log = logger.child({ module: 'sla-check' })

/**
 * Varre demandas abertas com prazo próximo ou vencido e envia notificação
 * SSE + persistida ao responsável de cada uma.
 *
 * Dedup: não envia se já foi criada uma notificação do tipo 'sla_warning'
 * para o mesmo par (user_id, demand) nas últimas 23h — garante no máximo
 * 1 notificação por ciclo de 24h mesmo que o job rode de hora em hora.
 *
 * @returns {{ sent: number, checked: number }}
 */
export async function runSlaCheck() {
  const warnHours = Number(process.env.SLA_WARN_HOURS ?? 24)

  const { rows } = await query(
    `SELECT
       d.id,
       d.title,
       d.due_date,
       d.current_assignee_id,
       EXTRACT(EPOCH FROM (d.due_date - NOW())) / 3600 AS hours_remaining
     FROM demands d
     JOIN demand_types dt ON dt.id = d.demand_type_id
     WHERE d.finalized_at IS NULL
       AND d.due_date IS NOT NULL
       AND d.due_date <= NOW() + ($1::int * INTERVAL '1 hour')
       AND d.current_assignee_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id  = d.current_assignee_id
           AND n.type     = 'sla_warning'
           AND n.link     = '/demands/' || d.id::text
           AND n.created_at >= NOW() - INTERVAL '23 hours'
       )`,
    [warnHours]
  )

  let sent = 0
  for (const row of rows) {
    const h       = Number(row.hours_remaining)
    const link    = `/demands/${row.id}`
    const message = h <= 0
      ? `Prazo vencido: "${row.title.slice(0, 80)}"`
      : `Demanda vence em ${Math.ceil(h)}h: "${row.title.slice(0, 80)}"`

    try {
      await createNotification(row.current_assignee_id, message, link, 'sla_warning')
      sent++
    } catch (err) {
      log.error({ err, demandId: row.id }, 'Falha ao criar notificação de SLA')
    }
  }

  log.info({ sent, checked: rows.length, warnHours }, 'SLA check concluído')
  return { sent, checked: rows.length }
}
