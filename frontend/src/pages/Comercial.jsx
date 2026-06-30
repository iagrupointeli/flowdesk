import { useEffect, useState } from 'react'
import { useComercialStore } from '../stores/comercialStore'

export default function Comercial() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  const byClient    = useComercialStore(s => s.byClient)
  const occupancy   = useComercialStore(s => s.occupancy)
  const isLoading   = useComercialStore(s => s.isLoading)
  const error       = useComercialStore(s => s.error)

  useEffect(() => {
    useComercialStore.getState().fetch({
      date_from: dateFrom || undefined,
      date_to:   dateTo   || undefined,
    })
  }, [dateFrom, dateTo])

  useEffect(() => {
    return () => useComercialStore.getState().reset()
  }, [])

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">

      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Comercial</h1>
        <p className="mt-0.5 text-sm text-gray-500">Gestão de ocupação e carteira por cliente</p>
      </div>

      {/* Filtros de data */}
      <div className="flex flex-wrap items-end gap-3">
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
        <p className="text-xs text-gray-400">Filtros aplicam-se à Carteira por Cliente</p>
      </div>

      {/* Loading */}
      {isLoading && !occupancy && <ComercialSkeleton />}

      {/* Erro */}
      {!isLoading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-semibold text-red-700">Erro ao carregar dados comerciais</p>
          <p className="mt-1 text-sm text-red-500">{error}</p>
          <button
            onClick={() => useComercialStore.getState().fetch({ date_from: dateFrom || undefined, date_to: dateTo || undefined })}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* KPI Cards de Occupancy */}
      {occupancy && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              label="Pontos"
              value={occupancy.total_assets}
              icon={<IconPin className="h-5 w-5" />}
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
            />
            <KpiCard
              label="Ocupados"
              value={occupancy.occupied_now}
              icon={<IconCheck className="h-5 w-5" />}
              iconBg="bg-green-100"
              iconColor="text-green-600"
            />
            <KpiCard
              label="Ociosos"
              value={occupancy.idle_now}
              icon={<IconPause className="h-5 w-5" />}
              iconBg={occupancy.idle_now > 0 ? 'bg-amber-100' : 'bg-gray-100'}
              iconColor={occupancy.idle_now > 0 ? 'text-amber-600' : 'text-gray-500'}
              highlight={occupancy.idle_now > 0}
              subtitle="hoje"
            />
            <KpiCard
              label="Taxa de Ocupação"
              value={`${(occupancy.occupancy_rate ?? 0).toFixed(1)}%`}
              icon={<IconChart className="h-5 w-5" />}
              iconBg="bg-purple-100"
              iconColor="text-purple-600"
            />
          </div>

          {/* Pontos Ociosos */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-700">
              Pontos Ociosos {occupancy.idle_assets?.length > 0 && `(${occupancy.idle_assets.length})`}
            </h2>
            {occupancy.idle_assets && occupancy.idle_assets.length === 0 ? (
              <div className="flex h-24 items-center justify-center rounded-lg bg-green-50">
                <p className="text-sm font-medium text-green-700">Todos os pontos ocupados</p>
              </div>
            ) : occupancy.idle_assets ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Código</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Nome</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Tipo</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Cidade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {occupancy.idle_assets.map(asset => (
                      <tr key={asset.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{asset.code}</td>
                        <td className="px-4 py-2 text-sm text-gray-700">{asset.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{asset.asset_type}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{asset.city}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      )}

      {/* Carteira por Cliente */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">
          Carteira por Cliente {byClient.length > 0 && `(${byClient.length})`}
        </h2>
        {byClient.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <p className="text-sm text-gray-400">Nenhum cliente no período selecionado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Cliente</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Campanhas</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Pontos</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Dias</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Ativas</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">Futuras</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {byClient.map(client => (
                  <tr key={client.client_name} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">{client.client_name}</td>
                    <td className="px-4 py-2 text-center text-sm text-gray-700">{client.total_campaigns}</td>
                    <td className="px-4 py-2 text-center text-sm text-gray-700">{client.distinct_assets}</td>
                    <td className="px-4 py-2 text-center text-sm text-gray-700">{client.total_days}</td>
                    <td className="px-4 py-2 text-center text-sm text-gray-700">{client.active_now}</td>
                    <td className="px-4 py-2 text-center text-sm text-gray-700">{client.upcoming}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, iconBg, iconColor, highlight = false, subtitle }) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${highlight ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
        </div>
        <div className={`flex-shrink-0 rounded-lg p-2 ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
    </div>
  )
}

function ComercialSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-28 rounded-xl bg-gray-100" />
        ))}
      </div>
      <div className="h-48 rounded-xl bg-gray-100" />
      <div className="h-64 rounded-xl bg-gray-100" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ícones SVG
// ─────────────────────────────────────────────────────────────────────────────

function IconPin({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
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

function IconPause({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
    </svg>
  )
}

function IconChart({ className }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 003 0v-13A1.5 1.5 0 0015.5 2zM9.5 6A1.5 1.5 0 008 7.5v9a1.5 1.5 0 003 0v-9A1.5 1.5 0 009.5 6zM3.5 10A1.5 1.5 0 002 11.5v5a1.5 1.5 0 003 0v-5A1.5 1.5 0 003.5 10z" />
    </svg>
  )
}