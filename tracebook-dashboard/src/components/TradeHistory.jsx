import { useState, useMemo, useCallback } from 'react'

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'win', label: 'Wins' },
  { id: 'loss', label: 'Losses' },
]

const DIRECTION_FILTERS = [
  { id: 'all', label: 'Direção' },
  { id: 'CALL', label: 'CALL ▲' },
  { id: 'PUT', label: 'PUT ▼' },
]

export default function TradeHistory({ trades, config }) {
  const [search, setSearch] = useState('')
  const [resultFilter, setResultFilter] = useState('all')
  const [directionFilter, setDirectionFilter] = useState('all')
  const [sortBy, setSortBy] = useState('time')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  const baseStake = config?.trading?.baseStake || 2

  const filteredTrades = useMemo(() => {
    if (!trades || trades.length === 0) return []

    let result = [...trades]

    // Busca
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(t => (t.asset || '').toLowerCase().includes(q))
    }

    // Filtro resultado
    if (resultFilter !== 'all') {
      result = result.filter(t => t.result === resultFilter)
    }

    // Filtro direção
    if (directionFilter !== 'all') {
      result = result.filter(t => t.direction === directionFilter)
    }

    // Ordenação
    result.sort((a, b) => {
      let aVal = a[sortBy] || 0
      let bVal = b[sortBy] || 0
      if (sortBy === 'time') {
        aVal = new Date(a.time || 0).getTime()
        bVal = new Date(b.time || 0).getTime()
      }
      if (sortDir === 'asc') return aVal > bVal ? 1 : -1
      return aVal < bVal ? 1 : -1
    })

    return result
  }, [trades, search, resultFilter, directionFilter, sortBy, sortDir])

  const paginatedTrades = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredTrades.slice(start, start + PAGE_SIZE)
  }, [filteredTrades, page])

  const totalPages = Math.ceil(filteredTrades.length / PAGE_SIZE)

  const handleSort = useCallback((col) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(1)
  }, [sortBy])

  const exportCSV = useCallback(() => {
    if (!filteredTrades.length) return
    const headers = ['Hora', 'Ativo', 'Direção', 'Resultado', 'Stake', 'P/L', 'Tipo', 'Motivo']
    const rows = filteredTrades.map(t => [
      t.time || '',
      t.asset || '',
      t.direction || '',
      t.result || '',
      baseStake.toFixed(2),
      t.result === 'win' ? `+${(t.pnl || baseStake * 0.82).toFixed(2)}` : `-${baseStake.toFixed(2)}`,
      t.type || 'entrada',
      t.reason || '',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trades-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredTrades, baseStake])

  const formatTime = (time) => {
    if (!time) return '--:--:--'
    const d = new Date(time)
    return d.toLocaleTimeString('pt-BR')
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          {/* Busca */}
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Buscar por ativo..."
              className="input-field w-full pl-8"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary">🔍</span>
          </div>

          {/* Filtro resultado */}
          <div className="flex gap-1 bg-bg-alt rounded-lg p-1">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => { setResultFilter(f.id); setPage(1) }}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  resultFilter === f.id
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Filtro direção */}
          <select
            value={directionFilter}
            onChange={e => { setDirectionFilter(e.target.value); setPage(1) }}
            className="input-field text-sm"
          >
            {DIRECTION_FILTERS.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          {/* Exportar */}
          <button onClick={exportCSV} className="btn-primary text-xs">
            📥 CSV
          </button>

          {/* Contador */}
          <div className="text-sm text-text-secondary">
            {filteredTrades.length} operações
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs uppercase tracking-wider border-b border-border">
              {[
                { key: 'time', label: 'Hora' },
                { key: 'asset', label: 'Ativo' },
                { key: 'direction', label: 'D' },
                { key: 'result', label: 'Result' },
                { key: 'stake', label: 'Stake' },
                { key: 'pnl', label: 'P/L' },
                { key: 'type', label: 'Tipo' },
                { key: 'reason', label: 'Motivo' },
              ].map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2 text-left cursor-pointer hover:text-accent-cyan transition-colors"
                >
                  {col.label}
                  {sortBy === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-text-secondary">
                  <div className="text-4xl mb-2">📋</div>
                  <p>Nenhuma operação encontrada</p>
                </td>
              </tr>
            ) : (
              paginatedTrades.map((trade, i) => (
                <tr key={trade.id || i} className="table-row animate-slide-in">
                  <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                    {formatTime(trade.time)}
                  </td>
                  <td className="px-3 py-2 font-mono font-medium">
                    {trade.asset || '???'}
                  </td>
                  <td className="px-3 py-2">
                    <DirectionBadge direction={trade.direction} />
                  </td>
                  <td className="px-3 py-2">
                    <ResultBadge result={trade.result} />
                  </td>
                  <td className="px-3 py-2 font-mono text-text-secondary">
                    R${baseStake.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 font-mono font-bold">
                    {trade.result === 'win'
                      ? <span className="text-accent-green">+R${((trade.pnl || baseStake * 0.82)).toFixed(2)}</span>
                      : trade.result === 'loss'
                        ? <span className="text-accent-red">-R${baseStake.toFixed(2)}</span>
                        : <span className="text-text-secondary">--</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <span className="badge bg-bg-alt text-text-secondary text-xs">
                      {trade.type || 'entrada'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {trade.reason || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <div className="text-xs text-text-secondary">
              Página {page} de {totalPages}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-primary text-xs px-3 disabled:opacity-30"
              >
                ◀
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (page <= 3) {
                  pageNum = i + 1
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = page - 2 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      page === pageNum
                        ? 'bg-accent-cyan/20 text-accent-cyan'
                        : 'bg-bg-alt text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {pageNum}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-primary text-xs px-3 disabled:opacity-30"
              >
                ▶
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DirectionBadge({ direction }) {
  const isCall = direction === 'CALL'
  return (
    <span className={`badge ${isCall ? 'badge-green' : 'badge-red'}`}>
      {isCall ? '▲' : '▼'} {direction}
    </span>
  )
}

function ResultBadge({ result }) {
  if (result === 'win') {
    return <span className="badge badge-green">WIN</span>
  }
  if (result === 'loss') {
    return <span className="badge badge-red">LOSS</span>
  }
  return <span className="badge bg-bg-alt text-text-secondary">OPEN</span>
}
