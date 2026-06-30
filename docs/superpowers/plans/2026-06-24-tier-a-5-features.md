# Tier A — 5 Features Operacionais OOH

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as 5 features de Tier A que mais agregam valor operacional imediato ao InteliCore OOH, aproveitando a infraestrutura existente (Kanban, anexos, notificações SSE, campanhas).

**Architecture:** Cada feature é independente e pode ser commitada separadamente. Features 2 e 5 exigem migrations SQL (028 e 029). Features 1, 3 e 4 são puramente código. Nenhuma depende da outra para funcionar.

**Tech Stack:** Node 20 + Express + PostgreSQL 16 + Zod · React 18 + Vite + Zustand · MinIO (anexos via `storage.service.js`) · `archiver` npm (Feature 4, instalar)

---

## Mapa de Arquivos

| Arquivo | Features | Ação |
|---|---|---|
| `backend/src/migrations/sql/028_workflow_stages_requires_attachment.sql` | 2 | Criar |
| `backend/src/migrations/sql/029_stage_notifications.sql` | 5 | Criar |
| `backend/src/services/demands.service.js` | 1, 2, 3, 4 | Modificar |
| `backend/src/controllers/demands.controller.js` | 1, 4 | Modificar |
| `backend/src/routes/demands.routes.js` | 1, 4 | Modificar |
| `backend/src/services/stageNotifications.service.js` | 5 | Criar |
| `backend/src/controllers/stageNotifications.controller.js` | 5 | Criar |
| `backend/src/routes/admin.routes.js` | 5 | Modificar |
| `frontend/src/components/kanban/Card.jsx` | 1 | Modificar |
| `frontend/src/components/kanban/Column.jsx` | 1 | Modificar |
| `frontend/src/pages/Board.jsx` | 1 | Modificar |
| `frontend/src/pages/admin/AdminWorkflows.jsx` | 2, 5 | Modificar |
| `frontend/src/pages/DemandDetail.jsx` | 4 | Modificar |

---

## Task 1: Ações em Lote para Status de Tarefas

**Escopo:** `PATCH /api/demands/batch-stage` + checkbox UI no Board.

**Files:**
- Modify: `backend/src/services/demands.service.js` (após `moveStage`)
- Modify: `backend/src/controllers/demands.controller.js` (novo export)
- Modify: `backend/src/routes/demands.routes.js` (nova rota)
- Modify: `frontend/src/components/kanban/Card.jsx`
- Modify: `frontend/src/components/kanban/Column.jsx`
- Modify: `frontend/src/pages/Board.jsx`

- [ ] **Step 1.1: Adicionar `batchMoveStage` no service**

Em `backend/src/services/demands.service.js`, logo após a função `moveStage` (por volta da linha 700, onde termina o `dispatchWebhooks`), adicionar:

```js
// ═══════════════════════════════════════════════════════════════════════════════
// BATCH MOVE STAGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Move várias demandas para a mesma etapa em sequência.
 * Demandas que falham (escopo, regras) são relatadas em `failed` sem abortar o lote.
 * @returns {{ succeeded: string[], failed: Array<{id:string, error:string}> }}
 */
export async function batchMoveStage(actor, demandIds, data) {
  const succeeded = []
  const failed    = []

  for (const id of demandIds) {
    try {
      await moveStage(actor, id, data)
      succeeded.push(id)
    } catch (err) {
      failed.push({ id, error: err.message })
    }
  }

  return { succeeded, failed }
}
```

- [ ] **Step 1.2: Adicionar controller para batch**

Em `backend/src/controllers/demands.controller.js`, adicionar no final (antes do último `}`):

```js
const batchStageSchema = z.object({
  demand_ids:  z.array(z.string().uuid()).min(1).max(100),
  stage_id:    z.string().uuid(),
  assignee_id: z.string().uuid().nullable().optional(),
  notes:       z.string().max(2000).optional(),
})

export async function batchMoveStage(req, res) {
  const parsed = batchStageSchema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    const { demand_ids, ...stageData } = parsed.data
    return res.json(await svc.batchMoveStage(req.user, demand_ids, stageData))
  } catch (err) { return handleError(err, res) }
}
```

