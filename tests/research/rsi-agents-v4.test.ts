/**
 * RSI AGENTS V4 — testes do runner: BINARY (janela final + revalidacao), BLITZ (imediato + fail-closed),
 * MESAS (disable cancela), watch preservado, entrySnapshot imutavel, export first-10 e sanitizacao.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const agentsV4 = await import("../../relay/rsi-agents-v4.mjs");
// @ts-expect-error - relay ESM sem tipagem
const coreV4 = await import("../../relay/rsi-v4.mjs");

const { RsiAgentsV4, RSI_V4_EXECUTION_ALLOWLIST, buildV4TradePackage, buildV4Summary } = agentsV4;
const { RSI_V4_POLICY } = coreV4;
const NOW = 1_800_000_000_000;
const T = Math.ceil(NOW / 60_000) * 60_000;
const KEY = "EURUSD:OTC";

const ind = (overrides: any = {}) => ({
  at: NOW, status: "NO_OPPORTUNITY", reason: "OK", closedCandles: 120, rsi: 50, rsiPrevious: 50, rsiSlope: 0, rsiBand: "NEUTRAL",
  bollinger: { upper: 1.2, middle: 1.1, lower: 1.0, width: 0.2, widthSlope: 0, expanding: false, position: 0.5, close: 1.1, touchUpper: false, touchLower: false, outsideUpper: false, outsideLower: false },
  dmi: { plusDI: 22, minusDI: 20, spread: 2, spreadSlope: 0, plusSlope: 0, minusSlope: 0 },
  adx: { value: 22, slope: 0, rising: false, falling: false, stabilizing: true, strong: false },
  atr: 0.001, structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", shortMomentum: 0, velocity: 0, acceleration: 0,
  noisePerCandle: 0.001, noiseHorizon: 0.00346, realizedVolatility: 0.001,
  bandRiding: { upper: false, lower: false }, strongContinuation: { upper: false, lower: false },
  dominantDI: "BALANCED", rejectionUpperNow: false, rejectionLowerNow: false,
  ...overrides,
});
const candidate = () => ind({ rsi: 24, rsiSlope: -0.4, bollinger: { ...ind().bollinger, position: 0.04, close: 1.0, lower: 1.0, touchLower: true, outsideLower: true }, dmi: { plusDI: 20, minusDI: 32, spread: -12, plusSlope: -0.2, minusSlope: 0.6 }, adx: { value: 30, slope: 0.7, rising: true } });
const ready = () => ind({ rsi: 36, rsiSlope: 1.3, bollinger: { ...ind().bollinger, position: 0.6, close: 1.03, lower: 1.0, middle: 1.1, touchLower: true }, dmi: { plusDI: 27, minusDI: 23, spread: 4, spreadSlope: 2, plusSlope: 1.5, minusSlope: -1.1 }, adx: { value: 24, slope: -0.4, falling: true }, shortHorizonDirection: "BULLISH", shortMomentum: 0.9, velocity: 0.7, rejectionLowerNow: true });
const blocked = () => ind({ rsi: 40, rsiSlope: -0.9, bollinger: { ...ind().bollinger, position: 0.5, close: 1.02, lower: 1.0, middle: 1.1 }, dmi: { plusDI: 18, minusDI: 31, spread: -13, plusSlope: -0.5, minusSlope: 0.4 }, adx: { value: 31, slope: 0.9, rising: true }, shortHorizonDirection: "BEARISH", shortMomentum: -1.1, velocity: -0.8 });

const scripted = (snapshots: any[]) => {
  let index = 0;
  return { evaluateIndicatorsV4: () => { const snapshot = snapshots[Math.min(index, snapshots.length - 1)]; index += 1; return snapshot; } };
};

const fakeRuntime = (options: any = {}) => {
  const calls: any[] = [];
  return {
    calls,
    submitAgentV4Order: async (input: any) => {
      calls.push(input);
      if (options.blitzUnsupported && String(input.instrumentType).startsWith("BLITZ")) { const error: any = new Error("BLITZ_ORDER_PATH_UNSUPPORTED"); error.code = "BLITZ_ORDER_PATH_UNSUPPORTED"; throw error; }
      return { state: "ACKNOWLEDGED", brokerOrderId: 777, executionId: "exec-v4", stake: 10, stakeRequested: 10 };
    },
  };
};

const fakePool = () => {
  const opportunities = new Map<string, any>();
  const events: any[] = [];
  const exportTrades: any[] = [];
  const exportSummaries: any[] = [];
  const states: any[] = [];
  const query = async (text: string, values: any[] = []) => {
    if (text.startsWith("INSERT INTO iq_rsi_opportunities_v4")) {
      const row = opportunities.get(values[0]) ?? {};
      Object.assign(row, { opportunity_id: values[0], market_key: values[1], instrument_type: values[3], direction: values[13], accepted: values[16], entry_price: values[31], submit_at: values[47] ?? row.submit_at ?? null });
      opportunities.set(values[0], row);
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO iq_rsi_events_v4")) { events.push({ event: values[4], reason: values[6], payload: JSON.parse(values[7] ?? "{}") }); return { rows: [] }; }
    if (text.startsWith("INSERT INTO iq_rsi_agent_state_v4")) { states.push({ values }); return { rows: [] }; }
    if (text.startsWith("SELECT count(*)::int AS n FROM iq_v4_export_trades")) return { rows: [{ n: exportTrades.length }] };
    if (text.startsWith("INSERT INTO iq_v4_export_trades")) { exportTrades.push({ instrument: values[1], duration: values[2], number: values[3], package: JSON.parse(values[4]) }); return { rows: [] }; }
    if (text.startsWith("SELECT package FROM iq_v4_export_trades")) return { rows: exportTrades.map((row) => ({ package: row.package })) };
    if (text.startsWith("INSERT INTO iq_v4_export_summary")) { exportSummaries.push({ instrument: values[1], summary: JSON.parse(values[3]) }); return { rows: [] }; }
    return { rows: [] };
  };
  return { query, opportunities, events, exportTrades, exportSummaries, states };
};

const build = async (options: any = {}) => {
  const pool = options.pool ?? fakePool();
  const runtime = options.runtime ?? fakeRuntime();
  const runner = new RsiAgentsV4({
    pool, runtime, now: () => options.now ?? NOW, enabled: true,
    skills: { ...coreV4, ...(options.skills ?? {}) },
  });
  runner.assignUniverse(options.instruments ?? [
    { marketKey: KEY, instrumentType: "BINARY", durationSeconds: 60, marketType: "OTC", canonical: "EURUSD", enabled: true, availability: "OPEN", activeId: 76, payout: 87 },
    { marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, marketType: "OTC", canonical: "EURUSD", enabled: true, availability: "OPEN", activeId: 76, payout: 80 },
  ]);
  return { runner, runtime, pool };
};

const candle = (bucketEnd: number) => ({ bucketStart: bucketEnd - 5_000, bucketEnd, open: 1.1, high: 1.11, low: 1.09, close: 1.1 });
const eventNames = (pool: any) => pool.events.map((row: any) => row.event);

describe("RSI AGENTS V4 — BINARY", () => {
  it("candidate -> watch -> janela final -> ordem BINARY unica R$10 com evidencia completa", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), ready(), ready()]) });
    const first = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    expect(first.watch?.watchMode).toBe("ACTIVE_CANDIDATE");
    expect(built.runner.hasActiveCandidate(KEY, "BINARY")).toBe(true);
    expect(eventNames(pool)).toContain("ACTIVE_WATCH_STARTED");
    const observeOnly = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 40_000)], targetExpiryAt: T, payout: 87, now: T - 40_000 });
    expect(observeOnly.waitReason).toBe("OBSERVE_ONLY");
    expect(runtime.calls).toHaveLength(0);
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 34_000 });
    expect(out.decision).toBe("BUY");
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].instrumentType).toBe("BINARY");
    expect(runtime.calls[0].stake).toBe(10);
    expect(runtime.calls[0].expectedStake).toBe(10);
    expect(runtime.calls[0].direction).toBe("BUY");
    expect(runtime.calls[0].entryMode).toBe("NORMAL_T5");
    const row: any = [...pool.opportunities.values()][0];
    expect(row.instrument_type).toBe("BINARY");
    const entryEvents = pool.events.filter((event: any) => event.event === "ORDER_SUBMITTED");
    expect(entryEvents).toHaveLength(1);
    expect(eventNames(pool)).toContain("FINAL_EVALUATION");
  });

  it("hard counter-evidence no momento da ordem => bloqueio fail-closed sem ordem", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), blocked(), blocked()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 40_000)], targetExpiryAt: T, payout: 87, now: T - 40_000 });
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(0);
    expect(String(out.waitReason)).toContain("CONTRA_EVIDENCIA");
    expect(out.counterEvidence.some((row: any) => row.severity === "HARD")).toBe(true);
  });

  it("nunca envia depois do cutoff (MISSED fail-closed)", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), ready()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    const late = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 30_000)], targetExpiryAt: T, payout: 87, now: T - 29_000 });
    expect(late.waitReason).toBe("MISSED_ENTRY_WINDOW");
    expect(runtime.calls).toHaveLength(0);
    expect(eventNames(pool)).toContain("MISSED_ENTRY_WINDOW");
  });
});

describe("RSI AGENTS V4 — BLITZ 45s", () => {
  it("confirmacao imediata => submit BLITZ_45S (nao espera minuto cheio)", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), ready()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 80, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: [candle(T - 47_000)], targetExpiryAt: T, payout: 80, now: T - 46_000 });
    expect(out.decision).toBe("BUY");
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].instrumentType).toBe("BLITZ_45S");
    expect(runtime.calls[0].durationSeconds).toBe(45);
    expect(runtime.calls[0].entryMode).toBe("BLITZ_IMMEDIATE");
    expect(runtime.calls[0].expiryAt).toBe((T - 46_000) + 45_000);
    expect(eventNames(pool)).toContain("BLITZ_CONFIRMED");
  });

  it("sem caminho de ordem verificado => BLITZ_ORDER_PATH_UNSUPPORTED (nunca simula)", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime({ blitzUnsupported: true });
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), ready()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 80, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: [candle(T - 47_000)], targetExpiryAt: T, payout: 80, now: T - 46_000 });
    expect(out.waitReason).toBe("ORDER_BLOCKED_BLITZ_ORDER_PATH_UNSUPPORTED");
    expect(built.runner.counters.blitzUnsupported).toBe(1);
    expect(eventNames(pool)).toContain("BLITZ_ORDER_PATH_UNSUPPORTED");
  });

  it("BLITZ nao e mais permissivo: candidato sem confirmacao nao entra", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), candidate(), candidate()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 80, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: [candle(T - 55_000)], targetExpiryAt: T, payout: 80, now: T - 54_000 });
    expect(out.decision).toBe("WAIT");
    expect(runtime.calls).toHaveLength(0);
  });
});

describe("RSI AGENTS V4 — MESAS / universo", () => {
  it("instrumento desabilitado: sem candidate novo e cancelamento auditavel", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), ready()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    expect(built.runner.hasActiveCandidate(KEY, "BINARY")).toBe(true);
    built.runner.assignUniverse([
      { marketKey: KEY, instrumentType: "BINARY", durationSeconds: 60, marketType: "OTC", canonical: "EURUSD", enabled: false, availability: "OPEN", activeId: 76, payout: 87 },
      { marketKey: KEY, instrumentType: "BLITZ_45S", durationSeconds: 45, marketType: "OTC", canonical: "EURUSD", enabled: false, availability: "OPEN", activeId: 76, payout: 80 },
    ]);
    expect(built.runner.hasActiveCandidate(KEY, "BINARY")).toBe(false);
    expect(eventNames(pool)).toContain("MARKET_DISABLED_BY_USER");
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 50_000)], targetExpiryAt: T, payout: 87, now: T - 49_000 });
    expect(out.waitReason).toBe("MARKET_DISABLED_BY_USER");
    expect(runtime.calls).toHaveLength(0);
  });
});

describe("RSI AGENTS V4 — export first-10 e sanitizacao", () => {
  it("settlement alimenta pacote e summary SEM segredos", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime, skills: scripted([candidate(), ready(), ready()]) });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 34_000 });
    await built.runner.recordSettlement({ marketKey: KEY, instrumentType: "BINARY", result: "WIN", profit: 8.7, entryPrice: 1.03, expiryPrice: 1.04, payout: 87 });
    expect(pool.exportTrades).toHaveLength(1);
    expect(pool.exportSummaries).toHaveLength(1);
    const serialized = JSON.stringify({ trades: pool.exportTrades, summaries: pool.exportSummaries });
    for (const forbidden of ["ssid", "token", "cookie", "password", "authorization", "secret", "bearer", "balance_id", "user_balance"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
    const pkg = pool.exportTrades[0].package;
    expect(pkg.schema).toBe("tracecon-v4-trade-v1");
    expect(pkg.strategyVersion).toBe("v4");
    expect(pkg.instrumentType).toBe("BINARY");
    expect(pkg.settlement.result).toBe("WIN");
    expect(pkg.entrySnapshot.counterEvidenceAtEntry).toBeDefined();
    expect(pkg.entrySnapshot.entryReason.length).toBeGreaterThan(0);
    expect(Array.isArray(pkg.evaluations)).toBe(true);
    expect(pkg.timing.fixedExpiry).toBe(T);
  });

  it("buildV4Summary nao declara edge e separa por instrumento", () => {
    const packageRow = { settlement: { result: "WIN", profit: 8.6, qualityClass: "NORMAL_WIN", actualCushion: 0.5, payout: 86 }, candidateToEntryMs: 30_000, entrySnapshot: { expectedCushion: 0.4, counterEvidenceAtEntry: [{ code: "REJECTION_FAILED", severity: "SOFT" }] }, payout: 86 };
    const summary = buildV4Summary({ instrumentType: "BINARY", durationSeconds: 60, packages: [packageRow] });
    expect(summary.sampleSize).toBe(1);
    expect(summary.note).toContain("nao e validacao estatistica");
    expect(summary.qualityDistribution.NORMAL_WIN).toBe(1);
    expect(summary.counterEvidenceDistribution.REJECTION_FAILED).toBe(1);
  });
});

describe("RSI AGENTS V4 — contrato", () => {
  it("allowlist exata, stake 10, PRACTICE only e sem caminho alternativo", () => {
    expect(RSI_V4_EXECUTION_ALLOWLIST).toEqual(["agent-v4:RSI_REVERSAL_V4"]);
    expect(RSI_V4_POLICY.stakeBrl).toBe(10);
    expect(RSI_V4_POLICY.practiceOnly).toBe(true);
    expect(RSI_V4_POLICY.realLocked).toBe(true);
    expect(RSI_V4_POLICY.blitzDurationSeconds).toBe(45);
  });

  it("universeEmpty sinaliza MESAS 0/N (auditoria: nunca silencioso)", () => {
    const runner = new RsiAgentsV4({ enabled: true, now: () => NOW });
    runner.assignUniverse([
      { marketKey: "AUDJPY:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: false, availability: "OPEN" },
      { marketKey: "GBPUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: false, availability: "OPEN" },
    ]);
    expect(runner.universe.enabled).toBe(0);
    expect(runner.universe.total).toBe(2);
    expect(runner.status().universeEmpty).toBe(true);
    expect(runner.status().blockedReason).toBe("MESAS_ZERO_ENABLED");
    runner.assignUniverse([
      { marketKey: "AUDJPY:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: true, availability: "OPEN" },
      { marketKey: "GBPUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, enabled: false, availability: "OPEN" },
    ]);
    expect(runner.status().universeEmpty).toBe(false);
    expect(runner.status().blockedReason).toBe(null);
    runner.assignUniverse([]);
    expect(runner.status().universeEmpty).toBe(false);
  });

  it("mapV4EventRow entrega payload publico e estavel (sem campos internos)", () => {
    const mapped = agentsV4.mapV4EventRow({
      id: 42, at: new Date("2026-09-19T22:14:55.115Z"), market_key: "AUDJPY:OTC", instrument_type: "BINARY",
      agent_id: "RSI_REVERSAL_V4:AUDJPY:OTC", strategy_id: "RSI_REVERSAL_V4", event: "CANDIDATE_CREATED",
      decision: "BUY", reason: "RSI_EXTREME_BUY_30", payload: { candidateRsi: 27.4 }, password: "nunca",
    });
    expect(mapped).toEqual({
      id: 42, at: "2026-09-19T22:14:55.115Z", marketKey: "AUDJPY:OTC", instrumentType: "BINARY",
      agentId: "RSI_REVERSAL_V4:AUDJPY:OTC", strategyId: "RSI_REVERSAL_V4", event: "CANDIDATE_CREATED",
      decision: "BUY", reason: "RSI_EXTREME_BUY_30", payload: { candidateRsi: 27.4 },
    });
    const sparse = agentsV4.mapV4EventRow({});
    expect(sparse.marketKey).toBe(null);
    expect(sparse.strategyId).toBe("RSI_REVERSAL_V4");
  });
});
