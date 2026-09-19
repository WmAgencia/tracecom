/**
 * SCENARIO_ENGINE_V3_FROZEN — verificador do manifesto de congelamento.
 *
 * Este teste RECALCULA os sha256 dos tres artefatos congelados e falha se qualquer um divergir.
 * Tambem confere que a configuracao/contrato exportados pelos modulos continuam iguais ao manifesto
 * (8 playbooks, cenarios, FEATURE_COMPONENTS, OTC unavailable, politicas SHADOW_ONLY).
 *
 * Congelado em 2026-09-19T08:21:48Z (commit-base 87688267aa2145ab9af22551f26b1bb169eeb715).
 * Qualquer mudanca de logica exige NOVA VERSAO — nunca editar a V3 congelada.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const engine = await import("../../relay/scenario-engine.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const shadow = await import("../../relay/scenario-shadow.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const intersection = await import("../../relay/scenario-timing-intersection.mjs");

type AnyRecord = Record<string, any>;

const ROOT = process.cwd();
const MANIFEST_PATH = "docs/research/data/scenario-engine-freeze.json";
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as AnyRecord;
const sha256 = (file: string) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");

const FROZEN_FILES = [
  "relay/scenario-engine.mjs",
  "relay/scenario-shadow.mjs",
  "relay/scenario-timing-intersection.mjs",
];

describe("SCENARIO_ENGINE_V3_FROZEN — manifesto verificavel", () => {
  it("registra a versao congelada SCENARIO_ENGINE_V3_FROZEN", () => {
    expect(manifest.schema).toBe("scenario-engine-freeze-v1");
    expect(manifest.scenarioEngineVersion).toBe("SCENARIO_ENGINE_V3_FROZEN");
    expect(manifest.engineVersionConstant).toBe("SCENARIO_ENGINE_V3");
    expect(manifest.frozenAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(manifest.frozenAtCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("recalcula o sha256 dos 3 artefatos congelados e falha se divergirem", () => {
    const listed = Object.keys(manifest.files).sort();
    expect(listed).toEqual([...FROZEN_FILES].sort());
    for (const file of FROZEN_FILES) {
      const recomputed = sha256(file);
      expect(recomputed, `${file} divergiu do freeze`).toBe(manifest.files[file].sha256);
      expect(recomputed).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("mantem o motor byte a byte no contrato congelado (versao, regimes, cenarios, playbooks)", () => {
    expect(engine.SCENARIO_ENGINE_VERSION).toBe(manifest.engineVersionConstant);
    expect(engine.SCENARIO_ENGINE_VERSION).toBe("SCENARIO_ENGINE_V3");
    expect(Object.values(engine.SCENARIOS)).toEqual(manifest.playbooks.map((row: AnyRecord) => row.scenario));
    const playbooks = Object.values(engine.PLAYBOOK_DEFINITIONS) as AnyRecord[];
    expect(playbooks).toHaveLength(8);
    expect(playbooks.map((row) => row.id).sort()).toEqual(manifest.playbooks.map((row: AnyRecord) => row.id).sort());
    for (const row of playbooks) {
      expect(row.featuresUsed).toEqual(manifest.features.playbookFeaturesUsed[row.id]);
      expect(row.featuresUsed).toContain("structureLabel");
    }
    expect(engine.FEATURE_COMPONENTS).toEqual(manifest.features.engineFeatureComponents);
    expect(engine.OTC_UNAVAILABLE_FEATURES).toEqual(manifest.features.otcUnavailable);
    expect(engine.SCENARIO_ENGINE_POLICY.controlsExecution).toBe(false);
    expect(engine.SCENARIO_ENGINE_POLICY.tuningPolicy).toBe("NO_TUNING_ON_WIN_LOSS");
  });

  it("mantem o shadow SHADOW_ONLY com o mesmo contrato (2 fases, EXPERIMENTAL_V1, timing NONE)", () => {
    expect(shadow.SCENARIO_ENGINE_V3).toBe(manifest.engineVersionConstant);
    expect(shadow.SCENARIO_SHADOW_VERSION).toBe(manifest.configuration.shadow.scenarioShadowVersion);
    expect(shadow.SCENARIO_ENGINE_CONTRACT_VERSION).toBe(manifest.configuration.shadow.contractVersion);
    expect(shadow.DIVERGENCE_POLICY_VERSION).toBe(manifest.configuration.shadow.divergencePolicy);
    expect(shadow.DEFAULT_ABLATION).toEqual(manifest.configuration.shadow.ablationDefault);
    expect(shadow.SCENARIO_SHADOW_POLICY.controlsExecution).toBe(false);
    expect(shadow.SCENARIO_SHADOW_POLICY.controlsProductionCritic).toBe(false);
    expect(shadow.SCENARIO_SHADOW_POLICY.criticMode).toBe("INDEPENDENT_TWO_PHASE");
    expect(shadow.SCENARIO_SHADOW_POLICY.divergenceMode).toBe("INVESTIGATION_NEVER_VOTING");
    expect(shadow.SCENARIO_SHADOW_POLICY.timingCoupling).toBe("NONE");
    expect(shadow.ENGINE_CONTRACT).toEqual([
      "SCENARIO_ENGINE_VERSION", "REGIMES", "SCENARIOS", "extractContext", "classifyRegime", "classifyScenario", "evaluatePlaybook", "analyzeScenario",
    ]);
    expect(shadow.sha256Hex("freeze").length).toBe(64);
  });

  it("mantem a interseccao como comparacao somente-leitura", () => {
    const policy = intersection.SCENARIO_TIMING_INTERSECTION_POLICY as AnyRecord;
    expect(intersection.SCENARIO_TIMING_INTERSECTION_VERSION).toBe(manifest.configuration.intersection.version);
    expect(intersection.INTERSECTION_VERDICTS).toEqual(manifest.configuration.intersection.verdicts);
    expect(policy.mutatesNeither).toBe(true);
    expect(policy.controlsExecution).toBe(false);
    expect(policy.mode).toBe("READ_ONLY_COMPARISON");
  });

  it("explicita que o freeze NAO autoriza mudar decisoes de producao", () => {
    expect(manifest.frozenDecisionsNotToChange).toContain("playbooks");
    expect(manifest.frozenDecisionsNotToChange).toContain("thresholds");
    expect(manifest.frozenDecisionsNotToChange).toContain("EXPERIMENTAL_V1");
    expect(manifest.frozenDecisionsNotToChange).toContain("regras de WAIT");
    expect(manifest.configuration.runtimeFlags.scenarioShadowEnabled).toBe(true);
    expect(manifest.configuration.runtimeFlags.scenarioTimingIntersectionEnabled).toBe(true);
    expect(manifest.configuration.governance.shadowSendsOrders).toBe(false);
  });
});