- [ ] **Step 1.3: Adicionar rota**

Em `backend/src/routes/demands.routes.js`, após a linha `router.get('/export/csv', ...)`:

```js
// Movimentação em lote (admins)
router.patch('/batch-stage', authorize('super_admin', 'dept_admin'), ctrl.batchMoveStage)
```

**ATENÇÃO:** Esta rota literal `/batch-stage` DEVE ficar antes de `router.get('/:id', ...)` para não ser capturada como param UUID — já existe comentário no arquivo sobre isso.

- [ ] **Step 1.4: Verificar backend**

Subir o backend e testar:

```bash
# Pegar dois demand_ids reais do board e um stage_id de destino válido
curl -X PATCH http://localhost:3000/api/demands/batch-stage \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"demand_ids":["<uuid1>","<uuid2>"],"stage_id":"<stage_uuid>"}'
# Esperado: { "succeeded": ["<uuid1>","<uuid2>"], "failed": [] }
```

- [ ] **Step 1.5: Checkbox no Card**

Em `frontend/src/components/kanban/Card.jsx`, aceitar props `isSelected`, `onToggle` e `selectionMode`:

```jsx
// No início do componente Card, adicionar parâmetros:
export default function Card({ demand, isSelected = false, onToggle, selectionMode = false, ...rest }) {

  // No JSX, envolver o card raiz com posição relative e adicionar checkbox:
  return (
    <div className="relative ...">  {/* className existente, adicionar 'relative' */}
      {selectionMode && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(demand.id)}
          onClick={e => e.stopPropagation()}
          className="absolute top-2 left-2 z-10 h-4 w-4 accent-blue-600 cursor-pointer"
        />
      )}
      {/* resto do JSX existente sem alterações */}
    </div>
  )
}
```

- [ ] **Step 1.6: Passar props do Column para o Card**

Em `frontend/src/components/kanban/Column.jsx`, repassar `selectionMode`, `selectedIds`, `onToggleSelect`:

```jsx
// Adicionar nas props do componente Column:
export default function Column({ stage, demands, selectionMode = false, selectedIds = new Set(), onToggleSelect, ...rest }) {

// Na renderização de cada Card dentro do map:
<Card
  key={demand.id}
  demand={demand}
  selectionMode={selectionMode}
  isSelected={selectedIds.has(demand.id)}
  onToggle={onToggleSelect}
  // ...props existentes
/>
```

- [ ] **Step 1.7: Estado e barra de ação em lote no Board**

Em `frontend/src/pages/Board.jsx`, adicionar estado de seleção e barra de ações:

