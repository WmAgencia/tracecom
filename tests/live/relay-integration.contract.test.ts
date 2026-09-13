import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const api = readFileSync("api/live-api.ts", "utf8");
const relay = readFileSync("relay/server.mjs", "utf8");
const browser = readFileSync("src/http/public/app.js", "utf8");

describe("live relay security and crop-only contracts", () => {
  it("keeps the Railway administrative credential server-side", () => {
    expect(api).toContain("process.env.TRACECOM_LIVE_RELAY_ADMIN_SECRET");
    expect(browser).not.toContain("TRACECOM_LIVE_RELAY_ADMIN_SECRET");
    expect(browser).not.toContain("x-relay-admin");
  });

  it("accepts only explicit local chart crops at the relay", () => {
    expect(relay).toContain("p.captureType==='crop'");
    expect(relay).toContain("!('screen' in p)");
    expect(relay).toContain("!('desktop' in p)");
    expect(browser).toContain('captureType: "crop"');
    expect(browser).toContain('api("/api/live/browser/frame"');
  });

  it("limits browser telemetry to the documented shadow events", () => {
    for (const type of ["SESSION_STARTED", "VISION_MARKET_SAMPLE", "DECISION", "COUNTDOWN", "SHADOW_UPDATE", "SETTLEMENT", "PIPELINE_ERROR", "HEARTBEAT", "SESSION_ENDED"]) expect(api).toContain(`"${type}"`);
    expect(api).not.toMatch(/BROKER_ACTION|EXECUTE_ORDER/);
  });

  it("keeps JSONB key scopes and request access logging durable", () => {
    expect(relay).toContain("JSON.stringify(requestedScopes)");
    expect(relay).toContain("_tracecomKeyId");
    expect(relay).toContain("live_access_logs");
    expect(relay).toContain("last-event-id");
  });
});
