import { useState, useCallback, useMemo } from 'react'
import { useBotStatus } from './hooks/useBotStatus'
import Header from './components/Header'
import MetricCard from './components/MetricCard'
import OpenPositions from './components/OpenPositions'
import PerformanceChart from './components/PerformanceChart'
import TradeHistory from './components/TradeHistory'
import SettingsPanel from './components/SettingsPanel'
import AssetMap from './components/AssetMap'
import DebugPanel from './components/DebugPanel'
import Toast from './components/common/Toast'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'history', label: 'Histórico' },
  { id: 'assets', label: 'Ativos' },
  { id: 'settings', label: 'Configurações' },
  { id: 'debug', label: 'Debug' },
]

export default function App() {
  const {
    status,
    trades,
    config,
    assetState,
    connected,
    lastUpdate,
    stopBot,
    sellPosition,
    updateConfig,
  } = useBotStatus()

  const [activeTab, setActiveTab] = useState('dashboard')
  const [toasts, setToasts] = useState([])
  const [soundEnabled, setSoundEnabled] = useState(false)

  // Estatísticas derivadas
  const stats = useMemo(() => {
    if (!status?.stats) {
      return {
        total: 0, wins: 0, losses: 0, wr: '0.0',
        pnl: '0.00', openCount: 0, universeSize: 0,
        candleCount: 0, warmupDone: false,
      }
    }
    return status.stats
  }, [status])

  // P/L acumulado por tempo (para o gráfico)
  const pnlHistory = useMemo(() => {
    if (!trades || trades.length === 0) return []
    let cumulative = 0
    return trades.map((trade, i) => {
      const pnl = trade.result === 'win'
        ? (trade.pnl || 0)
        : trade.result === 'loss'
          ? -(config?.trading?.baseStake || 2)
          : 0
      cumulative += pnl
      return {
        time: trade.time || i,
        pnl: cumulative,
        result: trade.result,
      }
    })
  }, [trades, config])

  // Toast notifications
  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  // Detecta nova operação
  const prevTradeCount = useMemo(() => trades.length, [trades.length])

  // Executa quando chega nova operação
  const lastTrade = trades[trades.length - 1]
  if (lastTrade && prevTradeCount > 0 && soundEnabled) {
    // Tocaria som aqui
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header */}
      <Header
        status={status}
        connected={connected}
        lastUpdate={lastUpdate}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(s => !s)}
        onStopBot={async () => {
          if (confirm('Parar o bot?')) {
            await stopBot()
            addToast('Bot parado', 'warning')
          }
        }}
      />

      {/* Tabs */}
      <div className="border-b border-border sticky top-[60px] bg-bg-primary z-40">
        <div className="max-w-[1920px] mx-auto px-4">
          <nav className="flex gap-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'tab-active text-accent-cyan'
                    : 'text-text-secondary hover:text-text-primary border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-[1920px] mx-auto px-4 py-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fade-in">
            {/* Métricas principais */}
            <section>
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <MetricCard
                  title="WIN RATE"
                  value={`${stats.wr}%`}
                  subtitle={`${stats.wins}W / ${stats.losses}L`}
                  color="cyan"
                  icon="📊"
                  progress={stats.wr}
                />
                <MetricCard
                  title="P/L LÍQUIDO"
                  value={`${parseFloat(stats.pnl) >= 0 ? '+' : ''}R$ ${stats.pnl}`}
                  subtitle={`meta: R$ ${config?.stop?.profitTarget || 1000}`}
                  color={parseFloat(stats.pnl) >= 0 ? 'green' : 'red'}
                  icon="💰"
                />
                <MetricCard
                  title="OPERAÇÕES"
                  value={`${stats.wins + stats.losses}`}
                  subtitle={`${stats.openCount} abertas`}
                  color="yellow"
                  icon="📈"
                />
                <MetricCard
                  title="CANDLES"
                  value={stats.candleCount?.toLocaleString() || '0'}
                  subtitle={`${stats.universeSize || 0}/${config?.universe?.minActive || 170} uni`}
                  color="cyan"
                  icon="🕯️"
                />
              </div>
            </section>

            {/* Gráfico + Operações Abertas */}
            <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2">
                <PerformanceChart data={pnlHistory} />
              </div>
              <div>
                <OpenPositions
                  positions={status?.openPositions || []}
                  onSell={sellPosition}
                  addToast={addToast}
                />
              </div>
            </section>

            {/* Resumo rápido */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card text-center">
                <div className="text-2xl font-bold font-mono text-accent-green">
                  {stats.wins}
                </div>
                <div className="text-xs text-text-secondary mt-1">Wins</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-bold font-mono text-accent-red">
                  {stats.losses}
                </div>
                <div className="text-xs text-text-secondary mt-1">Losses</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-bold font-mono text-accent-cyan">
                  {status?.universeSize || 0}
                </div>
                <div className="text-xs text-text-secondary mt-1">Ativos</div>
              </div>
              <div className="card text-center">
                <div className="text-2xl font-bold font-mono text-accent-yellow">
                  {status?.openCount || 0}
                </div>
                <div className="text-xs text-text-secondary mt-1">Em voo</div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="animate-fade-in">
            <TradeHistory trades={trades} config={config} />
          </div>
        )}

        {activeTab === 'assets' && (
          <div className="animate-fade-in">
            <AssetMap assetState={assetState} config={config} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="animate-fade-in">
            <SettingsPanel
              config={config}
              onUpdate={updateConfig}
              addToast={addToast}
            />
          </div>
        )}

        {activeTab === 'debug' && (
          <div className="animate-fade-in">
            <DebugPanel status={status} trades={trades} config={config} />
          </div>
        )}
      </main>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <Toast key={toast.id} message={toast.message} type={toast.type} />
        ))}
      </div>
    </div>
  )
}