```jsx
// Adicionar estados (junto aos outros useState):
const [selectionMode, setSelectionMode]   = useState(false)
const [selectedIds,   setSelectedIds]     = useState(new Set())
const [batchStageId,  setBatchStageId]    = useState('')
const [batchLoading,  setBatchLoading]    = useState(false)

// Handler de toggle
const handleToggleSelect = useCallback((demandId) => {
  setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(demandId) ? next.delete(demandId) : next.add(demandId)
    return next
  })
}, [])

// Handler de aplicar lote
const handleBatchMove = useCallback(async () => {
  if (!batchStageId || selectedIds.size === 0) return
  setBatchLoading(true)
  try {
    const { data } = await api.patch('/demands/batch-stage', {
      demand_ids: [...selectedIds],
      stage_id:   batchStageId,
    })
    // Recarrega o board após o lote
    if (data.succeeded.length > 0) {
      await fetchBoard(demandTypeId, { q: qParam, assignee_id: assigneeParam, tag_id: tagParam })
    }
    setSelectedIds(new Set())
    setSelectionMode(false)
    if (data.failed.length > 0) {
      alert(`${data.succeeded.length} movidas. ${data.failed.length} falharam:\n${data.failed.map(f => f.error).join('\n')}`)
    }
  } catch (err) {
    alert('Erro ao mover em lote: ' + (err.response?.data?.error ?? err.message))
  } finally {
    setBatchLoading(false)
  }
}, [batchStageId, selectedIds, demandTypeId, qParam, assigneeParam, tagParam])

// No JSX, adicionar barra acima das colunas (antes do DndContext):
{actorRole !== 'user' && (
  <div className="flex items-center gap-3 mb-3 px-1">
    <button
      onClick={() => { setSelectionMode(v => !v); setSelectedIds(new Set()) }}
      className={`text-xs px-3 py-1 rounded border ${selectionMode ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
    >
      {selectionMode ? `Selecionar (${selectedIds.size})` : 'Selecionar em lote'}
    </button>
    {selectionMode && selectedIds.size > 0 && (
      <>
        <select
          value={batchStageId}
          onChange={e => setBatchStageId(e.target.value)}
          className="text-xs border rounded px-2 py-1"
        >
          <option value="">Mover para etapa...</option>
          {stages.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          onClick={handleBatchMove}
          disabled={!batchStageId || batchLoading}
          className="text-xs px-3 py-1 rounded bg-green-600 text-white disabled:opacity-50"
        >
          {batchLoading ? 'Movendo...' : `Aplicar (${selectedIds.size})`}
        </button>
      </>
    )}
  </div>
)}

// Em cada Column no DndContext, passar as props de seleção:
<Column
  selectionMode={selectionMode}
  selectedIds={selectedIds}
  onToggleSelect={handleToggleSelect}
  // ...props existentes
/>
```

- [ ] **Step 1.8: Verificar no browser**

1. Abrir `/board/<demand_type_id>` como dept_admin
2. Clicar "Selecionar em lote" — cards mostram checkboxes
3. Marcar 3 cards, escolher etapa destino, clicar "Aplicar (3)"
4. Cards devem mover. Contador some após sucesso.

- [ ] **Step 1.9: Commit**

```powershell
$msg = @'
feat: ações em lote para status de tarefas

PATCH /demands/batch-stage move N demandas para a mesma etapa.
Board.jsx ganha modo de seleção com barra de ação em lote.
Falhas individuais são relatadas sem abortar o lote.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/services/demands.service.js `
      backend/src/controllers/demands.controller.js `
      backend/src/routes/demands.routes.js `
      frontend/src/components/kanban/Card.jsx `
      frontend/src/components/kanban/Column.jsx `
      frontend/src/pages/Board.jsx
git commit -m $msg
```

---

## Task 2: Motor de Handoff Comercial-Produção

**Escopo:** Novo booleano `requires_attachment` em `workflow_stages` + gate no `moveStage()` + toggle no AdminWorkflows.

**Files:**
- Create: `backend/src/migrations/sql/028_workflow_stages_requires_attachment.sql`
- Modify: `backend/src/services/demands.service.js` (função `moveStage`)
- Modify: `frontend/src/pages/admin/AdminWorkflows.jsx`

- [ ] **Step 2.1: Criar migration 028**

```sql
-- backend/src/migrations/sql/028_workflow_stages_requires_attachment.sql
-- ─── 028: workflow_stages — exige anexo antes de avançar ────────────────────────
--
-- Gate de handoff comercial→produção: impede mover uma demanda para esta etapa
-- sem que ao menos um anexo (NF, PI ou qualquer documento) tenha sido upado.
-- Segue o padrão de requires_note / requires_assignee já existentes.

ALTER TABLE workflow_stages
  ADD COLUMN IF NOT EXISTS requires_attachment BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: linha confirmando 028 aplicado sem erros
```

- [ ] **Step 2.3: Adicionar gate no `moveStage()`**

Em `backend/src/services/demands.service.js`, na função `moveStage`, localizar a query que carrega a etapa destino (linha ~572):

