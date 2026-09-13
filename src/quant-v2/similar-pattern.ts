import type { FeatureSnapshot, QuantTarget, SimilarNeighbor, SimilarPatternResult } from "./types";

export type HistoricalPattern = { groundTruthId: string; timestamp: number; features: Record<string, number | null>; direction: QuantTarget; resultAtT60: QuantTarget };
export type SimilarPatternConfig = { k?: number; method?: "euclidean" | "cosine"; maxDistance?: number };

function vector(current: Record<string, number | null>, row: Record<string, number | null>): [number[], number[]] { const a: number[] = [], b: number[] = []; for (const key of Object.keys(current)) { const x = current[key], y = row[key]; if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) { a.push(x); b.push(y); } } return [a, b]; }
function distance(a: number[], b: number[], method: "euclidean" | "cosine"): number { if (!a.length) return Infinity; if (method === "cosine") { let dot = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; } return aa && bb ? 1 - dot / Math.sqrt(aa * bb) : Infinity; } return Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0)); }

/** Historical candidates must be strictly earlier than the query timestamp. */
export function findSimilarPatterns(current: FeatureSnapshot, history: readonly HistoricalPattern[], config: SimilarPatternConfig = {}): SimilarPatternResult {
  const k = config.k ?? 30, method = config.method ?? "euclidean", maxDistance = config.maxDistance ?? Infinity;
  const candidates = history.filter(row => row.timestamp < current.timestamp).map(row => { const [a, b] = vector(current.features, row.features); return { row, d: distance(a, b, method) }; }).filter(x => x.d <= maxDistance).sort((a, b) => a.d - b.d).slice(0, k);
  const neighbors: SimilarNeighbor[] = candidates.map(({ row, d }) => ({ groundTruthId: row.groundTruthId, timestamp: row.timestamp, distance: d, direction: row.direction, resultAtT60: row.resultAtT60 })); const upCount = neighbors.filter(x => x.resultAtT60 === "UP").length, downCount = neighbors.filter(x => x.resultAtT60 === "DOWN").length, drawCount = neighbors.filter(x => x.resultAtT60 === "DRAW").length;
  const distances = neighbors.map(x => x.distance).sort((a, b) => a - b); return { neighborCount: neighbors.length, neighbors, upCount, downCount, drawCount, pUpNeighborhood: neighbors.length ? upCount / neighbors.length : null, pDownNeighborhood: neighbors.length ? downCount / neighbors.length : null, meanDistance: distances.length ? distances.reduce((s, x) => s + x, 0) / distances.length : null, medianDistance: distances.length ? distances[Math.floor(distances.length / 2)]! : null, confidenceFromNeighborhood: neighbors.length ? Math.abs(upCount - downCount) / neighbors.length : null };
}
