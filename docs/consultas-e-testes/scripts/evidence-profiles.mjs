import fs from "node:fs";
import pg from "pg";
process.env.FWD4_NO_AUTOSTART = "1";
const { Client } = pg;
const { featuresAt, buildCandles } = await import("file:///C:/tracecom-forward4/index.mjs");
const { decideAll } = await import("file:///C:/tracecom-forward4/index-profiles.mjs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ENDPOINT = "https://tracecom.consecom.com.br/api/fast/decision";
// referência INDEPENDENTE (mesmas regras congeladas, implementação separada da usada no executor)
function refFeatures(candles) {
  const m = candles.length; if (m < 31) return null;
  const closes = candles.map((x) => x.close);
  let g = 0, l = 0; for (let i = m - 14; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l); const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length; const vol = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  const mom120 = (closes[m - 1] - closes[m - 25]) / closes[m - 25];
  const w = candles.slice(m - 24); const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low));
  let fh = -1, fl = -1; for (let j = 0; j < w.length; j++) { if (w[j].high === hi && fh === -1) fh = j; if (w[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh; const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const close = closes[m - 1]; const inZone = range > 0 && close <= zHi && close >= zLo;
  return { s, vol, mom120, inZone, upSwing };
}
function refDecisions(f) {
  if (!f) return { v1: "WAIT", v2: "WAIT", v3: "WAIT", v6: "WAIT" };
  const v1 = f.vol < .0009 && f.inZone && ((f.s > .33 && f.upSwing) || (f.s < -.33 && !f.upSwing)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
  const v2 = f.vol < .0012 && f.inZone && ((f.s > .22 && f.upSwing) || (f.s < -.22 && !f.upSwing)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
  const v3 = f.vol < .0012 && f.inZone && ((f.s > .22 && f.mom120 > 0 && f.upSwing) || (f.s < -.22 && f.mom120 < 0 && !f.upSwing)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
  const deep = Math.abs(f.s) >= .63 && Math.abs(f.s) <= .857;
  const v6 = f.vol < .0009 && deep && f.inZone && ((f.s > 0 && f.upSwing) || (f.s < 0 && !f.upSwing)) ? (f.s > 0 ? "BUY" : "SELL") : "WAIT";
  return { v1, v2, v3, v6 };
}
const buckEnd = (t) => Math.floor(t / 5000) * 5000 + 5000;
(async () => {
  await c.connect();
  const trades = (await c.query("SELECT trade_id, asset_canonical AS asset, session_id, segment_id, reference_timestamp AS t0, reference_price, settlement_price FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC")).rows;
  const keys = new Map();
  for (const t of trades) { const k = `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`; if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  const groups = new Map();
  for (const t of trades) groups.set(`${t.session_id}|${t.segment_id ?? "none"}`, { s: t.session_id, g: t.segment_id ?? null, a: t.asset });
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  // === PARTE A: regressão local (executor.decideAll vs referência congelada) ===
  let checked = 0, mismA = 0; const cexA = [];
  const fixtures = [];
  for (const [k, list] of keys) {
    const t = list[0]; const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const window = all.filter((o) => o.t < buckEnd(Number(t.t0))).slice(-120);
    if (window.length < 2) continue;
    const candles = buildCandles(window);
    if (candles.length < 31) continue;
    const ref = refDecisions(refFeatures(candles));
    const exec = decideAll(featuresAt(candles, candles.length - 1)).decisions;
    checked += 1;
    if (ref.v1 !== exec.v1 || ref.v2 !== exec.v2 || ref.v3 !== exec.v3 || ref.v6 !== exec.v6) { mismA += 1; if (cexA.length < 3) cexA.push({ key: k, ref, exec }); }
    if (fixtures.length < 400) fixtures.push({ key: k, prices: window, t0: Number(t.t0), asset: t.asset, ref });
  }
  console.log(`PARTE A (regressão local): ${checked - mismA}/${checked} = ${(((checked - mismA) / checked) * 100).toFixed(1)}% de concordância entre executor e referência congelada`);
  if (cexA.length) console.log("counterexamples A: " + JSON.stringify(cexA, null, 1));
  // === PARTE B: regressão via API de produção (fibProfiles + decisão inalterada) ===
  let agreeB = 0, divB = 0, decOk = 0; const cexB = [];
  let idx = 0;
  const worker = async () => {
    while (idx < fixtures.length) {
      const fx = fixtures[idx++];
      const body = { now: buckEnd(fx.t0), prices: fx.prices.map((p) => ({ value: p.v, timestamp: p.t })), candleId: `candle_${Math.floor(fx.t0 / 5000) * 5000}`, decisionId: "regprof", sessionId: "regprof", frames: [], deepContext: null };
      try {
        const r = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json(); const f = j.fast ?? j; const fp = f.fibProfiles;
        if (!fp) { divB += 1; if (cexB.length < 3) cexB.push({ key: fx.key, err: "no fibProfiles" }); continue; }
        const ok = fp.v1 === fx.ref.v1 && fp.v2 === fx.ref.v2 && fp.v3 === fx.ref.v3 && fp.v6 === fx.ref.v6;
        if (ok) agreeB += 1; else { divB += 1; if (cexB.length < 3) cexB.push({ key: fx.key, ref: fx.ref, api: { v1: fp.v1, v2: fp.v2, v3: fp.v3, v6: fp.v6 } }); }
        if (f.decision === fx.ref.v3) decOk += 1;
      } catch { divB += 1; }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`PARTE B (API de produção): fibProfiles ${agreeB}/${agreeB + divB} = ${(((agreeB / Math.max(1, agreeB + divB))) * 100).toFixed(1)}% | decisão congelada (v3fib) inalterada: ${decOk}/${agreeB + divB}`);
  if (cexB.length) console.log("counterexamples B: " + JSON.stringify(cexB, null, 1));
  // === PARTE C: concordância histórica 1/2/3/4 × T+45/T+60 ===
  const outcome = (side, entry, exit) => (exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
  const groupsC = { 1: { h45: [], h60: [] }, 2: { h45: [], h60: [] }, 3: { h45: [], h60: [] }, 4: { h45: [], h60: [] } };
  let used = 0;
  for (const [k, list] of keys) {
    const t = list[0]; const all = obsCache.get(`${t.session_id}|${t.segment_id ?? "none"}`) ?? [];
    const window = all.filter((o) => o.t < buckEnd(Number(t.t0))).slice(-120);
    if (window.length < 2) continue;
    const f = refFeatures(buildCandles(window)); if (!f) continue;
    const d = refDecisions(f);
    const vals = [d.v1, d.v2, d.v3, d.v6];
    const nBuy = vals.filter((x) => x === "BUY").length, nSell = vals.filter((x) => x === "SELL").length;
    const count = Math.max(nBuy, nSell);
    if (count === 0 || (nBuy > 0 && nSell > 0)) continue;
    const dir = nBuy > nSell ? "BUY" : "SELL";
    const refT = Number(t.t0), refP = Number(t.reference_price);
    const last = window[window.length - 1];
    const entry = { v: refP, t: refT };
    const e45 = all.find((o) => o.t >= refT + 45000 && o.t <= refT + 75000);
    const e60 = all.find((o) => o.t >= refT + 60000 && o.t <= refT + 90000);
    if (e45) groupsC[count].h45.push(outcome(dir, entry.v, e45.v));
    if (e60) groupsC[count].h60.push(outcome(dir, entry.v, e60.v));
    used += 1;
  }
  const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return +(Math.max(0, cc - h)).toFixed(3); };
  console.log(`\nPARTE C (concordância histórica — ${used} eventos direcionais):`);
  for (const cnt of [1, 2, 3, 4]) {
    for (const h of ["h45", "h60"]) {
      const arr = groupsC[cnt][h]; const w = arr.filter((x) => x === "WIN").length, l = arr.filter((x) => x === "LOSS").length, dr = arr.filter((x) => x === "DRAW").length;
      if (!arr.length) continue;
      console.log(`concordantes=${cnt} ${h === "h45" ? "T+45" : "T+60"}: n=${arr.length} W=${w} L=${l} D=${dr} WR=${((w / (w + l)) * 100).toFixed(1)}% wilsonLow=${wilson(w, w + l)}`);
    }
  }
  fs.writeFileSync("C:/tracecom-forward4/evidence-profiles.json", JSON.stringify({ partA: { checked, mismA }, partB: { agreeB, divB, decOk }, partC: groupsC }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });