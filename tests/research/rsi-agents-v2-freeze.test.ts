/**
 * RSI AGENTS V2 FREEZE — recalcula sha256 e exige igualdade com o manifesto.
 * Prova noTuning das skills V2 e V1 intocada (referencia).
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/rsi-agents-v2-freeze.json";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");

const EXPECTED_FILES = [
  "relay/rsi-skills-v2.mjs",
  "relay/rsi-agents-v2.mjs",
  "relay/iq-multi-runtime.mjs",
  "relay/rsi-reversal.mjs",
  "relay/rsi-variants.mjs",
  "relay/rsi-agents-5x5.mjs",
];

describe("RSI_AGENTS_V2_FREEZE", () => {
  it("registra os arquivos V2 + referencias V1 com sha256/bytes", () => {
    expect(manifest.schema).toBe("rsi-agents-v2-freeze-v1");
    expect(manifest.noTuning).toBe(true);
    expect(manifest.strategies).toEqual({ strict: "RSI_REVERSAL_STRICT_V2", pullback: "RSI_EXTREME_PULLBACK_V2" });
    expect(manifest.policy.stakeBrl).toBe(10);
    expect(manifest.policy.practiceOnly).toBe(true);
    expect(manifest.policy.realLocked).toBe(true);
    for (const file of EXPECTED_FILES) expect(Object.keys(manifest.files)).toContain(file);
  });

  it("recalcula sha256 e falha se o codigo V2/runtime divergir do manifesto", () => {
    for (const [file, entry] of Object.entries(manifest.files) as Array<[string, any]>) {
      expect(sha256(file), `${file} divergiu`).toBe(entry.sha256);
      expect(statSync(path.join(ROOT, file)).size).toBe(entry.bytes);
    }
  });

  it("V1 permanece byte a byte como referencia congelada", () => {
    for (const file of manifest.v1Reference.files) {
      expect(manifest.files[file]).toBeTruthy();
      expect(sha256(file)).toBe(manifest.files[file].sha256);
    }
  });
});
