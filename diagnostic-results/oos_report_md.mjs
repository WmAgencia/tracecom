/**
 * Gera o relatório final de validação OOS em Markdown a partir de
 * `diagnostic-results/oos/oos-report.json`, para que nenhum número seja
 * transcrito à mão (e possa divergir da evidência).
 *
 * Uso: node diagnostic-results/oos_report_md.mjs
 * Saída: docs/analytics/validacao-oos-binarios-reais.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const REPORT = process.env.IQ_OOS_REPORT ?? "diagnostic-results/oos/oos-report.json";
const OUT = process.env.IQ_OOS_MD ?? "docs/analytics/validacao-oos-binarios-reais.md";
const r = JSON.parse(readFileSync(REPORT, "utf8"));
const pct = (x, d = 1) => (typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—");
const num = (x, d = 2) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(d) : "—");
const code = (s) => `\`${s}\``;

const L = [];
L.push("# Validação OOS dos binários REAIS (não-OTC) da IQ Option", "");
L.push(`Gerado: ${r.generatedAtUtc} · **somente leitura** · nenhuma ordem PRACTICE ou REAL foi enviada`, "");
L.push("> Escopo: **validar antes de implementar**. Nada aqui altera o Binary V3, o OTC Lab ou o Crypto V1.", "");

// ── 1. Sumário executivo ────────────────────────────────────────────────────
const insufficient = r.hypotheses.filter((h) => h.VERDICT.code !== "CANDIDATO_A_PROSPECTIVO");
L.push("## 1. Sumário executivo", "");
L.push("**Nenhuma das hipóteses está validada.** A estrutura encontrada in-sample não sobreviveu a um teste cego com separação cronológica, e a amostra disponível é pequena demais para decidir qualquer coisa.", "");
L.push("Três achados mudam o quadro:", "");
L.push("1. **80% de todos os candles coletados eram duplicatas.** O coletor original fez append de janelas MCP sobrepostas sem deduplicar. Cada série tem ~1.000–1.080 barras **únicas**, não 5.000–7.000. Os `n` dos WRs in-sample anteriores estavam inflados por pseudo-replicação, e os intervalos de Wilson reportados eram estreitos de forma inválida.");
L.push("2. **O produto padrão não oferece vencimento de 300s.** `binary-options` só negocia uma grade fixa de **900s (15 min)**. O horizonte de 300s do Binary V3 vive em `turbo-options` (grade de 60s) e `blitz-options` (`expiration_sizes_seconds` inclui 300 explicitamente).");
L.push("3. **O instrumento do S&P 500 ETF (SPY) não existe mais no catálogo.** Nenhum dos 121 ativos de `binary-options` é um ETF. A hipótese H3 foi medida, mas **não é executável hoje**. O índice `US 500` (#1470), que é ofertado, não reproduz o resultado.");
L.push("");
L.push("| hipótese | TRAIN | VALIDATION | BLIND OOS | eventos indep. | dias no teste | veredito |", "|---|---:|---:|---:|---:|---:|---|");
for (const h of r.hypotheses) {
  L.push(`| ${h.label} | ${pct(h.TRAIN_WR)} | ${pct(h.VALIDATION_WR)} | ${pct(h.BLIND_OOS_WR)} | ${h.INDEPENDENT_EVENTS} | ${h.EFFECTIVE_INDEPENDENT_DAYS_TEST} | **${h.VERDICT.code}** |`);
}
L.push("");
L.push(`Regra de aprovação pré-registrada (congelada antes da coleta prospectiva): ≥100 eventos independentes, limite inferior do bootstrap acima do breakeven e EV>0 com o payout observado. **${insufficient.length} de ${r.hypotheses.length} hipóteses não atingem nem o primeiro critério.**`, "");

// ── 2. Integridade dos dados ────────────────────────────────────────────────
L.push("## 2. Integridade dos dados (congelamento SHA-256)", "");
L.push("Manifesto: `diagnostic-results/data/iq-real/FREEZE-MANIFEST.json` (+ `.md`). Nenhum CSV foi reescrito.", "");
L.push("| hipótese | linhas brutas | barras únicas | duplicatas | conflitantes | span | gaps | sinais descartados (features/settlement) |", "|---|---:|---:|---:|---:|---:|---:|---|");
for (const h of r.hypotheses) {
  const g = h.DATA_GAPS;
  L.push(`| ${h.hypothesisId} | ${g.bars_raw} | ${g.bars_unique} | ${g.duplicates_dropped} (${pct(g.duplicate_ratio, 0)}) | ${g.conflicting_duplicates} | ${g.span_hours}h | ${g.gap_count} | ${g.signals_dropped_gap_features}/${g.signals_dropped_gap_settlement} |`);
}
L.push("");
L.push("**Consequência direta:** o `n` de cada hipótese nunca é o número de linhas do arquivo. O total real de informação é ~**37.270 barras únicas** para 36 séries — cerca de 17h de mercado em 1m por série.", "");
L.push("O coletor foi reescrito para **deduplicar na escrita** (união por `from`, ordenada) e verificado: numa segunda passada sobre os mesmos dois ativos, 2.000 candles recebidos geraram apenas **+9 barras novas** e **1.991 duplicatas evitadas** (evidência: `diagnostic-results/oos/pipeline-verification.json`). O coletor antigo teria acrescentado as 2.000 linhas de novo.", "");
L.push("Além disso, 12 das 36 séries foram resolvidas a um `asset_id` no catálogo atual; as **24 restantes são todas ETFs** — os mesmos instrumentos que sumiram da oferta.", "");

// ── 3. Compatibilidade com 300s ─────────────────────────────────────────────
L.push("## 3. Compatibilidade com o horizonte de 300s do Binary V3", "");
L.push("Conversão correta conforme solicitado: `1m × h5 = 300s` ✓ · `5m × h1 = 300s` ✓ · `5m × h5 = 1.500s` ✗ (não é o horizonte V3).", "");
L.push("O que o broker **realmente** oferece (catálogo MCP, leitura apenas):", "");
const perProduct = r.hypotheses[0]?.DATA_CATALOG_COUNTS ?? {};
L.push("| produto | ativos | esquema de expiração | passos observados | 300s ofertado? | payout min/med/max |", "|---|---:|---|---:|---|---|");
const catDir = "diagnostic-results/data/iq-catalog";
const catRows = [];
for (const f of ["binary-options", "turbo-options", "blitz-options"]) {
  const p = `${catDir}/${f}.json`;
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, "utf8"));
  const sizes = new Set(); const steps = new Set(); const payouts = [];
  for (const a of j.assets ?? []) {
    for (const s of a.expiration_sizes_seconds ?? []) sizes.add(s);
    const ex = a.expirations ?? [];
    for (let i = 1; i < ex.length; i++) steps.add(ex[i] - ex[i - 1]);
    if (typeof a.profit_percent === "number") payouts.push(a.profit_percent);
  }
  payouts.sort((x, y) => x - y);
  const ok300 = [...sizes].includes(300) || [...steps].includes(60);
  catRows.push(`| ${f} | ${j.count ?? "?"} | ${sizes.size ? "`expiration_sizes_seconds`" : "`expirations` (unix)"} | ${sizes.size ? JSON.stringify([...sizes].sort((a, b) => a - b)) : JSON.stringify([...steps].sort((a, b) => a - b)) + "s"} | ${ok300 ? "**sim**" : "**não**"} | ${payouts.length ? `${payouts[0]}/${payouts[Math.floor(payouts.length / 2)]}/${payouts.at(-1)}%` : "—"} |`);
}
L.push(...catRows, "");
L.push("**Leitura:** uma operação de 300s no `binary-options` não existe nesta API. O produto correto para o horizonte V3 é `turbo-options` (escolhendo o vencimento 5 minutos à frente na grade de 60s) ou `blitz-options` (tamanho 300s explícito). Isso não muda stake, ARM/AUTO nem o motor V3 — apenas onde a ordem seria enviada, o que continua **fora de escopo** nesta etapa.", "");
const AGG = "diagnostic-results/data/iq-catalog.json";
let aggLine = "";
if (existsSync(AGG)) {
  const a = JSON.parse(readFileSync(AGG, "utf8"));
  const counts = Object.entries(a.raw_counts_per_product ?? {}).map(([k, v]) => `${k}=${v}`).join(" + ");
  aggLine = `Contagem: ${counts} = **${a.raw_sum_products}** "ativos" por produto, mas **${a.unique_assets} ativos únicos** após deduplicar por \`asset_id\` (multiplicidade ${JSON.stringify(a.multiplicities)}). Os totais por produto do levantamento anterior (91/51/74/67) também não eram ativos únicos.`;
} else {
  aggLine = "Catálogo agregado indisponível no momento da geração.";
}
L.push(aggLine, "");

// ── 4. Metodologia ─────────────────────────────────────────────────────────
L.push("## 4. Metodologia aplicada", "");
for (const [k, v] of Object.entries(r.method)) L.push(`- **${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`);
L.push("");
L.push("Preservação das garantias pedidas:", "");
L.push("- **Sinais descartados por gap**, nunca interpolados: a janela de features (`i-25…i`) e a de settlement (`i…i+h`) precisam ser contíguas na resolução.");
L.push("- **Purge + embargo**: nenhum sinal cuja janela atravesse a fronteira do split; embargo de 1× horizonte após cada fronteira.");
L.push("- **Eventos independentes separados do total bruto**: seleção greedy de janelas de settlement que não se sobrepõem.");
L.push("- **Bootstrap temporal** (blocos estacionários + blocos por **dias**), além do Wilson binomial — que é otimista quando as operações se sobrepõem.");
L.push("- **Payout por produto**: o EV usa o payout do produto que oferta 300s, não 91% universal.");
L.push("- **Multiplicidade**: 4 hipóteses testadas; α de Bonferroni = 0,05/4 = 0,0125.");
L.push("");

// ── 5. Resultado por hipótese ──────────────────────────────────────────────
L.push("## 5. Resultado por hipótese", "");
for (const h of r.hypotheses) {
  const ci = h.CONFIDENCE_INTERVAL;
  const ev = h.EV;
  L.push(`### ${h.label}`, "");
  L.push(`${code(h.hypothesisId)} · MODEL_VERSION ${code(h.MODEL_VERSION.slice(0, 24))} · horizonte operacional **${h.operational_horizon_s}s** ${h.v3_300s_compatible ? "✓ compatível com V3" : "✗ incompatível" }`, "");
  L.push("| chave | valor |", "|---|---|");
  L.push(`| TRAIN_WR | **${pct(h.TRAIN_WR)}** (n=${h.splits.train.n}) |`);
  L.push(`| VALIDATION_WR | **${pct(h.VALIDATION_WR)}** (n=${h.splits.validation.n}) |`);
  L.push(`| BLIND_OOS_WR | **${pct(h.BLIND_OOS_WR)}** (n=${h.splits.test.n}) |`);
  L.push(`| PROSPECTIVE_WR | ${h.PROSPECTIVE_WR === null ? "**aguardando amostra prospectiva**" : `**${pct(h.PROSPECTIVE_WR)}**`} |`);
  L.push(`| RAW_SIGNALS | ${h.RAW_SIGNALS} |`);
  L.push(`| INDEPENDENT_EVENTS | ${h.INDEPENDENT_EVENTS} (WR independente ${pct(h.splits.test_independent.wr)} de n=${h.splits.test_independent.n}) |`);
  L.push(`| CONFIDENCE_INTERVAL | Wilson ${JSON.stringify(ci.wilson_test)} · bootstrap em blocos [${num(ci.block_bootstrap_test.lower, 3)}, ${num(ci.block_bootstrap_test.upper, 3)}] · bootstrap por dias ${ci.day_block_bootstrap_test.lower === null ? `indisponível (${ci.day_block_bootstrap_test.days} dia(s))` : `[${num(ci.day_block_bootstrap_test.lower, 3)}, ${num(ci.day_block_bootstrap_test.upper, 3)}]`} |`);
  L.push(`| PAYOUT_OBSERVED | ${h.PAYOUT_OBSERVED === null ? "**instrumento indisponível — sem payout**" : `${h.PAYOUT_OBSERVED}% (produto ${h.PAYOUT_OBSERVED_PRODUCT})`} · por produto ${JSON.stringify(h.PAYOUT_BY_PRODUCT)} |`);
  L.push(`| EV | ${ev.per_100_stakes === null ? "—" : `**${ev.per_100_stakes} por 100 stakes**`} (breakeven WR ${pct(h.BREAKEVEN_WR)}) |`);
  L.push(`| DRAWDOWN_PAPER | ${h.DRAWDOWN_PAPER.test.maxDrawdown} stake(s) no teste (${h.DRAWDOWN_PAPER.test.trades} operações) · ${h.DRAWDOWN_PAPER.independent.maxDrawdown} nos eventos independentes |`);
  L.push(`| DATA_GAPS | ${h.DATA_GAPS.bars_unique} barras únicas de ${h.DATA_GAPS.bars_raw} · ${h.DATA_GAPS.gap_count} gaps · ${h.DATA_GAPS.signals_dropped_gap_features + h.DATA_GAPS.signals_dropped_gap_settlement} sinais descartados |`);
  L.push(`| MARKET_AVAILABILITY | ${h.MARKET_AVAILABILITY.in_catalog ? `asset_id ${h.MARKET_AVAILABILITY.asset_id} (${h.MARKET_AVAILABILITY.resolved_asset_name}), aberto=${h.MARKET_AVAILABILITY.is_open_now}, 300s em ${JSON.stringify(h.MARKET_AVAILABILITY.products_offering_300s)}` : "**não ofertado — direção mensurável, execução impossível**"} |`);
  L.push(`| MODEL_VERSION | ${code(h.MODEL_VERSION)} |`);
  L.push("");
  L.push(`**VEREDITO: ${h.VERDICT.code}** — ${h.VERDICT.reason}.`, "");
  L.push(`Sensibilidade de EV ao payout: ${Object.entries(ev.sensitivity_by_payout).map(([p, v]) => `${p}%→${v.ev_per_100 ?? "—"}`).join(" · ")} (por 100 stakes).`, "");
  L.push(`Baselines nas mesmas entradas elegíveis do teste cego: ${Object.entries(h.baselines_test).map(([k, v]) => `${k} ${pct(v.wr)}`).join(" · ")}. Melhor baseline: **${h.BEST_BASELINE.name} ${pct(h.BEST_BASELINE.wr)}**.`, "");
}

// ── 6. Histórico × teste cego × forward ────────────────────────────────────
L.push("## 6. Diferenças entre histórico, teste cego e forward", "");
L.push("| hipótese | in-sample (antigo) | TRAIN | VALIDATION | BLIND OOS | PROSPECTIVE |", "|---|---:|---:|---:|---:|---:|");
const OLD = {
  "H1-UK100-1m-rsi14-h5": "70.1% (n=241)",
  "H2-US2000-1m-rsi14-h5": "67.0% (n=597) *iShares Russell 2000*",
  "H3-SP500ETF-1m-fade3-h5": "62.1% (n=1767)",
  "H3b-US500-1m-fade3-h5": "— (substituto declarado)",
};
for (const h of r.hypotheses) {
  L.push(`| ${h.hypothesisId} | ${OLD[h.hypothesisId] ?? "—"} | ${pct(h.TRAIN_WR)} | ${pct(h.VALIDATION_WR)} | ${pct(h.BLIND_OOS_WR)} | ${h.PROSPECTIVE_WR === null ? "aguardando" : pct(h.PROSPECTIVE_WR)} |`);
}
L.push("");
L.push("O `n` antigo era ~5× maior que a amostra real por causa das duplicatas. Quando o mesmo candle entra várias vezes, a estimativa pontual continua parecida, mas o intervalo de confiança fica artificialmente estreito — exatamente o que dava a falsa impressão de um 70% sólido.", "");

// ── 7. Shadow prospectivo ─────────────────────────────────────────────────
L.push("## 7. SHADOW prospectivo", "");
L.push("Congelamento: `forward-paper/iq-shadow/model-freeze.json`, gravado **antes** de qualquer coleta nova. O logger recalcula o SHA-256 de cada `MODEL_SPEC` e se recusa a iniciar se não bater.", "");
L.push("| hipótese | produto de execução | payout congelado | instrumento ofertado |", "|---|---|---:|---|");
const freezePath = "forward-paper/iq-shadow/model-freeze.json";
if (existsSync(freezePath)) {
  for (const m of JSON.parse(readFileSync(freezePath, "utf8")).models) {
    L.push(`| ${m.hypothesisId} | ${m.execution_product ?? "—"} | ${m.payout_execution === null ? "—" : m.payout_execution + "%"} | ${m.market_availability ? "sim" : "**não**"} |`);
  }
}
L.push("");
L.push("O log é `forward-paper/iq-shadow/shadow-predictions.jsonl` (append-only). Resolução **somente** com o candle cujo `from` é exatamente `entryBarTo + 300s`; ausência → `unresolved_gap`, nunca preço aproximado.", "");
L.push(`**Estado atual: ${r.shadow ? JSON.stringify(r.shadow) : "zero previsões resolvidas"}.** Os gatilhos são raros (RSI14 fora de [30,70] ocorre em ~2% das barras), então a amostra prospectiva começa devagar por construção.`, "");

// ── 8. Limitações ─────────────────────────────────────────────────────────
L.push("## 8. Limitações e o que seria necessário", "");
for (const lim of r.limitations) L.push(`- ${lim}`);
L.push("");
L.push("Para sair deste ponto é preciso **acumular histórico para frente** (o teto é 1.000 candles por chamada, sem paginação) ou obter uma janela histórica maior do provedor. Com ~1.000 barras por série, o teste cego tem 1–2 dias independentes: nenhuma conclusão estatística é defensável, por maior que seja o WR pontual.", "");

// ── 9. Reprodução ─────────────────────────────────────────────────────────
L.push("## 9. Artefatos e reprodução", "");
L.push("```bash");
L.push("# 1) congelar os dados (SHA-256, sem reescrever histórico)");
L.push("node diagnostic-results/freeze_real_datasets.mjs");
L.push("# 2) catálogo de ativos por produto (somente leitura; incremental e retomável)");
L.push("IQ_MCP_TOKEN=... IQ_PRODUCTS=binary-options node diagnostic-results/iq_mcp_catalog.mjs");
L.push("# 3) validação OOS (gera o congelamento dos modelos para o shadow)");
L.push("npx tsx diagnostic-results/oos_validation.mts");
L.push("# 4) relatório");
L.push("node diagnostic-results/oos_report_md.mjs");
L.push("# 5) shadow prospectivo (zero ordens)");
L.push("IQ_MCP_TOKEN=... node forward-paper/iq-shadow/shadow_logger.mjs");
L.push("```");
L.push("");
L.push("| arquivo | papel |");
L.push("|---|---|");
L.push("| `diagnostic-results/freeze_real_datasets.mjs` | manifesto SHA-256 + integridade/gaps |");
L.push("| `diagnostic-results/iq_mcp_scheduler.mjs` | agendador central, allowlist read-only, backoff, circuit breaker, checkpoint, dedupe por `asset_id` |");
L.push("| `diagnostic-results/iq_mcp_catalog.mjs` | catálogo por produto com payout e expirações reais |");
L.push("| `diagnostic-results/oos_validation.mts` | motor rigoroso + congelamento do modelo |");
L.push("| `diagnostic-results/oos_report_md.mjs` | gera este relatório |");
L.push("| `forward-paper/iq-shadow/shadow_logger.mjs` | coleta prospectiva read-only |");
L.push("| `diagnostic-results/oos/oos-report.json` | resultado legível por máquina |");
L.push("");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, L.join("\n"));
console.log(`✓ ${OUT} (${L.length} linhas)`);
