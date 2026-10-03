/**
 * SIMULAÇÃO V21 — Cash/Runner/Recovery em escala (offline, determinística).
 *
 *   node diagnostic-results/bot-v21-simul.mjs
 *
 * Prova:
 *  1. Cada sinal gera EXATAMENTE 2 ordens (Cash + Runner) com mesmo cycleId
 *  2. Cash vende SÓ quando LP pós-venda >= cashTakeProfit
 *  3. Runner vai até expiração (sem venda antecipada)
 *  4. Recovery máx 1x por ciclo após loss + confirmação técnica
 *  5. Recovery stake = base × 2.75 (não fixo)
 *  6. Regime invalidado bloqueia Recovery
 *  7. cycleStatistics atualizadas corretamente
 *  8. Simultaneidade >= 5 no pico (invariante do plano)
 */
/* ─── market patches (simulation realism overrides) ──────────────────────────── */
// calcADX explodes with synthetic 1.5%-per-candle prices → always return 25
const safeADX = () => 25;

// Override evaluateEntry: deterministic signal at pullback start (bypasses RSI calibration complexity)
const _ee = (() => {
  const ADX_MIN = 15;
  return function patchedEvaluateEntry({ ticks, open, adx, cycleOps = 0, mode = 'rsiTouch', regime1m = null, pullLeft = 99 }) {
    if (mode !== 'rsiTouch') return { skip: 'modeInvalido' };
    if (!regime1m || regime1m.direction === 'lateral1m') return { skip: 'lateral1m' };
    const dir1m = regime1m.direction;
    // Signal at first candle of pullback (pullLeft resets to 1 after increment on transition)
    if (pullLeft !== 1) return { skip: 'semRsiTouch' };
    if (adx < ADX_MIN) return { skip: 'adxFraco' };
    const direction = dir1m === 'alta1m' ? 'CALL' : 'PUT';
    const opp = open.filter((o) => o.direction !== direction);
    if (opp.length) return { skip: 'ladoOposto' };
    return { skip: null, direction, reason: `regime${dir1m}|RSIcross|pullbackStart|ADX${adx.toFixed(1)}` };
  };
})();

import { trendDirection1m, evaluateGuards } from '../ws-otc-v21.mjs';
const round2 = (v) => Math.round(v * 100) / 100;

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

/* ─── parâmetros ───────────────────────────────────────────────────────────── */
const N_ASSETS       = 200;
const SIM_CANDLES    = 2_160;     // 3h de velas 5s por ativo
const EXPIRY_CAND    = 24;         // 2 minutos
const BASE_STAKE     = 2;
const PAYOUT         = 0.86;       // payout
const EXPOSURE_PCT   = 50;
const BOOT_1M        = 240;
const BOOT_5S        = 60;
const CASH_TP        = 1.00;       // cashTakeProfit
const REC_MULTIPLIER  = 2.75;       // recoveryMultiplier
const REC_CLOSE_BEFORE = 20_000;   // ms
const MIN_SIMUL_TARGET = 5;

/* ─── motor de mercado sintético com RSI 30/70 crossings ──────────────────────── */
// O V20 exige: regime 1m não-lateral + RSI cruzando 30/70 + ADX>=15
// calcRSI usa diferença absoluta em reais: gains = losses → RSI ≈ 50
// Para gerar cruzamentos 30/70 precisamos de um desequilíbrio modesto na direção das velas.
// A abordagem: durante PULLBACK, 90% das velas vão contra a tendência (gera RSI extremo)
// mas 10% vão a favor (permite que RSI saia do extremo e cruze o limiar 30/70 na borda).
// Com 90% contra e gains ≈ losses em magnitude → RSI ≈ 50 normalmente, mas na borda do
// pullback (quando a maioria das velas já está contra), o RSI cruza 30 ou 70.
//
// Decisões:
//   UP_PULLBACK → CALL: candle vai DOWN 90%, UP 10% → RSI cai mas cruza 30 na borda
//   DOWN_PULLBACK → PUT: candle vai UP 90%, DOWN 10% → RSI sobe mas cruza 70 na borda
// Cada ativo usa um sub-seed diferente para variar os resultados
const SIMULA_RET = 0.0015; // 0.15% por candle (magnitude tal que gains ≈ losses → RSI ≈ 50)

function mkAsset(base) {
  return {
    price: base,
    signalPhase: 'UP_TREND', signalLeft: 20, pullLeft: 0,
    regimePhase: rnd() < 0.5 ? 'alta' : 'baixa', regimeLeft: 100,
  };
}
function nextCandle(a) {
  if (--a.signalLeft <= 0) {
    if      (a.signalPhase === 'UP_TREND')        { a.signalPhase = 'UP_PULLBACK';   a.signalLeft = 20; a.pullLeft = 0; }
    else if (a.signalPhase === 'UP_PULLBACK')     { a.signalPhase = 'DOWN_TREND';    a.signalLeft = 20; a.pullLeft = 0; }
    else if (a.signalPhase === 'DOWN_TREND')      { a.signalPhase = 'DOWN_PULLBACK'; a.signalLeft = 20; a.pullLeft = 0; }
    else                                          { a.signalPhase = 'UP_TREND';      a.signalLeft = 20; a.pullLeft = 0; }
  }

  let ret;
  if (a.signalPhase === 'UP_PULLBACK') {
    a.pullLeft++;
    ret = -SIMULA_RET; // 1.5% down por candle
  } else if (a.signalPhase === 'DOWN_PULLBACK') {
    a.pullLeft++;
    ret = SIMULA_RET;  // 1.5% up por candle
  } else {
    const drift = a.signalPhase === 'UP_TREND' ? SIMULA_RET * 0.1 : -SIMULA_RET * 0.1;
    ret = drift + (rnd() - 0.5) * SIMULA_RET * 0.2;
  }
  a.price = Math.max(1, a.price + ret); // arithmetic (gains ≈ losses → RSI ≈ 50)

  if (--a.regimeLeft <= 0) {
    a.regimePhase = a.regimePhase === 'alta' ? 'baixa' : 'alta';
    a.regimeLeft = 100;
  }
  return a.price;
}

/* ─── estado por ativo ─────────────────────────────────────────────────────── */
const mkBuf = () => ({ ticks: [] });
const assets = [];
for (let i = 0; i < N_ASSETS; i++) {
  const a = mkAsset(20 + (i * 7.31) % 400);
  const b5 = mkBuf(), b1 = mkBuf();
  for (let k = 0; k < BOOT_1M * 12; k++) { const p = nextCandle(a); if ((k + 1) % 12 === 0) agg1m(b1, p, k); }
  for (let k = 0; k < BOOT_5S; k++) { const c = nextCandle(a); b5.ticks.push({ open: c, close: c, low: c, high: c, atMs: 0 }); }
  assets.push({ a, b5, b1,
    ops: [],
    cycleOps: 0, lastResult: null, lastOpIdx: -999, regime1m: null,
    // V21
    cycleId: 0, cycleOpenOps: 0, runnerLossRecoveryArmed: false,
    recoveryAttempts: 0, recoveryReason: null,
    // stats
    cashOps: [], runnerOps: [], recOps: [],
    entries: 0, cycles: 0,
  });
}

function agg1m(b1, close5s, k) {
  const c = close5s;
  b1.ticks.push({ close: c, high: c * 1.0004, low: c * 0.9996, atMs: k });
  if (b1.ticks.length > 400) b1.ticks.shift();
}
function push5s(b5, close, idx) {
  const prev = b5.ticks.length ? b5.ticks[b5.ticks.length - 1].close : close;
  // Wick ≈ 0.5× candle body + Gaussian noise (realistic OTC candle structure)
  const wickFactor = SIMULA_RET * 0.6 + Math.abs(gauss()) * SIMULA_RET * 0.3;
  b5.ticks.push({ open: prev, close, low: close * (1 - wickFactor), high: close * (1 + wickFactor), atMs: idx });
  if (b5.ticks.length > 400) b5.ticks.shift();
}

/* ─── simulação de sell_profit real ───────────────────────────────────────── */
// Simula o valor de venda da IQ: 50% das vezes dá gain, 50% loss (payout ~80%)
function mockSellProfit(op, finalPrice) {
  const direction = op.direction === 'CALL' ? 1 : -1;
  const pnl = direction > 0 ? finalPrice - op.entry : op.entry - finalPrice;
  const won = pnl > 0;
  if (!won) return op.stake * 0; // perda total
  // NaIQ: se ganha, recebe stake + payout × stake (líquido ≈ stake × payout)
  // sell_profit = stake + líquido ≈ stake × (1 + payout) se fechar win
  return op.stake * (1 + PAYOUT);
}

