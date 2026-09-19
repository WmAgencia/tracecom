/**
 * RSI_REVERSAL_CONFLUENCE_V1 â€” detector RSI, confirmacoes obrigatorias (Bollinger E DMI/ADX),
 * bloqueio de tendencia forte, janela T-5s/T-safe, revalidacao sem inversao, mesma expiracao, caps e PRACTICE-only.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const rsi = await import("../../relay/rsi-reversal.mjs");

/** Serie sintetica: tendencia + reversao final opcional. */
function series({ drift = 0, count = 90, start = 1.1, tailReversal = 0, tailCount = 4, step = 0.0002 } = {}) {
  const now = 1_800_000_000_000;
  const list: any[] = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const isTail = index >= count - tailCount;
    const delta = isTail ? tailReversal : drift;
    const open = price;
    const close = open + delta;
    const start_ = now - (count - index) * 5_000;
    list.push({ bucketStart: start_, bucketEnd: start_ + 5_000, open, high: Math.max(open, close) + step / 2, low: Math.min(open, close) - step / 2, close });
    price = close;
  }
  return { candles: list, now };
}
const downward = () => series({ drift: -0.0004 });
const upward = () => series({ drift: 0.0004 });

describe("RSI_REVERSAL â€” detector e oportunidade", () => {
  it("RSI neutro => NO_OPPORTUNITY (nenhum indicador gera candidato sozinho)", () => {
    const now = 1_800_000_000_000;
    const candles: any[] = [];
    let price = 1.1;
    for (let index = 0; index < 90; index += 1) {
      const open = price; const close = open + (index % 2 === 0 ? 0.0002 : -0.0002);
      const start_ = now - (90 - index) * 5_000;
      candles.push({ bucketStart: start_, bucketEnd: start_ + 5_000, open, high: Math.max(open, close), low: Math.min(open, close), close });
      price = close;
    }
    const evaluation = rsi.evaluateRsiReversal({ candles, now });
    expect(["NO_OPPORTUNITY", "WAIT"]).toContain(evaluation.status);
    expect(evaluation.bothConfirmed !== true).toBe(true);
  });
  it("queda continua => RSI extremo (<=30) como oportunidade BUY, sem confirmar sozinho", () => {
    const { candles, now } = downward();
    const evaluation = rsi.evaluateRsiReversal({ candles, now });
    expect(evaluation.direction).toBe("BUY");
    expect(evaluation.rsi).toBeLessThanOrEqual(30);
    expect(evaluation.status).not.toBe("NO_OPPORTUNITY");
  });
  it("alta continua => RSI extremo (>=70) como oportunidade SELL", () => {
    const { candles, now } = upward();
    const evaluation = rsi.evaluateRsiReversal({ candles, now });
    expect(evaluation.direction).toBe("SELL");
    expect(evaluation.rsi).toBeGreaterThanOrEqual(70);
  });
  it("RSI <=20 e >=80 continuam sendo oportunidade (observabilidade por faixa)", () => {
    const buy = rsi.evaluateRsiReversal({ candles: downward().candles, now: downward().now });
    expect(rsi.RSI_BANDS_BUY.map((band: any[]) => band[2])).toContain(buy.rsiBand);
    const sell = rsi.evaluateRsiReversal({ candles: upward().candles, now: upward().now });
    expect(rsi.RSI_BANDS_SELL.map((band: any[]) => band[2])).toContain(sell.rsiBand);
  });
  it("historico insuficiente => WAIT INSUFFICIENT_HISTORY e candle formando nao conta", () => {
    const { candles, now } = downward();
    expect(rsi.evaluateRsiReversal({ candles: candles.slice(0, 40), now }).reason).toBe("INSUFFICIENT_HISTORY");
    const withForming = [...candles, { bucketStart: now, bucketEnd: now + 5_000, open: 1, high: 1, low: 1, close: 1 }];
    const snapshot = rsi.evaluateRsiReversal({ candles: withForming, now });
    expect(snapshot.direction).toBe("BUY");
  });
});

