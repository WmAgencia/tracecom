/**
 * ESTRATÉGIAS TraceCom v3 - FOCADO
 * ===================================
 * Apenas ativos que historicamente tiveram bom desempenho
 *
 * Estratégias:
 * 1. Fade3 - contra 3 velas consecutivas
 * 2. RSI2 Extreme - RSI(2) < 10 → CALL, RSI(2) > 90 → PUT
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 100;

// Ativos que historicamente performaram melhor
const GOOD_ASSETS = ['JAPAN225', 'NAS', 'SPX', 'GOLD', 'SILVER'];

// ============================================
// RSI(2) Extreme - mais responsivo
// ============================================
function calculateRSI2(closes) {
  const period = 2;
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

function getSignal(candles) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  // RSI2 Extreme
  const rsi2 = calculateRSI2(closes);
  if (Number.isFinite(rsi2)) {
    if (rsi2 < 10) {
      return { signal: 'CALL', strategy: 'RSI2-extreme', rsi: rsi2 };
    }
    if (rsi2 > 90) {
      return { signal: 'PUT', strategy: 'RSI2-extreme', rsi: rsi2 };
    }
  }

  // Fade3
  if (closes.length >= 4) {
    const a = closes[closes.length - 1] > closes[closes.length - 2];
    const b = closes[closes.length - 2] > closes[closes.length - 3];
    const c = closes[closes.length - 3] > closes[closes.length - 4];
    if (a && b && c) {
      return { signal: 'PUT', strategy: 'Fade3', rsi: 50 };
    }
    if (!a && !b && !c) {
      return { signal: 'CALL', strategy: 'Fade3', rsi: 50 };
    }
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

    const candleBuffer = new Map();
    const activeOperations = new Map();
    const resultados = [];

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

      // Filtrar ativos que historicamente performaram bem
      const assets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
        .filter(([_, a]) => GOOD_ASSETS.some(g => a.name.toUpperCase().includes(g)))
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      // Se não encontrar nenhum, usar todos
      if (assets.length === 0) {
        const allAssets = Object.entries(turboActives)
          .filter(([_, a]) => a.name && !/otc/i.test(a.name) && a.enabled && !a.is_suspended)
          .map(([id, act]) => ({ activeId: Number(id), name: act.name }));
        assets.push(...allAssets.slice(0, 15));
      }

      console.log(`[📋] ${assets.length} activos monitorados`);
      console.log(`[📋] Ativos: ${assets.map(a => a.name).join(', ')}\n`);

      for (const asset of assets) {
        candleBuffer.set(asset.activeId, { candles: [], asset });
        ws.subscribeCandles(asset.activeId, 60);
      }

      console.log('[⏳] Warmup 90s...\n');
      await new Promise(r => setTimeout(r, 90_000));

      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! Fade3 + RSI2-extreme\n');
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const buf = candleBuffer.get(aid);
      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        const idx = buf.candles.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf.candles[idx] = c;
        else buf.candles.push(c);
        if (buf.candles.length > 50) buf.candles.shift();
      } catch { return; }

      if (activeOperations.has(aid)) return;
      if (!warmupEndTime || Date.now() < warmupEndTime) return;

      const result = getSignal(buf.candles);
      if (!result) return;

      const { expiration, optionTypeId } = computeExpiration(Math.floor((ws.serverNow() ?? Date.now()) / 1000), 5);

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
        name: buf.asset.name,
        direction: result.signal,
        strategy: result.strategy,
        expiration,
        rsi: result.rsi,
        openedAt: Date.now()
      });

      console.log(`[📊 ${buf.asset.name}] ${result.strategy} ${result.signal} | RSI: ${result.rsi?.toFixed(1) || 'N/A'}`);

      resultados.push({
        active: buf.asset.name,
        direction: result.signal,
        strategy: result.strategy,
        timestamp: new Date().toISOString()
      });
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

      const idx = resultados.findIndex(r => r.active === op.name && r.strategy === op.strategy && !r.result);
      if (idx >= 0) {
        resultados[idx].result = result;
        resultados[idx].profit = profit;
      }

      activeOperations.delete(aid);

      // Estatísticas
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      if (total > 0) {
        const wr = ((wins / total) * 100).toFixed(1);
        const profit = resultados.filter(r => r.result).reduce((s, r) => s + (r.profit || 0), 0);
        console.log(`[📈] Total: ${total} | Wins: ${wins} | WR: ${wr}% | Lucro: R$${profit.toFixed(2)}\n`);
        fs.writeFileSync('D:/Tracecom project/resultados-tracecom-v3.json', JSON.stringify(resultados, null, 2));
      }
    });

    await ws.connect({ ssid });

    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      const opsAtivas = activeOperations.size;
      if (total > 0) {
        process.stdout.write(`\r[⏱️] Ops: ${total} | Ativas: ${opsAtivas} | WR: ${((wins/total)*100).toFixed(0)}%   `);
      }
    }

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

main();
