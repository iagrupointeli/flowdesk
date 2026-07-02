import { query } from '#config/database.js'

// ── submitIdea ───────────────────────────────────────────────────────────────
// "Tive uma ideia" no Header cria uma tarefa direto no projeto "Ideias -
// Geral" da área "Inovação". Resolvido por nome (não por UUID fixo) pra
// funcionar igual em qualquer ambiente — local ou produção têm IDs
// diferentes pro mesmo par área/projeto.
export async function submitIdea(userId, { title, notes }) {
  const { rows: [project] } = await query(
    `SELECT p.id, p.name
     FROM projects p
     JOIN areas a ON a.id = p.area_id
     WHERE p.name = 'Ideias - Geral' AND a.name = 'Inovação' AND p.archived_at IS NULL
     LIMIT 1`
  )
  if (!project) {
    const e = new Error('Projeto "Ideias - Geral" (área Inovação) não encontrado.')
    e.status = 500
    throw e
  }

  const { rows: [{ next_pos }] } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
     FROM personal_tasks
     WHERE project_id = $1 AND section IS NULL AND archived_at IS NULL`,
    [project.id]
  )

  // Sem assignee: fica na fila do quadro até alguém da área Inovação assumir.
  const { rows: [task] } = await query(
    `INSERT INTO personal_tasks (title, notes, project_id, position, created_by, project)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [title, notes ?? null, project.id, next_pos, userId, project.name]
  )
  return task
}
