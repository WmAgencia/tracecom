/**
 * P0 FIX VERIFICATION — V21
 * node diagnostic-results/bot-v21-p0-verify.mjs
 *
 * Testa apenas funções exportadas. Padrões estruturais verificados
 * pela bateria principal (bot-v21-tests.mjs).
 */
import * as b from '../ws-otc-v21.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const results = [];

function check(name, fn) {
  try { results.push({name, ok: true, obs: fn()}); }
  catch(e) { results.push({name, ok: false, obs: e.message}); }
}

// ── P0 #8: parseSettlement enum expandido ────────────────────────────────────
check('parseSettlement: pending → unknown', () => {
  const r = b.parseSettlement({status:'pending'}, {stake:2});
  assert.equal(r.result, 'unknown', `got '${r.result}'`);
});

check('parseSettlement: open → unknown', () => {
  const r = b.parseSettlement({status:'open'}, {stake:2});
  assert.equal(r.result, 'unknown', `got '${r.result}'`);
});

check('parseSettlement: active → unknown', () => {
  const r = b.parseSettlement({status:'active'}, {stake:2});
  assert.equal(r.result, 'unknown', `got '${r.result}'`);
});

check('parseSettlement: rejected → unknown', () => {
  const r = b.parseSettlement({status:'rejected'}, {stake:2});
  assert.equal(r.result, 'unknown', `got '${r.result}'`);
});

check('parseSettlement: closed sem profit → loss', () => {
  const r = b.parseSettlement({status:'closed'}, {stake:2});
  assert.equal(r.result, 'loss', `got '${r.result}'`);
  assert.equal(r.profit, -2, `got profit=${r.profit}`);
});

check('parseSettlement: win com invest → lucro correto', () => {
  const r = b.parseSettlement({win:'win', invest:5, win_amount:8}, {stake:5});
  assert.equal(r.result, 'win', `got '${r.result}'`);
  assert.equal(r.profit, 3, `got ${r.profit}`);
});

check('parseSettlement: null/empty → unknown', () => {
  const r1 = b.parseSettlement(null, {stake:2});
  assert.equal(r1.result, 'unknown', `null: got '${r1.result}'`);
  const r2 = b.parseSettlement({}, {stake:2});
  assert.equal(r2.result, 'unknown', `empty: got '${r2.result}'`);
});

// ── P0 #13: normalizeBrokerResult + normalizeBrokerProfit ────────────────────────
check('normalizeBrokerResult: open → unknown', () => {
  assert.equal(b.normalizeBrokerResult({status:'open'}), 'unknown');
});

check('normalizeBrokerResult: pending → unknown', () => {
  assert.equal(b.normalizeBrokerResult({status:'pending'}), 'unknown');
});

check('normalizeBrokerResult: sell_open → unknown', () => {
  assert.equal(b.normalizeBrokerResult({status:'sell_open'}), 'unknown');
});

check('normalizeBrokerResult: closed+profit>0 → win', () => {
  assert.equal(b.normalizeBrokerResult({status:'closed', profit:1}), 'win');
});

check('normalizeBrokerResult: closed+profit<0 → loss', () => {
  assert.equal(b.normalizeBrokerResult({status:'closed', profit:-2}), 'loss');
});

check('normalizeBrokerResult: closed sem profit → draw', () => {
  assert.equal(b.normalizeBrokerResult({status:'closed'}), 'draw');
});

check('normalizeBrokerProfit: expected_profit → null (não é realized)', () => {
  const r = b.normalizeBrokerProfit({expected_profit:1.72}, 2);
  assert.equal(r, null, `expected null, got ${r}`);
});

check('normalizeBrokerProfit: profit realizado → usado', () => {
  const r = b.normalizeBrokerProfit({profit:2.5}, 2);
  assert.equal(r, 2.5, `expected 2.5, got ${r}`);
});

check('normalizeBrokerProfit: profit negativo → usado', () => {
  const r = b.normalizeBrokerProfit({profit:-1.5}, 2);
  assert.equal(r, -1.5, `expected -1.5, got ${r}`);
});

check('normalizeBrokerProfit: null profit → null', () => {
  const r = b.normalizeBrokerProfit({status:'closed'}, 2);
  assert.equal(r, null, `expected null, got ${r}`);
});

// ── P0 #3: evaluateGuards com committed ─────────────────────────────────────────
check('evaluateGuards: committed (pending) conta no limite de exposição', () => {
  // committed=40 + stake=20 = 60 > 50 → exposureLimit
  const g = b.evaluateGuards({
    open:[], direction:'CALL', now:Date.now(),
    stake:20, balance:100,
    exposure:0, committed:40, exposureLimit:50,
    sessionLoss:0, sessionLossLimit:Infinity, maxSameDirection:3,
  });
  assert.equal(g, 'exposureLimit', `committed=40+stake=20 > 50 → '${g}'`);
});

