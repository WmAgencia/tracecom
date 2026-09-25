/**
 * V3 — hash/manifest: determinismo, cobertura e V2 intocada.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
// @ts-expect-error - script ESM sem tipagem
const hashModule = await import("../../scripts/v3-strategy-hash.mjs");
const { computeV3StrategyHash, V3_DECISION_FILES, V3_MANIFEST_PATH, v3Policy } = hashModule as any;

describe("V3 estrategia — hash e manifesto", () => {
  it("hash determinístico e cobre todos os arquivos de decisao da V3", () => {
    const first = computeV3StrategyHash();
    const second = computeV3StrategyHash();
    expect(first.strategyHash).toBe(second.strategyHash);
    expect(first.strategyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const file of ["relay/v3/timing.mjs", "relay/v3/measurements.mjs", "relay/v3/scenarios.mjs", "relay/v3/consensus.mjs", "relay/v3/opportunity-engine.mjs"]) {
      expect(V3_DECISION_FILES).toContain(file);
    }
    expect(v3Policy().discoveryMaxTteMs).toBe(330_000);
    expect(v3Policy().entryLeadMs).toBe(2_000);
    expect(v3Policy().targetHoldSeconds).toBe(300);
  });

  it("manifesto V3 esta coerente com o codigo (hash sem drift)", () => {
    const manifest = JSON.parse(fs.readFileSync(V3_MANIFEST_PATH, "utf8"));
    const computed = computeV3StrategyHash();
    expect(manifest.strategyVersion).toBe("PULLBACK_4060_300_AGENTIC_V3");
    // V3 foi promovida para a estratégia operacional; o manifesto é a
    // autoridade para o runtime e o teste deve proteger esse estado ativo.
    expect(manifest.status).toBe("ACTIVE");
    expect(manifest.executable).toBe(true);
    expect(manifest.strategyHash).toBe(computed.strategyHash);
    expect(manifest.newStrategyHash).toBe(computed.strategyHash);
    expect(manifest.stats.opportunities).toBe(0);
    expect(manifest.stats.wins).toBe(0);
    expect(manifest.edge).toBeUndefined();
    expect(manifest.confidence).toBeUndefined();
  });

  it("V2 permanece congelada e com hash original", () => {
    const v2 = JSON.parse(fs.readFileSync("estrategias/strategy-versions/PULLBACK_4060_300_AGENTIC_V2.json", "utf8"));
    expect(v2.status).toBe("ACTIVE");
    expect(v2.frozen).toBe(true);
    expect(v2.strategyHash).toBe("sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0");
    const freeze = JSON.parse(fs.readFileSync("estrategias/strategy-versions/PULLBACK_4060_300_AGENTIC_V2.freeze.json", "utf8"));
    expect(freeze.strategyHash).toBe(v2.strategyHash);
  });
});
