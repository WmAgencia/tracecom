// kh-features.cjs — motor de features KH (eficiente: TODAS as janelas <= 240 candles, nunca slice do array inteiro).
// Paridade exigida para as 5 estrategias Fib: s, vol12, r24, inZone, upSwing, distSma20 (logica identica ao engine v2).
// Features extras por familia: z-scores, exaustao, change-point, autocorr, entropia, hurst, micro, padroes, estados.
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function computeKh(candles, agg) {
  const N = candles.length;
  const CL = new Float64Array(N), HI = new Float64Array(N), LO = new Float64Array(N), OP = new Float64Array(N), TC = new Float64Array(N);
  for (let i = 0; i < N; i++) { CL[i] = candles[i].close; HI[i] = candles[i].high; LO[i] = candles[i].low; OP[i] = candles[i].open; TC[i] = candles[i].n; }
  const rows = [];
  // pivots incrementais (confirmados com 2 de atraso)
  const phI = [], plI = [];
  let phPtr = 0, plPtr = 0;
  const R = (k) => (CL[rows.length + k]); // helper nao usado
  for (let i = 40; i < N; i++) {
    // registrar pivots confirmados no indice i-2 (uma vez)
    const j = i - 2;
    if (phI.length === 0 || phI[phI.length - 1] < j) {
      if (j >= 2 && j < N - 2) {
        if (HI[j] > HI[j - 1] && HI[j] > HI[j + 1] && HI[j] > HI[j - 2] && HI[j] > HI[j + 2]) phI.push(j);
        if (LO[j] < LO[j - 1] && LO[j] < LO[j + 1] && LO[j] < LO[j - 2] && LO[j] < LO[j + 2]) plI.push(j);
      }
    }
    while (phPtr < phI.length && phI[phPtr] < i - 48) phPtr += 1;
    while (plPtr < plI.length && plI[plPtr] < i - 48) plPtr += 1;
    const close = CL[i], high = HI[i], low = LO[i], open = OP[i];
    const rng = high - low;
    // --- base (identico ao engine v2) ---
    let g = 0, l = 0; for (let k = i - 13; k <= i; k++) { const d = CL[k] - CL[k - 1]; if (d >= 0) g += d; else l -= d; }
    const rsi14 = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    const s = (55 - rsi14) / 45;
    const rs12 = []; for (let k = i - 11; k <= i; k++) rs12.push((CL[k] - CL[k - 1]) / CL[k - 1]);
    const mv = mean(rs12), vol12 = Math.sqrt(mean(rs12.map((x) => (x - mv) ** 2)));
    const r1 = (close - CL[i - 1]) / CL[i - 1], r6 = (close - CL[i - 6]) / CL[i - 6], r24 = (close - CL[i - 24]) / CL[i - 24];
    let atr14 = 0; for (let k = i - 13; k <= i; k++) atr14 += HI[k] - LO[k]; atr14 /= 14;
    let sma20 = 0; for (let k = i - 19; k <= i; k++) sma20 += CL[k]; sma20 /= 20;
    const distSma20 = (close - sma20) / atr14;
    let hi24 = -Infinity, lo24 = Infinity; for (let k = i - 23; k <= i; k++) { if (HI[k] > hi24) hi24 = HI[k]; if (LO[k] < lo24) lo24 = LO[k]; }
    const fRange = hi24 - lo24;
    let fh = -1, fl = -1; for (let k = i - 23; k <= i; k++) { if (HI[k] === hi24 && fh === -1) fh = k; if (LO[k] === lo24 && fl === -1) fl = k; }
    const upSwing = fl <= fh ? 1 : 0;
    const inZone = fRange > 0 && close <= Math.max(hi24 - fRange * .382, hi24 - fRange * .618) && close >= Math.min(hi24 - fRange * .382, hi24 - fRange * .618) ? 1 : 0;
    // --- familia: regressao/linha/estrutura ---
    const lastPH = phPtr < phI.length ? phI[phI.length - 1] : null;
    const lastPL = plPtr < plI.length ? plI[plI.length - 1] : null;
    const distPH = lastPH !== null ? (HI[lastPH] - close) / atr14 : null;
    const distPL = lastPL !== null ? (close - LO[lastPL]) / atr14 : null;
    // --- z-score family ---
    const zw = 60, zmean = (i >= zw ? (() => { let m = 0; for (let k = i - zw + 1; k <= i; k++) m += CL[k]; return m / zw; })() : close);
    const zsd = (i >= zw ? (() => { let q = 0; for (let k = i - zw + 1; k <= i; k++) q += (CL[k] - zmean) ** 2; return Math.sqrt(q / zw); })() : 1) || 1e-12;
    const z60 = (close - zmean) / zsd;
    const zw2 = 240, zmean2 = (i >= zw2 ? (() => { let m = 0; for (let k = i - zw2 + 1; k <= i; k++) m += CL[k]; return m / zw2; })() : close);
    const zsd2 = (i >= zw2 ? (() => { let q = 0; for (let k = i - zw2 + 1; k <= i; k++) q += (CL[k] - zmean2) ** 2; return Math.sqrt(q / zw2); })() : 1) || 1e-12;
    const z240 = (close - zmean2) / zsd2;
    // --- exaustao ---
    const r3 = (close - CL[i - 3]) / CL[i - 3], r12 = (close - CL[i - 12]) / CL[i - 12];
    const accel = r3 - (CL[i - 3] - CL[i - 6]) / CL[i - 6];
    let bodyPrev = 0; for (let k = i - 5; k < i; k++) bodyPrev += Math.abs(CL[k] - OP[k]); bodyPrev /= 5;
    const bodyNow = Math.abs(close - open);
    const bodyContraction = bodyPrev > 0 ? bodyNow / bodyPrev : 1;
    const wickExpansion = rng > 0 ? (Math.max(high - Math.max(close, open), Math.min(close, open) - low)) / rng : 0;
    // --- autocorr (lag1, janela 60) + runs ---
    let ac1 = 0; if (i >= 62) { const xs = [], ys = []; for (let k = i - 59; k <= i; k++) { xs.push((CL[k] - CL[k - 1]) / CL[k - 1]); } const m = mean(xs); const x1 = xs.slice(0, -1), x2 = xs.slice(1); const m1 = mean(x1), m2 = mean(x2); let a = 0, b = 0, c = 0; for (let k = 0; k < x1.length; k++) { a += (x1[k] - m1) * (x2[k] - m2); b += (x1[k] - m1) ** 2; c += (x2[k] - m2) ** 2; } ac1 = b > 0 && c > 0 ? a / Math.sqrt(b * c) : 0; }
    let runUp = 0, runDn = 0; for (let k = i; k > i - 30 && k >= 1; k--) { if (CL[k] > CL[k - 1]) { if (runDn > 0) break; runUp += 1; } else if (CL[k] < CL[k - 1]) { if (runUp > 0) break; runDn += 1; } else break; }
    // --- entropia de direcao (janela 60) + perm entropy (janela 30) ---
    const dirs = []; for (let k = i - 59; k <= i; k++) dirs.push(CL[k] > CL[k - 1] ? 1 : CL[k] < CL[k - 1] ? -1 : 0);
    const cnt = { "1": 0, "-1": 0, "0": 0 }; for (const d of dirs) cnt[String(d)] += 1;
    let H = 0; for (const kk of ["1", "-1", "0"]) { const p = cnt[kk] / dirs.length; if (p > 0) H -= p * Math.log2(p); }
    let Hp = 0; { const w = 30; const arr = []; for (let k = i - w + 1; k <= i; k++) arr.push(CL[k]); const perms = {}; for (let k = 0; k + 2 < arr.length; k++) { const idx = [0, 1, 2].sort((a, b) => arr[k + a] - arr[k + b]).join(""); perms[idx] = (perms[idx] || 0) + 1; } const tot = Object.values(perms).reduce((a, b) => a + b, 0); for (const v of Object.values(perms)) { const p = v / tot; if (p > 0) Hp -= p * Math.log2(p); } Hp = Hp / 3; }
    // --- hurst via variance ratio (janelas 8/16/32) ---
    let vr = null; if (i >= 70) { const rets = []; for (let k = i - 63; k <= i; k++) rets.push(Math.log(CL[k] / CL[k - 1])); const v1 = sd(rets); const agg2 = []; for (let k = 0; k + 1 < rets.length; k += 2) agg2.push(rets[k] + rets[k + 1]); const v2 = sd(agg2); vr = v1 > 0 ? v2 / (v1 * Math.sqrt(2)) : 1; }
    const hurst = vr === null ? null : Math.log2(vr) / 2 + 0.5;
    // --- micro (agg) ---
    let imb = null, tickRate = TC[i] / 5, tickBurst = 0, spreadRatio = null;
    if (agg) {
      const a0 = agg.get(candles[i].bucket); if (a0) { imb = a0.up + a0.dn > 0 ? (a0.up - a0.dn) / (a0.up + a0.dn) : 0; }
      let mrate = 0, cntR = 0; for (let k = i - 23; k <= i; k++) { const a2 = agg.get(candles[k].bucket); if (a2) { mrate += a2.ticks; cntR += 1; } } mrate = cntR ? mrate / cntR : TC[i];
      tickBurst = mrate > 0 && TC[i] > 1.8 * mrate ? 1 : 0;
      let sPrev = 0, nPrev = 0; for (let k = i - 23; k < i; k++) { const a2 = agg.get(candles[k].bucket); if (a2 && a2.spreadN) { sPrev += a2.spreadSum / a2.spreadN; nPrev += 1; } }
      if (a0 && a0.spreadN && nPrev >= 5) { const sp = a0.spreadSum / a0.spreadN; const pm = sPrev / nPrev; spreadRatio = pm > 0 ? sp / pm : null; }
    }
    // --- padrao/estado (para Markov/pattern mining fittado no TRAIN) ---
    let dir3 = ""; for (let k = i - 2; k <= i; k++) dir3 += CL[k] > CL[k - 1] ? "U" : "D";
    let dir10 = ""; for (let k = i - 9; k <= i; k++) dir10 += CL[k] > CL[k - 1] ? "U" : "D";
    const hour = new Date(candles[i].bucket + 5000).getUTCHours();
    rows.push({ i, t0: candles[i].bucket + 5000, entry: close, f: {
      s, vol12, r24, r6, r1, inZone, upSwing, distSma20, atr14, rsi14,
      z60, z240, r3, r12, accel, bodyContraction, wickExpansion, ac1, runUp, runDn, H, Hp, hurst, vr,
      imb, tickRate, tickBurst, spreadRatio, dir3, dir10, hour,
      bodyRatio: rng > 0 ? bodyNow / rng : 0, clv: rng > 0 ? ((close - low) - (high - close)) / rng : 0,
      distPH, distPL, streak: runUp > 0 ? runUp : -runDn,
      momentuma: r12 - r24, lowVol: vol12 < 0.0009 ? 1 : 0,
    } });
  }
  return rows;
}
// labels T+60 (12 candles exatos) sobre os MESMOS candles
function labelRows(rows, candles) {
  const byBucket = new Map(); for (let i = 0; i < candles.length; i++) byBucket.set(candles[i].bucket, i);
  for (const r of rows) { const si = byBucket.get(r.t0 - 5000 + 60000); r.l60 = si === undefined ? null : (candles[si].close === r.entry ? 0 : candles[si].close > r.entry ? 1 : -1); }
  return rows;
}
module.exports = { computeKh, labelRows, mean, sd };
