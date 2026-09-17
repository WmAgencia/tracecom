/** Fase 5 — Trader + Critic + Consensus: tabela conservadora, sem vies de concordancia, sem recálculo de indicadores. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const pair = await import("../../relay/agent-pair.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const frozen = await import("../../relay/frozen-strategies.mjs");
const { traderDecision, criticAssessment, consensusDecision, detectRegime, structuralBias } = pair as unknown as Record<string, any>;
const { computeFrozenFeatures, FROZEN_VARIANTS } = frozen as unknown as Record<string, any>;

const base = 1_700_000_000_000;
function makeCandles(count = 80, mutate: (index: number) => number = () => 0) {
  return Array.from({ length: count }, (_, index) => {
    const close = 1.1 + index * 0.00002 + mutate(index);
    return { start: base + index * 5_000, bucketStart: base + index * 5_000, open: close - 0.00001, high: close + 0.00002, low: close - 0.00002, close };
  });
}
const context = (features: any) => ({ deterministicIndicators: { rsi14: { value: features?.rsi14 ?? null }, adx14: { value: 22 }, diSpread: { value: 8 }, atrNormalized: { value: 0.0004 }, donchianPosition: { value: 0.5 } }, microstructure: { streak: 1 } });
const selection = { family: "V3", horizonSeconds: 60, variantId: "V3-60" };
const freshness = { fresh: true, reason: "OK", tickAgeMs: 200 };
const intelligence = { macro: null, news: null, experimental: false };

describe("AGENT PAIR — Trader/Critic/Consensus", () => {
  it("Trader nao recalcula indicadores: ecoa exatamente os valores do Feature Engine", () => {
    const candles = makeCandles();
    const features = computeFrozenFeatures(candles, candles.length - 1);
    const ctx = context(features);
    const trader = traderDecision({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", selection, features, context: ctx, payout: 85, freshness, intelligence, versions: {} });
    expect(trader.trigger.rsi14).toBe(features.rsi14);
    expect(trader.estimatedWinProbability).toBeNull();
    expect(trader.source).toBe("DETERMINISTIC_FROZEN");
    expect(["BUY", "SELL", "WAIT"]).toContain(trader.action);
  });
  it("tabela de consenso conservadora (deterministica)", () => {
    const trader = (action: string, confidence = 0.5) => ({ action, analysisConfidence: confidence, estimatedWinProbability: null });
    const critic = (independentAction: string, verdict: string) => ({ independentAction, traderAssessment: verdict, finalRecommendation: verdict === "CONFIRM" ? independentAction : "WAIT", estimatedWinProbability: null });
    expect(consensusDecision({ trader: trader("BUY"), critic: critic("BUY", "CONFIRM"), freshness, intelligence }).action).toBe("BUY");
    expect(consensusDecision({ trader: trader("SELL"), critic: critic("SELL", "CONFIRM"), freshness, intelligence }).action).toBe("SELL");
    expect(consensusDecision({ trader: trader("BUY"), critic: critic("WAIT", "CONFIRM"), freshness, intelligence }).action).toBe("WAIT");
    expect(consensusDecision({ trader: trader("BUY"), critic: critic("SELL", "CONTEST"), freshness, intelligence }).action).toBe("WAIT");
    expect(consensusDecision({ trader: trader("BUY"), critic: critic("BUY", "VETO"), freshness, intelligence }).status).toBe("VETOED");
    expect(consensusDecision({ trader: trader("BUY"), critic: critic("BUY", "CONFIRM"), freshness: { fresh: false, reason: "STALE_ANALYSIS" }, intelligence }).action).toBe("WAIT");
    const out = consensusDecision({ trader: trader("BUY"), critic: critic("BUY", "CONFIRM"), freshness, intelligence });
    expect(out.estimatedWinProbability).toBeNull();
    expect(out.analysisConfidence).toBeLessThanOrEqual(0.5);
  });
  it("Critic avalia independente ANTES de ver o Trader e pode CONTESTAR/VETAR", () => {
    const candles = makeCandles();
    const features = computeFrozenFeatures(candles, candles.length - 1);
    const ctx = context(features);
    const trader = traderDecision({ marketKey: "EURUSD:OTC", marketType: "OTC", selection, features, context: ctx, payout: 65, freshness, intelligence });
    const critic = criticAssessment({ marketKey: "EURUSD:OTC", marketType: "OTC", selection, features, context: ctx, payout: 65, freshness, intelligence, trader });
    expect(critic.independentAction).toBeDefined();
    expect(critic.traderAssessment).toBeDefined();
    expect(critic.riskFlags.some((flag: string) => flag.startsWith("payout_insuficiente"))).toBe(true);
    expect(critic.traderAssessment).toBe("VETO");
    const consensus = consensusDecision({ trader, critic, freshness, intelligence });
    expect(consensus.action).toBe("WAIT");
    expect(consensus.status).toBe("VETOED");
  });
  it("regime e vies estrutural derivam do contexto deterministico", () => {
    expect(detectRegime({ features: null, context: { deterministicIndicators: { adx14: { value: 30 }, atrNormalized: { value: 0.0005 } } } })).toBe("TRENDING");
    expect(structuralBias({ context: { deterministicIndicators: { donchianPosition: { value: 0.9 } }, microstructure: { streak: 3 } } })).toMatchObject({ channelBias: "UP", streakBias: "UP" });
  });
});
