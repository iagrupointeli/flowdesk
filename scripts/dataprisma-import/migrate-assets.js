#!/usr/bin/env node
/**
 * migrate-assets.js — Dataprisma (MySQL) → InteliONE (PostgreSQL 16)
 *
 * Ingestão idempotente de pontos OOH via STREAMING (memória constante).
 * Lê a origem linha-a-linha com cursor do mysql2, resolve cidade/UF/tipo em
 * memória (lookups pré-carregados), acumula em lotes de 5.000 e grava no destino
 * com ON CONFLICT (external_code) DO UPDATE.
 *
 * ARQUITETURA DE DADOS (confirmada via --discover, 2026-06):
 *   Tabela origem : backup_pontos_2025 (152.010 linhas; PK composta id+area)
 *     area        → UF/região comercial ('SP','SC',...,'NORDESTE','DFGOIAS')
 *     titulo      → nome/código do ponto ('A15038TH')
 *     cidade(int) → FK p/ out785_pontos_cidades.id → nome real + sigla (UF)
 *     tipo(int)   → FK p/ out785_pontos_tipos (id,area) → 'Outdoor','Front-Light',…
 *     lat,lng     → coordenadas (varchar, às vezes vazias)
 *     complemento → às vezes a dimensão ('9,00 x 3,00')
 *     audienciaTotal → impressões
 *   external_code → 'SC-12666' (area-id): determinístico, único, idempotente
 *
 * Flags:
 *   --discover           Schema + amostra + distribuição por area e sai
 *   --state <UF>         Filtra por area (ex: SC, SP, NORDESTE)
 *   --limit <n>          Limita a n registros (POC)
 *   --dry-run            Lê/mapeia sem gravar (não exige conexão de destino)
 *   --table <nome>       Tabela de origem (padrão: backup_pontos_2025)
 *   --offset <n>         Pula os primeiros n registros (retomada)
 *   --sample <n>         No dry-run, imprime os n primeiros registros mapeados
 *
 * Exemplos:
 *   node migrate-assets.js --discover
 *   node migrate-assets.js --state SC --limit 1000 --dry-run --sample 3
 *   node migrate-assets.js --state SC --limit 1000
 *   node migrate-assets.js --state SC
 *   node migrate-assets.js
 */

import mysql from 'mysql2/promise'
import pg    from 'pg'
import { parseArgs }     from 'node:util'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── Carrega .env local (tolerante a BOM) ─────────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dir, '.env')
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8').replace(/^﻿/, '')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ════════════════════════════════════════════════════════════════════════════

const BATCH_SIZE    = 5_000
const SOURCE_TABLE  = process.env.SOURCE_TABLE  ?? 'out785_pontos'   // tabela viva (~170k)
const SOURCE_UF_COL = process.env.SOURCE_UF_COL ?? 'area'           // coluna de UF/região
const CITY_TABLE    = process.env.CITY_TABLE    ?? 'out785_pontos_cidades'
const TYPE_TABLE    = process.env.TYPE_TABLE    ?? 'out785_pontos_tipos'
const PHOTO_BASE    = process.env.PHOTO_BASE_URL ?? ''              // prefixo opcional p/ imagem

// Mapeamento area → department_id no InteliONE (multi-tenancy).
// Preencha após: SELECT id, name FROM departments WHERE archived_at IS NULL;
// Areas ausentes → department_id = NULL (ativo compartilhado/holding).
const DEPT_MAP = JSON.parse(process.env.DEPT_MAP ?? '{}')

const UF_VALID = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
])

// ── Classificador de tipo OOH → enums InteliONE ──────────────────────────────
// asset_type:     ('painel','empena','led','lona','outdoor','mub','outro')   [mig 024]
// structure_type: ('mastro_metalico','totem','parede','cobertura','digital','outro') [mig 043]
const norm = s => (s ?? '').toString().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim()

function classify(tipoName) {
  const n = norm(tipoName)
  if (!n)                                                   return { asset_type: 'outro',   structure_type: null }
  if (n.includes('led') || n.includes('digital'))          return { asset_type: 'led',     structure_type: 'digital' }
  if (n.includes('empena'))                                return { asset_type: 'empena',  structure_type: 'parede' }
  if (n.includes('mobiliario') || n.includes('abrigo'))    return { asset_type: 'mub',     structure_type: 'outro' }
  if (n.includes('totem'))                                 return { asset_type: 'painel',  structure_type: 'totem' }
  if (n.includes('outdoor'))                               return { asset_type: 'outdoor', structure_type: 'mastro_metalico' }
  if (n.includes('lona') || n.includes('impressao'))       return { asset_type: 'lona',    structure_type: 'outro' }
  if (/(front|rodoviari|top sight|topsight|placa|triedro|paine|passarela)/.test(n))
                                                           return { asset_type: 'painel',  structure_type: 'mastro_metalico' }
  if (/(busdoor|backbus|taxidoor|cardoor|onibus|metro|trem|aeroporto|indoor|container|pedagio|carro)/.test(n))
                                                           return { asset_type: 'outro',   structure_type: 'outro' }
  return { asset_type: 'outro', structure_type: null }
}

const titleCase = s => (s ?? '').toString().toLowerCase()
  .replace(/(^|\s|-)([a-zà-ú])/g, (_, p, ch) => p + ch.toUpperCase())

// ════════════════════════════════════════════════════════════════════════════
// MAPEAMENTO DE LINHA  (usa lookups pré-carregados — zero query por linha)
// ════════════════════════════════════════════════════════════════════════════

