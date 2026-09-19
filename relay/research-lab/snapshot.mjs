/**
 * SNAPSHOT META — toda resposta/report do Research carrega asOf/windowStart/windowEnd/N/source/datasetVersion.
 *
 * Corrige a ambiguidade observacional da rodada anterior (numeros de instantes diferentes sem rotulo).
 */
export const SNAPSHOT_META_VERSION = "research-snapshot-meta-v1";

export function buildSnapshotMeta({
  asOf = null,
  windowStart = null,
  windowEnd = null,
  n = 0,
  source = "UNKNOWN",
  datasetVersion = null,
  datasetId = null,
  note = null,
  extra = null,
} = {}) {
  const start = finite(windowStart);
  const end = finite(windowEnd) ?? finite(asOf) ?? Date.now();
  const moment = finite(asOf) ?? end;
  return {
    metaVersion: SNAPSHOT_META_VERSION,
    asOf: moment,
    windowStart: start,
    windowEnd: end,
    windowMs: start !== null ? Math.max(0, end - start) : null,
    n: Number.isFinite(Number(n)) ? Number(n) : 0,
    source,
    datasetVersion: datasetVersion ?? null,
    datasetId: datasetId ?? null,
    note,
    extra: extra ?? null,
  };
}

/** Metadados a partir de uma lista de linhas temporais (usa campos comuns createdAt/at/asOf). */
export function snapshotFromRows(rows = [], { source = "UNKNOWN", datasetVersion = null, datasetId = null, note = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const times = list.map((row) => finite(row?.createdAt ?? row?.at ?? row?.asOf ?? row?.observedAt)).filter((value) => value !== null);
  times.sort((a, b) => a - b);
  return buildSnapshotMeta({
    asOf: times.length ? times[times.length - 1] : Date.now(),
    windowStart: times.length ? times[0] : null,
    windowEnd: times.length ? times[times.length - 1] : null,
    n: list.length, source, datasetVersion, datasetId, note,
  });
}

/** Duas janelas sao comparaveis apenas se explicitamente rotuladas como o mesmo dataset/instante. */
export function assertComparableSnapshots(left, right, { toleranceMs = 0 } = {}) {
  if (!left || !right) return { comparable: false, reason: "SNAPSHOT_MISSING" };
  if (left.datasetVersion && right.datasetVersion && left.datasetVersion !== right.datasetVersion) return { comparable: false, reason: "DATASET_VERSION_DIFFERS" };
  if (Math.abs(Number(left.asOf) - Number(right.asOf)) > toleranceMs) return { comparable: false, reason: "DIFFERENT_ASOF" };
  return { comparable: true, reason: "OK" };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
