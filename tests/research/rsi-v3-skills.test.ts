/**
 * RSI_REVERSAL_PULLBACK_V3 — regression tests das REGRAS (skills).
 *
 * Casos observados (sinteticos, sem hardcode de preco/ativo):
 *  positivos: GBPNZD/USDBRL/NZDCAD/GBPCAD/EURGBP/BTCUSD (pullback claro com continuidade);
 *  frageis/negativos: CADCHF (win fino), USDCHF/AUDCAD/GBPJPY/USDTRY (loss curto),
 *  RSI 45-55 sem confirmacao, ADX apenas caindo sem nova direcao.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const v3 = await import("../../relay/rsi-v3.mjs");

const { V3_ID, evaluateIndicatorsV3, createEpisodeV3, updateEpisodeV3, evaluateStageV3, evaluateV3Entry, firstSightThesisV3, projectExpiryV3, classifyOutcomeV3, rsiBandV3, rejectionValidityV3, diCrossValidityV3 } = v3;
const NOW = 1_800_000_000_000;
const T = Math.ceil(NOW / 60_000) * 60_000;
const WINDOW = { purchaseCutoffAt: T - 30_000, entryWindowOpensAt: T - 35_000, entryWindowClosesAt: T - 27_000, safeMarginMs: 3000, windowMs: 2000 };

const ind = (overrides: any = {}) => ({
  status: "NO_OPPORTUNITY", reason: "OK", closedCandles: 120, at: NOW,
  rsi: 50, rsiPrevious: 50, rsiSlope: 0, rsiBand: "NEUTRAL",
  bollinger: { upper: 1.2, middle: 1.1, lower: 1.0, width: 0.2, widthSlope: 0, expanding: false, position: 0.5, close: 1.1, distanceToUpper: 0.1, distanceToLower: 0.1, touchUpper: false, touchLower: false, outsideUpper: false, outsideLower: false },
  dmi: { plusDI: 22, minusDI: 20, spread: 2, spreadSlope: 0, plusSlope: 0, minusSlope: 0 },
  adx: { value: 22, slope: 0, rising: false, falling: false, stabilizing: true, strong: false },
  atr: 0.001, structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", shortMomentum: 0,
  velocity: 0, acceleration: 0, candleAnatomy: { bodyRatio: 0.5, upperWick: 0.2, lowerWick: 0.3 },
  noisePerCandle: 0.001, noiseHorizon: 0.00346, realizedVolatility: 0.001,
  bandRiding: { upper: false, lower: false }, strongContinuation: { upper: false, lower: false },
  dominantDI: "BALANCED", rejectionUpperNow: false, rejectionLowerNow: false,
  ...overrides,
});

const sellEpisode = (overrides: any = {}) => ({
  ...(createEpisodeV3({ indicators: ind({ rsi: 78, rsiBand: "70-80", at: NOW - 20_000, bollinger: { ...ind().bollinger, position: 0.95, touchUpper: true, outsideUpper: true, close: 1.18 } }), at: NOW - 20_000, expiryAt: T }) ?? {}),
  ...overrides,
});
const buyEpisode = (overrides: any = {}) => ({
  ...(createEpisodeV3({ indicators: ind({ rsi: 24, rsiBand: "20-15", at: NOW - 20_000, bollinger: { ...ind().bollinger, position: 0.05, touchLower: true, outsideLower: true, close: 1.02 } }), at: NOW - 20_000, expiryAt: T }) ?? {}),
  ...overrides,
});

/** Episodio SELL com memoria causal V3.1 (rejeicao + DI cross recentes e validos). */
const sellEpisodeWithMemory = (overrides: any = {}) => sellEpisode({
  bollingerRejectionAt: T - 45_000, bollingerRejectionPrice: 1.17, bollingerRejectionDirection: "UPPER",
  bollingerReentryConfirmed: true, bollingerRejectionExtreme: 1.18,
  diCrossAt: T - 45_000, diCrossDirection: "SELL", newDirectionConfirmedAt: T - 45_000,
  ...overrides,
});
const buyEpisodeWithMemory = (overrides: any = {}) => buyEpisode({
  bollingerRejectionAt: T - 45_000, bollingerRejectionPrice: 1.03, bollingerRejectionDirection: "LOWER",
  bollingerReentryConfirmed: true, bollingerRejectionExtreme: 1.02,
  diCrossAt: T - 45_000, diCrossDirection: "BUY", newDirectionConfirmedAt: T - 45_000,
  ...overrides,
});

