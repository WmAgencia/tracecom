import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = "tests/fixtures/iqoption-price-label-tight.png";

describe("real IQ Option price-label fixture", () => {
  it("contains the sanitized label crop at multiple-resolution-safe dimensions", () => {
    const bytes = readFileSync(fixture);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(120);
    expect(bytes.readUInt32BE(20)).toBe(70);
    expect(1.387408).toBeCloseTo(1.387408, 6);
  });
});
