/** Decision identity conventions (new ids) + historical compatibility.
 * Historical ids (local-…, decision_candle_…, op_…) stay readable forever. */
export const KNOWN_DECISION_PREFIXES = ["decision_", "op_", "local-", "decision_candle_"] as const;

export function isKnownDecisionId(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && KNOWN_DECISION_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function normalizeDecisionId(value: unknown, now: number, random: string): string {
  if (isKnownDecisionId(value)) return String(value);
  return `decision_${now}_${random.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "000000"}`;
}

export function traceIdFor(type: string, candleId: string | null | undefined, now: number, random: string): string {
  if (candleId && String(candleId).length) return `trace_${String(candleId)}`;
  return `trace_${type}_${now}_${random.replace(/[^a-z0-9]/gi, "").slice(0, 4) || "0000"}`;
}
