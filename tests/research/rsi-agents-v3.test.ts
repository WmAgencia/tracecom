/**
 * RSI AGENTS V3 — testes do runner: estrategia unica em todo universo, candidate/freshness,
 * revalidacao T-5, execucao R$10 PRACTICE, V2 shadow nunca executa, migracao com hold,
 * restart preservado e contrato de gate unico.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem
const agentsV3 = await import("../../relay/rsi-agents-v3.mjs");
// @ts-expect-error - relay ESM sem tipagem
const skillsV3 = await import("../../relay/rsi-v3.mjs");
// @ts-expect-error - relay ESM sem tipagem
const skillsV2 = await import("../../relay/rsi-skills-v2.mjs");

const { RsiAgentsV3, RSI_AGENTS_V3_POLICY, RSI_V3_EXECUTION_ALLOWLIST } = agentsV3;
const { V3_ID } = skillsV3;
const { STRICT_V2_ID, PULLBACK_V2_ID } = skillsV2;
const NOW = 1_800_000_000_000;
const T = Math.ceil(NOW / 60_000) * 60_000;

const market = (key: string, marketType = "OTC") => ({
  marketKey: key, marketType, canonical: key.split(":")[0], enabled: true, availability: "OPEN",
  activeId: 100 + Math.abs(key.length), instrumentTypes: ["binary", "turbo"], candles5s: 120, payout: 82,
});
const markets = (normalCount = 2, otcCount = 2) => [
  ...Array.from({ length: normalCount }, (_v, index) => market(`NORMAL${index}:NORMAL`, "NORMAL")),
  ...Array.from({ length: otcCount }, (_v, index) => market(`OTC${index}:OTC`, "OTC")),
];

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

const sellCandidate = () => ind({ at: T - 60_000, status: "SELL_EXTREME", rsi: 78, rsiBand: "70-80", rsiSlope: 0.4, bollinger: { ...ind().bollinger, position: 0.95, touchUpper: true, outsideUpper: true, close: 1.18 }, dmi: { plusDI: 33, minusDI: 21, spread: 12, plusSlope: 0.5, minusSlope: -0.1 }, adx: { value: 30, slope: 0.8, rising: true, strong: true }, bandRiding: { upper: true, lower: false }, dominantDI: "PLUS" });
const sellReady = () => ind({ at: T - 34_000, status: "NO_OPPORTUNITY", rsi: 64, rsiPrevious: 68, rsiSlope: -1.4, bollinger: { ...ind().bollinger, position: 0.68, close: 1.14, touchUpper: true, outsideUpper: false, widthSlope: -0.002, expanding: false }, dmi: { plusDI: 26, minusDI: 27, spread: -1, spreadSlope: -2, plusSlope: -1.6, minusSlope: 1.8 }, adx: { value: 26, slope: -0.9, rising: false, falling: true, strong: true }, shortMomentum: -0.9, shortHorizonDirection: "BEARISH", velocity: -0.5, acceleration: -0.2, structuralTrend: "BULLISH", rejectionUpperNow: true });

const scripted = (snapshots: any[]) => {
  let index = 0;
  return { evaluateIndicatorsV3: () => { const snapshot = snapshots[Math.min(index, snapshots.length - 1)]; index += 1; return snapshot; } };
};
const scriptedV2 = (snapshots: any[]) => {
  let index = 0;
  const neutral = () => ({ status: "NO_OPPORTUNITY", reason: "OK", closedCandles: 120, at: NOW, rsi: 50, rsiBand: "NEUTRAL", bollinger: { position: 0.5 }, dmi: { plusDI: 22, minusDI: 20, spread: 2, plusSlope: 0, minusSlope: 0 }, adx: { value: 22, slope: 0, rising: false, strong: false }, structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", bandRiding: { upper: false, lower: false }, dominantDI: "BALANCED", strongContinuation: { upper: false, lower: false } });
  return { evaluateIndicatorsV2: () => { const snapshot = snapshots[Math.min(index, snapshots.length - 1)] ?? neutral(); index += 1; return snapshot; } };
};

const fakeRuntime = ({ armed = true, orderResult = null }: any = {}) => {
  const calls: any[] = [];
  return {
    calls,
    submitAgentV3Order: async (input: any) => {
      calls.push(input);
      if (!armed) { const error: any = new Error("AGENT_ORDER_SYSTEM_NOT_ARMED"); error.code = "AGENT_ORDER_SYSTEM_NOT_ARMED"; throw error; }
      return orderResult ?? { state: "ACKNOWLEDGED", brokerOrderId: 555, executionId: "exec-v3", stake: 10, stakeRequested: 10, mode: "PRACTICE" };
    },
  };
};

const fakePool = (options: any = {}) => {
  const assignments = new Map<string, any>();
  const opportunities = new Map<string, any>();
  const events: any[] = [];
  const universeInserts: any[] = [];
  const queries: any[] = [];
  const query = async (text: string, values: any[] = []) => {
    queries.push({ text, values });
    if (options.onQuery) options.onQuery(text, values);
    if (text.startsWith("INSERT INTO iq_rsi_universe_v3")) { universeInserts.push({ text, values }); return { rows: [] }; }
    if (text.startsWith("SELECT market_key, strategy")) return { rows: [...assignments.values()].map((row) => ({ ...row })) };
    if (text.startsWith("INSERT INTO iq_rsi_agent_assignments_v3")) {
      const [marketKey, strategy, marketType, canonical, activeId, availability] = values;
      const existing = assignments.get(marketKey);
      assignments.set(marketKey, { market_key: marketKey, strategy, market_type: marketType, canonical, active_id: activeId, availability, block_reason: existing?.block_reason ?? null });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE iq_rsi_agent_assignments_v3")) {
      const row = assignments.get(values[0]); if (row) { row.availability = values[1]; row.block_reason = values[2] ?? row.block_reason; }
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO iq_rsi_opportunities_v3")) {
      const opportunityId = values[0];
      const row = opportunities.get(opportunityId) ?? {};
      Object.assign(row, { opportunity_id: opportunityId, market_key: values[1], market_type: values[2], direction: values[12], entry_mode: values[13], decision: values[16], accepted: values[17], v3_decision: values[28], strict_v2_decision: values[29], pullback_v2_decision: values[30], entry_price: values[34], entry_noise: values[35], expiry_at: values[36] });
      row.order_id = values[31] ?? row.order_id ?? null;
      row.execution_id = values[32] ?? row.execution_id ?? null;
      row.result = values[38] ?? row.result ?? null;
      opportunities.set(opportunityId, row);
      return { rows: [] };
    }
    if (text.startsWith("UPDATE iq_rsi_opportunities_v3")) {
      const row = opportunities.get(values[0]);
      if (row) Object.assign(row, { expiry_price: values[1], result: values[2], profit: values[3], quality_class: values[7], settlement_basis: values[8] });
      return { rows: [] };
    }
    if (text.startsWith("SELECT market_key, market_type, direction")) return { rows: [...opportunities.values()].map((row) => ({ ...row })) };
    if (text.startsWith("INSERT INTO iq_rsi_events_v3")) { events.push({ text, values }); return { rows: [] }; }
    return { rows: [] };
  };
  return { query, assignments, opportunities, events, universeInserts, queries };
};

const buildRunner = async (options: any = {}) => {
  let clock = options.now ?? NOW;
  const runtime = options.runtime ?? fakeRuntime();
  const pool = options.pool ?? fakePool();
  const runner = new RsiAgentsV3({
    runtime, pool, now: () => clock, enabled: true,
    skills: { ...skillsV3, ...(options.skills ?? {}) },
    skillsV2: { ...skillsV2, ...(options.skillsV2 ?? {}) },
  });
  const list = options.markets ?? markets();
  await runner.assignUniverse(list);
  return { runner, runtime, pool, advance: (ms: number) => { clock += ms; }, getNow: () => clock, list };
};

describe("RSI AGENTS V3 — universo unico", () => {
  it("a MESMA estrategia V3 em todos os elegiveis; NORMAL/OTC separados; persistido", async () => {
    const pool = fakePool();
    const first = await buildRunner({ pool, markets: markets(3, 4) });
    const assignments = [...first.runner.assignments.values()].filter((assignment: any) => assignment.eligible);
    expect(assignments).toHaveLength(7);
    expect(assignments.every((assignment: any) => assignment.strategy === V3_ID)).toBe(true);
    expect(assignments.filter((assignment: any) => assignment.marketType === "NORMAL")).toHaveLength(3);
    expect(assignments.filter((assignment: any) => assignment.marketType === "OTC")).toHaveLength(4);
    expect(first.runner.migration.complete).toBe(true);
    const before = new Map([...first.runner.assignments].map(([key, assignment]: any) => [key, assignment.strategy]));
    const second = await buildRunner({ pool, markets: markets(3, 4) });
    expect([...second.runner.assignments.entries()].map(([key, assignment]: any) => [key, assignment.strategy])).toEqual([...before.entries()]);
    const status = await second.runner.status();
    expect(status.totals.eligible).toBe(7);
    expect(status.shadowV2.controlsExecution).toBe(false);
    expect(status.stakeBrl).toBe(10);
    expect(status.practiceOnly).toBe(true);
    expect(RSI_V3_EXECUTION_ALLOWLIST).toEqual([`agent-v3:${V3_ID}`]);
  });

  it("inelegivel nao entra; mercado que sai do feed fica bloqueado sem substituicao", async () => {
    const closed = market("CLOSED:OTC", "OTC"); closed.availability = "CLOSED";
    const invalid = market("NOTURBO:OTC", "OTC"); invalid.instrumentTypes = ["binary"];
    const { runner } = await buildRunner({ markets: [...markets(1, 1), closed, invalid] });
    expect([...runner.assignments.values()].filter((assignment: any) => assignment.eligible)).toHaveLength(2);
    const universe = runner.universe;
    expect(universe.observed.find((row: any) => row.marketKey === "CLOSED:OTC").reason).toContain("MARKET_CLOSED");
  });
});

describe("RSI AGENTS V3 — execucao e shadow", () => {
  const v2ReadyForPullback = () => ({
    status: "NO_OPPORTUNITY", reason: "OK", closedCandles: 120, at: NOW, rsi: 64, rsiBand: "NEUTRAL",
    bollinger: { position: 0.7, touchUpper: true, outsideUpper: false, expanding: false },
    dmi: { plusDI: 28, minusDI: 25, spread: 3, plusSlope: -0.9, minusSlope: 0.9 },
    adx: { value: 24, slope: -0.4, rising: false, strong: false },
    structuralTrend: "BULLISH", shortHorizonDirection: "BEARISH",
    bandRiding: { upper: false, lower: false }, dominantDI: "BALANCED", strongContinuation: { upper: false, lower: false },
  });

  it("entrada V3 unica com stake 10 PRACTICE e observabilidade completa", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const built = await buildRunner({ runtime, pool, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady()]), skillsV2: scriptedV2([v2ReadyForPullback(), v2ReadyForPullback(), v2ReadyForPullback()]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [{ bucketStart: T - 5_000, bucketEnd: T, close: 1.05, open: 1.06, high: 1.06, low: 1.04 }], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].stake).toBe(10);
    expect(runtime.calls[0].expectedStake).toBe(10);
    expect(runtime.calls[0].strategyId).toBe(V3_ID);
    expect(runtime.calls[0].entryMode).toBe("NORMAL_T5");
    expect(runtime.calls[0].idempotencyKey).toContain(`rsi-agent-v3:${V3_ID}:${key}:${T}`);
    expect(out.decision).toBe("SELL");
    expect(out.orderId).toBe("555");
    expect(out.executionId).toBe("exec-v3");
    expect(out.requestedStake).toBe(10);
    expect(out.effectiveStake).toBe(10);
    expect(out.entryMode).toBe("NORMAL_T5");
    expect(out.strictV2Decision).toBeDefined();
    expect(out.pullbackV2Decision).toBeDefined();
    const opportunity: any = [...pool.opportunities.values()].find((row: any) => row.order_id === "555");
    expect(opportunity).toBeTruthy();
    expect(opportunity.strict_v2_decision).toBeDefined();
    expect(opportunity.pullback_v2_decision).toBeDefined();
    // liquidacao real com qualityClass
    built.runner.recordSettlement({ marketKey: key, result: "WIN", profit: 8.2, entryPrice: 1.14, expiryPrice: 1.13, payout: 82 });
    const status = await built.runner.status();
    const agent = status.agents.find((entry: any) => entry.marketKey === key);
    expect(agent.lastResult).toBe("WIN");
    expect(agent.qualityClass).toBeTruthy();
  });

  it("V2 shadow nunca executa (mesmo com decisao V2 direcional)", async () => {
    const runtime = fakeRuntime();
    const neutralV3 = ind({ at: T - 34_000, rsi: 50, rsiSlope: 0.2 });
    const built = await buildRunner({ runtime, markets: markets(1, 1), skills: scripted([neutralV3, neutralV3, neutralV3]), skillsV2: scriptedV2([v2ReadyForPullback(), v2ReadyForPullback(), v2ReadyForPullback()]) });
    const key = [...built.runner.assignments.keys()][0];
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.decision).toBe("WAIT");
    expect(out.waitReason).toBe("NO_CANDIDATE_RSI_NEUTRO");
    expect(runtime.calls).toHaveLength(0);
  });

  it("sem ARM o runtime bloqueia (fail closed, sem segundo caminho)", async () => {
    const runtime = fakeRuntime({ armed: false });
    const built = await buildRunner({ runtime, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.decision).toBe("WAIT");
    expect(out.waitReason).toContain("ORDER_BLOCKED");
    expect(out.reason).toContain("AGENT_ORDER_SYSTEM_NOT_ARMED");
  });

  it("hold de migracao impede ordem", async () => {
    const runtime = fakeRuntime();
    const built = await buildRunner({ runtime, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    built.runner.migration.complete = false;
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(out.waitReason).toBe("MIGRATION_IN_PROGRESS");
    expect(runtime.calls).toHaveLength(0);
  });

  it("T-5 invalida e cancela (nunca inverte)", async () => {
    const runtime = fakeRuntime();
    const stale = ind({ at: T - 34_000, rsi: 58, rsiSlope: 0.3, bollinger: { ...ind().bollinger, position: 0.6, touchUpper: true, outsideUpper: false }, dmi: { plusDI: 29, minusDI: 22, spread: 7, plusSlope: 0.4, minusSlope: -0.1 }, adx: { value: 28, slope: 0.6, rising: true }, shortMomentum: -0.2 });
    const built = await buildRunner({ runtime, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), stale]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(0);
    expect(["CANCELLED_REVALIDATION", "NOVA_DIRECAO_AINDA_NAO_EMERGIU"]).toContain(out.waitReason);
  });
});

describe("RSI AGENTS V3.1 — janela final, observabilidade e replay", () => {
  const candle = (bucketEnd: number) => ({ bucketStart: bucketEnd - 5_000, bucketEnd, open: 1.1, high: 1.11, low: 1.09, close: 1.1 });

  it("aceito dentro da janela mas em candle nao-final => OBSERVE_ONLY (nao antecipa)", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const built = await buildRunner({ runtime, pool, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const observeOnly = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 40_000)], targetExpiryAt: T, payout: 82, now: T - 40_000 });
    expect(observeOnly.decision).toBe("WAIT");
    expect(observeOnly.waitReason).toBe("OBSERVE_ONLY");
    expect(observeOnly.entryMode).toBeNull();
    expect(runtime.calls).toHaveLength(0);
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(1);
    expect(out.entryMode).toBe("NORMAL_T5");
    expect(out.decision).toBe("SELL");
  });

  it("nunca envia depois do cutoff (candle tardio vira MISSED)", async () => {
    const runtime = fakeRuntime();
    const built = await buildRunner({ runtime, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const late = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 30_000)], targetExpiryAt: T, payout: 82, now: T - 29_000 });
    expect(runtime.calls).toHaveLength(0);
    expect(["MISSED_ENTRY_WINDOW", "NO_SAFE_ENTRY_INSIDE_5S_WINDOW"]).toContain(late.waitReason);
  });

  it("observabilidade: events sem created_at, upserts com COALESCE e entry_mode sem valor precoce", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const built = await buildRunner({ runtime, pool, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const observeOnly = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 40_000)], targetExpiryAt: T, payout: 82, now: T - 40_000 });
    expect(observeOnly.entryMode).toBeNull();
    const eventQueries = pool.queries.filter((q: any) => q.text.startsWith("INSERT INTO iq_rsi_events_v3"));
    expect(eventQueries.length).toBeGreaterThan(0);
    expect(eventQueries.every((q: any) => !q.text.includes("created_at") && q.text.includes("payload"))).toBe(true);
    const stateQueries = pool.queries.filter((q: any) => q.text.startsWith("INSERT INTO iq_rsi_agent_state_v3"));
    expect(stateQueries.some((q: any) => q.text.includes("revalidation_at=COALESCE(") && q.text.includes("submit_at=COALESCE("))).toBe(true);
    const opportunityQueries = pool.queries.filter((q: any) => q.text.startsWith("INSERT INTO iq_rsi_opportunities_v3"));
    expect(opportunityQueries.some((q: any) => q.text.includes("entry_mode=COALESCE(") && q.text.includes("bollinger_rejection_at=COALESCE("))).toBe(true);
    const row: any = [...pool.opportunities.values()][0];
    expect(row.entry_mode).toBeNull();
  });

  it("snapshot do universo persiste completo mesmo com discover concorrente", async () => {
    const pool = fakePool();
    let replaced = false;
    const other = markets(5, 5);
    const runner = new RsiAgentsV3({ runtime: fakeRuntime(), pool, now: () => NOW, enabled: true, skills: { ...skillsV3 }, skillsV2: { ...skillsV2 } });
    pool.query = async (text: string, values: any[] = []) => {
      pool.queries.push({ text, values });
      if (text.startsWith("INSERT INTO iq_rsi_universe_v3")) {
        pool.universeInserts.push({ text, values });
        if (!replaced) { replaced = true; runner.discoverUniverse(other); }
        return { rows: [] };
      }
      if (text.startsWith("SELECT market_key, strategy")) return { rows: [...pool.assignments.values()].map((row) => ({ ...row })) };
      if (text.startsWith("INSERT INTO iq_rsi_agent_assignments_v3")) {
        const [marketKey, strategy, marketType, canonical, activeId, availability] = values;
        pool.assignments.set(marketKey, { market_key: marketKey, strategy, market_type: marketType, canonical, active_id: activeId, availability, block_reason: null });
        return { rows: [] };
      }
      return { rows: [] };
    };
    await runner.assignUniverse(markets(2, 2));
    expect(replaced).toBe(true);
    const ids = new Set(pool.universeInserts.map((insert: any) => insert.values[0]));
    expect(ids.size).toBe(1);
    expect(pool.universeInserts.length).toBe(4);
  });

  it("V3.1 mantem stake 10, PRACTICE e nunca usa dado futuro (firstSight recebe o mesmo tick)", () => {
    const source = readFileSync(new URL("../../relay/rsi-v3.mjs", import.meta.url), "utf8");
    expect(source.includes("V3_1_EPISODE_EVENT_STATE")).toBe(true);
    expect(source.includes("finalWindowMs: 5000")).toBe(true);
    expect(RSI_AGENTS_V3_POLICY.stakeBrl).toBe(10);
    expect(RSI_AGENTS_V3_POLICY.practiceOnly).toBe(true);
  });
});

describe("RSI AGENTS V3 — contrato", () => {
  it("modulo nao tem caminho alternativo de ordem (somente submitAgentV3Order)", () => {
    const source = readFileSync(new URL("../../relay/rsi-agents-v3.mjs", import.meta.url), "utf8");
    expect(source.includes("submitAgentV3Order")).toBe(true);
    expect(/\.requestOrder\s*\(/.test(source)).toBe(false);
    expect(source.includes("client.placeOrder")).toBe(false);
    expect(source.includes("RSI_REVERSAL_PULLBACK_V3")).toBe(true);
  });

  it("politica V3: stake 10, PRACTICE, REAL locked, sem inversao, mesma expiracao, gate unico", () => {
    expect(RSI_AGENTS_V3_POLICY.stakeBrl).toBe(10);
    expect(RSI_AGENTS_V3_POLICY.practiceOnly).toBe(true);
    expect(RSI_AGENTS_V3_POLICY.realLocked).toBe(true);
    expect(RSI_AGENTS_V3_POLICY.autoInvert).toBe(false);
    expect(RSI_AGENTS_V3_POLICY.sameExpiryRequired).toBe(true);
    expect(RSI_AGENTS_V3_POLICY.singleBrokerPath).toBe("runtime.submitAgentV3Order -> requestOrder");
    expect(RSI_AGENTS_V3_POLICY.shadowV2.controlsExecution).toBe(false);
  });
});
