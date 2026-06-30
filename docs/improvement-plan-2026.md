# FlowDesk — Architecture Improvement Plan 2026

**Audit Date:** 2026-06-29  
**Baseline:** Migration 042 (33 tables + 2 views)  
**Target:** Migration 046 (4 new migrations, 1 infrastructure change)  
**Owner:** Ruan / Grupo Inteli · ia@grupointeli.com

---

## Status de Execução (atualizado 2026-06-30)

| Item | Status |
|---|---|
| Migrations 043–046 (4 pilares) | ✅ Aplicadas no banco |
| Migration 047 (Recursos de Matriz / Agenda de Salas) | ✅ Aplicada (via `docker exec`) |
| PgBouncer (pool de conexões) | ✅ Em execução (porta 6432) |
| **Pilar 1 — Ingestão Dataprisma** | ✅ Script entregue; **SC importado (15.582 pontos, 0 falhas)** |
| Pilar 1 — Importação nacional (~170k) | ⏳ Pendente (rodar `migrate-assets.js` sem `--state`) |
| Pilares 2–4 (LGPD app-layer, AI loop) | ⏳ Schema pronto; lógica de aplicação pendente |

> Detalhes operacionais do import em `CLAUDE.md` → seção "Pilar 1 — Ingestão Dataprisma".
> Script: `scripts/dataprisma-import/migrate-assets.js`. Benchmark `Blumenau/SC` ~1ms.

---

## Resumo Executivo (C-Level)

O FlowDesk já opera como espinha dorsal do **Ecossistema Inteli**: centraliza demandas, rastreia o ciclo de vida dos pontos e conecta as 42+ marcas regionais em um fluxo único. A auditoria técnica revelou quatro vetores de maturidade que precisam ser endereçados antes da expansão para 6 países e da importação dos **180.000 pontos da Dataprisma**:

| Vetor | Risco Atual | Impacto após Melhoria |
|---|---|---|
| **Governança de Inventário** | Ponto de qualquer marca pode ser reservado por outra | Cada marca tem soberania sobre seu inventário — elimina dependência da Dataprisma |
| **Compliance LGPD / RMD** | CPF e dados pessoais em texto puro; sem registro de consentimento | Blindagem jurídica; auditoria RMD aprovada |
| **Capilaridade Nacional** | Sistema pode travar com 42 marcas acessando simultaneamente | Pool de conexões e índices garantem performance em escala nacional |
| **Verticalização IA** | Ciclo de vida dos mastros não gera ordens automáticas | MovePro recebe OSs automáticas da Inteli Estruturas; Vision AI valida checkings |

**Investimento técnico:** 4 migrations SQL + 1 mudança de infraestrutura Docker.  
**Risco de execução:** BAIXO — todas as migrations são aditivas (sem DROP, sem alteração de dados existentes).

---

## Roadmap de Execução

```
Semana 1          Semana 2          Semana 3          Semana 4
─────────────     ─────────────     ─────────────     ─────────────
Migration 043     Migration 044     Migration 045     Migration 046
Asset Ownership   LGPD Compliance   Performance       Verticalization
+ Dataprisma      + Consent         GIN + PgBouncer   AI + Service
Import Strategy   Tracking          Indexes           Orders
```

---

## Pilar 1 — Centralização do Inventário (Independência da Dataprisma)

### Problem Statement

The current `assets` table has no `department_id` — all 42+ brands share a single, unscoped asset pool. When BA Outdoor creates a demand for a point in Salvador, SP Outdoor can legally create a campaign for the same point on the same day (the `no_double_booking` exclusion constraint only prevents overlapping campaigns, not cross-brand governance conflicts).

Importing 180,000 Dataprisma points into this structure would create a governance vacuum: every brand would see all points, no brand could claim ownership, and central Controllership would lose traceability of which assets belong to which P&L.

### Solution: Migration 043

**File:** `backend/src/migrations/sql/043_asset_department_ownership.sql`

Key changes:
- `assets.department_id` — explicit brand ownership (nullable for global/shared assets)
- `assets.installation_date` — anchor date for predictive maintenance cycles
- `assets.structure_type` — Inteli Estruturas classification (mastro_metálico, totem, etc.)
- `assets.external_code` — unique import key for Dataprisma/Scoutdoor sync (prevents duplicate ingestion)

### Dataprisma Import Strategy (180k Points)

