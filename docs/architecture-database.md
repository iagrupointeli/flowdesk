# FlowDesk — Database Architecture Documentation

**Version:** Migration 047 (current)  
**Database:** PostgreSQL 16 (Docker, locale pt_BR.UTF-8)  
**Object Storage:** MinIO (S3-compatible, bucket auto-provisioned)  
**Generated:** 2026-06-29 · **Updated:** 2026-06-30 (sections 1–7 reflect mig 042; see §8 for 043–047)

---

## 1. Infrastructure Overview

```
┌─────────────────────────────────────────────────────┐
│                   Docker Compose                    │
│                                                     │
│  ┌─────────────────┐   ┌────────────────────────┐  │
│  │ flowdesk_postgres│   │   flowdesk_minio       │  │
│  │  PostgreSQL 16   │   │  S3-compatible storage │  │
│  │  Port: 5432      │   │  API:  Port 9000       │  │
│  │  Volume: postgres│   │  Admin: Port 9001      │  │
│  │  _data (local)   │   │  Volume: minio_data    │  │
│  └─────────────────┘   └────────────────────────┘  │
│                                                     │
│  ┌─────────────────┐   ┌────────────────────────┐  │
│  │ Express Backend  │   │    Vite Frontend       │  │
│  │  Port: 3001      │   │    Port: 5174          │  │
│  │  PM2 managed     │   │    PM2 managed         │  │
│  └─────────────────┘   └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**MinIO bucket policy:** Anonymous access = none. Temporary uploads tagged `confirmed!=true` expire in 1 day (ILM rule).

---

## 2. Entity Groups & Table Inventory

### 2.1 Users & Access Control (RBAC)

| Table | Rows (approx.) | Purpose |
|---|---|---|
| `users` | ~50–200 | System users |
| `departments` | ~42+ | Franchises / Regional Brands |
| `user_departments` | N:M | User ↔ Department membership |

#### `users`
```sql
id                UUID PK
name              VARCHAR(255) NOT NULL
email             VARCHAR(255) NOT NULL UNIQUE
password_hash     VARCHAR(255) NOT NULL
role              VARCHAR(20) CHECK IN ('super_admin','dept_admin','user')
notify_email      BOOLEAN DEFAULT true
notify_platform   BOOLEAN DEFAULT true
deactivated_at    TIMESTAMPTZ NULL          -- soft-delete
is_active         BOOLEAN GENERATED ALWAYS  -- computed: deactivated_at IS NULL
password_changed_at TIMESTAMPTZ NULL        -- NULL = first login pending
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

**Roles:**
- `super_admin` — full access to all departments and admin panels
- `dept_admin` — admin within assigned departments only
- `user` — standard access within assigned departments

#### `departments`
```sql
id          UUID PK
name        VARCHAR(255) NOT NULL UNIQUE
description TEXT NULL
archived_at TIMESTAMPTZ NULL   -- soft-delete
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

> **Franchises/Brands mapping:** Each `department` represents a regional brand (e.g., "SCOutdoor", "ParáMídia", etc.). The 42+ brands of Grupo Inteli map directly to rows in this table.

#### `user_departments` (N:M junction)
```sql
user_id       UUID FK → users
department_id UUID FK → departments
is_primary    BOOLEAN DEFAULT false   -- user's main department
created_at    TIMESTAMPTZ
PRIMARY KEY (user_id, department_id)
```

**Multi-tenancy mechanism:** Every demand belongs to a `demand_type` which belongs to a `department`. RBAC is enforced server-side by filtering by `deptIds` extracted from the JWT. Assets are global (intentional design — see §4.1).

---

### 2.2 Demand Management (Core Workflow)

```
demand_types ──< workflow_stages
     │
     └──< demands >── demand_history   (SLA log)
              │   └── demand_feed      (comments)
              │   └── demand_checklists
              │   └── demand_collaborators
              │   └── demand_tags
              └── assets (optional link)
