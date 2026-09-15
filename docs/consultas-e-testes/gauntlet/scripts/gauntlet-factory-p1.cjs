const fs = require("fs");
const rows = fs.readFileSync("C:/tracecom-forward4/gauntlet-features.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.split === "DISC" || r.split === "VAL").sort((a, b) => a.t0 - b.t0);
const N = rows.length, N_D = rows.filter((r) => r.split === "DISC").length, N_V = N - N_D;
console.log(`rows=${N} DISC=${N_D} VAL=${N_V}`);
const L = new Int8Array(N); for (let i = 0; i < N; i++) L[i] = rows[i].l60 === null ? 0 : rows[i].l60;
const col = (f) => { const a = new Float64Array(N); for (let i = 0; i < N; i++) { const v = rows[i].f[f]; a[i] = v === null || v === undefined ? NaN : v; } return a; };
const C = {}; for (const k of ["s", "vol12", "r24", "r12", "r6", "r1", "distSma20", "macdHist", "stochK", "bbB", "er30", "er60", "streak", "bodyRatio", "upperWick", "lowerWick", "expansion", "distPH", "distPL", "pos", "distFib", "atrPct", "hour", "sessMinute"]) C[k] = col(k);
const B = {}; for (const k of ["boUp", "boDown", "falseBoUp", "falseBoDown", "structureUp", "structureDown", "inZone", "upSwing", "beyondExt", "bullDiv", "bearDiv", "bigCandle", "doji"]) { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = rows[i].f[k] ? 1 : 0; B[k] = a; }
const INDEP = new Uint8Array(N); for (let i = 0; i < N; i++) INDEP[i] = rows[i].indep;
{ const up = rows.filter((r) => r.l60 === 1).length, dn = rows.filter((r) => r.l60 === -1).length; console.log(`labels: up=${up} down=${dn} draw/missing=${N - up - dn}`); }
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const wilson = (w, n) => { if (!n) return [0, 1]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; };
function stats(v, lo, hi) { let sig = 0, w = 0, l = 0, d = 0, wI = 0, lI = 0; for (let i = lo; i < hi; i++) { const x = v[i]; if (x === 0) continue; sig += 1; const y = L[i]; if (y === 0) { d += 1; } else { if (x === y) w += 1; else l += 1; } if (INDEP[i]) { if (y !== 0) { if (x === y) wI += 1; else lI += 1; } } } const n = w + l, acc = n ? w / n : 0; const [wl, wh] = wilson(w, n); return { sig, w, l, d, n, acc, wilson_lo: wl, wilson_hi: wh, indep_n: wI + lI, indep_w: wI, indep_l: lI, indep_acc: (wI + lI) ? wI / (wI + lI) : null }; }
const mk = (f) => { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = f(i); return v; };
const eqs = {
  and(a, b) { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = a[i] !== 0 && a[i] === b[i] ? a[i] : 0; return v; },
  union(a, b) { const v = new Int8Array(N); for (let i = 0; i < N; i++) { const x = a[i], y = b[i]; v[i] = x === 0 ? y : y === 0 ? x : x === y ? x : 0; } return v; },
  gate(v, cond) { const r = new Int8Array(N); for (let i = 0; i < N; i++) r[i] = cond[i] ? v[i] : 0; return r; },
  vote3(a, b, c2) { const v = new Int8Array(N); for (let i = 0; i < N; i++) { if (a[i] !== 0 && a[i] === b[i]) v[i] = a[i]; else if (a[i] !== 0 && a[i] === c2[i]) v[i] = a[i]; else if (b[i] !== 0 && b[i] === c2[i]) v[i] = b[i]; } return v; },
};
const mkCond = (f2) => { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = f2(i) ? 1 : 0; return a; };
const A = []; const push = (id, family, spec, vec) => A.push({ id, family, spec, vec });
for (const t of [0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77]) push(`rsi_s_${t}`, "reversion", { type: "rsi_s", t }, mk((i) => { const x = C.s[i]; return x > t ? 1 : x < -t ? -1 : 0; }));
for (const [t, v] of [[0.33, 0.0009], [0.22, 0.0012], [0.33, 0.0006], [0.44, 0.0009]]) push(`rsi_vol_${t}_${v}`, "reversion", { type: "rsi_vol", t, v }, mk((i) => { const x = C.s[i]; return C.vol12[i] < v ? (x > t ? 1 : x < -t ? -1 : 0) : 0; }));
for (const [lo, hi] of [[0.63, 0.857], [0.8, 1.2], [0.5, 0.7], [0.857, 2]]) push(`rsi_band_${lo}_${hi}`, "reversion", { type: "rsi_band", lo, hi }, mk((i) => { const x = Math.abs(C.s[i]); return x >= lo && x <= hi ? (C.s[i] > 0 ? 1 : -1) : 0; }));
for (const t of [0.00005, 0.0001, 0.0002, 0.0004]) push(`mom_f_${t}`, "trend", { type: "mom_follow", t }, mk((i) => { const x = C.r24[i]; return x > t ? 1 : x < -t ? -1 : 0; }));
for (const t of [0.0001, 0.0002, 0.0004]) push(`mom_r_${t}`, "trend", { type: "mom_revert", t }, mk((i) => { const x = C.r24[i]; return x > t ? -1 : x < -t ? 1 : 0; }));
for (const m of [0.5, 1, 1.5, 2, 2.5, 3]) push(`atr_${m}`, "volatility", { type: "atr_over", m }, mk((i) => { const x = C.distSma20[i]; return x <= -m ? 1 : x >= m ? -1 : 0; }));
push("macd_f", "momentum", { type: "macd_follow" }, mk((i) => C.macdHist[i] > 0 ? 1 : C.macdHist[i] < 0 ? -1 : 0));
push("macd_r", "momentum", { type: "macd_revert" }, mk((i) => C.macdHist[i] > 0 ? -1 : C.macdHist[i] < 0 ? 1 : 0));
for (const t of [10, 15, 20, 25, 30]) push(`stoch_r_${t}`, "momentum", { type: "stoch_rev", t }, mk((i) => { const k = C.stochK[i]; return k < t ? 1 : k > 100 - t ? -1 : 0; }));
for (const t of [10, 20]) push(`stoch_f_${t}`, "momentum", { type: "stoch_follow", t }, mk((i) => { const k = C.stochK[i]; return k > 100 - t ? 1 : k < t ? -1 : 0; }));
for (const t of [0.05, 0.1, 0.2, 0.3]) push(`bb_r_${t}`, "volatility", { type: "bb_rev", t }, mk((i) => { const x = C.bbB[i]; return x < t ? 1 : x > 1 - t ? -1 : 0; }));
push("bb_break", "volatility", { type: "bb_break" }, mk((i) => C.bbB[i] > 1 ? 1 : C.bbB[i] < 0 ? -1 : 0));
for (const t of [0.35, 0.5, 0.6]) push(`er_f_${t}`, "regime", { type: "er_follow", t }, mk((i) => { if (!(C.er30[i] > t)) return 0; const x = C.r24[i]; return x > 0 ? 1 : x < 0 ? -1 : 0; }));
for (const t of [0.35, 0.5, 0.6]) push(`er_arev_${t}`, "regime", { type: "er_rev", t }, mk((i) => { if (!(C.er30[i] > t)) return 0; const x = C.s[i]; return x > 0 ? 1 : x < 0 ? -1 : 0; }));
for (const t of [0.25, 0.35, 0.45]) push(`erc_rev_${t}`, "regime", { type: "er_chop_rev", t }, mk((i) => { if (!(C.er30[i] < t)) return 0; const x = C.s[i]; return x > 0 ? 1 : x < 0 ? -1 : 0; }));
for (const k of [3, 4, 5, 6]) push(`streak_r_${k}`, "price-action", { type: "streak_rev", k }, mk((i) => { const x = C.streak[i]; return x >= k ? -1 : x <= -k ? 1 : 0; }));
for (const k of [3, 4, 5, 6]) push(`streak_f_${k}`, "price-action", { type: "streak_follow", k }, mk((i) => { const x = C.streak[i]; return x >= k ? 1 : x <= -k ? -1 : 0; }));
push("bigc_r", "price-action", { type: "bigcandle_rev" }, mk((i) => { if (!B.bigCandle[i]) return 0; return C.r1[i] > 0 ? -1 : C.r1[i] < 0 ? 1 : 0; }));
push("bigc_f", "price-action", { type: "bigcandle_follow" }, mk((i) => { if (!B.bigCandle[i]) return 0; return C.r1[i] > 0 ? 1 : C.r1[i] < 0 ? -1 : 0; }));
push("wick_rej", "support-resistance", { type: "wick_rej" }, mk((i) => { const uw = C.upperWick[i], lw = C.lowerWick[i], dp = C.distPH[i], dl = C.distPL[i]; if (uw > 0.5 && !isNaN(dp) && dp < 0.3) return -1; if (lw > 0.5 && !isNaN(dl) && dl < 0.3) return 1; return 0; }));
push("brk_f", "price-action", { type: "breakout_follow" }, mk((i) => B.boUp[i] ? 1 : B.boDown[i] ? -1 : 0));
push("falsebo_r", "price-action", { type: "falsebo_rev" }, mk((i) => (B.falseBoUp[i] || B.falseBoDown[i]) ? (B.falseBoUp[i] ? -1 : 1) : 0));
push("sr_r", "support-resistance", { type: "sr_rev" }, mk((i) => { const dp = C.distPH[i], dl = C.distPL[i]; if (!isNaN(dp) && dp < 0.4) return -1; if (!isNaN(dl) && dl < 0.4) return 1; return 0; }));
push("struct_f", "structure", { type: "struct_follow" }, mk((i) => B.structureUp[i] ? 1 : B.structureDown[i] ? -1 : 0));
push("struct_r", "structure", { type: "struct_rev" }, mk((i) => { const sv = C.s[i]; if (B.structureUp[i] && sv > 0.1) return 1; if (B.structureDown[i] && sv < -0.1) return -1; return 0; }));
push("fib_ctx", "fibonacci", { type: "fib_ctx" }, mk((i) => B.inZone[i] ? (B.upSwing[i] ? 1 : -1) : 0));
push("fib_deep", "fibonacci", { type: "fib_deep" }, mk((i) => { if (!B.inZone[i]) return 0; const p = C.pos[i]; if (B.upSwing[i]) return p <= 0.5 ? 1 : 0; return p >= 0.5 ? -1 : 0; }));
push("div_r", "divergence", { type: "div_rev" }, mk((i) => B.bullDiv[i] ? 1 : B.bearDiv[i] ? -1 : 0));
push("exp_f", "volatility", { type: "expansion_follow" }, mk((i) => C.expansion[i] > 1.3 ? (C.r1[i] > 0 ? 1 : C.r1[i] < 0 ? -1 : 0) : 0));
push("last_candle", "baseline", { type: "last_candle" }, mk((i) => C.r1[i] > 0 ? 1 : C.r1[i] < 0 ? -1 : 0));
push("last3_f", "price-action", { type: "last3_follow" }, mk((i) => C.r6[i] > 0 ? 1 : C.r6[i] < 0 ? -1 : 0));
push("always_buy", "baseline", { type: "always", dir: 1 }, mk(() => 1));
push("always_sell", "baseline", { type: "always", dir: -1 }, mk(() => -1));
{ const rnd = mulberry32(42); push("random42", "baseline", { type: "random" }, mk(() => (rnd() < 0.5 ? 1 : -1))); }
const fibOkAt = (d, i) => B.inZone[i] && ((d === 1 && B.upSwing[i]) || (d === -1 && !B.upSwing[i]));
push("prod_v1fib", "production", { type: "prod", id: "reversion-v1-fib" }, mk((i) => { const x = C.s[i]; if (!(C.vol12[i] < 0.0009)) return 0; const d = x > 0.33 ? 1 : x < -0.33 ? -1 : 0; return d !== 0 && fibOkAt(d, i) ? d : 0; }));
push("prod_v3fib", "production", { type: "prod", id: "reversion-v3-fib" }, mk((i) => { const x = C.s[i], mo = C.r24[i]; if (!(C.vol12[i] < 0.0012)) return 0; const d = x > 0.22 && mo > 0 ? 1 : x < -0.22 && mo < 0 ? -1 : 0; return d !== 0 && fibOkAt(d, i) ? d : 0; }));
push("prod_v6fib", "production", { type: "prod", id: "reversion-v6-fib" }, mk((i) => { const a = Math.abs(C.s[i]); if (!(C.vol12[i] < 0.0009 && a >= 0.63 && a <= 0.857)) return 0; const d = C.s[i] > 0 ? 1 : -1; return fibOkAt(d, i) ? d : 0; }));
push("prod_v7and", "production", { type: "prod", id: "reversion-v7-and" }, mk((i) => { const x = C.s[i]; if (!(C.vol12[i] < 0.0009)) return 0; const d = x > 0.33 ? 1 : x < -0.33 ? -1 : 0; if (d === 0 || !fibOkAt(d, i)) return 0; const dev = C.distSma20[i]; const ad = dev <= -3 ? 1 : dev >= 3 ? -1 : 0; return ad === d ? d : 0; }));
push("prod_v7relaxed", "production", { type: "prod", id: "reversion-v7-relaxed" }, mk((i) => { const x = C.s[i]; let d = 0; if (C.vol12[i] < 0.0009) d = x > 0.33 ? 1 : x < -0.33 ? -1 : 0; if (d !== 0 && !fibOkAt(d, i)) d = 0; const dev = C.distSma20[i]; const ad = dev <= -1 ? 1 : dev >= 1 ? -1 : 0; const adOk = ad !== 0 && fibOkAt(ad, i) ? ad : 0; if (d !== 0 && adOk !== 0 && d !== adOk) return 0; return d !== 0 ? d : adOk; }));
console.log(`atoms built: ${A.length}`);
const conds = {
  "vol<0.0009": mkCond((i) => C.vol12[i] < 0.0009), "vol<0.0012": mkCond((i) => C.vol12[i] < 0.0012), "vol<0.0018": mkCond((i) => C.vol12[i] < 0.0018),
  "er<0.35": mkCond((i) => C.er30[i] < 0.35), "er<0.45": mkCond((i) => C.er30[i] < 0.45), "er>0.55": mkCond((i) => C.er30[i] > 0.55), "er>0.65": mkCond((i) => C.er30[i] > 0.65),
  "expansion>1.3": mkCond((i) => C.expansion[i] > 1.3), "sessMin<30": mkCond((i) => C.sessMinute < 30), "sessMin>=30": mkCond((i) => C.sessMinute >= 30),
  "h0-5": mkCond((i) => C.hour[i] >= 0 && C.hour[i] < 6), "h6-11": mkCond((i) => C.hour[i] >= 6 && C.hour[i] < 12), "h12-17": mkCond((i) => C.hour[i] >= 12 && C.hour[i] < 18), "h18-23": mkCond((i) => C.hour[i] >= 18),
  "inZone": mkCond((i) => B.inZone[i] === 1), "upSwing": mkCond((i) => B.upSwing[i] === 1), "bullDiv": mkCond((i) => B.bullDiv[i] === 1), "bearDiv": mkCond((i) => B.bearDiv[i] === 1),
};
console.log(`conditions: ${Object.keys(conds).length}`);
module.exports = { rows, N, N_D, L, C, B, INDEP, A, conds, eqs, mk, mkCond, stats, wilson, mulberry32 };
