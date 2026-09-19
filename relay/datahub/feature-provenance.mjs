/**
 * FEATURE PROVENANCE — auditoria por feature (value/calculatedAt/availableAt/source/producer/formulaVersion).
 *
 * Nenhuma feature importante entra no T0 enriquecido sem entrada de proveniencia.
 * availableAt e o maior timestamp dos INSUMOS da feature (nunca o momento do calculo por atacado):
 * uma feature de candle so esta disponivel quando o candle que a sustenta fechou.
 */
export const FEATURE_PROVENANCE_VERSION = "feature-provenance-v1";

export const FEATURE_SOURCES = Object.freeze([
  "DETERMINISTIC_CALCULATION",
  "CANDLE_5S",
  "CANDLE_5S_DERIVED",
  "TICK_RING",
  "FEATURE_ENGINE",
  "PRICE_STRUCTURE",
  "INSUFFICIENT_DATA",
]);

export const FEATURE_STATUS = Object.freeze(["OK", "DEGRADED", "INSUFFICIENT_DATA", "STALE"]);

export function provenanceEntry({
  value = null,
  status = null,
  source = "DETERMINISTIC_CALCULATION",
  producer = "unknown",
  formulaVersion = null,
  calculatedAt = null,
  availableAt = null,
  note = null,
} = {}) {
  const resolvedStatus = status ?? (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value)) ? "INSUFFICIENT_DATA" : "OK");
  return {
    value: value === undefined ? null : value,
    status: resolvedStatus,
    source: resolvedStatus === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : source,
    producer,
    formulaVersion,
    calculatedAt,
    availableAt: availableAt ?? calculatedAt,
    note,
  };
}

export function buildProvenanceMap(entries = {}) {
  const map = {};
  for (const [path, entry] of Object.entries(entries)) map[path] = provenanceEntry(entry);
  return map;
}

/** Atualiza/insere entradas sem apagar as existentes (append-only). */
export function mergeProvenance(base = {}, extra = {}) {
  const merged = { ...base };
  for (const [path, entry] of Object.entries(extra)) merged[path] = provenanceEntry(entry);
  return merged;
}

export function provenanceOf(map = {}, path = "") {
  return map[path] ?? null;
}
