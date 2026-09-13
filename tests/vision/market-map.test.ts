import { describe, expect, it } from "vitest";
import { MARKET_VISION_MAP, mapRoiToPixels, normalizeRect } from "../../src/vision/market-map";

describe("Market Vision Map", () => {
  it("defines all passive IQ Option regions with normalized bounds", () => {
    expect(Object.keys(MARKET_VISION_MAP)).toHaveLength(10);
    for (const roi of Object.values(MARKET_VISION_MAP)) {
      expect(roi.rect.x).toBeGreaterThanOrEqual(0); expect(roi.rect.y).toBeGreaterThanOrEqual(0);
      expect(roi.rect.x + roi.rect.width).toBeLessThanOrEqual(1);
      expect(roi.rect.y + roi.rect.height).toBeLessThanOrEqual(1);
    }
  });
  it("clamps unsafe rectangles and maps them to pixels", () => {
    expect(normalizeRect({ x: -.2, y: .8, width: 2, height: .5 })).toEqual({ x: 0, y: .8, width: 1, height: .2 });
    expect(mapRoiToPixels({ x: .1, y: .2, width: .5, height: .5 }, 1000, 800)).toEqual({ x: 100, y: 160, width: 500, height: 400 });
  });
});
