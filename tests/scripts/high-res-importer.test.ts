import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("high-resolution dataset importer", () => {
  it("normalizes CSV price and bid/ask, timestamps and quality metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracecon-tick-"));
    const input = path.join(dir, "ticks.csv");
    fs.writeFileSync(input, "timestamp,bid,ask\n2026-01-01T00:00:00Z,1.1,1.3\n1767225601,1.2,1.4\n");
    const out = path.join(dir, "out");
    const script = path.resolve("scripts/import-high-res-dataset.mjs");
    execFileSync(process.execPath, [script, input, "--out", out], { encoding: "utf8" });
    const result = JSON.parse(fs.readFileSync(path.join(out, "dataset.json"), "utf8"));
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ bid: 1.1, ask: 1.3 });
    expect(result.rows[0].price).toBeCloseTo(1.2, 10);
    expect(result.metadata.quality.status).toBe("PASS");
    expect(result.metadata.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unusable rows and reports gaps without inventing data", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tracecon-tick-"));
    const input = path.join(dir, "ticks.json");
    fs.writeFileSync(input, JSON.stringify({ rows: [
      { timestamp: 1704067200000, price: 1.2 }, { timestamp: 1704067200000, price: 1.2 },
      { timestamp: 1704067500000, price: 1.3 }, { timestamp: "invalid", price: 9 }
    ] }));
    const out = path.join(dir, "out");
    execFileSync(process.execPath, [path.resolve("scripts/import-high-res-dataset.mjs"), input, "--out", out]);
    const quality = JSON.parse(fs.readFileSync(path.join(out, "quality-report.json"), "utf8"));
    expect(quality.quality.invalidRows).toBe(1);
    expect(quality.quality.duplicateTimestamps).toBe(1);
    expect(quality.quality.gapCount).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(out, "dataset.json"), "utf8")).rows).toHaveLength(3);
  });
});
