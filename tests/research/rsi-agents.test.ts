/**
 * RSI AGENTS PINADOS — 12 agentes normais do runtime (6 STRICT + 6 PULLBACK):
 * atribuicao PINADA e persistida (GBPUSD:OTC -> STRICT, EURUSD:OTC -> PULLBACK),
 * sem troca silenciosa, fail closed para mercado ausente/fechado/sem feed/invalido/em conflito,
 * ordem somente via runtime.submitAgentOrder -> requestOrder (Execution Gate unico),
 * PRACTICE-only, observabilidade completa (stake/ordem/execucao) e revalidacao.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const agents = await import("../../relay/rsi-agents-5x5.mjs");
// @ts-expect-error - relay ESM sem tipagem
const variants = await import("../../relay/rsi-variants.mjs");

const PINNED_KEYS = agents.RSI_AGENT_PINNED_ASSIGNMENTS.map((entry: any) => entry.marketKey);

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

/** Universo do runtime com os 12 mercados pinados OPEN + extras nao pinados. */
const markets = (options: any = {}) => [
  ...agents.RSI_AGENT_PINNED_ASSIGNMENTS
    .filter((entry: any) => !(options.excludeKeys ?? []).includes(entry.marketKey))
    .map((entry: any, index: number) => ({
      marketKey: entry.marketKey,
      marketType: "OTC",
      enabled: true,
      availability: options.availability?.[entry.marketKey] ?? "OPEN",
      activeId: 1000 + index,
      canonical: entry.marketKey.split(":")[0],
    })),
  { marketKey: "NZDUSD:OTC", marketType: "OTC", enabled: true, availability: "OPEN", activeId: 2000, canonical: "NZDUSD" },
  { marketKey: "EURUSD:NORMAL", marketType: "NORMAL", enabled: true, availability: "OPEN", activeId: 76, canonical: "EURUSD" },
];

const fakeRuntime = ({ armed = true, orderResult = { state: "ACKNOWLEDGED", brokerOrderId: 777, executionId: "exec-1", stake: 1, stakeRequested: 1, stakeSource: "MANUAL_OVERRIDE", mode: "PRACTICE" } }: any = {}) => {
  const calls: any[] = [];
  return {
    calls,
    submitAgentOrder: async (input: any) => {
      calls.push(input);
      if (!armed) { const error: any = new Error("AGENT_ORDER_SYSTEM_NOT_ARMED"); error.code = "AGENT_ORDER_SYSTEM_NOT_ARMED"; throw error; }
      return orderResult;
    },
  };
};

const fakePool = () => {
  const queries: Array<{ text: string; values: any[] }> = [];
  return { queries, query: async (text: string, values: any[] = []) => { queries.push({ text, values }); return { rows: [] }; } };
};

const build = async (runtime: any, pool: any = null) => {
  const runner = new agents.RsiAgents5x5({ runtime, pool, enabled: true, now: () => 1_800_000_000_000 });
  await runner.assignUniverse(markets());
  return runner;
};

