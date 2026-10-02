/**
 * OTC BOT v9 - ALL OTCs + EXPIRATION ANALYSIS + LEARNING
 * ==========================================================================
 * Carrega TODOS os ativos OTC da API automaticamente.
 * Opera em 5 minutos, mas SIMULA retrospectivamente o resultado em:
 *   30s, 1min, 2min, 3min, 5min
 *
 * Config: bot-config.json (NÃO hardcoded)
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = JSON.parse(fs.readFileSync('D:/Tracecom project/bot-config.json', 'utf8'));
const C = CONFIG.trading;
const S = CONFIG.strategy;
const L = CONFIG.learning;
const EA = CONFIG.expirationAnalysis;
const P = CONFIG.paths;

const EMAIL    = CONFIG.login.email;
const PASSWORD = CONFIG.login.password;
const BASE_STAKE          = C.baseStake;
const EXPIRATION_MIN      = C.expirationMinutes;
const COOLDOWN_MS         = C.cooldownMs;
const OPERATION_TTL_MS    = C.operationTtlMs;
const REPORT_INTERVAL_MS  = C.reportIntervalMs;

// ─── OTC ASSETS — carregados da API ──────────────────────────────────────────
const OTC_ASSETS = {};  // activeId → { name, key, defaultDirection, wr }

function registerOTC(activeId, name) {
  // Normaliza nome pra key (ex: "USD-HKD" → "USDHKD", "EUR/USD OTC" → "EUROUSD")
  const clean = name.replace(/\s*OTC\s*/i, '').replace(/[\/\-]/g, '').toUpperCase();
  // heurísticas de direção baseadas no par
  const putPairs = ['USDZAR', 'ZARUSD', 'GBPUSD', 'GBPJPY', 'AUDUSD', 'NZDUSD', 'LTC', 'DOT', 'LINK', 'UNI', 'XRP', 'ADA', 'SOL', 'BCH', 'MATIC', 'SHIB', 'AVAX'];
  const isPut = putPairs.some(p => clean.includes(p.replace('USD', '')));
  const key = clean.replace(/[A-Z]{3}(USD|EUR|GBP|JPY)/, '').slice(0, 8) || clean.slice(0, 6);
  const wr = 55 + Math.floor(Math.random() * 20); // placeholder WR até aprender

  OTC_ASSETS[activeId] = {
    name, key, defaultDirection: isPut ? 'PUT' : 'CALL', wr
  };
  return key;
}

// ─── LEARNING STATE ───────────────────────────────────────────────────────────
let state = {};
try {
  if (fs.existsSync(P.state)) {
    state = JSON.parse(fs.readFileSync(P.state, 'utf8'));
  }
} catch (e) { console.warn('[STATE] Não consegui ler state:', e.message); }

function persistState() {
  try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {}
}

// ─── IC BINOMIAL ─────────────────────────────────────────────────────────────
function wrCI(wins, total) {
  if (total === 0) return { wr: 0, lower: 0, upper: 1 };
  const p = wins / total;
  const z = 1.96, n = total;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return {
    wr: p,
    lower: Math.max(0, (center - spread) / denom),
    upper: Math.min(1, (center + spread) / denom),
  };
}

// ─── REGIME ──────────────────────────────────────────────────────────────────
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

// ─── RSI ─────────────────────────────────────────────────────────────────────
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

// ─── FADE4 ──────────────────────────────────────────────────────────────────
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

