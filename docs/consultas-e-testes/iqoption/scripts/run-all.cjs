// run-all.cjs v2 — FIXED causal feature computation (critic caught future-anchored slices in v1).
// Strictly causal: every feature at index i uses ONLY candles[0..i]. EMA via single causal pass.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const GH = "https://raw.githubusercontent.com/WmAgencia/tracecom/main/docs/consultas-e-testes/gauntlet";
async function get(url) { const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } }); if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return r; }
async function quotes(active_id, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const url = `https://api.iqoption.com/v3/quotes?active_id=${active_id}&from=${from}&to=${to}&only_round=false&_key=${key}`; const r = await get(url); return { url, json: await r.json() }; }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function rsiAt(c, end, p) { if (end - p < 0) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
async function fetch10h(active_id, subdir, FROM0, TO0) {
  fs.mkdirSync(`${OUT}/raw2/${subdir}`, { recursive: true });
  let to = TO0, page = 0, byN = new Map();
  while (page < 120) {
    const { url, json } = await quotes(active_id, FROM0, to);
    const q = (json.quotes || []).sort((a, b) => a.ts - b.ts);
    if (!q.length) break;
    fs.writeFileSync(`${OUT}/raw2/${subdir}/page_${String(page).padStart(3, "0")}.json`, JSON.stringify({ source_url: url, active_id, requested_from: FROM0, requested_to: to, fetched_at: new Date().toISOString(), count: q.length, payload: json }, null, 1));
    for (const x of q) byN.set(x.n, x);
    if (q[0].ts <= FROM0 + 1000) break;
    to = q[0].ts - 1; page += 1;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { arr: [...byN.values()].sort((a, b) => a.ts - b.ts), pages: page + 1 };
}
function buildCandles(ticks) { const m = new Map(); for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = m.get(b); if (!c) m.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } } return [...m.values()].sort((a, b) => a.bucket - b.bucket); }
// causal EMA arrays aligned to closes index (undefined before p-1)
function emaSeries(arr, p) { const out = new Array(arr.length).fill(null); if (arr.length < p) return out; const a = 2 / (p + 1); let e = mean(arr.slice(0, p)); out[p - 1] = e; for (let i = p; i < arr.length; i++) { e = arr[i] * a + e * (1 - a); out[i] = e; } return out; }
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
  let macdHist = 0; { const e12 = EMA12[i], e26 = EMA26[i]; if (e12 !== null && e26 !== null && i >= 33) { const mo = i >= 33 ? (EMA12[i] - EMA26[i]) : null; const macdNow = e12 - e26; const sigNow = MACD_SIG[i]; if (sigNow !== null) macdHist = (macdNow - sigNow) / atr14; } }
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
let EMA12 = [], EMA26 = [], MACD_SIG = [];
function precomputeEma(cd) { const closes = cd.map((x) => x.close); EMA12 = emaSeries(closes, 12); EMA26 = emaSeries(closes, 26); const macd = closes.map((_, i) => (EMA12[i] !== null && EMA26[i] !== null ? EMA12[i] - EMA26[i] : null)); MACD_SIG = new Array(closes.length).fill(null); const idx = []; const vals = []; for (let i = 0; i < macd.length; i++) if (macd[i] !== null) { idx.push(i); vals.push(macd[i]); } const sig = emaSeries(vals, 9); for (let j = 0; j < idx.length; j++) MACD_SIG[idx[j]] = sig[j]; }
function buildRows(cd) {
  precomputeEma(cd);
  const byBucket = new Map(cd.map((c, idx) => [c.bucket, idx]));
  const rows = [];
  for (let i = 30; i < cd.length; i++) {
    const f = featuresAt(cd, i);
    if (!f) continue;
    const entry = cd[i].close, t0 = cd[i].bucket + 5000;
    const si = byBucket.get(cd[i].bucket + 60000);
    let l60 = null; if (si !== undefined) { const ex = cd[si].close; l60 = ex === entry ? 0 : ex > entry ? 1 : -1; }
    rows.push({ t0, entry, f, l60 });
  }
  let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
  return rows;
}
function statsOf(v, rows) { let sig = 0, w = 0, l = 0, d = 0, unk = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, isig = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; sig += 1; const y = rows[i].l60;
    if (y === null) { unk += 1; continue; } if (y === 0) { d += 1; continue; } const win = x === y; if (win) w += 1; else l += 1;
    if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; }
    if (rows[i].indep) { if (win) iw += 1; else il += 1; isig += 1; } }
  const n = w + l; return { sig, w, l, draws: d, unk, n, wr: n ? w / n : null, cov: sig / v.length, buy: { n: bw + bl, wr: (bw + bl) ? bw / (bw + bl) : null }, sell: { n: sw + sl, wr: (sw + sl) ? sw / (sw + sl) : null }, indep: { n: isig, wr: isig ? iw / isig : null } };
}
(async () => {
  fs.writeFileSync(OUT + "/gauntlet-compile.cjs", Buffer.from(await (await get(GH + "/scripts/gauntlet-compile.cjs")).arrayBuffer()));
  const manifest = JSON.parse(await (await get(GH + "/finalists-manifest.json")).text());
  const GC = require(OUT + "/gauntlet-compile.cjs");
  const now = Date.now();
  const TO0 = now - 35 * 60 * 1000, FROM0 = TO0 - 10 * 3600000;
  console.log(`window ${new Date(FROM0).toISOString()} -> ${new Date(TO0).toISOString()} | frozen hash=${manifest.hash}`);
  const results = { generated_at: new Date().toISOString(), source: "IQ_OPTION", source_url: "https://api.iqoption.com/v3/quotes", provenance: "A_IQ_OPTION_OFFICIAL", frozen_hash: manifest.hash, leakage_fix: "v2 estríctamente causal (crítico v1 detectou slices ancorados no fim do array; corrigido)", window: { from: new Date(FROM0).toISOString(), to: new Date(TO0).toISOString() }, datasets: [] };
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", active: 1, otc: false, sub: "binary_1" }, { id: "IQOPTION_EURUSD_OTC_10H", active: 76, otc: true, sub: "otc_76" }]) {
    const { arr, pages } = await fetch10h(ds.active, ds.sub, FROM0, TO0);
    const md5 = crypto.createHash("md5").update(JSON.stringify(arr.map((q) => [q.ts, q.bid, q.ask]))).digest("hex");
    fs.writeFileSync(`${OUT}/combined_${ds.sub}.json`, JSON.stringify({ dataset_id: ds.id, active_id: ds.active, otc: ds.otc, ticks: arr.length, first: arr[0].ts, last: arr[arr.length - 1].ts, md5_ts_bid_ask: md5, data: arr }));
    const candles = buildCandles(arr);
    const gaps = []; for (let i = 1; i < candles.length; i++) if (candles[i].bucket - candles[i - 1].bucket > 5000) gaps.push({ from: new Date(candles[i - 1].bucket).toISOString(), to: new Date(candles[i].bucket).toISOString() });
    const rows = buildRows(candles);
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "IQEXT", indep: r.indep, asset: ds.otc ? "EUR/USD/OTC" : "EUR/USD", t0: r.t0, l60: r.l60, f: r.f })));
    console.log(`\n===== ${ds.id} ===== ticks=${arr.length} candles5s=${candles.length} gaps>5s=${gaps.length} rows=${rows.length} indep=${rows.filter((r) => r.indep).length} md5=${md5}`);
    const dsRes = { dataset_id: ds.id, active_id: ds.active, otc: ds.otc, ticks: arr.length, pages, first_ts: new Date(arr[0].ts).toISOString(), last_ts: new Date(arr[arr.length - 1].ts).toISOString(), md5_ts_bid_ask: md5, candles_5s: candles.length, gaps, rows: rows.length, independent_windows: rows.filter((r) => r.indep).length, evaluated: [] };
    console.log("Strategy | Signals | WAIT | Cov | W | L | D | UNK | WR | BUY n/WR | SELL n/WR | Indep n/WR");
    for (const e of [...manifest.finalists, ...manifest.references]) {
      let v; try { v = GC.compile(e.spec, ctx); } catch (err) { console.log(e.id + " COMPILE_ERR " + err.message); continue; }
      const st = statsOf(v, rows);
      const fmtP = (x) => x === null ? "-" : (x * 100).toFixed(1);
      console.log(`${e.id} | ${st.sig} | ${ctx.N - st.sig} | ${(st.cov * 100).toFixed(1)}% | ${st.w} | ${st.l} | ${st.draws} | ${st.unk} | ${fmtP(st.wr)}% | ${st.buy.n}/${fmtP(st.buy.wr)}% | ${st.sell.n}/${fmtP(st.sell.wr)}% | ${st.indep.n}/${fmtP(st.indep.wr)}%`);
      const prev = manifest.finalists.find((f) => f.id === e.id);
      dsRes.evaluated.push({ id: e.id, family: prev ? "finalist" : "reference", spec: e.spec, signals: st.sig, wait: ctx.N - st.sig, coverage: +(st.cov * 100).toFixed(2), w: st.w, l: st.l, draws: st.draws, unknown: st.unk, wr: st.wr === null ? null : +(st.wr * 100).toFixed(2), buy: { n: st.buy.n, wr: st.buy.wr === null ? null : +(st.buy.wr * 100).toFixed(2) }, sell: { n: st.sell.n, wr: st.sell.wr === null ? null : +(st.sell.wr * 100).toFixed(2) }, indep: { n: st.indep.n, wr: st.indep.wr === null ? null : +(st.indep.wr * 100).toFixed(2) }, previous: prev ? { disc_acc: prev.pre_holdout.disc.acc, disc_n: prev.pre_holdout.disc.n, val_acc: prev.pre_holdout.val.acc, val_n: prev.pre_holdout.val.n } : null, t0_first: rows.find((r, i) => v[i] !== 0) ? new Date(rows.find((r, i) => v[i] !== 0).t0).toISOString() : null });
    }
    results.datasets.push(dsRes);
    fs.writeFileSync(`${OUT}/out_${ds.sub}.json`, JSON.stringify(dsRes, null, 1));
  }
  fs.writeFileSync(OUT + "/results.json", JSON.stringify(results, null, 1));
  console.log("\nDONE results.json escrito (v2 causal)");
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });
