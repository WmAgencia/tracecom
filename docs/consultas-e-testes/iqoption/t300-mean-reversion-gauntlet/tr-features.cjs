// tr-features.cjs — base signal z120_rev_2 (BINARY 10h, T+300): extrai os 890 sinais com features causais completas + reproduduz baseline.
const fs = require("fs");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const L = require(OUT + "/mh-lib.cjs");
const KHF = L.KHF;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
async function main() {
  const cd = await L.loadCandles(API, TOK, "IQOPTION_EURUSD_BINARY_10H");
  const agg = await L.loadTickAgg(API, TOK, "IQOPTION_EURUSD_BINARY_10H");
  const N = cd.length, C = cd.map((x) => x.close), H = cd.map((x) => x.high), Lo = cd.map((x) => x.low), O = cd.map((x) => x.open);
  const khRows = KHF.labelRows(KHF.computeKh(cd, agg), cd); const byK = new Map(); for (const r of khRows) byK.set(r.t0 - 5000, r);
  const byB = new Map(); for (let i = 0; i < N; i++) byB.set(cd[i].bucket, i);
  // indicadores locais
  const rsi = (i, p) => { if (i < p) return null; let g = 0, l = 0; for (let j = i - p + 1; j <= i; j++) { const d = C[j] - C[j - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
  const stoch = (i) => { if (i < 14) return null; let hh = -Infinity, ll = Infinity; for (let j = i - 13; j <= i; j++) { if (H[j] > hh) hh = H[j]; if (Lo[j] < ll) ll = Lo[j]; } return hh === ll ? 50 : ((C[i] - ll) / (hh - ll)) * 100; };
  const cci = (i) => { if (i < 20) return null; const tp = []; for (let j = i - 19; j <= i; j++) tp.push((H[j] + Lo[j] + C[j]) / 3); const m = mean(tp); const md = mean(tp.map((x) => Math.abs(x - m))); return md > 0 ? (tp[19] - m) / (0.015 * md) : 0; };
  const wpr = (i) => { if (i < 14) return null; let hh = -Infinity, ll = Infinity; for (let j = i - 13; j <= i; j++) { if (H[j] > hh) hh = H[j]; if (Lo[j] < ll) ll = Lo[j]; } return hh === ll ? -50 : ((hh - C[i]) / (hh - ll)) * -100; };
  const ema = (p) => { const o = new Array(N).fill(null); if (N < p) return o; const a = 2 / (p + 1); let e = mean(C.slice(0, p)); o[p - 1] = e; for (let i = p; i < N; i++) { e = C[i] * a + e * (1 - a); o[i] = e; } return o; };
  const e9 = ema(9), e21 = ema(21), e50 = ema(50);
  let mh = null; { const e12 = ema(12), e26 = ema(26); mh = new Array(N).fill(null); const mv = []; for (let i = 0; i < N; i++) if (e12[i] !== null && e26[i] !== null) { mv.push(e12[i] - e26[i]); mh[i] = e12[i] - e26[i]; } }
  const atr = (i, p) => { if (i < p) return null; let s = 0; for (let j = i - p + 1; j <= i; j++) s += H[j] - Lo[j]; return s / p; };
  const ret = (i, k) => i >= k ? (C[i] - C[i - k]) / C[i - k] : null;
  const sdRet = (i, n) => { if (i < n) return null; const r = []; for (let j = i - n + 1; j <= i; j++) r.push((C[j] - C[j - 1]) / C[j - 1]); return Math.sqrt(mean(r.map((x) => (x - mean(r)) ** 2))); };
  const er = (i, n) => { if (i < n) return null; let net = C[i] - C[i - n], sum = 0; for (let j = i - n + 1; j <= i; j++) sum += Math.abs(C[j] - C[j - 1]); return sum > 0 ? Math.abs(net) / sum : null; };
  const reg = (i, n) => { if (i < n) return null; const xs = [], ys = []; for (let j = i - n + 1; j <= i; j++) { xs.push(j); ys.push(C[j]); } const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0, syy = 0; for (let j = 0; j < n; j++) { sxx += (xs[j] - mx) ** 2; sxy += (xs[j] - mx) * (ys[j] - my); syy += (ys[j] - my) ** 2; } if (sxx === 0) return null; const b = sxy / sxx; const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0; let res = 0; for (let j = 0; j < n; j++) res += (ys[j] - (my + b * (xs[j] - mx))) ** 2; const sdRes = Math.sqrt(res / n); return { slope: b, r2, sdRes, residNow: C[i] - (my + b * (i - mx)) }; };
  const zs = (i, n) => { if (i < n) return null; let m = 0; for (let j = i - n + 1; j <= i; j++) m += C[j]; m /= n; let q = 0; for (let j = i - n + 1; j <= i; j++) q += (C[j] - m) ** 2; const sd = Math.sqrt(q / n) || 1e-12; return { z: (C[i] - m) / sd, m, sd }; };
  // pivots/estrutura
  const phI = [], plI = []; for (let j = 2; j < N - 2; j++) { if (H[j] > H[j - 1] && H[j] > H[j + 1] && H[j] > H[j - 2] && H[j] > H[j + 2]) phI.push(j); if (Lo[j] < Lo[j - 1] && Lo[j] < Lo[j + 1] && Lo[j] < Lo[j - 2] && Lo[j] < Lo[j + 2]) plI.push(j); }
  const signals = [];
  for (let i = 130; i < N; i++) {
    const zr = zs(i, 120); if (!zr || Math.abs(zr.z) < 2) continue;
    const dir = zr.z > 0 ? -1 : 1;
    const kh = byK.get(cd[i].bucket); const f = kh ? kh.f : {};
    const si300 = byB.get(cd[i].bucket + 300000); const l300 = si300 === undefined ? null : (cd[si300].close === C[i] ? 0 : cd[si300].close > C[i] ? 1 : -1);
    // janelas de tick
    const tw = {}; for (const k of [1, 2, 3, 6, 12]) { let up = 0, dn = 0, tk = 0, sp = 0, sn = 0; for (let j = i - k + 1; j <= i; j++) { const a = agg.get(cd[j].bucket); if (a) { up += a.up; dn += a.dn; tk += a.ticks; sp += a.spreadSum; sn += a.spreadN; } } tw[`tick_imb_${k * 5}s`] = up + dn > 0 ? (up - dn) / (up + dn) : null; tw[`tick_rate_${k * 5}s`] = tk / (k * 5); tw[`spread_${k * 5}s`] = sn > 0 ? sp / sn : null; }
    // path features (60s)
    let net = 0, sumAbs = 0, dirC = 0, maxAbs = 0, maxAbsIdx = 0, signChanges = 0, prevSign = 0, maxAdverse = 0, curAdverse = 0;
    for (let j = i - 11; j <= i; j++) { const d = C[j] - C[j - 1]; net += d; sumAbs += Math.abs(d); if (Math.abs(d) > maxAbs) { maxAbs = Math.abs(d); maxAbsIdx = j; } const sg = Math.sign(d); if (sg !== 0) { dirC += 1; if (prevSign !== 0 && sg !== prevSign) signChanges += 1; prevSign = sg; if (sg !== dir) { curAdverse += Math.abs(d); if (curAdverse > maxAdverse) maxAdverse = curAdverse; } else curAdverse = 0; } }
    // tempo no extremo
    let extC = 0, maxZ = 0, firstCross = null;
    for (let j = i - 11; j <= i; j++) { const z2 = zs(j, 120); if (z2 && Math.abs(z2.z) >= 2) { extC += 1; if (Math.abs(z2.z) > Math.max(maxZ, 0)) maxZ = Math.abs(z2.z); if (firstCross === null) firstCross = j; } }
    const barsSinceCross = firstCross === null ? null : i - firstCross;
    // change point
    let cpMean = null, cpVar = null; { if (i >= 60) { let m12 = 0, m48 = 0; for (let j = i - 11; j <= i; j++) m12 += C[j]; m12 /= 12; for (let j = i - 59; j <= i - 12; j++) m48 += C[j]; m48 /= 48; let q48 = 0; for (let j = i - 59; j <= i - 12; j++) q48 += (C[j] - m48) ** 2; const sd48 = Math.sqrt(q48 / 48) || 1e-12; cpMean = (m12 - m48) / sd48; } const s12 = sdRet(i, 12), s48 = i >= 49 ? sdRet(i, 48) : null; cpVar = s48 ? s12 / s48 : null; }
    // vol percentile (atr14 vs last 300)
    let volPct = null; { if (i >= 314) { const aNow = atr(i, 14); const arr = []; for (let j = i - 300; j <= i; j += 5) { const a = atr(j, 14); if (a !== null) arr.push(a); } if (arr.length > 10) volPct = arr.filter((x) => x <= aNow).length / arr.length; } }
    const r60 = reg(i, 60), r120 = reg(i, 120), r300 = i >= 300 ? reg(i, 300) : null;
    const bbw = (() => { if (i < 20) return null; let m = 0; for (let j = i - 19; j <= i; j++) m += C[j]; m /= 20; let q = 0; for (let j = i - 19; j <= i; j++) q += (C[j] - m) ** 2; return (4 * Math.sqrt(q / 20)) / m; })();
    const ph = phI.filter((j) => j <= i - 2).slice(-2), pl = plI.filter((j) => j <= i - 2).slice(-2);
    let structUp = 0, structDown = 0; if (ph.length === 2 && pl.length === 2) { const h2 = H[ph[1]], h1 = H[ph[0]], l2 = Lo[pl[1]], l1 = Lo[pl[0]]; if (h2 > h1 && l2 > l1) structUp = 1; else if (h2 < h1 && l2 < l1) structDown = 1; }
    const a14 = atr(i, 14);
    signals.push({
      t: cd[i].bucket, t0: cd[i].bucket + 5000, entry: C[i], dir, l300,
      z: +zr.z.toFixed(3), zAbs: +Math.abs(zr.z).toFixed(3), distMean: +(C[i] - zr.m).toFixed(6), distATR: a14 ? +(C[i] - zr.m) / a14 : null, distPct: volPct,
      ret15: ret(i, 3), ret30: ret(i, 6), ret45: ret(i, 9), ret60: ret(i, 12), ret90: ret(i, 18), ret120: ret(i, 24), ret180: ret(i, 36), ret300: ret(i, 60),
      accel: (ret(i, 3) ?? 0) - (ret(i - 3, 3) ?? 0), rsi14: rsi(i, 14), rsi7: rsi(i, 7), stoch: stoch(i), cci: cci(i), wpr: wpr(i),
      macd: mh[i], macdDecel: (mh[i] ?? 0) - (mh[i - 6] ?? 0),
      bodyRatio: f.bodyRatio, clv: f.clv, wickExp: f.wickExpansion,
      tick_imb_5s: tw["tick_imb_5s"], tick_imb_10s: tw["tick_imb_10s"], tick_imb_15s: tw["tick_imb_15s"], tick_imb_30s: tw["tick_imb_30s"], tick_imb_60s: tw["tick_imb_60s"],
      tick_rate_5s: tw["tick_rate_5s"], tick_rate_15s: tw["tick_rate_15s"], tick_rate_60s: tw["tick_rate_60s"], spread_15s: tw["spread_15s"], spread_60s: tw["spread_60s"],
      distPH: f.distPH, distPL: f.distPL, nearRes: f.distPH !== undefined && !isNaN(f.distPH) && f.distPH < 0.5 ? 1 : 0, nearSup: f.distPL !== undefined && !isNaN(f.distPL) && f.distPL < 0.5 ? 1 : 0,
      reg60_slope: r60 ? r60.slope : null, reg60_r2: r60 ? r60.r2 : null, reg60_residZ: r60 && r60.sdRes > 0 ? r60.residNow / r60.sdRes : null,
      reg120_slope: r120 ? r120.slope : null, reg120_r2: r120 ? r120.r2 : null, reg300_slope: r300 ? r300.slope : null, reg300_r2: r300 ? r300.r2 : null,
      er30: er(i, 30), er60: er(i, 60), adx: null, emaStack: (e9[i] !== null && e50[i] !== null) ? (e9[i] > e21[i] && e21[i] > e50[i] ? 1 : e9[i] < e21[i] && e21[i] < e50[i] ? -1 : 0) : 0,
      hurst: f.hurst, ac1: f.ac1, H: f.H, Hp: f.Hp, structUp, structDown,
      atr14: a14, atrPct: a14 ? a14 / C[i] : null, vol12: f.vol12, bbw, volPct,
      cpMean, cpVar, expansion: f.wickExpansion,
      pathEff: sumAbs > 0 ? Math.abs(net) / sumAbs : null, dirCandles: dirC, signChanges, maxCandleShare: sumAbs > 0 ? maxAbs / sumAbs : null, barsSinceMax: i - maxAbsIdx, maxAdverse: maxAdverse,
      extCandles: extC, maxZ: maxZ, barsSinceCross,
      inZone: f.inZone, upSwing: f.upSwing, fibPos: f.pos, fibOk: (f.inZone === 1 && ((dir === 1 && f.upSwing === 1) || (dir === -1 && f.upSwing === 0))) ? 1 : 0,
      hour: f.hour, volHigh: f.vol12 >= 0.0009 ? 1 : 0,
      aroonUp: null,
    });
  }
  // baseline reproduction
  let w = 0, l = 0, d = 0, u = 0, b = 0, s2 = 0, bw = 0, bl = 0, sw = 0, sl = 0;
  for (const sg of signals) { if (sg.l300 === null) { u += 1; continue; } if (sg.l300 === 0) { d += 1; continue; } const win = sg.dir === sg.l300; if (win) w += 1; else l += 1; if (sg.dir === 1) { b += 1; if (win) bw += 1; else bl += 1; } else { s2 += 1; if (win) sw += 1; else sl += 1; } }
  const hrs = cd.length * 5 / 3600;
  const rep = { dataset: "IQOPTION_EURUSD_BINARY_10H", signals: signals.length, W: w, L: l, DRAW: d, UNKNOWN: u, WR: +(w / (w + l) * 100).toFixed(2), sigPerHour: +(signals.length / hrs).toFixed(1), BUY: { n: b, wr: +(bw / b * 100).toFixed(2) }, SELL: { n: s2, wr: +(sw / s2 * 100).toFixed(2) }, expected: { n: 890, wr: 63.6, sigPerHour: 89.5 }, match: signals.length === 890 && Math.abs((w / (w + l) * 100) - 63.6) < 0.05 };
  fs.mkdirSync(OUT + "/tr", { recursive: true });
  fs.writeFileSync(OUT + "/tr/signals-raw.json", JSON.stringify({ note: "z120_rev_2 (BINARY, T+300) — DISCOVERY — entry=close(T), settlement=close(T+300s)", signals }));
  fs.writeFileSync(OUT + "/tr/baseline-reproduction.json", JSON.stringify(rep, null, 1));
  console.log("REPRO:", JSON.stringify(rep));
}
main().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
