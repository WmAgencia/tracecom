/**
 * FEATURE COVERAGE AUDIT — classifica VALID/DERIVED_VALID/STALE/MISSING/UNAVAILABLE/DEFAULTED/INVALID
 * e separa NATIVE de DERIVED. "available" nunca conta dado defaulted/invalido.
 */
import { buildSnapshotMeta } from "./snapshot.mjs";
import { STALE_FEATURE_MS } from "../datahub/t0-enriched.mjs";

export const COVERAGE_AUDIT_VERSION = "feature-coverage-audit-v1";

const DERIVED_SOURCES = new Set(["CANDLE_5S_DERIVED", "DETERMINISTIC_CALCULATION", "DERIVED", "T0_ENRICHED_MULTITF"]);

function classifyEntry(entry, { referenceAt, staleMs }) {
  if (!entry) return { state: "MISSING", origin: null };
  const status = String(entry.status ?? "OK").toUpperCase();
  const value = entry.value;
  if (status === "INVALID") return { state: "INVALID", origin: null };
  if (entry.invalid === true) return { state: "INVALID", origin: null };
  if (status === "INSUFFICIENT_DATA" || value === null || value === undefined) return { state: "UNAVAILABLE", origin: null };
  if (typeof value === "number" && !Number.isFinite(value)) return { state: "INVALID", origin: null };
  if (entry.defaulted === true) return { state: "DEFAULTED", origin: null };
  const origin = DERIVED_SOURCES.has(String(entry.source)) ? "DERIVED" : "NATIVE";
  const availableAt = Number(entry.availableAt);
  if (Number.isFinite(availableAt) && Number.isFinite(Number(referenceAt)) && Number(referenceAt) - availableAt > staleMs) return { state: "STALE", origin };
  return { state: origin === "DERIVED" ? "DERIVED_VALID" : "VALID", origin };
}

export function auditFeatureCoverage(snapshots = [], {
  source = "UNKNOWN", staleMs = STALE_FEATURE_MS, datasetVersion = null, datasetId = null, now = null,
} = {}) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter(Boolean);
  const paths = new Set();
  for (const snapshot of list) for (const path of Object.keys(snapshot?.featureProvenance ?? {})) paths.add(path);
  const rows = [];
  for (const path of [...paths].sort()) {
    const counts = { total: 0, VALID: 0, DERIVED_VALID: 0, STALE: 0, MISSING: 0, UNAVAILABLE: 0, DEFAULTED: 0, INVALID: 0, NATIVE: 0, DERIVED: 0 };
    for (const snapshot of list) {
      counts.total += 1;
      const referenceAt = Number.isFinite(Number(snapshot?.times?.decisionAt)) ? Number(snapshot.times.decisionAt) : Number(now);
      const { state, origin } = classifyEntry(snapshot?.featureProvenance?.[path], { referenceAt, staleMs });
      counts[state] += 1;
      if (origin === "DERIVED") counts.DERIVED += 1; else if (origin === "NATIVE") counts.NATIVE += 1;
    }
    const real = counts.VALID + counts.DERIVED_VALID;
    rows.push({
      feature: path,
      ...counts,
      availableRealPct: counts.total ? Number(((real / counts.total) * 100).toFixed(2)) : null,
      missingPct: counts.total ? Number(((counts.MISSING / counts.total) * 100).toFixed(2)) : null,
      stalePct: counts.total ? Number(((counts.STALE / counts.total) * 100).toFixed(2)) : null,
      defaultedPct: counts.total ? Number(((counts.DEFAULTED / counts.total) * 100).toFixed(2)) : null,
      invalidPct: counts.total ? Number(((counts.INVALID / counts.total) * 100).toFixed(2)) : null,
      origin: counts.DERIVED > counts.NATIVE ? "DERIVED" : counts.NATIVE > 0 ? "NATIVE" : "UNKNOWN",
    });
  }
  const times = list.map((snapshot) => Number(snapshot?.times?.decisionAt)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    version: COVERAGE_AUDIT_VERSION,
    snapshot: buildSnapshotMeta({
      asOf: now ?? (times.length ? times[times.length - 1] : Date.now()),
      windowStart: times[0] ?? null, windowEnd: times[times.length - 1] ?? null,
      n: list.length, source, datasetVersion, datasetId,
      note: "DEFAULTED/INVALID/STALE/UNAVAILABLE nao contam como disponibilidade real.",
    }),
    rows,
    totals: rows.reduce((acc, row) => {
      for (const key of ["total", "VALID", "DERIVED_VALID", "STALE", "MISSING", "UNAVAILABLE", "DEFAULTED", "INVALID", "NATIVE", "DERIVED"]) acc[key] += row[key] ?? 0;
      return acc;
    }, { total: 0, VALID: 0, DERIVED_VALID: 0, STALE: 0, MISSING: 0, UNAVAILABLE: 0, DEFAULTED: 0, INVALID: 0, NATIVE: 0, DERIVED: 0 }),
  };
}
