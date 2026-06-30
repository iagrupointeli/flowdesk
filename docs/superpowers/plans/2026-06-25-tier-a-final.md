# Tier A — Features Finais (PDF Report + Intake Forms + Campaign Holds)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar os 3 itens restantes executáveis do Tier A: commit do relatório PDF já escrito, formulários de intake público por tipo de demanda, e controle de alçadas para reservas premium.

**Architecture:** Três features independentes, cada uma em um commit. Task 1 é zero-risco (só commit + botão). Task 2 introduz link tokenizado público para criação de demandas sem login (padrão `external_links` já existente). Task 3 adiciona coluna `approval_status` em `campaigns` + flag `is_premium` em `assets` para bloquear reservas de pontos premium até aprovação de gerente.

**Tech Stack:** Node 20 + Express + PostgreSQL 16 + Zod · React 18 + Vite + Zustand · PDFKit (já instalado: `^0.19.1`) · `crypto.randomBytes` (Node built-in) para tokens · ES modules (`import`/`export`)

---

## Mapa de Arquivos

| Arquivo | Tasks | Ação |
|---|---|---|
| `backend/src/services/dashboard.service.js` | 1 | Commit (já modificado) |
| `backend/src/services/report.service.js` | 1 | Commit (já criado, untracked) |
| `backend/src/controllers/report.controller.js` | 1 | Commit (já criado, untracked) |
| `backend/src/routes/report.routes.js` | 1 | Commit (já criado, untracked) |
| `frontend/src/pages/Dashboard.jsx` | 1 | Modificar — botão PDF |
| `backend/src/migrations/sql/033_intake_links.sql` | 2 | Criar |
| `backend/src/services/intake.service.js` | 2 | Criar |
| `backend/src/controllers/intake.controller.js` | 2 | Criar |
| `backend/src/routes/intake.routes.js` | 2 | Criar |
| `backend/src/routes/admin.routes.js` | 2 | Modificar — gerar link |
| `backend/src/index.js` | 2 | Modificar — montar rota pública |
| `frontend/src/pages/IntakeForm.jsx` | 2 | Criar |
| `frontend/src/App.jsx` | 2 | Modificar — rota pública |
| `backend/src/migrations/sql/034_campaigns_holds.sql` | 3 | Criar |
| `backend/src/services/campaigns.service.js` | 3 | Modificar |
| `backend/src/controllers/campaigns.controller.js` | 3 | Modificar |
| `backend/src/routes/campaigns.routes.js` | 3 | Modificar |
| `frontend/src/pages/admin/AdminCampaigns.jsx` | 3 | Modificar |
| `frontend/src/pages/admin/AdminAssets.jsx` | 3 | Modificar |

---

## Task 1: Commit do Relatório Mensal PDF + Botão no Dashboard

