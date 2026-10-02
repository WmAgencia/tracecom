const ICONS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
}

const COLORS = {
  success: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
  error: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
  warning: 'border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow',
  info: 'border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan',
}

export default function Toast({ message, type = 'info' }) {
  const icon = ICONS[type] || ICONS.info
  const color = COLORS[type] || COLORS.info

  return (
    <div className={`card border ${color} animate-slide-in`}>
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  )
}