// ─── VOLATILIDADE ────────────────────────────────────────────────────────────
function volatility(ticks) {
  if (ticks.length < 5) return 0;
  const closes = ticks.slice(-5).map(t => t.close);
  const returns = [];
  for (let i = 1; i < closes.length; i++)
    returns.push(Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  return Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
}

// ─── SIGNAL v9 ───────────────────────────────────────────────────────────────
function getSignal(buf5s, buf1m, assetId) {
  const info = OTC_ASSETS[assetId];
  if (!info) return null;
  const key = info.key;
  const s = state[key];
  if (!s) return null;

  // Warmup
  if (buf5s.ticks.length < S.lookbackRegime) return null;
  if (buf1m.ticks.length < S.min1mCandles) return null;

  // Regime
  const regime = detectRegime(buf5s.ticks);
  if (regime === 'trending') return null;

  // Fade4
  const fade = fade4Signal(buf5s.ticks, s.direction);
  if (!fade) return null;

  // 1min confirmação (opcional)
  const last1m = buf1m.ticks.slice(-3);
  if (last1m.length >= 2) {
    const dir1m = last1m[last1m.length - 1].close > last1m[last1m.length - 2].close ? 'up' : 'down';
    const expDir = fade.signal === 'CALL' ? 'up' : 'down';
    if (dir1m !== expDir) return null;
  }

  // RSI
  const rsi = calcRSI(buf5s.ticks);
  if (fade.signal === 'CALL' && rsi <= S.rsiOversold) return null;
  if (fade.signal === 'PUT'   && rsi >= S.rsiOverbought) return null;

  // Volatilidade
  if (volatility(buf5s.ticks) < S.volatilityMin) return null;

  // IC gate
  const ci = wrCI(s.observedWins, s.observedTotal);
  if (s.observedTotal >= L.minSampleSize && ci.lower < S.icLowerGate) return null;

  // Stale
  const last5 = buf5s.ticks[buf5s.ticks.length - 1];
  if (Date.now() - last5.atMs > S.staleCandleMs) return null;

  // Pausado?
  if (s.pausedUntil && Date.now() < s.pausedUntil) return null;

  return { signal: fade.signal, rsi, regime, stake: BASE_STAKE, ci };
}

// ─── EXPIRATION SIMULATION ───────────────────────────────────────────────────
/**
 * Simula o resultado em múltiplas expirações usando candles 5s históricos.
 * Para cada expiração, encontra o candle mais próximo de (entryTime + expireSecs)
 * e compara com o candle de entrada.
 */
function simulateExpirations(entryTime, entryPrice, direction, buf5s) {
  const results = {};
  for (const expSecs of EA.simulate) {
    const targetMs = entryTime + expSecs * 1000;
    // encontra candle mais próximo
    let best = null, bestDiff = Infinity;
    for (const tick of buf5s.ticks) {
      if (tick.atMs < entryTime) continue;
      const diff = Math.abs(tick.atMs - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = tick; }
    }
    if (!best || best === null) { results[expSecs] = 'nocandle'; continue; }
    const exitPrice = best.close;
    const won = direction === 'CALL' ? exitPrice > entryPrice : exitPrice < entryPrice;
    results[expSecs] = won ? 'win' : 'loss';
  }
  return results;
}

// ─── PUSH CANDLE ─────────────────────────────────────────────────────────────
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

// ─── UPDATE LEARNING ─────────────────────────────────────────────────────────
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

  // Auto-kill
  if (s.observedTotal >= L.minSampleSize && s.rollingWR < L.killWR * 100) {
    if (!s.disabled) {
      s.disabled = true;
      s.disabledReason = `WR ${s.rollingWR.toFixed(1)}% < ${L.killWR * 100}%`;
      console.log(`[💀 KILL] ${key}: ${s.disabledReason}`);
    }
  }
  // Auto-revive
  if (s.disabled && s.observedTotal >= L.minSampleSize + 5 && s.rollingWR >= 55) {
    s.disabled = false;
    s.disabledReason = null;
    console.log(`[♻️ REVIVE] ${key} (WR ${s.rollingWR.toFixed(1)}%)`);
  }
  // Auto-flip
  if (s.observedTotal >= L.recalibrateAfter && s.rollingWR < L.autoFlipThreshold) {
    const newDir = s.direction === 'CALL' ? 'PUT' : 'CALL';
    console.log(`[🔄 FLIP] ${key}: ${s.direction}→${newDir} (WR=${s.rollingWR.toFixed(1)}%)`);
    s.direction = newDir;
    s.directionFlips++;
    s.lastDirectionFlipAt = Date.now();
    s.observedWins = 0;
    s.observedTotal = 0;
    s.rollingWR = s.historicalWR;
    s.estimatedWR = s.historicalWR;
    s.consecutiveLosses = 0;
  }
  persistState();
}

// ─── GLOBAL STATE ────────────────────────────────────────────────────────────
const buf5s   = new Map();   // activeId → { ticks, assetId, key }
const buf1m   = new Map();   // activeId → { ticks, assetId, key }
const activeOps  = new Map();  // activeId → op
const resultsList = [];
const expirationAnalysis = [];  // por operação

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function httpReq(options, postData = null) {
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
  const res = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/',
    }
  }, data);
  return JSON.parse(res.body).result?.ssid ?? JSON.parse(res.body).ssid;
}

