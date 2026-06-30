# Projects Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o módulo de Tarefas por um módulo de Projetos estilo Asana — com listagem de projetos, tabs (Visão Geral / Lista / Quadro / +), kanban por seções, membros com funções e convite via notificação interna.

**Architecture:** Nova tabela `projects` + `project_members` + `project_sections`. `personal_tasks` ganha coluna `project_id` FK. Tarefas existentes com `project` VARCHAR são migradas automaticamente via DO block no SQL. Backend: service único `projects.service.js` cobre projetos + seções + membros. Frontend: `Projects.jsx` (lista) + `ProjectDetail.jsx` (tabs inline). Kanban sem DnD — mover tarefa via select no card.

**Tech Stack:** Node 20 + Express + PostgreSQL 16 · React 18 + Vite + TailwindCSS

---

## File Map

| # | Arquivo | Ação |
|---|---------|------|
| 1 | `backend/src/migrations/sql/037_projects.sql` | Criar |
| 2 | `backend/src/services/projects.service.js` | Criar |
| 3 | `backend/src/controllers/projects.controller.js` | Criar |
| 4 | `backend/src/routes/projects.routes.js` | Criar |
| 5 | `backend/src/index.js` | Modificar — registrar rota |
| 6 | `frontend/src/components/layout/Sidebar.jsx` | Modificar — Tarefas→Projetos |
| 7 | `frontend/src/App.jsx` | Modificar — novas rotas |
| 8 | `frontend/src/pages/Projects.jsx` | Criar |
| 9 | `frontend/src/pages/ProjectDetail.jsx` | Criar |

---

## Task 1 — Migration 037_projects.sql

**Files:**
- Create: `backend/src/migrations/sql/037_projects.sql`

- [ ] Criar o arquivo de migration:

```sql
-- ─── 037: projects — módulo de projetos pessoais ────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  color       VARCHAR(7)   NOT NULL DEFAULT '#6366f1',
  owner_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       VARCHAR(50) NOT NULL DEFAULT 'membro',
  invited_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Seções do kanban, ordenadas por posição dentro de cada projeto
CREATE TABLE IF NOT EXISTS project_sections (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  position   INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, name)
);

-- FK em personal_tasks apontando para o projeto formal
ALTER TABLE personal_tasks
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner      ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_project_members_prj ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_usr ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_sections_prj ON project_sections(project_id, position);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_prj  ON personal_tasks(project_id);

-- ─── Migração de dados: criar projects a partir do campo project (VARCHAR) ──
DO $$
DECLARE
  r          RECORD;
  proj_id    UUID;
  admin_id   UUID;
  sec_pos    INTEGER;
BEGIN
  -- Pega o primeiro super_admin como dono dos projetos migrados
  SELECT id INTO admin_id FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN
    SELECT id INTO admin_id FROM users ORDER BY created_at LIMIT 1;
  END IF;

  IF admin_id IS NULL THEN
    RETURN; -- banco vazio, nada a migrar
  END IF;

  -- Para cada nome de projeto distinto
  FOR r IN
    SELECT DISTINCT project AS proj_name
    FROM personal_tasks
    WHERE project IS NOT NULL AND project_id IS NULL
  LOOP
    -- Cria o projeto
    INSERT INTO projects (name, owner_id)
    VALUES (r.proj_name, admin_id)
    RETURNING id INTO proj_id;

    -- Adiciona o dono como membro proprietário
    INSERT INTO project_members (project_id, user_id, role)
    VALUES (proj_id, admin_id, 'proprietário')
    ON CONFLICT DO NOTHING;

    -- Linka as tarefas ao projeto
    UPDATE personal_tasks
    SET project_id = proj_id
    WHERE project = r.proj_name AND project_id IS NULL;

    -- Cria project_sections a partir das sections distintas das tarefas
    sec_pos := 0;
    FOR r IN
      SELECT DISTINCT section AS sec_name
      FROM personal_tasks
      WHERE project_id = proj_id AND section IS NOT NULL
      ORDER BY section
    LOOP
      INSERT INTO project_sections (project_id, name, position)
      VALUES (proj_id, r.sec_name, sec_pos)
      ON CONFLICT DO NOTHING;
      sec_pos := sec_pos + 1;
    END LOOP;

  END LOOP;
END $$;
```

- [ ] Rodar: `cd backend && npm run migrate`
- [ ] Verificar: `✅ 037_projects.sql` no output e sem erros.

---

## Task 2 — projects.service.js

**Files:**
- Create: `backend/src/services/projects.service.js`

Cobre **projetos** (CRUD), **seções** (kanban columns) e **membros**.

- [ ] Criar o arquivo:

```js
import { query } from '#config/database.js'
import { createNotification } from '#services/notifications.service.js'

// ── Projetos ─────────────────────────────────────────────────────────────────

export async function listProjects(userId, role) {
  const { rows } = await query(
    `SELECT p.id, p.name, p.description, p.color, p.created_at,
            COUNT(DISTINCT pm.user_id)::int   AS member_count,
            COUNT(DISTINCT pt.id)::int        AS task_count,
            COUNT(DISTINCT pt.id) FILTER (WHERE pt.status = 'done')::int AS done_count
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     LEFT JOIN personal_tasks pt ON pt.project_id = p.id AND pt.archived_at IS NULL
     WHERE p.archived_at IS NULL
       AND ($1 = 'super_admin' OR pm.user_id = $2)
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [role, userId]
  )
  return rows
}

