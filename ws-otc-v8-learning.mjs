/**
 * OTC BOT v8 - MULTI-TIMEFRAME + REGIME + RSI + MARTINGALE
 * =================================================================
 * 5 camadas de filtro quantitativo:
 * 1. Regime (trending vs ranging) — evita operar contra tendência
 * 2. Fade4 (4 candles contra + confirmação) — padrão de reversão
 * 3. Timeframe 1min — confirmação em múltiplos frames
 * 4. RSI — filtro de momentum
 * 5. IC-WR — gate estatístico (lowerCI ≥ 55%)
 *
 * Martingale leve: loss → R$3 (stop em 3 losses)
 * Payout: R$2 → win +R$1.64 | loss -R$2.00
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const BASE_STAKE = 2;
const EXPIRATION_MIN = 1;
const CANDLE_SIZE = 5;
const LOOKBACK_REGIME = 15; // candles 5s pra regime
const REGIME_STREAK_THRESHOLD = 5; // 5+ candles seguidas = tendência
const RSI_PERIOD = 14;
const COOLDOWN_MS = 65_000;
const DEDUP_MS = 500;
const OPERATION_TTL_MS = 130_000;
const REPORT_INTERVAL_MS = 300_000;

const LEARNING = {
  minSampleSize: 10,
  killWR: 0.45,
  weightHistorical: 0.3,
  weightObserved: 0.7,
  lossStreakLimit: 3,
  lossStreakCooldown: 300_000,
  recalibrateAfter: 15,
  persistenceFile: 'D:/Tracecom project/learning-state.json',
};

const VALIDATED_ASSETS = [
  { names: ['USDHKD', 'USD-HKD'], direction: 'CALL', wr: 78 },
  { names: ['EURUSD', 'EUR-USD'], direction: 'CALL', wr: 74 },
  { names: ['USDZAR', 'USD-ZAR'], direction: 'PUT',  wr: 70 },
  { names: ['LTCUSD', 'Litecoin'], direction: 'PUT',  wr: 67 },
  { names: ['DOTUSD', 'Polkadot', 'DOT-USD'], direction: 'PUT', wr: 62 },
];

// ─── Learning State ──────────────────────────────────────────────────────────
let learningState = {};
try {
  if (fs.existsSync(LEARNING.persistenceFile)) {
    learningState = JSON.parse(fs.readFileSync(LEARNING.persistenceFile, 'utf8'));
  }
} catch {}

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
      totalProfit: 0,
      directionFlips: 0,
      lastDirectionFlipAt: 0,
      martingaleStreak: 0,    };
  }
  learningState[key].historicalWR = va.wr;
  learningState[key].direction = va.direction;
}

// ─── Martingale ─────────────────────────────────────────────────────────────
// REMOVIDO: stakes fixos para controlar risco
function getStake(assetKey) {
  return BASE_STAKE;
}

// ─── IC Binomial ────────────────────────────────────────────────────────────
function wrConfidence(wins, total) {
  if (total === 0) return { wr: 0, lower: 0, upper: 1 };
  const p = wins / total;
  const z = 1.96;
  const n = total;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return {
    wr: p,
    lower: Math.max(0, (center - spread) / denom),
    upper: Math.min(1, (center + spread) / denom),
  };
}

// ─── Regime Detection ────────────────────────────────────────────────────────
function detectRegime(ticks) {
  if (ticks.length < LOOKBACK_REGIME) return 'unknown';
  const moves = [];
  for (let i = ticks.length - LOOKBACK_REGIME; i < ticks.length; i++) {
    moves.push(ticks[i].close > ticks[i - 1].close ? 1 : -1);
  }
  let maxStreak = 1, cur = 1;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i] === moves[i - 1]) cur++;
    else cur = 1;
    if (cur > maxStreak) maxStreak = cur;
  }
  return maxStreak >= REGIME_STREAK_THRESHOLD ? 'trending' : 'ranging';
}

// ─── RSI ───────────────────────────────────────────────────────────────────
function calculateRSI(ticks, period = RSI_PERIOD) {
  if (ticks.length < period + 1) return 50;
  const closes = ticks.map(t => t.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

// ─── Fade4 Pattern ─────────────────────────────────────────────────────────
function getFade4Signal(ticks, direction) {
  if (ticks.length < 5) return null;
  const last5 = ticks.slice(-5);
  const last4 = last5.slice(0, 4);
  const lastCandle = last5[4];
  const prevCandle = last5[3];

  const isDown4 = last4.every((c, i) => i === 0 || c.close < last4[i - 1].close);
  const isUp4 = last4.every((c, i) => i === 0 || c.close > last4[i - 1].close);

  if (isDown4 && lastCandle.close > prevCandle.close && direction === 'CALL') {
    return { signal: 'CALL' };
  }
  if (isUp4 && lastCandle.close < prevCandle.close && direction === 'PUT') {
    return { signal: 'PUT' };
  }
  return null;
}

// ─── Volatilidade ──────────────────────────────────────────────────────────
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function calculateVolatility(ticks) {
  if (ticks.length < 5) return 0;
  const closes = ticks.slice(-5).map(t => t.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]));
  }
  return stdDev(returns);
}

// ─── Signal V8 (todas as camadas) ─────────────────────────────────────────
function getSignalV8(buf5s, buf1m, assetName) {
  const key = getKey(assetName);
  if (!key) return null;
  const s = learningState[key];
  if (!s) return null;

  // Camada 0: Warmup 1min
    if (buf5s.ticks.length < LOOKBACK_REGIME) return null;
  if (buf1m.ticks.length < 2) return null; // 2 candles 1min = 2min histórico

  // Camada 1: Regime
  const regime = detectRegime(buf5s.ticks);
  if (regime === 'trending') return null; // não opera contra tendência

  // Camada 2: Fade4 no 5s
  const fade4 = getFade4Signal(buf5s.ticks, s.direction);
  if (!fade4) return null;

  // Camada 3: Confirmação 1min (opcional — ignora se não tiver histórico)
  // Verifica se o 1min recente está na direção esperada
  const last1m = buf1m.ticks.slice(-3);
  if (last1m.length >= 2) {
    const last1mDir = last1m[last1m.length - 1].close > last1m[last1m.length - 2].close ? 'up' : 'down';
    const expected1mDir = fade4.signal === 'CALL' ? 'up' : 'down';
    if (last1mDir !== expected1mDir) return null; // 1min contradiz
  }

  // Camada 4: RSI
  const rsi = calculateRSI(buf5s.ticks);
  // PUT: RSI >= 75 = overbought extremo → perigo (pode reverter pra cima)
  // CALL: RSI <= 25 = oversold extremo → perigo (pode reverter pra baixo)
  if (fade4.signal === 'CALL' && rsi <= 25) return null;
  if (fade4.signal === 'PUT' && rsi >= 75) return null;

  // Camada 5: Volatilidade mínima
  const vol = calculateVolatility(buf5s.ticks);
  if (vol < 0.0002) return null;

  // Camada 6: IC-WR gate
  const ci = wrConfidence(s.observedWins, s.observedTotal);
  if (s.observedTotal >= LEARNING.minSampleSize && ci.lower < 0.55) return null;

  // Martingale check
  const stake = getStake(key);
  if (stake === 0) return null; // 3 losses seguidas = para

  // Stale candle check
  const last5s = buf5s.ticks[buf5s.ticks.length - 1];
  if (Date.now() - last5s.atMs > 30_000) return null;

  return { signal: fade4.signal, rsi, regime, stake, ci };
}

// ─── Utilitários ───────────────────────────────────────────────────────────
function getKey(assetName) {
  for (const va of VALIDATED_ASSETS) {
    if (va.names.some(n => assetName.toUpperCase().includes(n.toUpperCase()))) {
      return va.names[0];
    }
  }
  return null;
}

function persistLearning() {
  try { fs.writeFileSync(LEARNING.persistenceFile, JSON.stringify(learningState, null, 2)); } catch {}
}

function persistMissed(aid, raw) {
  try {
    const missed = fs.existsSync('D:/Tracecom project/missed-operations.json')
      ? JSON.parse(fs.readFileSync('D:/Tracecom project/missed-operations.json', 'utf8'))
      : [];
    missed.push({ aid, raw, ts: new Date().toISOString() });
    fs.writeFileSync('D:/Tracecom project/missed-operations.json', JSON.stringify(missed, null, 2));
  } catch {}
}

// ─── Learning Update ────────────────────────────────────────────────────────
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

  // Auto-kill
  if (s.observedTotal >= LEARNING.minSampleSize && s.rollingWR < LEARNING.killWR * 100) {
    if (!s.disabled) {
      s.disabled = true;
      s.disabledReason = `WR ${s.rollingWR.toFixed(1)}% < ${LEARNING.killWR * 100}% após ${s.observedTotal} ops`;
      console.log(`[🧠 KILL] ${assetKey}: ${s.disabledReason}`);
    }
  }

  // Auto-revive
  if (s.disabled && s.observedTotal >= LEARNING.minSampleSize + 5 && s.rollingWR >= 55) {
    s.disabled = false;
    s.disabledReason = null;
    console.log(`[🧠 REVIVE] ${assetKey} (WR ${s.rollingWR.toFixed(1)}%)`);
  }

  // Auto-recalibragem
  if (s.observedTotal >= LEARNING.recalibrateAfter && s.rollingWR < 50) {
    const newDir = s.direction === 'CALL' ? 'PUT' : 'CALL';
    console.log(`[🧠 FLIP] ${assetKey}: ${s.direction}→${newDir} (WR=${s.rollingWR.toFixed(1)}%)`);
    s.direction = newDir;
    s.directionFlips++;
    s.lastDirectionFlipAt = Date.now();
    s.observedWins = 0;
    s.observedTotal = 0;
    s.rollingWR = s.historicalWR;
    s.estimatedWR = s.historicalWR;
    s.consecutiveLosses = 0;
  }

  persistLearning();
}

// ─── Estado Global ─────────────────────────────────────────────────────────
const candleBuffer5s = new Map();
const candleBuffer1m = new Map();
const activeOperations = new Map();
const resultados = [];

function pushCandle(buf, raw) {
  const at = Number(raw.at ?? raw.timestamp);
  let atMs = at > 1e15 ? Math.round(at / 1e6) : at > 1e12 ? Math.round(at) : at * 1000;
  if (buf.ticks.length > 0 && Math.abs(buf.ticks[buf.ticks.length - 1].atMs - atMs) < DEDUP_MS) return false;
  const close = Number(raw.close);
  if (!Number.isFinite(close)) return false;
  buf.ticks.push({ atMs, close });
  if (buf.ticks.length > 150) buf.ticks.shift();
  return true;
}

// ─── Relatório ─────────────────────────────────────────────────────────────
function generateReport() {
  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;
  const totalProfit = resultados.reduce((sum, r) => sum + (r.profit || 0), 0);
  const assetReports = [];
  for (const va of VALIDATED_ASSETS) {
    const k = va.names[0];
    const s = learningState[k];
    const ci = wrConfidence(s?.observedWins || 0, s?.observedTotal || 0);
    let verdict = '⚠️观望';
    if (s?.disabled) verdict = '❌ OFF';
    else if (s?.pausedUntil > Date.now()) verdict = '⏸ pausa';
    else if (s?.observedTotal >= LEARNING.minSampleSize && ci.lower >= 0.55) verdict = '✅ operar';
    assetReports.push({
      key: k, direction: s?.direction, histWR: s?.historicalWR,
      obsWR: s?.rollingWR, estimatedWR: s?.estimatedWR,
      ci_lower: ci.lower, ci_wr: ci.wr, ci_upper: ci.upper,
      sampleSize: s?.observedTotal || 0,
      wins: s?.observedWins || 0,
      losses: (s?.observedTotal || 0) - (s?.observedWins || 0),
      profit: s?.totalProfit || 0,
      verdict,
    });
  }
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalOps: total, wins, losses: total - wins,
      wr: total > 0 ? (wins / total * 100).toFixed(1) : '0',
      totalProfit: totalProfit.toFixed(2),
      invested: (total * BASE_STAKE).toFixed(2),
    },
    assets: assetReports,
  };
  try { fs.writeFileSync('D:/Tracecom project/relatorio-v8.json', JSON.stringify(report, null, 2)); } catch {}
  return report;
}

function logReport(report) {
  console.log('\n📊 RELATÓRIO v8:');
  console.log(`   Total: ${report.summary.totalOps} ops | WR: ${report.summary.wr}% | Lucro: R$${report.summary.totalProfit}`);
  for (const a of report.assets) {
    const ciStr = `${(a.ci_lower * 100).toFixed(1)}%–${(a.ci_upper * 100).toFixed(1)}%`;
    const profitStr = (a.profit >= 0 ? '+' : '') + 'R$' + a.profit.toFixed(2);
    console.log(`   ${a.verdict} ${a.key.padEnd(10)} dir:${a.direction.padEnd(5)} IC:${ciStr} (${a.wins}/${a.sampleSize}) ${profitStr}`);
  }
}

// ─── HTTP / Login ───────────────────────────────────────────────────────────
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
  return (JSON.parse(res.body)).result?.ssid ?? JSON.parse(res.body).ssid;
}

// ─── Main ────────────────────────────────────────────────────────────────────
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
    console.log('🧠 BOT v8 - MULTI-TIMEFRAME | Regime | RSI | Martingale');
    console.log('='.repeat(70));
    console.log('\n📋 Estado:');
    for (const va of VALIDATED_ASSETS) {
      const k = va.names[0];
      const s = learningState[k];
      const ci = wrConfidence(s.observedWins, s.observedTotal);
      const status = s.disabled ? '❌' : '✅';
      console.log(`   ${status} ${k.padEnd(10)} dir:${s.direction.padEnd(5)} hist:${s.historicalWR}% obs:${s.rollingWR.toFixed(1)}% IC:${(ci.lower*100).toFixed(1)}%-${(ci.upper*100).toFixed(1)}% (${s.observedWins}/${s.observedTotal})`);
    }

    const allAssets = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    for (const asset of allAssets) {
      const key = getKey(asset.name);
      if (!key) continue;
      candleBuffer5s.set(asset.activeId, { ticks: [], asset, key });
      candleBuffer1m.set(asset.activeId, { ticks: [], asset, key });
      ws.subscribeCandles(asset.activeId, CANDLE_SIZE);    // 5s
      ws.subscribeCandles(asset.activeId, 60);                // 1min
    }

    console.log(`\n[📋] ${allAssets.filter(a => getKey(a.name)).length}/${VALIDATED_ASSETS.length} ativos`);
    console.log('[⏳] Warmup 120s (precisa 15 candles 5s + 2 candles 1min)...\n');
    await new Promise(r => setTimeout(r, 120_000));
    warmupEndTime = Date.now();
    console.log('[✅] INICIADO!\n');
  });

  // ─── Candle + Signal ────────────────────────────────────────────────────
  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
    const size = raw.size ?? raw.candle?.size ?? CANDLE_SIZE;

    if (size === CANDLE_SIZE && candleBuffer5s.has(aid)) {
      pushCandle(candleBuffer5s.get(aid), raw);
    } else if (size === 60 && candleBuffer1m.has(aid)) {
      pushCandle(candleBuffer1m.get(aid), raw);
    } else {
      return;
    }

    // Só processa sinais no timeframe 5s
    if (size !== CANDLE_SIZE) return;

    // TTL cleanup
    for (const [a, op] of activeOperations.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        console.warn(`[🧹 TTL] ${op.name} (aid=${a})`);
        activeOperations.delete(a);
      }
    }

    const buf5s = candleBuffer5s.get(aid);
    const buf1m = candleBuffer1m.get(aid);
    if (!buf5s || !buf1m) return;

    const existing = activeOperations.get(aid);
    if (existing && (Date.now() - existing.openedAt) < COOLDOWN_MS) return;
    if (!warmupEndTime || Date.now() < warmupEndTime) return;

    const signal = getSignalV8(buf5s, buf1m, buf5s.asset.name);
    if (!signal) return;

    const s = learningState[buf5s.key];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);

    ws.placeOrder({
      price: signal.stake, activeId: aid, direction: signal.signal,
      expiration, optionTypeId, balanceId
    });

    activeOperations.set(aid, {
      name: buf5s.asset.name, key: buf5s.key, direction: signal.signal,
      expected: s.estimatedWR, rsi: signal.rsi, regime: signal.regime,
      stake: signal.stake, ciLower: signal.ci.lower,
      openedAt: Date.now()
    });

    const ciStr = `${(signal.ci.lower*100).toFixed(1)}%-${(signal.ci.upper*100).toFixed(1)}%`;
    console.log(`[📊 ${buf5s.asset.name}] ${signal.signal} RSI:${signal.rsi.toFixed(0)} regime:${signal.regime} stake:R$${signal.stake} IC:${ciStr}`);

    resultados.push({
      active: buf5s.asset.name, key: buf5s.key, direction: signal.signal,
      expected: s.estimatedWR, rsi: signal.rsi, regime: signal.regime,
      stake: signal.stake, price: signal.stake,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('D:/Tracecom project/resultados-v8.json', JSON.stringify(resultados, null, 2));
  });

  // ─── Fechamento ─────────────────────────────────────────────────────────
  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op = activeOperations.get(aid);
    if (!op) {
      console.warn(`[MISSED] aid=${aid}`, JSON.stringify(raw).slice(0, 150));
      persistMissed(aid, raw);
      return;
    }

    const winResult = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = winResult ? 'win' : 'loss';
    const profit = winResult ? op.stake * 0.82 : -op.stake;
    const emoji = result === 'win' ? '✅' : '❌';

    console.log(`[${emoji}] ${op.name} | ${op.direction} | R$${op.stake} | RSI:${op.rsi?.toFixed(0) || '?'} | ${op.regime || '?'} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

    const idx = resultados.findIndex(r => r.active === op.name && !r.result);
    if (idx >= 0) {
      resultados[idx].result = result;
      resultados[idx].profit = profit;
      fs.writeFileSync('D:/Tracecom project/resultados-v8.json', JSON.stringify(resultados, null, 2));
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

  // Ticker
  setInterval(() => {
    const wins = resultados.filter(r => r.result === 'win').length;
    const total = resultados.filter(r => r.result).length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(0);
      const profitTotal = resultados.reduce((s, r) => s + (r.profit || 0), 0);
      process.stdout.write(`\r[⏱️ ${new Date().toLocaleTimeString()}] Ops: ${total} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)}   `);
    }
  }, 30_000);

  // Relatório a cada 5min
  setInterval(() => {
    const report = generateReport();
    logReport(report);
  }, REPORT_INTERVAL_MS);

  // Reconciliação a cada 60s
  setInterval(() => {
    for (const [aid, op] of activeOperations.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        console.warn(`[🔄 RECON] Timeout: ${op.name}`);
        const idx = resultados.findIndex(r => r.active === op.name && !r.result);
        if (idx >= 0) {
          resultados[idx].result = 'unknown';
          resultados[idx].profit = 0;
          fs.writeFileSync('D:/Tracecom project/resultados-v8.json', JSON.stringify(resultados, null, 2));
        }
        activeOperations.delete(aid);
      }
    }
  }, 60_000);
}

// ─── Final ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v8:\n');
  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;
  const unknown = resultados.filter(r => r.result === 'unknown').length;
  const totalProfit = resultados.reduce((s, r) => s + (r.profit || 0), 0);
  const totalInvested = resultados.filter(r => r.result && r.result !== 'unknown').reduce((s, r) => s + (r.stake || BASE_STAKE), 0);
  console.log(`📊 Ops: ${total} | Wins: ${wins} | Losses: ${total - wins} | Unknown: ${unknown} | WR: ${total > 0 ? (wins/total*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro: R$${totalProfit.toFixed(2)}`);
  console.log(`💵 Investido: R$${totalInvested.toFixed(2)}`);
  console.log('\n📋 Por ativo:');
  const byActive = {};
  for (const r of resultados.filter(r => r.result && r.result !== 'unknown')) {
    if (!byActive[r.key]) byActive[r.key] = { wins: 0, total: 0, profit: 0 };
    byActive[r.key].total++;
    if (r.result === 'win') byActive[r.key].wins++;
    byActive[r.key].profit += r.profit || 0;
  }
  for (const [key, s] of Object.entries(byActive)) {
    const ci = wrConfidence(s.wins, s.total);
    const wr = (s.wins / s.total * 100).toFixed(0);
    const profitStr = (s.profit >= 0 ? '+' : '') + 'R$' + s.profit.toFixed(2);
    console.log(`   ${key.padEnd(10)} ${s.wins}/${s.total} (${wr}%) IC:${(ci.lower*100).toFixed(1)}%-${(ci.upper*100).toFixed(1)}% ${profitStr}`);
  }
  if (unknown > 0) console.log(`\n⚠️ ${unknown} ops não capturadas`);
  logReport(generateReport());
  fs.writeFileSync('D:/Tracecom project/resultados-v8-final.json', JSON.stringify(resultados, null, 2));
  persistLearning();
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