function mapRow(row, ctx) {
  const area = (row[SOURCE_UF_COL] ?? '').toString().toUpperCase().trim()

  // Cidade + UF reais via lookup
  const cityRow = ctx.cityMap.get(Number(row.cidade))
  const city  = cityRow ? titleCase(cityRow.name) : null
  let   state = cityRow?.uf?.toUpperCase().slice(0, 2) || null
  if (!state && UF_VALID.has(area)) state = area     // fallback: area já é UF válida

  // Tipo → enums
  const tipoName = ctx.typeMap.get(`${area}:${row.tipo}`) ?? null
  const { asset_type, structure_type } = classify(tipoName)

  // Código de negócio (coluna CÓDIGO): codigoUnico é único e nunca vazio
  const codigoUnico = (row.codigoUnico ?? '').toString().trim()
  const code = (codigoUnico || `${area}${row.id}`).slice(0, 50)

  // Endereço
  const address = [row.endereco, row.bairro, city, state]
    .map(x => (x ?? '').toString().trim()).filter(Boolean).join(', ') || null

  // complemento é ambíguo: ora dimensão ("9,00 x 3,00m"), ora referência ("Terminal Urbano").
  // Extrai SÓ o padrão LxA; o resto (referência/iluminação) vai para notes.
  const compl = (row.complemento ?? '').toString().trim()
  const dimMatch = compl.match(/(\d+[.,]?\d*)\s*[xX]\s*(\d+[.,]?\d*)/)
  const dimensions = dimMatch
    ? `${dimMatch[1].replace('.', ',')}x${dimMatch[2].replace('.', ',')}m`.slice(0, 80)
    : null
  const iluminado = /ilumin/i.test(compl)
  const reference = (!dimMatch && /[a-zA-ZÀ-ÿ]{3,}/.test(compl)) ? compl : null

  // Coordenadas (preservadas em notes; InteliONE ainda não tem colunas geo)
  const lat = parseFloat((row.lat ?? '').toString().replace(',', '.')) || null
  const lng = parseFloat((row.lng ?? '').toString().replace(',', '.')) || null

  const noteParts = []
  if (reference) noteParts.push(`ref: ${reference}`)
  if (iluminado) noteParts.push('iluminado')
  if (lat && lng) noteParts.push(`geo:${lat},${lng}`)
  const notes = noteParts.join(' | ').slice(0, 1000) || null

  const impressions = parseInt((row.audienciaTotal ?? '').toString().replace(/\D/g, ''), 10) || null

  // Foto: scoutdoor serve em https://scoutdoor.com.br/imagem/<UF>/pontos/<arquivo>
  // PHOTO_BASE pode conter {UF} (substituído pela area do ponto).
  const imagem = (row.imagem ?? '').toString().trim()
  let photo = null
  if (imagem) {
    if (PHOTO_BASE) {
      const base = PHOTO_BASE.replace(/\{(uf|area)\}/gi, area).replace(/\/$/, '')
      photo = `${base}/${imagem}`
    } else {
      photo = imagem
    }
  }

  return {
    external_code:       `${area}-${row.id}`,                      // determinístico/idempotente
    code,                                                          // coluna CÓDIGO (codigoUnico)
    name:                String(row.titulo || `${area}-${row.id}`).slice(0, 200),
    asset_type,
    structure_type,
    address:             address ? address.slice(0, 500) : null,
    city:                city ? city.slice(0, 120) : null,
    state,
    dimensions,
    installation_date:   null,                                     // Dataprisma não tem data confiável
    impressions_monthly: impressions,
    photo_url:           photo,
    notes,
    source:              'dataprisma',
    department_id:       ctx.deptMap[area] ?? null,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// UPSERT
// ════════════════════════════════════════════════════════════════════════════

const UPSERT_COLS = [
  'external_code', 'code', 'name', 'asset_type', 'structure_type',
  'address', 'city', 'state', 'dimensions',
  'installation_date', 'impressions_monthly', 'photo_url',
  'notes', 'source', 'department_id',
]

function buildUpsert(rows) {
  const values = []
  const tuples = rows.map((row, i) => {
    const base = i * UPSERT_COLS.length
    UPSERT_COLS.forEach(c => values.push(row[c] ?? null))
    return `(${UPSERT_COLS.map((_, j) => `$${base + j + 1}`).join(',')})`
  })
  const updates = UPSERT_COLS
    .filter(c => c !== 'external_code' && c !== 'source')
    .map(c => `${c} = EXCLUDED.${c}`)
    .join(', ')

  // Arbiter = índice parcial único idx_assets_external_code (migration 043).
  const sql = `
    INSERT INTO assets (${UPSERT_COLS.join(',')})
    VALUES ${tuples.join(',')}
    ON CONFLICT (external_code) WHERE external_code IS NOT NULL AND archived_at IS NULL
    DO UPDATE SET ${updates}, source = 'dataprisma'
  `
  return { sql, values }
}

// Grava um lote; se o lote falhar, tenta linha-a-linha para salvar o resto.
async function writeBatch(pool, rows) {
  try {
    const { sql, values } = buildUpsert(rows)
    await pool.query(sql, values)
    return { ok: rows.length, failed: 0 }
  } catch {
    let ok = 0, failed = 0
    for (const row of rows) {
      try { const { sql, values } = buildUpsert([row]); await pool.query(sql, values); ok++ }
      catch {
        // Provável colisão no índice único de `code` (codigoUnico duplicado).
        // Reimporta com code = external_code (sempre único) para não perder o ponto.
        try {
          const alt = { ...row, code: String(row.external_code).slice(0, 50) }
          const { sql, values } = buildUpsert([alt]); await pool.query(sql, values); ok++
        } catch (e2) {
          failed++; if (failed <= 5) console.error(`\n  ✗ ${row.external_code}: ${e2.message}`)
        }
      }
    }
    return { ok, failed }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROGRESSO
// ════════════════════════════════════════════════════════════════════════════

const fmtN   = n => typeof n === 'number' ? n.toLocaleString('pt-BR') : String(n)
const fmtSec = s => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
const bar10  = r => '█'.repeat(Math.round(r * 10)).padEnd(10, '░')

function progress(done, total, startMs, failed) {
  const pct = total ? ((done / total) * 100).toFixed(1) : '?'
  const elapsed = (Date.now() - startMs) / 1000
  const rps = elapsed > 0 ? Math.round(done / elapsed) : 0
  const eta = (total && rps > 0) ? fmtSec(Math.round((total - done) / rps)) : '?'
  const bar = total ? bar10(done / total) : '░░░░░░░░░░'
  process.stdout.write(
    `\r[${bar}] ${fmtN(done)}/${fmtN(total ?? '?')} (${pct}%) | ${fmtN(rps)} r/s | ETA ${eta} | falhas: ${failed}   `
  )
}

// ════════════════════════════════════════════════════════════════════════════
// CONEXÕES
// ════════════════════════════════════════════════════════════════════════════

const mysqlConfig = () => ({
  host:     process.env.SRC_HOST,
  port:     Number(process.env.SRC_PORT ?? 3306),
  user:     process.env.SRC_USER,
  password: process.env.SRC_PASS,
  database: process.env.SRC_DB,
  timezone: 'Z',
  dateStrings: true,
})

const pgPool = () => new pg.Pool({
  host:     process.env.DST_HOST ?? 'localhost',
  port:     Number(process.env.DST_PORT ?? 5432),   // direto no Postgres (bypassa PgBouncer)
  user:     process.env.DST_USER,
  password: process.env.DST_PASS,
  database: process.env.DST_DB,
  max:      4,
})

function buildSelect(table, stateFilter, limit, offset) {
  let sql = `SELECT * FROM \`${table}\``
  const params = []
  if (stateFilter) { sql += ` WHERE \`${SOURCE_UF_COL}\` = ?`; params.push(stateFilter) }
  if (limit != null && offset) { sql += ` LIMIT ? OFFSET ?`; params.push(limit, offset) }
  else if (limit != null)      { sql += ` LIMIT ?`;          params.push(limit) }
  else if (offset)             { sql += ` LIMIT 18446744073709551615 OFFSET ?`; params.push(offset) }
  return { sql, params }
}

// Pré-carrega lookups de cidade e tipo em Maps (memória trivial: ~6k linhas)
async function loadLookups(conn) {
  const cityMap = new Map()
  const [cities] = await conn.query(`SELECT id, cidade, sigla FROM \`${CITY_TABLE}\``)
  for (const r of cities) cityMap.set(Number(r.id), { name: r.cidade, uf: r.sigla })

  const typeMap = new Map()
  const [types] = await conn.query(`SELECT id, area, tipo FROM \`${TYPE_TABLE}\``)
  for (const r of types) typeMap.set(`${(r.area ?? '').toUpperCase()}:${r.id}`, r.tipo)

  return { cityMap, typeMap }
}

// ════════════════════════════════════════════════════════════════════════════
// --discover
// ════════════════════════════════════════════════════════════════════════════

async function discover(table) {
  const conn = await mysql.createConnection(mysqlConfig())
  try {
    console.log(`\n── Schema de "${table}" ───────────────────────────────────`)
    const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``)
    console.table(cols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Key: c.Key })))

    console.log(`\n── 3 registros de amostra ─────────────────────────────────`)
    const [sample] = await conn.query(`SELECT * FROM \`${table}\` LIMIT 3`)
    console.dir(sample, { depth: null })

    const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
    console.log(`\n── Total: ${Number(total).toLocaleString('pt-BR')} registros`)

    console.log(`\n── Distribuição por "${SOURCE_UF_COL}" ────────────────────`)
    const [dist] = await conn.query(
      `SELECT \`${SOURCE_UF_COL}\` AS area, COUNT(*) AS qty
       FROM \`${table}\` GROUP BY \`${SOURCE_UF_COL}\` ORDER BY qty DESC LIMIT 40`)
    console.table(dist)
  } finally {
    await conn.end()
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO (streaming)
// ════════════════════════════════════════════════════════════════════════════

async function migrate({ table, stateFilter, limit, offset, dryRun, sample }) {
  const conn = await mysql.createConnection(mysqlConfig())
  const pool = dryRun ? null : pgPool()

  try {
    // Lookups em memória
    const { cityMap, typeMap } = await loadLookups(conn)
    const ctx = { cityMap, typeMap, deptMap: DEPT_MAP }
    console.log(`\n── Lookups: ${cityMap.size} cidades, ${typeMap.size} tipos carregados`)

    // Total para a barra de progresso
    const whereUf = stateFilter ? ` WHERE \`${SOURCE_UF_COL}\` = ?` : ''
    const [[{ total: rawTotal }]] = await conn.query(
      `SELECT COUNT(*) AS total FROM \`${table}\`${whereUf}`, stateFilter ? [stateFilter] : [])
    const total = limit ? Math.min(Number(rawTotal), limit) : Number(rawTotal)

    console.log(`\n── Migração: ${table}${stateFilter ? ` [${stateFilter}]` : ' [todas as areas]'}`)
    console.log(`   Disponível : ${Number(rawTotal).toLocaleString('pt-BR')}`)
    console.log(`   Processar  : ${total.toLocaleString('pt-BR')}`)
    console.log(`   Modo       : ${dryRun ? 'DRY-RUN (sem gravação)' : 'GRAVAÇÃO REAL'}`)
    console.log(`   Dept map   : ${Object.keys(DEPT_MAP).length} area(s) → marca`)
    if (!dryRun && Object.keys(DEPT_MAP).length === 0) {
      console.warn('\n  ⚠  DEPT_MAP vazio — pontos ficarão com department_id = NULL.\n')
    }

    // Stream com cursor server-side (memória constante + backpressure)
    const { sql, params } = buildSelect(table, stateFilter, limit, offset)
    const stream = conn.connection.query(sql, params).stream({ highWaterMark: BATCH_SIZE })

    let batch = []
    let done = 0, okTotal = 0, failTotal = 0, printed = 0
    const start = Date.now()

    const flush = async () => {
      if (batch.length === 0) return
      const mapped = batch.map(row => mapRow(row, ctx)).filter(r => r.external_code)

      if (sample && printed < sample) {
        console.log('\n── Amostra mapeada ─────────────────────────────────────')
        console.dir(mapped.slice(0, sample - printed), { depth: null })
        printed += Math.min(sample - printed, mapped.length)
      }
      if (!dryRun && mapped.length) {
        const r = await writeBatch(pool, mapped)
        okTotal += r.ok; failTotal += r.failed
      } else {
        okTotal += mapped.length
      }
      done += batch.length
      batch = []
      progress(done, total, start, failTotal)
    }

    for await (const row of stream) {          // for-await aplica backpressure no socket
      batch.push(row)
      if (batch.length >= BATCH_SIZE) await flush()
    }
    await flush()

    process.stdout.write('\n')
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`\n── Concluído em ${elapsed}s`)
    console.log(`   Lidos    : ${fmtN(done)}`)
    console.log(`   Gravados : ${dryRun ? '0 (dry-run)' : fmtN(okTotal)}`)
    console.log(`   Falhas   : ${failTotal}`)
    if (!dryRun && failTotal === 0) {
      console.log('\n   ✔ Verifique no InteliONE:')
      console.log(`     SELECT state, COUNT(*) FROM assets WHERE source='dataprisma' GROUP BY state ORDER BY 2 DESC;`)
    }
  } finally {
    await conn.end()
    if (pool) await pool.end()
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRADA
// ════════════════════════════════════════════════════════════════════════════

const { values: flags } = parseArgs({
  options: {
    discover:  { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    state:     { type: 'string' },
    limit:     { type: 'string' },
    table:     { type: 'string' },
    offset:    { type: 'string' },
    sample:    { type: 'string' },
  },
  strict: false,
})

const sourceTable = flags.table ?? SOURCE_TABLE

if (!process.env.SRC_HOST) {
  console.error('Erro: SRC_HOST não definido. Copie .env.example → .env e preencha.')
  process.exit(1)
}
if (!flags.discover && !flags['dry-run'] && !process.env.DST_HOST) {
  console.error('Erro: DST_HOST não definido (necessário p/ gravação). Use --dry-run para validar sem destino.')
  process.exit(1)
}

if (flags.discover) {
  await discover(sourceTable)
} else {
  await migrate({
    table:       sourceTable,
    stateFilter: flags.state?.toUpperCase() ?? null,
    limit:       flags.limit  ? parseInt(flags.limit, 10)  : null,
    offset:      flags.offset ? parseInt(flags.offset, 10) : 0,
    dryRun:      flags['dry-run'] ?? false,
    sample:      flags.sample ? parseInt(flags.sample, 10) : 0,
  })
}
