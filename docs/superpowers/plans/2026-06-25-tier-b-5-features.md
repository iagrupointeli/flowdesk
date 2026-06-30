# Plano Tier B — 5 Features Mais Urgentes

> Data: 2026-06-25
> Status: Planejado, não iniciado

---

## B1 — Motor de Disponibilidade de Inventário

**Infra existente:** exclusion constraint `btree_gist` em `campaigns` (da migration 027)
**Migrations:** nenhuma

Endpoints novos:
- `GET /assets/:id/availability?from=&to=` → `{ available: bool, conflicts: [{campaign_id, title, starts_at, ends_at}] }`

Arquivos alterados:
- `assets.service.js` — `checkAvailability(assetId, from, to)`
- `AdminAssets.jsx` — indicador de disponibilidade ao abrir timeline do ativo
- `AdminCampaigns.jsx` — aviso de conflito em tempo real no form de criação

---

## B2 — Sistema de Hold com Expiração Automática

**Infra existente:** `campaigns.approval_status = 'pending'` (hold)
**Migrations:** `038_campaigns_hold_expiry.sql`

```sql
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;
```

Lógica:
- Ao criar hold: `expires_at = NOW() + INTERVAL '7 days'` (configurável por body)
- Cron diário: `UPDATE campaigns SET approval_status = 'rejected' WHERE approval_status = 'pending' AND expires_at < NOW()`
- Notificação SSE ao `created_by` quando expirar

Arquivos alterados:
- `campaigns.service.js` — `createCampaign` aceita `expires_at`; nova fn `expireHolds()`
- `index.js` — registra cron de expiração (junto com os outros crons diários)
- `AdminCampaigns.jsx` — badge "Expira em X dias" nas linhas com `approval_status = 'pending'`

---

## B3 — Matriz de Ocupação Temporal

**Infra existente:** `campaigns`, `assets`
**Migrations:** `039_occupancy_view.sql` — VIEW para performance

```sql
CREATE OR REPLACE VIEW v_asset_occupancy AS
SELECT
  a.id AS asset_id, a.name, a.city, a.asset_type,
  c.id AS campaign_id, c.title, c.starts_at, c.ends_at,
  c.approval_status
FROM assets a
LEFT JOIN campaigns c ON c.asset_id = a.id
  AND c.finalized_at IS NULL
  AND (c.exception_state IS NULL OR c.exception_state <> 'cancelled')
WHERE a.archived_at IS NULL;
```

Endpoint novo:
- `GET /assets/occupancy-grid?from=&to=&city=&asset_type=`
  Retorna: `[{ asset_id, name, city, asset_type, campaigns: [{starts_at, ends_at, status, title}] }]`

Arquivos:
- `assets.service.js` — `getOccupancyGrid(filters)`
- `AdminOccupancy.jsx` (novo) — grid visual semanas × ativos, células coloridas
  - Verde = livre | Amarelo = hold | Vermelho = ocupado
  - Filtros: cidade, tipo
- `App.jsx` — rota `/admin/occupancy`
- `Sidebar.jsx` — link "Grade de Ocupação" no menu admin

---

## B4 — Gestão de Licenciamento Municipal

**Infra existente:** `asset_documents` (alvarás, contratos já cadastrados)
**Migrations:** `040_asset_documents_type.sql`

```sql
ALTER TABLE asset_documents
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(30) NOT NULL DEFAULT 'outro';
-- valores: 'alvara' | 'contrato_locacao' | 'licenca_municipal' | 'outro'
```

Lógica:
- Cron existente de alertas (`assetDocuments.service.js`) filtra por `document_type IN ('alvara','licenca_municipal')` para alertas mais críticos
- UI: aba "Licenças" separada em `AdminAssets` com semáforo (verde >60 dias / amarelo 30–60 / vermelho <30)

Arquivos alterados:
- `assetDocuments.service.js` — `listDocuments` inclui `document_type`; cron de alerta ganha prioridade por tipo
- `AdminAssets.jsx` — aba "Licenças" no modal de documentos; select de tipo no form de upload

---

## B5 — Dashboard de Ociosidade Crítica

**Infra existente:** `campaigns`, `assets`
**Migrations:** nenhuma

Endpoint novo:
- `GET /assets/idle?horizon_days=30`
  Retorna: `{ total: N, by_city: [{city, count}], assets: [{id, name, city, asset_type, last_campaign_end}] }`

Arquivos:
- `assets.service.js` — `getIdleAssets(horizonDays)`
- `Dashboard.jsx` (ou Home.jsx) — card "Ativos Ociosos (próx. 30 dias)" com breakdown por cidade e link para AdminAssets filtrado

---

## Ordem de execução

| # | Arquivo | Feature |
|---|---------|---------|
| 1 | `038_campaigns_hold_expiry.sql` | B2 |
| 2 | `039_occupancy_view.sql` | B3 |
| 3 | `040_asset_documents_type.sql` | B4 |
| 4 | `assets.service.js` | B1 + B3 + B5 |
| 5 | `campaigns.service.js` | B2 |
| 6 | `assetDocuments.service.js` | B4 |
| 7 | `index.js` | B2 (cron expiração holds) |
| 8 | `AdminAssets.jsx` | B1 + B4 |
| 9 | `AdminCampaigns.jsx` | B1 + B2 |
| 10 | `AdminOccupancy.jsx` | B3 (novo) |
| 11 | `Dashboard.jsx` | B5 |
| 12 | `App.jsx` + `Sidebar.jsx` | B3 (rota + link) |
