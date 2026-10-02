/**
 * OTC BOT v6.1 - AUTO-LEARNING (USDHKD + LTCUSD only, gate 60%)
 * =================================================================
 * Estratégia: Fade3, candles 5s, expiração 1min
 * WR gate mínimo: 60% (estimado)
 * Auto-kill: desativa ativo se WR real < 45% após 6+ ops
 * Auto-pause: 3 losses seguidas → pausa 5min
 * Auto-revive: reativa se WR volta pra ≥55% com +5 ops
 *
 * Ativos: USDHKD (CALL), LTCUSD (PUT)
 * Valor: R$2/op (profit vem real da IQ Option)
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 2;
const EXPIRATION_MIN = 1;
const CANDLE_SIZE = 5;
const MIN_CANDLES = 3;
const COOLDOWN_MS = 65_000;
const DEDUP_MS = 500;

const LEARNING = {
  minSampleSize: 6,
  killWR: 0.45,
  weightHistorical: 0.6,    // reduzido: mais peso no observado
  weightObserved: 0.4,
  minWRToTrade: 60,         // ⬅️ GATE 60%
  lossStreakLimit: 3,
  lossStreakCooldown: 300_000,
  persistenceFile: 'D:/Tracecom project/learning-state.json',
};

// Apenas 2 ativos validados
const VALIDATED_ASSETS = [
  { names: ['USDHKD', 'USD-HKD'], direction: 'CALL', wr: 57.4, edge: 7.4 },
  { names: ['LTCUSD', 'Litecoin'], direction: 'PUT', wr: 56.6, edge: 6.6 },
];

let learningState = {};
try {
  if (fs.existsSync(LEARNING.persistenceFile)) {
    learningState = JSON.parse(fs.readFileSync(LEARNING.persistenceFile, 'utf8'));
  }
} catch { /* fresh */ }

for (const va of VALIDATED_ASSETS) {
  const key = va.names[0];
  if (!learningState[key]) {
    learningState[key] = {
      key,
      historicalWR: va.wr,
      direction: va.direction,
      observedWins: 0,
      observedTotal: 0,
      rollingWR: va.wr,
      estimatedWR: va.wr,
      disabled: false,
      disabledReason: null,
      consecutiveLosses: 0,
      pausedUntil: 0,
      lastLossAt: 0,
      lastWinAt: 0,
      totalProfit: 0,         // lucro REAL acumulado
    };
  }
  learningState[key].historicalWR = va.wr;
  learningState[key].direction = va.direction;
}

function getKey(assetName) {
  for (const va of VALIDATED_ASSETS) {
    if (va.names.some(n => assetName.toUpperCase().includes(n.toUpperCase()))) {
      return va.names[0];
    }
  }
  return null;
}

function updateLearning(assetKey, result, profit) {
  const s = learningState[assetKey];
  if (!s) return;
  s.observedTotal++;
  s.totalProfit += profit || 0;
  if (result === 'win') {
    s.observedWins++;
    s.consecutiveLosses = 0;
    s.lastWinAt = Date.now();
  } else {
    s.consecutiveLosses++;
    s.lastLossAt = Date.now();
    if (s.consecutiveLosses >= LEARNING.lossStreakLimit) {
      s.pausedUntil = Date.now() + LEARNING.lossStreakCooldown;
      console.log(`[🧠 PAUSE] ${assetKey}: ${s.consecutiveLosses} losses → pausa 5min`);
      s.consecutiveLosses = 0;
    }
  }
  s.rollingWR = s.observedTotal > 0 ? (s.observedWins / s.observedTotal) * 100 : s.historicalWR;
  s.estimatedWR = LEARNING.weightHistorical * s.historicalWR + LEARNING.weightObserved * s.rollingWR;
  if (s.observedTotal >= LEARNING.minSampleSize && s.rollingWR < LEARNING.killWR * 100) {
    if (!s.disabled) {
      s.disabled = true;
      s.disabledReason = `WR ${s.rollingWR.toFixed(1)}% < ${LEARNING.killWR*100}% após ${s.observedTotal} ops`;
      console.log(`[🧠 KILL] ${assetKey}: ${s.disabledReason}`);
    }
  }
  if (s.disabled && s.observedTotal >= LEARNING.minSampleSize + 5 && s.rollingWR >= 55) {
    s.disabled = false;
    s.disabledReason = null;
    console.log(`[🧠 REVIVE] ${assetKey} (WR ${s.rollingWR.toFixed(1)}%)`);
  }
  persistLearning();
}

function persistLearning() {
  try {
    fs.writeFileSync(LEARNING.persistenceFile, JSON.stringify(learningState, null, 2));
  } catch {}
}

