import { randomUUID }     from 'node:crypto'
import busboy              from 'busboy'
import { fileTypeStream }  from 'file-type'
import { query }                                              from '#config/database.js'
import { uploadStream, confirmObject, deleteObject,
         presignedDownloadUrl }                                from '#services/storage.service.js'

/**
 * Assets Service — inventário de pontos OOH.
 *
 * Pontos são ativos da empresa (globais, sem escopo de departamento).
 * Leitura liberada a todos os roles autenticados; escrita restrita a admins
 * (garantido nas rotas).
 */

const ASSET_TYPES = ['painel', 'empena', 'led', 'lona', 'outdoor', 'mub', 'outro']
export { ASSET_TYPES }

// Colunas pesquisáveis via q_field — restringe o ILIKE a uma única coluna
// (ex.: achar duplicatas comparando só "dimensions" ou só "code").
const Q_FIELD_COLUMNS = {
  code:       'a.code',
  name:       'a.name',
  address:    'a.address',
  dimensions: 'a.dimensions',
}

const MAX_PHOTO_SIZE    = 8 * 1024 * 1024 // 8 MB
const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Resolve o photo_url de exibição: URLs externas (Scoutdoor/Dataprisma CDN,
 * começam com http) são devolvidas como estão; objectNames internos do MinIO
 * (uploads feitos pelo admin) viram presigned URL (TTL 1h, gerada localmente
 * sem round-trip de rede — segura para resolver em lote por página).
 */
async function resolvePhotoUrl(raw) {
  if (!raw) return null
  if (raw.startsWith('http')) return raw
  try { return await presignedDownloadUrl(raw) } catch { return null }
}

/**
 * Lista pontos ativos com contagem de demandas vinculadas.
 * Filtros: q (nome, código, endereço ou cidade — ou só a coluna de q_field,
 * se informado), asset_type.
 * Paginação: page (1-based) + page_size (máx. 500). Retorna { rows, total },
 * onde total é a contagem completa do filtro (via COUNT(*) OVER(), pré-LIMIT).
 */
