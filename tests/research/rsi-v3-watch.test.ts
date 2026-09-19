/**
 * RSI AGENTS V3.1 — SCHEDULER/MONITORAMENTO (ACTIVE_CANDIDATE_WATCH / PRIORITY_FINAL_WATCH).
 * Nenhuma regra direcional e testada/alterada aqui: apenas QUANDO e COM QUE FREQUENCIA o snapshot e produzido.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const agentsV3 = await import("../../relay/rsi-agents-v3.mjs");
// @ts-expect-error - relay ESM sem tipagem
const skillsV3 = await import("../../relay/rsi-v3.mjs");
// @ts-expect-error - relay ESM sem tipagem
const skillsV2 = await import("../../relay/rsi-skills-v2.mjs");
// @ts-expect-error - relay ESM sem tipagem
const watchHelpers = await import("../../relay/rsi-v3-watch.mjs");
// @ts-expect-error - relay ESM sem tipagem
const reversalHelpers = await import("../../relay/rsi-reversal.mjs");

const { RsiAgentsV3, RSI_AGENTS_V3_POLICY } = agentsV3;
const { V3_ID, updateEpisodeV3, evaluateV3Entry } = skillsV3;
const { entryWindow } = reversalHelpers;
const { watchModeFor, shouldEvaluate, RSI_V3_WATCH_POLICY } = watchHelpers;

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

const fakeRuntime = () => {
  const calls: any[] = [];
  return {
    calls,
    submitAgentV3Order: async (input: any) => {
      calls.push(input);
      return { state: "ACKNOWLEDGED", brokerOrderId: 555, executionId: "exec-v3", stake: 10, stakeRequested: 10, mode: "PRACTICE" };
    },
  };
};

const fakePool = () => {
  const assignments = new Map<string, any>();
  const opportunities = new Map<string, any>();
  const events: any[] = [];
  const queries: any[] = [];
  const query = async (text: string, values: any[] = []) => {
    queries.push({ text, values });
    if (text.startsWith("SELECT market_key, strategy")) return { rows: [...assignments.values()].map((row) => ({ ...row })) };
    if (text.startsWith("INSERT INTO iq_rsi_agent_assignments_v3")) {
      const [marketKey, strategy, marketType] = values;
      assignments.set(marketKey, { market_key: marketKey, strategy, market_type: marketType, block_reason: null });
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO iq_rsi_opportunities_v3")) {
      const opportunityId = values[0];
      const row = opportunities.get(opportunityId) ?? {};
      Object.assign(row, { opportunity_id: opportunityId, market_key: values[1], direction: values[12], submit_at: values[59] ?? row.submit_at ?? null, revalidation_at: values[58] ?? row.revalidation_at ?? null });
      opportunities.set(opportunityId, row);
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO iq_rsi_events_v3")) { events.push({ text, values }); return { rows: [] }; }
    return { rows: [] };
  };
  return { query, assignments, opportunities, events, queries };
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
  await runner.assignUniverse(options.markets ?? markets());
  return { runner, runtime, pool, advance: (ms: number) => { clock += ms; }, getNow: () => clock };
};

const candle = (bucketEnd: number) => ({ bucketStart: bucketEnd - 5_000, bucketEnd, open: 1.1, high: 1.11, low: 1.09, close: 1.1 });
const eventNames = (pool: any) => pool.events.map((entry: any) => entry.values[3]);
const eventsOf = (pool: any, name: string) => pool.events.filter((entry: any) => entry.values[3] === name);

describe("RSI AGENTS V3.1 — scheduler helper", () => {
  it("candidate ignora throttle generico; dedupe por candle; prioridade perto do cutoff", () => {
    expect(watchModeFor({ hasCandidate: false })).toBe("NORMAL_SCAN");
    expect(watchModeFor({ hasCandidate: true, at: NOW, window: { entryWindowOpensAt: NOW + 20_000 } })).toBe("ACTIVE_CANDIDATE");
    expect(watchModeFor({ hasCandidate: true, at: NOW, window: { entryWindowOpensAt: NOW + 5_000 } })).toBe("PRIORITY_FINAL_WATCH");
    expect(RSI_V3_WATCH_POLICY.candleMs).toBe(5_000);
    expect(shouldEvaluate({ now: 1_000, lastAt: 900, bucketEnd: 1_000, lastBucket: 500, candidateActive: true })).toBe(true);
    expect(shouldEvaluate({ now: 1_000, lastAt: 900, bucketEnd: 1_000, lastBucket: 500, candidateActive: false })).toBe(false);
    expect(shouldEvaluate({ now: 3_100, lastAt: 1_000, bucketEnd: 2_000, lastBucket: 1_000, candidateActive: false })).toBe(true);
    expect(shouldEvaluate({ now: 2_100, lastAt: 1_000, bucketEnd: 1_000, lastBucket: 1_000, candidateActive: true })).toBe(false);
  });

  it("29 ativos no mesmo candle: candidates e scan normal avaliam sem starvation", () => {
    for (let index = 0; index < 29; index += 1) {
      const candidateActive = index % 3 === 0;
      expect(shouldEvaluate({ now: 10_000, lastAt: candidateActive ? 9_100 : 8_000, bucketEnd: 10_000, lastBucket: index, candidateActive })).toBe(true);
    }
  });
});

describe("RSI AGENTS V3.1 — watch do candidate", () => {
  it("candidate recebe avaliacao a cada candle; ACTIVE_WATCH_STARTED + telemetria por candidate", async () => {
    const pool = fakePool();
    const built = await buildRunner({ pool, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    const first = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    expect(first.watch?.watchMode).toBe("ACTIVE_CANDIDATE");
    expect(first.watch?.evaluationCount).toBe(1);
    expect(first.watch?.candidateAt).toBe(T - 60_000);
    expect(eventNames(pool)).toContain("ACTIVE_WATCH_STARTED");
    expect(built.runner.hasActiveCandidate(key)).toBe(true);

    const second = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 55_000)], targetExpiryAt: T, payout: 82, now: T - 55_000 });
    expect(second.watch?.evaluationCount).toBe(2);
    expect(second.watch?.evaluationGapMs).toBe(5_000);
    expect(second.watch?.maxEvaluationGapMs).toBe(5_000);
    expect(second.watch?.timeToExpiryMs).toBe(55_000);
    expect(second.watch?.timeToCutoffMs).toBe(25_000);
  });

  it("PRIORITY_FINAL_WATCH perto do cutoff + FINAL_EVALUATION com lead positivo", async () => {
    const pool = fakePool();
    const built = await buildRunner({ pool, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const pre = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 40_000)], targetExpiryAt: T, payout: 82, now: T - 40_000 });
    expect(pre.watch?.watchMode).toBe("PRIORITY_FINAL_WATCH");
    expect(eventNames(pool)).toContain("PRIORITY_FINAL_WATCH_STARTED");
    expect(pre.decision).toBe("WAIT");
    expect(pre.waitReason).toBe("OBSERVE_ONLY");

    const final = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 82, now: T - 34_000 });
    expect(final.decision).toBe("SELL");
    expect(final.entryMode).toBe("NORMAL_T5");
    expect(eventNames(pool)).toContain("FINAL_EVALUATION");
    expect(final.watch?.finalEvaluationAt).toBe(T - 34_000);
    expect(final.watch?.finalEvaluationLeadMs).toBeGreaterThan(0);
    expect(final.watch?.submitLatencyMs).toBeGreaterThanOrEqual(0);
    const finalEvent = eventsOf(pool, "FINAL_EVALUATION")[0];
    const payload = JSON.parse(finalEvent.values[6]);
    expect(payload.leadMs).toBeGreaterThan(0);
    expect(payload.cutoffLeadMs).toBeGreaterThan(0);
    expect(payload.evaluationCount).toBeGreaterThanOrEqual(3);
    expect(eventNames(pool).filter((name: string) => name === "FINAL_EVALUATION")).toHaveLength(1);
  });

  it("MISSED_ENTRY_WINDOW continua fail-closed e emite telemetria uma vez por candidate/expiry", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await buildRunner({ runtime, pool, markets: markets(1, 1), skills: scripted([sellCandidate(), sellReady(), sellReady(), sellReady()]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    const late = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 30_000)], targetExpiryAt: T, payout: 82, now: T - 29_000 });
    expect(late.waitReason).toBe("MISSED_ENTRY_WINDOW");
    expect(runtime.calls).toHaveLength(0);
    expect(eventsOf(pool, "MISSED_ENTRY_WINDOW")).toHaveLength(1);
    const again = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 25_000)], targetExpiryAt: T, payout: 82, now: T - 24_000 });
    expect(again.waitReason).toBe("MISSED_ENTRY_WINDOW");
    expect(eventsOf(pool, "MISSED_ENTRY_WINDOW")).toHaveLength(1);
  });

  it("candidate expirado sai do watch (ACTIVE_WATCH_CANCELLED) e nao fica preso", async () => {
    const pool = fakePool();
    const built = await buildRunner({ pool, markets: markets(1, 1), skills: scripted([sellCandidate(), ind({ at: NOW, rsi: 50, rsiSlope: 0.1 })]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];
    await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    expect(built.runner.hasActiveCandidate(key)).toBe(true);
    const expiredAt = T - 60_000 + skillsV3.RSI_V3_POLICY.candidateMaxAgeMs + 5_000;
    const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(expiredAt)], targetExpiryAt: T + 60_000, payout: 82, now: expiredAt });
    expect(built.runner.hasActiveCandidate(key)).toBe(false);
    expect(built.runner.watchFor(key)).toBeNull();
    expect(out.waitReason).toBe("CANDIDATE_EXPIRED_AGE");
    expect(eventNames(pool)).toContain("ACTIVE_WATCH_CANCELLED");
  });

  it("restart nao recria candidate fantasma (novo runner comeca em NORMAL_SCAN)", async () => {
    const pool = fakePool();
    const first = await buildRunner({ pool, markets: markets(1, 1), skills: scripted([sellCandidate()]), skillsV2: scriptedV2([]) });
    const key = [...first.runner.assignments.keys()][0];
    await first.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    expect(first.runner.hasActiveCandidate(key)).toBe(true);

    const second = await buildRunner({ pool, markets: markets(1, 1), skills: scripted([ind({ at: NOW, rsi: 50, rsiSlope: 0.1 })]), skillsV2: scriptedV2([]) });
    expect(second.runner.hasActiveCandidate(key)).toBe(false);
    expect(second.runner.watchFor(key)).toBeNull();
    const eventsBeforeNeutral = second.pool.events.length;
    const neutral = await second.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 82, now: T - 60_000 });
    expect(neutral.watch).toBeNull();
    const newEvents = second.pool.events.slice(eventsBeforeNeutral).map((entry: any) => entry.values[3]);
    expect(newEvents.filter((name: string) => name.startsWith("ACTIVE_WATCH"))).toHaveLength(0);
  });

  it("equivalencia: o watch nao altera a decisao da estrategia (mesmo snapshot => mesma avaliacao)", async () => {
    const times = [T - 60_000, T - 55_000, T - 50_000, T - 45_000, T - 40_000, T - 34_000];
    const snapshots = [sellCandidate(), sellReady(), sellReady(), sellReady(), sellReady(), sellReady()];
    const built = await buildRunner({ markets: markets(1, 1), skills: scripted([...snapshots]), skillsV2: scriptedV2([]) });
    const key = [...built.runner.assignments.keys()][0];

    let episode: any = null;
    const expected: any[] = [];
    for (let index = 0; index < times.length; index += 1) {
      const indicators = snapshots[index];
      const at = times[index];
      (episode as any) = updateEpisodeV3({ episode, indicators: { ...indicators, targetExpiryAt: T }, at }).episode ?? null;
      const window = entryWindow({ targetExpiryAt: T, safeMarginMs: 3_000 });
      const evaluation = evaluateV3Entry({ indicators, episode, window, at });
      expected.push({ accepted: evaluation.accepted === true, direction: evaluation.direction ?? "WAIT", stage: evaluation.stage, strength: evaluation.strength, blockers: [...(evaluation.blockers ?? [])] });
    }

    for (let index = 0; index < times.length; index += 1) {
      const at = times[index] as number;
      const out = await built.runner.observeMarket({ marketKey: key, marketType: "OTC", candles: [candle(at)], targetExpiryAt: T, payout: 82, now: at });
      expect({ accepted: out.execEval.accepted === true, direction: out.execEval.direction ?? "WAIT", stage: out.execEval.stage, strength: out.execEval.strength, blockers: [...(out.execEval.blockers ?? [])] }).toEqual(expected[index]);
    }
  });

  it("politica de scheduler nao muda stake/PRACTICE/REAL e nao cria caminho de ordem", () => {
    expect(RSI_AGENTS_V3_POLICY.stakeBrl).toBe(10);
    expect(RSI_AGENTS_V3_POLICY.practiceOnly).toBe(true);
    expect(RSI_AGENTS_V3_POLICY.realLocked).toBe(true);
    expect(V3_ID).toContain("RSI_REVERSAL_PULLBACK_V3");
  });
});
