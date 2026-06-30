# Tier A — 5 Features Restantes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as 5 features restantes de Tier A com encaixe imediato na infraestrutura atual do InteliCore OOH.

**Architecture:** Cada feature é independente e pode ser commitada separadamente. Tasks 3, 4 e 5 exigem migrations SQL (030, 031, 032). Tasks 1 e 2 são puramente código. Nenhuma depende das outras. Features diferidas por falta de infraestrutura: Proofing canvas (biblioteca de anotação ausente), Intake Forms (form builder), Holds/Alçadas (aprovação multi-nível), Conformidade Fiscal (módulo de faturamento inexistente).

**Tech Stack:** Node 20 + Express + PostgreSQL 16 + Zod · React 18 + Vite + Zustand · MinIO (`storage.service.js`, `presignedDownloadUrl`) · `setInterval` cron (padrão já em `index.js`) · ES modules (`import`/`export`)

---

## Mapa de Arquivos

| Arquivo | Tasks | Ação |
|---|---|---|
| `backend/src/services/external.service.js` | 1 | Modificar |
| `backend/src/controllers/external.controller.js` | 1 | Modificar |
| `backend/src/routes/external.routes.js` | 1 | Modificar |
| `frontend/src/pages/ExternalPortal.jsx` | 1 | Modificar |
| `backend/src/services/portfolios.service.js` | 2 | Criar |
| `backend/src/controllers/portfolios.controller.js` | 2 | Criar |
| `backend/src/routes/portfolios.routes.js` | 2 | Criar |
| `backend/src/index.js` | 2, 3, 5 | Modificar |
| `frontend/src/pages/admin/AdminPortfolios.jsx` | 2 | Criar |
| `frontend/src/App.jsx` | 2 | Modificar |
| `backend/src/migrations/sql/030_asset_documents.sql` | 3 | Criar |
| `backend/src/services/assetDocuments.service.js` | 3 | Criar |
| `backend/src/controllers/assetDocuments.controller.js` | 3 | Criar |
| `backend/src/routes/admin.routes.js` | 3 | Modificar |
| `frontend/src/pages/admin/AdminAssets.jsx` | 3 | Modificar |
| `backend/src/migrations/sql/031_attachments_creative.sql` | 4 | Criar |
| `backend/src/services/demands.service.js` | 4 | Modificar |
| `frontend/src/components/demands/CreativeBlock.jsx` | 4 | Criar |
| `frontend/src/pages/DemandDetail.jsx` | 4 | Modificar |
| `backend/src/migrations/sql/032_campaigns_demand_link.sql` | 5 | Criar |
| `backend/src/services/campaigns.service.js` | 5 | Modificar |
| `backend/src/services/materialDeadlines.service.js` | 5 | Criar |
| `frontend/src/pages/admin/AdminCampaigns.jsx` | 5 | Modificar |

---

## Task 1: Portal do Cliente com Auditoria Transparente (PoP)

**Escopo:** Expor a galeria de fotos de checking no portal externo do prestador. Atualmente o portal mostra apenas a *contagem* de fotos (`photo_count`). A feature acrescenta `GET /api/external/:token/photos` que devolve as fotos com URLs assinadas e renderiza a galeria em `ExternalPortal.jsx`.

**Files:**
- Modify: `backend/src/services/external.service.js`
- Modify: `backend/src/controllers/external.controller.js`
- Modify: `backend/src/routes/external.routes.js`
- Modify: `frontend/src/pages/ExternalPortal.jsx`

- [ ] **Step 1.1: Adicionar `getExternalPhotos` no service**

Em `backend/src/services/external.service.js`, adicionar import no topo:

```js
import { presignedDownloadUrl } from '#services/storage.service.js'
```

Adicionar função após `getExternalView`:

```js
/**
 * Retorna as fotos de checking com URLs de download assinadas.
 * Expõe apenas: id, file_name, entered_at, url (presigned, 15min).
 * NUNCA expõe file_path (detalhe interno do MinIO).
 */
export async function getExternalPhotos(token) {
  const link = await resolveToken(token)

  const { rows } = await query(
    `SELECT id, file_name, entered_at
     FROM attachments
     WHERE demand_id = $1 AND kind = 'checking'
     ORDER BY entered_at ASC`,
    [link.demand_id]
  )

  return Promise.all(
    rows.map(async r => {
      const { rows: pathRows } = await query(
        'SELECT file_path FROM attachments WHERE id = $1', [r.id]
      )
      return {
        id:         r.id,
        file_name:  r.file_name,
        entered_at: r.entered_at,
        url:        await presignedDownloadUrl(pathRows[0].file_path),
      }
    })
  )
}
```

> **Nota de implementação:** se a query de `getExternalView` já retorna `file_path` nas rows, simplifique combinando as queries em uma só. O objetivo é nunca expor `file_path` diretamente na resposta JSON.

- [ ] **Step 1.2: Adicionar controller `photos`**

Em `backend/src/controllers/external.controller.js`, adicionar ao final:

```js
export async function photos(req, res) {
  try {
    return res.json(await svc.getExternalPhotos(req.params.token))
  } catch (err) { return handleError(err, res) }
}
```

- [ ] **Step 1.3: Adicionar rota**

Em `backend/src/routes/external.routes.js`, após `router.get('/:token', ctrl.view)`:

```js
router.get('/:token/photos', ctrl.photos)
```

- [ ] **Step 1.4: Galeria em ExternalPortal.jsx**

Em `frontend/src/pages/ExternalPortal.jsx`, adicionar estado e fetch de fotos. Alterar o início do componente:

```jsx
const [photos, setPhotos] = useState([])

const loadPhotos = useCallback(async () => {
  try {
    const res = await fetch(`${API}/${token}/photos`)
    if (res.ok) setPhotos(await res.json())
  } catch { /* silencioso — galeria opcional */ }
}, [token])
```