check('evaluateGuards: committed=0 + stake<=limit →ok', () => {
  const g = b.evaluateGuards({
    open:[], direction:'CALL', now:Date.now(),
    stake:20, balance:100,
    exposure:0, committed:0, exposureLimit:50,
    sessionLoss:0, sessionLossLimit:Infinity, maxSameDirection:3,
  });
  assert.equal(g, null, `expected null, got '${g}'`);
});

check('evaluateGuards: exposure=45 + stake=10 > 50 → exposureLimit', () => {
  const g = b.evaluateGuards({
    open:[], direction:'CALL', now:Date.now(),
    stake:10, balance:100,
    exposure:45, committed:45, exposureLimit:50,
    sessionLoss:0, sessionLossLimit:Infinity, maxSameDirection:3,
  });
  assert.equal(g, 'exposureLimit', `got '${g}'`);
});

// ── CORREÇÕES CONFIRMADAS (regressão) ─────────────────────────────────────────
check('CORREÇÃO: exposição acima do teto bloqueia', () => {
  const g = b.evaluateGuards({
    open:[], direction:'CALL', now:Date.now(),
    stake:4, balance:100,
    exposure:90, committed:90, exposureLimit:50,
    sessionLoss:0, sessionLossLimit:Infinity, maxSameDirection:3,
  });
  assert.equal(g, 'exposureLimit', `got '${g}'`);
});

check('CORREÇÃO: saldo zero bloqueia', () => {
  const g = b.evaluateGuards({
    open:[], direction:'CALL', now:Date.now(),
    stake:2, balance:0,
    exposure:0, committed:0, exposureLimit:50,
    sessionLoss:0, sessionLossLimit:Infinity, maxSameDirection:3,
  });
  assert.equal(g, 'semSaldo', `got '${g}'`);
});

check('CORREÇÃO: perda sessão bloqueia', () => {
  const g = b.evaluateGuards({
    open:[], direction:'CALL', now:Date.now(),
    stake:2, balance:100,
    exposure:0, committed:0, exposureLimit:50,
    sessionLoss:20, sessionLossLimit:20, maxSameDirection:3,
  });
  assert.equal(g, 'perdaSessao', `got '${g}'`);
});

// ── P0 #9: savePending schema completo (via source check) ─────────────────────
check('savePending: código inclui assetId, key, record', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  const saveBlock = src.match(/function savePending[\s\S]{0,2000}/)?.[0] ?? '';
  assert(saveBlock.includes('assetId'), 'savePending não inclui assetId');
  assert(saveBlock.includes('.key'), 'savePending não inclui key');
  assert(saveBlock.includes('record'), 'savePending não inclui record');
  assert(saveBlock.includes('settledLedger'), 'savePending não inclui settledLedger');
  return 'schema completo no source';
});

// ── P0 #2: loadPending existe e é exportada ───────────────────────────────────
check('loadPending: função exportada', () => {
  assert.equal(typeof b.loadPending, 'function', `expected function, got ${typeof b.loadPending}`);
  const r = b.loadPending();
  assert(typeof r === 'object', `expected object, got ${typeof r}`);
  assert(Array.isArray(r.inFlight), 'inFlight não é array');
  assert(Array.isArray(r.pending), 'pending não é array');
  assert(Array.isArray(r.settledLedger), 'settledLedger não é array');
  return typeof b.loadPending;
});

// ── P0 #11+12: reconcile envelope adaptativo (via source) ─────────────────────
check('reconcile: código adapta {open_options, closed_options}', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  const reconBlock = src.match(/async function reconcileWithBroker[\s\S]{0,3000}/)?.[0] ?? '';
  assert(reconBlock.includes('open_options'), 'reconcile não adapta open_options');
  assert(reconBlock.includes('closed_options'), 'reconcile não adapta closed_options');
  assert(reconBlock.includes('open ?? []'), 'reconcile não fallback open');
  assert(reconBlock.includes('closed ?? []'), 'reconcile não fallback closed');
  return 'envelope adaptativo presente';
});

// ── P0 #12: reconcile unknown mantém fila ────────────────────────────────────
check('reconcile: unknown mantém awaitSettlement (via source)', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  const reconBlock = src.match(/async function reconcileWithBroker[\s\S]{0,3000}/)?.[0] ?? '';
  assert(reconBlock.includes("result === 'unknown'"), 'reconcile não trata unknown');
  assert(reconBlock.includes('continue;'), 'reconcile não usa continue para unknown');
  return 'unknown mantém fila';
});

