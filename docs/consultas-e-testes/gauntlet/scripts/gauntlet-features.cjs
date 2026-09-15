const { Client } = require("pg");
const fs = require("fs");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const buildSeries = (rows) => { const m = new Map(); for (const o of rows) { const b = Math.floor(o.t / 5000) * 5000; const cc = m.get(b); if (!cc) m.set(b, { start: b, open: o.v, high: o.v, low: o.v, close: o.v }); else { cc.high = Math.max(cc.high, o.v); cc.low = Math.min(cc.low, o.v); cc.close = o.v; } } return [...m.values()].sort((a, b) => a.start - b.start); };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function ema(arr, p) { if (arr.length < p) return null; const a = 2 / (p + 1); let e = mean(arr.slice(0, p)); const out = [e]; for (let i = p; i < arr.length; i++) { e = arr[i] * a + e * (1 - a); out.push(e); } return out; }
function rsiAt(closes, end, p) { if (end - p < 0) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
(async () => {
  await c.connect();
  const data = JSON.parse(fs.readFileSync("C:/tracecom-forward4/gauntlet-snapshots.json", "utf8"));
  const snaps = data.snapshots;
  const groups = new Map();
  for (const s of snaps) groups.set(`${s.session}|${s.segment ?? "none"}`, { s: s.session, g: s.segment ?? null, a: s.asset });
  const obsCache = new Map();
  for (const [gk, g] of groups) {
    const rows = (await c.query("SELECT value::float8 AS v, EXTRACT(EPOCH FROM observed_at)*1000 AS t FROM price_observations WHERE session_id=$1 AND status='ACCEPTED' AND market_type='OTC' AND context_validation_status='VALID' AND ($2::text IS NULL OR segment_id=$2) AND ($3::text IS NULL OR asset_canonical=$3) ORDER BY observed_at ASC", [g.s, g.g, g.a ?? null])).rows.map((r) => ({ v: Number(r.v), t: Number(r.t) }));
    obsCache.set(gk, rows);
  }
  const sessMin = new Map();
  for (const s of snaps) sessMin.set(s.session, Math.min(sessMin.get(s.session) ?? Infinity, s.t0));
  const out = [];
  let featErr = 0;
  for (const s of snaps) {
    try {
      const all = obsCache.get(`${s.session}|${s.segment ?? "none"}`) ?? [];
      const bucketEnd = Math.floor(s.t0 / 5000) * 5000 + 5000;
      const window = all.filter((o) => o.t < bucketEnd).slice(-240);
      const cd = buildSeries(window);
      const m = cd.length;
      if (m < 31) { featErr += 1; continue; }
      const closes = cd.map((x) => x.close), highs = cd.map((x) => x.high), lows = cd.map((x) => x.low), opens = cd.map((x) => x.open);
      const close = closes[m - 1], open = opens[m - 1], high = highs[m - 1], low = lows[m - 1];
      const ret = (i) => (closes[i] - closes[i - 1]) / closes[i - 1];
      const r1 = ret(m - 1), r1p = ret(m - 2), r3 = (close - closes[m - 4]) / closes[m - 4], r6 = (close - closes[m - 7]) / closes[m - 7], r12 = (close - closes[m - 13]) / closes[m - 13], r24 = (close - closes[m - 25]) / closes[m - 25];
      const r60 = m >= 61 ? (close - closes[m - 61]) / closes[m - 61] : null;
      const accel = r1 - r1p;
      const rsi14 = rsiAt(closes, m - 1, 14), sval = rsi14 === null ? null : (55 - rsi14) / 45;
      const rsi7 = rsiAt(closes, m - 1, 7);
      const rsi14_6 = rsiAt(closes, m - 7, 14);
      const rs12 = []; for (let j = m - 12; j < m; j++) rs12.push(ret(j));
      const vol12 = sd(rs12);
      const rs24 = []; for (let j = m - 24; j < m; j++) rs24.push(ret(j));
      const vol24 = sd(rs24);
      const rs60 = m >= 61 ? (() => { const a = []; for (let j = m - 60; j < m; j++) a.push(ret(j)); return sd(a); })() : null;
      const atr14 = mean(cd.slice(m - 14).map((x) => x.high - x.low));
      const atr50 = m >= 50 ? mean(cd.slice(m - 50).map((x) => x.high - x.low)) : null;
      const atrRatio = atr50 ? atr14 / atr50 : null;
      const sma10 = mean(closes.slice(-10)), sma20 = mean(closes.slice(-20)), sma50 = m >= 50 ? mean(closes.slice(-50)) : null;
      const e9 = ema(closes, 9), e21 = ema(closes, 21), e12 = ema(closes, 12), e26 = ema(closes, 26);
      const ema9 = e9[e9.length - 1], ema21 = e21[e21.length - 1];
      let macd = null, macdSig = null, macdHist = null;
      if (e12 && e26) { const n = Math.min(e12.length, e26.length); const mo = []; for (let i = 0; i < n; i++) mo.push(e12[e12.length - n + i] - e26[e26.length - n + i]); macd = mo[mo.length - 1]; const sg = mo.length >= 9 ? ema(mo, 9) : null; macdSig = sg ? sg[sg.length - 1] : null; macdHist = sg ? macd - macdSig : null; }
      const sd20 = sd(closes.slice(-20));
      const bbUp = sma20 + 2 * sd20, bbLo = sma20 - 2 * sd20;
      const bbWidth = sma20 !== 0 ? (bbUp - bbLo) / sma20 : 0;
      const bbB = bbUp !== bbLo ? (close - bbLo) / (bbUp - bbLo) : 0.5;
      const kAt = (i) => { const w = cd.slice(i - 13, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); return hh === ll ? 50 : ((cd[i].close - ll) / (hh - ll)) * 100; };
      const k1 = kAt(m - 1), k2 = kAt(m - 2), k3 = kAt(m - 3), stochD = (k1 + k2 + k3) / 3;
      const range = high - low, body = close - open, bodyAbs = Math.abs(body);
      const bodyRatio = range > 0 ? bodyAbs / range : 0;
      const upperWick = range > 0 ? (high - Math.max(close, open)) / range : 0;
      const lowerWick = range > 0 ? (Math.min(close, open) - low) / range : 0;
      const bull5 = cd.slice(-5).filter((x) => x.close > x.open).length;
      const bull10 = cd.slice(-10).filter((x) => x.close > x.open).length;
      let streak = 0; { let dir = Math.sign(close - open); if (dir !== 0) { streak = 1; for (let i = m - 2; i >= 1; i--) { const d = Math.sign(cd[i].close - cd[i].open); if (d === dir) streak += 1; else break; } if (dir < 0) streak = -streak; } }
      const doji = range > 0 && bodyRatio < 0.15;
      const bigCandle = range > 2 * atr14;
      const range4 = mean(cd.slice(-4).map((x) => x.high - x.low));
      const range20 = mean(cd.slice(-20).map((x) => x.high - x.low));
      const expansion = range20 > 0 ? range4 / range20 : 1;
      const hh24 = Math.max(...highs.slice(-25, -1)), ll24 = Math.min(...lows.slice(-25, -1));
      const boUp = close > hh24, boDown = close < ll24;
      let falseBoUp = 0, falseBoDown = 0; for (let i = Math.max(1, m - 4); i < m; i++) { const prevH = Math.max(...highs.slice(Math.max(0, i - 13), i)), prevL = Math.min(...lows.slice(Math.max(0, i - 13), i)); if (cd[i].high > prevH && cd[i].close < prevH) falseBoUp += 1; if (cd[i].low < prevL && cd[i].close > prevL) falseBoDown += 1; }
      const pivH = [], pivL = [];
      for (let i = 2; i < m - 2; i++) { if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 2]) pivH.push(i); if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 2]) pivL.push(i); }
      const lastPH = pivH.filter((i) => i >= m - 48), lastPL = pivL.filter((i) => i >= m - 48);
      const ph = lastPH.length ? highs[lastPH[lastPH.length - 1]] : null, pl = lastPL.length ? lows[lastPL[lastPL.length - 1]] : null;
      const distPH = ph !== null ? (ph - close) / atr14 : null, distPL = pl !== null ? (close - pl) / atr14 : null;
      let structure = "RANGE"; if (lastPH.length >= 2 && lastPL.length >= 2) { const h2 = highs[lastPH[lastPH.length - 1]], h1 = highs[lastPH[lastPH.length - 2]], l2 = lows[lastPL[lastPL.length - 1]], l1 = lows[lastPL[lastPL.length - 2]]; const higher = h2 > h1 && l2 > l1, lower = h2 < h1 && l2 < l1; structure = higher ? "UP" : lower ? "DOWN" : "RANGE"; }
      const w24 = cd.slice(m - 24); const fhi = Math.max(...w24.map((x) => x.high)), flo = Math.min(...w24.map((x) => x.low));
      let fh = -1, fl = -1; for (let j = 0; j < w24.length; j++) { if (w24[j].high === fhi && fh === -1) fh = j; if (w24[j].low === flo && fl === -1) fl = j; }
      const frange = fhi - flo, upSwing = fl <= fh, inZone = frange > 0 && close <= Math.max(fhi - frange * .382, fhi - frange * .618) && close >= Math.min(fhi - frange * .382, fhi - frange * .618);
      const fibLevels = [0.236, 0.382, 0.5, 0.618, 0.786].map((L) => fhi - frange * L);
      const distFib = frange > 0 ? Math.min(...fibLevels.map((L) => Math.abs(close - L))) / frange : null;
      const pos = frange > 0 ? (close - flo) / frange : null;
      const extUp = fhi + frange * 0.272, extDn = flo - frange * 0.272;
      const beyondExt = upSwing ? close > extUp : close < extDn;
      let er30 = null; { let net = 0, sum = 0; for (let j = m - 30; j < m; j++) { const d = closes[j] - closes[j - 1]; net += d; sum += Math.abs(d); } er30 = sum > 0 ? Math.abs(net) / sum : null; }
      const d = new Date(s.t0);
      const hour = d.getUTCHours(), minute = d.getUTCMinutes();
      const sessMinute = Math.round((s.t0 - sessMin.get(s.session)) / 60000);
      const bullDiv = closes[m - 1] < closes[m - 7] && rsi14 !== null && rsi14_6 !== null && rsi14 > rsi14_6;
      const bearDiv = closes[m - 1] > closes[m - 7] && rsi14 !== null && rsi14_6 !== null && rsi14 < rsi14_6;
      out.push({
        key: s.key, split: s.split, indep: s.indep ? 1 : 0, asset: s.asset, t0: s.t0, l45: s.l45, l60: s.l60, entry: s.entry,
        f: {
          r1, r1p, r3, r6, r12, r24, r60, accel, rsi14, s: sval, rsi7, vol12, vol24, vol60: rs60, atr14, atr50, atrRatio, atrPct: atr14 / close,
          sma10, sma20, sma50, distSma20: (close - sma20) / atr14, distSma10: (close - sma10) / atr14, distEma21: ema21 !== undefined && ema21 !== null ? (close - ema21) / atr14 : null,
          ema9, ema21, macd, macdSig, macdHist: macdHist !== null ? macdHist / atr14 : null,
          stochK: k1, stochD, bbB, bbWidth, sd20,
          bodyRatio, upperWick, lowerWick, bull5, bull10, streak, doji: doji ? 1 : 0, bigCandle: bigCandle ? 1 : 0,
          expansion, boUp: boUp ? 1 : 0, boDown: boDown ? 1 : 0, falseBoUp, falseBoDown,
          distPH, distPL, structure, structureUp: structure === "UP" ? 1 : 0, structureDown: structure === "DOWN" ? 1 : 0,
          fibHi: fhi, fibLo: flo, upSwing: upSwing ? 1 : 0, inZone: inZone ? 1 : 0, fibRange: frange, distFib, pos, beyondExt: beyondExt ? 1 : 0,
          er30, er60: (() => { if (m < 61) return null; let net = 0, sum = 0; for (let j = m - 60; j < m; j++) { const d = closes[j] - closes[j - 1]; net += d; sum += Math.abs(d); } return sum > 0 ? Math.abs(net) / sum : null; })(), hour, minute, sessMinute, bullDiv: bullDiv ? 1 : 0, bearDiv: bearDiv ? 1 : 0,
          close, open, high, low,
        },
      });
    } catch (e) { featErr += 1; }
  }
  // er60 pos-hoc (loop separado para manter try simples)
  console.log(`features computed: ${out.length} (erros: ${featErr})`);
  const keysHave = new Set(out.map((r) => r.key));
  const missList = snaps.filter((s) => !keysHave.has(s.key)).map((s) => s.key);
  if (missList.length) console.log(`MISSING ${missList.length}: ` + JSON.stringify(missList.slice(0, 5)));
  fs.writeFileSync("C:/tracecom-forward4/gauntlet-missing.json", JSON.stringify(missList));
  const perSplit = {}; for (const r of out) perSplit[r.split] = (perSplit[r.split] ?? 0) + 1;
  console.log("por split:", JSON.stringify(perSplit));
  const raw = out.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync("C:/tracecom-forward4/gauntlet-features.jsonl", raw);
  console.log("escrito gauntlet-features.jsonl");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });
