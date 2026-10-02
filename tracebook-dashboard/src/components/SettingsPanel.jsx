import { useState, useEffect } from 'react'

const SETTINGS_TABS = [
  { id: 'trading', label: 'Trading' },
  { id: 'estrategia', label: 'Estratégia' },
  { id: 'venda', label: 'Venda' },
  { id: 'risco', label: 'Risco' },
  { id: 'universo', label: 'Universo' },
]

const DEFAULTS = {
  trading: {
    baseStake: { min: 0.5, max: 20, step: 0.5, default: 2, unit: 'R$' },
    expirationMinutes: { options: [1, 2, 3, 5], default: 5 },
    maxOpsPerAsset: { min: 1, max: 5, step: 1, default: 3 },
    galeWindowMs: { min: 30000, max: 300000, step: 10000, default: 120000, unit: 'ms', toLabel: v => `${(v/1000).toFixed(0)}s` },
  },
  estrategia: {
    adxMin: { min: 10, max: 40, step: 1, default: 20 },
    rsiCallMax: { min: 40, max: 70, step: 1, default: 55 },
    rsiPutMin: { min: 30, max: 60, step: 1, default: 45 },
    regimeStreakThreshold: { min: 5, max: 20, step: 1, default: 12 },
    trendMinEmaSpreadPct: { min: 0.02, max: 0.20, step: 0.01, default: 0.06, toLabel: v => `${(v*100).toFixed(0)}%` },
  },
  venda: {
    takeProfitMode: { options: ['NORMAL', 'SCALP'], default: 'NORMAL' },
    takeProfitPctOfStake: { min: 10, max: 50, step: 5, default: 20, unit: '%', toLabel: v => `${v}%` },
    endgameAfterMs: { min: 20000, max: 60000, step: 5000, default: 40000, unit: 's', toLabel: v => `${(v/1000).toFixed(0)}s` },
    endgameBeforeMs: { min: 10000, max: 30000, step: 5000, default: 20000, unit: 's', toLabel: v => `${(v/1000).toFixed(0)}s` },
    minRecover: { min: 0.1, max: 2, step: 0.1, default: 0.5, unit: 'R$' },
    endgameDistanceFactor: { min: 1, max: 8, step: 0.5, default: 4, unit: '×' },
    earlyGaleEnabled: { type: 'boolean', default: true },
    earlyGaleThreshold: { min: 0.2, max: 2, step: 0.1, default: 0.8, unit: 'R$' },
  },
  risco: {
    maxExposurePct: { min: 10, max: 80, step: 5, default: 50, unit: '%' },
    maxSessionLossPct: { min: 5, max: 30, step: 5, default: 20, unit: '%' },
    maxStake: { min: 5, max: 100, step: 5, default: 20, unit: 'R$' },
  },
  universo: {
    minActive: { min: 50, max: 200, step: 10, default: 170 },
    maxActive: { min: 50, max: 250, step: 10, default: 200 },
    replaceStaleMs: { min: 60000, max: 600000, step: 30000, default: 180000, toLabel: v => `${(v/60000).toFixed(0)}m` },
    checkEveryMs: { min: 10000, max: 300000, step: 10000, default: 30000, toLabel: v => `${(v/1000).toFixed(0)}s` },
  },
}

