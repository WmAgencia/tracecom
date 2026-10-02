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
import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// No Vercel, o diretório de trabalho é /var/task
// Os arquivos estão no mesmo diretório que o script
const UI_DIR = __dirname
const PORT = process.env.PORT || 3000

// ============================================
// WEBSOCKET — bot conecta aqui para telemetria em tempo real
// ============================================
const WS_PORT = process.env.PANEL_WS_PORT || 8080

// Clients: browsers connected to see live updates
const browserClients = new Set()

// Bot client: the bot process that sends telemetry
let botClient = null
let botAuthenticated = false

function broadcastToBrowsers(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() })
  for (const ws of browserClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg) } catch { /* ignore */ }
    }
  }
}

function setupWebSocketServer() {
  let wss
  try {
    wss = new WebSocketServer({ port: WS_PORT })
  } catch {
    console.log('[WS] porta 8080 não disponível — comunicação em tempo real desativada')
    return
  }

  console.log(`[WS] servidor de telemetria ouvindo na porta ${WS_PORT}`)

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress
    console.log(`[WS] nova conexão de ${ip}`)

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // ── BOT CLIENT (autentica via PANEL_SECRET) ──────────────────────────
      if (msg.auth && msg.secret === process.env.PANEL_SECRET) {
        if (botClient && botClient !== ws) {
          // desconecta bot anterior
          try { botClient.close(1000, 'new bot connected') } catch { /* */ }
        }
        botClient = ws
        botAuthenticated = true
        ws.send(JSON.stringify({ type: 'ack', ts: Date.now() }))
        console.log('[WS] bot autenticado')
        return
      }

      // ── BROWSER CLIENT ───────────────────────────────────────────────────
      if (msg.type === 'browser_hello') {
        browserClients.add(ws)
        // envia estado atual imediatamente
        ws.send(JSON.stringify({
          type: 'state_snapshot',
          payload: buildStatePayload(),
          ts: Date.now(),
        }))
        ws.on('close', () => browserClients.delete(ws))
        return
      }

      // ── COMANDOS DO BROWSER PARA O BOT ─────────────────────────────────
      if (msg.type === 'command' && botClient && botClient.readyState === WebSocket.OPEN) {
        console.log('[WS] comando do browser → bot:', msg.action)
        botClient.send(JSON.stringify(msg.payload || { action: msg.action }))
        return
      }

      // ── TELEMETRIA DO BOT ──────────────────────────────────────────────
      if (botAuthenticated && ws === botClient) {
        handleBotTelemetry(msg)
        // retransmite para todos os browsers
        broadcastToBrowsers('telemetry', msg)
        return
      }
    })

    ws.on('close', () => {
      if (ws === botClient) {
        botClient = null
        botAuthenticated = false
        console.log('[WS] bot desconectado')
        broadcastToBrowsers('bot_disconnected', {})
      }
      browserClients.delete(ws)
    })

    ws.on('error', (err) => {
      console.error('[WS] erro:', err.message)
    })
  })
}

function buildStatePayload() {
  return {
    runtime: {
      state: state.runtime.state,
      connection: state.runtime.connection,
      account: state.runtime.account,
      live: state.runtime.live,
      session: state.session,
    },
    stats: state.stats,
    stake: state.stake,
    engine: state.engineInfo,
    trades: state.trades.slice(-20),
  }
}

function handleBotTelemetry(msg) {
  if (!msg || typeof msg !== 'object') return
  state.lastUpdate = new Date().toISOString()

  if (msg.connection) {
    state.runtime.connection = msg.connection
  }

  if (msg.account) {
    state.runtime.account = msg.account
  }

  if (msg.live !== undefined) {
    state.runtime.live = msg.live
  }

  if (msg.stats) {
    const r = msg.stats
    const total = (r.wins || 0) + (r.losses || 0)
    const wr = total > 0 ? ((r.wins / total) * 100).toFixed(2) : '0.00'
    state.stats = {
      day: { profit: r.profit || 0, ops: r.ops || 0, wins: r.wins || 0, losses: r.losses || 0, wr },
      week: { profit: 0, ops: 0, wins: 0, losses: 0, wr: '0.00' },
      month: { profit: 0, ops: 0, wins: 0, losses: 0, wr: '0.00' },
    }
  }

  if (msg.session) {
    state.session = msg.session
  }

  if (msg.state) {
    state.runtime.state = msg.state
  }
}

