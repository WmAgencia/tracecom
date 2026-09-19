/**
 * FEATURE COVERAGE — disponibilidade/missing/stale por feature, separando NORMAL e OTC.
 *
 * Relatorio de pesquisa: nunca alimenta decisao, nunca altera features.
 */
import { STALE_FEATURE_MS } from "./t0-enriched.mjs";

export const FEATURE_COVERAGE_VERSION = "feature-coverage-v1";

const MARKET_TYPES = ["NORMAL", "OTC"];

function marketTypeOf(snapshot) {
  const explicit = snapshot?.market?.marketType ?? null;
  if (MARKET_TYPES.includes(explicit)) return explicit;
  const key = String(snapshot?.market?.marketKey ?? "");
  const suffix = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1).toUpperCase() : "";
  return MARKET_TYPES.includes(suffix) ? suffix : "UNKNOWN";
}

function emptyBucket() { return { total: 0, available: 0, missing: 0, stale: 0 }; }

function finalize(bucket) {
  const pct = (value) => (bucket.total > 0 ? Number(((value / bucket.total) * 100).toFixed(2)) : null);
  return {
    ...bucket,
    availablePct: pct(bucket.available),
    missingPct: pct(bucket.missing),
    stalePct: pct(bucket.stale),
  };
}

export function computeFeatureCoverage(snapshots = [], { staleMs = STALE_FEATURE_MS, now = null } = {}) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter(Boolean);
  const paths = new Set();
  for (const snapshot of list) for (const path of Object.keys(snapshot?.featureProvenance ?? {})) paths.add(path);
  const rows = [];
  for (const path of [...paths].sort()) {
    const overall = emptyBucket();
    const byType = { NORMAL: emptyBucket(), OTC: emptyBucket(), UNKNOWN: emptyBucket() };
    for (const snapshot of list) {
      const type = marketTypeOf(snapshot);
      const entry = snapshot?.featureProvenance?.[path] ?? null;
      const decisionAt = Number.isFinite(Number(snapshot?.times?.decisionAt)) ? Number(snapshot.times.decisionAt) : null;
      const referenceNow = Number.isFinite(Number(now)) ? Number(now) : decisionAt;
      const value = entry?.value;
      const present = entry !== null && value !== null && value !== undefined && entry?.status !== "INSUFFICIENT_DATA";
      const ageMs = present && referenceNow !== null && Number.isFinite(Number(entry?.availableAt)) ? Math.max(0, referenceNow - Number(entry.availableAt)) : null;
      const stale = present && ageMs !== null && ageMs > staleMs;
      const bucket = byType[type] ?? byType.UNKNOWN;
      overall.total += 1; bucket.total += 1;
      if (!present) { overall.missing += 1; bucket.missing += 1; }
      else if (stale) { overall.stale += 1; bucket.stale += 1; }
      else { overall.available += 1; bucket.available += 1; }
    }
    rows.push({
      feature: path,
      ...finalize(overall),
      byType: {
        NORMAL: finalize(byType.NORMAL),
        OTC: finalize(byType.OTC),
        UNKNOWN: finalize(byType.UNKNOWN),
      },
    });
  }
  const totals = list.reduce((acc, snapshot) => {
    const type = marketTypeOf(snapshot);
    acc.total += 1;
    if (acc[type] !== undefined) acc[type] += 1;
    return acc;
  }, { total: 0, NORMAL: 0, OTC: 0, UNKNOWN: 0 });
  return {
    version: FEATURE_COVERAGE_VERSION,
    generatedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
    snapshots: totals.total,
    byMarketType: totals,
    staleThresholdMs: staleMs,
    rows,
    note: "Relatorio observacional (SHADOW). Coverage ausente NAO e convertida em feature: apenas reportada.",
  };
}