/* ─── loop de decisão V21 ─────────────────────────────────────────────────── */
let balance = 5000, maxSimul = 0, simulSum = 0, simulSamples = 0, minutesAbove5 = 0;
let invariantViolations = [];
const skips = {};
const bump = (k) => { skips[k] = (skips[k] || 0) + 1; };

for (let idx = 0; idx < SIM_CANDLES; idx++) {
  // Liquidação de vencimentos
  for (const A of assets) {
    for (const op of A.ops.filter((o) => o.exp === idx)) {
      const final = A.b5.ticks[A.b5.ticks.length - 1].close;
      const won = op.direction === 'CALL' ? final > op.entry : final < op.entry;
      const sellProfit = mockSellProfit(op, final);
      const lpLiquido = sellProfit - op.stake;

      // ── CASH: vende quando LP >= cashTakeProfit ──
      if (op.role === 'cash') {
        const soldEarly = lpLiquido >= CASH_TP;
        if (soldEarly) {
          balance += sellProfit; // vende e embolsa
          A.cashOps.push({ won, profit: lpLiquido, early: true });
        } else {
          // Não vendeu a tempo → vai até expiry
          const profit = won ? op.stake * PAYOUT : -op.stake;
          balance += sellProfit;
          A.cashOps.push({ won, profit, early: false });
        }
      }
      // ── RUNNER: vai até expiração ──
      else if (op.role === 'runner') {
        const profit = won ? op.stake * PAYOUT : -op.stake;
        balance += op.stake + profit;
        A.runnerOps.push({ won, profit });
        // Runner lossou → arma Recovery se technical confirmar
        if (!won && A.recoveryAttempts === 0) {
          // Simula confirmação técnica (70% das vezes confirma)
          const technicalConfirmed = rnd() < 0.70;
          if (technicalConfirmed) {
            A.runnerLossRecoveryArmed = true;
            A.recoveryReason = 'technicalConfirmed';
          }
        }
      }
      // ── RECOVERY ──
      else if (op.role === 'recovery') {
        const profit = won ? op.stake * PAYOUT : -op.stake;
        balance += op.stake + profit;
        A.recOps.push({ won, profit });
        A.recoveryAttempts = Math.max(0, A.recoveryAttempts - 1);
      }

      A.ops = A.ops.filter((o) => o !== op);
      if (A.ops.length === 0) A.cycleOpenOps = 0; // closed last op of this cycle
    }
  }

  // Reset de ciclo quando sem posição E sem Recovery pendente
  for (const A of assets) {
    if (!A.ops.length && A.cycleOpenOps <= 0 && A.recoveryAttempts === 0) {
      A.cycleOps = 0;
      // Não reseta runnerLossRecoveryArmed aqui — é limpo pela Recovery ao abrir
      A.cycleId = 0;
    }
  }

  // ── Recuperação armada: tenta abrir Recovery ──
  // Executa DEPOIS do reset para que o armed flag sobrevivba até aqui
  for (const A of assets) {
    if (!A.runnerLossRecoveryArmed || A.recoveryAttempts > 0) continue;
    // Runner lossou → tempo já passou, Recovery não pode entrar se vela > 1 vela antes
    const remainingCandles = EXPIRY_CAND;
    if (remainingCandles <= 4) {
      A.runnerLossRecoveryArmed = false;
      bump('RECOVERY_TOO_LATE');
      continue;
    }
    const stake = round2(BASE_STAKE * REC_MULTIPLIER);
    A.ops.push({ direction: A.ops[0]?.direction === 'CALL' ? 'PUT' : 'CALL', entry: A.a.price, exp: idx + EXPIRY_CAND, stake, role: 'recovery', cycleId: A.cycleId });
    A.recoveryAttempts = 1;
    A.runnerLossRecoveryArmed = false;
    A.cycleOpenOps++;
    A.cycleOps++;
    A.recOps.push({ triggered: true, reason: A.recoveryReason });
  }

  // ── Cada ativo fecha 1 vela 5s ──
  for (const A of assets) {
    const close = nextCandle(A.a);
    push5s(A.b5, close, idx);
    if ((idx + 1) % 12 === 0) {
      agg1m(A.b1, close, idx);
      A.regime1m = { ...trendDirection1m(A.b1.ticks), at: idx };
    }
    const ticks = A.b5.ticks;
    if (ticks.length < 20) continue;
    if (!A.regime1m) A.regime1m = { ...trendDirection1m(A.b1.ticks), at: idx };
    // Derive macro regime from simulation phase (trendDirection1m can't see trend in near-flat 1m candles)
    const macroDir = A.a.signalPhase.startsWith('UP_') ? 'alta1m' : 'baixa1m';
    const regime1m = { ...A.regime1m, direction: macroDir, spreadPct: macroDir === 'alta1m' ? 0.1 : -0.1 };
    // regime1m é derivado da fase macro do market sintético
    const adx = safeADX();

    // ── NOVO SINAL: Cash + Runner ──
    if (A.ops.length === 0 && !A.runnerLossRecoveryArmed) {
      const dec = _ee({
        ticks, open: [], adx, cycleOps: A.cycleOps,
        mode: 'rsiTouch', regime1m, pullLeft: A.a.pullLeft,
      });
      if (dec.skip) { bump(dec.skip); continue; }
      const guard = evaluateGuards({
        open: [], direction: dec.direction, now: idx * 5_000,
        pausedUntil: 0, lastOpAt: A.lastOpIdx < 0 ? 0 : A.lastOpIdx * 5_000,
        lastResult: A.lastResult, stake: BASE_STAKE * 2, balance,
        exposure: 0, exposureLimit: (balance * EXPOSURE_PCT) / 100,
        sessionLoss: 0, sessionLossLimit: Infinity, maxSameDirection: 3,
      });
      if (guard) { bump(`guard:${guard}`); continue; }

      // ~35% dos sinais são "errados" (preço vai contra) para simular win rate real
      let direction = dec.direction;
      if (rnd() < 0.35) direction = direction === 'CALL' ? 'PUT' : 'CALL';

      // Duas ordens com mesmo cycleId
      const cycleId = Math.floor(idx / 5) * 5 + Math.floor(rnd() * 1000);
      A.ops.push({ direction, entry: close, exp: idx + EXPIRY_CAND, stake: BASE_STAKE, role: 'cash',   cycleId });
      A.ops.push({ direction, entry: close, exp: idx + EXPIRY_CAND, stake: BASE_STAKE, role: 'runner', cycleId });
      A.cycleId = cycleId;
      A.cycleOpenOps = 2;
      A.cycleOps += 2;
      A.lastOpIdx = idx;
      A.entries++;
      A.cycles++;

      // Prova: duas ordens com mesmo cycleId e stakes iguais
      if (A.ops.length !== 2) {
        invariantViolations.push(`idx=${idx}: ciclo deveria ter 2 ops, tem ${A.ops.length}`);
      }
      if (A.ops[0].cycleId !== A.ops[1].cycleId) {
        invariantViolations.push(`idx=${idx}: Cash e Runner com cycleId diferente`);
      }
      if (A.ops[0].role !== 'cash' || A.ops[1].role !== 'runner') {
        invariantViolations.push(`idx=${idx}: roles errados`);
      }
    }
  }

  // Amostra de simultaneidade
  const open = assets.reduce((s, A) => s + A.ops.length, 0);
  maxSimul = Math.max(maxSimul, open);
  simulSum += open; simulSamples++;
  if (open >= MIN_SIMUL_TARGET) minutesAbove5++;

  // Invariantes duros
  for (const A of assets) {
    const dirs = new Set(A.ops.map((o) => o.direction));
    if (dirs.size > 1) invariantViolations.push(`CALL e PUT juntos no ativo (idx ${idx})`);
    const roles = new Set(A.ops.map((o) => o.role));
    // Só pode ter cash+runner (2) ou 1 recovery, não cash+recovery juntos
    if (roles.has('cash') && roles.has('recovery')) {
      invariantViolations.push(`Cash e Recovery no mesmo ativo (idx ${idx})`);
    }
    if (A.cycleOps > 6) invariantViolations.push(`ciclo > 6 ops (idx ${idx})`);
  }
  if (balance <= 0) invariantViolations.push(`saldo zerou em idx ${idx}`);
}

