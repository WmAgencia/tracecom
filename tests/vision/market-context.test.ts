import { describe, expect, it } from "vitest";
import { isEligibleForUsdCadOtcExperiment, validateExperimentMarketContext } from "../../src/vision/market-context";

const base = { sessionId: "vision_test", segmentId: "seg_1", asset: "USD/CAD (OTC)", marketType: "OTC", timeframeSeconds: 5, visibleWindowSeconds: 300, tradeExpirationSeconds: 60, confidence: .95 };
describe("MarketContext provenance", () => {
  it("accepts only verified USD/CAD OTC 5s/5m/60s context", () => { const c = validateExperimentMarketContext(base); expect(c.validationStatus).toBe("VALID"); expect(isEligibleForUsdCadOtcExperiment(c)).toBe(true); });
  it("rejects unknown, spot, timeframe and expiration mismatches", () => { expect(validateExperimentMarketContext({ ...base, asset: "USD/CAD" }).validationStatus).toBe("INSUFFICIENT_EVIDENCE"); expect(validateExperimentMarketContext({ ...base, marketType: "REAL_MARKET" }).validationStatus).toBe("MARKET_TYPE_MISMATCH"); expect(validateExperimentMarketContext({ ...base, timeframeSeconds: 60 }).validationStatus).toBe("TIMEFRAME_MISMATCH"); expect(validateExperimentMarketContext({ ...base, tradeExpirationSeconds: 300 }).validationStatus).toBe("EXPIRATION_MISMATCH"); });
});
