/** ADVERSARIAL — IQ connector: PRACTICE-only enforcement, idempotencia, kill switch, causalidade de candles. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const connector = await import("../../relay/iqoption-connector.mjs");
const {
  ConnectorError, IdempotencyStore, KillSwitch,
  applyBrokerAcknowledgement, assertPracticeAccount, buildCausalCandles,
  compareSettlement, normalizeTick, validatePracticeOrder,
} = connector as unknown as Record<string, any>;

const baseRequest = { direction: "BUY", decisionId: "dec-1", stake: 1, asset: "EUR/USD", horizonSeconds: 60, decisionAgeMs: 2_000, marketOpen: true, idempotencyKey: "idem-1" };
const context = (overrides: Record<string, unknown> = {}) => ({ accountType: "PRACTICE", expectedAsset: "EUR/USD", killSwitch: new KillSwitch(), idempotency: new IdempotencyStore(), stakeCap: 1, ...overrides });

describe("REAL ACCOUNT BLOCK — enforcement server-side inegociavel", () => {
  it("REAL + BUY → REAL_ACCOUNT_EXECUTION_FORBIDDEN", () => {
    expect(() => validatePracticeOrder({ ...baseRequest }, context({ accountType: "REAL" }))).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
  });
  it("REAL + SELL, payload forjado, endpoint direto e frontend adulterado → TODOS bloqueados", () => {
    expect(() => validatePracticeOrder({ ...baseRequest, direction: "SELL" }, context({ accountType: "real" }))).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
    expect(() => validatePracticeOrder({ ...baseRequest, accountType: "PRACTICE" }, context({ accountType: "REAL" }))).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/); // payload nao controla a conta
    expect(() => assertPracticeAccount("UNKNOWN")).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
    expect(() => assertPracticeAccount(null)).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
    expect(() => validatePracticeOrder({ ...baseRequest }, context({ accountType: "LIVE" }))).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
  });
  it("PRACTICE passa (CALL/PUT mapeados de BUY/SELL)", () => {
    const buy = validatePracticeOrder({ ...baseRequest }, context());
    expect(buy.direction).toBe("CALL");
    const sell = validatePracticeOrder({ ...baseRequest, direction: "SELL", idempotencyKey: "idem-2" }, context());
    expect(sell.direction).toBe("PUT");
  });
});

describe("IDEMPOTENCIA — uma decisao = no maximo UMA ordem", () => {
  it("retry/timeout/replay com a mesma key nao cria segunda ordem", () => {
    const ctx = context();
    const first = validatePracticeOrder({ ...baseRequest }, ctx);
    expect(first.duplicate).toBe(false);
    const retry = validatePracticeOrder({ ...baseRequest }, ctx);
    expect(retry.duplicate).toBe(true);
    expect(retry.record.executionId).toBe(first.record.executionId);
    expect(ctx.idempotency.byKey.size).toBe(1);
  });
  it("ACK sem brokerOrderId → UNKNOWN (nunca assume sucesso); com orderId → ACKNOWLEDGED", () => {
    const store = new IdempotencyStore();
    const { record } = store.register("k1", {});
    expect(applyBrokerAcknowledgement(record, {})).toMatchObject({ state: "UNKNOWN", brokerOrderId: null });
    const { record: record2 } = store.register("k2", {});
    expect(applyBrokerAcknowledgement(record2, { orderId: 987 })).toMatchObject({ state: "ACKNOWLEDGED", brokerOrderId: "987" });
    const { record: record3 } = store.register("k3", {});
    expect(applyBrokerAcknowledgement(record3, { error: "insufficient" })).toMatchObject({ state: "REJECTED" });
  });
});

describe("KILL SWITCH + stake + fresh", () => {
  it("kill switch ativo bloqueia; release permite novamente", () => {
    const killSwitch = new KillSwitch();
    expect(validatePracticeOrder({ ...baseRequest }, context({ killSwitch })).direction).toBe("CALL");
    killSwitch.engage();
    expect(() => validatePracticeOrder({ ...baseRequest, idempotencyKey: "idem-3" }, context({ killSwitch }))).toThrowError(/KILL_SWITCH_ACTIVE/);
    killSwitch.release();
    expect(validatePracticeOrder({ ...baseRequest, idempotencyKey: "idem-4" }, context({ killSwitch })).direction).toBe("CALL");
  });
  it("stake cap, stale decision, asset, mercado fechado e horizonte invalido → fail-closed", () => {
    expect(() => validatePracticeOrder({ ...baseRequest, stake: 5 }, context())).toThrowError(/STAKE_CAP_EXCEEDED/);
    expect(() => validatePracticeOrder({ ...baseRequest, decisionAgeMs: 60_000 }, context())).toThrowError(/STALE_DECISION/);
    expect(() => validatePracticeOrder({ ...baseRequest, asset: "GBP/USD" }, context())).toThrowError(/ASSET_MISMATCH/);
    expect(() => validatePracticeOrder({ ...baseRequest, marketOpen: false }, context())).toThrowError(/MARKET_CLOSED/);
    expect(() => validatePracticeOrder({ ...baseRequest, horizonSeconds: 0 }, context())).toThrowError(/INVALID_HORIZON/);
    expect(() => validatePracticeOrder({ ...baseRequest, idempotencyKey: "" }, context())).toThrowError(/IDEMPOTENCY_KEY_REQUIRED/);
  });
  it("practiceOnly permanece TRUE no status do kill switch (sem opcao REAL)", () => {
    expect(new KillSwitch(true).status()).toEqual({ executionEnabled: true, practiceOnly: true });
  });
});

describe("CANDLES CAUSAIS (IQ_OPTION_WS) — sem futuro, sem duplicata, sem cross-asset", () => {
  it("agrega ticks 5s, ordena, deduplica buckets e marca source", () => {
    const serverTime = 1_700_000_010_000;
    const ticks = [
      { asset: "EUR/USD", timestamp: 1_700_000_003_000, price: 1.1537 },
      { asset: "EUR/USD", timestamp: 1_700_000_004_500, price: 1.1538 },
      { asset: "EUR/USD", timestamp: 1_700_000_006_000, price: 1.1536 },
      { asset: "EUR/USD", timestamp: 1_700_000_003_500, price: 1.1539 },
    ];
    const candles = buildCausalCandles(ticks, { asset: "EUR/USD", serverTime }) as Array<Record<string, unknown>>;
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ bucketStart: 1_700_000_000_000, bucketEnd: 1_700_000_005_000, open: 1.1537, high: 1.1539, low: 1.1537, close: 1.1539, source: "IQ_OPTION_WS" });
    expect(candles[1]).toMatchObject({ open: 1.1536, close: 1.1536 });
    expect(candles.every((candle) => Number(candle.bucketStart) < serverTime)).toBe(true);
  });
  it("tick futuro rejeitado; cross-asset rejeitado; tick invalido rejeitado", () => {
    expect(() => normalizeTick({ timestamp: 1_700_000_020_000, price: 1.1 }, { asset: "EUR/USD", serverTime: 1_700_000_010_000 })).toThrowError(/FUTURE_TICK_REJECTED/);
    expect(() => normalizeTick({ timestamp: 1_700_000_003_000, price: 1.1 }, { asset: "GBP/USD", expectedAsset: "EUR/USD", serverTime: 1_700_000_010_000 })).toThrowError(/CROSS_ASSET_REJECTED/);
    expect(() => normalizeTick({ timestamp: "x", price: "y" }, { asset: "EUR/USD" })).toThrowError(/INVALID_TICK/);
  });
});

describe("SETTLEMENT — divergencia broker vs causal nunca e ocultada", () => {
  it("match, mismatch e evidencias insuficientes", () => {
    expect(compareSettlement("WIN", "WIN")).toMatchObject({ mismatch: false, reason: "MATCH" });
    expect(compareSettlement("WIN", "LOSS")).toMatchObject({ mismatch: true, reason: "SETTLEMENT_MISMATCH" });
    expect(compareSettlement("UNKNOWN", "WIN")).toMatchObject({ mismatch: false, reason: "INSUFFICIENT_EVIDENCE" });
  });
});