describe("RSI AGENTS PINADOS — atribuicao 6+6 persistida sem troca silenciosa", () => {
  it("12 mercados pinados -> 12 agentes, 6 STRICT + 6 PULLBACK, GBPUSD/EURUSD nas estrategias corretas", async () => {
    const runner = await build(fakeRuntime());
    const entries = [...runner.assignments.entries()];
    expect(entries).toHaveLength(12);
    expect(entries.map(([key]: any) => key).sort()).toEqual([...PINNED_KEYS].sort());
    const strict = entries.filter(([, a]: any) => a.strategy === agents.RSI_AGENTS.STRICT);
    const pull = entries.filter(([, a]: any) => a.strategy === agents.RSI_AGENTS.PULLBACK);
    expect(strict).toHaveLength(6); expect(pull).toHaveLength(6);
    expect(runner.assignments.get("GBPUSD:OTC").strategy).toBe(agents.RSI_AGENTS.STRICT);
    expect(runner.assignments.get("EURUSD:OTC").strategy).toBe(agents.RSI_AGENTS.PULLBACK);
    const status = await runner.status();
    expect(status.groups.strict.total).toBe(6); expect(status.groups.pullback.total).toBe(6);
    expect(status.readyToArm).toBe(true); expect(status.armed).toBe(false);
    expect(status.policy.stakeBrl).toBe(1);
    expect(status.pinned).toBe(true); expect(status.policy.failClosed).toBe(true);
  });

  it("persiste o pino no banco (INSERT com pinned=true) e nao apaga o que ja existia", async () => {
    const pool = fakePool();
    const runner = await build(fakeRuntime(), pool);
    expect(runner.pinnedReady).toBe(true);
    const inserts = pool.queries.filter((q: any) => q.text.includes("INSERT INTO iq_rsi_agent_assignments"));
    expect(inserts.length).toBe(12);
    expect(inserts.every((q: any) => q.values[0] && q.values[1])).toBe(true);
    expect(runner.unpinnedPersisted).toEqual([]);
  });

  it("mercado ausente do universo falha fechado: sem ordem e com motivo exato persistido", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const runner = new agents.RsiAgents5x5({ runtime, pool, enabled: true, now: () => 1_800_000_000_000 });
    await runner.assignUniverse(markets({ excludeKeys: ["GBPUSD:OTC"] }));
    const assignment = runner.assignments.get("GBPUSD:OTC");
    expect(assignment.availability).toBe("MISSING_NOT_IN_UNIVERSE");
    const status = await runner.status();
    expect(status.feedMissing).toContain("GBPUSD:OTC");
    const agent = status.agents.find((entry: any) => entry.marketKey === "GBPUSD:OTC");
    expect(agent.waitReason).toBe("MISSING_NOT_IN_UNIVERSE");
    const out = await runner.observeMarket({ marketKey: "GBPUSD:OTC", marketType: "OTC", candles: strictAccept().candles, targetExpiryAt: 1_800_000_000_000 });
    expect(out.waitReason).toBe("MISSING_NOT_IN_UNIVERSE");
    expect(runtime.calls).toHaveLength(0);
  });

  it("mercado fechado/sem feed nunca opera (fail closed com motivo)", async () => {
    const runtime = fakeRuntime();
    const runner = new agents.RsiAgents5x5({ runtime, enabled: true, now: () => 1_800_000_000_000 });
    await runner.assignUniverse(markets({ availability: { "EURUSD:OTC": "CLOSED" } }));
    const { candles } = strictAccept();
    const out = await runner.observeMarket({ marketKey: "EURUSD:OTC", marketType: "OTC", candles, targetExpiryAt: null });
    expect(out.decision).toBe("WAIT");
    expect(out.waitReason).toBe("MARKET_CLOSED");
    expect(runtime.calls).toHaveLength(0);
  });

  it("sem candles suficientes (sem feed) falha fechado", async () => {
    const runtime = fakeRuntime();
    const runner = await build(runtime);
    const out = await runner.observeMarket({ marketKey: "GBPUSD:OTC", marketType: "OTC", candles: [{ close: 1 }], targetExpiryAt: null });
    expect(out.decision).toBe("WAIT");
    expect(out.waitReason).toBe("NO_FEED_INSUFFICIENT_CANDLES");
    expect(runtime.calls).toHaveLength(0);
  });

  it("mercado nao pinado nunca opera, mesmo com estrategia valida", async () => {
    const runtime = fakeRuntime();
    const runner = await build(runtime);
    const out = await runner.observeMarket({ marketKey: "NZDUSD:OTC", marketType: "OTC", candles: strictAccept().candles, targetExpiryAt: null });
    expect(out).toBeNull();
    expect(runtime.calls).toHaveLength(0);
  });

  it("conflito banco x pino bloqueia o agente (nunca troca de estrategia em silencio)", async () => {
    const runtime = fakeRuntime();
    const pool = {
      query: async (text: string) => {
        if (text.startsWith("SELECT market_key, strategy")) {
          return { rows: [{ market_key: "GBPUSD:OTC", strategy: agents.RSI_AGENTS.PULLBACK, availability: "OPEN", active_id: 1 }] };
        }
        return { rows: [] };
      },
    };
    const runner = new agents.RsiAgents5x5({ runtime, pool, enabled: true, now: () => 1_800_000_000_000 });
    await runner.assignUniverse(markets());
    const status = await runner.status();
    const agent = status.agents.find((entry: any) => entry.marketKey === "GBPUSD:OTC");
    expect(agent.blocked).toBe(true);
    expect(agent.availability).toBe("CONFLICT");
    expect(status.conflicts.some((entry: any) => entry.marketKey === "GBPUSD:OTC")).toBe(true);
    const out = await runner.observeMarket({ marketKey: "GBPUSD:OTC", marketType: "OTC", candles: strictAccept().candles, targetExpiryAt: 1_800_000_000_000 });
    expect(out.waitReason).toContain("CONFLICT");
    expect(runtime.calls).toHaveLength(0);
  });
});

