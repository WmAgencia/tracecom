/** S04-50 — TESTES DE INTEGRIDADE PRE-T0 (run independente; DB apenas em iq_lab_* com run de teste, limpo no final). */
import { createRequire } from "node:module";
const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { routeSnapshot } from "../relay/lab/router.mjs";
import { LabRunner } from "../relay/lab/runner.mjs";
import { LabStore } from "../relay/lab/store.mjs";
import { labSpecsHash, LAB_STRATEGY_SPECS } from "../relay/lab/strategy-specs.mjs";

const S04 = "S04_BOLLINGER_MEAN_REVERSION";
const results = [];
const check = (id, name, ok, detail = "") => { results.push({ id, name, ok: ok === true }); console.log(`${ok ? "PASS" : "FAIL"} ${String(id).padStart(2, "0")} ${name}${detail ? " :: " + detail : ""}`); };

const STEP_MS = 5000; const START_MS = Date.parse("2026-09-20T12:00:00Z");
const base = 1.1; const unit = 0.00008;
function candles() {
  const closes = []; let v = base;
  for (let i = 0; i < 40; i += 1) { v += unit * 0.2; closes.push(v); }
  for (let i = 0; i < 40; i += 1) { v -= unit * 0.15; closes.push(v); }
  return closes.map((close, i) => { const open = i === 0 ? close : closes[i - 1]; const bucketEnd = START_MS + (i + 1) * STEP_MS; return { bucketStart: bucketEnd - STEP_MS, bucketEnd, open, high: Math.max(open, close) + unit, low: Math.min(open, close) - unit, close }; });
}

const pool = new pg.Pool({ connectionString: "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify", max: 2, ssl: { rejectUnauthorized: false } });
const runA = `s04-50-tests-a-${Date.now()}`;
const runB = `s04-50-tests-b-${Date.now()}`;

