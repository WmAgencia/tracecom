const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
(async () => {
  await c.connect();
  const run = (await c.query("SELECT * FROM fwd_event_runs ORDER BY started_at DESC LIMIT 1")).rows[0];
  const startMs = Number(run.start_ms), endMs = startMs + 30 * 60000;
  const dec = await c.query("SELECT direction, probability_source, COUNT(*)::int n FROM live_decisions WHERE timestamp >= to_timestamp($1/1000.0) AND timestamp <= to_timestamp($2/1000.0) GROUP BY 1,2 ORDER BY n DESC", [startMs, endMs]);
  console.log("agent decisions in cohort window (by direction/source):");
  for (const x of dec.rows) console.log(`  ${x.probability_source} ${x.direction} n=${x.n}`);
  const signals = await c.query("SELECT decision_id, direction, timestamp, candle_id, session_id, probability_source FROM live_decisions WHERE direction IN ('BUY','SELL') AND timestamp >= to_timestamp($1/1000.0) AND timestamp <= to_timestamp($2/1000.0) ORDER BY timestamp ASC", [startMs, endMs]);
  console.log(`agent signals: ${signals.rows.length}`);
  const outcomes = [];
  for (const s of signals.rows) {
    const t0 = new Date(s.timestamp).getTime();
    const entry = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND EXTRACT(EPOCH FROM observed_at)*1000 <= $2 ORDER BY observed_at DESC LIMIT 1", [s.session_id, t0])).rows[0];
    const exit = (await c.query("SELECT value::float8 AS v, (EXTRACT(EPOCH FROM observed_at)*1000)::bigint AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND EXTRACT(EPOCH FROM observed_at)*1000 >= $2 AND EXTRACT(EPOCH FROM observed_at)*1000 <= $3 ORDER BY observed_at ASC LIMIT 1", [s.session_id, t0 + 60000, t0 + 90000])).rows[0];
    if (!entry || !exit) { outcomes.push({ ...s, result: "U" }); continue; }
    const r = Number(exit.v) === Number(entry.v) ? "DRAW" : s.direction === "BUY" ? (Number(exit.v) > Number(entry.v) ? "WIN" : "LOSS") : (Number(exit.v) < Number(entry.v) ? "WIN" : "LOSS");
    outcomes.push({ ...s, result: r, entry: Number(entry.v), exit: Number(exit.v) });
  }
  const rr = outcomes.map((x) => x.result);
  const w = rr.filter((r) => r === "WIN").length, l = rr.filter((r) => r === "LOSS").length, d = rr.filter((r) => r === "DRAW").length, u = rr.filter((r) => r === "U").length;
  const dirN = w + l;
  console.log(`AGENT (v3+fib via sistema) | sinais=${outcomes.length} W=${w} L=${l} D=${d} U=${u} | WR=${dirN ? +((w / dirN) * 100).toFixed(1) : null}% Wilson=${wilson(w, dirN) ? wilson(w, dirN).join("..") : "-"}`);
  for (const x of outcomes.slice(0, 12)) console.log(`  ${new Date(Number(x.timestamp)).toISOString()} ${x.direction} entry=${x.entry ?? "-"} exit=${x.exit ?? "-"} -> ${x.result}`);
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });