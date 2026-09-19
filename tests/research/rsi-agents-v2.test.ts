/**
 * RSI AGENTS V2 — testes do runner: universo dinamico, 50/50 persistente, episodios,
 * shadow comparison (nunca executa), stake R$10 PRACTICE, fail closed, migracao com hold,
 * UNICO Execution Gate (nenhum caminho alternativo de ordem).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem
const agentsV2 = await import("../../relay/rsi-agents-v2.mjs");
// @ts-expect-error - relay ESM sem tipagem
const skillsV2 = await import("../../relay/rsi-skills-v2.mjs");

const { RsiAgentsV2, RSI_AGENTS_V2, RSI_AGENTS_V2_POLICY, computeFiftyFiftySplit } = agentsV2;
const { STRICT_V2_ID, PULLBACK_V2_ID } = skillsV2;
const NOW = 1_800_000_000_000;
const T = Math.ceil(NOW / 60_000) * 60_000;

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

const market = (key: string, marketType = "OTC", overrides: any = {}) => ({
  marketKey: key, marketType, canonical: key.split(":")[0], enabled: true, availability: "OPEN",
  activeId: 100 + Math.abs(key.length), instrumentTypes: ["binary", "turbo"], candles5s: 120, payout: 82, ...overrides,
});

const eligibleMarkets = (normalCount = 7, otcCount = 6) => [
  ...Array.from({ length: normalCount }, (_v, index) => market(`NORMAL${index}:NORMAL`, "NORMAL")),
  ...Array.from({ length: otcCount }, (_v, index) => market(`OTC${index}:OTC`, "OTC")),
];

const baseIndicators = (overrides: any = {}) => ({
  status: "NO_OPPORTUNITY", reason: "OK", closedCandles: 120, at: NOW,
  rsi: 50, rsiPrevious: 50, rsiSlope: 0, rsiBand: "NEUTRAL",
  bollinger: { upper: 1.2, middle: 1.1, lower: 1.0, width: 0.2, widthSlope: 0, expanding: false, position: 0.5, close: 1.1, touchUpper: false, touchLower: false, outsideUpper: false, outsideLower: false },
  dmi: { plusDI: 22, minusDI: 20, spread: 2, plusSlope: 0, minusSlope: 0 },
  adx: { value: 22, slope: 0, rising: false, strong: false },
  structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", shortMomentum: 0,
  bandRiding: { upper: false, lower: false }, dominantDI: "BALANCED", strongContinuation: { upper: false, lower: false },
  ...overrides,
});

const sellCandidate = () => baseIndicators({ at: T - 60_000, status: "SELL_EXTREME", rsi: 76, rsiSlope: 0.4, bollinger: { ...baseIndicators().bollinger, position: 0.95, touchUpper: true, close: 1.18 }, dmi: { plusDI: 33, minusDI: 21, spread: 12, plusSlope: 0.5, minusSlope: -0.1 }, adx: { value: 30, slope: 0.8, rising: true, strong: true }, bandRiding: { upper: true, lower: false }, dominantDI: "PLUS" });
const sellConfirmed = () => baseIndicators({ at: T - 34_000, status: "SELL_EXTREME", rsi: 66, rsiSlope: -1.4, bollinger: { ...baseIndicators().bollinger, position: 0.72, touchUpper: true, close: 1.14 }, dmi: { plusDI: 26, minusDI: 27, spread: -1, plusSlope: -1.6, minusSlope: 1.8 }, adx: { value: 27, slope: -0.9, rising: false, strong: true }, structuralTrend: "BULLISH", shortHorizonDirection: "BEARISH" });

/** Snapshot PULLBACK BUY aceito mas STRICT em WAIT (shadow direcional sem ordem). */
const buyPullbackAcceptedStrictWait = (at: number) => baseIndicators({ at, status: "BUY_EXTREME", rsi: 34, rsiSlope: 1.1, shortHorizonDirection: "BULLISH", structuralTrend: "BEARISH", bollinger: { ...baseIndicators().bollinger, position: 0.25, touchLower: true, close: 1.05 }, dmi: { plusDI: 24, minusDI: 29, spread: -5, plusSlope: 0.9, minusSlope: 0 }, adx: { value: 22, slope: -0.2, rising: false, strong: false }, dominantDI: "MINUS" });
const buyCandidate = (at: number) => baseIndicators({ at, status: "BUY_EXTREME", rsi: 27, rsiSlope: 0.2, shortHorizonDirection: "NEUTRAL", structuralTrend: "BEARISH", bollinger: { ...baseIndicators().bollinger, position: 0.03, touchLower: true, close: 1.0 }, dmi: { plusDI: 18, minusDI: 32, spread: -14, plusSlope: -0.1, minusSlope: 0.4 }, adx: { value: 32, slope: 0.7, rising: true, strong: true }, bandRiding: { upper: false, lower: true }, dominantDI: "MINUS" });

