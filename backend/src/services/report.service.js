import PDFDocument from 'pdfkit'
import * as dashboardSvc from '#services/dashboard.service.js'

const pad = n => String(n).padStart(2, '0')

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export async function getMonthlyReportData(actor, { year, month, dept_id }) {
  const date_from = `${year}-${pad(month)}-01`
  const lastDay = lastDayOfMonth(year, month)
  const date_to = `${year}-${pad(month)}-${pad(lastDay)}`

  const filters = { dept_id, date_from, date_to }

  const [stats, byDepartment, rows] = await Promise.all([
    dashboardSvc.getStats(actor, filters),
    dashboardSvc.getOperationalByDepartment(actor, filters),
    dashboardSvc.getExportRows(actor, filters),
  ])

  return {
    period: { year, month, date_from, date_to },
    stats,
    byDepartment,
    rows,
  }
}

export async function streamMonthlyReportPdf(data, writable) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  doc.pipe(writable)

  const { period, stats, byDepartment, rows } = data
  const m = period.month
  const y = period.year

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  doc.fontSize(18).font('Helvetica-Bold')
  doc.text(`Relatório Mensal — ${pad(m)}/${y}`, { align: 'center' })
  doc.moveDown(0.5)
  doc.fontSize(10).font('Helvetica')
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, { align: 'center' })
  doc.moveDown(1.5)

  // ── Seção 1: Indicadores ───────────────────────────────────────────────────
  doc.fontSize(14).font('Helvetica-Bold')
  doc.text('Indicadores')
  doc.moveDown(0.5)

  const metrics = stats.metrics
  const indicatorLines = [
    `Total de demandas: ${metrics.total_demands}`,
    `Finalizadas: ${metrics.finalized_count}`,
    `Taxa de finalização: ${metrics.finalization_rate.toFixed(1)}%`,
    `Em espera: ${metrics.on_hold_count}`,
    `Canceladas: ${metrics.cancelled_count}`,
    `Tempo médio de resolução: ${metrics.avg_resolution_hours != null ? metrics.avg_resolution_hours.toFixed(1) + ' h' : '—'}`,
  ]

  doc.fontSize(10).font('Helvetica')
  indicatorLines.forEach(line => {
    doc.text(line)
    doc.moveDown(0.3)
  })
  doc.moveDown(1)

  // ── Seção 2: Operacional por departamento ──────────────────────────────────
  if (metrics.total_demands === 0) {
    doc.fontSize(12).font('Helvetica')
    doc.text('Sem demandas criadas no período.')
    doc.end()
    return
  }

  doc.fontSize(14).font('Helvetica-Bold')
  doc.text('Operacional por departamento')
  doc.moveDown(0.5)

  // Helper de tabela: desenha uma linha com TODAS as colunas no mesmo Y.
  // (doc.text avança doc.y a cada chamada — capturar rowY evita o efeito escada.)
  // Quebra de página sozinho preservando a margem inferior.
  const bottomLimit = doc.page.height - 50
  const drawRow = (cells, widths, { bold = false, size = 9 } = {}) => {
    if (doc.y > bottomLimit) doc.addPage()
    const rowY = doc.y
    let cx = 50
    doc.fontSize(size).font(bold ? 'Helvetica-Bold' : 'Helvetica')
    cells.forEach((c, i) => {
      doc.text(String(c ?? ''), cx, rowY, {
        width: widths[i],
        align: i === 0 ? 'left' : 'center',
        ellipsis: true,
      })
      cx += widths[i]
    })
    doc.y = rowY + size + 5
  }

  // Tabela: operacional por departamento
  const colWidths = [180, 60, 70, 60, 60]
  drawRow(['Departamento', 'Total', 'Finalizadas', 'Taxa %', 'Em espera'], colWidths, { bold: true })
  byDepartment.forEach(row => {
    drawRow([
      row.dept_name,
      row.total,
      row.finalized,
      row.finalization_rate != null ? row.finalization_rate.toFixed(1) : '0.0',
      row.on_hold,
    ], colWidths)
  })
  doc.moveDown(1)

  // ── Seção 3: Demandas criadas no período ──────────────────────────────────
  doc.fontSize(14).font('Helvetica-Bold')
  doc.text('Demandas criadas no período')
  doc.moveDown(0.5)

  const detailWidths = [55, 150, 70, 70, 70, 70, 70]
  drawRow(['ID', 'Título', 'Depto', 'Tipo', 'Etapa', 'Responsável', 'Criada em'], detailWidths, { bold: true, size: 8 })
  rows.forEach(row => {
    drawRow([
      row.id.slice(0, 8),
      row.title,
      row.department_name,
      row.demand_type_name,
      row.current_stage_name || '—',
      row.assignee_name || '—',
      new Date(row.created_at).toISOString().slice(0, 10),
    ], detailWidths, { size: 8 })
  })

  doc.end()
}