/** Estado de entrada valido EURAUD-like (SELL): RSI saindo, rejeicao upper, DI novo reagindo, ADX estabilizando. */
const sellReady = () => ind({
  at: T - 34_000, rsi: 64, rsiPrevious: 68, rsiSlope: -1.4, rsiBand: "NEUTRAL",
  bollinger: { ...ind().bollinger, position: 0.68, close: 1.14, touchUpper: true, outsideUpper: false, widthSlope: -0.002, expanding: false },
  dmi: { plusDI: 26, minusDI: 27, spread: -1, spreadSlope: -2, plusSlope: -1.6, minusSlope: 1.8 },
  adx: { value: 26, slope: -0.9, rising: false, falling: true, stabilizing: false, strong: true },
  shortMomentum: -0.9, shortHorizonDirection: "BEARISH", velocity: -0.5, acceleration: -0.2,
  structuralTrend: "BULLISH", rejectionUpperNow: true,
});

/** Espelho BUY GBPCAD-like. */
const buyReady = () => ind({
  at: T - 34_000, rsi: 36, rsiPrevious: 32, rsiSlope: 1.5, rsiBand: "NEUTRAL",
  bollinger: { ...ind().bollinger, position: 0.32, close: 1.06, touchLower: true, outsideLower: false, widthSlope: -0.002, expanding: false },
  dmi: { plusDI: 27, minusDI: 26, spread: 1, spreadSlope: 2, plusSlope: 1.9, minusSlope: -1.7 },
  adx: { value: 26, slope: -0.8, rising: false, falling: true, stabilizing: false, strong: true },
  shortMomentum: 0.9, shortHorizonDirection: "BULLISH", velocity: 0.5, acceleration: 0.2,
  structuralTrend: "BEARISH", rejectionLowerNow: true,
});

