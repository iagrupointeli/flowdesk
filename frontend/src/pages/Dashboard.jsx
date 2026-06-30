import { useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardStore }  from '../stores/dashboardStore'
import { useDemandTypeStore } from '../stores/demandTypeStore'
import api from '../lib/api'

/**
 * Página de Dashboard de Métricas — /dashboard
 *
 * Restrita a super_admin e dept_admin (protegida via ProtectedRoute + redirect
 * do AppLayout; o backend também bloqueia com authorize middleware).
 *
 * ── Layout ────────────────────────────────────────────────────────────────────
 *
 *   Barra de filtros: [Dpto▾] [De: date] [Até: date]     [Exportar CSV]
 *   ┌────────┬────────┬────────────┬──────────────────────┐
 *   │ Total  │ Espera │ % Final    │ Tempo Médio (h)      │  ← KPI cards
 *   └────────┴────────┴────────────┴──────────────────────┘
 *   ┌──────────────────────┬───────────────────────────────┐
 *   │ Demandas por Etapa   │ Demandas por Departamento     │  ← gráficos
 *   └──────────────────────┴───────────────────────────────┘
 *
 * ── Gráficos ─────────────────────────────────────────────────────────────────
 *
 * Barras horizontais em SVG puro + Tailwind inline.
 * Zero dependências de charting (recharts, chart.js, etc).
 * Cada barra é normalizada para [4%, 100%] em relação ao valor máximo do conjunto.
 *
 * ── Exportação CSV ───────────────────────────────────────────────────────────
 *
 * GET /api/dashboard/export com os mesmos filtros.
 * Resposta: blob CSV com Content-Disposition:attachment.
 * Fluxo: fetch → Blob → URL.createObjectURL → <a download> programático → revoke.
 * O token Bearer é enviado via interceptor Axios — não é uma navegação direta.
 *
 * ── Filtros ───────────────────────────────────────────────────────────────────
 *
 * Departamento: derivado de demandTypeStore (já carregado pelo AppLayout).
 * Datas: inputs type="date" controlados.
 * Qualquer mudança de filtro → store.fetch(filters) via useEffect.
 */
