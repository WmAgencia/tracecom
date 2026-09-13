export type PriceObservation = { value: number; timestamp: number; confidence: number; source: string };
export type AcceptedObservation = { value: number; timestamp: number };
export type PriceValidationStatus = "ACCEPTED" | "OUTLIER" | "REGIME_CHANGE_ACCEPTED" | "UNAVAILABLE";

export type PriceValidation = {
  status: PriceValidationStatus;
  reason: string | null;
  rollingMedian: number | null;
  relativeDeviation: number | null;
  previousPrice: number | null;
  confirmations: number;
};

export function lockCausalPrice(observations: readonly PriceObservation[], targetTimestamp: number, toleranceMs = 3_000): PriceObservation | null {
  return observations.filter((item) => Number.isFinite(item.value) && item.timestamp <= targetTimestamp && targetTimestamp - item.timestamp <= toleranceMs && item.confidence >= .6).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

export function decimalPlaces(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Temporal price validation.
 *
 * A high provider confidence is never enough on its own: the reading must also
 * be coherent with the recent accepted cluster for the same session/asset.
 * A single absurd outlier is rejected; a genuinely different regime is only
 * accepted after multiple consecutive coherent readings far from the baseline.
 */
export function validatePriceObservation(input: {
  value: number; timestamp: number; confidence?: number | null;
  history: readonly AcceptedObservation[];
  outlierCandidates?: readonly AcceptedObservation[];
  maxRelativeDeviation?: number;
  minConfidence?: number;
  historyWindowMs?: number;
  candidateWindowMs?: number;
}): PriceValidation {
  const threshold = input.maxRelativeDeviation ?? .005;
  const minConfidence = input.minConfidence ?? .6;
  const empty: PriceValidation = { status: "UNAVAILABLE", reason: null, rollingMedian: null, relativeDeviation: null, previousPrice: null, confirmations: 0 };
  if (!Number.isFinite(input.value) || input.value <= 0) return { ...empty, status: "OUTLIER", reason: "INVALID_VALUE" };
  if (input.confidence !== null && input.confidence !== undefined && Number(input.confidence) < minConfidence) return { ...empty, status: "OUTLIER", reason: "LOW_CONFIDENCE" };
  const recent = input.history
    .filter((item) => Number.isFinite(item.value) && item.value > 0 && input.timestamp - item.timestamp <= (input.historyWindowMs ?? 60_000))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!recent.length) return { ...empty, status: "ACCEPTED" };
  const window = recent.slice(-8).map((item) => item.value).sort((a, b) => a - b);
  const rollingMedian = window[Math.floor((window.length - 1) / 2)]!;
  const previousPrice = recent[recent.length - 1]!.value;
  const relativeDeviation = Math.abs(input.value - rollingMedian) / rollingMedian;
  const base = { rollingMedian, relativeDeviation, previousPrice, confirmations: 0 };
  const historyDecimals = decimalPlaces(rollingMedian);
  // Só rejeita por formato quando a precisão observada é claramente menor
  // (ex.: "1.38" no lugar de "1.385285"), nunca por zeros à direita perdidos.
  if (historyDecimals >= 4 && decimalPlaces(input.value) <= 2 && decimalPlaces(input.value) <= historyDecimals - 3) return { ...base, status: "OUTLIER", reason: "DECIMAL_FORMAT_INCONSISTENT" };
  const confirmations = (input.outlierCandidates ?? [])
    .filter((item) => Number.isFinite(item.value) && item.value > 0
      && input.timestamp - item.timestamp <= (input.candidateWindowMs ?? 30_000)
      && Math.abs(item.value - input.value) / input.value <= threshold / 2)
    .length;
  if (confirmations >= 2) return { ...base, status: "REGIME_CHANGE_ACCEPTED", reason: "REGIME_CHANGE_CONFIRMED", confirmations: confirmations + 1 };
  // Robust dispersion gate: a large absolute jump in a few seconds is a spike
  // unless confirmed by a coherent cluster (handled above).
  const deviations = recent.slice(-8).map((item) => Math.abs(item.value - rollingMedian)).sort((a, b) => a - b);
  const mad = deviations[Math.floor((deviations.length - 1) / 2)] ?? 0;
  const stepRelative = previousPrice > 0 ? Math.abs(input.value - previousPrice) / previousPrice : relativeDeviation;
  const madRelative = rollingMedian > 0 ? mad / rollingMedian : 0;
  if (stepRelative > Math.max(.002, 6 * madRelative)) return { ...base, status: "OUTLIER", reason: "TEMPORAL_SPIKE" };
  if (relativeDeviation <= threshold) return { ...base, status: "ACCEPTED", reason: null };
  return { ...base, status: "OUTLIER", reason: "TEMPORAL_OUTLIER" };
}