Chamar `loadPhotos()` dentro do `useEffect` existente, após `load()`:

```jsx
useEffect(() => {
  load()
  loadPhotos()
}, [load, loadPhotos])
```

Também chamar `loadPhotos()` no callback de upload bem-sucedido (após `load()` na linha 63).

Adicionar seção de galeria após o bloco de upload (após a `</div>` que fecha "Fotos da instalação"):

```jsx
{photos.length > 0 && (
  <div className="rounded-2xl bg-white p-5 shadow">
    <h2 className="text-sm font-semibold text-gray-900">
      📸 Evidências registradas ({photos.length})
    </h2>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {photos.map(p => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
          <img
            src={p.url}
            alt={p.file_name}
            className="h-32 w-full rounded-xl object-cover border border-gray-100"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 1.5: Verificar**

1. Criar um link externo para uma demanda com fotos de checking
2. Abrir `/external/<token>` no browser
3. Seção "Evidências registradas (N)" aparece com thumbnails clicáveis
4. Upload de nova foto → galeria atualiza automaticamente

- [ ] **Step 1.6: Commit**

```powershell
$msg = @'
feat: galeria de evidências PoP no portal externo do prestador

GET /external/:token/photos retorna fotos de checking com URLs
assinadas. ExternalPortal.jsx exibe galeria 2-col após upload.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/services/external.service.js `
      backend/src/controllers/external.controller.js `
      backend/src/routes/external.routes.js `
      frontend/src/pages/ExternalPortal.jsx
git commit -m $msg
```

---

## Task 2: Portfólios de Clientes/Agências

**Escopo:** Visão consolidada de todas as campanhas por cliente (`client_name`). Sem nova migration — agrega sobre a tabela `campaigns` + `assets` existente. Nova rota `GET /api/portfolios`, nova página `AdminPortfolios.jsx` acessível em `/admin/portfolios`.

**Files:**
- Create: `backend/src/services/portfolios.service.js`
- Create: `backend/src/controllers/portfolios.controller.js`
- Create: `backend/src/routes/portfolios.routes.js`
- Modify: `backend/src/index.js`
- Create: `frontend/src/pages/admin/AdminPortfolios.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 2.1: Criar `portfolios.service.js`**

```js
// backend/src/services/portfolios.service.js
import { query } from '#config/database.js'

/**
 * Lista todos os clientes/agências com stats agregados de campanhas.
 * Filtro opcional por q (substring do client_name, case-insensitive).
 */
export async function listPortfolios({ q } = {}) {
  const params = []
  let whereExtra = ''
  if (q?.trim()) {
    params.push(`%${q.trim()}%`)
    whereExtra = `AND c.client_name ILIKE $1`
  }

  const { rows } = await query(
    `SELECT
       c.client_name,
       COUNT(DISTINCT c.id)::int           AS campaign_count,
       COUNT(DISTINCT c.asset_id)::int     AS asset_count,
       MIN(c.starts_on)                    AS earliest_start,
       MAX(c.ends_on)                      AS latest_end,
       array_agg(DISTINCT a.code
                 ORDER BY a.code)
         FILTER (WHERE a.code IS NOT NULL) AS asset_codes,
       array_agg(DISTINCT a.name
                 ORDER BY a.name)          AS asset_names
     FROM campaigns c
     JOIN assets a ON a.id = c.asset_id
     WHERE c.archived_at IS NULL ${whereExtra}
     GROUP BY c.client_name
     ORDER BY c.client_name ASC`,
    params
  )
  return rows
}

/**
 * Detalha campanhas de um cliente específico.
 */
export async function getPortfolioDetail(clientName) {
  const { rows } = await query(
    `SELECT
       c.id, c.title, c.starts_on, c.ends_on, c.notes,
       a.id AS asset_id, a.code AS asset_code,
       a.name AS asset_name, a.city AS asset_city,
       u.name AS created_by_name
     FROM campaigns c
     JOIN assets a ON a.id = c.asset_id
     JOIN users  u ON u.id = c.created_by
     WHERE c.client_name = $1 AND c.archived_at IS NULL
     ORDER BY c.starts_on DESC`,
    [clientName]
  )
  return rows
}
```

- [ ] **Step 2.2: Criar `portfolios.controller.js`**

```js
// backend/src/controllers/portfolios.controller.js
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
```

- [ ] **Step 2.3: Criar `portfolios.routes.js`**

```js
// backend/src/routes/portfolios.routes.js
import { Router } from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import { authorize }    from '#middlewares/authorize.js'
import * as ctrl        from '#controllers/portfolios.controller.js'

const router = Router()
router.use(authenticate)
router.use(authorize('super_admin', 'dept_admin'))

router.get('/',                    ctrl.list)
router.get('/:clientName',         ctrl.detail)

export default router
```

- [ ] **Step 2.4: Registrar em `index.js`**

Em `backend/src/index.js`, adicionar import junto aos outros:

```js
import portfoliosRoutes from '#routes/portfolios.routes.js'
```

Adicionar montagem junto às outras rotas:

```js
app.use('/api/portfolios', portfoliosRoutes)
```

- [ ] **Step 2.5: Criar `AdminPortfolios.jsx`**

```jsx
// frontend/src/pages/admin/AdminPortfolios.jsx
import { useEffect, useState } from 'react'
import api from '../../services/api'

