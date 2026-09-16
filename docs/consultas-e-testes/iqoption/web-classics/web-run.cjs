// web-run.cjs — estrategias classicas da internet, parametros publicados (SEM tuning), causais. Testa nos datasets 10h (BINARY e OTC) e opcionalmente nos 167h.
const fs = require("fs");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function wilson(w, n) { if (!n) return [0, 0]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; }
function indicators(cd) {
  const N = cd.length; const C = cd.map((x) => x.close), H = cd.map((x) => x.high), L = cd.map((x) => x.low), O = cd.map((x) => x.open);
  const sma = (arr, i, p) => i + 1 >= p ? mean(arr.slice(i + 1 - p, i + 1)) : null;
  const emaArr = (arr, p) => { const o = new Array(N).fill(null); if (N < p) return o; const a = 2 / (p + 1); let e = mean(arr.slice(0, p)); o[p - 1] = e; for (let i = p; i < N; i++) { e = arr[i] * a + e * (1 - a); o[i] = e; } return o; };
  const rsiW = (p) => { const o = new Array(N).fill(null); let g = 0, l = 0; for (let i = 1; i < N; i++) { const d = C[i] - C[i - 1]; const up = d > 0 ? d : 0, dn = d < 0 ? -d : 0; if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; };
  const rsi2 = rsiW(2), rsi4 = rsiW(4), rsi7 = rsiW(7), rsi14 = rsiW(14);
  const e9 = emaArr(C, 9), e12 = emaArr(C, 12), e21 = emaArr(C, 21), e26 = emaArr(C, 26), e50 = emaArr(C, 50), e200 = emaArr(C, 200);
  const macd = C.map((_, i) => (e12[i] !== null && e26[i] !== null ? e12[i] - e26[i] : null));
  const mvals = macd.filter((x) => x !== null); const sig0 = emaArr(mvals, 9); const mSig = new Array(N).fill(null); let k = 0; for (let i = 0; i < N; i++) if (macd[i] !== null) { mSig[i] = sig0[k]; k += 1; }
  const stochK = (p, sp) => { const o = new Array(N).fill(null); for (let i = p - 1; i < N; i++) { const w = cd.slice(i + 1 - p, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); o[i] = hh === ll ? 50 : ((C[i] - ll) / (hh - ll)) * 100; } const d = new Array(N).fill(null); for (let i = 0; i < N; i++) { let s = 0, c = 0; for (let j = i - sp + 1; j <= i; j++) if (j >= 0 && o[j] !== null) { s += o[j]; c += 1; } d[i] = c === sp ? s / sp : null; } return { k: o, d }; };
  const st14 = stochK(14, 3), st5 = stochK(5, 3);
  const bb = (p, k) => { const up = new Array(N).fill(null), lo = new Array(N).fill(null), mid = new Array(N).fill(null), wid = new Array(N).fill(null); for (let i = p - 1; i < N; i++) { const w = C.slice(i + 1 - p, i + 1); const m = mean(w); const sd = Math.sqrt(mean(w.map((x) => (x - m) ** 2))); mid[i] = m; up[i] = m + k * sd; lo[i] = m - k * sd; wid[i] = m > 0 ? (2 * k * sd) / m : null; } return { up, lo, mid, wid }; };
  const BB = bb(20, 2), BB25 = bb(20, 2.5);
  const atr = (p) => { const o = new Array(N).fill(null); for (let i = p - 1; i < N; i++) o[i] = mean(cd.slice(i + 1 - p, i + 1).map((x) => x.high - x.low)); return o; };
  const a10 = atr(10), a14 = atr(14);
  const kcUp = C.map((_, i) => e21[i] !== null && a10[i] !== null ? e21[i] + 2 * a10[i] : null), kcLo = C.map((_, i) => e21[i] !== null && a10[i] !== null ? e21[i] - 2 * a10[i] : null);
  // SuperTrend (10, 3)
  const st = new Array(N).fill(null), stdir = new Array(N).fill(0); { let up = null, dn = null, dir = 1; for (let i = 10; i < N; i++) { const at = a10[i]; const hl2 = (H[i] + L[i]) / 2; const upB = hl2 + 3 * at, dnB = hl2 - 3 * at; up = (up === null || C[i - 1] > up) ? upB : (upB < up ? upB : up); dn = (dn === null || C[i - 1] < dn) ? dnB : (dnB > dn ? dnB : dn); dir = C[i] > (dir === 1 ? up : dn) ? (C[i] > up ? 1 : dir) : (C[i] < dn ? -1 : dir); st[i] = dir === 1 ? dn : up; stdir[i] = dir; } }
  // PSAR
  const psar = new Array(N).fill(null), pdir = new Array(N).fill(0); { let isUp = true, af = 0.02, ep = H[1], ps = L[1]; for (let i = 2; i < N; i++) { ps = ps + af * (ep - ps); if (isUp) { if (L[i] < ps) { isUp = false; ps = ep; ep = L[i]; af = 0.02; } else { if (H[i] > ep) { ep = H[i]; af = Math.min(0.2, af + 0.02); } } } else { if (H[i] > ps) { isUp = true; ps = ep; ep = H[i]; af = 0.02; } else { if (L[i] < ep) { ep = L[i]; af = Math.min(0.2, af + 0.02); } } } psar[i] = ps; pdir[i] = isUp ? 1 : -1; } }
  // Ichimoku
  const tenkan = new Array(N).fill(null), kijun = new Array(N).fill(null), senB = new Array(N).fill(null);
  for (let i = 8; i < N; i++) { const w = cd.slice(i - 8, i + 1); tenkan[i] = (Math.max(...w.map((x) => x.high)) + Math.min(...w.map((x) => x.low))) / 2; }
  for (let i = 25; i < N; i++) { const w = cd.slice(i - 25, i + 1); kijun[i] = (Math.max(...w.map((x) => x.high)) + Math.min(...w.map((x) => x.low))) / 2; }
  for (let i = 51; i < N; i++) { const w = cd.slice(i - 51, i + 1); senB[i] = (Math.max(...w.map((x) => x.high)) + Math.min(...w.map((x) => x.low))) / 2; }
  const cloudNow = (i) => (i - 26 >= 0 && tenkan[i - 26] !== null && kijun[i - 26] !== null && senB[i - 26] !== null) ? { top: Math.max(tenkan[i - 26], kijun[i - 26], senB[i - 26]), bot: Math.min(tenkan[i - 26], kijun[i - 26], senB[i - 26]) } : null;
  const cci = (p) => { const o = new Array(N).fill(null); for (let i = p - 1; i < N; i++) { const tp = []; for (let j = i + 1 - p; j <= i; j++) tp.push((H[j] + L[j] + C[j]) / 3); const m = mean(tp); const md = mean(tp.map((x) => Math.abs(x - m))); o[i] = md > 0 ? (tp[tp.length - 1] - m) / (0.015 * md) : 0; } return o; };
  const c20 = cci(20);
  const wr = (p) => { const o = new Array(N).fill(null); for (let i = p - 1; i < N; i++) { const w = cd.slice(i + 1 - p, i + 1); const hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low)); o[i] = hh === ll ? -50 : ((hh - C[i]) / (hh - ll)) * -100; } return o; };
  const w14 = wr(14);
  const roc = (p) => C.map((_, i) => i >= p ? (C[i] - C[i - p]) / C[i - p] : null);
  const roc10 = roc(10);
  // ADX approx (14)
  const adx = new Array(N).fill(null); { let trs = [], pdm = [], ndm = []; for (let i = 1; i < N; i++) { const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])); const upM = H[i] - H[i - 1], dnM = L[i - 1] - L[i]; const pd = upM > dnM && upM > 0 ? upM : 0, nd = dnM > upM && dnM > 0 ? dnM : 0; trs.push(tr); pdm.push(pd); ndm.push(nd); if (trs.length > 14) { trs.shift(); pdm.shift(); ndm.shift(); } if (trs.length === 14) { const trS = mean(trs), pS = mean(pdm), nS = mean(ndm); const pdi = trS ? 100 * pS / trS : 0, ndi = trS ? 100 * nS / trS : 0; adx[i] = (pdi + ndi) > 0 ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0; } } }
  const don = (p) => { const up = new Array(N).fill(null), lo = new Array(N).fill(null); for (let i = p; i < N; i++) { up[i] = Math.max(...H.slice(i - p, i)); lo[i] = Math.min(...L.slice(i - p, i)); } return { up, lo }; };
  const d20 = don(20), d55 = don(55);
  const ha = new Array(N).fill(null); { let haClose = C[0], haOpen = O[0]; for (let i = 0; i < N; i++) { haClose = (O[i] + H[i] + L[i] + C[i]) / 4; haOpen = i === 0 ? (O[i] + C[i]) / 2 : (haOpen + haClose) / 2; ha[i] = { o: haOpen, c: haClose }; } }
  return { C, H, L, O, sma, e9, e12, e21, e26, e50, e200, macd, mSig, rsi2, rsi4, rsi7, rsi14, st14, st5, BB, BB25, a14, kcUp, kcLo, stdir, st, psar, pdir, tenkan, kijun, senB, cloudNow, c20, w14, roc10, adx, d20, d55, ha };
}
function buildStrategies(I, cd) {
  const N = I.C.length; const S = [];
  const add = (id, src, fn) => S.push({ id, source: src, vec: (() => { const v = new Int8Array(N); for (let i = 0; i < N; i++) { try { v[i] = fn(i) || 0; } catch { v[i] = 0; } } return v; })() });
  const prev = (arr, i) => i > 0 ? arr[i - 1] : null;
  // 1-3 Connors RSI2
  add("connors_rsi2", "Connors/Alvarez, RSI(2), SMA200+F5", (i) => { const r = I.rsi2[i], s200 = I.sma(I.C, i, 200); if (r === null || s200 === null) return 0; if (I.C[i] > s200 && r < 10) return 1; if (I.C[i] < s200 && r > 90) return -1; return 0; });
  add("connors_rsi2_deep", "Connors deep RSI2<5/>95", (i) => { const r = I.rsi2[i], s200 = I.sma(I.C, i, 200); if (r === null || s200 === null) return 0; if (I.C[i] > s200 && r < 5) return 1; if (I.C[i] < s200 && r > 95) return -1; return 0; });
  add("connors_rsi2_3bars", "Connors pullback 3 barras", (i) => { if (i < 3) return 0; const s200 = I.sma(I.C, i, 200); if (s200 === null) return 0; const r0 = I.rsi2[i], r1 = I.rsi2[i - 1], r2 = I.rsi2[i - 2]; if (r0 === null || r1 === null || r2 === null) return 0; if (I.C[i] > s200 && r0 < 10 && r1 < 10 && r2 < 10) return 1; if (I.C[i] < s200 && r0 > 90 && r1 > 90 && r2 > 90) return -1; return 0; });
  // RSI classico
  add("rsi14_30_70", "RSI14 30/70 reversion", (i) => { const r = I.rsi14[i]; return r === null ? 0 : r < 30 ? 1 : r > 70 ? -1 : 0; });
  add("rsi14_20_80", "RSI14 20/80 deep", (i) => { const r = I.rsi14[i]; return r === null ? 0 : r < 20 ? 1 : r > 80 ? -1 : 0; });
  add("rsi4_bb_scalp", "FXOpen: RSI(4) 20/80 + Banda BB", (i) => { const r = I.rsi4[i]; if (r === null || I.BB.lo[i] === null) return 0; if (r < 20 && I.C[i] < I.BB.lo[i]) return 1; if (r > 80 && I.C[i] > I.BB.up[i]) return -1; return 0; });
  // Bollinger
  add("bb_reversion_2", "BB(20,2) reversion", (i) => { if (I.BB.lo[i] === null) return 0; return I.C[i] < I.BB.lo[i] ? 1 : I.C[i] > I.BB.up[i] ? -1 : 0; });
  add("bb_reversion_25", "BB(20,2.5) reversion", (i) => { if (I.BB25.lo[i] === null) return 0; return I.C[i] < I.BB25.lo[i] ? 1 : I.C[i] > I.BB25.up[i] ? -1 : 0; });
  add("bb_breakout", "BB(20,2) breakout follow", (i) => { if (I.BB.up[i] === null) return 0; return I.C[i] > I.BB.up[i] ? 1 : I.C[i] < I.BB.lo[i] ? -1 : 0; });
  add("ttm_squeeze", "TTM Squeeze (BB dentro KC) breakout", (i) => { if (i < 30 || I.BB.up[i] === null || I.kcUp[i] === null) return 0; let sq = false; for (let j = i - 12; j <= i; j++) if (I.BB.up[j] !== null && I.kcUp[j] !== null && I.BB.up[j] < I.kcUp[j] && I.BB.lo[j] > I.kcLo[j]) { sq = true; break; } if (!sq) return 0; return I.C[i] > I.BB.up[i - 1] ? 1 : I.C[i] < I.BB.lo[i - 1] ? -1 : 0; });
  add("keltner_reversion", "KC(20,2) reversion", (i) => { if (I.kcLo[i] === null) return 0; return I.C[i] < I.kcLo[i] ? 1 : I.C[i] > I.kcUp[i] ? -1 : 0; });
  add("keltner_rsi", "FXOpen: Keltner + RSI", (i) => { if (I.kcLo[i] === null || I.rsi14[i] === null) return 0; if (I.C[i] < I.kcLo[i] && I.rsi14[i] < 40) return 1; if (I.C[i] > I.kcUp[i] && I.rsi14[i] > 60) return -1; return 0; });
  // MACD
  add("macd_hist_zero", "MACD(12,26,9) hist cross 0", (i) => { if (i < 1 || I.macd[i] === null || I.mSig[i] === null || I.mSig[i - 1] === null) return 0; const h = I.macd[i] - I.mSig[i], hp = I.macd[i - 1] - I.mSig[i - 1]; return hp <= 0 && h > 0 ? 1 : hp >= 0 && h < 0 ? -1 : 0; });
  add("macd_signal_cross", "MACD signal cross", (i) => { if (i < 1 || I.macd[i] === null || I.mSig[i] === null) return 0; return I.macd[i - 1] <= I.mSig[i - 1] && I.macd[i] > I.mSig[i] ? 1 : I.macd[i - 1] >= I.mSig[i - 1] && I.macd[i] < I.mSig[i] ? -1 : 0; });
  add("macd_rsi_combo", "MACD hist + RSI50 (>0 & >50)", (i) => { if (I.macd[i] === null || I.rsi14[i] === null) return 0; const h = I.macd[i] - (I.mSig[i] ?? 0); return h > 0 && I.rsi14[i] > 50 ? 1 : h < 0 && I.rsi14[i] < 50 ? -1 : 0; });
  // Stochastic
  add("stoch_143_zones", "Stoch(14,3) cross em zonas", (i) => { if (i < 1 || I.st14.k[i] === null || I.st14.d[i] === null || I.st14.d[i - 1] === null) return 0; const k = I.st14.k[i], d = I.st14.d[i], kp = I.st14.k[i - 1], dp = I.st14.d[i - 1]; if (k < 20 && kp <= dp && k > d) return 1; if (k > 80 && kp >= dp && k < d) return -1; return 0; });
  add("stoch_533_rev", "Stoch(5,3,3) 20/80 reversion", (i) => { const k = I.st5.k[i]; return k === null ? 0 : k < 20 ? 1 : k > 80 ? -1 : 0; });
  // EMAs
  add("ema_9_21_cross", "EMA 9/21 cross", (i) => { if (i < 1 || I.e9[i] === null || I.e21[i] === null) return 0; return I.e9[i - 1] <= I.e21[i - 1] && I.e9[i] > I.e21[i] ? 1 : I.e9[i - 1] >= I.e21[i - 1] && I.e9[i] < I.e21[i] ? -1 : 0; });
  add("ema_50_200_cross", "Golden/Death cross 50/200", (i) => { if (i < 1 || I.e50[i] === null || I.e200[i] === null) return 0; return I.e50[i - 1] <= I.e200[i - 1] && I.e50[i] > I.e200[i] ? 1 : I.e50[i - 1] >= I.e200[i - 1] && I.e50[i] < I.e200[i] ? -1 : 0; });
  add("ema200_pullback", "EMA200 pullback a EMA21", (i) => { if (I.e200[i] === null || I.e21[i] === null) return 0; const dip = I.L[i] <= I.e21[i] && I.C[i] > I.e21[i]; const pop = I.H[i] >= I.e21[i] && I.C[i] < I.e21[i]; return I.e200[i] !== null && I.C[i] > I.e200[i] && dip ? 1 : I.C[i] < I.e200[i] && pop ? -1 : 0; });
  // SuperTrend / PSAR
  add("supertrend_10_3", "SuperTrend(10,3) flip", (i) => { if (i < 1 || I.stdir[i] === 0 || I.stdir[i - 1] === 0) return 0; return I.stdir[i] !== I.stdir[i - 1] ? I.stdir[i] : 0; });
  add("supertrend_rsi", "Supertrend + RSI<70/>30", (i) => { if (i < 1 || I.stdir[i] === 0 || I.rsi14[i] === null) return 0; if (I.stdir[i] !== I.stdir[i - 1]) { if (I.stdir[i] === 1 && I.rsi14[i] < 70) return 1; if (I.stdir[i] === -1 && I.rsi14[i] > 30) return -1; } return 0; });
  add("psar_flip", "PSAR flip", (i) => { if (i < 1 || I.pdir[i] === 0) return 0; return I.pdir[i] !== I.pdir[i - 1] ? I.pdir[i] : 0; });
  // Ichimoku
  add("ichimoku_kumo_break", "Preco rompe a nuvem", (i) => { const cl = I.cloudNow(i); if (!cl || i < 1) return 0; const prevCl = I.cloudNow(i - 1); if (!prevCl) return 0; if (I.C[i - 1] <= cl.top && I.C[i] > cl.top) return 1; if (I.C[i - 1] >= cl.bot && I.C[i] < cl.bot) return -1; return 0; });
  add("ichimoku_tk_above", "TK cross acima da nuvem", (i) => { if (i < 1 || I.tenkan[i] === null || I.kijun[i] === null) return 0; const cl = I.cloudNow(i + 0); if (!cl) return 0; if (I.tenkan[i - 1] <= I.kijun[i - 1] && I.tenkan[i] > I.kijun[i] && I.C[i] > cl.top) return 1; if (I.tenkan[i - 1] >= I.kijun[i - 1] && I.tenkan[i] < I.kijun[i] && I.C[i] < cl.bot) return -1; return 0; });
  // Donchian/Turtle
  add("turtle_d20", "Donchian 20 breakout", (i) => { if (I.d20.up[i] === null) return 0; return I.C[i] > I.d20.up[i] ? 1 : I.C[i] < I.d20.lo[i] ? -1 : 0; });
  add("turtle_d55", "Donchian 55 breakout", (i) => { if (I.d55.up[i] === null) return 0; return I.C[i] > I.d55.up[i] ? 1 : I.C[i] < I.d55.lo[i] ? -1 : 0; });
  add("inside_bar", "Inside bar breakout", (i) => { if (i < 2) return 0; const mother = I.H[i - 1] - I.L[i - 1] > (I.H[i - 2] - I.L[i - 2]); if (!mother) return 0; return I.C[i] > I.H[i - 1] ? 1 : I.C[i] < I.L[i - 1] ? -1 : 0; });
  add("engulfing_bb", "Engulfing em extremo BB", (i) => { if (i < 1 || I.BB.up[i] === null) return 0; const bull = I.C[i] > I.O[i] && I.C[i - 1] < I.O[i - 1] && I.C[i] > I.O[i - 1] && I.O[i] < I.C[i - 1]; const bear = I.C[i] < I.O[i] && I.C[i - 1] > I.O[i - 1] && I.C[i] < I.O[i - 1] && I.O[i] > I.C[i - 1]; if (bull && I.C[i - 1] < I.BB.lo[i - 1]) return 1; if (bear && I.C[i - 1] > I.BB.up[i - 1]) return -1; return 0; });
  add("pinbar_sr", "Pin bar em topo/fundo 24h(288)", (i) => { if (i < 288) return 0; const hh = Math.max(...I.H.slice(i - 288, i)), ll = Math.min(...I.L.slice(i - 288, i)); const rng = I.H[i] - I.L[i]; if (rng <= 0) return 0; const upW = (I.H[i] - Math.max(I.C[i], I.O[i])) / rng, loW = (Math.min(I.C[i], I.O[i]) - I.L[i]) / rng; if (upW > 0.66 && I.H[i] >= hh - 0.1 * rng) return -1; if (loW > 0.66 && I.L[i] <= ll + 0.1 * rng) return 1; return 0; });
  add("three_soldiers", "3 soldados/corvos", (i) => { if (i < 3) return 0; const up = I.C.slice(i - 2, i + 1), op = I.O.slice(i - 2, i + 1); const dn = (a, b) => a.every((x, j) => x > b[j]); if (up.every(() => true) && dn(up, op) && I.C[i] > I.C[i - 1] && I.C[i - 1] > I.C[i - 2]) return 1; const upB = I.C.slice(i - 2, i + 1), opB = I.O.slice(i - 2, i + 1); if (upB.every((x, j) => x < opB[j]) && I.C[i] < I.C[i - 1] && I.C[i - 1] < I.C[i - 2]) return -1; return 0; });
  add("heikin_flip", "Heikin-Ashi flip (2x)", (i) => { if (i < 2) return 0; const c1 = I.ha[i].c > I.ha[i].o, c2 = I.ha[i - 1].c > I.ha[i - 1].o, c0 = I.ha[i].c; if (c1 && c2 && c0 > I.ha[i - 1].c) return 1; if (!c1 && !c2 && c0 < I.ha[i - 1].c) return -1; return 0; });
  // CCI / W%R / ROC
  add("cci_rev", "CCI(20) +-100 reversion", (i) => { const c = I.c20[i]; return c === null ? 0 : c < -100 ? 1 : c > 100 ? -1 : 0; });
  add("cci_mom", "CCI(20) +-200 momentum", (i) => { const c = I.c20[i]; return c === null ? 0 : c > 200 ? 1 : c < -200 ? -1 : 0; });
  add("williams_r", "Williams %R(14) -80/-20", (i) => { const w = I.w14[i]; return w === null ? 0 : w < -80 ? 1 : w > -20 ? -1 : 0; });
  add("roc10_follow", "ROC(10) momentum follow", (i) => { const r = I.roc10[i]; return r === null ? 0 : r > 0 ? 1 : r < 0 ? -1 : 0; });
  add("adx_di_trend", "ADX(14)>25 + direcao", (i) => { const ax = I.adx[i]; if (ax === null || ax < 25 || I.e9[i] === null || I.e21[i] === null) return 0; return I.e9[i] > I.e21[i] ? 1 : -1; });
  // Divergencias
  add("rsi_div", "RSI div (10 barras)", (i) => { if (i < 10) return 0; const w = I.C.slice(i - 9, i + 1); const lo = Math.min(...w), hi = Math.max(...w); const r = I.rsi14[i], r10 = I.rsi14[i - 10]; if (r === null || r10 === null) return 0; if (I.C[i] === lo && I.C[i] < I.C[i - 10] && r > r10) return 1; if (I.C[i] === hi && I.C[i] > I.C[i - 10] && r < r10) return -1; return 0; });
  add("macd_div", "MACD div (10 barras)", (i) => { if (i < 10) return 0; const m = I.macd[i], m10 = I.macd[i - 10]; if (m === null || m10 === null) return 0; const w = I.C.slice(i - 9, i + 1); const lo = Math.min(...w), hi = Math.max(...w); if (I.C[i] === lo && I.C[i] < I.C[i - 10] && m > m10) return 1; if (I.C[i] === hi && I.C[i] > I.C[i - 10] && m < m10) return -1; return 0; });
  // Sessions / ORB
  add("orb_hour", "ORB: range dos 1os 60s da hora", (i) => { const b = cd[i].bucket; const secInHour = Math.floor((b % 3600000) / 5000); if (secInHour < 12) return 0; let hi = -Infinity, lo = Infinity; for (let j = i - secInHour; j < i - secInHour + 12; j++) { if (j < 0) return 0; hi = Math.max(hi, I.H[j]); lo = Math.min(lo, I.L[j]); } return I.C[i] > hi && I.C[i - 1] <= hi ? 1 : I.C[i] < lo && I.C[i - 1] >= lo ? -1 : 0; });
  add("session_open_break", "Rompe range 5min da sessao (hora UTC par)", (i) => { const b = cd[i].bucket; const m5 = Math.floor(b / 300000) % 2; if (m5 !== 1) return 0; const start = b - (b % 300000); let hi = -Infinity, lo = Infinity; for (let j = i; j >= 0 && cd[j].bucket >= start - 300000; j--) { if (cd[j].bucket < start) { hi = Math.max(hi, I.H[j]); lo = Math.min(lo, I.L[j]); } } if (hi === -Infinity) return 0; return I.C[i] > hi ? 1 : I.C[i] < lo ? -1 : 0; });
  return S;
}
function evaluate(v, rows, lkey) { let sig = 0, w = 0, l = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, iN = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; const y = rows[i][lkey]; if (y === null || y === 0) continue; sig += 1; const win = x === y; if (win) w += 1; else l += 1; if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { iN += 1; if (win) iw += 1; else il += 1; } } const n = w + l; return { n, w, l, wr: n ? +((w / n) * 100).toFixed(2) : null, buyN: bw + bl, buyWR: (bw + bl) ? +((bw / (bw + bl)) * 100).toFixed(2) : null, sellN: sw + sl, sellWR: (sw + sl) ? +((sw / (sw + sl)) * 100).toFixed(2) : null, indepN: iN, indepWR: iN ? +((iw / iN) * 100).toFixed(2) : null, ci95: n ? wilson(w, n).map((x) => +(x * 100).toFixed(2)) : null };
}
(async () => {
  const out = { generated_at: new Date().toISOString(), method: "classicas da internet, parametros publicados, SEM tuning, construcao causal", datasets: {} };
  const cache = {};
  for (const ds of [{ id: "IQOPTION_EURUSD_BINARY_10H", otc: false }, { id: "IQOPTION_EURUSD_OTC_10H", otc: true }]) {
    if (!cache[ds.id]) { const rowsDb = []; for (let off = 0; ; off += 3000) { const p = await sql(`SELECT EXTRACT(EPOCH FROM bucket)*1000 AS b, open, high, low, close, tick_count FROM iqopt_candles_5s WHERE dataset_id='${ds.id}' ORDER BY bucket LIMIT 3000 OFFSET ${off};`); rowsDb.push(...p); if (p.length < 3000) break; } cache[ds.id] = rowsDb.map((r) => ({ bucket: Number(r.b), open: +r.open, high: +r.high, low: +r.low, close: +r.close, n: +r.tick_count })); }
    const cd = cache[ds.id]; const I = indicators(cd); const byB = new Map(); for (let i = 0; i < cd.length; i++) byB.set(cd[i].bucket, i);
    const rows = cd.map((c, i) => { const si = byB.get(c.bucket + 60000); const l60 = si === undefined ? null : (cd[si].close === c.close ? 0 : cd[si].close > c.close ? 1 : -1); return { t0: c.bucket + 5000, l60 }; }); let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    const strat = buildStrategies(I, cd);
    const res = [];
    for (const s of strat) { const v = s.vec; const r = evaluate(v, rows, "l60"); res.push({ id: s.id, source: s.source, ...r }); }
    res.sort((a, b) => (b.wr ?? 0) - (a.wr ?? 0));
    out.datasets[ds.id] = res;
    const q = res.filter((r) => r.wr >= 70 && r.n >= 50);
    console.log(`\n===== ${ds.id} (rows=${rows.length}) =====`);
    console.log(`>=70% com n>=50: ${q.length ? q.map((r) => `${r.id}(${r.wr}% n=${r.n})`).join(" ") : "NENHUMA"}`);
    console.log("Top 8 por WR:"); for (const r of res.slice(0, 8)) console.log(`  ${r.id} | n=${r.n} WR=${r.wr}% BUY ${r.buyWR}% SELL ${r.sellWR}% indep ${r.indepN}/${r.indepWR}%`);
    const q2 = res.filter((r) => r.wr >= 70 && r.n < 50);
    if (q2.length) console.log(`EXCLUIDAS (n<50): ${q2.map((r) => `${r.id}(${r.wr}% n=${r.n})`).join(" ")}`);
  }
  fs.mkdirSync(OUT + "/web", { recursive: true }); fs.writeFileSync(OUT + "/web/web-classics-results.json", JSON.stringify(out, null, 1));
  console.log("\nDONE web-classics-results.json");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
