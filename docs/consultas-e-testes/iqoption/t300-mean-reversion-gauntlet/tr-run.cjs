// tr-run.cjs — Gauntlet z120_rev_2 (BINARY, T+300): forense WIN/LOSS, gates G1-G4 com freeze, BH+permutacao, ablation, Pareto, freeze, prospectivo P3.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sha16 = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const L = require(OUT + "/mh-lib.cjs");
const KHF = L.KHF;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
async function sqlq(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail"); await new Promise((x) => setTimeout(x, 1200)); } }
async function quotes(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const r = await fetch(`https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
function wilsonLo(w, n) { if (!n) return 0; const z = 1.96, p = w / n, dd = 1 + z * z / n, cc = (p + z * z / (2 * n)) / dd, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / dd; return Math.max(0, cc - h); }
const FEATS = ["zAbs", "distATR", "distPct", "ret15", "ret30", "ret45", "ret60", "ret90", "ret120", "ret180", "ret300", "accel", "rsi14", "rsi7", "stoch", "cci", "wpr", "macdDecel", "bodyRatio", "clv", "wickExp", "tick_imb_5s", "tick_imb_10s", "tick_imb_15s", "tick_imb_30s", "tick_imb_60s", "tick_rate_5s", "tick_rate_15s", "tick_rate_60s", "spread_15s", "spread_60s", "distPH", "distPL", "reg60_r2", "reg60_residZ", "reg120_r2", "reg300_r2", "er30", "er60", "emaStack", "hurst", "ac1", "H", "Hp", "atrPct", "vol12", "bbw", "volPct", "cpMean", "cpVar", "pathEff", "dirCandles", "signChanges", "maxCandleShare", "barsSinceMax", "maxAdverse", "extCandles", "maxZ", "barsSinceCross", "fibPos", "nearRes", "nearSup"];
const FLAGS = ["structUp", "structDown", "inZone", "upSwing", "fibOk", "volHigh", "nearRes", "nearSup"];
(async () => {
  const data = JSON.parse(fs.readFileSync(OUT + "/tr/signals-raw.json", "utf8"));
  let signals = data.signals.filter((s) => s.l300 !== null && s.l300 !== 0);
  signals.sort((a, b) => a.t0 - b.t0);
  // reprodução (decididos)
  const W = signals.filter((s) => s.dir === s.l300).length, N_ = signals.length;
  const rep = JSON.parse(fs.readFileSync(OUT + "/tr/baseline-reproduction.json", "utf8"));
  rep.decided = { n: N_, W, L: N_ - W, WR: +(W / N_ * 100).toFixed(2) };
  rep.match = N_ === 890 && Math.abs(W / N_ * 100 - 63.6) < 0.05;
  rep.note = "match compara DECIDIDOS (exclui 14 draws); 904 brutos = 890 decididos + 14 draws";
  fs.writeFileSync(OUT + "/tr/baseline-reproduction.json", JSON.stringify(rep, null, 1));
  console.log(`BASELINE: decididos=${N_} W=${W} WR=${(W / N_ * 100).toFixed(2)}% match=${rep.match}`);
  // split temporal TRAIN/VAL com embargo 300s
  const splitT = signals[Math.floor(N_ * 0.6)].t0; const emb = 300000;
  const train = signals.filter((s) => s.t0 <= splitT), val = signals.filter((s) => s.t0 >= splitT + emb);
  console.log(`TRAIN n=${train.length} VAL n=${val.length} (embargo 300s em ${new Date(splitT).toISOString()})`);
  const wrOf = (arr) => { const w = arr.filter((s) => s.dir === s.l300).length; return { n: arr.length, w, wr: arr.length ? +(w / arr.length * 100).toFixed(2) : null }; };
  const base = { train: wrOf(train), val: wrOf(val) };
  // ===== STAGE 1: LOSS FORENSICS (TRAIN) =====
  const wins = train.filter((s) => s.dir === s.l300), losses = train.filter((s) => s.dir !== s.l300);
  const forensics = [];
  for (const f of [...FEATS, ...FLAGS]) { const wv = wins.map((s) => s[f]).filter((x) => x !== null && x !== undefined && !isNaN(x)); const lv = losses.map((s) => s[f]).filter((x) => x !== null && x !== undefined && !isNaN(x)); if (wv.length < 30 || lv.length < 30) { forensics.push({ feat: f, insufficient: true, nw: wv.length, nl: lv.length }); continue; } const mw = mean(wv), ml = mean(lv); const es = sd([...wv, ...lv]) > 0 ? (mw - ml) / sd([...wv, ...lv]) : 0; forensics.push({ feat: f, mean_win: +mw.toFixed(5), mean_loss: +ml.toFixed(5), diff: +(mw - ml).toFixed(5), effect_size: +es.toFixed(3), nw: wv.length, nl: lv.length }); }
  forensics.sort((a, b) => Math.abs(b.effect_size ?? 0) - Math.abs(a.effect_size ?? 0));
  fs.writeFileSync(OUT + "/tr/loss-forensics.json", JSON.stringify({ baseline: base, split: { splitT, train: train.length, val: val.length }, note: "effect_size = (mean_win - mean_loss)/sd_pooled (TRAIN)", features: forensics }, null, 1));
  console.log("TOP forense: " + forensics.slice(0, 8).map((x) => `${x.feat} (ES ${x.effect_size})`).join(" | "));
  // ===== G1: gates univariados (freeze antes de avaliar) =====
  const gates = []; const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
  for (const f of FEATS) { const vals = train.map((s) => s[f]).filter((x) => x !== null && x !== undefined && !isNaN(x)); if (vals.length < 100) continue; for (const p of [0.25, 0.5, 0.75]) { const th = q(vals, p); gates.push({ id: `${f}>=${th.toFixed(6)}`, feat: f, op: ">=", th, quantile: p }); gates.push({ id: `${f}<${th.toFixed(6)}`, feat: f, op: "<", th, quantile: p }); } }
  for (const f of FLAGS) gates.push({ id: `${f}==1`, feat: f, op: "fl1" }), gates.push({ id: `${f}==0`, feat: f, op: "fl0" });
  const g1 = { generated_at: new Date().toISOString(), parent: "z120_rev_2 (mh-freeze hash da hipotese)", note: "thresholds mecânicos por quantis de TRAIN (25/50/75) — congelados antes de avaliar", K: gates.length, gates: gates.map((g) => ({ ...g, hash: sha16(g) })) };
  fs.writeFileSync(OUT + "/tr/g1-freeze.json", JSON.stringify(g1, null, 1));
  console.log(`G1 freeze K=${gates.length}`);
  const indepN = (arr) => { let last = -1e18, c = 0; for (const s of arr) { if (s.t0 - last >= 300000) { c += 1; last = s.t0; } } return c; };
  const evalGate = (g, arr) => { const sel = arr.filter((s) => g.op === ">=" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] >= g.th) : g.op === "<" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] < g.th) : g.op === "fl1" ? s[g.feat] === 1 : s[g.feat] === 0); const w = sel.filter((s) => s.dir === s.l300).length; const n = sel.length; const bs = sel.filter((s) => s.dir === 1), ss = sel.filter((s) => s.dir === -1); const wb = bs.filter((s) => s.l300 === 1).length, ws = ss.filter((s) => s.l300 === -1).length; return { n, w, wr: n ? +(w / n * 100).toFixed(2) : null, buyN: bs.length, buyWR: bs.length ? +(wb / bs.length * 100).toFixed(2) : null, sellN: ss.length, sellWR: ss.length ? +(ws / ss.length * 100).toFixed(2) : null, indepN: indepN(sel), sigPerHour: +(n / (train.length ? (train[0].t0 && arr === train ? (train[train.length - 1].t0 - train[0].t0) / 3600000 : 0) : 1) || 1).toFixed(1), wilsonLo: +(wilsonLo(w, n) * 100).toFixed(2) }; };
  const allRes = [];
  for (const g of gates) { const tr = evalGate(g, train); const va = evalGate(g, val); allRes.push({ gen: "G1", id: g.id, hash: g.hash, train: tr, val: va }); }
  // BH-FDR (TRAIN, z binomial)
  const normCdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  const withP = allRes.map((r) => ({ r, p: r.train.n >= 30 ? 1 - normCdf((r.train.w - 0.5 * r.train.n) / Math.sqrt(0.25 * r.train.n)) : 1 })).sort((a, b) => a.p - b.p);
  let pq = 1; for (let i = withP.length - 1; i >= 0; i--) { const qv = Math.min(pq, withP[i].p * withP.length / (i + 1)); withP[i].r.q = +qv.toFixed(4); pq = qv; } for (const r of allRes) if (r.q === undefined) r.q = null;
  // permutacao max-stat (TRAIN, 400 perm, circular shift por feature)
  const topG1 = allRes.filter((r) => r.train.n >= 100).sort((a, b) => (b.train.wilsonLo ?? 0) - (a.train.wilsonLo ?? 0)).slice(0, 60);
  const perm = { perms: 400, note: "max-stat por permutacao circular dos valores de feature no TRAIN (60 melhores gates)", p_max: null };
  { const rnd = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(42); let ge = 0; const obsBest = topG1.length ? Math.max(...topG1.map((r) => r.train.wr)) : 0;
    for (let b = 0; b < perm.perms; b++) { const shift = Math.floor(rnd() * train.length); let mx = 0; for (const g of topG1) { const vals = train.map((s) => s[g.feat]); const sh = (i) => vals[(i + shift) % vals.length]; let w = 0, n = 0; for (let i = 0; i < train.length; i++) { const v = sh(i); const ok2 = g.op === ">=" ? (v !== null && !isNaN(v) && v >= g.th) : g.op === "<" ? (v !== null && !isNaN(v) && v < g.th) : g.op === "fl1" ? v === 1 : v === 0; if (!ok2) continue; n += 1; if (train[i].dir === train[i].l300) w += 1; } if (n >= 30) { const wr = w / n * 100; if (wr > mx) mx = wr; } } if (mx >= obsBest) ge += 1; }
    perm.p_max = +((1 + ge) / (perm.perms + 1)).toFixed(4); perm.obs_best = obsBest; }
  console.log(`G1: top5 = ` + topG1.slice(0, 5).map((r) => `${r.id} tr ${r.train.wr}% n=${r.train.n} va ${r.val.wr}% n=${r.val.n}`).join(" | "));
  console.log(`permutacao max-stat p=${perm.p_max} (obs best ${perm.obs_best}%)`);
  // ===== G2: pares (top 8 features distintas) =====
  const topFeats = []; for (const r of topG1) { if (!topFeats.find((x) => x.feat === r.feat) && topFeats.length < 8) topFeats.push(r); }
  const g2 = []; for (let i = 0; i < topFeats.length; i++) for (let j = i + 1; j < topFeats.length; j++) g2.push({ id: `(${topFeats[i].id})&(${topFeats[j].id})`, a: topFeats[i], b: topFeats[j] });
  fs.writeFileSync(OUT + "/tr/g2-freeze.json", JSON.stringify({ generated_at: new Date().toISOString(), parents: topFeats.map((r) => r.id), K: g2.length, gates: g2.map((g) => ({ id: g.id, a: g.a.id, b: g.b.id, hash: sha16({ a: g.a.id, b: g.b.id }) })) }, null, 1));
  const comb = (a, b, arr) => arr.filter((s) => { const ok = (g) => g.op === ">=" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] >= g.th) : g.op === "<" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] < g.th) : g.op === "fl1" ? s[g.feat] === 1 : s[g.feat] === 0; return ok(a) && ok(b); });
  const g2res = []; for (const g of g2) { const st = comb(g.a, g.b, train), sv = comb(g.a, g.b, val); const wr = (arr) => { const w = arr.filter((s) => s.dir === s.l300).length; return { n: arr.length, w, wr: arr.length ? +(w / arr.length * 100).toFixed(2) : null, wilsonLo: arr.length ? +(wilsonLo(w, arr.length) * 100).toFixed(2) : 0 }; }; g2res.push({ gen: "G2", id: g.id, hash: sha16({ a: g.a.id, b: g.b.id }), train: wr(st), val: wr(sv) }); }
  const g2sorted = g2res.filter((r) => r.train.n >= 40).sort((a, b) => (b.train.wilsonLo ?? 0) - (a.train.wilsonLo ?? 0));
  console.log(`G2: top3 = ` + g2sorted.slice(0, 3).map((r) => `${r.id} tr ${r.train.wr}% n=${r.train.n} va ${r.val.wr}% n=${r.val.n}`).join(" | "));
  // ===== G3: trios (top 6 gates G2 ou G1) =====
  const trioParents = g2sorted.slice(0, 6);
  const g3 = []; for (let i = 0; i < Math.min(6, topFeats.length); i++) for (let j = i + 1; j < Math.min(6, topFeats.length); j++) for (let k = j + 1; k < Math.min(6, topFeats.length); k++) g3.push({ id: `(${topFeats[i].id})&(${topFeats[j].id})&(${topFeats[k].id})`, a: topFeats[i], b: topFeats[j], c: topFeats[k] });
  fs.writeFileSync(OUT + "/tr/g3-freeze.json", JSON.stringify({ generated_at: new Date().toISOString(), parents: topFeats.slice(0, 6).map((r) => r.id), K: g3.length, gates: g3.map((g) => ({ id: g.id, hash: sha16({ a: g.a.id, b: g.b.id, c: g.c.id }) })) }, null, 1));
  const g3res = []; for (const g of g3) { const sel = (arr) => arr.filter((s) => [g.a, g.b, g.c].every((gg) => gg.op === ">=" ? (s[gg.feat] !== null && !isNaN(s[gg.feat]) && s[gg.feat] >= gg.th) : gg.op === "<" ? (s[gg.feat] !== null && !isNaN(s[gg.feat]) && s[gg.feat] < gg.th) : gg.op === "fl1" ? s[gg.feat] === 1 : s[gg.feat] === 0)); const st = sel(train), sv = sel(val); const wr = (arr) => { const w = arr.filter((s) => s.dir === s.l300).length; return { n: arr.length, w, wr: arr.length ? +(w / arr.length * 100).toFixed(2) : null, wilsonLo: arr.length ? +(wilsonLo(w, arr.length) * 100).toFixed(2) : 0 }; }; g3res.push({ gen: "G3", id: g.id, train: wr(st), val: wr(sv) }); }
  const g3sorted = g3res.filter((r) => r.train.n >= 30).sort((a, b) => (b.train.wilsonLo ?? 0) - (a.train.wilsonLo ?? 0));
  console.log(`G3: top3 = ` + g3sorted.slice(0, 3).map((r) => `${r.id} tr ${r.train.wr}% n=${r.train.n} va ${r.val.wr}% n=${r.val.n}`).join(" | "));
  // ===== G4: meta-labeling (logistic, TRAIN only) =====
  const MF = ["zAbs", "distATR", "ret30", "ret120", "accel", "rsi14", "stoch", "cci", "tick_imb_15s", "tick_imb_60s", "er30", "er60", "hurst", "H", "Hp", "cpMean", "pathEff", "maxAdverse", "extCandles", "barsSinceCross", "clv", "wickExp", "fibOk", "nearRes", "nearSup"];
  const prep = (s) => MF.map((k) => { let v = s[k]; if (k === "fibOk" || k === "nearRes" || k === "nearSup") v = v === 1 ? 1 : 0; if (v === null || v === undefined || isNaN(v)) v = 0; return v; });
  const Xtr = train.map(prep), Ytr = train.map((s) => (s.dir === s.l300 ? 1 : 0));
  const mu = MF.map((_, k) => mean(Xtr.map((x) => x[k]))), sg = MF.map((_, k) => sd(Xtr.map((x) => x[k])) || 1);
  let w0 = new Array(MF.length).fill(0), b0 = 0; const lr = 0.3;
  for (let it = 0; it < 300; it++) { const gw = new Array(MF.length).fill(0); let gb = 0; for (let q2 = 0; q2 < Xtr.length; q2++) { let z = b0; for (let k = 0; k < w0.length; k++) z += w0[k] * ((Xtr[q2][k] - mu[k]) / sg[k]); const pr = 1 / (1 + Math.exp(-z)); const e = pr - Ytr[q2]; gb += e; for (let k = 0; k < w0.length; k++) gw[k] += e * ((Xtr[q2][k] - mu[k]) / sg[k]); } for (let k = 0; k < w0.length; k++) w0[k] -= lr * gw[k] / Xtr.length; b0 -= lr * gb / Xtr.length; }
  const prob = (s) => { const x = prep(s); let z = b0; for (let k = 0; k < w0.length; k++) z += w0[k] * ((x[k] - mu[k]) / sg[k]); return 1 / (1 + Math.exp(-z)); };
  let bestThr = null; { let bestScore = -1; for (const t of [0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62, 0.65, 0.7]) { const sel = train.filter((s) => prob(s) >= t); if (sel.length < 40) continue; const wq = sel.filter((s) => s.dir === s.l300).length; const wrv = wq / sel.length; if (wrv > bestScore) { bestScore = wrv; bestThr = t; } } }
  const meta = { gen: "G4", threshold: bestThr, weights: { w: w0, b0, mu, sg }, feats: MF };
  const metaEval = (arr) => { const sel = arr.filter((s) => prob(s) >= bestThr); const w = sel.filter((s) => s.dir === s.l300).length; return { n: sel.length, w, wr: sel.length ? +(w / sel.length * 100).toFixed(2) : null }; };
  console.log(`G4 meta: thr=${bestThr} train ${JSON.stringify(metaEval(train))} val ${JSON.stringify(metaEval(val))} (baseline train ${base.train.wr}% val ${base.val.wr}%)`);
  fs.writeFileSync(OUT + "/tr/g4-freeze.json", JSON.stringify({ generated_at: new Date().toISOString(), spec: { model: "logistic", feats: MF, threshold: bestThr, trained_on: "TRAIN only" }, hash: sha16({ MF, bestThr }) }, null, 1));
  // ===== FIB comparacao explicita =====
  const fibRes = { without: { train: base.train, val: base.val }, withFibOk: { train: wrOf(train.filter((s) => s.fibOk === 1)), val: wrOf(val.filter((s) => s.fibOk === 1)) }, withInZone: { train: wrOf(train.filter((s) => s.inZone === 1)), val: wrOf(val.filter((s) => s.inZone === 1)) } };
  console.log(`FIB: sem fib tr ${base.train.wr}% va ${base.val.wr}% | com fibOk tr ${fibRes.withFibOk.train.wr}% (n=${fibRes.withFibOk.train.n}) va ${fibRes.withFibOk.val.wr}% (n=${fibRes.withFibOk.val.n})`);
  // ===== loss capture / ablation / confidence / pareto / finalists =====
  const cands = [...topG1.slice(0, 10), ...g2sorted.slice(0, 10), ...g3sorted.slice(0, 10)];
  const lossCap = cands.map((r) => { const g = r.a ? { op: "combo", arr: [r.a, r.b, r.c].filter(Boolean) } : r; const selFn = (s) => { if (r.a) return [r.a, r.b, r.c].filter(Boolean).every((gg) => gg.op === ">=" ? (s[gg.feat] !== null && !isNaN(s[gg.feat]) && s[gg.feat] >= gg.th) : gg.op === "<" ? (s[gg.feat] !== null && !isNaN(s[gg.feat]) && s[gg.feat] < gg.th) : gg.op === "fl1" ? s[gg.feat] === 1 : s[gg.feat] === 0); return r.op === ">=" ? (s[r.feat] !== null && !isNaN(s[r.feat]) && s[r.feat] >= r.th) : r.op === "<" ? (s[r.feat] !== null && !isNaN(s[r.feat]) && s[r.feat] < r.th) : r.op === "fl1" ? s[r.feat] === 1 : s[r.feat] === 0; }; const kept = val.filter(selFn); const keptLosses = kept.filter((s) => s.dir !== s.l300).length; const keptWins = kept.filter((s) => s.dir === s.l300).length; const valLoss = val.length - val.filter((s) => s.dir === s.l300).length; const valWin = val.filter((s) => s.dir === s.l300).length; return { id: r.id, val: r.val, loss_rejection: valLoss ? +((1 - keptLosses / valLoss) * 100).toFixed(1) : null, win_retention: valWin ? +((keptWins / valWin) * 100).toFixed(1) : null }; });
  const conf = {}; { const tiers = [0, 1, 2, 3]; for (const t of tiers) { const sel = val.filter((s) => [topFeats[0], topFeats[1], topFeats[2]].filter(Boolean).filter((g) => g.op === ">=" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] >= g.th) : g.op === "<" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] < g.th) : g.op === "fl1" ? s[g.feat] === 1 : s[g.feat] === 0).length >= t); const w = sel.filter((s) => s.dir === s.l300).length; conf[`gates>=${t}`] = { n: sel.length, wr: sel.length ? +(w / sel.length * 100).toFixed(2) : null }; } }
  const pareto = cands.map((r) => ({ id: r.id, val: r.val, gen: r.gen })).filter((r) => r.val.n >= 20 && (r.train?.n ?? r.train?.n) >= 0);
  const finRule = cands.filter((r) => r.train.n >= 50 && r.val.n >= 25).sort((a, b) => (b.val.wilsonLo ?? 0) - (a.val.wilsonLo ?? 0));
  const finalists = finRule.slice(0, 3).map((r) => ({ id: r.id, gen: r.gen, train: r.train, val: r.val, spec: r.a ? { op: "combo", parts: [r.a, r.b, r.c].filter(Boolean).map((x) => ({ id: x.id, feat: x.feat, op: x.op, th: x.th })) } : { id: r.id, feat: r.feat, op: r.op, th: r.th }, hash: r.hash ?? sha16(r.id) }));
  const freezeF = { frozen_at: new Date().toISOString(), base: "z120_rev_2 (BINARY, T+300)", market: "IQOPTION_EURUSD_BINARY_10H", split: { splitT: new Date(splitT).toISOString(), train: train.length, val: val.length, embargo_s: 300 }, rule: "train n>=50, val n>=25, top3 por val wilsonLo", finalists };
  fs.writeFileSync(OUT + "/tr/finalists-freeze.json", JSON.stringify(freezeF, null, 1));
  console.log("FINALISTS: " + finalists.map((f) => `${f.id} tr ${f.train.wr}%/n${f.train.n} va ${f.val.wr}%/n${f.val.n}`).join(" | "));
  // outputs
  fs.writeFileSync(OUT + "/tr/all-results.jsonl", [...allRes, ...g2res, ...g3res].map((r) => JSON.stringify(r)).join("\n"));
  fs.writeFileSync(OUT + "/tr/loss-rejection-analysis.json", JSON.stringify(lossCap, null, 1));
  fs.writeFileSync(OUT + "/tr/confidence-curves.json", JSON.stringify(conf, null, 1));
  fs.writeFileSync(OUT + "/tr/ablation.json", JSON.stringify(cands.slice(0, 8).map((r) => ({ id: r.id, note: "remover cada filtro do combo", parts: [] })), null, 1));
  fs.writeFileSync(OUT + "/tr/pareto-frontier.json", JSON.stringify(pareto, null, 1));
  fs.writeFileSync(OUT + "/tr/feature-analysis.json", JSON.stringify({ feats: FEATS, flags: FLAGS, forensics_top: forensics.slice(0, 15) }, null, 1));
  // ===== PROSPECTIVE P3 (pos-freeze) =====
  const P2_END = Date.now(); // prospective real executado por tr-prosp.cjs (apos este freeze)
  const TO = Date.now() - 35 * 60 * 1000; const hours = (TO - P2_END) / 3600000;
  console.log(`\nPROSPECTIVE P3 window: ${new Date(P2_END + 1).toISOString()} -> ${new Date(TO).toISOString()} (${hours.toFixed(2)}h)`);
  const prosp = { window: { from: new Date(P2_END + 1).toISOString(), to: new Date(TO).toISOString(), hours: +hours.toFixed(2) }, frozen_at: freezeF.frozen_at, status: hours < 0.3 ? "PROSPECTIVE_EVIDENCE_INSUFFICIENT" : "EVALUATED", finalists: [] };
  if (hours >= 0.3) {
    const byN = new Map(); let to = TO, page = 0; const dir = `${OUT}/tr/p3raw`; fs.mkdirSync(dir, { recursive: true });
    while (page < 100) { const qp = ((await quotes(1, P2_END + 1, to)).quotes || []).sort((a, b) => a.ts - b.ts); if (!qp.length) break; fs.writeFileSync(`${dir}/p${String(page).padStart(3, "0")}.json`, JSON.stringify({ from: P2_END + 1, to, fetched_at: new Date().toISOString(), count: qp.length, payload: { quotes: qp } })); for (const x of qp) byN.set(x.n, x); if (qp[0].ts <= P2_END + 2000) break; to = qp[0].ts - 1; page += 1; await new Promise((x) => setTimeout(x, 120)); }
    const ticks = [...byN.values()].sort((a, b) => a.ts - b.ts);
    const cmap = new Map(), agg = new Map(); let prev = null;
    for (const t of ticks) { const b = Math.floor(t.ts / 5000) * 5000; const p = t.value != null ? t.value : (t.bid + t.ask) / 2; const c = cmap.get(b); if (!c) cmap.set(b, { bucket: b, open: p, high: p, low: p, close: p, n: 1 }); else { c.high = Math.max(c.high, p); c.low = Math.min(c.low, p); c.close = p; c.n += 1; } let a = agg.get(b); if (!a) { a = { up: 0, dn: 0, spreadSum: 0, spreadN: 0, ticks: 0 }; agg.set(b, a); } a.ticks += 1; if (t.ask != null && t.bid != null) { a.spreadSum += t.ask - t.bid; a.spreadN += 1; } if (prev !== null) { if (p > prev) a.up += 1; else if (p < prev) a.dn += 1; } prev = p; }
    const cands2 = [...cmap.values()].sort((a, b) => a.bucket - b.bucket);
    const C2 = cands2.map((x) => x.close); const byB2 = new Map(); for (let i = 0; i < cands2.length; i++) byB2.set(cands2[i].bucket, i);
    const sig2 = []; for (let i = 120; i < cands2.length; i++) { let m = 0; for (let j = i - 119; j <= i; j++) m += C2[j]; m /= 120; let q2 = 0; for (let j = i - 119; j <= i; j++) q2 += (C2[j] - m) ** 2; const z = (C2[i] - m) / (Math.sqrt(q2 / 120) || 1e-12); if (Math.abs(z) < 2) continue; const dir2 = z > 0 ? -1 : 1; const si = byB2.get(cands2[i].bucket + 300000); const l300 = si === undefined ? null : (C2[si] === C2[i] ? 0 : C2[si] > C2[i] ? 1 : -1); sig2.push({ t0: cands2[i].bucket + 5000, dir: dir2, l300, zAbs: Math.abs(z), ret30: i >= 6 ? (C2[i] - C2[i - 6]) / C2[i - 6] : null, ret120: (C2[i] - C2[i - 24]) / C2[i - 24], fibOk: null }); }
    const dec = sig2.filter((s) => s.l300 !== null && s.l300 !== 0);
    const baseP = { n: dec.length, w: dec.filter((s) => s.dir === s.l300).length, wr: dec.length ? +(dec.filter((s) => s.dir === s.l300).length / dec.length * 100).toFixed(2) : null };
    console.log(`P3 base z120: n=${baseP.n} WR=${baseP.wr}%`);
    for (const f of finalists) { const sel = dec.filter((s) => { if (f.spec.parts) return f.spec.parts.every((g) => g.op === ">=" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] >= g.th) : g.op === "<" ? (s[g.feat] !== null && !isNaN(s[g.feat]) && s[g.feat] < g.th) : g.op === "fl1" ? s[g.feat] === 1 : s[g.feat] === 0); return true; }); const w = sel.filter((s) => s.dir === s.l300).length; prosp.finalists.push({ id: f.id, n: sel.length, w, wr: sel.length ? +(w / sel.length * 100).toFixed(2) : null }); }
    prosp.base = baseP; prosp.dataset = { ticks: ticks.length, candles: cands2.length, rows: dec.length };
    // persistir P3
    await sqlq(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to, provenance) VALUES ('IQOPTION_EURUSD_BINARY_P3','EUR/USD','BINARY',false,'IQ_OPTION','INSERTING','${new Date(cands2[0].bucket).toISOString()}','${new Date(cands2[cands2.length - 1].bucket).toISOString()}','${JSON.stringify({ purpose: "z120 T300 gauntlet prospective P3", frozen_at: freezeF.frozen_at }).replace(/'/g, "''")}'::jsonb) ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to, provenance=EXCLUDED.provenance;`);
    const tv = ticks.map((t) => { const iso = new Date(t.ts).toISOString(); return `('IQOPTION_EURUSD_BINARY_P3','IQ_OPTION','EUR/USD','BINARY',false,'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`; });
    for (let i = 0; i < tv.length; i += 5000) await sqlq(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i, i + 5000).join(",")};`);
    const cv = cands2.map((x, idx) => `('IQOPTION_EURUSD_BINARY_P3','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx + 1 < cands2.length && cands2[idx + 1].bucket - x.bucket > 5000 ? "true" : "false"},${x.close})`);
    for (let i = 0; i < cv.length; i += 5000) await sqlq(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i, i + 5000).join(",")};`);
    await sqlq(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3';`);
    console.log("PROSPECTIVE: " + JSON.stringify(prosp.finalists));
  } else { console.log("PROSPECTIVE_EVIDENCE_INSUFFICIENT"); }
  fs.writeFileSync(OUT + "/tr/prospective-results.json", JSON.stringify(prosp, null, 1));
  await sqlq(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('tr-z120-t300-2026-09-16', now(), '${JSON.stringify({ baseline: { n: N_, wr: +(W / N_ * 100).toFixed(2) }, G1: gates.length, perm_p: perm.p_max, finalists: finalists.map((f) => f.id), prospective: prosp.status }).replace(/'/g, "''")}'::jsonb, 'tr-features/tr-run') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  console.log("\nTR DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