```js
// ANTES (linha ~572-577):
const { rows: stageRows } = await query(
  `SELECT id, name, is_final, requires_note, requires_assignee, archived_at
   FROM workflow_stages
   WHERE id = $1 AND demand_type_id = $2`,
  [stage_id, demand.demand_type_id]
)
```

Substituir por:

```js
const { rows: stageRows } = await query(
  `SELECT id, name, is_final, requires_note, requires_assignee, requires_attachment, archived_at
   FROM workflow_stages
   WHERE id = $1 AND demand_type_id = $2`,
  [stage_id, demand.demand_type_id]
)
```

Em seguida, logo após o bloco `if (stage.requires_assignee && !effectiveAssignee)` (linha ~616), adicionar:

```js
  if (stage.requires_attachment) {
    const { rows: attRows } = await query(
      'SELECT 1 FROM attachments WHERE demand_id = $1 LIMIT 1',
      [demandId]
    )
    if (!attRows[0]) {
      throw Object.assign(
        new Error('Esta etapa requer o upload de um documento (NF ou PI) antes de avançar.'),
        { status: 422 }
      )
    }
  }
```

- [ ] **Step 2.4: Verificar gate via curl**

```bash
# Tentar mover uma demanda SEM anexos para uma etapa com requires_attachment=true
# (setar via SQL direto: UPDATE workflow_stages SET requires_attachment=true WHERE id='<uuid>')
curl -X PATCH http://localhost:3000/api/demands/<demand_id>/stage \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"stage_id":"<stage_com_requires_attachment>"}'
# Esperado: 422 {"error":"Esta etapa requer o upload de um documento..."}
```

- [ ] **Step 2.5: Adicionar toggle no AdminWorkflows**

Em `frontend/src/pages/admin/AdminWorkflows.jsx`, localizar o JSX do formulário de edição/criação de etapa. Adicionar o toggle de `requires_attachment` junto aos outros dois (`requires_note`, `requires_assignee`):

```jsx
{/* Adicionar após o toggle de requires_assignee, seguindo o mesmo padrão visual */}
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={stageForm.requires_attachment ?? false}
    onChange={e => setStageForm(f => ({ ...f, requires_attachment: e.target.checked }))}
    className="h-4 w-4 accent-blue-600"
  />
  Exige documento anexado (NF / PI)
</label>
```

Certificar que ao salvar a etapa (PATCH/POST para o endpoint de stages), o campo `requires_attachment` é incluído no payload enviado ao backend.

Verificar qual endpoint atualiza stages em `AdminWorkflows.jsx` e incluir `requires_attachment` no body.

- [ ] **Step 2.6: Verificar no browser**

1. Ir em Admin → Workflows → expandir um tipo de demanda
2. Editar uma etapa intermediária → marcar "Exige documento anexado"
3. Abrir o Board, tentar arrastar um card sem anexos para essa etapa
4. Deve aparecer erro 422 no MoveStageModal

- [ ] **Step 2.7: Commit**

```powershell
$msg = @'
feat: gate de handoff comercial-produção (requires_attachment)

Migration 028 adiciona requires_attachment em workflow_stages.
moveStage() bloqueia com 422 se a etapa exige documento e
a demanda não tem nenhum anexo upado.
Toggle disponível em AdminWorkflows.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/028_workflow_stages_requires_attachment.sql `
      backend/src/services/demands.service.js `
      frontend/src/pages/admin/AdminWorkflows.jsx
git commit -m $msg
```

---

## Task 3: Notificação Automática de "Campanha no Ar"

**Escopo:** Hook no final de `uploadAttachment()` em `demands.service.js` — quando `kind === 'checking'`, notifica solicitante, responsável e colaboradores.

**Files:**
- Modify: `backend/src/services/demands.service.js` (função `uploadAttachment`, linha ~1006)

- [ ] **Step 3.1: Adicionar hook de notificação pós-checking**

Em `backend/src/services/demands.service.js`, função `uploadAttachment`, localizar (linha ~1006):

```js
        await confirmObject(objectName)

        resolve(rows[0])
```

Substituir por:

