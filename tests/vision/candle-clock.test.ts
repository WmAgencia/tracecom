import { describe, expect, it } from "vitest";
import { CANDLE_SECONDS, EXPIRATION_SECONDS, VISIBLE_WINDOW_SECONDS, candleCloseTimestamp, candleId, nextCandleAnalysisAt } from "../../src/vision/candle-clock";

describe("5-second visual candle clock", () => {
  it("keeps the operational relationship explicit", () => {
    expect(CANDLE_SECONDS).toBe(5);
    expect(EXPIRATION_SECONDS / CANDLE_SECONDS).toBe(12);
    expect(VISIBLE_WINDOW_SECONDS).toBe(300);
  });
  it("deduplicates timestamps inside the same candle and schedules after close", () => {
    expect(candleId(12_001)).toBe(candleId(14_999));
    expect(candleCloseTimestamp(14_999)).toBe(10_000);
    expect(nextCandleAnalysisAt(14_999)).toBe(15_500);
  });
});
