import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browser = readFileSync("src/http/public/app.js", "utf8");
const api = readFileSync("api/http.ts", "utf8");
const provider = readFileSync("api/vision-provider.ts", "utf8");

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
});
