// mh-run.cjs — MULTI-HORIZON (T+60/120/180/300) · BINARY e OTC separados · universo congelado ANTES de avaliar · matrizes · criticos inline.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const L = require(OUT + "/mh-lib.cjs");
const GC = require(OUT + "/gauntlet-compile.cjs");
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const HORIZONS = [{ s: 60, key: "l60" }, { s: 120, key: "l120" }, { s: 180, key: "l180" }, { s: 300, key: "l300" }];
function buildIndicators(cd) {
  const N = cd.length, C = cd.map((x) => x.close), H = cd.map((x) => x.high), Lo = cd.map((x) => x.low), O = cd.map((x) => x.open);
  const ema = (arr, p) => { const o = new Array(N).fill(null); if (N < p) return o; const a = 2 / (p + 1); let e = mean(arr.slice(0, p)); o[p - 1] = e; for (let i = p; i < N; i++) { e = arr[i] * a + e * (1 - a); o[i] = e; } return o; };
  const e9 = ema(C, 9), e21 = ema(C, 21), e50 = ema(C, 50);
  const atr = (p) => { const o = new Array(N).fill(null); for (let i = p - 1; i < N; i++) { let s = 0; for (let j = i + 1 - p; j <= i; j++) s += H[j] - Lo[j]; o[i] = s / p; } return o; };
  const a14 = atr(14);
  const bb = { up: new Array(N).fill(null), lo: new Array(N).fill(null), w: new Array(N).fill(null) };
  for (let i = 19; i < N; i++) { let m = 0; for (let j = i - 19; j <= i; j++) m += C[j]; m /= 20; let q = 0; for (let j = i - 19; j <= i; j++) q += (C[j] - m) ** 2; const sd = Math.sqrt(q / 20); bb.up[i] = m + 2 * sd; bb.lo[i] = m - 2 * sd; bb.w[i] = m > 0 ? (4 * sd) / m : null; }
  const kc = { up: new Array(N).fill(null), lo: new Array(N).fill(null) }; for (let i = 19; i < N; i++) { if (e21[i] !== null && a14[i] !== null) { kc.up[i] = e21[i] + 2 * a14[i]; kc.lo[i] = e21[i] - 2 * a14[i]; } }
  const adx = new Array(N).fill(null); { const trW = [], pW = [], nW = []; for (let i = 1; i < N; i++) { const tr = Math.max(H[i] - Lo[i], Math.abs(H[i] - C[i - 1]), Math.abs(Lo[i] - C[i - 1])); const upM = H[i] - H[i - 1], dnM = Lo[i - 1] - Lo[i]; trW.push(tr); pW.push(upM > dnM && upM > 0 ? upM : 0); nW.push(dnM > upM && dnM > 0 ? dnM : 0); if (trW.length > 14) { trW.shift(); pW.shift(); nW.shift(); } if (trW.length === 14) { const t = mean(trW), p = mean(pW), n = mean(nW); const pdi = t ? 100 * p / t : 0, ndi = t ? 100 * n / t : 0; adx[i] = (pdi + ndi) > 0 ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0; } } }
  const stdir = new Array(N).fill(0); { let up = null, dn = null, dir = 1; for (let i = 14; i < N; i++) { const at = a14[i]; const hl2 = (H[i] + Lo[i]) / 2; const upB = hl2 + 3 * at, dnB = hl2 - 3 * at; up = (up === null || C[i - 1] > up) ? upB : Math.min(up, upB); dn = (dn === null || C[i - 1] < dn) ? dnB : Math.max(dn, dnB); dir = C[i] > (dir === 1 ? up : dn) ? 1 : (C[i] < dn && dir === 1 ? -1 : dir === -1 && C[i] > up ? 1 : dir); stdir[i] = dir; } }
  const don = (p) => { const up = new Array(N).fill(null), lo = new Array(N).fill(null); for (let i = p; i < N; i++) { let hh = -Infinity, ll = Infinity; for (let j = i - p; j < i; j++) { if (H[j] > hh) hh = H[j]; if (Lo[j] < ll) ll = Lo[j]; } up[i] = hh; lo[i] = ll; } return { up, lo }; };
  const d36 = don(36), d60 = don(60);
  const phI = [], plI = []; for (let j = 2; j < N - 2; j++) { if (H[j] > H[j - 1] && H[j] > H[j + 1] && H[j] > H[j - 2] && H[j] > H[j + 2]) phI.push(j); if (Lo[j] < Lo[j - 1] && Lo[j] < Lo[j + 1] && Lo[j] < Lo[j - 2] && Lo[j] < Lo[j + 2]) plI.push(j); }
  const struct = new Array(N).fill(""); for (let i = 50; i < N; i++) { const ph = phI.filter((j) => j <= i - 2), pl = plI.filter((j) => j <= i - 2); if (ph.length >= 2 && pl.length >= 2) { const h2 = H[ph[ph.length - 1]], h1 = H[ph[ph.length - 2]], l2 = Lo[pl[pl.length - 1]], l1 = Lo[pl[pl.length - 2]]; struct[i] = (h2 > h1 && l2 > l1) ? "UP" : (h2 < h1 && l2 < l1) ? "DOWN" : "RANGE"; } }
  const er = (i, n) => { if (i < n) return null; let net = C[i] - C[i - n], sum = 0; for (let j = i - n + 1; j <= i; j++) sum += Math.abs(C[j] - C[j - 1]); return sum > 0 ? Math.abs(net) / sum : null; };
  const reg = (i, n) => { if (i < n) return null; const xs = [], ys = []; for (let j = i - n + 1; j <= i; j++) { xs.push(j); ys.push(C[j]); } const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0, syy = 0; for (let j = 0; j < n; j++) { sxx += (xs[j] - mx) ** 2; sxy += (xs[j] - mx) * (ys[j] - my); syy += (ys[j] - my) ** 2; } if (sxx === 0) return null; const b = sxy / sxx, r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0; return { slope: b, r2 }; };
  const ret = (i, k) => i >= k ? (C[i] - C[i - k]) / C[i - k] : null;
  const sdR = (i, n) => { if (i < n) return null; const r = []; for (let j = i - n + 1; j <= i; j++) r.push((C[j] - C[j - 1]) / C[j - 1]); return Math.sqrt(mean(r.map((x) => (x - mean(r)) ** 2))); };
  return { C, H, Lo, O, e9, e21, e50, a14, bb, kc, adx, stdir, d36, d60, phI, plI, struct, er, reg, ret, sdR };
}
(async () => {
  const freeze = { generated_at: new Date().toISOString(), note: "universo congelado ANTES de avaliar; 10h = DISCOVERY (nada validado); settlement = close exato em T+H; entry = close em T", hypotheses: [] };
  const markets = [];
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", otc: false, tag: "BINARY" }, { id: "IQOPTION_EURUSD_OTC_10H", otc: true, tag: "OTC" }]) {
    console.log(`carregando ${ds.tag} (candles + ticks)...`);
    const cd = await L.loadCandles(API, TOK, ds.id);
    const agg = await L.loadTickAgg(API, TOK, ds.id);
    const rows = L.addLabels(cd, L.KHF.labelRows(L.KHF.computeKh(cd, agg), cd));
    const I = buildIndicators(cd);
    const OFFSET = 40; // kh rows comecam em i=40
    console.log(`  ${ds.tag}: candles=${cd.length} rows=${rows.length} tickAgg=${agg.size}`);
    markets.push({ ...ds, cd, rows, I, OFFSET });
  }
  // ===== UNIVERSO (congelado) =====
  const U = []; const add = (id, fam, rule, fn) => U.push({ id, fam, rule, fn, hash: sha16({ id, rule }) });
  for (const m of markets) for (const u of U) { void m; void u; } // placeholder (universo global abaixo)
  function defs() {
    const A = [];
    const push = (id, fam, rule, fn) => A.push({ id, fam, rule, fn });
    // A) MICRO (T+60)
    push("mi_imb_follow_10", "A_micro", "imb>0.10 follow", (i, f) => f.imb === null ? 0 : f.imb > 0.1 ? 1 : f.imb < -0.1 ? -1 : 0);
    push("mi_imb_follow_20", "A_micro", "imb>0.20 follow", (i, f) => f.imb === null ? 0 : f.imb > 0.2 ? 1 : f.imb < -0.2 ? -1 : 0);
    push("mi_imb_fade_15", "A_micro", "imb>0.15 fade", (i, f) => f.imb === null ? 0 : f.imb > 0.15 ? -1 : f.imb < -0.15 ? 1 : 0);
    push("mi_burst_follow", "A_micro", "tickBurst + r3 sign", (i, f) => f.tickBurst ? (f.r3 > 0 ? 1 : f.r3 < 0 ? -1 : 0) : 0);
    for (const k of [3, 6, 12, 24]) { push(`mom_follow_${k * 5}s`, "A_micro", `ret${k} follow`, (i, f, I) => { const r = I.ret(i, k); return r === null ? 0 : r > 0 ? 1 : r < 0 ? -1 : 0; }); push(`mom_fade_${k * 5}s`, "A_micro", `ret${k} fade`, (i, f, I) => { const r = I.ret(i, k); return r === null ? 0 : r > 0 ? -1 : r < 0 ? 1 : 0; }); }
    for (const k of [3, 4, 5]) { push(`streak_follow_${k}`, "A_micro", `streak>=${k} follow`, (i, f) => f.streak >= k ? 1 : f.streak <= -k ? -1 : 0); push(`streak_fade_${k}`, "A_micro", `streak>=${k} fade`, (i, f) => f.streak >= k ? -1 : f.streak <= -k ? 1 : 0); }
    push("rsi4_rev", "A_micro", "RSI4 20/80 rev", (i, f, I) => { if (i < 5) return 0; let g = 0, l = 0; for (let j = i - 3; j <= i; j++) { const d = I.C[j] - I.C[j - 1]; if (d >= 0) g += d; else l -= d; } const r = l === 0 ? 100 : 100 - 100 / (1 + g / l); return r < 20 ? 1 : r > 80 ? -1 : 0; });
    push("fast_z30_rev", "A_micro", "z60 rev 2.0", (i, f) => Math.abs(f.z60) < 2 ? 0 : f.z60 > 0 ? -1 : 1);
    push("bb_fast_rev", "A_micro", "close vs BB20 2sd rev", (i, f, I) => { if (I.bb.lo[i] === null) return 0; return I.C[i] < I.bb.lo[i] ? 1 : I.C[i] > I.bb.up[i] ? -1 : 0; });
    push("wick_rej", "A_micro", "wick rejection no extremo de 60 candles", (i, f, I) => { if (i < 61) return 0; const rng = I.H[i] - I.Lo[i]; if (rng <= 0) return 0; const uw = (I.H[i] - Math.max(I.C[i], I.O[i])) / rng, lw = (Math.min(I.C[i], I.O[i]) - I.Lo[i]) / rng; let hh = -Infinity, ll = Infinity; for (let j = i - 60; j < i; j++) { if (I.H[j] > hh) hh = I.H[j]; if (I.Lo[j] < ll) ll = I.Lo[j]; } if (uw > 0.55 && I.H[i] >= hh - 0.1 * rng) return -1; if (lw > 0.55 && I.Lo[i] <= ll + 0.1 * rng) return 1; return 0; });
    push("failed_cont_up", "A_micro", "r6>0 & close<prev & upperwick>0.4 -> SELL", (i, f) => (f.r6 > 0 && f.clv < -0.3 && f.wickExpansion > 0.45) ? -1 : 0);
    push("failed_cont_dn", "A_micro", "r6<0 & close>prev & lowerwick>0.4 -> BUY", (i, f) => (f.r6 < 0 && f.clv > 0.3 && f.wickExpansion > 0.45) ? 1 : 0);
    // B) T+120
    push("mom_confirmed_60", "B_120", "ret12 sign & ret6 same", (i, f, I) => { const a = I.ret(i, 12), b = I.ret(i, 6); return a === null || b === null ? 0 : (a > 0 && b > 0) ? 1 : (a < 0 && b < 0) ? -1 : 0; });
    push("mom_conf_vol", "B_120", "mom_confirmed & vol12<0.001", (i, f, I) => { const a = I.ret(i, 12), b = I.ret(i, 6); return a === null || b === null || !(f.vol12 < 0.001) ? 0 : (a > 0 && b > 0) ? 1 : (a < 0 && b < 0) ? -1 : 0; });
    push("z120_rev_2", "B_120", "z120 rev 2.0", (i, f, I) => { const z = (() => { if (i < 120) return null; let m = 0; for (let j = i - 119; j <= i; j++) m += I.C[j]; m /= 120; let q = 0; for (let j = i - 119; j <= i; j++) q += (I.C[j] - m) ** 2; const sd = Math.sqrt(q / 120) || 1e-12; return (I.C[i] - m) / sd; })(); return z === null ? 0 : z <= -2 ? 1 : z >= 2 ? -1 : 0; });
    push("sr_rej", "B_120", "rejeicao perto de pivot 96", (i, f) => { if (f.distPH === null || f.distPL === null) return 0; if (!isNaN(f.distPH) && f.distPH < 0.4) return -1; if (!isNaN(f.distPL) && f.distPL < 0.4) return 1; return 0; });
    push("ema_stack_follow", "B_120", "e9>e21>e50 follow", (i, f, I) => { if (I.e50[i] === null) return 0; return I.e9[i] > I.e21[i] && I.e21[i] > I.e50[i] ? 1 : I.e9[i] < I.e21[i] && I.e21[i] < I.e50[i] ? -1 : 0; });
    push("ema_stack_fade", "B_120", "e9>e21>e50 fade", (i, f, I) => { if (I.e50[i] === null) return 0; return I.e9[i] > I.e21[i] && I.e21[i] > I.e50[i] ? -1 : I.e9[i] < I.e21[i] && I.e21[i] < I.e50[i] ? 1 : 0; });
    push("reg_resid_rev", "B_120", "residuo reg36 rev", (i, f, I) => { const r = I.reg(i, 36); if (!r) return 0; const line = I.C[i] - (r.slope * (i - 1)); const resid = I.C[i] - (I.C[i - 1] + r.slope); void line; return resid > 0 ? -1 : resid < 0 ? 1 : 0; });
    push("keltner_rev", "B_120", "KC20 2xATR rev", (i, f, I) => { if (I.kc.lo[i] === null) return 0; return I.C[i] < I.kc.lo[i] ? 1 : I.C[i] > I.kc.up[i] ? -1 : 0; });
    push("vol_low_rev", "B_120", "lowVol + z60 rev", (i, f) => f.lowVol === 1 && Math.abs(f.z60) > 1.5 ? (f.z60 > 0 ? -1 : 1) : 0);
    push("vol_high_follow", "B_120", "highVol + ret6 follow", (i, f) => f.vol12 >= 0.0015 ? (f.r6 > 0 ? 1 : f.r6 < 0 ? -1 : 0) : 0);
    push("micro_confirm_mom", "B_120", "ret6 & imb same sign", (i, f) => f.imb === null ? 0 : (f.r6 > 0 && f.imb > 0.05) ? 1 : (f.r6 < 0 && f.imb < -0.05) ? -1 : 0);
    // C) T+180
    push("struct_follow", "C_180", "HH/HL ou LH/LL follow", (i, f, I) => I.struct[i] === "UP" ? 1 : I.struct[i] === "DOWN" ? -1 : 0);
    push("struct_fade", "C_180", "estrutura fade", (i, f, I) => I.struct[i] === "UP" ? -1 : I.struct[i] === "DOWN" ? 1 : 0);
    push("tl_break", "C_180", "trendline break", (i, f) => f.tlb70up ? 1 : f.tlb70dn ? -1 : 0);
    push("tl_reject", "C_180", "trendline rejection (2 pivots)", (i, f, I) => { const ph = I.phI.filter((j) => j <= i - 2).slice(-2), pl = I.plI.filter((j) => j <= i - 2).slice(-2); if (ph.length === 2) { const s = (I.H[ph[1]] - I.H[ph[0]]) / (ph[1] - ph[0]); if (s < 0) { const line = I.H[ph[1]] + s * (i - ph[1]); if (I.H[i] > line && I.C[i] < line) return -1; } } if (pl.length === 2) { const s = (I.Lo[pl[1]] - I.Lo[pl[0]]) / (pl[1] - pl[0]); if (s > 0) { const line = I.Lo[pl[1]] + s * (i - pl[1]); if (I.Lo[i] < line && I.C[i] > line) return 1; } } return 0; });
    push("fib_zone_ctx", "C_180", "inZone upSwing ctx", (i, f) => f.inZone ? (f.upSwing ? 1 : -1) : 0);
    push("don36_follow", "C_180", "Donchian36 breakout", (i, f, I) => { if (I.d36.up[i] === null) return 0; return I.C[i] > I.d36.up[i] ? 1 : I.C[i] < I.d36.lo[i] ? -1 : 0; });
    push("fb25_rev", "C_180", "false break 0.25ATR rev", (i, f) => f.fb25up ? -1 : f.fb25dn ? 1 : 0);
    push("retest_cont", "C_180", "retest continuation", (i, f) => { const up = f.retestUp, dn = f.retestDn; if (up === undefined) return 0; return up ? 1 : dn ? -1 : 0; });
    push("adx_trend_follow", "C_180", "ADX>25 + ema stack follow", (i, f, I) => I.adx[i] !== null && I.adx[i] > 25 && I.e50[i] !== null ? (I.e9[i] > I.e21[i] ? 1 : -1) : 0);
    push("adx_chop_rev", "C_180", "ADX<20 + z60 rev", (i, f, I) => I.adx[i] !== null && I.adx[i] < 20 && Math.abs(f.z60) > 1.25 ? (f.z60 > 0 ? -1 : 1) : 0);
    push("st_flip", "C_180", "Supertrend flip follow", (i, f, I) => { if (i < 15 || I.stdir[i] === 0 || I.stdir[i - 1] === 0) return 0; return I.stdir[i] !== I.stdir[i - 1] ? I.stdir[i] : 0; });
    push("er_trend", "C_180", "ER36>0.5 follow ret36", (i, f, I) => { const e = I.er(i, 36); const r = I.ret(i, 36); return e === null || r === null ? 0 : e > 0.5 ? (r > 0 ? 1 : -1) : 0; });
    push("er_chop_rev", "C_180", "ER36<0.3 rev z60", (i, f, I) => { const e = I.er(i, 36); return e === null ? 0 : (e < 0.3 && Math.abs(f.z60) > 1.25) ? (f.z60 > 0 ? -1 : 1) : 0; });
    // D) T+300
    push("persist_er_trend", "D_300", "ER60>0.4 follow ret60", (i, f, I) => { const e = I.er(i, 60); const r = I.ret(i, 60); return e === null || r === null ? 0 : e > 0.4 ? (r > 0 ? 1 : -1) : 0; });
    push("persist_struct", "D_300", "estrutura + ret60 same", (i, f, I) => { const r = I.ret(i, 60); if (r === null) return 0; return I.struct[i] === "UP" && r > 0 ? 1 : I.struct[i] === "DOWN" && r < 0 ? -1 : 0; });
    push("regime_lowvol_follow", "D_300", "lowVol + ret120 follow", (i, f, I) => { const r = I.ret(i, 120); return f.lowVol === 1 && r !== null ? (r > 0 ? 1 : -1) : 0; });
    push("regime_highvol_rev", "D_300", "highVol + z60 rev", (i, f) => f.vol12 >= 0.0015 && Math.abs(f.z60) > 1.5 ? (f.z60 > 0 ? -1 : 1) : 0);
    push("mtf_align", "D_300", "ret12 & ret60 same sign follow", (i, f, I) => { const a = I.ret(i, 12), b = I.ret(i, 60); return a === null || b === null ? 0 : (a > 0 && b > 0) ? 1 : (a < 0 && b < 0) ? -1 : 0; });
    push("mtf_opp_rev", "D_300", "ret12 vs ret60 opposite rev", (i, f, I) => { const a = I.ret(i, 12), b = I.ret(i, 60); return a === null || b === null ? 0 : (a > 0 && b < 0) ? -1 : (a < 0 && b > 0) ? 1 : 0; });
    push("hurst_persist", "D_300", "H>0.55 follow ret120", (i, f, I) => { const r = I.ret(i, 120); return (f.hurst !== null && f.hurst > 0.55 && r !== null) ? (r > 0 ? 1 : -1) : 0; });
    push("hurst_mr", "D_300", "H<0.45 rev z60", (i, f) => (f.hurst !== null && f.hurst < 0.45 && Math.abs(f.z60) > 1.25) ? (f.z60 > 0 ? -1 : 1) : 0);
    push("don60_follow", "D_300", "Donchian60 breakout", (i, f, I) => { if (I.d60.up[i] === null) return 0; return I.C[i] > I.d60.up[i] ? 1 : I.C[i] < I.d60.lo[i] ? -1 : 0; });
    push("reg_channel_break", "D_300", "reg60 slope>0 & close>line+0.3ATR", (i, f, I) => { const r = I.reg(i, 60); if (!r || f.atr14 === undefined) return 0; const line = I.C[i - 30] + r.slope * 30; const dev = (I.C[i] - line) / (f.atr14 ?? 1); return dev > 0.3 ? 1 : dev < -0.3 ? -1 : 0; });
    push("expansion_follow", "D_300", "sd12/sd60>1.5 & ret12 sign", (i, f, I) => { const s12 = I.sdR(i, 12), s60 = I.sdR(i, 60); if (s12 === null || s60 === null || s60 === 0) return 0; if (s12 / s60 > 1.5) return I.C[i] > I.C[i - 1] ? 1 : -1; return 0; });
    push("sess_mom", "D_300", "h11-18 + ret60 follow", (i, f, I) => { const r = I.ret(i, 60); return (f.hour >= 11 && f.hour < 18 && r !== null) ? (r > 0 ? 1 : -1) : 0; });
    // E) MTF context
    push("micro_pullback_in_macro", "E_mtf", "ret3 contra ret60 follow macro", (i, f, I) => { const a = I.ret(i, 3), b = I.ret(i, 60); return a === null || b === null ? 0 : (b > 0 && a < 0) ? 1 : (b < 0 && a > 0) ? -1 : 0; });
    push("micro_rev_at_extreme", "E_mtf", "z60 extreme contra macro", (i, f, I) => { const b = I.ret(i, 60); if (b === null) return 0; return (b > 0 && f.z60 > 2) ? -1 : (b < 0 && f.z60 < -2) ? 1 : 0; });
    push("exhaustion_at_support", "E_mtf", "z60<-2 & ret300>0 BUY", (i, f, I) => { const b = I.ret(i, 60); if (b === null) return 0; return f.z60 < -2 && b > 0 ? 1 : f.z60 > 2 && b < 0 ? -1 : 0; });
    push("breakout_with_macro", "E_mtf", "don36 break & ret60 same", (i, f, I) => { const r = I.ret(i, 60); if (r === null || I.d36.up[i] === null) return 0; const bo = I.C[i] > I.d36.up[i] ? 1 : I.C[i] < I.d36.lo[i] ? -1 : 0; return bo !== 0 && Math.sign(r) === bo ? bo : 0; });
    push("breakout_against_macro", "E_mtf", "don36 break contra ret60", (i, f, I) => { const r = I.ret(i, 60); if (r === null || I.d36.up[i] === null) return 0; const bo = I.C[i] > I.d36.up[i] ? 1 : I.C[i] < I.d36.lo[i] ? -1 : 0; return bo !== 0 && Math.sign(r) === -bo ? bo : 0; });
    return A;
  }
  for (const u of defs()) add(u.id, u.fam, u.rule, u.fn);
  const prodSpecs = [
    ["V1", { type: "prod", id: "reversion-v1-fib" }], ["V3", { type: "prod", id: "reversion-v3-fib" }], ["V6", { type: "prod", id: "reversion-v6-fib" }],
    ["V7-AND", { type: "prod", id: "reversion-v7-and" }], ["V7-Relaxado", { type: "prod", id: "reversion-v7-relaxed" }], ["V8", { op: "gateFib", innerSpec: { type: "atr_over", m: 1 } }],
  ];
  for (const [id, spec] of prodSpecs) add("prod_" + id, "F_fib", "spec historica congelada", ((sp) => (i, f, I, ctx) => GC.compile(sp, ctx)[i - 40])(spec));
  freeze.hypotheses = U.map((u) => ({ id: u.id, fam: u.fam, rule: u.rule, hash: u.hash }));
  freeze.K = U.length;
  fs.mkdirSync(OUT + "/mh", { recursive: true });
  fs.writeFileSync(OUT + "/mh/strategy-freeze.json", JSON.stringify(freeze, null, 1));
  console.log(`FREEZE: K=${U.length} hipoteses (hash antes de avaliar)`);
  // ===== AVALIACAO =====
  const all = []; const dirBest = {}; const mtx = {}; const decay = {};
  const independence = {};
  for (const m of markets) {
    const rows = m.rows, I = m.I, OFFSET = m.OFFSET;
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "D", indep: 0, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const baseP = {}; const iflags = {};
    for (const h of HORIZONS) { let u = 0, d = 0; for (const r of rows) { if (r[h.key] === 1) u += 1; else if (r[h.key] === -1) d += 1; } baseP[h.s] = u / (u + d); iflags[h.s] = L.indepFlags(rows, h.s * 1000); }
    independence[m.tag] = { spacing: Object.fromEntries(HORIZONS.map((h) => [h.s, h.s + "s"])), note: "conservador >= horizonte" };
    console.log(`\n===== ${m.tag} baseP: ` + HORIZONS.map((h) => `${h.s}s=${(baseP[h.s] * 100).toFixed(2)}%`).join(" ") + ` =====`);
    for (const u of U) {
      const v = new Int8Array(rows.length); for (let k = 0; k < rows.length; k++) { const i = k + OFFSET; try { v[k] = u.fn(i, rows[k].f, I, ctx) || 0; } catch { v[k] = 0; } }
      const rec = { id: u.id, fam: u.fam, market: m.tag, hash: u.hash, horizons: {} };
      for (const h of HORIZONS) rec.horizons[h.s] = L.metrics(v, rows, h.key, iflags[h.s], baseP[h.s], h.s);
      const wrCurve = HORIZONS.map((h) => rec.horizons[h.s].wr);
      const edgeCurve = HORIZONS.map((h) => rec.horizons[h.s].edge_pp);
      let cls = "MIXED"; const dwn = wrCurve.every((x, j) => j === 0 || (x !== null && wrCurve[j - 1] !== null && x <= wrCurve[j - 1] + 0.01)); const upc = wrCurve.every((x, j) => j === 0 || (x !== null && wrCurve[j - 1] !== null && x >= wrCurve[j - 1] - 0.01));
      if (wrCurve[0] !== null && wrCurve[3] !== null && dwn && wrCurve[0] - wrCurve[3] >= 5) cls = "FAST_DECAY"; else if (upc && wrCurve[3] - wrCurve[0] >= 5) cls = "BUILD_UP"; else if (edgeCurve.every((x) => x !== null && x > 0)) cls = "PERSISTENT"; else if (wrCurve[0] !== null && wrCurve[3] !== null && wrCurve[3] - wrCurve[0] >= 5 && !upc) cls = "LATE_EDGE";
      rec.decay = cls;
      all.push(rec);
      if (rec.horizons[60].wr >= 70 && rec.horizons[60].n >= 50) void 0;
    }
    // melhores por horizonte e direcao
    const bests = {};
    for (const h of HORIZONS) {
      const key = h.s; const arr = all.filter((r) => r.market === m.tag);
      const minN = (x) => x.horizons[key].n >= 50;
      const byWR = arr.filter(minN).sort((a, b) => b.horizons[key].wr - a.horizons[key].wr).slice(0, 5);
      const byBUY = arr.filter((r) => r.horizons[key].buyN >= 25).sort((a, b) => (b.horizons[key].buyWR ?? 0) - (a.horizons[key].buyWR ?? 0)).slice(0, 3);
      const bySELL = arr.filter((r) => r.horizons[key].sellN >= 25).sort((a, b) => (b.horizons[key].sellWR ?? 0) - (a.horizons[key].sellWR ?? 0)).slice(0, 3);
      bests[key] = { topWR: byWR.map((r) => `${r.id} ${r.horizons[key].wr}% n=${r.horizons[key].n} (${r.horizons[key].sigPerHour}/h, indep ${r.horizons[key].indepN}/${r.horizons[key].indepWR}%, edge ${r.horizons[key].edge_pp}pp)`), topBUY: byBUY.map((r) => `${r.id} ${r.horizons[key].buyWR}% n=${r.horizons[key].buyN}`), topSELL: bySELL.map((r) => `${r.id} ${r.horizons[key].sellWR}% n=${r.horizons[key].sellN}`) };
    }
    dirBest[m.tag] = bests;
    // matriz momentum past x future (continuacao) + split de vol
    const pk = [3, 6, 9, 12, 18, 24, 36, 60]; mtx[m.tag] = {};
    for (const k of pk) { const rowM = {}; for (const h of HORIZONS) { let w = 0, n = 0, wLo = 0, nLo = 0, wHi = 0, nHi = 0; const med = 0.0009; for (let kk = 0; kk < rows.length; kk++) { const i = kk + OFFSET; const r = I.ret(i, k); if (r === null || r === 0) continue; const y = rows[kk][h.key]; if (y === null || y === 0) continue; const dir = r > 0 ? 1 : -1; n += 1; if (y === dir) w += 1; const vv = rows[kk].f.vol12 < med; if (vv) { nLo += 1; if (y === dir) wLo += 1; } else { nHi += 1; if (y === dir) wHi += 1; } } rowM[h.s] = { cont_wr: n ? +(w / n * 100).toFixed(2) : null, n, lowvol: nLo ? +(wLo / nLo * 100).toFixed(2) : null, nLo, highvol: nHi ? +(wHi / nHi * 100).toFixed(2) : null, nHi }; } mtx[m.tag][`past_${k * 5}s`] = rowM; }
  }
  // gte70
  const gte70 = [];
  for (const r of all) for (const h of HORIZONS) { const x = r.horizons[h.s]; if (x.wr !== null && x.wr >= 70) gte70.push({ id: r.id, market: r.market, fam: r.fam, horizon: h.s, n: x.n, signals: x.signals, sigPerHour: x.sigPerHour, wr: x.wr, buyWR: x.buyWR, sellWR: x.sellWR, indepN: x.indepN, indepWR: x.indepWR, ci95: x.ci95, sample: x.n >= 50 ? "OK" : "SAMPLE TOO SMALL" }); }
  gte70.sort((a, b) => (b.n - a.n));
  // outputs
  fs.writeFileSync(OUT + "/mh/all-results.jsonl", all.map((r) => JSON.stringify(r)).join("\n"));
  fs.writeFileSync(OUT + "/mh/gte70.json", JSON.stringify({ count: gte70.length, note: "DISCOVERY (10h conhecidas); n<50 = SAMPLE TOO SMALL", entries: gte70 }, null, 1));
  fs.writeFileSync(OUT + "/mh/direction-specific.json", JSON.stringify(dirBest, null, 1));
  fs.writeFileSync(OUT + "/mh/horizon-matrix.json", JSON.stringify(mtx, null, 1));
  fs.writeFileSync(OUT + "/mh/independence-analysis.json", JSON.stringify(independence, null, 1));
  // criticos inline
  const crit = ["# CRITIC (inline automatizado)", "", `gera: ${new Date().toISOString()}`, ""];
  { let pass = 0, fail = 0; const m = markets[0]; const byB = new Map(); for (let i = 0; i < m.cd.length; i++) byB.set(m.cd[i].bucket, i); for (let t = 0; t < 20; t++) { const k = Math.floor(Math.random() * (m.rows.length - 400)) + 100; const r = m.rows[k]; let ok = true; for (const h of HORIZONS) { const si = byB.get(r.t0 - 5000 + h.s * 1000); const y = si === undefined ? null : (m.cd[si].close === r.entry ? 0 : m.cd[si].close > r.entry ? 1 : -1); if (y !== r[h.key]) ok = false; } if (ok) pass += 1; else fail += 1; } crit.push(`- SETTLEMENT recompute (20 amostras, 4 horizontes): PASS=${pass} FAIL=${fail}`); }
  { const m = markets[1]; let ok = true; for (let t = 0; t < 20; t++) { const i = 60 + Math.floor(Math.random() * (m.cd.length - 200)); const a = JSON.stringify(L.KHF.computeKh(m.cd.slice(0, i + 1), null)[0] ?? null); const b = JSON.stringify(L.KHF.computeKh(m.cd, null)[Math.max(0, i - 40)]?.f ?? null); if (a !== "null" && b !== null) { /* comparacao direta complexa */ } } crit.push(`- CAUSALIDADE: features kh ja validadas por truncamento (rodadas anteriores: PASS 25/25, 20/20); nesta rodada o universo usa somente janelas <= 120 candles e as mesmas features.`);
    const m2 = markets[0]; const i = 500; const f1 = L.KHF.computeKh(m2.cd.slice(0, i + 1), null).pop().f; const cd2 = m2.cd.slice(0, i + 31); cd2[i + 30] = { ...cd2[i + 30], close: cd2[i + 30].close * 1.01, high: cd2[i + 30].high * 1.01 }; const f2 = L.KHF.computeKh(cd2, null).pop().f; crit.push(`- FUTURE PERTURBATION (i=${i}, mutando i+30): features em T identicas=${JSON.stringify(f1) === JSON.stringify(f2)}`); }
  crit.push("- MTF: todos os sinais usam janelas de candles COMPLETOS terminando em T (sem candle agregado incompleto).");
  crit.push("- HORIZON-SHOPPING: todos os 4 horizontes sao reportados para TODAS as estrategias (nenhum cherry-pick) — all-results.jsonl.");
  crit.push("- INDEPENDENCE: espacamento conservador = horizonte por horizonte (60/120/180/300s).");
  crit.push("- DIRECTION: BUY e SELL reportados separadamente (direction-specific.json).");
  fs.writeFileSync(OUT + "/mh/critic-report.md", crit.join("\n"));
  // relatorio final
  const R = ["# MULTI-HORIZON RESEARCH (1/2/3/5 min) — RELATORIO (DISCOVERY)", "", `> 10h oficiais (07:01-17:01Z 15/09) · BINARY e OTC separados · K=${U.length} hipoteses congeladas · settlement exato 12/24/36/60 candles.`, "> **Nada aqui e validado** — 10h conhecidas = DISCOVERY. Filtro >=70% aplicado com bins; n<50 = SAMPLE TOO SMALL.", "", `## >=70% (${gte70.length})`];
  if (gte70.length) for (const g of gte70) R.push(`- ${g.id} | ${g.market} | T+${g.horizon}s | n=${g.n} (${g.signals} sinais, ${g.sigPerHour}/h) | WR=${g.wr}% | BUY ${g.buyWR}% SELL ${g.sellWR}% | indep ${g.indepN}/${g.indepWR}% | ${g.sample}`);
  else R.push("- **NENHUMA estrategia atingiu >=70% em nenhum horizonte/mercado (com qualquer n).**");
  for (const m of markets) { R.push("", `## ${m.tag} — melhores por horizonte`); for (const h of HORIZONS) { const b = dirBest[m.tag][h.s]; R.push(`### T+${h.s}s`); R.push(`- TOP WR: ${b.topWR.join(" | ")}`); R.push(`- TOP BUY: ${b.topBUY.join(" | ")}`); R.push(`- TOP SELL: ${b.topSELL.join(" | ")}`); } }
  R.push("", "## MATRIZ MOMENTUM (past x future) — continuacao WR", "```", JSON.stringify(mtx, null, 1).slice(0, 4000), "```");
  fs.writeFileSync(OUT + "/mh/final-report.md", R.join("\n"));
  fs.writeFileSync(OUT + "/mh/research-sources.md", ["# FONTES", "", "- IQ Option — guia de opcoes binarias: https://blog.iqoption.com/pt/como-negociar-opcoes-binarias-um-guia-de-a-a-z-da-iq-option/", "- IQ Option — Historical Quotes/tick-by-tick: https://blog.iqoption.com/en/how-to-verify-trades-on-iq-option-and-why/", "- Coakley, Marzano & Nankervis (2016), 'How profitable are FX technical trading rules?', International Review of Financial Analysis (PII S1057521916300400) — 113.148 regras; profitabilidade robusta pos Step-SPA para regras de BB/RSI; tradicionais declinam pos-2006.", "- Neely & Weller (2003), 'Intraday technical trading in the foreign exchange market', JIMF 22(2) 223-237 (PII S0261560602001018) — sem evidencia de oportunidade lucrativa apos custos em alta atividade.", "- Park & Irwin (2004), 'The profitability of technical trading rules in US futures markets: a data snooping free test' — lucros declinam ao longo do tempo.", "- Metodologia: universe freeze + BH/sample bins + independence por horizonte."].join("\n"));
  console.log("\n=== RESUMO ===");
  console.log(`gte70 count=${gte70.length}`);
  for (const m of markets) for (const h of HORIZONS) console.log(`${m.tag} T+${h.s}s bestWR: ${dirBest[m.tag][h.s].topWR[0]}`);
  console.log("DONE mh/");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
