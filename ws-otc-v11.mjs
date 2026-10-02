/**
 * OTC BOT v11 - TODOS OTCs + EARLY SELL + 2MIN + LEARNING
 * ==========================================================================
 * - Todos os ativos OTC da API
 * - Expiração: 2 minutos
 * - Early Sell: vende antes se gráfico reverte contra
 * - Learning: auto-elimina ativos ruins
 * - Config: bot-config.json
 */
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync('D:/Tracecom project/bot-config.json', 'utf8'));
const C   = CONFIG.trading;
const S   = CONFIG.strategy;
const L   = CONFIG.learning;
const EA  = CONFIG.expirationAnalysis;
const P   = CONFIG.paths;

const EMAIL    = CONFIG.login.email;
const PASSWORD = CONFIG.login.password;
const BASE_STAKE         = C.baseStake;
const EXPIRATION_MIN     = C.expirationMinutes;
const EXPIRATION_MS      = EXPIRATION_MIN * 60 * 1000;
const COOLDOWN_MS        = C.cooldownMs;
const OPERATION_TTL_MS   = C.operationTtlMs;
const REPORT_INTERVAL_MS = C.reportIntervalMs;

// ─── EARLY SELL CONFIG ───────────────────────────────────────────────────────
const EARLY_SELL = {
  enabled: true,
  checkIntervalMs: 5000,      // verifica a cada 5s
  minProfitToSell: 0.30,      // só vende se tiver ≥ R$0.30 de lucro
  reversalThreshold: 0.00015,  // vende se candle reverte ≥ 0.015% contra direção
  trailingProfitMin: 0.50,    // trailing: se teve ≥ R$0.50 de lucro em algum momento, aceita vender com qualquer lucro
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let state = {};
try {
  if (fs.existsSync(P.state)) state = JSON.parse(fs.readFileSync(P.state, 'utf8'));
} catch (e) {}

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
    results[expSecs] = !best || bestDiff > 60000 ? 'nocandle'
      : (direction === 'CALL' ? best.close > entryPrice : best.close < entryPrice) ? 'win' : 'loss';
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

// ─── EARLY SELL LOGIC ────────────────────────────────────────────────────────
/**
 * Decide se deve vender antes da expiração.
 *
 * Estratégia:
 * - CALL: se o candle mais recente fechou abaixo do candle anterior E
 *         o candle anterior estava acima do anterior-a-anterior (reversão de alta → baixa)
 *         → vende se tiver lucro
 * - PUT:  lógica espelhada
 *
 * Também: trailing profit — se já teve lucro grande em algum momento, aceita vender
 *        com qualquer lucro restante (protege ganhos).
 */
function shouldEarlySell(op, buf5s, candlesDuringTrade) {
  if (!EARLY_SELL.enabled) return false;
  if (candlesDuringTrade.length < 2) return false;

  const now = Date.now();
  const elapsed = now - op.openedAt;
  const remaining = op.expiresAt - now;

  // Não vende se faltam < 20s ou > 80% do tempo
  if (remaining < 20_000) return false;
  if (elapsed < 30_000) return false; // deixa rodar pelo menos 30s

  // Estima lucro atual
  const lastCandle = candlesDuringTrade[candlesDuringTrade.length - 1];
  const prevCandle = candlesDuringTrade[candlesDuringTrade.length - 2];
  if (!lastCandle || !prevCandle) return false;

  const currentPrice = lastCandle.close;
  const entryPrice = op.entryPrice;

  // CALL: lucra se currentPrice > entryPrice
  // PUT:  lucra se currentPrice < entryPrice
  let currentProfit;
  if (op.direction === 'CALL') {
    currentProfit = currentPrice > entryPrice
      ? (currentPrice - entryPrice) / entryPrice * op.stake * 1.82
      : -(Math.abs(currentPrice - entryPrice) / entryPrice * op.stake);
  } else {
    currentProfit = currentPrice < entryPrice
      ? (entryPrice - currentPrice) / entryPrice * op.stake * 1.82
      : -(Math.abs(currentPrice - entryPrice) / entryPrice * op.stake);
  }

  // Atualiza peak profit
  if (currentProfit > op.peakProfit) {
    op.peakProfit = currentProfit;
  }

  // Trailing: se já teve lucro >= trailingProfitMin, aceita vender com qualquer lucro >= minProfitToSell
  if (op.peakProfit >= EARLY_SELL.trailingProfitMin && currentProfit >= EARLY_SELL.minProfitToSell) {
    return true;
  }

  // Reversão: candle atual reverteu contra a direção?
  const directionFavorable = op.direction === 'CALL'
    ? lastCandle.close > prevCandle.close
    : lastCandle.close < prevCandle.close;

  if (directionFavorable) return false; // ainda indo bem, mantém

  // Reverteu! Verifica magnitude da reversão
  const reversalSize = op.direction === 'CALL'
    ? (prevCandle.close - lastCandle.close) / lastCandle.close
    : (lastCandle.close - prevCandle.close) / lastCandle.close;

  if (reversalSize >= EARLY_SELL.reversalThreshold && currentProfit >= EARLY_SELL.minProfitToSell) {
    return true;
  }

  return false;
}

// ─── SIGNAL ──────────────────────────────────────────────────────────────────
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

// ─── UPDATE LEARNING ─────────────────────────────────────────────────────────
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
  console.log('   ' + agg.map(a => `${a.expirationLabel}: ${a.wr}%WR(${a.total})`).join(' | '));
  console.log('\n   Detalhado (últimas 5):');
  for (const a of rows.slice(-5)) {
    const actual = a.result === 'win' ? '✅' : a.result === 'loss' ? '❌' : a.result === 'early-sell' ? '💰' : '⚪';
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
  const earlySells = ops.filter(r => r.earlySell).length;
  const byAsset = {};
  for (const r of ops) {
    if (!byAsset[r.key]) byAsset[r.key] = { wins: 0, total: 0, profit: 0 };
    byAsset[r.key].total++;
    if (r.result === 'win' || r.earlySell) byAsset[r.key].wins++;
    byAsset[r.key].profit += r.profit || 0;
  }
  const report = {
    timestamp: new Date().toISOString(),
    summary: { totalOps: total, wins, losses: total - wins, earlySells,
      wr: total > 0 ? (wins / total * 100).toFixed(1) : '0', profit: profit.toFixed(2) },
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
  console.log(`\n📊 RELATÓRIO | Ops: ${report.summary.totalOps} | WR: ${report.summary.wr}% | Lucro: R$${report.summary.profit} | EarlySell: ${report.summary.earlySells}`);
  for (const a of report.byAsset) {
    const profitStr = (Number(a.profit) >= 0 ? '+' : '') + 'R$' + a.profit;
    console.log(`   ${a.verdict} ${a.key.padEnd(14)} dir:${(a.direction||'?').padEnd(5)} WR:${a.wr}%(${a.sampleSize}) ${profitStr}`);
  }
}

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
const buf5s = new Map();   // activeId → { ticks, assetId, name, key }
const buf1m = new Map();   // activeId → { ticks, assetId, name, key }
const activeOps = new Map();  // activeId → op
const earlySellTimers = new Map(); // activeId → timerId
const candlesDuringTrade = new Map(); // activeId → [{atMs, close}]
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

// ─── EARLY SELL MONITOR ──────────────────────────────────────────────────────
function startEarlySellMonitor(ws, aid) {
  if (earlySellTimers.has(aid)) return;

  const timerId = setInterval(() => {
    const op = activeOps.get(aid);
    if (!op) { clearInterval(timerId); earlySellTimers.delete(aid); return; }

    // Tempo restante
    const remaining = op.expiresAt - Date.now();
    if (remaining <= 0) { clearInterval(timerId); earlySellTimers.delete(aid); return; }

    const buf = buf5s.get(aid);
    if (!buf || buf.ticks.length < 2) return;

    // Coleta candles durante a operação
    if (!candlesDuringTrade.has(aid)) candlesDuringTrade.set(aid, []);
    const tradeCandles = candlesDuringTrade.get(aid);
    const lastTick = buf.ticks[buf.ticks.length - 1];
    if (tradeCandles.length === 0 || tradeCandles[tradeCandles.length - 1].atMs !== lastTick.atMs) {
      tradeCandles.push({ atMs: lastTick.atMs, close: lastTick.close });
      if (tradeCandles.length > 200) tradeCandles.shift();
    }

    const shouldSell = shouldEarlySell(op, buf, tradeCandles);
    if (shouldSell) {
      clearInterval(timerId);
      earlySellTimers.delete(aid);
      candlesDuringTrade.delete(aid);

      console.log(`[💰 EARLY SELL] ${op.name} | direction:${op.direction} | entry:R$${op.entryPrice.toFixed(4)} | current:R$${lastTick.close.toFixed(4)} | peak:R$${op.peakProfit.toFixed(2)} | remaining:${Math.round(remaining/1000)}s`);

      // Vende a opção
      ws.sellOption(aid);
      // O resultado vem via evento sell-equal / sell-error
    }
  }, EARLY_SELL.checkIntervalMs);

  earlySellTimers.set(aid, timerId);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const ssid = await login();
  console.log('[LOGIN] OK!');

  const ws = new IqWsClient({ log: () => {} });
  let balanceId = null;
  let warmupDone = false;
  let allAssetIds = []; // todos OTCs

  // ─── Sell Events ──────────────────────────────────────────────────────────
  ws.on('sell-equal', (msg) => {
    const raw = msg?.msg ?? msg;
    const aid = raw?.id ?? raw?.active_id ?? raw?.option_id;
    const sellProfit = Number(raw?.sell_profit ?? raw?.profit ?? raw?.amount ?? 0);
    console.log(`[💰 SOLD] aid=${aid} | sell_profit: R$${sellProfit.toFixed(2)}`);

    // Encontra a op correspondente
    let op = null;
    let foundAid = null;
    for (const [a, o] of activeOps.entries()) {
      if (Math.abs(a - (aid ?? 0)) < 100 || o.name?.includes(String(aid))) {
        op = o; foundAid = a; break;
      }
    }
    if (!op || foundAid === null) { console.warn('[SELL] Op não encontrada:', aid); return; }

    // Limpa timers
    if (earlySellTimers.has(foundAid)) { clearInterval(earlySellTimers.get(foundAid)); earlySellTimers.delete(foundAid); }
    candlesDuringTrade.delete(foundAid);

    // Atualiza resultado
    const idx = resultsList.findIndex(r => r.assetId === foundAid && !r.result);
    const profit = sellProfit - op.stake;
    if (idx >= 0) {
      resultsList[idx].result = 'early-sell';
      resultsList[idx].profit = profit;
      resultsList[idx].earlySell = true;
      resultsList[idx].sellPrice = sellProfit;
      fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
    }

    expirationAnalysis.push({
      assetId: foundAid, assetName: op.name, direction: op.direction,
      entryPrice: op.entryPrice, entryTime: op.entryTime,
      result: 'early-sell', profit,
      timestamp: new Date().toISOString(),
    });
    try { fs.writeFileSync(P.expirationAnalysis || 'D:/Tracecom project/expiracao-analysis-v11.json', JSON.stringify(expirationAnalysis, null, 2)); } catch {}

    updateLearning(op.key, sellProfit > op.stake ? 'win' : 'loss', profit, true);
    activeOps.delete(foundAid);

    console.log(`[💰 EARLY SELL RESULT] ${op.name} | R$${profit.toFixed(2)} | WR contribiu`);
    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win' || r.result === 'early-sell').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(1);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      console.log(`[📈] Total: ${total} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)} | EarlySell: ${ops.filter(r=>r.earlySell).length}`);
    }
  });

  ws.on('sell-error', (msg) => {
    const raw = msg?.msg ?? msg;
    console.warn('[SELL ERROR]', JSON.stringify(raw).slice(0, 200));
  });

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

    allAssetIds = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    console.log(`[📋] ${allAssetIds.length} ativos OTC encontrados`);
    console.log('─'.repeat(60));
    for (const a of allAssetIds) {
      const cleanName = a.name.replace('front.', '').replace('-OTC', '');
      console.log(`   ${cleanName}`);
      // Inicializa state se não existir
      if (!state[cleanName]) {
        const isPut = /ZAR|USD|RGBP|SHIB|LTC|DOT|ADA|SOL|LINK|UNI|AVAX|BCH/i.test(cleanName);
        state[cleanName] = {
          key: cleanName, name: a.name,
          historicalWR: 55 + Math.floor(Math.random() * 20),
          direction: isPut ? 'PUT' : 'CALL',
          observedWins: 0, observedTotal: 0,
          rollingWR: 55 + Math.floor(Math.random() * 20),
          estimatedWR: 55 + Math.floor(Math.random() * 20),
          disabled: false, disabledReason: null,
          consecutiveLosses: 0, pausedUntil: 0,
          lastLossAt: 0, lastWinAt: 0,
          totalProfit: 0, directionFlips: 0, lastDirectionFlipAt: 0,
        };
      }
      buf5s.set(a.activeId, { ticks: [], assetId: a.activeId, name: a.name, key: cleanName });
      buf1m.set(a.activeId, { ticks: [], assetId: a.activeId, name: a.name, key: cleanName });
      ws.subscribeCandles(a.activeId, S.candleSizeSeconds);
      ws.subscribeCandles(a.activeId, 60);
    }
    persistState();

    console.log('─'.repeat(60));
    console.log('\n' + '='.repeat(70));
    console.log('🧠 BOT v11 - TODOS OTCs + EARLY SELL + 2MIN + LEARNING');
    console.log('='.repeat(70));
    console.log(`\n[⏳] Warmup ${S.warmupMs / 1000}s...`);
    await new Promise(r => setTimeout(r, S.warmupMs));
    warmupDone = true;
    console.log('[✅] INICIADO! Exp:2min | Stake:R$2 | EarlySell:ON\n');
  });

  // ─── Candle Handler ──────────────────────────────────────────────────────
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

    // TTL
    for (const [a, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        if (earlySellTimers.has(a)) { clearInterval(earlySellTimers.get(a)); earlySellTimers.delete(a); }
        candlesDuringTrade.delete(a);
        activeOps.delete(a);
      }
    }

    const b5 = buf5s.get(aid), b1 = buf1m.get(aid);
    if (!b5 || !b1) return;

    if (activeOps.has(aid) && (Date.now() - activeOps.get(aid).openedAt) < COOLDOWN_MS) return;

    const sig = getSignal(b5, b1, b5.key);
    if (!sig) return;

    const s = state[b5.key];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);
    const expiresAt = (ws.serverNow() ?? Date.now()) + EXPIRATION_MS;

    const entryPrice = b5.ticks[b5.ticks.length - 1].close;
    const entryTime  = Date.now();

    ws.placeOrder({ price: sig.stake, activeId: aid, direction: sig.signal, expiration, optionTypeId, balanceId });

    activeOps.set(aid, {
      name: b5.name, key: b5.key, assetId: aid,
      direction: sig.signal, expected: s?.estimatedWR,
      rsi: sig.rsi, regime: sig.regime, stake: sig.stake,
      entryPrice, entryTime, expiresAt, peakProfit: 0,
    });

    candlesDuringTrade.set(aid, [{ atMs: entryTime, close: entryPrice }]);
    startEarlySellMonitor(ws, aid);

    const ciStr = `${(sig.ci.lower*100).toFixed(1)}%-${(sig.ci.upper*100).toFixed(1)}%`;
    console.log(`[📊 ${b5.name.replace('front.','').replace('-OTC','')}] ${sig.signal} RSI:${sig.rsi.toFixed(0)} IC:${ciStr}`);

    resultsList.push({
      assetId: aid, active: b5.name, key: b5.key, direction: sig.signal,
      expected: s?.estimatedWR, rsi: sig.rsi, regime: sig.regime,
      stake: sig.stake, entryPrice, timestamp: new Date().toISOString(),
      expirationSecs: EXPIRATION_MIN * 60,
    });
    fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
  });

  // ─── Fechamento natural ──────────────────────────────────────────────────
  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;
    const op  = activeOps.get(aid);
    if (!op) { console.warn('[MISSED CLOSE] aid=', aid); return; }

    // Limpa early sell se ainda estiver rodando
    if (earlySellTimers.has(aid)) { clearInterval(earlySellTimers.get(aid)); earlySellTimers.delete(aid); }
    candlesDuringTrade.delete(aid);

    const won    = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = won ? 'win' : 'loss';
    const profit = won ? op.stake * 0.82 : -op.stake;
    const emoji  = won ? '✅' : '❌';

    let simResults = null;
    const b5 = buf5s.get(aid);
    if (EA.enabled && b5) simResults = simulateExpirations(op.entryTime, op.entryPrice, op.direction, b5);

    console.log(`[${emoji}] ${op.name.replace('front.','').replace('-OTC','')} | ${op.direction} | R$${op.stake} | RSI:${op.rsi?.toFixed(0)} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

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
      result, profit, simulated: simResults,
      timestamp: new Date().toISOString(),
    });
    try { fs.writeFileSync(P.expirationAnalysis || 'D:/Tracecom project/expiracao-analysis-v11.json', JSON.stringify(expirationAnalysis, null, 2)); } catch {}

    updateLearning(op.key, result, profit);
    activeOps.delete(aid);

    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(1);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      console.log(`[📈] Total: ${total} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)} | EarlySell: ${ops.filter(r=>r.earlySell).length}`);
      logExpirationTable();
    }
    console.log('');
  });

  await ws.connect({ ssid });

  // Ticker
  setInterval(() => {
    const ops = resultsList.filter(r => r.result);
    const wins = ops.filter(r => r.result === 'win' || r.result === 'early-sell').length;
    const total = ops.length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(0);
      const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
      const es = ops.filter(r => r.earlySell).length;
      process.stdout.write(`\r[⏱ ${new Date().toLocaleTimeString()}] Ops:${total} WR:${wr}% Lucro:R$${profitTotal.toFixed(2)} EarlySell:${es}   `);
    }
  }, 30_000);

  // Relatório
  setInterval(() => { logReport(generateReport()); logExpirationTable(); }, REPORT_INTERVAL_MS);

  // Reconcile
  setInterval(() => {
    for (const [aid, op] of activeOps.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        if (earlySellTimers.has(aid)) { clearInterval(earlySellTimers.get(aid)); earlySellTimers.delete(aid); }
        candlesDuringTrade.delete(aid);
        const idx = resultsList.findIndex(r => r.assetId === aid && !r.result);
        if (idx >= 0) { resultsList[idx].result = 'unknown'; resultsList[idx].profit = 0; }
        activeOps.delete(aid);
      }
    }
  }, 60_000);
}

// ─── FINAL ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v11:\n');
  const ops = resultsList.filter(r => r.result && r.result !== 'unknown');
  const wins = ops.filter(r => r.result === 'win').length;
  const earlySells = ops.filter(r => r.earlySell).length;
  const total = ops.length;
  const unknown = resultsList.filter(r => r.result === 'unknown').length;
  const profitTotal = resultsList.reduce((s, r) => s + (r.profit || 0), 0);
  console.log(`📊 Ops: ${total} | W: ${wins} | EarlySell: ${earlySells} | L: ${total - wins - earlySells} | WR: ${total > 0 ? ((wins+earlySells)/total*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro: R$${profitTotal.toFixed(2)}`);
  const byKey = {};
  for (const r of ops) {
    if (!byKey[r.key]) byKey[r.key] = { wins: 0, total: 0, profit: 0, earlySell: 0 };
    byKey[r.key].total++;
    if (r.result === 'win' || r.earlySell) byKey[r.key].wins++;
    if (r.earlySell) byKey[r.key].earlySell++;
    byKey[r.key].profit += r.profit || 0;
  }
  console.log('\n📋 Por ativo:');
  for (const [key, d] of Object.entries(byKey)) {
    const wr = (d.wins / d.total * 100).toFixed(0);
    const p = (d.profit >= 0 ? '+' : '') + 'R$' + d.profit.toFixed(2);
    console.log(`   ${key.padEnd(14)} ${d.wins}/${d.total} (${wr}%) ${p} ${d.earlySell > 0 ? '💰x'+d.earlySell : ''}`);
  }
  if (unknown > 0) console.log(`\n⚠️ ${unknown} ops não resolvidas`);
  logExpirationTable();
  logReport(generateReport());
  fs.writeFileSync(P.results, JSON.stringify(resultsList, null, 2));
  try { fs.writeFileSync(P.expirationAnalysis || 'D:/Tracecom project/expiracao-analysis-v11.json', JSON.stringify(expirationAnalysis, null, 2)); } catch {}
  persistState();
  // Limpa timers
  for (const t of earlySellTimers.values()) clearInterval(t);
  earlySellTimers.clear();
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