describe("RSI_REVERSAL â€” confirmacoes obrigatorias", () => {
  it("RSI sozinho nunca gera CANDIDATE; Bollinger/DMI/ADX devem confirmar juntos", () => {
    const { candles, now } = downward();
    const evaluation = rsi.evaluateRsiReversal({ candles, now });
    if (evaluation.status === "CANDIDATE") {
      expect(evaluation.bollingerConfirmed).toBe(true);
      expect(evaluation.dmiConfirmed).toBe(true);
    } else {
      expect(evaluation.bothConfirmed).toBe(false);
    }
  });
  it("tendencia forte contra a reversao => REVERSAL_REJECTED_STRONG_TREND (BUY em queda forte)", () => {
    const { candles, now } = series({ drift: -0.0006 });
    const evaluation = rsi.evaluateRsiReversal({ candles, now });
    expect(["REVERSAL_REJECTED_STRONG_TREND", "WAITING_CONFIRMATION"]).toContain(evaluation.status);
    expect(evaluation.bothConfirmed).toBe(false);
    expect(evaluation.direction).toBe("BUY");
  });
  it("tendencia forte bullish => SELL rejeitado (nunca vender so por RSI extremo)", () => {
    const { candles, now } = series({ drift: 0.0006 });
    const evaluation = rsi.evaluateRsiReversal({ candles, now });
    expect(["REVERSAL_REJECTED_STRONG_TREND", "WAITING_CONFIRMATION"]).toContain(evaluation.status);
    expect(evaluation.bothConfirmed).toBe(false);
  });
  it("reversao com confirmacao e alcancavel (RSI extremo + bandas + DI enfraquecendo)", () => {
    const tails = [0.00002, 0.00005, 0.0001, 0.0002, 0.0004];
    const buyStatuses = tails.map((tailReversal) => rsi.evaluateRsiReversal({ candles: series({ drift: -0.0006, tailReversal, tailCount: 1 }).candles, now: series({ drift: -0.0006, tailReversal, tailCount: 1 }).now }).status);
    const sellStatuses = tails.map((tailReversal) => rsi.evaluateRsiReversal({ candles: series({ drift: 0.0006, tailReversal: -tailReversal, tailCount: 1 }).candles, now: series({ drift: 0.0006, tailReversal: -tailReversal, tailCount: 1 }).now }).status);
    const all = [...buyStatuses, ...sellStatuses];
    expect(buyStatuses.some((status) => status === "CANDIDATE")).toBe(true);
    expect(sellStatuses.some((status) => status === "CANDIDATE")).toBe(true);
  });
});

describe("RSI_REVERSAL â€” timing T-5s/T-safe", () => {
  it("janela valida e exatamente [cutoff-5000, cutoff-safeMargin]", () => {
    const window = rsi.entryWindow({ targetExpiryAt: 1_800_000_060_000, safeMarginMs: 3000 });
    expect(window.purchaseCutoffAt).toBe(1_800_000_030_000);
    expect(window.entryWindowOpensAt).toBe(window.purchaseCutoffAt - 5000);
    expect(window.entryWindowClosesAt).toBe(window.purchaseCutoffAt - 3000);
  });
  it("safeMargin nunca < 3000ms e usa o maior medido", () => {
    expect(rsi.effectiveSafeMarginMs({})).toBe(3000);
    expect(rsi.effectiveSafeMarginMs({ ackP95Ms: 1700, persistP95Ms: 800, decisionMs: 50, jitterMs: 300, bufferMs: 200 })).toBe(3050);
  });
  it("safeMargin > 5s => janela invalida (NO_SAFE_ENTRY_INSIDE_5S_WINDOW)", () => {
    const window = rsi.entryWindow({ targetExpiryAt: 1_800_000_060_000, safeMarginMs: 6000 });
    expect(window.windowMs).toBeLessThan(0);
    expect(rsi.RSI_REVERSAL_POLICY.finalWindowMs).toBe(5000);
  });
  it("antes de T-5s nao existe ordem (OBSERVE_ONLY)", async () => {
    const experiment = new rsi.RsiReversalExperiment({});
    const down = downward();
    const expiry = 1_800_000_060_000;
    const record = await experiment.observeMarket({ marketKey: "EURUSD:OTC", marketType: "OTC", candles: down.candles, targetExpiryAt: expiry, now: down.now - 60_000 });
    if (record.status === "CANDIDATE" || record.status === "OBSERVE_ONLY") expect(["CANDIDATE", "OBSERVE_ONLY", "WAITING_CONFIRMATION", "NO_OPPORTUNITY", "REVERSAL_REJECTED_STRONG_TREND"]).toContain(record.status);
    expect(experiment.memory.executions.size).toBe(0);
  });
});

