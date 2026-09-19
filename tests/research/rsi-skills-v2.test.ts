/**
 * RSI SKILLS V2 — regression tests das regras STRICT V2 / PULLBACK V2.
 *
 * Casos de referencia (NAO overfit): AUDCAD (STRICT WIN), AUDUSD (STRICT cedo demais),
 * CADCHF (PULLBACK contra continuacao), CADJPY (PULLBACK cedo demais), EURAUD (PULLBACK WIN).
 * RSI e SOMENTE detector: candidate sempre nasce em extremo (<=30 / >=70).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const skills = await import("../../relay/rsi-skills-v2.mjs");

const { STRICT_V2_ID, PULLBACK_V2_ID, evaluateV2, createEpisodeV2, updateEpisodeV2 } = skills;
const NOW = 1_800_000_000_000;

const indicators = (overrides: any = {}) => ({
  status: "NO_OPPORTUNITY", reason: "OK", closedCandles: 120, at: NOW,
  rsi: 50, rsiPrevious: 50, rsiSlope: 0, rsiBand: "NEUTRAL",
  bollinger: { upper: 1.2, middle: 1.1, lower: 1.0, width: 0.2, widthSlope: 0, expanding: false, position: 0.5, close: 1.1, touchUpper: false, touchLower: false, outsideUpper: false, outsideLower: false },
  dmi: { plusDI: 22, minusDI: 20, spread: 2, plusSlope: 0, minusSlope: 0 },
  adx: { value: 22, slope: 0, rising: false, strong: false },
  structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", shortMomentum: 0,
  bandRiding: { upper: false, lower: false }, dominantDI: "BALANCED", strongContinuation: { upper: false, lower: false },
  ...overrides,
});

/** Episodio SELL nascido em RSI extremo alto. */
const sellEpisode = (overrides: any = {}) => ({
  direction: "SELL", candidateAt: NOW - 20_000, candidateRsi: 78, candidateRsiBand: "SELL 70-80",
  candidateIndicators: null, candidateSpread: 12, candidatePlusDI: 32, candidateMinusDI: 20,
  minRsi: 70, maxRsi: 78,
  touchedUpper: true, touchedLower: false, outsideUpper: true, outsideLower: false,
  reenteredUpper: true, reenteredLower: false,
  maxPlusDI: 34, minPlusDI: 28, maxMinusDI: 22, minMinusDI: 16, maxSpread: 14, minSpread: 2,
  oppositeReactionStreak: 2, lastAt: NOW - 5_000,
  ...overrides,
});

/** Episodio BUY nascido em RSI extremo baixo. */
const buyEpisode = (overrides: any = {}) => ({
  direction: "BUY", candidateAt: NOW - 20_000, candidateRsi: 24, candidateRsiBand: "BUY 20-30",
  candidateIndicators: null, candidateSpread: -12, candidatePlusDI: 18, candidateMinusDI: 30,
  minRsi: 22, maxRsi: 30,
  touchedUpper: false, touchedLower: true, outsideUpper: false, outsideLower: true,
  reenteredUpper: false, reenteredLower: true,
  maxPlusDI: 22, minPlusDI: 14, maxMinusDI: 34, minMinusDI: 24, maxSpread: -2, minSpread: -14,
  oppositeReactionStreak: 2, lastAt: NOW - 5_000,
  ...overrides,
});

describe("RSI SKILLS V2 — candidate/RSI detector", () => {
  it("RSI neutro nunca cria candidate (STRICT e PULLBACK)", () => {
    const neutro = indicators({ rsi: 50 });
    expect(updateEpisodeV2({ episode: null, indicators: neutro, at: NOW }).episode).toBeNull();
    expect(evaluateV2({ strategy: STRICT_V2_ID, indicators: neutro, episode: null }).status).toBe("NO_CANDIDATE");
    expect(evaluateV2({ strategy: PULLBACK_V2_ID, indicators: neutro, episode: null }).status).toBe("NO_CANDIDATE");
    expect(evaluateV2({ strategy: STRICT_V2_ID, indicators: neutro, episode: null }).decision).toBe("WAIT");
  });

  it("candidate nasce em RSI extremo e registra candidateAt/RSI do extremo", () => {
    const created = updateEpisodeV2({ episode: null, indicators: indicators({ rsi: 27.5, status: "BUY_EXTREME" }), at: NOW });
    expect(created.event).toBe("CANDIDATE_CREATED");
    expect(created.episode.direction).toBe("BUY");
    expect(created.episode.candidateRsi).toBe(27.5);
    expect(created.episode.candidateAt).toBe(NOW);
    const createdSell = createEpisodeV2({ indicators: indicators({ rsi: 74.2 }), at: NOW });
    expect(createdSell.direction).toBe("SELL");
    expect(createdSell.candidateRsi).toBe(74.2);
  });

  it("RSI pode sair do extremo antes do submit sem perder o episodio; candidateAt/RSI permanecem os do extremo", () => {
    const first = updateEpisodeV2({ episode: null, indicators: indicators({ rsi: 28.4 }), at: NOW });
    const second = updateEpisodeV2({ episode: first.episode, indicators: indicators({ rsi: 34.1 }), at: NOW + 20_000 });
    expect(second.event).toBe("CANDIDATE_UPDATED");
    expect(second.episode.candidateAt).toBe(NOW);
    expect(second.episode.candidateRsi).toBe(28.4);
    expect(second.episode.direction).toBe("BUY");
  });

  it("RSI neutro NAO vira candidate retroativo (novo episodio so em novo extremo)", () => {
    const first = updateEpisodeV2({ episode: null, indicators: indicators({ rsi: 28.4 }), at: NOW });
    const expired = updateEpisodeV2({ episode: first.episode, indicators: indicators({ rsi: 50 }), at: NOW + 10_000 });
    expect(expired.episode).toBeNull();
    expect(expired.event).toBe("EPISODE_EXPIRED_NEUTRAL");
    const fresh = updateEpisodeV2({ episode: null, indicators: indicators({ rsi: 29.1 }), at: NOW + 30_000 });
    expect(fresh.episode.candidateAt).toBe(NOW + 30_000);
  });
});

