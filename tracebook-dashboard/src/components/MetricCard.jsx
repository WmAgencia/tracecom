const COLOR_MAP = {
  cyan: {
    border: 'border-accent-cyan/30 hover:border-accent-cyan/50',
    text: 'text-accent-cyan',
    bg: 'bg-accent-cyan/5',
    progress: 'bg-accent-cyan',
    glow: 'glow-cyan',
  },
  green: {
    border: 'border-accent-green/30 hover:border-accent-green/50',
    text: 'text-accent-green',
    bg: 'bg-accent-green/5',
    progress: 'bg-accent-green',
    glow: 'glow-green',
  },
  red: {
    border: 'border-accent-red/30 hover:border-accent-red/50',
    text: 'text-accent-red',
    bg: 'bg-accent-red/5',
    progress: 'bg-accent-red',
    glow: 'glow-red',
  },
  yellow: {
    border: 'border-accent-yellow/30 hover:border-accent-yellow/50',
    text: 'text-accent-yellow',
    bg: 'bg-accent-yellow/5',
    progress: 'bg-accent-yellow',
    glow: '',
  },
  gold: {
    border: 'border-accent-gold/30 hover:border-accent-gold/50',
    text: 'text-accent-gold',
    bg: 'bg-accent-gold/5',
    progress: 'bg-accent-gold',
    glow: '',
  },
}

export default function MetricCard({ title, value, subtitle, color = 'cyan', icon, progress, sparkline }) {
  const colors = COLOR_MAP[color] || COLOR_MAP.cyan

  return (
    <div className={`card ${colors.border} ${colors.glow}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon && <span className="text-lg">{icon}</span>}
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
            {title}
          </span>
        </div>
      </div>

      {/* Valor principal */}
      <div className={`text-3xl font-bold font-mono ${colors.text} mb-1`}>
        {value}
      </div>

      {/* Subtítulo */}
      {subtitle && (
        <div className="text-xs text-text-secondary font-mono">
          {subtitle}
        </div>
      )}

      {/* Barra de progresso (se fornecida) */}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 bg-bg-alt rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${colors.progress}`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}

      {/* Sparkline (se fornecida) */}
      {sparkline && (
        <div className="mt-3 h-8">
          <svg viewBox="0 0 100 30" className="w-full h-full">
            <polyline
              fill="none"
              stroke={colors.text.replace('text-', '')}
              strokeWidth="1.5"
              points={sparkline.map((v, i) => `${(i / sparkline.length) * 100},${30 - (v / Math.max(...sparkline) * 28)}`).join(' ')}
            />
          </svg>
        </div>
      )}
    </div>
  )
}
