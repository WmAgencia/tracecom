/**
 * IQ Option Trader - ESTRATÉGIA SIMPLES RSI EXTREMO
 * Foco: Operar quando RSI atingir extremos (sobrecompra/sobrevenda)
 * Usa candles de 1 minuto, aquece por 2 minutos
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;

const RESULTADOS_FILE = 'D:/Tracecom project/resultados.json';

// State
const candleBuffer = new Map();
const activeOperations = new Map();
const resultados = [];
let assets = [];
let ws = null;
let balanceId = null;
let warmupEndTime = null;
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

// ============================================
// ESTRATÉGIA RSI EXTREMO (MUITO SIMPLES)
// ============================================
function getSignal(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  const last = closes[closes.length - 1];
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

  // Direção das últimas 2 velas
  const lastUp = candles[candles.length - 1]?.close > candles[candles.length - 1]?.open;
  const prevUp = candles[candles.length - 2]?.close > candles[candles.length - 2]?.open;

  let callScore = 0, putScore = 0;
  let reasons = [];

  // RSI Extremo - o sinal principal
  if (rsi < 30) {
    callScore += 50;
    reasons.push(`RSI ${rsi.toFixed(0)}`);
  } else if (rsi < 35) {
    callScore += 30;
    reasons.push(`RSI ${rsi.toFixed(0)}`);
  }

  if (rsi > 70) {
    putScore += 50;
    reasons.push(`RSI ${rsi.toFixed(0)}`);
  } else if (rsi > 65) {
    putScore += 30;
    reasons.push(`RSI ${rsi.toFixed(0)}`);
  }

  // Preço cruzou média (confirmação)
  if (last > ma3 && closes[closes.length - 2] <= ma3) {
    callScore += 20;
    reasons.push('Cruzou MA');
  }
  if (last < ma3 && closes[closes.length - 2] >= ma3) {
    putScore += 20;
    reasons.push('Cruzou MA');
  }

  // Vela de reversão (fechou no oposto da tendência)
  if (lastUp && !prevUp) {
    callScore += 15;
    reasons.push('Vela alta');
  }
  if (!lastUp && prevUp) {
    putScore += 15;
    reasons.push('Vela baixa');
  }

  const confidence = Math.max(callScore, putScore) / 100;
  if (confidence < 0.50) return null;

  const direction = callScore > putScore ? 'CALL' : 'PUT';

  return { signal: direction, confidence, rsi, reasons };
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

      // Subscrever a todos com candles de 1 minuto
      for (const asset of assets) {
        candleBuffer.set(asset.activeId, []);
        ws.subscribeCandles(asset.activeId, 60); // 1 minuto
      }

      console.log('[⏳] Warmup 2min...\n');
      await new Promise(r => setTimeout(r, 120_000));

      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! Operando...\n');
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
        if (buf.length > 20) buf.shift();
      } catch { return; }

      if (activeOperations.has(aid)) return;
      if (!warmupEndTime || Date.now() < warmupEndTime) return;
      if (buf.length < 5) return;

      const result = getSignal(buf);
      if (!result) return;

      const asset = assets.find(a => a.activeId === aid);
      const assetName = asset?.name ?? String(aid);

      // Verificar expiração
      const op = activeOperations.get(aid);
      if (op && Date.now() > op.expiration * 1000 + 30_000) {
        activeOperations.delete(aid);
      } else if (op) {
        return;
      }

      const serverTs = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
      const { expiration, optionTypeId } = computeExpiration(serverTs, 5);

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
        name: assetName,
        direction: result.signal,
        expiration,
        openedAt: Date.now(),
        confidence: result.confidence,
        rsi: result.rsi
      });

      console.log(`[📊 ${assetName}] ${result.signal} | RSI:${result.rsi.toFixed(0)} | Conf:${(result.confidence*100).toFixed(0)}% | ${result.reasons.join(' | ')}`);
    });

    ws.on('option-opened', (msg) => {
      console.log('[✅ ABERTA]', JSON.stringify(msg?.msg ?? msg).substring(0, 100));
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
        confidence: op.confidence,
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

main();
