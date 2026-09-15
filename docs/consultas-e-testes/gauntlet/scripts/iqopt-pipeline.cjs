// IQOPT-PIPELINE: IQ Option external validation.
// Usage: node iqopt-pipeline.cjs <dataset_id>
// Reads raw ticks from iqopt_raw_ticks (populated by the authorized collector AFTER authentication),
// rebuilds exact 5s candles, computes the SAME causal features used by the Gauntlet,
// applies FROZEN finalists (no retraining/parameter changes), settles at T+60 and reports.
const fs = require("fs");
const { Client } = require("pg");
const GC = require("./gauntlet-compile.cjs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const BUCKET = 5000, T60 = 60000;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function ema(arr, p) { if (arr.length < p) return null; const a = 2 / (p + 1); let e = mean(arr.slice(0, p)); const out = [e]; for (let i = p; i < arr.length; i++) { e = arr[i] * a + e * (1 - a); out.push(e); } return out; }
function rsiAt(closes, end, p) { if (end - p < 0) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
(async () => {
  const datasetId = process.argv[2];
  if (!datasetId) { console.error("uso: node iqopt-pipeline.cjs <dataset_id>"); process.exit(1); }
  await c.connect();
  const ds = (await c.query("SELECT * FROM iqopt_datasets WHERE dataset_id=$1", [datasetId])).rows[0];
  if (!ds) { console.error("dataset nao encontrado: " + datasetId); process.exit(1); }
  const ticks = (await c.query("SELECT ts, bid, ask, mid, raw_price FROM iqopt_raw_ticks WHERE dataset_id=$1 ORDER BY ts ASC", [datasetId])).rows;
  if (!ticks.length) { console.error("IQOPT_NO_TICKS: dataset sem ticks; aguardando ingestao autorizada."); process.exit(2); }
  const priceOf = (t) => { const v = t.mid ?? (t.bid != null && t.ask != null ? (Number(t.bid) + Number(t.ask)) / 2 : null) ?? t.raw_price; return v == null ? null : Number(v); };
  // 1) candles exatos de 5s (sem interpolacao; gaps apenas marcados)
  const cmap = new Map();
  for (const t of ticks) { const v = priceOf(t); if (v == null) continue; const b = Math.floor(new Date(t.ts).getTime() / BUCKET) * BUCKET; const cc = cmap.get(b); if (!cc) cmap.set(b, { bucket: b, open: v, high: v, low: v, close: v, n: 1 }); else { cc.high = Math.max(cc.high, v); cc.low = Math.min(cc.low, v); cc.close = v; cc.n += 1; } }
  const candles = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
  const gaps = []; for (let i = 1; i < candles.length; i++) if (candles[i].bucket - candles[i - 1].bucket > BUCKET) gaps.push({ from: new Date(candles[i - 1].bucket).toISOString(), to: new Date(candles[i].bucket).toISOString(), missingBuckets: Math.round((candles[i].bucket - candles[i - 1].bucket) / BUCKET) - 1 });
  const dsRow = await c.query("UPDATE iqopt_datasets SET status='READY', window_from=$2, window_to=$3 WHERE dataset_id=$1", [datasetId, new Date(candles[0].bucket).toISOString(), new Date(candles[candles.length - 1].bucket).toISOString()]);
  for (let i = 0; i < candles.length; i++) candles[i].gapNext = i + 1 < candles.length && candles[i + 1].bucket - candles[i].bucket > BUCKET;
  for (let i = 0; i < candles.length; i += 500) { const chunk = candles.slice(i, i + 500); const vals = [], params = [datasetId]; let p = 2; for (const cd of chunk) { vals.push(`($1,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`); params.push(new Date(cd.bucket).toISOString(), cd.open, cd.high, cd.low, cd.close, cd.n, !!(cd.gapNext), null); } await c.query(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${vals.join(",")} ON CONFLICT (dataset_id,bucket) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,tick_count=EXCLUDED.tick_count`, params); }
  console.log(`candles=${candles.length} gaps=${gaps.length} (${JSON.stringify(gaps.slice(0, 5))})`);
  // 2) features causais (mesmas definicoes do gauntlet) + label T+60 por candle alvo
  const M = candles.length;
  if (M < 31) { console.error("IQOPT_INSUFFICIENT_CANDLES: " + M); process.exit(3); }
  const byBucket = new Map(candles.map((x, i) => [x.bucket, i]));
  const rows = []; let lastIndep = -1e18;
  for (let i = 30; i < M; i++) {
    const cd = candles.slice(0, i + 1); const m = cd.length;
    const closes = cd.map((x) => x.close), highs = cd.map((x) => x.high), lows = cd.map((x) => x.low), opens = cd.map((x) => x.open);
    const close = closes[m - 1], open = opens[m - 1], high = highs[m - 1], low = lows[m - 1];
    const ret = (j) => (closes[j] - closes[j - 1]) / closes[j - 1];
    const r1 = ret(m - 1), r6 = (close - closes[m - 7]) / closes[m - 7], r24 = (close - closes[m - 25]) / closes[m - 25];
    const rsi14 = rsiAt(closes, m - 1, 14), s = (55 - rsi14) / 45;
    const rs12 = []; for (let j = m - 12; j < m; j++) rs12.push(ret(j)); const vol12 = sd(rs12);
    const atr14 = mean(cd.slice(m - 14).map((x) => x.high - x.low));
    const sma20 = mean(closes.slice(-20));
    const e12 = ema(closes, 12), e26 = ema(closes, 26); let macdHist = null;
    if (e12 && e26) { const n = Math.min(e12.length, e26.length); const mo = []; for (let k = 0; k < n; k++) mo.push(e12[e12.length - n + k] - e26[e26.length - n + k]); const sg = mo.length >= 9 ? ema(mo, 9) : null; if (sg) macdHist = (mo[mo.length - 1] - sg[sg.length - 1]) / atr14; }
    const kAt = (j) => { const w = cd.slice(j - 13, j + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? 50 : ((cd[j].close - ll) / (hh - ll)) * 100; };
    const stochK = kAt(m - 1);
    const sd20 = sd(closes.slice(-20)); const bbUp = sma20 + 2 * sd20, bbLo = sma20 - 2 * sd20; const bbB = bbUp !== bbLo ? (close - bbLo) / (bbUp - bbLo) : 0.5;
    const range = high - low;
    let streak = 0; { const dir = Math.sign(close - open); if (dir !== 0) { streak = 1; for (let j = m - 2; j >= 1; j--) { if (Math.sign(cd[j].close - cd[j].open) === dir) streak += 1; else break; } if (dir < 0) streak = -streak; } }
    const range4 = mean(cd.slice(-4).map((x) => x.high - x.low)), range20 = mean(cd.slice(-20).map((x) => x.high - x.low)); const expansion = range20 > 0 ? range4 / range20 : 1;
    const hh24 = Math.max(...highs.slice(-25, -1)), ll24 = Math.min(...lows.slice(-25, -1));
    const pivH = [], pivL = [];
    for (let j = 2; j < m - 2; j++) { if (highs[j] > highs[j - 1] && highs[j] > highs[j + 1] && highs[j] > highs[j - 2] && highs[j] > highs[j + 2]) pivH.push(j); if (lows[j] < lows[j - 1] && lows[j] < lows[j + 1] && lows[j] < lows[j - 2] && lows[j] < lows[j + 2]) pivL.push(j); }
    const lp = pivH.filter((j) => j >= m - 48), lpl = pivL.filter((j) => j >= m - 48);
    const ph = lp.length ? highs[lp[lp.length - 1]] : null, pl = lpl.length ? lows[lpl[lpl.length - 1]] : null;
    const distPH = ph !== null ? (ph - close) / atr14 : NaN, distPL = pl !== null ? (close - pl) / atr14 : NaN;
    let structureUp = 0, structureDown = 0;
    if (lp.length >= 2 && lpl.length >= 2) { const h2 = highs[lp[lp.length - 1]], h1 = highs[lp[lp.length - 2]], l2 = lows[lpl[lpl.length - 1]], l1 = lows[lpl[lpl.length - 2]]; if (h2 > h1 && l2 > l1) structureUp = 1; else if (h2 < h1 && l2 < l1) structureDown = 1; }
    const w24 = cd.slice(m - 24); const fhi = Math.max(...w24.map((x) => x.high)), flo = Math.min(...w24.map((x) => x.low));
    let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === fhi && fh === -1) fh = j; if (w24[j].low === flo && fl === -1) fl = j; }
    const frange = fhi - flo, upSwing = fl <= fh; const inZone = frange > 0 && close <= Math.max(fhi - frange * .382, fhi - frange * .618) && close >= Math.min(fhi - frange * .382, fhi - frange * .618);
    const pos = frange > 0 ? (close - flo) / frange : 0.5;
    let er30 = null; { let net = 0, sum = 0; for (let j = m - 30; j < m; j++) { const d = closes[j] - closes[j - 1]; net += d; sum += Math.abs(d); } er30 = sum > 0 ? Math.abs(net) / sum : null; }
    const d0 = new Date(cd[m - 1].bucket + BUCKET);
    const entry = close, t0 = cd[m - 1].bucket + BUCKET;
    const settleIdx = byBucket.get(cd[m - 1].bucket + T60);
    let l60 = 0, result60 = "UNKNOWN";
    if (settleIdx !== undefined) { const settle = candles[settleIdx].close; l60 = settle === entry ? 0 : settle > entry ? 1 : -1; }
    if (t0 - lastIndep >= 90000) { lastIndep = t0; }
    rows.push({ indep: 0, entry, asset: ds.instrument + (ds.otc ? "/OTC" : ""), t0, l60: settleIdx !== undefined ? l60 : null, f: { r1, r6, r24, s, vol12, distSma20: (close - sma20) / atr14, macdHist, stochK, bbB, streak, bodyRatio: range > 0 ? Math.abs(close - open) / range : 0, upperWick: range > 0 ? (high - Math.max(close, open)) / range : 0, lowerWick: range > 0 ? (Math.min(close, open) - low) / range : 0, expansion, distPH, distPL, pos, hour: d0.getUTCHours(), sessMinute: Math.round((cd[m - 1].bucket - candles[0].bucket) / 60000), boUp: close > hh24 ? 1 : 0, boDown: close < ll24 ? 1 : 0, falseBoUp: 0, falseBoDown: 0, structureUp, structureDown, inZone: inZone ? 1 : 0, upSwing: upSwing ? 1 : 0, beyondExt: 0, bullDiv: 0, bearDiv: 0, bigCandle: range > 2 * atr14 ? 1 : 0, doji: range > 0 && Math.abs(close - open) / range < 0.15 ? 1 : 0 } });
  }
  // fix indep flag (greedy cumulativo correto)
  { let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; } }
  const ctx = GC.loadCtx(rows);
  const manifest = JSON.parse(fs.readFileSync("C:/tracecom-forward4/finalists-manifest.json", "utf8"));
  const prev = JSON.parse(fs.readFileSync("C:/tracecom-forward4/blind-holdout-results.json", "utf8"));
  const prevById = new Map(prev.finalists.map((f) => [f.id, f]));
  const out = { dataset_id: datasetId, instrument: ds.instrument, otc: ds.otc, candles: M, features_rows: rows.length, gaps, generated_at: new Date().toISOString(), results: [] };
  console.log("=== IQ OPTION EXTERNAL VALIDATION — " + ds.instrument + (ds.otc ? " OTC" : "") + " ===");
  console.log("Strategy | Opps | Signals | WAIT | Cov | W | L | D | UNK | WR | BUY sig/W/L/WR | SELL sig/W/L/WR | Indep N/Acc");
  for (const e of [...manifest.finalists, ...manifest.references]) {
    let v; try { v = GC.compile(e.spec, ctx); } catch (err) { console.log(e.id + " COMPILE_ERR " + err.message); continue; }
    let sig = 0, w = 0, l = 0, dd = 0, unk = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, isig = 0;
    const decisionRows = [];
    for (let i = 0; i < ctx.N; i++) { const x = v[i]; const r = rows[i]; const dec = x === 1 ? "BUY" : x === -1 ? "SELL" : "WAIT"; let res = "WAIT";
      if (x !== 0) { sig += 1; if (r.l60 === null) { unk += 1; res = "UNKNOWN"; } else if (r.l60 === 0) { dd += 1; res = "DRAW"; } else if ((x === 1 && r.l60 === 1) || (x === -1 && r.l60 === -1)) { w += 1; res = "WIN"; } else { l += 1; res = "LOSS"; } if (x === 1) { if (r.l60 === 1) bw += 1; else if (r.l60 === -1) bl += 1; } if (x === -1) { if (r.l60 === -1) sw += 1; else if (r.l60 === 1) sl += 1; } if (r.indep) { if (res === "WIN") iw += 1; if (res === "LOSS") il += 1; if (res === "WIN" || res === "LOSS") isig += 1; } }
      decisionRows.push({ x, i, dec, res });
    }
    const n = w + l, wr = n ? (w / n * 100).toFixed(1) : "-", cov = (sig / ctx.N * 100).toFixed(1);
    const bn = bw + bl, sn = sw + sl;
    console.log(`${e.id} | ${ctx.N} | ${sig} | ${ctx.N - sig} | ${cov}% | ${w} | ${l} | ${dd} | ${unk} | ${wr}% | ${bn}/${bw}/${bl}/${bn ? (bw / bn * 100).toFixed(1) : "-"}% | ${sn}/${sw}/${sl}/${sn ? (sw / sn * 100).toFixed(1) : "-"}% | ${isig}/${isig ? (iw / isig * 100).toFixed(1) : "-"}%`);
    const p = prevById.get(e.id);
    out.results.push({ id: e.id, opportunities: ctx.N, signals: sig, wait: ctx.N - sig, coverage: cov + "%", w, l, draws: dd, unknown: unk, wr: wr + "%", buy: { n: bn, w: bw, l: bl, wr: bn ? (bw / bn * 100).toFixed(1) + "%" : null }, sell: { n: sn, w: sw, l: sl, wr: sn ? (sw / sn * 100).toFixed(1) + "%" : null }, indep: { n: isig, w: iw, l: il, acc: isig ? (iw / isig * 100).toFixed(1) + "%" : null }, previous: p ? { wr: p.acc, n: p.n, holdout: true } : null });
    for (let b = 0; b < decisionRows.length; b += 500) { const chunk = decisionRows.slice(b, b + 500); const vals = [], params = []; let q = 1; for (const dr of chunk) { vals.push(`($${q++},$${q++},$${q++},$${q++},$${q++},$${q++})`); params.push(datasetId, e.id, rows[dr.i].t0, rows[dr.i].entry, dr.dec, dr.res); } await c.query(`INSERT INTO iqopt_decisions (dataset_id,strategy_id,t0_ms,entry_price,decision,result) VALUES ${vals.join(",")}`, params); }
  }
  fs.writeFileSync(`C:/tracecom-forward4/iqopt-results-${datasetId}.json`, JSON.stringify(out, null, 1));
  console.log("resultados salvos em iqopt-results-" + datasetId + ".json");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
