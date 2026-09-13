import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browser = readFileSync("src/http/public/app.js", "utf8");
const api = readFileSync("api/http.ts", "utf8");
const provider = readFileSync("api/vision-provider.ts", "utf8");
const html = readFileSync("src/http/public/index.html", "utf8");

describe("sanitized crop transport contract", () => {
  it("does not regress to metadata-only Vision requests", () => {
    expect(browser).toContain("chartImages: temporal");
    expect(browser).toContain("dataUrl: item.dataUrl");
    expect(browser).toContain("VISION_CROP_READY");
    expect(browser).toContain("VISION_REQUEST_PREPARED");
    expect(api).toContain("imageDataUrl: images[0].dataUrl");
    expect(api).toContain("VISION_API_RECEIVED");
    expect(provider).toContain('source: { type: "base64"');
    expect(provider).toContain("VISION_PROVIDER_REQUEST");
  });

  it("keeps one canonical 5-second observation and preserves non-operational lean", () => {
    expect(browser).toContain("CANDLE_SECONDS = 5");
    expect(browser).toContain("state.lastCandleId === candleId");
    expect(browser).toContain("directionalLean");
    expect(api).toContain("Promise.all([");
    expect(api).toContain("BULL_AGENT");
    expect(api).toContain("RISK_NO_TRADE_AGENT");
    expect(api).toContain("BULL_ADVOCATE");
    expect(api).toContain("BEAR_ADVOCATE");
    expect(api).toContain("controlDecision");
    expect(api).toContain("challengerDecision");
    expect(api).toContain("latencyStats");
    expect(api).toContain("FABLE_TIMEOUT");
    expect(api).toContain("WAIT_DIRECTIONAL_LEAN");
    expect(provider).toContain("VISION_PARSE_REPAIRED");
    expect(html).toContain("directionalLeanValue");
    expect(html).toContain("5s / 60s");
  });
});
