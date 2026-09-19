/**
 * RSI_REVERSAL_V4 — testes do decision core (fresh critics + counterexamples).
 * Nenhum teste aqui usa outcome futuro para decidir: o core e puro.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../../relay/rsi-v4.mjs");
// @ts-expect-error - relay ESM sem tipagem
const v3 = await import("../../relay/rsi-v3.mjs");

const { V4_ID, RSI_V4_POLICY, detectV4, updateEpisodeV4, bollingerReversalV4, dmiAdxV4, counterEvidenceV4, cushionV4, evaluateV4Decision, buildV4TradePackage: _pkg, rsiV4FreezeManifest } = v4;

const T = 1_800_000_000_000;

const ind = (overrides: any = {}) => ({
  at: T, rsi: 50, rsiPrevious: 50, rsiSlope: 0, rsiBand: "NEUTRAL", closedCandles: 120,
  bollinger: { upper: 1.2, middle: 1.1, lower: 1.0, width: 0.2, widthSlope: 0, expanding: false, position: 0.5, close: 1.1, touchUpper: false, touchLower: false, outsideUpper: false, outsideLower: false },
  dmi: { plusDI: 22, minusDI: 20, spread: 2, spreadSlope: 0, plusSlope: 0, minusSlope: 0 },
  adx: { value: 22, slope: 0, rising: false, falling: false, stabilizing: true, strong: false },
  atr: 0.001, structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", shortMomentum: 0,
  velocity: 0, acceleration: 0, noisePerCandle: 0.001, noiseHorizon: 0.00346, realizedVolatility: 0.001,
  bandRiding: { upper: false, lower: false }, strongContinuation: { upper: false, lower: false },
  dominantDI: "BALANCED", rejectionUpperNow: false, rejectionLowerNow: false,
  ...overrides,
});

/** Snapshot CURRENT-STATE favoravel para BUY (nada de memoria historica). */
const buyReady = (overrides: any = {}) => ind({
  rsi: 34, rsiSlope: 1.2, bollinger: { ...ind().bollinger, position: 0.6, close: 1.02, lower: 1.0, middle: 1.1, touchLower: true, outsideLower: false },
  dmi: { plusDI: 26, minusDI: 24, spread: 2, spreadSlope: 2, plusSlope: 1.4, minusSlope: -1.2 },
  adx: { value: 24, slope: -0.6, rising: false, falling: true, stabilizing: false, strong: false },
  shortHorizonDirection: "BULLISH", shortMomentum: 0.8, velocity: 0.6, rejectionLowerNow: true,
  ...overrides,
});
const sellReady = (overrides: any = {}) => ind({
  rsi: 66, rsiSlope: -1.2, bollinger: { ...ind().bollinger, position: 0.4, close: 1.18, upper: 1.2, middle: 1.1, touchUpper: true, outsideUpper: false },
  dmi: { plusDI: 24, minusDI: 26, spread: -2, spreadSlope: -2, plusSlope: -1.2, minusSlope: 1.4 },
  adx: { value: 24, slope: -0.6, rising: false, falling: true, stabilizing: false, strong: false },
  shortHorizonDirection: "BEARISH", shortMomentum: -0.8, velocity: -0.6, rejectionUpperNow: true,
  ...overrides,
});

const episodeBuy = () => ({ direction: "BUY", candidateAt: T - 60_000, candidateRsi: 24, candidatePrice: 0.99, candidateReason: "RSI_EXTREME_BUY_30", touchedLower: true, touchedUpper: false, minPrice: 0.99, maxPrice: 1.01 });
const episodeSell = () => ({ direction: "SELL", candidateAt: T - 60_000, candidateRsi: 76, candidatePrice: 1.21, candidateReason: "RSI_EXTREME_SELL_70", touchedLower: false, touchedUpper: true, minPrice: 1.19, maxPrice: 1.21 });

describe("RSI V4 — DETECT", () => {
  it("RSI extremo cria candidate; RSI sozinho nunca autoriza", () => {
    expect(detectV4({ indicators: ind({ rsi: 28 }) }).direction).toBe("BUY");
    expect(detectV4({ indicators: ind({ rsi: 72 }) }).direction).toBe("SELL");
    expect(detectV4({ indicators: ind({ rsi: 50 }) }).direction).toBeNull();
    const fresh = updateEpisodeV4({ episode: null, indicators: ind({ rsi: 28, bollinger: { ...ind().bollinger, position: 0.05, touchLower: true } }), at: T });
    expect(fresh.event).toBe("CANDIDATE_CREATED");
    const decision = evaluateV4Decision({ indicators: ind({ rsi: 28 }), episode: fresh.episode });
    expect(decision.accepted).toBe(false);
  });
});

