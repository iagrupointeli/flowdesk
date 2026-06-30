import * as svc from '#services/projects.service.js'

function err(e, res) { return res.status(e.status ?? 500).json({ error: e.message ?? 'Erro interno.' }) }

// ── Projetos
export const list    = async (req, res) => { try { res.json(await svc.listProjects(req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const create  = async (req, res) => { try { res.status(201).json(await svc.createProject(req.user.id, req.body)) } catch(e){err(e,res)} }
export const get     = async (req, res) => { try { res.json(await svc.getProject(req.params.id, req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const update  = async (req, res) => { try { res.json(await svc.updateProject(req.params.id, req.user.id, req.user.role, req.body)) } catch(e){err(e,res)} }
export const archive = async (req, res) => { try { await svc.archiveProject(req.params.id, req.user.id, req.user.role); res.status(204).end() } catch(e){err(e,res)} }

// ── Seções
export const listSections  = async (req, res) => { try { res.json(await svc.listSections(req.params.id, req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const createSection = async (req, res) => { try { res.status(201).json(await svc.createSection(req.params.id, req.user.id, req.user.role, req.body.name)) } catch(e){err(e,res)} }
export const renameSection = async (req, res) => { try { res.json(await svc.renameSection(req.params.id, req.params.sid, req.user.id, req.user.role, req.body.name)) } catch(e){err(e,res)} }
export const deleteSection = async (req, res) => { try { await svc.deleteSection(req.params.id, req.params.sid, req.user.id, req.user.role); res.status(204).end() } catch(e){err(e,res)} }

// ── Membros
export const listMembers  = async (req, res) => { try { res.json(await svc.listMembers(req.params.id, req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const addMember    = async (req, res) => { try { res.status(201).json(await svc.addMember(req.params.id, req.body.user_id, req.body.role ?? 'membro', req.user.id)) } catch(e){err(e,res)} }
export const updateMember = async (req, res) => { try { res.json(await svc.updateMemberRole(req.params.id, req.params.uid, req.user.id, req.user.role, req.body.role)) } catch(e){err(e,res)} }
export const removeMember = async (req, res) => { try { await svc.removeMember(req.params.id, req.params.uid, req.user.id, req.user.role); res.status(204).end() } catch(e){err(e,res)} }

// ── Tarefas do projeto
export const listTasks  = async (req, res) => { try { res.json(await svc.listProjectTasks(req.params.id, req.user.id, req.user.role)) } catch(e){err(e,res)} }
export const createTask = async (req, res) => { try { res.status(201).json(await svc.createProjectTask(req.params.id, req.user.id, req.user.role, req.body)) } catch(e){err(e,res)} }
