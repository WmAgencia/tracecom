/**
 * RSI V3 FREEZE — recalcula sha256 e exige igualdade com o manifesto.
 * Prova noTuning da V3 e que V1/V2 permanecem byte a byte congeladas.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/rsi-v3-freeze.json";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const sha256 = (file: string) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");

describe("RSI_V3_FREEZE", () => {
  it("registra V3 + referencias V1/V2 com sha256/bytes e noTuning", () => {
    expect(manifest.schema).toBe("rsi-v3-freeze-v1");
    expect(manifest.noTuning).toBe(true);
    expect(manifest.strategy).toBe("RSI_REVERSAL_PULLBACK_V3");
    expect(manifest.policy.stakeBrl).toBe(10);
    expect(manifest.policy.routing).toBe("RSI_V3_ONLY");
    expect(manifest.policy.practiceOnly).toBe(true);
    expect(manifest.policy.realLocked).toBe(true);
    for (const file of ["relay/rsi-v3.mjs", "relay/rsi-agents-v3.mjs", "relay/iq-multi-runtime.mjs"]) expect(Object.keys(manifest.files)).toContain(file);
  });

  it("recalcula sha256 e falha se o codigo V3/runtime divergir do manifesto", () => {
    for (const [file, entry] of Object.entries(manifest.files) as Array<[string, any]>) {
      expect(sha256(file), `${file} divergiu`).toBe(entry.sha256);
      expect(statSync(path.join(ROOT, file)).size).toBe(entry.bytes);
    }
  });

  it("V1/V2 permanecem congeladas (referencia byte a byte)", () => {
    for (const file of [...manifest.references.v1, ...manifest.references.v2]) {
      expect(manifest.files[file]).toBeTruthy();
      expect(sha256(file)).toBe(manifest.files[file].sha256);
    }
  });
});