const scriptedSkills = (snapshots: any[]) => {
  let index = 0;
  return {
    evaluateIndicatorsV2: () => { const snapshot = snapshots[Math.min(index, snapshots.length - 1)]; index += 1; return snapshot; },
    updateEpisodeV2: skillsV2.updateEpisodeV2,
    evaluateV2: skillsV2.evaluateV2,
  };
};

const fakeRuntime = ({ armed = true, orderResult = null }: any = {}) => {
  const calls: any[] = [];
  return {
    calls,
    submitAgentV2Order: async (input: any) => {
      calls.push(input);
      if (!armed) { const error: any = new Error("AGENT_ORDER_SYSTEM_NOT_ARMED"); error.code = "AGENT_ORDER_SYSTEM_NOT_ARMED"; throw error; }
      return orderResult ?? { state: "ACKNOWLEDGED", brokerOrderId: 999, executionId: "exec-9", stake: 10, stakeRequested: 10, mode: "PRACTICE" };
    },
  };
};

/** Pool fake com tabelas em memoria (assignments/opportunities). */
const fakePool = () => {
  const assignments = new Map<string, any>();
  const opportunities = new Map<string, any>();
  const query = async (text: string, values: any[] = []) => {
    if (text.startsWith("SELECT market_key, strategy")) return { rows: [...assignments.values()].map((row) => ({ ...row })) };
    if (text.startsWith("INSERT INTO iq_rsi_agent_assignments_v2")) {
      const [marketKey, strategy, marketType, canonical, activeId, availability] = values;
      const existing = assignments.get(marketKey);
      assignments.set(marketKey, { market_key: marketKey, strategy, market_type: marketType, canonical, active_id: activeId, availability, block_reason: existing?.block_reason ?? null });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE iq_rsi_agent_assignments_v2")) {
      const row = assignments.get(values[0]);
      if (row) { row.availability = values[1]; row.block_reason = values[2] ?? row.block_reason; }
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO iq_rsi_shadow_opportunities_v2")) {
      const opportunityId = values[0];
      const row = opportunities.get(opportunityId) ?? {};
      const previous = { order_id: row.order_id ?? null, executing_result: row.executing_result ?? null, executing_profit: row.executing_profit ?? null, executing_settled_at: row.executing_settled_at ?? null, shadow_result: row.shadow_result ?? null, shadow_profit: row.shadow_profit ?? null, shadow_settled_at: row.shadow_settled_at ?? null };
      Object.assign(row, { opportunity_id: opportunityId, market_key: values[1], market_type: values[2], strategy_executing: values[3], strategy_shadow: values[4], observed_at: values[5], expiry_at: values[6], executing_decision: values[7], shadow_decision: values[8], agreement: values[9], executing_accepted: values[10], shadow_accepted: values[11], direction: values[12], rsi: values[13], rsi_band: values[14], tags: JSON.parse(values[20] ?? "{}"), effective_stake: values[23] ?? null });
      row.order_id = values[21] ?? previous.order_id;
      row.execution_id = values[22] ?? row.execution_id ?? null;
      row.executing_result = values[24] ?? previous.executing_result;
      row.executing_profit = values[25] ?? previous.executing_profit;
      row.executing_settled_at = values[26] ?? previous.executing_settled_at;
      row.shadow_result = values[27] ?? previous.shadow_result;
      row.shadow_profit = values[28] ?? previous.shadow_profit;
      row.shadow_settled_at = values[29] ?? previous.shadow_settled_at;
      opportunities.set(opportunityId, row);
      return { rows: [] };
    }
    if (text.startsWith("UPDATE iq_rsi_shadow_opportunities_v2 SET shadow_result")) {
      const row = opportunities.get(values[0]); if (row) Object.assign(row, { shadow_result: values[1], shadow_profit: values[2], shadow_settled_at: values[3] });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE iq_rsi_shadow_opportunities_v2 SET executing_result")) {
      const row = opportunities.get(values[0]); if (row) Object.assign(row, { executing_result: values[1], executing_profit: values[2], executing_settled_at: values[3] });
      return { rows: [] };
    }
    if (text.startsWith("SELECT * FROM iq_rsi_shadow_opportunities_v2")) return { rows: [...opportunities.values()].map((row) => ({ ...row })) };
    return { rows: [] };
  };
  return { query, assignments, opportunities };
};

