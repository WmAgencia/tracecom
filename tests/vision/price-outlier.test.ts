import { describe, expect, it } from "vitest";
import { validatePriceObservation, type AcceptedObservation } from "../../src/vision/price-lock";

/** Sequência real do log de produção: o provider devolveu 1.163930 com
 * confidence=0.97 no meio de leituras coerentes ~1.385x. */
const REAL_SEQUENCE = [1.386525, 1.386660, 1.385485, 1.385225, 1.163930, 1.385285, 1.385555];

describe("temporal price outlier validation", () => {
  it("rejects the real 1.163930 outlier and keeps the coherent readings", () => {
    const accepted: AcceptedObservation[] = [];
    const rejected: AcceptedObservation[] = [];
    const results = REAL_SEQUENCE.map((value, index) => {
      const timestamp = 1_000 + index * 2_000;
      const validation = validatePriceObservation({ value, timestamp, confidence: .97, history: accepted, outlierCandidates: rejected });
      if (validation.status === "ACCEPTED" || validation.status === "REGIME_CHANGE_ACCEPTED") accepted.push({ value, timestamp });
      else rejected.push({ value, timestamp });
      return { value, status: validation.status, reason: validation.reason };
    });
    const outlier = results[4]!;
    expect(outlier.value).toBe(1.163930);
    expect(outlier.status).toBe("OUTLIER");
    expect(outlier.reason).toBe("TEMPORAL_OUTLIER");
    expect(results.filter((item) => item.status === "ACCEPTED")).toHaveLength(6);
    expect(accepted.map((item) => item.value)).not.toContain(1.163930);
  });

  it("does not let a high confidence alone validate a value outside the cluster", () => {
    const history: AcceptedObservation[] = [{ value: 1.385285, timestamp: 1_000 }];
    const validation = validatePriceObservation({ value: 1.163930, timestamp: 2_000, confidence: .99, history });
    expect(validation).toMatchObject({ status: "OUTLIER", reason: "TEMPORAL_OUTLIER" });
    expect(validation.relativeDeviation).toBeGreaterThan(.1);
  });

  it("rejects low-confidence readings", () => {
    const validation = validatePriceObservation({ value: 1.387408, timestamp: 1_000, confidence: .4, history: [] });
    expect(validation).toMatchObject({ status: "OUTLIER", reason: "LOW_CONFIDENCE" });
  });

  it("accepts a confirmed regime change after consecutive coherent readings", () => {
    const history: AcceptedObservation[] = [{ value: 1.385285, timestamp: 1_000 }];
    const first = validatePriceObservation({ value: 1.395500, timestamp: 2_000, confidence: .97, history });
    expect(first.status).toBe("OUTLIER");
    const candidates: AcceptedObservation[] = [{ value: 1.395500, timestamp: 2_000 }];
    const second = validatePriceObservation({ value: 1.395700, timestamp: 4_000, confidence: .97, history, outlierCandidates: candidates });
    expect(second.status).toBe("OUTLIER");
    candidates.push({ value: 1.395700, timestamp: 4_000 });
    const third = validatePriceObservation({ value: 1.395600, timestamp: 6_000, confidence: .97, history, outlierCandidates: candidates });
    expect(third).toMatchObject({ status: "REGIME_CHANGE_ACCEPTED", reason: "REGIME_CHANGE_CONFIRMED", confirmations: 3 });
  });

  it("does not apply the outlier to entry or settlement locks", () => {
    const history: AcceptedObservation[] = [{ value: 1.385285, timestamp: 1_500 }];
    const validation = validatePriceObservation({ value: 1.163930, timestamp: 2_000, confidence: .97, history });
    const accepted = validation.status === "ACCEPTED" || validation.status === "REGIME_CHANGE_ACCEPTED";
    expect(accepted).toBe(false);
  });
});
