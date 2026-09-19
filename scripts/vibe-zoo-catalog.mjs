/**
 * VIBE ZOO CATALOG — varre o clone auditado do Vibe-Trading e gera catalogo factual dos fatores.
 *
 * Uso: VIBE_ZOO_DIR=<path do clone> node scripts/vibe-zoo-catalog.mjs
 * Saida: docs/research/data/vibe-zoo-catalog.json
 *
 * Nao copia codigo: extrai apenas metadados (`__alpha_meta__`) dos arquivos reais e classifica
 * compatibilidade com o TraceCom (FX/OTC, sem volume verdadeiro/order book/fundamental).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const VIBE_ZOO_SOURCE = Object.freeze({
  repo: "HKUDS/Vibe-Trading",
  commit: "e5f719567a0a8c943c08276b0295b95c572891fb",
  describe: "v0.1.15-151-ge5f7195",
  license: "MIT",
  zooLicenseNotes: {
    alpha101: "formulas from Kakushadze (2015) arXiv:1601.00991 (mathematical artifacts)",
    gtja191: "formulas from GTJA 2014 report (mathematical artifacts)",
    qlib158: "adapted from microsoft/qlib pin d5379c520f66a39953bad76234a7019a72796fd0 (Apache-2.0)",
    academic: "academic papers (formulas)",
    fundamental: "fundamental data factors (not usable in TraceCom OTC)",
  },
});

const ZOOS = ["alpha101", "gtja191", "qlib158", "academic", "fundamental"];
const VOLUME_COLUMNS = new Set(["volume", "vwap", "amount"]);

function parseStringList(block, key) {
  const match = block.match(new RegExp(`['"]${key}['"]\\s*:\\s*\\[([^\\]]*)\\]`, "s"));
  if (!match) return [];
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((row) => row[1]);
}

function parseMeta(text) {
  const match = text.match(/__alpha_meta__\s*=\s*\{/);
  if (!match) return null;
  const start = text.indexOf("{", match.index);
  let depth = 0, end = -1;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") { depth -= 1; if (depth === 0) { end = index; break; } }
  }
  if (end < 0) return null;
  const block = text.slice(start, end + 1);
  const id = block.match(/['"]id['"]\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null;
  const nickname = block.match(/['"]nickname['"]\s*:\s*['"]([^'"]*)['"]/)?.[1] ?? null;
  const formula = block.match(/['"](?:formula_latex|formula)['"]\s*:\s*(['"])([\s\S]*?)\1\s*,/)?.[2] ?? null;
  const notes = block.match(/['"]notes['"]\s*:\s*(['"])([\s\S]*?)\1\s*,?/)?.[2] ?? null;
  return {
    id, nickname, formula_latex: formula, notes,
    theme: parseStringList(block, "theme"),
    columns_required: parseStringList(block, "columns_required"),
    extras_required: parseStringList(block, "extras_required"),
    universe: parseStringList(block, "universe"),
    frequency: parseStringList(block, "frequency"),
    requires_sector: /['"]requires_sector['"]\s*:\s*True/i.test(block),
    min_warmup_bars: Number(block.match(/['"]min_warmup_bars['"]\s*:\s*(\d+)/)?.[1] ?? NaN),
  };
}

function classify(meta, zoo) {
  const columns = Array.isArray(meta.columns_required) ? meta.columns_required : [];
  const extras = Array.isArray(meta.extras_required) ? meta.extras_required : [];
  const reasons = [];
  if (zoo === "fundamental" || extras.some((value) => String(value).startsWith("fund:")) || columns.some((value) => String(value).startsWith("fund:"))) reasons.push("REQUIRES_FUNDAMENTAL");
  if (columns.some((value) => VOLUME_COLUMNS.has(String(value).toLowerCase()))) reasons.push("REQUIRES_TRUE_VOLUME");
  if (meta.requires_sector === true) reasons.push("REQUIRES_SECTOR");
  const universes = Array.isArray(meta.universe) ? meta.universe : [];
  const fxLike = universes.length === 0 || universes.some((value) => String(value).includes("fx") || String(value).includes("forex"));
  const priceOnly = columns.length > 0 && columns.every((value) => ["open", "high", "low", "close"].includes(String(value).toLowerCase())) && extras.length === 0;
  const formula = String(meta.formula_latex ?? meta.formula ?? "");
  const crossSectionalPattern = /\b(rank|scale|indneutralize|sector|industry)\s*\(/i;
  const requiresCrossSectional = crossSectionalPattern.test(formula.replace(/ts_rank\s*\(/gi, "TSRANK(").replace(/decay_linear\s*\(/gi, "DECAY("));
  if (requiresCrossSectional) reasons.push("REQUIRES_CROSS_SECTIONAL_RANK");
  let compatibility = "CANDIDATE_TS_PORT";
  if (reasons.includes("REQUIRES_FUNDAMENTAL") || reasons.includes("REQUIRES_SECTOR")) compatibility = "UNAVAILABLE_FOR_OTC";
  else if (reasons.includes("REQUIRES_TRUE_VOLUME")) compatibility = "UNAVAILABLE_FOR_OTC";
  else if (requiresCrossSectional) compatibility = "TS_ADAPTATION_REQUIRED";
  else if (!priceOnly) compatibility = "REVIEW_NEEDED";
  else if (!fxLike) compatibility = "ASSET_CLASS_MISMATCH";
  return {
    compatibility,
    reasons,
    priceOnly,
    requiresCrossSectional,
    timeSeriesPortable: priceOnly && reasons.length === 0,
    columnsRequired: columns,
    extrasRequired: extras,
    universe: universes,
    theme: meta.theme ?? null,
    frequency: meta.frequency ?? null,
    minWarmupBars: Number.isFinite(Number(meta.min_warmup_bars)) ? Number(meta.min_warmup_bars) : null,
  };
}

export function catalogZoo(zooDir) {
  const rows = [];
  for (const zoo of ZOOS) {
    const dir = path.join(zooDir, zoo);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".py") && name !== "__init__.py")) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      const meta = parseMeta(text);
      if (!meta) continue;
      rows.push({
        factorId: `vibe:${meta.id ?? `${zoo}_${file.replace(/\.py$/, "")}`}`,
        zoo,
        file: `${zoo}/${file}`,
        nickname: meta.nickname ?? null,
        formula: meta.formula_latex ?? null,
        source: VIBE_ZOO_SOURCE.repo,
        sourceCommit: VIBE_ZOO_SOURCE.commit,
        license: zoo === "qlib158" ? "Apache-2.0 (upstream qlib pin; see NOTICE)" : "MIT / formulas (see LICENSE.md)",
        ...classify(meta, zoo),
      });
    }
  }
  const counts = {};
  for (const row of rows) counts[row.zoo] = (counts[row.zoo] ?? 0) + 1;
  const compatibility = {};
  for (const row of rows) compatibility[row.compatibility] = (compatibility[row.compatibility] ?? 0) + 1;
  return {
    schema: "vibe-zoo-catalog-v1",
    generatedAtUtc: new Date().toISOString(),
    source: VIBE_ZOO_SOURCE,
    counts, compatibility,
    portableCandidates: rows.filter((row) => row.timeSeriesPortable).map((row) => row.factorId),
    factors: rows,
  };
}

if (process.argv[1] && process.argv[1].endsWith("vibe-zoo-catalog.mjs")) {
  const zooDir = process.env.VIBE_ZOO_DIR;
  if (!zooDir || !fs.existsSync(zooDir)) {
    console.error("VIBE_ZOO_DIR ausente/invalido (aponte para agent/src/factors/zoo do clone auditado)");
    process.exit(1);
  }
  const catalog = catalogZoo(zooDir);
  const out = path.join(process.cwd(), "docs/research/data/vibe-zoo-catalog.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(catalog, null, 1)}\n`);
  console.log(`VIBE_ZOO_CATALOG_WRITTEN ${out}`);
  console.log(`counts=${JSON.stringify(catalog.counts)} compatibility=${JSON.stringify(catalog.compatibility)} portable=${catalog.portableCandidates.length}`);
}
