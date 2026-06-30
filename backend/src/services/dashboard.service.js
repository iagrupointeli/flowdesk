/**
 * Dashboard Service — métricas, gráficos e exportação CSV.
 *
 * ── Escopo RBAC (vertical isolation) ────────────────────────────────────────
 *
 *   super_admin → todos os departamentos + pode filtrar livremente por dept_id
 *   dept_admin  → SOMENTE seus departamentos (deptIds do JWT); qualquer dept_id
 *                 passado pelo frontend é ignorado para evitar vazamento vertical.
 *
 * Filtros aceitos:
 *   dept_id   — UUID do departamento (apenas super_admin pode usar)
 *   date_from — ISO date string, inclusivo (>= date 00:00:00)
 *   date_to   — ISO date string, inclusivo (até o ÚLTIMO segundo do dia)
 */
import { query } from '#config/database.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Adiciona condição de escopo de departamento ao WHERE.
 * super_admin não recebe restrição; dept_admin vê somente seus depts.
 */
function addScopeCondition(actor, params, conditions) {
  if (actor.role !== 'super_admin') {
    params.push(actor.deptIds)
    conditions.push(`dt.department_id = ANY($${params.length}::uuid[])`)
  }
}

/**
 * Adiciona filtros de deptId e intervalo de datas.
 *
 * SEGURANÇA — dept_id:
 *   dept_admin: o parâmetro dept_id é IGNORADO — o escopo já está garantido
 *   por addScopeCondition (deptIds do JWT). Aceitar o dept_id do frontend
 *   permitiria que um dept_admin tentasse inspecionar outros departamentos.
 *   Apenas super_admin pode aplicar filtro adicional por dept_id.
 *
 * PRECISÃO — date_to:
 *   A string YYYY-MM-DD sem horário seria interpretada como 00:00:00, excluindo
 *   todo o último dia. Usamos `<= date_to + 1 day - 1 second` para incluir
 *   todos os registros até 23:59:59 do dia solicitado (precisão de 1s).
 */
function addCommonFilters(actor, filters, params, conditions) {
  // dept_id: somente super_admin pode filtrar por departamento arbitrário
  if (filters.dept_id && actor.role === 'super_admin') {
    params.push(filters.dept_id)
    conditions.push(`dt.department_id = $${params.length}`)
  }
  if (filters.date_from) {
    params.push(filters.date_from)
    conditions.push(`d.created_at >= $${params.length}::date`)
  }
  if (filters.date_to) {
    params.push(filters.date_to)
    // Inclusivo: inclui todo o último dia (23:59:59)
    conditions.push(
      `d.created_at <= ($${params.length}::date + INTERVAL '1 day' - INTERVAL '1 second')`
    )
  }
}

function buildWhere(conditions) {
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
}

// ── Exported actions ──────────────────────────────────────────────────────────

/**
 * Retorna métricas KPI + dados dos gráficos em um único objeto.
 *
 * KPIs:
 *   total_demands      — total no período/filtro
 *   on_hold_count      — em espera
 *   cancelled_count    — canceladas
 *   finalized_count    — em etapa final
 *   finalization_rate  — % finalizadas (0–100)
 *   avg_resolution_hours — média de horas entre criação e entrada na 1ª etapa final
 *
 * Gráficos:
 *   by_stage      — [{ stage_name, count }]
 *   by_department — [{ dept_name, count }]
 */
