#!/usr/bin/env node
/**
 * server.mjs — Servidor único que roda proxy + dashboard
 *
 * Roteamento:
 * /api/*      → proxy de métricas (recebe dados do bot)
 * /*          → dashboard estático (React build)
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const DIST_DIR = path.join(__dirname, 'dist')

// ============================================
// PROXY — estado em memória
// ============================================
let botData = {
  status: null,
  trades: [],
  config: null,
  lastUpdate: null,
}

// ============================================
// SERVE ARQUIVOS ESTÁTICOS
// ============================================
function serveStatic(req, res) {
  let filePath = path.join(DIST_DIR, req.url.split('?')[0])

  // SPA fallback
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html')
  }

  const ext = path.extname(filePath)
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' })
    res.end(data)
  })
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url.split('?')[0]

  // API routes
  if (url.startsWith('/api/')) {
    handleApi(req, res, url)
    return
  }

  // Static files
  serveStatic(req, res)
})

// ============================================
// API HANDLERS
// ============================================
function handleApi(req, res, url) {
  res.setHeader('Content-Type', 'application/json')

  // POST /api/update — bot envia dados
  if (req.method === 'POST' && url === '/api/update') {
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
  if (req.method === 'GET' && url === '/api/status') {
    res.end(JSON.stringify(botData.status || getEmptyStatus()))
    return
  }

  // GET /api/trades
  if (req.method === 'GET' && url === '/api/trades') {
    res.end(JSON.stringify(botData.trades || []))
    return
  }

  // GET /api/state
  if (req.method === 'GET' && url === '/api/state') {
    res.end(JSON.stringify(botData.status?.assetState || {}))
    return
  }

  // GET /api/config
  if (req.method === 'GET' && url === '/api/config') {
    if (botData.config) {
      const { login, ...safe } = botData.config
      res.end(JSON.stringify(safe))
    } else {
      res.writeHead(404)
      res.end('{"error":"config not found"}')
    }
    return
  }

  // GET /api/health
  if (req.method === 'GET' && url === '/api/health') {
    res.end(JSON.stringify({
      ok: true,
      timestamp: Date.now(),
      lastBotUpdate: botData.lastUpdate,
      mode: 'remote',
    }))
    return
  }

  res.writeHead(404)
  res.end('{"error":"not found"}')
}

function getEmptyStatus() {
  return {
    candleCount: 0,
    stats: { total: 0, wins: 0, losses: 0, wr: '0.0', pnl: '0.00', openCount: 0, universeSize: 0, warmupDone: false },
    sessionStart: Date.now(),
    accountType: 'DEMO',
    balance: 0,
    sessionPnl: 0,
    paused: false,
    openPositions: [],
    assetState: {},
  }
}

server.listen(PORT, () => {
  console.log(`[📊] TraceBot Dashboard + Proxy rodando em http://localhost:${PORT}`)
  console.log(`    Dashboard: http://localhost:${PORT}/`)
  console.log(`    API:        http://localhost:${PORT}/api/status`)
  console.log(`    Telemetria: POST http://localhost:${PORT}/api/update`)
})

process.on('SIGINT', () => {
  console.log('\n[📊] Servidor encerrado')
  process.exit(0)
})