The import must be **idempotent** — if the job runs twice, it must not create duplicates. The `external_code` unique index on `assets` is the deduplication key.

**Recommended import pipeline:**

```
Dataprisma Export (CSV/API)
    ↓
Normalize & map to assets schema
    ↓
Batch UPSERT (1,000 rows/batch)
    ON CONFLICT (external_code) DO UPDATE SET
      name = EXCLUDED.name,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      impressions_monthly = EXCLUDED.impressions_monthly,
      photo_url = EXCLUDED.photo_url
    ↓
Set department_id per brand (second pass: UPDATE by state/city mapping)
    ↓
Verify: SELECT COUNT(*), department_id FROM assets GROUP BY department_id
```

**Estimated import time:** ~180k rows at 1k/batch = 180 batches ≈ 3–5 minutes on local infra.

**Rollback:** All new rows have `source = 'dataprisma'` — a single `DELETE FROM assets WHERE source = 'dataprisma'` cleanly removes the import if validation fails.

---

## Pilar 2 — Blindagem de Compliance (LGPD + RMD)

### Problem Statement

Three critical LGPD gaps exist in the current schema:

1. **CPF in plaintext:** The `cpf` field type in `demand_type_fields` stores the value inside `demands.payload` as a raw JSONB string — completely readable in a database dump.
2. **No consent tracking:** There is no record of when, how, or under what legal basis user data was collected — a mandatory requirement under LGPD Art. 7.
3. **No erasure workflow:** `deactivated_at` (soft-delete) preserves all PII indefinitely. LGPD Art. 18 grants users the right to erasure. Without an `anonymized_at` and a corresponding job, the company has no legal defense in case of an audit.

### Solution: Migration 044

**File:** `backend/src/migrations/sql/044_lgpd_compliance.sql`

Key additions:
- `users.consent_given_at` + `users.consent_type` + `users.consent_ip` — LGPD Art. 7 compliance
- `users.anonymized_at` — signals that PII has been scrubbed; irreversible
- `demands.anonymized_at` — for demand-level erasure (requester name, payload CPF)
- `demand_feed.anonymized_at` — for comment-level erasure
- `lgpd_requests` table — formal LGPD request tracking (access, rectification, erasure, portability)
- `data_retention_log` table — audit trail of all anonymization/deletion actions

### CPF Encryption Strategy (Application Layer)

Encrypting JSONB sub-fields in PostgreSQL requires application-layer AES-256-GCM encryption before INSERT. The recommended approach for the existing `payload` column:

```
Before INSERT/UPDATE on demands:
  for each field in payload where field_type = 'cpf':
    payload[field_id] = AES256GCM.encrypt(value, FIELD_ENCRYPTION_KEY)

Before SELECT (reading demand):
  for each field in fields_snapshot where field_type = 'cpf':
    payload[field_id] = AES256GCM.decrypt(payload[field_id], FIELD_ENCRYPTION_KEY)
```

`FIELD_ENCRYPTION_KEY` must be stored in environment variables (never in the database) and rotated annually.

> **Note:** This requires a one-time backfill migration to encrypt existing CPF values. Schedule this for off-hours with a maintenance window.

### Anonymization Job Logic

```javascript
// Runs nightly: anonymize deactivated users after 90-day retention window
SELECT id FROM users
WHERE deactivated_at < NOW() - INTERVAL '90 days'
  AND anonymized_at IS NULL

// For each user:
BEGIN;
  UPDATE users SET
    name = 'Usuário Anonimizado',
    email = 'anon_' || id || '@removido.lgpd',
    password_hash = 'REMOVED',
    anonymized_at = NOW()
  WHERE id = $1;

  UPDATE demands SET
    anonymized_at = NOW()
  WHERE requester_id = $1;

  INSERT INTO data_retention_log (table_name, record_id, action, reason)
  VALUES ('users', $1, 'anonymized', 'retention_policy_90d');
COMMIT;
```

---

## Pilar 3 — Escalabilidade e Performance Nacional

### Problem Statement

With 42+ brands and teams in all 27 Brazilian states potentially accessing the system simultaneously:

1. **Connection exhaustion:** PostgreSQL default `max_connections = 100`. Each Express worker holds 1 connection. Without pooling, 100+ simultaneous users crash the database.
2. **JSONB query performance:** `demands.payload` stores dynamic field values. Queries like "find all demands in Pindamonhangaba where field X = Y" perform a full table scan — this becomes unusable at 180k+ demand rows.
3. **Asset city search:** No composite index exists for `(city, state)` on assets — critical for the geographic view of 180k points.

