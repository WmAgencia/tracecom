import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vision Web entry timer contract", () => {
  const source = readFileSync(resolve(process.cwd(), "src/http/public/app.js"), "utf8");

  it("uses an absolute entry target and records the decision metadata", () => {
    expect(source).toContain("decisionTimestamp");
    expect(source).toContain("entryUntil = decision === \"BUY\" || decision === \"SELL\" ? now + 10_000");
    expect(source).toContain("entryUntil - now");
  });

  it("keeps WAIT re-evaluation distinct from an actionable entry window", () => {
    expect(source).toContain("reanalysisAt = decision === \"WAIT\" ? now + 5_000 : 0");
    expect(source).toContain("REAVALIANDO EM");
    expect(source).toContain("ENTRADA EM");
    expect(source).toContain("EXPIRADO");
  });
});
