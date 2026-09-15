/**
 * TraceCom PROFILES executor v2.0 — V1/V2/V3/V6 + Fibonacci.
 * Perfis (classificação/UI, NÃO altera nenhuma decisão):
 *   AGRESSIVO:  reversion-v2-fib, reversion-v3-fib
 *   BALANCEADO: reversion-v1-fib
 *   CONSERVADOR: reversion-v6-fib
 * Em cada evento forward: as 4 estratégias decidem INDEPENDENTEMENTE (BUY/SELL/WAIT)
 * sobre o mesmo snapshot causal, persistido antes de T+45 existir. Concordância é
 * apenas registrada (count + direção) — nunca usada para decidir.
 * Zero look-ahead; warm-up causal permitido (histórico pré-coorte); eventos só ≥ cohortStart.
 */
process.env.FWD4_NO_AUTOSTART = "1";
import pg from "pg";
import { createHash } from "node:crypto";
const { buildCandles, featuresAt, signalsFor } = await import("./index.mjs");

const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000, GRACE = 15_000, POLL_MS = 5000;
const WARMUP_MS = Number(process.env.FWD_WARMUP_MS ?? 900_000);
const ASSET = process.env.FWD_ASSET ?? "AUD/CAD";
const STRATEGIES = [
  { key: "v1", version: "reversion-v1-fib", profile: "BALANCEADO" },
  { key: "v2", version: "reversion-v2-fib", profile: "AGRESSIVO" },
  { key: "v3", version: "reversion-v3-fib", profile: "AGRESSIVO" },
  { key: "v6", version: "reversion-v6-fib", profile: "CONSERVADOR" },
  { key: "v7and", version: "reversion-v7-and", profile: "EXPERIMENTAL" },
  { key: "v7relaxed", version: "reversion-v7-relaxed", profile: "EXPERIMENTAL" },
];
const CONFIG = { version: "fwd-profiles-2.1.0", asset: ASSET, bucket_ms: BUCKET, min_candles: MIN_CANDLES, tol_ms: TOL, grace_ms: GRACE, warmup_ms: WARMUP_MS, profiles: { AGRESSIVO: ["reversion-v2-fib", "reversion-v3-fib"], BALANCEADO: ["reversion-v1-fib"], CONSERVADOR: ["reversion-v6-fib"], EXPERIMENTAL: ["reversion-v7-and", "reversion-v7-relaxed"] }, rules: "frozen: v1/v2/v3 via signalsFor; v6fib = deep band; v7and = ATR-Fib(3x) == V1Fib; v7relaxed = ATR-Fib(1x) OR V1Fib (conflict=WAIT)", concordance: "registered only (v1-v6 count+direction); never used for decisions" };
const CONFIG_HASH = createHash("sha256").update(JSON.stringify(CONFIG)).digest("hex").slice(0, 16);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

