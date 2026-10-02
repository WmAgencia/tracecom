import { useState, useMemo } from 'react'

const ASSET_STATES = {
  operating: { label: 'Operando', color: 'green', icon: '🟢' },
  noCandle: { label: 'Sem candle', color: 'yellow', icon: '🟡' },
  banned: { label: 'Banido/Suspenso', color: 'red', icon: '🔴' },
  offline: { label: 'Offline', color: 'gray', icon: '⚫' },
}

export default function AssetMap({ assetState, config }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState(null)

  const whitelist = config?.whitelist || []
  const reserve = config?.reserve || []
  const allAssets = [...whitelist, ...reserve]

  const assets = useMemo(() => {
    return allAssets.map(asset => {
      const key = Object.keys(asset)[0]
      const info = asset[key]
      const state = assetState?.[key] || { status: 'operating', direction: info.direction || 'CALL', rsi: null, adx: null }
      return {
        key,
        name: key,
        direction: state.direction || info.direction || 'CALL',
        status: state.status || 'operating',
        rsi: state.rsi,
        adx: state.adx,
        regime: state.regime,
        wr: info.wr,
        isTop: whitelist.indexOf(asset) < 10,
      }
    }).filter(a => {
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'all') return true
      return a.status === filter
    })
  }, [allAssets, assetState, search, filter])

  const counts = useMemo(() => {
    const c = { operating: 0, noCandle: 0, banned: 0, offline: 0 }
    allAssets.forEach(asset => {
      const key = Object.keys(asset)[0]
      const state = assetState?.[key]
      const status = state?.status || 'operating'
      if (c[status] !== undefined) c[status]++
      else c.operating++
    })
    return c
  }, [allAssets, assetState])

  return (
    <div className="space-y-4">
      {/* Filtros e contadores */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          {/* Busca */}
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar ativo..."
              className="input-field w-full pl-8"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary">🔍</span>
          </div>

          {/* Contadores */}
          <div className="flex gap-2">
            {Object.entries(ASSET_STATES).map(([key, s]) => (
              <button
                key={key}
                onClick={() => setFilter(filter === key ? 'all' : key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all border ${
                  filter === key
                    ? `border-${s.color === 'green' ? 'accent-green' : s.color === 'yellow' ? 'accent-yellow' : s.color === 'red' ? 'accent-red' : 'text-secondary'}/30 bg-${s.color === 'green' ? 'accent-green' : s.color === 'yellow' ? 'accent-yellow' : s.color === 'red' ? 'accent-red' : 'text-secondary'}/10`
                    : 'border-border text-text-secondary hover:border-accent-cyan/30'
                }`}
              >
                {s.icon} {counts[key] || 0}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid de ativos */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-secondary">
            Universo de Ativos
            <span className="ml-2 text-xs">({assets.length} mostrados / {allAssets.length} total)</span>
          </h3>
        </div>

        {assets.length === 0 ? (
          <div className="text-center py-12 text-text-secondary">
            <div className="text-4xl mb-2">🗺️</div>
            <p>Nenhum ativo encontrado</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
            {assets.map(asset => (
              <AssetChip
                key={asset.key}
                asset={asset}
                onClick={() => setSelectedAsset(asset)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de detalhes */}
      {selectedAsset && (
        <AssetModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  )
}

function AssetChip({ asset, onClick }) {
  const stateColors = {
    operating: 'bg-accent-green/10 border-accent-green/30 text-accent-green hover:bg-accent-green/20',
    noCandle: 'bg-accent-yellow/10 border-accent-yellow/30 text-accent-yellow hover:bg-accent-yellow/20',
    banned: 'bg-accent-red/10 border-accent-red/30 text-accent-red hover:bg-accent-red/20',
    offline: 'bg-bg-alt border-border text-text-secondary',
  }

  const trendIcon = asset.direction === 'CALL' ? '▲' : asset.direction === 'PUT' ? '▼' : '➖'
  const trendColor = asset.direction === 'CALL' ? 'text-accent-green' : asset.direction === 'PUT' ? 'text-accent-red' : 'text-text-secondary'

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center p-2 rounded-lg border text-xs transition-all hover:scale-105 ${stateColors[asset.status] || stateColors.offline}`}
      title={`${asset.name}\nDireção: ${asset.direction}\nRSI: ${asset.rsi ?? '?'}\nADX: ${asset.adx ?? '?'}\nStatus: ${asset.status}`}
    >
      {asset.isTop && <span className="absolute -top-1 -right-1 text-[8px]">⭐</span>}
      <span className="font-mono font-bold">{asset.name.replace('USD', '')}</span>
      <span className={`text-xs ${trendColor}`}>{trendIcon}</span>
    </button>
  )
}

function AssetModal({ asset, onClose }) {
  const state = ASSET_STATES[asset.status] || ASSET_STATES.offline

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card max-w-md w-full mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold font-mono text-text-primary">
            {asset.name}
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-xl">✕</button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-text-secondary">Status</span>
            <span className={`badge ${
              asset.status === 'operating' ? 'badge-green' :
              asset.status === 'noCandle' ? 'badge-yellow' : 'badge-red'
            }`}>
              {state.icon} {state.label}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-text-secondary">Direção</span>
            <span className={`font-mono font-bold ${
              asset.direction === 'CALL' ? 'text-accent-green' : 'text-accent-red'
            }`}>
              {asset.direction === 'CALL' ? '▲ CALL' : asset.direction === 'PUT' ? '▼ PUT' : '➖ ?'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-text-secondary">RSI (14)</span>
            <span className={`font-mono font-bold ${
              asset.rsi !== null
                ? (asset.rsi > 55 ? 'text-accent-red' : asset.rsi < 45 ? 'text-accent-green' : 'text-accent-yellow')
                : 'text-text-secondary'
            }`}>
              {asset.rsi !== null ? asset.rsi.toFixed(1) : '?'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-text-secondary">ADX</span>
            <span className={`font-mono font-bold ${
              asset.adx !== null
                ? (asset.adx >= 20 ? 'text-accent-green' : 'text-accent-yellow')
                : 'text-text-secondary'
            }`}>
              {asset.adx !== null ? asset.adx.toFixed(1) : '?'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-sm text-text-secondary">Regime</span>
            <span className="font-mono text-text-secondary">
              {asset.regime || '?'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-text-secondary">Win Rate (histórico)</span>
            <span className="font-mono font-bold text-accent-cyan">
              {asset.wr !== null && asset.wr !== undefined ? `${asset.wr}%` : '?'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
