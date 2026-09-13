import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

async function diagnostic() {
  const source = await readFile(new URL("../../extension/diagnostic-sanitizer.js", import.meta.url), "utf8");
  const context: { TraceConDiagnostic?: any } = {};
  runInNewContext(source, context);
  if (!context.TraceConDiagnostic) throw new Error("diagnostic sanitizer did not initialize");
  return context.TraceConDiagnostic;
}

describe("DEV diagnostic sanitizer", () => {
  it("retains bounded market diagnostics while removing sensitive fields at every depth", async () => {
    const tools = await diagnostic();
    const result = tools.sanitize({
      eventName: "candle-generated",
      price: 1.16022,
      authorization: "must-not-leave-extension",
      nested: { sessionId: "must-not-leave-extension", activeId: 42, close: 1.16023 },
      rows: [{ symbol: "EURUSD", cookie: "must-not-leave-extension" }],
    });
    expect(result).toEqual({
      eventName: "candle-generated",
      price: 1.16022,
      nested: { activeId: 42, close: 1.16023 },
      rows: [{ symbol: "EURUSD" }],
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leave-extension");
  });

  it("creates a stable fingerprint from safe diagnostic shape rather than credentials", async () => {
    const tools = await diagnostic();
    const first = { syncState: { failure: "STREAM_FOUND_MAPPING_PENDING", candidateIds: [42] }, protocolSummary: { eventTypes: { "candle-generated": 4 } }, errors: [], token: "first" };
    const second = { ...first, token: "second" };
    expect(tools.fingerprint(first)).toBe(tools.fingerprint(second));
  });
});
