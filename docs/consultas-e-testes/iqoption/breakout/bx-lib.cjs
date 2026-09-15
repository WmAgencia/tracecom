// bx-lib.cjs — causal Breakout & Market Structure features + hypothesis compiler + stats.
// Tudo é calculado em T usando SOMENTE candles[0..i] (indices <= i). Pivôs confirmados com 2 candles de atraso (fractal 2).
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function rsiAt(c, end, p) { if (end - p < 0) return null; let g = 0, l = 0; for (let i = end - p + 1; i <= end; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function pivotsUpTo(highs, lows, i) { // fractais confirmados até i-2
  const ph = [], pl = [];
  for (let j = 2; j <= i - 2; j++) {
    if (highs[j] > highs[j - 1] && highs[j] > highs[j + 1] && highs[j] > highs[j - 2] && highs[j] > highs[j + 2]) ph.push(j);
    if (lows[j] < lows[j - 1] && lows[j] < lows[j + 1] && lows[j] < lows[j - 2] && lows[j] < lows[j + 2]) pl.push(j);
  }
  return { ph, pl };
}
function clusterLevels(pivIdxs, prices, i, atr) { // agrupa pivôs próximos (tol 0.25*ATR) em níveis
  const pts = pivIdxs.filter((j) => j >= i - 96).map((j) => ({ j, p: prices[j] }));
  const levels = [];
  for (const pt of pts) {
    let hit = null;
    for (const lv of levels) if (Math.abs(lv.price - pt.p) <= 0.25 * atr) { hit = lv; break; }
    if (hit) { hit.sum += pt.p; hit.n += 1; hit.last = Math.max(hit.last, pt.j); hit.first = Math.min(hit.first, pt.j); hit.price = hit.sum / hit.n; }
    else levels.push({ sum: pt.p, n: 1, last: pt.j, first: pt.j, price: pt.p });
  }
  return levels.map((lv) => ({ price: lv.price, touches: lv.n, age: i - lv.first, sinceTouch: i - lv.last }));
}
function linreg(pts) { // pts: [{x,y}] -> slope, r2, valueAt(x0)
  const n = pts.length; if (n < 3) return null;
  const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  if (sxx === 0) return null;
  const b = sxy / sxx, a = my - b * mx; const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope: b, r2, at: (x) => a + b * x };
}
// tickAgg: Map bucketMs -> {up, dn, spreadSum, spreadN, ticks}
function bxFeaturesAt(cd, i, tickAgg) {
  if (i < 40) return null;
  const closes = cd.map((x) => x.close), highs = cd.map((x) => x.high), lows = cd.map((x) => x.low), opens = cd.map((x) => x.open);
  const close = closes[i], high = highs[i], low = lows[i], open = opens[i];
  const rng = high - low;
  const atr14 = mean(cd.slice(i - 13, i + 1).map((x) => x.high - x.low));
  if (!(atr14 > 0)) return null;
  const atr50 = i >= 49 ? mean(cd.slice(i - 49, i + 1).map((x) => x.high - x.low)) : atr14;
  const atrRatio = atr50 > 0 ? atr14 / atr50 : 1;
  const ret = (k) => (close - closes[i - k]) / closes[i - k];
  const ret3 = ret(3), ret6 = ret(6), ret12 = ret(12), ret24 = ret(24), ret60 = ret(60), ret120 = ret(120), ret180 = ret(180);
  const bodyRatio = rng > 0 ? Math.abs(close - open) / rng : 0;
  const clv = rng > 0 ? ((close - low) - (high - close)) / rng : 0;
  const upperWick = rng > 0 ? (high - Math.max(close, open)) / rng : 0;
  const lowerWick = rng > 0 ? (Math.min(close, open) - low) / rng : 0;
  // pivôs e estrutura
  const { ph, pl } = pivotsUpTo(highs, lows, i);
  const lastPH = ph.length ? ph[ph.length - 1] : null, prevPH = ph.length > 1 ? ph[ph.length - 2] : null;
  const lastPL = pl.length ? pl[pl.length - 1] : null, prevPL = pl.length > 1 ? pl[pl.length - 2] : null;
  const lastHiP = lastPH !== null ? highs[lastPH] : null, prevHiP = prevPH !== null ? highs[prevPH] : null;
  const lastLoP = lastPL !== null ? lows[lastPL] : null, prevLoP = prevPL !== null ? lows[prevPL] : null;
  const HH = lastHiP !== null && prevHiP !== null && lastHiP > prevHiP ? 1 : 0;
  const LH = lastHiP !== null && prevHiP !== null && lastHiP < prevHiP ? 1 : 0;
  const HL = lastLoP !== null && prevLoP !== null && lastLoP > prevLoP ? 1 : 0;
  const LL = lastLoP !== null && prevLoP !== null && lastLoP < prevLoP ? 1 : 0;
  const bosUp = lastHiP !== null && close > lastHiP ? 1 : 0;
  const bosDn = lastLoP !== null && close < lastLoP ? 1 : 0;
  const chochUp = LH && LL && close > lastHiP ? 1 : 0;
  const chochDn = HH && HL && close < lastLoP ? 1 : 0;
  const sweepUp = lastHiP !== null && high > lastHiP && close < lastHiP ? 1 : 0;   // wick acima do topo, fecha de volta
  const sweepDn = lastLoP !== null && low < lastLoP && close > lastLoP ? 1 : 0;
  const sweepDepthUp = lastHiP !== null && high > lastHiP ? (high - lastHiP) / atr14 : 0;
  const sweepDepthDn = lastLoP !== null && low < lastLoP ? (lastLoP - low) / atr14 : 0;
  // S/R por clusters de pivôs
  const levels = clusterLevels([...ph, ...pl], cd.map((x) => x.close), i, atr14);
  let res = null, sup = null;
  for (const lv of levels) { if (lv.price > close && (res === null || lv.price < res.price)) res = lv; if (lv.price < close && (sup === null || lv.price > sup.price)) sup = lv; }
  const distRes = res ? (res.price - close) / atr14 : null, distSup = sup ? (close - sup.price) / atr14 : null;
  const resTouches = res ? res.touches : 0, resSinceTouch = res ? res.sinceTouch : null, resAge = res ? res.age : null;
  const supTouches = sup ? sup.touches : 0, supSinceTouch = sup ? sup.sinceTouch : null, supAge = sup ? sup.age : null;
  // Donchian ranges
  const Ns = { N12: 12, N24: 24, N48: 48, N96: 96 };
  const brk = {};
  for (const [k, N] of Object.entries(Ns)) { const hh = Math.max(...highs.slice(i - N, i)), ll = Math.min(...lows.slice(i - N, i)); const up = close > hh ? 1 : 0, dn = close < ll ? 1 : 0; brk[k] = { up, dn, distUp: up ? (close - hh) / atr14 : 0, distDn: dn ? (ll - close) / atr14 : 0, width: (hh - ll) / atr14, hh, ll }; }
  const b24 = brk.N24;
  // Falso rompimento recente (rompeu e fechou de volta) nas últimas 6
  let fbUp = 0, fbDn = 0, fbUpDepth = 0, fbDnDepth = 0, fbUpAge = null, fbDnAge = null;
  for (let j = Math.max(1, i - 6); j <= i; j++) {
    const hh = Math.max(...highs.slice(j - 24, j)), ll = Math.min(...lows.slice(j - 24, j));
    if (cd[j].close > hh) { } // rompeu de fato
    if (highs[j] > hh && cd[j].close < hh) { fbUp = 1; fbUpDepth = Math.max(fbUpDepth, (highs[j] - hh) / atr14); fbUpAge = i - j; }
    if (lows[j] < ll && cd[j].close > ll) { fbDn = 1; fbDnDepth = Math.max(fbDnDepth, (ll - lows[j]) / atr14); fbDnAge = i - j; }
  }
  // Retest: rompeu além do hh/ll do range 24 em j<=i-2 e voltou perto do nível sem perder
  let retestUp = 0, retestDn = 0, retestDepthUp = 0, retestDepthDn = 0;
  for (let j = Math.max(1, i - 12); j <= i - 2; j++) {
    const hh = Math.max(...highs.slice(j - 24, j)), ll = Math.min(...lows.slice(j - 24, j));
    if (cd[j].close > hh) { const afterLow = Math.min(...lows.slice(j + 1, i + 1)); if (afterLow <= hh + 0.3 * atr14 && close > hh) { retestUp = 1; retestDepthUp = Math.max(retestDepthUp, (hh - afterLow) / atr14); } }
    if (cd[j].close < ll) { const afterHigh = Math.max(...highs.slice(j + 1, i + 1)); if (afterHigh >= ll - 0.3 * atr14 && close < ll) { retestDn = 1; retestDepthDn = Math.max(retestDepthDn, (afterHigh - ll) / atr14); } }
  }
  // Trendlines (regressão sobre últimos até 12 pivôs de cada tipo)
  const resPts = ph.slice(-12).map((j) => ({ x: j, y: highs[j] }));
  const supPts = pl.slice(-12).map((j) => ({ x: j, y: lows[j] }));
  const lrRes = linreg(resPts), lrSup = linreg(supPts);
  const resLineNow = lrRes ? lrRes.at(i) : null, supLineNow = lrSup ? lrSup.at(i) : null;
  const tlUpBreak = lrRes && lrRes.slope < 0 && close > resLineNow ? 1 : 0;   // quebra de resistência descendente
  const tlDnBreak = lrSup && lrSup.slope > 0 && close < supLineNow ? 1 : 0;  // quebra de suporte ascendente
  const tlUpReject = lrRes && lrRes.slope < 0 && high > resLineNow && close < resLineNow ? 1 : 0;
  const tlDnReject = lrSup && lrSup.slope > 0 && low < supLineNow && close > supLineNow ? 1 : 0;
  const tlDistRes = resLineNow !== null ? (resLineNow - close) / atr14 : null;
  const tlDistSup = supLineNow !== null ? (close - supLineNow) / atr14 : null;
  // compressão/expansão
  const range24 = Math.max(...highs.slice(i - 23, i + 1)) - Math.min(...lows.slice(i - 23, i + 1));
  const range96 = Math.max(...highs.slice(i - 95, i + 1)) - Math.min(...lows.slice(i - 95, i + 1));
  const compression = range96 > 0 ? range24 / range96 : 1;
  const expansionNow = rng > 1.5 * atr14 ? 1 : 0;
  const comp24 = i >= 24 ? (mean(cd.slice(i - 23, i + 1).map((x) => x.high - x.low)) / atr14) : 1;
  // micro (ticks agregados por bucket de 5s)
  let micro = { tickN: cd[i].n, tickRate: cd[i].n / 5, tickBurst: 0, imbalance: null, spread: null, spreadRatio: null };
  if (tickAgg) {
    const agg = tickAgg.get(cd[i].bucket);
    if (agg) { micro.imbalance = agg.up + agg.dn > 0 ? (agg.up - agg.dn) / (agg.up + agg.dn) : 0; micro.spread = agg.spreadN ? agg.spreadSum / agg.spreadN : null; }
    const rates = []; for (let j = Math.max(0, i - 23); j <= i; j++) { const a2 = tickAgg.get(cd[j].bucket); if (a2) rates.push(a2.ticks); }
    const mr = rates.length ? mean(rates) : cd[i].n;
    micro.tickBurst = mr > 0 && cd[i].n > 2 * mr ? 1 : 0;
    const prevSpreads = []; for (let j = Math.max(0, i - 23); j < i; j++) { const a2 = tickAgg.get(cd[j].bucket); if (a2 && a2.spreadN) prevSpreads.push(a2.spreadSum / a2.spreadN); }
    if (micro.spread !== null && prevSpreads.length >= 5) { const pm = mean(prevSpreads); micro.spreadRatio = pm > 0 ? micro.spread / pm : null; }
  }
  const rsi14 = rsiAt(closes, i, 14);
  const h = new Date(cd[i].bucket + 5000).getUTCHours();
  return {
    atr14, atrRatio, ret3, ret6, ret12, ret24, ret60, ret120, ret180, bodyRatio, clv, upperWick, lowerWick,
    HH, HL, LH, LL, bosUp, bosDn, chochUp, chochDn, sweepUp, sweepDn, sweepDepthUp, sweepDepthDn,
    distRes, distSup, resTouches, resSinceTouch, resAge, supTouches, supSinceTouch, supAge,
    brkN12up: brk.N12.up, brkN12dn: brk.N12.dn, brkN24up: b24.up, brkN24dn: b24.dn, brkN48up: brk.N48.up, brkN48dn: brk.N48.dn, brkN96up: brk.N96.up, brkN96dn: brk.N96.dn,
    brkD24up: b24.distUp, brkD24dn: b24.distDn, brkW24: b24.width,
    fbUp, fbDn, fbUpDepth, fbDnDepth, fbUpAge, fbDnAge,
    retestUp, retestDn, retestDepthUp, retestDepthDn,
    tlSlopeRes: lrRes ? lrRes.slope * 300 / atr14 : null, tlR2Res: lrRes ? lrRes.r2 : null, tlSlopeSup: lrSup ? lrSup.slope * 300 / atr14 : null, tlR2Sup: lrSup ? lrSup.r2 : null,
    tlUpBreak, tlDnBreak, tlUpReject, tlDnReject, tlDistRes, tlDistSup,
    compression, comp24, expansionNow,
    tickRate: micro.tickRate, tickBurst: micro.tickBurst, imbalance: micro.imbalance, spread: micro.spread, spreadRatio: micro.spreadRatio,
    rsi14, sBase: rsi14 === null ? null : (55 - rsi14) / 45, hour: h,
  };
}
// compilador das hipóteses BX (specs próprios) sobre rows[i].f
function compileBx(spec, rows) {
  const N = rows.length; const v = new Int8Array(N); const F = (i) => rows[i].f;
  const ops = spec;
  if (ops.type === "brk") { const NN = ops.N.replace("N", ""); for (let i = 0; i < N; i++) { const f = F(i); const up = f["brkN" + NN + "up"], dn = f["brkN" + NN + "dn"]; const d = up ? (f["brkD" + NN + "up"] ?? 0) : dn ? (f["brkD" + NN + "dn"] ?? 0) : 0; if ((up && d >= ops.minD) || (dn && d >= ops.minD)) { if (ops.quality === "body" && f.bodyRatio < 0.5) continue; if (ops.quality === "clv" && (up ? f.clv < 0.5 : f.clv > -0.5)) continue; v[i] = up ? 1 : -1; } } return v; }
  if (ops.type === "fb") { for (let i = 0; i < N; i++) { const f = F(i); if (f.fbUp && f.fbUpDepth >= ops.minD) v[i] = -1; else if (f.fbDn && f.fbDnDepth >= ops.minD) v[i] = 1; } return v; }
  if (ops.type === "tl") { for (let i = 0; i < N; i++) { const f = F(i); if (ops.mode === "break") { if (f.tlUpBreak && f.tlR2Res >= ops.minR2) v[i] = 1; else if (f.tlDnBreak && f.tlR2Sup >= ops.minR2) v[i] = -1; } else { if (f.tlUpReject && f.tlR2Res >= ops.minR2) v[i] = -1; else if (f.tlDnReject && f.tlR2Sup >= ops.minR2) v[i] = 1; } } return v; }
  if (ops.type === "bos") { for (let i = 0; i < N; i++) { const f = F(i); if (ops.kind === "bos") { if (f.bosUp) v[i] = 1; else if (f.bosDn) v[i] = -1; } else if (ops.kind === "choch") { if (f.chochUp) v[i] = 1; else if (f.chochDn) v[i] = -1; } else if (ops.kind === "retest") { if (f.retestUp) v[i] = 1; else if (f.retestDn) v[i] = -1; } else { if (f.sweepUp) v[i] = -1; else if (f.sweepDn) v[i] = 1; } } return v; }
  if (ops.type === "comp") { const NN = ops.N.replace("N", ""); for (let i = 0; i < N; i++) { const f = F(i); const up = f["brkN" + NN + "up"], dn = f["brkN" + NN + "dn"]; if (!(f.compression <= ops.maxComp)) continue; if (ops.needExp && !f.expansionNow) continue; if (up) v[i] = 1; else if (dn) v[i] = -1; } return v; }
  if (ops.type === "gate") { const BASE = { brk24up: (f) => f.brkN24up === 1, brk24dn: (f) => f.brkN24dn === 1, brk48up: (f) => f.brkN48up === 1, brk48dn: (f) => f.brkN48dn === 1, bosUp: (f) => f.bosUp === 1, bosDn: (f) => f.bosDn === 1, sweepUp: (f) => f.sweepUp === 1, sweepDn: (f) => f.sweepDn === 1, fbUp: (f) => f.fbUp === 1, fbDn: (f) => f.fbDn === 1, retestUp: (f) => f.retestUp === 1, retestDn: (f) => f.retestDn === 1 }; const condOk = (f, dir) => ops.condName === "rsi" ? (f.sBase !== null && Math.abs(f.sBase) > 0.22) : ops.condName === "mom12" ? (dir === 1 ? f.ret12 > 0 : f.ret12 < 0) : ops.condName === "imb" ? (f.imbalance !== null && (dir === 1 ? f.imbalance > 0.05 : f.imbalance < -0.05)) : false; for (let i = 0; i < N; i++) { const f = F(i); const bfn = BASE[ops.baseName]; if (!bfn || !bfn(f)) continue; if (!condOk(f, ops.dir)) continue; v[i] = ops.dir; } return v; }
  throw new Error("spec BX desconhecido: " + JSON.stringify(ops).slice(0, 80));
}
function metrics(v, rows, baseP) {
  let sig = 0, b = 0, s = 0, w = 0, l = 0, d = 0, u = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, in_ = 0, curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; sig += 1; if (x === 1) b += 1; else s += 1; const y = rows[i].l60; if (y === null) { u += 1; continue; } if (y === 0) { d += 1; continue; } const win = x === y; if (win) { w += 1; curW += 1; curL = 0; if (curW > maxW) maxW = curW; } else { l += 1; curL += 1; curW = 0; if (curL > maxL) maxL = curL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { in_ += 1; if (win) iw += 1; else il += 1; } }
  const n = w + l, bn = bw + bl, sn = sw + sl;
  const baseStrategy = sig ? (b * baseP + s * (1 - baseP)) / sig : null;
  const p = n ? w / n : null; const z = n && baseStrategy ? (w - baseStrategy * n) / Math.sqrt(n * baseStrategy * (1 - baseStrategy)) : null;
  const wilson = n ? (() => { const zz = 1.96, dd = 1 + zz * zz / n, cc = (p + zz * zz / (2 * n)) / dd, hh = zz * Math.sqrt(p * (1 - p) / n + zz * zz / (4 * n * n)) / dd; return [Math.max(0, cc - hh), Math.min(1, cc + hh)]; })() : null;
  return { signals: sig, sigPerHour: +(sig / (rows.length * 5 / 3600)).toFixed(1), buyN: b, sellN: s, w, l, draws: d, unknown: u, wr: p === null ? null : +(p * 100).toFixed(2), coverage: +((sig / rows.length) * 100).toFixed(2), buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, indepN: in_, indepW: iw, indepL: il, indepWR: in_ ? +((iw / in_) * 100).toFixed(2) : null, maxWinStreak: maxW, maxLossStreak: maxL, baseStrategy: baseStrategy === null ? null : +(baseStrategy * 100).toFixed(2), edge_pp: n && baseStrategy !== null ? +((p - baseStrategy) * 100).toFixed(2) : null, z, wilson95: wilson, wilsonLo: wilson ? +(wilson[0] * 100).toFixed(2) : null };
}
module.exports = { bxFeaturesAt, compileBx, metrics, pivotsUpTo, clusterLevels, linreg, mean, sd };