```

#### `demand_types`
```sql
id            UUID PK
name          VARCHAR(255) NOT NULL
description   TEXT NULL
department_id UUID FK → departments
sla_hours     INTEGER NULL CHECK > 0   -- NULL = no SLA defined
archived_at   TIMESTAMPTZ NULL
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
```

#### `demand_type_fields` (dynamic form builder)
```sql
id             UUID PK
demand_type_id UUID FK → demand_types
label          VARCHAR(255) NOT NULL
field_type     VARCHAR(20) CHECK IN ('text','textarea','number','date','select','cpf')
required       BOOLEAN DEFAULT false
options        JSONB NULL    -- [{id: UUID, label: string}] for 'select' type
display_order  INTEGER DEFAULT 0
archived_at    TIMESTAMPTZ NULL    -- soft-delete: preserves historical demand rendering
created_at     TIMESTAMPTZ
```

> **Important invariant:** `field_type` is immutable after creation. Payload values for `select` fields store the option `id` (UUID), never the label — label changes don't corrupt historical data.

#### `workflow_stages`
```sql
id                  UUID PK
demand_type_id      UUID FK → demand_types
name                VARCHAR(255) NOT NULL
display_order       INTEGER DEFAULT 0
is_final            BOOLEAN DEFAULT false
requires_note       BOOLEAN DEFAULT false
requires_assignee   BOOLEAN DEFAULT false
requires_attachment BOOLEAN DEFAULT false
wip_limit           INTEGER NULL CHECK > 0   -- NULL = unlimited
archived_at         TIMESTAMPTZ NULL
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
UNIQUE (id, demand_type_id)    -- enables composite FK in demands
```

#### `demands` (central entity)
```sql
id                  UUID PK
title               VARCHAR(500) NOT NULL
description         TEXT NOT NULL
requester_id        UUID FK → users
demand_type_id      UUID FK → demand_types
current_stage_id    UUID FK → workflow_stages (composite with demand_type_id)
current_assignee_id UUID FK → users NULL
asset_id            UUID FK → assets NULL    -- optional link to OOH point
exception_state     VARCHAR(20) NULL CHECK IN ('on_hold','cancelled')
fields_snapshot     JSONB NOT NULL DEFAULT '{}'   -- immutable snapshot of fields at creation
payload             JSONB NOT NULL DEFAULT '{}'   -- user-filled values, keys = field UUIDs
due_date            TIMESTAMPTZ NULL             -- NOW() + sla_hours at creation; immutable
finalized_at        TIMESTAMPTZ NULL             -- set when entering is_final stage
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
```

> **Demand state machine:**
> - Active flow: `exception_state IS NULL` + progressing through `workflow_stages`
> - Concluded: `exception_state IS NULL` AND `current_stage.is_final = true`
> - On hold: `exception_state = 'on_hold'` (SLA pauses)
> - Cancelled: `exception_state = 'cancelled'`

#### `demand_history` (append-only SLA log)
```sql
id              BIGSERIAL PK    -- strict ordering for SLA window functions
demand_id       UUID FK → demands
event_type      VARCHAR(30) CHECK IN ('created','stage_changed','exception_changed','assignee_changed')
actor_id        UUID FK → users
stage_id        UUID FK → workflow_stages NULL
assignee_id     UUID FK → users NULL
exception_state VARCHAR(20) NULL
notes           TEXT NULL
entered_at      TIMESTAMPTZ DEFAULT NOW()
```

#### `demand_feed` (comments, no SLA impact)
```sql
id          BIGSERIAL PK
demand_id   UUID FK → demands
event_type  VARCHAR(30) DEFAULT 'comment_added'
actor_id    UUID FK → users
stage_id    UUID FK → workflow_stages NULL   -- context at comment time
assignee_id UUID FK → users NULL
body        TEXT NOT NULL CHECK LENGTH > 0
entered_at  TIMESTAMPTZ
```

#### `demand_checklists`
```sql
id            UUID PK
demand_id     UUID FK → demands ON DELETE CASCADE
title         TEXT NOT NULL
is_completed  BOOLEAN DEFAULT false
display_order INTEGER DEFAULT 0
completed_by  UUID FK → users NULL ON DELETE SET NULL
completed_at  TIMESTAMPTZ NULL
created_at    TIMESTAMPTZ
```

#### `demand_collaborators` (cross-department followers)
```sql
demand_id  UUID FK → demands ON DELETE CASCADE
user_id    UUID FK → users ON DELETE CASCADE
added_by   UUID FK → users NULL ON DELETE SET NULL
created_at TIMESTAMPTZ
PRIMARY KEY (demand_id, user_id)
```

---

### 2.3 Assets (OOH Point Inventory)

> **Assets are GLOBAL** — not scoped to a department. All authenticated users can read assets to link them when creating demands. Write access restricted to `super_admin` and `dept_admin`.

#### `assets`
```sql
id                   UUID PK
code                 VARCHAR(50) NULL UNIQUE (partial: where not archived)
name                 VARCHAR(200) NOT NULL
asset_type           VARCHAR(30) CHECK IN ('painel','empena','led','lona','outdoor','mub','outro')
address              TEXT NULL
city                 VARCHAR(120) NULL
state                VARCHAR(2) NULL           -- UF (e.g., 'SC', 'SP')
dimensions           VARCHAR(80) NULL
notes                TEXT NULL
is_premium           BOOLEAN DEFAULT false     -- requires approval workflow for campaigns
source               VARCHAR(30) DEFAULT 'manual'  -- 'manual' | 'scoutdoor'
photo_url            TEXT NULL                 -- main photo (Scoutdoor CDN or MinIO)
impressions_monthly  INTEGER NULL              -- estimated monthly views (from Scoutdoor)
archived_at          TIMESTAMPTZ NULL
created_at           TIMESTAMPTZ
```

#### `asset_documents` (expiry-tracked documents)
```sql
id          UUID PK
asset_id    UUID FK → assets ON DELETE CASCADE
title       VARCHAR(200) NOT NULL
doc_type    VARCHAR(20) CHECK IN ('alvara','contrato','seguro','licenca','outro')
expires_at  DATE NOT NULL
notes       TEXT NULL
created_by  UUID FK → users NULL ON DELETE SET NULL
created_at  TIMESTAMPTZ
updated_at  TIMESTAMPTZ
```

**Automated job:** `runDocumentExpiryCheck` notifies `super_admin` users at 30, 15, 7, and 1 day before expiry.

#### `asset_lifecycle_logs` (maintenance history)
```sql
id           UUID PK
asset_id     UUID FK → assets ON DELETE CASCADE
event_type   VARCHAR(30) CHECK IN ('manutencao','vistoria','reparo','troca_material','outro')
description  TEXT NOT NULL
performed_at DATE NOT NULL
next_date    DATE NULL     -- scheduled next event (predictive maintenance anchor)
created_by   UUID FK → users
created_at   TIMESTAMPTZ
```

---

### 2.4 Campaigns (Commercial Scheduling)

#### `campaigns`
```sql
id              UUID PK
asset_id        UUID FK → assets ON DELETE CASCADE
demand_id       UUID FK → demands NULL ON DELETE SET NULL   -- linked production demand
client_name     VARCHAR(200) NOT NULL
title           VARCHAR(300) NOT NULL
starts_on       DATE NOT NULL
ends_on         DATE NOT NULL
approval_status VARCHAR(10) CHECK IN ('pending','approved','rejected') DEFAULT 'approved'
approval_note   TEXT NULL
approved_by     UUID FK → users NULL ON DELETE SET NULL
expires_at      TIMESTAMPTZ NULL    -- auto-expiry for pending holds
notes           TEXT NULL
created_by      UUID FK → users
archived_at     TIMESTAMPTZ NULL
created_at      TIMESTAMPTZ