const buildRunner = async (options: any = {}) => {
  let clock = options.now ?? NOW;
  const runtime = options.runtime ?? fakeRuntime();
  const pool = options.pool ?? fakePool();
  const runner = new RsiAgentsV2({ runtime, pool, now: () => clock, enabled: true, skills: options.skills ?? scriptedSkills(options.snapshots ?? []) });
  const markets = options.markets ?? eligibleMarkets();
  await runner.assignUniverse(markets);
  return { runner, runtime, pool, advance: (ms: number) => { clock += ms; }, getNow: () => clock };
};

/* ------------------------------------------------------------------ *
 * universo + 50/50 persistente
 * ------------------------------------------------------------------ */

describe("RSI AGENTS V2 — universo e divisao 50/50", () => {
  it("divide todo o universo elegivel 50/50, diff <= 1, com NORMAL e OTC nos dois lados", async () => {
    const { runner } = await buildRunner({ markets: eligibleMarkets(7, 6) });
    const assignments = [...runner.assignments.values()].filter((assignment: any) => assignment.eligible);
    expect(assignments).toHaveLength(13);
    const strict = assignments.filter((assignment: any) => assignment.strategy === STRICT_V2_ID);
    const pullback = assignments.filter((assignment: any) => assignment.strategy === PULLBACK_V2_ID);
    expect(Math.abs(strict.length - pullback.length)).toBeLessThanOrEqual(1);
    expect(strict.some((assignment: any) => assignment.marketType === "OTC")).toBe(true);
    expect(strict.some((assignment: any) => assignment.marketType === "NORMAL")).toBe(true);
    expect(pullback.some((assignment: any) => assignment.marketType === "OTC")).toBe(true);
    expect(pullback.some((assignment: any) => assignment.marketType === "NORMAL")).toBe(true);
    expect(runner.migration.complete).toBe(true);
    expect(runner.migration.hold).toBe(false);
  });

  it("universo dinamico: OPEN/enabled/activeId/turbo; inelegiveis ficam de fora com motivo", async () => {
    const markets = [
      market("A:OTC"),
      market("B:OTC", "OTC", { availability: "CLOSED" }),
      market("C:OTC", "OTC", { enabled: false }),
      market("D:OTC", "OTC", { activeId: null }),
      market("E:OTC", "OTC", { instrumentTypes: ["binary"] }),
      market("F:NORMAL", "NORMAL"),
    ];
    const { runner } = await buildRunner({ markets });
    const universe = runner.universe;
    expect(universe.eligible.map((row: any) => row.marketKey).sort()).toEqual(["A:OTC", "F:NORMAL"]);
    const closed = universe.observed.find((row: any) => row.marketKey === "B:OTC");
    expect(closed.eligible).toBe(false);
    expect(closed.reason).toContain("MARKET_CLOSED");
  });

  it("split e persistente apos restart e mercado novo entra no lado menor (sem troca silenciosa)", async () => {
    const pool = fakePool();
    const markets = eligibleMarkets(7, 6);
    const first = await buildRunner({ pool, markets });
    const before = new Map([...first.runner.assignments].map(([key, assignment]: any) => [key, assignment.strategy]));
    expect(before.size).toBe(13);
    // "restart": nova instancia com o MESMO banco
    const second = await buildRunner({ pool, markets });
    const after = new Map([...second.runner.assignments].map(([key, assignment]: any) => [key, assignment.strategy]));
    expect([...after.entries()]).toEqual([...before.entries()]);
    // mercado novo elegivel entra no lado menor, sem alterar os existentes
    second.advance(20_000);
    await second.runner.assignUniverse([...markets, market("NEW:OTC", "OTC")]);
    for (const [key, strategy] of before) expect(second.runner.assignments.get(key).strategy).toBe(strategy);
    const counts = { strict: 0, pullback: 0 };
    for (const assignment of second.runner.assignments.values()) if (assignment.eligible) counts[assignment.strategy === STRICT_V2_ID ? "strict" : "pullback"] += 1;
    expect(Math.abs(counts.strict - counts.pullback)).toBeLessThanOrEqual(1);
    const novo = second.runner.assignments.get("NEW:OTC");
    expect([STRICT_V2_ID, PULLBACK_V2_ID]).toContain(novo.strategy);
  });

  it("computeFiftyFiftySplit e deterministico e balanceado por tipo", () => {
    const list = eligibleMarkets(5, 5).map((row) => ({ marketKey: row.marketKey, marketType: row.marketType }));
    const split = computeFiftyFiftySplit(list);
    expect(split.total).toBe(10);
    expect(split.strictCount).toBe(5);
    expect(split.pullbackCount).toBe(5);
    const again = computeFiftyFiftySplit([...list].reverse());
    expect(again.strict.map((row: any) => row.marketKey)).toEqual(split.strict.map((row: any) => row.marketKey));
  });
});

