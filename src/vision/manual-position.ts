export type ManualPositionState = "NO_POSITION" | "POSSIBLE_POSITION" | "POSITION_CONFIRMED" | "WAITING_SETTLEMENT" | "SETTLED" | "POSITION_UNCERTAIN" | "POSITION_CLOSED";
export type ManualDirection = "BUY" | "SELL" | "UNKNOWN";
export type ManualPosition = { state: ManualPositionState; direction: ManualDirection; confidence: number; detectedAt: number | null; evidence: string[]; linkedDecisionId: string | null; linkedLean: string | null; hasOpenPosition: boolean };

export const emptyManualPosition = (): ManualPosition => ({ state: "NO_POSITION", direction: "UNKNOWN", confidence: 0, detectedAt: null, evidence: [], linkedDecisionId: null, linkedLean: null, hasOpenPosition: false });

/** Only IQ Option position-panel/card evidence may prove a human position.
 * Candle color, price direction, regime, momentum or Fast Path output are
 * NEVER accepted as position ground truth. */
export const POSITION_PANEL_EVIDENCE = /panel|posi|card|open|opera|expir|opç|opc|above|below|acima|abaixo|stake|invest/i;

export function panelEvidenceFor(evidence: readonly string[]): string[] { return evidence.filter((item) => POSITION_PANEL_EVIDENCE.test(item)); }

export function updateManualPosition(previous: ManualPosition, observation: Record<string, unknown> | null, now = Date.now(), linkedDecisionId: string | null = null, linkedLean: string | null = null): ManualPosition {
  const raw = observation?.manualPosition && typeof observation.manualPosition === "object" ? observation.manualPosition as Record<string, unknown> : null;
  if (!raw) return previous;
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  const panelEvidence = panelEvidenceFor(evidence);
  const hasOpenPosition = raw.hasOpenPosition === true || panelEvidence.length > 0;
  const requested = ["POSITION_CONFIRMED", "WAITING_SETTLEMENT", "SETTLED", "POSITION_UNCERTAIN", "POSITION_CLOSED"].includes(String(raw.state)) ? raw.state as ManualPositionState : raw.state === "POSSIBLE_POSITION" ? "POSSIBLE_POSITION" : "NO_POSITION";
  // Direction is trustworthy only when the panel/card itself proves it.
  const direction: ManualDirection = panelEvidence.length > 0 && (raw.direction === "BUY" || raw.direction === "SELL") ? raw.direction : "UNKNOWN";
  // Existing evidence of an open position cannot be erased by a single weak frame.
  if (requested === "NO_POSITION" && previous.hasOpenPosition && previous.state !== "POSITION_CLOSED") return previous;
  const state: ManualPositionState = requested === "POSITION_CONFIRMED" && !hasOpenPosition ? "POSSIBLE_POSITION" : requested;
  return { state, direction, confidence, detectedAt: state === "NO_POSITION" ? null : previous.detectedAt || now, evidence, linkedDecisionId, linkedLean, hasOpenPosition: hasOpenPosition || previous.hasOpenPosition };
}