CHECK (ends_on >= starts_on)

CONSTRAINT no_double_booking EXCLUDE USING gist (
  asset_id WITH =,
  daterange(starts_on, ends_on, '[]') WITH &&
) WHERE (archived_at IS NULL)
```

> **Anti-double-booking:** Enforced at database level via PostgreSQL `EXCLUDE` constraint with `btree_gist` extension. No application code can bypass this — conflicting INSERT/UPDATE fails with HTTP 409.

**Approval workflow:**
- Normal asset + duration ≤ 30 days → `approved` (default)
- Premium asset (`is_premium = true`) → enters as `pending`, requires manager approval
- `rejected` → `archived_at` is set automatically, slot freed

---

### 2.5 Files & Attachments

#### `attachments` (demand files)
```sql
id          UUID PK
demand_id   UUID FK → demands
uploaded_by UUID FK → users
stage_id    UUID FK → workflow_stages NULL
assignee_id UUID FK → users NULL
file_path   VARCHAR(255) NOT NULL UNIQUE    -- pure UUID in MinIO (no enumeration risk)
file_name   VARCHAR(500) NOT NULL
file_size   INTEGER NOT NULL CHECK > 0
kind        VARCHAR(20) CHECK IN ('generic','checking','creative') DEFAULT 'generic'
version     INTEGER NOT NULL DEFAULT 1      -- auto-incremented per creative per demand
entered_at  TIMESTAMPTZ
```

**Attachment kinds:**
- `generic` — contracts, documents, artwork files
- `checking` — photo evidence of OOH display (required for billing release)
- `creative` — artwork/layout versions (auto-versioned)

#### `chat_attachments` (chat files)
```sql
id         UUID PK
message_id UUID FK → chat_messages ON DELETE CASCADE
file_path  VARCHAR(255) NOT NULL
file_name  VARCHAR(500) NOT NULL
file_size  INTEGER NOT NULL
mime_type  VARCHAR(127) NOT NULL
created_at TIMESTAMPTZ
```

---

### 2.6 Notifications & Webhooks

#### `notifications`
```sql
id         UUID PK
user_id    UUID FK → users ON DELETE CASCADE
message    TEXT NOT NULL
is_read    BOOLEAN DEFAULT false
type       VARCHAR(50) DEFAULT 'system'
           -- 'mention' | 'assignment' | 'stage_change' | 'comment' | 'system'