// ── P0 #16: Recovery timeout executa sem inFlight (via source) ─────────────────
check('Recovery timeout: evaluateOpenPositions não retorna cedo por inFlight vazio', () => {
  const src = fs.readFileSync(new URL('../ws-otc-v21.mjs', import.meta.url), 'utf8');
  const evalBlock = src.match(/async function evaluateOpenPositions[\s\S]{0,2000}/)?.[0] ?? '';
  // O guard `if (inFlight.size === 0) return;` DEVE ter sido removido
  assert(!evalBlock.match(/if\s*\(\s*inFlight\.size\s*===\s*0\s*\)\s*return/), 'guard inFlight vazio ainda presente');
  return 'guard removido';
});

// ── AUDITORIA 2026-10-03: reconciliação/exposição/regime/ADX ─────────────────────
check('normalizeBrokerResult: win=win (histórico IQ sem status) → win', () => {
  assert.equal(b.normalizeBrokerResult({win:'win', win_amount:3.64, sum:2}), 'win');
});

check('normalizeBrokerResult: win=loose → loss', () => {
  assert.equal(b.normalizeBrokerResult({win:'loose', sum:2}), 'loss');
});

check('normalizeBrokerResult: win=equal → draw', () => {
  assert.equal(b.normalizeBrokerResult({win:'equal', sum:2}), 'draw');
});

check('normalizeBrokerProfit: win_amount − sum (win)', () => {
  assert.equal(b.normalizeBrokerProfit({win:'win', profit:0, win_amount:3.64, sum:2}, 2), 1.64);
});

check('normalizeBrokerProfit: loss = −sum', () => {
  assert.equal(b.normalizeBrokerProfit({win:'loose', sum:2}, 2), -2);
});

check('normalizeBrokerProfit: equal = 0', () => {
  assert.equal(b.normalizeBrokerProfit({win:'equal', sum:2}, 2), 0);
});

check('pendingCommitment: reserva em inFlight não conta em dobro', () => {
  const entries = [['a|1|x', {stake:2}], ['b|1|y', {stake:2}], ['c|1|z', {stake:5.5}]];
  const has = (k) => k === 'a|1|x' || k === 'b|1|y';
  assert.equal(b.pendingCommitment(entries, has), 5.5);
  assert.equal(b.pendingCommitment(entries, () => false), 9.5);
});

check('pendingStaleKeys: só reservas vencidas (> ttl)', () => {
  const now = 1_000_000;
  const entries = [['velha', {stake:2, sentAtMs: now - 700_000}], ['nova', {stake:2, sentAtMs: now - 1_000}]];
  assert.deepEqual(b.pendingStaleKeys(entries, now), ['velha']);
});

check('computeRegime15mLocal: 250 candles 1m em alta → alta15m', () => {
  let q = 100; const t = [];
  for (let i = 0; i < 250; i++) { q *= 1.0004; t.push({atMs: i * 60_000, open: q * 0.999, close: q, high: q * 1.0005, low: q * 0.9995}); }
  const r = b.computeRegime15mLocal(t);
  assert.equal(r.direction, 'alta15m');
  assert.equal(r.source, 'local-15m');
  return r.direction;
});

check('computeRegime15mLocal: pouco histórico → lateral/warming (fail-safe)', () => {
  const t = Array.from({length:10},(_,i)=>({atMs:i*60_000, open:100, close:100, high:100.1, low:99.9}));
  const r = b.computeRegime15mLocal(t);
  assert.equal(r.direction, 'lateral15m');
  return r.source;
});

check('calcADX: tendência forte ≥15 e lateral <15 (O(n))', () => {
  let p = 100; const up = [];
  for (let i = 0; i < 80; i++) { p += 0.1; up.push({open:p-0.05, close:p, high:p+0.02, low:p-0.07}); }
  const flat = [];
  for (let i = 0; i < 80; i++) { const v = 100 + (i % 2 ? 0.01 : -0.01); flat.push({open:v, close:v, high:v+0.005, low:v-0.005}); }
  const aTrend = b.calcADX(up), aFlat = b.calcADX(flat);
  assert.ok(aTrend >= 15, `ADX tendência ${aTrend} < 15`);
  assert.ok(aFlat < 15, `ADX lateral ${aFlat} >= 15`);
  return `${aTrend}/${aFlat}`;
});

// ── RESULTS ─────────────────────────────────────────────────────────────────────
console.log('\n══ P0 FIX VERIFICATION — V22 ══');
let pass=0, fail=0;
for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  const detail = r.ok ? '' : '\n   → ' + JSON.stringify(r.obs);
  console.log(`${icon} ${r.name}${detail}`);
  r.ok ? pass++ : fail++;
}
console.log(`\nPassados: ${pass}  Falhas: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
