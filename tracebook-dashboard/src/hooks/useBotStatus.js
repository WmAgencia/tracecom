import { useState, useEffect, useCallback, useRef } from 'react'
import { botApi } from '../api/botApi'

const POLL_INTERVAL = 2000 // 2s

export function useBotStatus() {
  const [status, setStatus] = useState(null)
  const [trades, setTrades] = useState([])
  const [config, setConfig] = useState(null)
  const [assetState, setAssetState] = useState({})
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)
  const pollRef = useRef(null)

  // Reconhece o formato real do bot (polling dos JSONs de estado)
  const pollState = useCallback(async () => {
    // Tenta API HTTP primeiro (se o bot tiver servidor de métricas)
    let apiStatus = await botApi.getStatus()
    let apiTrades = await botApi.getTrades()

    // Fallback: polling direto dos JSONs do bot (sem modificar o bot)
    if (!apiStatus) {
      const state = await readJson('/bot-state-v15.json')
      const results = await readJson('/resultados-v15.json')
      if (state || results) {
        apiStatus = parseBotState(state)
        apiTrades = results || []
      }
    }

    if (apiStatus) {
      setStatus(apiStatus)
      setTrades(apiTrades || [])
      setConnected(true)
      setLastUpdate(new Date())
      setError(null)
    } else {
      setConnected(false)
    }
  }, [])

  // Lê JSON do sistema de arquivos via fetch local (para fallback sem servidor HTTP)
  const readJson = async (filename) => {
    try {
      // Tenta via API própria se existir
      const res = await fetch(`/api/file${filename}`)
      if (res.ok) return await res.json()
    } catch {}
    // Fallback: dados simulados para demonstração
    return null
  }

  // Parse do formato do bot
  const parseBotState = (state) => {
    if (!state) return null
    const results = state.resultsList || []
    const wins = results.filter(r => r.result === 'win').length
    const losses = results.filter(r => r.result === 'loss').length
    const total = wins + losses
    const pnl = results.reduce((sum, r) => {
      if (r.result === 'win') return sum + (r.pnl || 0)
      if (r.result === 'loss') return sum - (state.trading?.baseStake || 2)
      return sum
    }, 0)

    return {
      candleCount: state.candleCount || 0,
      stats: {
        total,
        wins,
        losses,
        wr: total > 0 ? (wins / total * 100).toFixed(1) : '0.0',
        pnl: pnl.toFixed(2),
        openCount: state.inFlight?.size || 0,
        universeSize: state.running?.size || 0,
        warmupDone: state.warmupDone || false,
      },
      sessionStart: state.sessionStart || Date.now(),
      accountType: state.accountType || 'DEMO',
      balance: state.currentBalance || 0,
      sessionPnl: state.sessionPnl || 0,
      paused: state.paused || false,
    }
  }

  // WebSocket para realtime (se disponível)
  const connectWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket('ws://localhost:3456/ws')
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'status') setStatus(data.payload)
          if (data.type === 'trade') setTrades(prev => [...prev.slice(-199), data.payload])
          if (data.type === 'state') setAssetState(data.payload)
        } catch {}
      }
      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        // Reconecta em 5s
        setTimeout(connectWebSocket, 5000)
      }
      ws.onerror = () => ws.close()
      wsRef.current = ws
    } catch {
      // WebSocket não disponível, usa polling
    }
  }, [])

  // Inicialização
  useEffect(() => {
    connectWebSocket()
    pollState()
    pollRef.current = setInterval(pollState, POLL_INTERVAL)
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [connectWebSocket, pollState])

  // Actions
  const stopBot = useCallback(async () => {
    await botApi.stopBot()
  }, [])

  const sellPosition = useCallback(async (optionId) => {
    await botApi.sellPosition(optionId)
  }, [])

  const refreshConfig = useCallback(async () => {
    const cfg = await botApi.getConfig()
    if (cfg) setConfig(cfg)
  }, [])

  const updateConfig = useCallback(async (newConfig) => {
    const res = await botApi.updateConfig(newConfig)
    if (res) setConfig(res)
    return res
  }, [])

  return {
    status,
    trades,
    config,
    assetState,
    connected,
    lastUpdate,
    error,
    stopBot,
    sellPosition,
    refreshConfig,
    updateConfig,
  }
}
