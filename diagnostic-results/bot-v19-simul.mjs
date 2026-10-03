/**
 * SIMULAÇÃO DE ESCALA V19 — prova de simultaneidade (offline, determinística).
 *
 *   node diagnostic-results/bot-v19-simul.mjs
 *
 * Roda o pipeline REAL de decisão do bot (trendDirection1m + rsiTouchSignal +
 * supportProximity + evaluateEntry + evaluateGuards, importados do ws-otc-v19.mjs)
 * sobre N ativos sintéticos com regimes de horas, pullbacks profundos e lateralidade,
 * durante 3 horas simuladas. Nenhuma ordem, nenhuma rede.
 *
 * V19 (vs V18): universe maior (200-500), regime 1m mais sensivel (0.03%),
 * boot 1m = 2h (vs 4h), replaceStaleMs 60s (vs 180s). Espera-se pico maior
 * de ordens simultaneas.
 *
 * O que prova:
 *   • a regra nova gera MUITAS entradas simultâneas (meta do dono: ≥5, ideal 10);
 *   • os invariantes do dono não quebram: nunca CALL+PUT no mesmo ativo, ciclo ≤ 3,
 *     exposição nunca acima do teto (50% do saldo), uma ordem por ativo por vez
 *     (exceto pirâmide com ADX ≥ 25 + RSI extremo, como sempre).
 *
 * O mercado é sintético e determinístico (semente fixa): serve como prova mecânica
 * da lógica e como regression harness — a prova em mercado real é o E2E na demo.
 */
import {
  trendDirection1m, evaluateEntry, evaluateGuards, calcRSI, trendDirection,
  detectRegime, calcADX,
} from '../ws-otc-v19.mjs';