export async function getStats(actor, filters = {}) {
  const params     = []
  const conditions = []
  addScopeCondition(actor, params, conditions)
  addCommonFilters(actor, filters, params, conditions)
  const where = buildWhere(conditions)

  // ── Métricas principais ──────────────────────────────────────────────────
  const { rows: [metrics] } = await query(`
    SELECT
      COUNT(d.id)                                                          AS total_demands,
      COUNT(d.id) FILTER (WHERE d.exception_state = 'on_hold')            AS on_hold_count,
      COUNT(d.id) FILTER (WHERE d.exception_state = 'cancelled')          AS cancelled_count,
      COUNT(d.id) FILTER (WHERE ws.is_final = true)                       AS finalized_count,
      ROUND(
        COUNT(d.id) FILTER (WHERE ws.is_final = true)::numeric
        / NULLIF(COUNT(d.id), 0) * 100,
        1
      )                                                                    AS finalization_rate
    FROM demands d
    JOIN demand_types    dt   ON dt.id   = d.demand_type_id
    JOIN departments     dept ON dept.id = dt.department_id
    LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
    ${where}
  `, params)

  // ── Tempo médio de resolução (horas) ─────────────────────────────────────
  // Para cada demanda que passou por uma etapa final, registra o instante
  // da PRIMEIRA entrada em etapa final. Média sobre esse conjunto.
  const { rows: [slaRow] } = await query(`
    WITH resolved AS (
      SELECT DISTINCT ON (dh.demand_id)
        dh.demand_id,
        dh.entered_at  AS resolved_at,
        d.created_at
      FROM  demand_history dh
      JOIN  workflow_stages wsfin ON wsfin.id = dh.stage_id AND wsfin.is_final = true
      JOIN  demands         d     ON d.id   = dh.demand_id
      JOIN  demand_types    dt    ON dt.id  = d.demand_type_id
      JOIN  departments     dept  ON dept.id = dt.department_id
      ${where}
      ORDER BY dh.demand_id, dh.entered_at ASC
    )
    SELECT
      ROUND(
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::numeric,
        1
      ) AS avg_resolution_hours
    FROM resolved
  `, params)

  // ── Gráfico: volumetria por etapa ────────────────────────────────────────
  const { rows: byStage } = await query(`
    SELECT
      COALESCE(ws.name, 'Sem etapa') AS stage_name,
      COUNT(d.id)::int               AS count
    FROM demands d
    JOIN demand_types    dt   ON dt.id   = d.demand_type_id
    JOIN departments     dept ON dept.id = dt.department_id
    LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
    ${where}
    GROUP BY ws.id, ws.name
    ORDER BY count DESC
  `, params)

  // ── Gráfico: volumetria por departamento ─────────────────────────────────
  const { rows: byDepartment } = await query(`
    SELECT
      dept.name        AS dept_name,
      COUNT(d.id)::int AS count
    FROM demands d
    JOIN demand_types dt   ON dt.id   = d.demand_type_id
    JOIN departments  dept ON dept.id = dt.department_id
    LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
    ${where}
    GROUP BY dept.id, dept.name
    ORDER BY count DESC
  `, params)

  return {
    metrics: {
      total_demands:         Number(metrics.total_demands   ?? 0),
      on_hold_count:         Number(metrics.on_hold_count   ?? 0),
      cancelled_count:       Number(metrics.cancelled_count ?? 0),
      finalized_count:       Number(metrics.finalized_count ?? 0),
      finalization_rate:     Number(metrics.finalization_rate ?? 0),
      avg_resolution_hours:  slaRow.avg_resolution_hours != null
                               ? Number(slaRow.avg_resolution_hours)
                               : null,
    },
    charts: {
      by_stage:      byStage,
      by_department: byDepartment,
    },
  }
}

/**
 * Dados agregados para o Modo TV — painel de operação ao vivo.
 *
 * Pensado para polling de 60s num monitor: uma única chamada retorna tudo
 * que a tela precisa, sem filtros de data (sempre o estado AGORA).
 *
 * Blocos:
 *   kpis            — abertas, críticas (<24h), vencidas, criadas/concluídas hoje, pausadas
 *   critical        — até 8 demandas com prazo vencido ou vencendo em 24h
 *   by_department   — demandas abertas por departamento
 *   recent_activity — últimos 10 eventos do demand_history
 */