function shouldTrade(assetKey) {
  const s = learningState[assetKey];
  if (!s) return { ok: false, reason: 'sem dados' };
  if (s.disabled) return { ok: false, reason: `OFF: ${s.disabledReason}` };
  if (Date.now() < s.pausedUntil) return { ok: false, reason: `pausado` };
  // Gate de 60% só vale APÓS ter amostra mínima (6+ ops)
  if (s.observedTotal >= LEARNING.minSampleSize && s.estimatedWR < LEARNING.minWRToTrade) {
    return { ok: false, reason: `WR-ajustado ${s.estimatedWR.toFixed(1)}% < ${LEARNING.minWRToTrade}% (após ${s.observedTotal} ops)` };
  }
  return { ok: true };
}

function getValidatedPattern(assetName) {
  for (const va of VALIDATED_ASSETS) {
    if (va.names.some(n => assetName.toUpperCase().includes(n.toUpperCase()))) return va;
  }
  return null;
}

const candleBuffer = new Map();
const activeOperations = new Map();
const resultados = [];

function pushCandle(buf, raw) {
  const at = Number(raw.at ?? raw.timestamp);
  let atMs = at > 1e15 ? Math.round(at / 1e6) : at > 1e12 ? Math.round(at) : at * 1000;
  if (buf.ticks.length > 0 && Math.abs(buf.ticks[buf.ticks.length - 1].atMs - atMs) < DEDUP_MS) return false;
  const close = Number(raw.close);
  if (!Number.isFinite(close)) return false;
  buf.ticks.push({ atMs, close });
  if (buf.ticks.length > 100) buf.ticks.shift();
  return true;
}

