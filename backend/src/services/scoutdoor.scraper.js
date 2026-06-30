import { query }  from '#config/database.js'
import { logger } from '#lib/logger.js'

const log     = logger.child({ module: 'scoutdoor-scraper' })
const BASE    = 'https://www.scoutdoor.com.br'
const DELAY   = 350 // ms entre requests — respeita o servidor deles

// ── Estado in-memory do job (um sync por vez) ─────────────────────────────────

export const syncStatus = {
  running:    false,
  started:    null,
  done:       false,
  error:      null,
  total:      0,
  processed:  0,
  created:    0,
  updated:    0,
  skipped:    0,
  errors:     0,
}

function reset() {
  Object.assign(syncStatus, {
    running: true, started: new Date().toISOString(), done: false,
    error: null, total: 0, processed: 0, created: 0, updated: 0, skipped: 0, errors: 0,
  })
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InteliONE-Sync/1.0; +https://intelione.com.br)' },
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function extractSlugs(html) {
  // Hrefs são relativos: href="outdoor-em-city-santa-catarina-ponto-CODE"
  const re = /href=["'](?:https?:\/\/[^"']*?\/)?([^"']*-santa-catarina-ponto-[^"'/?#\s]+)\/?["']/gi
  const set = new Set()
  let m
  while ((m = re.exec(html)) !== null) {
    const slug = m[1].replace(/\/$/, '').trim()
    if (slug && !slug.startsWith('http')) set.add(slug)
  }
  return [...set]
}


const TYPE_MAP = {
  outdoor:           'outdoor',
  frontlight:        'painel',
  'front-light':     'painel',
  'painel-rodoviario':'painel',
  led:               'led',
  empena:            'empena',
  lona:              'lona',
  mub:               'mub',
}

function parsePoint(html, slug) {
  // Código: último segmento após "ponto-"
  const codeM = slug.match(/ponto-([^/]+)$/)
  const code   = codeM ? codeM[1].toUpperCase() : null

  // Tipo de mídia: prefixo do slug antes de "-em-"
  const typeSlug  = slug.split('-em-')[0].toLowerCase()
  const asset_type = TYPE_MAP[typeSlug] ?? 'outro'

  // Cidade: porção entre "-em-" e "-santa-catarina-ponto-"
  const cityM = slug.match(/-em-(.+?)-santa-catarina-ponto-/)
  const city   = cityM
    ? cityM[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : null

  // Dimensões: padrão "9,00 x 3,00m"
  const dimM      = html.match(/(\d+[.,]\d+\s*[xX×]\s*\d+[.,]\d+\s*m?)/i)
  const dimensions = dimM ? dimM[1].trim() : null

  // Foto: src relativo sem barra inicial, com query string de cache
  // ex: imagem/SC/pontos/96523_whatsapp_image_2026-06-17_at_17.webp?1781726882
  const photoM   = html.match(/src=["']([^"']*imagem\/SC\/pontos\/[^"'?#\s]+\.\w+)/i)
  const photo_url = photoM
    ? (photoM[1].startsWith('http') ? photoM[1] : `${BASE}/${photoM[1].replace(/^\//, '')}`)
    : null

  // Endereço: busca heading com referência de via
  let address = null
  const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]{5,200}?)<\/h[1-4]>/gi)]
  for (const [, text] of headings) {
    const clean = text.replace(/<[^>]+>/g, '').trim()
    if (/\b(BR|SC|Av\.|Rua|Rod\.|Estrada|KM\s*\d|Avenida)\b/i.test(clean) && clean.length < 250) {
      address = clean
      break
    }
  }

  // Impressões mensais
  const impM              = html.match(/([\d.]+)\s*visualiza/i)
  const impressions_monthly = impM ? parseInt(impM[1].replace(/\./g, '')) : null

  const name = address ?? `${asset_type.charAt(0).toUpperCase() + asset_type.slice(1)} ${code ?? ''}${city ? ` - ${city}` : ''}`.trim()

  return { code, name, asset_type, city, address, dimensions,
           photo_url, state: 'SC', source: 'scoutdoor', impressions_monthly }
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsert(point) {
  const { code, name, asset_type, city, address, dimensions,
          photo_url, state, source, impressions_monthly } = point

  if (!code) return 'skipped'

  const { rows } = await query(
    `INSERT INTO assets
       (code, name, asset_type, city, address, dimensions, photo_url,
        state, source, impressions_monthly)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (code) WHERE code IS NOT NULL AND archived_at IS NULL
     DO UPDATE SET
       name                 = EXCLUDED.name,
       asset_type           = EXCLUDED.asset_type,
       city                 = EXCLUDED.city,
       address              = EXCLUDED.address,
       dimensions           = EXCLUDED.dimensions,
       photo_url            = COALESCE(EXCLUDED.photo_url, assets.photo_url),
       impressions_monthly  = EXCLUDED.impressions_monthly
     RETURNING (xmax = 0) AS inserted`,
    [code, name, asset_type, city, address, dimensions,
     photo_url, state, source, impressions_monthly]
  )

  return rows[0]?.inserted ? 'created' : 'updated'
}

// ── Runner principal ──────────────────────────────────────────────────────────

export async function runScoutdoorSync() {
  if (syncStatus.running) return { already: true }

  reset()
  log.info('Scoutdoor sync iniciado')

  // Roda em background — não bloqueia o request
  ;(async () => {
    try {
      // Fase 1: coletar todos os slugs percorrendo as páginas de listagem
      const allSlugs = new Set()

      // Carrega a primeira página e calcula total de páginas pelo contador do site
      const firstHtml   = await fetchHtml(`${BASE}/pontos/`)
      extractSlugs(firstHtml).forEach(s => allSlugs.add(s))

      // Itera páginas via ?paged=N até não encontrar novos slugs
      let page = 2
      while (true) {
        await sleep(DELAY)
        const pageUrl = `${BASE}/pontos/?paged=${page}`
        let stopped = false
        try {
          const html   = await fetchHtml(pageUrl)
          const before = allSlugs.size
          extractSlugs(html).forEach(s => allSlugs.add(s))
          if (allSlugs.size === before) { stopped = true }  // página vazia ou repetida
          if (page % 50 === 0) log.info({ page, slugs: allSlugs.size }, 'Progresso coleta')
        } catch (err) {
          log.warn({ pageUrl, err: err.message }, 'Erro buscando página de listagem')
          stopped = true
        }
        if (stopped) break
        page++
      }
      log.info({ pages: page, slugs: allSlugs.size }, 'Coleta de slugs concluída')

      syncStatus.total = allSlugs.size
      log.info({ total: syncStatus.total }, 'Total de pontos encontrados')

      // Fase 2: scrape de cada ponto individual
      for (const slug of allSlugs) {
        try {
          const html   = await fetchHtml(`${BASE}/${slug}/`)
          const point  = parsePoint(html, slug)
          const result = await upsert(point)
          if (result === 'created') syncStatus.created++
          else if (result === 'updated') syncStatus.updated++
          else syncStatus.skipped++
        } catch (err) {
          syncStatus.errors++
          log.warn({ slug, err: err.message }, 'Falha ao processar ponto')
        }
        syncStatus.processed++
        await sleep(DELAY)
      }

      syncStatus.done    = true
      syncStatus.running = false
      log.info(syncStatus, 'Scoutdoor sync concluído')
    } catch (err) {
      syncStatus.error   = err.message
      syncStatus.running = false
      syncStatus.done    = true
      log.error({ err }, 'Scoutdoor sync falhou')
    }
  })()

  return { started: true }
}