export async function getTvData(actor) {
  const params     = []
  const conditions = []
  addScopeCondition(actor, params, conditions)
  const where    = buildWhere(conditions)
  const andScope = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  // ── KPIs ──────────────────────────────────────────────────────────────────
  // "Aberta" = não finalizada e não cancelada.
  const { rows: [kpis] } = await query(`
    SELECT
      COUNT(d.id) FILTER (
        WHERE d.finalized_at IS NULL
          AND (d.exception_state IS NULL OR d.exception_state <> 'cancelled')
      )::int AS open_count,
      COUNT(d.id) FILTER (
        WHERE d.finalized_at IS NULL
          AND (d.exception_state IS NULL OR d.exception_state <> 'cancelled')
          AND d.due_date IS NOT NULL
          AND d.due_date <= NOW() + INTERVAL '24 hours'
          AND d.due_date > NOW()
      )::int AS critical_count,
      COUNT(d.id) FILTER (
        WHERE d.finalized_at IS NULL
          AND (d.exception_state IS NULL OR d.exception_state <> 'cancelled')
          AND d.due_date IS NOT NULL
          AND d.due_date <= NOW()
      )::int AS overdue_count,
      COUNT(d.id) FILTER (WHERE d.created_at   >= CURRENT_DATE)::int AS created_today,
      COUNT(d.id) FILTER (WHERE d.finalized_at >= CURRENT_DATE)::int AS finalized_today,
      COUNT(d.id) FILTER (
        WHERE d.exception_state = 'on_hold' AND d.finalized_at IS NULL
      )::int AS on_hold_count
    FROM demands d
    JOIN demand_types dt   ON dt.id   = d.demand_type_id
    JOIN departments  dept ON dept.id = dt.department_id
    ${where}
  `, params)

  // ── Demandas críticas (vencidas primeiro, depois mais próximas do prazo) ──
  const { rows: critical } = await query(`
    SELECT
      d.id, d.title, d.due_date,
      dept.name   AS department_name,
      ws.name     AS stage_name,
      u.name      AS assignee_name,
      ROUND(EXTRACT(EPOCH FROM (d.due_date - NOW())) / 3600, 1) AS hours_remaining
    FROM demands d
    JOIN demand_types    dt   ON dt.id   = d.demand_type_id
    JOIN departments     dept ON dept.id = dt.department_id
    LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
    LEFT JOIN users      u    ON u.id    = d.current_assignee_id
    WHERE d.finalized_at IS NULL
      AND (d.exception_state IS NULL OR d.exception_state <> 'cancelled')
      AND d.due_date IS NOT NULL
      AND d.due_date <= NOW() + INTERVAL '24 hours'
      ${andScope}
    ORDER BY d.due_date ASC
    LIMIT 8
  `, params)

  // ── Abertas por departamento ──────────────────────────────────────────────
  const { rows: byDepartment } = await query(`
    SELECT
      dept.name        AS dept_name,
      COUNT(d.id)::int AS count
    FROM demands d
    JOIN demand_types dt   ON dt.id   = d.demand_type_id
    JOIN departments  dept ON dept.id = dt.department_id
    WHERE d.finalized_at IS NULL
      AND (d.exception_state IS NULL OR d.exception_state <> 'cancelled')
      ${andScope}
    GROUP BY dept.id, dept.name
    ORDER BY count DESC
  `, params)

  // ── Últimas movimentações ─────────────────────────────────────────────────
  const { rows: recentActivity } = await query(`
    SELECT
      dh.id, dh.event_type, dh.entered_at,
      d.title     AS demand_title,
      dept.name   AS department_name,
      a.name      AS actor_name,
      ws.name     AS stage_name
    FROM demand_history dh
    JOIN demands      d    ON d.id    = dh.demand_id
    JOIN demand_types dt   ON dt.id   = d.demand_type_id
    JOIN departments  dept ON dept.id = dt.department_id
    LEFT JOIN users           a  ON a.id  = dh.actor_id
    LEFT JOIN workflow_stages ws ON ws.id = dh.stage_id
    ${where}
    ORDER BY dh.entered_at DESC
    LIMIT 10
  `, params)

  return {
    generated_at: new Date().toISOString(),
    kpis: {
      open_count:      kpis.open_count,
      critical_count:  kpis.critical_count,
      overdue_count:   kpis.overdue_count,
      created_today:   kpis.created_today,
      finalized_today: kpis.finalized_today,
      on_hold_count:   kpis.on_hold_count,
    },
    critical,
    by_department:   byDepartment,
    recent_activity: recentActivity,
  }
}

/**
 * Retorna linhas para exportação como CSV.
 * Colunas: id, título, departamento, tipo, etapa, responsável,
 *          solicitante, estado_exceção, criada_em, atualizada_em
 */
export async function getExportRows(actor, filters = {}) {
  const params     = []
  const conditions = []
  addScopeCondition(actor, params, conditions)
  addCommonFilters(actor, filters, params, conditions)
  const where = buildWhere(conditions)

  const { rows } = await query(`
    SELECT
      d.id,
      d.title,
      dept.name              AS department_name,
      dt.name                AS demand_type_name,
      COALESCE(ws.name, '')  AS current_stage_name,
      COALESCE(u_asgn.name, '') AS assignee_name,
      COALESCE(u_req.name,  '') AS requester_name,
      COALESCE(d.exception_state, '') AS exception_state,
      d.created_at,
      d.updated_at
    FROM demands d
    JOIN demand_types    dt    ON dt.id   = d.demand_type_id
    JOIN departments     dept  ON dept.id = dt.department_id
    LEFT JOIN workflow_stages ws    ON ws.id    = d.current_stage_id
    LEFT JOIN users      u_req  ON u_req.id  = d.requester_id
    LEFT JOIN users      u_asgn ON u_asgn.id = d.current_assignee_id
    ${where}
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 5000
  `, params)

  return rows
}

/**
 * Converte linhas para string CSV com header.
 */
export function rowsToCsv(rows) {
  if (!rows.length) return 'ID,Título,Departamento,Tipo,Etapa,Responsável,Solicitante,Exceção,Criada Em,Atualizada Em\n'

  const escape = v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }

  const header = ['ID','Título','Departamento','Tipo','Etapa','Responsável','Solicitante','Exceção','Criada Em','Atualizada Em']
  const lines  = rows.map(r => [
    r.id, r.title, r.department_name, r.demand_type_name,
    r.current_stage_name, r.assignee_name, r.requester_name,
    r.exception_state,
    new Date(r.created_at).toISOString(),
    new Date(r.updated_at).toISOString(),
  ].map(escape).join(','))

  return [header.join(','), ...lines].join('\n')
}

