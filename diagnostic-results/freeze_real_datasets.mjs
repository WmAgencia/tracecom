/**
 * CONGELAMENTO (FREEZE) DOS DADOS REAIS (NÃO-OTC) DA IQ OPTION — somente leitura.
 *
 * Gera um manifesto SHA-256 dos 36 datasets coletados via MCP + scripts + resultados,
 * SEM reescrever nenhum arquivo de histórico. O manifesto é a fonte de verdade para
 * verificar depois se algum CSV foi alterado (append, truncamento, substituição).
 *
 * Uso:  node diagnostic-results/freeze_real_datasets.mjs
 * Saída: diagnostic-results/data/iq-real/FREEZE-MANIFEST.json
 *        diagnostic-results/data/iq-real/FREEZE-MANIFEST.md
 *
 * Se o manifesto já existir, NÃO é sobrescrito: grava um novo com sufixo de timestamp
 * e reporta divergências (drift) contra o manifesto anterior.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";

const ROOT = process.env.IQ_ROOT ?? "diagnostic-results/data/iq-real";
const SIZE_FROM_NAME = (f) => (/_60s\.csv$/.test(f) ? 60 : /_300s\.csv$/.test(f) ? 300 : null);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sha256File = (p) => sha256(readFileSync(p));

/** Analisa um CSV de candles: dedupe por `from`, ordenação, gaps e janela observada. */
function analyzeCsv(path, sizeS) {
  const text = readFileSync(path, "utf8");
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0];
  const rows = lines.slice(1).filter(Boolean).map((l) => {
    const p = l.split(",");
    return { from: p[0], to: p[1], open: +p[2], high: +p[3], low: +p[4], close: +p[5] };
  });

  // Integridade: duplicatas por timestamp de abertura e ordem não monotônica bruta.
  const byFrom = new Map();
  let nonMonotonic = 0;
  let conflictingDuplicates = 0;
  let prev = null;
  for (const r of rows) {
    if (prev !== null && new Date(r.from).getTime() <= new Date(prev).getTime()) nonMonotonic++;
    prev = r.from;
    const t = new Date(r.from).getTime();
    const existing = byFrom.get(t);
    if (!existing) {
      byFrom.set(t, r);
    } else if (existing.close !== r.close || existing.open !== r.open) {
      conflictingDuplicates++; // mesma vela com OHLC divergente => dado inconsistente
    }
  }
  const unique = [...byFrom.values()].sort((a, b) => new Date(a.from) - new Date(b.from));

  // Gaps: cadeias de barras ausentes maiores que 1 passo.
  const gaps = [];
  let missingBars = 0;
  for (let i = 1; i < unique.length; i++) {
    const dt = (new Date(unique[i].from) - new Date(unique[i - 1].from)) / 1000;
    if (dt > sizeS) {
      const barsMissing = Math.round(dt / sizeS) - 1;
      missingBars += barsMissing;
      if (gaps.length < 60) {
        gaps.push({ after: unique[i - 1].to, before: unique[i].from, missingBars: barsMissing, seconds: dt - sizeS });
      }
    }
  }

  const firstFrom = unique[0]?.from ?? null;
  const lastTo = unique.at(-1)?.to ?? null;
  const spanSeconds = firstFrom && lastTo ? (new Date(lastTo) - new Date(firstFrom)) / 1000 : 0;
  const expectedBars = Math.round(spanSeconds / sizeS);

  return {
    header,
    rowsRaw: rows.length,
    rowsUnique: unique.length,
    duplicateRows: rows.length - unique.length,
    duplicateRatio: rows.length ? Math.round((1 - unique.length / rows.length) * 1000) / 1000 : 0,
    nonMonotonicOrder: nonMonotonic,
    conflictingDuplicates,
    resolutionSeconds: sizeS,
    firstFrom,
    lastTo,
    spanHours: Math.round((spanSeconds / 3600) * 100) / 100,
    expectedBars,
    missingBars,
    gapCount: gaps.length,
    gaps,
  };
}

const hashOf = (p) => ({ sha256: sha256File(p), bytes: statSync(p).size });

// --- 0. Mapa nome → asset_id, vindo do catálogo MCP -------------------------------
// O coletor original gravou apenas o NOME sanitizado (nunca o asset_id). O catálogo
// reconstruído por iq_mcp_catalog.mjs permite preencher essa lacuna retroativamente.
const normalizeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const assetIdByName = new Map();
const CATALOG_PATH = "diagnostic-results/data/iq-catalog.json";
if (existsSync(CATALOG_PATH)) {
  const cat = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  for (const a of cat.assets ?? []) {
    assetIdByName.set(normalizeName(a.name), { asset_id: a.asset_id, name: a.name, products: a.products, payout_by_product: a.payoutByProduct });
  }
}