link       VARCHAR(500) NULL    -- relative route (replaces FK to demand)
created_at TIMESTAMPTZ
```

#### `stage_notifications` (automation rules)
```sql
id                UUID PK
stage_id          UUID FK → workflow_stages ON DELETE CASCADE
notify_requester  BOOLEAN DEFAULT false
notify_assignee   BOOLEAN DEFAULT false
message_template  VARCHAR(500) DEFAULT 'Demanda "{title}" avançou de etapa.'
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
UNIQUE (stage_id)    -- max 1 rule per stage
```

#### `webhooks` (outbound integrations)
```sql
id            UUID PK
department_id UUID FK → departments NULL ON DELETE CASCADE   -- NULL = global
url           TEXT NOT NULL
secret_key    TEXT NOT NULL    -- 32 random bytes hex; HMAC SHA-256 signing
events        JSONB DEFAULT '[]'
              -- ['demand.created','demand.stage_changed','demand.blocked']
is_active     BOOLEAN DEFAULT true
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
```

---

### 2.7 Chat

#### `chat_channels`
```sql
id            UUID PK
type          VARCHAR(20) CHECK IN ('dm','group','broadcast')
name          VARCHAR(255) NULL
department_id UUID FK → departments NULL ON DELETE SET NULL
created_by    UUID FK → users
description   TEXT NULL
archived_at   TIMESTAMPTZ NULL
created_at    TIMESTAMPTZ
```

#### `chat_members`
```sql
channel_id   UUID FK → chat_channels ON DELETE CASCADE
user_id      UUID FK → users ON DELETE CASCADE
role         VARCHAR(20) CHECK IN ('owner','admin','member','readonly')
joined_at    TIMESTAMPTZ
last_read_at TIMESTAMPTZ NULL
PRIMARY KEY (channel_id, user_id)
```

#### `chat_messages`
```sql
id         UUID PK
channel_id UUID FK → chat_channels ON DELETE CASCADE
sender_id  UUID FK → users
body       TEXT NULL
reply_to   UUID FK → chat_messages NULL    -- threading
edited_at  TIMESTAMPTZ NULL
deleted_at TIMESTAMPTZ NULL    -- soft-delete
created_at TIMESTAMPTZ
```

---

### 2.8 Personal Productivity (Areas > Projects > Tasks)

```
areas ──< projects ──< project_sections
              │     └──< project_members
              └──< personal_tasks