```js
        await confirmObject(objectName)

        // Notifica ao registrar evidência fotográfica (checking)
        if (kind === 'checking') {
          const link = `/demands/${demandId}`
          const msg  = `📸 Checking registrado em "${demand.title}" — veiculação confirmada.`

          if (demand.requester_id && String(demand.requester_id) !== String(actor.id)) {
            notify(demand.requester_id, msg, link, 'system')
          }
          if (demand.current_assignee_id && String(demand.current_assignee_id) !== String(actor.id)) {
            notify(demand.current_assignee_id, msg, link, 'system')
          }
          // Colaboradores (fire-and-forget, deduplica ator + requester + assignee)
          notifyCollaborators(demandId, msg, link, 'system', [
            actor.id, demand.requester_id, demand.current_assignee_id,
          ]).catch(err => console.error('[checking-notify] colaboradores:', err.message))
        }

        resolve(rows[0])
```

- [ ] **Step 3.2: Verificar**

```bash
# Upload de um arquivo com kind=checking em uma demanda com requester e assignee diferentes do ator
curl -X POST "http://localhost:3000/api/demands/<demand_id>/attachments?kind=checking" \
  -H "Authorization: Bearer <token>" \
  -F "file=@foto_instalacao.jpg"
# Esperado: 200/201 com attachment. Notificações aparecendo no sino do requester e assignee.
```

- [ ] **Step 3.3: Commit**

```powershell
$msg = @'
feat: notificação automática ao registrar checking (campanha no ar)

Upload de anexo com kind=checking dispara notificação SSE para
solicitante, responsável e colaboradores da demanda.
Fire-and-forget — não bloqueia o upload em caso de falha.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/services/demands.service.js
git commit -m $msg
```

---

## Task 4: Consolidador de Provas de Exibição (PoP Batch Export)

**Escopo:** `GET /api/demands/:id/checking-zip` — baixa todos os anexos `kind='checking'` da demanda como um único arquivo `.zip`.

**Files:**
- Modify: `backend/src/services/demands.service.js` (nova função `exportCheckingZip`)
- Modify: `backend/src/controllers/demands.controller.js` (novo export)
- Modify: `backend/src/routes/demands.routes.js` (nova rota)
- Modify: `frontend/src/pages/DemandDetail.jsx` (botão de download)

- [ ] **Step 4.1: Instalar `archiver`**

```powershell
cd C:\Geral\flowdesk\backend
npm install archiver
```

- [ ] **Step 4.2: Adicionar `exportCheckingZip` no service**

Em `backend/src/services/demands.service.js`, adicionar import no topo:

```js
import archiver from 'archiver'
```

Adicionar a função após `uploadAttachment` (final do arquivo, antes de `// TIMELINE`):

```js
// ═══════════════════════════════════════════════════════════════════════════════
// CHECKING ZIP EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transmite um ZIP com todos os anexos kind='checking' da demanda.
 * @param {object} actor
 * @param {string} demandId
 * @param {import('express').Response} res - response do Express para pipe direto
 */
export async function exportCheckingZip(actor, demandId, res) {
  const demand = await getDemand(actor, demandId)

  const { rows: attachments } = await query(
    `SELECT file_path, file_name FROM attachments
     WHERE demand_id = $1 AND kind = 'checking'
     ORDER BY entered_at ASC`,
    [demandId]
  )

  if (attachments.length === 0) {
    throw Object.assign(new Error('Esta demanda não possui evidências de checking.'), { status: 404 })
  }

  const safeName = demand.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="pop_${safeName}.zip"`)

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.pipe(res)

  for (const att of attachments) {
    // presignedDownloadUrl retorna URL assinada; baixamos como stream e adicionamos ao zip
    const url    = await presignedDownloadUrl(att.file_path)
    const { default: https } = await import('node:https')
    const { default: http  } = await import('node:http')
    const client = url.startsWith('https') ? https : http

    await new Promise((resolve, reject) => {
      client.get(url, stream => {
        archive.append(stream, { name: att.file_name })
        stream.on('end', resolve)
        stream.on('error', reject)
      }).on('error', reject)
    })
  }

  await archive.finalize()
}
```

- [ ] **Step 4.3: Adicionar controller**

Em `backend/src/controllers/demands.controller.js`:

```js
export async function checkingZip(req, res) {
  try {
    await svc.exportCheckingZip(req.user, req.params.id, res)
  } catch (err) { return handleError(err, res) }
}
```

- [ ] **Step 4.4: Adicionar rota**

Em `backend/src/routes/demands.routes.js`, após a linha `router.get('/:id/checking-report', ...)`:

```js
router.get('/:id/checking-zip', authorize('super_admin', 'dept_admin', 'user'), ctrl.checkingZip)
```

- [ ] **Step 4.5: Verificar backend**

```bash
curl -o pop_export.zip \
  "http://localhost:3000/api/demands/<demand_id_com_checkings>/checking-zip" \
  -H "Authorization: Bearer <token>"