describe("RSI SKILLS V2 — STRICT V2", () => {
  it("RSI extremo + Bollinger sem DMI/ADX suficiente => WAIT", () => {
    const out = evaluateV2({
      strategy: STRICT_V2_ID,
      indicators: indicators({ rsi: 73, rsiSlope: -0.4, bollinger: { ...indicators().bollinger, position: 0.92, touchUpper: true, outsideUpper: false, close: 1.18 }, dmi: { plusDI: 30, minusDI: 22, spread: 8, plusSlope: 0.4, minusSlope: -0.1 }, adx: { value: 28, slope: 0.6, rising: true, strong: true } }),
      episode: sellEpisode({ maxSpread: 8 }),
    });
    expect(out.decision).toBe("WAIT");
    expect(out.accepted).toBe(false);
    expect(out.blockers).toContain("DI_ANTIGO_NAO_ENFRAQUECEU");
    expect(out.blockers).toContain("DI_OPOSTO_SEM_REACAO");
  });

  it("strong continuation (band riding + DI dominante + ADX subindo) => WAIT", () => {
    const out = evaluateV2({
      strategy: STRICT_V2_ID,
      indicators: indicators({ rsi: 74, rsiSlope: -0.2, bollinger: { ...indicators().bollinger, position: 0.95, touchUpper: true, close: 1.19 }, dmi: { plusDI: 34, minusDI: 20, spread: 14, plusSlope: 0.5, minusSlope: -0.2 }, adx: { value: 30, slope: 0.7, rising: true, strong: true }, bandRiding: { upper: true, lower: false }, dominantDI: "PLUS", strongContinuation: { upper: true, lower: false } }),
      episode: sellEpisode(),
    });
    expect(out.decision).toBe("WAIT");
    expect(out.blockers).toContain("CONTINUACAO_FORTE_BAND_RIDING");
  });

  it("DI antigo enfraquece mas o oposto NAO reage => WAIT (AUDUSD-like)", () => {
    const out = evaluateV2({
      strategy: STRICT_V2_ID,
      indicators: indicators({ rsi: 72, rsiSlope: -0.2, bollinger: { ...indicators().bollinger, position: 0.88, touchUpper: true, close: 1.17 }, dmi: { plusDI: 31, minusDI: 24, spread: 7, plusSlope: -0.6, minusSlope: -0.3 }, adx: { value: 26, slope: 0.3, rising: true, strong: true } }),
      episode: sellEpisode({ maxSpread: 7 }),
    });
    expect(out.decision).toBe("WAIT");
    expect(out.blockers).toContain("DI_OPOSTO_SEM_REACAO");
  });

  it("reversao completa (AUDCAD-like) => TRADE", () => {
    const out = evaluateV2({
      strategy: STRICT_V2_ID,
      indicators: indicators({ rsi: 66, rsiSlope: -1.4, bollinger: { ...indicators().bollinger, position: 0.72, touchUpper: true, close: 1.14 }, dmi: { plusDI: 26, minusDI: 27, spread: -1, plusSlope: -1.6, minusSlope: 1.8 }, adx: { value: 27, slope: -0.9, rising: false, strong: true }, structuralTrend: "BULLISH", shortHorizonDirection: "BEARISH" }),
      episode: sellEpisode(),
    });
    expect(out.decision).toBe("SELL");
    expect(out.accepted).toBe(true);
    expect(out.status).toBe("STRICT_CONFIRMED");
  });

  it("espelho BUY: reversao completa => TRADE; sem reacao oposta => WAIT", () => {
    const good = evaluateV2({
      strategy: STRICT_V2_ID,
      indicators: indicators({ rsi: 35, rsiSlope: 1.5, bollinger: { ...indicators().bollinger, position: 0.3, touchLower: true, close: 1.06 }, dmi: { plusDI: 27, minusDI: 26, spread: 1, plusSlope: 1.9, minusSlope: -1.7 }, adx: { value: 26, slope: -0.8, rising: false, strong: true }, structuralTrend: "BEARISH", shortHorizonDirection: "BULLISH" }),
      episode: buyEpisode(),
    });
    expect(good.decision).toBe("BUY");
    expect(good.accepted).toBe(true);
    const bad = evaluateV2({
      strategy: STRICT_V2_ID,
      indicators: indicators({ rsi: 29, rsiSlope: 0.1, bollinger: { ...indicators().bollinger, position: 0.08, touchLower: true, close: 1.01 }, dmi: { plusDI: 20, minusDI: 31, spread: -11, plusSlope: 0.2, minusSlope: -0.2 }, adx: { value: 30, slope: 0.5, rising: true, strong: true } }),
      episode: buyEpisode(),
    });
    expect(bad.decision).toBe("WAIT");
  });
});

