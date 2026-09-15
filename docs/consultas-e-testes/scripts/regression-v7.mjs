import fs from "node:fs";
import pg from "pg";
process.env.FWD4_NO_AUTOSTART = "1";
process.env.FWD_PROFILES_NO_AUTOSTART = "1";
const { Client } = pg;
const { buildCandles, featuresAt } = await import("file:///C:/tracecom-forward4/index.mjs");
const { decideAll } = await import("file:///C:/tracecom-forward4/index-profiles.mjs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
// ===== REFERÊNCIA INDEPENDENTE (mesmas equações dos scripts dos experimentos) =====
function refFeatures(cd) {
  const m = cd.length; if (m < 31) return null;
  const closes = cd.map((x) => x.close), close = closes[m - 1];
  let g = 0, l = 0; for (let i = m - 14; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mv = mean(rs), vol = Math.sqrt(mean(rs.map((x) => (x - mv) ** 2)));
  const mom120 = (close - closes[m - 25]) / closes[m - 25];
  const w24 = cd.slice(m - 24); const hi = Math.max(...w24.map((x) => x.high)), lo = Math.min(...w24.map((x) => x.low));
  let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === hi && fh === -1) fh = j; if (w24[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh; const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const inZone = range > 0 && close <= zHi && close >= zLo;
  const atr = mean(cd.slice(m - 14).map((x) => x.high - x.low));
  const sma20 = mean(closes.slice(-20));
  return { s, vol, mom120, inZone, upSwing, close, atr, sma20 };
}
const fibOk = (f, dir) => f.inZone && (dir === "BUY" ? f.upSwing : !f.upSwing);
const rV1 = (f) => { const d = f.vol < .0009 && Math.abs(f.s) > .33 ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; };
const rV3 = (f) => { const d = f.vol < .0012 && Math.abs(f.s) > .22 && ((f.s > 0 && f.mom120 > 0) || (f.s < 0 && f.mom120 < 0)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; };
const rV6 = (f) => { const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857; const d = f.vol < .0009 && deep ? (f.s > 0 ? "BUY" : "SELL") : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; };
const rAtr = (f, mult) => { const d = f.sma20 - f.close >= mult * f.atr ? "BUY" : f.close - f.sma20 >= mult * f.atr ? "SELL" : "WAIT"; return d !== "WAIT" && fibOk(f, d) ? d : "WAIT"; };
const rV7And = (f) => { const a = rAtr(f, 3), b = rV1(f); return a !== "WAIT" && a === b ? a : "WAIT"; };
const rV7Rel = (f) => { const a = rAtr(f, 1), b = rV1(f); if (a === "WAIT") return b; if (b === "WAIT") return a; return a === b ? a : "WAIT"; };
(async () => {
  await c.connect();
  const trades = (await c.query("SELECT session_id, segment_id, reference_timestamp AS t0, reference_price, asset_canonical AS asset FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC")).rows;
  const keys = new Map();
  for (const t of trades) { const k = `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  const groups = new Map();
  for (const t of trades) groups.set(`${t.session_id}|${t.segment_id ?? "none"}`, { s: t.session_id, g: t.segment_id ?? null, a: t.asset });
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  const CHECKS = ["v1", "v3", "v6", "v7and", "v7relaxed"];
  const agree = { v1: 0, v3: 0, v6: 0, v7and: 0, v7relaxed: 0 };
  let checked = 0; const cex = [];
  const fixtures = [];
  for (const [k, list] of keys) {
    const t = list[0]; const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const bucketEnd = Math.floor(Number(t.t0) / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    if (window.length < 2) continue;
    const candles = buildCandles(window);
    if (candles.length < 31) continue;
    const i = candles.length - 1;
    const fRef = refFeatures(candles);
    const fExec = featuresAt(candles, i);
    const exec = decideAll(fExec, candles);
    const ref = { v1: rV1(fRef), v3: rV3(fRef), v6: rV6(fRef), v7and: rV7And(fRef), v7relaxed: rV7Rel(fRef) };
    checked += 1;
    for (const s of CHECKS) { if (exec.decisions[s] === ref[s]) agree[s] += 1; else if (cex.length < 5) cex.push({ key: k, strategy: s, ref: ref[s], exec: exec.decisions[s] }); }
    if (fixtures.length < 25) fixtures.push(candles);
  }
  console.log(`fixtures analisadas: ${checked}`);
  let allPass = true;
  for (const s of CHECKS) { const pct = ((agree[s] / checked) * 100).toFixed(1); const pass = agree[s] === checked; if (!pass) allPass = false; console.log(`regressão ${s}: ${agree[s]}/${checked} = ${pct}% ${pass ? "PASS" : "FAIL"}`); }
  if (cex.length) console.log("counterexamples: " + JSON.stringify(cex, null, 1));
  // ===== causalidade: mutar o futuro não pode mudar decisões passadas =====
  let causalityOk = true;
  for (const candles of fixtures) {
    const i = candles.length - 1;
    const before = decideAll(featuresAt(candles, i), candles).decisions;
    const mutated = candles.concat(candles.slice(-10).map((x, j) => ({ start: x.start + 50000 + j * 5000, open: x.open * 9, high: x.high * 9, low: x.low * 9, close: x.close * 9 })));
    const after = decideAll(featuresAt(mutated, i), mutated.slice(0, i + 1)).decisions;
    for (const s of CHECKS) if (before[s] !== after[s]) { causalityOk = false; console.log(`CAUSALITY FAIL ${s}: before=${before[s]} after=${after[s]}`); }
  }
  console.log(causalityOk ? "causalidade: PASS (mutação do futuro não altera nenhuma decisão)" : "causalidade: FAIL");
  fs.writeFileSync("C:/tracecom-forward4/regression-v7.json", JSON.stringify({ checked, agree, cex, causalityOk, allPass }, null, 1));
  await c.end();
  process.exit(allPass && causalityOk ? 0 : 1);
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });