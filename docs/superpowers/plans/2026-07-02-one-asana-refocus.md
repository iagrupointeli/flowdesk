# ONE → Asana-like refocus (Track R)

**Date:** 2026-07-02 (same-day pivot from Ruan, after the leadership meeting)
**Status:** PLANNED / nothing built yet
**Direction:** InteliONE's current focus becomes projects + tasks assigned to
users — "make ONE work like an Asana". The demand/OOH modules are NOT deleted:
they go to a backlog state (code kept, hidden from navigation) until the
holding's operation needs them surfaced again.

## Verified facts grounding this plan (prod recon, 2026-07-02)

- `demands` table: **0 rows** in production. Hiding the demand system today
  loses nothing.
- `departments`: exactly 1 ("SC Outdoor" — owns the 15k SC assets).
- `areas`: 3 (Diretoria, Inovação, TI). **Zero name collision** with
  departments.
- `area_members`: **0 rows** — no membership data to migrate.
- `personal_tasks`: 16 active, **all** project-scoped (project "TI - Inovação
  IA"). Projects/tasks are already the only live work data in prod.
- Dashboard backend (`dashboard.service.js`): 8 queries on `demands` + a few
  on `campaigns`/`assets` — fully demand/OOH-centric, needs replacement not
  adjustment.
- FocusMode frontend: fetches `/demands` — same situation.

## R1 — Navigation restructure (frontend only, fast)

✅ **DONE 2026-07-02, commit `b4876ef`.** Decisions confirmed by Ruan: hide
QUADROS too, routes stay reachable by direct URL (not hard-blocked), rename
"Áreas" to "Departamentos", batch-deploy with the rest.

- Sidebar gained an "Administração" section (gated to
  dept_admin/super_admin): Dashboard, Usuários, Departamentos, Workflows,
  Webhooks.
- Header gear dropdown removed entirely (state/handlers/icons/ADMIN_ITEMS).
- Backlog'd — no menu entry anywhere, routes/pages/backend untouched and
  reachable by direct URL (verified `/admin/map` renders fine unlinked):
  Comercial, Tags, Pontos, Ocupação, Grade, Mapa, Recorrências, Auditoria,
  Modo TV.
- "Nova Demanda" button and the "Quadros" section (demand-type boards)
  removed from the sidebar. `demandTypeStore`/`NewDemandModal` no longer
  imported there; backend + store code untouched.
- "Áreas" sidebar section renamed to "Departamentos" — label only for now,
  still reads `GET /areas`; real backend unification is R2 below.
- Verified in preview with disposable test accounts: super_admin sees the
  full new layout; plain `user` role correctly does NOT see the
  Administração section (RBAC intact).

**Not addressed, flagged for Ruan:** `/board` is still the default
post-login landing page and its empty state still says "Selecione um tipo
de demanda na barra lateral" — stale copy now that demand types aren't in
the nav. Not broken, just orphaned language. Candidate to fix alongside R4
(when Modo Foco / a projects-based view becomes the natural landing page).

## R2 — Áreas = Departamentos unification (migration 050)

Ruan's clarification: an Area IS a Department — one concept, two tables today
purely by accident of development order. Prod data makes the merge cheap.

- Migration 050:
  - Insert the 3 areas into `departments` **reusing the same UUIDs**
    (`INSERT INTO departments (id, name, ...) SELECT id, name, ... FROM areas
    WHERE id NOT IN (SELECT id FROM departments)`), so existing
    `projects.area_id` values remain valid as department references.
  - `projects`: add `department_id UUID REFERENCES departments(id)`, backfill
    `= area_id`, drop `area_id`.
  - `area_members` is empty — nothing to migrate; drop it.
  - Rename `areas` to `areas_deprecated` for one release (paranoia window),
    drop in a later migration.
- Backend: `assertProjectAccess` swaps `area_members` check for
  `user_departments`; areas routes/controller/service fold into departments
  (or become thin aliases for one release while the frontend migrates).
- Frontend: Sidebar tree + Areas page read departments (each department shows
  its projects). UI label decision pending (keep "Áreas" vs rename
  "Departamentos").
- Side effects (intended): chat visibility and dept_admin scope now naturally
  cover the project-hosting departments; assigning people to
  Diretoria/Inovação/TI becomes normal department membership (RH flow, ties
  into Track F2 hierarchy later).

## R3 — Dashboard v2: projects & tasks

- Replace demand queries with task/project queries: tasks by status per
  project; active/archived project counts; overdue tasks (due_date < today,
  status 'todo'); workload per assignee; completed-this-week trend.
- **Migration 051: `task_due_date_history`** (append-only: task_id, old_date,
  new_date, changed_by, changed_at) + write-path hook wherever due_date
  changes. This is Track F3's postponement-drift dashboard ("10/07 → 30/07 →
  10/08 — falta de tempo, foco ou rumo?"). Even if the chart ships later,
  start collecting NOW — the data only has value with history behind it.
- Old demand dashboard code → backlog (kept, unrouted).

## R4 — Modo Foco: my tasks across projects

- Rework FocusMode to list `personal_tasks` where `assignee_id = me AND
  status = 'todo' AND archived_at IS NULL`, grouped by urgency (Atrasadas /
  Hoje / Esta semana / Sem data) and labeled by project. This is the "my
  work" view — the heart of the Asana model.

## R5 — Task depth (Asana parity, absorbs Track F3 features)

- Subtasks: `parent_task_id` on personal_tasks (migration 052).
- Comments + @mentions on tasks (new table; reuse the existing notifications
  system for mention pings).
- Due-date drift visible on task detail (reads 051 history).
- Assignee + due date per task already exist — no work needed.

## Sequencing

R1 → R2 → (R3 and R4, either order) → R5.
R1 is pure UI and lands the visible change immediately; R2 is the structural
foundation the dashboards read from; R3/R4 deliver the Asana feel; R5 is
depth. Pending undeployed commits (chat profile header `e3386a5`, idea button
`c08faf3`) ship together with R1's deploy.

## Explicitly NOT in this track

- Deleting demand/OOH code or data — backlog means hidden, not removed.
- The OOH roadmap (Phases 2–6, Tracks B/C/D) — deprioritized, not cancelled;
  it resumes when the holding's operation pulls for it.
- AI anywhere in runtime — unchanged thesis.
