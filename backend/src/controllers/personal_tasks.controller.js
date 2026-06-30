import * as svc from '#services/personal_tasks.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function list(req, res) {
  try {
    const tasks = await svc.listTasks(req.user.id, req.user.role, {
      assigneeId: req.query.assignee_id,
    })
    return res.json(tasks)
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  try {
    const task = await svc.createTask(req.user.id, req.body)
    return res.status(201).json(task)
  } catch (err) { return handleError(err, res) }
}

export async function update(req, res) {
  try {
    const task = await svc.updateTask(req.params.id, req.user.id, req.user.role, req.body)
    return res.json(task)
  } catch (err) { return handleError(err, res) }
}

export async function reorder(req, res) {
  try {
    const task = await svc.reorderTask(
      req.params.id,
      req.user.id,
      req.user.role,
      req.body.position
    )
    return res.json(task)
  } catch (err) { return handleError(err, res) }
}

export async function archive(req, res) {
  try {
    await svc.archiveTask(req.params.id, req.user.id, req.user.role)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}
