/**
 * IQ Option Trader - ESTRATÉGIA SIMPLES DE REVERSÃO
 * Pega candles históricos e opera imediatamente
 * Foco: 60%+ WR através de sinais de reversão claros
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;

const RESULTADOS_FILE = 'D:/Tracecom project/resultados.json';

// State
const activeOperations = new Map();
const resultados = [];
let assets = [];
let ws = null;
let balanceId = null;
let running = true;

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

// Buscar candles históricos via WebSocket (5 minutos)
async function getHistoricalCandles(activeId) {
  try {
    const result = await ws.getCandlesHistory({ activeId, size: 60, count: 10 });
    const data = result?.msg ?? result;
    if (data?.candles && Array.isArray(data.candles)) {
      return data.candles;
    }
    return [];
  } catch (e) {
    console.log(`[ERRO] Candles para ${activeId}:`, e.message);
    return [];
  }
}

// ============================================
// ESTRATÉGIA SIMPLES DE REVERSÃO
// ============================================
function getSignal(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const prev2 = closes[closes.length - 3];

  if (!isFinite(last) || last === 0) return null;

  // RSI rápido (7 períodos)
  let gains = 0, losses = 0;
  for (let i = closes.length - 7; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / 7, avgLoss = losses / 7;
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  // Médias simples
  const ma3 = closes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;

  // Momentum
  const momentum = last - closes[closes.length - 3];
  const momentumPct = (momentum / closes[closes.length - 3]) * 100;

  // Direção das últimas 3 velas
  const dir = candles.slice(-3).map(c => c.close > c.open ? 1 : -1);
  const dirSum = dir.reduce((a, b) => a + b, 0);

  let callScore = 0, putScore = 0;
  let reasons = [];

  // RSI Extremo
  if (rsi < 30) { callScore += 40; reasons.push(`RSI ${rsi.toFixed(0)}`); }
  else if (rsi < 40) { callScore += 20; reasons.push(`RSI ${rsi.toFixed(0)}`); }

  if (rsi > 70) { putScore += 40; reasons.push(`RSI ${rsi.toFixed(0)}`); }
  else if (rsi > 60) { putScore += 20; reasons.push(`RSI ${rsi.toFixed(0)}`); }

  // Preço cruzou abaixo da MA3 (possível reversão de alta)
  if (last > ma3 && prev < ma3) { callScore += 25; reasons.push('Cruzamento alta'); }
  if (last < ma3 && prev > ma3) { putScore += 25; reasons.push('Cruzamento baixa'); }

  // Momentum revertendo
  if (momentumPct > 0.5 && dirSum >= 2) { callScore += 15; reasons.push('Momentum alta'); }
  if (momentumPct < -0.5 && dirSum <= -2) { putScore += 15; reasons.push('Momentum baixa'); }

  // Pullback: 3 velas no mesmo sentido, possível reversão
  if (dirSum === -3) { callScore += 20; reasons.push('Pullback CALL'); }
  if (dirSum === 3) { putScore += 20; reasons.push('Pullback PUT'); }

  const confidence = Math.max(callScore, putScore) / 100;
  if (confidence < 0.50) return null;

  const direction = callScore > putScore ? 'CALL' : 'PUT';
  const conf = (confidence * 100).toFixed(0);

  return { signal: direction, confidence, rsi, reasons, conf };
}

async function main() {
  try {
    const ssid = await login();
    ws = new IqWsClient({ log: () => {} });

    ws.on('ready', async () => {
      console.log('[WS] Ready!');

      // Pegar saldo
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

      // Pegar activos
      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      console.log(`[📋] ${assets.length} activos disponíveis\n`);

      // Buscar candles históricos para todos os ativos
      console.log('[⏳] Buscando candles históricos...\n');
      const historicalCandles = new Map();

      for (const asset of assets) {
        const candles = await getHistoricalCandles(asset.activeId);
        historicalCandles.set(asset.activeId, candles);
        console.log(`[📊 ${asset.name}] ${candles.length} candles históricos`);
      }

      console.log('\n[✅] INICIANDO OPERAÇÕES...\n');

      // Loop principal - buscar candles frescos a cada iteração
      setInterval(async () => {
        if (!running) return;

        for (const asset of assets) {
          if (activeOperations.has(asset.activeId)) continue;

          // Buscar candles frescos
          const candles = await getHistoricalCandles(asset.activeId);
          const result = getSignal(candles);

          if (!result) continue;

          const serverTs = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
          const { expiration, optionTypeId } = computeExpiration(serverTs, 5);

          ws.placeOrder({
            price: TRADE_AMOUNT,
            activeId: asset.activeId,
            direction: result.signal,
            expiration,
            optionTypeId,
            balanceId
          });

          tradeCounter++;
          activeOperations.set(asset.activeId, {
            name: asset.name,
            direction: result.signal,
            expiration,
            rsi: result.rsi,
            confidence: result.confidence
          });

          console.log(`[📊 ${asset.name}] ${result.signal} | RSI:${result.rsi.toFixed(0)} | Conf:${result.conf}% | ${result.reasons.join(' | ')}`);
        }
      }, 10000); // A cada 10 segundos
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;
      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid) return;

      const op = activeOperations.get(aid);
      if (!op) return;

      // Verificar se expirou
      if (Date.now() / 1000 > op.expiration + 30) {
        activeOperations.delete(aid);
      }
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

      console.log(`[${result === 'win' ? '✅' : '❌'}] ${op.name} | ${op.direction} | RSI:${op.rsi?.toFixed(0)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.length;
      const wr = ((wins / total) * 100).toFixed(1);
      console.log(`[📈] Total: ${total} | Wins: ${wins} | Losses: ${total - wins} | WR: ${wr}%\n`);

      fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(resultados, null, 2));
    });

    await ws.connect({ ssid });

  } catch (err) {
    console.error('[FATAL]', err);
  }
}

main();