```

#### `areas`
```sql
id          UUID PK
name        VARCHAR(200) NOT NULL
description TEXT NULL
color       VARCHAR(7) DEFAULT '#6366f1'
created_by  UUID FK → users ON DELETE CASCADE
created_at  TIMESTAMPTZ
archived_at TIMESTAMPTZ NULL
```

#### `area_members`
```sql
id         UUID PK
area_id    UUID FK → areas ON DELETE CASCADE
user_id    UUID FK → users ON DELETE CASCADE
invited_by UUID FK → users NULL ON DELETE SET NULL
invited_at TIMESTAMPTZ
UNIQUE (area_id, user_id)
```

#### `projects`
```sql
id          UUID PK
name        VARCHAR(200) NOT NULL
description TEXT NULL
color       VARCHAR(7) DEFAULT '#6366f1'
area_id     UUID FK → areas NULL ON DELETE SET NULL
owner_id    UUID FK → users ON DELETE CASCADE
visibility  VARCHAR(20) CHECK IN ('public','limited','private') DEFAULT 'private'
created_at  TIMESTAMPTZ
archived_at TIMESTAMPTZ NULL
```

**Visibility rules:**
- `public` — visible to all authenticated users
- `limited` — visible only to `area_members` + `project_members` + `super_admin`
- `private` — visible only to `project_members` + `super_admin`

#### `project_sections`
```sql
id         UUID PK
project_id UUID FK → projects ON DELETE CASCADE
name       VARCHAR(100) NOT NULL
position   INTEGER DEFAULT 0
created_at TIMESTAMPTZ
UNIQUE (project_id, name)
```

#### `project_members`
```sql
id         UUID PK
project_id UUID FK → projects ON DELETE CASCADE
user_id    UUID FK → users ON DELETE CASCADE
role       VARCHAR(50) DEFAULT 'membro'    -- 'proprietário' | 'membro'
invited_by UUID FK → users NULL ON DELETE SET NULL
invited_at TIMESTAMPTZ
UNIQUE (project_id, user_id)
```

#### `personal_tasks`
```sql
id           UUID PK
title        TEXT NOT NULL
notes        TEXT NULL
project      VARCHAR(100) NULL      -- legacy text field (pre-037, kept for compat)
project_id   UUID FK → projects NULL ON DELETE SET NULL   -- structured FK (post-037)
section      VARCHAR(100) NULL
assignee_id  UUID FK → users NULL ON DELETE SET NULL
due_date     DATE NULL
status       VARCHAR(20) CHECK IN ('todo','done') DEFAULT 'todo'
position     INTEGER DEFAULT 0
created_by   UUID FK → users ON DELETE CASCADE
created_at   TIMESTAMPTZ
completed_at TIMESTAMPTZ NULL
archived_at  TIMESTAMPTZ NULL
```

---

### 2.9 Intake & External Access Links

#### `intake_links` (public demand submission)
```sql
id              UUID PK
demand_type_id  UUID FK → demand_types ON DELETE CASCADE
label           VARCHAR(200) NOT NULL
token_hash      VARCHAR(64) NOT NULL UNIQUE    -- SHA-256 hex of opaque token
expires_at      TIMESTAMPTZ NULL               -- NULL = never expires
created_by      UUID FK → users ON DELETE RESTRICT
created_at      TIMESTAMPTZ
```

#### `external_links` (contractor portal)
```sql
id           UUID PK
demand_id    UUID FK → demands ON DELETE CASCADE
token_hash   VARCHAR(64) NOT NULL UNIQUE    -- SHA-256 hex; plaintext shown once only
label        VARCHAR(200) NULL
created_by   UUID FK → users
expires_at   TIMESTAMPTZ NOT NULL
revoked_at   TIMESTAMPTZ NULL
last_used_at TIMESTAMPTZ NULL
created_at   TIMESTAMPTZ
```

---

### 2.10 Tags

#### `tags`
```sql
id            UUID PK
department_id UUID FK → departments ON DELETE CASCADE
name          VARCHAR(100) NOT NULL
color_hex     CHAR(7) DEFAULT '#6366f1'
created_at    TIMESTAMPTZ
UNIQUE (department_id, name)
```

#### `demand_tags` (N:M)
```sql
demand_id  UUID FK → demands ON DELETE CASCADE
tag_id     UUID FK → tags ON DELETE CASCADE
created_at TIMESTAMPTZ
PRIMARY KEY (demand_id, tag_id)
```

---

### 2.11 Recurring Templates

#### `recurring_templates`
```sql
id              UUID PK
demand_type_id  UUID FK → demand_types ON DELETE CASCADE
title           VARCHAR(500) NOT NULL
description     TEXT NOT NULL
payload         JSONB DEFAULT '{}'
assignee_id     UUID FK → users NULL ON DELETE SET NULL
interval_days   INTEGER NOT NULL CHECK > 0
next_run_at     TIMESTAMPTZ NOT NULL
last_run_at     TIMESTAMPTZ NULL
created_by      UUID FK → users
archived_at     TIMESTAMPTZ NULL
created_at      TIMESTAMPTZ
```

---

## 3. Views & Computed Objects

### `demand_sla`
Calculates SLA intervals using `LEAD()` window function over `demand_history`.

| Column | Description |
|---|---|
| `interval_duration` | Total time for this state interval |
| `active_duration` | Time counting only when `exception_state IS NULL` |
| `paused_duration` | Time counting only when `exception_state = 'on_hold'` |

Usage:
```sql
SELECT demand_id,
       SUM(active_duration) AS total_active,
       SUM(paused_duration) AS total_paused
FROM demand_sla
WHERE demand_id = $1
GROUP BY demand_id;
```

### `v_asset_occupancy`
Crosses `assets` with active `campaigns` for the occupancy grid (`/admin/occupancy`).

| Column | Source |
|---|---|
| `asset_id`, `asset_name`, `asset_code`, `city`, `asset_type` | `assets` |
| `campaign_id`, `campaign_title`, `client_name`, `starts_on`, `ends_on`, `approval_status` | `campaigns` |

Filter: `campaigns.archived_at IS NULL AND approval_status <> 'rejected'`

---

## 4. Architectural Analysis

### 4.1 Media Points ↔ Franchises/Brands Relationship

**Current model: INDIRECT coupling via Demands**

```
departments (Brands)
    └── demand_types
            └── demands
                    └── assets (Media Points)  ← optional FK
```

```
campaigns
    └── assets (Media Points)   ← direct FK, NO department reference
