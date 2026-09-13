export type ManualPositionState = "NO_POSITION" | "POSSIBLE_POSITION" | "POSITION_CONFIRMED" | "WAITING_SETTLEMENT" | "SETTLED";
export type ManualDirection = "BUY" | "SELL" | "UNKNOWN";
export type ManualPosition = { state: ManualPositionState; direction: ManualDirection; confidence: number; detectedAt: number | null; evidence: string[]; linkedDecisionId: string | null; linkedLean: string | null };

export const emptyManualPosition = (): ManualPosition => ({ state: "NO_POSITION", direction: "UNKNOWN", confidence: 0, detectedAt: null, evidence: [], linkedDecisionId: null, linkedLean: null });

export function updateManualPosition(previous: ManualPosition, observation: Record<string, unknown> | null, now = Date.now(), linkedDecisionId: string | null = null, linkedLean: string | null = null): ManualPosition {
  const raw = observation?.manualPosition && typeof observation.manualPosition === "object" ? observation.manualPosition as Record<string, unknown> : null;
  if (!raw) return previous;
  const direction = raw.direction === "BUY" || raw.direction === "SELL" ? raw.direction : "UNKNOWN";
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  const requested = raw.state === "POSITION_CONFIRMED" || raw.state === "WAITING_SETTLEMENT" || raw.state === "SETTLED" ? raw.state : raw.state === "POSSIBLE_POSITION" ? "POSSIBLE_POSITION" : "NO_POSITION";
  if (requested === "NO_POSITION" && previous.state === "POSITION_CONFIRMED") return previous;
  return { state: requested, direction, confidence, detectedAt: requested === "NO_POSITION" ? null : previous.detectedAt || now, evidence, linkedDecisionId, linkedLean };
}
