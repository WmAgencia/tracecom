/** Precision is a permission, never a training target. Missing OOS evidence fails closed. */
export const PRODUCTION_SIGNAL_THRESHOLD = 0.70;
export const MIN_70_BUCKET_SAMPLE = 70;
export const MIN_70_BUCKET_EFFECTIVE_SAMPLE = 50;
export type ProductionCalibrationStatus = "INSUFFICIENT_SAMPLE" | "PROVISIONAL" | "CALIBRATED" | "ROBUST";
export interface ProductionSignalEvidence {
  readonly probabilityCalibrated: number | null;
  readonly calibrationStatus: ProductionCalibrationStatus;
  readonly bucketSampleSize: number;
  readonly bucketEffectiveSampleSize: number;
  readonly bucketObservedWinRate: number | null;
  readonly bucketLowerConfidenceBound: number | null;
  readonly netExpectedValue: number | null;
  readonly profitFactor: number | null;
  readonly maxDrawdown: number | null;
  readonly dataQuality: "high" | "medium" | "low" | "unknown";
  readonly stale: boolean;
  readonly riskApproved: boolean;
}
export interface ProductionSignalGateResult { readonly allowed: boolean; readonly threshold: typeof PRODUCTION_SIGNAL_THRESHOLD; readonly reasonCodes: readonly string[]; }
export function evaluateProductionSignalGate(evidence: ProductionSignalEvidence | null | undefined): ProductionSignalGateResult {
  if (!evidence) return { allowed: false, threshold: PRODUCTION_SIGNAL_THRESHOLD, reasonCodes: ["PRODUCTION_EVIDENCE_UNAVAILABLE"] };
  const reasons: string[] = []; const p = evidence.probabilityCalibrated;
  if (p === null || !Number.isFinite(p) || p < PRODUCTION_SIGNAL_THRESHOLD) reasons.push("CALIBRATED_PROBABILITY_BELOW_70");
  if (evidence.calibrationStatus !== "CALIBRATED" && evidence.calibrationStatus !== "ROBUST") reasons.push("CALIBRATION_STATUS_NOT_APPROVED");
  if (evidence.bucketSampleSize < MIN_70_BUCKET_SAMPLE) reasons.push("BUCKET_SAMPLE_INSUFFICIENT");
  if (evidence.bucketEffectiveSampleSize < MIN_70_BUCKET_EFFECTIVE_SAMPLE) reasons.push("BUCKET_EFFECTIVE_SAMPLE_INSUFFICIENT");
  if (evidence.bucketObservedWinRate === null || evidence.bucketObservedWinRate < PRODUCTION_SIGNAL_THRESHOLD) reasons.push("OOS_BUCKET_WIN_RATE_BELOW_70");
  if (evidence.bucketLowerConfidenceBound === null || evidence.bucketLowerConfidenceBound < PRODUCTION_SIGNAL_THRESHOLD) reasons.push("OOS_LOWER_CONFIDENCE_BOUND_BELOW_70");
  if (evidence.netExpectedValue === null || evidence.netExpectedValue <= 0) reasons.push("NET_EV_NOT_POSITIVE");
  if (evidence.profitFactor === null || evidence.profitFactor <= 1) reasons.push("PROFIT_FACTOR_NOT_POSITIVE");
  if (evidence.maxDrawdown === null || !Number.isFinite(evidence.maxDrawdown)) reasons.push("DRAWDOWN_UNAVAILABLE");
  if (evidence.dataQuality !== "high") reasons.push("DATA_QUALITY_NOT_HIGH");
  if (evidence.stale) reasons.push("STALE_DATA");
  if (!evidence.riskApproved) reasons.push("RISK_GATE_NOT_APPROVED");
  return { allowed: reasons.length === 0, threshold: PRODUCTION_SIGNAL_THRESHOLD, reasonCodes: reasons };
}
