/**
 * TraceCom FORWARD EVENTS executor — protocolo de 100 EVENTOS (parte 2, AUD/CAD).
 *
 * Regra de amostragem (fixa, causal, independente de resultado):
 *   - Coorte nova: começa no primeiro candle COMPLETO após o boot desta correção.
 *   - Todo candle de 5s com >= 1 observação aceita (AUD/CAD OTC VALID) é um evento candidato, em ordem cronológica.
 *   - Em T0 (fechamento do candle): entryPrice = última observação do candle; decisões A/B/C/D congeladas e
 *     PERSISTIDAS imediatamente (BUY/SELL/WAIT) usando SOMENTE dados até o candle.
 *   - Depois: priceT45 (primeira obs em [T0+45s, T0+75s]) e priceT60 (primeira obs em [T0+60s, T0+90s]).
 *   - Coorte ENCERRA quando 100 eventos tiverem T+60 resolvido. Nenhuma seleção por resultado.
 *   - WAIT é decisão válida (cobertura), não entra em W/(W+L).
 * Zero look-ahead, zero replay, zero broker side effects.
 */
process.env.FWD4_NO_AUTOSTART = "1";
import pg from "pg";
import { createHash } from "node:crypto";
const { buildCandles, featuresAt, signalsFor } = await import("./index.mjs");

const BUCKET = 5000, MIN_CANDLES = 30, TOL = 30_000, GRACE = 15_000, TARGET_EVENTS = 100, POLL_MS = 5000;
const ASSET = process.env.FWD_ASSET ?? "AUD/CAD";
const STRATS = { A: "reversion-v1-fib", B: "reversion-v3-fib", C: "reversion-v2-fib", D: "stochrsi-v1" };
const CONFIG = { version: "fwd-events-1.0.0", asset: ASSET, bucket_ms: BUCKET, min_candles: MIN_CANDLES, tol_ms: TOL, grace_ms: GRACE, target_events: TARGET_EVENTS, sampling: "every completed 5s candle with >=1 accepted observation, chronological", strategies: STRATS };
const CONFIG_HASH = createHash("sha256").update(JSON.stringify(CONFIG)).digest("hex").slice(0, 16);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });

