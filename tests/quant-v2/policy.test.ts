import { describe, expect, it } from "vitest";
import { applyShadowPolicy, DEFAULT_SHADOW_POLICY, effectivePolicyId } from "../../src/quant-v2/shadow-policy";
import { quantShadowDecision } from "../../src/quant-v2/quant-fusion";
import { buildFeatureSnapshot } from "../../src/quant-v2/feature-engine";

describe("Quant V2 effective shadow policies", () => {
  it("uses functional knobs and deterministic policy ids", () => {
    const a = effectivePolicyId(DEFAULT_SHADOW_POLICY); const b = effectivePolicyId({ ...DEFAULT_SHADOW_POLICY, noEdgeThreshold: .2 });
    expect(a).not.toBe(b); expect(a).toContain("policy_quant_v2_");
  });
  it("never promotes policy output to operational state", () => {
    const candles = Array.from({ length: 80 }, (_, i) => ({ provider: "f", symbol: "USDCAD", timeframe: "1m" as const, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1, timestamp: i * 5000, receivedAt: i * 5000, isClosed: true, source: "fixture", quality: "high" as const }));
    const out = applyShadowPolicy(quantShadowDecision({ snapshot: buildFeatureSnapshot(candles) }), { ...DEFAULT_SHADOW_POLICY, minimumNeighborCount: 999 });
    expect(out.direction).toBe("NO_EDGE"); expect(out.shadowOnly).toBe(true);
  });
});