export default function SettingsPanel({ config, onUpdate, addToast }) {
  const [activeTab, setActiveTab] = useState('trading')
  const [localConfig, setLocalConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [previewImpact, setPreviewImpact] = useState(null)

  useEffect(() => {
    if (config) setLocalConfig(JSON.parse(JSON.stringify(config)))
  }, [config])

  if (!localConfig) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-20 text-text-secondary">
          <div className="text-center">
            <div className="text-4xl mb-3">⚙️</div>
            <p>Conectando ao bot...</p>
            <p className="text-xs mt-1">O servidor de métricas precisa estar rodando em localhost:3456</p>
          </div>
        </div>
      </div>
    )
  }

  const handleChange = (section, key, value) => {
    setLocalConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      if (!next[section]) next[section] = {}
      next[section][key] = value
      return next
    })
    setHasChanges(true)

    // Calcula impacto
    const impact = calculateImpact(section, key, value, config)
    if (impact) setPreviewImpact(impact)
    else setPreviewImpact(null)
  }

  const calculateImpact = (section, key, value, current) => {
    const msgs = {
      'estrategia.adxMin': {
        adxMin: { lower: 'Mais entradas (ADX mais permissivo)', higher: 'Menos entradas (ADX mais rigoroso)' },
      },
      'estrategia.rsiCallMax': {
        rsiCallMax: { higher: 'Mais entradas CALL permitidas', lower: 'Menos entradas CALL (RSI mais esticado)' },
      },
      'estrategia.rsiPutMin': {
        rsiPutMin: { lower: 'Mais entradas PUT permitidas', higher: 'Menos entradas PUT (RSI mais esticado)' },
      },
      'venda.takeProfitPctOfStake': {
        takeProfitPctOfStake: { lower: 'Venda mais rápida (lucro menor)', higher: 'Venda mais demorada (lucro maior)' },
      },
      'venda.earlyGaleEnabled': {
        earlyGaleEnabled: { true: 'Gale antecipado ATIVADO', false: 'Gale antecipado DESATIVADO' },
      },
    }
    const sectionMap = msgs[`${section}.${key}`]
    if (!sectionMap) return null
    const currentVal = current?.[section]?.[key]
    const currentMeta = DEFAULTS[section]?.[key]
    if (currentVal === undefined || currentMeta === undefined) return null
    if (typeof currentMeta.toLabel === 'function') {
      return sectionMap[key]?.[value > currentVal ? 'higher' : 'lower'] || null
    }
    return sectionMap[key]?.[value > currentVal ? 'higher' : 'lower'] || null
  }

  const handleSave = async () => {
    if (!confirm('Salvar configuração e reiniciar o bot?')) return
    setSaving(true)
    try {
      await onUpdate(localConfig)
      addToast('Configuração salva! Bot reiniciando...', 'success')
      setHasChanges(false)
    } catch (e) {
      addToast('Erro ao salvar: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!confirm('Resetar para valores padrão?')) return
    const defaults = {}
    Object.entries(DEFAULTS).forEach(([section, fields]) => {
      defaults[section] = {}
      Object.entries(fields).forEach(([key, meta]) => {
        defaults[section][key] = meta.default
      })
    })
    setLocalConfig(prev => ({ ...prev, ...defaults }))
    setHasChanges(true)
    setPreviewImpact(null)
    addToast('Resetado para padrão', 'info')
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="card">
        <div className="flex gap-1 overflow-x-auto">
          {SETTINGS_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-accent-cyan/20 text-accent-cyan'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-alt'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Campos */}
      <div className="card">
        <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">
          {SETTINGS_TABS.find(t => t.id === activeTab)?.label}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Object.entries(DEFAULTS[activeTab] || {}).map(([key, meta]) => (
            <SettingsField
              key={key}
              label={formatLabel(key)}
              meta={meta}
              value={localConfig?.[activeTab]?.[key] ?? meta.default}
              onChange={v => handleChange(activeTab, key, v)}
              description={getDescription(activeTab, key)}
            />
          ))}
        </div>
      </div>

      {/* Preview de impacto */}
      {previewImpact && (
        <div className="card border-accent-yellow/30 bg-accent-yellow/5">
          <div className="flex items-center gap-2 text-accent-yellow">
            <span>💡</span>
            <span className="text-sm font-medium">{previewImpact}</span>
          </div>
        </div>
      )}

      {/* Ações */}
      <div className="flex items-center justify-between">
        <button onClick={handleReset} className="btn-primary">
          ↺ Resetar
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          className="btn-success disabled:opacity-30"
        >
          {saving ? 'Salvando...' : hasChanges ? '💾 Aplicar + Reiniciar Bot' : 'Sem alterações'}
        </button>
      </div>

      {/* Info */}
      <div className="card bg-bg-alt/50">
        <p className="text-xs text-text-secondary">
          ⚠️ Alterações na configuração são salvas no arquivo <code className="text-accent-cyan">bot-config-v15.json</code> e o bot é reiniciado automaticamente.
          O servidor de métricas deve estar rodando em <code className="text-accent-cyan">localhost:3456</code>.
        </p>
      </div>
    </div>
  )
}