export default function AdminPortfolios() {
  const [portfolios, setPortfolios]   = useState([])
  const [q,          setQ]            = useState('')
  const [selected,   setSelected]     = useState(null)   // client_name em detalhe
  const [detail,     setDetail]       = useState([])
  const [loading,    setLoading]      = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/portfolios', { params: { q } })
      .then(r => setPortfolios(r.data))
      .finally(() => setLoading(false))
  }, [q])

  useEffect(() => {
    if (!selected) { setDetail([]); return }
    api.get(`/portfolios/${encodeURIComponent(selected)}`)
       .then(r => setDetail(r.data))
  }, [selected])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Portfólios de Clientes</h1>

      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Filtrar por cliente..."
        className="mb-4 w-full max-w-sm rounded-lg border px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
      />

      {loading ? (
        <p className="text-sm text-gray-400">Carregando...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {portfolios.map(p => (
            <button
              key={p.client_name}
              onClick={() => setSelected(selected === p.client_name ? null : p.client_name)}
              className={`text-left rounded-xl border p-4 transition-colors ${
                selected === p.client_name
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="font-semibold text-gray-900 text-sm">{p.client_name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {p.campaign_count} campanha{p.campaign_count !== 1 ? 's' : ''} ·{' '}
                {p.asset_count} ponto{p.asset_count !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {p.earliest_start} → {p.latest_end}
              </p>
              {p.asset_codes?.length > 0 && (
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {p.asset_codes.join(' · ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && detail.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            Campanhas — {selected}
          </h2>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Campanha</th>
                  <th className="px-4 py-2 text-left">Ponto</th>
                  <th className="px-4 py-2 text-left">Período</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {detail.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{c.title}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {c.asset_code && <span className="font-mono text-xs">[{c.asset_code}] </span>}
                      {c.asset_name}
                    </td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {c.starts_on} → {c.ends_on}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {portfolios.length === 0 && !loading && (
        <p className="text-sm text-gray-400 mt-4">Nenhum cliente encontrado.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2.6: Registrar rota em `App.jsx`**

Em `frontend/src/App.jsx`, adicionar import lazy (junto aos outros admins, em ordem alfabética):

```jsx
const AdminPortfolios = lazy(() => import('./pages/admin/AdminPortfolios'))
```

Adicionar rota dentro do bloco `<ProtectedRoute roles={['super_admin', 'dept_admin']}>`:

```jsx
<Route path="/admin/portfolios" element={<AdminPortfolios />} />
```

- [ ] **Step 2.7: Verificar**

1. Navegar para `/admin/portfolios`
2. Listar clientes com stats de campanhas
3. Clicar num cliente → ver detalhe de campanhas com pontos e períodos
4. Filtro por nome funciona

- [ ] **Step 2.8: Commit**

```powershell
$msg = @'
feat: portfólios de clientes/agências

GET /portfolios lista clientes agrupados por client_name com stats.
GET /portfolios/:clientName detalha campanhas do cliente.
AdminPortfolios.jsx com filtro + detalhe inline.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/services/portfolios.service.js `
      backend/src/controllers/portfolios.controller.js `
      backend/src/routes/portfolios.routes.js `
      backend/src/index.js `
      frontend/src/pages/admin/AdminPortfolios.jsx `
      frontend/src/App.jsx
git commit -m $msg
```

---

## Task 3: Engine de Alertas de Vencimento de Documentos

**Escopo:** Tabela `asset_documents` para rastrear alvarás e contratos de locação por ponto OOH. Job diário notifica `super_admins` quando documentos vencem em 30, 15, 7 ou 1 dia. UI embutida em `AdminAssets.jsx`.

**Files:**
- Create: `backend/src/migrations/sql/030_asset_documents.sql`
- Create: `backend/src/services/assetDocuments.service.js`
- Create: `backend/src/controllers/assetDocuments.controller.js`
- Modify: `backend/src/routes/admin.routes.js`
- Modify: `backend/src/index.js`
- Modify: `frontend/src/pages/admin/AdminAssets.jsx`

- [ ] **Step 3.1: Criar migration 030**

```sql
-- backend/src/migrations/sql/030_asset_documents.sql
-- ─── 030: asset_documents — documentos com vencimento por ponto OOH ─────────────
--
-- Controla alvarás, contratos de locação, seguros e licenças municipais.
-- O job diário `runDocumentExpiryCheck` notifica super_admins quando
-- um documento vence em 30, 15, 7 ou 1 dia.

CREATE TABLE IF NOT EXISTS asset_documents (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID         NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  doc_type    VARCHAR(20)  NOT NULL DEFAULT 'outro'
                CHECK (doc_type IN ('alvara', 'contrato', 'seguro', 'licenca', 'outro')),
  expires_at  DATE         NOT NULL,
  notes       TEXT,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_documents_asset
  ON asset_documents (asset_id);

-- Índice parcial para o job de vencimento (busca só datas futuras)
CREATE INDEX IF NOT EXISTS idx_asset_documents_expires
  ON asset_documents (expires_at)
  WHERE expires_at >= CURRENT_DATE;
```

- [ ] **Step 3.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: 030 aplicado sem erros
```

- [ ] **Step 3.3: Criar `assetDocuments.service.js`**

```js
// backend/src/services/assetDocuments.service.js
import { query }              from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'
import { logger }             from '#lib/logger.js'

const log = logger.child({ module: 'asset-documents' })

export async function listByAsset(assetId) {
  const { rows } = await query(
    `SELECT id, title, doc_type, expires_at, notes, created_at,
            (expires_at < CURRENT_DATE) AS expired,
            (expires_at - CURRENT_DATE) AS days_remaining
     FROM asset_documents
     WHERE asset_id = $1
     ORDER BY expires_at ASC`,
    [assetId]
  )
  return rows
}

export async function create(actor, assetId, { title, doc_type, expires_at, notes = null }) {
  const { rows } = await query(
    `INSERT INTO asset_documents (asset_id, title, doc_type, expires_at, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, doc_type, expires_at, notes, created_at`,
    [assetId, title, doc_type, expires_at, notes, actor.id]
  )
  return rows[0]
}

export async function update(id, { title, doc_type, expires_at, notes }) {
  const sets   = []
  const params = []
  for (const [key, val] of Object.entries({ title, doc_type, expires_at, notes })) {
    if (val !== undefined) { params.push(val); sets.push(`${key} = $${params.length}`) }
  }
  if (!sets.length) throw Object.assign(new Error('Nada para atualizar.'), { status: 422 })
  params.push(id)
  const { rows } = await query(
    `UPDATE asset_documents SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING id, title, doc_type, expires_at, notes`,
    params
  )
  if (!rows[0]) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 })
  return rows[0]
}

export async function remove(id) {
  const { rowCount } = await query(
    'DELETE FROM asset_documents WHERE id = $1', [id]
  )
  if (!rowCount) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 })
}

/**
 * Job diário: verifica documentos que vencem em exatamente 30, 15, 7 ou 1 dia.
 * Notifica todos os super_admins via SSE.
 */
export async function runDocumentExpiryCheck() {
  const thresholds = [30, 15, 7, 1]

  const { rows: admins } = await query(
    `SELECT id FROM users WHERE role = 'super_admin' AND archived_at IS NULL`
  )
  if (!admins.length) return

  for (const days of thresholds) {
    const { rows: docs } = await query(
      `SELECT ad.id, ad.title, ad.doc_type, ad.expires_at,
              a.name AS asset_name, a.code AS asset_code
       FROM asset_documents ad
       JOIN assets a ON a.id = ad.asset_id
       WHERE (ad.expires_at - CURRENT_DATE) = $1`,
      [days]
    )

    for (const doc of docs) {
      const label   = doc.asset_code ? `[${doc.asset_code}] ${doc.asset_name}` : doc.asset_name
      const message = `⚠ Documento "${doc.title}" (${doc.doc_type}) do ponto ${label} vence em ${days} dia${days > 1 ? 's' : ''}.`
      const link    = '/admin/assets'

      for (const admin of admins) {
        createNotification(admin.id, message, link, 'system')
          .catch(err => log.error({ err }, 'Falha ao notificar vencimento de documento'))
      }
    }
  }

  log.info('Document expiry check concluído')
}
```

- [ ] **Step 3.4: Criar `assetDocuments.controller.js`**

```js
// backend/src/controllers/assetDocuments.controller.js
import { z } from 'zod'
import * as svc from '#services/assetDocuments.service.js'

const schema = z.object({
  title:      z.string().min(1).max(200),
  doc_type:   z.enum(['alvara', 'contrato', 'seguro', 'licenca', 'outro']),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use formato YYYY-MM-DD'),
  notes:      z.string().max(2000).optional().nullable(),
})

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function list(req, res) {
  try {
    return res.json(await svc.listByAsset(req.params.assetId))
  } catch (err) { return handleError(err, res) }
}

export async function create(req, res) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.status(201).json(await svc.create(req.user, req.params.assetId, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function update(req, res) {
  const parsed = schema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.update(req.params.docId, parsed.data))
  } catch (err) { return handleError(err, res) }
}

export async function remove(req, res) {
  try {
    await svc.remove(req.params.docId)
    return res.status(204).end()
  } catch (err) { return handleError(err, res) }
}
```

- [ ] **Step 3.5: Adicionar rotas em `admin.routes.js`**

Em `backend/src/routes/admin.routes.js`, adicionar import e rotas:

```js
import * as adCtrl from '#controllers/assetDocuments.controller.js'

// Documentos de pontos OOH (alvarás, contratos, etc.)
router.get   ('/assets/:assetId/documents',       authorize('super_admin', 'dept_admin'), adCtrl.list)
router.post  ('/assets/:assetId/documents',       authorize('super_admin', 'dept_admin'), adCtrl.create)
router.patch ('/assets/:assetId/documents/:docId', authorize('super_admin', 'dept_admin'), adCtrl.update)
router.delete('/assets/:assetId/documents/:docId', authorize('super_admin', 'dept_admin'), adCtrl.remove)
```

- [ ] **Step 3.6: Adicionar cron em `index.js`**

Em `backend/src/index.js`, adicionar import:

```js
import { runDocumentExpiryCheck } from '#services/assetDocuments.service.js'
```

Dentro do `server.listen` callback, após o job de recorrentes:

```js
  // ── Job de vencimento de documentos ──────────────────────────────────────
  // Roda uma vez por dia às 08:00 UTC. Notifica super_admins sobre documentos
  // (alvarás, contratos) que vencem em 30, 15, 7 ou 1 dia.
  const DOC_INTERVAL = 24 * 60 * 60 * 1000
  const runDocExpiry = () =>
    runDocumentExpiryCheck().catch(err => logger.error({ err }, 'Document expiry check falhou'))
  runDocExpiry()
  setInterval(runDocExpiry, DOC_INTERVAL)
```

- [ ] **Step 3.7: Seção de documentos em `AdminAssets.jsx`**

Em `frontend/src/pages/admin/AdminAssets.jsx`, localizar onde um ponto é expandido ou detalhado. Adicionar estado e UI para documentos. Ler o arquivo para entender a estrutura exata antes de editar.

A seção a adicionar segue este padrão (adaptar ao estado e handlers já existentes):

```jsx
// Estado (adicionar junto aos outros useState do componente)
const [docsMap,   setDocsMap]   = useState({})   // { [assetId]: [] }
const [docForm,   setDocForm]   = useState(null)  // { assetId, title, doc_type, expires_at, notes }
const [docsOpen,  setDocsOpen]  = useState({})    // { [assetId]: bool }

async function loadDocs(assetId) {
  const { data } = await api.get(`/admin/assets/${assetId}/documents`)
  setDocsMap(m => ({ ...m, [assetId]: data }))
}

async function saveDoc() {
  const { assetId, ...payload } = docForm
  if (docForm.id) {
    await api.patch(`/admin/assets/${assetId}/documents/${docForm.id}`, payload)
  } else {
    await api.post(`/admin/assets/${assetId}/documents`, payload)
  }
  setDocForm(null)
  await loadDocs(assetId)
}

async function deleteDoc(assetId, docId) {
  if (!confirm('Remover documento?')) return
  await api.delete(`/admin/assets/${assetId}/documents/${docId}`)
  await loadDocs(assetId)
}

// JSX a renderizar por ponto expandido:
{docsOpen[asset.id] && (
  <div className="mt-3 border-t pt-3">
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-semibold text-gray-600">Documentos do ponto</p>
      <button
        onClick={() => setDocForm({ assetId: asset.id, title: '', doc_type: 'alvara', expires_at: '', notes: '' })}
        className="text-xs px-2 py-1 rounded bg-blue-600 text-white"
      >+ Documento</button>
    </div>
    {(docsMap[asset.id] ?? []).map(doc => (
      <div key={doc.id} className={`flex items-center gap-2 text-xs py-1 ${doc.expired ? 'text-red-600' : doc.days_remaining <= 7 ? 'text-amber-600' : 'text-gray-700'}`}>
        <span className="font-medium">{doc.title}</span>
        <span className="text-gray-400">({doc.doc_type})</span>
        <span>{doc.expires_at}</span>
        {doc.expired && <span className="text-red-500 font-bold">VENCIDO</span>}
        <button onClick={() => setDocForm({ assetId: asset.id, ...doc })} className="ml-auto text-gray-400 hover:text-gray-700">✎</button>
        <button onClick={() => deleteDoc(asset.id, doc.id)} className="text-gray-400 hover:text-red-600">✕</button>
      </div>
    ))}
    {(docsMap[asset.id] ?? []).length === 0 && (
      <p className="text-xs text-gray-400">Nenhum documento cadastrado.</p>
    )}
  </div>
)}

// Botão toggle (adicionar no card/linha de cada asset):
<button
  onClick={() => {
    setDocsOpen(o => ({ ...o, [asset.id]: !o[asset.id] }))
    if (!docsMap[asset.id]) loadDocs(asset.id)
  }}
  className="text-xs text-gray-500 hover:text-gray-800"
>
  📄 Documentos
</button>

// Modal de formulário (fora do map, no nível do componente):
{docForm && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
    <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-3">
      <h3 className="font-semibold text-sm">{docForm.id ? 'Editar' : 'Novo'} Documento</h3>
      <input className="w-full border rounded px-3 py-1.5 text-sm"
        placeholder="Título (ex: Alvará 2025)" value={docForm.title}
        onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))} />
      <select className="w-full border rounded px-3 py-1.5 text-sm"
        value={docForm.doc_type}
        onChange={e => setDocForm(f => ({ ...f, doc_type: e.target.value }))}>
        {['alvara','contrato','seguro','licenca','outro'].map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <input type="date" className="w-full border rounded px-3 py-1.5 text-sm"
        value={docForm.expires_at}
        onChange={e => setDocForm(f => ({ ...f, expires_at: e.target.value }))} />
      <textarea className="w-full border rounded px-3 py-1.5 text-sm" rows={2}
        placeholder="Observações" value={docForm.notes ?? ''}
        onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))} />
      <div className="flex gap-2">
        <button onClick={saveDoc} className="flex-1 rounded bg-blue-600 text-white text-sm py-1.5">Salvar</button>
        <button onClick={() => setDocForm(null)} className="flex-1 rounded border text-sm py-1.5">Cancelar</button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3.8: Verificar**

