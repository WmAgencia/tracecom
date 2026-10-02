/**
 * OTC BOT v13 - INTERFACE SIMPLES EM TEMPO REAL
 * ==========================================================================
 * - Contador de candles em linha única
 * - Lucro calculado pelo saldo real
 * - Interface limpa igual ao resultado final
 */
import fs from 'fs';
import https from 'https';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync('D:/Tracecom project/bot-config-v13.json', 'utf8'));
const C   = CONFIG.trading;
const S   = CONFIG.strategy;
const L   = CONFIG.learning;
const P   = CONFIG.paths;

const EMAIL    = CONFIG.login.email;
const PASSWORD = CONFIG.login.password;
const BASE_STAKE        = C.baseStake;
const EXPIRATION_MIN    = C.expirationMinutes;
const COOLDOWN_MS       = C.cooldownMs;
const OPERATION_TTL_MS  = C.operationTtlMs;

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {};
try {
  if (fs.existsSync(P.state)) state = JSON.parse(fs.readFileSync(P.state, 'utf8'));
} catch (e) {}

const WHITELIST = (CONFIG.whitelist ? Object.entries(CONFIG.whitelist) : []).map(([k, v]) => ({
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
      totalProfit: 0,
    };
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
  if (buf1m.ticks.length < 3) return null;

  const regime = detectRegime(buf5s.ticks);
  if (regime === 'trending') return null;

  const fade = fade4Signal(buf5s.ticks, s.direction);
  if (!fade) return null;

  const rsi = calcRSI(buf5s.ticks);
  if (fade.signal === 'CALL' && rsi <= S.rsiOversold) return null;
  if (fade.signal === 'PUT'   && rsi >= S.rsiOverbought) return null;

  const ci = wrCI(s.observedWins, s.observedTotal);
  if (s.observedTotal >= L.minSampleSize && ci.lower < S.icLowerGate) return null;

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
    s.lastWinAt = Date.now();
  } else if (result === 'loss') {
    s.consecutiveLosses++;
    s.lastLossAt = Date.now();
    if (s.consecutiveLosses >= L.lossStreakLimit) {
      s.pausedUntil = Date.now() + L.lossStreakCooldownMs;
      console.log(`[⏸ PAUSE] ${key}: ${s.consecutiveLosses} losses → cooldown`);
      s.consecutiveLosses = 0;
    }
  }
  s.rollingWR = s.observedTotal > 0 ? (s.observedWins / s.observedTotal) * 100 : s.historicalWR;
  persistState();
}

// ─── UI SIMPLES ────────────────────────────────────────────────────────────────
let candleCount = 0;
let initialBalance = 0;
let lastStatusLine = '';

function formatProfit(valor) {
  if (valor >= 0) return `+R$${valor.toFixed(2)}`;
  return `-R$${Math.abs(valor).toFixed(2)}`;
}