const outcome = (side, entry, exit) => (exit === null || exit === undefined ? null : exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS fwd_event_runs (run_id text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), start_ms bigint NOT NULL, asset text NOT NULL, config jsonb NOT NULL, config_hash text NOT NULL, closed boolean NOT NULL DEFAULT false)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS fwd_events (
    event_id text PRIMARY KEY, run_id text NOT NULL, asset text NOT NULL, session_id text, segment_id text,
    t0_ms bigint NOT NULL, entry_price double precision, entry_observation_id text,
    a_decision text, b_decision text, c_decision text, d_decision text,
    rsi double precision, stoch_rsi double precision, ema9 double precision, ema21 double precision, volatility double precision, mom120 double precision, fib jsonb,
    price_t45 double precision, ts_t45 bigint, obs_t45 text, price_t60 double precision, ts_t60 bigint, obs_t60 text,
    a_45 text, b_45 text, c_45 text, d_45 text, a_60 text, b_60 text, c_60 text, d_60 text,
    retry_count int NOT NULL DEFAULT 0, last_retry_ms bigint, settled_ms bigint, created_ms bigint NOT NULL, provenance jsonb)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS fwd_events_t0_idx ON fwd_events (t0_ms)`);
}

async function getRun() {
  const ex = (await pool.query("SELECT * FROM fwd_event_runs ORDER BY started_at ASC LIMIT 1")).rows[0];
  if (ex) return ex;
  const startMs = Date.now();
  const runId = `fwdE_${startMs}`;
  await pool.query("INSERT INTO fwd_event_runs(run_id, start_ms, asset, config, config_hash) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT (run_id) DO NOTHING", [runId, startMs, ASSET, JSON.stringify(CONFIG), CONFIG_HASH]);
  console.info("FWD_EVENTS_RUN_CREATED", JSON.stringify({ runId, startMs, asset: ASSET, configHash: CONFIG_HASH }));
  return (await pool.query("SELECT * FROM fwd_event_runs ORDER BY started_at ASC LIMIT 1")).rows[0];
}

const state = { lastObsMs: 0, groups: new Map(), seen: new Set() };

async function loadState(run) {
  const rows = (await pool.query("SELECT session_id, segment_id, price_observation_id, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE status='ACCEPTED' AND asset_canonical=$1 AND market_type='OTC' AND context_validation_status='VALID' AND EXTRACT(EPOCH FROM observed_at)*1000 >= $2 ORDER BY observed_at ASC", [ASSET, Number(run.start_ms)])).rows;
  for (const r of rows) ingest({ s: r.session_id, g: r.segment_id, id: r.price_observation_id, v: Number(r.v), t: Number(r.t) });
  const ev = await pool.query("SELECT event_id FROM fwd_events WHERE run_id=$1", [run.run_id]);
  for (const e of ev.rows) state.seen.add(e.event_id);
  console.info("FWD_EVENTS_STATE_LOADED", JSON.stringify({ observations: rows.length, groups: state.groups.size, knownEvents: state.seen.size, cohortStart: new Date(Number(run.start_ms)).toISOString() }));
}

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

async function fetchNew(run) {
  const rows = (await pool.query("SELECT session_id, segment_id, price_observation_id, value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE status='ACCEPTED' AND asset_canonical=$1 AND market_type='OTC' AND context_validation_status='VALID' AND EXTRACT(EPOCH FROM observed_at)*1000 > $2 AND EXTRACT(EPOCH FROM observed_at)*1000 >= $3 ORDER BY observed_at ASC", [ASSET, Math.max(state.lastObsMs, Number(run.start_ms) - 1), Number(run.start_ms)])).rows;
  for (const r of rows) ingest({ s: r.session_id, g: r.segment_id, id: r.price_observation_id, v: Number(r.v), t: Number(r.t) });
  return rows.length;
}

async function sampleEvents(run, now) {
  const resolved = (await pool.query("SELECT COUNT(*)::int n FROM fwd_events WHERE run_id=$1 AND price_t60 IS NOT NULL", [run.run_id])).rows[0].n;
  if (resolved >= TARGET_EVENTS) return 0;
  let inserted = 0;
  for (const [key, g] of state.groups) {
    const [sid, seg] = key.split("|");
    for (let i = MIN_CANDLES; i < g.candles.length; i++) {
      const candle = g.candles[i];
      if (candle.start + BUCKET > now) break; // candle ainda não fechou
      const eventId = `${sid}:${candle.start}`;
      if (state.seen.has(eventId)) continue;
      state.seen.add(eventId);
      const f = featuresAt(g.candles, i);
      const ref0 = candle.lastObs; if (!ref0) continue;
      // PURITY: a decisão precisa ser persistida ANTES de T+45 existir.
      if (now - ref0.t >= 45000) { console.info("FWD_EVENT_SKIPPED_STALE", JSON.stringify({ eventId, t0: ref0.t, ageMs: now - ref0.t })); continue; }
      const dA = signalsFor(f, STRATS.A)[0] ?? "WAIT";
      const dB = signalsFor(f, STRATS.B)[0] ?? "WAIT";
      const dC = signalsFor(f, STRATS.C)[0] ?? "WAIT";
      const dD = signalsFor(f, STRATS.D)[0] ?? "WAIT";
      const ref = candle.lastObs; if (!ref) continue;
      const ins = await pool.query(`INSERT INTO fwd_events(event_id,run_id,asset,session_id,segment_id,t0_ms,entry_price,entry_observation_id,a_decision,b_decision,c_decision,d_decision,rsi,stoch_rsi,ema9,ema21,volatility,mom120,fib,created_ms,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21::jsonb) ON CONFLICT (event_id) DO NOTHING`,
        [eventId, run.run_id, ASSET, sid, seg === "null" ? null : seg, ref.t, ref.v, ref.id, dA, dB, dC, dD, f.rsi, f.srs, f.ema9, f.ema21, f.vol, f.mom120, f.fib ? JSON.stringify(f.fib) : null, now, JSON.stringify({ candleStart: candle.start, configHash: CONFIG_HASH })]);
      if (ins.rowCount > 0) {
        inserted += 1;
        console.info("FWD_EVENT_SAMPLED", JSON.stringify({ eventId, t0: ref.t, entry: ref.v, A: dA, B: dB, C: dC, D: dD, futureKnown: false }));
      }
    }
  }
  return inserted;
}

async function settleEvents(run, now) {
  const due = (await pool.query("SELECT * FROM fwd_events WHERE run_id=$1 AND (price_t60 IS NULL OR price_t45 IS NULL) AND retry_count < 3 AND t0_ms + $2 + 60000 <= $3 ORDER BY t0_ms ASC LIMIT 200", [run.run_id, GRACE, now])).rows;
  let settled = 0;
  for (const ev of due) {
    const t45 = await findPrice(ev, 45_000, TOL);
    const t60 = await findPrice(ev, 60_000, TOL);
    if (t45 && t60) {
      const upd = await pool.query(`UPDATE fwd_events SET price_t45=$2, ts_t45=$3, obs_t45=$4, price_t60=$5, ts_t60=$6, obs_t60=$7,
        a_45=$8, b_45=$9, c_45=$10, d_45=$11, a_60=$12, b_60=$13, c_60=$14, d_60=$15, settled_ms=$16 WHERE event_id=$1`,
        [ev.event_id, t45.v, t45.ts, t45.id, t60.v, t60.ts, t60.id,
         outcome(ev.a_decision, ev.entry_price, t45.v), outcome(ev.b_decision, ev.entry_price, t45.v), outcome(ev.c_decision, ev.entry_price, t45.v), outcome(ev.d_decision, ev.entry_price, t45.v),
         outcome(ev.a_decision, ev.entry_price, t60.v), outcome(ev.b_decision, ev.entry_price, t60.v), outcome(ev.c_decision, ev.entry_price, t60.v), outcome(ev.d_decision, ev.entry_price, t60.v), now]);
      if (upd.rowCount > 0) { settled += 1; console.info("FWD_EVENT_SETTLED", JSON.stringify({ eventId: ev.event_id, A: ev.a_decision, B: ev.b_decision, C: ev.c_decision, D: ev.d_decision })); }
    } else {
      const wider45 = t45 ? null : await findPrice(ev, 45_000, 120_000);
      const wider60 = t60 ? null : await findPrice(ev, 60_000, 120_000);
      if ((!t45 && !wider45) || (!t60 && !wider60)) {
        await pool.query("UPDATE fwd_events SET retry_count=retry_count+1, last_retry_ms=$2 WHERE event_id=$1 AND price_t60 IS NULL", [ev.event_id, now]);
      } else {
        const f45 = t45 ?? wider45, f60 = t60 ?? wider60;
        await pool.query(`UPDATE fwd_events SET price_t45=$2, ts_t45=$3, obs_t45=$4, price_t60=$5, ts_t60=$6, obs_t60=$7, a_45=$8, b_45=$9, c_45=$10, d_45=$11, a_60=$12, b_60=$13, c_60=$14, d_60=$15, settled_ms=$16 WHERE event_id=$1`,
          [ev.event_id, f45.v, f45.ts, f45.id, f60.v, f60.ts, f60.id,
           outcome(ev.a_decision, ev.entry_price, f45.v), outcome(ev.b_decision, ev.entry_price, f45.v), outcome(ev.c_decision, ev.entry_price, f45.v), outcome(ev.d_decision, ev.entry_price, f45.v),
           outcome(ev.a_decision, ev.entry_price, f60.v), outcome(ev.b_decision, ev.entry_price, f60.v), outcome(ev.c_decision, ev.entry_price, f60.v), outcome(ev.d_decision, ev.entry_price, f60.v), now]);
        settled += 1;
        console.info("FWD_EVENT_SETTLED", JSON.stringify({ eventId: ev.event_id, A: ev.a_decision, B: ev.b_decision, C: ev.c_decision, D: ev.d_decision }));
      }
    }
  }
  const resolved = (await pool.query("SELECT COUNT(*)::int n FROM fwd_events WHERE run_id=$1 AND price_t60 IS NOT NULL", [run.run_id])).rows[0].n;
  if (resolved >= TARGET_EVENTS) {
    const c = await pool.query("UPDATE fwd_event_runs SET closed=true WHERE run_id=$1 AND closed=false RETURNING run_id", [run.run_id]);
    if (c.rowCount > 0) console.info("FWD_EVENTS_COMPLETE", JSON.stringify({ runId: run.run_id, resolved }));
  }
  return settled;
}

async function findPrice(ev, horizon, tol) {
  const target = Number(ev.t0_ms) + horizon;
  const exact = (await pool.query("SELECT price_observation_id AS id, value::float8 AS v, (EXTRACT(EPOCH FROM observed_at)*1000)::bigint AS ts FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND ($2::text IS NULL OR segment_id=$2) AND EXTRACT(EPOCH FROM observed_at)*1000 >= $3 AND EXTRACT(EPOCH FROM observed_at)*1000 <= $4 ORDER BY observed_at ASC LIMIT 1", [ev.session_id, ev.segment_id ?? null, target, target + tol])).rows[0];
  if (exact) return exact;
  return (await pool.query("SELECT price_observation_id AS id, value::float8 AS v, (EXTRACT(EPOCH FROM observed_at)*1000)::bigint AS ts FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND asset_canonical=$2 AND market_type='OTC' AND context_validation_status='VALID' AND EXTRACT(EPOCH FROM observed_at)*1000 >= $3 AND EXTRACT(EPOCH FROM observed_at)*1000 <= $4 ORDER BY observed_at ASC LIMIT 1", [ev.session_id, ev.asset, target, target + tol])).rows[0] ?? null;
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("FWD_EVENTS_NO_DATABASE_URL"); process.exit(1); }
  await init();
  const run = await getRun();
  await loadState(run);
  console.info("FWD_EVENTS_STARTED", JSON.stringify({ asset: ASSET, runId: run.run_id, cohortStart: new Date(Number(run.start_ms)).toISOString(), configHash: CONFIG_HASH, targetEvents: TARGET_EVENTS }));
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    const now = Date.now();
    let fetched = 0, sampled = 0, settled = 0;
    try { fetched = await fetchNew(run); } catch (e) { console.error("FWD_EVENTS_FETCH_ERROR", e instanceof Error ? e.message : String(e)); }
    try { sampled = await sampleEvents(run, now); } catch (e) { console.error("FWD_EVENTS_SAMPLE_ERROR", e instanceof Error ? e.message : String(e)); }
    try { settled = await settleEvents(run, now); } catch (e) { console.error("FWD_EVENTS_SETTLE_ERROR", e instanceof Error ? e.message : String(e)); }
    if (fetched || sampled || settled) console.info("FWD_EVENTS_TICK", JSON.stringify({ fetched, sampled, settled }));
    busy = false;
  };
  await tick();
  setInterval(() => void tick(), POLL_MS);
}
main().catch((e) => { console.error("FWD_EVENTS_FATAL", e instanceof Error ? e.message : String(e)); process.exit(1); });