### Solution: Migration 045 + PgBouncer

**File:** `backend/src/migrations/sql/045_performance_indexes.sql`

Key additions:
- `GIN` index on `demands.payload` — enables `@>` operator for field value search
- Partial `GIN` on active demands only (reduces index size ~40% for a typical Kanban load)
- `GIN` on `demands.fields_snapshot` — analytics queries
- Composite `(city, state)` index on `assets` — geographic asset lookup
- Composite `(department_id, city)` index on `assets` — brand-scoped geographic queries

### PgBouncer Configuration

Add to `docker-compose.yml` as an additional service. Express connects to PgBouncer (port 6432) instead of PostgreSQL directly. PgBouncer maintains a pool of persistent connections to PostgreSQL.

**File:** `docker-compose.pgbouncer.yml` (extend via `docker compose -f docker-compose.yml -f docker-compose.pgbouncer.yml up -d`)

```yaml
pgbouncer:
  image: bitnami/pgbouncer:latest
  container_name: flowdesk_pgbouncer
  environment:
    POSTGRESQL_HOST: postgres
    POSTGRESQL_PORT: 5432
    POSTGRESQL_DATABASE: ${POSTGRES_DB}
    POSTGRESQL_USERNAME: ${POSTGRES_USER}
    POSTGRESQL_PASSWORD: ${POSTGRES_PASSWORD}
    PGBOUNCER_POOL_MODE: transaction       # best for web APIs
    PGBOUNCER_MAX_CLIENT_CONN: 500         # max external connections
    PGBOUNCER_DEFAULT_POOL_SIZE: 20        # persistent connections to Postgres
    PGBOUNCER_MIN_POOL_SIZE: 5
    PGBOUNCER_SERVER_IDLE_TIMEOUT: 600
  ports:
    - "6432:6432"
  depends_on:
    postgres:
      condition: service_healthy
  restart: unless-stopped
```

**Backend `.env` change after PgBouncer:**
```
# Before:
DATABASE_URL=postgresql://user:pass@localhost:5432/flowdesk

# After:
DATABASE_URL=postgresql://user:pass@localhost:6432/flowdesk
```

> **Pool mode `transaction`:** Each query gets a connection from the pool for the duration of the transaction, then releases it. Most efficient for Express APIs with many short queries. Incompatible with `SET` / session-level state — verify no service uses `SET search_path` or similar.

### Expected Performance Impact

| Scenario | Before | After |
|---|---|---|
| 100 simultaneous users | DB crash (max_connections) | Stable (pooled) |
| Search `payload @> '{"field_id": "value"}'` on 180k rows | ~8s full scan | <50ms GIN index |
| Asset search by city + state | ~2s full scan | <20ms composite index |
| Peak load (42 brands, morning rush) | Unpredictable | Bounded by pool size |

---

## Pilar 4 — Verticalização com IA (Inteli Estruturas + MovePro)

### Problem Statement

The `asset_lifecycle_logs` table records maintenance events but generates no automatic downstream actions. The gap in the vertical integration loop is:

```
Inteli Estruturas installs a mastro metálico
    ↓
Event logged in asset_lifecycle_logs
    ↓
[GAP] — no rule fires, no service order is created
    ↓
MovePro waits for a human to remember to schedule the next maintenance
```

This manual dependency is the bottleneck that prevents scaling the operational model across 180k points.

### Solution: Migration 046

**File:** `backend/src/migrations/sql/046_verticalization.sql`

#### `maintenance_rules` table

Configurable triggers: "when a mastro_metálico's last `vistoria` is older than 180 days, auto-create a `manutencao` demand assigned to the MovePro department."

```
maintenance_rules
  asset_type       = 'outdoor'
  structure_type   = 'mastro_metalico'
  event_type       = 'vistoria'
  interval_days    = 180
  demand_type_id   → "Manutenção Preventiva" demand type
  assignee_dept_id → MovePro department
  priority         = 'high'
```

#### `service_orders` table

Auto-generated work orders for MovePro. Status lifecycle:
```
pending → assigned → in_progress → completed
                 ↘ cancelled
```

- `demand_id` is populated when the job creates the demand — closing the loop: service order → demand → checking attachment → finalized.
- `created_by = NULL` distinguishes auto-generated orders from manually created ones.