describe("RSI V4 — WATCH continuity", () => {
  it("normalizou completamente => CANCEL; oposto extremo => FLIP; idade => EXPIRE", () => {
    const ended = updateEpisodeV4({ episode: episodeBuy(), indicators: ind({ rsi: 60, bollinger: { ...ind().bollinger, close: 1.12, middle: 1.1 } }), at: T });
    expect(ended.event).toBe("CANDIDATE_ENDED_NORMALIZED");
    expect(ended.episode).toBeNull();
    const flipped = updateEpisodeV4({ episode: episodeBuy(), indicators: ind({ rsi: 75 }), at: T });
    expect(flipped.event).toBe("CANDIDATE_FLIPPED");
    expect(flipped.episode.direction).toBe("SELL");
    const expired = updateEpisodeV4({ episode: episodeBuy(), indicators: ind({ rsi: 40 }), at: T + RSI_V4_POLICY.candidateMaxAgeMs + 5_000 });
    expect(expired.event).toBe("CANDIDATE_EXPIRED_AGE");
  });
});

describe("RSI V4 — CONFIRM: Bollinger / DMI / ADX", () => {
  it("Bollinger: rejeicao ATUAL passa; band riding contra bloqueia; fora da banda bloqueia", () => {
    const ok = bollingerReversalV4({ indicators: buyReady(), direction: "BUY", episode: episodeBuy() });
    expect(ok.ok).toBe(true);
    const riding = bollingerReversalV4({ indicators: buyReady({ bandRiding: { upper: false, lower: true } }), direction: "BUY", episode: episodeBuy() });
    expect(riding.ok).toBe(false);
    expect(riding.reasonCodes).toContain("BAND_RIDING");
    const outside = bollingerReversalV4({ indicators: buyReady({ bollinger: { ...ind().bollinger, outsideLower: true, touchLower: true, position: 0.02 } }), direction: "BUY", episode: episodeBuy() });
    expect(outside.ok).toBe(false);
    expect(outside.reasonCodes).toContain("PRECO_FORA_DA_BANDA");
  });

  it("ADX caindo NAO confirma sozinho (exige DI novo reagindo); ADX subindo com DI antigo dominante bloqueia", () => {
    const oldStillDominant = dmiAdxV4({ indicators: buyReady({ dmi: { plusDI: 20, minusDI: 30, spread: -10, plusSlope: 0.2, minusSlope: 0.3 }, adx: { value: 30, slope: 0.8, rising: true, strong: true } }), direction: "BUY" });
    expect(oldStillDominant.ok).toBe(false);
    expect(oldStillDominant.reasonCodes).toContain("ADX_SUPORTANDO_ANTIGA");
    const adxFallingOnly = dmiAdxV4({ indicators: buyReady({ dmi: { plusDI: 20, minusDI: 30, spread: -10, plusSlope: -0.5, minusSlope: -0.8 }, adx: { value: 30, slope: -1.2, falling: true } }), direction: "BUY" });
    expect(adxFallingOnly.ok).toBe(false);
    expect(adxFallingOnly.checks.adxSupportingOld).toBe(false);
    const strong = dmiAdxV4({ indicators: buyReady({ dmi: { plusDI: 30, minusDI: 20, spread: 10, plusSlope: 0.8, minusSlope: -0.8 }, adx: { value: 26, slope: 0.2, stabilizing: true } }), direction: "BUY" });
    expect(strong.ok).toBe(true);
    expect(strong.checks.strongConfirmation).toBe(true);
  });
});

describe("RSI V4 — counterEvidence HARD/SOFT", () => {
  it("classifica contradicoes e bloqueia qualquer HARD", () => {
    const base = evaluateV4Decision({ indicators: buyReady(), episode: episodeBuy() });
    expect(base.accepted).toBe(true);
    expect(base.counterEvidence.filter((row: any) => row.severity === "HARD")).toHaveLength(0);
    const oldDominant = evaluateV4Decision({ indicators: buyReady({ dmi: { plusDI: 20, minusDI: 30, spread: -10, plusSlope: 0.2, minusSlope: 0.3 }, adx: { value: 30, slope: 0.9, rising: true } }), episode: episodeBuy() });
    expect(oldDominant.accepted).toBe(false);
    expect(oldDominant.counterEvidence.some((row: any) => row.code === "ADX_SUPPORTING_OLD_DIRECTION" && row.severity === "HARD")).toBe(true);
    const opposite = evaluateV4Decision({ indicators: buyReady({ shortHorizonDirection: "BEARISH", shortMomentum: -1.2, velocity: -0.9 }), episode: episodeBuy() });
    expect(opposite.accepted).toBe(false);
    expect(opposite.counterEvidence.some((row: any) => row.code === "MOMENTUM_AGAINST" && row.severity === "HARD")).toBe(true);
    const invalidated = evaluateV4Decision({ indicators: buyReady({ bollinger: { ...ind().bollinger, close: 0.98, middle: 1.1, position: 0.2 }, noiseHorizon: 0.01 }), episode: episodeBuy() });
    expect(invalidated.accepted).toBe(false);
    expect(invalidated.counterEvidence.some((row: any) => row.code === "PRICE_STRUCTURE_INVALIDATED" && row.severity === "HARD")).toBe(true);
    const soft = evaluateV4Decision({ indicators: buyReady({ rsi: 34, rsiSlope: -0.9 }), episode: episodeBuy() });
    expect(soft.counterEvidence.some((row: any) => row.code === "RSI_REACCELERATING_AGAINST" && row.severity === "SOFT")).toBe(true);
  });

  it("hardBlocksChecked e entryReason presentes e auditaveis", () => {
    const decision = evaluateV4Decision({ indicators: buyReady(), episode: episodeBuy() });
    expect(decision.hardBlocksChecked).toContain("OLD_DI_STILL_DOMINANT");
    expect(decision.hardBlocksChecked).toContain("CUSHION_TOO_SMALL");
    expect(decision.entryReason.length).toBeGreaterThan(0);
  });
});