1. Rodar `npm run migrate` — confirmar 030 aplicado
2. Abrir `/admin/assets`, expandir um ponto → seção "Documentos" aparece
3. Adicionar alvará com data de vencimento
4. Atualizar data para hoje + 7 dias → badge âmbar
5. Atualizar para data passada → badge vermelho "VENCIDO"

- [ ] **Step 3.9: Commit**

```powershell
$msg = @'
feat: engine de alertas de vencimento de documentos por ponto OOH

Migration 030 cria asset_documents (alvará, contrato, seguro, etc.).
Job diário notifica super_admins 30/15/7/1 dia antes do vencimento.
CRUD embutido em AdminAssets com badges de status visual.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/030_asset_documents.sql `
      backend/src/services/assetDocuments.service.js `
      backend/src/controllers/assetDocuments.controller.js `
      backend/src/routes/admin.routes.js `
      backend/src/index.js `
      frontend/src/pages/admin/AdminAssets.jsx
git commit -m $msg
```

---

## Task 4: Controle de Versão de Peças Criativas

**Escopo:** Novo `kind='creative'` em `attachments` + coluna `version INT`. Ao fazer upload de uma arte com `kind=creative`, o service auto-incrementa a versão. `CreativeBlock.jsx` mostra histórico de versões com badge "v1", "v2" etc., destacando a mais recente.

**Files:**
- Create: `backend/src/migrations/sql/031_attachments_creative.sql`
- Modify: `backend/src/services/demands.service.js`
- Create: `frontend/src/components/demands/CreativeBlock.jsx`
- Modify: `frontend/src/pages/DemandDetail.jsx`

- [ ] **Step 4.1: Criar migration 031**

```sql
-- backend/src/migrations/sql/031_attachments_creative.sql
-- ─── 031: attachments — kind 'creative' e controle de versão ─────────────────
--
-- Adiciona 'creative' como tipo de anexo para peças criativas (artes, layouts).
-- A coluna `version` numera automaticamente as versões de uma peça por demanda:
-- o service incrementa MAX(version)+1 ao receber kind='creative'.
-- A versão mais recente é a com version mais alto para o par (demand_id, kind).

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_kind_check;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_kind_check
    CHECK (kind IN ('generic', 'checking', 'creative'));

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- Índice para buscar versões de um criativo (ORDER BY version DESC)
CREATE INDEX IF NOT EXISTS idx_attachments_creative
  ON attachments (demand_id, version DESC)
  WHERE kind = 'creative';
