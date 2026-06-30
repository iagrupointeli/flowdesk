import { z }    from 'zod'
import * as svc from '#services/assets.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

const assetTypeEnum = z.enum(['painel', 'empena', 'led', 'lona', 'outdoor', 'mub', 'outro'])

const createSchema = z.object({
  code:       z.string().max(50).optional().nullable(),
  name:       z.string().min(2).max(200),
  asset_type: assetTypeEnum.optional().default('painel'),
  address:    z.string().max(500).optional().nullable(),
  city:       z.string().max(120).optional().nullable(),
  dimensions: z.string().max(80).optional().nullable(),
  notes:      z.string().max(2000).optional().nullable(),
  is_premium: z.boolean().optional(),
})

const updateSchema = createSchema.partial()

export async function list(req, res) {
  try {
    const { rows, total } = await svc.listAssets(req.query)
    // Total completo do filtro vai no header → body permanece array puro
    // (contrato consumido pelo select de pontos do NewDemand sem alteração).
    res.set('X-Total-Count', String(total))
    return res.json(rows)
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.createAsset(parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function update(req, res) {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.updateAsset(req.params.id, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function archive(req, res) {
  try {
    await svc.archiveAsset(req.params.id)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}

export async function uploadPhoto(req, res) {
  // busboy lida com o multipart — não usa express.json() aqui
  try {
    return res.status(201).json(await svc.uploadAssetPhoto(req.params.id, req))
  } catch (err) { return handleError(err, res) }
}

export async function idleAssets(req, res) {
  const horizonDays = Number(req.query.horizon_days ?? 30)
  try {
    return res.json(await svc.getIdleAssets(horizonDays))
  } catch (err) { return handleError(err, res) }
}

export async function occupancyGrid(req, res) {
  const { from, to, city, asset_type } = req.query
  if (!from || !to) return res.status(422).json({ error: 'from e to são obrigatórios.' })
  try {
    return res.json(await svc.getOccupancyGrid({ from, to, city, asset_type }))
  } catch (err) { return handleError(err, res) }
}

export async function availability(req, res) {
  const { from, to } = req.query
  if (!from || !to) return res.status(422).json({ error: 'from e to são obrigatórios.' })
  try {
    return res.json(await svc.checkAvailability(req.params.id, from, to))
  } catch (err) { return handleError(err, res) }
}

export async function timeline(req, res) {
  try {
    return res.json(await svc.getAssetTimeline(req.params.id))
  } catch (err) { return handleError(err, res) }
}
