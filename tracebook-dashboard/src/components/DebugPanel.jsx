import { useState, useMemo } from 'react'

export default function DebugPanel({ status, trades, config }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const rawStatus = useMemo(() => {
    return JSON.stringify(status, null, 2)
  }, [status])

  const rawConfig = useMemo(() => {
    if (!config) return '{}'
    // Remove senha
    const safe = { ...config }
    if (safe.login) safe.login = { ...safe.login, password: '***' }
    return JSON.stringify(safe, null, 2)
  }, [config])

  const recentTrades = useMemo(() => {
    if (!trades) return '[]'
    return JSON.stringify(trades.slice(-50), null, 2)
  }, [trades])

  const handleCopyDiagnostics = () => {
    const text = `
=== TraceBot V16 Diagnostics ===
Gerado em: ${new Date().toISOString()}

--- STATUS ---
${rawStatus}

--- ÚLTIMAS 50 OPERAÇÕES ---
${recentTrades}

--- CONFIGURAÇÃO ---
${rawConfig}

--- USER AGENT ---
${navigator.userAgent}
`.trim()

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔍</span>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Painel de Debug</h3>
            <p className="text-xs text-text-secondary">Diagnóstico avançado para suporte</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopyDiagnostics}
            className="btn-primary text-xs"
          >
            {copied ? '✅ Copiado!' : '📋 Copiar Diagnóstico'}
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="btn-primary text-xs"
          >
            {expanded ? 'Recolher' : 'Expandir'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4">
          {/* Status raw */}
          <DebugSection title="Status (raw)" data={rawStatus} />

          {/* Últimas 50 operações */}
          <DebugSection title="Últimas 50 Operações (raw)" data={recentTrades} />

          {/* Configuração */}
          <DebugSection title="Configuração (raw)" data={rawConfig} />

          {/* Candle buffers */}
          {status?.assetState && (
            <DebugSection
              title="Estado por Ativo"
              data={JSON.stringify(status.assetState, null, 2)}
            />
          )}

          {/* Info do ambiente */}
          <div className="card">
            <h4 className="text-sm font-semibold text-text-secondary mb-3">Informações do Ambiente</h4>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-text-secondary">User Agent:</span>
                <div className="text-text-primary mt-1">{navigator.userAgent}</div>
              </div>
              <div>
                <span className="text-text-secondary">Screen:</span>
                <div className="text-text-primary mt-1">{window.screen.width}x{window.screen.height}</div>
              </div>
              <div>
                <span className="text-text-secondary">Timestamp:</span>
                <div className="text-text-primary mt-1">{Date.now()}</div>
              </div>
              <div>
                <span className="text-text-secondary">Timezone:</span>
                <div className="text-text-primary mt-1">{Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DebugSection({ title, data }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-text-secondary">{title}</h4>
        <button
          onClick={() => navigator.clipboard.writeText(data)}
          className="text-xs text-text-secondary hover:text-accent-cyan transition-colors"
        >
          📋 Copiar
        </button>
      </div>
      <pre className="text-xs text-accent-cyan font-mono bg-bg-primary rounded-lg p-3 overflow-x-auto max-h-80 overflow-y-auto">
        {data || '{}'}
      </pre>
    </div>
  )
}
