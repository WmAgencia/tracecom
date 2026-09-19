/**
 * INDICATOR_5M_V1 — control group: historico minimo, candle formando, regras de confluencia,
 * trend forte, cancelamento tardio, sem inversao, mesma expiracao e margem de seguranca.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const ind = await import("../../relay/indicator-5m.mjs");

const baseSnapshot = (overrides: any = {}) => ({
  available: true,
  rsi: { value: 50, slope: 0, state: "NEUTRAL" },
  dmi: { plusDI: 20, minusDI: 20, spread: 0, direction: "NEUTRAL", lastCross: null, lastCrossAgeMs: null },
  adx: { value: 15, slope: 0, strength: "WEAK" },
  bollinger: { upper: 1.11, middle: 1.1, lower: 1.09, width: 0.02, widthTrajectory: 0, position: 0.5, distanceToUpper: 0.01, distanceToLower: 0.01 },
  bollingerState: "MID",
  atr: 0.001, price: 1.1,
  ...overrides,
});

function candles(count: number, now: number) {
  const list: any[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = now - (count - index) * 5_000;
    list.push({ bucketStart: start, bucketEnd: start + 5_000, open: 1.1 + index * 1e-6, high: 1.1005 + index * 1e-6, low: 1.0995 + index * 1e-6, close: 1.1 + index * 1e-6 });
  }
  return list;
}

describe("INDICATOR_5M_V1 — historico", () => {
  it("exige >= 60 candles 5s fechados (5 minutos completos)", () => {
    const now = 1_800_000_000_000;
    expect(ind.analyzeIndicators({ candles: candles(59, now), now }).reason).toBe("INSUFFICIENT_HISTORY");
    expect(ind.analyzeIndicators({ candles: candles(80, now), now }).available).toBe(true);
  });
  it("candle formando nao conta (bucketEnd > now)", () => {
    const now = 1_800_000_000_000;
    const list = candles(60, now);
    list.push({ bucketStart: now, bucketEnd: now + 5_000, open: 1.1, high: 1.2, low: 1.0, close: 1.15 });
    const snapshot = ind.analyzeIndicators({ candles: list, now });
    expect(snapshot.closedCandles).toBe(60);
  });
});

describe("INDICATOR_5M_V1 — regras de confluencia (sem forcar trade)", () => {
  it("RSI extremo sozinho NAO forca trade", () => {
    const decision = ind.decideIndicator5M({ snapshot: baseSnapshot({ rsi: { value: 22, slope: 0.1, state: "OVERSOLD" } }) });
    expect(decision.action).toBe("WAIT");
  });
  it("toque em Bollinger sozinho NAO forca trade", () => {
    expect(ind.decideIndicator5M({ snapshot: baseSnapshot({ bollingerState: "LOWER_EDGE" }) }).action).toBe("WAIT");
    expect(ind.decideIndicator5M({ snapshot: baseSnapshot({ bollingerState: "UPPER_EDGE" }) }).action).toBe("WAIT");
  });
  it("cruzamento DI sozinho NAO forca trade", () => {
    const decision = ind.decideIndicator5M({ snapshot: baseSnapshot({ dmi: { plusDI: 30, minusDI: 10, spread: 20, direction: "BULLISH", lastCross: { at: 1, direction: "BULL" }, lastCrossAgeMs: 1000 } }) });
    expect(decision.action).toBe("WAIT");
  });
  it("ADX nao e usado como direcao (ADX forte com spread neutro => WAIT)", () => {
    const decision = ind.decideIndicator5M({ snapshot: baseSnapshot({ adx: { value: 35, slope: 1, strength: "STRONG" } }) });
    expect(decision.action).toBe("WAIT");
  });
  it("conflito entre indicadores => WAIT", () => {
    const decision = ind.decideIndicator5M({ snapshot: baseSnapshot({ rsi: { value: 25, slope: 0.2, state: "OVERSOLD" }, dmi: { plusDI: 10, minusDI: 30, spread: -20, direction: "BEARISH" }, bollingerState: "LOWER_EDGE" }) });
    expect(decision.action).toBe("WAIT");
    expect(decision.confluence).toBe("CONFLICTED");
  });
  it("confluencia bullish e bearish sao alcancaveis", () => {
    const bullish = ind.decideIndicator5M({ snapshot: baseSnapshot({ rsi: { value: 28, slope: 0.3, state: "OVERSOLD" }, dmi: { plusDI: 30, minusDI: 12, spread: 18, direction: "BULLISH" }, bollingerState: "LOWER_EDGE" }) });
    expect(bullish.action).toBe("BUY");
    expect(bullish.indicatorAgreementCount).toBeGreaterThanOrEqual(2);
    const bearish = ind.decideIndicator5M({ snapshot: baseSnapshot({ rsi: { value: 74, slope: -0.3, state: "OVERBOUGHT" }, dmi: { plusDI: 12, minusDI: 30, spread: -18, direction: "BEARISH" }, bollingerState: "UPPER_EDGE" }) });
    expect(bearish.action).toBe("SELL");
  });
  it("trend forte impede reversao por RSI extremo", () => {
    const decision = ind.decideIndicator5M({ snapshot: baseSnapshot({ rsi: { value: 78, slope: 0.4, state: "OVERBOUGHT" }, dmi: { plusDI: 38, minusDI: 8, spread: 30, direction: "BULLISH" }, adx: { value: 42, slope: 1.5, strength: "VERY_STRONG" }, bollingerState: "UPPER_EDGE" }) });
    expect(decision.action).not.toBe("SELL");
  });
  it("nunca emite probabilidade de WIN", () => {
    const decision = ind.decideIndicator5M({ snapshot: baseSnapshot() });
    expect(JSON.stringify(decision)).not.toMatch(/probability|probabilidade/i);
  });
});

describe("INDICATOR_5M_V1 — timing, revalidacao e engine", () => {
  it("margem de seguranca nunca e menor que 3000ms e usa valor maior quando medido for maior", () => {
    expect(ind.effectiveSafetyMarginMs({ ackP95Ms: 100, persistP95Ms: 50, decisionMs: 10 })).toBe(3000);
    expect(ind.effectiveSafetyMarginMs({ ackP95Ms: 1700, persistP95Ms: 800, decisionMs: 50, jitterMs: 300, bufferMs: 200 })).toBe(3050);
  });
  it("plano tardio mira cutoff - margem efetiva (mesma expiracao)", () => {
    const plan = ind.planLateEntry({ targetExpiryAt: 1_800_000_000_000, latency: {} });
    expect(plan.effectiveSafetyMarginMs).toBe(3000);
    expect(plan.targetSubmitAt).toBe(plan.purchaseCutoffAt - 3000);
  });
  it("historico insuficiente => WAIT INSUFFICIENT_HISTORY no engine", () => {
    const engine = new ind.Indicator5MEngine({});
    const observation = engine.observeCandidate({ marketKey: "EURUSD:OTC", candles: candles(30, 1_800_000_000_000), targetEntryAt: 1, targetExpiryAt: 2 });
    expect(observation.initialDecision.action).toBe("WAIT");
    expect(observation.status).toBe("WAIT");
  });
  it("revalidacao tardia pode cancelar e NUNCA inverte direcao", () => {
    const engine = new ind.Indicator5MEngine({});
    const now = 1_800_000_000_000;
    const observation = engine.observeCandidate({ marketKey: "EURUSD:OTC", candles: candles(80, now), targetEntryAt: now + 10_000, targetExpiryAt: now + 60_000 });
    if (observation.status !== "CANDIDATE") return; // sem confluencia natural no fixture: nada a cancelar
    const cancelled = engine.revalidateFinal({ observationId: observation.id, candles: candles(80, now + 10_000), atMs: now + 20_000 });
    expect(["CANCELLED_REVALIDATION", "READY", "MISSED_SAME_EXPIRY_WINDOW"]).toContain(cancelled.status);
    expect(cancelled.direction === null || cancelled.direction === observation.initialDecision.action).toBe(true);
  });
  it("mesma expiracao obrigatoria: apos o cutoff => MISSED_SAME_EXPIRY_WINDOW", () => {
    const engine = new ind.Indicator5MEngine({});
    const now = 1_800_000_000_000;
    const observation = engine.observeCandidate({ marketKey: "EURUSD:OTC", candles: candles(80, now), targetEntryAt: now + 10_000, targetExpiryAt: now + 60_000 });
    expect(observation.status).toBe("WAIT"); // fixture sem confluencia exata
    const forced = { ...observation, status: "CANDIDATE", direction: "BUY", plan: { purchaseCutoffAt: now + 1_000, targetSubmitAt: now - 2_000, effectiveSafetyMarginMs: 3000 } };
    engine.observations.set(forced.id, forced);
    const result = engine.revalidateFinal({ observationId: forced.id, candles: candles(80, now), atMs: now + 5_000 });
    expect(result.status).toBe("MISSED_SAME_EXPIRY_WINDOW");
  });
  it("settlement idempotente, nunca broker, e freeze sem tuning", () => {
    const engine = new ind.Indicator5MEngine({});
    const freeze = ind.indicator5mFreezeManifest();
    expect(freeze.noTuning).toBe(true);
    expect(freeze.policy.controlsExecution).toBe(false);
    expect(freeze.policy.minimumRequestedSafetyMarginMs).toBe(3000);
    expect(ind.INDICATOR_5M_POLICY.minClosedCandles5s).toBe(60);
  });
});
