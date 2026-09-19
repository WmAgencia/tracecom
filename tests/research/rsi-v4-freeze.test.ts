/**
 * RSI V4 FREEZE — teste de manifesto + export/sanitizacao dos primeiros 10 trades.
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
// @ts-expect-error - script ESM sem tipagem
const freeze = await import("../../scripts/rsi-v4-freeze.mjs");
// @ts-expect-error - script ESM sem tipagem
const exporter = await import("../../scripts/rsi-v4-export-first10.mjs");

const { RSI_V4_FREEZE_FILES, sha256File } = freeze;
const { scanForSecrets } = exporter;

describe("RSI_V4_FREEZE", () => {
  it("manifesto existe e os hashes batem com o codigo atual", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../docs/research/data/rsi-v4-freeze.json", import.meta.url), "utf8"));
    expect(manifest.schema).toBe("rsi-v4-freeze-v1");
    expect(manifest.policy.routing).toBe("RSI_V4_ONLY");
    expect(manifest.policy.practiceOnly).toBe(true);
    expect(manifest.policy.realLocked).toBe(true);
    expect(manifest.policy.stakeBrl).toBe(10);
    for (const file of RSI_V4_FREEZE_FILES) expect(sha256File(file), file).toBe(manifest.files[file].sha256);
  });

  it("nunca permite REAL, martingale ou stake diferente de 10", () => {
    const source = readFileSync(new URL("../../relay/rsi-v4.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/martingale|recovery|progression/i);
    expect(source.includes("stakeBrl: 10")).toBe(true);
    expect(source.includes("realLocked: true")).toBe(true);
    const runner = readFileSync(new URL("../../relay/rsi-agents-v4.mjs", import.meta.url), "utf8");
    expect(runner.includes("submitAgentV4Order")).toBe(true);
    expect(/\.requestOrder\s*\(/.test(runner)).toBe(false);
  });
});

describe("RSI V4 — sanitizacao do export GitHub", () => {
  it("detecta segredos e bloqueia", () => {
    expect(scanForSecrets('{"ssid":"abc"}')).toContain("SSID");
    expect(scanForSecrets('{"authorization":"Bearer xyz12345678"}')).toContain("AUTHORIZATION");
    expect(scanForSecrets('{"cookie":"abc"}')).toContain("COOKIE");
    expect(scanForSecrets('{"password":"abc"}')).toContain("PASSWORD");
    expect(scanForSecrets('{"api_key":"sk-1234567890"}')).toContain("SECRET");
    expect(scanForSecrets('{"user_balance_id":12345678}')).toContain("BALANCE_ID");
    expect(scanForSecrets('{"email":"a@b.com"}')).toContain("EMAIL");
    expect(scanForSecrets('{"marketKey":"EURUSD:OTC","rsi":30}')).toHaveLength(0);
  });

  it("pacote de trade e summary nao contem chaves proibidas", () => {
    const pkg = {
      schema: "tracecon-v4-trade-v1", tradeNumber: 1, strategyVersion: "v4", strategyId: "RSI_REVERSAL_V4",
      market: "EURUSD:OTC", underlying: "EURUSD", instrumentType: "BINARY", marketType: "OTC", direction: "BUY",
      duration: 60, payout: 87, stake: 10, accountMode: "PRACTICE",
      timestamps: { candidateAt: 1, entryAt: 2, expiryAt: 3 }, candidateToEntryMs: 1,
      prices: { candidatePrice: 1, entryPrice: 1.1, expiryPrice: 1.2, actualDisplacement: 0.1 },
      entrySnapshot: { rsi: 34, counterEvidenceAtEntry: [], entryReason: ["X"], hardBlocksChecked: [] },
      evaluations: [], settlement: { result: "WIN", profit: 8.7, qualityClass: "NORMAL_WIN" },
      timing: { fixedExpiry: 3 },
    };
    const serialized = JSON.stringify(pkg);
    expect(scanForSecrets(serialized)).toHaveLength(0);
  });
});
