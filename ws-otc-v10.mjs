/**
 * OTC BOT v10 - WHITELIST 8 ATIVOS + 2MIN + EXPIRY ANALYSIS
 * ==========================================================================
 * Ativos: TRON, HYPE, DYDX, ORDI, SHIB, FARTCOIN, RAYDIUM, RENDER
 * Expiração: 2 minutos
 * Config: bot-config-v10.json
 */
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync('D:/Tracecom project/bot-config-v10.json', 'utf8'));
const C   = CONFIG.trading;
const S   = CONFIG.strategy;
const L   = CONFIG.learning;
const EA  = CONFIG.expirationAnalysis;
const P   = CONFIG.paths;
const WL  = CONFIG._whitelist;

const EMAIL    = CONFIG.login.email;
const PASSWORD = CONFIG.login.password;
const BASE_STAKE        = C.baseStake;
const EXPIRATION_MIN    = C.expirationMinutes;
const COOLDOWN_MS       = C.cooldownMs;
const OPERATION_TTL_MS  = C.operationTtlMs;
const REPORT_INTERVAL_MS = C.reportIntervalMs;

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {};
try {
  if (fs.existsSync(P.state)) state = JSON.parse(fs.readFileSync(P.state, 'utf8'));
} catch (e) {}

// Pre-popula state com whitelist
const WHITELIST = Object.entries(WL).filter(([k]) => k !== '_desc').map(([k, v]) => ({
  key: k, name: v.name, direction: v.direction, wr: v.wr
}));

for (const asset of WHITELIST) {
  if (!state[asset.key]) {
    state[asset.key] = {
      key: asset.key, name: asset.name,
      historicalWR: asset.wr, direction: asset.direction,
      observedWins: 0, observedTotal: 0,
      rollingWR: asset.wr, estimatedWR: asset.wr,
      disabled: false, disabledReason: null,
      consecutiveLosses: 0, pausedUntil: 0,
      lastLossAt: 0, lastWinAt: 0,
      totalProfit: 0, directionFlips: 0, lastDirectionFlipAt: 0,
    };
  }
  // Mantém direção aprendida se já existir
  if (state[asset.key].observedTotal > 0) {
    state[asset.key].historicalWR = asset.wr;
  } else {
    state[asset.key].direction = asset.direction;
    state[asset.key].rollingWR = asset.wr;
    state[asset.key].estimatedWR = asset.wr;
  }
}

function persistState() {
  try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {}
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function wrCI(wins, total) {
  if (total === 0) return { wr: 0, lower: 0, upper: 1 };
  const p = wins / total;
  const z = 1.96, n = total;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return { wr: p, lower: Math.max(0, (center - spread) / denom), upper: Math.min(1, (center + spread) / denom) };
}

function detectRegime(ticks) {
  if (ticks.length < S.lookbackRegime) return 'unknown';
  const moves = [];
  for (let i = ticks.length - S.lookbackRegime; i < ticks.length; i++)
    moves.push(ticks[i].close > ticks[i - 1].close ? 1 : -1);
  let max = 1, cur = 1;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i] === moves[i - 1]) cur++; else cur = 1;
    if (cur > max) max = cur;
  }
  return max >= S.regimeStreakThreshold ? 'trending' : 'ranging';
}

