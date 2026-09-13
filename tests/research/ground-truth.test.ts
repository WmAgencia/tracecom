import { describe, expect, it } from "vitest";
import { buildGroundTruth, resolveGroundTruthChain } from "../../src/research/ground-truth";
import { runAudit } from "../../src/research/audit-engine";

const T = 1_000_000;
const observations = [
  { priceObservationId: "po_entry", value: 1.387235, observedAt: T - 1_000, status: "ACCEPTED" },
  { priceObservationId: "po_settle", value: 1.385135, observedAt: T + 60_000, status: "ACCEPTED" },
  { priceObservationId: "po_rejected", value: 1.52, observedAt: T, status: "REJECTED" },
  { priceObservationId: "po_future", value: 1.30, observedAt: T + 90_000, status: "ACCEPTED" },
];

describe("ground truth price provenance", () => {
  it("resolves a complete causal chain", () => {
    const chain = resolveGroundTruthChain({ entryPriceObservationId: "po_entry", settlementPriceObservationId: "po_settle", entryTimestamp: T, settlementTimestamp: T + 60_000, entryPrice: 1.387235, settlementPrice: 1.385135, observations });
    expect(chain.status).toBe("COMPLETE");
    expect(chain.entry?.priceObservationId).toBe("po_entry");
    expect(chain.settlement?.priceObservationId).toBe("po_settle");
  });

  it("marks missing ids as LEGACY_INCOMPLETE_PROVENANCE without fabricating", () => {
    const gt = buildGroundTruth({ groundTruthId: "gt_legacy", entryPrice: 1.387235, settlementPrice: 1.385135 });
    expect(gt.status).toBe("LEGACY_INCOMPLETE_PROVENANCE");
    expect(gt.entryPriceObservationId).toBeNull();
  });

  it("rejects rejected/outlier/future observations as ground truth", () => {
    expect(resolveGroundTruthChain({ entryPriceObservationId: "po_rejected", settlementPriceObservationId: "po_settle", observations }).status).toBe("INVALID");
    expect(resolveGroundTruthChain({ entryPriceObservationId: "po_future", settlementPriceObservationId: "po_settle", entryTimestamp: T, observations }).reasons).toContain("entry_observation_not_causal");
    expect(resolveGroundTruthChain({ entryPriceObservationId: "po_entry", settlementPriceObservationId: "po_settle", entryPrice: 9.99, observations }).reasons).toContain("entry_value_mismatch");
  });

  it("passes PRICE_PROVENANCE in strict mode only with resolvable ids", () => {
    const strict = runAudit({
      priceObservations: observations,
      settlements: [{ signalId: "op_x", entryPrice: 1.387235, exitPrice: 1.385135, entryTimestamp: T, exitTimestamp: T + 60_000, result: "WIN", entryPriceObservationId: "po_entry", settlementPriceObservationId: "po_settle" }],
    }, ["PRICE_PROVENANCE"]);
    expect(strict[0]!.status).toBe("PASS");
    const missing = runAudit({
      priceObservations: observations,
      settlements: [{ signalId: "op_y", entryPrice: 1.387235, exitPrice: 1.385135, entryTimestamp: T, exitTimestamp: T + 60_000, result: "WIN" }],
    }, ["PRICE_PROVENANCE"]);
    expect(missing[0]!.status).toBe("FAIL");
    expect(missing[0]!.evidence[0]).toMatchObject({ status: "LEGACY_INCOMPLETE_PROVENANCE" });
  });
});