# Esperado: arquivo pop_export.zip baixado. Abrir e confirmar as fotos de checking.
```

- [ ] **Step 4.6: Botão no DemandDetail**

Em `frontend/src/pages/DemandDetail.jsx`, localizar onde `checkingCount` ou a lista de anexos é exibida. Adicionar botão de download:

```jsx
{/* Adicionar onde aparece a seção de attachments/checking */}
{checkingCount > 0 && (
  <a
    href={`/api/demands/${demand.id}/checking-zip`}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 text-gray-700"
  >
    ↓ Exportar provas (.zip)
  </a>
)}
```

Se `checkingCount` não existir como variável, derivar da lista de attachments:
```jsx
const checkingCount = attachments.filter(a => a.kind === 'checking').length
```

- [ ] **Step 4.7: Verificar no browser**

1. Abrir uma demanda que tenha fotos de checking
2. Botão "Exportar provas (.zip)" aparece
3. Clicar — browser inicia download do `.zip`
4. Abrir o zip e confirmar que contém as fotos de checking

- [ ] **Step 4.8: Commit**

```powershell
$msg = @'
feat: exportação em lote das provas de exibição (PoP ZIP)

GET /demands/:id/checking-zip transmite ZIP com todos os
anexos kind=checking da demanda. Botão no DemandDetail.
Usa archiver para stream direto, sem armazenar em disco.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/services/demands.service.js `
      backend/src/controllers/demands.controller.js `
      backend/src/routes/demands.routes.js `
      frontend/src/pages/DemandDetail.jsx `
      backend/package.json `
      backend/package-lock.json
git commit -m $msg
```

---

## Task 5: Regras de Automação de Status

**Escopo:** Tabela `stage_notifications` + hook no `moveStage()` + toggle no AdminWorkflows. Quando uma demanda entra em uma etapa configurada, dispara notificação para solicitante e/ou responsável com mensagem customizável.

**Files:**
- Create: `backend/src/migrations/sql/029_stage_notifications.sql`
- Create: `backend/src/services/stageNotifications.service.js`
- Create: `backend/src/controllers/stageNotifications.controller.js`
- Modify: `backend/src/routes/admin.routes.js`
- Modify: `backend/src/services/demands.service.js` (hook no `moveStage`)
- Modify: `frontend/src/pages/admin/AdminWorkflows.jsx`

- [ ] **Step 5.1: Criar migration 029**

```sql
-- backend/src/migrations/sql/029_stage_notifications.sql
-- ─── 029: stage_notifications — automação de notificação por etapa ──────────────
--
-- Quando uma demanda entra em uma etapa configurada, o sistema dispara
-- notificações automáticas para solicitante e/ou responsável.
-- A mensagem suporta {title} como placeholder (substituído pelo título da demanda).

CREATE TABLE IF NOT EXISTS stage_notifications (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id            UUID        NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  notify_requester    BOOLEAN     NOT NULL DEFAULT false,
  notify_assignee     BOOLEAN     NOT NULL DEFAULT false,
  message_template    VARCHAR(500) NOT NULL DEFAULT 'Demanda "{title}" avançou de etapa.',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (stage_id)  -- máx. 1 regra por etapa
);

CREATE INDEX IF NOT EXISTS idx_stage_notifications_stage ON stage_notifications (stage_id);
```

