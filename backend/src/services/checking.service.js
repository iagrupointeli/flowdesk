import PDFDocument         from 'pdfkit'
import { query }           from '#config/database.js'
import { getDemand }       from '#services/demands.service.js'
import { getObjectBuffer } from '#services/storage.service.js'
import { logger }          from '#lib/logger.js'

const log = logger.child({ module: 'checking-report' })

/** Extensões de imagem que o pdfkit consegue embutir nativamente */
const PDF_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png'])

function isPdfEmbeddable(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase() ?? ''
  return PDF_IMAGE_EXT.has(ext)
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

/**
 * Gera o Relatório de Checking em PDF e escreve direto no response stream.
 *
 * Estrutura do documento:
 *   1. Cabeçalho — título, demanda, ponto, período
 *   2. Grade de evidências — 2 fotos por linha, com data e autor
 *   3. Rodapé — gerado por FlowDesk + timestamp
 *
 * Fotos não-embutíveis (webp/gif/pdf) são listadas em texto no final.
 */
export async function generateCheckingReport(actor, demandId, res) {
  // Valida acesso (lança 403/404 antes de qualquer byte ser enviado)
  const demand = await getDemand(actor, demandId)

  const { rows: evidences } = await query(
    `SELECT a.id, a.file_path, a.file_name, a.entered_at,
            u.name AS uploaded_by_name
     FROM attachments a
     JOIN users u ON u.id = a.uploaded_by
     WHERE a.demand_id = $1 AND a.kind = 'checking'
     ORDER BY a.entered_at ASC`,
    [demandId]
  )

  if (!evidences.length) {
    throw Object.assign(
      new Error('Nenhuma evidência de checking anexada a esta demanda.'),
      { status: 422 }
    )
  }

  // ── Headers HTTP (antes do primeiro byte do PDF) ────────────────────────────
  const safeTitle = demand.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60).trim() || 'checking'
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition',
    `attachment; filename="checking-${safeTitle.replace(/\s+/g, '-').toLowerCase()}.pdf"`)

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true })
  doc.pipe(res)

  const pageW    = doc.page.width - 100   // largura útil (margens de 50)
  const colW     = (pageW - 20) / 2       // 2 colunas com gap de 20
  const imgH     = 200

  // ── Cabeçalho ───────────────────────────────────────────────────────────────
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#111827')
     .text('Relatório de Checking')
  doc.moveDown(0.3)
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
     .text(`Gerado em ${fmtDate(new Date().toISOString())}`)
  doc.moveDown(1)

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827').text(demand.title)
  doc.moveDown(0.3)

  doc.fontSize(10).font('Helvetica').fillColor('#374151')
  doc.text(`Tipo: ${demand.demand_type_name}   ·   Departamento: ${demand.department_name}`)
  if (demand.asset_name) {
    doc.text(`Ponto: ${demand.asset_code ? `[${demand.asset_code}] ` : ''}${demand.asset_name}`)
  }
  doc.text(`Criada em: ${fmtDate(demand.created_at)}`
    + (demand.finalized_at ? `   ·   Concluída em: ${fmtDate(demand.finalized_at)}` : ''))
  doc.text(`Evidências: ${evidences.length} foto(s)`)

  doc.moveDown(0.5)
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
     .strokeColor('#e5e7eb').lineWidth(1).stroke()
  doc.moveDown(1)

  // ── Grade de evidências (2 por linha) ───────────────────────────────────────
  const embeddable = []
  const skipped    = []
  for (const ev of evidences) {
    if (isPdfEmbeddable(ev.file_name)) embeddable.push(ev)
    else skipped.push(ev)
  }

  let col = 0
  for (const ev of embeddable) {
    let buffer
    try {
      buffer = await getObjectBuffer(ev.file_path)
    } catch (err) {
      log.error({ err, attachmentId: ev.id }, 'Falha ao baixar evidência do MinIO')
      skipped.push(ev)
      continue
    }

    // Quebra de página se a próxima imagem não cabe
    if (doc.y + imgH + 30 > doc.page.height - 50) {
      doc.addPage()
      col = 0
    }

    const x = 50 + col * (colW + 20)
    const yStart = doc.y

    try {
      doc.image(buffer, x, yStart, { fit: [colW, imgH], align: 'center' })
    } catch (err) {
      log.error({ err, attachmentId: ev.id }, 'pdfkit falhou ao embutir imagem')
      skipped.push(ev)
      continue
    }

    doc.fontSize(8).fillColor('#6b7280')
       .text(`${fmtDate(ev.entered_at)} · ${ev.uploaded_by_name}`,
             x, yStart + imgH + 4, { width: colW, align: 'center' })

    col = (col + 1) % 2
    if (col === 0) {
      doc.y = yStart + imgH + 25
    } else {
      doc.y = yStart    // segunda coluna: mesma linha
    }
  }
  if (col === 1) doc.y += imgH + 25   // fecha linha incompleta

  // ── Arquivos não embutíveis ─────────────────────────────────────────────────
  if (skipped.length) {
    doc.moveDown(1)
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#9ca3af')
       .text(`Outros arquivos de evidência (não exibidos): ${skipped.map(s => s.file_name).join(', ')}`,
             50, doc.y, { width: pageW })
  }

  // ── Rodapé em todas as páginas ──────────────────────────────────────────────
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
       .text(`FlowDesk · Relatório de Checking · página ${i + 1} de ${range.count}`,
             50, doc.page.height - 35, { width: pageW, align: 'center' })
  }

  doc.end()
}
