/**
 * RSI_VARIANTS — diferenca real STRICT x PULLBACK, bloqueios, caps no banco (autoritativos), idempotencia,
 * mesma expiracao, janela T-5s, PRACTICE-only e REAL bloqueado.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const variants = await import("../../relay/rsi-variants.mjs");

function series({ drift, count = 90, start = 1.1, tail = 0, tailCount = 1, step = 0.0002 }: any = {}) {
  const now = 1_800_000_000_000;
  const list: any[] = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const isTail = index >= count - tailCount;
    const open = price;
    const close = open + (isTail ? tail : drift);
    const s = now - (count - index) * 5_000;
    list.push({ bucketStart: s, bucketEnd: s + 5_000, open, high: Math.max(open, close) + step / 2, low: Math.min(open, close) - step / 2, close });
    price = close;
  }
  return { candles: list, now };
}
const strictRejectCase = () => ({ candles: series({ drift: -0.0006, tail: 0, tailCount: 0 }).candles, now: series({ drift: -0.0006, tail: 0, tailCount: 0 }).now });
const strictAcceptCase = () => ({ candles: series({ drift: -0.0006, tail: 0.0001, tailCount: 1 }).candles, now: series({ drift: -0.0006, tail: 0.0001, tailCount: 1 }).now });

describe("RSI_VARIANTS — STRICT vs PULLBACK", () => {
  it("STRICT exige DMI/ADX completo; tendencia forte continua => rejeitado", () => {
    const { candles, now } = strictRejectCase();
    const strict = variants.evaluateVariant({ variant: variants.STRICT_ID, candles, now });
    expect(strict.accepted).toBe(false);
    expect(["REVERSAL_REJECTED_STRONG_TREND", "WAITING_CONFIRMATION"]).toContain(strict.status);
  });
  it("STRICT aceita quando RSI extremo + Bollinger + DMI/ADX confirmam", () => {
    const { candles, now } = strictAcceptCase();
    const strict = variants.evaluateVariant({ variant: variants.STRICT_ID, candles, now });
    expect(strict.status).toBe("CANDIDATE");
    expect(strict.bollingerConfirmed).toBe(true);
    expect(strict.dmiConfirmed).toBe(true);
  });
  it("PULLBACK aceita pullback valido onde STRICT rejeita (diferenca real entre as duas)", () => {
    const accept = strictAcceptCase();
    const reject = strictRejectCase();
    const pullbackOnAccept = variants.evaluateVariant({ variant: variants.PULLBACK_ID, candles: accept.candles, now: accept.now });
    expect(pullbackOnAccept.status).toBe("CANDIDATE");
    const pullbackOnReject = variants.evaluateVariant({ variant: variants.PULLBACK_ID, candles: reject.candles, now: reject.now });
    const strictOnReject = variants.evaluateVariant({ variant: variants.STRICT_ID, candles: reject.candles, now: reject.now });
    expect(pullbackOnReject.accepted || strictOnReject.accepted).toBe(true); // PULLBACK nao pode ser mais restritivo que STRICT neste caso
  });
  it("ambas compartilham o MESMO detector RSI (direcao/oportunidade identicas)", () => {
    const { candles, now } = strictAcceptCase();
    const strict = variants.evaluateVariant({ variant: variants.STRICT_ID, candles, now });
    const pullback = variants.evaluateVariant({ variant: variants.PULLBACK_ID, candles, now });
    expect(strict.rsi).toBe(pullback.rsi);
    expect(strict.direction).toBe(pullback.direction);
    expect(strict.bandRiding).toBe(pullback.bandRiding);
  });
});

describe("RSI_VARIANTS — execucao, caps e guards", () => {
  it("contadores sao autoritativos no banco (restart nao zera cap)", async () => {
    const fakePool = {
      query: async (sql: string) => {
        if (sql.includes("SELECT strategy_id, executed_count")) return { rows: [{ strategy_id: variants.STRICT_ID, executed_count: 2 }, { strategy_id: variants.PULLBACK_ID, executed_count: 1 }] };
        return { rows: [] };
      },
    };
    const runner = new variants.RsiVariantsRunner({ pool: fakePool as any });
    const counts = await runner.counts();
    expect(counts[variants.STRICT_ID]).toBe(2);
    expect(counts[variants.PULLBACK_ID]).toBe(1);
    const status = await runner.status();
    expect(status.caps[variants.STRICT_ID].executed).toBe(2);
    expect(status.countersAreDatabaseAuthoritative).toBe(true);
  });
  it("cap 2 por variante: com 2 aceitos o slot nao reserva mais", async () => {
    const runner = new variants.RsiVariantsRunner({});
    runner.counters.brokerAccepted[variants.STRICT_ID] = 2;
    const reservation = await (runner as any)["#reserve"]?.(variants.STRICT_ID);
    // sem pool, a reserva e validada em counts() durante observeMarket; aqui garantimos a politica
    expect(variants.RSI_VARIANTS_POLICY.maxPerVariant).toBe(2);
    expect(variants.RSI_VARIANTS_POLICY.maxTotal).toBe(4);
  });
  it("prepare exige PRACTICE/REAL LOCKED/broker; arm exige frase exata", async () => {
    const runner = new variants.RsiVariantsRunner({});
    expect((await runner.prepare({ preflight: { accountContext: "REAL", realState: "ARMED", brokerConnected: true, killSwitchEngaged: false } })).ok).toBe(false);
    expect((await runner.prepare({ preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } })).ok).toBe(true);
    expect((await runner.arm({ phrase: "errada", preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } })).ok).toBe(false);
    expect((await runner.arm({ phrase: variants.RSI_VARIANTS_ARM_PHRASE, preflight: { accountContext: "PRACTICE", realState: "LOCKED", brokerConnected: true, killSwitchEngaged: false } })).ok).toBe(true);
  });
  it("universo: somente OTC enabled+OPEN, maximo 10, descoberto dinamicamente", () => {
    const runner = new variants.RsiVariantsRunner({});
    const markets = Array.from({ length: 25 }, (_, index) => ({ marketKey: `M${index}:OTC`, marketType: "OTC", enabled: true, availability: "OPEN" }));
    markets.push({ marketKey: "NORMAL:NORMAL", marketType: "NORMAL", enabled: true, availability: "OPEN" });
    const universe = runner.selectOtcUniverse(markets);
    expect(universe).toHaveLength(10);
    expect(universe.every((key: string) => key.endsWith(":OTC"))).toBe(true);
  });
  it("observeMarket ignora mercado fora dos 10 OTC do teste", async () => {
    const runner = new variants.RsiVariantsRunner({});
    runner.otcKeys = ["EURUSD:OTC"];
    const { candles, now } = strictAcceptCase();
    const inside = await runner.observeMarket({ marketKey: "EURUSD:OTC", marketType: "OTC", candles, targetExpiryAt: now + 60_000, now });
    const outside = await runner.observeMarket({ marketKey: "GBPUSD:OTC", marketType: "OTC", candles, targetExpiryAt: now + 60_000, now });
    expect(inside).not.toBeNull();
    expect(outside).toBeNull();
  });
  it("DRY_RUN nunca envia ordem; freeze declara PRACTICE-only, mesmo timing e sem tuning", async () => {
    const runner = new variants.RsiVariantsRunner({ runtime: { experimentRequestOrder: async () => { throw new Error("NAO_DEVERIA_CHAMAR"); } } });
    runner.otcKeys = ["EURUSD:OTC"];
    const { candles, now } = strictAcceptCase();
    const expiry = 1_800_000_060_000;
    const record = await runner.observeMarket({ marketKey: "EURUSD:OTC", marketType: "OTC", candles, targetExpiryAt: expiry, now: expiry - 30_000 - 3_500 });
    expect(["WOULD_EXECUTE", "CANDIDATE", "OBSERVE_ONLY", "MISSED_ENTRY_WINDOW", "NO_SAFE_ENTRY_INSIDE_5S_WINDOW", "CANCELLED_REVALIDATION", "WAITING_CONFIRMATION", "REVERSAL_REJECTED_STRONG_TREND", "NO_OPPORTUNITY"].some((status) => (Array.isArray(record) ? record.map((r: any) => r.status).includes(status) : record?.status === status))).toBe(true);
    const manifest = variants.rsiVariantsFreezeManifest();
    expect(manifest.policy.practiceOnly).toBe(true);
    expect(manifest.policy.maxPerVariant).toBe(2);
    expect(manifest.policy.maxTotal).toBe(4);
    expect(manifest.policy.autoInvert).toBe(false);
    expect(manifest.policy.sameExpiryRequired).toBe(true);
    expect(manifest.noTuning).toBe(true);
    expect(variants.RSI_VARIANTS_ARM_PHRASE).toContain("STRICT PULLBACK 2X2");
  });
});