/* ------------------------------------------------------------------ *
 * shadow comparison
 * ------------------------------------------------------------------ */

describe("RSI AGENTS V2 — shadow comparison (nunca envia ordem)", () => {
  it("skill nao atribuida avalia a mesma oportunidade e NUNCA executa", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const markets = eligibleMarkets(2, 2);
    const { runner } = await buildRunner({ runtime, pool, markets, snapshots: [buyCandidate(T - 60_000), buyPullbackAcceptedStrictWait(T - 34_000), buyPullbackAcceptedStrictWait(T - 34_000)] });
    const strictKey = [...runner.assignments.entries()].find(([, assignment]: any) => assignment.strategy === STRICT_V2_ID)![0];
    await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [{ bucketStart: T - 5_000, bucketEnd: T, close: 1.02, open: 1.03, high: 1.03, low: 1.01 }], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.decision).toBe("WAIT");
    expect(out.executingDecision).toBe("WAIT");
    expect(out.shadowDecision).toBe("BUY");
    expect(runtime.calls).toHaveLength(0);
    expect(pool.opportunities.size).toBeGreaterThan(0);
    const opportunity: any = [...pool.opportunities.values()][0];
    expect(opportunity.strategy_shadow).toBe(PULLBACK_V2_ID);
    expect(opportunity.shadow_decision).toBe("BUY");
    expect(opportunity.order_id).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * execucao: stake 10, PRACTICE, idempotencia, fail closed
 * ------------------------------------------------------------------ */

describe("RSI AGENTS V2 — execucao controlada", () => {
  it("STRICT confirmado envia UMA ordem com stake 10 PRACTICE pelo caminho unico", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const markets = eligibleMarkets(2, 2);
    const { runner, advance } = await buildRunner({ runtime, pool, markets, snapshots: [sellCandidate(), sellConfirmed(), sellConfirmed()] });
    const strictKey = [...runner.assignments.entries()].find(([, assignment]: any) => assignment.strategy === STRICT_V2_ID)![0];
    await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].stake).toBe(10);
    expect(runtime.calls[0].expectedStake).toBe(10);
    expect(runtime.calls[0].strategyId).toBe(STRICT_V2_ID);
    expect(runtime.calls[0].idempotencyKey).toContain(`rsi-agent-v2:${STRICT_V2_ID}:${strictKey}:${T}`);
    expect(out.decision).toBe("SELL");
    expect(out.orderId).toBe("999");
    expect(out.executionId).toBe("exec-9");
    expect(out.requestedStake).toBe(10);
    expect(out.effectiveStake).toBe(10);
    advance(1_000);
    const duplicate = await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 33_500 });
    expect(runtime.calls).toHaveLength(1);
    expect(duplicate.waitReason).toBe("DUPLICATE_BLOCKED");
    runner.recordSettlement({ marketKey: strictKey, result: "WIN", profit: 8.2, payout: 82 });
    const opportunity: any = [...pool.opportunities.values()].find((row: any) => row.order_id === "999");
    expect(opportunity.executing_result).toBe("WIN");
  });

  it("sem ARM o runtime bloqueia e o motivo fica persistido (nunca segundo caminho de ordem)", async () => {
    const runtime = fakeRuntime({ armed: false });
    const { runner } = await buildRunner({ runtime, markets: eligibleMarkets(2, 2), snapshots: [sellCandidate(), sellConfirmed(), sellConfirmed()] });
    const strictKey = [...runner.assignments.entries()].find(([, assignment]: any) => assignment.strategy === STRICT_V2_ID)![0];
    await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.decision).toBe("WAIT");
    expect(out.waitReason).toContain("ORDER_BLOCKED");
    expect(out.reason).toContain("AGENT_ORDER_SYSTEM_NOT_ARMED");
    expect(runner.rejections.some((row: any) => row.reason === "AGENT_ORDER_SYSTEM_NOT_ARMED")).toBe(true);
  });

  it("candidate sem confirmacao NAO gera ordem (RSI extremo + Bollinger sem DMI/ADX)", async () => {
    const runtime = fakeRuntime();
    const weak = baseIndicators({ at: T - 34_000, status: "SELL_EXTREME", rsi: 73, rsiSlope: -0.4, bollinger: { ...baseIndicators().bollinger, position: 0.92, touchUpper: true, close: 1.18 }, dmi: { plusDI: 30, minusDI: 22, spread: 8, plusSlope: 0.4, minusSlope: -0.1 }, adx: { value: 28, slope: 0.6, rising: true, strong: true } });
    const { runner } = await buildRunner({ runtime, markets: eligibleMarkets(2, 2), snapshots: [sellCandidate(), weak, weak] });
    const strictKey = [...runner.assignments.entries()].find(([, assignment]: any) => assignment.strategy === STRICT_V2_ID)![0];
    const out = await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.decision).toBe("WAIT");
    expect(runtime.calls).toHaveLength(0);
  });

  it("sem RSI extremo nunca cria candidate nem executa", async () => {
    const runtime = fakeRuntime();
    const neutro = baseIndicators({ at: T - 34_000, rsi: 50 });
    const { runner } = await buildRunner({ runtime, markets: eligibleMarkets(2, 2), snapshots: [neutro, neutro] });
    const key = [...runner.assignments.keys()][0];
    const out = await runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.waitReason).toBe("NO_CANDIDATE_RSI_NEUTRO");
    expect(runtime.calls).toHaveLength(0);
  });

  it("fail closed: assignment bloqueado nao envia ordem", async () => {
    const runtime = fakeRuntime();
    const { runner } = await buildRunner({ runtime, markets: eligibleMarkets(2, 2), snapshots: [sellCandidate(), sellConfirmed()] });
    const strictKey = [...runner.assignments.entries()].find(([, assignment]: any) => assignment.strategy === STRICT_V2_ID)![0];
    const assignment = runner.assignments.get(strictKey);
    assignment.blocked = true; assignment.blockReason = "NOT_ELIGIBLE:TEST";
    const out = await runner.observeMarket({ marketKey: strictKey, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.decision).toBe("WAIT");
    expect(out.waitReason).toBe("NOT_ELIGIBLE:TEST");
    expect(runtime.calls).toHaveLength(0);
  });

  it("PRACTICE-only e REAL locked na politica e no status", async () => {
    const { runner } = await buildRunner({ markets: eligibleMarkets(2, 2) });
    const status = await runner.status();
    expect(status.practiceOnly).toBe(true);
    expect(status.realTouched).toBe(false);
    expect(status.policy.realLocked).toBe(true);
    expect(status.stakeBrl).toBe(10);
    expect(RSI_AGENTS_V2_POLICY.singleBrokerPath).toBe("runtime.submitAgentV2Order -> requestOrder");
  });
});