// ─── REPORT ───────────────────────────────────────────────────────────────────
function generateReport() {
  const ops = resultsList.filter(r => r.result);
  const wins = ops.filter(r => r.result === 'win').length;
  const total = ops.length;
  const profit = resultsList.reduce((s, r) => s + (r.profit || 0), 0);

  // Aggregate per asset
  const byAsset = {};
  for (const r of ops) {
    if (!byAsset[r.key]) byAsset[r.key] = { wins: 0, total: 0, profit: 0, info: null };
    byAsset[r.key].total++;
    if (r.result === 'win') byAsset[r.key].wins++;
    byAsset[r.key].profit += r.profit || 0;
    if (!byAsset[r.key].info) byAsset[r.key].info = OTC_ASSETS[r.assetId] || {};
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

function aggregateExpirationSim() {
  const summary = {};
  for (const exp of EA.simulate) summary[exp] = { wins: 0, total: 0 };
  for (const a of expirationAnalysis) {
    if (!a.simulated) continue;
    for (const exp of EA.simulate) {
      const r = a.simulated[exp];
      if (r && r !== 'nocandle') {
        summary[exp].total++;
        if (r === 'win') summary[exp].wins++;
      }
    }
  }
  return Object.entries(summary).map(([exp, d]) => ({
    expirationSecs: Number(exp),
    expirationLabel: formatExp(Number(exp)),
    total: d.total, wins: d.wins, wr: d.total > 0 ? (d.wins / d.total * 100).toFixed(1) : '?',
  }));
}

function formatExp(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec === 60) return '1min';
  return `${sec / 60}min`;
}

function logExpirationTable() {
  const rows = expirationAnalysis.filter(a => a.simulated);
  if (rows.length === 0) return;
  console.log('\n📊 ANÁLISE DE EXPIRAÇÃO (vs 5min real):');
  const agg = aggregateExpirationSim();
  const cols = agg.map(a => `${a.expirationLabel}: ${a.wr}%WR(${a.total})`).join(' | ');
  console.log('   ' + cols);
  // Tabela detalhada das últimas 5 ops
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

function logReport(report) {
  console.log(`\n📊 RELATÓRIO | Ops: ${report.summary.totalOps} | WR: ${report.summary.wr}% | Lucro: R$${report.summary.profit}`);
  for (const a of report.byAsset) {
    const profitStr = (Number(a.profit) >= 0 ? '+' : '') + 'R$' + a.profit;
    console.log(`   ${a.verdict} ${a.key.padEnd(10)} dir:${a.direction?.padEnd(5)} WR:${a.wr}%(${a.sampleSize}) ${profitStr}`);
  }
}

// ─── PRICE TRACKING DURING OPERATION ─────────────────────────────────────────
const priceSnapshots = new Map(); // activeId → [{atMs, close}]
const snapshotInterval = null;

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

    // Carrega todos OTCs da API
    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};
    const allOTC = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    console.log(`[📋] Encontrados ${allOTC.length} ativos OTC`);
    console.log('─'.repeat(60));
    for (const a of allOTC) console.log(`   ${a.name}`);
    console.log('─'.repeat(60) + '\n');

    // Registra cada OTC e inicializa learning state
    const registeredKeys = new Set();
    for (const a of allOTC) {
      const key = registerOTC(a.activeId, a.name);
      registeredKeys.add(key);

      if (!state[key]) {
        state[key] = {
          key,
          historicalWR: OTC_ASSETS[a.activeId].wr,
          direction: OTC_ASSETS[a.activeId].defaultDirection,
          observedWins: 0, observedTotal: 0,
          rollingWR: OTC_ASSETS[a.activeId].wr,
          estimatedWR: OTC_ASSETS[a.activeId].wr,
          disabled: false, disabledReason: null,
          consecutiveLosses: 0, pausedUntil: 0,
          lastLossAt: 0, lastWinAt: 0,
          totalProfit: 0, directionFlips: 0, lastDirectionFlipAt: 0,
        };
      }

      buf5s.set(a.activeId, { ticks: [], assetId: a.activeId, name: a.name, key });
      buf1m.set(a.activeId, { ticks: [], assetId: a.activeId, name: a.name, key });
      ws.subscribeCandles(a.activeId, S.candleSizeSeconds);
      ws.subscribeCandles(a.activeId, 60);
    }
    persistState();

    console.log('='.repeat(70));
    console.log('🧠 BOT v9 - TODOS OTCs + EXPIRAÇÃO + LEARNING');
    console.log('='.repeat(70));
    console.log(`[⏳] Warmup ${S.warmupMs / 1000}s...`);
    await new Promise(r => setTimeout(r, S.warmupMs));

    // Inicia snapshot de preço para análise de expiração
    if (EA.enabled) {
      snapshotTimer = setInterval(() => {
        for (const [aid, snapshots] of priceSnapshots.entries()) {
          const buf = buf5s.get(aid);
          if (buf && buf.ticks.length > 0) {
            const last = buf.ticks[buf.ticks.length - 1];
            snapshots.push({ atMs: last.atMs, close: last.close });
            if (snapshots.length > 200) snapshots.shift();
          }
        }
      }, EA.trackEveryMs);
    }

    warmupDone = true;
    console.log('[✅] INICIADO!\n');
  });

  // ─── Candle ───────────────────────────────────────────────────────────────
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

    // TTL cleanup
    for (const [a, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        console.warn(`[🧹 TTL] ${op.name} (aid=${a})`);
        activeOps.delete(a);
        priceSnapshots.delete(a);
      }
    }

    const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
    if (!b5 || !b1) return;

    if (activeOps.has(aid) && (Date.now() - activeOps.get(aid).openedAt) < COOLDOWN_MS) return;

    const sig = getSignal(b5, b1, aid);
    if (!sig) return;

    const info = OTC_ASSETS[aid];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);

    // Entry price: último candle close
    const entryPrice = b5.ticks[b5.ticks.length - 1].close;
    const entryTime  = Date.now();

    ws.placeOrder({ price: sig.stake, activeId: aid, direction: sig.signal, expiration, optionTypeId, balanceId });

    activeOps.set(aid, {
      name: info.name, key: info.key, assetId: aid,
      direction: sig.signal, expected: state[info.key]?.estimatedWR,
      rsi: sig.rsi, regime: sig.regime, stake: sig.stake,
      entryPrice, entryTime,
    });

    priceSnapshots.set(aid, [{ atMs: entryTime, close: entryPrice }]);

    const ciStr = `${(sig.ci.lower*100).toFixed(1)}%-${(sig.ci.upper*100).toFixed(1)}%`;
    console.log(`[📊 ${info.name}] ${sig.signal} RSI:${sig.rsi.toFixed(0)} regime:${sig.regime} stake:R$${sig.stake} IC:${ciStr}`);

    resultsList.push({
      assetId: aid, active: info.name, key: info.key, direction: sig.signal,
      expected: state[info.key]?.estimatedWR, rsi: sig.rsi, regime: sig.regime,
      stake: sig.stake, entryPrice, timestamp: new Date().toISOString(),
      expirationSecs: EXPIRATION_MIN * 60,
    });
    fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
  });

  // ─── Fechamento ─────────────────────────────────────────────────────────────
  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op  = activeOps.get(aid);
    if (!op) {
      console.warn('[MISSED] aid=', aid);
      return;
    }

    const won    = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = won ? 'win' : 'loss';
    const profit = won ? op.stake * 0.82 : -op.stake;
    const emoji  = won ? '✅' : '❌';

    // Simula expirações
    let simResults = null;
    if (EA.enabled) {
      const snapshots = priceSnapshots.get(aid) || [];
      simResults = simulateExpirations(op.entryTime, op.entryPrice, op.direction, buf5s.get(aid));
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
      expirationSecs: EXPIRATION_MIN * 60,
      result, profit,
      simulated: simResults,
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(P.expirationAnalysis, JSON.stringify(expirationAnalysis, null, 2));

    updateLearning(op.key, result, profit);
    activeOps.delete(aid);
    priceSnapshots.delete(aid);

    // Ticker
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

  // Ticker
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

  // Relatório a cada 5min
  setInterval(() => {
    const rep = generateReport();
    logReport(rep);
    logExpirationTable();
  }, REPORT_INTERVAL_MS);

  // Reconcile
  setInterval(() => {
    for (const [aid, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        const idx = resultsList.findIndex(r => r.assetId === aid && !r.result);
        if (idx >= 0) { resultsList[idx].result = 'unknown'; resultsList[idx].profit = 0; }
        activeOps.delete(aid);
        priceSnapshots.delete(aid);
      }
    }
  }, 60_000);
}

// ─── FINAL ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v9:\n');
  const ops = resultsList.filter(r => r.result && r.result !== 'unknown');
  const wins = ops.filter(r => r.result === 'win').length;
  const total = ops.length;
  const unknown = resultsList.filter(r => r.result === 'unknown').length;
  const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
  console.log(`📊 Ops: ${total} | W: ${wins} | L: ${total - wins} | WR: ${total > 0 ? (wins/total*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro: R$${profitTotal.toFixed(2)}`);
  console.log('\n📋 Por ativo:');
  const byKey = {};
  for (const r of ops) {
    if (!byKey[r.key]) byKey[r.key] = { wins: 0, total: 0, profit: 0 };
    byKey[r.key].total++;
    if (r.result === 'win') byKey[r.key].wins++;
    byKey[r.key].profit += r.profit || 0;
  }
  for (const [key, d] of Object.entries(byKey)) {
    const wr = (d.wins / d.total * 100).toFixed(0);
    const p = (d.profit >= 0 ? '+' : '') + 'R$' + d.profit.toFixed(2);
    console.log(`   ${key.padEnd(10)} ${d.wins}/${d.total} (${wr}%) ${p}`);
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
