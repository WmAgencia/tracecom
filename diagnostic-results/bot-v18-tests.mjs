/**
 * Bateria da V18 — funções puras da nova entrada (sem rede, sem ordem).
 *
 *   node diagnostic-results/bot-v18-tests.mjs   → testes offline
 *
 * Cobre a regra do dono (2026-10-02): regime de HORAS (velas 1m) + gatilho único
 * RSI(5s) cruzando 30/70 + sustentáculo (preço encostado no fundo/topo do range),
 * e prova que pirâmide, gale de reversão e o modo antigo (pullback) ficam intactos.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  trendDirection1m, rsiTouchSignal, supportProximity, evaluateEntry,
  calcRSI, trendDirection,
} from '../ws-otc-v18.mjs';

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
};

/* ─── geradores sintéticos (determinísticos) ───────────────────────────────── */
let clock = 1_700_000_000_000;
function mkCandles(deltas, base = 100) {
  const out = [];
  let close = base;
  for (const d of deltas) {
    const open = close;
    close = Math.round((close + d) * 1e6) / 1e6;
    out.push({ open, high: Math.max(open, close), low: Math.min(open, close), close, atMs: (clock += 5_000) });
  }
  return out;
}
// 1m usa atMs próprio (não importa para as funções — só close/high/low)
const mk1m = (deltas, base) => mkCandles(deltas, base).map((c, i) => ({ ...c, atMs: 1_700_000_000_000 + i * 60_000 }));

const UPTREND_1M = mk1m(Array.from({ length: 150 }, () => 0.08));
const DOWNTREND_1M = mk1m(Array.from({ length: 150 }, () => -0.08));
const FLAT_1M = mk1m(Array.from({ length: 150 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01)));
const SHORT_1M = mk1m(Array.from({ length: 50 }, () => 0.08));

// Série 5s que FAZ o RSI(14) cruzar para baixo de 30 na última vela:
// 13 velas planas + 7 altas de 0.10 + 7 baixas de 0.12 + 1 baixa forte de 0.60.
// RSI(janela anterior) ≈ 45.4 (>30) → RSI(agora) ≈ 29.4 (≤30): cruzou.
const CALL_TOUCH = mkCandles([...Array(13).fill(0), ...Array(7).fill(0.10), ...Array(7).fill(-0.12), -0.60]);
// Mesma série + um rebote de 0.50: RSI volta pra cima da zona (fora do gatilho).
const CALL_TOUCH_BOUNCED = mkCandles([...CALL_TOUCH.map((c, i, a) => (i === 0 ? 0 : c.close - a[i - 1].close)), 0.50]);
// Mesma série com um PAVIO profundo numa vela anterior (o fundo real ficou 1.20 abaixo
// do close atual): RSI cruza 30 igual, mas o preço já subiu do pisão — entrada tarde.
const CALL_TOUCH_LATE = CALL_TOUCH.map((c, i) => (i === 24 ? { ...c, low: c.low - 1.20 } : c));
// Espelho para PUT: 7 baixas de 0.10 + 7 altas de 0.12 + 1 alta forte de 0.60.
const PUT_TOUCH = mkCandles([...Array(13).fill(0), ...Array(7).fill(-0.10), ...Array(7).fill(0.12), 0.60]);
// Série 5s em ALTA consistente (para tendência CALL do modo antigo/pirâmide).
const RISING_5S = mkCandles(Array.from({ length: 60 }, () => 0.15));

console.log('\n══ V18 — REGIME DE HORAS (trendDirection1m) ══');
ok('uptrend 1m (150 velas) → CALL', () => {
  const r = trendDirection1m(UPTREND_1M);
  assert.equal(r.direction, 'CALL');
  assert.equal(r.source, 'alta1m');
  assert.ok(r.spreadPct >= 0.05, `spread ${r.spreadPct} >= 0.05`);
});
ok('downtrend 1m → PUT', () => {
  const r = trendDirection1m(DOWNTREND_1M);
  assert.equal(r.direction, 'PUT');
  assert.equal(r.source, 'baixa1m');
});
ok('lateral 1m → lateral1m (não entra)', () => {
  const r = trendDirection1m(FLAT_1M);
  assert.equal(r.direction, null);
  assert.equal(r.source, 'lateral1m');
});
ok('amostra curta (50 velas < 120) → dados1m (fail-closed)', () => {
  const r = trendDirection1m(SHORT_1M);
  assert.equal(r.direction, null);
  assert.equal(r.source, 'dados1m');
});

