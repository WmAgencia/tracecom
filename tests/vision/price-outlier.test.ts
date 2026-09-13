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
    expect(["TEMPORAL_OUTLIER", "TEMPORAL_SPIKE"]).toContain(outlier.reason);
    expect(results.filter((item) => item.status === "ACCEPTED")).toHaveLength(6);
    expect(accepted.map((item) => item.value)).not.toContain(1.163930);
  });

  it("does not let a high confidence alone validate a value outside the cluster", () => {
    const history: AcceptedObservation[] = [{ value: 1.385285, timestamp: 1_000 }];
    const validation = validatePriceObservation({ value: 1.163930, timestamp: 2_000, confidence: .99, history });
    expect(validation.status).toBe("OUTLIER");
    expect(["TEMPORAL_OUTLIER", "TEMPORAL_SPIKE"]).toContain(validation.reason);
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

  it("rejects a sudden spike even inside the percentage threshold (1.3885 vs ~1.3840)", () => {
    const accepted: AcceptedObservation[] = [];
    const rejected: AcceptedObservation[] = [];
    const sequence = [1.382965, 1.383075, 1.383215, 1.384025, 1.384125, 1.3885];
    const results = sequence.map((value, index) => {
      const timestamp = 1_000 + index * 2_000;
      const validation = validatePriceObservation({ value, timestamp, confidence: .97, history: accepted, outlierCandidates: rejected });
      if (validation.status === "ACCEPTED" || validation.status === "REGIME_CHANGE_ACCEPTED") accepted.push({ value, timestamp });
      else rejected.push({ value, timestamp });
      return { value, status: validation.status, reason: validation.reason };
    });
    const spike = results[results.length - 1]!;
    expect(spike.value).toBe(1.3885);
    expect(spike.status).toBe("OUTLIER");
    expect(accepted.map((item) => item.value)).not.toContain(1.3885);
  });

  it("keeps smooth short-term drift accepted", () => {
    const accepted: AcceptedObservation[] = [];
    const sequence = [1.382965, 1.383075, 1.383125, 1.383215, 1.383275, 1.383325];
    for (let index = 0; index < sequence.length; index++) {
      const validation = validatePriceObservation({ value: sequence[index]!, timestamp: 1_000 + index * 2_000, confidence: .97, history: accepted, outlierCandidates: [] });
      expect(validation.status).toBe("ACCEPTED");
      accepted.push({ value: sequence[index]!, timestamp: 1_000 + index * 2_000 });
    }
  });

  it("does not apply the outlier to entry or settlement locks", () => {
    const history: AcceptedObservation[] = [{ value: 1.385285, timestamp: 1_500 }];
    const validation = validatePriceObservation({ value: 1.163930, timestamp: 2_000, confidence: .97, history });
    const accepted = validation.status === "ACCEPTED" || validation.status === "REGIME_CHANGE_ACCEPTED";
    expect(accepted).toBe(false);
  });
});