export async function createProject(userId, data) {
  const { name, description, color } = data
  const { rows: [proj] } = await query(
    `INSERT INTO projects (name, description, color, owner_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description ?? null, color ?? '#6366f1', userId]
  )
  // Criador entra como membro proprietário
  await query(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES ($1, $2, 'proprietário') ON CONFLICT DO NOTHING`,
    [proj.id, userId]
  )
  // Seção inicial padrão
  await query(
    `INSERT INTO project_sections (project_id, name, position)
     VALUES ($1, 'A fazer', 0)`,
    [proj.id]
  )
  return proj
}

export async function getProject(id, userId, role) {
  const { rows: [proj] } = await query(
    `SELECT p.*
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE p.id = $1 AND p.archived_at IS NULL
       AND ($2 = 'super_admin' OR pm.user_id = $3)`,
    [id, role, userId]
  )
  if (!proj) { const e = new Error('Projeto não encontrado.'); e.status = 404; throw e }
  return proj
}

export async function updateProject(id, userId, role, data) {
  await assertProjectAccess(id, userId, role, ['proprietário'])
  const { name, description, color } = data
  const { rows: [proj] } = await query(
    `UPDATE projects SET
       name        = COALESCE($1, name),
       description = $2,
       color       = COALESCE($3, color)
     WHERE id = $4 RETURNING *`,
    [name ?? null, description !== undefined ? description : undefined, color ?? null, id]
  )
  return proj
}

export async function archiveProject(id, userId, role) {
  await assertProjectAccess(id, userId, role, ['proprietário'])
  await query(`UPDATE projects SET archived_at = NOW() WHERE id = $1`, [id])
}

// ── Seções (kanban columns) ───────────────────────────────────────────────────

export async function listSections(projectId) {
  const { rows } = await query(
    `SELECT * FROM project_sections WHERE project_id = $1 ORDER BY position ASC`,
    [projectId]
  )
  return rows
}

export async function createSection(projectId, userId, role, name) {
  await assertProjectAccess(projectId, userId, role)
  const { rows: [{ max_pos }] } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS max_pos FROM project_sections WHERE project_id = $1`,
    [projectId]
  )
  const { rows: [sec] } = await query(
    `INSERT INTO project_sections (project_id, name, position)
     VALUES ($1, $2, $3) RETURNING *`,
    [projectId, name, max_pos]
  )
  return sec
}

export async function renameSection(projectId, sectionId, userId, role, newName) {
  await assertProjectAccess(projectId, userId, role)
  const { rows: [sec] } = await query(
    `SELECT name FROM project_sections WHERE id = $1 AND project_id = $2`,
    [sectionId, projectId]
  )
  if (!sec) { const e = new Error('Seção não encontrada.'); e.status = 404; throw e }
  const oldName = sec.name
  await query(
    `UPDATE project_sections SET name = $1 WHERE id = $2`,
    [newName, sectionId]
  )
  // Cascateia para as tarefas do projeto
  await query(
    `UPDATE personal_tasks SET section = $1 WHERE project_id = $2 AND section = $3`,
    [newName, projectId, oldName]
  )
  return { id: sectionId, name: newName }
}

export async function deleteSection(projectId, sectionId, userId, role) {
  await assertProjectAccess(projectId, userId, role)
  // Move tarefas da seção para null antes de deletar
  await query(
    `UPDATE personal_tasks SET section = NULL WHERE project_id = $1 AND section = (
       SELECT name FROM project_sections WHERE id = $2
     )`,
    [projectId, sectionId]
  )
  await query(`DELETE FROM project_sections WHERE id = $1 AND project_id = $2`, [sectionId, projectId])
}

// ── Membros ───────────────────────────────────────────────────────────────────

export async function listMembers(projectId) {
  const { rows } = await query(
    `SELECT pm.id, pm.user_id, pm.role, pm.invited_at,
            u.name AS user_name, u.email AS user_email
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY pm.invited_at ASC`,
    [projectId]
  )
  return rows
}

export async function addMember(projectId, targetUserId, memberRole, invitedBy, inviterName) {
  const { rows: [proj] } = await query(
    `SELECT name FROM projects WHERE id = $1`, [projectId]
  )
  const { rows: [member] } = await query(
    `INSERT INTO project_members (project_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [projectId, targetUserId, memberRole, invitedBy]
  )
  // Notificação para o convidado
  createNotification(
    targetUserId,
    `${inviterName} te adicionou ao projeto "${proj.name}" como ${memberRole}.`,
    `/projects/${projectId}`,
    'system'
  ).catch(() => {})
  return member
}