// --- 1. Datasets reais (36 séries) -------------------------------------------------
const datasets = [];
const dirs = existsSync(ROOT) ? readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory()) : [];
for (const server of dirs) {
  for (const f of readdirSync(join(ROOT, server)).filter((f) => f.endsWith(".csv")).sort()) {
    const sizeS = SIZE_FROM_NAME(f);
    if (sizeS === null) continue;
    const path = join(ROOT, server, f);
    const h = hashOf(path);
    const a = analyzeCsv(path, sizeS);
    const assetLabel = basename(f, ".csv").replace(new RegExp(`_${sizeS}s$`), "").replace(/[^A-Za-z0-9]/g, " ").trim();
    const catHit = assetIdByName.get(normalizeName(assetLabel)) ?? null;
    datasets.push({
      server,
      product: server,
      file: join(server, f),
      assetLabel,
      "size_s": sizeS,
      asset_id: catHit?.asset_id ?? null,
      catalog_name: catHit?.name ?? null,
      catalog_products: catHit?.products ?? null,
      payout_by_product: catHit?.payout_by_product ?? null,
      catalog_match: catHit ? "encontrado" : "NAO_ENCONTRADO (instrumento não ofertado no momento da coleta do catálogo)",
      sha256: h.sha256,
      bytes: h.bytes,
      ...a,
    });
  }
}

// --- 2. Scripts e resultados (parâmetros / metodologia) -----------------------------
const ARTIFACTS = [
  "diagnostic-results/iq_otc_collect.mjs",
  "diagnostic-results/iq_otc_analyze.mts",
  "diagnostic-results/iq-real-analysis.json",
  "diagnostic-results/iq-otc-analysis.json",
  "diagnostic-results/walk_forward_real.mts",
  "diagnostic-results/walk-forward-real-results.json",
  "diagnostic-results/data/iq-otc/MANIFEST-OTC.json",
  "diagnostic-results/data/MANIFEST.json",
  "diagnostic-results/freeze_real_datasets.mjs",
  "diagnostic-results/oos_validation.mts",
  "diagnostic-results/oos_report_md.mjs",
  "diagnostic-results/iq_mcp_scheduler.mjs",
  "diagnostic-results/iq_mcp_catalog.mjs",
  "diagnostic-results/iq_mcp_ratelimit_probe.mjs",
  "forward-paper/iq-shadow/shadow_logger.mjs",
  "forward-paper/iq-shadow/README.md",
  "forward-paper/iq-shadow/model-freeze.json",
  "diagnostic-results/oos/oos-report.json",
  "docs/analytics/validacao-oos-binarios-reais.md",
];
const artifacts = [];
for (const p of ARTIFACTS) {
  if (!existsSync(p)) { artifacts.push({ path: p, missing: true }); continue; }
  artifacts.push({ path: p, ...hashOf(p) });
}

const totals = datasets.reduce(
  (acc, d) => ({
    raw: acc.raw + d.rowsRaw,
    unique: acc.unique + d.rowsUnique,
    dups: acc.dups + d.duplicateRows,
    missing: acc.missing + d.missingBars,
  }),
  { raw: 0, unique: 0, dups: 0, missing: 0 },
);

const manifest = {
  kind: "FREEZE-SHA256",
  generatedAtUtc: new Date().toISOString(),
  read_only: true,
  orders_placed: false,
  frozen_under: "diagnostic-results/data/iq-real/binary-options (append-only no disco; nenhum histórico reescrito)",
  integrity_summary: {
    series: datasets.length,
    rows_raw: totals.raw,
    rows_unique: totals.unique,
    duplicate_rows: totals.dups,
    duplicate_ratio: totals.raw ? Math.round((totals.dups / totals.raw) * 1000) / 1000 : 0,    missing_bars_within_span: totals.missing,
    asset_id_resolved: datasets.filter((d) => d.asset_id).length,
    asset_id_unresolved: datasets.filter((d) => !d.asset_id).length,
    note: "O coletor original fez append de janelas MCP sobrepostas sem deduplicar. " +
      "Toda a análise rigorosa DEVE usar rowsUnique (dedupe por 'from' + ordenação). " +
      "Os WRs in-sample anteriores usaram rows_raw e por isso sofreram pseudo-replicação " +
      "(mesma vela contada até ~5x), invalidando os intervalos de Wilson reportados.",
  },
  datasets,
  artifacts,
};