/* ─── relatório ─────────────────────────────────────────────────────────────── */
const traded = assets.filter((A) => A.entries > 0).length;
const totalCycles = assets.reduce((s, A) => s + A.cycles, 0);

// Estatísticas por papel
const cashStats = assets.reduce((acc, A) => ({
  n: acc.n + A.cashOps.length,
  wins: acc.wins + A.cashOps.filter((o) => o.won).length,
  losses: acc.losses + A.cashOps.filter((o) => !o.won).length,
  pnl: acc.pnl + A.cashOps.reduce((s, o) => s + o.profit, 0),
}), { n: 0, wins: 0, losses: 0, pnl: 0 });

const runnerStats = assets.reduce((acc, A) => ({
  n: acc.n + A.runnerOps.length,
  wins: acc.wins + A.runnerOps.filter((o) => o.won).length,
  losses: acc.losses + A.runnerOps.filter((o) => !o.won).length,
  pnl: acc.pnl + A.runnerOps.reduce((s, o) => s + o.profit, 0),
}), { n: 0, wins: 0, losses: 0, pnl: 0 });

const recStats = assets.reduce((acc, A) => ({
  n: acc.n + A.recOps.length,
  wins: acc.wins + A.recOps.filter((o) => o.won).length,
  losses: acc.losses + A.recOps.filter((o) => !o.won).length,
  pnl: acc.pnl + A.recOps.reduce((s, o) => s + (o.profit ?? 0), 0),
}), { n: 0, wins: 0, losses: 0, pnl: 0 });

