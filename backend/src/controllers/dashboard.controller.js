import * as svc from '#services/dashboard.service.js'

function handleError(err, res) {
  console.error('[Dashboard]', err)
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

/**
 * GET /api/dashboard
 * Query params: dept_id, date_from, date_to
 */
export async function stats(req, res) {
  try {
    const result = await svc.getStats(req.user, req.query)
    return res.json(result)
  } catch (err) { return handleError(err, res) }
}

/**
 * GET /api/dashboard/tv
 * Dados agregados para o Modo TV (polling 60s, sem filtros).
 */
export async function tv(req, res) {
  try {
    const result = await svc.getTvData(req.user)
    return res.json(result)
  } catch (err) { return handleError(err, res) }
}

/**
 * GET /api/dashboard/export
 * Retorna CSV com as demandas do período/filtro.
 * Content-Disposition: attachment — browser inicia download direto.
 */
export async function exportCsv(req, res) {
  try {
    const rows = await svc.getExportRows(req.user, req.query)
    const csv  = svc.rowsToCsv(rows)
    const filename = `relatorio-${new Date().toISOString().slice(0, 10)}.csv`

    res.setHeader('Content-Type',        'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    // BOM UTF-8 para compatibilidade com Excel
    return res.send('﻿' + csv)
  } catch (err) { return handleError(err, res) }
}

/**
 * GET /api/dashboard/commercial
 * Dashboard Comercial agregado por cliente (campanhas).
 * Query params: date_from, date_to (ISO date strings, opcionais)
 */
export async function commercial(req, res) {
  try {
    const result = await svc.getCommercialByClient(req.user, req.query)
    return res.json(result)
  } catch (err) { return handleError(err, res) }
}