#### `checking_validation_queue` table

Every `attachment` uploaded with `kind = 'checking'` is enqueued here. A background Vision AI job processes the queue and sets:
- `status = 'approved'` — panel visible, brand correct, no obstruction
- `status = 'flagged'` — anomaly detected; `flagged_reason` describes the issue
- `ai_findings` — structured JSON: `{"panel_visible": true, "brand_correct": true, "obstruction": false, "luminosity": "good"}`

### Automation Job: Maintenance Rule Evaluator

This job runs nightly (or can be triggered manually). For each active rule:

```sql
-- Find assets overdue for maintenance per rule
SELECT a.id, a.name, a.department_id,
       MAX(l.performed_at) AS last_event
FROM assets a
LEFT JOIN asset_lifecycle_logs l
  ON l.asset_id = a.id AND l.event_type = rule.event_type
WHERE (rule.asset_type IS NULL OR a.asset_type = rule.asset_type)
  AND (rule.structure_type IS NULL OR a.structure_type = rule.structure_type)
  AND a.archived_at IS NULL
GROUP BY a.id, a.name, a.department_id
HAVING MAX(l.performed_at) < NOW() - (rule.interval_days * INTERVAL '1 day')
   OR MAX(l.performed_at) IS NULL  -- never had this event type
```

For each overdue asset:
1. Check if a `service_order` for this rule + asset is already `pending` or `in_progress` (avoid duplicates)
2. Create `service_order` with `scheduled_date = CURRENT_DATE + 7`
3. Create demand via `createDemand` service, linked to the service order
4. Notify MovePro `dept_admin` via `notifications`

### Integration with Inteli Estruturas Installation Flow

When Inteli Estruturas completes a new structure installation:
1. A demand of type "Instalação de Estrutura" is finalized (`is_final = true`)
2. A webhook fires to the FlowDesk backend
3. Backend creates an `asset_lifecycle_log` with `event_type = 'manutencao'` and `next_date = installation_date + 180` days
4. The nightly rule evaluator uses this `next_date` as the maintenance anchor

This closes the full loop:
```
Inteli Estruturas installs → FlowDesk logs → next_date set
    → Rule evaluator fires → Service order created for MovePro
    → MovePro demand created → Checking photo uploaded
    → Vision AI validates → Demand finalized
    → Asset lifecycle updated → Cycle repeats
```

---

## Migration Execution Order

```bash
# Run from project root
npm run migrate

# Migrations execute in alphabetical order — all four will run after 042:
# 043_asset_department_ownership.sql
# 044_lgpd_compliance.sql
# 045_performance_indexes.sql
# 046_verticalization.sql
```

All migrations are:
- **Idempotent** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`)
- **Additive only** — no existing columns or tables are dropped
- **Zero downtime** — column additions on PostgreSQL 16 with default values are instant (no table rewrite)

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Dataprisma import creates duplicates | Medium | High | `external_code` unique constraint + idempotent UPSERT |
| PgBouncer `transaction` mode breaks SET commands | Low | Medium | Audit services for session-level state before cutover |
| CPF backfill encryption leaves window of exposure | Low | High | Run backfill in maintenance window; disable endpoint during migration |
| GIN indexes slow down INSERT/UPDATE | Low | Low | GIN overhead on write is ~15% — acceptable for this write volume |
| `maintenance_rules` fires for assets without departments | Low | Medium | Rule evaluator checks `department_id IS NOT NULL` before creating demand |
| Vision AI false positives flag valid checkings | Medium | Medium | Flagged status requires human review, not auto-rejection |

---

## Files Generated by This Plan

| File | Type | Status |
|---|---|---|
| `docs/architecture-database.md` | Reference | ✅ Complete |
| `docs/improvement-plan-2026.md` | This document | ✅ Complete |
| `backend/src/migrations/sql/043_asset_department_ownership.sql` | SQL Migration | ✅ Ready to run |
| `backend/src/migrations/sql/044_lgpd_compliance.sql` | SQL Migration | ✅ Ready to run |
| `backend/src/migrations/sql/045_performance_indexes.sql` | SQL Migration | ✅ Ready to run |
| `backend/src/migrations/sql/046_verticalization.sql` | SQL Migration | ✅ Ready to run |
| `docker-compose.pgbouncer.yml` | Infrastructure | ⏳ Pending approval |