describe("RSI V3 — detector e candidate", () => {
  it("RSI neutro NUNCA cria candidate e nao existe candidate retroativo", () => {
    expect(createEpisodeV3({ indicators: ind({ rsi: 50 }), at: NOW, expiryAt: T })).toBeNull();
    const update = updateEpisodeV3({ episode: null, indicators: ind({ rsi: 52 }), at: NOW });
    expect(update.episode).toBeNull();
    expect(update.event).toBe("NO_CANDIDATE");
    expect(evaluateV3Entry({ indicators: ind({ rsi: 52 }), episode: null, window: WINDOW, at: NOW }).status).toBe("NO_CANDIDATE");
  });

  it("extremo cria candidate com candidateAt/candidateRsi/candidatePrice/candidateExpiry/candidateReason", () => {
    const episode = createEpisodeV3({ indicators: ind({ rsi: 14.5, rsiBand: "15-10", bollinger: { ...ind().bollinger, position: 0.03, close: 1.01 }, at: NOW }), at: NOW, expiryAt: T });
    expect(episode.direction).toBe("BUY");
    expect(episode.candidateAt).toBe(NOW);
    expect(episode.candidateRsi).toBe(14.5);
    expect(episode.candidatePrice).toBe(1.01);
    expect(episode.candidateExpiry).toBe(T);
    expect(episode.candidateReason).toContain("RSI_EXTREME_BUY_15-10");
    expect(episode.extreme).toBe(true);
    const band = rsiBandV3(9.5);
    expect(band).toBe("<=10");
    expect(rsiBandV3(87)).toBe("85-90");
  });

  it("candidate expira por idade (freshness)", () => {
    const episode = buyEpisode();
    const expired = updateEpisodeV3({ episode, indicators: ind({ rsi: 32, at: NOW + 9 * 60_000 }), at: NOW + 9 * 60_000 });
    expect(expired.episode).toBeNull();
    expect(expired.event).toBe("CANDIDATE_EXPIRED_AGE");
  });

  it("candidate perde continuidade quando RSI volta ao neutro e mercado lateraliza", () => {
    let episode = buyEpisode();
    let event = null;
    for (let index = 1; index <= 3; index += 1) {
      const result = updateEpisodeV3({ episode, indicators: ind({ rsi: 50, structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", velocity: 0, at: NOW + index * 6_000 }), at: NOW + index * 6_000 });
      episode = result.episode;
      event = result.event;
    }
    expect(episode).toBeNull();
    expect(event).toBe("CANDIDATE_CONTINUITY_LOST_LATERAL");
  });

  it("candidate muda de lado apenas quando nasce novo extremo oposto", () => {
    const episode = buyEpisode();
    const flipped = updateEpisodeV3({ episode, indicators: ind({ rsi: 88, at: NOW + 20_000 }), at: NOW + 20_000 });
    expect(flipped.event).toBe("CANDIDATE_FLIPPED");
    expect(flipped.episode.direction).toBe("SELL");
    expect(flipped.episode.candidateRsi).toBe(88);
  });
});

describe("RSI V3 — DMI/ADX em dois estagios", () => {
  it("ADX caindo sozinho NAO confirma reversao (old trend intacta)", () => {
    const stage = evaluateStageV3({ indicators: ind({ rsi: 60, dmi: { plusDI: 30, minusDI: 18, spread: 12, plusSlope: 0.3, minusSlope: 0 }, adx: { value: 35, slope: -1.2, falling: true } }), episode: sellEpisode() });
    expect(stage.stage).toBe("NONE");
    expect(stage.adxMeaning).toBe("INSUFFICIENT");
  });

  it("old DI enfraquecendo sem nova direcao => STAGE 1 e entrada WAIT", () => {
    const stage = evaluateStageV3({ indicators: ind({ rsi: 66, dmi: { plusDI: 28, minusDI: 21, spread: 7, plusSlope: -1.2, minusSlope: 0 }, adx: { value: 26, slope: -0.8, falling: true } }), episode: sellEpisode({ maxSpread: 12 }) });
    expect(stage.stage).toBe("OLD_TREND_WEAKENING");
    const entry = evaluateV3Entry({ indicators: ind({ at: T - 34_000, rsi: 66, rsiSlope: -0.5, bollinger: { ...ind().bollinger, position: 0.7, touchUpper: true }, dmi: { plusDI: 28, minusDI: 21, spread: 7, plusSlope: -1.2, minusSlope: 0 }, adx: { value: 26, slope: -0.8, falling: true }, shortMomentum: -0.6 }), episode: sellEpisode({ maxSpread: 12 }), window: WINDOW, at: T - 34_000 });
    expect(entry.decision).toBe("WAIT");
    expect(entry.blockers).toContain("NOVA_DIRECAO_AINDA_NAO_EMERGIU");
  });

  it("nova direcao emergindo => STAGE 2 e entrada valida (EURAUD-like)", () => {
    const stage = evaluateStageV3({ indicators: sellReady(), episode: sellEpisode({ maxSpread: 12 }) });
    expect(stage.stage).toBe("NEW_DIRECTION_EMERGING");
    expect(stage.strength).not.toBe("NONE");
    const entry = evaluateV3Entry({ indicators: sellReady(), episode: sellEpisode({ maxSpread: 12, maxPosition: 0.98 }), window: WINDOW, at: T - 34_000 });
    expect(entry.decision).toBe("SELL");
    expect(entry.accepted).toBe(true);
    expect(entry.entryMode).toBe("NORMAL_T5");
  });

  it("espelho BUY (GBPCAD-like) => entrada valida", () => {
    const entry = evaluateV3Entry({ indicators: buyReady(), episode: buyEpisode({ minSpread: -12, minPosition: 0.02 }), window: WINDOW, at: T - 34_000 });
    expect(entry.decision).toBe("BUY");
    expect(entry.accepted).toBe(true);
  });

  it("band riding contra a reversao bloqueia (CADCHF-like continuation)", () => {
    const entry = evaluateV3Entry({
      indicators: ind({ at: T - 34_000, rsi: 26, rsiSlope: 0.4, bollinger: { ...ind().bollinger, position: 0.04, touchLower: true, outsideLower: true, expanding: true }, dmi: { plusDI: 18, minusDI: 32, spread: -14, plusSlope: -0.2, minusSlope: 0.6 }, adx: { value: 33, slope: 0.9, rising: true, strong: true }, shortMomentum: 0.3, bandRiding: { upper: false, lower: true }, dominantDI: "MINUS" }),
      episode: buyEpisode({ minSpread: -2, maxSpread: -2 }),
      window: WINDOW, at: T - 34_000,
    });
    expect(entry.decision).toBe("WAIT");
    expect(entry.blockers).toContain("BAND_RIDING_AGAINST");
    expect(entry.status).toBe("V3_BLOCKED_STRONG_TREND");
  });
});

describe("RSI V3 — T-5 (primeira vista) e RSI neutro no submit", () => {
  it("T-5 invalida quando a nova direcao desapareceu (USDCHF/AUDCAD-like curto)", () => {
    const stale = ind({ at: T - 34_000, rsi: 58, rsiSlope: 0.3, bollinger: { ...ind().bollinger, position: 0.6, touchUpper: true, outsideUpper: false }, dmi: { plusDI: 29, minusDI: 22, spread: 7, plusSlope: 0.4, minusSlope: -0.1 }, adx: { value: 28, slope: 0.6, rising: true }, shortMomentum: -0.2, rejectionUpperNow: false });
    const thesis = firstSightThesisV3({ indicators: stale, direction: "SELL" });
    expect(thesis.valid).toBe(false);
    expect(thesis.hardFails.some((fail: string) => fail.startsWith("NOVA_DIRECAO") || fail === "SEM_REJEICAO_ATUAL")).toBe(true);
    const entry = evaluateV3Entry({ indicators: stale, episode: sellEpisode({ maxSpread: 14 }), window: WINDOW, at: T - 34_000 });
    expect(entry.decision).toBe("WAIT");
  });

  it("T-5 mantem valido quando a tese continua viva", () => {
    const thesis = firstSightThesisV3({ indicators: sellReady(), direction: "SELL" });
    expect(thesis.valid).toBe(true);
  });

  it("RSI neutro 45-55 no submit exige confirmacao forte + cushion forte", () => {
    const neutralWeak = ind({ at: T - 34_000, rsi: 49, rsiSlope: -0.2, bollinger: { ...ind().bollinger, position: 0.7, touchUpper: true }, dmi: { plusDI: 26, minusDI: 25, spread: 1, plusSlope: -0.5, minusSlope: 0.4 }, adx: { value: 24, slope: -0.2, falling: true, stabilizing: true }, shortMomentum: -0.5, rejectionUpperNow: true });
    const weak = evaluateV3Entry({ indicators: neutralWeak, episode: sellEpisodeWithMemory({ maxSpread: 10 }), window: WINDOW, at: T - 34_000 });
    expect(weak.decision).toBe("WAIT");
    expect(weak.blockers).toContain("RSI_NEUTRO_SEM_CONFIRMACAO_FORTE");
    const neutralStrong = ind({ at: T - 34_000, rsi: 48, rsiSlope: -1.2, bollinger: { ...ind().bollinger, position: 0.55, touchUpper: true }, dmi: { plusDI: 24, minusDI: 28, spread: -4, plusSlope: -1.8, minusSlope: 2.1 }, adx: { value: 27, slope: 0.7, rising: true, strong: true }, shortMomentum: -1.0, shortHorizonDirection: "BEARISH", velocity: -0.5, rejectionUpperNow: true });
    const strong = evaluateV3Entry({ indicators: neutralStrong, episode: sellEpisodeWithMemory({ maxSpread: 10 }), window: WINDOW, at: T - 34_000 });
    expect(strong.decision).toBe("SELL");
  });
});

describe("RSI V3 — projecao/cushion e qualidade", () => {
  it("projecao deterministica: ruido e zonas coerentes", () => {
    const projection = projectExpiryV3({ indicators: sellReady(), direction: "SELL", entryPrice: 1.14 });
    expect(projection.method).toBe("DETERMINISTIC_ATR_CONTINUATION_V1");
    expect(projection.expectedCushionNormalized).toBeGreaterThan(0);
    expect(projection.expectedExpiryZone.favorable).toBeLessThan(1.14);
    expect(projection.expectedExpiryZone.adverse).toBeGreaterThan(1.14);
    expect(projection.invalidationCondition).toContain("upper band");
  });

  it("cushion baixo => FRAGILE_ENTRY e WAIT; cushion forte => permite", () => {
    const fragile = ind({ at: T - 34_000, rsi: 64, rsiSlope: -1.4, bollinger: { ...ind().bollinger, position: 0.68, touchUpper: true }, dmi: { plusDI: 26, minusDI: 27, spread: -1, plusSlope: -1.6, minusSlope: 1.8 }, adx: { value: 26, slope: -0.9, falling: true }, shortMomentum: -0.03, rejectionUpperNow: true });
    const low = evaluateV3Entry({ indicators: fragile, episode: sellEpisode({ maxSpread: 12 }), window: WINDOW, at: T - 34_000 });
    expect(low.blockers).toContain("FRAGILE_ENTRY");
    expect(low.decision).toBe("WAIT");
    const strong = evaluateV3Entry({ indicators: sellReady(), episode: sellEpisode({ maxSpread: 12 }), window: WINDOW, at: T - 34_000 });
    expect(strong.decision).toBe("SELL");
    expect(strong.projection.expectedCushionNormalized).toBeGreaterThanOrEqual(relativeCushionMin());
  });

  it("qualityClass relativa ao ruido (STRONG/NORMAL/THIN)", () => {
    const strong = classifyOutcomeV3({ result: "WIN", entryPrice: 1.1, expiryPrice: 1.097, direction: "SELL", noiseHorizon: 0.003 });
    expect(strong.qualityClass).toBe("STRONG_WIN");
    const thin = classifyOutcomeV3({ result: "WIN", entryPrice: 1.1, expiryPrice: 1.0998, direction: "SELL", noiseHorizon: 0.003 });
    expect(thin.qualityClass).toBe("THIN_WIN");
    const normalLoss = classifyOutcomeV3({ result: "LOSS", entryPrice: 1.1, expiryPrice: 1.101, direction: "SELL", noiseHorizon: 0.003 });
    expect(normalLoss.qualityClass).toBe("NORMAL_LOSS");
    expect(classifyOutcomeV3({ result: "DRAW", entryPrice: 1.1, expiryPrice: 1.1, direction: "SELL", noiseHorizon: 0.003 }).qualityClass).toBe("DRAW");
  });
});

describe("RSI V3 — extreme reversal override", () => {
  const overrideIndicators = () => ind({
    at: T - 45_000, rsi: 89, rsiPrevious: 93, rsiSlope: -1.5, rsiBand: "85-90",
    bollinger: { ...ind().bollinger, position: 0.72, close: 1.16, touchUpper: true, outsideUpper: true, expanding: false },
    dmi: { plusDI: 24, minusDI: 29, spread: -5, spreadSlope: -4, plusSlope: -2.0, minusSlope: 2.4 },
    adx: { value: 28, slope: 0.6, rising: true, strong: true },
    shortMomentum: -1.1, shortHorizonDirection: "BEARISH", velocity: -0.6, acceleration: -0.3,
    structuralTrend: "BULLISH", rejectionUpperNow: true,
  });
  const overrideEpisode = () => sellEpisodeWithMemory({ candidateRsi: 92, extreme: true, extremeDeep: true, maxRsi: 93, outsideUpper: true, reenteredUpper: true, touchedUpper: true, maxSpread: 8, bollingerRejectionExtreme: 1.18 });

  it("override permitido apenas com confluencia excepcional (RSI >=85) e em modo OVERRIDE", () => {
    const entry = evaluateV3Entry({ indicators: overrideIndicators(), episode: overrideEpisode(), window: WINDOW, at: T - 45_000 });
    expect(entry.decision).toBe("SELL");
    expect(entry.confirmations.overrideEligible).toBe(true);
    expect(entry.entryMode).toBe("EXTREME_REVERSAL_OVERRIDE");
  });

  it("override bloqueado quando falta confluencia (sem rejeicao/DIs)", () => {
    const weak = ind({ at: T - 45_000, rsi: 86, rsiSlope: -0.2, bollinger: { ...ind().bollinger, position: 0.97, touchUpper: true, outsideUpper: false }, dmi: { plusDI: 30, minusDI: 20, spread: 10, plusSlope: 0.4, minusSlope: 0.1 }, adx: { value: 32, slope: 0.8, rising: true, strong: true }, shortMomentum: -0.2, rejectionUpperNow: false });
    const entry = evaluateV3Entry({ indicators: weak, episode: overrideEpisode(), window: WINDOW, at: T - 45_000 });
    expect(entry.confirmations.overrideEligible).toBe(false);
    expect(entry.entryMode).not.toBe("EXTREME_REVERSAL_OVERRIDE");
    expect(entry.decision).toBe("WAIT");
  });

  it("extremo raso (RSI 70-80) nunca usa override", () => {
    const shallow = sellReady();
    const entry = evaluateV3Entry({ indicators: shallow, episode: sellEpisode({ candidateRsi: 76 }), window: WINDOW, at: T - 45_000 });
    expect(entry.confirmations.overrideEligible).toBe(false);
  });
});

describe("RSI V3.1 — memoria causal do episodio (evento != estado)", () => {
  it("rejeicao do MESMO episodio vale sem exigir nova rejeicao no tick (T-5)", () => {
    const thesis = firstSightThesisV3({ indicators: sellReady(), direction: "SELL", episode: sellEpisodeWithMemory({ maxSpread: 12, maxPosition: 0.98 }), at: T - 34_000 });
    expect(thesis.valid).toBe(true);
    expect(thesis.components.episodeRejectionValid).toBe(true);
    expect(thesis.components.episodeStage2Recorded).toBe(true);
    expect(thesis.rejection.ageMs).toBeLessThan(thesis.rejection.validityMs);
  });

  it("rejeicao antiga demais -> BLOCK (nao autoriza eternamente)", () => {
    const episode = sellEpisodeWithMemory({ bollingerRejectionAt: T - 200_000, maxSpread: 12 });
    const thesis = firstSightThesisV3({ indicators: sellReady(), direction: "SELL", episode, at: T - 34_000 });
    expect(thesis.valid).toBe(false);
    expect(thesis.hardFails).toContain("REJEICAO_ANTIGA_DEMAIS");
  });

  it("rejeicao invalidada pelo preco -> BLOCK", () => {
    const episode = sellEpisodeWithMemory({ bollingerRejectionExtreme: 1.10, maxSpread: 12 });
    const thesis = firstSightThesisV3({ indicators: sellReady(), direction: "SELL", episode, at: T - 34_000 });
    expect(thesis.valid).toBe(false);
    expect(thesis.hardFails).toContain("REJEICAO_INVALIDADA_PELO_PRECO");
  });

  it("band riding retomado -> BLOCK; strong continuation antiga -> BLOCK", () => {
    const riding = ind({ ...sellReady(), bandRiding: { upper: true, lower: false } });
    const ridingThesis = firstSightThesisV3({ indicators: riding, direction: "SELL", episode: sellEpisodeWithMemory({ maxSpread: 12 }), at: T - 34_000 });
    expect(ridingThesis.valid).toBe(false);
    expect(ridingThesis.hardFails).toContain("BAND_RIDING_AGAINST");
    const strong = ind({ ...sellReady(), strongContinuation: { upper: true, lower: false } });
    const strongThesis = firstSightThesisV3({ indicators: strong, direction: "SELL", episode: sellEpisodeWithMemory({ maxSpread: 12 }), at: T - 34_000 });
    expect(strongThesis.valid).toBe(false);
    expect(strongThesis.hardFails).toContain("CONTINUACAO_FORTE");
  });

  it("DI cross recente mantem Stage 2 mesmo com slope 0/negativo; cross antigo/revertido -> BLOCK", () => {
    const flatSlope = ind({ at: T - 34_000, rsi: 62, rsiSlope: -0.4, bollinger: { ...ind().bollinger, position: 0.7, touchUpper: true }, dmi: { plusDI: 24, minusDI: 28, spread: -4, plusSlope: -0.2, minusSlope: -0.1 }, adx: { value: 26, slope: 0.2, rising: false, stabilizing: true }, shortMomentum: -0.6, structuralTrend: "BULLISH", shortHorizonDirection: "BEARISH", velocity: -0.3, rejectionUpperNow: true });
    const stage = evaluateStageV3({ indicators: flatSlope, episode: sellEpisodeWithMemory({ maxSpread: 10 }) });
    expect(stage.stage).toBe("NEW_DIRECTION_EMERGING");
    expect(stage.emerging.crossValid).toBe(true);
    expect(stage.strengths).toContain("DI_CROSS_PERSISTED");
    const thesis = firstSightThesisV3({ indicators: flatSlope, direction: "SELL", episode: sellEpisodeWithMemory({ maxSpread: 10 }), at: T - 34_000 });
    expect(thesis.valid).toBe(true);
    const oldCross = evaluateStageV3({ indicators: flatSlope, episode: sellEpisodeWithMemory({ diCrossAt: T - 300_000, maxSpread: 10 }) });
    expect(oldCross.stage).not.toBe("NEW_DIRECTION_EMERGING");
    const reverted = diCrossValidityV3({ episode: sellEpisodeWithMemory({ maxSpread: 10 }), indicators: ind({ ...flatSlope, dmi: { plusDI: 30, minusDI: 22, spread: 8, plusSlope: 0.3, minusSlope: 0.1 } }), at: T - 34_000 });
    expect(reverted.valid).toBe(false);
    expect(reverted.reason).toBe("DI_NOVO_PERDEU_DOMINANCIA");
  });

  it("ADX volta a fortalecer a antiga com DI antigo dominante -> BLOCK", () => {
    const backing = ind({ ...sellReady(), dmi: { plusDI: 30, minusDI: 22, spread: 8, plusSlope: 0.6, minusSlope: 0.2 }, adx: { value: 30, slope: 1.2, rising: true, strong: true } });
    const thesis = firstSightThesisV3({ indicators: backing, direction: "SELL", episode: sellEpisodeWithMemory({ maxSpread: 12 }), at: T - 34_000 });
    expect(thesis.valid).toBe(false);
    expect(thesis.hardFails).toContain("ADX_FORTALECENDO_ANTIGA");
    const cross = diCrossValidityV3({ episode: sellEpisodeWithMemory({ maxSpread: 12 }), indicators: backing, at: T - 34_000 });
    expect(cross.valid).toBe(false);
    expect(cross.reason).toBe("ADX_VOLTOU_FORTALECER_ANTIGA");
  });

  it("cushion <0.25 -> BLOCK (rejeicao e DI validos nao bastam)", () => {
    const fragile = ind({ ...sellReady(), shortMomentum: -0.03, velocity: -0.01, acceleration: 0 });
    const thesis = firstSightThesisV3({ indicators: fragile, direction: "SELL", episode: sellEpisodeWithMemory({ maxSpread: 12 }), at: T - 34_000 });
    expect(thesis.valid).toBe(false);
    expect(thesis.hardFails).toContain("CUSHION_ABAIXO");
  });

  it("dados insuficientes -> WAIT/INSUFFICIENT_HISTORY", () => {
    const candles = Array.from({ length: 20 }, (_v, index) => ({ bucketStart: index * 5_000, bucketEnd: (index + 1) * 5_000, open: 1, high: 1.1, low: 0.9, close: 1 + index * 0.001 }));
    const evaluation = evaluateIndicatorsV3({ candles, now: 200_000 });
    expect(evaluation.status).toBe("WAIT");
    expect(evaluation.reason).toBe("INSUFFICIENT_HISTORY");
  });

  it("rejeicao fora do mesmo episodio (candidate sem memoria) -> BLOCK", () => {
    const thesis = firstSightThesisV3({ indicators: sellReady(), direction: "SELL", episode: sellEpisode({ maxSpread: 12 }), at: T - 34_000 });
    expect(thesis.valid).toBe(false);
    expect(thesis.hardFails).toContain("SEM_REJEICAO_NO_EPISODIO");
  });
});

function relativeCushionMin() {
  return v3.RSI_V3_POLICY.cushionMin;
}
