/** FASE 6.2 — Just-in-Time entry: candido -> janela -> revalidacao final -> commit.
 * Cobre o modulo puro (regras A-G) e a fiação no runtime com relogio deterministico. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const timing = await import("../../relay/entry-timing.mjs");
const { nextEntryWindow, dynamicEntryLeadMs, clampLeadMs, compareCandidateSnapshots, revalidateCandidate, makeCandidate, EntryTimingExperiment, DEFAULT_ENTRY_LEAD_MS, MIN_ENTRY_LEAD_MS, MAX_ENTRY_LEAD_MS } = timing as unknown as Record<string, any>;
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE = Date.UTC(2026, 8, 17, 12, 0, 20); // 12:00:20 UTC (segundos :20)

function brain(action: string, over: Record<string, any> = {}) {
  const setup = over.setup ?? (action === "WAIT" ? "NO_VALID_SETUP" : "TREND_PULLBACK");
  const trigger = over.trigger ?? (action === "WAIT" ? null : "pullback_com_estrutura_mantida");
  const trader = {
    agent: "TRADER", action, setup, trigger, analysisConfidence: action === "WAIT" ? 0 : 0.62, waitReason: action === "WAIT" ? "SEM_SETUP_VALIDO" : null,
    processLog: [{ stage: "DECISION", status: "OK", value: action }], structure: { label: "HH_HL" }, location: { zone: "MEIO_CANAL" },
    momentum: { rsi14: 58, acceleration: 0.001 }, strength: { adx14: 27, diSpread: 12 }, volatility: { atrRatio: 0.0012 }, microstructure: { streak: 2 },
    supportingEvidence: ["setup:" + setup], contradictingEvidence: [], primaryRisk: null, latencyMs: 1,
    ...over.trader,
  };
  const critic = { agent: "CRITIC", traderAssessment: over.criticVerdict ?? (action === "WAIT" ? "CONFIRM" : "CONFIRM"), independentAction: over.criticIndependent ?? action, contradictions: over.criticContradictions ?? [], riskFlags: over.criticRiskFlags ?? [], finalRecommendation: action === "WAIT" ? "WAIT" : action, latencyMs: 1 };
  const consensus = { action, status: over.consensusStatus ?? (action === "WAIT" ? "WAIT" : "CONFIRMED"), reason: action === "WAIT" ? "TRADER_WAIT" : "TRADER_E_CRITIC_ALINHADOS", rules: [], analysisConfidence: action === "WAIT" ? 0 : 0.62, estimatedWinProbability: null, latencyMs: 1 };
  return { trader, critic, consensus, regime: over.regime ?? "TREND_UP", fresh: over.fresh };
}

function fixture({ markets = ["EURUSD:OTC"], serverOffsetMs = 0 }: { markets?: string[]; serverOffsetMs?: number } = {}) {
  const clock = { nowMs: BASE, serverOffsetMs };
  const overrides = new Map<string, any>();
  const runtime = new IqMultiRuntime({
    pool: null, getSsid: () => null, now: () => clock.nowMs, log: () => {}, ackTimeoutMs: 150,
    decisionOverride: ({ marketKey }: any) => { const override = overrides.get(marketKey); return override ? override() : brain("WAIT"); },
  }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-jit", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true, connectedAt: clock.nowMs };
  runtime.connection = { connectionId: "conn-jit", host: "ws.iqoption.com", serverTimeMs: clock.nowMs, clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: true, balanceId: 777, balance: 500, currency: "USD" }, hasReal: true, checkedAt: clock.nowMs, type: "PRACTICE" };
  runtime.config.autoExecute = true; runtime.config.globalMaxStake = 100; runtime.config.calculatedBankrollStake = 1;
  runtime.config.qualityGateEnabled = false; // testes de fiacao JIT usam brains sinteticos; o gate tem testes proprios
  runtime.__sent = [];
  runtime.client = {
    serverNow: () => clock.nowMs + clock.serverOffsetMs,
    placeOrder: (options: Record<string, unknown>) => { runtime.__sent.push(options); return options.requestId; },
    getOptions: async () => ({ response: { msg: { closed_options: [] } } }),
  };
  const activeIds: Record<string, number> = { "EURUSD:OTC": 76, "GBPUSD:OTC": 81, "USDJPY:OTC": 85, "EURGBP:OTC": 77, "GBPJPY:OTC": 84, "AUDUSD:OTC": 83, "USDCAD:OTC": 86, "USDCHF:OTC": 87, "NZDUSD:OTC": 88, "AUDJPY:OTC": 89, "CADJPY:OTC": 90, "CHFJPY:OTC": 91, "EURAUD:OTC": 92, "EURCAD:OTC": 93, "GBPAUD:OTC": 94 };
  const buckets: Record<string, number> = {};
  const seed = (key: string) => {
    const ctx = runtime.markets.get(key);
    ctx.availability = "OPEN"; ctx.activeId = activeIds[key] ?? 76; ctx.payout = 85; ctx.payoutSource = "test"; ctx.enabled = true; ctx.maxStake = 100;
    ctx.instrumentTypes = ["binary", "turbo"];
    const start = Math.floor((clock.nowMs - 40 * 5_000) / 5_000) * 5_000;
    buckets[key] = start;
    for (let index = 0; index < 40; index += 1) ingest(key, start + index * 5_000, 1.1 + index * 0.00001);
  };
  const ingest = (key: string, bucketStart: number, close: number) => {
    const ctx = runtime.markets.get(key);
    const fromSec = Math.floor(bucketStart / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: "conn-jit", receivedAt: clock.nowMs, msg: { active_id: ctx.activeId, size: 5, from: fromSec, to: fromSec + 5, open: close - 0.00001, high: close + 0.00002, low: close - 0.00002, close } });
    buckets[key] = bucketStart;
  };
  const step = ({ advanceMs = 1_000, advanceCandle = 5_000 } = {}) => {
    clock.nowMs += advanceMs;
    for (const key of markets) {
      const ctx = runtime.markets.get(key);
      if (!ctx) continue;
      ingest(key, (buckets[key] ?? Math.floor(clock.nowMs / 5_000) * 5_000) + advanceCandle, Number(ctx.lastCandle?.close ?? 1.1) + 0.00002);
    }
  };
  const ack = async (key: string, orderId: string) => {
    const pending = runtime.pendingOrders.get(key);
    if (!pending) return null;
    runtime.ingestEvent("socket-option-opened", { connectionId: "conn-jit", receivedAt: clock.nowMs, msg: { id: orderId, active_id: pending.activeId, price: pending.stake, expired: pending.expirationSec } });
    await sleep(20);
    return pending;
  };
  const ready = (...keys: string[]) => { for (const key of keys) seed(key); runtime.arm(100, { confirmation: true }); };
  return { runtime, clock, overrides, seed, ready, step, ack, markets };
}

describe("ENTRY TIMING — janela alvo (server time)", () => {
  it("targetEntryAt e a proxima fronteira de 60s com folga de revalidacao", () => {
    const window = nextEntryWindow({ serverNowMs: Date.UTC(2026, 8, 17, 12, 0, 20), leadMs: 1500 });
    expect(window.targetEntryAt).toBe(Date.UTC(2026, 8, 17, 12, 1, 0));
    expect(window.targetExpiryAt).toBe(Date.UTC(2026, 8, 17, 12, 2, 0));
    expect(window.submitAt).toBe(window.targetEntryAt - 1500);
    const late = nextEntryWindow({ serverNowMs: Date.UTC(2026, 8, 17, 12, 0, 58, 500), leadMs: 1500 });
    expect(late.targetEntryAt).toBe(Date.UTC(2026, 8, 17, 12, 2, 0));
  });

  it("lead dinamico = p95 + buffers, sempre entre 1000 e 2000ms", () => {
    expect(clampLeadMs(10)).toBe(MIN_ENTRY_LEAD_MS);
    expect(clampLeadMs(9_999)).toBe(MAX_ENTRY_LEAD_MS);
    expect(clampLeadMs(undefined)).toBe(DEFAULT_ENTRY_LEAD_MS);
    expect(dynamicEntryLeadMs([])).toBe(DEFAULT_ENTRY_LEAD_MS);
    expect(dynamicEntryLeadMs([100, 120, 130, 150, 160, 170, 180, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 500])).toBe(MIN_ENTRY_LEAD_MS);
    expect(dynamicEntryLeadMs([50, 60, 70, 80])).toBe(MIN_ENTRY_LEAD_MS);
    expect(dynamicEntryLeadMs([...Array(18).fill(120), 1_700, 1_800])).toBe(MAX_ENTRY_LEAD_MS);
  });

  it("comparacao candidato x final detecta mudancas observaveis", () => {
    const initial = { action: "BUY", regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "x", rsi: 58, adx: 27 };
    const same = compareCandidateSnapshots(initial, { ...initial });
    expect(same.changed).toBe(false);
    const changed = compareCandidateSnapshots(initial, { ...initial, regime: "TRANSITION", rsi: 44 });
    expect(changed.changed).toBe(true);
    expect(changed.changes.map((change: any) => change.field)).toEqual(expect.arrayContaining(["regime", "rsi"]));
  });

  it("regras A-G: cada falha tem motivo proprio; sucesso exige todas", () => {
    const candidate = { action: "BUY", regime: "TREND_UP", setup: "TREND_PULLBACK" };
    const ok = { action: "BUY", regime: "TREND_UP", setup: "TREND_PULLBACK", trigger: "x", criticVerdict: "CONFIRM", consensusStatus: "CONFIRMED" };
    expect(revalidateCandidate({ candidate, final: ok, freshness: { fresh: true } }).ok).toBe(true);
    expect(revalidateCandidate({ candidate, final: { ...ok, action: "WAIT" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_LOGIC_CHANGED_TO_WAIT");
    expect(revalidateCandidate({ candidate, final: { ...ok, action: "SELL" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_LOGIC_CHANGED_DIRECTION");
    expect(revalidateCandidate({ candidate, final: { ...ok, regime: "UNCLEAR" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_REGIME_CHANGED");
    expect(revalidateCandidate({ candidate, final: { ...ok, regime: "TRANSITION" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_REGIME_CHANGED");
    expect(revalidateCandidate({ candidate, final: { ...ok, regime: "EXPANSION" }, freshness: { fresh: true } }).ok).toBe(true);
    expect(revalidateCandidate({ candidate, final: { ...ok, setup: "NO_VALID_SETUP" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_SETUP_INVALIDATED");
    expect(revalidateCandidate({ candidate, final: { ...ok, trigger: null }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_TRIGGER_GONE");
    expect(revalidateCandidate({ candidate, final: { ...ok, criticVerdict: "VETO" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_CRITIC_VETO");
    expect(revalidateCandidate({ candidate, final: { ...ok, consensusStatus: "NO_CONSENSUS" }, freshness: { fresh: true } }).reason).toBe("CANDIDATE_CONSENSUS_LOST");
    expect(revalidateCandidate({ candidate, final: ok, freshness: { fresh: false, reason: "STALE_ANALYSIS" } }).reason).toBe("CANDIDATE_DATA_STALE");
    const crafted = makeCandidate({ marketKey: "EURUSD:OTC", marketType: "OTC", action: "BUY", now: 1, serverNow: 1, window: { targetEntryAt: 60_000, targetExpiryAt: 120_000, submitAt: 58_500, leadMs: 1500 }, snapshot: ok });
    expect(crafted.status).toBe("WAITING_WINDOW");
    expect(crafted.id).toContain("EURUSD_OTC");
  });

  it("experimento early vs JIT liquida causalmente e mantem contadores", () => {
    const experiment = new EntryTimingExperiment({ now: () => 0 }) as any;
    experiment.recordCandidate({ marketKey: "EURUSD:OTC", marketType: "OTC", candidateId: "c1", action: "BUY", entryPrice: 1.1, payout: 85, atMs: 0, targetEntryAt: 60_000, targetExpiryAt: 120_000 });
    experiment.recordCancellation({ candidateId: "c2", reason: "CANDIDATE_SETUP_INVALIDATED", changes: [{ field: "setup" }] });
    experiment.recordCancellation({ candidateId: "c3", reason: "ENTRY_WINDOW_MISSED", changes: [] });
    experiment.recordExecution({ marketKey: "EURUSD:OTC", candidateId: "c0", action: "BUY", result: "WIN", stake: 10, payout: 85, entryAt: 0, settlementAt: 60_000 });
    expect(experiment.settle({ marketKey: "EURUSD:OTC", candles: [{ bucketStart: 120_001, close: 1.2 }], index: 0, nowMs: 120_001 })).toBe(1);
    const board = experiment.scoreboard();
    expect(board.arms.EARLY_DECISION_SHADOW).toMatchObject({ n: 1, wins: 1 });
    expect(board.arms.JUST_IN_TIME_ENTRY).toMatchObject({ n: 1, wins: 1 });
    expect(board.counters).toMatchObject({ candidates: 1, cancellations: 2, setupInvalidated: 1, windowMissed: 1 });
  });
});

describe("JIT no runtime — candidato, revalidacao e commit", () => {
  it("nao envia ordem antes da janela; revalida em T-1.5s e registra drift", async () => {
    const { runtime, clock, overrides, ready, step, ack } = fixture();
    ready("EURUSD:OTC");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const ctx = runtime.markets.get("EURUSD:OTC");
    expect(ctx.candidate).toBeTruthy();
    expect(runtime.__sent).toHaveLength(0);
    const candidate = ctx.candidate;
    expect(candidate.targetEntryAt % 60_000).toBe(0);
    expect(candidate.submitAt).toBe(candidate.targetEntryAt - candidate.entryLeadMs);
    // ainda antes da janela: nada de ordem
    step();
    expect(runtime.__sent).toHaveLength(0);
    expect(ctx.candidate).toBeTruthy();
    // avanca para o instante de submit (server time)
    clock.nowMs = candidate.submitAt - 50;
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    await sleep(20);
    expect(runtime.__sent).toHaveLength(1);
    expect(runtime.__sent[0].expiration * 1000).toBe(candidate.targetExpiryAt);
    const pending = runtime.pendingOrders.get("EURUSD:OTC");
    expect(pending).toBeTruthy();
    await ack("EURUSD:OTC", "ORD-JIT-1");
    const position = runtime.openPositions.get("EURUSD:OTC");
    expect(position.entryTiming.targetEntryAt).toBe(candidate.targetEntryAt);
    expect(position.entryTiming.entryLeadMs).toBeGreaterThanOrEqual(1_000);
    expect(position.entryTiming.entryDriftMs).toBe(Math.round(clock.nowMs - candidate.targetEntryAt));
    expect(position.decisionSnapshot.source).toBe("T0_DECISION_SNAPSHOT");
    const signal = runtime.signals(5).signals[0];
    expect(signal.entryTiming.candidateId).toBe(candidate.id);
    expect(signal.mode).toBe("PRACTICE");
  });

  it("BUY -> WAIT cancela; BUY -> SELL cancela sem inverter; setup/trigger/critic/consensus/stale cancelam", async () => {
    const cases: Array<[string, any, string]> = [
      ["WAIT", () => brain("WAIT"), "CANDIDATE_LOGIC_CHANGED_TO_WAIT"],
      ["SELL", () => brain("SELL"), "CANDIDATE_LOGIC_CHANGED_DIRECTION"],
      ["REGIME", () => brain("BUY", { regime: "UNCLEAR" }), "CANDIDATE_REGIME_CHANGED"],
      ["SETUP", () => brain("BUY", { trader: { setup: "NO_VALID_SETUP" } }), "CANDIDATE_SETUP_INVALIDATED"],
      ["TRIGGER", () => brain("BUY", { trader: { trigger: null } }), "CANDIDATE_TRIGGER_GONE"],
      ["CRITIC", () => brain("BUY", { criticVerdict: "VETO" }), "CANDIDATE_CRITIC_VETO"],
      ["CONSENSUS", () => brain("BUY", { consensusStatus: "NO_CONSENSUS" }), "CANDIDATE_CONSENSUS_LOST"],
      ["STALE", () => brain("BUY", { fresh: { fresh: false, reason: "STALE_ANALYSIS" } }), "CANDIDATE_DATA_STALE"],
    ];
    for (const [name, final, expected] of cases) {
      const { runtime, clock, overrides, ready, step } = fixture();
      ready("EURUSD:OTC");
      overrides.set("EURUSD:OTC", () => brain("BUY"));
      step();
      const ctx = runtime.markets.get("EURUSD:OTC");
      expect(ctx.candidate, name).toBeTruthy();
      clock.nowMs = ctx.candidate.submitAt - 50;
      overrides.set("EURUSD:OTC", final);
      step();
      await sleep(10);
      expect(runtime.__sent, name).toHaveLength(0);
      expect(ctx.lastCandidate.cancelReason, name).toBe(expected);
      expect(ctx.lastCandidate.status, name).toBe("CANCELLED");
      const scores = runtime.entryTimingStatus().scoreboard;
      expect(scores.counters.cancellations, name).toBeGreaterThanOrEqual(1);
    }
  });

  it("mudanca intermediaria NAO cancela: WAIT no meio e BUY na janela final entra", async () => {
    const { runtime, clock, overrides, ready, step } = fixture();
    ready("EURUSD:OTC");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const ctx = runtime.markets.get("EURUSD:OTC");
    expect(ctx.candidate).toBeTruthy();
    // T-50s: mercado vira WAIT por alguns candles (nao cancela; apenas registra mudanca)
    clock.nowMs += 5_000;
    overrides.set("EURUSD:OTC", () => brain("WAIT"));
    step();
    await sleep(10);
    expect(ctx.candidate).toBeTruthy();
    expect(runtime.__sent).toHaveLength(0);
    expect(ctx.candidate.changes.changed).toBe(true);
    expect(ctx.candidate.changes.changes.some((change: any) => change.field === "action")).toBe(true);
    // T-1.45s: volta a BUY e revalida ok -> entrada
    clock.nowMs = ctx.candidate.submitAt - 50;
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    await sleep(20);
    expect(runtime.__sent).toHaveLength(1);
    expect(["CONFIRMED", "ORDER_SENT"]).toContain(ctx.candidate.status);
    expect(runtime.pendingOrders.has("EURUSD:OTC")).toBe(true);
  });

  it("janela perdida: nao persegue entrada e cancela com ENTRY_WINDOW_MISSED", async () => {
    const { runtime, clock, overrides, ready, step } = fixture();
    ready("EURUSD:OTC");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const ctx = runtime.markets.get("EURUSD:OTC");
    clock.nowMs = ctx.candidate.targetEntryAt + runtime.config.entryWindowMaxDriftMs + 1;
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    await sleep(10);
    expect(runtime.__sent).toHaveLength(0);
    expect(ctx.lastCandidate.cancelReason).toBe("ENTRY_WINDOW_MISSED");
    expect(ctx.candidate).toBeNull();
  });

  it("session lost cancela o candidato (reconnect seguro)", async () => {
    const { runtime, overrides, ready, step } = fixture();
    ready("EURUSD:OTC");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    expect(runtime.markets.get("EURUSD:OTC").candidate).toBeTruthy();
    runtime.stop("TEST_DISCONNECT");
    expect(runtime.markets.get("EURUSD:OTC").candidate).toBeNull();
    expect(runtime.markets.get("EURUSD:OTC").lastCandidate.cancelReason).toBe("CANDIDATE_SESSION_LOST");
  });

  it("clock skew: janela alinhada ao server time, nao ao relogio local", async () => {
    const { runtime, overrides, ready, step } = fixture({ serverOffsetMs: 37_000 });
    ready("EURUSD:OTC");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const candidate = runtime.markets.get("EURUSD:OTC").candidate;
    expect(candidate.targetEntryAt % 60_000).toBe(0);
    expect(candidate.targetEntryAt).toBeGreaterThan(runtime.client.serverNow());
  });

  it("5 e 10 mercados: candidatos isolados, uma ordem por mercado", async () => {
    const keys5 = ["EURUSD:OTC", "GBPUSD:OTC", "USDJPY:OTC", "EURGBP:OTC", "GBPJPY:OTC"];
    const { runtime, clock, overrides, ready, step } = fixture({ markets: keys5 });
    ready(...keys5);
    for (const key of keys5) overrides.set(key, () => brain("BUY"));
    step();
    expect(keys5.every((key) => runtime.markets.get(key).candidate)).toBe(true);
    expect(runtime.__sent).toHaveLength(0);
    const submitAt = runtime.markets.get(keys5[0]).candidate.submitAt;
    clock.nowMs = submitAt - 50;
    step();
    await sleep(30);
    expect(runtime.__sent).toHaveLength(5);
    const activeIds = new Set(runtime.__sent.map((order: any) => order.activeId));
    expect(activeIds.size).toBe(5);
    runtime.stop("END");
  });

  it("duplicata no mesmo bucket nao vira segunda ordem (idempotencia/posicao aberta)", async () => {
    const { runtime, clock, overrides, ready, step, ack } = fixture();
    ready("EURUSD:OTC");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    const candidate = runtime.markets.get("EURUSD:OTC").candidate;
    clock.nowMs = candidate.submitAt - 50;
    step();
    await sleep(20);
    await ack("EURUSD:OTC", "ORD-DUP-1");
    overrides.set("EURUSD:OTC", () => brain("BUY"));
    step();
    await sleep(20);
    expect(runtime.__sent).toHaveLength(1);
    expect(runtime.openPositions.size).toBe(1);
    const blocked = await runtime.simulateSignal("EURUSD:OTC", "BUY");
    expect(blocked.disposition).toBe("BLOCKED");
    runtime.stop("END");
  });

  it("tradeQualityScore: abaixo do threshold cancela, com threshold baixo executa (gate nunca cria direcao)", async () => {
    const blockedFixture = fixture();
    blockedFixture.ready("EURUSD:OTC");
    blockedFixture.runtime.config.qualityGateEnabled = true;
    blockedFixture.runtime.config.minTradeQualityScore = 95;
    blockedFixture.overrides.set("EURUSD:OTC", () => brain("BUY"));
    blockedFixture.step();
    const blockedCtx = blockedFixture.runtime.markets.get("EURUSD:OTC");
    blockedFixture.clock.nowMs = blockedCtx.candidate.submitAt - 50;
    blockedFixture.step();
    await sleep(20);
    expect(blockedFixture.runtime.__sent).toHaveLength(0);
    expect(blockedCtx.lastCandidate.cancelReason).toBe("QUALITY_SCORE_BELOW_THRESHOLD");
    expect(blockedCtx.lastCandidate.quality.score).toBeLessThan(95);

    const allowedFixture = fixture();
    allowedFixture.ready("EURUSD:OTC");
    allowedFixture.runtime.config.qualityGateEnabled = true;
    allowedFixture.runtime.config.minTradeQualityScore = 50;
    allowedFixture.overrides.set("EURUSD:OTC", () => brain("BUY"));
    allowedFixture.step();
    const allowedCtx = allowedFixture.runtime.markets.get("EURUSD:OTC");
    allowedFixture.clock.nowMs = allowedCtx.candidate.submitAt - 50;
    allowedFixture.step();
    await sleep(20);
    expect(allowedFixture.runtime.__sent).toHaveLength(1);
    allowedFixture.runtime.stop("END");
  });

  it("PRACTICE only: nenhuma superficie habilita REAL", () => {
    const { runtime } = fixture();
    expect(runtime.config.mode).toBe("PRACTICE");
    expect(runtime.realMode.authorized()).toBe(false);
    expect(() => runtime.setMode("REAL")).toThrowError(/REAL_MODE_NOT_CONFIRMED/);
  });
});
