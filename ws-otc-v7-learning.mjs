/**
 * OTC BOT v7 - QUANTITATIVO
 * =================================================================
 * Melhorias vs v6:
 * - Captura robusta (TTL + logging de perdas + reconciliação)
 * - Fade4 (4 candles, mais robusto que 3)
 * - Filtro de volatilidade (evita mercado lateral)
 * - IC binomial 95% (só opera se lowerCI > 55% e total >= 10)
 * - Auto-recalibragem de direção (inverte se WR < 50% após 15 ops)
 * - 5 ativos com gate IC-WR ≥ 65%
 * - Relatório JSON completo a cada 5min
 *
 * Payout real: R$2 → win +R$1.64 | loss -R$2.00
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';
const TRADE_AMOUNT = 2;
const EXPIRATION_MIN = 1;
const CANDLE_SIZE = 5;
const MIN_CANDLES = 5;
const COOLDOWN_MS = 65_000;
const DEDUP_MS = 500;
const OPERATION_TTL_MS = 130_000; // 2min10s
const REPORT_INTERVAL_MS = 300_000; // 5 min

const LEARNING = {
  minSampleSize: 10,        // ⬆️ mais ops antes de avaliar
  killWR: 0.45,
  weightHistorical: 0.4,
  weightObserved: 0.6,      // mais peso no observado
  lossStreakLimit: 3,
  lossStreakCooldown: 300_000,
  recalibrateAfter: 15,     // reverte direção se WR < 50% após 15 ops
  persistenceFile: 'D:/Tracecom project/learning-state.json',
};

// 5 ativos com melhor WR histórico
const VALIDATED_ASSETS = [
  { names: ['USDHKD', 'USD-HKD'], direction: 'CALL', wr: 78 },
  { names: ['EURUSD', 'EUR-USD'], direction: 'CALL', wr: 74 },
  { names: ['USDZAR', 'USD-ZAR'], direction: 'PUT',  wr: 70 },
  { names: ['LTCUSD', 'Litecoin'], direction: 'PUT',  wr: 67 },
  { names: ['DOTUSD', 'Polkadot', 'DOT-USD'], direction: 'PUT', wr: 62 },
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
      totalProfit: 0,
      directionFlips: 0,
      lastDirectionFlipAt: 0,
    };
  }
  learningState[key].historicalWR = va.wr;
  learningState[key].direction = va.direction;
}

// ─── Intervalo de Confiança Binomial ───────────────────────────────────────
function wrConfidence(wins, total) {
  if (total === 0) return { wr: 0, lower: 0, upper: 1, sampleSize: 0 };
  const p = wins / total;
  const z = 1.96; // 95%
  const n = total;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  const lower = Math.max(0, (center - spread) / denom);
  const upper = Math.min(1, (center + spread) / denom);
  return { wr: p, lower, upper, sampleSize: n };
}

// ─── Utilitários ─────────────────────────────────────────────────────────────
function getKey(assetName) {
  for (const va of VALIDATED_ASSETS) {
    if (va.names.some(n => assetName.toUpperCase().includes(n.toUpperCase()))) {
      return va.names[0];
    }
  }
  return null;
}

function persistLearning() {
  try {
    fs.writeFileSync(LEARNING.persistenceFile, JSON.stringify(learningState, null, 2));
  } catch {}
}

function persistActiveOps() {
  try {
    const entries = [];
    for (const [aid, op] of activeOperations.entries()) {
      entries.push({ aid, ...op });
    }
    fs.writeFileSync('D:/Tracecom project/active-operations.json', JSON.stringify(entries));
  } catch {}
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

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
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

// ─── Learning ────────────────────────────────────────────────────────────────
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

  // Auto-recalibragem de direção
  if (s.observedTotal >= LEARNING.recalibrateAfter && s.rollingWR < 50) {
    const newDir = s.direction === 'CALL' ? 'PUT' : 'CALL';
    console.log(`[🧠 FLIP] ${assetKey}: direção ${s.direction}→${newDir} (WR=${s.rollingWR.toFixed(1)}% após ${s.observedTotal} ops)`);
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

function shouldTrade(assetKey) {
  const s = learningState[assetKey];
  if (!s) return { ok: false, reason: 'sem dados' };
  if (s.disabled) return { ok: false, reason: `OFF: ${s.disabledReason}` };
  if (Date.now() < s.pausedUntil) return { ok: false, reason: `pausado` };

  // Gate com IC: só bloqueia se TIVER amostra E o limite inferior do IC < 55%
  if (s.observedTotal >= LEARNING.minSampleSize) {
    const ci = wrConfidence(s.observedWins, s.observedTotal);
    const lowerPct = (ci.lower * 100).toFixed(1);
    if (ci.lower < 0.55) {
      return { ok: false, reason: `IC-WR ${lowerPct}% < 55% (est:${s.estimatedWR.toFixed(1)}%)` };
    }
  }
  return { ok: true, ci: wrConfidence(s.observedWins, s.observedTotal) };
}

// ─── Padrão Fade4 com validação ──────────────────────────────────────────────
function getSignal(buf, assetName) {
  const key = getKey(assetName);
  if (!key) return null;
  const s = learningState[key];
  if (!s || buf.ticks.length < MIN_CANDLES) return null;

  const t = buf.ticks.slice(-5); // 5 candles (4 + 1 de confirmação)
  if (Date.now() - t[t.length - 1].atMs > 30_000) return null;

  // Volatilidade mínima (evita lateral)
  const vol = calculateVolatility(t);
  if (vol < 0.0002) return null;

  // Fade4: últimos 4 candles na direção errada → sinal
  const last4 = t.slice(0, 4);
  const isDown4 = last4.every((c, i) => i === 0 || last4[i].close < last4[i - 1].close);
  const isUp4 = last4.every((c, i) => i === 0 || last4[i].close > last4[i - 1].close);

  // Confirmação: candle atual (5º) deve confirmar reversão
  const lastCandle = t[4];
  const prevCandle = t[3];

  if (isDown4 && lastCandle.close > prevCandle.close && s.direction === 'CALL') {
    return { signal: 'CALL', ci: wrConfidence(s.observedWins, s.observedTotal) };
  }
  if (isUp4 && lastCandle.close < prevCandle.close && s.direction === 'PUT') {
    return { signal: 'PUT', ci: wrConfidence(s.observedWins, s.observedTotal) };
  }
  return null;
}

// ─── Estado global ──────────────────────────────────────────────────────────
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

// ─── Relatório JSON ─────────────────────────────────────────────────────────
function generateReport() {
  const byActive = {};
  for (const r of resultados) {
    if (!byActive[r.key]) {
      byActive[r.key] = { wins: 0, total: 0, profit: 0, direction: r.direction };
    }
    if (r.result) {
      byActive[r.key].total++;
      if (r.result === 'win') byActive[r.key].wins++;
      byActive[r.key].profit += r.profit || 0;
    }
  }
  const assetReports = [];
  for (const va of VALIDATED_ASSETS) {
    const k = va.names[0];
    const s = learningState[k];
    const br = byActive[k] || { wins: 0, total: 0, profit: 0, direction: s?.direction };
    const ci = wrConfidence(s?.observedWins || 0, s?.observedTotal || 0);
    let verdict = '⚠️观望';
    if (s?.disabled) verdict = '❌ pausar';
    else if (s?.observedTotal >= LEARNING.minSampleSize && ci.lower >= 0.65) verdict = '✅ operar';
    else if (s?.observedTotal >= LEARNING.minSampleSize && ci.lower >= 0.55) verdict = '⚠️观望';
    else if (s?.pausedUntil > Date.now()) verdict = '⏸ pausa';
    assetReports.push({
      key: k,
      direction: s?.direction,
      histWR: s?.historicalWR,
      obsWR: s?.rollingWR,
      estimatedWR: s?.estimatedWR,
      ci95_lower: ci.lower,
      ci95_wr: ci.wr,
      ci95_upper: ci.upper,
      sampleSize: s?.observedTotal || 0,
      wins: s?.observedWins || 0,
      losses: (s?.observedTotal || 0) - (s?.observedWins || 0),
      profit: s?.totalProfit || 0,
      disabled: s?.disabled || false,
      paused: s?.pausedUntil > Date.now(),
      verdict,
    });
  }
  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;
  const totalProfit = resultados.reduce((sum, r) => sum + (r.profit || 0), 0);
  const report = {
    timestamp: new Date().toISOString(),
    balance: {},
    summary: {
      totalOps: total,
      wins,
      losses: total - wins,
      wr: total > 0 ? (wins / total * 100).toFixed(1) : '0',
      totalProfit: totalProfit.toFixed(2),
      invested: (total * TRADE_AMOUNT).toFixed(2),
    },
    assets: assetReports,
  };
  try {
    fs.writeFileSync('D:/Tracecom project/relatorio-v7.json', JSON.stringify(report, null, 2));
  } catch {}
  return report;
}

function logReport(report) {
  console.log('\n📊 RELATÓRIO v7:');
  console.log(`   Total: ${report.summary.totalOps} ops | WR: ${report.summary.wr}% | Lucro: R$${report.summary.totalProfit}`);
  for (const a of report.assets) {
    const ciStr = `${(a.ci95_lower * 100).toFixed(1)}%–${(a.ci95_upper * 100).toFixed(1)}%`;
    const profitStr = (a.profit >= 0 ? '+' : '') + 'R$' + a.profit.toFixed(2);
    console.log(`   ${a.verdict} ${a.key.padEnd(10)} dir:${a.direction} IC:${ciStr} (${a.wins}/${a.sampleSize}) ${profitStr}`);
  }
}

// ─── HTTP / Login ────────────────────────────────────────────────────────────
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
    console.log('🧠 BOT v7 - QUANTITATIVO | Fade4 | IC-WR Gate | 5 Ativos');
    console.log('='.repeat(70));
    console.log('\n📋 Estado aprendido:');
    for (const va of VALIDATED_ASSETS) {
      const k = va.names[0];
      const s = learningState[k];
      const ci = wrConfidence(s.observedWins, s.observedTotal);
      const status = s.disabled ? '❌ OFF' : '✅ ON';
      const ciStr = `${(ci.lower * 100).toFixed(1)}%–${(ci.upper * 100).toFixed(1)}%`;
      console.log(`   ${status} ${k.padEnd(10)} dir:${s.direction.padEnd(5)} hist:${s.historicalWR}% obs:${s.rollingWR.toFixed(1)}% IC:${ciStr} (${s.observedWins}/${s.observedTotal})`);
    }

    const allAssets = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

    let foundCount = 0;
    for (const asset of allAssets) {
      const key = getKey(asset.name);
      if (!key) continue;
      const s = learningState[key];
      if (s.disabled) { console.log(`[⏭️] ${asset.name} → PULADO`); continue; }
      candleBuffer.set(asset.activeId, { ticks: [], asset, key });
      ws.subscribeCandles(asset.activeId, CANDLE_SIZE);
      foundCount++;
      console.log(`[✅] ${asset.name} → ${s.direction} (size=${CANDLE_SIZE}s)`);
    }

    console.log(`\n[📋] ${foundCount}/${VALIDATED_ASSETS.length} ativos`);
    console.log('[⏳] Warmup 20s...\n');
    await new Promise(r => setTimeout(r, 20_000));
    warmupEndTime = Date.now();
    console.log('[✅] INICIADO!\n');
  });

  // ─── Candle + Sinal + Ordem ───────────────────────────────────────────────
  ws.on('candle-generated', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
    if (!aid || !candleBuffer.has(aid)) return;
    const buf = candleBuffer.get(aid);
    if (!pushCandle(buf, raw)) return;

    // TTL: limpar operações órfãs com mais de OPERATION_TTL_MS
    for (const [a, op] of activeOperations.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        console.warn(`[🧹 TTL] Removendo op órfã ${op.name} (aid=${a})`);
        activeOperations.delete(a);
      }
    }

    // Cooldown: pular se já tem operação ativa
    const existing = activeOperations.get(aid);
    if (existing && (Date.now() - existing.openedAt) < COOLDOWN_MS) return;
    if (!warmupEndTime || Date.now() < warmupEndTime) return;

    // Fade4
    const signal = getSignal(buf, buf.asset.name);
    if (!signal) return;

    // Gate IC-WR
    const trade = shouldTrade(buf.key);
    if (!trade.ok) return;

    const s = learningState[buf.key];
    const { expiration, optionTypeId } = computeExpiration(
      Math.floor((ws.serverNow() ?? Date.now()) / 1000), EXPIRATION_MIN);

    ws.placeOrder({
      price: TRADE_AMOUNT, activeId: aid, direction: signal.signal,
      expiration, optionTypeId, balanceId
    });

    activeOperations.set(aid, {
      name: buf.asset.name, key: buf.key, direction: signal.signal,
      expected: s.estimatedWR, ciLower: signal.ci.lower, openedAt: Date.now()
    });
    persistActiveOps();

    const ciStr = `${(signal.ci.lower * 100).toFixed(1)}%–${(signal.ci.upper * 100).toFixed(1)}%`;
    console.log(`[📊 ${buf.asset.name}] ${signal.signal} | IC-WR:${ciStr} (est:${s.estimatedWR.toFixed(1)}%)`);

    resultados.push({
      active: buf.asset.name, key: buf.key, direction: signal.signal,
      expected: s.estimatedWR, price: TRADE_AMOUNT,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync('D:/Tracecom project/resultados-v7.json', JSON.stringify(resultados, null, 2));
  });

  // ─── Fechamento de Opção ─────────────────────────────────────────────────
  ws.on('socket-option-closed', (msg) => {
    const raw = msg?.msg ?? msg;
    if (!raw) return;
    const aid = raw.active_id ?? raw.activeId;

    const op = activeOperations.get(aid);
    if (!op) {
      console.warn(`[MISSED] socket-option-closed aid=${aid} raw=`, JSON.stringify(raw).slice(0, 200));
      persistMissed(aid, raw);
      return;
    }

    // Payout real 82%: R$2 → win +R$1.64, loss -R$2.00
    const winResult = (raw.win ?? '').toLowerCase() === 'win' || (raw.profit ?? 0) > 0;
    const result = winResult ? 'win' : 'loss';
    const profit = winResult ? TRADE_AMOUNT * 0.82 : -TRADE_AMOUNT;
    const emoji = result === 'win' ? '✅' : '❌';

    console.log(`[${emoji}] ${op.name} | ${op.direction} | IC:${op.ciLower !== undefined ? (op.ciLower*100).toFixed(1)+'%' : '?'} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

    const idx = resultados.findIndex(r => r.active === op.name && !r.result);
    if (idx >= 0) {
      resultados[idx].result = result;
      resultados[idx].profit = profit;
      fs.writeFileSync('D:/Tracecom project/resultados-v7.json', JSON.stringify(resultados, null, 2));
    }

    updateLearning(op.key, result, profit);
    activeOperations.delete(aid);
    persistActiveOps();

    const wins = resultados.filter(r => r.result === 'win').length;
    const total = resultados.filter(r => r.result).length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(1);
      const profitTotal = resultados.reduce((sum, r) => sum + (r.profit || 0), 0);
      console.log(`[📈] Total: ${total} | Wins: ${wins} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)}\n`);
    }
  });

  await ws.connect({ ssid });

  // Relatório ticker a cada 30s
  setInterval(() => {
    const wins = resultados.filter(r => r.result === 'win').length;
    const total = resultados.filter(r => r.result).length;
    if (total > 0) {
      const wr = ((wins / total) * 100).toFixed(0);
      process.stdout.write(`\r[⏱️ ${new Date().toLocaleTimeString()}] Ops: ${total} | WR: ${wr}% | Lucro: R$${resultados.reduce((s, r) => s + (r.profit || 0), 0).toFixed(2)}   `);
    }
  }, 30_000);

  // Relatório completo a cada 5min
  setInterval(() => {
    const report = generateReport();
    logReport(report);
  }, REPORT_INTERVAL_MS);

  // Reconciliação a cada 60s
  setInterval(() => {
    for (const [aid, op] of activeOperations.entries()) {
      if (Date.now() - op.openedAt > OPERATION_TTL_MS) {
        console.warn(`[🔄 RECON] Timeout: ${op.name} (aid=${aid}) — marcando unknown`);
        const idx = resultados.findIndex(r => r.active === op.name && !r.result);
        if (idx >= 0) {
          resultados[idx].result = 'unknown';
          resultados[idx].profit = 0;
          fs.writeFileSync('D:/Tracecom project/resultados-v7.json', JSON.stringify(resultados, null, 2));
        }
        activeOperations.delete(aid);
      }
    }
  }, 60_000);
}

// ─── Final ────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL v7:\n');
  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;
  const totalProfit = resultados.reduce((s, r) => s + (r.profit || 0), 0);
  const unknown = resultados.filter(r => r.result === 'unknown').length;
  console.log(`📊 Ops: ${total} | Wins: ${wins} | Losses: ${total - wins} | Unknown: ${unknown} | WR: ${total > 0 ? (wins/total*100).toFixed(1) : 0}%`);
  console.log(`💰 Lucro: R$${totalProfit.toFixed(2)}`);
  console.log(`💵 Investido: R$${(total * TRADE_AMOUNT).toFixed(2)}`);
  console.log('\n📋 Por ativo:');
  const byActive = {};
  for (const r of resultados.filter(r => r.result && r.result !== 'unknown')) {
    if (!byActive[r.key]) byActive[r.key] = { wins: 0, total: 0, profit: 0, direction: '' };
    byActive[r.key].total++;
    byActive[r.key].direction = r.direction;
    if (r.result === 'win') byActive[r.key].wins++;
    byActive[r.key].profit += r.profit || 0;
  }
  for (const [key, s] of Object.entries(byActive)) {
    const ci = wrConfidence(s.wins, s.total);
    const wr = (s.wins / s.total * 100).toFixed(0);
    const profitStr = (s.profit >= 0 ? '+' : '') + 'R$' + s.profit.toFixed(2);
    console.log(`   ${key.padEnd(10)} ${s.wins}/${s.total} (${wr}%) IC:${(ci.lower*100).toFixed(1)}%-${(ci.upper*100).toFixed(1)}% ${profitStr}`);
  }
  if (unknown > 0) console.log(`\n⚠️ ${unknown} ops não capturadas (ver missed-operations.json)`);
  const finalReport = generateReport();
  logReport(finalReport);
  fs.writeFileSync('D:/Tracecom project/resultados-v7-final.json', JSON.stringify(resultados, null, 2));
  persistLearning();
  process.exit(0);
});

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