console.log('\n══ V18 — GATILHO ÚNICO (rsiTouchSignal) ══');
ok('CALL: RSI cruza 45 → 29.4 na última vela = sinal', () => {
  const now = calcRSI(CALL_TOUCH), prev = calcRSI(CALL_TOUCH.slice(0, -1));
  assert.ok(now <= 30, `RSI agora ${now.toFixed(1)} <= 30`);
  assert.ok(prev > 30, `RSI antes ${prev.toFixed(1)} > 30`);
  assert.equal(rsiTouchSignal(CALL_TOUCH, 'CALL'), true);
});
ok('CALL: continuar dentro da zona NÃO re-dispara (sem rajada)', () => {
  const still = mkCandles([...CALL_TOUCH.map((c, i, a) => (i === 0 ? 0 : c.close - a[i - 1].close)), -0.12]);
  assert.equal(rsiTouchSignal(still, 'CALL'), false);
});
ok('PUT: RSI cruza 54 → 70.6 na última vela = sinal', () => {
  const now = calcRSI(PUT_TOUCH), prev = calcRSI(PUT_TOUCH.slice(0, -1));
  assert.ok(now >= 70, `RSI agora ${now.toFixed(1)} >= 70`);
  assert.ok(prev < 70, `RSI antes ${prev.toFixed(1)} < 70`);
  assert.equal(rsiTouchSignal(PUT_TOUCH, 'PUT'), true);
});
ok('direção inválida → sem sinal', () => {
  assert.equal(rsiTouchSignal(CALL_TOUCH, null), false);
});
ok('série curta demais → sem sinal', () => {
  assert.equal(rsiTouchSignal(mkCandles([0.1, -0.2, 0.1]), 'CALL'), false);
});

console.log('\n══ V18 — SUSTENTÁCULO (supportProximity) ══');
ok('CALL: preço no fundo do range = ok', () => {
  const r = supportProximity(CALL_TOUCH, 'CALL');
  assert.equal(r.ok, true, `dist ${r.distPct?.toFixed(3)}% do fundo`);
});
ok('CALL: RSI na zona mas preço escapou do fundo = NÃO ok', () => {
  const r = supportProximity(CALL_TOUCH_BOUNCED, 'CALL');
  assert.equal(r.ok, false, `dist ${r.distPct?.toFixed(3)}% do fundo`);
});
ok('PUT: preço no topo do range = ok', () => {
  const r = supportProximity(PUT_TOUCH, 'PUT');
  assert.equal(r.ok, true, `dist ${r.distPct?.toFixed(3)}% do topo`);
});