function decideV6Fib(f) {
  if (!f) return "WAIT";
  const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857;
  const fibDir = f.fib && f.fib.inZone ? (f.s > 0 && f.fib.upSwing ? "BUY" : f.s < 0 && !f.fib.upSwing ? "SELL" : null) : null;
  return f.vol !== null && f.vol < .0009 && deep && fibDir ? fibDir : "WAIT";
}
function atrSma(candles) { const m = candles.length; const atr = candles.slice(m - 14).reduce((a, x) => a + (x.high - x.low), 0) / 14; const sma20 = candles.slice(m - 20).reduce((a, x) => a + x.close, 0) / 20; return { atr, sma20 }; }
// ATR-Overshoot+Fib: desvio >= mult*ATR(14) da SMA20 + golden zone + contexto de swing (regra congelada do experimento)
export function decideAtrFib(f, candles, mult) { if (!f || !f.fib) return "WAIT"; const lastCandle = candles[candles.length - 1]; const close = lastCandle ? lastCandle.close : null; if (close === null || !Number.isFinite(close)) return "WAIT"; const { atr, sma20 } = atrSma(candles); const dir = sma20 - close >= mult * atr ? "BUY" : close - sma20 >= mult * atr ? "SELL" : "WAIT"; const fibDir = dir === "BUY" ? f.fib.upSwing : dir === "SELL" ? !f.fib.upSwing : false; return dir !== "WAIT" && f.fib.inZone && fibDir ? dir : "WAIT"; }
// V7-AND: ATR-Overshoot+Fib (3x) E V1+Fib concordando na mesma direção
export function decideV7And(f, candles) { const a = decideAtrFib(f, candles, 3); const b = f ? (signalsFor(f, "reversion-v1-fib")[0] ?? "WAIT") : "WAIT"; return a !== "WAIT" && a === b ? a : "WAIT"; }
// V7-Relaxado: união (ATR-Overshoot+Fib com dev>=1xATR) OU (V1+Fib); conflito -> WAIT
export function decideV7Relaxed(f, candles) { const a = decideAtrFib(f, candles, 1); const b = f ? (signalsFor(f, "reversion-v1-fib")[0] ?? "WAIT") : "WAIT"; if (a === "WAIT") return b; if (b === "WAIT") return a; return a === b ? a : "WAIT"; }
export function decideAll(f, candles) {
  const v1 = f ? (signalsFor(f, "reversion-v1-fib")[0] ?? "WAIT") : "WAIT";
  const v2 = f ? (signalsFor(f, "reversion-v2-fib")[0] ?? "WAIT") : "WAIT";
  const v3 = f ? (signalsFor(f, "reversion-v3-fib")[0] ?? "WAIT") : "WAIT";
  const v6 = decideV6Fib(f);
  const v7and = decideV7And(f, candles);
  const v7relaxed = decideV7Relaxed(f, candles);
  const decisions = { v1, v2, v3, v6, v7and, v7relaxed };
  const nBuy = [v1, v2, v3, v6].filter((d) => d === "BUY").length;
  const nSell = [v1, v2, v3, v6].filter((d) => d === "SELL").length;
  const nWait = 4 - nBuy - nSell;
  const concordantCount = Math.max(nBuy, nSell);
  const concordantDirection = nBuy > 0 && nSell > 0 ? "MIXED" : nBuy > 0 ? "BUY" : nSell > 0 ? "SELL" : "NONE";
  return { decisions, nBuy, nSell, nWait, concordantCount, concordantDirection };
}
const outcome = (side, entry, exit) => (exit === null || exit === undefined ? null : exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS fwd_profile_runs (run_id text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), start_ms bigint NOT NULL, asset text NOT NULL, config jsonb NOT NULL, config_hash text NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fwd_profile_events (event_id text PRIMARY KEY, run_id text NOT NULL, asset text NOT NULL, session_id text, segment_id text, t0_ms bigint NOT NULL, entry_price double precision, entry_observation_id text, market_context_id text, v1 text, v2 text, v3 text, v6 text, v7and text, v7relaxed text, n_buy int, n_sell int, n_wait int, concordant_count int, concordant_direction text, price_t45 double precision, ts_t45 bigint, obs_t45 text, price_t60 double precision, ts_t60 bigint, obs_t60 text, retry_count int NOT NULL DEFAULT 0, last_retry_ms bigint, created_ms bigint NOT NULL, settled_ms bigint, provenance jsonb)`);
  await pool.query(`ALTER TABLE fwd_profile_events ADD COLUMN IF NOT EXISTS v7and text`);
  await pool.query(`ALTER TABLE fwd_profile_events ADD COLUMN IF NOT EXISTS v7relaxed text`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fwd_profile_decisions (decision_id text PRIMARY KEY, event_id text NOT NULL, run_id text NOT NULL, strategy_version text NOT NULL, profile text NOT NULL, decision text NOT NULL, t0_ms bigint NOT NULL, entry_price double precision, price_t45 double precision, price_t60 double precision, result_45 text, result_60 text, observation_id text, context_id text, asset text, created_ms bigint NOT NULL, settled_ms bigint)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS fwd_profile_events_t0_idx ON fwd_profile_events (t0_ms)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS fwd_profile_decisions_event_idx ON fwd_profile_decisions (event_id)`);
}

