/**
 * IQ Option Trader - ESTRATÉGIA RSI14 h5
 *
 * Implementação exata baseada no TraceCom:
 * - RSI(14) Wilder < 30 → CALL (up)
 * - RSI(14) Wilder > 70 → PUT (down)
 * - Timeframe: 1 minuto
 * - Horizonte: 5 candles = 300 segundos (5 min)
 *
 * Ativos: UK-100, US2000
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;

const RESULTADOS_FILE = 'D:/Tracecom project/resultados-rsi14h5.json';

// State
const candleBuffer = new Map();
const activeOperations = new Map();
const resultados = [];
let ws = null;
let balanceId = null;
let warmupEndTime = null;
let running = true;

// Lista de ativos a monitorar (UK-100 e US2000)
const TARGET_ASSETS = ['UK100:N', 'US2000:N'];

// ============================================
// RSI(14) WILDERR (exatamente como no TraceCom)
// ============================================
function calculateRSI14(closes) {
  const period = 14;
  if (closes.length < period + 1) return NaN;

  let avgGain = 0, avgLoss = 0;

  // SMA inicial para os primeiros 'period' valores
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }

  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) return 100;

  let rsi = 100 - (100 / (1 + avgGain / avgLoss));

  // Smoothed RSI (Wilder)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) rsi = 100;
    else rsi = 100 - (100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

// ============================================
// ESTRATÉGIA RSI14 h5 (exatamente como no TraceCom)
// ============================================
function getSignal(candles) {
  if (!candles || candles.length < 15) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 15) return null;

  const rsi = calculateRSI14(closes);
  if (!Number.isFinite(rsi)) return null;

  // Regras exatas do TraceCom
  if (rsi < 30) {
    return { signal: 'CALL', rsi, reasons: [`RSI14 ${rsi.toFixed(1)} < 30`] };
  }

  if (rsi > 70) {
    return { signal: 'PUT', rsi, reasons: [`RSI14 ${rsi.toFixed(1)} > 70`] };
  }

  return null;
}

async function main() {
  try {
    const ssid = await login();
    ws = new IqWsClient({ log: () => {} });

    ws.on('ready', async () => {
      console.log('[WS] Ready!');

      const balMsg = await ws.getBalances();
      const balData = balMsg?.msg ?? balMsg;
      const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
      const conta = balances.find(b => b.type === 4) || balances[0];

      if (!conta || conta.amount <= 0) {
        console.error('[ERRO] Sem saldo'); ws.close(); return;
      }

      balanceId = conta.id;
      const tipo = conta.type === 0 ? 'REAL' : conta.type === 4 ? 'DEMO' : 'PRÁTICA';
      console.log(`[💼 CONTA] ${tipo} | Saldo: R$${conta.amount.toFixed(2)}\n`);

      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      // Filtrar apenas UK-100 e US2000
      const allAssets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      // Matching flexível para encontrar os ativos
      const targetAssets = allAssets.filter(a =>
        TARGET_ASSETS.some(t =>
          a.name.toUpperCase().includes(t.toUpperCase()) ||
          a.name.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        )
      );

      if (targetAssets.length === 0) {
        console.log('[⚠️] Ativos não encontrados. Usando todos os disponíveis.');
        console.log('[📋] Ativos:', allAssets.map(a => a.name).join(', '));
        targetAssets.push(...allAssets.slice(0, 10));
      }

      console.log(`[📋] Ativos monitorados: ${targetAssets.map(a => a.name).join(', ')}\n`);

      for (const asset of targetAssets) {
        candleBuffer.set(asset.activeId, []);
        ws.subscribeCandles(asset.activeId, 60); // 1 minuto
      }

      console.log('[⏳] Warmup 2min para RSI14...\n');
      await new Promise(r => setTimeout(r, 120_000));

      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! RSI14 h5 - Expiração 5min\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const buf = candleBuffer.get(aid);
      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        const idx = buf.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf[idx] = c;
        else buf.push(c);
        if (buf.length > 50) buf.shift();
      } catch { return; }

      if (activeOperations.has(aid)) return;
      if (!warmupEndTime || Date.now() < warmupEndTime) return;
      if (buf.length < 15) return;

      const result = getSignal(buf);
      if (!result) return;

      const assetEntry = [...(new Map([...candleBuffer.entries()].map(([k]) => [k, null]))).keys()]
        .find(k => {
          const initMsg = ws.getInitializationData?.();
          return k === aid;
        });

      console.log(`[📊 AID:${aid}] ${result.signal} | RSI14: ${result.rsi.toFixed(1)} | ${result.reasons.join(', ')}`);

      const op = activeOperations.get(aid);
      if (op && Date.now() > op.expiration * 1000 + 30_000) {
        activeOperations.delete(aid);
      } else if (op) {
        return;
      }

      const serverTs = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
      const { expiration, optionTypeId } = computeExpiration(serverTs, 5); // h5 = 5 minutos

      ws.placeOrder({
        price: TRADE_AMOUNT,
        activeId: aid,
        direction: result.signal,
        expiration,
        optionTypeId,
        balanceId
      });

      activeOperations.set(aid, {
        activeId: aid,
        name: `AID:${aid}`,
        direction: result.signal,
        expiration,
        openedAt: Date.now(),
        rsi: result.rsi
      });

      console.log(`[🚀 OPERAÇÃO] ${result.signal} | RSI14: ${result.rsi.toFixed(1)} | 5min | ${result.reasons.join(', ')}`);
    });

    ws.on('socket-option-closed', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId;
      const op = activeOperations.get(aid);
      if (!op) return;

      const profit = raw.profit ?? 0;
      const result = profit > 0 ? 'win' : 'loss';

      resultados.push({
        active: op.name,
        direction: op.direction,
        result,
        profit,
        rsi: op.rsi,
        timestamp: new Date().toISOString()
      });

      activeOperations.delete(aid);

      const emoji = result === 'win' ? '✅' : '❌';
      console.log(`[${emoji}] ${op.name} | ${op.direction} | RSI14:${op.rsi?.toFixed(1)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.length;
      const wr = ((wins / total) * 100).toFixed(1);
      console.log(`[📈] Total: ${total} | Wins: ${wins} | Losses: ${total - wins} | WR: ${wr}%\n`);

      fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(resultados, null, 2));
    });

    await ws.connect({ ssid });

    while (running) {
      await new Promise(r => setTimeout(r, 5000));
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.length;
      const opsAtivas = activeOperations.size;
      if (total > 0) {
        process.stdout.write(`\r[⏱️] Ops: ${total} | Ativas: ${opsAtivas} | WR: ${((wins/total)*100).toFixed(0)}%   `);
      }
    }

    ws.close();
  } catch (err) {
    console.error('[FATAL]', err);
  } finally {
    ws?.close();
    process.exit(0);
  }
}

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function login() {
  console.log('[LOGIN] Fazendo login...');
  const data = JSON.stringify({ identifier: EMAIL, password: PASSWORD });
  const res = await httpRequest({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  const json = JSON.parse(res.body);
  const ssid = json.result?.ssid ?? json.ssid;
  if (!ssid) throw new Error('Login falhou');
  console.log(`[LOGIN] OK!`);
  return ssid;
}

main();
