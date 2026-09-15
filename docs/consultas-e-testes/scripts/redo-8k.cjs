const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ENDPOINT = "https://tracecom.consecom.com.br/api/fast/decision";
const CONCURRENCY = 8;
function buildSeries(rows) { const map = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = map.get(b); if (!cc) map.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...map.values()].sort((a, b) => a.start - b.start); }
function evalB(candles) {
  const n = candles.length;
  if (n < 31) return { decision: "WAIT", reason: "insufficient_candles", candles: n };
  const closes = candles.map((x) => x.close), m = closes.length;
  let g = 0, l = 0;
  for (let i = m - 14; i < m; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  const s = (55 - rsi) / 45;
  const rs = []; for (let j = m - 12; j < m; j++) rs.push((closes[j] - closes[j - 1]) / closes[j - 1]);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const vol = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  const mom120 = (closes[m - 1] - closes[m - 25]) / closes[m - 25];
  const w = candles.slice(m - 24);
  const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low));
  let fh = -1, fl = -1;
  for (let j = 0; j < w.length; j++) { if (w[j].high === hi && fh === -1) fh = j; if (w[j].low === lo && fl === -1) fl = j; }
  const range = hi - lo, upSwing = fl <= fh;
  const zHi = Math.max(hi - range * .382, hi - range * .618), zLo = Math.min(hi - range * .382, hi - range * .618);
  const close = closes[m - 1];
  const inZone = range > 0 && close <= zHi && close >= zLo;
  const volOk = vol < .0012;
  let decision = "WAIT";
  if (volOk && inZone && s > .22 && mom120 > 0 && upSwing) decision = "BUY";
  else if (volOk && inZone && s < -.22 && mom120 < 0 && !upSwing) decision = "SELL";
  return { decision, candles: n, rsi, s, vol, mom120, inZone, upSwing };
}
const outcome = (side, entry, exit) => (exit === entry ? "DRAW" : side === "BUY" ? (exit > entry ? "WIN" : "LOSS") : (exit < entry ? "WIN" : "LOSS"));
(async () => {
  await c.connect();
  const trades = (await c.query("SELECT trade_id, asset_canonical AS asset, session_id, segment_id, reference_timestamp AS t0, reference_price, settlement_price, settlement_target_at, result FROM shadow_trades WHERE reference_timestamp IS NOT NULL AND session_id IS NOT NULL ORDER BY reference_timestamp ASC")).rows;
  console.log(`trades carregados: ${trades.length}`);
  const keyOf = (t) => `${t.session_id}|${t.segment_id ?? "none"}|${Math.floor(Number(t.t0) / 5000) * 5000}`;
  const keys = new Map();
  for (const t of trades) { const k = keyOf(t); if (!keys.has(k)) keys.set(k, []); keys.get(k).push(t); }
  console.log(`snapshots únicos: ${keys.size}`);
  // carregar obs por grupo (session|segment) — ingest exato
  const groups = new Map();
  for (const t of trades) { groups.set(`${t.session_id}|${t.segment_id ?? "none"}`, { s: t.session_id, g: t.segment_id ?? null, a: t.asset }); }
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  const snapshots = new Map();
  for (const [k, list] of keys) {
    const t = list[0]; const gk = `${t.session_id}|${t.segment_id ?? "none"}`;
    const all = obsCache.get(gk) ?? [];
    const bucketEnd = Math.floor(Number(t.t0) / 5000) * 5000 + 5000;
    const window = all.filter((o) => o.t < bucketEnd).slice(-120);
    if (window.length < 2) { snapshots.set(k, null); continue; }
    const mine = evalB(buildSeries(window));
    snapshots.set(k, { mine, prices: window, t0: Number(t.t0), asset: t.asset });
  }
  // resultado do meu B nos 8k
  let myBuys = 0, mySells = 0, myWaits = 0, myWins = 0, myLosses = 0, myDraws = 0, skipped = 0;
  const perTrade = [];
  for (const t of trades) {
    const snap = snapshots.get(keyOf(t));
    if (!snap) { skipped += 1; continue; }
    const d = snap.mine.decision;
    if (d === "BUY") myBuys += 1; else if (d === "SELL") mySells += 1; else myWaits += 1;
    let res = null;
    if (d !== "WAIT" && t.settlement_price !== null && t.reference_price !== null) { res = outcome(d, Number(t.reference_price), Number(t.settlement_price)); if (res === "WIN") myWins += 1; else if (res === "LOSS") myLosses += 1; else myDraws += 1; }
    perTrade.push({ trade_id: t.trade_id, asset: t.asset, t0: Number(t.t0), mine: d, res });
  }
  const dirN = myWins + myLosses;
  console.log(`MEU B (v3fib) sobre os eventos dos trades: BUY=${myBuys} SELL=${mySells} WAIT=${myWaits} skipped=${skipped}`);
  console.log(`  resultado (proxy T+60 registrado): W=${myWins} L=${myLosses} D=${myDraws} | WR=${dirN ? ((myWins / dirN) * 100).toFixed(1) : "-"}%`);
  // passada no agente (API) — snapshots únicos, com concorrência
  const uniqueKeys = [...snapshots.keys()].filter((k) => snapshots.get(k));
  console.log(`enviando ${uniqueKeys.length} snapshots ao agente (concorrência ${CONCURRENCY})...`);
  const agentResults = new Map();
  let idx = 0, agree = 0, diverge = 0; const cex = [];
  const worker = async () => {
    while (idx < uniqueKeys.length) {
      const k = uniqueKeys[idx++];
      const snap = snapshots.get(k);
      const bucketEnd = Math.floor(snap.t0 / 5000) * 5000 + 5000;
      const body = { now: bucketEnd, prices: snap.prices.map((p) => ({ value: p.v, timestamp: p.t })), candleId: `candle_${Math.floor(snap.t0 / 5000) * 5000}`, decisionId: "redo8k", sessionId: "redo8k", frames: [], deepContext: null };
      try {
        const r = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json(); const f = j.fast ?? j;
        const agent = f.v3fib?.evaluable ? f.decision : (f.probabilitySource === "V3FIB_FROZEN_v1" ? f.decision : f.decision);
        agentResults.set(k, agent);
        if (agent === snap.mine.decision) agree += 1; else { diverge += 1; if (cex.length < 3) cex.push({ key: k, t0: new Date(snap.t0).toISOString(), mine: snap.mine.decision, agent }); }
      } catch { agentResults.set(k, null); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`AGREEMENT nos snapshots únicos: ${agree}/${agree + diverge} = ${agree + diverge ? ((agree / (agree + diverge)) * 100).toFixed(1) : "-"}%`);
  if (cex.length) console.log("counterexamples: " + JSON.stringify(cex, null, 1));
  require("fs").writeFileSync("C:/tracecom-forward4/redo8k.json", JSON.stringify({ trades: perTrade.length, uniqueSnapshots: uniqueKeys.length, myBuys, mySells, myWaits, myWins, myLosses, myDraws, agree, diverge, cex }, null, 1));
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });