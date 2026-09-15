// prod-validation.cjs — teste focado das versões de PRODUÇÃO (V1/V3/V6/V7 + variantes oficiais) nas 10h IQ Option já persistidas.
// Fontes congeladas: benchmark-freeze.json (specs+hashes, GitHub), gauntlet-compile.cjs (implementação "prod"), REGISTRO-TECNICO-ESTRATEGIAS.md.
// Dados: iqopt_candles_5s no Supabase (MESMOS datasets validados; nada é refetchado). Engine: run-all.cjs v2 causal.
const fs = require("fs");
const crypto = require("crypto");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const GH = "https://raw.githubusercontent.com/WmAgencia/tracecom/main";
async function getText(u) { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return await r.text(); }
async function getJson(u) { return JSON.parse(await getText(u)); }
async function sql(q) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); if (r.ok) return await r.json(); if (a === 2) throw new Error("SQL fail " + r.status); await new Promise((x) => setTimeout(x, 1200)); } }
(async () => {
  // 1) MANIFEST de identificação (antes de executar)
  const freeze = await getJson(GH + "/docs/consultas-e-testes/iqoption/benchmark/benchmark-freeze.json");
  const f = (id) => freeze.strategies.find((s) => s.strategy_id === id);
  const MANIFEST = [
    { version: "V1", strategy_id: "prod_v1fib", internal_id: "reversion-v1-fib", source_file: "gauntlet-compile.cjs (case prod) + REGISTRO-TECNICO-ESTRATEGIAS.md", relation: "principal" },
    { version: "V3", strategy_id: "prod_v3fib", internal_id: "reversion-v3-fib", source_file: "gauntlet-compile.cjs (case prod) + REGISTRO-TECNICO-ESTRATEGIAS.md", relation: "principal" },
    { version: "V6", strategy_id: "prod_v6fib", internal_id: "reversion-v6-fib", source_file: "gauntlet-compile.cjs (case prod) + REGISTRO-TECNICO-ESTRATEGIAS.md", relation: "principal" },
    { version: "V7", strategy_id: "prod_v7and", internal_id: "reversion-v7-and", source_file: "gauntlet-compile.cjs (case prod) + REGISTRO-TECNICO-ESTRATEGIAS.md", relation: "principal (V7-AND)" },
    { version: "V7 (variante)", strategy_id: "prod_v7relaxed", internal_id: "reversion-v7-relaxed", source_file: "gauntlet-compile.cjs (case prod) + REGISTRO-TECNICO-ESTRATEGIAS.md", relation: "VARIANTE DE V7 (união relaxada ATR 1x OU V1fib)" },
    { version: "V2 (variante)", strategy_id: "prod_v2fib", internal_id: "(sem id interno; composto gateFib(rsi_vol .22/.0012))", source_file: "benchmark-freeze.json (addDef) + REGISTRO-TECNICO-ESTRATEGIAS.md (V2)", relation: "VARIANTE DE V1/V3 (mesma família, sem filtro de tendência)" },
  ];
  for (const m of MANIFEST) { const d = f(m.strategy_id); if (!d) throw new Error("spec ausente no freeze: " + m.strategy_id); m.spec = d.spec; m.hash = d.hash; m.rules = d.family; }
  const BASE_IDS = ["always_buy", "always_sell", "random42", "last_candle"];
  for (const b of BASE_IDS) { const d = f(b); MANIFEST.push({ version: "-", strategy_id: b, internal_id: b, source_file: "benchmark-freeze.json (G0)", relation: "baseline", spec: d.spec, hash: d.hash, rules: d.family }); }
  fs.writeFileSync(OUT + "/prod-validation-manifest.json", JSON.stringify({ generated_at: new Date().toISOString(), note: "V1/V2/V3/V6/V7 são os IDs de produção do pipeline de perfis; V4/V5 não existem nessa linhagem (confirmado no registry/freeze).", manifest: MANIFEST }, null, 1));
  console.log("MANIFEST:"); for (const m of MANIFEST) console.log(`  ${m.version} | ${m.strategy_id} | hash=${m.hash} | ${m.relation}`);
  // 2) dados persistidos (Supabase) + engine v2
  const runAll = await getText(GH + "/docs/consultas-e-testes/iqoption/scripts/run-all.cjs");
  const prefix = runAll.slice(0, runAll.indexOf("(async () => {"));
  const engine = new Function("require", "__dirname", prefix + "\n;return { buildCandles, buildRows, featuresAt }; ")(require, __dirname);
  const GC = require(OUT + "/gauntlet-compile.cjs");
  const dsIds = ["IQOPTION_EURUSD_BINARY_10H", "IQOPTION_EURUSD_OTC_10H"];
  function metrics(v, rows, baseP) {
    let sig = 0, b = 0, s = 0, w = 0, l = 0, d = 0, u = 0, bw = 0, bl = 0, sw = 0, sl = 0, iw = 0, il = 0, in_ = 0, curW = 0, curL = 0, maxW = 0, maxL = 0;
    for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === 0) continue; sig += 1; if (x === 1) b += 1; else s += 1; const y = rows[i].l60; if (y === null) { u += 1; continue; } if (y === 0) { d += 1; continue; } const win = x === y; if (win) { w += 1; curW += 1; curL = 0; if (curW > maxW) maxW = curW; } else { l += 1; curL += 1; curW = 0; if (curL > maxL) maxL = curL; } if (x === 1) { if (y === 1) bw += 1; else bl += 1; } else { if (y === -1) sw += 1; else sl += 1; } if (rows[i].indep) { in_ += 1; if (win) iw += 1; else il += 1; } }
    const n = w + l, bn = bw + bl, sn = sw + sl;
    const baseStrategy = sig ? (b * baseP + s * (1 - baseP)) / sig : null;
    return { signals: sig, buyN: b, sellN: s, w, l, draws: d, unknown: u, wr: n ? +((w / n) * 100).toFixed(2) : null, coverage: +((sig / rows.length) * 100).toFixed(2), buyW: bw, buyL: bl, buyWR: bn ? +((bw / bn) * 100).toFixed(2) : null, sellW: sw, sellL: sl, sellWR: sn ? +((sw / sn) * 100).toFixed(2) : null, indepN: in_, indepWR: in_ ? +((iw / in_) * 100).toFixed(2) : null, maxWinStreak: maxW, maxLossStreak: maxL, baseStrategy: baseStrategy === null ? null : +(baseStrategy * 100).toFixed(2), edge_pp: n && baseStrategy !== null ? +(((w / n) - baseStrategy) * 100).toFixed(2) : null };
  }
  const results = { generated_at: new Date().toISOString(), source: "Supabase iqopt_candles_5s (MESMOS datasets; nada refetchado)", engine: "run-all.cjs v2 causal", datasets: {} };
  for (const dsId of dsIds) {
    const rowsDb = [];
    for (let off = 0; ; off += 3000) { const p = await sql(`SELECT EXTRACT(EPOCH FROM bucket)*1000 AS b, open, high, low, close, tick_count FROM iqopt_candles_5s WHERE dataset_id='${dsId}' ORDER BY bucket LIMIT 3000 OFFSET ${off};`); rowsDb.push(...p); if (p.length < 3000) break; }
    const candles = rowsDb.map((r) => ({ bucket: Number(r.b), open: +r.open, high: +r.high, low: +r.low, close: +r.close, n: +r.tick_count }));
    const rows = engine.buildRows(candles);
    let last = -1e18; for (const r of rows) { r.indep = r.t0 - last >= 90000 ? 1 : 0; if (r.indep) last = r.t0; }
    let up = 0, dn = 0; for (const r of rows) { if (r.l60 === 1) up += 1; else if (r.l60 === -1) dn += 1; }
    const baseP = up / (up + dn);
    const ctx = GC.loadCtx(rows.map((r) => ({ split: "IQEXT", indep: r.indep, asset: "X", t0: r.t0, l60: r.l60, f: r.f })));
    const per = {};
    for (const m of MANIFEST) { const v = GC.compile(m.spec, ctx); per[m.strategy_id] = metrics(v, rows, baseP); }
    results.datasets[dsId] = { candles: candles.length, rows: rows.length, base_market_up: +(baseP * 100).toFixed(2), strategies: per };
    // cross-check contra iqopt_benchmark (Supabase)
    const bench = await sql(`SELECT strategy_id, metrics FROM iqopt_benchmark WHERE dataset_id='${dsId}' AND grp='G1_producao';`);
    const xc = [];
    for (const br of bench) { const mine = per[br.strategy_id]; if (!mine) continue; const ok = mine.signals === br.metrics.signals && mine.w === br.metrics.w && mine.l === br.metrics.l; xc.push({ strategy_id: br.strategy_id, match: ok, mine: { s: mine.signals, w: mine.w, l: mine.l }, bench: { s: br.metrics.signals, w: br.metrics.w, l: br.metrics.l } }); }
    results.datasets[dsId].cross_check_vs_iqopt_benchmark = xc;
    console.log(`\n=== ${dsId} | base up=${(baseP * 100).toFixed(2)}% | rows=${rows.length}`);
    for (const m of MANIFEST) { const r = per[m.strategy_id]; console.log(`  ${m.strategy_id}: sig=${r.signals} W=${r.w} L=${r.l} D=${r.draws} U=${r.unknown} WR=${r.wr}% cov=${r.coverage}% BUY ${r.buyN}/${r.buyWR}% SELL ${r.sellN}/${r.sellWR}% indep ${r.indepN}/${r.indepWR}% edge=${r.edge_pp}pp`); }
    console.log("  cross-check vs benchmark: " + xc.map((x) => `${x.strategy_id}=${x.match ? "OK" : "DIVERGE"}`).join(" "));
  }
  // 3) comparação com resultados anteriores oficiais
  const blind = await getJson(GH + "/docs/consultas-e-testes/gauntlet/blind-holdout-results.json");
  const prevHold = Object.fromEntries(blind.references.filter((r) => r.id.startsWith("prod_")).map((r) => [r.id, { wr: r.acc, n: r.n }]));
  const log = (await getText(GH + "/docs/consultas-e-testes/gauntlet/search-log.jsonl")).trim().split("\n").map((x) => JSON.parse(x));
  const prevDisc = Object.fromEntries(log.filter((e) => e.family === "production").map((e) => [e.id, { disc_acc: e.disc.acc, disc_n: e.disc.n, val_acc: e.val.acc, val_n: e.val.n }]));
  results.comparison = { previous_hold_blind: prevHold, previous_gauntlet_disc_val: prevDisc };
  fs.writeFileSync(OUT + "/prod-validation-results.json", JSON.stringify(results, null, 1));
  console.log("\ncomparação — previous HOLD(blind) vs IQ:");
  for (const m of MANIFEST.filter((x) => x.version.startsWith("V"))) { const ph = prevHold[m.strategy_id]; const bin = results.datasets[dsIds[0]].strategies[m.strategy_id]; const otc = results.datasets[dsIds[1]].strategies[m.strategy_id]; console.log(`  ${m.strategy_id}: prev ${ph ? ph.wr * 100 : "-"}% (n=${ph ? ph.n : "-"}) | IQ bin ${bin.wr}% | Δ ${ph && bin.wr !== null ? (bin.wr - ph.wr * 100).toFixed(1) : "-"} | IQ otc ${otc.wr}% | Δ ${ph && otc.wr !== null ? (otc.wr - ph.wr * 100).toFixed(1) : "-"}`); }
  console.log("DONE prod-validation-results.json");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
