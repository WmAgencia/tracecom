#!/usr/bin/env node
/**
 * PAINEL DE PRODUÇÃO (Railway/Vercel) — API + frontend estático
 * =============================================================
 * Recebe telemetria do bot via POST, serve dashboard para leitura.
 * NÃO fala diretamente com a IQ Option.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// No Vercel, o diretório de trabalho é /var/task
// Os arquivos estão no mesmo diretório que o script
const UI_DIR = __dirname
const PORT = process.env.PORT || 3000

// Lista arquivos disponíveis no diretório
console.log('[DEBUG] Files in UI_DIR:', fs.readdirSync(UI_DIR).join(', '))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

// ============================================
// ESTADO EM MEMÓRIA (Railway não persiste)
// ============================================
const state = {
  session: null,
  trades: [],
  stats: { day: { profit: 0, ops: 0, wins: 0, losses: 0, wr: '0.00' } },
  runtime: { state: 'STOPPED', connection: { ws: 'OFFLINE', feed: 'NO_FEED' } },
  stake: { value: 2, saved: 2 },
  lastUpdate: null,
  engineInfo: { rev: 'V15', mode: 'remote' },
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { req.destroy(); resolve(null); return }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try { resolve(JSON.parse(text)) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

// ============================================
// API HANDLERS
// ============================================
const apiHandlers = {
  async 'GET /api/health'(req, res) {
    json(res, 200, {
      ok: true,
      at: new Date().toISOString(),
      lastUpdate: state.lastUpdate,
      account: 'DEMO',
    })
  },

  async 'GET /api/engine'(req, res) {
    json(res, 200, {
      ok: true,
      engine: { rev: state.engineInfo.rev, mode: state.engineInfo.mode },
      proof: { status: 'N/A', fingerprint: 'remote-telemetry' },
      account: { mode: 'remote', readOnly: true },
    })
  },

  async 'GET /api/runtime'(req, res) {
    json(res, 200, {
      ok: true,
      account: { mode: state.engineInfo.mode, label: state.engineInfo.mode === 'real' ? 'REAL' : 'PRACTICE (demo)', readOnly: true },
      state: state.runtime.state,
      sessionId: state.session?.id || null,
      startedAt: state.session?.startedAt || null,
      live: state.runtime.live || null,
      connection: state.runtime.connection,
      stake: state.stake,
    })
  },

  async 'POST /api/runtime/start'(req, res) {
    // Em produção remote, apenas confirma (bot roda localmente)
    json(res, 200, {
      ok: true,
      message: 'Bot controlado localmente. Telemetria em andamento.',
      sessionId: state.session?.id || crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    })
  },

  async 'POST /api/runtime/stop'(req, res) {
    json(res, 200, { ok: true, message: 'Bot controlado localmente.' })
  },

  async 'GET /api/stake'(req, res) {
    json(res, 200, { ok: true, ...state.stake })
  },

  async 'POST /api/stake'(req, res) {
    const body = await readBody(req)
    if (body.value && typeof body.value === 'number' && body.value > 0) {
      state.stake = { value: body.value, saved: body.value }
      json(res, 200, { ok: true, ...state.stake })
    } else {
      json(res, 400, { ok: false, error: 'Valor inválido' })
    }
  },

  async 'GET /api/stats'(req, res) {
    json(res, 200, {
      ok: true,
      ...state.stats,
      today: state.stats.day,
      sessions: { day: 0, week: 0, month: 0, all: 0 },
    })
  },

  async 'GET /api/history'(req, res) {
    const limit = 100
    const trades = state.trades.slice(-limit).reverse()
    json(res, 200, {
      ok: true,
      range: 'all',
      trades,
      tradesTotal: state.trades.length,
      sessions: [],
    })
  },

  async 'GET /api/events'(req, res) {
    json(res, 200, { ok: true, events: [] })
  },

  async 'POST /api/reset'(req, res) {
    // Confirmação obrigatória
    const body = await readBody(req)
    if (!body || body.confirm !== 'DELETAR TUDO') {
      return json(res, 400, {
        ok: false,
        error: 'Confirmação obrigatória. Digite: DELETAR TUDO',
      })
    }

    // Reseta todos os contadores
    state.trades = []
    state.stats = {
      day: { profit: 0, ops: 0, wins: 0, losses: 0, wr: '0.00' },
      week: { profit: 0, ops: 0, wins: 0, losses: 0, wr: '0.00' },
      month: { profit: 0, ops: 0, wins: 0, losses: 0, wr: '0.00' },
    }

    console.log('[RESET] Contadores deletados em:', new Date().toISOString())
    json(res, 200, {
      ok: true,
      message: 'Todos os contadores foram resetados com sucesso.',
      resetAt: new Date().toISOString(),
    })
  },

  async 'POST /api/update'(req, res) {
    // Endpoint principal de telemetria
    const body = await readBody(req)
    if (!body) return json(res, 400, { ok: false, error: 'Invalid body' })

    // Atualiza estado
    if (body.status) {
      state.runtime.state = body.status.paused ? 'STOPPED' : 'RUNNING'
      state.runtime.connection = {
        ws: body.status.warmupDone ? 'CONNECTED' : 'CONNECTING',
        feed: body.status.candleCount > 0 ? 'LIVE' : 'NO_FEED',
        candles: body.status.candleCount || 0,
        warmup: body.status.warmupDone || false,
        phase: body.status.paused ? 'stopped' : 'running',
        stale: false,
      }
      state.session = {
        id: body.status.sessionId || crypto.randomUUID(),
        startedAt: body.status.sessionStart || new Date().toISOString(),
      }
    }

    if (body.trades && Array.isArray(body.trades)) {
      state.trades = body.trades

      // Recalcula estatísticas
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

      const todayTrades = body.trades.filter(t => {
        const tTime = Date.parse(t.settledAt || t.sentAt || 0)
        return tTime >= todayStart
      })

      const wins = todayTrades.filter(t => t.result === 'win').length
      const losses = todayTrades.filter(t => t.result === 'loss').length
      const ops = wins + losses

      state.stats.day = {
        profit: todayTrades.reduce((sum, t) => {
          if (t.result === 'win') return sum + (t.pnl || 0)
          if (t.result === 'loss') return sum - 2
          return sum
        }, 0).toFixed(2),
        ops,
        wins,
        losses,
        wr: ops > 0 ? ((wins / ops) * 100).toFixed(2) : '0.00',
      }
    }

    if (body.config) {
      state.engineInfo.rev = body.config._version || 'V15'
    }

    state.lastUpdate = Date.now()
    json(res, 200, { ok: true, timestamp: state.lastUpdate })
  },
}

// ============================================
// SERVE ARQUIVOS ESTÁTICOS
// ============================================
function serveStatic(req, res) {
  let url = req.url.split('?')[0]
  if (url === '/') url = '/index.html'

  const filePath = path.join(UI_DIR, url)
  console.log('[DEBUG] serveStatic:', url, '->', filePath, 'exists:', fs.existsSync(filePath))

  // Security: prevent directory traversal
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    const ext = path.extname(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(filePath).pipe(res)
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404)
      res.end('Not Found')
    } else {
      res.writeHead(500)
      res.end('Server Error')
    }
  }
}

// ============================================
// SERVER PRINCIPAL
// ============================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // API routes
  if (url.pathname.startsWith('/api/')) {
    const route = `${req.method} ${url.pathname}`
    const handler = apiHandlers[route]
    if (handler) {
      await handler(req, res)
    } else {
      json(res, 404, { ok: false, code: 'NOT_FOUND', route })
    }
    return
  }

  // Static files
  if (req.method === 'GET') {
    serveStatic(req, res)
    return
  }

  res.writeHead(405)
  res.end('Method Not Allowed')
})

server.listen(PORT, () => {
  console.log(`[PAINEL] Tracecom Painel Production`)
  console.log(`[PAINEL] Server running on port ${PORT}`)
  console.log(`[PAINEL] Dashboard: http://localhost:${PORT}/`)
})

process.on('SIGINT', () => {
  console.log('\n[PAINEL] Server stopped')
  process.exit(0)
})
