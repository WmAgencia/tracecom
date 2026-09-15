const { Client } = require("pg");
const fs = require("fs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const buildSeries = (rows) => { const m = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = m.get(b); if (!cc) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); };
(async () => {
  await c.connect();
  const out = { generated_at: new Date().toISOString(), db: "supabase-production" };
  out.shadowTrades = (await c.query(`SELECT count(*)::int AS total, count(DISTINCT trade_id)::int AS uniq_trade_id, count(DISTINCT session_id)::int AS sessions, count(DISTINCT asset_canonical)::int AS assets, min(reference_timestamp)::float8 AS tmin, max(reference_timestamp)::float8 AS tmax, sum((settlement_price IS NOT NULL)::int) AS with_settlement, sum((result IS NOT NULL)::int) AS with_result, sum((reference_price IS NOT NULL)::int) AS with_refprice FROM shadow_trades`)).rows[0];
  out.shadowByResult = (await c.query(`SELECT result, count(*)::int n FROM shadow_trades GROUP BY 1 ORDER BY n DESC`)).rows;
  out.shadowByAsset = (await c.query(`SELECT asset_canonical, market_type, count(*)::int n FROM shadow_trades GROUP BY 1,2 ORDER BY n DESC`)).rows;
  out.shadowByStrategy = (await c.query(`SELECT strategy_version, count(*)::int n FROM shadow_trades GROUP BY 1 ORDER BY n DESC`)).rows;
  out.shadowByPhase = (await c.query(`SELECT phase, count(*)::int n FROM shadow_trades GROUP BY 1 ORDER BY n DESC`)).rows;
  out.shadowByExperiment = (await c.query(`SELECT experiment_id, count(*)::int n FROM shadow_trades GROUP BY 1 ORDER BY n DESC LIMIT 30`)).rows;
  out.dupTradeIds = (await c.query(`SELECT trade_id, count(*)::int n FROM shadow_trades GROUP BY 1 HAVING count(*)>1 ORDER BY n DESC LIMIT 5`)).rows;
  out.sessions = (await c.query(`SELECT session_id, min(reference_timestamp)::float8 AS t0min, max(reference_timestamp)::float8 AS t0max, count(*)::int n, count(DISTINCT segment_id)::int segs, count(DISTINCT asset_canonical)::int assets, string_agg(DISTINCT asset_canonical, ',') AS asset_list FROM shadow_trades GROUP BY 1 ORDER BY t0min ASC`)).rows;
  out.priceObs = (await c.query(`SELECT count(*)::int AS total, min(observed_at) AS tmin, max(observed_at) AS tmax FROM price_observations`)).rows[0];
  out.priceObsByStatus = (await c.query(`SELECT status, market_type, context_validation_status, count(*)::int n FROM price_observations GROUP BY 1,2,3 ORDER BY n DESC LIMIT 12`)).rows;
  out.liveDecisions = (await c.query(`SELECT count(*)::int n, count(DISTINCT session_id)::int sessions, min(timestamp) AS tmin, max(timestamp) AS tmax FROM live_decisions`)).rows[0];
  out.liveDecisionsBySource = (await c.query(`SELECT decision_source, probability_source, count(*)::int n FROM live_decisions GROUP BY 1,2 ORDER BY n DESC LIMIT 15`)).rows;
  try { out.groundTruthsCols = (await c.query(`SELECT * FROM ground_truths LIMIT 1`)).fields.map((f) => f.name); out.groundTruthsN = (await c.query(`SELECT count(*)::int n FROM ground_truths`)).rows[0].n; } catch (e) { out.groundTruthsErr = e.message; }
  try { out.liveSettlementsN = (await c.query(`SELECT count(*)::int n FROM live_settlements`)).rows[0].n; } catch (e) { out.liveSettlementsErr = e.message; }
  try { out.shadowExperiments = (await c.query(`SELECT * FROM shadow_experiments LIMIT 20`)).rows; } catch (e) { out.shadowExperimentsErr = e.message; }
  try { out.marketObs = (await c.query(`SELECT count(*)::int n FROM market_observations`)).rows[0]; } catch (e) { out.marketObsErr = e.message; }

  // ---- snapshots unicos + labels causais ----
  const trades = (await c.query(`SELECT trade_id, asset_canonical AS asset, session_id, segment_id, reference_timestamp AS t0, reference_price, settlement_price, result, decision FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC`)).rows;
  const groups = new Map();
  for (const t of trades) groups.set(`${t.session_id}|${t.segment_id ?? "none"}`, { s: t.session_id, g: t.segment_id ?? null, a: t.asset });
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  const keys = new Map();
  for (const t of trades) { const k = `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  const outcome = (side, entry, exit) => (exit === undefined || exit === null ? null : exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
  const dirLabel = (entry, exit) => (exit === undefined || exit === null ? null : exit === entry ? 0 : exit > entry ? 1 : -1);
  const snaps = []; let skippedWarmup = 0, causW60 = 0, causL60 = 0, causD60 = 0, noLabel60 = 0, sysAgree = 0, sysDisagree = 0, sysDraw = 0;
  for (const [k, list] of keys) {
    const t = list[0]; const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const t0 = Number(t.t0), bucketEnd = Math.floor(t0 / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    const candles = buildSeries(window);
    const eligible = candles.length >= 31;
    if (!eligible) skippedWarmup += 1;
    const e45 = all.find((o) => o.t >= t0 + 45000 && o.t <= t0 + 75000);
    const e60 = all.find((o) => o.t >= t0 + 60000 && o.t <= t0 + 90000);
    const entry = Number(t.reference_price);
    const l45 = e45 ? dirLabel(entry, e45.v) : null;
    const l60 = e60 ? dirLabel(entry, e60.v) : null;
    if (l60 === 1) causW60 += 1; else if (l60 === -1) causL60 += 1; else if (l60 === 0) causD60 += 1; else noLabel60 += 1;
    // crosscheck sistema (1o trade da snapshot)
    const dec = String(t.decision ?? "").toUpperCase();
    if (dec === "BUY" || dec === "SELL") { const sr = outcome(dec, entry, t.settlement_price === null ? null : Number(t.settlement_price)); const cl = outcome(dec, entry, e60 ? e60.v : null); if (sr && cl) { if (sr === cl) sysAgree += 1; else sysDisagree += 1; if (sr === "DRAW") sysDraw += 1; } }
    snaps.push({ key: k, session: t.session_id, segment: t.segment_id ?? null, asset: t.asset, t0, entry, candles: candles.length, l45, l60, sys_result: t.result, sys_settlement: t.settlement_price === null ? null : Number(t.settlement_price), sys_decision: dec || null, trades_in_snap: list.length, eligible });
  }
  const elig = snaps.filter((s) => s.eligible);
  // amostragem independente (janelas de label de 90s nao sobrepostas por session|segment)
  const byGroup = new Map();
  for (const s of elig) { const g = `${s.session}|${s.segment ?? "none"}`; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(s); }
  let indepCount = 0;
  for (const [, arr] of byGroup) { arr.sort((a, b) => a.t0 - b.t0); let last = -1e18; for (const s of arr) { if (s.t0 - last >= 90000) { s.indep = true; last = s.t0; indepCount += 1; } else s.indep = false; } }
  // splits temporais 60/20/20 com embargo de 90s
  elig.sort((a, b) => a.t0 - b.t0);
  const q = (p) => elig[Math.min(elig.length - 1, Math.floor(elig.length * p))].t0;
  const tA = q(0.6), tB = q(0.8);
  for (const s of elig) { s.split = s.t0 < tA ? "DISC" : s.t0 < tA + 90000 ? "EMBARGO" : s.t0 < tB ? "VAL" : s.t0 < tB + 90000 ? "EMBARGO" : "HOLD"; }
  const splitCount = (name) => elig.filter((s) => s.split === name).length;
  out.dataset = {
    trades: trades.length, snapshots: keys.size, eligible: elig.length, skippedWarmup,
    label60: { up: causW60, down: causL60, draw: causD60, missing: noLabel60 },
    systemCrosscheck: { agree: sysAgree, disagree: sysDisagree, draws: sysDraw },
    independent: indepCount, splits: { DISC: splitCount("DISC"), EMBARGO: splitCount("EMBARGO"), VAL: splitCount("VAL"), HOLD: splitCount("HOLD") },
    boundaries: { tA, tB, tA_iso: new Date(tA).toISOString(), tB_iso: new Date(tB).toISOString(), tmin: elig[0]?.t0, tmax: elig[elig.length - 1]?.t0 },
  };
  out.dataset.splits.indepDISC = elig.filter((s) => s.split === "DISC" && s.indep).length;
  out.dataset.splits.indepVAL = elig.filter((s) => s.split === "VAL" && s.indep).length;
  out.dataset.splits.indepHOLD = elig.filter((s) => s.split === "HOLD" && s.indep).length;
  fs.writeFileSync("C:/tracecom-forward4/gauntlet-dataset.json", JSON.stringify(out, null, 1));
  fs.writeFileSync("C:/tracecom-forward4/gauntlet-snapshots.json", JSON.stringify({ generated_at: out.generated_at, snapshots: elig }));
  console.log("AUDIT shadow_trades:", JSON.stringify(out.shadowTrades));
  console.log("result dist:", JSON.stringify(out.shadowByResult));
  console.log("assets:", JSON.stringify(out.shadowByAsset));
  console.log("sessions:", out.sessions.length, "| priceObs:", JSON.stringify(out.priceObs));
  console.log("liveDecisions:", JSON.stringify(out.liveDecisions));
  console.log("DATASET:", JSON.stringify(out.dataset, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });
