import { z } from 'zod'
import * as svc from '#services/report.service.js'

const pad = n => String(n).padStart(2, '0')

const monthlyQuerySchema = z.object({
  year:  z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  dept_id: z.string().uuid().optional(),
})

function handleError(err, res) {
  console.error('[Report]', err)
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function monthly(req, res) {
  try {
    const parsed = monthlyQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(422).json({ error: 'Parâmetros inválidos', details: parsed.error.flatten().fieldErrors })
    }

    const data = await svc.getMonthlyReportData(req.user, parsed.data)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="relatorio-mensal-${parsed.data.year}-${pad(parsed.data.month)}.pdf"`)

    await svc.streamMonthlyReportPdf(data, res)
  } catch (err) { return handleError(err, res) }
}