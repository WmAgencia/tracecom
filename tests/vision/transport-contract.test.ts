import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browser = readFileSync("src/http/public/app.js", "utf8");
const api = readFileSync("api/http.ts", "utf8");
const provider = readFileSync("api/vision-provider.ts", "utf8");
const html = readFileSync("src/http/public/index.html", "utf8");
const session = readFileSync("src/training/session.ts", "utf8");
const store = readFileSync("src/training/store.ts", "utf8");

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
    expect(session).toContain("controlDecision");
    expect(session).toContain("challengerDecision");
    expect(api).toContain("latencyStats");
    expect(api).toContain("FABLE_TIMEOUT");
    expect(session).toContain("WAIT_DIRECTIONAL_LEAN");
    expect(provider).toContain("VISION_PARSE_REPAIRED");
    expect(html).toContain("directionalLeanValue");
    expect(html).toContain("5s / 60s");
  });

  it("keeps durable session recovery, price outlier guard and backpressure contracts", () => {
    expect(browser).toContain("TRAINING_SESSION_RECOVERY_STARTED");
    expect(browser).toContain("TRAINING_SESSION_RECOVERED");
    expect(browser).toContain("PRICE_OBSERVATION_REJECTED");
    expect(browser).toContain("outlierCandidates");
    expect(browser).toContain("ANALYSIS_SKIPPED_BUSY");
    expect(browser).toContain("STALE_ANALYSIS");
    expect(browser).toContain("state.lastCandleId === candleId");
    expect(api).toContain("trainingStore");
    expect(store).toContain("DURABLE_RELAY");
    expect(api).toContain("validatePriceObservation");
    expect(api).toContain("TEMPORAL_OUTLIER");
    expect(api).toContain("/api/metrics");
  });

  it("keeps the fast T+60 path, deep background analysis and profile selector contracts", () => {
    const fastPath = readFileSync("src/engine/fast-path.ts", "utf8");
    expect(fastPath).toContain("PREDICTION_HORIZON_SECONDS = 60");
    expect(fastPath).toContain("FAST_PATH_DEADLINE_MS = 5_000");
    expect(fastPath).toContain("deepAnalysisAgeMs");
    expect(browser).toContain("FAST_PATH_STARTED");
    expect(browser).toContain("FAST_PATH_COMPLETED");
    expect(browser).toContain("FAST_PATH_TIMEOUT");
    expect(browser).toContain("DEEP_ANALYSIS_COMPLETED");
    expect(browser).toContain("/api/fast/decision");
    expect(browser).toContain("applyProfile");
    expect(html).toContain("profileSelect");
    expect(api).toContain("/api/fast/decision");
  });

  it("keeps the exclusive operational channel contracts", () => {
    expect(browser).toContain("OPERATIONAL_SIGNAL_LOCKED");
    expect(browser).toContain("ENTRY_COUNTDOWN_STARTED");
    expect(browser).toContain("SIGNAL_INVALIDATED_BEFORE_ENTRY");
    expect(browser).toContain("MID_TRADE_DIRECTION_FLIP");
    expect(browser).toContain("MANUAL_ENTRY_PRICE_LOCKED");
    expect(browser).toContain("channelManualPosition");
    expect(browser).toContain("ENTRY_NOT_CONFIRMED");
    expect(html).toContain("opStateValue");
    expect(api).toContain("/api/settlement");
    expect(api).toContain("early_settlement_rejected");
  });

  it("keeps the full diagnostic access contracts", () => {
    const relay = readFileSync("relay/server.mjs", "utf8");
    const liveApi = readFileSync("api/live-api.ts", "utf8");
    expect(relay).toContain("diagnostic_logs");
    expect(relay).toContain("agent_runs");
    expect(relay).toContain("OPENCODE_FULL_DIAGNOSTIC");
    expect(relay).toContain("debug:read");
    expect(relay).toContain("/timeline");
    expect(relay).toContain("debug-snapshot");
    expect(liveApi).toContain("/api/live/browser/logs");
    expect(liveApi).toContain("/api/debug/agents");
    expect(liveApi).toContain("/api/debug/config");
    expect(api).toContain("/api/research/session-autopsy");
    expect(api).toContain("/api/research/compare");
    expect(api).toContain("/api/research/replay");
    expect(api).toContain("/api/shadow/evaluate");
    expect(api).toContain("/api/shadow/batch");
    expect(browser).toContain("diagCapture");
    expect(browser).toContain("UNCAUGHT_ERROR");
  });
});
