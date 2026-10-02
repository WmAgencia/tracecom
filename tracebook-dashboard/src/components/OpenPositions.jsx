export default function OpenPositions({ positions, onSell, addToast }) {
  if (!positions || positions.length === 0) {
    return (
      <div className="card">
        <h3 className="text-sm font-semibold text-text-secondary mb-4">Operações Abertas</h3>
        <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
          <span className="text-4xl mb-3">📭</span>
          <p className="text-sm">Nenhuma operação aberta</p>
        </div>
      </div>
    )
  }

  async function handleSell(optionId) {
    if (!confirm('Vender esta posição agora?')) return
    try {
      await onSell(optionId)
      addToast('Venda solicitada', 'info')
    } catch (e) {
      addToast('Erro ao vender', 'error')
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-secondary">
          Operações Abertas
          <span className="ml-2 badge badge-cyan">{positions.length}</span>
        </h3>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {positions.map((pos, i) => (
          <OpenPositionRow key={pos.id || i} pos={pos} onSell={handleSell} />
        ))}
      </div>
    </div>
  )
}

function OpenPositionRow({ pos, onSell }) {
  const direction = pos.direction || 'CALL'
  const isCall = direction === 'CALL'
  const sellProfit = pos.sellProfit || 0
  const remainingMs = pos.expiresAt ? Math.max(0, pos.expiresAt - Date.now()) : 0
  const remainingPct = pos.totalMs ? Math.max(0, Math.min(100, (remainingMs / pos.totalMs) * 100)) : 100
  const remainingTime = formatTime(remainingMs)
  const isWinning = sellProfit > 0
  const isLosing = sellProfit < 0
  const pyramidBadge = pos.pyramidCount > 1 && (
    <span className="badge badge-yellow ml-1">×{pos.pyramidCount}</span>
  )

  return (
    <div className={`bg-bg-alt rounded-lg p-3 border ${
      isWinning ? 'border-accent-green/30' : isLosing ? 'border-accent-red/30' : 'border-border'
    }`}>
      <div className="flex items-center justify-between gap-2">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold font-mono ${
              isCall ? 'text-accent-green' : 'text-accent-red'
            }`}>
              {isCall ? '▲' : '▼'} {pos.asset || 'UNKNOWN'}
            </span>
            <span className="text-xs text-text-secondary font-mono">R${pos.stake?.toFixed(2) || '2.00'}</span>
            {pyramidBadge}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            ⏱ {remainingTime} restante
          </div>
        </div>

        {/* Cotação */}
        <div className="text-right">
          <div className={`text-sm font-bold font-mono ${
            isWinning ? 'text-accent-green' : isLosing ? 'text-accent-red' : 'text-text-secondary'
          }`}>
            {isWinning ? '+' : ''}R${sellProfit.toFixed(2)}
          </div>
          <div className={`text-xs font-mono ${
            isWinning ? 'text-accent-green/60' : isLosing ? 'text-accent-red/60' : 'text-text-secondary'
          }`}>
            {pos.quote ? `cot: ${pos.quote}` : ''}
          </div>
        </div>

        {/* Botão vender */}
        <button
          onClick={() => onSell(pos.id)}
          className="btn-danger text-xs px-2 py-1"
        >
          Vender
        </button>
      </div>

      {/* Barra de progresso */}
      <div className="mt-2 h-1 bg-bg-primary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isCall ? 'bg-accent-green' : 'bg-accent-red'
          }`}
          style={{ width: `${remainingPct}%` }}
        />
      </div>
    </div>
  )
}

function formatTime(ms) {
  if (ms <= 0) return '0s'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