describe("RSI SKILLS V2 — PULLBACK V2", () => {
  it("pullback curto valido mesmo com estrutura antiga bullish (EURAUD-like) => TRADE", () => {
    const out = evaluateV2({
      strategy: PULLBACK_V2_ID,
      indicators: indicators({ rsi: 68, rsiSlope: -1.3, bollinger: { ...indicators().bollinger, position: 0.7, touchUpper: true, close: 1.14 }, dmi: { plusDI: 28, minusDI: 25, spread: 3, plusSlope: -0.9, minusSlope: 0.9 }, adx: { value: 24, slope: -0.4, rising: false, strong: false }, structuralTrend: "BULLISH", shortHorizonDirection: "BEARISH" }),
      episode: sellEpisode(),
    });
    expect(out.decision).toBe("SELL");
    expect(out.accepted).toBe(true);
    expect(out.confirmations.structuralTrend).toBe("BULLISH");
    expect(out.confirmations.shortHorizonDirection).toBe("BEARISH");
  });

  it("band riding + DI dominante + ADX subindo => WAIT (bloqueio reforcado)", () => {
    const out = evaluateV2({
      strategy: PULLBACK_V2_ID,
      indicators: indicators({ rsi: 71, rsiSlope: -0.3, bollinger: { ...indicators().bollinger, position: 0.96, touchUpper: true, close: 1.19, expanding: true }, dmi: { plusDI: 34, minusDI: 21, spread: 13, plusSlope: 0.6, minusSlope: -0.1 }, adx: { value: 31, slope: 0.8, rising: true, strong: true }, structuralTrend: "BULLISH", shortHorizonDirection: "BEARISH", bandRiding: { upper: true, lower: false }, dominantDI: "PLUS" }),
      episode: sellEpisode(),
    });
    expect(out.decision).toBe("WAIT");
    expect(out.blockers).toContain("BAND_RIDING_DI_ADX_CONTRA");
  });

  it("CADCHF-like: band riding lower + -DI dominante + ADX subindo + bandas abrindo => NAO BUY", () => {
    const out = evaluateV2({
      strategy: PULLBACK_V2_ID,
      indicators: indicators({ rsi: 26, rsiSlope: 0.3, bollinger: { ...indicators().bollinger, position: 0.04, touchLower: true, close: 1.0, expanding: true }, dmi: { plusDI: 18, minusDI: 32, spread: -14, plusSlope: -0.2, minusSlope: 0.5 }, adx: { value: 33, slope: 0.9, rising: true, strong: true }, structuralTrend: "BEARISH", shortHorizonDirection: "BULLISH", bandRiding: { upper: false, lower: true }, dominantDI: "MINUS" }),
      episode: buyEpisode(),
    });
    expect(out.decision).toBe("WAIT");
    expect(out.blockers).toContain("BAND_RIDING_DI_ADX_CONTRA");
  });

  it("CADJPY-like: RSI cai mas momentum curto ainda nao virou => WAIT", () => {
    const out = evaluateV2({
      strategy: PULLBACK_V2_ID,
      indicators: indicators({ rsi: 71, rsiSlope: -0.5, bollinger: { ...indicators().bollinger, position: 0.85, touchUpper: true, close: 1.16 }, dmi: { plusDI: 27, minusDI: 24, spread: 3, plusSlope: -0.3, minusSlope: 0.2 }, adx: { value: 24, slope: 0.1, rising: false, strong: false }, structuralTrend: "BULLISH", shortHorizonDirection: "BULLISH" }),
      episode: sellEpisode(),
    });
    expect(out.decision).toBe("WAIT");
    expect(out.blockers).toContain("MOMENTUM_CURTO_NAO_REAGIU");
  });
});