describe("RSI V4 — cushion e principio current-state", () => {
  it("cushion FRAGILE => WAIT; NORMAL/STRONG => liberam", () => {
    const fragile = cushionV4({ indicators: buyReady({ noiseHorizon: 0.5, atr: 0.5, shortMomentum: 0.05, velocity: 0.05 }), direction: "BUY", entryPrice: 1.02 });
    expect(fragile.class).toBe("FRAGILE");
    expect(evaluateV4Decision({ indicators: buyReady({ noiseHorizon: 0.5, atr: 0.5, shortMomentum: 0.05, velocity: 0.05 }), episode: episodeBuy() }).accepted).toBe(false);
    const ok = cushionV4({ indicators: buyReady(), direction: "BUY", entryPrice: 1.02 });
    expect(["NORMAL", "STRONG"]).toContain(ok.class);
  });

  it("passado bom NAO autoriza presente ruim (current state > historical memory)", () => {
    const badCurrent = ind({ rsi: 52, rsiSlope: -1.0, bollinger: { ...ind().bollinger, position: 0.5, close: 1.1, touchLower: true }, dmi: { plusDI: 18, minusDI: 30, spread: -12, plusSlope: -0.6, minusSlope: 0.5 }, adx: { value: 32, slope: 0.9, rising: true }, shortHorizonDirection: "BEARISH", shortMomentum: -0.9 });
    const decision = evaluateV4Decision({ indicators: badCurrent, episode: episodeBuy() });
    expect(decision.accepted).toBe(false);
    // o mesmo episodio (passado "bom") com o presente bom entra:
    expect(evaluateV4Decision({ indicators: buyReady(), episode: episodeBuy() }).accepted).toBe(true);
  });

  it("SELL espelhado funciona", () => {
    const decision = evaluateV4Decision({ indicators: sellReady(), episode: episodeSell() });
    expect(decision.accepted).toBe(true);
    expect(decision.direction).toBe("SELL");
  });
});

describe("RSI V4 — complexity budget e freeze", () => {
  it("V4 e estritamente mais simples que V3.1 (thresholds, hard blockers e decision core)", () => {
    const v4PolicyKeys = Object.keys(RSI_V4_POLICY).length;
    const v3PolicyKeys = Object.keys(v3.RSI_V3_POLICY).length;
    expect(v4PolicyKeys).toBeLessThan(v3PolicyKeys);
    const manifest = rsiV4FreezeManifest();
    expect(manifest.hardCounterEvidence.length).toBeLessThanOrEqual(7);
    const v4Source = readFileSync(new URL("../../relay/rsi-v4.mjs", import.meta.url), "utf8");
    const v3Source = readFileSync(new URL("../../relay/rsi-v3.mjs", import.meta.url), "utf8");
    const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
    const v4Core = count(v4Source, /function (detectV4|updateEpisodeV4|bollingerReversalV4|dmiAdxV4|counterEvidenceV4|cushionV4|evaluateV4Decision)/g);
    const v3Core = count(v3Source, /function (createEpisodeV3|updateEpisodeV3|evaluateStageV3|rejectionValidityV3|diCrossValidityV3|projectExpiryV3|firstSightThesisV3|evaluateV3Entry)/g);
    expect(v4Core).toBeLessThan(v3Core);
    expect(V4_ID).toBe("RSI_REVERSAL_V4");
    expect(RSI_V4_POLICY.practiceOnly).toBe(true);
    expect(RSI_V4_POLICY.realLocked).toBe(true);
    expect(RSI_V4_POLICY.stakeBrl).toBe(10);
  });
});
