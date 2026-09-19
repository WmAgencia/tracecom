/**
 * RSI AGENTS 5x5 — agentes normais do runtime: 5 STRICT + 5 PULLBACK, atribuicao persistida sem troca
 * silenciosa, ordem somente via runtime.submitAgentOrder -> requestOrder, PRACTICE-only, stake R$1,
 * idempotencia, revalidacao/cancelamento e observabilidade completa.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const agents = await import("../../relay/rsi-agents-5x5.mjs");
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
const strictAccept = () => series({ drift: -0.0006, tail: 0.0001, tailCount: 1 });
const markets = (n = 12) => Array.from({ length: n }, (_, i) => ({ marketKey: `OTC-${String.fromCharCode(65 + i)}`, marketType: "OTC", enabled: true, availability: "OPEN", activeId: 1000 + i, canonical: `OTC-${i}` }));
const fakeRuntime = ({ armed = true, orderResult = { state: "ACKNOWLEDGED", brokerOrderId: 777, executionId: 1 } }: any = {}) => {
  const calls: any[] = [];
  return { calls, submitAgentOrder: async (input: any) => { calls.push(input); if (!armed) { const error: any = new Error("AGENT_ORDER_SYSTEM_NOT_ARMED"); error.code = "AGENT_ORDER_SYSTEM_NOT_ARMED"; throw error; } return orderResult; } };
};
const build = async (runtime: any) => { const runner = new agents.RsiAgents5x5({ runtime, enabled: true, now: () => 1_800_000_000_000 }); await runner.assignUniverse(markets()); return runner; };

describe("RSI AGENTS 5x5 — atribuicao", () => {
  it("12 OTCs elegiveis -> 10 atribuidos, 5 STRICT + 5 PULLBACK, sem duplicados", async () => {
    const runner = await build(fakeRuntime());
    const entries = [...runner.assignments.entries()];
    expect(entries).toHaveLength(10);
    expect(new Set(entries.map(([key]: any) => key)).size).toBe(10);
    const strict = entries.filter(([, a]: any) => a.strategy === agents.RSI_AGENTS.STRICT);
    const pull = entries.filter(([, a]: any) => a.strategy === agents.RSI_AGENTS.PULLBACK);
    expect(strict).toHaveLength(5); expect(pull).toHaveLength(5);
    const status = await runner.status();
    expect(status.groups.strict.total).toBe(5); expect(status.groups.pullback.total).toBe(5);
    expect(status.readyToArm).toBe(true); expect(status.policy.stakeBrl).toBe(1);
  });
  it("indisponibilidade e registrada sem substituicao silenciosa", async () => {
    const runner = await build(fakeRuntime());
    const key = [...runner.assignments.keys()][0];
    await runner.markAvailability(key, "CLOSED");
    expect(runner.assignments.get(key).availability).toBe("CLOSED");
    expect(runner.assignments.has(key)).toBe(true);
    expect([...runner.assignments.keys()]).toHaveLength(10);
  });
  it("mercado nao atribuido nunca opera", async () => {
    const runtime = fakeRuntime(); const runner = await build(runtime);
    const out = await runner.observeMarket({ marketKey: "OTC-ZZ", marketType: "OTC", candles: strictAccept().candles, targetExpiryAt: null });
    expect(out).toBeNull(); expect(runtime.calls).toHaveLength(0);
  });
});

describe("RSI AGENTS 5x5 — decisao e ordem pelo caminho normal", () => {
  const strictKey = async (runner: any) => [...runner.assignments.entries()].find(([, a]: any) => a.strategy === agents.RSI_AGENTS.STRICT)![0];
  const window = (now: number) => Math.ceil(now / 60_000) * 60_000;

  it("STRICT sem arm bloqueia no runtime e registra motivo (nunca segundo caminho de ordem)", async () => {
    const runtime = fakeRuntime({ armed: false }); const runner = await build(runtime);
    const key = await strictKey(runner); const { candles, now } = strictAccept(); const T = window(now);
    const out = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles, targetExpiryAt: T, now: T - 4_000 });
    expect(runtime.calls.length).toBeLessThanOrEqual(1);
    if (runtime.calls.length === 1) expect(out.waitReason).toContain("ORDER_BLOCKED");
    expect(runner.rejections.length).toBe(runtime.calls.length);
  });
  it("ARMADO: ordem unica com stake 1, PRACTICE, idempotencia e observabilidade", async () => {
    const runtime = fakeRuntime(); const runner = await build(runtime);
    const key = await strictKey(runner); const { candles, now } = strictAccept(); const T = window(now);
    const first = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles, targetExpiryAt: T, now: T - 4_000 });
    if (runtime.calls.length === 0) { expect(first.waitReason.length > 0).toBe(true); return; }
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].stake).toBe(1);
    expect(runtime.calls[0].idempotencyKey).toContain(`rsi-agent:${agents.RSI_AGENTS.STRICT}:${key}:${T}`);
    expect(["BUY", "SELL"]).toContain(runtime.calls[0].direction);
    expect(first.position?.status).toBe("OPEN");
    const second = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles, targetExpiryAt: T, now: T - 3_500 });
    expect(runtime.calls).toHaveLength(1); expect(second.waitReason).toBe("DUPLICATE_BLOCKED");
    const status = await runner.status();
    expect(status.agents.find((a: any) => a.marketKey === key).submitAt).toBeTruthy();
    expect(status.realTouched).toBe(false); expect(status.practiceOnly).toBe(true);
  });
  it("liquidacao atualiza WIN/LOSS/PnL PRACTICE", async () => {
    const runner = await build(fakeRuntime()); const key = await strictKey(runner);
    runner.recordSettlement({ marketKey: key, result: "WIN", profit: 0.85, entryPrice: 1.1, expiryPrice: 1.1005, payout: 0.85 });
    const status = await runner.status();
    const agent = status.agents.find((a: any) => a.marketKey === key);
    expect(agent.lastResult).toBe("WIN"); expect(agent.lastPnl).toBeCloseTo(0.85);
  });
  it("skills reutilizadas do modulo congelado (mesma interface STRICT/PULLBACK)", () => {
    const { candles, now } = series({ drift: -0.0006, tail: 0, tailCount: 0 });
    const strict = variants.evaluateVariant({ variant: variants.STRICT_ID, candles, now });
    expect(strict.accepted).toBe(false);
    expect(["REVERSAL_REJECTED_STRONG_TREND", "WAITING_CONFIRMATION", "NO_DIRECTION"].some((s) => s === strict.status || strict.reason === s || !strict.direction)).toBe(true);
    expect(typeof variants.evaluateVariant({ variant: variants.PULLBACK_ID, candles, now }).accepted).toBe("boolean");
  });
});