export async function updateMemberRole(projectId, targetUserId, userId, role, newRole) {
  await assertProjectAccess(projectId, userId, role, ['proprietário'])
  const { rows: [m] } = await query(
    `UPDATE project_members SET role = $1
     WHERE project_id = $2 AND user_id = $3 RETURNING *`,
    [newRole, projectId, targetUserId]
  )
  return m
}

export async function removeMember(projectId, targetUserId, userId, role) {
  await assertProjectAccess(projectId, userId, role, ['proprietário'])
  await query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, targetUserId]
  )
}

// ── Tarefas do projeto ────────────────────────────────────────────────────────

export async function listProjectTasks(projectId) {
  const { rows } = await query(
    `SELECT pt.*,
            u.name  AS assignee_name,
            u.email AS assignee_email
     FROM personal_tasks pt
     LEFT JOIN users u ON u.id = pt.assignee_id
     WHERE pt.project_id = $1 AND pt.archived_at IS NULL
     ORDER BY pt.section NULLS LAST, pt.position ASC, pt.created_at ASC`,
    [projectId]
  )
  return rows
}

export async function createProjectTask(projectId, userId, data) {
  const { title, section, due_date, assignee_id } = data
  const { rows: [{ next_pos }] } = await query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
     FROM personal_tasks
     WHERE project_id = $1 AND (section IS NOT DISTINCT FROM $2) AND archived_at IS NULL`,
    [projectId, section ?? null]
  )
  const { rows: [task] } = await query(
    `INSERT INTO personal_tasks
       (title, section, project_id, assignee_id, due_date, position, created_by, project)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       (SELECT name FROM projects WHERE id = $3))
     RETURNING *`,
    [title, section ?? null, projectId, assignee_id ?? userId, due_date ?? null, next_pos, userId]
  )
  return task
}

// ── Helper de autorização ─────────────────────────────────────────────────────

async function assertProjectAccess(projectId, userId, role, allowedRoles = null) {
  if (role === 'super_admin') return
  const { rows: [m] } = await query(
    `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId]
  )
  if (!m) { const e = new Error('Sem acesso a este projeto.'); e.status = 403; throw e }
  if (allowedRoles && !allowedRoles.includes(m.role)) {
    const e = new Error('Permissão insuficiente no projeto.'); e.status = 403; throw e
  }
}
```

---

## Task 3 — projects.controller.js

**Files:**
- Create: `backend/src/controllers/projects.controller.js`

- [ ] Criar o arquivo:

```js
import * as svc from '#services/projects.service.js'

