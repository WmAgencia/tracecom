// persist.cjs — persiste o dataset IQ OPTION (10h binary + 10h OTC) nas tabelas iqopt_* do Supabase.
// Fontes: C:\...\Temp\opencode\iqopt (combined_*.json + results.json) | Credencial: D:\tracecom\repo\supabase\.temp\pooler-url
// Bloqueio de segurança: recomputa os finalistas e ABORTA se divergir dos números do results.json aprovado (critic v2 PASS).
const fs = require("fs");
const { Client } = require("pg");
const OUT = __dirname;
const URL_FILE = "D:/tracecom/repo/supabase/.temp/pooler-url";
const pooler = fs.readFileSync(URL_FILE, "utf8").trim();
if (!pooler.startsWith("postgres")) throw new Error("pooler-url invalida");
if (!pooler.includes("cladmauwmuoeqongxzwb")) throw new Error("pooler-url de OUTRO projeto (ref inesperado)");
let connStr = pooler;
if (process.env.IQOPT_DB_PASSWORD) { const u = new URL(pooler); u.password = process.env.IQOPT_DB_PASSWORD; connStr = u.toString(); }
else throw new Error("defina IQOPT_DB_PASSWORD (senha do banco lida do Credential Manager)");
const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
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
  let macdHist = 0; { const e12 = EMA12[i], e26 = EMA26[i]; const sigNow = MACD_SIG[i]; if (e12 !== null && e26 !== null && sigNow !== null) macdHist = ((e12 - e26) - sigNow) / atr14; }
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
async function batchInsert(table, cols, rowsVals, batchSize, c) { let done = 0; for (let i = 0; i < rowsVals.length; i += batchSize) { const chunk = rowsVals.slice(i, i + batchSize); const vals = [], params = []; let q = 1; for (const r of chunk) { const ph = []; for (let k = 0; k < cols.length; k++) { ph.push("$" + q++); params.push(r[k]); } vals.push("(" + ph.join(",") + ")"); } await c.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${vals.join(",")}`, params); done += chunk.length; if (i % (batchSize * 20) === 0) console.log(`  ${table}: ${done}/${rowsVals.length}`); } console.log(`${table}: ${done} inseridos`); }
(async () => {
  const GC = require(OUT + "/gauntlet-compile.cjs");
  const manifest = JSON.parse(fs.readFileSync(OUT + "/finalists-manifest.json", "utf8"));
  const prevResults = JSON.parse(fs.readFileSync(OUT + "/results.json", "utf8"));
  await c.connect();
  console.log("conectado ao Supabase (ref ok).");
  await c.query("DELETE FROM iqopt_decisions WHERE dataset_id = ANY($1)", [[ "IQOPTION_EURUSD_BINARY_10H", "IQOPTION_EURUSD_OTC_10H" ]]);
  await c.query("DELETE FROM iqopt_candles_5s WHERE dataset_id = ANY($1)", [[ "IQOPTION_EURUSD_BINARY_10H", "IQOPTION_EURUSD_OTC_10H" ]]);
  await c.query("DELETE FROM iqopt_raw_ticks WHERE dataset_id = ANY($1)", [[ "IQOPTION_EURUSD_BINARY_10H", "IQOPTION_EURUSD_OTC_10H" ]]);
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", file: "combined_binary_1.json", sub: "binary_1", otc: false, active: 1 }, { id: "IQOPTION_EURUSD_OTC_10H", file: "combined_otc_76.json", sub: "otc_76", otc: true, active: 76 }]) {
    const comb = JSON.parse(fs.readFileSync(OUT + "/" + ds.file, "utf8"));
    const ticks = comb.data;
    const pages = fs.readdirSync(`${OUT}/raw2/${ds.sub}`).length;
    const cd = buildCandles(ticks);
    const rows = buildRows(cd);
    // consistência: comparar finalistas com results.json aprovado
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "IQEXT", indep: 0, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const prevDs = prevResults.datasets.find((d) => d.dataset_id === ds.id);
    for (const e of manifest.finalists) {
      const v = GC.compile(e.spec, ctx); const exp = prevDs.evaluated.find((x) => x.id === e.id);
      let w = 0, l = 0, sig = 0; for (let i = 0; i < v.length; i++) { if (v[i] === 0) continue; sig += 1; if (rows[i].l60 === 1 || rows[i].l60 === -1) { if (v[i] === rows[i].l60) w += 1; else l += 1; } }
      if (sig !== exp.signals || w !== exp.w || l !== exp.l) throw new Error(`CONSISTENCIA FALHOU ${ds.id} ${e.id}: got ${sig}/${w}/${l} expected ${exp.signals}/${exp.w}/${exp.l}`);
      console.log(`  ok ${ds.id} ${e.id} = ${sig} sinais / ${w}W ${l}L (bate com critic-v2)`);
    }
    const prov = JSON.stringify({ classification: "A_IQ_OPTION_OFFICIAL", source_url: "https://api.iqoption.com/v3/quotes", method: "backward pagination", raw_dir: "raw2/" + ds.sub, pages, md5_ts_bid_ask: comb.md5_ts_bid_ask, critic: "independent critic v2 PASS (v1 leakage bug fixed)", fetched_at: prevResults.generated_at });
    await c.query(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ($1,'EUR/USD',$2,$3,'IQ_OPTION','INSERTING',$4,$5,$6::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, provenance=EXCLUDED.provenance`, [ds.id, ds.otc ? "OTC" : "BINARY", ds.otc, new Date(comb.first).toISOString(), new Date(comb.last).toISOString(), prov]);
    const tickVals = ticks.map((t) => { const tsIso = new Date(t.ts).toISOString(); return [ds.id, "IQ_OPTION", "EUR/USD", ds.otc ? "OTC" : "BINARY", ds.otc, tsIso, t.bid, t.ask, t.value, t.value, tsIso, null, JSON.stringify({ source_url: "https://api.iqoption.com/v3/quotes", page_fetch: "raw2/" + ds.sub, phase: t.phase, round: t.round, n: t.n }), JSON.stringify(t)]; });
    await batchInsert("iqopt_raw_ticks", ["dataset_id", "source", "instrument", "contract_type", "otc", "ts", "bid", "ask", "mid", "raw_price", "source_timestamp", "received_at", "provenance", "raw"], tickVals, 600, c);
    const candleVals = cd.map((x, idx) => [ds.id, new Date(x.bucket).toISOString(), x.open, x.high, x.low, x.close, x.n, !!(idx + 1 < cd.length && cd[idx + 1].bucket - x.bucket > 5000), x.close]);
    await batchInsert("iqopt_candles_5s", ["dataset_id", "bucket", "open", "high", "low", "close", "tick_count", "gap", "mid_close"], candleVals, 800, c);
    const stratVecs = [];
    for (const e of [...manifest.finalists, ...manifest.references]) { const v = GC.compile(e.spec, ctx); stratVecs.push({ id: e.id, v }); }
    const decVals = [];
    for (const sv of stratVecs) { for (let i = 0; i < rows.length; i++) { const x = sv.v[i]; if (x === 0) continue; const y = rows[i].l60; const res = y === null ? "UNKNOWN" : y === 0 ? "DRAW" : x === y ? "WIN" : "LOSS"; decVals.push([ds.id, sv.id, rows[i].t0, rows[i].entry, x === 1 ? "BUY" : "SELL", res]); } }
    await batchInsert("iqopt_decisions", ["dataset_id", "strategy_id", "t0_ms", "entry_price", "decision", "result"], decVals, 800, c);
    await c.query(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id=$1`, [ds.id]);
    console.log(`${ds.id}: ticks=${ticks.length} candles=${cd.length} decisions=${decVals.length} OK`);
  }
  const chk = (await c.query("SELECT dataset_id, count(*)::int AS n FROM iqopt_raw_ticks GROUP BY 1 ORDER BY 1")).rows;
  const chk2 = (await c.query("SELECT dataset_id AS d, count(*)::int AS candles FROM iqopt_candles_5s GROUP BY 1 ORDER BY 1")).rows;
  const chk3 = (await c.query("SELECT dataset_id AS d, decision, count(*)::int AS n FROM iqopt_decisions GROUP BY 1,2 ORDER BY 1,2")).rows;
  console.log("VERIFICACAO FINAL:");
  console.log(" tidiimdataset_id|n ", JSON.stringify(chk), JSON.stringify(chk2));
  console.log(" decisoes: ", JSON.stringify(chk3));
  await c.end();
  console.log("PERSISTENCIA COMPLETA");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
