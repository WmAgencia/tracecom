#!/usr/bin/env node
/**
 * proxy.mjs — Proxy de métricas para TraceBot V16
 *
 * MODELO:
 * - Bot local POSTA dados para /api/update
 * - Dashboard GET os dados de /api/status, /api/trades, etc.
 *
 * Uso local: node proxy.mjs
 * Uso Railway: deployment automático
 */
import http from 'http'
import fs from 'fs'
import path from 'path'

// Estado em memória (Railway não persiste arquivos facilmente)
let botData = {
  status: null,
  trades: [],
  config: null,
  lastUpdate: null,
}

// Configuração
const PORT = process.env.PORT || 3456
const BOT_DIR = process.env.BOT_DIR || 'D:/Tracecom project'

function readJson(filename) {
  try {
    const data = fs.readFileSync(path.join(BOT_DIR, filename), 'utf8')
    return JSON.parse(data)
  } catch {
    return null
  }
}

function parseBotState(state) {
  if (!state) return null
  const results = readJson('resultados-v15.json') || []
  const wins = results.filter(r => r.result === 'win').length
  const losses = results.filter(r => r.result === 'loss').length
  const total = wins + losses
  const baseStake = 2
  const pnl = results.reduce((sum, r) => {
    if (r.result === 'win') return sum + (r.pnl || 0)
    if (r.result === 'loss') return sum - baseStake
    return sum
  }, 0)

  const universeSize = state ? Object.keys(state).length : 0
  const stateWins = Object.values(state || {}).filter(a => a.lastResult === 'win').length
  const stateLosses = Object.values(state || {}).filter(a => a.lastResult === 'loss').length

  return {
    candleCount: 0,
    stats: {
      total: total || (stateWins + stateLosses),
      wins: wins || stateWins,
      losses: losses || stateLosses,
      wr: total > 0 ? (wins / total * 100).toFixed(1) : '0.0',
      pnl: pnl.toFixed(2),
      openCount: 0,
      universeSize,
      warmupDone: true,
    },
    sessionStart: Date.now(),
    accountType: 'DEMO',
    balance: 0,
    sessionPnl: 0,
    paused: false,
    openPositions: [],
    assetState: state || {},
  }
}

// Carrega dados iniciais do sistema de arquivos local (fallback)
function loadLocalData() {
  const state = readJson('bot-state-v15.json')
  const results = readJson('resultados-v15.json') || []
  const config = readJson('bot-config-v15.json')

  botData.status = parseBotState(state)
  botData.trades = results
  botData.config = config
  botData.lastUpdate = Date.now()
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // POST /api/update — bot envia dados
  if (req.method === 'POST' && req.url === '/api/update') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        if (data.status) botData.status = { ...botData.status, ...data.status }
        if (data.trades) botData.trades = data.trades
        if (data.config) botData.config = data.config
        botData.lastUpdate = Date.now()
        res.end(JSON.stringify({ ok: true, timestamp: botData.lastUpdate }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // GET /api/status
  if (req.method === 'GET' && req.url === '/api/status') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(botData.status || {
      candleCount: 0,
      stats: { total: 0, wins: 0, losses: 0, wr: '0.0', pnl: '0.00', openCount: 0, universeSize: 0, warmupDone: false },
      sessionStart: Date.now(),
      accountType: 'DEMO',
      balance: 0,
      sessionPnl: 0,
      paused: false,
      openPositions: [],
      assetState: {},
    }))
    return
  }

  // GET /api/trades
  if (req.method === 'GET' && req.url === '/api/trades') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(botData.trades || []))
    return
  }

  // GET /api/state
  if (req.method === 'GET' && req.url === '/api/state') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(botData.status?.assetState || {}))
    return
  }

  // GET /api/config
  if (req.method === 'GET' && req.url === '/api/config') {
    res.setHeader('Content-Type', 'application/json')
    if (botData.config) {
      const { login, ...safe } = botData.config
      res.end(JSON.stringify(safe))
    } else {
      res.statusCode = 404
      res.end('{"error":"config not found"}')
    }
    return
  }

  // GET /api/health
  if (req.method === 'GET' && req.url === '/api/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      ok: true,
      timestamp: Date.now(),
      lastBotUpdate: botData.lastUpdate,
      mode: 'remote',
    }))
    return
  }

  // Fallback
  res.statusCode = 404
  res.end('{"error":"not found"}')
})

// Tenta carregar dados locais na inicialização
loadLocalData()

server.listen(PORT, () => {
  console.log(`[📡] Proxy de métricas rodando na porta ${PORT}`)
  console.log(`    POST /api/update   — receber dados do bot`)
  console.log(`    GET  /api/status   — status do bot`)
  console.log(`    GET  /api/trades   — histórico de operações`)
  console.log(`    GET  /api/state    — estado por ativo`)
  console.log(`    GET  /api/config   — configuração (sem senha)`)
  console.log(`    GET  /api/health   — health check`)
  console.log(`\n  Dashboard acessa: http://localhost:${PORT}/api/...`)
})

process.on('SIGINT', () => {
  console.log('\n[📡] Proxy encerrado')
  process.exit(0)
})
