// API do bot — comunicação com o servidor de métricas
// Em produção (Railway) usa URL do Railway, local usa localhost:3456
const isProduction = import.meta.env.PROD
const RAILWAY_URL = 'https://desirable-connection-production-ef1a.up.railway.app'
const API_BASE = isProduction ? RAILWAY_URL : (import.meta.env.VITE_API_URL || 'http://localhost:3456')

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.warn(`[botApi] ${path} falhou:`, err.message)
    return null
  }
}

export const botApi = {
  // Status geral
  getStatus: () => apiFetch('/api/status'),

  // Histórico de operações
  getTrades: () => apiFetch('/api/trades'),

  // Config atual
  getConfig: () => apiFetch('/api/config'),

  // Atualizar config
  updateConfig: (config) =>
    apiFetch('/api/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // Parar o bot
  stopBot: () => apiFetch('/api/stop', { method: 'POST' }),

  // Vender posição manualmente
  sellPosition: (optionId) =>
    apiFetch('/api/sell', {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    }),

  // Estado por ativo
  getState: () => apiFetch('/api/state'),
}