console.log('\n══ V18 — evaluateEntry (modo rsiTouch) ══');
const REGIME_CALL = trendDirection1m(UPTREND_1M);
const REGIME_PUT = trendDirection1m(DOWNTREND_1M);
const baseArgs = (ticks, extra = {}) => ({
  ticks, open: [], trend: trendDirection(ticks), regime: { state: 'ranging', streak: 0 },
  rsi: calcRSI(ticks), adx: 0, cycleOps: 0, mode: 'rsiTouch', ...extra,
});
ok('regime de ALTA 1m + RSI cruzou 30 + no fundo → ENTRADA CALL', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH, { regime1m: REGIME_CALL }));
  assert.equal(d.kind, 'entrada');
  assert.equal(d.direction, 'CALL');
  assert.match(d.reason, /alta1m/);
});
ok('regime de BAIXA 1m + RSI cruzou 70 + no topo → ENTRADA PUT', () => {
  const d = evaluateEntry(baseArgs(PUT_TOUCH, { regime1m: REGIME_PUT }));
  assert.equal(d.kind, 'entrada');
  assert.equal(d.direction, 'PUT');
});
ok('regime lateral 1m → skip lateral1m (sem direção não entra)', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH, { regime1m: trendDirection1m(FLAT_1M) }));
  assert.equal(d.skip, 'lateral1m');
});
ok('regime sem dados 1m → skip dados1m (fail-closed)', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH, { regime1m: trendDirection1m(SHORT_1M) }));
  assert.equal(d.skip, 'dados1m');
});
ok('sem toque no 30 → skip semRsiTouch (o gatilho é único)', () => {
  const calm = mkCandles([...Array(20).fill(0), ...Array(7).fill(0.10), ...Array(7).fill(-0.02)]);
  const d = evaluateEntry(baseArgs(calm, { regime1m: REGIME_CALL }));
  assert.equal(d.skip, 'semRsiTouch');
});
ok('rebote forte: RSI sai da zona → skip semRsiTouch (gatilho desarma sozinho)', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH_BOUNCED, { regime1m: REGIME_CALL }));
  assert.equal(d.skip, 'semRsiTouch');
});
ok('tocou 30 mas o fundo real (pavio) ficou 1.20 abaixo → skip semSuporte', () => {
  assert.equal(rsiTouchSignal(CALL_TOUCH_LATE, 'CALL'), true, 'cruza 30 igual');
  const sup = supportProximity(CALL_TOUCH_LATE, 'CALL');
  assert.equal(sup.ok, false, `dist ${sup.distPct?.toFixed(3)}% do fundo`);
  const d = evaluateEntry(baseArgs(CALL_TOUCH_LATE, { regime1m: REGIME_CALL }));
  assert.equal(d.skip, 'semSuporte');
});
ok('ciclo fechado (cycleOps >= 3) → skip cicloFechado', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH, { regime1m: REGIME_CALL, cycleOps: 3 }));
  assert.equal(d.skip, 'cicloFechado');
});
ok('gale de reversão armado dispara ANTES e não exige regime/gatilho (intacto)', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH, { regime1m: null, reversalGale: true, trend: { direction: 'CALL', spreadPct: 0.2, source: 'alta' } }));
  assert.equal(d.kind, 'reversalGale');
});
ok('PIRAMIDE intacta: posição aberta + ADX 26 + RSI 28 a favor → pyramid', () => {
  const close = CALL_TOUCH[CALL_TOUCH.length - 1].close;
  const d = evaluateEntry(baseArgs(CALL_TOUCH, {
    regime1m: REGIME_CALL, adx: 26,
    open: [{ direction: 'CALL', entryPrice: close }],
    trend: trendDirection(RISING_5S),
    rsi: 28, adxMin: 20,
  }));
  assert.equal(d.kind, 'pyramid');
  assert.equal(d.direction, 'CALL');
});
ok('posição aberta no lado oposto da tendência 5s → ladoOposto (nunca CALL+PUT)', () => {
  const d = evaluateEntry(baseArgs(CALL_TOUCH, {
    regime1m: REGIME_CALL,
    open: [{ direction: 'PUT', entryPrice: 100 }],
    trend: { direction: 'CALL', spreadPct: 0.2, source: 'alta' },
  }));
  assert.equal(d.skip, 'ladoOposto');
});
ok('modo antigo (pullback) continua lá: mesmo fixture sem fade4 → skip (não entra)', () => {
  const d = evaluateEntry({ ...baseArgs(CALL_TOUCH, { regime1m: REGIME_CALL }), mode: 'pullback', adx: 30 });
  assert.ok(typeof d.skip === 'string', `esperava skip no modo antigo, veio ${JSON.stringify(d)}`);
});

console.log('\n══ V18 — CONFIG E ARQUIVO ══');
ok('bot-config-v18.json: entryMode rsiTouch + parâmetros da regra', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../bot-config-v18.json', import.meta.url), 'utf8'));
  assert.equal(cfg.strategy.entryMode, 'rsiTouch');
  assert.equal(cfg.strategy.rsiTouchCall, 30);
  assert.equal(cfg.strategy.rsiTouchPut, 70);
  assert.equal(cfg.strategy.regime1mMinCandles, 120);
  assert.equal(cfg.strategy.boot1mCandles, 240);
  assert.equal(cfg.strategy.supportAtrFactor, 1.5);
  assert.equal(cfg.strategy.pyramidAdxMin, 25);
  assert.equal(cfg.trading.baseStake, 2);
  assert.equal(cfg.trading.expirationMinutes, 2);
  assert.equal(cfg.trading.maxOpsPerAsset, 3);
  assert.ok(cfg.universe.minActive >= 500);
  assert.equal(cfg.martingale.martingaleMultiplier, 2.75);
});
ok('ws-otc-v18.mjs lê o config V18 e expõe a regra nova', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v18.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes("new URL('./bot-config-v18.json'"), 'config V18');
  assert.ok(src.includes("CODE_REV = 'V18'"), 'CODE_REV V18');
  assert.ok(src.includes('trendDirection1m') && src.includes('rsiTouchSignal') && src.includes('supportProximity'));
  assert.ok(src.includes("[TELEMETRIA:BEGIN]") && src.includes("[TELEMETRIA:END]"), 'bloco de telemetria intacto');
  assert.ok(!src.includes("new URL('./bot-config-v15.json'"), 'não pode ler o config antigo');
});

console.log(`\n${'═'.repeat(62)}\nV18: ${pass} passaram, ${fail} falharam\n`);
process.exit(fail === 0 ? 0 : 1);