function getSignal(buf, assetName) {
  const validated = getValidatedPattern(assetName);
  if (!validated || buf.ticks.length < MIN_CANDLES) return null;
  const t = buf.ticks.slice(-3);
  if (Date.now() - t[t.length - 1].atMs > 30_000) return null;
  const a = t[0].close < t[1].close;
  const b = t[1].close < t[2].close;
  if (a && b && validated.direction === 'PUT') return { signal: 'PUT', expected: validated.wr, edge: validated.edge };
  if (!a && !b && validated.direction === 'CALL') return { signal: 'CALL', expected: validated.wr, edge: validated.edge };
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
  const data = JSON.stringify({ identifier: EMAIL, password: PASSWORD });
  const res = await httpRequest({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  const json = JSON.parse(res.body);
  return json.result?.ssid ?? json.ssid;
}

async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK!\n');

  const ws = new IqWsClient({ log: () => {} });
  let balanceId = null;
  let warmupEndTime = null;

  ws.on('ready', async () => {
    console.log('[WS] Ready!');
    const balMsg = await ws.getBalances();
    const balData = balMsg?.msg ?? balMsg;
    const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
    const conta = balances.find(b => b.type === 4) || balances[0];
    if (!conta || conta.amount <= 0) { console.error('[ERRO] Sem saldo'); ws.close(); return; }
    balanceId = conta.id;
    console.log(`[💼 CONTA] DEMO | Saldo: R$${conta.amount.toFixed(2)}\n`);

    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};

    console.log('='.repeat(70));
    console.log('🧠 BOT v6.1 - USDHKD + LTCUSD | Gate WR ≥ 60%');
    console.log('='.repeat(70));
    console.log('\n📋 Estado aprendido:');
    for (const va of VALIDATED_ASSETS) {
      const k = va.names[0];
      const s = learningState[k];
      const status = s.disabled ? '❌ OFF' : '✅ ON';
      console.log(`   ${status} ${k.padEnd(10)} hist:${s.historicalWR}% obs:${s.rollingWR.toFixed(1)}% (${s.observedWins}/${s.observedTotal}) est:${s.estimatedWR.toFixed(1)}%`);
    }

    const allAssets = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    let foundCount = 0;
    for (const asset of allAssets) {
      const key = getKey(asset.name);
      if (!key) continue;
      const s = learningState[key];
      if (s.disabled) {
        console.log(`[⏭️] ${asset.name} → PULADO`);
        continue;
      }
      candleBuffer.set(asset.activeId, { ticks: [], asset, key });
      ws.subscribeCandles(asset.activeId, CANDLE_SIZE);
      foundCount++;
      console.log(`[✅] ${asset.name} → ${s.direction} (size=${CANDLE_SIZE}s)`);
    }

    console.log(`\n[📋] ${foundCount}/2 ativos ativos`);
    console.log('[⏳] Warmup 20s...\n');
    await new Promise(r => setTimeout(r, 20_000));
    warmupEndTime = Date.now();
    console.log('[✅] INICIADO!\n');
  });

  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
    if (!aid || !candleBuffer.has(aid)) return;
    const buf = candleBuffer.get(aid);
    pushCandle(buf, raw);

    const op = activeOperations.get(aid);
    if (op && (Date.now() - op.openedAt) < COOLDOWN_MS) return;
    if (!warmupEndTime || Date.now() < warmupEndTime) return;

    const result = getSignal(buf, buf.asset.name);
    if (!result) return;

    const trade = shouldTrade(buf.key);
    if (!trade.ok) return;

    const s = learningState[buf.key];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);

    ws.placeOrder({
      price: TRADE_AMOUNT, activeId: aid, direction: result.signal,
      expiration, optionTypeId, balanceId
    });

    activeOperations.set(aid, {
      name: buf.asset.name, key: buf.key, direction: result.signal,
      expected: s.estimatedWR, openedAt: Date.now()
    });

    console.log(`[📊 ${buf.asset.name}] ${result.signal} | WR-ajustado:${s.estimatedWR.toFixed(1)}%`);
    resultados.push({
      active: buf.asset.name, key: buf.key, direction: result.signal,
      expected: s.estimatedWR, price: TRADE_AMOUNT,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('D:/Tracecom project/resultados-v6.json', JSON.stringify(resultados, null, 2));
  });

  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op = activeOperations.get(aid);
    if (!op) return;

    // ⬅️ PAYOUT REAL DE 82%: R$2 stake → win +R$1.64, loss -R$2.00
    const winResult = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = winResult ? 'win' : 'loss';
    const profit = winResult ? TRADE_AMOUNT * 0.82 : -TRADE_AMOUNT;
    const emoji = result === 'win' ? '✅' : '❌';

    console.log(`[${emoji}] ${op.name} | ${op.direction} | WR:${op.expected.toFixed(1)}% | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

    const idx = resultados.findIndex(r => r.active === op.name && !r.result);
    if (idx >= 0) {
      resultados[idx].result = result;
      resultados[idx].profit = profit;
      fs.writeFileSync('D:/Tracecom project/resultados-v6.json', JSON.stringify(resultados, null, 2));
    }

    updateLearning(op.key, result, profit);
    activeOperations.delete(aid);

    const wins = resultados.filter(r => r.result === 'win').length;
    const total = resultados.filter(r => r.result).length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(1);
      const profitTotal = resultados.reduce((sum, r) => sum + (r.profit || 0), 0);
      console.log(`[📈] Total: ${total} | Wins: ${wins} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)}\n`);
    }
  });

  await ws.connect({ ssid });

  setInterval(() => {
    const wins = resultados.filter(r => r.result === 'win').length;
    const total = resultados.filter(r => r.result).length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(0);
      process.stdout.write(`\r[⏱️ ${new Date().toLocaleTimeString()}] Ops: ${total} | WR: ${wr}%   `);
    }
  }, 5000);

  setInterval(() => {
    console.log('\n[🧠] Estado:');
    for (const va of VALIDATED_ASSETS) {
      const k = va.names[0];
      const s = learningState[k];
      console.log(`   ${s.disabled ? '❌' : '✅'} ${k.padEnd(10)} est:${s.estimatedWR.toFixed(1)}% (${s.observedWins}/${s.observedTotal}) lucro:R$${s.totalProfit.toFixed(2)}`);
    }
  }, 60_000);
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v6.1:\n');
  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;
  const totalProfit = resultados.reduce((s, r) => s + (r.profit || 0), 0);
  console.log(`📊 Ops: ${total} | Wins: ${wins} | WR: ${total > 0 ? ((wins/total)*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro REAL: R$${totalProfit.toFixed(2)}`);
  console.log(`💵 Investido: R$${(total * TRADE_AMOUNT).toFixed(2)}`);
  console.log('\n📋 Por ativo:');
  const byActive = {};
  for (const r of resultados.filter(r => r.result)) {
    if (!byActive[r.active]) byActive[r.active] = { wins: 0, total: 0, profit: 0 };
    byActive[r.active].total++;
    if (r.result === 'win') byActive[r.active].wins++;
    byActive[r.active].profit += r.profit || 0;
  }
  for (const [name, s] of Object.entries(byActive)) {
    const wr = (s.wins / s.total * 100).toFixed(0);
    console.log(`   ${name}: ${s.wins}/${s.total} (${wr}%) | R$${s.profit.toFixed(2)}`);
  }
  fs.writeFileSync('D:/Tracecom project/resultados-v6-final.json', JSON.stringify(resultados, null, 2));
  persistLearning();
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });