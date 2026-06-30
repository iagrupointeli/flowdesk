import * as svc from '#services/portfolios.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function list(req, res) {
  try {
    return res.json(await svc.listPortfolios({ q: req.query.q }))
  } catch (err) { return handleError(err, res) }
}

export async function detail(req, res) {
  try {
    const clientName = decodeURIComponent(req.params.clientName)
    return res.json(await svc.getPortfolioDetail(clientName))
  } catch (err) { return handleError(err, res) }
}