```

**What this means:**
- Assets (OOH points) are shared across all brands — any brand can create a demand for any asset.
- Campaigns are brand-agnostic at schema level: there is no `department_id` on `campaigns` or `assets`.
- To answer "which brand owns which points," you must query via `demands.asset_id` joined through `demand_types.department_id`.

**Gap:** There is no direct `department_id` (brand ownership) column on `assets`. If a brand needs exclusive inventory management (private points), this must be handled at application layer (RBAC) rather than schema.

---

### 4.2 Scalability Audit — 42+ Brands

| Area | Current State | Risk |
|---|---|---|
| Multi-tenancy isolation | Via `department_id` on `demand_types`, `tags`, `webhooks`, `chat_channels` | ✅ Correct pattern |
| Asset ownership | Global (no `department_id` on `assets`) | ⚠️ Brands share the same asset pool |
| Double-booking | `EXCLUDE` constraint in `campaigns` (database-enforced) | ✅ Bulletproof |
| Index coverage | Partial indexes for most hot query paths | ✅ Good |
| JSONB payload | Unindexed on `demands.payload` and `demands.fields_snapshot` | ⚠️ Cross-demand searches on field values will be slow at scale |
| `demand_history` table | `BIGSERIAL` → integer sequence; supports billions of rows | ✅ Sufficient |
| Connection pooling | Not configured in current `docker-compose.yml` | ⚠️ No PgBouncer or pool config visible |
| Read replicas | Not configured | ⚠️ Single write node — 42 simultaneous brands hitting same Postgres |

**Recommendations for scale:**
1. Add `department_id` to `assets` (optional, for explicit brand ownership).
2. Deploy PgBouncer between Express and PostgreSQL.
3. Add `GIN` index on `demands.payload` if cross-field search is needed.
4. Consider read replica for reporting queries (`demand_sla`, `v_asset_occupancy`).

---

### 4.3 Security & LGPD Compliance

#### Strengths
| Control | Implementation |
|---|---|
| Password storage | `bcrypt` hash, never plaintext |
| Token security | SHA-256 hash stored; plaintext returned once only (external_links, intake_links) |
| Webhook signing | HMAC SHA-256, 32-byte secret |
| Soft-delete | All entities use `archived_at TIMESTAMPTZ` (audit trail preserved) |
| SSRF protection | DNS-rebinding prevention on outbound requests (documented in CLAUDE.md) |
| File path obfuscation | MinIO keys are pure UUIDs (no enumeration via path guessing) |
| Anti double-booking | Database-enforced `EXCLUDE` constraint |
| First-login enforcement | `password_changed_at NULL` = forced password change |

#### LGPD Gaps & Risks
| Gap | Description | Impact |
|---|---|---|
| No PII encryption at rest | `users.name`, `users.email`, `demands.payload` (may contain CPF) stored in plaintext | **HIGH** — CPF field type exists but data is unencrypted |
| No consent tracking | No `consent_given_at` or `consent_type` column on `users` | **HIGH** — LGPD requires documented consent |
| No erasure capability | Soft-delete preserves all data; no `anonymize_at` or hard-delete workflow | **MEDIUM** — LGPD Art. 18 grants right to erasure |
| No data retention policy | No automated purge of old `demand_history`, `notifications`, or `demand_feed` rows | **MEDIUM** — retention periods should be defined |
| External link audit | `last_used_at` tracked but no per-action log for contractor portal | **LOW** — limited audit trail for external access |
| Chat messages | Soft-delete only (`deleted_at`) — no anonymization of sender PII | **LOW** |

#### Recommended LGPD additions:
```sql
-- On users table:
ALTER TABLE users ADD COLUMN consent_given_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN consent_type VARCHAR(50) NULL;  -- 'explicit' | 'legitimate_interest'
ALTER TABLE users ADD COLUMN anonymized_at TIMESTAMPTZ NULL; -- signals LGPD erasure processed

-- Automated retention (pg_cron or application job):
-- DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '90 days';
-- DELETE FROM demand_feed WHERE entered_at < NOW() - INTERVAL '2 years';
```

---

### 4.4 AI-Ready Integration Points

The following fields are natural anchors for AI/automation features:

#### Predictive Maintenance (Inteli Estruturas)
```
asset_lifecycle_logs.performed_at   → last maintenance date
asset_lifecycle_logs.next_date      → scheduled next event
asset_lifecycle_logs.event_type     → 'manutencao' | 'vistoria' | 'reparo'
assets.impressions_monthly          → usage intensity proxy
```
**Automation:** Trigger alert demand via `recurring_templates` when `next_date - TODAY() <= 7`.

#### Checking Photo Validation (Vision AI)
```
attachments WHERE kind = 'checking'
  → file_path (MinIO UUID) → fetch image → run vision model
  → validate: panel visible, brand correct, no obstruction
