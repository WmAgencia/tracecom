#!/usr/bin/env node
/**
 * bot-telemetry.mjs — Envia dados do bot pro proxy remoto (Railway)
 *
 * Uso: node bot-telemetry.mjs
 * Roda junto com o bot na mesma máquina
 */
import https from 'https'
import http from 'http'
import fs from 'fs'
import path from 'path'

const BOT_DIR = 'D:/Tracecom project'
const PROXY_URL = process.env.PROXY_URL || 'https://desirable-connection-production-ef1a.up.railway.app'

function readJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(BOT_DIR, filename), 'utf8'))
  } catch {
    return null
  }
}

function postUpdate(data) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/update', PROXY_URL)
    const body = JSON.stringify(data)

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function sendTelemetry() {
  const state = readJson('bot-state-v15.json')
  const results = readJson('resultados-v15.json') || []
  const config = readJson('bot-config-v15.json')

  // Monta status resumido
  const wins = results.filter(r => r.result === 'win').length
  const losses = results.filter(r => r.result === 'loss').length
  const total = wins + losses

  const status = {
    candleCount: 0,
    stats: {
      total,
      wins,
      losses,
      wr: total > 0 ? (wins / total * 100).toFixed(1) : '0.0',
      pnl: results.reduce((sum, r) => {
        if (r.result === 'win') return sum + (r.pnl || 0)
        if (r.result === 'loss') return sum - 2
        return sum
      }, 0).toFixed(2),
      openCount: 0,
      universeSize: state ? Object.keys(state).length : 0,
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

  try {
    const result = await postUpdate({ status, trades: results.slice(-200), config })
    const now = new Date().toLocaleTimeString('pt-BR')
    console.log(`[${now}] 📤 Telemetria: ${total} ops, WR ${status.stats.wr}%`)
    return result
  } catch (e) {
    console.error(`[❌] Erro: ${e.message}`)
    return null
  }
}

// Envia a cada 5 segundos
setInterval(sendTelemetry, 5000)

// Envia imediatamente
sendTelemetry()

console.log(`[📡] Telemetria ativa → ${PROXY_URL}`)
console.log(`    Ctrl+C para parar\n`)