export default function Dashboard() {
  // ── Filtros locais ─────────────────────────────────────────────────────────
  const [deptId,    setDeptId]    = useState('')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [exporting, setExporting] = useState(false)
  const [pdfMonth,      setPdfMonth]      = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [pdfYear,       setPdfYear]       = useState(() => String(new Date().getFullYear()))
  const [exportingPdf,  setExportingPdf]  = useState(false)
  const [idle,          setIdle]          = useState(null)  // null | { total, by_city, assets }

  // ── Store ──────────────────────────────────────────────────────────────────
  const metrics   = useDashboardStore(s => s.metrics)
  const charts    = useDashboardStore(s => s.charts)
  const isLoading = useDashboardStore(s => s.isLoading)
  const error     = useDashboardStore(s => s.error)

  // Departamentos derivados do demandTypeStore (já populado pelo AppLayout)
  const demandTypes = useDemandTypeStore(s => s.demandTypes)
  const departments = useMemo(() => {
    const map = new Map()
    for (const dt of demandTypes) {
      if (dt.department_id && !map.has(dt.department_id)) {
        map.set(dt.department_id, dt.department_name ?? dt.department_id)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [demandTypes])

  // ── Fetch ao montar e ao mudar filtros ────────────────────────────────────
  useEffect(() => {
    useDashboardStore.getState().fetch({
      dept_id:   deptId   || undefined,
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
    })
  }, [deptId, dateFrom, dateTo])

  // ── Cleanup ao desmontar ──────────────────────────────────────────────────
  useEffect(() => {
    return () => useDashboardStore.getState().reset()
  }, [])

  // ── Ativos ociosos ────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/assets/idle', { params: { horizon_days: 30 } })
      .then(r => setIdle(r.data))
      .catch(() => {})
  }, [])

  // ── Exportar CSV ──────────────────────────────────────────────────────────
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const params = {}
      if (deptId)   params.dept_id   = deptId
      if (dateFrom) params.date_from = dateFrom
      if (dateTo)   params.date_to   = dateTo

      const response = await api.get('/dashboard/export', {
        params,
        responseType: 'blob',
      })

      const blob     = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url      = URL.createObjectURL(blob)
      const link     = document.createElement('a')
      const filename = `relatorio-${new Date().toISOString().slice(0, 10)}.csv`
      link.href      = url
      link.download  = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      // revokeObjectURL APÓS o click: o download é assíncrono — revogar
      // sincronicamente cancelaria o blob antes de o browser iniciar a
      // transferência. 100ms é suficiente para o browser capturar a URL.
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch (err) {
      console.error('[Dashboard] exportar CSV falhou:', err)
      alert('Não foi possível gerar o relatório. Tente novamente.')
    } finally {
      setExporting(false)
    }
  }

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
      link.href     = url
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">

      {/* ── Cabeçalho + barra de filtros ─────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-gray-500">Métricas consolidadas das demandas</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Filtro de departamento */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Departamento</label>
            <select
              value={deptId}
              onChange={e => setDeptId(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                         text-gray-700 focus:border-primary-500 focus:outline-none
                         focus:ring-1 focus:ring-primary-400"
            >
              <option value="">Todos</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Data inicial */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">De</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                         text-gray-700 focus:border-primary-500 focus:outline-none
                         focus:ring-1 focus:ring-primary-400"
            />
          </div>

          {/* Data final */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Até</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                         text-gray-700 focus:border-primary-500 focus:outline-none
                         focus:ring-1 focus:ring-primary-400"
            />
          </div>

          {/* Seletores mês/ano + botão PDF */}
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

          {/* Exportar CSV */}
          <button
            onClick={handleExport}
            disabled={exporting || isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2
                       text-sm font-semibold text-white transition-colors
                       hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <IconDownload className="h-4 w-4" />
            )}
            Exportar Relatório (CSV)
          </button>
        </div>
      </div>

      {/* ── Loading ───────────────────────────────────────────────────────── */}
      {isLoading && !metrics && <DashboardSkeleton />}

      {/* ── Erro ─────────────────────────────────────────────────────────── */}
      {!isLoading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-semibold text-red-700">Erro ao carregar o dashboard</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
          <button
            onClick={() => useDashboardStore.getState().fetch({ dept_id: deptId || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined })}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      {metrics && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            label="Total de Demandas"
            value={metrics.total_demands}
            icon={<IconList className="h-5 w-5" />}
            iconBg="bg-blue-100"
            iconColor="text-blue-600"
          />
          <KpiCard
            label="Em Espera (Bloqueadas)"
            value={metrics.on_hold_count}
            icon={<IconPause className="h-5 w-5" />}
            iconBg="bg-amber-100"
            iconColor="text-amber-600"
            highlight={metrics.on_hold_count > 0}
          />
          <KpiCard
            label="Taxa de Finalização"
            value={`${metrics.finalization_rate ?? 0}%`}
            sub={`${metrics.finalized_count} finalizadas`}
            icon={<IconCheck className="h-5 w-5" />}
            iconBg="bg-green-100"
            iconColor="text-green-600"
          />
          <KpiCard
            label="Tempo Médio de Resolução"
            value={metrics.avg_resolution_hours != null
              ? formatHours(metrics.avg_resolution_hours)
              : '—'}
            sub="entre abertura e conclusão"
            icon={<IconClock className="h-5 w-5" />}
            iconBg="bg-purple-100"
            iconColor="text-purple-600"
          />
        </div>
      )}

      {/* ── Ativos Ociosos ────────────────────────────────────────────────── */}
      {idle && idle.total > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-orange-800">
                {idle.total} ativo{idle.total !== 1 ? 's' : ''} ocioso{idle.total !== 1 ? 's' : ''} nos próximos 30 dias
              </p>
              <p className="mt-1 text-xs text-orange-600">
                {idle.by_city.slice(0, 5).map(({ city, count }) => `${city} (${count})`).join(' · ')}
                {idle.by_city.length > 5 && ` · +${idle.by_city.length - 5} cidades`}
              </p>
            </div>
            <a href="/admin/assets"
               className="flex-shrink-0 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-50">
              Ver pontos →
            </a>
          </div>
        </div>
      )}

      {/* ── Gráficos ──────────────────────────────────────────────────────── */}
      {charts && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Demandas por Etapa">
            {charts.by_stage.length === 0
              ? <EmptyChart />
              : <BarChart
                  data={charts.by_stage.map(r => ({ label: r.stage_name, count: r.count }))}
                  colorClass="bg-blue-500"
                />
            }
          </ChartCard>

          <ChartCard title="Demandas por Departamento">
            {charts.by_department.length === 0
              ? <EmptyChart />
              : <BarChart
                  data={charts.by_department.map(r => ({ label: r.dept_name, count: r.count }))}
                  colorClass="bg-primary-500"
                />
            }
          </ChartCard>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, iconBg, iconColor, highlight = false }) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${highlight ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
        </div>
        <div className={`flex-shrink-0 rounded-lg p-2 ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">{title}</h2>
      {children}
    </div>
  )
}

/**
 * Gráfico de barras horizontais — SVG-free, estilizado com Tailwind.
 * Cada barra é normalizada para max=100%; mínimo de 4% para visibilidade.
 */
function BarChart({ data, colorClass }) {
  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <div className="space-y-3">
      {data.map((item, i) => {
        const pct = Math.max((item.count / maxCount) * 100, item.count > 0 ? 4 : 0)
        return (
          <div key={i} className="flex items-center gap-3">
            <span
              className="w-28 flex-shrink-0 truncate text-right text-xs text-gray-500"
              title={item.label}
            >
              {item.label}
            </span>
            <div className="relative flex-1 overflow-hidden rounded-full bg-gray-100 h-6">
              <div
                className={`${colorClass} h-6 rounded-full transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
              <span className="absolute inset-0 flex items-center px-2.5 text-xs font-semibold text-white mix-blend-difference">
                {item.count}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex h-24 items-center justify-center text-sm text-gray-400">
      Sem dados para o período selecionado
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-28 rounded-xl bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-xl bg-gray-100" />
        <div className="h-64 rounded-xl bg-gray-100" />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatHours(hours) {
  if (hours == null) return '—'
  if (hours < 24) return `${hours}h`
  const days = (hours / 24).toFixed(1)
  return `${days}d`
}

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────────

function IconDownload({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  )
}

function IconList({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z" clipRule="evenodd" />
    </svg>
  )
}

function IconPause({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
    </svg>
  )
}

function IconCheck({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
    </svg>
  )
}

function IconClock({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
    </svg>
  )
}