function err(e, res) { return res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno.' }) }

// ── Projetos
export const list    = async (req, res) => { try { res.json(await svc.listProjects(req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const create  = async (req, res) => { try { res.status(201).json(await svc.createProject(req.user.id, req.body)) } catch(e){err(e,res)} }
export const get     = async (req, res) => { try { res.json(await svc.getProject(req.params.id, req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const update  = async (req, res) => { try { res.json(await svc.updateProject(req.params.id, req.user.id, req.user.role, req.body)) } catch(e){err(e,res)} }
export const archive = async (req, res) => { try { await svc.archiveProject(req.params.id, req.user.id, req.user.role); res.status(204).end() } catch(e){err(e,res)} }

// ── Seções
export const listSections  = async (req, res) => { try { res.json(await svc.listSections(req.params.id)) } catch(e){err(e,res)} }
export const createSection = async (req, res) => { try { res.status(201).json(await svc.createSection(req.params.id, req.user.id, req.user.role, req.body.name)) } catch(e){err(e,res)} }
export const renameSection = async (req, res) => { try { res.json(await svc.renameSection(req.params.id, req.params.sid, req.user.id, req.user.role, req.body.name)) } catch(e){err(e,res)} }
export const deleteSection = async (req, res) => { try { await svc.deleteSection(req.params.id, req.params.sid, req.user.id, req.user.role); res.status(204).end() } catch(e){err(e,res)} }

// ── Membros
export const listMembers    = async (req, res) => { try { res.json(await svc.listMembers(req.params.id)) } catch(e){err(e,res)} }
export const addMember      = async (req, res) => { try { res.status(201).json(await svc.addMember(req.params.id, req.body.user_id, req.body.role ?? 'membro', req.user.id, req.user.name)) } catch(e){err(e,res)} }
export const updateMember   = async (req, res) => { try { res.json(await svc.updateMemberRole(req.params.id, req.params.uid, req.user.id, req.user.role, req.body.role)) } catch(e){err(e,res)} }
export const removeMember   = async (req, res) => { try { await svc.removeMember(req.params.id, req.params.uid, req.user.id, req.user.role); res.status(204).end() } catch(e){err(e,res)} }

// ── Tarefas do projeto
export const listTasks  = async (req, res) => { try { res.json(await svc.listProjectTasks(req.params.id)) } catch(e){err(e,res)} }
export const createTask = async (req, res) => { try { res.status(201).json(await svc.createProjectTask(req.params.id, req.user.id, req.body)) } catch(e){err(e,res)} }
```

---

## Task 4 — projects.routes.js

**Files:**
- Create: `backend/src/routes/projects.routes.js`

- [ ] Criar o arquivo:

```js
import { Router }      from 'express'
import { authenticate } from '#middlewares/authenticate.js'
import * as ctrl        from '#controllers/projects.controller.js'

const router = Router()
router.use(authenticate)

// Projetos
router.get('/',    ctrl.list)
router.post('/',   ctrl.create)
router.get('/:id', ctrl.get)
router.patch('/:id', ctrl.update)
router.delete('/:id', ctrl.archive)

// Seções (kanban columns)
router.get('/:id/sections',        ctrl.listSections)
router.post('/:id/sections',       ctrl.createSection)
router.patch('/:id/sections/:sid', ctrl.renameSection)
router.delete('/:id/sections/:sid',ctrl.deleteSection)

// Membros
router.get('/:id/members',         ctrl.listMembers)
router.post('/:id/members',        ctrl.addMember)
router.patch('/:id/members/:uid',  ctrl.updateMember)
router.delete('/:id/members/:uid', ctrl.removeMember)

// Tarefas
router.get('/:id/tasks',  ctrl.listTasks)
router.post('/:id/tasks', ctrl.createTask)

export default router
```

---

## Task 5 — Registrar rota em index.js

**Files:**
- Modify: `backend/src/index.js`

- [ ] Adicionar import após a linha `import intakeRoutes`:

```js
import projectsRoutes from '#routes/projects.routes.js'
```

- [ ] Adicionar `app.use` após `/api/reports`:

```js
app.use('/api/projects', projectsRoutes)
```

- [ ] Reiniciar backend e confirmar: `GET /api/projects` retorna `401` (rota existe, requer auth).

---

## Task 6 — Sidebar.jsx

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.jsx`

- [ ] Substituir o bloco da seção Pessoal:

**De:**
```jsx
{/* ── Tarefas (visível a todos) ────────────────────────────────── */}
<SectionLabel className="mt-4">Pessoal</SectionLabel>
<NavItem to="/tasks" label="Tarefas" icon={<IconCheckSquare />} />
```

**Para:**
```jsx
{/* ── Pessoal (visível a todos) ───────────────────────────────── */}
<SectionLabel className="mt-4">Pessoal</SectionLabel>
<NavItem to="/projects" label="Projetos" icon={<IconCheckSquare />} />
```

---

## Task 7 — App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] Adicionar lazy imports (após `TvMode`):

```jsx
const Projects       = lazy(() => import('./pages/Projects'))
const ProjectDetail  = lazy(() => import('./pages/ProjectDetail'))
```

- [ ] Adicionar rotas dentro do `<AppLayout>` (após `/foco`):

```jsx
{/* Projetos pessoais */}
<Route path="/projects"     element={<Projects />} />
<Route path="/projects/:id" element={<ProjectDetail />} />
```

---

## Task 8 — Projects.jsx (lista de projetos)

**Files:**
- Create: `frontend/src/pages/Projects.jsx`

- [ ] Criar o arquivo:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'

const COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState({ name: '', description: '', color: '#6366f1' })
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/projects').then(r => setProjects(r.data)).finally(() => setLoading(false))
  }, [])

  function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    api.post('/projects', form).then(r => {
      setProjects(prev => [r.data, ...prev])
      setModal(false)
      setForm({ name: '', description: '', color: '#6366f1' })
      navigate(`/projects/${r.data.id}`)
    })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Projetos</h1>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Novo Projeto
        </button>
      </div>

      {loading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map(i => <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <svg className="h-12 w-12 mb-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
          <p className="text-sm">Nenhum projeto. Crie o primeiro!</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map(p => (
          <button
            key={p.id}
            onClick={() => navigate(`/projects/${p.id}`)}
            className="text-left rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="h-8 w-8 rounded-lg flex-shrink-0" style={{ backgroundColor: p.color }} />
              <span className="font-semibold text-gray-900 truncate">{p.name}</span>
            </div>
            {p.description && (
              <p className="text-xs text-gray-500 line-clamp-2 mb-3">{p.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>{p.task_count} tarefa{p.task_count !== 1 ? 's' : ''}</span>
              <span>{p.done_count} concluída{p.done_count !== 1 ? 's' : ''}</span>
              <span>{p.member_count} membro{p.member_count !== 1 ? 's' : ''}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Modal novo projeto */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-gray-900">Novo Projeto</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nome</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do projeto"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Opcional"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Cor</label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`h-7 w-7 rounded-full transition-transform ${form.color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setModal(false)} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button type="submit" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Criar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## Task 9 — ProjectDetail.jsx (tabs: Visão Geral / Lista / Quadro / +)

**Files:**
- Create: `frontend/src/pages/ProjectDetail.jsx`

Este é o arquivo maior — contém o container de tabs + 3 componentes de tab inline.

- [ ] Criar `frontend/src/pages/ProjectDetail.jsx` — ver seções abaixo.

### 9a — Skeleton + header + tabs

```jsx
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

const TODAY    = new Date().toISOString().slice(0, 10)
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
const ROLES    = ['proprietário','desenvolvedor','conselheiro','observador','membro']
const COLORS   = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#14b8a6']

function dueDateColor(d, status) {
  if (!d || status === 'done') return 'text-gray-400'
  if (d < TODAY)  return 'text-red-600 font-semibold'
  if (d <= TOMORROW) return 'text-amber-500 font-semibold'
  return 'text-gray-500'
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user    = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'super_admin'

  const [project,  setProject]  = useState(null)
  const [sections, setSections] = useState([])
  const [members,  setMembers]  = useState([])
  const [tasks,    setTasks]    = useState([])
  const [users,    setUsers]    = useState([])
  const [tab,      setTab]      = useState('lista')
  const [loading,  setLoading]  = useState(true)

  const refetch = useCallback(async () => {
    const [proj, secs, mems, tsk] = await Promise.all([
      api.get(`/projects/${id}`).then(r => r.data),
      api.get(`/projects/${id}/sections`).then(r => r.data),
      api.get(`/projects/${id}/members`).then(r => r.data),
      api.get(`/projects/${id}/tasks`).then(r => r.data),
    ])
    setProject(proj); setSections(secs); setMembers(mems); setTasks(tsk)
  }, [id])

  useEffect(() => {
    setLoading(true)
    refetch().finally(() => setLoading(false))
  }, [refetch])

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users').then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data.users ?? [])))
  }, [isAdmin])

  function updateTask(taskId, data) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...data } : t))
    api.patch(`/tasks/${taskId}`, data).catch(refetch)
  }

  function addTask(data) {
    api.post(`/projects/${id}/tasks`, data).then(r => setTasks(prev => [...prev, r.data]))
  }

  if (loading) return (
    <div className="p-6 space-y-3">
      {[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />)}
    </div>
  )
  if (!project) return <div className="p-6 text-gray-400">Projeto não encontrado.</div>

  const TABS = [
    { key: 'overview', label: 'Visão geral' },
    { key: 'lista',    label: 'Lista' },
    { key: 'quadro',   label: 'Quadro' },
    { key: 'plus',     label: '+' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 pt-5 pb-0">
        <div className="flex items-center gap-3 mb-3">
          <span className="h-8 w-8 rounded-lg flex-shrink-0" style={{ backgroundColor: project.color }} />
          <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
        </div>
        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <OverviewTab project={project} members={members} users={users} isAdmin={isAdmin}
            onProjectChange={setProject} onMembersChange={setMembers} projectId={id} user={user} />
        )}
        {tab === 'lista' && (
          <ListaTab tasks={tasks} sections={sections} users={users} isAdmin={isAdmin}
            onUpdateTask={updateTask} onAddTask={addTask} projectId={id} />
        )}
        {tab === 'quadro' && (
          <QuadroTab tasks={tasks} sections={sections} setSections={setSections}
            users={users} isAdmin={isAdmin} onUpdateTask={updateTask} onAddTask={addTask}
            projectId={id} user={user} />
        )}
        {tab === 'plus' && <PlusTab />}
      </div>
    </div>
  )
}
```

### 9b — OverviewTab

```jsx
function OverviewTab({ project, members, users, isAdmin, onProjectChange, onMembersChange, projectId, user }) {
  const [inviteModal, setInviteModal] = useState(false)
  const [invForm,     setInvForm]     = useState({ user_id: '', role: 'membro' })
  const [editDesc,    setEditDesc]    = useState(false)
  const [desc,        setDesc]        = useState(project.description ?? '')

  function saveDesc() {
    setEditDesc(false)
    api.patch(`/projects/${projectId}`, { description: desc })
       .then(r => onProjectChange(r.data))
  }

  function invite(e) {
    e.preventDefault()
    if (!invForm.user_id) return
    api.post(`/projects/${projectId}/members`, invForm).then(r => {
      const newMember = { ...r.data, user_name: users.find(u => u.id === invForm.user_id)?.name }
      onMembersChange(prev => [...prev.filter(m => m.user_id !== invForm.user_id), newMember])
      setInviteModal(false)
      setInvForm({ user_id: '', role: 'membro' })
    })
  }

  function changeRole(uid, newRole) {
    api.patch(`/projects/${projectId}/members/${uid}`, { role: newRole })
       .then(r => onMembersChange(prev => prev.map(m => m.user_id === uid ? { ...m, role: r.data.role } : m)))
  }

  function removeMember(uid) {
    api.delete(`/projects/${projectId}/members/${uid}`)
       .then(() => onMembersChange(prev => prev.filter(m => m.user_id !== uid)))
  }

  const nonMembers = users.filter(u => !members.some(m => m.user_id === u.id))

  return (
    <div className="p-6 max-w-2xl">
      {/* Descrição */}
      <div className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Descrição</h2>
        {editDesc ? (
          <div>
            <textarea
              autoFocus
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-primary-300 px-3 py-2 text-sm focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button onMouseDown={e => { e.preventDefault(); saveDesc() }}
                className="rounded bg-primary-600 px-3 py-1 text-xs text-white hover:bg-primary-700">Salvar</button>
              <button onMouseDown={e => { e.preventDefault(); setEditDesc(false); setDesc(project.description ?? '') }}
                className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => setEditDesc(true)}
            className={`cursor-pointer rounded-lg p-2 text-sm hover:bg-gray-50 ${desc ? 'text-gray-700' : 'text-gray-300 italic'}`}
          >
            {desc || 'Adicionar descrição...'}
          </p>
        )}
      </div>

      {/* Membros */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Membros</h2>
          {(isAdmin || members.some(m => m.user_id === user?.id && m.role === 'proprietário')) && nonMembers.length > 0 && (
            <button onClick={() => setInviteModal(true)}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Convidar membro
            </button>
          )}
        </div>
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                {(m.user_name ?? '?').split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}
              </span>
              <span className="flex-1 text-sm text-gray-800">{m.user_name}</span>
              {isAdmin || members.some(mm => mm.user_id === user?.id && mm.role === 'proprietário') ? (
                <select
                  value={m.role}
                  onChange={e => changeRole(m.user_id, e.target.value)}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 focus:outline-none"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <span className="text-xs text-gray-400">{m.role}</span>
              )}
              {(isAdmin || (members.some(mm => mm.user_id === user?.id && mm.role === 'proprietário') && m.role !== 'proprietário')) && (
                <button onClick={() => removeMember(m.user_id)}
                  className="text-gray-300 hover:text-red-400 transition-colors">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Modal de convite */}
      {inviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-base font-bold text-gray-900">Convidar membro</h3>
            <form onSubmit={invite} className="space-y-3">
              <select
                value={invForm.user_id}
                onChange={e => setInvForm(f => ({ ...f, user_id: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
              >
                <option value="">Selecionar pessoa</option>
                {nonMembers.map(u => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
              </select>
              <select
                value={invForm.role}
                onChange={e => setInvForm(f => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-primary-400"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setInviteModal(false)} className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button type="submit" className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Convidar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
```

### 9c — ListaTab

```jsx
function ListaTab({ tasks, sections, users, isAdmin, onUpdateTask, onAddTask, projectId }) {
  const [newTitle,  setNewTitle]  = useState('')
  const [newSection, setNewSection] = useState('')
  const [adding,    setAdding]    = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  function commitAdd() {
    const t = newTitle.trim()
    if (t) onAddTask({ title: t, section: newSection || null })
    setNewTitle(''); setAdding(false)
  }

  const sectionNames = sections.length > 0
    ? sections.map(s => s.name)
    : [...new Set(tasks.map(t => t.section ?? '').filter(Boolean)), '']

  const grouped = sectionNames.reduce((acc, sec) => {
    acc[sec] = tasks.filter(t => (t.section ?? '') === sec)
    return acc
  }, {})
  // Tasks sem seção definida nas sections
  if (!sectionNames.includes('')) grouped[''] = tasks.filter(t => !t.section)

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-1 grid grid-cols-[2rem_1fr_8rem_8rem] gap-0 px-4">
        <span />
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Nome</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Responsável</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Conclusão</span>
      </div>
      <div className="border-t border-gray-200 mb-3" />

      {Object.entries(grouped).map(([sec, secTasks]) => {
        if (secTasks.length === 0 && sec !== '') return null
        return (
          <div key={sec} className="mb-6">
            {sec && <p className="mb-1 text-sm font-semibold text-gray-700">{sec}</p>}
            <table className="w-full">
              <tbody>
                {secTasks.map(t => (
                  <tr key={t.id} className={`border-b border-gray-100 hover:bg-gray-50 ${t.status === 'done' ? 'opacity-60' : ''}`}>
                    <td className="w-8 pl-4 py-2">
                      <button
                        onClick={() => onUpdateTask(t.id, { status: t.status === 'done' ? 'todo' : 'done' })}
                        className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${t.status==='done' ? 'border-primary-500 bg-primary-500':'border-gray-300 hover:border-primary-400'}`}
                      >
                        {t.status==='done' && <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 1.414l-6 6a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L5 8.586l5.293-5.293z" clipRule="evenodd" /></svg>}
                      </button>
                    </td>
                    <td className="py-2 pr-4 w-full">
                      <span className={`text-sm ${t.status==='done' ? 'line-through text-gray-400':'text-gray-800'}`}>{t.title}</span>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {t.assignee_name
                        ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[10px] font-semibold text-primary-700">{t.assignee_name.split(' ').map(n=>n[0]).slice(0,2).join('').toUpperCase()}</span>
                        : <span className="text-xs text-gray-300">—</span>
                      }
                    </td>
                    <td className={`py-2 pr-4 whitespace-nowrap text-xs ${dueDateColor(t.due_date, t.status)}`}>
                      {t.due_date ? t.due_date.slice(0,10).split('-').reverse().join('/') : '—'}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="pl-4 py-1">
                    {adding && newSection === sec ? (
                      <div className="flex items-center gap-2">
                        <input ref={inputRef} value={newTitle} onChange={e=>setNewTitle(e.target.value)}
                          onKeyDown={e=>{if(e.key==='Enter')commitAdd();if(e.key==='Escape'){setNewTitle('');setAdding(false)}}}
                          placeholder="Nome da tarefa..." className="flex-1 rounded border border-primary-300 px-2 py-1 text-sm focus:outline-none" />
                        <button onMouseDown={e=>{e.preventDefault();commitAdd()}} className="rounded bg-primary-600 px-2 py-1 text-xs text-white">Salvar</button>
                        <button onMouseDown={e=>{e.preventDefault();setAdding(false)}} className="text-xs text-gray-400">Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={()=>{setNewSection(sec);setAdding(true)}} className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
                        Adicionar tarefa
                      </button>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
```

### 9d — QuadroTab (Kanban)

```jsx
function QuadroTab({ tasks, sections, setSections, users, isAdmin, onUpdateTask, onAddTask, projectId, user }) {
  const [editingCol,  setEditingCol]  = useState(null) // sectionId sendo renomeado
  const [colName,     setColName]     = useState('')
  const [addColMode,  setAddColMode]  = useState(false)
  const [newColName,  setNewColName]  = useState('')
  const [addTaskCol,  setAddTaskCol]  = useState(null)
  const [newTaskTitle,setNewTaskTitle]= useState('')
  const colInput = useRef(null)
  const taskInput = useRef(null)

  useEffect(() => { if (editingCol !== null) colInput.current?.focus() }, [editingCol])
  useEffect(() => { if (addTaskCol !== null) taskInput.current?.focus() }, [addTaskCol])

  function startRename(sec) {
    setEditingCol(sec.id); setColName(sec.name)
  }

  function commitRename(sec) {
    const name = colName.trim()
    if (!name || name === sec.name) { setEditingCol(null); return }
    api.patch(`/projects/${projectId}/sections/${sec.id}`, { name })
       .then(() => setSections(prev => prev.map(s => s.id === sec.id ? { ...s, name } : s)))
    setEditingCol(null)
  }

  function addColumn() {
    const name = newColName.trim()
    if (!name) { setAddColMode(false); return }
    api.post(`/projects/${projectId}/sections`, { name })
       .then(r => setSections(prev => [...prev, r.data]))
    setNewColName(''); setAddColMode(false)
  }

  function deleteColumn(sec) {
    if (!window.confirm(`Deletar coluna "${sec.name}"? As tarefas ficarão sem seção.`)) return
    api.delete(`/projects/${projectId}/sections/${sec.id}`)
       .then(() => setSections(prev => prev.filter(s => s.id !== sec.id)))
  }

  function addTaskToCol(secName) {
    const title = newTaskTitle.trim()
    if (title) onAddTask({ title, section: secName })
    setNewTaskTitle(''); setAddTaskCol(null)
  }

  function moveTask(taskId, newSection) {
    onUpdateTask(taskId, { section: newSection })
  }

  const cols = sections.length > 0 ? sections : [{ id: '__none', name: '' }]

  return (
    <div className="flex gap-4 p-6 overflow-x-auto min-h-full items-start">
      {cols.map(sec => {
        const colTasks = tasks.filter(t => (t.section ?? '') === sec.name)
        return (
          <div key={sec.id} className="w-64 flex-shrink-0">
            {/* Cabeçalho da coluna */}
            <div className="group flex items-center justify-between mb-3">
              {editingCol === sec.id ? (
                <input
                  ref={colInput}
                  value={colName}
                  onChange={e => setColName(e.target.value)}
                  onBlur={() => commitRename(sec)}
                  onKeyDown={e => { if (e.key==='Enter') commitRename(sec); if (e.key==='Escape') setEditingCol(null) }}
                  className="flex-1 rounded border border-primary-300 px-2 py-0.5 text-sm font-semibold focus:outline-none"
                />
              ) : (
                <span
                  onDoubleClick={() => startRename(sec)}
                  className="text-sm font-semibold text-gray-700 cursor-default"
                  title="Duplo clique para renomear"
                >
                  {sec.name || 'Sem seção'} <span className="font-normal text-gray-400">({colTasks.length})</span>
                </span>
              )}
              {sec.id !== '__none' && (
                <button onClick={() => deleteColumn(sec)}
                  className="opacity-0 group-hover:opacity-100 ml-2 text-gray-300 hover:text-red-400 transition-all">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>

            {/* Cards */}
            <div className="space-y-2">
              {colTasks.map(t => (
                <div key={t.id} className={`rounded-xl border border-gray-200 bg-white p-3 shadow-sm ${t.status==='done' ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => onUpdateTask(t.id, { status: t.status==='done'?'todo':'done' })}
                      className={`mt-0.5 flex-shrink-0 flex h-4 w-4 items-center justify-center rounded border-2 transition-colors ${t.status==='done'?'border-primary-500 bg-primary-500':'border-gray-300 hover:border-primary-400'}`}
                    >
                      {t.status==='done' && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="currentColor"><path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 1.414l-6 6a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L5 8.586l5.293-5.293z" clipRule="evenodd" /></svg>}
                    </button>
                    <p className={`flex-1 text-sm ${t.status==='done'?'line-through text-gray-400':'text-gray-800'}`}>{t.title}</p>
                  </div>
                  {t.due_date && (
                    <p className={`mt-1.5 ml-6 text-xs ${dueDateColor(t.due_date, t.status)}`}>
                      {t.due_date.slice(0,10).split('-').reverse().join('/')}
                    </p>
                  )}
                  {/* Mover para outra coluna */}
                  {sections.length > 1 && (
                    <div className="mt-2 ml-6">
                      <select
                        value={t.section ?? ''}
                        onChange={e => moveTask(t.id, e.target.value || null)}
                        className="w-full rounded border border-gray-100 bg-gray-50 px-1 py-0.5 text-xs text-gray-500 focus:outline-none"
                      >
                        {sections.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              ))}

              {/* Adicionar tarefa à coluna */}
              {addTaskCol === sec.id ? (
                <div className="rounded-xl border border-primary-200 bg-white p-3">
                  <input
                    ref={taskInput}
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    onKeyDown={e => { if(e.key==='Enter') addTaskToCol(sec.name); if(e.key==='Escape'){setNewTaskTitle('');setAddTaskCol(null)} }}
                    placeholder="Nome da tarefa..."
                    className="w-full text-sm focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button onMouseDown={e=>{e.preventDefault();addTaskToCol(sec.name)}} className="rounded bg-primary-600 px-2 py-0.5 text-xs text-white">Salvar</button>
                    <button onMouseDown={e=>{e.preventDefault();setNewTaskTitle('');setAddTaskCol(null)}} className="text-xs text-gray-400">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddTaskCol(sec.id)}
                  className="flex w-full items-center gap-1 rounded-xl border border-dashed border-gray-200 p-2 text-xs text-gray-400 hover:border-primary-300 hover:text-primary-600 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
                  Adicionar tarefa
                </button>
              )}
            </div>
          </div>
        )
      })}

      {/* Adicionar coluna */}
      <div className="w-64 flex-shrink-0">
        {addColMode ? (
          <div className="rounded-xl border border-primary-200 bg-white p-3">
            <input
              autoFocus
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              onKeyDown={e => { if(e.key==='Enter') addColumn(); if(e.key==='Escape'){setNewColName('');setAddColMode(false)} }}
              placeholder="Nome da coluna..."
              className="w-full text-sm font-semibold focus:outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button onMouseDown={e=>{e.preventDefault();addColumn()}} className="rounded bg-primary-600 px-2 py-0.5 text-xs text-white">Salvar</button>
              <button onMouseDown={e=>{e.preventDefault();setNewColName('');setAddColMode(false)}} className="text-xs text-gray-400">Cancelar</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddColMode(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 p-3 text-sm text-gray-400 hover:border-primary-300 hover:text-primary-600 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
            Adicionar seção
          </button>
        )}
      </div>
    </div>
  )
}
```

### 9e — PlusTab

```jsx
function PlusTab() {
  const OPTIONS = [
    { label: 'Gantt',             desc: 'Monitore dependências e linhas de base' },
    { label: 'Calendário',        desc: 'Planeje o trabalho semanal ou mensal' },
    { label: 'Cronograma',        desc: 'Agende trabalhos ao longo do tempo' },
    { label: 'Painel',            desc: 'Monitore métricas e insights do projeto' },
    { label: 'Mensagens',         desc: 'Comunique-se com os membros do projeto' },
    { label: 'Fluxo de trabalho', desc: 'Automatize com regras' },
  ]
  return (
    <div className="p-6 max-w-2xl">
      <p className="mb-4 text-sm text-gray-500">Adicionar visualização ao projeto</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(o => (
          <div key={o.label} className="rounded-xl border border-gray-200 p-4 opacity-50 cursor-not-allowed">
            <p className="font-semibold text-gray-700 text-sm">{o.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{o.desc}</p>
            <span className="mt-2 inline-block text-xs text-gray-300">Em breve</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Self-Review

**Spec coverage:**
- ✅ Sidebar "Tarefas" → "Projetos" — Task 6
- ✅ Criar novo projeto — Task 8 (modal)
- ✅ Migração das 16 tarefas existentes — Task 1 (DO block)
- ✅ Adicionar pessoas ao projeto com convite (notificação interna) — Task 9b OverviewTab
- ✅ Funções dentro do projeto (proprietário/desenvolvedor/conselheiro etc) — `project_members.role`
- ✅ Lista de tarefas (Lista tab) — Task 9c
- ✅ Kanban com seções renomeáveis — Task 9d, `renameSection` cascateia para tasks
- ✅ Aba + com opções futuras — Task 9e

**Gaps identificados:**
- `updateProject` no service tem bug: `description` usa `undefined` em vez de `existing.description` no `COALESCE`. Fix inline no Task 2 abaixo.
- `inviterName` no controller usa `req.user.name` — confirmar que `authenticate` middleware popula `req.user.name`. Ver existing controllers para padrão.

**Fix description no updateProject (Task 2):**
```js
// Linha corrigida:
`UPDATE projects SET
   name        = COALESCE($1, name),
   description = COALESCE($2, description),
   color       = COALESCE($3, color)
 WHERE id = $4 RETURNING *`,
[name ?? null, description ?? null, color ?? null, id]
```

**Observação authenticate middleware:** Se `req.user.name` não existir, trocar no controller por:
```js
// Em addMember:
req.user.name ?? req.user.email
```
