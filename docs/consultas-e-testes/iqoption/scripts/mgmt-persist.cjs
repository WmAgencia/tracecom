// mgmt-persist.cjs — persiste IQ OPTION 10h (binary+OTC) nas iqopt_* via Supabase Management API (access token sbp_ do Credential Manager).
// Mesma preparação/checagem de consistência do persist.cjs (aborta se divergir do results.json aprovado pelo critic v2).
const fs = require("fs");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("SUPABASE_ACCESS_TOKEN ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function rsiAt(c2, end, p) { if (end - p < 0) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = c2[i] - c2[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function emaSeries(arr, p) { const out = new Array(arr.length).fill(null); if (arr.length < p) return out; const a = 2 / (p + 1); let e = mean(arr.slice(0, p)); out[p - 1] = e; for (let i = p; i < arr.length; i++) { e = arr[i] * a + e * (1 - a); out[i] = e; } return out; }
function buildCandles(ticks) { const m = new Map(); for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const cc = m.get(b); if (!cc) m.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { cc.high = Math.max(cc.high, p); cc.low = Math.min(cc.low, p); cc.close = p; cc.n += 1; } } return [...m.values()].sort((a, b) => a.bucket - b.bucket); }
let EMA12 = [], EMA26 = [], MACD_SIG = [];
function precomputeEma(cd) { const closes = cd.map((x) => x.close); EMA12 = emaSeries(closes, 12); EMA26 = emaSeries(closes, 26); const macd = closes.map((_, i) => (EMA12[i] !== null && EMA26[i] !== null ? EMA12[i] - EMA26[i] : null)); MACD_SIG = new Array(closes.length).fill(null); const idx = [], vals = []; for (let i = 0; i < macd.length; i++) if (macd[i] !== null) { idx.push(i); vals.push(macd[i]); } const sig = emaSeries(vals, 9); for (let j = 0; j < idx.length; j++) MACD_SIG[idx[j]] = sig[j]; }
function featuresAt(cd, i) {
  if (i < 30) return null;
  const closes = cd.map((x) => x.close), highs = cd.map((x) => x.high), lows = cd.map((x) => x.low);
  const close = closes[i], open = cd[i].open, high = highs[i], low = lows[i];
  const atr14 = mean(cd.slice(i - 13, i + 1).map((x) => x.high - x.low));
  const ret1 = (j) => (closes[j] - closes[j - 1]) / closes[j - 1];
  const r1 = ret1(i), r6 = (close - closes[i - 6]) / closes[i - 6], r24 = (close - closes[i - 24]) / closes[i - 24];
  const rsi14 = rsiAt(closes, i, 14), s = (55 - rsi14) / 45;
  const rs12 = []; for (let j = i - 11; j <= i; j++) rs12.push(ret1(j)); const vol12 = sd(rs12);
  const sma20 = mean(closes.slice(i - 19, i + 1));
  let macdHist = 0; { const e12 = EMA12[i], e26 = EMA26[i], sigNow = MACD_SIG[i]; if (e12 !== null && e26 !== null && sigNow !== null) macdHist = ((e12 - e26) - sigNow) / atr14; }
  const kAt = (j) => { let hh = -Infinity, ll = Infinity; for (let x = j - 13; x <= j; x++) { if (highs[x] > hh) hh = highs[x]; if (lows[x] < ll) ll = lows[x]; } return hh === ll ? 50 : ((cd[j].close - ll) / (hh - ll)) * 100; };
  const stochK = kAt(i);
  const sd20 = sd(closes.slice(i - 19, i + 1)); const bbUp = sma20 + 2 * sd20, bbLo = sma20 - 2 * sd20; const bbB = bbUp !== bbLo ? (close - bbLo) / (bbUp - bbLo) : 0.5;
  const range = high - low;
  let streak = 0; { const dir = Math.sign(close - open); if (dir !== 0) { streak = 1; for (let j = i - 1; j >= 0; j--) { if (Math.sign(cd[j].close - cd[j].open) === dir) streak += 1; else break; } if (dir < 0) streak = -streak; } }
  const range4 = mean(cd.slice(i - 3, i + 1).map((x) => x.high - x.low)), range20 = mean(cd.slice(i - 19, i + 1).map((x) => x.high - x.low)); const expansion = range20 > 0 ? range4 / range20 : 1;
  let hh24 = -Infinity, ll24 = Infinity; for (let j = i - 24; j < i; j++) { if (highs[j] > hh24) hh24 = highs[j]; if (lows[j] < ll24) ll24 = lows[j]; }
  let falseBoUp = 0, falseBoDown = 0; for (let j = Math.max(1, i - 3); j <= i; j++) { let ph = -Infinity, pl = Infinity; for (let x = Math.max(0, j - 13); x < j; x++) { if (highs[x] > ph) ph = highs[x]; if (lows[x] < pl) pl = lows[x]; } if (cd[j].high > ph && cd[j].close < ph) falseBoUp += 1; if (cd[j].low < pl && cd[j].close > pl) falseBoDown += 1; }
  const pivH = [], pivL = [];
  for (let j = 2; j <= i - 2; j++) { if (highs[j] > highs[j - 1] && highs[j] > highs[j + 1] && highs[j] > highs[j - 2] && highs[j] > highs[j + 2]) pivH.push(j); if (lows[j] < lows[j - 1] && lows[j] < lows[j + 1] && lows[j] < lows[j - 2] && lows[j] < lows[j + 2]) pivL.push(j); }
  const lp = pivH.filter((j) => j >= i - 47), lpl = pivL.filter((j) => j >= i - 47);
  const phv = lp.length ? highs[lp[lp.length - 1]] : null, plv = lpl.length ? lows[lpl[lpl.length - 1]] : null;
  const distPH = phv !== null ? (phv - close) / atr14 : NaN, distPL = plv !== null ? (close - plv) / atr14 : NaN;
  let structureUp = 0, structureDown = 0;
  if (lp.length >= 2 && lpl.length >= 2) { const h2 = highs[lp[lp.length - 1]], h1 = highs[lp[lp.length - 2]], l2 = lows[lpl[lpl.length - 1]], l1 = lows[lpl[lpl.length - 2]]; if (h2 > h1 && l2 > l1) structureUp = 1; else if (h2 < h1 && l2 < l1) structureDown = 1; }
  const w24 = cd.slice(i - 23, i + 1); let fhi = -Infinity, flo = Infinity; for (const x of w24) { if (x.high > fhi) fhi = x.high; if (x.low < flo) flo = x.low; }
  let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === fhi && fh === -1) fh = j; if (w24[j].low === flo && fl === -1) fl = j; }
  const frange = fhi - flo, upSwing = fl <= fh; const inZone = frange > 0 && close <= Math.max(fhi - frange * .382, fhi - frange * .618) && close >= Math.min(fhi - frange * .382, fhi - frange * .618);
  const pos = frange > 0 ? (close - flo) / frange : 0.5;
  const beyondExt = frange > 0 ? (upSwing ? close > fhi + frange * 0.272 : close < flo - frange * 0.272) : false;
  let er30 = null; { let net = 0, sum = 0; for (let j = i - 29; j <= i; j++) { const d = closes[j] - closes[j - 1]; net += d; sum += Math.abs(d); } er30 = sum > 0 ? Math.abs(net) / sum : null; }
  const rsi6 = rsiAt(closes, i - 6, 14);
  const bullDiv = rsi6 !== null && closes[i] < closes[i - 6] && rsi14 > rsi6;
  const bearDiv = rsi6 !== null && closes[i] > closes[i - 6] && rsi14 < rsi6;
  const h = new Date(cd[i].bucket + 5000).getUTCHours();
  return { r1, r6, r24, s, vol12, distSma20: (close - sma20) / atr14, macdHist, stochK, bbB, streak, bodyRatio: range > 0 ? Math.abs(close - open) / range : 0, upperWick: range > 0 ? (high - Math.max(close, open)) / range : 0, lowerWick: range > 0 ? (Math.min(close, open) - low) / range : 0, expansion, distPH, distPL, pos, hour: h, sessMinute: Math.round((cd[i].bucket - cd[0].bucket) / 60000), boUp: close > hh24 ? 1 : 0, boDown: close < ll24 ? 1 : 0, falseBoUp, falseBoDown, structureUp, structureDown, inZone: inZone ? 1 : 0, upSwing: upSwing ? 1 : 0, beyondExt: beyondExt ? 1 : 0, bullDiv: bullDiv ? 1 : 0, bearDiv: bearDiv ? 1 : 0, bigCandle: range > 2 * atr14 ? 1 : 0, doji: range > 0 && Math.abs(close - open) / range < 0.15 ? 1 : 0 };
}
function buildRows(cd) { precomputeEma(cd); const byBucket = new Map(cd.map((x, idx) => [x.bucket, idx])); const rows = []; for (let i = 30; i < cd.length; i++) { const f = featuresAt(cd, i); if (!f) continue; const entry = cd[i].close, t0 = cd[i].bucket + 5000; const si = byBucket.get(cd[i].bucket + 60000); let l60 = null; if (si !== undefined) { const ex = cd[si].close; l60 = ex === entry ? 0 : ex > entry ? 1 : -1; } rows.push({ t0, entry, f, l60 }); } return rows; }
const q1 = (v) => { if (v === null || v === undefined) return "NULL"; if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL"; return "'" + String(v).replace(/'/g, "''") + "'"; };
async function sql(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    if (r.ok) return await r.json();
    const body = await r.text();
    if (attempt === 2) throw new Error("SQL fail HTTP " + r.status + ": " + body.slice(0, 300));
    await new Promise((res) => setTimeout(res, 1500));
  }
}
async function insertRows(table, cols, tuples, batch, label) {
  let done = 0;
  for (let i = 0; i < tuples.length; i += batch) {
    const chunk = tuples.slice(i, i + batch);
    const vals = chunk.map((t) => "(" + t.map(q1).join(",") + ")").join(",");
    await sql(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${vals};`);
    done += chunk.length;
    console.log(`  ${label ?? table}: ${done}/${tuples.length}`);
    await new Promise((res) => setTimeout(res, 150));
  }
}
(async () => {
  const r0 = await fetch(`https://api.supabase.com/v1/projects/${REF}`, { headers: { Authorization: "Bearer " + TOK } });
  if (!r0.ok) throw new Error("token invalido");
  console.log("token ok, projeto:", (await r0.json()).name);
  const GC = require(OUT + "/gauntlet-compile.cjs");
  const manifest = JSON.parse(fs.readFileSync(OUT + "/finalists-manifest.json", "utf8"));
  const prevResults = JSON.parse(fs.readFileSync(OUT + "/results.json", "utf8"));
  await sql(`CREATE TABLE IF NOT EXISTS iqopt_datasets (dataset_id text PRIMARY KEY, instrument text NOT NULL, contract_type text NOT NULL, otc boolean NOT NULL DEFAULT false, source text NOT NULL DEFAULT 'IQ_OPTION', status text NOT NULL DEFAULT 'COLLECTING', window_from timestamptz, window_to timestamptz, provenance jsonb, created_at timestamptz DEFAULT now());`);
  await sql(`CREATE TABLE IF NOT EXISTS iqopt_raw_ticks (id bigserial PRIMARY KEY, dataset_id text NOT NULL, source text NOT NULL DEFAULT 'IQ_OPTION', instrument text NOT NULL, contract_type text NOT NULL, otc boolean NOT NULL, ts timestamptz NOT NULL, bid double precision, ask double precision, mid double precision, raw_price double precision, source_timestamp timestamptz, received_at timestamptz, ingested_at timestamptz DEFAULT now(), provenance jsonb, raw jsonb);`);
  await sql(`CREATE TABLE IF NOT EXISTS iqopt_candles_5s (dataset_id text NOT NULL, bucket timestamptz NOT NULL, open double precision, high double precision, low double precision, close double precision, tick_count int NOT NULL, gap boolean NOT NULL DEFAULT false, mid_close double precision, PRIMARY KEY (dataset_id, bucket));`);
  await sql(`CREATE TABLE IF NOT EXISTS iqopt_decisions (id bigserial PRIMARY KEY, dataset_id text NOT NULL, strategy_id text NOT NULL, t0_ms bigint NOT NULL, entry_price double precision, decision text NOT NULL, result text, buy_side text, sell_side text, features_snapshot jsonb, created_at timestamptz DEFAULT now());`);
  await sql(`DELETE FROM iqopt_decisions WHERE dataset_id IN ('IQOPTION_EURUSD_BINARY_10H','IQOPTION_EURUSD_OTC_10H');`);
  await sql(`DELETE FROM iqopt_candles_5s WHERE dataset_id IN ('IQOPTION_EURUSD_BINARY_10H','IQOPTION_EURUSD_OTC_10H');`);
  await sql(`DELETE FROM iqopt_raw_ticks WHERE dataset_id IN ('IQOPTION_EURUSD_BINARY_10H','IQOPTION_EURUSD_OTC_10H');`);
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", file: "combined_binary_1.json", sub: "binary_1", otc: false }, { id: "IQOPTION_EURUSD_OTC_10H", file: "combined_otc_76.json", sub: "otc_76", otc: true }]) {
    const comb = JSON.parse(fs.readFileSync(OUT + "/" + ds.file, "utf8"));
    const ticks = comb.data;
    const pages = fs.readdirSync(`${OUT}/raw2/${ds.sub}`).length;
    const cd = buildCandles(ticks);
    const rows = buildRows(cd);
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "IQEXT", indep: 0, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const prevDs = prevResults.datasets.find((d) => d.dataset_id === ds.id);
    for (const e of manifest.finalists) {
      const v = GC.compile(e.spec, ctx); const exp = prevDs.evaluated.find((x) => x.id === e.id);
      let w = 0, l = 0, sig = 0; for (let i = 0; i < v.length; i++) { if (v[i] === 0) continue; sig += 1; if (rows[i].l60 === 1 || rows[i].l60 === -1) { if (v[i] === rows[i].l60) w += 1; else l += 1; } }
      if (sig !== exp.signals || w !== exp.w || l !== exp.l) throw new Error(`CONSISTENCIA FALHOU ${ds.id} ${e.id}`);
      console.log(`  ok ${ds.id} ${e.id} = ${sig}/${w}W ${l}L`);
    }
    const prov = JSON.stringify({ classification: "A_IQ_OPTION_OFFICIAL", source_url: "https://api.iqoption.com/v3/quotes", method: "backward pagination", raw_dir: "raw2/" + ds.sub, pages, md5_ts_bid_ask: comb.md5_ts_bid_ask, critic: "independent critic v2 PASS (v1 leakage bug fixed)", fetched_at: prevResults.generated_at });
    await sql(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('${ds.id}','EUR/USD','${ds.otc ? "OTC" : "BINARY"}',${ds.otc ? "true" : "false"},'IQ_OPTION','INSERTING','${new Date(comb.first).toISOString()}','${new Date(comb.last).toISOString()}','${prov.replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, provenance=EXCLUDED.provenance;`);
    const tickT = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); const ptick = JSON.stringify({ source_url: "https://api.iqoption.com/v3/quotes", page_fetch: "raw2/" + ds.sub, phase: t.phase, round: t.round, n: t.n }); return [ds.id, "IQ_OPTION", "EUR/USD", ds.otc ? "OTC" : "BINARY", ds.otc, iso, t.bid, t.ask, t.value, t.value, iso, null, ptick, JSON.stringify(t)]; });
    await insertRows("iqopt_raw_ticks", ["dataset_id", "source", "instrument", "contract_type", "otc", "ts", "bid", "ask", "mid", "raw_price", "source_timestamp", "received_at", "provenance", "raw"], tickT, 3000, "ticks " + ds.sub);
    const candT = cd.map((x, idx) => [ds.id, new Date(x.bucket).toISOString(), x.open, x.high, x.low, x.close, x.n, !!(idx + 1 < cd.length && cd[idx + 1].bucket - x.bucket > 5000), x.close]);
    await insertRows("iqopt_candles_5s", ["dataset_id", "bucket", "open", "high", "low", "close", "tick_count", "gap", "mid_close"], candT, 5000, "candles " + ds.sub);
    const stratVecs = [];
    for (const e of [...manifest.finalists, ...manifest.references]) { const v = GC.compile(e.spec, ctx); stratVecs.push({ id: e.id, v }); }
    const decT = [];
    for (const sv of stratVecs) { for (let i = 0; i < rows.length; i++) { const x = sv.v[i]; if (x === 0) continue; const y = rows[i].l60; const res = y === null ? "UNKNOWN" : y === 0 ? "DRAW" : x === y ? "WIN" : "LOSS"; decT.push([ds.id, sv.id, rows[i].t0, rows[i].entry, x === 1 ? "BUY" : "SELL", res]); } }
    await insertRows("iqopt_decisions", ["dataset_id", "strategy_id", "t0_ms", "entry_price", "decision", "result"], decT, 5000, "decisions " + ds.sub);
    await sql(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='${ds.id}';`);
    console.log(`${ds.id}: ticks=${ticks.length} candles=${cd.length} decisions=${decT.length} READY`);
  }
  const v1 = await sql(`SELECT dataset_id, count(*)::int AS n FROM iqopt_raw_ticks GROUP BY 1 ORDER BY 1;`);
  const v2 = await sql(`SELECT dataset_id, count(*)::int AS n FROM iqopt_candles_5s GROUP BY 1 ORDER BY 1;`);
  const v3 = await sql(`SELECT dataset_id, count(*)::int AS n FROM iqopt_decisions GROUP BY 1 ORDER BY 1;`);
  console.log("VERIFICACAO FINAL");
  console.log(" ticks:", JSON.stringify(v1));
  console.log(" candles:", JSON.stringify(v2));
  console.log(" decisions:", JSON.stringify(v3));
  console.log("PERSISTENCIA COMPLETA");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
