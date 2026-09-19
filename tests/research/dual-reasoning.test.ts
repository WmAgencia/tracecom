/**
 * DUAL_REASONING_V1_SHADOW â€” provas de medicao: A/B cegos, mesmos snapshots por rodada,
 * conflito => WAIT, challenge invalida tese, sem futuro, sem execucao, latencia, settlement idempotente.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const dual = await import("../../relay/dual-reasoning.mjs");
// @ts-expect-error - relay ESM sem tipagem
const hub = await import("../../relay/datahub/index.mjs");
import { buildEnrichedT0, healthyDataQuality, rangeCandles, zigzagCandles } from "../ai/fixtures/agents-v4-fixtures";

function t0Up() { return buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) }).t0; }
function t0Down() { return buildEnrichedT0({ candles: zigzagCandles({ dir: "DOWN", steps: 88 }) }).t0; }

function thesis(agent: string, direction: string, action: string, extra: any = {}) {
  return { agent, role: agent === "A" ? "STRUCTURAL_CONTEXT_ANALYST" : "SHORT_HORIZON_ENTRY_ANALYST", version: dual.DUAL_REASONING_VERSION, snapshotId: extra.snapshotId ?? "s1", availableAt: 1, structuralDirection: direction, shortDirection: direction, candidateAction: action, primaryScenario: extra.scenario ?? "TREND_PULLBACK", evidenceFor: extra.evidenceFor ?? ["e1", "e2"], evidenceAgainst: extra.evidenceAgainst ?? [], invalidation: ["x"], confidenceClass: "MEDIUM", latencyMs: 0, controlsExecution: false };
}

describe("DUAL_REASONING_V1_SHADOW", () => {
  it("Round 1 e cego: A e B analisam o MESMO T0, com hashes proprios e sem ver a conclusao do outro", () => {
    const t0 = t0Up();
    const engine = new dual.DualReasoningEngine({});
    const observation = engine.observeRound1({ t0, candidate: { candidateId: "cand-1", targetEntryAt: 1, targetExpiryAt: 2, payout: 0.87 }, g2Action: "BUY", v4Action: "BUY" });
    expect(observation.rounds.R1.blind).toBe(true);
    expect(observation.rounds.R1.a.snapshotId).toBe(t0.snapshotId);
    expect(observation.rounds.R1.b.snapshotId).toBe(t0.snapshotId);
    expect(observation.rounds.R1.aHash).toHaveLength(64);
    expect(observation.rounds.R1.bHash).toHaveLength(64);
    expect(observation.rounds.R1.a.role).not.toBe(observation.rounds.R1.b.role);
    expect(observation.rounds.R1.a.controlsExecution).toBe(false);
    expect(observation.rounds.R1.b.controlsExecution).toBe(false);
  });

  it("Round 2 usa o MESMO T1 para A e B e preserva o R1 intacto", () => {
    const engine = new dual.DualReasoningEngine({});
    const observation = engine.observeRound1({ t0: t0Up(), candidate: { candidateId: "cand-2", targetEntryAt: 1, targetExpiryAt: 2 }, g2Action: "BUY" });
    const r1Before = JSON.stringify(observation.rounds.R1);
    const t1 = t0Up();
    engine.observeRound2({ observationId: observation.id, t0: t1 });
    expect(observation.rounds.R2.a.snapshotId).toBe(t1.snapshotId);
    expect(observation.rounds.R2.b.snapshotId).toBe(t1.snapshotId);
    expect(observation.rounds.R2.sameSnapshotAB).toBe(true);
    expect(JSON.stringify(observation.rounds.R1)).toBe(r1Before);
  });

  it("conflito de direcao entre A e B gera CHALLENGE e a sintese padrao e WAIT", () => {
    const a = thesis("A", "BULLISH", "BUY");
    const b = thesis("B", "BEARISH", "SELL", { evidenceFor: ["m1", "m2", "m3"] });
    const crossA = dual.crossExamine({ self: a, other: b, round: "FINAL" });
    const crossB = dual.crossExamine({ self: b, other: a, round: "FINAL" });
    expect(crossA.verdict).toBe("CHALLENGE");
    expect(crossA.survivesChallenge).toBe(false);
    const synthesis = dual.dualSynthesis({ a, b, crossA, crossB, comparison: { horizonConflict: true } });
    expect(synthesis.action).toBe("WAIT");
    expect(synthesis.reason).toMatch(/CONFLITO|HORIZON/);
  });

  it("acordo mutuo com sobrevivencia gera candidato; A BUY + B neutro permanece candidato", () => {
    const agreed = dual.dualSynthesis({ a: thesis("A", "BULLISH", "BUY"), b: thesis("B", "BULLISH", "BUY"), crossA: { survivesChallenge: true }, crossB: { survivesChallenge: true }, comparison: {} });
    expect(agreed.action).toBe("BUY");
    const neutralB = dual.dualSynthesis({ a: thesis("A", "BULLISH", "BUY"), b: thesis("B", "NEUTRAL", "WAIT"), crossA: { survivesChallenge: true }, crossB: { survivesChallenge: true }, comparison: {} });
    expect(neutralB.action).toBe("BUY");
    expect(neutralB.reason).toBe("A_COM_B_NEUTRO");
  });

  it("B com evidencia short-horizon contra forte bloqueia A (WAIT)", () => {
    const a = thesis("A", "BULLISH", "BUY");
    const b = thesis("B", "BEARISH", "WAIT", { evidenceFor: ["m1"], evidenceAgainst: ["c1", "c2", "c3", "c4"] });
    const synthesis = dual.dualSynthesis({ a, b, crossA: { survivesChallenge: true }, crossB: { survivesChallenge: true }, comparison: {} });
    expect(synthesis.action).toBe("WAIT");
    expect(synthesis.reason).toBe("SHORT_HORIZON_CONTRA_FORTE");
  });

  it("final nao injeta dados futuros e nao altera snapshots anteriores", () => {
    const engine = new dual.DualReasoningEngine({});
    const t0 = t0Up();
    const observation = engine.observeRound1({ t0, candidate: { candidateId: "cand-3", targetEntryAt: 1, targetExpiryAt: 2 }, g2Action: "BUY" });
    const r1 = JSON.stringify(observation.rounds.R1);
    engine.finalize({ observationId: observation.id, t0: t0Up(), candidate: { targetEntryAt: 1, targetExpiryAt: 2 } });
    expect(JSON.stringify(observation.rounds.R1)).toBe(r1);
    expect(hub.findFutureReferences(observation.rounds.FINAL, t0.times.availableAt)).toEqual([]);
  });

  it("SHADOW nunca executa: policy e observacao sem ordem", () => {
    const engine = new dual.DualReasoningEngine({});
    const observation = engine.observeRound1({ t0: t0Up(), candidate: { candidateId: "cand-4", targetEntryAt: 1, targetExpiryAt: 2 }, g2Action: "BUY" });
    engine.finalize({ observationId: observation.id, t0: t0Up(), candidate: { targetEntryAt: 1, targetExpiryAt: 2 } });
    expect(dual.DUAL_POLICY.controlsExecution).toBe(false);
    expect(dual.DUAL_POLICY.sendsOrders).toBe(false);
    expect(observation).not.toHaveProperty("brokerOrderId");
    expect(observation).not.toHaveProperty("executionId");
    expect(engine.status().sendsOrders).toBe(false);
  });

  it("latencia e medida por fase e no total", () => {
    const engine = new dual.DualReasoningEngine({});
    const observation = engine.observeRound1({ t0: t0Up(), candidate: { candidateId: "cand-5", targetEntryAt: 1, targetExpiryAt: 2 } });
    engine.finalize({ observationId: observation.id, t0: t0Up(), candidate: { targetEntryAt: 1, targetExpiryAt: 2 } });
    const status = engine.status();
    expect(status.latencyMs.total.count).toBeGreaterThan(0);
    expect(status.latencyMs.agentA.count).toBeGreaterThan(0);
    expect(status.latencyMs.synthesis.count).toBeGreaterThan(0);
    expect(observation.latency.totalReasoningMs).toBeGreaterThanOrEqual(0);
  });

  it("settlement causal e idempotente e nunca BROKER_EXECUTED", () => {
    const engine = new dual.DualReasoningEngine({});
    const t0 = t0Up();
    const observation = engine.observeRound1({ t0, candidate: { candidateId: "cand-6", targetEntryAt: t0.times.decisionAt - 2_000, targetExpiryAt: t0.times.decisionAt + 58_000, payout: 0.87 } });
    engine.finalize({ observationId: observation.id, t0, candidate: { targetEntryAt: t0.times.decisionAt - 2_000, targetExpiryAt: t0.times.decisionAt + 58_000, payout: 0.87 } });
    if (observation.direction !== "BUY" && observation.direction !== "SELL") return; // WAIT nao liquida
    const candles = [];
    for (let index = 0; index < 60; index += 1) { const bucketStart = t0.times.decisionAt - 30_000 + index * 5_000; candles.push({ bucketStart, bucketEnd: bucketStart + 5_000, open: 1.1, high: 1.101, low: 1.099, close: 1.1005 }); }
    engine.settleCausal({ marketKey: observation.marketKey, candles, index: candles.length - 1, nowMs: t0.times.decisionAt + 200_000 });
    const first = JSON.stringify(observation.outcome);
    engine.settleCausal({ marketKey: observation.marketKey, candles, index: candles.length - 1, nowMs: t0.times.decisionAt + 300_000 });
    expect(JSON.stringify(observation.outcome)).toBe(first);
    expect(observation.settlementBasis).toBe("CAUSAL_COUNTERFACTUAL");
    expect(observation.outcome.settlementBasis).not.toBe("BROKER_EXECUTED");
  });

  it("associacao e deterministica por candidateId (restart seguro) e range nao quebra", () => {
    const engine = new dual.DualReasoningEngine({});
    const t0 = buildEnrichedT0({ candles: rangeCandles() }).t0;
    const observation = engine.observeRound1({ t0, candidate: { candidateId: "cand-7", targetEntryAt: 1, targetExpiryAt: 2 } });
    expect(observation.id).toBe(`dual:${t0.market.marketKey}:cand-7`);
    expect(engine.observeRound1({ t0, candidate: { candidateId: "cand-7", targetEntryAt: 1, targetExpiryAt: 2 } }).id).toBe(observation.id);
  });

  it("freeze manifest declara ausencia de tuning e de execucao", () => {
    const manifest = dual.dualFreezeManifest();
    expect(manifest.noTuning).toBe(true);
    expect(manifest.policy.controlsExecution).toBe(false);
    expect(manifest.policy.mode).toBe("SHADOW_ONLY");
    expect(manifest.rules.conflict).toContain("WAIT");
  });
});

