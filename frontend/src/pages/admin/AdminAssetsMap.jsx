import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import api from '../../lib/api'

/**
 * Mapa de Inventário — /admin/map
 *
 * Visão geoespacial dos pontos OOH. Restrito a super_admin (ferramenta de
 * análise/estratégia — RBAC validado no backend em GET /assets/map).
 *
 * CircleMarker (canvas) em vez de Marker padrão: mais leve pra milhares de
 * pontos e evita o bug clássico de ícone quebrado do Leaflet com bundlers.
 */

const TYPE_LABELS = {
  painel: 'Painel', empena: 'Empena', led: 'LED', lona: 'Lona',
  outdoor: 'Outdoor', mub: 'MUB', outro: 'Outro',
}
const TYPE_COLORS = {
  painel: '#2563eb', empena: '#7c3aed', led: '#f59e0b', lona: '#10b981',
  outdoor: '#ef4444', mub: '#0891b2', outro: '#6b7280',
}

const SC_CENTER = [-27.4, -49.8]
const SC_ZOOM   = 8

export default function AdminAssetsMap() {
  const [points,     setPoints]     = useState([])
  const [isLoading,  setIsLoading]  = useState(true)
  const [error,      setError]      = useState(null)
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    setIsLoading(true)
    setError(null)
    const params = {}
    if (typeFilter) params.asset_type = typeFilter

    api.get('/assets/map', { params, signal: ctrl.signal })
      .then(res => setPoints(res.data))
      .catch(err => {
        if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
          setError('Falha ao carregar o mapa de pontos.')
        }
      })
      .finally(() => setIsLoading(false))

    return () => ctrl.abort()
  }, [typeFilter])

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Mapa de Inventário</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {isLoading ? 'Carregando…' : `${points.length.toLocaleString('pt-BR')} ponto(s) georreferenciado(s)`}
          </p>
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                     focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Mapa — isolate cria stacking context própria: o z-index interno do
          Leaflet (até 1000 em controles/panes) fica contido aqui dentro e
          não vaza por cima dos dropdowns do Header. */}
      <div className="relative isolate z-0 flex-1">
        {isLoading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/60">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
          </div>
        )}
        <MapContainer center={SC_CENTER} zoom={SC_ZOOM} preferCanvas className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map(p => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={5}
              pathOptions={{
                color:       TYPE_COLORS[p.asset_type] ?? '#6b7280',
                fillColor:   TYPE_COLORS[p.asset_type] ?? '#6b7280',
                fillOpacity: 0.7,
                weight:      1,
              }}
            >
              <Popup>
                <div className="min-w-[180px] text-sm">
                  {p.photo_url && (
                    <img
                      src={p.photo_url}
                      alt=""
                      loading="lazy"
                      className="mb-2 h-20 w-full rounded object-cover bg-gray-50"
                    />
                  )}
                  <p className="font-mono text-xs text-gray-500">{p.code ?? '—'}</p>
                  <p className="font-semibold text-gray-900">{p.name}</p>
                  <p className="text-gray-600">
                    {TYPE_LABELS[p.asset_type] ?? p.asset_type}
                    {p.city ? ` · ${p.city}` : ''}
                  </p>
                  {p.dimensions && <p className="text-gray-500">{p.dimensions}</p>}
                  {p.is_premium && (
                    <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      ⭐ Premium
                    </span>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
