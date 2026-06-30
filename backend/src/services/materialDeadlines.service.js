import { query }              from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'
import { logger }             from '#lib/logger.js'

const log = logger.child({ module: 'material-deadlines' })

/**
 * Job diário: alerta quando campanha começa em exatamente 7, 3 ou 1 dia
 * e a demanda vinculada não tem peça criativa (kind='creative') anexada.
 * Notifica: assignee da demanda + todos os super_admins.
 */
export async function runMaterialDeadlineCheck() {
  const thresholds = [7, 3, 1]

  const { rows: admins } = await query(
    `SELECT id FROM users WHERE role = 'super_admin' AND deactivated_at IS NULL`
  )

  for (const days of thresholds) {
    const { rows: campaigns } = await query(
      `SELECT
         c.id, c.title, c.client_name, c.demand_id,
         d.title                 AS demand_title,
         d.current_assignee_id,
         a.name                  AS asset_name,
         a.code                  AS asset_code,
         (SELECT COUNT(*)::int FROM attachments att
          WHERE att.demand_id = c.demand_id AND att.kind = 'creative') AS creative_count
       FROM campaigns c
       LEFT JOIN demands d ON d.id = c.demand_id
       LEFT JOIN assets  a ON a.id = c.asset_id
       WHERE (c.starts_on - CURRENT_DATE) = $1
         AND c.demand_id IS NOT NULL
         AND c.archived_at IS NULL`,
      [days]
    )

    for (const camp of campaigns) {
      if (camp.creative_count > 0) continue   // arte já anexada — sem alerta

      const label   = camp.asset_code ? `[${camp.asset_code}] ${camp.asset_name}` : camp.asset_name
      const message = `⏰ Campanha "${camp.client_name} — ${camp.title}" (${label}) começa em ${days} dia${days > 1 ? 's' : ''} sem arte criativa anexada.`
      const link    = `/demands/${camp.demand_id}`

      const targets = new Set(admins.map(a => String(a.id)))
      if (camp.current_assignee_id) targets.add(String(camp.current_assignee_id))

      for (const userId of targets) {
        createNotification(userId, message, link, 'system')
          .catch(err => log.error({ err }, 'Falha ao notificar prazo de material'))
      }
    }
  }

  log.info('Material deadline check concluído')
}