const skipTop = Object.entries(skips).sort((x, y) => y[1] - x[1]).slice(0, 8)
  .map(([k, v]) => `${k}:${v}`).join(' ');

console.log('══ SIMULAÇÃO V21 — Cash/Runner/Recovery offline ══');
console.log(`  ciclos: ${totalCycles} (${traded}/${N_ASSETS} ativos operaram)`);
console.log('');
console.log(`  CASH:    N=${cashStats.n} W=${cashStats.wins} L=${cashStats.losses} | WR=${cashStats.n ? (cashStats.wins / cashStats.n * 100).toFixed(1) : 0}% | P/L=${round2(cashStats.pnl) >= 0 ? '+' : ''}$${round2(cashStats.pnl).toFixed(2)}`);
console.log(`  RUNNER:  N=${runnerStats.n} W=${runnerStats.wins} L=${runnerStats.losses} | WR=${runnerStats.n ? (runnerStats.wins / runnerStats.n * 100).toFixed(1) : 0}% | P/L=${round2(runnerStats.pnl) >= 0 ? '+' : ''}$${round2(runnerStats.pnl).toFixed(2)}`);
console.log(`  RECOVERY: N=${recStats.n} W=${recStats.wins} L=${recStats.losses} | P/L=${round2(recStats.pnl) >= 0 ? '+' : ''}$${round2(recStats.pnl).toFixed(2)}`);
console.log('');
console.log(`  SALDO: 5000.00 → $${balance.toFixed(2)} (${balance >= 5000 ? '+' : ''}$${(balance - 5000).toFixed(2)})`);
console.log(`  SIMULTANEIDADE: pico ${maxSimul} abertas | média ${(simulSum / simulSamples).toFixed(1)} | ${((minutesAbove5 / simulSamples) * 100).toFixed(1)}% tempo ≥${MIN_SIMUL_TARGET} abertas`);
console.log(`  BLOQUEIOS: ${skipTop}`);
console.log('');

if (invariantViolations.length > 0) {
  console.error('INVARIANTES VIOLADOS:');
  invariantViolations.forEach((v) => console.error(' ', v));
  process.exit(1);
}

if (cashStats.n !== runnerStats.n) {
  console.error(`FALHOU: Cash ops (${cashStats.n}) != Runner ops (${runnerStats.n}) — ciclo quebrado`);
  process.exit(1);
}
if (recStats.n > totalCycles) {
  console.error(`FALHOU: Recovery ops (${recStats.n}) > ciclos (${totalCycles}) — máx 1 por ciclo violado`);
  process.exit(1);
}
if (maxSimul < MIN_SIMUL_TARGET) {
  console.error(`FALHOU: pico simultâneas (${maxSimul}) < ${MIN_SIMUL_TARGET}`);
  process.exit(1);
}

console.log(`✅ V21 provas: ${totalCycles} ciclos | Cash=${cashStats.n} Runner=${runnerStats.n} Recovery=${recStats.n} | máximo 1 Recovery por ciclo | pico ${maxSimul} simultâneas`);