function renderStatusLine() {
  const ops = resultsList.filter(r => r.result);
  const total = ops.length;
  if (total === 0) return;

  const wins = ops.filter(r => r.result === 'win').length;
  const wr = ((wins / total) * 100).toFixed(1);
  const profitReal = (currentBalance - initialBalance).toFixed(2);

  const newLine = `[🕯️ ${candleCount}] [📊 ${total} ops | W: ${wins} | L: ${total-wins} | WR: ${wr}% | Lucro: ${formatProfit(parseFloat(profitReal))}]`;

  if (newLine !== lastStatusLine) {
    process.stdout.write(`\r${newLine}${' '.repeat(Math.max(0, 80 - newLine.length))}`);
    lastStatusLine = newLine;
  }
}

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
const buf5s = new Map();
const buf1m = new Map();
const activeOps = new Map();
const resultsList = [];
let currentBalance = 0;

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
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  return JSON.parse(res.body).result?.ssid ?? JSON.parse(res.body).ssid;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK!');

  const ws = new IqWsClient({ log: (m) => {} }); // Silencia todos os logs internos

  // Contador de candles
  ws.on('candle-generated', () => { candleCount++; });

  let balanceId = null;
  let warmupDone = false;

  ws.on('ready', async () => {
    console.log('[WS] Ready!');
    const balMsg = await ws.getBalances();
    const balData = balMsg?.msg ?? balMsg;
    const balances = Array.isArray(balData) ? balData : [];

    // Debug: mostrar todos os saldos
    console.log('[DEBUG] Saldos encontrados:');
    for (const b of balances) {
      const tipo = b.type === 1 ? 'REAL' : b.type === 4 ? 'DEMO' : 'OUTRO';
      console.log(`  - ${tipo}: R$${b.amount.toFixed(2)} (id: ${b.id})`);
    }

    // Pegar DEMO (type 4)
    const conta = balances.find(b => b.type === 4);
    if (!conta || conta.amount <= 0) {
      console.error('[ERRO] Sem saldo DEMO'); ws.close(); return;
    }
    balanceId = conta.id;
    initialBalance = conta.amount;
    currentBalance = conta.amount;
    console.log(`[💼 CONTA] DEMO | Saldo Inicial: R$${initialBalance.toFixed(2)}\n`);

    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};

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

    console.log(`[📋] ${subscribed.length}/${WHITELIST.length} ativos | [⏳] Warmup ${(S.warmupMs / 1000).toFixed(0)}s...\n`);
    await new Promise(r => setTimeout(r, S.warmupMs));

    warmupDone = true;
    console.log('[✅] INICIADO! Stake: R$' + BASE_STAKE + '\n');
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
      if (Date.now() - op.entryTime > OPERATION_TTL_MS) { activeOps.delete(a); }
    }

    const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
    if (!b5 || !b1) return;

    if (activeOps.has(aid) && (Date.now() - activeOps.get(aid).entryTime) < COOLDOWN_MS) return;

    const sig = getSignal(b5, b1, b5.key);
    if (!sig) return;

    const s = state[b5.key];
    const serverNowSec = Math.floor((ws.serverNow() ?? Date.now()) / 1000);
    const { expiration, optionTypeId } = computeExpiration(serverNowSec, EXPIRATION_MIN);

    const orderPayload = {
      body: {
        price: sig.stake,
        active_id: aid,
        expired: expiration,
        direction: sig.signal.toLowerCase(),
        option_type_id: optionTypeId,
        user_balance_id: Number(balanceId)
      },
      name: 'binary-options.open-option',
      version: '1.0'
    };

    ws.send('sendMessage', orderPayload, ws.uuid().replace(/-/g, "").slice(0, 12));

    activeOps.set(aid, {
      name: b5.name, key: b5.key, assetId: aid,
      direction: sig.signal, expected: s?.estimatedWR,
      rsi: sig.rsi, regime: sig.regime, stake: sig.stake,
      entryTime: Date.now(),
      expiration: expiration,
    });

    console.log(`[📤 ORDEM] ${b5.name} | ${sig.signal} | R$${sig.stake} | exp:${expiration} | aid:${aid}`);

    resultsList.push({
      assetId: aid, active: b5.name, key: b5.key, direction: sig.signal,
      expected: s?.estimatedWR, rsi: sig.rsi,
      stake: sig.stake, timestamp: new Date().toISOString(),
    });
    try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {}
  });

  ws.on('socket-option-opened', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op = activeOps.get(aid);
    if (!op) {
      console.log(`[❌ ERRO] Opened mas não encontrou op: aid=${aid}`);
      return;
    }
    console.log(`[✅ OPENSENTO] ${op.name} | ${op.direction} | exp:${raw.expired}`);
  });

  ws.on('socket-option-closed', async (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op  = activeOps.get(aid);
    if (!op) {
      console.log(`[❌ ERRO] Closed mas não encontrou op: aid=${aid}`);
      return;
    }

    const won    = (raw.win ?? '').toLowerCase() === 'win';
    const result = won ? 'win' : 'loss';
    const profit = won ? Number(raw.win) - op.stake : -op.stake;

    // Atualizar saldo atual
    const balMsg = await ws.getBalances();
    const balData = balMsg?.msg ?? balMsg;
    const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
    const conta = balances.find(b => b.type === 4) || balances[0];
    if (conta) currentBalance = conta.amount;

    const idx = resultsList.findIndex(r => r.assetId === aid && !r.result);
    if (idx >= 0) {
      resultsList[idx].result = result;
      resultsList[idx].profit = profit;
      try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {}
    }

    updateLearning(op.key, result, profit);
    activeOps.delete(aid);

    renderStatusLine();
  });

  await ws.connect({ ssid });

  setInterval(() => {
    if (warmupDone) renderStatusLine();
  }, 1000);
}

// ─── FINAL ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  const ops = resultsList.filter(r => r.result);
  const wins = ops.filter(r => r.result === 'win').length;
  const total = ops.length;
  const profitTotal = ops.reduce((s, r) => s + (r.profit || 0), 0);
  const profitReal = currentBalance - initialBalance;

  console.log('\n\n🛑 RESULTADO FINAL:\n');
  console.log(`📊 Ops: ${total} | W: ${wins} | L: ${total - wins} | WR: ${total > 0 ? (wins/total*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro (bot): ${formatProfit(profitTotal)}`);
  console.log(`💰 Lucro (real): ${formatProfit(profitReal)}`);
  console.log(`💼 Saldo Final: R$${currentBalance.toFixed(2)}`);

  const byKey = {};
  for (const r of ops) {
    if (!byKey[r.key]) byKey[r.key] = { wins: 0, total: 0, profit: 0 };
    byKey[r.key].total++;
    if (r.result === 'win') byKey[r.key].wins++;
    byKey[r.key].profit += r.profit || 0;
  }

  if (Object.keys(byKey).length > 0) {
    console.log('\n📋 Por ativo:');
    for (const [key, d] of Object.entries(byKey)) {
      const wr = (d.wins / d.total * 100).toFixed(0);
      console.log(`   ${key.padEnd(14)} ${d.wins}/${d.total} (${wr}%) ${formatProfit(d.profit)}`);
    }
  }

  try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {}
  persistState();
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
