import { describe, expect, it } from "vitest";
import { lockCausalPrice } from "../../src/vision/price-lock";
import { settleTrade } from "../../src/training/settlement";

describe("causal current price locks", () => {
  const observations = [{ value: 1.387408, timestamp: 1000, confidence: .96, source: "IQ_OPTION_CURRENT_PRICE_LABEL" }, { value: 1.3875, timestamp: 61_000, confidence: .95, source: "IQ_OPTION_CURRENT_PRICE_LABEL" }];
  it("locks the latest valid observation at or before entry/settlement", () => {
    expect(lockCausalPrice(observations, 1_500)?.value).toBe(1.387408);
    expect(lockCausalPrice(observations, 61_500)?.value).toBe(1.3875);
    expect(lockCausalPrice(observations, 900)).toBeNull();
  });
  it("uses settleTrade as the only outcome authority", () => {
    expect(settleTrade({ direction: "BUY", entryPrice: 1.387408, exitPrice: 1.3875, entryTimestamp: 1000, exitTimestamp: 61_000, dueTimestamp: 61_000 }).outcome).toBe("WIN");
    expect(settleTrade({ direction: "BUY", entryPrice: 1.387408, exitPrice: 1.3873, entryTimestamp: 1000, exitTimestamp: 61_000, dueTimestamp: 61_000 }).outcome).toBe("LOSS");
    expect(settleTrade({ direction: "SELL", entryPrice: 1.387408, exitPrice: 1.3873, entryTimestamp: 1000, exitTimestamp: 61_000, dueTimestamp: 61_000 }).outcome).toBe("WIN");
  });
});
