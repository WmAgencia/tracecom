/**
 * OTC BOT v12 - WHITELIST + EARLY SELL HTTP + 2MIN
 * ==========================================================================
 * Early sell: polling HTTP API a cada 10s
 * Whitelist: 12 ativos com WR >= 60% da v9
 * Expiração: 2 min
 * Max 5 ops simultâneas
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync('D:/Tracecom project/bot-config-v12.json', 'utf8'));
const C   = CONFIG.trading;
const S   = CONFIG.strategy;
const L   = CONFIG.learning;
const ES  = CONFIG.earlySell;
const P   = CONFIG.paths;
const WL_KEYS = Object.keys(CONFIG.whitelist).filter(k => k !== '_desc');

const EMAIL    = CONFIG.login.email;
const PASSWORD = CONFIG.login.password;

const BASE_STAKE     = C.baseStake;
const EXPIRATION_MIN = C.expirationMinutes;
const EXPIRATION_MS  = EXPIRATION_MIN * 60 * 1000;

// ─── HTTP ────────────────────────────────────────────────────────────────────
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
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
               'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  return JSON.parse(res.body).result?.ssid ?? JSON.parse(res.body).ssid;
}

async function apiGet(path, ssid) {
  return httpReq({
    hostname: 'iqoption.com', path, method: 'GET',
    headers: { 'Authorization': `Bearer ${ssid}`, 'Origin': 'https://iqoption.com' }
  });
}

async function apiPost(path, body, ssid) {
  const data = JSON.stringify(body);
  return httpReq({
    hostname: 'iqoption.com', path, method: 'POST',
    headers: { 'Authorization': `Bearer ${ssid}`, 'Content-Type': 'application/json',
               'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com' }
  }, data);
}

async function getActiveOptions(ssid) {
  const res = await apiGet('/api/options/active', ssid);
  try { return JSON.parse(res.body); } catch { return {}; }
}

async function sellOption(optionId, ssid) {
  const res = await apiPost('/api/options/sell', { option_id: Number(optionId) }, ssid);
  try { return JSON.parse(res.body); } catch { return {}; }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const WHITELIST = Object.entries(CONFIG.whitelist).filter(([k]) => k !== '_desc').map(([k, v]) => ({
  key: k, name: v.name, direction: v.direction, wr: v.wr
}));

let state = {};
for (const asset of WHITELIST) {
  state[asset.key] = {
    key: asset.key, name: asset.name,
    historicalWR: asset.wr, direction: asset.direction,
    observedWins: 0, observedTotal: 0,
    rollingWR: asset.wr, estimatedWR: asset.wr,
    disabled: false, disabledReason: null,
    consecutiveLosses: 0, pausedUntil: 0,
    totalProfit: 0, directionFlips: 0,
    lastSignalAt: 0,
  };
}

function persistState() {
  try { fs.writeFileSync(P.state, JSON.stringify(state, null, 2)); } catch {}
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
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
  if (!s || s.disabled) return null;
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

function updateLearning(key, result, profit, wasEarlySell = false) {
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
  s.rollingWR    = s.observedTotal > 0 ? (s.observedWins / s.observedTotal) * 100 : s.historicalWR;
  s.estimatedWR  = L.weightHistorical * s.historicalWR + L.weightObserved * s.rollingWR;

  if (s.observedTotal >= L.minSampleSize && s.rollingWR < L.killWR * 100) {
    if (!s.disabled) { s.disabled = true; s.disabledReason = `WR ${s.rollingWR.toFixed(1)}% < ${L.killWR * 100}%`; console.log(`[💀 KILL] ${key}: ${s.disabledReason}`); }
  }
  if (s.disabled && s.observedTotal >= L.minSampleSize + 5 && s.rollingWR >= 55) {
    s.disabled = false; s.disabledReason = null; console.log(`[♻️ REVIVE] ${key} (WR ${s.rollingWR.toFixed(1)}%)`);
  }
  persistState();
}

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
const buf5s       = new Map();
const buf1m       = new Map();
const activeOps   = new Map();  // activeId → { name, key, direction, stake, entryPrice, entryTime, optionId, wsOrderId }
const resultsList = [];
const expirationAnalysis = [];

// ─── EARLY SELL via HTTP ─────────────────────────────────────────────────────
async function checkAndSellActiveOps(ssid) {
  if (!ES.enabled) return;
  if (activeOps.size === 0) return;

  const now = Date.now();
  const activeData = await getActiveOptions(ssid);
  const options = activeData?.result ?? activeData?.data ?? [];

  for (const [aid, op] of activeOps.entries()) {
    const elapsed = now - op.openedAt;
    const remaining = op.expiresAt - now;

    // Só vende se passou do tempo mínimo e ainda resta tempo
    if (elapsed < ES.minSecondsBeforeSell * 1000) continue;
    if (remaining <= 0) continue;

    // Encontra a opção ativa correspondente
    let optionData = null;
    for (const opt of options) {
      if (opt.active_id === aid || opt.active_id === Number(aid)) {
        optionData = opt;
        break;
      }
    }

    if (!optionData) continue;

    const currentPrice = Number(optionData.current_price ?? optionData.price ?? 0);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

    // Calcula lucro atual
    let currentProfit;
    const direction = op.direction;
    const entryPrice = op.entryPrice;
    const maxProfit = op.stake * 1.82; // payout ~1.82

    if (direction === 'CALL') {
      currentProfit = currentPrice > entryPrice
        ? (currentPrice - entryPrice) / entryPrice * maxProfit
        : -(Math.abs(currentPrice - entryPrice) / entryPrice * maxProfit);
    } else {
      currentProfit = currentPrice < entryPrice
        ? (entryPrice - currentPrice) / entryPrice * maxProfit
        : -(Math.abs(currentPrice - entryPrice) / entryPrice * maxProfit);
    }

    // Atualiza peak profit
    if (currentProfit > (op.peakProfit ?? 0)) {
      op.peakProfit = currentProfit;
    }

    // Condições de early sell:
    // 1) Lucro >= minProfitToSell (R$0.20)
    // 2) OU lucro >= profitPercentToSell (50%) do peak profit
    const profitPercentOfPeak = (op.peakProfit ?? 0) > 0 ? currentProfit / op.peakProfit : 0;
    const shouldSell =
      (currentProfit >= ES.minProfitToSell) ||
      (currentProfit >= ES.profitPercentToSell * (op.peakProfit ?? currentProfit));

    if (shouldSell && currentProfit > 0) {
      console.log(`[💰 EARLY SELL] ${op.name.replace('front.','').replace('-OTC','')} | ${direction} | entry:R$${entryPrice.toFixed(4)} | current:R$${currentPrice.toFixed(4)} | profit:R$${currentProfit.toFixed(2)} | peak:R$${(op.peakProfit ?? 0).toFixed(2)} | elapsed:${Math.round(elapsed/1000)}s`);

      const optionId = optionData.id ?? optionData.option_id;
      if (optionId) {
        const sellRes = await sellOption(optionId, ssid);
        console.log(`[💰 SELL RESPONSE] ${JSON.stringify(sellRes).slice(0, 100)}`);
      }
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  // Zera arquivos antigos
  try { fs.unlinkSync('D:/Tracecom project/resultados-v12.json'); } catch {}
  try { fs.unlinkSync('D:/Tracecom project/relatorio-v12.json'); } catch {}
  try { fs.unlinkSync('D:/Tracecom project/expiracao-analysis-v12.json'); } catch {}
  try { fs.unlinkSync(P.state); } catch {}
  persistState();

  const ssid = await login();
  console.log('[LOGIN] OK!');

  const ws = new IqWsClient({ log: () => {} });
  let balanceId = null;
  let warmupDone = false;

  ws.on('ready', async () => {
    console.log('[WS] Ready!');
    const balMsg = await ws.getBalances({ timeoutMs: 60000 }).catch(e => {
      console.error('[BALANCES ERROR]', e.message);
      return null;
    });
    if (!balMsg) { console.error('[ERRO] Sem acesso a saldos'); ws.close(); return; }
    const balData = balMsg?.msg ?? balMsg;
    const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
    const conta = balances.find(b => b.type === 4) || balances[0];
    if (!conta || conta.amount <= 0) { console.error('[ERRO] Sem saldo'); ws.close(); return; }
    balanceId = conta.id;
    console.log(`[💼 CONTA] DEMO | Saldo: R$${conta.amount.toFixed(2)}\n`);

    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};

    // Subscribe apenas whitelist
    let found = 0;
    for (const asset of WHITELIST) {
      for (const [id, act] of Object.entries(turboActives)) {
        if (act.name === asset.name) {
          const aid = Number(id);
          buf5s.set(aid, { ticks: [], assetId: aid, name: act.name, key: asset.key });
          buf1m.set(aid, { ticks: [], assetId: aid, name: act.name, key: asset.key });
          ws.subscribeCandles(aid, S.candleSizeSeconds);
          ws.subscribeCandles(aid, 60);
          found++;
          break;
        }
      }
    }

    console.log('='.repeat(70));
    console.log('🧠 BOT v12 - WHITELIST + EARLY SELL HTTP + 2MIN');
    console.log('='.repeat(70));
    console.log('\n📋 WHITELIST (' + found + '/' + WHITELIST.length + '):');
    for (const a of WHITELIST) {
      const s = state[a.key];
      console.log(`   ✅ ${a.name.replace('front.','').replace('-OTC','').padEnd(18)} dir:${a.direction} histWR:${a.wr}%`);
    }
    console.log(`\n[⏳] Warmup ${S.warmupMs / 1000}s...`);
    await new Promise(r => setTimeout(r, S.warmupMs));
    warmupDone = true;
    console.log('[✅] INICIADO! Exp:2min | Stake:R$2 | EarlySell:ON | MaxOps:' + C.maxConcurrentOps + '\n');
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

    // Limpa ops expiradas
    for (const [a, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > C.operationTtlMs) {
        activeOps.delete(a);
      }
    }

    // Max concurrent
    if (activeOps.size >= C.maxConcurrentOps) return;

    const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
    if (!b5 || !b1) return;

    // Cooldown
    if (activeOps.has(aid)) return;

    const sig = getSignal(b5, b1, b5.key);
    if (!sig) return;

    const s = state[b5.key];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);
    const expiresAt = (ws.serverNow() ?? Date.now()) + EXPIRATION_MS;
    const entryPrice = b5.ticks[b5.ticks.length - 1].close;
    const entryTime  = Date.now();

    const wsOrderId = ws.placeOrder({ price: sig.stake, activeId: aid, direction: sig.signal, expiration, optionTypeId, balanceId });

    activeOps.set(aid, {
      name: b5.name, key: b5.key, assetId: aid,
      direction: sig.signal, stake: sig.stake,
      entryPrice, entryTime, expiresAt,
      wsOrderId, peakProfit: 0,
    });

    const ciStr = `${(sig.ci.lower*100).toFixed(1)}%-${(sig.ci.upper*100).toFixed(1)}%`;
    console.log(`[📊 ${b5.name.replace('front.','').replace('-OTC','')}] ${sig.signal} RSI:${sig.rsi.toFixed(0)} IC:${ciStr} | Ops ativas:${activeOps.size}/${C.maxConcurrentOps}`);

    resultsList.push({
      assetId: aid, active: b5.name, key: b5.key, direction: sig.signal,
      expected: s?.estimatedWR, rsi: sig.rsi,
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
    if (!op) { console.warn('[MISSED CLOSE] aid=', aid); return; }

    const won    = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = won ? 'win' : 'loss';
    const profit = won ? op.stake * 0.82 : -op.stake;
    const emoji = won ? '✅' : '❌';

    console.log(`[${emoji}] ${op.name.replace('front.','').replace('-OTC','')} | ${op.direction} | R$${op.stake} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

    const idx = resultsList.findIndex(r => r.assetId === aid && !r.result);
    if (idx >= 0) {
      resultsList[idx].result = result;
      resultsList[idx].profit = profit;
      fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
    }

    expirationAnalysis.push({
      assetId: aid, assetName: op.name, direction: op.direction,
      entryPrice: op.entryPrice, entryTime: op.entryTime, result, profit,
      timestamp: new Date().toISOString(),
    });
    try { fs.writeFileSync(P.expirationAnalysis, JSON.stringify(expirationAnalysis, null, 2)); } catch {}

    updateLearning(op.key, result, profit);
    activeOps.delete(aid);

    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(1);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      console.log(`[📈] Total: ${total} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)}`);
    }
  });

  await ws.connect({ ssid });

  // ─── Early Sell Loop via HTTP ──────────────────────────────────────────────
  setInterval(async () => {
    if (!ES.enabled || activeOps.size === 0) return;
    try {
      await checkAndSellActiveOps(ssid);
    } catch (e) {
      console.warn('[EARLY SELL ERROR]', e.message);
    }
  }, ES.checkIntervalMs);

  // ─── Ticker ────────────────────────────────────────────────────────────────
  setInterval(() => {
    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(0);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      process.stdout.write(`\r[⏱ ${new Date().toLocaleTimeString()}] Ops:${total} WR:${wr}% Lucro:R$${profitTotal.toFixed(2)} Ativas:${activeOps.size}   `);
    }
  }, 30_000);

  // ─── Relatório periódico ───────────────────────────────────────────────────
  setInterval(() => {
    const ops = resultsList.filter(r => r.result);
    if (ops.length === 0) return;
    const wins = ops.filter(r => r.result === 'win').length;
    const total = ops.length;
    const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
    const report = {
      timestamp: new Date().toISOString(),
      summary: { totalOps: total, wins, losses: total - wins, wr: ((wins / total) * 100).toFixed(1), profit: profitTotal.toFixed(2) },
      byAsset: Object.entries(
        ops.reduce((acc, r) => {
          if (!acc[r.key]) acc[r.key] = { wins: 0, total: 0, profit: 0 };
          acc[r.key].total++;
          if (r.result === 'win') acc[r.key].wins++;
          acc[r.key].profit += r.profit || 0;
          return acc;
        }, {})
      ).map(([key, d]) => ({
        key, direction: state[key]?.direction, wr: (d.wins / d.total * 100).toFixed(1),
        sampleSize: d.total, profit: d.profit.toFixed(2),
        verdict: state[key]?.disabled ? '❌ OFF' : state[key]?.pausedUntil > Date.now() ? '⏸ pausa' : '✅ ativo',
      })),
    };
    try { fs.writeFileSync(P.report, JSON.stringify(report, null, 2)); } catch {}
  }, C.reportIntervalMs);
}

// ─── FINAL ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v12:\n');
  const ops = resultsList.filter(r => r.result && r.result !== 'unknown');
  const wins = ops.filter(r => r.result === 'win').length;
  const total = ops.length;
  const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
  console.log(`📊 Ops: ${total} | W: ${wins} | L: ${total - wins} | WR: ${total > 0 ? ((wins/total*100).toFixed(1)) : '0'}%`);
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
  // Salva relatório final
  const report = {
    timestamp: new Date().toISOString(),
    summary: { totalOps: total, wins, losses: total - wins, wr: total > 0 ? ((wins/total*100).toFixed(1)) : '0', profit: profitTotal.toFixed(2) },
    byAsset: Object.entries(byKey).map(([key, d]) => ({
      key, direction: state[key]?.direction, wr: (d.wins / d.total * 100).toFixed(1),
      sampleSize: d.total, profit: d.profit.toFixed(2),
    })),
  };
  try { fs.writeFileSync(P.report, JSON.stringify(report, null, 2)); } catch {}
  try { fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2)); } catch {}
  try { fs.writeFileSync(P.expirationAnalysis, JSON.stringify(expirationAnalysis, null, 2)); } catch {}
  persistState();
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
