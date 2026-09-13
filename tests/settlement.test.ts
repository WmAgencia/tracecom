import { describe, expect, it } from "vitest";
import { settleTrade } from "../src/training/settlement";

const base = { direction: "BUY" as const, entryPrice: 100, entryTimestamp: 1_000, dueTimestamp: 61_000, exitTimestamp: 61_000 };

describe("settleTrade canonical paper settlement", () => {
  it.each([
    [101, "WIN"], [99, "LOSS"], [100, "DRAW"],
  ] as const)("settles BUY at due boundary (%s) as %s", (exitPrice, outcome) => {
    expect(settleTrade({ ...base, exitPrice })).toMatchObject({ outcome });
  });
  it("inverts direction for SELL", () => {
    expect(settleTrade({ ...base, direction: "SELL", exitPrice: 99 }).outcome).toBe("WIN");
  });
  it("rejects an early quote instead of labeling it", () => {
    expect(settleTrade({ ...base, exitPrice: 101, exitTimestamp: 60_999 })).toMatchObject({ outcome: "UNKNOWN", reason: "EARLY_EXIT" });
  });
  it("rejects a cross-symbol quote", () => {
    expect(settleTrade({ ...base, exitPrice: 101, entrySymbol: "EURUSD", exitSymbol: "GBPUSD" })).toMatchObject({ outcome: "UNKNOWN", reason: "SYMBOL_MISMATCH" });
  });
  it("does not turn missing prices into a loss", () => {
    expect(settleTrade({ ...base, entryPrice: null, exitPrice: 101 })).toMatchObject({ outcome: "UNKNOWN", reason: "MISSING_PRICE" });
  });
});