function SettingsField({ label, meta, value, onChange, description }) {
  if (meta.type === 'boolean') {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-text-primary">{label}</label>
          <button
            onClick={() => onChange(!value)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              value ? 'bg-accent-green' : 'bg-bg-alt'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              value ? 'left-[26px]' : 'left-0.5'
            }`} />
          </button>
        </div>
        {description && <p className="text-xs text-text-secondary">{description}</p>}
      </div>
    )
  }

  if (meta.options) {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-text-primary">{label}</label>
        <select
          value={value}
          onChange={e => onChange(Number(e.target.value) || e.target.value)}
          className="input-field w-full"
        >
          {meta.options.map(opt => (
            <option key={opt} value={opt}>
              {meta.toLabel ? meta.toLabel(opt) : opt}
            </option>
          ))}
        </select>
        {description && <p className="text-xs text-text-secondary">{description}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">{label}</label>
        <span className="text-sm font-mono text-accent-cyan">
          {meta.toLabel ? meta.toLabel(value) : `${meta.unit || ''}${value}`}
        </span>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-bg-alt rounded-full appearance-none cursor-pointer accent-accent-cyan"
      />
      <div className="flex justify-between text-xs text-text-secondary font-mono">
        <span>{meta.toLabel ? meta.toLabel(meta.min) : meta.min}</span>
        <span>{meta.toLabel ? meta.toLabel(meta.max) : meta.max}</span>
      </div>
      {description && <p className="text-xs text-text-secondary">{description}</p>}
    </div>
  )
}

function formatLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .replace(/PctOfStake/g, '% of Stake')
    .replace(/Min/g, ' Mín')
    .replace(/Max/g, ' Máx')
    .replace(/Ms/g, ' (ms)')
    .trim()
}

function getDescription(section, key) {
  const descs = {
    'trading.baseStake': 'Valor base de cada operação. Sempre fixo — sem martingale de valor.',
    'trading.maxOpsPerAsset': 'Máximo de operações no mesmo ativo por ciclo (1 entrada + até 2 gales).',
    'trading.galeWindowMs': 'Prazo para o gale entrar após um loss. Passou = ciclo fecha.',
    'estrategia.adxMin': 'ADX mínimo = força mínima da tendência. Abaixo = mercado fraco/lateral, entrada proibida.',
    'estrategia.rsiCallMax': 'Não compra CALL se RSI > este valor (RSI esticado contra).',
    'estrategia.rsiPutMin': 'Não vende PUT se RSI < este valor (RSI esticado contra).',
    'estrategia.regimeStreakThreshold': 'Bloqueia entrada com N+ candles iguais seguidos (tendência exausta).',
    'estrategia.trendMinEmaSpreadPct': 'Spread mínimo entre EMA8 e EMA21 para confirmar tendência.',
    'venda.takeProfitMode': 'SCALP = vende qualquer lucro > 0. NORMAL = vende em 20% do stake.',
    'venda.takeProfitPctOfStake': 'Vende quando o lucro líquido atingir X% do stake (ex: 20% = R$0,40 com stake R$2).',
    'venda.endgameAfterMs': 'Começa a avaliar venda no fim da opção (tempo restante < X).',
    'venda.endgameBeforeMs': 'A janela final de venda (de X até 0 segundos restantes).',
    'venda.minRecover': 'Mínimo de recuperação para vender perdendo (ex: 0,50 = recupera pelo menos R$0,50).',
    'venda.endgameDistanceFactor': 'O preço precisa estar a X candles 5s longe da linha de win para vender.',
    'venda.earlyGaleEnabled': 'Abre gale ANTES da operação original fechar em loss.',
    'venda.earlyGaleThreshold': 'Abre gale se a posição estiver perdendo mais que R$X.',
    'risco.maxExposurePct': 'Máximo de exposição como % do saldo (todas ordens abertas somadas).',
    'risco.maxSessionLossPct': 'Perdeu mais que X% do saldo inicial = para de abrir operações.',
    'risco.maxStake': 'Teto máximo por ordem (não confundir com baseStake).',
    'universo.minActive': 'Mínimo de ativos operando. O bot completa até este número automaticamente.',
    'universo.maxActive': 'Máximo de ativos no universo.',
    'universo.replaceStaleMs': 'Ativo sem candle fresco por X = substituído.',
    'universo.checkEveryMs': 'Frequência de revisão do universo.',
  }
  return descs[`${section}.${key}`] || ''
}