```
**Automation:** Auto-validate checking attachments; flag anomalies on `demand_feed`.

#### SLA Prediction
```
demand_sla view → SUM(active_duration) grouped by demand_type_id
demand_history → stage_id sequences and durations per type
```
**Automation:** Train regression model per `demand_type_id` to predict expected resolution time at creation.

#### Campaign Demand Completion Alert
```
campaigns.starts_on
campaigns.demand_id → demands → attachments WHERE kind = 'creative'
```
**Automation:** `runMaterialDeadlineCheck` job already exists — extend to trigger AI reminder if no creative uploaded 7 days before `starts_on`.

#### Document Expiry (already partially automated)
```
asset_documents.expires_at
asset_documents.doc_type → 'alvara' | 'licenca'
```
**Automation:** Existing `runDocumentExpiryCheck` job fires at 30/15/7/1 day. Extend to auto-create demand of type "Renovação de Documento" via `recurring_templates`.

#### Audience Data (MetricsAI / DOOH Intelligence)
```
assets.impressions_monthly   → estimated audience per point
campaigns.starts_on/ends_on  → campaign duration
demands.asset_id             → which campaigns needed what service on which point
```
**Automation:** Feed into MetricsAI pipeline for ROI calculations and geospatial heat maps.

---

## 5. Full Index Inventory

| Index | Table | Columns | Type |
|---|---|---|---|
| `idx_user_departments_dept` | `user_departments` | `department_id` | btree |
| `idx_demand_types_dept` | `demand_types` | `department_id` | btree |
| `idx_demand_types_active` | `demand_types` | `department_id` WHERE `archived_at IS NULL` | partial |
| `idx_demand_type_fields_type` | `demand_type_fields` | `demand_type_id` | btree |
| `idx_demand_type_fields_active` | `demand_type_fields` | `(demand_type_id, display_order)` WHERE `archived_at IS NULL` | partial |
| `idx_workflow_stages_type` | `workflow_stages` | `demand_type_id` | btree |
| `idx_workflow_stages_active` | `workflow_stages` | `(demand_type_id, display_order)` WHERE `archived_at IS NULL` | partial |
| `idx_demands_requester` | `demands` | `requester_id` | btree |
| `idx_demands_type` | `demands` | `demand_type_id` | btree |
| `idx_demands_stage` | `demands` | `current_stage_id` | btree |
| `idx_demands_assignee` | `demands` | `current_assignee_id` WHERE `NOT NULL` | partial |
| `idx_demands_due_date` | `demands` | `due_date` WHERE `NOT NULL` | partial |
| `idx_demands_asset` | `demands` | `asset_id` WHERE `NOT NULL` | partial |
| `idx_history_sla` | `demand_history` | `(demand_id, id)` | btree |
| `idx_history_cursor` | `demand_history` | `(demand_id, entered_at, id)` | btree |
| `idx_history_actor` | `demand_history` | `actor_id` | btree |
| `idx_history_stage` | `demand_history` | `stage_id` WHERE `NOT NULL` | partial |
| `idx_history_assignee` | `demand_history` | `assignee_id` WHERE `NOT NULL` | partial |
| `idx_feed_cursor` | `demand_feed` | `(demand_id, entered_at, id)` | btree |
| `idx_notifications_user` | `notifications` | `(user_id, created_at DESC)` | btree |
| `idx_notifications_unread` | `notifications` | `user_id` WHERE `is_read = false` | partial |
| `idx_notifications_type` | `notifications` | `(user_id, type, created_at DESC)` | btree |
| `idx_webhooks_active` | `webhooks` | `(department_id, is_active)` WHERE `is_active = true` | partial |
| `idx_tags_department` | `tags` | `department_id` | btree |
| `idx_demand_tags_tag` | `demand_tags` | `tag_id` | btree |
| `idx_departments_active` | `departments` | `name` WHERE `archived_at IS NULL` | partial |
| `idx_chat_messages_channel` | `chat_messages` | `(channel_id, created_at DESC)` WHERE `deleted_at IS NULL` | partial |
| `idx_assets_code_unique` | `assets` | `code` WHERE `code NOT NULL AND archived_at IS NULL` | unique partial |
| `idx_campaigns_period` | `campaigns` | `(starts_on, ends_on)` WHERE `archived_at IS NULL` | partial |
| `idx_campaigns_approval` | `campaigns` | `approval_status` WHERE `pending AND NOT archived` | partial |
| `idx_campaigns_demand` | `campaigns` | `demand_id` WHERE `NOT NULL` | partial |
| `idx_asset_documents_expires` | `asset_documents` | `expires_at` | btree |
| `idx_asset_lifecycle_asset_id` | `asset_lifecycle_logs` | `(asset_id, performed_at DESC)` | btree |
| `idx_attachments_checking` | `attachments` | `(demand_id, entered_at DESC)` WHERE `kind = 'checking'` | partial |
| `idx_attachments_creative` | `attachments` | `(demand_id, version DESC)` WHERE `kind = 'creative'` | partial |
| `idx_recurring_templates_due` | `recurring_templates` | `next_run_at` WHERE `archived_at IS NULL` | partial |
| `idx_intake_links_type` | `intake_links` | `demand_type_id` | btree |
| `idx_external_links_demand` | `external_links` | `demand_id` | btree |
| `idx_personal_tasks_assignee` | `personal_tasks` | `assignee_id` | btree |
| `idx_personal_tasks_due_date` | `personal_tasks` | `due_date` | btree |
| `idx_projects_owner` | `projects` | `owner_id` | btree |
| `idx_project_members_usr` | `project_members` | `user_id` | btree |
| `idx_project_sections_prj` | `project_sections` | `(project_id, position)` | btree |
| `idx_areas_created_by` | `areas` | `created_by` | btree |
| `idx_projects_area` | `projects` | `area_id` | btree |
| `idx_area_members_area_id` | `area_members` | `area_id` | btree |
| `idx_area_members_user_id` | `area_members` | `user_id` | btree |

---

## 6. Extensions Required

| Extension | Purpose |
|---|---|
| `btree_gist` | Required for `campaigns.no_double_booking` EXCLUDE constraint |
| `pgcrypto` (implicit via `gen_random_uuid()`) | UUID generation |

---

## 7. Summary Table Count

| Module | Tables |
|---|---|
| Users & Access | 3 |
| Demand Management | 7 |
| Assets & OOH | 3 |
| Campaigns | 1 |
| Files | 2 |
| Notifications & Webhooks | 3 |
| Chat | 4 |
| Personal Productivity | 5 |
| Tags | 2 |
| Links & Integrations | 3 |
| **Subtotal (mig 042)** | **33 tables + 2 views** |
| Governance & AI (mig 044/046) | 5 |
| Matriz / Agenda (mig 047) | 2 |
| **Total (mig 047)** | **40 tables + 2 views** |

---

## 8. Migrations 043–047 (added since mig 042)

### 8.1 Asset Governance — Pilar 1 (mig 043)
New columns on **`assets`** (no new tables):
- `department_id` (FK departments) — soberania de marca / multi-tenancy
- `external_code` (unique partial index) — chave de import idempotente (Dataprisma/Scoutdoor)
- `installation_date` (date) — âncora de manutenção preditiva
- `structure_type` (CHECK: mastro_metalico/totem/parede/cobertura/digital/outro)
- Indexes geográficos: `idx_assets_city_state`, `idx_assets_dept_city`, `idx_assets_external_code`

> **Dados:** 15.582 pontos de SC importados (`source='dataprisma'`) via `scripts/dataprisma-import/`.

### 8.2 LGPD Compliance (mig 044)
- New tables: **`lgpd_requests`**, **`data_retention_log`**
- New columns: `users.consent_given_at / consent_type / consent_ip / anonymized_at`,
  `demands.anonymized_at`, `demand_feed.anonymized_at`
- `idx_users_pending_anonymization` (partial) para o job noturno de anonimização

### 8.3 Performance (mig 045)
Indexes only (no tables): GIN em `demands.payload` e `demands.fields_snapshot`;
geo/composite em `assets`, `campaigns`, `tasks`. Busca `Blumenau/SC` ~1ms.

### 8.4 Verticalization AI (mig 046)
New tables: **`maintenance_rules`**, **`service_orders`**, **`checking_validation_queue`**
(loop Inteli Estruturas → MovePro + fila de validação Vision AI).

### 8.5 Recursos de Matriz / Agenda (mig 047)
New tables: **`rooms`** (LED, Studio, Tática) e **`room_bookings`**.
- Anti-double-booking via `EXCLUDE USING gist (room_id, tstzrange(...))` (requer `btree_gist`)
- Campos de sync Google Calendar: `external_event_id`, `external_calendar_id`, `sync_status`,
  `last_synced_at`, `sync_error` — serviço em `backend/src/services/googleCalendar.service.js`
- LGPD: `room_bookings.anonymized_at` (segue mig 044)