async function getRun() {
  const latest = (await pool.query("SELECT * FROM fwd_profile_runs ORDER BY started_at DESC LIMIT 1")).rows[0];
  if (latest) return latest;
  const startMs = Date.now();
  const runId = `fwdP_${startMs}`;
  await pool.query("INSERT INTO fwd_profile_runs(run_id, start_ms, asset, config, config_hash) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT (run_id) DO NOTHING", [runId, startMs, ASSET, JSON.stringify(CONFIG), CONFIG_HASH]);
  console.info("FWD_PROFILES_RUN_CREATED", JSON.stringify({ runId, startMs, asset: ASSET, configHash: CONFIG_HASH }));
  return (await pool.query("SELECT * FROM fwd_profile_runs ORDER BY started_at DESC LIMIT 1")).rows[0];
}

const state = { lastObsMs: 0, groups: new Map(), seen: new Set() };
function ingest(o) {
  const key = `${o.s}|${o.g}`;
  if (!state.groups.has(key)) state.groups.set(key, { obs: [], candles: [] });
  const g = state.groups.get(key);
  g.obs.push(o);
  const b = Math.floor(o.t / BUCKET) * BUCKET;
  let cur = g.candles[g.candles.length - 1];
  if (!cur || cur.start !== b) { cur = { start: b, open: o.v, high: o.v, low: o.v, close: o.v, lastObs: o }; g.candles.push(cur); }
  else { cur.high = Math.max(cur.high, o.v); cur.low = Math.min(cur.low, o.v); cur.close = o.v; cur.lastObs = o; }
  if (o.t > state.lastObsMs) state.lastObsMs = o.t;
}
async function loadState(run) {
  const warmupStart = Number(run.start_ms) - WARMUP_MS;
  const rows = (await pool.query("SELECT session_id, segment_id, price_observation_id, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t, market_context_id FROM price_observations WHERE status='ACCEPTED' AND asset_canonical=$1 AND market_type='OTC' AND context_validation_status='VALID' AND EXTRACT(EPOCH FROM observed_at)*1000 >= $2 ORDER BY observed_at ASC", [ASSET, warmupStart])).rows;
  for (const r of rows) ingest({ s: r.session_id, g: r.segment_id, id: r.price_observation_id, v: Number(r.v), t: Number(r.t), ctx: r.market_context_id });
  const ev = await pool.query("SELECT event_id FROM fwd_profile_events WHERE run_id=$1", [run.run_id]);
  for (const e of ev.rows) state.seen.add(e.event_id);
  console.info("FWD_PROFILES_STATE_LOADED", JSON.stringify({ observations: rows.length, groups: state.groups.size, knownEvents: state.seen.size, cohortStart: new Date(Number(run.start_ms)).toISOString(), warmupStart: new Date(warmupStart).toISOString() }));
}
async function fetchNew(run) {
  const rows = (await pool.query("SELECT session_id, segment_id, price_observation_id, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t, market_context_id FROM price_observations WHERE status='ACCEPTED' AND asset_canonical=$1 AND market_type='OTC' AND context_validation_status='VALID' AND EXTRACT(EPOCH FROM observed_at)*1000 > $2 AND EXTRACT(EPOCH FROM observed_at)*1000 >= $3 ORDER BY observed_at ASC", [ASSET, Math.max(state.lastObsMs, Number(run.start_ms) - 1), Number(run.start_ms)])).rows;
  for (const r of rows) ingest({ s: r.session_id, g: r.segment_id, id: r.price_observation_id, v: Number(r.v), t: Number(r.t), ctx: r.market_context_id });
  return rows.length;
}

