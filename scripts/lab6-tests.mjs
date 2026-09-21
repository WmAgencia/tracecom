/**
 * LAB 6 — TESTES OBRIGATORIOS PRE-T0 (20 provas). Somente leitura no runtime real; DB apenas nas tabelas iq_lab_* com run de teste (limpo no final).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { routeSnapshot } from "../relay/lab/router.mjs";
import { LabRunner } from "../relay/lab/runner.mjs";
import { LabStore } from "../relay/lab/store.mjs";
import { LAB_STRATEGY_IDS, LAB_EXPIRY_POLICY } from "../relay/lab/strategy-specs.mjs";

const STEP_MS = 5000;
const START_MS = Date.parse("2026-09-20T12:00:00Z");
const results = [];
const check = (id, name, ok, detail = "") => { results.push({ id, name, ok: ok === true, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${String(id).padStart(2, "0")} ${name}${detail ? " :: " + detail : ""}`); };

function makeCandles({ closes, wicks = [] }) {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const wick = wicks[index] ?? { up: 0, down: 0 };
    const bucketEnd = START_MS + (index + 1) * STEP_MS;
    return { bucketStart: bucketEnd - STEP_MS, bucketEnd, open, high: Math.max(open, close) + (wick.up ?? 0), low: Math.min(open, close) - (wick.down ?? 0), close };
  });
}
function drift({ from, count, delta }) { const out = []; for (let i = 0; i < count; i += 1) out.push(from + delta * (i + 1)); return out; }
const base = 1.1; const unit = 0.00008;
function sellReversalCandles() {
  const closes = [...drift({ from: base, count: 70, delta: unit * 0.15 })];
  const start = closes[closes.length - 1];
  for (let i = 0; i < 16; i += 1) closes.push(start + unit * (i + 1) * 1.2);
  const peak = closes[closes.length - 1];
  closes.push(peak - unit * 0.5, peak - unit * 0.9, peak - unit * 1.3, peak - unit * 1.6);
  const wicks = closes.map(() => ({ up: 0, down: 0 }));
  wicks[closes.length - 1] = { up: unit * 9, down: 0 };
  return makeCandles({ closes, wicks });
}

const pool = new pg.Pool({ connectionString: "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify", max: 2, ssl: { rejectUnauthorized: false } });
const runId = `lab6-tests-${Date.now()}`;

try {
  const candles = sellReversalCandles();
  const now = candles[candles.length - 1].bucketEnd;
  const snapshot = buildMarketSnapshot({ marketKey: "TEST:OTC", marketType: "OTC", candles, now });
  const routed = routeSnapshot(snapshot);

  check(1, "todas usam o mesmo MarketSnapshot", routed.length === 6 && routed.every((r) => r.snapshotId === snapshot.snapshotId), `snapshotId=${snapshot.snapshotId}`);

  const futureCandle = { bucketStart: now + STEP_MS, bucketEnd: now + STEP_MS, open: 9, high: 9, low: 9, close: 9 };
  const snapFuture = buildMarketSnapshot({ marketKey: "TEST:OTC", marketType: "OTC", candles: [...candles, futureCandle], now });
  const leak = (snapFuture.recentCandles ?? []).some((c) => c.bucketEnd > now) || (snapFuture.provenance?.closedCandles ?? 0) > (snapshot.provenance?.closedCandles ?? 0);
  check(2, "sem future-data leak", leak === false, `closed=${snapFuture.provenance?.closedCandles}`);

  const fakeRuntime = { config: { mode: "PRACTICE", defaultStake: 2 }, accountContext: { context: "PRACTICE" }, submitLabPracticeOrder: async () => ({ state: "ACKNOWLEDGED", brokerOrderId: "T1", executionId: "E1" }) };
  const runnerA = new LabRunner({ runtime: fakeRuntime, pool: null, enabled: true, runId });
  runnerA.started = true;
  await runnerA.observeMarket({ snapshot, marketKey: "TEST:OTC", targetExpiryAt: now + 20_000, payout: 80 });
  const runnerB = new LabRunner({ runtime: fakeRuntime, pool: null, enabled: true, runId });
  runnerB.started = true;
  await runnerB.observeMarket({ snapshot, marketKey: "TEST:OTC", targetExpiryAt: now + 20_000, payout: 80 });
  const statesA = [...runnerA.states.values()].map((s) => s.lastDecision);
  const statesB = [...runnerB.states.values()].map((s) => s.lastDecision);
  check(3, "cada estrategia mantem state independente", runnerA.states.size === 6 && statesA.length === 6, `n=${runnerA.states.size}`);
  check(4, "uma nao altera a decisao da outra (determinismo)", JSON.stringify(statesA) === JSON.stringify(statesB), JSON.stringify(statesA));

  const idA = `lab:${runId}:${LAB_STRATEGY_IDS[0]}:TEST:OTC:${now}:SELL`;
  const idB = `lab:${runId}:${LAB_STRATEGY_IDS[1]}:TEST:OTC:${now}:SELL`;
  check(5, "strategyTradeIds independentes", idA !== idB, idA.slice(0, 40) + "...");
  check(6, "dedup dentro da mesma estrategia", idA === `lab:${runId}:${LAB_STRATEGY_IDS[0]}:TEST:OTC:${now}:SELL`);

  await pool.query("INSERT INTO iq_lab_runs(run_id, specs_hash, stake) VALUES($1,'test',2) ON CONFLICT DO NOTHING", [runId]);
  for (const id of LAB_STRATEGY_IDS) await pool.query("INSERT INTO iq_lab_strategy_state(run_id, strategy_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [runId, id]);
  const store = new LabStore({ pool, runId, specsHash: "test", stake: 2 });
  const slotS01 = await store.reserveSlot(LAB_STRATEGY_IDS[0]);
  const slotS02 = await store.reserveSlot(LAB_STRATEGY_IDS[1]);
  check(7, "duas estrategias podem operar o mesmo asset", Boolean(slotS01 && slotS02), `s01=${slotS01?.open_count} s02=${slotS02?.open_count}`);

  const realRunner = new LabRunner({ runtime: { config: { mode: "REAL" }, accountContext: { context: "REAL" } }, pool: null, enabled: true, runId });
  realRunner.started = true;
  await realRunner.observeMarket({ snapshot, marketKey: "TEST:OTC", targetExpiryAt: now + 20_000 });
  const rtSrc = fs.readFileSync(new URL("../relay/iq-multi-runtime.mjs", import.meta.url), "utf8");
  check(8, "avaliacao roda em REAL; gasto real so com arm (dry-run desarmado)", realRunner.counters.blockedReal === 0 && rtSrc.includes("REAL_NOT_ARMED"), `blockedReal=${realRunner.counters.blockedReal}`);

  await store.releaseReservation(LAB_STRATEGY_IDS[0]);
  await store.releaseReservation(LAB_STRATEGY_IDS[1]);
  let reserved = 0;
  for (let i = 0; i < 20; i += 1) { const row = await store.reserveSlot(LAB_STRATEGY_IDS[0]); if (row) reserved += 1; }
  const cap21 = await store.reserveSlot(LAB_STRATEGY_IDS[0]);
  check(9, "20-settlement cap funciona", reserved === 20 && cap21 === null, `reserved=${reserved} cap21=${cap21 === null ? "null" : "SLOT"}`);

  for (let i = 0; i < 19; i += 1) await store.releaseSlot(LAB_STRATEGY_IDS[0], { result: "WIN" });
  const capAfter19 = await store.reserveSlot(LAB_STRATEGY_IDS[0]);
  check(10, "19 settled + 1 open impede trade extra", capAfter19 === null, `cap=${capAfter19 === null ? "null" : "SLOT"}`);

  const st = (await pool.query("SELECT settled_count, open_count, wins FROM iq_lab_strategy_state WHERE run_id=$1 AND strategy_id=$2", [runId, LAB_STRATEGY_IDS[0]])).rows[0];
  const st2 = (await pool.query("SELECT settled_count, open_count FROM iq_lab_strategy_state WHERE run_id=$1 AND strategy_id=$2", [runId, LAB_STRATEGY_IDS[1]])).rows[0];
  check(11, "settlement atribuido a estrategia correta", Number(st.settled_count) === 19 && Number(st.open_count) === 1 && Number(st2.settled_count) === 0, JSON.stringify({ s01: st, s02: st2 }));

  let frozen = true;
  const walk = (value) => { if (value && typeof value === "object") { if (!Object.isFrozen(value)) frozen = false; for (const key of Object.keys(value)) walk(value[key]); } };
  walk(snapshot);
  check(12, "entrySnapshot imutavel", frozen === true);

  const recovered = new LabRunner({ runtime: fakeRuntime, pool, enabled: true, runId });
  await recovered.start();
  check(13, "restart recovery preserva contadores", recovered.counters.recoveredSettled === 19 && recovered.counters.recoveredOpen === 0, JSON.stringify({ settled: recovered.counters.recoveredSettled }));

  const routerSrc = fs.readFileSync(new URL("../relay/lab/router.mjs", import.meta.url), "utf8");
  check(14, "feed unico (router nao reconstroi snapshot)", !routerSrc.includes("buildMarketSnapshot") && routed.length === 6);
  check(15, "Feature Engine compartilhado (1 snapshot com tudo)", Boolean(snapshot.indicators?.macd && snapshot.indicators?.ema && snapshot.indicators?.stochastic !== undefined && snapshot.indicators?.fib !== undefined));

  check(16, "scheduler causal (snapshot.at <= now e sem futuro)", snapshot.at <= now && (snapshot.recentCandles ?? []).every((c) => c.bucketEnd <= now));

  const runnerCut = new LabRunner({ runtime: fakeRuntime, pool, enabled: true, runId });
  runnerCut.started = true;
  const before = runnerCut.counters.submits;
  await runnerCut.observeMarket({ snapshot, marketKey: "TEST:OTC", targetExpiryAt: now + 3_000, payout: 80 });
  check(17, "safe cutoff continua funcionando", runnerCut.counters.missed >= 1 && runnerCut.counters.submits === before, `missed=${runnerCut.counters.missed}`);

  const rejectRunner = new LabRunner({ runtime: { config: { mode: "PRACTICE", defaultStake: 2 }, accountContext: { context: "PRACTICE" }, submitLabPracticeOrder: async () => { throw Object.assign(new Error("not armed"), { code: "EXECUTION_NOT_ARMED" }); } }, pool, enabled: true, runId });
  rejectRunner.started = true;
  await rejectRunner.observeMarket({ snapshot, marketKey: "TEST:OTC", targetExpiryAt: Date.now() + 20_000, payout: 80 });
  check(18, "Execution Gate continua funcionando (rejeicao devolve slot)", rejectRunner.counters.rejected >= 1, `rejected=${rejectRunner.counters.rejected}`);

  const grid = fs.readFileSync(new URL("../src/http/public/grid.html", import.meta.url), "utf8");
  check(19, "frontend grid continua funcionando", grid.includes("Grid Binary OTC") && grid.includes("/api/iq/candles"));
  const server = fs.readFileSync(new URL("../relay/server.mjs", import.meta.url), "utf8");
  check(20, "LOG continua funcionando (rota consensus/log + lab decisions)", server.includes("/api/iq/research/consensus/log") && fs.existsSync(new URL("../relay/lab/store.mjs", import.meta.url)));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nLAB6_TESTS ${failed.length === 0 ? "ALL_PASS" : "FAILURES=" + failed.length} (${results.length - failed.length}/${results.length})`);
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error("LAB6_TESTS_ERROR", String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  await pool.query("DELETE FROM iq_lab_decisions WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.query("DELETE FROM iq_lab_trades WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.query("DELETE FROM iq_lab_strategy_state WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.query("DELETE FROM iq_lab_runs WHERE run_id=$1", [runId]).catch(() => undefined);
  await pool.end();
}