- [ ] **Step 5.2: Rodar migration**

```powershell
cd C:\Geral\flowdesk\backend
npm run migrate
# Esperado: 029 aplicado sem erros
```

- [ ] **Step 5.3: Criar `stageNotifications.service.js`**

```js
// backend/src/services/stageNotifications.service.js
import { query } from '#config/database.js'

export async function getByStage(stageId) {
  const { rows } = await query(
    'SELECT * FROM stage_notifications WHERE stage_id = $1',
    [stageId]
  )
  return rows[0] ?? null
}

export async function upsert(stageId, { notify_requester, notify_assignee, message_template }) {
  const { rows } = await query(
    `INSERT INTO stage_notifications (stage_id, notify_requester, notify_assignee, message_template)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stage_id) DO UPDATE
       SET notify_requester  = EXCLUDED.notify_requester,
           notify_assignee   = EXCLUDED.notify_assignee,
           message_template  = EXCLUDED.message_template,
           updated_at        = NOW()
     RETURNING *`,
    [stageId, notify_requester, notify_assignee, message_template]
  )
  return rows[0]
}

export async function remove(stageId) {
  await query('DELETE FROM stage_notifications WHERE stage_id = $1', [stageId])
}
```

- [ ] **Step 5.4: Criar controller**

```js
// backend/src/controllers/stageNotifications.controller.js
import { z } from 'zod'
import * as svc from '#services/stageNotifications.service.js'

const schema = z.object({
  notify_requester: z.boolean(),
  notify_assignee:  z.boolean(),
  message_template: z.string().min(5).max(500),
})

export async function upsert(req, res) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(422).json({ errors: parsed.error.flatten() })
  try {
    return res.json(await svc.upsert(req.params.stageId, parsed.data))
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}

export async function remove(req, res) {
  try {
    await svc.remove(req.params.stageId)
    return res.status(204).end()
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message })
  }
}
```

- [ ] **Step 5.5: Adicionar rotas em `admin.routes.js`**

Em `backend/src/routes/admin.routes.js`, adicionar import e rotas:

```js
import * as snCtrl from '#controllers/stageNotifications.controller.js'

// Automações de etapa
router.put   ('/stage-notifications/:stageId', authorize('super_admin', 'dept_admin'), snCtrl.upsert)
router.delete('/stage-notifications/:stageId', authorize('super_admin', 'dept_admin'), snCtrl.remove)
```

- [ ] **Step 5.6: Hook no `moveStage()`**

Em `backend/src/services/demands.service.js`, adicionar import no topo:

```js
import { getByStage } from '#services/stageNotifications.service.js'
```

No `moveStage()`, localizar o `dispatchWebhooks` (que é o bloco pós-commit, após ~linha 690). Adicionar logo depois:

```js
  // Automação de notificação por etapa (fire-and-forget)
  getByStage(stage_id).then(rule => {
    if (!rule) return
    const message = rule.message_template.replace('{title}', demand.title)
    const link    = `/demands/${demandId}`
    if (rule.notify_requester && demand.requester_id) {
      notify(demand.requester_id, message, link, 'system')
    }
    if (rule.notify_assignee && effectiveAssignee && effectiveAssignee !== demand.requester_id) {
      notify(effectiveAssignee, message, link, 'system')
    }
  }).catch(err => console.error('[stage-automation]', err.message))
```

- [ ] **Step 5.7: UI em AdminWorkflows**

Em `frontend/src/pages/admin/AdminWorkflows.jsx`, ao expandir uma etapa, adicionar seção "Automação de Notificação":