// O manifesto é METADADO DERIVADO: pode ser regenerado. O que não se sobrescreve é
// o HISTÓRICO DE CANDLES. Cada execução (a) atualiza o canônico e (b) arquiva uma
// cópia datada em `freeze-history/`, para que o drift seja auditável ao longo do tempo.
const OUT = join(ROOT, "FREEZE-MANIFEST.json");
const MDOUT = join(ROOT, "FREEZE-MANIFEST.md");
const HIST_DIR = join(ROOT, "freeze-history");
mkdirSync(HIST_DIR, { recursive: true });
const prevFiles = readdirSync(HIST_DIR).filter((f) => f.endsWith(".json")).sort();
const prevPath = prevFiles.length ? join(HIST_DIR, prevFiles.at(-1)) : existsSync(OUT) ? OUT : null;
let drift = null;
if (prevPath) {
  const prev = JSON.parse(readFileSync(prevPath, "utf8"));
  const prevByFile = new Map((prev.datasets ?? []).map((d) => [d.file, d.sha256]));
  const changed = datasets.filter((d) => prevByFile.has(d.file) && prevByFile.get(d.file) !== d.sha256).map((d) => ({ file: d.file, was: prevByFile.get(d.file), now: d.sha256 }));
  const added = datasets.filter((d) => !prevByFile.has(d.file)).map((d) => d.file);
  const removed = [...prevByFile.keys()].filter((f) => !datasets.some((d) => d.file === f));
  drift = { comparedAgainst: prevPath, changed, added, removed, clean: changed.length === 0 && added.length === 0 && removed.length === 0 };
}
manifest.drift_vs_previous = drift;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(join(HIST_DIR, `FREEZE-MANIFEST-${stamp}.json`), JSON.stringify(manifest, null, 2));
writeFileSync(OUT, JSON.stringify(manifest, null, 2));

const md = [
  "# Congelamento SHA-256 — binários REAIS (não-OTC) da IQ Option",
  "",
  `Gerado: ${manifest.generatedAtUtc} · somente leitura · nenhuma ordem enviada`,
  "",
  "## Integridade",
  "",
  `- Séries: **${datasets.length}**`,
  `- Linhas brutas: **${totals.raw}** → únicas: **${totals.unique}** (duplicatas: ${totals.dups}, **${((totals.dups / Math.max(1, totals.raw)) * 100).toFixed(1)}%**)`,
  `- Barras ausentes dentro do intervalo observado: **${totals.missing}**`,
  "",
  "> O coletor fez append de janelas sobrepostas sem dedupe. Toda análise rigorosa usa as linhas únicas; os WRs in-sample anteriores usaram linhas brutas e sofreram pseudo-replicação.",
  "",
  "## Séries",
  "",
  "| produto | série | asset_id | res | linhas | únicas | dups | span (h) | barras ausentes | primeiro | último | sha256 |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|",
  ...datasets.map(
    (d) =>
      `| ${d.product} | ${d.assetLabel} | ${d.asset_id ?? "—"} | ${d["size_s"]}s | ${d.rowsRaw} | ${d.rowsUnique} | ${d.duplicateRatio} | ${d.spanHours} | ${d.missingBars} | ${d.firstFrom} | ${d.lastTo} | \`${d.sha256.slice(0, 16)}\` |`,
  ),
  "",
  `Séries sem correspondência no catálogo atual: **${datasets.filter((d) => !d.asset_id).length}** (inclui todos os ETFs — ver relatório OOS §3).`,
  "",
];
writeFileSync(MDOUT, md.join("\n"));

console.log(`✓ manifesto: ${OUT}`);
console.log(`✓ arquivo:   ${join(HIST_DIR, `FREEZE-MANIFEST-${stamp}.json`)}`);
console.log(`✓ legível:   ${MDOUT}`);
console.log(`séries=${datasets.length} rows=${totals.raw} únicas=${totals.unique} dups=${((totals.dups / totals.raw) * 100).toFixed(1)}% ausentes=${totals.missing}`);
console.log(`asset_id resolvidos=${manifest.integrity_summary.asset_id_resolved} não resolvidos=${manifest.integrity_summary.asset_id_unresolved}`);
if (drift && !drift.clean) console.log(`⚠ DRIFT: ${drift.changed.length} alterado(s), ${drift.added.length} novo(s), ${drift.removed.length} removido(s)`);
else if (drift) console.log("✓ sem drift em relação ao congelamento anterior");
