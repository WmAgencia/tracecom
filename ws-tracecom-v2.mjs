/**
 * ESTRATÉGIAS TraceCom v2 - Otimizado para Mercado Real
 * ========================================================
 * - RSI14 em 5min: RSI < 35 → CALL | RSI > 65 → PUT
 * - Fade3 em 1min: contra 3 velas consecutivas
 *
 * Prioridade: RSI14 primeiro, depois Fade3
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;

// ============================================
// RSI(14) Wilder com EMA smoothing
// ============================================
function calculateRSI14(closes) {
  const period = 14;
  if (closes.length < period + 1) return NaN;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;

  let rsi = 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

// ============================================
// Estratégia RSI14 5min (limiares relaxados)
// ============================================
function getSignalRSI14(candles) {
  if (!candles || candles.length < 15) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 15) return null;

  const rsi = calculateRSI14(closes);
  if (!Number.isFinite(rsi)) return null;

  // Limiares mais relaxados para 5min
  if (rsi < 35) {
    return { signal: 'CALL', rsi, strategy: 'RSI14-5m' };
  }
  if (rsi > 65) {
    return { signal: 'PUT', rsi, strategy: 'RSI14-5m' };
  }
  return null;
}

// ============================================
// Estratégia Fade3 1min
// ============================================
function getSignalFade3(candles) {
  if (!candles || candles.length < 4) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 4) return null;

  const a = closes[closes.length - 1] > closes[closes.length - 2];
  const b = closes[closes.length - 2] > closes[closes.length - 3];
  const c = closes[closes.length - 3] > closes[closes.length - 4];

  if (a && b && c) {
    return { signal: 'PUT', rsi: 50, strategy: 'Fade3' };
  }
  if (!a && !b && !c) {
    return { signal: 'CALL', rsi: 50, strategy: 'Fade3' };
  }
  return null;
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
  console.log(`[LOGIN] OK!\n`);
  return ssid;
}

async function main() {
  try {
    const ssid = await login();
    const ws = new IqWsClient({ log: () => {} });

    // Buffers separados para cada timeframe
    const candleBuffer5m = new Map(); // RSI14 usa 5min
    const candleBuffer1m = new Map(); // Fade3 usa 1min
    const activeOperations = new Map();
    const resultadosRSI = [];
    const resultadosFade = [];

    let balanceId = null;
    let warmupEndTime = null;

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
      console.log(`[💼 CONTA] DEMO | Saldo: R$${conta.amount.toFixed(2)}\n`);

      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      const assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      console.log(`[📋] ${assets.length} activos disponíveis\n`);

      // Subscrever em ambos timeframes
      for (const asset of assets) {
        candleBuffer5m.set(asset.activeId, { candles: [], asset });
        candleBuffer1m.set(asset.activeId, { candles: [], asset });
        ws.subscribeCandles(asset.activeId, 300); // 5 min
        ws.subscribeCandles(asset.activeId, 60);  // 1 min
      }

      console.log('[⏳] Warmup 3min...\n');
      await new Promise(r => setTimeout(r, 180_000));

      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! RSI14-5m + Fade3-1m\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid) return;

      // Verificar timeframe pelo tamanho do candle (aproximado)
      const ts = raw.from ?? raw.timestamp ?? raw.t ?? 0;
      const candleSize = (raw.to ?? 0) - ts;
      const is5min = candleSize >= 240; // 5min = 300s

      const buf = is5min ? candleBuffer5m.get(aid) : candleBuffer1m.get(aid);
      if (!buf) return;

      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        const idx = buf.candles.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf.candles[idx] = c;
        else buf.candles.push(c);
        if (buf.candles.length > 50) buf.candles.shift();
      } catch { return; }

      if (activeOperations.has(aid)) return;
      if (!warmupEndTime || Date.now() < warmupEndTime) return;

      const candles = buf.candles;

      // Testar RSI14 (5min) primeiro - prioridade
      const rsiResult = getSignalRSI14(candles);
      if (rsiResult && is5min) {
        const { expiration, optionTypeId } = computeExpiration(Math.floor((ws.serverNow() ?? Date.now()) / 1000), 5);

        ws.placeOrder({
          price: TRADE_AMOUNT,
          activeId: aid,
          direction: rsiResult.signal,
          expiration,
          optionTypeId,
          balanceId
        });

        activeOperations.set(aid, {
          activeId: aid,
          name: buf.asset.name,
          direction: rsiResult.signal,
          strategy: 'RSI14',
          expiration,
          rsi: rsiResult.rsi,
          openedAt: Date.now()
        });

        console.log(`[📊 ${buf.asset.name}] RSI14-5m ${rsiResult.signal} | RSI: ${rsiResult.rsi.toFixed(1)}`);
        return;
      }

      // Testar Fade3 (1min)
      const fadeResult = getSignalFade3(candles);
      if (fadeResult && !is5min && !activeOperations.has(aid)) {
        const { expiration, optionTypeId } = computeExpiration(Math.floor((ws.serverNow() ?? Date.now()) / 1000), 5);

        ws.placeOrder({
          price: TRADE_AMOUNT,
          activeId: aid,
          direction: fadeResult.signal,
          expiration,
          optionTypeId,
          balanceId
        });

        activeOperations.set(aid, {
          activeId: aid,
          name: buf.asset.name,
          direction: fadeResult.signal,
          strategy: 'Fade3',
          expiration,
          rsi: fadeResult.rsi,
          openedAt: Date.now()
        });

        console.log(`[📊 ${buf.asset.name}] Fade3 ${fadeResult.signal} | Contra 3 velas`);
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
      const emoji = result === 'win' ? '✅' : '❌';

      console.log(`[${emoji}] ${op.name} | ${op.strategy} | ${op.direction} | RSI:${op.rsi?.toFixed(1)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      if (op.strategy === 'RSI14') {
        resultadosRSI.push({ active: op.name, direction: op.direction, result, profit, rsi: op.rsi, timestamp: new Date().toISOString() });
        const wins = resultadosRSI.filter(r => r.result === 'win').length;
        const total = resultadosRSI.filter(r => r.result).length;
        if (total > 0) console.log(`[📈 RSI14] Total: ${total} | Wins: ${wins} | WR: ${((wins/total)*100).toFixed(0)}%`);
        fs.writeFileSync('D:/Tracecom project/resultados-rsi14h5.json', JSON.stringify(resultadosRSI, null, 2));
      } else {
        resultadosFade.push({ active: op.name, direction: op.direction, result, profit, rsi: op.rsi, timestamp: new Date().toISOString() });
        const wins = resultadosFade.filter(r => r.result === 'win').length;
        const total = resultadosFade.filter(r => r.result).length;
        if (total > 0) console.log(`[📈 Fade3] Total: ${total} | Wins: ${wins} | WR: ${((wins/total)*100).toFixed(0)}%`);
        fs.writeFileSync('D:/Tracecom project/resultados-fade3.json', JSON.stringify(resultadosFade, null, 2));
      }

      activeOperations.delete(aid);
      console.log('');
    });

    await ws.connect({ ssid });

    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      const rsiWins = resultadosRSI.filter(r => r.result === 'win').length;
      const rsiTotal = resultadosRSI.filter(r => r.result).length;
      const fadeWins = resultadosFade.filter(r => r.result === 'win').length;
      const fadeTotal = resultadosFade.filter(r => r.result).length;

      process.stdout.write(
        `\r[⏱️] RSI14: ${rsiTotal} ops | WR: ${rsiTotal > 0 ? ((rsiWins/rsiTotal)*100).toFixed(0) : 0}% | Fade3: ${fadeTotal} ops | WR: ${fadeTotal > 0 ? ((fadeWins/fadeTotal)*100).toFixed(0) : 0}%   `
      );
    }

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

main();
