// cg-comps.cjs — builders de componentes/masks (mesma implementação usada no discovery) + rebuilder de vetores de finalistas.
// Usado pelo prospective para garantir combination integrity (Critic 2): componentes reconstruídos do spec congelado.
const AGREE = (a, b) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = a[i] !== 0 && a[i] === b[i] ? a[i] : 0; return v; };
const UNI = (a, b) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; v[i] = x === 0 ? y : y === 0 ? x : x === y ? x : 0; } return v; };
const CONFIRM = (a, b) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = b[i] !== 0 ? a[i] : 0; return v; };
const GATE = (a, m) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = m[i] ? a[i] : 0; return v; };
const AGREE3v = (a, b, c) => { const v = new Int8Array(a.length); for (let i = 0; i < a.length; i++) v[i] = a[i] !== 0 && a[i] === b[i] && a[i] === c[i] ? a[i] : 0; return v; };
const GC = require("./gauntlet-compile.cjs");
function buildParts(rows, ctx, mk3table) {
  const N = rows.length; const F = (i) => rows[i].f;
  const mk = (fn) => { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = fn(i); return v; };
  const comps = {};
  comps.tlbrk70 = mk((i) => F(i).tlb70up ? 1 : F(i).tlb70dn ? -1 : 0);
  comps.tlbrk50 = mk((i) => F(i).tlb50up ? 1 : F(i).tlb50dn ? -1 : 0);
  comps.fb25 = mk((i) => F(i).fb25up ? -1 : F(i).fb25dn ? 1 : 0);
  comps.v7relaxed = GC.compile({ type: "prod", id: "reversion-v7-relaxed" }, ctx);
  comps.v7and = GC.compile({ type: "prod", id: "reversion-v7-and" }, ctx);
  comps.v1 = GC.compile({ type: "prod", id: "reversion-v1-fib" }, ctx);
  comps.v3 = GC.compile({ type: "prod", id: "reversion-v3-fib" }, ctx);
  comps.v6 = GC.compile({ type: "prod", id: "reversion-v6-fib" }, ctx);
  comps.z240 = mk((i) => { const f = F(i); if (f.lowVol !== 1) return 0; if (f.z240 <= -2.5) return 1; if (f.z240 >= 2.5) return -1; return 0; });
  comps.exrsi = mk((i) => { const s = F(i).s; return s > 0.33 ? 1 : s < -0.33 ? -1 : 0; });
  comps.cp = mk((i) => { const f = F(i); const sdv = Math.abs(f.r24) / 2 + 1e-9; const diff = f.r3 - f.r24 / 8; return diff > 0.5 * sdv ? 1 : diff < -0.5 * sdv ? -1 : 0; });
  comps.acfade = mk((i) => { const f = F(i); if (f.ac1 < -0.25) return f.r6 > 0 ? -1 : f.r6 < 0 ? 1 : 0; return 0; });
  comps.miimb = mk((i) => { const f = F(i); if (f.imb === null) return 0; return f.imb > 0.1 ? 1 : f.imb < -0.1 ? -1 : 0; });
  comps.enperm = mk((i) => { const f = F(i); if (f.Hp < 0.8 && Math.abs(f.z60) > 1) return f.z60 > 0 ? -1 : 1; return 0; });
  comps.humr = mk((i) => { const f = F(i); if (f.hurst !== null && f.hurst < 0.45 && Math.abs(f.z60) > 1.25) return f.z60 > 0 ? -1 : 1; return 0; });
  if (mk3table) comps.mk3 = mk((i) => { const t = mk3table[F(i).dir3]; if (!t || t.n < 300) return 0; const p = t.u / t.n; return p > 0.54 ? 1 : p < 0.46 ? -1 : 0; });
  return comps;
}
function buildMasks(rows) {
  const N = rows.length; const F = (i) => rows[i].f;
  const mk = (fn) => { const v = new Int8Array(N); for (let i = 0; i < N; i++) v[i] = fn(i); return v; };
  return {
    enlow: mk((i) => F(i).H < 2.7 ? 1 : 0),
    hurstMR: mk((i) => (F(i).hurst !== null && F(i).hurst < 0.45) ? 1 : 0),
    cpActive: mk((i) => { const f = F(i); const sdv = Math.abs(f.r24) / 2 + 1e-9; return Math.abs(f.r3 - f.r24 / 8) > 0.8 * sdv ? 1 : 0; }),
    burst: mk((i) => F(i).tickBurst ? 1 : 0),
    h11_18: mk((i) => (F(i).hour >= 11 && F(i).hour < 18) ? 1 : 0),
    lowvol: mk((i) => F(i).lowVol === 1 ? 1 : 0),
  };
}
// meta state deve ser construido com a MESMA tabela treinada no discovery (frozenStats) quando disponível
function setMk3(comps, frozenTable) { const N = 0; void N; return frozenTable; }
function rebuildVec(spec, parts, rows) {
  const { comps, masks, mk3table } = parts; const N = rows.length; const F = (i) => rows[i].f;
  if (spec.single) return comps[spec.single];
  if (spec.op === "AND") return AGREE(comps[spec.a], comps[spec.b]);
  if (spec.op === "OR") return UNI(comps[spec.a], comps[spec.b]);
  if (spec.op === "CONFIRM") return CONFIRM(comps[spec.a], comps[spec.b]);
  if (spec.op === "GATE") return GATE(comps[spec.a], masks[spec.m]);
  if (spec.op === "AND3") return AGREE3v(comps[spec.comps[0]], comps[spec.comps[1]], comps[spec.comps[2]]);
  if (spec.op === "GATE2" || spec.op === "GATE3") return GATE(rebuildVec(spec.parent, parts, rows), masks[spec.m]);
  if (spec.op === "REGIME_SWITCH") { const v = new Int8Array(N); for (let i = 0; i < N; i++) { const f = F(i); if (f.H > 2.85) continue; if (f.hurst !== null && f.hurst < 0.45) v[i] = comps.z240[i]; else if (f.hurst !== null && f.hurst > 0.55) v[i] = comps.exrsi[i]; else v[i] = comps.miimb[i]; } return v; }
  if (spec.op === "META") { const base = rebuildVec(spec.baseSpec, parts, rows); const { w, b0, mu, sg } = spec.weights; const feats = (i) => { const f = F(i); return [base[i], Math.abs(f.imb ?? 0), f.H, f.Hp, f.hurst ?? 0.5, Math.abs(f.r3 - f.r24 / 8), f.vol12 * 1e4, f.tickRate, f.z60, f.r6 * 100, f.spreadRatio ?? 1, f.hour / 24]; }; const v = new Int8Array(N); for (let i = 0; i < N; i++) { if (base[i] === 0) continue; const x = feats(i); let z = b0; for (let k = 0; k < w.length; k++) z += w[k] * ((x[k] - mu[k]) / sg[k]); const p = 1 / (1 + Math.exp(-z)); if (p >= spec.threshold) v[i] = base[i]; } return v; }
  throw new Error("spec desconhecido " + JSON.stringify(spec).slice(0, 80));
}
module.exports = { buildParts, buildMasks, rebuildVec, AGREE, UNI, CONFIRM, GATE, AGREE3v };
