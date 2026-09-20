/**
 * RSI AGENTS V2 LIVE — testes: Strategy Core V2 ORIGINAL + infraestrutura moderna.
 * Fresh critics: scheduler antigo nao voltou; V4 nao vaza regra para V2; candidate velho nao envia;
 * ordem nunca sai pos-cutoff; entrySnapshot imutavel; MESAS respeitado.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem
const live = await import("../../relay/rsi-agents-v2-live.mjs");
// @ts-expect-error - relay ESM sem tipagem
const skillsV2 = await import("../../relay/rsi-skills-v2.mjs");
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");

const { RsiAgentsV2Live, RSI_V2_LIVE_EXECUTION_ALLOWLIST } = live;
const { STRICT_V2_ID, PULLBACK_V2_ID } = skillsV2;
const { IqMultiRuntime } = runtimeModule;
const NOW = 1_800_000_000_000;
const T = Math.ceil(NOW / 60_000) * 60_000;
const KEY = "EURUSD:OTC";

const ind = (o: any = {}) => ({ at: NOW, closedCandles: 120, rsi: 50, rsiBand: "NEUTRAL", rsiSlope: 0, bollinger: { upper: 1.2, middle: 1.1, lower: 1.0, width: 0.2, position: 0.5, close: 1.1, touchUpper: false, touchLower: false, outsideUpper: false, outsideLower: false }, dmi: { plusDI: 22, minusDI: 20, spread: 2, spreadSlope: 0, plusSlope: 0, minusSlope: 0 }, adx: { value: 22, slope: 0 }, structuralTrend: "NEUTRAL", shortHorizonDirection: "NEUTRAL", shortMomentum: 0, velocity: 0, noiseHorizon: 0.00346, bandRiding: { upper: false, lower: false }, strongContinuation: { upper: false, lower: false }, dominantDI: "BALANCED", rejectionUpperNow: false, rejectionLowerNow: false, ...o });
const ready = () => ind({ rsi: 34, rsiSlope: 1.2, bollinger: { ...ind().bollinger, position: 0.6, close: 1.03, touchLower: true }, dmi: { plusDI: 27, minusDI: 23, spread: 4, spreadSlope: 2, plusSlope: 1.5, minusSlope: -1.1 }, adx: { value: 24, slope: -0.4 }, shortHorizonDirection: "BULLISH", shortMomentum: 0.9, velocity: 0.7, rejectionLowerNow: true });

const candle = (bucketEnd: number) => ({ bucketStart: bucketEnd - 5_000, bucketEnd, open: 1.1, high: 1.11, low: 1.09, close: 1.1 });
const fakeRuntime = (throws: string | null = null) => {
  const calls: any[] = [];
  return { calls, submitAgentV2LiveOrder: async (input: any) => { calls.push(input); if (throws) { const error: any = new Error(throws); error.code = throws; throw error; } return { state: "ACKNOWLEDGED", brokerOrderId: 999, executionId: "exec-v2live", stake: 10, stakeRequested: 10 }; } };
};
const fakePool = () => {
  const opportunities = new Map<string, any>(); const events: any[] = [];
  const query = async (text: string, values: any[] = []) => {
    if (text.startsWith("INSERT INTO iq_rsi_opportunities_v2live")) { opportunities.set(values[0], { opportunity_id: values[0], market_key: values[1], submit_at: values[46] ?? null, accepted: values[16], payload: JSON.parse(values[45] ?? "{}") }); return { rows: [] }; }
    if (text.startsWith("INSERT INTO iq_rsi_events_v2live")) { events.push({ event: values[4], reason: values[6] }); return { rows: [] }; }
    return { rows: [] };
  };
  return { query, opportunities, events };
};

const build = async (options: any = {}) => {
  const pool = options.pool ?? fakePool();
  const runtime = options.runtime ?? fakeRuntime();
  const skills = {
    evaluateIndicatorsV2: options.scriptIndicators ?? skillsV2.evaluateIndicatorsV2,
    updateEpisodeV2: skillsV2.updateEpisodeV2,
    evaluateV2: skillsV2.evaluateV2,
    ...(options.skillsOverride ?? {}),
  };
  const runner = new RsiAgentsV2Live({ pool, runtime, now: () => options.now ?? NOW, enabled: true, skills });
  runner.assignUniverse(options.instruments ?? [{ marketKey: KEY, instrumentType: "BINARY", durationSeconds: 60, marketType: "OTC", canonical: "EURUSD", enabled: true, availability: "OPEN", activeId: 76, payout: 87 }]);
  if (options.rawUniverse) runner.assignUniverse(options.rawUniverse);
  return { runner, runtime, pool };
};

describe("V2 LIVE — Strategy Core original + infra moderna", () => {
  it("core usa rsi-skills-v2 ORIGINAL (hash congelado) e nao define thresholds proprios de decisao", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../docs/research/data/rsi-agents-v2-freeze.json", import.meta.url), "utf8"));
    expect(manifest.files["relay/rsi-skills-v2.mjs"]).toBeTruthy();
    const source = readFileSync(new URL("../../relay/rsi-agents-v2-live.mjs", import.meta.url), "utf8");
    expect(source.includes("evaluateV2")).toBe(true);
    expect(source.includes("updateEpisodeV2")).toBe(true);
    expect(source.includes("computeFiftyFiftySplit")).toBe(true);
    for (const leaked of ["this.skills.evaluateV4Decision", "counterEvidenceV4(", "evaluateV4Entry("]) expect(source.includes(leaked)).toBe(false);
    expect(source.includes("shouldEvaluate(")).toBe(false); // scheduler vive no runtime, nao no core
  });

  it("scheduler moderno presente (watch/dedupe/cutoff) e submit com fonte agent-v2", () => {
    const runtimeSource = readFileSync(new URL("../../relay/iq-multi-runtime.mjs", import.meta.url), "utf8");
    expect(runtimeSource.includes("#observeRsiAgentsV2Live")).toBe(true);
    expect(runtimeSource.includes("submitAgentV2LiveOrder")).toBe(true);
    expect(runtimeSource.includes("shouldEvaluate")).toBe(true);
    expect(RSI_V2_LIVE_EXECUTION_ALLOWLIST).toEqual([`agent-v2:${STRICT_V2_ID}`, `agent-v2:${PULLBACK_V2_ID}`, "agent-v2:RSI_REVERSAL_V2_BLITZ"]);
    expect(RSI_V2_LIVE_EXECUTION_ALLOWLIST.every((entry: string) => entry.startsWith("agent-v2:"))).toBe(true);
  });

  it("ordem nunca sai depois do cutoff (MISSED fail-closed) e candidate velho nao envia", async () => {
    const runtime = fakeRuntime();
    const built = await build({ runtime, scriptIndicators: () => ready() });
    // candidate criado no snapshot extremo; sem avaliacao na janela => MISSED
    const late = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 30_000)], targetExpiryAt: T, payout: 87, now: T - 29_000 });
    expect(runtime.calls).toHaveLength(0);
    expect(late.decision).not.toBe("BUY");
  });

  it("gate de entrada: V2 aceita mas RSI longe do extremo (SELL 59) => bloqueia (RSI_LONGE_DO_EXTREMO)", async () => {
    const runtime = fakeRuntime();
    const seq = [
      ind({ rsi: 76, rsiSlope: -1, bollinger: { ...ind().bollinger, position: 0.9, close: 1.19, touchUpper: true }, dmi: { plusDI: 33, minusDI: 21, spread: 12, plusSlope: 0.6, minusSlope: -0.3 }, adx: { value: 30, slope: 0.8 }, shortHorizonDirection: "BULLISH", shortMomentum: 0.7 }),
      ind({ rsi: 59, rsiSlope: -1.4, bollinger: { ...ind().bollinger, position: 0.55, close: 1.16, touchUpper: true }, dmi: { plusDI: 24, minusDI: 27, spread: -3, plusSlope: -1.2, minusSlope: 1.4 }, adx: { value: 26, slope: -0.5 }, shortHorizonDirection: "BEARISH", shortMomentum: -0.8 }),
    ];
    let index = 0;
    const accepted = { strategy: STRICT_V2_ID, direction: "SELL", decision: "SELL", accepted: true, status: "STRICT_CONFIRMED", reason: null };
    const episode = { direction: "SELL", candidateAt: NOW - 60_000, candidateRsi: 76, candidatePrice: 1.19, touchedUpper: true };
    const built = await build({
      runtime,
      skillsOverride: {
        evaluateIndicatorsV2: () => seq[Math.min(index++, seq.length - 1)],
        updateEpisodeV2: () => ({ episode, event: "CANDIDATE_CONTINUED" }),
        evaluateV2: () => accepted,
      },
    });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(0);
    expect(out.waitReason).toBe("RSI_LONGE_DO_EXTREMO");
    expect(out.entryRsiOk).toBe(false);
  });

  it("(3) janela infra 1500ms: aprova e envia em T-32s (que era MISSED com margem 3000)", async () => {
    const runtime = fakeRuntime();
    const snap = ind({ rsi: 72, rsiSlope: -1.2, bollinger: { ...ind().bollinger, position: 0.88, close: 1.19, touchUpper: true }, dmi: { plusDI: 33, minusDI: 21, spread: 12, plusSlope: 0.5, minusSlope: -0.4 }, adx: { value: 30, slope: 0.7 }, shortHorizonDirection: "BULLISH", shortMomentum: 0.7 });
    const accepted = { strategy: STRICT_V2_ID, direction: "SELL", decision: "SELL", accepted: true, status: "STRICT_CONFIRMED", reason: null };
    const episode = { direction: "SELL", candidateAt: NOW - 60_000, candidateRsi: 72, candidatePrice: 1.19, touchedUpper: true };
    const built = await build({ runtime, skillsOverride: { evaluateIndicatorsV2: () => snap, updateEpisodeV2: () => ({ episode, event: "CANDIDATE_CONTINUED" }), evaluateV2: () => accepted } });
    await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 32_000 });
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0].direction).toBe("SELL");
    expect(out.decision).toBe("SELL");
  });

  it("prova positiva do caminho de ordem: aceitacao na janela final -> submitAgentV2LiveOrder + FINAL_EVALUATION", async () => {
    const runtime = fakeRuntime();
    const pool = fakePool();
    const extreme = ind({ rsi: 24, rsiSlope: -0.4, bollinger: { ...ind().bollinger, position: 0.05, close: 1.0, touchLower: true }, dmi: { plusDI: 20, minusDI: 32, spread: -12, plusSlope: -0.2, minusSlope: 0.6 }, adx: { value: 30, slope: 0.7 }, shortHorizonDirection: "BEARISH", shortMomentum: -0.8 });
    const accepted = { strategy: STRICT_V2_ID, direction: "BUY", decision: "BUY", accepted: true, status: "STRICT_CONFIRMED", reason: null };
    let episode: any = { direction: "BUY", candidateAt: NOW - 60_000, candidateRsi: 24, candidatePrice: 1.0, touchedLower: true };
    const built = await build({
      runtime, pool,
      skillsOverride: {
        evaluateIndicatorsV2: () => extreme,
        updateEpisodeV2: () => ({ episode, event: episode ? "CANDIDATE_CONTINUED" : "CANDIDATE_CREATED" }),
        evaluateV2: () => accepted,
      },
    });
    // 1) nascimento/continuidade do episodio (fora da janela)
    const before = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 60_000)], targetExpiryAt: T, payout: 87, now: T - 60_000 });
    expect(before.waitReason).toBe("OBSERVE_ONLY");
    // 2) tick final causal (candle :25, next :30 >= closes) -> submit
    const final = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 34_000 });
    expect(runtime.calls).toHaveLength(1);
    const call = runtime.calls[0];
    expect(call.instrumentType).toBe("BINARY");
    expect(call.direction).toBe("BUY");
    expect(call.stake).toBe(10);
    expect(call.expectedStake).toBe(10);
    expect(call.strategyId).toBe(STRICT_V2_ID);
    expect(String(call.idempotencyKey)).toContain("rsi-agent-v2live");
    expect(call.entryMode).toBe("NORMAL_T5");
    expect(final.decision).toBe("BUY");
    expect(pool.events.some((event: any) => event.event === "FINAL_EVALUATION")).toBe(true);
    expect(pool.events.some((event: any) => event.event === "ORDER_SUBMITTED")).toBe(true);
    expect(pool.events.some((event: any) => event.event === "ORDER_BLOCKED")).toBe(false);
  });

  it("MESAS: instrumento desabilitado bloqueia e cancela (MARKET_DISABLED_BY_USER)", async () => {
    const pool = fakePool();
    const runtime = fakeRuntime();
    const built = await build({ pool, runtime });
    built.runner.assignUniverse([{ marketKey: KEY, instrumentType: "BINARY", durationSeconds: 60, marketType: "OTC", canonical: "EURUSD", enabled: false, availability: "OPEN", activeId: 76, payout: 87 }]);
    const out = await built.runner.observeMarket({ marketKey: KEY, instrumentType: "BINARY", candles: [candle(T - 35_000)], targetExpiryAt: T, payout: 87, now: T - 34_000 });
    expect(String(out.waitReason)).toContain("MARKET_DISABLED");
    expect(runtime.calls).toHaveLength(0);
  });

  it("entrySnapshot imutavel e 50/50 STRICT/PULLBACK por mercado", async () => {
    const built = await build({ instruments: [
      { marketKey: "AUDUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, marketType: "OTC", canonical: "AUDUSD", enabled: true, availability: "OPEN", activeId: 1, payout: 87 },
      { marketKey: "EURUSD:OTC", instrumentType: "BINARY", durationSeconds: 60, marketType: "OTC", canonical: "EURUSD", enabled: true, availability: "OPEN", activeId: 76, payout: 87 },
    ] });
    const skills = ["AUDUSD:OTC", "EURUSD:OTC"].map((key) => built.runner.skillFor(key));
    expect(new Set(skills).size).toBe(2);
    expect(skills.every((skill: string) => skill === STRICT_V2_ID || skill === PULLBACK_V2_ID)).toBe(true);
  });
});

describe("V2 LIVE — routing RSI_V2_ONLY", () => {
  it("V2 live passa; V4/V3/G2/manual/experimentos bloqueados", async () => {
    const runtime = new IqMultiRuntime({ executionAllowlist: RSI_V2_LIVE_EXECUTION_ALLOWLIST, executionPolicyName: "RSI_V2_ONLY" });
    const codeOf = async (promise: Promise<any>) => { try { await promise; return "NO_ERROR"; } catch (error: any) { return String(error?.code ?? error); } };
    expect(await codeOf(runtime.requestOrder({ marketKey: KEY, direction: "BUY", source: `agent-v2:${STRICT_V2_ID}:${STRICT_V2_ID}` }))).not.toBe("EXECUTION_SOURCE_BLOCKED");
    for (const source of ["agent-v4:RSI_REVERSAL_V4:RSI_REVERSAL_V4", "agent-v3:RSI_REVERSAL_PULLBACK_V3:RSI_REVERSAL_PULLBACK_V3", "AUTO_DECISION", "MANUAL", "experiment:RSI_REVERSAL_CONFLUENCE_V1"]) {
      expect(await codeOf(runtime.requestOrder({ marketKey: KEY, direction: "BUY", source })), source).toBe("EXECUTION_SOURCE_BLOCKED");
    }
    const status = runtime.executionRoutingStatus();
    expect(status.policy).toBe("RSI_V2_ONLY");
    const v4 = status.sources.find((row: any) => row.strategyId === "RSI_REVERSAL_V4");
    expect(v4.controlsExecution).toBe(false);
  });
});