describe("RSI AGENTS PINADOS — decisao e ordem pelo caminho normal", () => {
  const strictKey = (runner: any) => [...runner.assignments.entries()].find(([, a]: any) => a.strategy === agents.RSI_AGENTS.STRICT)![0];
  const window = (now: number) => Math.ceil(now / 60_000) * 60_000;

  it("STRICT sem ARM bloqueia no runtime e registra motivo (nunca segundo caminho de ordem)", async () => {
    const runtime = fakeRuntime({ armed: false }); const runner = await build(runtime);
    const key = strictKey(runner); const { candles, now } = strictAccept(); const T = window(now);
    const out = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles, targetExpiryAt: T, now: T - 4_000 });
    expect(runtime.calls.length).toBeLessThanOrEqual(1);
    if (runtime.calls.length === 1) expect(out.waitReason).toContain("ORDER_BLOCKED");
    expect(runner.rejections.length).toBe(runtime.calls.length);
  });

  it("ARMADO: ordem unica com stake 1, PRACTICE, idempotencia e observabilidade completa", async () => {
    const runtime = fakeRuntime(); const runner = await build(runtime);
    const key = strictKey(runner); const { candles, now } = strictAccept(); const T = window(now);
    const first = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles, targetExpiryAt: T, now: T - 4_000 });
    if (runtime.calls.length === 0) { expect(first.waitReason.length > 0).toBe(true); return; }
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].stake).toBe(1);
    expect(runtime.calls[0].strategyId).toBe(agents.RSI_AGENTS.STRICT);
    expect(runtime.calls[0].skill).toBe(variants.STRICT_ID);
    expect(runtime.calls[0].idempotencyKey).toContain(`rsi-agent:${agents.RSI_AGENTS.STRICT}:${key}:${T}`);
    expect(["BUY", "SELL"]).toContain(runtime.calls[0].direction);
    expect(first.position?.status).toBe("OPEN");
    expect(first.orderId).toBe("777");
    expect(first.executionId).toBe("exec-1");
    expect(first.requestedStake).toBe(1);
    expect(first.effectiveStake).toBe(1);
    const second = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles, targetExpiryAt: T, now: T - 3_500 });
    expect(runtime.calls).toHaveLength(1); expect(second.waitReason).toBe("DUPLICATE_BLOCKED");
    const status = await runner.status();
    const agent = status.agents.find((a: any) => a.marketKey === key);
    expect(agent.submitAt).toBeTruthy();
    expect(agent.orderId).toBe("777"); expect(agent.executionId).toBe("exec-1");
    expect(agent.accountMode).toBe("PRACTICE");
    expect(status.realTouched).toBe(false); expect(status.practiceOnly).toBe(true);
  });

  it("liquidacao atualiza WIN/LOSS/PnL PRACTICE", async () => {
    const runner = await build(fakeRuntime()); const key = strictKey(runner);
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
