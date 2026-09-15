// bench-finalize.cjs — persiste benchmark no Supabase (iqopt_benchmark) + gera benchmark-report.md + prepara GitHub.
const fs = require("fs");
const OUT = __dirname;
const REF = "cladmauwmuoeqongxzwb";
const TOK = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOK || !TOK.startsWith("sbp_")) throw new Error("token ausente");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const q1 = (v) => { if (v === null || v === undefined) return "NULL"; if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL"; if (typeof v === "boolean") return v ? "true" : "false"; return "'" + String(v).replace(/'/g, "''") + "'"; };
async function sql(query) { for (let a = 0; a < 3; a++) { const r = await fetch(API, { method: "POST", headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" }, body: JSON.stringify({ query }) }); if (r.ok) return await r.json(); const b = await r.text(); if (a === 2) throw new Error("SQL fail " + r.status + ": " + b.slice(0, 200)); await new Promise((x) => setTimeout(x, 1200)); } }
const fmt = (x, d = 2) => (x === null || x === undefined ? "-" : (typeof x === "number" ? x.toFixed(d) : x));
(async () => {
  const freeze = JSON.parse(fs.readFileSync(OUT + "/benchmark-freeze.json", "utf8"));
  const results = JSON.parse(fs.readFileSync(OUT + "/benchmark-results.json", "utf8"));
  const comboFreeze = JSON.parse(fs.readFileSync(OUT + "/benchmark-combos-freeze.json", "utf8"));
  const comboRes = JSON.parse(fs.readFileSync(OUT + "/benchmark-combos-results.json", "utf8"));
  console.log("artefatos carregados. freeze:", freeze.totals.unique_specs, "combos:", comboFreeze.hypotheses);
  await sql(`CREATE TABLE IF NOT EXISTS iqopt_benchmark (id bigserial PRIMARY KEY, dataset_id text NOT NULL, strategy_id text NOT NULL, spec_hash text NOT NULL, grp text NOT NULL, family text, spec jsonb, metrics jsonb, created_at timestamptz DEFAULT now());`);
  await sql(`CREATE INDEX IF NOT EXISTS iqopt_benchmark_ds ON iqopt_benchmark (dataset_id, spec_hash);`);
  await sql(`CREATE TABLE IF NOT EXISTS iqopt_benchmark_meta (run_id text PRIMARY KEY, generated_at timestamptz, totals jsonb, engine text, created_at timestamptz DEFAULT now());`);
  await sql(`DELETE FROM iqopt_benchmark;`);
  const rows = [];
  for (const dsId of Object.keys(results.datasets)) { for (const e of results.datasets[dsId].strategies) { if (!e.metrics) continue; rows.push([dsId, e.strategy_id, e.hash, e.group, e.family ?? null, JSON.stringify(e.spec), JSON.stringify(e.metrics)]); } }
  for (const dsId of Object.keys(comboRes.datasets)) { for (const e of [...comboRes.datasets[dsId].top50, ...comboRes.datasets[dsId].survivors]) { if (!e.metrics) continue; rows.push([dsId, e.strategy_id, e.hash, "G3_exploratorio", e.family ?? null, JSON.stringify(e.spec), JSON.stringify(e.metrics)]); } }
  const uniq = new Map(); for (const r of rows) uniq.set(r[0] + "|" + r[2], r);
  const allRows = [...uniq.values()];
  console.log(`rows para inserir: ${allRows.length}`);
  for (let i = 0; i < allRows.length; i += 300) {
    const chunk = allRows.slice(i, i + 300);
    const vals = chunk.map((r) => `(${r.map(q1).join(",")})`).join(",");
    await sql(`INSERT INTO iqopt_benchmark (dataset_id, strategy_id, spec_hash, grp, family, spec, metrics) VALUES ${vals};`);
    if (i % 3000 === 0) console.log(`  inseridos ${i + chunk.length}/${allRows.length}`);
  }
  await sql(`INSERT INTO iqopt_benchmark_meta (run_id, generated_at, totals, engine) VALUES ('bench-2026-09-15', now(), '${JSON.stringify({ ...freeze.totals, hypotheses_G3: comboFreeze.hypotheses, datasets: Object.keys(results.datasets) }).replace(/'/g, "''")}'::jsonb, 'run-all.cjs v2 causal (GitHub)') ON CONFLICT (run_id) DO UPDATE SET generated_at=now(), totals=EXCLUDED.totals;`);
  const chk = await sql(`SELECT dataset_id, grp, count(*)::int AS n FROM iqopt_benchmark GROUP BY 1,2 ORDER BY 1,2;`);
  console.log("VERIFICACAO SUPABASE:", JSON.stringify(chk));
  // relatório md
  const L = [];
  L.push("# BENCHMARK COMPLETO — IQ OPTION 10h (BINARY + OTC)");
  L.push("");
  L.push(`> Engine: **run-all.cjs v2 causal** (GitHub, extraída sem modificação; truncamento PASS 50/50 em ambos datasets). Dados: \`iqopt_candles_5s\` (Supabase).`);
  L.push(`> **Nada foi otimizado.** ${freeze.totals.unique_specs} specs únicos congelados com hash ANTES da avaliação (benchmark-freeze.json). Resultados ruins permanecem.`);
  L.push("");
  L.push("## TOTAIS");
  L.push(`- Estratégias no inventário: **${freeze.totals.unique_specs}** (G1 produção: ${freeze.totals.by_group.G1_producao}, G2 pré-existentes do Gauntlet: ${freeze.totals.by_group.G2_pre_existente}, G0 baselines: ${freeze.totals.by_group.G0_baseline})`);
  L.push(`- Testadas (por dataset): **968** · inválidas: **0**`);
  L.push(`- Hipóteses exploratórias novas (G3, pares mecânicos de ${comboFreeze.atoms} átomos ativos): **${comboFreeze.hypotheses}** (freeze separado ANTES da avaliação; BH-FDR por dataset)`);
  L.push(`- TraceCon 1M (extension/local-engine.js): ${freeze.trace1m}`);
  L.push("");
  const short = [];
  for (const dsId of Object.keys(results.datasets)) {
    const ds = results.datasets[dsId];
    L.push(`## ${dsId}`);
    L.push(`Base rate (up): ${ds.base_market_p_up}% · candles: 7201 · linhas: ${ds.counts.total} · independentes(90s): ${ds.counts.indep} · draws ${ds.counts.draw} · unknown ${ds.counts.unk}`);
    L.push("");
    L.push("### TOP 15 por z-score (n≥50) — G0/G1/G2");
    L.push("| Strategy | sig | W | L | WR% | BUY WR% | SELL WR% | base% | edge pp | z | indep n/WR% | maxW/maxL |");
    L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const e of ds.strategies.filter((x) => x.metrics && x.metrics.w + x.metrics.l >= 50).slice(0, 15)) {
      const m = e.metrics;
      L.push(`| ${e.strategy_id} | ${m.signals} | ${m.w} | ${m.l} | ${fmt(m.wr_no_draws)} | ${fmt(m.buyWR)} | ${fmt(m.sellWR)} | ${fmt(m.baseStrategy)} | ${fmt(m.edge_pp)} | ${fmt(m.z)} | ${m.indep_n}/${fmt(m.indep_wr)} | ${m.max_win_streak}/${m.max_loss_streak} |`);
      if (m.indep_n >= 20 && m.indep_wr >= 52 && m.wr_no_draws >= 52 && m.edge_pp > 0) short.push({ ds: dsId, id: e.strategy_id, wr: m.wr_no_draws, n: m.w + m.l, indep: `${m.indep_n}/${fmt(m.indep_wr)}`, z: m.z, edge: m.edge_pp });
    }
    const c = comboRes.datasets[dsId];
    L.push("");
    L.push(`### G3 exploratórios — K=${c.K}, sobreviventes q≤0.1 & n≥100: **${c.q10_survivors_n100}**`);
    L.push("| Strategy | q | sig | WR% | edge pp | z |");
    L.push("|---|---|---|---|---|---|");
    for (const sv of c.survivors.slice(0, 10)) L.push(`| ${sv.strategy_id} | ${sv.q} | ${sv.metrics.signals} | ${fmt(sv.metrics.wr_no_draws)} | ${fmt(sv.metrics.edge_pp)} | ${fmt(sv.metrics.z)} |`);
    L.push("");
  }
  L.push("## ESTRATÉGIAS QUE MERECEM NOVA VALIDAÇÃO (hipóteses, NÃO 'vencedoras')");
  L.push("Critério mecânico: WR≥52% com n≥50 nos G1/G2 + subamostra independente (90s) com n≥20 e WR≥52%; listadas com métricas dos DOIS datasets.");
  L.push("| Strategy | dataset | n | WR% | indep | z | edge pp |");
  L.push("|---|---|---|---|---|---|---|");
  const byId = new Map(short.map((s) => [s.id + "|" + s.ds, s]));
  results.datasets && Object.keys(results.datasets).forEach(() => { });
  const seen = new Set();
  for (const s of short.sort((a, b) => (b.z ?? 0) - (a.z ?? 0))) { if (seen.has(s.id)) continue; seen.add(s.id); L.push(`| ${s.id} | ${s.ds} | ${s.n} | ${fmt(s.wr)} | ${s.indep} | ${fmt(s.z)} | ${fmt(s.edge)} |`); }
  L.push("");
  L.push("**Aviso estatístico**: janelas de 5s são sobrepostas (pseudo-replicação); o z e o CI tratam-nas como independentes e SÃO OTIMISTAS. A subamostra independente (90s) e o q-value (G3) qualificam a leitura. Nenhuma estratégia deve ser declarada lucrativa com base nestas 10h; a próxima etapa é congelar candidatas e testar em dados NOVOS.");
  fs.writeFileSync(OUT + "/benchmark-report.md", L.join("\n"));
  console.log("benchmark-report.md escrito (" + L.length + " linhas)");
  await sql(`UPDATE iqopt_benchmark_meta SET totals = totals || '${JSON.stringify({ report_lines: L.length }).replace(/'/g, "''")}'::jsonb WHERE run_id='bench-2026-09-15';`);
  console.log("DONE");
})().catch((e) => { console.error("ERR " + (e && e.stack || e.message)); process.exit(1); });