try {
  const list = candles();
  const snapshot = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles: list, now: list[list.length - 1].bucketEnd });

  const only = routeSnapshot(snapshot, { only: [S04] });
  check(1, "S04-50 roda SOMENTE a S04 (router filtrado)", only.length === 1 && only[0].strategyId === S04);

  const runner = new LabRunner({ runtime: { config: { mode: "PRACTICE", defaultStake: 2 }, accountContext: { context: "PRACTICE" } }, pool, enabled: true, runId: runA, strategies: [S04], cap: 50 });
  await runner.start();
  check(2, "state map apenas da S04 e cap 50", runner.states.size === 1 && runner.cap === 50 && runner.store.cap === 50);

  const storeA = new LabStore({ pool, runId: runA, specsHash: labSpecsHash(), stake: 2, cap: 50 });
  await storeA.ensureRun([S04]);
  let reserved = 0;
  for (let i = 0; i < 49; i += 1) {
    const r = await storeA.reserveSlotWithTrade({ strategyTradeId: `lab:${runA}:${S04}:T:OTC:${1000 + i}:BUY`, strategyId: S04, strategyVersion: "lab-s04-v1", marketKey: "T:OTC", direction: "BUY", stake: 2, decision: "BUY", reason: "test", requestedExpiry: new Date().toISOString(), expiryAt: new Date().toISOString(), candidateAt: new Date().toISOString(), supporting: [], counter: [], specialistOutputs: {}, entrySnapshot: {} });
    if (r) { reserved += 1; const res = i % 3 === 0 ? "WIN" : "LOSS"; await storeA.markTradeSettled({ strategyTradeId: `lab:${runA}:${S04}:T:OTC:${1000 + i}:BUY`, result: res, pnl: res === "WIN" ? 1.8 : -2 }); await storeA.releaseSlot(S04, { result: res }); }
  }
  check(3, "49 settlements + reserva/50-cap preparados", reserved === 49);
  const slot50 = await storeA.reserveSlotWithTrade({ strategyTradeId: `lab:${runA}:${S04}:T:OTC:9999:BUY`, strategyId: S04, strategyVersion: "lab-s04-v1", marketKey: "T:OTC", direction: "BUY", stake: 2, decision: "BUY", reason: "test", requestedExpiry: new Date().toISOString(), expiryAt: new Date().toISOString(), candidateAt: new Date().toISOString(), supporting: [], counter: [], specialistOutputs: {}, entrySnapshot: {} });
  const blocked = await storeA.reserveSlotWithTrade({ strategyTradeId: `lab:${runA}:${S04}:T:OTC:9998:BUY`, strategyId: S04, strategyVersion: "lab-s04-v1", marketKey: "T:OTC", direction: "BUY", stake: 2, decision: "BUY", reason: "test", requestedExpiry: new Date().toISOString(), expiryAt: new Date().toISOString(), candidateAt: new Date().toISOString(), supporting: [], counter: [], specialistOutputs: {}, entrySnapshot: {} });
  check(4, "49 settled + 1 open = capacity 0 (nao abre a 51a)", Boolean(slot50) && blocked === null);

  const storeB = new LabStore({ pool, runId: runB, specsHash: labSpecsHash(), stake: 2, cap: 20 });
  await storeB.ensureRun([S04]);
  const slotB = await storeB.reserveSlotWithTrade({ strategyTradeId: `lab:${runB}:${S04}:T:OTC:1:BUY`, strategyId: S04, strategyVersion: "lab-s04-v1", marketKey: "T:OTC", direction: "BUY", stake: 2, decision: "BUY", reason: "test", requestedExpiry: new Date().toISOString(), expiryAt: new Date().toISOString(), candidateAt: new Date().toISOString(), supporting: [], counter: [], specialistOutputs: {}, entrySnapshot: {} });
  const stateA = (await pool.query("SELECT settled_count, open_count FROM iq_lab_strategy_state WHERE run_id=$1 AND strategy_id=$2", [runA, S04])).rows[0];
  const stateB = (await pool.query("SELECT settled_count, open_count FROM iq_lab_strategy_state WHERE run_id=$1 AND strategy_id=$2", [runB, S04])).rows[0];
  check(5, "runs independentes (contadores isolados)", Number(stateA.settled_count) === 49 && Number(stateA.open_count) === 1 && Number(stateB.settled_count) === 0 && Number(stateB.open_count) === 1, JSON.stringify({ A: stateA, B: stateB }));
  await storeB.releaseSlot(S04, { result: "WIN" });
  const stateB2 = (await pool.query("SELECT settled_count FROM iq_lab_strategy_state WHERE run_id=$1 AND strategy_id=$2", [runB, S04])).rows[0];
  check(6, "settlement de um run nao toca o outro", Number(stateB2.settled_count) === 1 && Number((await pool.query("SELECT settled_count FROM iq_lab_strategy_state WHERE run_id=$1 AND strategy_id=$2", [runA, S04])).rows[0].settled_count) === 49);

  const realRunner = new LabRunner({ runtime: { config: { mode: "REAL", defaultStake: 2 }, accountContext: { context: "REAL" } }, pool: null, enabled: true, runId: runA, strategies: [S04], cap: 50 });
  realRunner.started = true;
  await realRunner.observeMarket({ snapshot, marketKey: "T:OTC", targetExpiryAt: Date.now() + 20_000 });
  check(7, "PRACTICE-only bloqueia REAL (S04-50)", realRunner.counters.blockedReal === 1 && realRunner.counters.submits === 0);

  const spec = LAB_STRATEGY_SPECS.find((x) => x.id === S04);
  check(8, "StrategySpec identica a S04 congelada (mesma fonte)", Boolean(spec) && spec.version === "lab-s04-v1" && labSpecsHash() === labSpecsHash());
  const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='iq_lab_runs'")).rows.map((r) => r.column_name);
  check(9, "manifest suporta sourceRunId/sourceStrategy", cols.includes("source_run_id") && cols.includes("source_strategy"));

  const nonTerminal = (await pool.query("SELECT count(*)::int AS n FROM iq_lab_trades WHERE run_id=$1 AND state IN ('SUBMITTED','PENDING_ACK','UNKNOWN','REQUESTED','ACKNOWLEDGED') AND result IS NULL", [runA])).rows[0];
  check(10, "estados nao-terminais contam como capacidade (persist-first)", Number(nonTerminal.n) === 1);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nS04_50_TESTS ${failed.length === 0 ? "ALL_PASS" : "FAILURES=" + failed.length} (${results.length - failed.length}/${results.length})`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error("S04_50_TESTS_ERROR", String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  for (const rid of [runA, runB]) {
    await pool.query("DELETE FROM iq_lab_decisions WHERE run_id=$1", [rid]).catch(() => undefined);
    await pool.query("DELETE FROM iq_lab_trades WHERE run_id=$1", [rid]).catch(() => undefined);
    await pool.query("DELETE FROM iq_lab_strategy_state WHERE run_id=$1", [rid]).catch(() => undefined);
    await pool.query("DELETE FROM iq_lab_runs WHERE run_id=$1", [rid]).catch(() => undefined);
  }
  await pool.end();
}
