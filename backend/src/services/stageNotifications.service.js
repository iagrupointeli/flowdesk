// backend/src/services/stageNotifications.service.js
import { query } from '#config/database.js'

export async function getByStage(stageId) {
  const { rows } = await query(
    'SELECT * FROM stage_notifications WHERE stage_id = $1',
    [stageId]
  )
  return rows[0] ?? null
}

export async function upsert(stageId, { notify_requester, notify_assignee, message_template }) {
  const { rows } = await query(
    `INSERT INTO stage_notifications (stage_id, notify_requester, notify_assignee, message_template)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stage_id) DO UPDATE
       SET notify_requester  = EXCLUDED.notify_requester,
           notify_assignee   = EXCLUDED.notify_assignee,
           message_template  = EXCLUDED.message_template,
           updated_at        = NOW()
     RETURNING *`,
    [stageId, notify_requester, notify_assignee, message_template]
  )
  return rows[0]
}

export async function remove(stageId) {
  await query('DELETE FROM stage_notifications WHERE stage_id = $1', [stageId])
}