/* ------------------------------------------------------------------ *
 * contrato estatico: gate unico, V1 pausado, shadow nunca chama ordem
 * ------------------------------------------------------------------ */

describe("RSI AGENTS V2 — contrato estatico", () => {
  it("nenhum caminho alternativo de ordem no modulo V2 (somente submitAgentV2Order)", () => {
    const source = readFileSync(new URL("../../relay/rsi-agents-v2.mjs", import.meta.url), "utf8");
    expect(source.includes("submitAgentV2Order")).toBe(true);
    expect(/\.requestOrder\s*\(/.test(source)).toBe(false);
    expect(source.includes("client.placeOrder")).toBe(false);
    expect(source.includes("rsiAgentsV2FreezeManifest")).toBe(true);
  });

  it("skills V2 nao modificam as V1 (modulos congelados continuam existindo)", () => {
    const source = readFileSync(new URL("../../relay/rsi-skills-v2.mjs", import.meta.url), "utf8");
    expect(source.includes('from "./rsi-variants.mjs"')).toBe(false);
    expect(source.includes('from "./rsi-reversal.mjs"')).toBe(false);
    expect(source.includes("RSI_REVERSAL_STRICT_V2")).toBe(true);
    expect(source.includes("RSI_EXTREME_PULLBACK_V2")).toBe(true);
  });
});
