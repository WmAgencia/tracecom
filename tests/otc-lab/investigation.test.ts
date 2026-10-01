import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { audit, normalizeCandles, sha256, horizonReturns, volatilityExpansionSignal, testLookahead, directions300 } from "../../relay/otc-lab/investigation.mjs";

const fixture = (n = 80) => ({ candles: Array.from({ length: n }, (_, i) => { const c = 1.1 + Math.sin(i / 3) * 0.0002 + i * 0.00001; return { from: new Date(i * 60_000).toISOString(), to: new Date((i + 1) * 60_000).toISOString(), open: c, max: c + .0001, min: c - .0001, close: c + Math.sin(i) * .00003 }; }) });

describe("isolated OTC investigation", () => {
  it("normalizes deterministically and hashes frozen bytes", () => { const raw = JSON.stringify(fixture()); expect(sha256(raw)).toBe(sha256(raw)); expect(normalizeCandles(JSON.parse(raw))).toHaveLength(80); });
  it("verifies the committed frozen data against its SHA-256 manifest", () => { const audit = JSON.parse(fs.readFileSync(new URL("../../docs/otc-lab/26h-data-audit.json", import.meta.url), "utf8")); const bytes = fs.readFileSync(new URL(`../../${audit.frozenSnapshot.replaceAll("\\", "/")}`, import.meta.url)); const digest=createHash("sha256").update(bytes).digest("hex"); expect(digest).toBe(audit.frozenSha256); const manifest=JSON.parse(fs.readFileSync(new URL(`../../${audit.frozenSnapshot.replaceAll("\\", "/").replace(/\.json$/, ".manifest.json")}`, import.meta.url), "utf8")); expect(manifest.datasetSha256).toBe(digest); });
  it("reproduces and invalidates V1 after excluding the six-minute gap", () => { const benchmark = JSON.parse(fs.readFileSync(new URL("../../docs/otc-lab/model-benchmark.json", import.meta.url), "utf8")); expect(benchmark.v1.legacyPriorMethod).toMatchObject({ signals: 27, wins: 19, windowsCrossingGap: 19 }); expect(benchmark.v1).toMatchObject({ signalCountOverlapping: 8, wins: 3, effectiveNonoverlapCount: 2 }); });
  it("audits missing candles without interpolation", () => { const p = fixture(4); p.candles[3].to = new Date(300_000).toISOString(); const rows = normalizeCandles(p); const result = audit(rows, Buffer.from(JSON.stringify(p))); expect(result.gapCount).toBe(1); expect(result.gaps[0].missingCandles).toBe(1); });
  it("does not fabricate sub-minute outcomes and uses exact 300s closes", () => { const c = normalizeCandles(fixture()); expect(horizonReturns(c, 45).available).toBe(false); expect(horizonReturns(c, 300).nOverlapping).toBeGreaterThan(0); });
  it("passes future mutation lookahead test", () => { const c = normalizeCandles(fixture()); expect(testLookahead(c, volatilityExpansionSignal).passed).toBe(true); });
  it("creates nonoverlapping 300-second targets", () => { const c = normalizeCandles(fixture()); const d = directions300(c); expect(d.length).toBe(15); expect(new Set(d.map((x) => x.at)).size).toBe(d.length); });
  it("keeps research module isolated from trading and operational engines", () => { const source = fs.readFileSync(new URL("../../relay/otc-lab/investigation.mjs", import.meta.url), "utf8"); expect(source).not.toMatch(/placeOrder|placeTrade|ARM|V3|Crypto|iq-mcp|server\.mjs/); });
});
