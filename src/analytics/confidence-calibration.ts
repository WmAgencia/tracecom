/** Confidence calibration from real causal settlements.
 *
 * Only operational directional predictions with a settled WIN/LOSS count.
 * Excluded: UNKNOWN, DRAW-only evidence, synthetic smoke trades, temporally
 * approximate/invalid datasets (callers must not feed them in) and trades
 * without a raw confidence.
 */
export type CalibrationSample = {
  direction: "BUY" | "SELL";
  confidence: number | null;
  result: "WIN" | "LOSS" | "DRAW" | "UNKNOWN" | null;
  synthetic?: boolean;
  regime?: string | null;
  profile?: string | null;
};

export type CalibrationBucket = { bucket: string; lower: number; upper: number; predictions: number; evaluated: number; wins: number; losses: number; draws: number; empiricalWinRate: number | null };

export type CalibrationReport = {
  status: "INSUFFICIENT_SAMPLE" | "AVAILABLE";
  total: number;
  evaluated: number;
  excludedSynthetic: number;
  excludedUnknown: number;
  minBucketSample: number;
  buckets: CalibrationBucket[];
  mapping: Array<{ lower: number; upper: number; empiricalWinRate: number }>;
};

export const CALIBRATION_BUCKETS = [[.50, .55], [.55, .60], [.60, .65], [.65, .70], [.70, .75], [.75, .80], [.80, .85], [.85, .90], [.90, .95], [.95, 1.0]] as const;

function bucketLabel(lower: number, upper: number): string { return `${Math.round(lower * 100)}-${Math.round(upper * 100)}`; }

export function bucketForConfidence(confidence: number): string {
  for (const [lower, upper] of CALIBRATION_BUCKETS) if (confidence >= lower && confidence < upper) return bucketLabel(lower, upper);
  return "95-100";
}

export function buildCalibration(samples: readonly CalibrationSample[], options: { minBucketSample?: number; minTotal?: number } = {}): CalibrationReport {
  const minBucketSample = options.minBucketSample ?? 30;
  const minTotal = options.minTotal ?? 200;
  let excludedSynthetic = 0, excludedUnknown = 0;
  const buckets: CalibrationBucket[] = CALIBRATION_BUCKETS.map(([lower, upper]) => ({ bucket: bucketLabel(lower, upper), lower, upper, predictions: 0, evaluated: 0, wins: 0, losses: 0, draws: 0, empiricalWinRate: null }));
  for (const sample of samples) {
    if (sample.synthetic === true) { excludedSynthetic += 1; continue; }
    if (sample.result === null || sample.result === undefined || sample.result === "UNKNOWN") { excludedUnknown += 1; continue; }
    const confidence = Number(sample.confidence);
    if (!Number.isFinite(confidence) || confidence < .5 || confidence > 1) continue;
    const bucket = buckets.find((item) => confidence >= item.lower && confidence < item.upper) ?? buckets[buckets.length - 1]!;
    bucket.predictions += 1;
    if (sample.result === "DRAW") { bucket.draws += 1; continue; }
    bucket.evaluated += 1;
    if (sample.result === "WIN") bucket.wins += 1; else bucket.losses += 1;
  }
  for (const bucket of buckets) bucket.empiricalWinRate = bucket.evaluated ? bucket.wins / bucket.evaluated : null;
  const evaluated = buckets.reduce((sum, bucket) => sum + bucket.evaluated, 0);
  const populated = buckets.filter((bucket) => bucket.evaluated >= minBucketSample && bucket.empiricalWinRate !== null);
  const sufficient = evaluated >= minTotal && populated.length >= 3;
  const mapping = sufficient ? monotonicMapping(populated.map((bucket) => ({ lower: bucket.lower, upper: bucket.upper, empiricalWinRate: bucket.empiricalWinRate! }))) : [];
  return { status: sufficient ? "AVAILABLE" : "INSUFFICIENT_SAMPLE", total: samples.length, evaluated, excludedSynthetic, excludedUnknown, minBucketSample, buckets, mapping };
}

/** Enforces a non-decreasing empirical curve (pool adjacent violators). */
function monotonicMapping(points: Array<{ lower: number; upper: number; empiricalWinRate: number }>): Array<{ lower: number; upper: number; empiricalWinRate: number }> {
  const sorted = [...points].sort((a, b) => a.lower - b.lower);
  const pooled: Array<{ lower: number; upper: number; empiricalWinRate: number; weight: number }> = [];
  for (const point of sorted) {
    let current = { ...point, weight: 1 };
    while (pooled.length && pooled[pooled.length - 1]!.empiricalWinRate > current.empiricalWinRate) {
      const previous = pooled.pop()!;
      const weight = previous.weight + current.weight;
      current = { lower: previous.lower, upper: current.upper, empiricalWinRate: (previous.empiricalWinRate * previous.weight + current.empiricalWinRate * current.weight) / weight, weight };
    }
    pooled.push(current);
  }
  return pooled.map(({ lower, upper, empiricalWinRate }) => ({ lower, upper, empiricalWinRate }));
}

export function calibrateConfidence(confidence: number, report: CalibrationReport): number | null {
  if (report.status !== "AVAILABLE") return null;
  const value = Number(confidence);
  if (!Number.isFinite(value)) return null;
  const point = report.mapping.find((item) => value >= item.lower && value < item.upper) ?? report.mapping[report.mapping.length - 1] ?? null;
  return point ? point.empiricalWinRate : null;
}

export function breakEvenWinRate(payoutRatio: number | null | undefined): number | null {
  const ratio = Number(payoutRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return 1 / (1 + ratio);
}

export function edgeVsBreakEven(winRate: number | null | undefined, payoutRatio: number | null | undefined): number | null {
  const breakEven = breakEvenWinRate(payoutRatio);
  const wr = Number(winRate);
  if (breakEven === null || !Number.isFinite(wr)) return null;
  return wr - breakEven;
}