async function sampleEvents(run, now) {
  let inserted = 0;
  for (const [key, g] of state.groups) {
    const [sid, seg] = key.split("|");
    for (let i = MIN_CANDLES; i < g.candles.length; i++) {
      const candle = g.candles[i];
      if (candle.start + BUCKET > now) break;
      const eventId = `${sid}:${candle.start}`;
      if (state.seen.has(eventId)) continue;
      state.seen.add(eventId);
      const ref = candle.lastObs; if (!ref) continue;
      if (ref.t < Number(run.start_ms)) continue;
      if (now - ref.t >= 45000) { console.info("FWD_PROFILES_SKIPPED_STALE", JSON.stringify({ eventId, ageMs: now - ref.t })); continue; }
      const f = featuresAt(g.candles, i);
      const { decisions, nBuy, nSell, nWait, concordantCount, concordantDirection } = decideAll(f, g.candles.slice(0, i + 1));
      const ins = await pool.query(`INSERT INTO fwd_profile_events(event_id,run_id,asset,session_id,segment_id,t0_ms,entry_price,entry_observation_id,market_context_id,v1,v2,v3,v6,v7and,v7relaxed,n_buy,n_sell,n_wait,concordant_count,concordant_direction,created_ms,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb) ON CONFLICT (event_id) DO NOTHING`,
        [eventId, run.run_id, ASSET, sid, seg === "null" ? null : seg, ref.t, ref.v, ref.id, ref.ctx ?? null, decisions.v1, decisions.v2, decisions.v3, decisions.v6, decisions.v7and, decisions.v7relaxed, nBuy, nSell, nWait, concordantCount, concordantDirection, now, JSON.stringify({ candleStart: candle.start, configHash: CONFIG_HASH, cohortStartMs: Number(run.start_ms), warmupMs: WARMUP_MS, warmupCandles: i })]);
      if (ins.rowCount > 0) {
        inserted += 1;
        for (const s of STRATEGIES) {
          await pool.query("INSERT INTO fwd_profile_decisions(decision_id,event_id,run_id,strategy_version,profile,decision,t0_ms,entry_price,observation_id,context_id,asset,created_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (decision_id) DO NOTHING",
            [`${eventId}:${s.version}`, eventId, run.run_id, s.version, s.profile, decisions[s.key], ref.t, ref.v, ref.id, ref.ctx ?? null, ASSET, now]);
        }
        console.info("FWD_PROFILES_EVENT", JSON.stringify({ eventId, t0: ref.t, entry: ref.v, v1: decisions.v1, v2: decisions.v2, v3: decisions.v3, v6: decisions.v6, concordantCount, concordantDirection, futureKnown: false }));
      }
    }
  }
  return inserted;
}

async function findPrice(ev, horizon, tol) {
  const target = Number(ev.t0_ms) + horizon;
  const exact = (await pool.query("SELECT price_observation_id AS id, value::float8 AS v, (EXTRACT(EPOCH FROM observed_at)*1000)::bigint AS ts FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND ($2::text IS NULL OR segment_id=$2) AND EXTRACT(EPOCH FROM observed_at)*1000 >= $3 AND EXTRACT(EPOCH FROM observed_at)*1000 <= $4 ORDER BY observed_at ASC LIMIT 1", [ev.session_id, ev.segment_id ?? null, target, target + tol])).rows[0];
  if (exact) return exact;
  return (await pool.query("SELECT price_observation_id AS id, value::float8 AS v, (EXTRACT(EPOCH FROM observed_at)*1000)::bigint AS ts FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND asset_canonical=$2 AND market_type='OTC' AND context_validation_status='VALID' AND EXTRACT(EPOCH FROM observed_at)*1000 >= $3 AND EXTRACT(EPOCH FROM observed_at)*1000 <= $4 ORDER BY observed_at ASC LIMIT 1", [ev.session_id, ev.asset, target, target + tol])).rows[0] ?? null;
}

