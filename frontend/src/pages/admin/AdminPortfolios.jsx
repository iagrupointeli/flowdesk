import { useEffect, useState } from 'react'
import api from '../../lib/api'

export default function AdminPortfolios() {
  const [portfolios, setPortfolios] = useState([])
  const [q,          setQ]          = useState('')
  const [selected,   setSelected]   = useState(null)
  const [detail,     setDetail]     = useState([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/portfolios', { params: { q } })
      .then(r => setPortfolios(r.data))
      .finally(() => setLoading(false))
  }, [q])

  useEffect(() => {
    if (!selected) { setDetail([]); return }
    api.get(`/portfolios/${encodeURIComponent(selected)}`)
       .then(r => setDetail(r.data))
  }, [selected])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Portfólios de Clientes</h1>

      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Filtrar por cliente..."
        className="mb-4 w-full max-w-sm rounded-lg border px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
      />

      {loading ? (
        <p className="text-sm text-gray-400">Carregando...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {portfolios.map(p => (
            <button
              key={p.client_name}
              onClick={() => setSelected(selected === p.client_name ? null : p.client_name)}
              className={`text-left rounded-xl border p-4 transition-colors ${
                selected === p.client_name
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <p className="font-semibold text-gray-900 text-sm">{p.client_name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {p.campaign_count} campanha{p.campaign_count !== 1 ? 's' : ''} ·{' '}
                {p.asset_count} ponto{p.asset_count !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {p.earliest_start} → {p.latest_end}
              </p>
              {p.asset_codes?.length > 0 && (
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {p.asset_codes.join(' · ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && detail.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">
            Campanhas — {selected}
          </h2>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Campanha</th>
                  <th className="px-4 py-2 text-left">Ponto</th>
                  <th className="px-4 py-2 text-left">Período</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {detail.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{c.title}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {c.asset_code && <span className="font-mono text-xs">[{c.asset_code}] </span>}
                      {c.asset_name}
                    </td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {c.starts_on} → {c.ends_on}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {portfolios.length === 0 && !loading && (
        <p className="text-sm text-gray-400 mt-4">Nenhum cliente encontrado.</p>
      )}
    </div>
  )
}