// ============================================
// LISTA DE ARQUIVOS DISPONÍVEIS NO DIRETÓRIO
// ============================================

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
    // Encaminha comando start ao bot via WebSocket
    if (botClient && botClient.readyState === WebSocket.OPEN) {
      botClient.send(JSON.stringify({ action: 'start' }))
    }
    json(res, 200, {
      ok: true,
      message: 'Comando start enviado ao bot.',
      sessionId: state.session?.id || randomUUID(),
      startedAt: new Date().toISOString(),
    })
  },

  async 'POST /api/runtime/stop'(req, res) {
    // Encaminha comando stop ao bot via WebSocket
    if (botClient && botClient.readyState === WebSocket.OPEN) {
      botClient.send(JSON.stringify({ action: 'stop' }))
    }
    json(res, 200, { ok: true, message: 'Comando stop enviado ao bot.' })
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

  async 'GET /api/auth/status'(req, res) {
    // Lê credenciais do arquivo do bot
    const credPath = path.join(UI_DIR, 'bot-credentials.json')
    let loggedIn = false
    let email = null
    try {
      const raw = fs.readFileSync(credPath, 'utf8')
      const cred = JSON.parse(raw)
      if (cred.email && cred.password) { loggedIn = true; email = cred.email }
    } catch { /* sem arquivo */ }
    json(res, 200, { ok: true, loggedIn, email })
  },

  async 'POST /api/auth/login'(req, res) {
    const body = await readBody(req)
    if (!body || !body.email || !body.password) {
      return json(res, 400, { ok: false, error: 'Email e senha são obrigatórios.' })
    }
    // Salva credenciais no arquivo que o bot vai ler
    const credPath = path.join(UI_DIR, 'bot-credentials.json')
    const cred = { email: String(body.email).trim(), password: String(body.password) }
    try {
      fs.writeFileSync(credPath, JSON.stringify(cred, null, 2))
    } catch (e) {
      console.error('[AUTH] erro ao salvar credenciais:', e.message)
      return json(res, 500, { ok: false, error: 'Não foi possível salvar as credenciais.' })
    }
    // Notifica bot via WS
    if (botClient && botClient.readyState === WebSocket.OPEN) {
      botClient.send(JSON.stringify({ action: 'login', email: cred.email, password: cred.password }))
    }
    console.log('[AUTH] credenciais atualizadas para:', cred.email)
    json(res, 200, { ok: true, loggedIn: true, email: cred.email })
  },

  async 'POST /api/auth/logout'(req, res) {
    const credPath = path.join(UI_DIR, 'bot-credentials.json')
    try { if (fs.existsSync(credPath)) fs.unlinkSync(credPath) } catch { /* */ }
    if (botClient && botClient.readyState === WebSocket.OPEN) {
      botClient.send(JSON.stringify({ action: 'logout' }))
    }
    json(res, 200, { ok: true, loggedIn: false })
  },

  async 'POST /api/account/switch'(req, res) {
    const body = await readBody(req)
    const mode = body?.mode
    if (mode !== 'demo' && mode !== 'real') {
      return json(res, 400, { ok: false, error: 'Modo deve ser "demo" ou "real".' })
    }
    // Salva preference
    const prefPath = path.join(UI_DIR, 'bot-preference.json')
    fs.writeFileSync(prefPath, JSON.stringify({ mode }))
    // Notifica bot via WS
    if (botClient && botClient.readyState === WebSocket.OPEN) {
      botClient.send(JSON.stringify({ action: 'account_switch', mode }))
    }
    state.runtime.account = { mode, label: mode === 'real' ? 'REAL' : 'PRACTICE (demo)', readOnly: false }
    broadcastToBrowsers('account_switched', { mode })
    json(res, 200, { ok: true, mode })
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
        id: body.status.sessionId || randomUUID(),
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
  setupWebSocketServer()
})

process.on('SIGINT', () => {
  console.log('\n[PAINEL] Server stopped')
  process.exit(0)
})