/**
 * Operacional por Departamento — agregado para relatórios.
 *
 * Mesma lógica de escopo e filtros de getStats (RBAC via addScopeCondition,
 * date_from/date_to via addCommonFilters). Retorna linhas por departamento
 * com total, finalizadas, taxa e em espera.
 */
export async function getOperationalByDepartment(actor, filters = {}) {
  const params     = []
  const conditions = []
  addScopeCondition(actor, params, conditions)
  addCommonFilters(actor, filters, params, conditions)
  const where = buildWhere(conditions)

  const { rows } = await query(`
    SELECT dept.name AS dept_name,
           COUNT(d.id)::int AS total,
           COUNT(d.id) FILTER (WHERE ws.is_final = true)::int AS finalized,
           ROUND(COUNT(d.id) FILTER (WHERE ws.is_final = true)::numeric
                 / NULLIF(COUNT(d.id),0) * 100, 1) AS finalization_rate,
           COUNT(d.id) FILTER (WHERE d.exception_state = 'on_hold')::int AS on_hold
    FROM demands d
    JOIN demand_types dt   ON dt.id   = d.demand_type_id
    JOIN departments  dept ON dept.id = dt.department_id
    LEFT JOIN workflow_stages ws ON ws.id = d.current_stage_id
    ${where}
    GROUP BY dept.id, dept.name
    ORDER BY total DESC
  `, params)

  return rows
}

/**
 * Dashboard Comercial — agregado por cliente (campanhas).
 *
 * Campanhas são globais (sem escopo de departamento). Filtra apenas:
 *   - archived_at IS NULL
 *   - date_from / date_to (sobreposição: starts_on <= date_to AND ends_on >= date_from)
 *
 * Retorna { by_client: [...] } com colunas:
 *   client_name, total_campaigns, distinct_assets, total_days,
 *   active_now, upcoming
 */
export async function getCommercialByClient(actor, filters = {}) {
  const params = []
  const conditions = ['c.archived_at IS NULL']

  if (filters.date_from) {
    params.push(filters.date_from)
    conditions.push(`c.ends_on >= $${params.length}::date`)
  }
  if (filters.date_to) {
    params.push(filters.date_to)
    conditions.push(`c.starts_on <= $${params.length}::date`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows } = await query(`
    SELECT
      c.client_name,
      COUNT(*)::int                                              AS total_campaigns,
      COUNT(DISTINCT c.asset_id)::int                            AS distinct_assets,
      SUM((c.ends_on - c.starts_on) + 1)::int                    AS total_days,
      COUNT(*) FILTER (WHERE CURRENT_DATE BETWEEN c.starts_on AND c.ends_on)::int AS active_now,
      COUNT(*) FILTER (WHERE c.starts_on > CURRENT_DATE)::int    AS upcoming
    FROM campaigns c
    ${where}
    GROUP BY c.client_name
    ORDER BY total_campaigns DESC, c.client_name ASC
  `, params)

  // Ocupação da rede (estado de HOJE — sem filtros de data)
  const { rows: [occ] } = await query(`
    SELECT
      COUNT(*)::int            AS total_assets,
      COUNT(active.asset_id)::int AS occupied_now
    FROM assets a
    LEFT JOIN (
      SELECT DISTINCT asset_id
      FROM campaigns
      WHERE archived_at IS NULL
        AND CURRENT_DATE BETWEEN starts_on AND ends_on
    ) active ON active.asset_id = a.id
    WHERE a.archived_at IS NULL
  `)

  const { rows: idleAssets } = await query(`
    SELECT a.id, a.code, a.name, a.asset_type, a.city
    FROM assets a
    WHERE a.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM campaigns c
        WHERE c.asset_id = a.id
          AND c.archived_at IS NULL
          AND CURRENT_DATE BETWEEN c.starts_on AND c.ends_on
      )
    ORDER BY a.city NULLS LAST, a.name
    LIMIT 100
  `)

  const totalAssets  = Number(occ.total_assets ?? 0)
  const occupiedNow  = Number(occ.occupied_now ?? 0)
  return {
    by_client: rows,
    occupancy: {
      total_assets:   totalAssets,
      occupied_now:   occupiedNow,
      idle_now:       totalAssets - occupiedNow,
      occupancy_rate: totalAssets > 0 ? Math.round((occupiedNow / totalAssets) * 1000) / 10 : 0,
      idle_assets:    idleAssets,
    },
  }
}
