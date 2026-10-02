export default function Header({ status, connected, soundEnabled, onToggleSound, onStopBot }) {
  const accountType = status?.accountType || 'DEMO'
  const balance = status?.balance || 0
  const currency = accountType === 'REAL' ? 'R$' : 'US$'
  const sessionMs = status?.sessionStart ? Date.now() - status.sessionStart : 0
  const sessionTime = formatDuration(sessionMs)

  const botStatus = !status ? '🔴' : status.paused ? '🟡' : status.warmupDone ? '🟢' : '🟡'

  function formatDuration(ms) {
    if (!ms) return '00:00'
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  return (
    <header className="sticky top-0 z-50 bg-bg-surface/95 backdrop-blur-sm border-b border-border">
      <div className="max-w-[1920px] mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Logo + Versão */}
          <div className="flex items-center gap-3">
            <div className="text-2xl">📊</div>
            <div>
              <div className="font-bold text-text-primary">TraceBot</div>
              <div className="text-xs text-text-secondary font-mono">V16</div>
            </div>
          </div>

          {/* Status central */}
          <div className="flex items-center gap-6">
            {/* Conta */}
            <div className="flex items-center gap-2">
              <span className={`badge ${accountType === 'REAL' ? 'badge-green' : 'badge-cyan'}`}>
                {accountType}
              </span>
            </div>

            {/* Saldo */}
            <div className="text-center">
              <div className="text-sm font-mono font-bold text-text-primary">
                {currency}{balance.toFixed(2)}
              </div>
              {status?.sessionPnl !== undefined && (
                <div className={`text-xs font-mono ${status.sessionPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                  {status.sessionPnl >= 0 ? '+' : ''}{currency}{status.sessionPnl.toFixed(2)}
                </div>
              )}
            </div>

            {/* Tempo de sessão */}
            <div className="text-center">
              <div className="text-sm font-mono text-text-secondary">⏱ {sessionTime}</div>
            </div>

            {/* Status do bot */}
            <div className="flex items-center gap-2">
              <span className={`text-xl ${!connected ? 'animate-pulse-subtle' : ''}`}>
                {botStatus}
              </span>
            </div>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-2">
            {/* Som */}
            <button
              onClick={onToggleSound}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-bg-alt text-text-secondary hover:text-text-primary'
              }`}
              title={soundEnabled ? 'Desativar som' : 'Ativar som'}
            >
              {soundEnabled ? '🔔' : '🔕'}
            </button>

            {/* Parar */}
            <button
              onClick={onStopBot}
              className="btn-danger text-xs"
            >
              ⏹ Parar
            </button>

            {/* Indicador de conexão */}
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-accent-green' : 'bg-accent-red'}`} />
          </div>
        </div>
      </div>
    </header>
  )
}