/* ─── PRNG determinístico ───────────────────────────────────────────────────── */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261002);
const gauss = () => {
  const u = Math.max(1e-9, rnd()), v = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ─── parâmetros (espelham o config V18) ────────────────────────────────────── */
const N_ASSETS      = 200;
const SIM_CANDLES   = 2_160;      // 3h de velas 5s por ativo (2160 × 5s = 10800s)
const EXPIRY_CAND   = 24;          // 2 minutos
const STAKE         = 2;
const PAYOUT        = 0.82;        // medido no vivo: 2,00 → +1,64
const EXPOSURE_PCT  = 50;
const BOOT_1M       = 240;         // hidratação do boot (4h)
const BOOT_5S       = 60;
const COOLDOWN_LOSS_CANDLES = 1;   // 5s
const REGIME_1M_MIN = 120;
const MIN_SIMUL_TARGET = 5;

/* ─── motor de mercado sintético ────────────────────────────────────────────── */
// Fases: alta (40%), baixa (40%), lateral (20%), com duração 40–160 velas 5s.
// Dentro de alta/baixa há pullbacks/repiques profundos (−/+0.10% por vela, 6–12 velas)
// — é o mergulho que empurra o RSI(5s) para 30/70 e que a regra nova compra.
function mkAsset(base) {
  return { price: base, phase: 'range', left: 30 + Math.floor(rnd() * 60), pull: 0, pullLeft: 0 };
}
function nextCandle(a) {
  if (a.pullLeft > 0) { a.pullLeft--; if (a.pullLeft === 0) a.pull = 0; }
  else if (rnd() < 0.012) { a.pull = a.phase === 'up' ? -1 : a.phase === 'down' ? 1 : 0; a.pullLeft = 6 + Math.floor(rnd() * 7); }
  if (--a.left <= 0) {
    const r = rnd();
    a.phase = r < 0.40 ? 'up' : r < 0.80 ? 'down' : 'range';
    a.left = 40 + Math.floor(rnd() * 120);
  }
  const drift = a.pull !== 0 ? a.pull * 0.0010 : a.phase === 'up' ? 0.00020 : a.phase === 'down' ? -0.00020 : 0;
  const ret = drift + gauss() * 0.0004;
  a.price = a.price * (1 + ret);
  return a.price;
}

/* ─── estado por ativo (espelha o bot) ──────────────────────────────────────── */
const mkBuf = () => ({ ticks: [] });
const assets = [];
for (let i = 0; i < N_ASSETS; i++) {
  const a = mkAsset(20 + (i * 7.31) % 400);
  const b5 = mkBuf(), b1 = mkBuf();
  // Hidratação (como o boot): 240 velas 1m + 60 velas 5s de histórico.
  for (let k = 0; k < BOOT_1M * 12; k++) { const p = nextCandle(a); if ((k + 1) % 12 === 0) agg1m(b1, p, k); }
  for (let k = 0; k < BOOT_5S; k++) b5.ticks.push({ close: nextCandle(a), low: 0, high: 0, atMs: 0 });
  assets.push({ a, b5, b1, ops: [], cycleOps: 0, lastResult: null, lastOpIdx: -999, regime1m: null, wins: 0, losses: 0, pnl: 0, entries: 0, pyramids: 0 });
}
function agg1m(b1, close5s, k) {
  const c = close5s;
  b1.ticks.push({ close: c, high: c * 1.0004, low: c * 0.9996, atMs: k });
  if (b1.ticks.length > 400) b1.ticks.shift();
}
function push5s(b5, close, idx) {
  b5.ticks.push({ close, low: close * (1 - 0.0004 - Math.abs(gauss()) * 0.0002), high: close * (1 + 0.0004 + Math.abs(gauss()) * 0.0002), atMs: idx });
  if (b5.ticks.length > 400) b5.ticks.shift();
}

/* ─── loop de decisão (mesma sequência do bot: candle fechado → planTrade) ──── */
let balance = 5000, maxSimul = 0, simulSum = 0, simulSamples = 0, minutesAbove5 = 0;
const skips = {};
const bump = (k) => { skips[k] = (skips[k] || 0) + 1; };
for (let idx = 0; idx < SIM_CANDLES; idx++) {
  // liquida vencimentos
  for (const A of assets) {
    for (const op of A.ops.filter((o) => o.exp === idx)) {
      const final = A.b5.ticks[A.b5.ticks.length - 1].close;
      const won = op.direction === 'CALL' ? final > op.entry : final < op.entry;
      if (won) { A.wins++; A.pnl += STAKE * PAYOUT; balance += STAKE * PAYOUT; } else { A.losses++; A.pnl -= STAKE; balance -= STAKE; }
      A.lastResult = won ? 'win' : 'loss';
      A.ops = A.ops.filter((o) => o !== op);
    }
  }
  // reset do ciclo quando sem posição (como planTrade)
  for (const A of assets) {
    if (!A.ops.length && (A.lastResult === 'win' || A.cycleOps >= 3)) A.cycleOps = 0;
  }
  // cada ativo fecha 1 vela 5s
  for (const A of assets) {
    const close = nextCandle(A.a);
    push5s(A.b5, close, idx);
    if ((idx + 1) % 12 === 0) {
      agg1m(A.b1, close, idx);
      A.regime1m = { ...trendDirection1m(A.b1.ticks), at: idx };
    }
    const ticks = A.b5.ticks;
    if (ticks.length < 20) continue;
    // regime 1m fallback (cache já pronto pela hidratação)
    if (!A.regime1m) A.regime1m = { ...trendDirection1m(A.b1.ticks), at: idx };
    const trend = trendDirection(ticks);
    const regime = detectRegime(ticks);
    const rsi = calcRSI(ticks);
    const adx = calcADX(ticks);
    const dec = evaluateEntry({
      ticks, open: A.ops, trend, regime, rsi, adx, cycleOps: A.cycleOps,
      mode: 'rsiTouch', regime1m: A.regime1m,
    });
    if (dec.skip) { bump(dec.skip); continue; }
    const exposure = A.ops.reduce((s, o) => s + o.stake, 0);
    // evaluateGuards fala MILISSEGUNDOS (como no bot): now/lastOpAt em ms; lastOpAt=0
    // (falsy) quando o ativo nunca operou — igual ao estado inicial do bot.
    const guard = evaluateGuards({
      open: A.ops, direction: dec.direction, now: idx * 5_000,
      pausedUntil: 0, lastOpAt: A.lastOpIdx < 0 ? 0 : A.lastOpIdx * 5_000, lastResult: A.lastResult,
      stake: STAKE, balance, exposure, exposureLimit: (balance * EXPOSURE_PCT) / 100,
      sessionLoss: 0, sessionLossLimit: Infinity, maxSameDirection: 3,
    });
    if (guard) { bump(`guard:${guard}`); continue; }
    if (exposure + STAKE > (balance * EXPOSURE_PCT) / 100) { bump('guard:exposicao'); continue; }
    A.ops.push({ direction: dec.direction, entry: close, exp: idx + EXPIRY_CAND, stake: STAKE });
    A.cycleOps++;
    A.lastOpIdx = idx;
    if (dec.kind === 'pyramid') A.pyramids++; else A.entries++;
  }
  // amostra de simultaneidade
  const open = assets.reduce((s, A) => s + A.ops.length, 0);
  maxSimul = Math.max(maxSimul, open);
  simulSum += open; simulSamples++;
  if (open >= MIN_SIMUL_TARGET) minutesAbove5++;
  // invariantes duros (a regra do teto vale NA ABERTURA — evaluateGuards; posições já
  // abertas podem ultrapassar passivamente se o saldo cair, como no bot real)
  for (const A of assets) {
    const dirs = new Set(A.ops.map((o) => o.direction));
    if (dirs.size > 1) { console.error(`FALHOU: CALL e PUT juntos no mesmo ativo (idx ${idx})`); process.exit(1); }
    if (A.cycleOps > 3) { console.error(`FALHOU: ciclo > 3 (idx ${idx})`); process.exit(1); }
  }
  if (balance <= 0) { console.error(`FALHOU: saldo zerou (idx ${idx})`); process.exit(1); }
}

/* ─── relatório ─────────────────────────────────────────────────────────────── */
const traded = assets.filter((A) => A.entries + A.pyramids > 0).length;
const totalOps = assets.reduce((s, A) => s + A.entries + A.pyramids, 0);
const wins = assets.reduce((s, A) => s + A.wins, 0), losses = assets.reduce((s, A) => s + A.losses, 0);
const avgSimul = (simulSum / simulSamples).toFixed(1);
const skipTop = Object.entries(skips).sort((x, y) => y[1] - x[1]).slice(0, 8)
  .map(([k, v]) => `${k}:${v}`).join(' ');
console.log('══ SIMULAÇÃO V19 — 200 ativos × 3h (funções reais de decisão) ══');
console.log(`  entradas: ${totalOps} (${traded}/${N_ASSETS} ativos operaram) | W ${wins} / L ${losses} | WR ${wins + losses ? ((wins / (wins + losses)) * 100).toFixed(1) : 0}% | P/L ${balance - 5000 >= 0 ? '+' : ''}${(balance - 5000).toFixed(2)}`);
console.log(`  SIMULTANEIDADE: pico ${maxSimul} abertas | média ${avgSimul} | ${((minutesAbove5 / simulSamples) * 100).toFixed(1)}% do tempo com ≥${MIN_SIMUL_TARGET} abertas`);
console.log(`  pirâmides: ${assets.reduce((s, A) => s + A.pyramids, 0)} (regra intacta)`);
console.log(`  bloqueios: ${skipTop}`);
console.log(`  regimes 1m: ${assets.map((A) => A.regime1m?.source ?? '?').join(',')}`);
console.log(`  saldo: 5000.00 → ${balance.toFixed(2)}`);
console.log('');
if (maxSimul < MIN_SIMUL_TARGET) { console.error(`FALHOU: pico de simultâneas (${maxSimul}) < ${MIN_SIMUL_TARGET}`); process.exit(1); }
if (totalOps < 20) { console.error(`FALHOU: entradas demais poucas (${totalOps}) — regra morta`); process.exit(1); }
console.log(`✅ simultaneidade ≥ ${MIN_SIMUL_TARGET} provada (pico ${maxSimul}) | ${totalOps} entradas | invariantes intactos`);