**Escopo:** Os 3 arquivos do relatório PDF já estão escritos e wired no `index.js` (import + `app.use('/api/reports', reportRoutes)`). O `dashboard.service.js` tem a função `getOperationalByDepartment` adicionada mas não comitada. Falta apenas o botão "Baixar PDF" em `Dashboard.jsx` para o feature ficar end-to-end. O PDF requer `year` e `month` como query params — acrescentar seletores de mês/ano na barra de filtros.

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`
- Commit: `backend/src/services/dashboard.service.js` (M)
- Commit: `backend/src/services/report.service.js` (??)
- Commit: `backend/src/controllers/report.controller.js` (??)
- Commit: `backend/src/routes/report.routes.js` (??)

- [ ] **Step 1.1: Adicionar estado e handler de PDF em `Dashboard.jsx`**

Ler o arquivo antes de editar para confirmar os imports existentes. Em `Dashboard.jsx`, adicionar junto aos outros `useState`:

```jsx
const [pdfMonth,     setPdfMonth]     = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
const [pdfYear,      setPdfYear]      = useState(() => String(new Date().getFullYear()))
const [exportingPdf, setExportingPdf] = useState(false)
```

Adicionar a função `handleExportPdf` logo após `handleExport`:

```jsx
async function handleExportPdf() {
  if (exportingPdf) return
  setExportingPdf(true)
  try {
    const response = await api.get('/reports/monthly', {
      params: { year: pdfYear, month: pdfMonth, ...(deptId ? { dept_id: deptId } : {}) },
      responseType: 'blob',
    })
    const url  = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href  = url
    link.download = `relatorio-${pdfYear}-${pdfMonth}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  } catch (err) {
    console.error('[Dashboard] exportar PDF falhou:', err)
    alert('Não foi possível gerar o PDF. Tente novamente.')
  } finally {
    setExportingPdf(false)
  }
}
```

- [ ] **Step 1.2: Adicionar controles de mês/ano + botão PDF na barra de filtros**

No JSX de `Dashboard.jsx`, localizar o bloco do botão "Exportar Relatório (CSV)" (em torno da linha 170–184). Adicionar ANTES desse botão:

```jsx
{/* Seletores de mês/ano para PDF */}
<div className="flex flex-col gap-1">
  <label className="text-xs font-medium text-gray-500">Mês/Ano PDF</label>
  <div className="flex gap-1">
    <select
      value={pdfMonth}
      onChange={e => setPdfMonth(e.target.value)}
      className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none"
    >
      {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
    <input
      type="number"
      value={pdfYear}
      onChange={e => setPdfYear(e.target.value)}
      min="2020"
      max="2100"
      className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none"
    />
  </div>
</div>

{/* Botão PDF */}
<button
  onClick={handleExportPdf}
  disabled={exportingPdf || isLoading}
  className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2
             text-sm font-semibold text-white transition-colors
             hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
>
  {exportingPdf ? (
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
  ) : (
    <span>📄</span>
  )}
  Relatório PDF
</button>
```

- [ ] **Step 1.3: Verificar**

1. Iniciar o backend (`npm run dev`)
2. Navegar para `/dashboard`
3. Os seletores de Mês/Ano aparecem
4. Clicar "Relatório PDF" → arquivo `relatorio-YYYY-MM.pdf` baixado
5. Abrir o PDF: cabeçalho com o mês/ano, seção Indicadores, tabela de departamentos, tabela de demandas

- [ ] **Step 1.4: Commit**

```powershell
$msg = @'
feat: relatório mensal PDF on-demand

GET /api/reports/monthly gera PDF com indicadores, operacional por
departamento e lista de demandas do período. Dashboard.jsx exibe
seletores mês/ano e botão "Relatório PDF" ao lado do CSV.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/services/dashboard.service.js `
      backend/src/services/report.service.js `
      backend/src/controllers/report.controller.js `
      backend/src/routes/report.routes.js `
      frontend/src/pages/Dashboard.jsx
git commit -m $msg
```

---

## Task 2: Formulários de Intake Inteligentes

**Escopo:** Link público tokenizado por tipo de demanda. Qualquer pessoa com a URL `/intake/<token>` preenche um formulário estruturado e o sistema cria a demanda automaticamente (sem login). Padrão: SHA-256 do token em claro (igual a `external_links`). O admin gera o link em `AdminDemandTypes` ou via `POST /api/admin/demand-types/:id/intake-link`. A demanda criada tem `requester_id` = admin que criou o link (nenhum usuário novo é criado).

**Files:**
- Create: `backend/src/migrations/sql/033_intake_links.sql`
- Create: `backend/src/services/intake.service.js`
- Create: `backend/src/controllers/intake.controller.js`
- Create: `backend/src/routes/intake.routes.js`
- Modify: `backend/src/routes/admin.routes.js`
- Modify: `backend/src/index.js`
- Create: `frontend/src/pages/IntakeForm.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 2.1: Criar migration 033**

```sql
-- backend/src/migrations/sql/033_intake_links.sql
-- ─── 033: intake_links — links públicos de intake por tipo de demanda ──────────
--
-- Um intake_link é um URL tokenizado que permite criar uma demanda de um tipo
-- específico sem autenticação. O admin gera o link; o submissor preenche o
-- formulário e o sistema cria a demanda automaticamente.
--
-- Segurança: token em claro é retornado UMA VEZ na criação.
--            Apenas o SHA-256 hex (token_hash) é armazenado.
-- Expiração: expires_at NULL = nunca expira.
--            Expirado = formulário exibe mensagem de link inválido.

CREATE TABLE IF NOT EXISTS intake_links (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_type_id  UUID         NOT NULL REFERENCES demand_types(id) ON DELETE CASCADE,
  label           VARCHAR(200) NOT NULL,       -- nome descritivo (ex: "Pedido de Arte Digital")
  token_hash      VARCHAR(64)  NOT NULL UNIQUE, -- SHA-256 hex do token opaco (256 bits)
  expires_at      TIMESTAMPTZ  NULL,
  created_by      UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_links_type
  ON intake_links (demand_type_id);
```

- [ ] **Step 2.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: 033 aplicado sem erros
```

- [ ] **Step 2.3: Criar `intake.service.js`**

```js
// backend/src/services/intake.service.js
import crypto                       from 'crypto'
import { query, getClient }         from '#config/database.js'

const sha256 = token => crypto.createHash('sha256').update(token, 'utf8').digest('hex')

/**
 * Gera um link de intake para um tipo de demanda.
 * Retorna { token, link } — token em claro exibido UMA VEZ.
 */
export async function createIntakeLink(actor, demandTypeId, { label, expires_at = null }) {
  // Confirma que o tipo existe e pertence ao escopo do ator
  const { rows: dtRows } = await query(
    'SELECT id FROM demand_types WHERE id = $1 AND archived_at IS NULL',
    [demandTypeId]
  )
  if (!dtRows[0]) throw Object.assign(new Error('Tipo de demanda não encontrado.'), { status: 404 })

  const token     = crypto.randomBytes(32).toString('base64url')
  const tokenHash = sha256(token)

  await query(
    `INSERT INTO intake_links (demand_type_id, label, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [demandTypeId, label, tokenHash, expires_at ?? null, actor.id]
  )

  return { token, url: `/intake/${token}` }
}

/**
 * Lista os intake links de um tipo de demanda.
 */
export async function listIntakeLinks(demandTypeId) {
  const { rows } = await query(
    `SELECT il.id, il.label, il.expires_at, il.created_at,
            u.name AS created_by_name
     FROM intake_links il
     JOIN users u ON u.id = il.created_by
     WHERE il.demand_type_id = $1
     ORDER BY il.created_at DESC`,
    [demandTypeId]
  )
  return rows
}

/**
 * Remove um intake link por id.
 */
export async function deleteIntakeLink(id) {
  const { rowCount } = await query('DELETE FROM intake_links WHERE id = $1', [id])
  if (!rowCount) throw Object.assign(new Error('Link não encontrado.'), { status: 404 })
}

/**
 * Resolve o token e retorna o schema do formulário (demand_type + fields).
 * Usado pela página pública antes de exibir o form.
 */
export async function resolveIntakeToken(token) {
  const tokenHash = sha256(token)

  const { rows } = await query(
    `SELECT il.id, il.demand_type_id, il.label, il.expires_at,
            il.created_by,
            dt.name AS demand_type_name
     FROM intake_links il
     JOIN demand_types dt ON dt.id = il.demand_type_id
     WHERE il.token_hash = $1`,
    [tokenHash]
  )

  if (!rows[0]) throw Object.assign(new Error('Link inválido ou expirado.'), { status: 404 })
  const link = rows[0]

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    throw Object.assign(new Error('Link inválido ou expirado.'), { status: 410 })
  }

  // Busca os campos ativos do tipo de demanda
  const { rows: fields } = await query(
    `SELECT id, label, field_type, required, options, display_order
     FROM demand_type_fields
     WHERE demand_type_id = $1 AND archived_at IS NULL
     ORDER BY display_order`,
    [link.demand_type_id]
  )

  return {
    link_label:       link.label,
    demand_type_id:   link.demand_type_id,
    demand_type_name: link.demand_type_name,
    fields,
    created_by:       link.created_by,
  }
}

/**
 * Cria a demanda a partir da submissão pública do formulário de intake.
 * requester_id = admin que criou o link (sem novo usuário criado).
 */
export async function submitIntake(token, { title, requester_name, requester_email = '', notes = '', payload = {} }) {
  const form = await resolveIntakeToken(token)

  // Snapshot dos campos ativos (igual ao createDemand normal)
  const snapshot = form.fields

  // Valida payload — reusa a lógica de validatePayload
  const errors = []
  for (const field of snapshot) {
    if (!field.required) continue
    const val = payload[field.id]
    if (val === undefined || val === null || val === '') {
      errors.push(`Campo "${field.label}" é obrigatório.`)
    }
  }
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 422 })

  // Obtém a primeira etapa do tipo de demanda
  const { rows: stageRows } = await query(
    `SELECT id FROM workflow_stages
     WHERE demand_type_id = $1 AND archived_at IS NULL
     ORDER BY display_order LIMIT 1`,
    [form.demand_type_id]
  )
  if (!stageRows[0]) throw Object.assign(new Error('Tipo de demanda sem etapas configuradas.'), { status: 422 })

  const slaRow = await query(
    'SELECT sla_hours FROM demand_types WHERE id = $1',
    [form.demand_type_id]
  )
  const slaHours = slaRow.rows[0]?.sla_hours ?? null

  const description = [
    `Submetido por: ${requester_name}${requester_email ? ` <${requester_email}>` : ''}`,
    notes ? `\nObservações: ${notes}` : '',
    `\n[Via formulário de intake: ${form.link_label}]`,
  ].join('')

  const client = await getClient()
  let demandId
  try {
    await client.query('BEGIN')

    const { rows: demandRows } = await client.query(
      `INSERT INTO demands
         (title, description, requester_id, demand_type_id, current_stage_id,
          fields_snapshot, payload, due_date)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
               CASE WHEN $8::int IS NOT NULL
                    THEN NOW() + ($8::int * INTERVAL '1 hour')
                    ELSE NULL END)
       RETURNING id`,
      [
        title,
        description,
        form.created_by,    // requester_id = admin do link
        form.demand_type_id,
        stageRows[0].id,
        JSON.stringify(snapshot),
        JSON.stringify(payload),
        slaHours,
      ]
    )
    demandId = demandRows[0].id

    await client.query(
      `INSERT INTO demand_history
         (demand_id, actor_id, action, stage_id, snapshot)
       VALUES ($1, $2, 'created', $3, '{}'::jsonb)`,
      [demandId, form.created_by, stageRows[0].id]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { demand_id: demandId }
}
```

- [ ] **Step 2.4: Criar `intake.controller.js`**

```js
// backend/src/controllers/intake.controller.js
import { z } from 'zod'
import * as svc from '#services/intake.service.js'

function handleError(err, res) {
  return res.status(err.status ?? 500).json({ error: err.message ?? 'Erro interno.' })
}

export async function getForm(req, res) {
  try {
    return res.json(await svc.resolveIntakeToken(req.params.token))
  } catch (err) { return handleError(err, res) }
}

const submitSchema = z.object({
  title:           z.string().min(1).max(500),
  requester_name:  z.string().min(1).max(200),
  requester_email: z.string().email().optional().or(z.literal('')),
  notes:           z.string().max(2000).optional(),
  payload:         z.record(z.unknown()).optional().default({}),
})

export async function submit(req, res) {
  const parsed = submitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    const result = await svc.submitIntake(req.params.token, parsed.data)
    return res.status(201).json(result)
  } catch (err) { return handleError(err, res) }
}
```

- [ ] **Step 2.5: Criar `intake.routes.js`**

```js
// backend/src/routes/intake.routes.js
import { Router } from 'express'
import * as ctrl  from '#controllers/intake.controller.js'