export async function listAssets(filters = {}) {
  const { q, asset_type, q_field } = filters
  const params = []
  const where  = ['a.archived_at IS NULL']

  if (q?.trim()) {
    params.push(`%${q.trim()}%`)
    const col = Q_FIELD_COLUMNS[q_field]
    where.push(
      col
        ? `${col} ILIKE $${params.length}`
        : `(a.name ILIKE $${params.length} OR a.code ILIKE $${params.length}` +
          ` OR a.address ILIKE $${params.length} OR a.city ILIKE $${params.length})`
    )
  }
  if (asset_type) {
    params.push(asset_type)
    where.push(`a.asset_type = $${params.length}`)
  }
  if (filters.incomplete === 'true' || filters.incomplete === true) {
    where.push(
      `(a.photo_url IS NULL OR a.code IS NULL` +
      ` OR trim(coalesce(a.name, '')) = '' OR a.dimensions IS NULL)`
    )
  }

  // Paginação (1-based). page_size limitado a 500 para conter o payload.
  const pageSize = Math.min(500, Math.max(1, parseInt(filters.page_size, 10) || 500))
  const page     = Math.max(1, parseInt(filters.page, 10) || 1)
  const offset   = (page - 1) * pageSize
  params.push(pageSize); const limitParam  = params.length
  params.push(offset);   const offsetParam = params.length

  const { rows } = await query(
    `SELECT
       a.id, a.code, a.name, a.asset_type, a.address, a.city,
       a.dimensions, a.notes, a.is_premium, a.photo_url, a.state,
       a.impressions_monthly, a.source, a.created_at,
       COUNT(d.id)::int                                    AS demand_count,
       COUNT(d.id) FILTER (WHERE d.finalized_at IS NULL
         AND (d.exception_state IS NULL OR d.exception_state <> 'cancelled'))::int
                                                           AS open_demand_count,
       COUNT(*) OVER()::int                                AS total_count
     FROM assets a
     LEFT JOIN demands d ON d.asset_id = a.id
     WHERE ${where.join(' AND ')}
     GROUP BY a.id
     ORDER BY a.name ASC, a.id ASC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  )
  // total_count vem em toda linha (window function); 0 quando não há resultados.
  const total = rows[0]?.total_count ?? 0
  await Promise.all(rows.map(async r => {
    delete r.total_count
    r.photo_url = await resolvePhotoUrl(r.photo_url)
  }))
  return { rows, total }
}

export async function createAsset(data) {
  const { code = null, name, asset_type = 'painel',
          address = null, city = null, dimensions = null, notes = null } = data

  try {
    const { rows } = await query(
      `INSERT INTO assets (code, name, asset_type, address, city, dimensions, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, code, name, asset_type, address, city, dimensions, notes, created_at`,
      [code || null, name, asset_type, address, city, dimensions, notes]
    )
    return rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error(`Já existe um ponto ativo com o código "${code}".`), { status: 409 })
    }
    throw err
  }
}

export async function updateAsset(id, data) {
  const sets   = []
  const params = []
  for (const key of ['code', 'name', 'asset_type', 'address', 'city', 'dimensions', 'notes', 'is_premium']) {
    if (data[key] !== undefined) {
      params.push(data[key] === '' ? null : data[key])
      sets.push(`${key} = $${params.length}`)
    }
  }
  if (!sets.length) throw Object.assign(new Error('Nada para atualizar.'), { status: 422 })

  params.push(id)
  try {
    const { rows } = await query(
      `UPDATE assets SET ${sets.join(', ')}
       WHERE id = $${params.length} AND archived_at IS NULL
       RETURNING id, code, name, asset_type, address, city, dimensions, notes`,
      params
    )
    if (!rows[0]) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 })
    return rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('Já existe um ponto ativo com esse código.'), { status: 409 })
    }
    throw err
  }
}

export async function archiveAsset(id) {
  const { rowCount } = await query(
    `UPDATE assets SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL`,
    [id]
  )
  if (!rowCount) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 })
}

/**
 * Timeline do ponto: demandas vinculadas, mais recentes primeiro.
 * É o histórico do ativo — instalações, manutenções, checkings.
 */
export async function getIdleAssets(horizonDays = 30) {
  const { rows } = await query(
    `SELECT
       a.id, a.name, a.code, a.city, a.asset_type,
       MAX(c.ends_on) AS last_campaign_end
     FROM assets a
     LEFT JOIN campaigns c
       ON  c.asset_id    = a.id
       AND c.archived_at IS NULL
       AND (c.exception_state IS NULL OR c.exception_state <> 'cancelled')
       AND c.approval_status = 'approved'
       AND c.ends_on >= CURRENT_DATE
       AND c.starts_on <= (CURRENT_DATE + $1::int)
     WHERE a.archived_at IS NULL
     GROUP BY a.id
     HAVING MAX(c.ends_on) IS NULL
     ORDER BY a.city NULLS LAST, a.name ASC
     LIMIT 200`,
    [horizonDays]
  )

  const byCity = rows.reduce((acc, r) => {
    const k = r.city ?? 'Sem cidade'
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  return {
    total:   rows.length,
    by_city: Object.entries(byCity).sort((a, b) => b[1] - a[1]).map(([city, count]) => ({ city, count })),
    assets:  rows,
  }
}

export async function getOccupancyGrid({ from, to, city, asset_type } = {}) {
  const params = [from, to]
  const where  = ['a.archived_at IS NULL']
  if (city)       { params.push(city);       where.push(`a.city = $${params.length}`) }
  if (asset_type) { params.push(asset_type); where.push(`a.asset_type = $${params.length}`) }

  const { rows } = await query(
    `SELECT
       a.id, a.name, a.code, a.city, a.asset_type,
       COALESCE(
         json_agg(
           json_build_object(
             'campaign_id',    c.id,
             'title',          c.title,
             'client_name',    c.client_name,
             'starts_on',      c.starts_on,
             'ends_on',        c.ends_on,
             'status',         c.approval_status
           ) ORDER BY c.starts_on
         ) FILTER (WHERE c.id IS NOT NULL),
         '[]'
       ) AS campaigns
     FROM assets a
     LEFT JOIN campaigns c
       ON  c.asset_id    = a.id
       AND c.archived_at IS NULL
       AND c.approval_status <> 'rejected'
       AND c.starts_on <= $2::date
       AND c.ends_on   >= $1::date
     WHERE ${where.join(' AND ')}
     GROUP BY a.id
     ORDER BY a.city NULLS LAST, a.name ASC
     LIMIT 500`,
    params
  )
  return rows
}

// ── Ciclo de vida do ativo ────────────────────────────────────────────────────

export async function listLifecycleLogs(assetId) {
  const { rows } = await query(
    `SELECT l.id, l.event_type, l.description, l.performed_at, l.next_date,
            l.created_at, u.name AS created_by_name
     FROM asset_lifecycle_logs l
     JOIN users u ON u.id = l.created_by
     WHERE l.asset_id = $1
     ORDER BY l.performed_at DESC, l.created_at DESC
     LIMIT 200`,
    [assetId]
  )
  return rows
}

export async function createLifecycleLog(assetId, actorId, data) {
  const { event_type, description, performed_at, next_date = null } = data
  const { rows } = await query(
    `INSERT INTO asset_lifecycle_logs (asset_id, event_type, description, performed_at, next_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, event_type, description, performed_at, next_date, created_at`,
    [assetId, event_type, description, performed_at, next_date || null, actorId]
  )
  return rows[0]
}

export async function deleteLifecycleLog(logId) {
  const { rowCount } = await query(
    `DELETE FROM asset_lifecycle_logs WHERE id = $1`,
    [logId]
  )
  if (!rowCount) throw Object.assign(new Error('Registro não encontrado.'), { status: 404 })
}

export async function checkAvailability(assetId, from, to) {
  const { rows } = await query(
    `SELECT c.id, c.title, c.client_name, c.starts_on, c.ends_on
     FROM campaigns c
     WHERE c.asset_id = $1
       AND c.finalized_at IS NULL
       AND (c.exception_state IS NULL OR c.exception_state <> 'cancelled')
       AND c.approval_status <> 'rejected'
       AND c.starts_on <= $3::date
       AND c.ends_on   >= $2::date`,
    [assetId, from, to]
  )
  return { available: rows.length === 0, conflicts: rows }
}

export async function getAssetTimeline(id) {
  const { rows: assetRows } = await query(
    `SELECT id, code, name, asset_type, address, city, dimensions, notes, created_at
     FROM assets WHERE id = $1 AND archived_at IS NULL`,
    [id]
  )
  if (!assetRows[0]) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 })

  const { rows: demands } = await query(
    `SELECT
       d.id, d.title, d.created_at, d.finalized_at, d.exception_state,
       dt.name   AS demand_type_name,
       dept.name AS department_name,
       ws.name   AS current_stage_name,
       ws.is_final,
       u.name    AS assignee_name
     FROM demands d
     JOIN demand_types    dt   ON dt.id   = d.demand_type_id
     JOIN departments     dept ON dept.id = dt.department_id
     LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
     LEFT JOIN users      u    ON u.id    = d.current_assignee_id
     WHERE d.asset_id = $1
     ORDER BY d.created_at DESC
     LIMIT 100`,
    [id]
  )

  return { asset: assetRows[0], demands }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD DE FOTO (busboy streaming → MinIO)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Substitui a foto de um ponto. Stream direto para o MinIO (sem disco/RAM
 * intermediária), valida o tipo real via magic bytes (não confia na extensão).
 * Se havia uma foto antiga vinda de upload interno (não URL externa), remove
 * o objeto velho do MinIO após o sucesso.
 */
export async function uploadAssetPhoto(assetId, req) {
  const { rows: existing } = await query(
    `SELECT photo_url FROM assets WHERE id = $1 AND archived_at IS NULL`,
    [assetId]
  )
  if (!existing.length) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 })
  const previousPhoto = existing[0].photo_url

  return new Promise((resolve, reject) => {
    let fileProcessed = false
    let filePromise    = null

    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_PHOTO_SIZE } })

    bb.on('file', (fieldname, fileStream) => {
      fileProcessed = true
      const objectName = randomUUID()
      let truncated     = false
      fileStream.on('limit', () => { truncated = true })

      filePromise = (async () => {
        const typedStream  = await fileTypeStream(fileStream)
        const detectedMime = typedStream.fileType?.mime ?? 'application/octet-stream'

        if (!ALLOWED_PHOTO_MIME.has(detectedMime)) {
          typedStream.resume()
          throw Object.assign(
            new Error(`Tipo de arquivo não permitido: ${detectedMime}. Use JPEG, PNG ou WebP.`),
            { status: 415 }
          )
        }

        await uploadStream(objectName, typedStream, detectedMime)

        if (truncated) {
          await deleteObject(objectName).catch(() => {})
          throw Object.assign(
            new Error(`Imagem excede o limite de ${MAX_PHOTO_SIZE / 1024 / 1024} MB.`),
            { status: 413 }
          )
        }
        return objectName
      })()
    })

    bb.on('filesLimit', () =>
      reject(Object.assign(new Error('Apenas 1 imagem por requisição.'), { status: 400 }))
    )

    bb.on('finish', async () => {
      if (!fileProcessed || !filePromise) {
        return reject(Object.assign(new Error('Nenhuma imagem enviada.'), { status: 400 }))
      }
      try {
        const objectName = await filePromise
        await query(`UPDATE assets SET photo_url = $1 WHERE id = $2`, [objectName, assetId])
        await confirmObject(objectName)

        // Remove a foto antiga do MinIO só se era um upload interno (objectName, não URL externa).
        if (previousPhoto && !previousPhoto.startsWith('http')) {
          deleteObject(previousPhoto).catch(() => {})
        }

        resolve({ photo_url: await presignedDownloadUrl(objectName) })
      } catch (err) {
        reject(err)
      }
    })

    bb.on('error', reject)
    req.pipe(bb)
  })
}