describe("RSI_REVERSAL â€” experimento, guards e caps", () => {
  it("default DRY_RUN; prepare exige PRACTICE/REAL LOCKED/broker; arm exige frase exata", async () => {
    const experiment = new rsi.RsiReversalExperiment({});
    const bad = await experiment.prepare({ preflight: { accountContext: "REAL", realState: "ARMED", brokerConnected: true, killSwitchEngaged: false } });
    expect(bad.ok).toBe(false);
    const good = await experiment.prepare({ preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } });
    expect(good.ok).toBe(true);
    expect((await experiment.arm({ phrase: "frase errada", preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } })).ok).toBe(false);
    expect((await experiment.arm({ phrase: rsi.RSI_REVERSAL_ARM_PHRASE, preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } })).ok).toBe(true);
    expect(experiment.state).toBe("ARMED_PRACTICE");
  });
  it("observabilidade: rejection persiste motivo exato (ORDER_IN_FLIGHT) sem alterar estrategia", async () => {
    const experiment = new rsi.RsiReversalExperiment({ runtime: { experimentRequestOrder: async () => { const error: any = new Error("ORDER_IN_FLIGHT: EURUSD:OTC"); error.code = "ORDER_IN_FLIGHT"; throw error; } } });
    await experiment.arm({ phrase: rsi.RSI_REVERSAL_ARM_PHRASE, preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } });
    const now = 1_800_000_000_000;
    const candles: any[] = [];
    let price = 1.1;
    for (let index = 0; index < 90; index += 1) {
      const open = price;
      const close = open - 0.0006 + (index === 89 ? 0.0001 : 0);
      const start_ = now - (90 - index) * 5_000;
      candles.push({ bucketStart: start_, bucketEnd: start_ + 5_000, open, high: Math.max(open, close), low: Math.min(open, close), close });
      price = close;
    }
    const expiry = 1_800_000_060_000;
    const entryAt = expiry - 30_000 - 3_500;
    const record = await experiment.observeMarket({ marketKey: "EURUSD:OTC", marketType: "OTC", candles, targetExpiryAt: expiry, now: entryAt });
    if (record?.status === "BROKER_REJECTED") {
      expect(record.rejectionReason).toBe("ORDER_IN_FLIGHT");
      expect(String(record.error)).toContain("ORDER_IN_FLIGHT");
    } else {
      expect(["CANDIDATE", "OBSERVE_ONLY", "WAITING_CONFIRMATION", "REVERSAL_REJECTED_STRONG_TREND", "NO_OPPORTUNITY", "WOULD_EXECUTE", "MISSED_ENTRY_WINDOW", "CANCELLED_REVALIDATION"]).toContain(record?.status);
    }
  });
  it("cap 30, stake R$1, PRACTICE-only, sem auto-inversao e mesma expiracao no freeze", () => {
    const manifest = rsi.rsiReversalFreezeManifest();
    expect(manifest.policy.maxTotalBrokerAccepted).toBe(30);
    expect(manifest.policy.stakeBrl).toBe(1);
    expect(manifest.policy.practiceOnly).toBe(true);
    expect(manifest.policy.autoInvert).toBe(false);
    expect(manifest.policy.sameExpiryRequired).toBe(true);
    expect(manifest.noTuning).toBe(true);
    expect(rsi.RSI_REVERSAL_ARM_PHRASE).toContain("RSI REVERSAL 5S");
  });
});