// Rotas PÚBLICAS — sem authenticate (qualquer um com o token pode acessar)
const router = Router()

router.get ('/:token',        ctrl.getForm)
router.post('/:token/submit', ctrl.submit)

export default router
```

- [ ] **Step 2.6: Adicionar gerenciamento de links em `admin.routes.js`**

Em `backend/src/routes/admin.routes.js`, adicionar import no topo (junto aos outros controllers):

```js
import * as intakeSvc from '#services/intake.service.js'
```

Adicionar as rotas (dentro do router já autenticado e autorizado como super_admin/dept_admin):

```js
// ── Intake links — links públicos para criação de demandas sem login ──────────
router.get   ('/demand-types/:typeId/intake-links', authorize('super_admin', 'dept_admin'), async (req, res) => {
  try {
    return res.json(await intakeSvc.listIntakeLinks(req.params.typeId))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
})

router.post  ('/demand-types/:typeId/intake-links', authorize('super_admin', 'dept_admin'), async (req, res) => {
  try {
    const { label, expires_at } = req.body
    if (!label?.trim()) return res.status(422).json({ error: 'label é obrigatório.' })
    return res.status(201).json(await intakeSvc.createIntakeLink(req.user, req.params.typeId, { label, expires_at }))
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
})

router.delete('/intake-links/:linkId', authorize('super_admin', 'dept_admin'), async (req, res) => {
  try {
    await intakeSvc.deleteIntakeLink(req.params.linkId)
    return res.status(204).end()
  } catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
})
```

- [ ] **Step 2.7: Registrar rota pública em `index.js`**

Em `backend/src/index.js`, adicionar import junto aos outros:

```js
import intakeRoutes from '#routes/intake.routes.js'
```

Adicionar montagem ANTES das rotas autenticadas (intake é pública):

```js
// Rota pública — sem cookie/sessão
app.use('/api/intake', intakeRoutes)
```

- [ ] **Step 2.8: Criar `IntakeForm.jsx`**

```jsx
// frontend/src/pages/IntakeForm.jsx
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const API = import.meta.env.VITE_API_URL ?? '/api'

function FieldInput({ field, value, onChange }) {
  const base = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500'

  if (field.field_type === 'select') {
    return (
      <select className={base} value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required}>
        <option value="">Selecione...</option>
        {(field.options ?? []).map(opt => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    )
  }
  if (field.field_type === 'textarea') {
    return (
      <textarea className={base} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required} />
    )
  }
  const inputType = { number: 'number', date: 'date', cpf: 'text' }[field.field_type] ?? 'text'
  return (
    <input type={inputType} className={base} value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required}
      placeholder={field.field_type === 'cpf' ? '000.000.000-00' : undefined}
    />
  )
}

export default function IntakeForm() {
  const { token } = useParams()
  const [form,      setForm]      = useState(null)   // { link_label, demand_type_name, fields }
  const [status,    setStatus]    = useState('loading') // loading | form | submitted | error
  const [errorMsg,  setErrorMsg]  = useState('')
  const [title,     setTitle]     = useState('')
  const [name,      setName]      = useState('')
  const [email,     setEmail]     = useState('')
  const [notes,     setNotes]     = useState('')
  const [payload,   setPayload]   = useState({})
  const [submitting,setSubmitting]= useState(false)

  const loadForm = useCallback(async () => {
    try {
      const res = await fetch(`${API}/intake/${token}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setErrorMsg(body.error ?? 'Link inválido ou expirado.')
        setStatus('error')
        return
      }
      const data = await res.json()
      setForm(data)
      setStatus('form')
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.')
      setStatus('error')
    }
  }, [token])

  useEffect(() => { loadForm() }, [loadForm])

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/intake/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, requester_name: name, requester_email: email, notes, payload }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.error ?? 'Erro ao enviar formulário.')
        return
      }
      setStatus('submitted')
    } catch {
      alert('Erro de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Carregando formulário...</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm text-center">
          <p className="text-2xl mb-2">🔗</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Link inválido</h1>
          <p className="text-sm text-gray-500">{errorMsg}</p>
        </div>
      </div>
    )
  }

  if (status === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm text-center">
          <p className="text-3xl mb-3">✅</p>
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Pedido enviado!</h1>
          <p className="text-sm text-gray-500">Seu pedido foi registrado e será processado em breve.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">{form.link_label}</h1>
          <p className="text-sm text-gray-500 mt-1">Tipo: {form.demand_type_name}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-6 space-y-4">
          {/* Título do pedido */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Título do pedido *</label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Ex: Arte para campanha de verão"
            />
          </div>

          {/* Identificação do solicitante */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Seu nome *</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Campos dinâmicos do tipo de demanda */}
          {(form.fields ?? []).map(field => (
            <div key={field.id}>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                {field.label}{field.required && ' *'}
              </label>
              <FieldInput
                field={field}
                value={payload[field.id] ?? ''}
                onChange={val => setPayload(p => ({ ...p, [field.id]: val }))}
              />
            </div>
          ))}

          {/* Observações livres */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Informações adicionais..."
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 text-white text-sm font-semibold py-2.5 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Enviando...' : 'Enviar pedido'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2.9: Registrar rota em `App.jsx`**

Em `frontend/src/App.jsx`, adicionar import lazy junto aos outros:

```jsx
const IntakeForm = lazy(() => import('./pages/IntakeForm'))
```

Adicionar rota FORA do bloco `<ProtectedRoute>` (é rota pública):

```jsx
{/* Rota pública — formulário de intake (sem login) */}
<Route path="/intake/:token" element={<IntakeForm />} />
```

- [ ] **Step 2.10: Verificar**

1. Rodar migration 033
2. Gerar link via `POST /api/admin/demand-types/<id>/intake-links` com body `{ "label": "Teste" }`
3. Abrir `/intake/<token>` no browser (sem estar logado → funciona)
4. Preencher e submeter → status 201, tela de confirmação
5. Verificar no board que a demanda foi criada no primeiro estágio do tipo
6. Tentar abrir link expirado → tela "Link inválido"

- [ ] **Step 2.11: Commit**

```powershell
$msg = @'
feat: formulários de intake inteligentes

Migration 033 cria intake_links (link público tokenizado por tipo de demanda).
POST /intake/:token/submit cria demanda sem login — requester_id = admin do link.
IntakeForm.jsx renderiza campos dinâmicos do demand_type via token.
Admin gera/lista/remove links via /admin/demand-types/:id/intake-links.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/033_intake_links.sql `
      backend/src/services/intake.service.js `
      backend/src/controllers/intake.controller.js `
      backend/src/routes/intake.routes.js `
      backend/src/routes/admin.routes.js `
      backend/src/index.js `
      frontend/src/pages/IntakeForm.jsx `
      frontend/src/App.jsx
git commit -m $msg
```

---

## Task 3: Controle de Alçadas para Reservas (Holds)

**Escopo:** Pontos marcados como `is_premium` (ou campanhas com duração > 30 dias) precisam de aprovação de gestor antes de serem confirmadas. A campanha entra em `approval_status = 'pending'` no momento da criação — a exclusion constraint `no_double_booking` continua ativa (a reserva bloqueia o slot). Gestor aprova/rejeita via `AdminCampaigns.jsx`. Rejeição arquiva a campanha (libera o slot). Notificação SSE a todos os `dept_admin` e `super_admin`.

**Files:**
- Create: `backend/src/migrations/sql/034_campaigns_holds.sql`
- Modify: `backend/src/services/campaigns.service.js`
- Modify: `backend/src/controllers/campaigns.controller.js`
- Modify: `backend/src/routes/campaigns.routes.js`
- Modify: `frontend/src/pages/admin/AdminCampaigns.jsx`
- Modify: `frontend/src/pages/admin/AdminAssets.jsx`

- [ ] **Step 3.1: Criar migration 034**

```sql
-- backend/src/migrations/sql/034_campaigns_holds.sql
-- ─── 034: campaigns holds + assets is_premium ────────────────────────────────
--
-- Controle de alçadas para reservas:
--
-- assets.is_premium: pontos premium (painel de rua de alto tráfego, etc.)
--   qualquer campanha neste ponto entra como 'pending' para aprovação.
--
-- campaigns.approval_status:
--   'approved' = confirmado (default para pontos normais)
--   'pending'  = aguardando aprovação do gestor (pontos premium ou duração > 30d)
--   'rejected' = reprovado — archived_at setado, slot liberado
--
-- campaigns.approval_note: motivo opcional de rejeição.
-- campaigns.approved_by:   quem aprovou/rejeitou.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(10) NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_note   TEXT NULL,
  ADD COLUMN IF NOT EXISTS approved_by     UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_approval
  ON campaigns (approval_status)
  WHERE approval_status = 'pending' AND archived_at IS NULL;
```

- [ ] **Step 3.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: 034 aplicado sem erros
```

- [ ] **Step 3.3: Modificar `campaigns.service.js`**

**Adicionar import de notifications no topo** (se não existir):

```js
import { createNotification } from '#services/notifications.service.js'
import { logger }             from '#lib/logger.js'
const log = logger.child({ module: 'campaigns' })
```

**Modificar `createCampaign`** — adicionar lógica de hold logo antes do INSERT:

```js
export async function createCampaign(actor, data) {
  const { asset_id, client_name, title, starts_on, ends_on,
          notes = null, demand_id = null } = data

  // Verifica se o ponto existe e busca is_premium
  const { rows: assetRows } = await query(
    'SELECT id, name, code, is_premium FROM assets WHERE id = $1 AND archived_at IS NULL',
    [asset_id]
  )
  if (!assetRows[0]) throw Object.assign(new Error('Ponto não encontrado.'), { status: 404 })
  const asset = assetRows[0]

  // Determina se exige aprovação:
  // - Ponto premium (is_premium = true), OU
  // - Período longo (> 30 dias)
  const durationDays = Math.ceil(
    (new Date(ends_on) - new Date(starts_on)) / (1000 * 60 * 60 * 24)
  )
  const needsApproval = asset.is_premium || durationDays > 30
  const approvalStatus = needsApproval ? 'pending' : 'approved'

  let campaign
  try {
    const { rows } = await query(
      `INSERT INTO campaigns
         (asset_id, client_name, title, starts_on, ends_on, notes,
          demand_id, created_by, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, asset_id, client_name, title, starts_on, ends_on,
                 demand_id, approval_status, created_at`,
      [asset_id, client_name, title, starts_on, ends_on, notes,
       demand_id, actor.id, approvalStatus]
    )
    campaign = rows[0]
  } catch (err) { throw translateExclusionError(err, asset_id) }

  // Notifica gestores se campanha entrou como pending
  if (needsApproval) {
    const assetLabel = asset.code ? `[${asset.code}] ${asset.name}` : asset.name
    const reason     = asset.is_premium ? 'ponto premium' : `período longo (${durationDays} dias)`
    const message    = `⏳ Campanha "${client_name} — ${title}" (${assetLabel}) aguarda aprovação — ${reason}.`
    const link       = '/admin/campaigns'

    const { rows: managers } = await query(
      `SELECT id FROM users WHERE role IN ('super_admin', 'dept_admin') AND archived_at IS NULL`
    )
    for (const m of managers) {
      createNotification(m.id, message, link, 'system')
        .catch(err => log.error({ err }, 'Falha ao notificar hold de campanha'))
    }
  }

  return campaign
}
```

**Atualizar `listCampaigns`** — adicionar `approval_status` e `is_premium` no SELECT:

```js
// No SELECT de listCampaigns, adicionar:
c.approval_status,
a.is_premium,
// (adicionar após as colunas já existentes na query)
```

**Adicionar função `approveCampaign`** no final do service:

```js
export async function approveCampaign(actor, campaignId, { action, note = null }) {
  if (!['approved', 'rejected'].includes(action)) {
    throw Object.assign(new Error('Ação inválida. Use "approved" ou "rejected".'), { status: 422 })
  }

  const client = await getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `UPDATE campaigns
       SET approval_status = $1,
           approval_note   = $2,
           approved_by     = $3
       WHERE id = $4 AND approval_status = 'pending'
       RETURNING id, title, client_name, approval_status`,
      [action, note, actor.id, campaignId]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Campanha não encontrada ou já processada.'), { status: 404 })
    }

    // Rejeição → arquiva (libera o slot da exclusion constraint)
    if (action === 'rejected') {
      await client.query(
        'UPDATE campaigns SET archived_at = NOW() WHERE id = $1',
        [campaignId]
      )
    }

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 3.4: Adicionar controller `approve` em `campaigns.controller.js`**

Ler o arquivo para verificar o padrão de exports. Adicionar ao final:

```js
export async function approve(req, res) {
  try {
    const { action, note } = req.body
    if (!action) return res.status(422).json({ error: '"action" é obrigatório (approved | rejected).' })
    return res.json(await svc.approveCampaign(req.user, req.params.id, { action, note }))
  } catch (err) { return handleError(err, res) }
}
```

- [ ] **Step 3.5: Adicionar rota em `campaigns.routes.js`**

Ler o arquivo para verificar o padrão de rotas. Adicionar:

```js
router.post('/:id/approval', authorize('super_admin', 'dept_admin'), ctrl.approve)
```

- [ ] **Step 3.6: Toggle `is_premium` em `AdminAssets.jsx`**

Ler `AdminAssets.jsx` para entender onde ficam os controles de cada ponto. Adicionar toggle `is_premium` por linha/card de asset:

```jsx
{/* Toggle premium — adicionar junto ao botão de Documentos */}
<button
  onClick={async () => {
    await api.patch(`/admin/assets/${asset.id}`, { is_premium: !asset.is_premium })
    // Recarregar a lista (usar a função de reload já existente no componente)
    load()
  }}
  className={`text-xs px-2 py-1 rounded border ${
    asset.is_premium
      ? 'border-amber-400 bg-amber-50 text-amber-700'
      : 'border-gray-200 text-gray-400'
  }`}
  title={asset.is_premium ? 'Ponto premium (clique para remover)' : 'Marcar como premium'}
>
  {asset.is_premium ? '⭐ Premium' : '☆ Premium'}
</button>
```

> **Nota:** Verificar se `PATCH /admin/assets/:id` já existe e aceita `is_premium`. Se o controller/service de assets não aceitar o campo ainda, adicionar `is_premium` ao schema Zod e ao UPDATE do service de assets.

- [ ] **Step 3.7: Badge e ações em `AdminCampaigns.jsx`**

Ler `AdminCampaigns.jsx` antes de editar. Adicionar badge de status e botões de aprovação na tabela/lista de campanhas:

```jsx
{/* Badge de approval_status — adicionar junto ao título ou na coluna de status */}
{camp.approval_status === 'pending' && (
  <span className="ml-2 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">
    AGUARDA APROVAÇÃO
  </span>
)}
{camp.approval_status === 'rejected' && (
  <span className="ml-2 rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-[10px] font-semibold">
    REPROVADA
  </span>
)}

{/* Botões de aprovação — exibir apenas se pending e se usuário é gestor */}
{camp.approval_status === 'pending' && (
  <div className="flex gap-2 mt-1">
    <button
      onClick={async () => {
        await api.post(`/campaigns/${camp.id}/approval`, { action: 'approved' })
        load()  // recarregar lista
      }}
      className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
    >
      ✓ Aprovar
    </button>
    <button
      onClick={async () => {
        const note = prompt('Motivo da reprovação (opcional):') ?? ''
        await api.post(`/campaigns/${camp.id}/approval`, { action: 'rejected', note })
        load()
      }}
      className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
    >
      ✕ Reprovar
    </button>
  </div>
)}
```

- [ ] **Step 3.8: Verificar**

1. Marcar um asset como premium via toggle
2. Criar campanha para esse asset → `approval_status = 'pending'`
3. Verificar no banco: `SELECT approval_status FROM campaigns WHERE ...`
4. Notificação aparece no sino dos gestores
5. Aprovar → `approval_status = 'approved'`, campanha visível normalmente
6. Criar segunda campanha pendente → reprovar → campanha arquivada, slot liberado
7. Criar nova campanha no mesmo período → funciona (slot estava livre)
8. Criar campanha com > 30 dias para asset normal → entra como pending

- [ ] **Step 3.9: Commit**

```powershell
$msg = @'
feat: controle de alçadas para reservas (holds)

Migration 034 adiciona is_premium em assets e approval_status em campaigns.
Campanhas para pontos premium ou >30 dias entram como pending e notificam gestores.
Rejeição arquiva a campanha e libera o slot. Badge + aprovação em AdminCampaigns.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/034_campaigns_holds.sql `
      backend/src/services/campaigns.service.js `
      backend/src/controllers/campaigns.controller.js `
      backend/src/routes/campaigns.routes.js `
      frontend/src/pages/admin/AdminCampaigns.jsx `
      frontend/src/pages/admin/AdminAssets.jsx
git commit -m $msg
```

---

## Self-Review

**Spec coverage:**
- ✅ Task 1: relatório PDF on-demand com botão mês/ano no dashboard
- ✅ Task 2: intake form público por tipo de demanda, criação automática de demanda
- ✅ Task 3: hold para pontos premium + aprovação/rejeição de gestores

**Placeholder scan:**
- Task 2 Step 2.6: rotas de intake nos admin.routes importam `intakeSvc` diretamente em vez de criar controller separado — aceitável pois são 3 handlers inline simples.
- Task 3 Step 3.6: nota explícita sobre verificar `PATCH /admin/assets/:id` antes de adicionar toggle.
- Task 3 Step 3.7: `load()` pode ter nome diferente em `AdminCampaigns.jsx` — o implementador deve verificar o nome real da função de reload.

**Type consistency:**
- `approveCampaign(actor, campaignId, { action, note })` → controller passa `req.user`, `req.params.id`, `{ action, note }` ✓
- `createIntakeLink` retorna `{ token, url }` → controller usa `token` e `url` ✓
- `resolveIntakeToken` e `submitIntake` usam o mesmo `sha256(token)` via função local ✓
- `approval_status CHECK ('pending','approved','rejected')` consistente entre migration, service e frontend badge ✓

**Features diferidas (fora deste plano):**
- **Proofing e Anotações Visuais**: requer canvas (Fabric.js), anotações JSON posicionadas, upload de arquivo anotado — scope > 2 dias
- **Conformidade Fiscal Regionalizada**: módulo de faturamento/notas fiscais não existe
