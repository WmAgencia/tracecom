const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function loadCtx(rows) {
  const N = rows.length;
  const L = new Int8Array(N); for (let i = 0; i < N; i++) L[i] = rows[i].l60 === null ? 0 : rows[i].l60;
  const col = (f) => { const a = new Float64Array(N); for (let i = 0; i < N; i++) { const v = rows[i].f[f]; a[i] = v === null || v === undefined ? NaN : v; } return a; };
  const C = {}; for (const k of ["s", "vol12", "r24", "r12", "r6", "r1", "distSma20", "macdHist", "stochK", "bbB", "er30", "er60", "streak", "bodyRatio", "upperWick", "lowerWick", "expansion", "distPH", "distPL", "pos", "distFib", "atrPct", "hour", "sessMinute"]) C[k] = col(k);
  const B = {}; for (const k of ["boUp", "boDown", "falseBoUp", "falseBoDown", "structureUp", "structureDown", "inZone", "upSwing", "beyondExt", "bullDiv", "bearDiv", "bigCandle", "doji"]) { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = rows[i].f[k] ? 1 : 0; B[k] = a; }
  const INDEP = new Uint8Array(N); for (let i = 0; i < N; i++) INDEP[i] = rows[i].indep;
  const mk = (f) => { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = f(i); return v; };
  const mkCond = (f) => { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = f(i) ? 1 : 0; return a; };
  const conds = {
    "vol<0.0009": mkCond((i) => C.vol12[i] < 0.0009), "vol<0.0012": mkCond((i) => C.vol12[i] < 0.0012), "vol<0.0018": mkCond((i) => C.vol12[i] < 0.0018),
    "er<0.35": mkCond((i) => C.er30[i] < 0.35), "er<0.45": mkCond((i) => C.er30[i] < 0.45), "er>0.55": mkCond((i) => C.er30[i] > 0.55), "er>0.65": mkCond((i) => C.er30[i] > 0.65),
    "expansion>1.3": mkCond((i) => C.expansion[i] > 1.3), "sessMin<30": mkCond((i) => C.sessMinute[i] < 30), "sessMin>=30": mkCond((i) => C.sessMinute[i] >= 30),
    "h0-5": mkCond((i) => C.hour[i] >= 0 && C.hour[i] < 6), "h6-11": mkCond((i) => C.hour[i] >= 6 && C.hour[i] < 12), "h12-17": mkCond((i) => C.hour[i] >= 12 && C.hour[i] < 18), "h18-23": mkCond((i) => C.hour[i] >= 18),
    "inZone": mkCond((i) => B.inZone[i] === 1), "upSwing": mkCond((i) => B.upSwing[i] === 1), "bullDiv": mkCond((i) => B.bullDiv[i] === 1), "bearDiv": mkCond((i) => B.bearDiv[i] === 1),
  };
  const eqs = {
    and(a, b) { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = a[i] !== 0 && a[i] === b[i] ? a[i] : 0; return v; },
    union(a, b) { const v = new Int8Array(N); for (let i = 0; i < N; i++) { const x = a[i], y = b[i]; v[i] = x === 0 ? y : y === 0 ? x : x === y ? x : 0; } return v; },
    gate(v, cond) { const r = new Int8Array(N); for (let i = 0; i < N; i++) r[i] = cond[i] ? v[i] : 0; return r; },
    vote3(a, b, c2) { const v = new Int8Array(N); for (let i = 0; i < N; i++) { if (a[i] !== 0 && a[i] === b[i]) v[i] = a[i]; else if (a[i] !== 0 && a[i] === c2[i]) v[i] = a[i]; else if (b[i] !== 0 && b[i] === c2[i]) v[i] = b[i]; } return v; },
  };
  const gateFibOk = (v) => { const r = new Int8Array(N); for (let i = 0; i < N; i++) { const x = v[i]; if (x === 0) continue; const inZ = B.inZone[i], up = B.upSwing[i]; if (inZ && ((x === 1 && up) || (x === -1 && !up))) r[i] = x; } return r; };
  const wilson = (w, n) => { if (!n) return [0, 1]; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return [Math.max(0, cc - h), Math.min(1, cc + h)]; };
  const stats = (v, lo, hi) => { let sig = 0, w = 0, l = 0, d = 0, wI = 0, lI = 0; for (let i = lo; i < hi; i++) { const x = v[i]; if (x === 0) continue; sig += 1; const y = L[i]; if (y === 0) { d += 1; } else { if (x === y) w += 1; else l += 1; } if (INDEP[i] && y !== 0) { if (x === y) wI += 1; else lI += 1; } } const n = w + l, acc = n ? w / n : 0; const [wl, wh] = wilson(w, n); return { sig, w, l, d, n, acc, wilson_lo: wl, wilson_hi: wh, indep_n: wI + lI, indep_w: wI, indep_l: lI, indep_acc: (wI + lI) ? wI / (wI + lI) : null }; };
  return { N, L, C, B, INDEP, mk, mkCond, conds, eqs, gateFibOk, stats, wilson };
}
const fibOkAt = (ctx, d, i) => ctx.B.inZone[i] && ((d === 1 && ctx.B.upSwing[i]) || (d === -1 && !ctx.B.upSwing[i]));
function compile(spec, ctx) {
  const { C, B, mk, eqs, conds, gateFibOk } = ctx;
  if (spec.op) {
    if (spec.op === "and") return eqs.and(compile(spec.aSpec, ctx), compile(spec.bSpec, ctx));
    if (spec.op === "union") return eqs.union(compile(spec.aSpec, ctx), compile(spec.bSpec, ctx));
    if (spec.op === "and3") return eqs.and(eqs.and(compile(spec.specs[0], ctx), compile(spec.specs[1], ctx)), compile(spec.specs[2], ctx));
    if (spec.op === "vote3") return eqs.vote3(compile(spec.specs[0], ctx), compile(spec.specs[1], ctx), compile(spec.specs[2], ctx));
    if (spec.op === "gate") { const inner = compile(spec.innerSpec, ctx); const cond = conds[spec.cond]; if (!cond) throw new Error("unknown cond " + spec.cond); return eqs.gate(inner, cond); }
    if (spec.op === "gateFib") { const inner = compile(spec.innerSpec, ctx); return gateFibOk(inner); }
    if (spec.op === "weighted") { const vs = spec.specs.map((s) => compile(s, ctx)); const ws = spec.weights; const thr = spec.thr; const v = new Int8Array(ctx.N); const tot = ws.reduce((a, b) => a + b, 0); for (let i = 0; i < ctx.N; i++) { let sc = 0; for (let j = 0; j < vs.length; j++) sc += ws[j] * vs[j][i]; if (Math.abs(sc) >= thr * tot) v[i] = sc > 0 ? 1 : -1; } return v; }
    throw new Error("unknown op " + spec.op);
  }
  switch (spec.type) {
    case "rsi_s": return mk((i) => { const x = C.s[i]; return x > spec.t ? 1 : x < -spec.t ? -1 : 0; });
    case "rsi_vol": return mk((i) => { const x = C.s[i]; return C.vol12[i] < spec.v ? (x > spec.t ? 1 : x < -spec.t ? -1 : 0) : 0; });
    case "rsi_band": return mk((i) => { const x = Math.abs(C.s[i]); return x >= spec.lo && x <= spec.hi ? (C.s[i] > 0 ? 1 : -1) : 0; });
    case "mom_follow": return mk((i) => { const x = C.r24[i]; return x > spec.t ? 1 : x < -spec.t ? -1 : 0; });
    case "mom_revert": return mk((i) => { const x = C.r24[i]; return x > spec.t ? -1 : x < -spec.t ? 1 : 0; });
    case "atr_over": return mk((i) => { const x = C.distSma20[i]; return x <= -spec.m ? 1 : x >= spec.m ? -1 : 0; });
    case "macd_follow": return mk((i) => C.macdHist[i] > 0 ? 1 : C.macdHist[i] < 0 ? -1 : 0);
    case "macd_revert": return mk((i) => C.macdHist[i] > 0 ? -1 : C.macdHist[i] < 0 ? 1 : 0);
    case "stoch_rev": return mk((i) => { const k = C.stochK[i]; return k < spec.t ? 1 : k > 100 - spec.t ? -1 : 0; });
    case "stoch_follow": return mk((i) => { const k = C.stochK[i]; return k > 100 - spec.t ? 1 : k < spec.t ? -1 : 0; });
    case "bb_rev": return mk((i) => { const x = C.bbB[i]; return x < spec.t ? 1 : x > 1 - spec.t ? -1 : 0; });
    case "bb_break": return mk((i) => C.bbB[i] > 1 ? 1 : C.bbB[i] < 0 ? -1 : 0);
    case "er_follow": return mk((i) => { if (!(C.er30[i] > spec.t)) return 0; const x = C.r24[i]; return x > 0 ? 1 : x < 0 ? -1 : 0; });
    case "er_rev": return mk((i) => { if (!(C.er30[i] > spec.t)) return 0; const x = C.s[i]; return x > 0 ? 1 : x < 0 ? -1 : 0; });
    case "er_chop_rev": return mk((i) => { if (!(C.er30[i] < spec.t)) return 0; const x = C.s[i]; return x > 0 ? 1 : x < 0 ? -1 : 0; });
    case "streak_rev": return mk((i) => { const x = C.streak[i]; return x >= spec.k ? -1 : x <= -spec.k ? 1 : 0; });
    case "streak_follow": return mk((i) => { const x = C.streak[i]; return x >= spec.k ? 1 : x <= -spec.k ? -1 : 0; });
    case "bigcandle_rev": return mk((i) => { if (!B.bigCandle[i]) return 0; return C.r1[i] > 0 ? -1 : C.r1[i] < 0 ? 1 : 0; });
    case "bigcandle_follow": return mk((i) => { if (!B.bigCandle[i]) return 0; return C.r1[i] > 0 ? 1 : C.r1[i] < 0 ? -1 : 0; });
    case "wick_rej": return mk((i) => { const uw = C.upperWick[i], lw = C.lowerWick[i], dp = C.distPH[i], dl = C.distPL[i]; if (uw > 0.5 && !isNaN(dp) && dp < 0.3) return -1; if (lw > 0.5 && !isNaN(dl) && dl < 0.3) return 1; return 0; });
    case "breakout_follow": return mk((i) => B.boUp[i] ? 1 : B.boDown[i] ? -1 : 0);
    case "falsebo_rev": return mk((i) => (B.falseBoUp[i] || B.falseBoDown[i]) ? (B.falseBoUp[i] ? -1 : 1) : 0);
    case "sr_rev": return mk((i) => { const dp = C.distPH[i], dl = C.distPL[i]; if (!isNaN(dp) && dp < 0.4) return -1; if (!isNaN(dl) && dl < 0.4) return 1; return 0; });
    case "struct_follow": return mk((i) => B.structureUp[i] ? 1 : B.structureDown[i] ? -1 : 0);
    case "struct_rev": return mk((i) => { const sv = C.s[i]; if (B.structureUp[i] && sv > 0.1) return 1; if (B.structureDown[i] && sv < -0.1) return -1; return 0; });
    case "fib_ctx": return mk((i) => B.inZone[i] ? (B.upSwing[i] ? 1 : -1) : 0);
    case "fib_deep": return mk((i) => { if (!B.inZone[i]) return 0; const p = C.pos[i]; if (B.upSwing[i]) return p <= 0.5 ? 1 : 0; return p >= 0.5 ? -1 : 0; });
    case "div_rev": return mk((i) => B.bullDiv[i] ? 1 : B.bearDiv[i] ? -1 : 0);
    case "expansion_follow": return mk((i) => C.expansion[i] > 1.3 ? (C.r1[i] > 0 ? 1 : C.r1[i] < 0 ? -1 : 0) : 0);
    case "last_candle": return mk((i) => C.r1[i] > 0 ? 1 : C.r1[i] < 0 ? -1 : 0);
    case "last3_follow": return mk((i) => C.r6[i] > 0 ? 1 : C.r6[i] < 0 ? -1 : 0);
    case "always": return mk(() => spec.dir);
    case "random": { const rnd = mulberry32(spec.seed ?? 42); return mk(() => (rnd() < 0.5 ? 1 : -1)); }
    case "prod": {
      const id = spec.id;
      if (id === "reversion-v1-fib") return mk((i) => { const x = C.s[i]; if (!(C.vol12[i] < 0.0009)) return 0; const d = x > 0.33 ? 1 : x < -0.33 ? -1 : 0; return d !== 0 && fibOkAt(ctx, d, i) ? d : 0; });
      if (id === "reversion-v3-fib") return mk((i) => { const x = C.s[i], mo = C.r24[i]; if (!(C.vol12[i] < 0.0012)) return 0; const d = x > 0.22 && mo > 0 ? 1 : x < -0.22 && mo < 0 ? -1 : 0; return d !== 0 && fibOkAt(ctx, d, i) ? d : 0; });
      if (id === "reversion-v6-fib") return mk((i) => { const a = Math.abs(C.s[i]); if (!(C.vol12[i] < 0.0009 && a >= 0.63 && a <= 0.857)) return 0; const d = C.s[i] > 0 ? 1 : -1; return fibOkAt(ctx, d, i) ? d : 0; });
      if (id === "reversion-v7-and") return mk((i) => { const x = C.s[i]; if (!(C.vol12[i] < 0.0009)) return 0; const d = x > 0.33 ? 1 : x < -0.33 ? -1 : 0; if (d === 0 || !fibOkAt(ctx, d, i)) return 0; const dev = C.distSma20[i]; const ad = dev <= -3 ? 1 : dev >= 3 ? -1 : 0; return ad === d ? d : 0; });
      if (id === "reversion-v7-relaxed") return mk((i) => { const x = C.s[i]; let d = 0; if (C.vol12[i] < 0.0009) d = x > 0.33 ? 1 : x < -0.33 ? -1 : 0; if (d !== 0 && !fibOkAt(ctx, d, i)) d = 0; const dev = C.distSma20[i]; const ad = dev <= -1 ? 1 : dev >= 1 ? -1 : 0; const adOk = ad !== 0 && fibOkAt(ctx, ad, i) ? ad : 0; if (d !== 0 && adOk !== 0 && d !== adOk) return 0; return d !== 0 ? d : adOk; });
      throw new Error("unknown prod " + id);
    }
    default: throw new Error("unknown feature type " + spec.type);
  }
}
function ATOM_BY_ID() { return {}; }
module.exports = { loadCtx, compile, gateFibOkRef: (ctx) => ctx.gateFibOk };