async function settleEvents(now) {
  const due = (await pool.query("SELECT * FROM fwd_profile_events WHERE (price_t45 IS NULL OR price_t60 IS NULL) AND retry_count <= 3 AND t0_ms + $1 + 60000 <= $2 ORDER BY t0_ms ASC LIMIT 200", [GRACE, now])).rows;
  let settled = 0;
  for (const ev of due) {
    let t45 = ev.price_t45 !== null ? { v: Number(ev.price_t45), ts: Number(ev.ts_t45), id: ev.obs_t45 } : await findPrice(ev, 45_000, TOL);
    let t60 = ev.price_t60 !== null ? { v: Number(ev.price_t60), ts: Number(ev.ts_t60), id: ev.obs_t60 } : await findPrice(ev, 60_000, TOL);
    if (!t45) t45 = await findPrice(ev, 45_000, 120_000);
    if (!t60) t60 = await findPrice(ev, 60_000, 120_000);
    if (t45 && t60) {
      await pool.query("UPDATE fwd_profile_events SET price_t45=$2, ts_t45=$3, obs_t45=$4, price_t60=$5, ts_t60=$6, obs_t60=$7, settled_ms=$8 WHERE event_id=$1",
        [ev.event_id, t45.v, t45.ts, t45.id, t60.v, t60.ts, t60.id, now]);
      const decs = (await pool.query("SELECT strategy_version, decision FROM fwd_profile_decisions WHERE event_id=$1", [ev.event_id])).rows;
      for (const d of decs) {
        const r45 = d.decision === "WAIT" ? null : outcome(d.decision, Number(ev.entry_price), t45.v);
        const r60 = d.decision === "WAIT" ? null : outcome(d.decision, Number(ev.entry_price), t60.v);
        await pool.query("UPDATE fwd_profile_decisions SET price_t45=$2, price_t60=$3, result_45=$4, result_60=$5, settled_ms=$6 WHERE decision_id=$7 AND settled_ms IS NULL",
          [t45.v, t60.v, r45, r60, now, `${ev.event_id}:${d.strategy_version}`]);
      }
      settled += 1;
      console.info("FWD_PROFILES_SETTLED", JSON.stringify({ eventId: ev.event_id, t45: t45.v, t60: t60.v }));
    } else {
      await pool.query("UPDATE fwd_profile_events SET retry_count=retry_count+1, last_retry_ms=$2 WHERE event_id=$1", [ev.event_id, now]);
    }
  }
  return settled;
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("FWD_PROFILES_NO_DATABASE_URL"); process.exit(1); }
  await init();
  const run = await getRun();
  await loadState(run);
  console.info("FWD_PROFILES_STARTED", JSON.stringify({ asset: ASSET, runId: run.run_id, cohortStart: new Date(Number(run.start_ms)).toISOString(), configHash: CONFIG_HASH, profiles: CONFIG.profiles }));
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    const now = Date.now();
    let fetched = 0, sampled = 0, settled = 0;
    try { fetched = await fetchNew(run); } catch (e) { console.error("FWD_PROFILES_FETCH_ERROR", e instanceof Error ? e.message : String(e)); }
    try { sampled = await sampleEvents(run, now); } catch (e) { console.error("FWD_PROFILES_SAMPLE_ERROR", e instanceof Error ? e.message : String(e)); }
    try { settled = await settleEvents(now); } catch (e) { console.error("FWD_PROFILES_SETTLE_ERROR", e instanceof Error ? e.message : String(e)); }
    if (fetched || sampled || settled) console.info("FWD_PROFILES_TICK", JSON.stringify({ fetched, sampled, settled }));
    busy = false;
  };
  await tick();
  setInterval(() => void tick(), POLL_MS);
}
if (process.env.FWD_PROFILES_NO_AUTOSTART !== "1") {
  main().catch((e) => { console.error("FWD_PROFILES_FATAL", e instanceof Error ? e.message : String(e)); process.exit(1); });
}