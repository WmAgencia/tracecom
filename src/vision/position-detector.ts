/**
 * Local-only visual position detector.
 *
 * The caller may run OCR/template matching on a sanitized crop, but this
 * module deliberately accepts only those local candidate results.  It never
 * looks at price action, an analysis decision, or broker controls, and it
 * cannot execute an order.
 */
export type PositionDirection = "BUY" | "SELL" | "UNKNOWN";
export type PositionDetectionState = "NO_POSITION" | "POSSIBLE_POSITION" | "POSITION_CONFIRMED" | "POSITION_UNCERTAIN";

export type NormalizedRect = { x: number; y: number; width: number; height: number };
export type LocalPositionCandidate = {
  /** Semantic label emitted by local OCR/template matching, never market data. */
  readonly kind: "POSITION_PANEL" | "OPEN_POSITION_CARD" | "EXPIRY" | "STAKE" | "DIRECTION_LABEL" | "OTHER";
  readonly text?: string;
  readonly direction?: PositionDirection;
  readonly confidence: number;
  /** Pixel coordinates relative to this crop. */
  readonly rect: { x: number; y: number; width: number; height: number };
};
export type LocalCropPositionInput = {
  readonly frameId: string;
  readonly capturedAt: number;
  readonly width: number;
  readonly height: number;
  readonly candidates: readonly LocalPositionCandidate[];
};
export type PositionDetectorMemory = {
  readonly candidateFrames: number;
  readonly confirmedDirection: PositionDirection;
  readonly lastFrameId: string | null;
};
export type PositionDetection = {
  readonly state: PositionDetectionState;
  readonly direction: PositionDirection;
  readonly confidence: number;
  readonly roi: NormalizedRect | null;
  readonly evidence: readonly string[];
  readonly mismatch: boolean;
  readonly candidateFrames: number;
  readonly memory: PositionDetectorMemory;
};

const panelKinds = new Set<LocalPositionCandidate["kind"]>(["POSITION_PANEL", "OPEN_POSITION_CARD"]);
const corroboratingKinds = new Set<LocalPositionCandidate["kind"]>(["POSITION_PANEL", "OPEN_POSITION_CARD", "EXPIRY", "STAKE", "DIRECTION_LABEL"]);

export const emptyPositionDetectorMemory = (): PositionDetectorMemory => ({ candidateFrames: 0, confirmedDirection: "UNKNOWN", lastFrameId: null });

export function normalizePositionRect(rect: LocalPositionCandidate["rect"], width: number, height: number): NormalizedRect | null {
  if (![rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.max(0, Math.min(1, rect.x / width));
  const y = Math.max(0, Math.min(1, rect.y / height));
  const right = Math.max(x, Math.min(1, (rect.x + rect.width) / width));
  const bottom = Math.max(y, Math.min(1, (rect.y + rect.height) / height));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function mergeRoi(rects: readonly NormalizedRect[]): NormalizedRect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Requires a panel/card cue plus a second corroborating cue. This rejects
 * chart labels and isolated directional words that frequently occur outside
 * an open-position card. Confirmation requires two distinct crop frames.
 */
export function detectLocalPosition(input: LocalCropPositionInput, previous = emptyPositionDetectorMemory()): PositionDetection {
  const validFrame = input.frameId.length > 0 && Number.isFinite(input.capturedAt) && input.width > 0 && input.height > 0;
  if (!validFrame || input.frameId === previous.lastFrameId) {
    return { state: "NO_POSITION", direction: "UNKNOWN", confidence: 0, roi: null, evidence: ["LOCAL_FRAME_INVALID_OR_DUPLICATE"], mismatch: false, candidateFrames: previous.candidateFrames, memory: previous };
  }
  const eligible = input.candidates.filter((candidate) => candidate.confidence >= .65 && corroboratingKinds.has(candidate.kind));
  const panel = eligible.filter((candidate) => panelKinds.has(candidate.kind));
  const directionCues = eligible.filter((candidate) => candidate.kind === "DIRECTION_LABEL" && (candidate.direction === "BUY" || candidate.direction === "SELL"));
  const directions = new Set(directionCues.map((candidate) => candidate.direction));
  const conflictingFrameDirections = directions.has("BUY") && directions.has("SELL");
  const direction = conflictingFrameDirections || directions.size !== 1 ? "UNKNOWN" : [...directions][0] ?? "UNKNOWN";
  const hasPositionEvidence = panel.length > 0 && eligible.length >= 2;
  const mismatch = hasPositionEvidence && (conflictingFrameDirections || (previous.confirmedDirection !== "UNKNOWN" && direction !== "UNKNOWN" && previous.confirmedDirection !== direction));
  const nextCandidateFrames = hasPositionEvidence && !mismatch ? previous.candidateFrames + 1 : 0;
  const nextDirection = mismatch || !hasPositionEvidence ? "UNKNOWN" : direction === "UNKNOWN" ? previous.confirmedDirection : direction;
  const state: PositionDetectionState = mismatch ? "POSITION_UNCERTAIN" : !hasPositionEvidence ? "NO_POSITION" : nextCandidateFrames >= 2 ? "POSITION_CONFIRMED" : "POSSIBLE_POSITION";
  const accepted = state !== "NO_POSITION";
  const confidence = accepted ? Math.min(1, eligible.reduce((sum, candidate) => sum + candidate.confidence, 0) / eligible.length * (state === "POSITION_CONFIRMED" ? 1 : .72)) : 0;
  const roi = mergeRoi(eligible.map((candidate) => normalizePositionRect(candidate.rect, input.width, input.height)).filter((rect): rect is NormalizedRect => rect !== null));
  const evidence = eligible.map((candidate) => `${candidate.kind}:${candidate.direction ?? "UNKNOWN"}`).slice(0, 6);
  if (mismatch) evidence.push("DIRECTION_MISMATCH");
  const memory: PositionDetectorMemory = { candidateFrames: nextCandidateFrames, confirmedDirection: state === "POSITION_CONFIRMED" ? nextDirection : previous.confirmedDirection, lastFrameId: input.frameId };
  return { state, direction: mismatch ? "UNKNOWN" : nextDirection, confidence, roi, evidence, mismatch, candidateFrames: nextCandidateFrames, memory };
}