```

- [ ] **Step 4.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: 031 aplicado sem erros
```

- [ ] **Step 4.3: Auto-incremento de versão no `uploadAttachment`**

Em `backend/src/services/demands.service.js`, localizar a função `uploadAttachment`. Antes do início do stream busboy (logo após a validação de `kind` e do acesso via `getDemand`), adicionar:

```js
  // Pré-calcula próxima versão para peças criativas (fora do stream busboy)
  let nextVersion = 1
  if (kind === 'creative') {
    const { rows: vRows } = await query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM attachments WHERE demand_id = $1 AND kind = 'creative'`,
      [demandId]
    )
    nextVersion = vRows[0].next_version
  }
```

Na query INSERT dentro do stream busboy (onde o attachment é salvo no banco), adicionar a coluna `version` e usar `nextVersion`:

```js
-- Antes (exemplo):
INSERT INTO attachments (demand_id, file_name, file_path, file_size, mime_type, kind, uploaded_by, entered_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())

-- Depois:
INSERT INTO attachments (demand_id, file_name, file_path, file_size, mime_type, kind, version, uploaded_by, entered_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
```

Ajustar os parâmetros para incluir `nextVersion` na posição correta. **Leia o INSERT existente antes de editar** — o número de `$N` depende da ordem atual.

- [ ] **Step 4.4: Criar `CreativeBlock.jsx`**

```jsx
// frontend/src/components/demands/CreativeBlock.jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../services/api'

export default function CreativeBlock({ demandId, isFrozen }) {
  const [creatives, setCreatives] = useState([])
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const { data } = await api.get(`/demands/${demandId}/attachments`, {
      params: { kind: 'creative' },
    })
    // Ordenar: versão mais alta primeiro
    setCreatives([...data].sort((a, b) => b.version - a.version))
  }, [demandId])

  useEffect(() => { load() }, [load])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.post(`/demands/${demandId}/attachments?kind=creative`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      await load()
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const latest = creatives[0]

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">🎨 Peças Criativas</h3>
        {!isFrozen && (
          <label className="cursor-pointer text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 text-gray-700">
            {uploading ? 'Enviando…' : '+ Upload'}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.ai,.psd,.eps"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      {creatives.length === 0 && (
        <p className="text-xs text-gray-400">Nenhuma peça criativa anexada.</p>
      )}

      <div className="space-y-2">
        {creatives.map((c, i) => (
          <div
            key={c.id}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${
              i === 0 ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-100 opacity-60'
            }`}
          >
            <span className={`font-mono font-bold ${i === 0 ? 'text-blue-700' : 'text-gray-400'}`}>
              v{c.version}
            </span>
            {i === 0 && (
              <span className="rounded-full bg-blue-600 text-white px-1.5 py-0.5 text-[10px] font-semibold">
                atual
              </span>
            )}
            <span className="flex-1 truncate text-gray-700">{c.file_name}</span>
            <span className="text-gray-400 whitespace-nowrap">
              {new Date(c.entered_at).toLocaleDateString('pt-BR')}
            </span>
            <a
              href={`/api/demands/${demandId}/attachments/${c.id}/download`}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-blue-600"
              title="Download"
            >↓</a>
          </div>
        ))}
      </div>

      {creatives.length > 1 && latest && (
        <p className="mt-2 text-[10px] text-gray-400">
          {creatives.length - 1} versão{creatives.length > 2 ? 'ões' : ''} anterior{creatives.length > 2 ? 'es' : ''} arquivada{creatives.length > 2 ? 's' : ''}.
        </p>
      )}
    </section>
  )
}
```

> **Nota:** `GET /demands/:id/attachments?kind=creative` pode não existir ainda. Verificar se o endpoint `GET /demands/:id/attachments` aceita filtro por `kind`. Se não, adaptar o componente para filtrar client-side após buscar todos os attachments, ou adicionar suporte ao filtro no controller.

- [ ] **Step 4.5: Adicionar `CreativeBlock` em `DemandDetail.jsx`**

Em `frontend/src/pages/DemandDetail.jsx`, adicionar import:

```jsx
import CreativeBlock from '../components/demands/CreativeBlock'
```

Adicionar o bloco logo antes de `<CheckingBlock>` (por volta da linha 385):

```jsx
{/* Peças criativas com controle de versão */}
<CreativeBlock demandId={demandId} isFrozen={isFrozen} />

{/* Checking fotográfico (evidências + relatório PDF) */}
<CheckingBlock demandId={demandId} isFrozen={isFrozen} />
```

- [ ] **Step 4.6: Verificar**

1. Abrir uma demanda
2. Bloco "Peças Criativas" aparece (vazio)
3. Fazer upload de um PDF → aparece como "v1 atual"
4. Fazer upload de outro PDF → aparece como "v2 atual", v1 fica dimmed abaixo
5. Download funciona para ambas as versões

- [ ] **Step 4.7: Commit**

```powershell
$msg = @'
feat: controle de versão de peças criativas

Migration 031 adiciona kind=creative e coluna version em attachments.
uploadAttachment auto-incrementa versão para kind=creative.
CreativeBlock.jsx exibe histórico de versões com badge "atual".

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/031_attachments_creative.sql `
      backend/src/services/demands.service.js `
      frontend/src/components/demands/CreativeBlock.jsx `
      frontend/src/pages/DemandDetail.jsx
git commit -m $msg
```

---

## Task 5: Gestão de Prazos de Entrega de Materiais

**Escopo:** Liga campanhas a demandas de produção via `demand_id` opcional em `campaigns`. Job diário alerta quando uma campanha começa em 7, 3 ou 1 dia e a demanda vinculada não tem peça criativa (`kind='creative'`) anexada. UI em `AdminCampaigns.jsx` para vincular a demanda.

**Files:**
- Create: `backend/src/migrations/sql/032_campaigns_demand_link.sql`
- Modify: `backend/src/services/campaigns.service.js`
- Create: `backend/src/services/materialDeadlines.service.js`
- Modify: `backend/src/index.js`
- Modify: `frontend/src/pages/admin/AdminCampaigns.jsx`

- [ ] **Step 5.1: Criar migration 032**

```sql
-- backend/src/migrations/sql/032_campaigns_demand_link.sql
-- ─── 032: campaigns — vínculo opcional com demanda de produção ───────────────
--
-- Um campo demand_id permite associar a campanha à demanda de produção dos
-- materiais (arte, lona). O job `runMaterialDeadlineCheck` usa esse link
-- para alertar quando a campanha está prestes a começar sem arte criativa.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS demand_id UUID REFERENCES demands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_demand
  ON campaigns (demand_id)
  WHERE demand_id IS NOT NULL;
```

- [ ] **Step 5.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: 032 aplicado sem erros
```

- [ ] **Step 5.3: Incluir `demand_id` no `campaigns.service.js`**

Em `backend/src/services/campaigns.service.js`, atualizar `listCampaigns`, `createCampaign` e `updateCampaign`:

**`listCampaigns`:** adicionar `c.demand_id` no SELECT e `d.title AS demand_title` via LEFT JOIN:

```js
  const { rows } = await query(
    `SELECT
       c.id, c.asset_id, c.client_name, c.title,
       c.starts_on, c.ends_on, c.notes, c.demand_id, c.created_at,
       a.name AS asset_name, a.code AS asset_code,
       u.name AS created_by_name,
       d.title AS demand_title
     FROM campaigns c
     JOIN assets a ON a.id = c.asset_id
     JOIN users  u ON u.id = c.created_by
     LEFT JOIN demands d ON d.id = c.demand_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.starts_on ASC
     LIMIT 1000`,
    params
  )
```

**`createCampaign`:** aceitar e persistir `demand_id`:

```js
export async function createCampaign(actor, data) {
  const { asset_id, client_name, title, starts_on, ends_on,
          notes = null, demand_id = null } = data
  // ...validação do asset...
  try {
    const { rows } = await query(
      `INSERT INTO campaigns (asset_id, client_name, title, starts_on, ends_on, notes, demand_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, asset_id, client_name, title, starts_on, ends_on, demand_id, created_at`,
      [asset_id, client_name, title, starts_on, ends_on, notes, demand_id, actor.id]
    )
    return rows[0]
  } catch (err) { throw translateExclusionError(err, asset_id) }
}
```

**`updateCampaign`:** incluir `demand_id` na lista de campos atualizáveis:

```js
  for (const key of ['client_name', 'title', 'starts_on', 'ends_on', 'notes', 'demand_id']) {
```

- [ ] **Step 5.4: Criar `materialDeadlines.service.js`**

```js
// backend/src/services/materialDeadlines.service.js
import { query }              from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'
import { logger }             from '#lib/logger.js'

const log = logger.child({ module: 'material-deadlines' })

/**
 * Job diário: alerta quando campanha começa em exatamente 7, 3 ou 1 dia
 * e a demanda vinculada não tem peça criativa (kind='creative') anexada.
 * Notifica: assignee da demanda + todos os super_admins.
 */
export async function runMaterialDeadlineCheck() {
  const thresholds = [7, 3, 1]

  const { rows: admins } = await query(
    `SELECT id FROM users WHERE role = 'super_admin' AND archived_at IS NULL`
  )

  for (const days of thresholds) {
    const { rows: campaigns } = await query(
      `SELECT
         c.id, c.title, c.client_name, c.starts_on, c.demand_id,
         d.title            AS demand_title,
         d.current_assignee_id,
         a.name             AS asset_name,
         a.code             AS asset_code,
         (SELECT COUNT(*) FROM attachments att
          WHERE att.demand_id = c.demand_id
            AND att.kind = 'creative')::int AS creative_count
       FROM campaigns c
       LEFT JOIN demands d ON d.id = c.demand_id
       LEFT JOIN assets  a ON a.id = c.asset_id
       WHERE (c.starts_on - CURRENT_DATE) = $1
         AND c.demand_id IS NOT NULL
         AND c.archived_at IS NULL`,
      [days]
    )

    for (const camp of campaigns) {
      if (camp.creative_count > 0) continue   // arte já anexada, sem alerta

      const label = camp.asset_code
        ? `[${camp.asset_code}] ${camp.asset_name}`
        : camp.asset_name
      const message = `⏰ Campanha "${camp.client_name} — ${camp.title}" (${label}) começa em ${days} dia${days > 1 ? 's' : ''} sem arte criativa anexada.`
      const link    = `/demands/${camp.demand_id}`

      const targets = new Set(admins.map(a => String(a.id)))
      if (camp.current_assignee_id) targets.add(String(camp.current_assignee_id))

      for (const userId of targets) {
        createNotification(userId, message, link, 'system')
          .catch(err => log.error({ err }, 'Falha ao notificar prazo de material'))
      }
    }
  }

  log.info('Material deadline check concluído')
}
```

- [ ] **Step 5.5: Adicionar cron em `index.js`**

Em `backend/src/index.js`, adicionar import:

```js
import { runMaterialDeadlineCheck } from '#services/materialDeadlines.service.js'
```

Dentro do `server.listen` callback, após o job de vencimento de documentos:

```js
  // ── Job de prazos de materiais ────────────────────────────────────────────
  // Alerta quando campanha começa em 7, 3 ou 1 dia sem arte criativa anexada.
  const runMaterialDeadlines = () =>
    runMaterialDeadlineCheck().catch(err => logger.error({ err }, 'Material deadline check falhou'))
  runMaterialDeadlines()
  setInterval(runMaterialDeadlines, 24 * 60 * 60 * 1000)
```

- [ ] **Step 5.6: Demand picker em `AdminCampaigns.jsx`**

Ler `AdminCampaigns.jsx` antes de editar para entender a estrutura do formulário. O campo a adicionar é um input de busca de demanda por título. Seguir o padrão de estado do componente.

No formulário de criar/editar campanha, adicionar campo de busca e vínculo:

```jsx
// Estado (adicionar no form state):
// demand_id: null, demandSearch: '', demandResults: []

// Função de busca de demandas (lazy, ao digitar):
async function searchDemands(q) {
  if (!q.trim()) { setDemandResults([]); return }
  const { data } = await api.get('/demands', { params: { q, limit: 10 } })
  setDemandResults(data.demands ?? data)
}

// JSX do campo (adicionar após o campo `notes`):
<div>
  <label className="block text-xs font-medium text-gray-600 mb-1">
    Demanda de produção (opcional)
  </label>
  {form.demand_id ? (
    <div className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm bg-blue-50">
      <span className="flex-1 truncate text-blue-800">{form.demand_title ?? form.demand_id}</span>
      <button
        type="button"
        onClick={() => setForm(f => ({ ...f, demand_id: null, demand_title: null }))}
        className="text-gray-400 hover:text-red-500"
      >✕</button>
    </div>
  ) : (
    <div className="relative">
      <input
        type="search"
        placeholder="Buscar demanda por título..."
        className="w-full border rounded px-3 py-1.5 text-sm"
        onChange={e => searchDemands(e.target.value)}
      />
      {demandResults.length > 0 && (
        <ul className="absolute z-10 top-full left-0 right-0 bg-white border rounded-b shadow text-sm max-h-40 overflow-y-auto">
          {demandResults.map(d => (
            <li key={d.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-800"
                onClick={() => {
                  setForm(f => ({ ...f, demand_id: d.id, demand_title: d.title }))
                  setDemandResults([])
                }}
              >
                {d.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )}
</div>
```

Ao salvar, incluir `demand_id` no payload enviado ao backend.

- [ ] **Step 5.7: Verificar**

1. Abrir `/admin/campaigns`, criar campanha
2. Campo "Demanda de produção" aparece — buscar e selecionar uma demanda
3. Salvar campanha — confirmar via SQL que `demand_id` foi persistido
4. Na demanda vinculada, NÃO anexar criativo
5. Forçar o check via `runMaterialDeadlineCheck()` no backend (ou ajustar data via SQL para testar)
6. Notificação aparece no sino

- [ ] **Step 5.8: Commit**

```powershell
$msg = @'
feat: gestão de prazos de entrega de materiais criativos

Migration 032 adiciona demand_id (nullable) em campaigns.
Job diário alerta 7/3/1 dia antes do início quando demanda vinculada
não tem arte criativa anexada. Demand picker em AdminCampaigns.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/032_campaigns_demand_link.sql `
      backend/src/services/campaigns.service.js `
      backend/src/services/materialDeadlines.service.js `
      backend/src/index.js `
      frontend/src/pages/admin/AdminCampaigns.jsx
git commit -m $msg
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: galeria de evidências PoP no portal externo
- ✅ Task 2: portfólios por cliente sem nova migration
- ✅ Task 3: migration 030 + CRUD + cron diário + UI
- ✅ Task 4: migration 031 + kind=creative + versão auto-incrementada + CreativeBlock
- ✅ Task 5: migration 032 + demand_id + cron diário + demand picker

**Placeholder scan:** Nenhum "TBD" ou "TODO" nas seções de código. Step 4.5 menciona verificar endpoint de filtragem de attachments — implementador deve confirmar antes de construir CreativeBlock (ver nota no step).

**Type consistency:**
- `runDocumentExpiryCheck` exportado em `assetDocuments.service.js` e importado no `index.js` com o mesmo nome ✓
- `runMaterialDeadlineCheck` exportado em `materialDeadlines.service.js` e importado no `index.js` ✓
- `nextVersion` computado antes do stream busboy e usado no INSERT ✓
- `demand_id` consistente em `createCampaign`, `updateCampaign` e `listCampaigns` (LEFT JOIN) ✓

**Pendências de contexto:**
- Task 4 Step 4.3: o implementador deve ler o INSERT real de `uploadAttachment` antes de editar — o número e ordem dos `$N` varia
- Task 4 Step 4.4: verificar se `GET /demands/:id/attachments` aceita `?kind=` como filtro; se não, adicionar suporte no controller
- Task 3 Step 3.7: o implementador deve ler `AdminAssets.jsx` para entender a estrutura exata antes de adicionar o estado de documentos

## Features Diferidas (fora do escopo desta fase)

| Feature | Motivo da diferimento |
|---|---|
| Proofing e Anotações Visuais | Requer biblioteca canvas (Fabric.js); anotações JSON em banco; scope > 2 dias |
| Formulários de Intake Inteligentes | Exige form builder ou templates fixos por tipo de demanda; significativa nova UI |
| Controle de Alçadas para Reservas | Requer conceito de "hold" em campaigns, approval chain multi-nível |
| Conformidade Fiscal Regionalizada | Módulo de faturamento/notas fiscais inexistente; ISS por município é infraestrutura nova |
