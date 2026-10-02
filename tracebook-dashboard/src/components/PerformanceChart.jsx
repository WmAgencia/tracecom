import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

const TIME_RANGES = [
  { label: '1M', minutes: 1 },
  { label: '5M', minutes: 5 },
  { label: '15M', minutes: 15 },
  { label: '1H', minutes: 60 },
  { label: 'ALL', minutes: Infinity },
]

export default function PerformanceChart({ data }) {
  const [range, setRange] = useState('ALL')
  const [showDrawdown, setShowDrawdown] = useState(false)

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return []
    if (range === 'ALL') return data

    const rangeObj = TIME_RANGES.find(r => r.label === range)
    if (!rangeObj || rangeObj.minutes === Infinity) return data

    const cutoffMs = Date.now() - rangeObj.minutes * 60 * 1000
    return data.filter(d => {
      const t = typeof d.time === 'number' && d.time > 1e12 ? d.time : Date.now()
      return t > cutoffMs
    })
  }, [data, range])

  // Encontra drawdown máximo
  const maxDrawdown = useMemo(() => {
    if (!filteredData.length) return 0
    let peak = filteredData[0]?.pnl || 0
    let maxDD = 0
    filteredData.forEach(d => {
      if (d.pnl > peak) peak = d.pnl
      const dd = peak - d.pnl
      if (dd > maxDD) maxDD = dd
    })
    return maxDD
  }, [filteredData])

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const pnl = payload[0]?.value || 0
    const result = payload[0]?.payload?.result
    return (
      <div className="bg-bg-surface border border-border rounded-lg p-3 shadow-xl">
        <div className={`text-lg font-bold font-mono ${pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
          {pnl >= 0 ? '+' : ''}R${pnl.toFixed(2)}
        </div>
        {result && (
          <div className={`text-xs mt-1 ${
            result === 'win' ? 'text-accent-green' : 'text-accent-red'
          }`}>
            {result === 'win' ? '✅ WIN' : '❌ LOSS'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-secondary">
          P/L ACUMULADO
          {maxDrawdown > 0 && (
            <span className="ml-2 text-xs text-accent-red">
              máx drawdown: -R${maxDrawdown.toFixed(2)}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDrawdown(s => !s)}
            className={`text-xs px-2 py-1 rounded ${showDrawdown ? 'bg-accent-red/20 text-accent-red' : 'bg-bg-alt text-text-secondary'}`}
          >
            Drawdown
          </button>
          <div className="flex gap-1">
            {TIME_RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setRange(r.label)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  range === r.label
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Gráfico */}
      <div className="h-64">
        {filteredData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <div className="text-center">
              <div className="text-4xl mb-2">📈</div>
              <p className="text-sm">Sem dados suficientes</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filteredData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="pnlGradientNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d40" />
              <XAxis dataKey="index" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `R$${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#1e2d40" strokeWidth={1} />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke="#22d3ee"
                strokeWidth={2}
                fill="url(#pnlGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#22d3ee' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