```jsx
{/* Adicionar dentro da área de edição de etapa, após os toggles de requires_* */}
<div className="mt-3 border-t pt-3">
  <p className="text-xs font-semibold text-gray-500 mb-2">Automação ao entrar nesta etapa</p>
  <label className="flex items-center gap-2 text-xs mb-1">
    <input type="checkbox"
      checked={stageForm.autoNotifyRequester ?? false}
      onChange={e => setStageForm(f => ({ ...f, autoNotifyRequester: e.target.checked }))}
      className="h-3 w-3 accent-blue-600"
    />
    Notificar solicitante
  </label>
  <label className="flex items-center gap-2 text-xs mb-2">
    <input type="checkbox"
      checked={stageForm.autoNotifyAssignee ?? false}
      onChange={e => setStageForm(f => ({ ...f, autoNotifyAssignee: e.target.checked }))}
      className="h-3 w-3 accent-blue-600"
    />
    Notificar responsável
  </label>
  {(stageForm.autoNotifyRequester || stageForm.autoNotifyAssignee) && (
    <input
      type="text"
      placeholder='Ex: Demanda "{title}" entrou em Produção.'
      value={stageForm.autoMessage ?? 'Demanda "{title}" avançou de etapa.'}
      onChange={e => setStageForm(f => ({ ...f, autoMessage: e.target.value }))}
      className="w-full text-xs border rounded px-2 py-1"
    />
  )}
</div>
```

Ao salvar a etapa, fazer chamada separada ao endpoint de automação:

```js
// Após salvar a etapa com sucesso (PATCH/POST):
if (stageForm.autoNotifyRequester || stageForm.autoNotifyAssignee) {
  await api.put(`/admin/stage-notifications/${savedStage.id}`, {
    notify_requester: stageForm.autoNotifyRequester ?? false,
    notify_assignee:  stageForm.autoNotifyAssignee ?? false,
    message_template: stageForm.autoMessage ?? 'Demanda "{title}" avançou de etapa.',
  })
} else {
  await api.delete(`/admin/stage-notifications/${savedStage.id}`).catch(() => {})
}
```

Ao carregar as etapas de um tipo, buscar as regras existentes e popular `stageForm` com elas para o caso de edição.

- [ ] **Step 5.8: Verificar**

1. Admin → Workflows → expandir etapa "Em Produção"
2. Marcar "Notificar solicitante" + mensagem customizada → Salvar
3. Arrastar um card para "Em Produção"
4. Verificar sino do solicitante — deve aparecer a notificação com o texto configurado

- [ ] **Step 5.9: Commit**

```powershell
$msg = @'
feat: automação de notificação por etapa de workflow

Migration 029 cria stage_notifications (1 regra por etapa).
moveStage() dispara notificações configuradas ao entrar na etapa.
Admin pode configurar notify_requester/assignee e template de
mensagem com placeholder {title}.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
git add backend/src/migrations/sql/029_stage_notifications.sql `
      backend/src/services/stageNotifications.service.js `
      backend/src/controllers/stageNotifications.controller.js `
      backend/src/routes/admin.routes.js `
      backend/src/services/demands.service.js `
      frontend/src/pages/admin/AdminWorkflows.jsx
git commit -m $msg
```

---

## Self-Review

**Spec coverage:**
- ✅ Ações em lote: endpoint + frontend completos
- ✅ Handoff gate: migration + service + admin UI
- ✅ Notificação checking: hook fire-and-forget pós-upload
- ✅ ZIP export: stream + botão frontend
- ✅ Automação: migration + service + controller + rotas + UI + hook

**Placeholder scan:** Nenhum "TBD", "TODO" ou step sem código.

**Type consistency:** `notify()` e `notifyCollaborators()` já existem no service. `presignedDownloadUrl` já importado. `getByStage()` nomeado consistente com o arquivo.

**Pendência de contexto:** O Step 5.7 menciona "ao carregar as etapas" — ao implementar, verificar no `AdminWorkflows.jsx` como as stages são carregadas (provavelmente `GET /admin/demand-types/:id/stages`) e fazer um `GET /admin/stage-notifications/:stageId` em paralelo para preencher os toggles no formulário de edição.