function calcRSI(ticks, period = S.rsiPeriod) {
  if (ticks.length < period + 1) return 50;
  const closes = ticks.map(t => t.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}

function fade4Signal(ticks, direction) {
  if (ticks.length < 5) return null;
  const last5 = ticks.slice(-5);
  const last4 = last5.slice(0, 4);
  const c5 = last5[4], c4 = last5[3];
  const down4 = last4.every((c, i) => i === 0 || c.close < last4[i - 1].close);
  const up4   = last4.every((c, i) => i === 0 || c.close > last4[i - 1].close);
  if (down4 && c5.close > c4.close && direction === 'CALL') return { signal: 'CALL' };
  if (up4   && c5.close < c4.close && direction === 'PUT')   return { signal: 'PUT' };
  return null;
}

function volatility(ticks) {
  if (ticks.length < 5) return 0;
  const closes = ticks.slice(-5).map(t => t.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++) returns.push(Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  return Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
}

function simulateExpirations(entryTime, entryPrice, direction, buf5s) {
  const results = {};
  for (const expSecs of EA.simulate) {
    const targetMs = entryTime + expSecs * 1000;
    let best = null, bestDiff = Infinity;
    for (const tick of buf5s.ticks) {
      if (tick.atMs < entryTime) continue;
      const diff = Math.abs(tick.atMs - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = tick; }
    }
    results[expSecs] = !best || bestDiff > 60000 ? 'nocandle' : (direction === 'CALL' ? best.close > entryPrice : best.close < entryPrice) ? 'win' : 'loss';
  }
  return results;
}

function pushCandle(buf, raw) {
  const at = Number(raw.at ?? raw.timestamp);
  let atMs = at > 1e15 ? Math.round(at / 1e6) : at > 1e12 ? Math.round(at) : at * 1000;
  const close = Number(raw.close);
  if (!Number.isFinite(close)) return false;
  if (buf.ticks.length > 0 && Math.abs(buf.ticks[buf.ticks.length - 1].atMs - atMs) < 500) return false;
  buf.ticks.push({ atMs, close });
  if (buf.ticks.length > 500) buf.ticks.shift();
  return true;
}

function getSignal(buf5s, buf1m, key) {
  const s = state[key];
  if (!s) return null;
  if (s.disabled) return null;
  if (s.pausedUntil && Date.now() < s.pausedUntil) return null;
  if (buf5s.ticks.length < S.lookbackRegime) return null;
  if (buf1m.ticks.length < S.min1mCandles) return null;

  const regime = detectRegime(buf5s.ticks);
  if (regime === 'trending') return null;

  const fade = fade4Signal(buf5s.ticks, s.direction);
  if (!fade) return null;

  const last1m = buf1m.ticks.slice(-3);
  if (last1m.length >= 2) {
    const dir1m = last1m[last1m.length - 1].close > last1m[last1m.length - 2].close ? 'up' : 'down';
    const expDir = fade.signal === 'CALL' ? 'up' : 'down';
    if (dir1m !== expDir) return null;
  }

  const rsi = calcRSI(buf5s.ticks);
  if (fade.signal === 'CALL' && rsi <= S.rsiOversold) return null;
  if (fade.signal === 'PUT'   && rsi >= S.rsiOverbought) return null;
  if (volatility(buf5s.ticks) < S.volatilityMin) return null;

  const ci = wrCI(s.observedWins, s.observedTotal);
  if (s.observedTotal >= L.minSampleSize && ci.lower < S.icLowerGate) return null;

  const last5 = buf5s.ticks[buf5s.ticks.length - 1];
  if (Date.now() - last5.atMs > S.staleCandleMs) return null;

  return { signal: fade.signal, rsi, regime, stake: BASE_STAKE, ci };
}

function updateLearning(key, result, profit) {
  const s = state[key];
  if (!s) return;
  s.observedTotal++;
  s.totalProfit += profit || 0;
  if (result === 'win') {
    s.observedWins++;
    s.consecutiveLosses = 0;
  } else if (result === 'loss') {
    s.consecutiveLosses++;
    if (s.consecutiveLosses >= L.lossStreakLimit) {
      s.pausedUntil = Date.now() + L.lossStreakCooldownMs;
      console.log(`[⏸ PAUSE] ${key}: ${s.consecutiveLosses} losses → 5min cooldown`);
      s.consecutiveLosses = 0;
    }
  }
  s.rollingWR   = s.observedTotal > 0 ? (s.observedWins / s.observedTotal) * 100 : s.historicalWR;
  s.estimatedWR = L.weightHistorical * s.historicalWR + L.weightObserved * s.rollingWR;

  if (s.observedTotal >= L.minSampleSize && s.rollingWR < L.killWR * 100) {
    if (!s.disabled) { s.disabled = true; s.disabledReason = `WR ${s.rollingWR.toFixed(1)}% < ${L.killWR * 100}%`; console.log(`[💀 KILL] ${key}: ${s.disabledReason}`); }
  }
  if (s.disabled && s.observedTotal >= L.minSampleSize + 5 && s.rollingWR >= 55) {
    s.disabled = false; s.disabledReason = null; console.log(`[♻️ REVIVE] ${key} (WR ${s.rollingWR.toFixed(1)}%)`);
  }
  if (s.observedTotal >= L.recalibrateAfter && s.rollingWR < L.autoFlipThreshold) {
    const newDir = s.direction === 'CALL' ? 'PUT' : 'CALL';
    console.log(`[🔄 FLIP] ${key}: ${s.direction}→${newDir} (WR=${s.rollingWR.toFixed(1)}%)`);
    s.direction = newDir; s.directionFlips++; s.lastDirectionFlipAt = Date.now();
    s.observedWins = 0; s.observedTotal = 0; s.rollingWR = s.historicalWR; s.estimatedWR = s.historicalWR; s.consecutiveLosses = 0;
  }
  persistState();
}

function formatExp(sec) { return sec < 60 ? `${sec}s` : sec === 60 ? '1min' : `${sec / 60}min`; }

function aggregateExpirationSim() {
  const summary = {};
  for (const exp of EA.simulate) summary[exp] = { wins: 0, total: 0 };
  for (const a of expirationAnalysis) {
    if (!a.simulated) continue;
    for (const exp of EA.simulate) {
      const r = a.simulated[exp];
      if (r && r !== 'nocandle') { summary[exp].total++; if (r === 'win') summary[exp].wins++; }
    }
  }
  return Object.entries(summary).map(([exp, d]) => ({
    expirationSecs: Number(exp), expirationLabel: formatExp(Number(exp)),
    total: d.total, wins: d.wins, wr: d.total > 0 ? (d.wins / d.total * 100).toFixed(1) : '?',
  }));
}

function logExpirationTable() {
  const rows = expirationAnalysis.filter(a => a.simulated);
  if (rows.length === 0) return;
  console.log('\n📊 ANÁLISE DE EXPIRAÇÃO:');
  const agg = aggregateExpirationSim();
  const cols = agg.map(a => `${a.expirationLabel}: ${a.wr}%WR(${a.total})`).join(' | ');
  console.log('   ' + cols);
  console.log('\n   Detalhado (últimas 5):');
  for (const a of rows.slice(-5)) {
    const actual = a.result === 'win' ? '✅' : a.result === 'loss' ? '❌' : '⚪';
    const parts = EA.simulate.map(exp => {
      const r = a.simulated && a.simulated[exp];
      const icon = r === 'win' ? '✅' : r === 'loss' ? '❌' : '⚪';
      return `${formatExp(exp)}=${icon}`;
    });
    console.log(`   ${a.assetName} ${a.direction} ${actual} | ${parts.join(' | ')}`);
  }
}

function generateReport() {
  const ops = resultsList.filter(r => r.result);
  const wins = ops.filter(r => r.result === 'win').length;
  const total = ops.length;
  const profit = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
  const byAsset = {};
  for (const r of ops) {
    if (!byAsset[r.key]) byAsset[r.key] = { wins: 0, total: 0, profit: 0 };
    byAsset[r.key].total++;
    if (r.result === 'win') byAsset[r.key].wins++;
    byAsset[r.key].profit += r.profit || 0;
  }
  const report = {
    timestamp: new Date().toISOString(),
    summary: { totalOps: total, wins, losses: total - wins, wr: total > 0 ? (wins / total * 100).toFixed(1) : '0', profit: profit.toFixed(2) },
    byAsset: Object.entries(byAsset).map(([key, d]) => ({
      key, direction: state[key]?.direction, wr: d.total > 0 ? (d.wins / d.total * 100).toFixed(1) : '?',
      sampleSize: d.total, wins: d.wins, profit: d.profit.toFixed(2),
      verdict: state[key]?.disabled ? '❌ OFF' : state[key]?.pausedUntil > Date.now() ? '⏸ pausa' : '✅ ativo',
    })),
    expirationSim: aggregateExpirationSim(),
  };
  try { fs.writeFileSync(P.report, JSON.stringify(report, null, 2)); } catch {}
  return report;
}

function logReport(report) {
  console.log(`\n📊 RELATÓRIO | Ops: ${report.summary.totalOps} | WR: ${report.summary.wr}% | Lucro: R$${report.summary.profit}`);
  for (const a of report.byAsset) {
    const profitStr = (Number(a.profit) >= 0 ? '+' : '') + 'R$' + a.profit;
    console.log(`   ${a.verdict} ${a.key.padEnd(14)} dir:${(a.direction||'?').padEnd(5)} WR:${a.wr}%(${a.sampleSize}) ${profitStr}`);
  }
}

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
const buf5s = new Map();
const buf1m = new Map();
const activeOps = new Map();
const resultsList = [];
const expirationAnalysis = [];

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    import('https').then(https => {
      const req = https.request(options, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  });
}

async function login() {
  const data = JSON.stringify({ identifier: EMAIL, password: PASSWORD });
  const res = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  return JSON.parse(res.body).result?.ssid ?? JSON.parse(res.body).ssid;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK!');

  const ws = new IqWsClient({ log: () => {} });
  let balanceId = null;
  let warmupDone = false;
  let snapshotTimer = null;

  ws.on('ready', async () => {
    console.log('[WS] Ready!');
    const balMsg = await ws.getBalances();
    const balData = balMsg?.msg ?? balMsg;
    const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
    const conta = balances.find(b => b.type === 4) || balances[0];
    if (!conta || conta.amount <= 0) { console.error('[ERRO] Sem saldo'); ws.close(); return; }
    balanceId = conta.id;
    console.log(`[💼 CONTA] DEMO | Saldo: R$${conta.amount.toFixed(2)}\n`);

    // Carrega init data
    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};

    // Encontra IDs dos ativos whitelist
    const subscribed = [];
    for (const [id, act] of Object.entries(turboActives)) {
      const aid = Number(id);
      for (const asset of WHITELIST) {
        if (act.name === asset.name) {
          buf5s.set(aid, { ticks: [], assetId: aid, name: asset.name, key: asset.key });
          buf1m.set(aid, { ticks: [], assetId: aid, name: asset.name, key: asset.key });
          ws.subscribeCandles(aid, S.candleSizeSeconds);
          ws.subscribeCandles(aid, 60);
          subscribed.push(asset);
          break;
        }
      }
    }

    console.log('='.repeat(70));
    console.log('🧠 BOT v10 - WHITELIST 8 ATIVOS + 2MIN + EXPIRY ANALYSIS');
    console.log('='.repeat(70));
    console.log('\n📋 WHITELIST:');
    for (const a of subscribed) {
      const s = state[a.key];
      const ci = wrCI(s?.observedWins || 0, s?.observedTotal || 0);
      console.log(`   ✅ ${a.name.padEnd(24)} dir:${a.direction} histWR:${a.wr}%`);
    }
    console.log(`\n[📋] ${subscribed.length}/${WHITELIST.length} ativos encontrados`);
    console.log(`[⏳] Warmup ${S.warmupMs / 1000}s...\n`);
    await new Promise(r => setTimeout(r, S.warmupMs));

    if (EA.enabled) {
      snapshotTimer = setInterval(() => {
        for (const [, buf] of buf5s.entries()) {
          if (buf.ticks.length > 0) {
            // snapshot já capturado via candles
          }
        }
      }, EA.trackEveryMs);
    }

    warmupDone = true;
    console.log('[✅] INICIADO! Expiração: 2min | Stake: R$2\n');
  });

  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid  = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
    const size = raw.size ?? raw.candle?.size ?? S.candleSizeSeconds;

    if (size === S.candleSizeSeconds && buf5s.has(aid)) {
      pushCandle(buf5s.get(aid), raw);
    } else if (size === 60 && buf1m.has(aid)) {
      pushCandle(buf1m.get(aid), raw);
    } else {
      return;
    }

    if (size !== S.candleSizeSeconds) return;
    if (!warmupDone) return;

    for (const [a, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) { activeOps.delete(a); }
    }

    const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
    if (!b5 || !b1) return;

    if (activeOps.has(aid) && (Date.now() - activeOps.get(aid).openedAt) < COOLDOWN_MS) return;

    const sig = getSignal(b5, b1, b5.key);
    if (!sig) return;

    const s = state[b5.key];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);

    const entryPrice = b5.ticks[b5.ticks.length - 1].close;
    const entryTime  = Date.now();

    ws.placeOrder({ price: sig.stake, activeId: aid, direction: sig.signal, expiration, optionTypeId, balanceId });

    activeOps.set(aid, {
      name: b5.name, key: b5.key, assetId: aid,
      direction: sig.signal, expected: s?.estimatedWR,
      rsi: sig.rsi, regime: sig.regime, stake: sig.stake,
      entryPrice, entryTime,
    });

    const ciStr = `${(sig.ci.lower*100).toFixed(1)}%-${(sig.ci.upper*100).toFixed(1)}%`;
    console.log(`[📊 ${b5.name}] ${sig.signal} RSI:${sig.rsi.toFixed(0)} regime:${sig.regime} IC:${ciStr}`);

    resultsList.push({
      assetId: aid, active: b5.name, key: b5.key, direction: sig.signal,
      expected: s?.estimatedWR, rsi: sig.rsi, regime: sig.regime,
      stake: sig.stake, entryPrice, timestamp: new Date().toISOString(),
      expirationSecs: EXPIRATION_MIN * 60,
    });
    fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
  });

  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op  = activeOps.get(aid);
    if (!op) { console.warn('[MISSED] aid=', aid); return; }

    const won    = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = won ? 'win' : 'loss';
    const profit = won ? op.stake * 0.82 : -op.stake;
    const emoji  = won ? '✅' : '❌';

    let simResults = null;
    if (EA.enabled) {
      const b5 = buf5s.get(aid);
      simResults = simulateExpirations(op.entryTime, op.entryPrice, op.direction, b5);
    }

    console.log(`[${emoji}] ${op.name} | ${op.direction} | R$${op.stake} | RSI:${op.rsi?.toFixed(0)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

    const idx = resultsList.findIndex(r => r.assetId === aid && !r.result);
    if (idx >= 0) {
      resultsList[idx].result = result;
      resultsList[idx].profit = profit;
      resultsList[idx].simulated = simResults;
      fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
    }

    expirationAnalysis.push({
      assetId: aid, assetName: op.name, direction: op.direction,
      entryPrice: op.entryPrice, entryTime: op.entryTime,
      expirationSecs: EXPIRATION_MIN * 60, result, profit,
      simulated: simResults, timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(P.expirationAnalysis, JSON.stringify(expirationAnalysis, null, 2));

    updateLearning(op.key, result, profit);
    activeOps.delete(aid);

    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(1);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      console.log(`[📈] Total: ${total} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)}`);
      logExpirationTable();
    }
    console.log('');
  });

  await ws.connect({ ssid });

  setInterval(() => {
    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(0);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      process.stdout.write(`\r[⏱ ${new Date().toLocaleTimeString()}] Ops:${total} WR:${wr}% Lucro:R$${profitTotal.toFixed(2)}   `);
    }
  }, 30_000);

  setInterval(() => { logReport(generateReport()); logExpirationTable(); }, REPORT_INTERVAL_MS);

  setInterval(() => {
    for (const [aid, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        const idx = resultsList.findIndex(r => r.assetId === aid && !r.result);
        if (idx >= 0) { resultsList[idx].result = 'unknown'; resultsList[idx].profit = 0; }
        activeOps.delete(aid);
      }
    }
  }, 60_000);
}

// ─── FINAL ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v10:\n');
  const ops = resultsList.filter(r => r.result && r.result !== 'unknown');
  const wins = ops.filter(r => r.result === 'win').length;
  const total = ops.length;
  const unknown = resultsList.filter(r => r.result === 'unknown').length;
  const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
  console.log(`📊 Ops: ${total} | W: ${wins} | L: ${total - wins} | WR: ${total > 0 ? (wins/total*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro: R$${profitTotal.toFixed(2)}`);
  const byKey = {};
  for (const r of ops) {
    if (!byKey[r.key]) byKey[r.key] = { wins: 0, total: 0, profit: 0 };
    byKey[r.key].total++;
    if (r.result === 'win') byKey[r.key].wins++;
    byKey[r.key].profit += r.profit || 0;
  }
  console.log('\n📋 Por ativo:');
  for (const [key, d] of Object.entries(byKey)) {
    const wr = (d.wins / d.total * 100).toFixed(0);
    const p = (d.profit >= 0 ? '+' : '') + 'R$' + d.profit.toFixed(2);
    console.log(`   ${key.padEnd(14)} ${d.wins}/${d.total} (${wr}%) ${p}`);
  }
  if (unknown > 0) console.log(`\n⚠️ ${unknown} ops não resolvidas`);
  logExpirationTable();
  logReport(generateReport());
  fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
  fs.writeFileSync(P.expirationAnalysis, JSON.stringify(expirationAnalysis, null, 2));
  persistState();
  if (snapshotTimer) clearInterval(snapshotTimer);
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
