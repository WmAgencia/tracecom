/**
 * AGENTS V4 HOTPATH FREEZE — recalcula sha256 do hot path e exige:
 *  - igualdade com o manifesto agents-v4-hotpath-freeze.json;
 *  - igualdade dos artefatos V3 com o freeze original do SCENARIO_ENGINE_V3_FROZEN.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

type AnyRecord = Record<string, any>;
const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/agents-v4-hotpath-freeze.json";
const V3_MANIFEST_PATH = "docs/research/data/scenario-engine-freeze.json";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as AnyRecord;
const v3Manifest = JSON.parse(readFileSync(V3_MANIFEST_PATH, "utf8")) as AnyRecord;
const sha256 = (file: string) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");

describe("AGENTS_V4_HOTPATH_FREEZE", () => {
  it("registra os 13 arquivos do hot path com sha256/bytes", () => {
    expect(manifest.schema).toBe("agents-v4-hotpath-freeze-v1");
    const files = Object.keys(manifest.files);
    expect(files).toContain("relay/professional-brain.mjs");
    expect(files).toContain("relay/trade-quality.mjs");
    expect(files).toContain("relay/entry-timing.mjs");
    expect(files).toContain("relay/portfolio-gate.mjs");
    expect(files).toContain("relay/iqoption-connector.mjs");
    expect(files).toContain("relay/iq-multi-runtime.mjs");
    expect(files.length).toBe(13);
  });

  it("recalcula sha256 e falha se o hot path divergir do manifesto", () => {
    for (const [file, entry] of Object.entries(manifest.files) as Array<[string, AnyRecord]>) {
      expect(sha256(file), `${file} divergiu`).toBe(entry.sha256);
      expect(statSync(path.join(ROOT, file)).size).toBe(entry.bytes);
    }
  });

  it("artefatos congelados do V3 continuam byte a byte identicos", () => {
    for (const [file, check] of Object.entries(manifest.v3CrossCheck) as Array<[string, AnyRecord]>) {
      expect(check.matchesV3Freeze, file).toBe(true);
      expect(sha256(file)).toBe(v3Manifest.files[file].sha256);
    }
  });

  it("G2/Quality Gate/JIT/Execution Gate/stake nao foram alterados pela rodada V4", () => {
    for (const file of ["relay/professional-brain.mjs", "relay/trade-quality.mjs", "relay/entry-timing.mjs", "relay/portfolio-gate.mjs", "relay/iqoption-connector.mjs", "relay/price-structure.mjs", "relay/feature-engine.mjs"]) {
      expect(manifest.files[file].sha256).toBe(sha256(file));
    }
    expect(manifest.files["relay/iq-multi-runtime.mjs"].sha256).toBe(sha256("relay/iq-multi-runtime.mjs"));
  });
});
