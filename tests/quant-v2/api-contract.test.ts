import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Quant V2 shadow API contract", () => {
  it("is isolated from the operational path", () => {
    const api = readFileSync("api/http.ts", "utf8");
    expect(api).toContain('path === "/api/quant/shadow"');
    expect(api).toContain("shadowOnly: true");
    expect(api).toContain('brokerAutomation: "NONE"');
    expect(api).toContain("quantShadowDecision");
  });

  it("has explicit versioned research artifacts", () => {
    const docs = readFileSync("docs/quant-v2.md", "utf8");
    expect(docs).toContain("walk-forward");
    expect(docs).toContain("NO_EDGE");
    expect(docs).toContain("never promoted automatically");
  });
});
