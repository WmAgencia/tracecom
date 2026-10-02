/**
 * IQ Option Trader - ESTRATÉGIA PULLBACK + REVERSÃO EXTREMA
 *
 * Indicadores:
 * - RSI: Extrema sobre-venda (<30) = CALL | Sobre-compra (>70) = PUT
 * - Bollinger Bands: Preço na banda inferior = CALL | Banda superior = PUT
 * - MACD: Histograma mudando de direção = sinal forte
 * - Médias Móveis: Preço retornando à MA = Pullback
 *
 * Uso: node ws-multi-v2.mjs
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;

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
// ESTRATÉGIA: PULLBACK + REVERSÃO EXTREMA
// ============================================
function getSignal(candles) {
  if (!candles || candles.length < 20) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  const highs = candles.map(c => c.max).filter(v => typeof v === 'number' && isFinite(v));
  const lows = candles.map(c => c.min).filter(v => typeof v === 'number' && isFinite(v));

  if (closes.length < 20) return null;

  const last = closes[closes.length - 1];
  if (!isFinite(last) || last === 0) return null;

  // === RSI (14 períodos) ===
  let gains = 0, losses = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / 14, avgLoss = losses / 14;
  const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  // === Bollinger Bands (20 períodos) ===
  const bbPeriod = closes.slice(-20);
  const bbSma = bbPeriod.reduce((a, b) => a + b, 0) / 20;
  const bbStd = Math.sqrt(bbPeriod.reduce((s, v) => s + Math.pow(v - bbSma, 2), 0) / 20);
  const bbUpper = bbSma + bbStd * 2;
  const bbLower = bbSma - bbStd * 2;
  const bbWidth = bbUpper - bbLower;

  // === Médias Móveis ===
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;

  // === MACD ===
  const ema = (arr, p) => {
    const k = 2 / (p + 1);
    let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  };
  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const macd = ema12 - ema26;
  const signal = ema([...Array(9).fill(macd), macd], 9);
  const histogram = macd - signal;

  // === Momentum ===
  const momentum = last - closes[closes.length - 5];
  const momentumPct = momentum / closes[closes.length - 5];

  // === SCORE ===
  let callScore = 0, putScore = 0;
  let reasons = [];

  // REVERSÃO EXTREMA - RSI (reduzido para detectar mais sinais)
  if (rsi < 30) {
    callScore += 40;
    reasons.push(`RSI ${rsi.toFixed(1)} (extrema sobrevenda)`);
  } else if (rsi < 40) {
    callScore += 25;
    reasons.push(`RSI ${rsi.toFixed(1)} (sobrevenda)`);
  }

  if (rsi > 70) {
    putScore += 40;
    reasons.push(`RSI ${rsi.toFixed(1)} (extrema sobrecompra)`);
  } else if (rsi > 60) {
    putScore += 25;
    reasons.push(`RSI ${rsi.toFixed(1)} (sobrecompra)`);
  }

  // BOLLINGER BANDS - Pullback (mais sensível)
  const distLower = (last - bbLower) / bbWidth;
  const distUpper = (bbUpper - last) / bbWidth;

  if (distLower < 0.15) {
    callScore += 35;
    reasons.push('Preço na banda inferior BB');
  } else if (distLower < 0.35) {
    callScore += 15;
    reasons.push('Próximo da banda inferior BB');
  }

  if (distUpper < 0.15) {
    putScore += 35;
    reasons.push('Preço na banda superior BB');
  } else if (distUpper < 0.35) {
    putScore += 15;
    reasons.push('Próximo da banda superior BB');
  }

  // PULLBACK - Preço retornando à média
  if (last < ma5 && last > ma10 && closes[closes.length - 2] < closes[closes.length - 3]) {
    callScore += 20;
    reasons.push('Pullback de alta');
  }
  if (last > ma5 && last < ma10 && closes[closes.length - 2] > closes[closes.length - 3]) {
    putScore += 20;
    reasons.push('Pullback de baixa');
  }

  // MACD Histogram mudando direção
  const histPrev = candles.length >= 2 ? (ema(closes.slice(-14, -1), 12) - ema(closes.slice(-28, -1), 26)) -
    ema([...Array(9).fill(ema(closes.slice(-14, -1), 12) - ema(closes.slice(-28, -1), 26))], 9).slice(-9)[0] : 0;

  if (histogram > 0 && histogram > Math.abs(histPrev)) {
    callScore += 15;
    reasons.push('MACD bullish');
  }
  if (histogram < 0 && histogram < -Math.abs(histPrev)) {
    putScore += 15;
    reasons.push('MACD bearish');
  }

  // Confiança mínima de 45% para começar a operar
  const confidence = Math.max(callScore, putScore) / 100;
  if (confidence < 0.45) return null;

  const direction = callScore > putScore ? 'CALL' : 'PUT';

  return {
    signal: direction,
    confidence,
    rsi,
    reasons: reasons.slice(0, 3),
    bbLower: bbLower.toFixed(5),
    bbUpper: bbUpper.toFixed(5),
    last: last.toFixed(5)
  };
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

      assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      console.log(`[📋] ${assets.length} activos monitorados\n`);

      for (const asset of assets) {
        candleBuffer.set(asset.activeId, []);
        ws.subscribeCandles(asset.activeId, 60); // 1 minuto para teste rápido
      }

      console.log('[⏳] Warmup 120s (precisamos de candles de 1min)...\n');
      await new Promise(r => setTimeout(r, 120_000));

      warmupEndTime = Date.now();
      console.log('[✅] ESTRATÉGIA: Pullback + Reversão Extrema\n');
    });

    let candleCount = 0;
    let lastDebugTime = 0;

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

      candleCount++;
      const now = Date.now();
      if (now - lastDebugTime > 15000) {
        lastDebugTime = now;
        console.log(`[🔍 DEBUG] Candles recebidos: ${candleCount} | Buffer sizes: ${[...candleBuffer.values()].map(b => b.length).join(', ')}`);
      }

      if (activeOperations.has(aid)) return;
      if (!warmupEndTime || Date.now() < warmupEndTime) return;

      // Reduzido para 5 candles para teste
      if (buf.length < 5) {
        if (now - lastDebugTime > 5000) console.log(`[⏳ ${assets.find(a => a.activeId === aid)?.name}] Aguardando candles: ${buf.length}/5`);
        return;
      }

      const result = getSignal(buf);
      if (!result) {
        // Debug: mostrar valores dos indicadores para o primeiro ativo
        if (aid === assets[0]?.activeId && Date.now() - (lastDebugTime + 10000) > 5000) {
          const closes = buf.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
          if (closes.length >= 14) {
            let gains = 0, losses = 0;
            for (let i = closes.length - 14; i < closes.length; i++) {
              const diff = closes[i] - closes[i - 1];
              if (diff > 0) gains += diff; else losses += Math.abs(diff);
            }
            const avgGain = gains / 14, avgLoss = losses / 14;
            const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
            const bbPeriod = closes.slice(-20);
            const bbSma = bbPeriod.reduce((a, b) => a + b, 0) / 20;
            const bbStd = Math.sqrt(bbPeriod.reduce((s, v) => s + Math.pow(v - bbSma, 2), 0) / 20);
            const bbUpper = bbSma + bbStd * 2;
            const bbLower = bbSma - bbStd * 2;
            const last = closes[closes.length - 1];
            const distLower = (last - bbLower) / (bbUpper - bbLower);
            console.log(`[🔬 DEBUG] RSI: ${rsi.toFixed(1)} | Preço: ${last.toFixed(5)} | BB Lower: ${bbLower.toFixed(5)} | distLower: ${distLower.toFixed(2)}`);
          }
        }
        return;
      }

      const asset = assets.find(a => a.activeId === aid);
      const assetName = asset?.name ?? String(aid);

      // Verificar expiração de operações antigas
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

      console.log(`[📊 ${assetName}] ${result.signal} | RSI:${result.rsi.toFixed(1)} | Conf:${(result.confidence*100).toFixed(0)}% | ${result.reasons.join(' | ')}`);
    });

    ws.on('option-opened', (msg) => {
      console.log('[✅ ORDEM ABERTA]', JSON.stringify(msg?.msg ?? msg));
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

      console.log(`[${result === 'win' ? '✅' : '❌'}] ${op.name} | ${op.direction} | RSI:${op.rsi?.toFixed(1)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.length;
      const wr = ((wins / total) * 100).toFixed(1);
      console.log(`[📈] Total: ${total} | Wins: ${wins} | Losses: ${total - wins} | WR: ${wr}%\n`);

      fs.writeFileSync('D:/Tracecom project/resultados.json', JSON.stringify(resultados, null, 2));
    });

    await ws.connect({ ssid });

    while (running) {
      await new Promise(r => setTimeout(r, 3000));
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
