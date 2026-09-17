/**
 * IQ MULTI-MARKET RUNTIME (Fase 4) — uma conexao WS, N mercados independentes (ate 10 ativos).
 *
 * Invariantes:
 *  - NORMAL ≠ OTC: `markets` e chaveado por marketKey (EURUSD:NORMAL / EURUSD:OTC); nenhum
 *    buffer/feature/decision/trade e compartilhado. Nenhum fallback silencioso para OTC.
 *  - Ativos resolvidos em RUNTIME (RuntimeAssetResolver); activeId estatico nunca e verdade.
 *  - PortfolioExecutionGate ANTES de qualquer ordem; gate PRACTICE congelado continua sendo a
 *    ultima instancia no modo PRACTICE. Modo REAL exige RealModeController confirmado.
 *  - MAX_ACTIVE_MARKETS = 10; 1 posicao por mercado; varias posicoes simultaneas em mercados
 *    diferentes.
 *  - Apos restart: reconfigura, reconcilia (nunca reenvia), REAL volta bloqueado.
 *  - Nenhum segredo em log/status/eventos.
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { IqWsClient, IqWsError, IQ_WS_CANDIDATE_HOSTS, CANDLE_SIZE_SECONDS, classifyBalances, computeExpiration, normalizeCandle, parseSettlement, toEpochMs, EXPECTED_EURUSD_ACTIVE_ID_FROM_REPO, EXPECTED_EURUSD_OTC_ACTIVE_ID_FROM_REPO } from "./iqoption-ws.mjs";
import { buildFeatureContext, freshnessGate } from "./feature-engine.mjs";
import { executionGate, applyBrokerAcknowledgement, compareSettlement, ExecutionArmState, IdempotencyStore, KillSwitch, MAX_PRACTICE_STAKE_BRL } from "./iqoption-connector.mjs";
import { RealModeController } from "./real-mode.mjs";
import { PortfolioExecutionGate, resolveFinalStake } from "./portfolio-gate.mjs";
import { RuntimeAssetResolver } from "./asset-resolver.mjs";
import { GlobalIntelligenceState, INTELLIGENCE_DOMAINS } from "./intelligence.mjs";
import { SetupResearchEngine, ABExperiment, BRAIN_HORIZON_SECONDS } from "./research-engine.mjs";
import { BRAIN_GENERATION, BRAIN_VERSION, traderBrainDecision, criticBrainAssessment, consensusBrainDecision, CORE_BRAIN } from "./professional-brain.mjs";
import { computeStructureFeatures, classifyRegime, STRUCTURE_VERSION } from "./price-structure.mjs";
import { TradingKnowledgeRetriever } from "./knowledge-base.mjs";
import { SecondBrainAdapter } from "./second-brain.mjs";
import { TradingJournal, HypothesisRegistry, PerformanceSupervisor, reviewTrade } from "./professor.mjs";
import { ApprenticeDesk } from "./apprentice.mjs";
import { ExternalFeedSync } from "./external-feeds.mjs";
import { ENTRY_TIMING_VERSION, DEFAULT_ENTRY_LEAD_MS, DEFAULT_MAX_DRIFT_MS, MIN_ENTRY_LEAD_MS, MAX_ENTRY_LEAD_MS, nextEntryWindow, dynamicEntryLeadMs, compareCandidateSnapshots, comparableSnapshot, makeCandidate, revalidateCandidate, EntryTimingExperiment } from "./entry-timing.mjs";
import { UNIVERSE, marketKey, entryForKey, segmentIdFor, MAX_ACTIVE_MARKETS, MAX_OPEN_POSITIONS_PER_MARKET, HARD_CAP_STAKE, DEFAULT_GLOBAL_MAX_STAKE, concentrationExposure } from "./market-universe.mjs";

export const RUNTIME_VERSION = "iq-multi-runtime-v2";
export const ACK_TIMEOUT_MS = 15_000;
export const MARKET_TICK_AGE_MS = 15_000;
export const MIN_CANDLES_FEATURE = 30;
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
export const MAX_CANDLE_BUFFER = 600;
export const EVENT_BUFFER = 2_000;
export const AGENT_STATES = ["OFFLINE", "UNAVAILABLE", "WAIT", "ANALYZING", "SIGNAL", "ORDERING", "IN_POSITION", "SETTLING", "WIN", "LOSS", "DRAW", "ERROR"];

export function percentile(values, fraction) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index]);
}
export function latencySummary(samples) { return { count: samples.length, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99), max: samples.length ? Math.round(Math.max(...samples)) : null }; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
const nowIso = (ms) => new Date(ms).toISOString();

function emptyDailyStats() { return { wins: 0, losses: 0, draws: 0, settledPnl: 0, trades: 0 }; }

export class IqMultiRuntime extends EventEmitter {
  #disconnectedWaiter = null;

  constructor({ pool = null, getSsid = () => null, armState = new ExecutionArmState(), killSwitch = new KillSwitch(), idempotency = new IdempotencyStore(), hosts = IQ_WS_CANDIDATE_HOSTS, now = () => Date.now(), log = () => {}, maxLatencySamples = 300, ackTimeoutMs = ACK_TIMEOUT_MS, realMode = new RealModeController({ now }), gate = new PortfolioExecutionGate(), resolver = new RuntimeAssetResolver({ now }), autoExecute = false, decisionOverride = null } = {}) {
    super();
    this.pool = pool; this.getSsid = getSsid; this.armState = armState; this.killSwitch = killSwitch; this.idempotency = idempotency;
    this.hosts = hosts; this.now = now; this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxLatencySamples = maxLatencySamples; this.ackTimeoutMs = ackTimeoutMs;
    this.realMode = realMode; this.gate = gate; this.resolver = resolver;
    this.decisionOverride = typeof decisionOverride === "function" ? decisionOverride : null; // diagnostico/testes deterministicos (nunca usado em producao)
    this.running = false; this.client = null; this.connection = null; this.stopRequested = false;
    this.reconnects = 0; this.connectionStartedAt = null;
    this.session = { connected: false, host: null, connectionId: null, serverTimeMs: null, clockSkewMs: null, timeValid: false, connectedAt: null };
    this.account = { practice: { verified: false, balanceId: null, balance: null, currency: null }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: null, type: "UNKNOWN" };
    this.config = { mode: "PRACTICE", globalMaxStake: HARD_CAP_STAKE, defaultStake: 1, calculatedBankrollStake: 1, hardCap: HARD_CAP_STAKE, maxActiveMarkets: MAX_ACTIVE_MARKETS, autoExecute: autoExecute === true, revision: 0, brainGeneration: BRAIN_GENERATION, jitEnabled: true, entryLeadMs: DEFAULT_ENTRY_LEAD_MS, entryWindowMaxDriftMs: DEFAULT_MAX_DRIFT_MS };
    this.markets = new Map();
    for (const entry of UNIVERSE) {
      const key = marketKey(entry.canonical, entry.marketType);
      this.markets.set(key, this.#emptyMarket(entry, key));
    }
    this.pendingOrders = new Map();
    this.openPositions = new Map();
    this.orderIndex = new Map();
    this.signalLog = []; this.signalStats = new Map(); this.signalSeq = 0;
    this.intelligence = new GlobalIntelligenceState({ now });
    this.secondBrain = new SecondBrainAdapter({ log: this.log });
    this.knowledge = new TradingKnowledgeRetriever({ rootDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "knowledge"), secondBrain: this.secondBrain, now, log: this.log });
    this.research = new SetupResearchEngine({ now });
    this.ab = new ABExperiment({ now });
    this.journal = new TradingJournal({ pool, now, secondBrain: this.secondBrain, log: this.log });
    this.hypotheses = new HypothesisRegistry({ now, secondBrain: this.secondBrain, log: this.log });
    this.supervisor = new PerformanceSupervisor({ now, log: this.log });
    this.knowledgeRebuiltAt = null;
    this.apprentice = new ApprenticeDesk({ now, onEvent: (type, payload) => { this.#emitEvent(type, payload); const ctx = this.markets.get(payload?.marketKey); if (ctx) this.#auditRecord(`appr_${payload?.lessonId ?? payload?.to ?? this.now()}`, payload.marketKey, type === "apprentice.promotion" ? "APPRENTICE_PROMOTION" : "APPRENTICE_LESSON", payload, { persist: true }); this.#safe(() => this.log("IQ_MULTI_APPRENTICE", JSON.stringify({ type, ...payload }))); } });
    this.feeds = new ExternalFeedSync({ universe: UNIVERSE, log: this.log, apply: (kind, items) => this.#applyExternalItems(kind, items) });
    this.jit = new EntryTimingExperiment({ now });
    this.agentState = new Map();
    this.audit = []; this.correlationSeq = 0;
    this.agentLatency = [];
    this.events = []; this.eventSeq = 0;
    this.stress = { running: false, report: null };
    this.metrics = { messages: 0, candles: 0, reorder: 0, duplicates: 0, rejected: 0, startedAt: null, cpuBase: process.cpuUsage(), reconnects: 0 };
    this.reconcile = { lastRunAt: null, checked: 0, settled: 0, unknown: 0, error: null };
    this.configLoaded = false;
    this.equityCurveCache = []; this.equityRefreshedAt = 0;
    this.lastTickEmit = new Map();
  }

  #emptyMarket(entry, key) {
    return {
      marketKey: key, symbol: entry.symbol, display: entry.display, marketType: entry.marketType, canonical: entry.canonical,
      enabled: false, paused: false, maxStake: HARD_CAP_STAKE, configuredStake: null, strategy: null, strategyVariantId: null, revision: 0,
      activeId: null, instrumentTypes: [], availability: "UNKNOWN", payout: null, payoutSource: null, resolvedAt: null,
      connectionHealth: { connected: false, lastMessageAt: null, gaps: 0 },
      serverTime: null, lastTick: null, lastTickAt: null,
      candles: new Map(), lastCandle: null, featureState: null, decisionState: { action: "WAIT", reason: "BOOT", evaluatedAt: null },
      positionState: { status: "IDLE", direction: null, entryPrice: null, stake: null, brokerOrderId: null, requestId: null, expirationSec: null, openedAt: null, settledAt: null, result: null, profit: null, mode: null },
      settlementState: { lastResult: null, lastProfit: null, lastAt: null, daily: emptyDailyStats() },
      indicative: { state: "NEUTRAL", delta: null, indicativePnl: null, updatedAt: null },
      latency: { serverToReceived: [], receivedToNormalized: [], normalizedToFeature: [], orderAck: [] },
      stats: { messages: 0, candlesProcessed: 0, duplicates: 0, reorder: 0, gaps: 0, rejected: 0, lastBucketStart: null },
      agentState: "OFFLINE", agentSince: null, lastSignal: null, lastDecision: null, lastTrade: null,
    };
  }

  /* ------------------------------- lifecycle ------------------------------- */

  start() {
    if (this.running) return { started: false, reason: "ALREADY_RUNNING" };
    this.running = true; this.stopRequested = false;
    void this.knowledge.rebuild();
    void this.#runLoop();
    return { started: true, version: RUNTIME_VERSION };
  }

  stop(reason = "STOP_REQUESTED") {
    this.running = false; this.stopRequested = true;
    const waiter = this.#disconnectedWaiter; if (waiter) { this.#disconnectedWaiter = null; waiter(); }
    try { this.client?.close(reason); } catch { /* noop */ }
    this.client = null;
    this.session = { ...this.session, connected: false };
    this.realMode.revoke("RUNTIME_STOP");
    try { this.armState.disarm("WS_DISCONNECTED"); } catch { /* noop */ }
    for (const ctx of this.markets.values()) { if (ctx.candidate) this.#cancelCandidate(ctx, "CANDIDATE_SESSION_LOST", { reason }); this.#setAgent(ctx, "OFFLINE", "RUNTIME_STOP"); }
    return { stopped: true, reason };
  }

  onSessionAvailable() { this.start(); }
  onSessionRemoved() { this.stop("SESSION_DISCONNECTED"); }

  /** Recarrega configuracao persistida (diagnostico/teste; restart real usa o mesmo caminho no boot). */
  async reloadConfiguration() { this.configLoaded = false; await this.#loadPersistedConfig(); return { defaultStake: this.config.defaultStake, revision: this.config.revision, markets: [...this.markets.values()].filter((ctx) => ctx.enabled).map((ctx) => ({ marketKey: ctx.marketKey, configuredStake: ctx.configuredStake, setup: ctx.decisionState?.setup ?? null })) }; }

  async #runLoop() {
    let attempt = 0;
    while (this.running && !this.stopRequested) {
      const ssid = this.getSsid();
      if (!ssid) { await sleep(5_000); continue; }
      let client = null;
      try {
        client = new IqWsClient({ hosts: this.hosts, log: this.log });
        this.#wire(client);
        const ready = await client.connect({ ssid });
        this.client = client;
        this.connection = ready;
        this.reconnects = attempt > 0 ? this.reconnects + 1 : this.reconnects;
        this.metrics.reconnects = this.reconnects;
        this.connectionStartedAt = this.now();
        this.session = { connected: true, host: ready.host, connectionId: ready.connectionId, serverTimeMs: ready.serverTimeMs, clockSkewMs: ready.clockSkewMs, timeValid: ready.timeValid, connectedAt: this.now() };
        this.#emitEvent("connection.ready", { host: ready.host, timeValid: ready.timeValid, clockSkewMs: ready.clockSkewMs });
        await this.#bootstrap(client);
        attempt = 0;
        await new Promise((resolve) => { this.#disconnectedWaiter = resolve; if (!this.running) resolve(); });
      } catch (error) {
        this.#safe(() => this.log("IQ_MULTI_CONNECT_FAILED", JSON.stringify({ code: error?.code ?? "UNKNOWN", detail: String(error?.message ?? error).slice(0, 160) })));
      } finally {
        this.client = null; this.#disconnectedWaiter = null;
        this.session = { ...this.session, connected: false };
        for (const ctx of this.markets.values()) ctx.connectionHealth = { ...ctx.connectionHealth, connected: false };
        try { this.armState.disarm("WS_DISCONNECTED"); } catch { /* noop */ }
        this.realMode.revoke("WS_DISCONNECTED");
        for (const ctx of this.markets.values()) { if (ctx.candidate) this.#cancelCandidate(ctx, "CANDIDATE_SESSION_LOST", { reason: "WS_DISCONNECTED" }); if (ctx.enabled) this.#setAgent(ctx, ctx.availability === "OPEN" ? "WAIT" : "UNAVAILABLE", "WS_DISCONNECTED"); }
      }
      if (!this.running || this.stopRequested) break;
      const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
      attempt += 1;
      this.#emitEvent("connection.disconnected", { nextAttemptInMs: delay });
      await sleep(delay + Math.floor(Math.random() * 400));
    }
    this.running = false;
  }

  #safe(fn) { try { fn(); } catch (error) { this.log("IQ_MULTI_LOG_ERROR", String(error?.message ?? error)); } }

  #wire(client) {
    client.on("closed", () => { const waiter = this.#disconnectedWaiter; if (waiter) { this.#disconnectedWaiter = null; waiter(); } });
    client.on("candle-generated", (event) => this.ingestEvent("candle-generated", event));
    client.on("candles-generated", (event) => this.ingestEvent("candles-generated", event));
    client.on("balances", (event) => this.ingestEvent("balances", event));
    client.on("balance-changed", (event) => this.ingestEvent("balance-changed", event));
    client.on("option", (event) => this.ingestEvent("option", event));
    client.on("buyComplete", (event) => this.ingestEvent("buyComplete", event));
    client.on("result", (event) => this.ingestEvent("result", event));
    client.on("socket-option-opened", (event) => this.ingestEvent("socket-option-opened", event));
    client.on("socket-option-closed", (event) => this.ingestEvent("socket-option-closed", event));
    client.on("option-closed", (event) => this.ingestEvent("option-closed", event));
    client.on("commission-changed", (event) => this.ingestAuxiliary(event?.msg));
    client.on("instruments", (event) => this.ingestAuxiliary(event?.msg));
    client.on("api_game_getoptions_result", (event) => this.ingestAuxiliary(event?.msg));
  }

  /** Payout/disponibilidade auxiliares em runtime (commission-changed/instruments/get-options). */
  ingestAuxiliary(msg) {
    this.resolver.ingestAuxiliary(msg);
    this.#applyResolver({ reason: "AUXILIARY" });
  }

  /** Diagnostico sanitizado de get-options (sem ids de usuario/segredos). */
  async diagnoseOptions() {
    if (!this.client || !this.session.connected) throw new IqWsError("WS_DISCONNECTED");
    const { response } = await this.client.getOptions({ limit: 20, instrumentType: "binary,turbo", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId });
    const msg = response.msg ?? {};
    const open = Array.isArray(msg.open_options) ? msg.open_options : [];
    const closed = Array.isArray(msg.closed_options) ? msg.closed_options : [];
    const sanitize = (row) => (row && typeof row === "object" ? Object.fromEntries(Object.entries(row).filter(([key]) => !/user|balance|token|ssid/i.test(key)).slice(0, 24)) : null);
    return { msgKeys: Object.keys(msg), openCount: open.length, closedCount: closed.length, sampleOpen: sanitize(open[0]), resolver: this.resolver.status() };
  }

  ingestEvent(kind, event) {
    const normalized = event && typeof event === "object" ? { name: kind, ...event } : { name: kind, msg: event };
    if (!this.#isCurrentConnection(normalized)) return undefined;
    if (kind === "candle-generated" || kind === "candles-generated") return this.#onCandleEvent(normalized, { allSizes: kind === "candles-generated" });
    if (kind === "balances") return this.#onBalances(normalized);
    if (kind === "balance-changed") return this.#onBalanceChanged(normalized);
    if (kind === "option" || kind === "buyComplete" || kind === "result" || kind === "socket-option-opened") return this.#onOrderEvent(normalized, kind);
    if (kind === "socket-option-closed" || kind === "option-closed") return this.#onSettlementEvent(normalized, kind);
    return undefined;
  }

  #isCurrentConnection(event) { const current = this.connection?.connectionId ?? null; return Boolean(event && current && event.connectionId === current); }

  /* ------------------------------- bootstrap ------------------------------- */

  async #bootstrap(client) {
    await this.#loadPersistedConfig();
    try {
      const { response } = await client.getInitializationData();
      this.resolver.ingestInitializationData(response.msg);
      this.#applyResolver({ reason: "BOOTSTRAP" });
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_INIT_DATA_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 120))); }
    try { const { response } = await client.getBalances(); this.#applyBalances(response.msg); } catch (error) { this.#safe(() => this.log("IQ_MULTI_BALANCES_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 120))); }
    try {
      const { response } = await client.getOptions({ limit: 30, instrumentType: "binary,turbo", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId });
      this.resolver.ingestAuxiliary(response.msg);
      this.#applyResolver({ reason: "BOOTSTRAP_OPTIONS" });
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_OPTIONS_BOOTSTRAP_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 80))); }
    try {
      for (const instrument of ["binary-option", "turbo-option"]) client.send("subscribeMessage", { name: "commission-changed", params: { routingFilters: { instrument_type: instrument } }, version: "1.0" });
      this.#safe(() => this.log("IQ_MULTI_PAYOUT_SUBSCRIBED", "binary-option,turbo-option"));
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_PAYOUT_SUBSCRIBE_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 80))); }
    if (!this.activeMarketKeys().length) this.#applyDefaultSelection();
    for (const ctx of this.markets.values()) this.#subscribeCtx(client, ctx);
    // Fontes externas reais ainda nao integradas: registra NO_FEED honesto (nunca inventa noticia/macro).
    this.intelligence.publish("MACRO", { note: "sem integracao externa de macro conectada" }, { source: "none", sourceType: "EXTERNAL", dataQuality: "UNAVAILABLE", status: "NO_FEED" });
    this.intelligence.publish("NEWS", { note: "sem integracao externa de noticias conectada" }, { source: "none", sourceType: "EXTERNAL", dataQuality: "UNAVAILABLE", status: "NO_FEED" });
    if (process.env.EXTERNAL_FEED_SYNC !== "false") this.feeds.start();
    await this.#loadDailyStats();
    void this.reconcileOrphans();
    void this.refreshEquityCurve();
  }

  /** Default: ativa somente mercados NORMAL disponiveis (nunca troca NORMAL por OTC em silencio).
   *  OTC so entra se o operador habilitar explicitamente (setMarket) ou via config persistida. */
  #applyDefaultSelection() {
    const normals = [...this.markets.values()].filter((ctx) => ctx.marketType === "NORMAL" && ctx.availability === "OPEN" && ctx.activeId !== null);
    const selected = normals.slice(0, this.config.maxActiveMarkets);
    for (const ctx of selected) {
      try { ctx.enabled = true; ctx.selectionReason = "AUTO_DEFAULT_NORMAL_AVAILABLE"; } catch { /* noop */ }
    }
    this.#safe(() => this.log("IQ_MULTI_DEFAULT_SELECTION", JSON.stringify({ selected: selected.map((ctx) => ctx.marketKey), normalAvailable: normals.length, otcAvailable: [...this.markets.values()].filter((ctx) => ctx.marketType === "OTC" && ctx.availability === "OPEN").length })));
    this.#emitEvent("markets.default_selection", { selected: selected.map((ctx) => ctx.marketKey), normalAvailable: normals.length });
    void this.#persistConfig();
    for (const ctx of selected) void this.#persistMarket(ctx);
  }

  #applyBalances(msg) {
    const list = Array.isArray(msg) ? msg : Array.isArray(msg?.balances) ? msg.balances : [];
    const classified = classifyBalances(list);
    const real = classified.real.find((row) => row.isDefault) ?? classified.real[0] ?? null;
    const practice = classified.practice.find((row) => row.isDefault) ?? classified.practice[0] ?? null;
    this.account = {
      practice: { verified: Boolean(practice), balanceId: practice?.id ?? null, balance: practice?.amount ?? null, currency: practice?.currency ?? null },
      real: { available: Boolean(real), balanceId: real?.id ?? null, balance: real?.amount ?? null, currency: real?.currency ?? null },
      hasReal: classified.hasReal, checkedAt: this.now(), type: classified.type,
    };
    if (practice) { try { if (!this.armState.connectedAccountType) this.armState.onConnected("PRACTICE"); } catch { /* noop */ } }
    this.#emitEvent("account.balances", { practice: this.account.practice.verified, real: this.account.real.available, currency: this.account.practice.currency, type: this.account.type });
  }

  #onBalances(event) { const list = Array.isArray(event.msg) ? event.msg : Array.isArray(event.msg?.balances) ? event.msg.balances : []; this.#applyBalances(list); }
  #onBalanceChanged(event) {
    const current = event.msg?.current_balance;
    if (!current) return;
    if (Number(current.id) === Number(this.account.practice.balanceId)) this.account.practice.balance = Number.isFinite(Number(current.amount)) ? Number(current.amount) : this.account.practice.balance;
    if (Number(current.id) === Number(this.account.real.balanceId)) this.account.real.balance = Number.isFinite(Number(current.amount)) ? Number(current.amount) : this.account.real.balance;
  }

  /* ------------------------------- resolver/markets ------------------------------- */

  #applyResolver({ reason }) {
    let changed = 0;
    for (const ctx of this.markets.values()) {
      const resolved = this.resolver.get(ctx.marketKey);
      if (!resolved) continue;
      ctx.activeId = resolved.activeId; ctx.instrumentTypes = resolved.instrumentTypes; ctx.availability = resolved.availability;
      ctx.payout = resolved.payout; ctx.payoutSource = resolved.payoutSource; ctx.resolvedAt = resolved.resolvedAt;
      ctx.connectionHealth = { ...ctx.connectionHealth, connected: this.session.connected };
      if (ctx.enabled && ctx.availability !== "OPEN") { ctx.availability = resolved.availability; }
      changed += 1;
    }
    this.#safe(() => this.log("IQ_MULTI_RESOLVED", JSON.stringify({ reason, resolved: this.resolver.resolvedCount(), open: this.marketsOpenCount(), sampleKeys: this.resolver.sampleActiveKeys })));
    this.#emitEvent("markets.resolved", { reason, resolved: this.resolver.resolvedCount() });
    return changed;
  }

  marketsOpenCount() { return [...this.markets.values()].filter((ctx) => ctx.availability === "OPEN").length; }
  activeMarketKeys() { return [...this.markets.values()].filter((ctx) => ctx.enabled).map((ctx) => ctx.marketKey); }

  #subscribeCtx(client, ctx) {
    if (!client || !this.session.connected) return;
    if (!ctx.enabled || ctx.activeId === null || ctx.activeId === undefined) { ctx.connectionHealth = { ...ctx.connectionHealth, connected: false }; return; }
    try { client.subscribeCandles(ctx.activeId, CANDLE_SIZE_SECONDS); ctx.connectionHealth = { ...ctx.connectionHealth, connected: true }; }
    catch (error) { this.#safe(() => this.log("IQ_MULTI_SUBSCRIBE_FAILED", `${ctx.marketKey}:${String(error?.code ?? error?.message ?? error).slice(0, 80)}`)); }
  }

  #unsubscribeCtx(client, ctx) {
    if (!client || ctx.activeId === null) return;
    try { client.unsubscribeCandles(ctx.activeId, CANDLE_SIZE_SECONDS); } catch { /* noop */ }
  }

  setMarket(key, patch = {}, { persist = true } = {}) {
    const ctx = this.markets.get(key);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    const next = { ...patch };
    if (next.enabled === true && !ctx.enabled) {
      const active = this.activeMarketKeys();
      if (active.length >= this.config.maxActiveMarkets) throw new IqWsError("MAX_ACTIVE_MARKETS_REACHED", `${active.length} >= ${this.config.maxActiveMarkets}`);
      if (ctx.availability !== "OPEN" || ctx.activeId === null) throw new IqWsError("MARKET_UNAVAILABLE", `${key}:${ctx.availability}`);
      ctx.enabled = true;
      this.#subscribeCtx(this.client, ctx);
    } else if (next.enabled === false && ctx.enabled) {
      ctx.enabled = false;
      this.#unsubscribeCtx(this.client, ctx);
      this.#setAgent(ctx, ctx.availability === "OPEN" ? "WAIT" : "UNAVAILABLE", "MARKET_DISABLED");
    }
    if (next.paused !== undefined) ctx.paused = next.paused === true;
    if (next.configuredStake !== undefined) {
      const value = Number(next.configuredStake);
      if (!Number.isFinite(value) || value <= 0 || value > this.config.hardCap) throw new IqWsError("INVALID_CONFIGURED_STAKE", String(next.configuredStake));
      ctx.configuredStake = value;
      if (Number(ctx.maxStake) < value) ctx.maxStake = Math.min(this.config.hardCap, value);
    }
    if (next.maxStake !== undefined) {
      const value = Number(next.maxStake);
      if (!Number.isFinite(value) || value <= 0 || value > this.config.hardCap) throw new IqWsError("INVALID_MARKET_STAKE", String(next.maxStake));
      if (Number.isFinite(Number(ctx.configuredStake)) && value < Number(ctx.configuredStake)) throw new IqWsError("MARKET_CAP_BELOW_CONFIGURED_STAKE", `${value} < ${ctx.configuredStake}`);
      ctx.maxStake = value;
    }
    if (next.strategyVariantId !== undefined || next.strategy !== undefined) throw new IqWsError("LEGACY_STRATEGY_REMOVED", "V1/V2/V3/V8 foram removidas do runtime (LEGACY_STRATEGY_AUDIT; apenas historico).");
    if (next.enabled === undefined && next.paused === undefined && next.maxStake === undefined && next.configuredStake === undefined && next.strategy === undefined && next.strategyVariantId === undefined) throw new IqWsError("EMPTY_PATCH");
    ctx.revision = Number(ctx.revision || 0) + 1;
    if (persist) void this.#persistMarket(ctx);
    this.#emitEvent("market.config", { marketKey: key, enabled: ctx.enabled, paused: ctx.paused, maxStake: ctx.maxStake, configuredStake: ctx.configuredStake, revision: ctx.revision });
    return this.#publicMarket(ctx);
  }

  /** Valor por operacao (configuredStake). APPLY TO ALL sobrescreve os valores individuais dos mercados alvo. */
  applyGlobalMaxStake(value, keys = null) {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0 || limit > this.config.hardCap) throw new IqWsError("INVALID_GLOBAL_STAKE", String(value));
    this.config.defaultStake = limit;
    this.config.globalMaxStake = Math.max(Number(this.config.globalMaxStake) || 0, limit);
    this.config.revision = Number(this.config.revision || 0) + 1;
    const targets = Array.isArray(keys) && keys.length ? keys : [...this.markets.keys()];
    let applied = 0;
    for (const key of targets) {
      const ctx = this.markets.get(key);
      if (!ctx) continue;
      ctx.configuredStake = limit;
      if (Number(ctx.maxStake) < limit) ctx.maxStake = Math.min(this.config.hardCap, limit);
      ctx.revision = Number(ctx.revision || 0) + 1;
      applied += 1;
      void this.#persistMarket(ctx);
    }
    void this.#persistConfig();
    this.#emitEvent("config.global_stake", { defaultStake: limit, globalMaxStake: this.config.globalMaxStake, appliedTo: applied });
    return { defaultStake: limit, globalMaxStake: this.config.globalMaxStake, appliedTo: applied };
  }

  setAutoExecute(enabled) { this.config.autoExecute = enabled === true; void this.#persistConfig(); return { autoExecute: this.config.autoExecute }; }

  setMode(mode) {
    const next = mode === "REAL" ? "REAL" : "PRACTICE";
    if (next === this.config.mode) return this.modeState();
    if (next === "REAL" && !this.realMode.authorized()) throw new IqWsError("REAL_MODE_NOT_CONFIRMED");
    try { this.armState.disarm("MODE_SWITCH"); } catch { /* noop */ }
    if (next === "PRACTICE") this.realMode.revoke("MODE_SWITCH_TO_PRACTICE");
    // Fase 6: sem Strategy Manager; Performance Supervisor nao altera metodologia em REAL.
    this.config.mode = next;
    void this.#persistConfig();
    this.#emitEvent("mode.changed", { mode: next, armed: false });
    return this.modeState();
  }

  modeState() {
    return {
      mode: this.config.mode, practice: { verified: this.account.practice.verified, balance: this.account.practice.balance, currency: this.account.practice.currency }, real: { available: this.account.real.available, balance: this.account.real.balance, currency: this.account.real.currency }, realMode: this.realMode.status(),
    };
  }

  setKillSwitch(engaged, reason = "UI") {
    if (engaged === true) { this.killSwitch.engage(); try { this.armState.disarm("KILL_SWITCH"); } catch { /* noop */ } this.realMode.revoke("KILL_SWITCH"); }
    else this.killSwitch.release();
    this.#emitEvent("kill_switch", { executionEnabled: this.killSwitch.status().executionEnabled, reason });
    return { killSwitch: this.killSwitch.status(), armState: this.armState.snapshot() };
  }

  arm(limitBrl, { confirmation = false, actor = "ui" } = {}) {
    if (!this.account.practice.verified) throw new IqWsError("PRACTICE_ACCOUNT_NOT_VERIFIED");
    if (this.config.mode === "REAL" && !this.realMode.authorized()) throw new IqWsError("REAL_MODE_NOT_CONFIRMED");
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("KILL_SWITCH_ACTIVE");
    const health = this.connectionHealth();
    if (!health.healthy) throw new IqWsError("CONNECTION_UNHEALTHY", health.reasons.join(","));
    if (!this.marketsOpenCount()) throw new IqWsError("NO_ACTIVE_MARKET");
    if (!this.armState.connectedAccountType) this.armState.onConnected("PRACTICE");
    this.armState.onMarketData(true);
    const limit = Number(limitBrl);
    const arm = this.armState.arm(limit, { explicitConfirmation: confirmation === true });
    this.userLimitBrl = Math.min(limit, this.config.hardCap);
    this.#emitEvent("execution.armed", { limitBrl: this.userLimitBrl, mode: this.config.mode, actor });
    return { ...arm, userLimitBrl: this.userLimitBrl, mode: this.config.mode, currency: this.account.practice.currency, fxMode: this.account.practice.currency === "BRL" ? "BRL_NATIVE" : "NOMINAL_BROKER_CURRENCY_CAP" };
  }

  disarm(reason = "MANUAL") { this.#emitEvent("execution.disarmed", { reason }); return this.armState.disarm(reason); }

  connectionHealth() {
    const reasons = [];
    if (!this.session.connected) reasons.push("WS_DISCONNECTED");
    if (!this.session.timeValid) reasons.push("TIME_SYNC_INVALID");
    return { healthy: reasons.length === 0, reasons, skewMs: this.session.clockSkewMs, host: this.session.host };
  }

  /* ------------------------------- candles/features/decisions ------------------------------- */

  #onCandleEvent(event, { allSizes = false } = {}) {
    this.metrics.messages += 1;
    const receivedAt = event.receivedAt ?? this.now();
    const serverTimestamp = this.client?.serverNow() ?? toEpochMs(event.msg?.at) ?? receivedAt;
    const rawList = [];
    if (allSizes) {
      const candles = event.msg?.candles;
      if (candles && typeof candles === "object") {
        const five = candles[String(CANDLE_SIZE_SECONDS)] ?? candles[CANDLE_SIZE_SECONDS];
        if (five) rawList.push({ ...five, active_id: event.msg?.active_id, at: event.msg?.at, ask: event.msg?.ask, bid: event.msg?.bid, size: CANDLE_SIZE_SECONDS });
      }
    } else if (Number(event.msg?.size) === CANDLE_SIZE_SECONDS) rawList.push(event.msg);
    for (const raw of rawList) {
      const activeId = Number(raw?.active_id);
      const ctx = [...this.markets.values()].find((market) => market.enabled && Number(market.activeId) === activeId) ?? null;
      if (!ctx) continue; // ativo desconhecido/desabilitado: NUNCA roteia para outro mercado
      this.#ingestCandle(ctx, raw, { receivedAt, serverTimestamp, connectionId: event.connectionId });
    }
  }

  #ingestCandle(ctx, raw, { receivedAt, serverTimestamp, connectionId }) {
    let candle;
    try {
      candle = normalizeCandle(raw, { symbol: ctx.display, activeId: ctx.activeId, serverTimestamp, receivedAt, connectionId, sizeSeconds: CANDLE_SIZE_SECONDS });
    } catch (error) {
      ctx.stats.rejected += 1; this.metrics.rejected += 1;
      this.#safe(() => this.log("IQ_MULTI_CANDLE_REJECTED", `${ctx.marketKey}:${String(error?.code ?? error?.message ?? error).slice(0, 80)}`));
      return;
    }
    candle.segmentId = segmentIdFor(ctx.marketKey, candle.bucketStart);
    candle.marketKey = ctx.marketKey;
    if (!ctx.candles.has(candle.bucketStart)) {
      if (ctx.stats.lastBucketStart !== null && candle.bucketStart < ctx.stats.lastBucketStart) ctx.stats.reorder += 1;
      else if (ctx.stats.lastBucketStart !== null && candle.bucketStart > ctx.stats.lastBucketStart + CANDLE_SIZE_SECONDS * 1000) ctx.stats.gaps += 1;
      ctx.stats.candlesProcessed += 1; this.metrics.candles += 1;
    } else {
      ctx.stats.duplicates += 1;
    }
    if (ctx.stats.lastBucketStart === null || candle.bucketStart > ctx.stats.lastBucketStart) ctx.stats.lastBucketStart = candle.bucketStart;
    const existing = ctx.candles.get(candle.bucketStart);
    ctx.candles.set(candle.bucketStart, { ...(existing ?? {}), ...candle });
    if (ctx.candles.size > MAX_CANDLE_BUFFER) ctx.candles.delete(Math.min(...ctx.candles.keys()));
    ctx.stats.messages += 1;
    ctx.lastTick = { price: candle.close, bucketStart: candle.bucketStart, bucketEnd: candle.bucketEnd, serverTimestamp: candle.serverTimestamp, receivedAt: candle.receivedAt, ageMs: this.now() - candle.receivedAt, source: candle.source, segmentId: candle.segmentId };
    ctx.lastCandle = candle; ctx.lastTickAt = receivedAt;
    ctx.serverTime = serverTimestamp;
    ctx.connectionHealth = { ...ctx.connectionHealth, connected: true, lastMessageAt: receivedAt };
    if (Number.isFinite(Number(candle.serverTimestamp))) this.#recordLatency(ctx, "serverToReceived", Math.max(0, receivedAt - Number(candle.serverTimestamp)));
    this.#recordLatency(ctx, "receivedToNormalized", 0);
    this.#emitEvent("market.candle", { marketKey: ctx.marketKey, bucketStart: candle.bucketStart, close: candle.close, marketType: ctx.marketType });
    const lastTickEmit = this.lastTickEmit.get(ctx.marketKey) ?? 0;
    if (this.now() - lastTickEmit >= 1_000) { this.lastTickEmit.set(ctx.marketKey, this.now()); this.#emitEvent("market.tick", { marketKey: ctx.marketKey, price: candle.close, ageMs: this.now() - candle.receivedAt }); }
    this.#updateIndicative(ctx);
    this.#maybeEvaluate(ctx);
  }

  #recordLatency(ctx, stage, value) { const list = ctx.latency[stage]; list.push(Math.max(0, Math.round(value))); if (list.length > this.maxLatencySamples) list.splice(0, list.length - this.maxLatencySamples); }

  #candleList(ctx) { return [...ctx.candles.values()].sort((a, b) => a.bucketStart - b.bucketStart); }

  #maybeEvaluate(ctx) {
    const now = this.now();
    if (ctx.featureState && now - ctx.featureState.builtAt < 1_000) return;
    const list = this.#candleList(ctx);
    if (list.length < 3) return;
    const context = buildFeatureContext({ candles: list, now, frameCapturedAt: ctx.lastTickAt ?? now, timeframeSeconds: CANDLE_SIZE_SECONDS, provenanceExtra: { source: "IQ_OPTION_WS", marketKey: ctx.marketKey, connectionId: this.connection?.connectionId ?? null, activeId: ctx.activeId } });
    const fresh = freshnessGate(context);
    ctx.featureState = { builtAt: now, fresh: fresh.fresh, freshnessReason: fresh.reason, context };
    if (ctx.lastTickAt !== null) this.#recordLatency(ctx, "normalizedToFeature", Math.max(0, now - ctx.lastTickAt));
    this.#emitEvent("market.feature", { marketKey: ctx.marketKey, rsi14: context.deterministicIndicators.rsi14.value, fresh: fresh.fresh });
    const bucket = list[list.length - 1]?.bucketStart ?? null;
    if (bucket !== null && ctx.lastResearchBucket !== bucket) {
      ctx.lastResearchBucket = bucket;
      this.research.observeCandle({ marketKey: ctx.marketKey, marketType: ctx.marketType, candles: list, index: list.length - 1, payout: ctx.payout, atMs: now });
      this.ab.settle({ marketKey: ctx.marketKey, candles: list, index: list.length - 1 });
      this.jit.settle({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      this.apprentice.observeCandle({ marketKey: ctx.marketKey, marketType: ctx.marketType, candles: list, index: list.length - 1, features: this.#brainFeatures(list, ctx.featureState?.context ?? null), context: ctx.featureState?.context ?? null, payout: ctx.payout, atMs: now });
    }
    this.#publishInternalIntelligence(now);
    this.#evaluateDecision(ctx, list);
  }

  /** Publica snapshots internos REAIS (nunca inventa externo). MACRO/NEWS ficam NO_FEED. */
  #publishInternalIntelligence(now) {
    if (now - (this.lastIntelligencePublish ?? 0) < 5_000) return;
    this.lastIntelligencePublish = now;
    const active = [...this.markets.values()].filter((ctx) => ctx.enabled);
    const feeds = active.map((ctx) => ctx.featureState?.context?.deterministicIndicators).filter(Boolean);
    const avg = (pick) => { const values = feeds.map(pick).filter((value) => Number.isFinite(value)); return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6)) : null; };
    const positions = [...this.openPositions.values()];
    const concentration = concentrationExposure(positions);
    this.intelligence.publish("MARKET", { activeMarkets: active.length, avgAtrNormalized: avg((row) => row.atrNormalized?.value), avgAdx: avg((row) => row.adx14?.value), bullish: active.filter((ctx) => ctx.decisionState?.action === "BUY").length, bearish: active.filter((ctx) => ctx.decisionState?.action === "SELL").length }, { source: "tracecom-runtime", sourceType: "INTERNAL", marketsAffected: active.map((ctx) => ctx.marketKey), importance: 0.4 });
    this.intelligence.publish("RISK", { openPositions: positions.length, stakeAtRisk: positions.reduce((sum, position) => sum + (Number(position.stake) || 0), 0), concentrationWarnings: concentration.warnings.length, dailySettledPnl: this.portfolioSnapshot().settled.pnl }, { source: "tracecom-portfolio", sourceType: "INTERNAL", importance: 0.5 });
    this.intelligence.publish("SECURITY", { connectionHealthy: this.connectionHealth().healthy, timeValid: this.session.timeValid, rejectedCandles: this.metrics.rejected, dataQuality: this.connectionHealth().healthy && this.session.timeValid ? "OK" : "PARTIAL" }, { source: "tracecom-integrity", sourceType: "INTERNAL", importance: 0.6, dataQuality: this.connectionHealth().healthy && this.session.timeValid ? "OK" : "PARTIAL" });
    this.intelligence.publish("RESEARCH", { setups: CORE_BRAIN.setups ? Object.keys(CORE_BRAIN.setups).length : 0, shadowMarkets: this.research.markets.size, brainGeneration: BRAIN_GENERATION, supervisor: this.supervisor.status().reviews.length }, { source: "tracecom-research", sourceType: "INTERNAL", importance: 0.3 });
  }

  #agentId(ctx) { return `trader:${ctx.marketKey}`; }

  /** Features causais para o brain (momentum normalizado, r24, vol12) — derivadas do Feature Engine, sem variantes antigas. */
  #brainFeatures(list, context) {
    const closes = list.map((candle) => candle.close);
    const rsi = context?.deterministicIndicators?.rsi14?.value ?? null;
    const s = rsi === null ? 0 : (55 - rsi) / 45;
    const r24 = closes.length > 24 && closes[closes.length - 25] ? (closes[closes.length - 1] - closes[closes.length - 25]) / closes[closes.length - 25] : 0;
    const returns = [];
    for (let index = Math.max(1, closes.length - 12); index < closes.length; index += 1) returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
    const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const vol12 = returns.length ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length) : 0;
    return { rsi14: rsi, s: Number(s.toFixed(4)), r24: Number(r24.toFixed(6)), vol12: Number(vol12.toFixed(6)) };
  }

  #evaluateDecision(ctx, list) {
    const now = this.now();
    const correlationId = `corr_${++this.correlationSeq}`;
    // Fase 6: sem variantes antigas. Dados causais -> estrutura -> brain profissional.
    let features = null;
    let structureFeatures = null;
    if (list.length > MIN_CANDLES_FEATURE) {
      structureFeatures = computeStructureFeatures(list, list.length - 1);
      features = this.#brainFeatures(list, ctx.featureState?.context ?? null);
    }
    const context = ctx.featureState?.context ?? null;
    const fresh = { fresh: ctx.featureState?.fresh === true, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE", tickAgeMs: ctx.lastTickAt === null ? null : now - ctx.lastTickAt };
    let regime = structureFeatures ? classifyRegime({ features, structureFeatures, context }) : "UNCLEAR";
    const intelligenceContext = this.intelligence.contextForMarket(ctx.marketKey, ctx.marketType, { atMs: now });
    const knowledgeContext = this.knowledge.contextForMarket(ctx.marketKey, { regime, setup: null, atMs: now });
    let trader, critic, consensus, effectiveFresh = fresh;
    if (this.decisionOverride) {
      const injected = this.decisionOverride({ marketKey: ctx.marketKey, marketType: ctx.marketType, features, structureFeatures, regime, context, freshness: fresh, atMs: now });
      trader = injected.trader; critic = injected.critic; consensus = injected.consensus;
      if (injected.fresh) effectiveFresh = injected.fresh;
      if (injected.regime) regime = injected.regime;
    } else {
      trader = traderBrainDecision({ marketKey: ctx.marketKey, marketType: ctx.marketType, features, context, structureFeatures, regime, freshness: fresh, intelligence: intelligenceContext, knowledgeContext });
      critic = criticBrainAssessment({ trader, features, context, structureFeatures, regime, freshness: fresh, intelligence: intelligenceContext });
      consensus = consensusBrainDecision({ trader, critic, freshness: fresh });
    }
    ctx.agents = { correlationId, at: now, brainGeneration: BRAIN_GENERATION, regime, features, structureFeatures, trader, critic, consensus, intelligenceContext, knowledgeContext };
    this.agentState.set(ctx.marketKey, ctx.agents);
    this.agentLatency.push(trader.latencyMs + critic.latencyMs + consensus.latencyMs);
    if (this.agentLatency.length > this.maxLatencySamples) this.agentLatency.splice(0, this.agentLatency.length - this.maxLatencySamples);
    this.#emitEvent("agent.trader", { marketKey: ctx.marketKey, correlationId, action: trader.action, confidence: trader.analysisConfidence, regime, setup: trader.setup, brainGeneration: BRAIN_GENERATION });
    this.#emitEvent("agent.critic", { marketKey: ctx.marketKey, correlationId, independentAction: critic.independentAction, verdict: critic.traderAssessment, riskFlags: critic.riskFlags.length });
    this.#emitEvent("agent.consensus", { marketKey: ctx.marketKey, correlationId, action: consensus.action, status: consensus.status, reason: consensus.reason });
    this.#auditRecord(correlationId, ctx.marketKey, "AGENTS", { brainGeneration: BRAIN_GENERATION, brainVersion: BRAIN_VERSION, trader: trader.action, setup: trader.setup, criticVerdict: critic.traderAssessment, criticIndependent: critic.independentAction, consensus: consensus.action, consensusStatus: consensus.status, regime, knowledgeIds: knowledgeContext.knowledgeIds, knowledgeUsed: knowledgeContext.used }, { persist: consensus.action === "BUY" || consensus.action === "SELL" });
    // Research shadow por SETUP + A/B v2 (mesmo snapshot causal).
    this.research.observeCandle({ marketKey: ctx.marketKey, marketType: ctx.marketType, candles: list, index: list.length - 1, brain: { setup: trader.setup, action: consensus.action, regime, trigger: trader.trigger }, payout: ctx.payout, atMs: now });
    this.ab.settle({ marketKey: ctx.marketKey, candles: list, index: list.length - 1 });
    this.ab.record({ marketKey: ctx.marketKey, marketType: ctx.marketType, atMs: now, setup: trader.setup, entryPrice: ctx.lastCandle?.close ?? null, settlementAfterMs: (ctx.lastCandle?.bucketStart ?? now) + BRAIN_HORIZON_SECONDS * 1000, payout: ctx.payout, actions: { A_TRADER: trader.action, B_TRADER_CRITIC: consensus.action, C_PLUS_INTELLIGENCE: consensus.action === "WAIT" || intelligenceContext?.news?.importance < 0.9 ? consensus.action : "WAIT", D_APPRENTICE: trader.action } });
    const action = consensus.action;
    const reason = consensus.status === "CONFIRMED" ? "CONSENSUS_CONFIRMED" : consensus.reason;
    const confidence = consensus.analysisConfidence;
    ctx.decisionState = {
      action, reason, confidence, setup: trader.setup, regime, horizonSeconds: BRAIN_HORIZON_SECONDS, evaluatedAt: now, featuresAvailable: Boolean(structureFeatures),
      trigger: trader.trigger, waitReason: trader.waitReason,
      consensus: { status: consensus.status, reason: consensus.reason, traderAction: trader.action, criticIndependent: critic.independentAction, criticVerdict: critic.traderAssessment },
      processLog: trader.processLog, knowledge: { used: knowledgeContext.used, ids: knowledgeContext.knowledgeIds, version: knowledgeContext.knowledgeVersion, latencyMs: knowledgeContext.retrievalLatencyMs },
      brainGeneration: BRAIN_GENERATION,
    };
    ctx.lastDecision = ctx.decisionState;
    this.journal.recordDecision({ agentId: this.#agentId(ctx), marketKey: ctx.marketKey, marketType: ctx.marketType, decisionAt: now, snapshot: { ...ctx.decisionState, critic: { verdict: critic.traderAssessment, independent: critic.independentAction }, consensus: { status: consensus.status, action: consensus.action }, knowledgeContextIds: knowledgeContext.knowledgeIds } });
    this.#emitEvent("market.decision", { marketKey: ctx.marketKey, action, reason, confidence, setup: trader.setup, regime, consensus: consensus.status });
    if (action === "BUY" || action === "SELL") {
      ctx.lastSignal = { action, at: this.now(), bucketStart: ctx.lastCandle?.bucketStart ?? null, setup: trader.setup };
      this.#emitEvent("market.signal", { marketKey: ctx.marketKey, action, bucketStart: ctx.lastSignal.bucketStart, setup: trader.setup, consensus: consensus.status, correlationId });
    } else {
      if (ctx.positionState?.status === "OPEN" || ctx.positionState?.status === "ORDERING") this.#setAgent(ctx, ctx.positionState.status === "OPEN" ? "IN_POSITION" : "ORDERING", "POSITION_OPEN");
      else if (!ctx.candidate) this.#setAgent(ctx, "WAIT", reason);
      if (this.now() - (ctx.lastWaitEmit ?? 0) > 5_000) { ctx.lastWaitEmit = this.now(); this.#emitEvent("market.wait", { marketKey: ctx.marketKey, reason, waitReason: trader.waitReason, setup: trader.setup, consensus: consensus.status }); }
      this.#expireSignals(ctx);
    }
    void this.#entryPipeline(ctx, { action, trader, critic, consensus, fresh: effectiveFresh, knowledgeContext, intelligenceContext, now, correlationId });
  }

  /* ------------------------------- entrada just-in-time (Fase 6.2) ------------------------------- */

  /** Pipeline: CANDIDATE -> espera janela -> revalidacao final (T-entryLeadMs) -> commit. Nunca inverte sozinho. */
  async #entryPipeline(ctx, { action, trader, critic, consensus, fresh, now, correlationId }) {
    if (this.pendingOrders.has(ctx.marketKey) || this.openPositions.has(ctx.marketKey)) { this.#setAgent(ctx, "IN_POSITION", "POSITION_OPEN"); return; }
    const serverNow = this.client?.serverNow?.() ?? now;
    if (this.config.jitEnabled !== true) { if (action !== "BUY" && action !== "SELL") return; this.#setAgent(ctx, "SIGNAL", "JIT_DISABLED"); void this.#handleSignal(ctx, action, trader, this.#candleList(ctx)); return; }
    if (!ctx.candidate) {
      if (action !== "BUY" && action !== "SELL") return;
      const leadMs = this.#entryLeadMs();
      const window = nextEntryWindow({ serverNowMs: serverNow, leadMs, horizonMs: BRAIN_HORIZON_SECONDS * 1000 });
      const snapshot = this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
      const candidate = makeCandidate({ marketKey: ctx.marketKey, marketType: ctx.marketType, action, now, serverNow, window, snapshot, correlationId });
      ctx.candidate = candidate;
      this.#scheduleEntryFinalize(ctx, candidate, serverNow);
      this.jit.recordCandidate({ marketKey: ctx.marketKey, marketType: ctx.marketType, candidateId: candidate.id, action, entryPrice: ctx.lastCandle?.close ?? null, payout: ctx.payout, atMs: now, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, regime: snapshot.regime, setup: snapshot.setup, trigger: snapshot.trigger });
      this.#setAgent(ctx, "SIGNAL", `CANDIDATE_${action}`);
      this.#emitEvent("candidate.created", { marketKey: ctx.marketKey, candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, submitAt: candidate.submitAt, entryLeadMs: leadMs, secondsToWindow: Math.max(0, Math.round((candidate.targetEntryAt - serverNow) / 1000)) });
      this.#auditRecord(correlationId ?? candidate.id, ctx.marketKey, "CANDIDATE_CREATED", { candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, submitAt: candidate.submitAt, entryLeadMs: leadMs, serverNow, regime: snapshot.regime, setup: snapshot.setup, trigger: snapshot.trigger }, { persist: true });
      this.#safe(() => this.log("IQ_ENTRY_CANDIDATE_CREATED", JSON.stringify({ marketKey: ctx.marketKey, candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, entryLeadMs: leadMs })));
      return;
    }

    const candidate = ctx.candidate;
    candidate.evaluations += 1;
    candidate.updatedAt = now;
    // Secao 6/9: mudanca intermediaria NAO cancela; marca candidateChangedBeforeEntry e segue analisando.
    // A decisao e SEMPRE a revalidacao final em submitAt (T-entryLeadMs).
    const finalFull = this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
    const finalComparable = comparableSnapshot(finalFull);
    const comparison = compareCandidateSnapshots(candidate.initial, finalComparable);
    if (comparison.changed && (!candidate.changes.changed || comparison.changes.length !== candidate.changes.changes.length)) {
      candidate.changes = comparison;
      this.#emitEvent("candidate.updated", { marketKey: ctx.marketKey, candidateId: candidate.id, changed: comparison.changes.map((change) => change.field), interimAction: action });
      this.#auditRecord(correlationId ?? candidate.id, ctx.marketKey, "CANDIDATE_UPDATED", { candidateId: candidate.id, changes: comparison.changes, interimAction: action }, { persist: true });
    }
    if (serverNow > candidate.targetEntryAt + this.#entryMaxDriftMs()) { this.#cancelCandidate(ctx, "ENTRY_WINDOW_MISSED", { serverNow, targetEntryAt: candidate.targetEntryAt }); return; }
    if (serverNow < candidate.submitAt) { this.#setAgent(ctx, "SIGNAL", `CANDIDATE_${candidate.action}`); return; }
    return this.#finalizeEntry(ctx, { action, trader, critic, consensus, fresh, now, correlationId, source: "TICK" });
  }

  /** Timer no instante exato de submitAt (server time) para nao depender do tick de candle. */
  #scheduleEntryFinalize(ctx, candidate, serverNow) {
    const delay = Math.max(0, Math.min(BRAIN_HORIZON_SECONDS * 2000, candidate.submitAt - serverNow));
    candidate.finalizeTimer = setTimeout(() => { candidate.finalizeTimer = null; void this.#finalizeCandidate(ctx); }, delay);
    candidate.finalizeTimer.unref?.();
  }

  /** Revalidacao no timer: usa o snapshot MAIS RECENTE disponivel (ultima avaliacao), nunca o do candidato. */
  async #finalizeCandidate(ctx) {
    const agents = ctx.agents;
    if (!ctx.candidate || ctx.candidate.finalized) return;
    if (!agents) { this.#cancelCandidate(ctx, "CANDIDATE_NO_LATEST_ANALYSIS", {}); return; }
    const now = this.now();
    const fresh = { fresh: Boolean(ctx.featureState?.fresh) && ctx.lastTickAt !== null && now - ctx.lastTickAt <= MARKET_TICK_AGE_MS, tickAgeMs: ctx.lastTickAt === null ? null : now - ctx.lastTickAt, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE" };
    const action = ctx.decisionState?.action ?? agents.consensus?.action ?? "WAIT";
    return this.#finalizeEntry(ctx, { action, trader: agents.trader, critic: agents.critic, consensus: agents.consensus, fresh, now, correlationId: agents.correlationId, source: "TIMER" });
  }

  /** Revalidacao final (T-entryLeadMs): decide COMMIT ou CANCEL. Nunca inverte sozinho. */
  async #finalizeEntry(ctx, { action, trader, critic, consensus, fresh, now, correlationId, source = "TICK" }) {
    const candidate = ctx.candidate;
    if (!candidate || candidate.finalized) return;
    const serverNow = this.client?.serverNow?.() ?? now;
    if (serverNow > candidate.targetEntryAt + this.#entryMaxDriftMs()) { this.#cancelCandidate(ctx, "ENTRY_WINDOW_MISSED", { serverNow, targetEntryAt: candidate.targetEntryAt }); return; }
    candidate.finalized = true;
    if (candidate.finalizeTimer) { clearTimeout(candidate.finalizeTimer); candidate.finalizeTimer = null; }
    const finalDecision = { action, regime: ctx.decisionState?.regime ?? null, setup: trader?.setup ?? null, trigger: trader?.trigger ?? null, criticVerdict: critic?.traderAssessment ?? null, consensusStatus: consensus?.status ?? null };
    const revalidation = revalidateCandidate({ candidate: { action: candidate.action, regime: candidate.initial.regime, setup: candidate.initial.setup }, final: finalDecision, freshness: fresh, config: this.config });
    candidate.revalidatedAt = now; candidate.status = "REVALIDATING"; candidate.confirmation = revalidation;
    this.#emitEvent("candidate.revalidated", { marketKey: ctx.marketKey, candidateId: candidate.id, ok: revalidation.ok, reason: revalidation.reason, source });
    this.#auditRecord(correlationId ?? candidate.id, ctx.marketKey, "FINAL_REVALIDATION", { candidateId: candidate.id, ok: revalidation.ok, reason: revalidation.reason, checks: revalidation.checks, candidateChangedBeforeEntry: candidate.changes.changed, changedFields: candidate.changes.changes, finalDecision, entryLeadMs: candidate.entryLeadMs, serverNow }, { persist: true });
    if (!revalidation.ok) { this.#cancelCandidate(ctx, revalidation.reason ?? "CANDIDATE_REVALIDATION_FAILED", { checks: revalidation.checks }); return; }
    candidate.status = "CONFIRMED"; candidate.confirmedAt = now;
    this.#emitEvent("candidate.confirmed", { marketKey: ctx.marketKey, candidateId: candidate.id, action, secondsToEntry: Math.max(0, Math.round((candidate.targetEntryAt - serverNow) / 1000)) });
    const entryTiming = {
      candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, targetExpirySec: Math.round(candidate.targetExpiryAt / 1000),
      submitAt: candidate.submitAt, entryLeadMs: candidate.entryLeadMs, revalidatedAt: now, candidateChangedBeforeEntry: candidate.changes.changed, changedFields: candidate.changes.changes,
      initialSnapshot: candidate.initialFull, revalidationChecks: revalidation.checks,
    };
    const record = await this.#handleSignal(ctx, action, trader, this.#candleList(ctx), entryTiming);
    if (record?.disposition === "EXECUTED") { candidate.status = "ORDER_SENT"; this.#setAgent(ctx, "IN_POSITION", "ORDER_SENT"); }
    else if (record?.disposition === "DUPLICATE") { candidate.status = "DUPLICATE"; this.#commitCandidate(ctx, "CANDIDATE_DUPLICATE", { signalId: record?.id ?? null }); }
    else { candidate.status = "GATE_BLOCKED"; this.#cancelCandidate(ctx, `ORDER_${record?.reason ?? "BLOCKED"}`, { signalId: record?.id ?? null, reason: record?.reason ?? null }); }
  }

  #candidateSnapshot(ctx, { action, trader, critic, consensus, now }) {
    return {
      action, marketKey: ctx.marketKey, marketType: ctx.marketType, at: now, price: ctx.lastCandle?.close ?? null,
      regime: ctx.decisionState?.regime ?? null, structure: trader?.structure ?? null, setup: trader?.setup ?? null, trigger: trader?.trigger ?? null,
      momentum: trader?.momentum ?? null, strength: trader?.strength ?? null, volatility: trader?.volatility ?? null, microstructure: trader?.microstructure ?? null, location: trader?.location ?? null,
      critic: { verdict: critic?.traderAssessment ?? null, independentAction: critic?.independentAction ?? null, contradictions: critic?.contradictions ?? [], riskFlags: critic?.riskFlags ?? [] },
      consensus: { status: consensus?.status ?? null, reason: consensus?.reason ?? null },
      knowledgeContextIds: ctx.decisionState?.knowledge?.ids ?? [], knowledgeVersion: ctx.decisionState?.knowledge?.version ?? null,
      freshness: { fresh: ctx.featureState?.fresh === true, reason: ctx.featureState?.freshnessReason ?? null, tickAgeMs: ctx.lastTickAt === null ? null : now - ctx.lastTickAt },
      basis: { candles: "CLOSED_CANDLE", tick: "INTRABAR_REALTIME_DATA" },
    };
  }

  #entryLeadMs() {
    const samples = this.agentLatency.length ? [...this.agentLatency] : [];
    const ackSamples = [...this.markets.values()].flatMap((ctx) => ctx.latency.orderAck).slice(-50);
    return dynamicEntryLeadMs([...ackSamples, ...samples.map((value) => Math.round(value / 10))], { fallback: this.config.entryLeadMs ?? DEFAULT_ENTRY_LEAD_MS });
  }

  #entryMaxDriftMs() { const value = Number(this.config.entryWindowMaxDriftMs); return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_DRIFT_MS; }

  #commitCandidate(ctx, reason, detail = {}) {
    const candidate = ctx.candidate;
    if (!candidate) return null;
    if (candidate.finalizeTimer) { clearTimeout(candidate.finalizeTimer); candidate.finalizeTimer = null; }
    candidate.status = "CANCELLED"; candidate.cancelReason = reason; candidate.closedAt = this.now();
    ctx.lastCandidate = { ...candidate, initialFull: undefined };
    ctx.candidate = null;
    this.jit.recordCancellation({ candidateId: candidate.id, reason, changes: candidate.changes?.changes ?? [] });
    this.#emitEvent("candidate.cancelled", { marketKey: ctx.marketKey, candidateId: candidate.id, reason, detail });
    this.#auditRecord(candidate.correlationId ?? candidate.id, ctx.marketKey, "CANDIDATE_CANCELLED", { candidateId: candidate.id, reason, detail, evaluations: candidate.evaluations, changed: candidate.changes?.changed === true, changedFields: candidate.changes?.changes ?? [] }, { persist: true });
    this.#safe(() => this.log("IQ_ENTRY_CANDIDATE_CANCELLED", JSON.stringify({ marketKey: ctx.marketKey, candidateId: candidate.id, reason })));
    return candidate;
  }

  #cancelCandidate(ctx, reason, detail = {}) {
    const candidate = ctx.candidate;
    if (!candidate) return null;
    candidate.lastCancelReason = reason;
    const cancelled = this.#commitCandidate(ctx, reason, detail);
    this.#setAgent(ctx, "WAIT", reason);
    return cancelled;
  }

  setEntryTimingConfig(patch = {}) {
    const allowed = ["jitEnabled", "entryLeadMs", "entryWindowMaxDriftMs"];
    const next = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.includes(key)) continue;
      if (key === "jitEnabled") next.jitEnabled = value === true;
      else if (Number.isFinite(Number(value))) next[key] = key === "entryLeadMs" ? Math.max(MIN_ENTRY_LEAD_MS, Math.min(MAX_ENTRY_LEAD_MS, Math.round(Number(value)))) : Math.max(0, Math.round(Number(value)));
    }
    Object.assign(this.config, next);
    this.config.revision = Number(this.config.revision || 0) + 1;
    void this.#persistConfig();
    this.#emitEvent("entry.config", { config: { jitEnabled: this.config.jitEnabled, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.config.entryWindowMaxDriftMs } });
    return { jitEnabled: this.config.jitEnabled, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.config.entryWindowMaxDriftMs };
  }

  entryTimingStatus() {
    const now = this.now();
    const serverNow = this.client?.serverNow?.() ?? now;
    const markets = [...this.markets.values()].filter((ctx) => ctx.candidate || ctx.lastCandidate).map((ctx) => this.#publicEntryTiming(ctx, serverNow));
    return { version: ENTRY_TIMING_VERSION, jitEnabled: this.config.jitEnabled === true, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.#entryMaxDriftMs(), markets, scoreboard: this.jit.scoreboard() };
  }

  #publicEntryTiming(ctx, serverNow) {
    const candidate = ctx.candidate ?? ctx.lastCandidate;
    if (!candidate) return null;
    const active = ctx.candidate ? candidate : null;
    const stage = active
      ? (active.status === "CONFIRMED" || active.status === "ORDER_SENT" ? "ENVIANDO ORDEM" : serverNow >= active.submitAt ? "REVALIDANDO" : "AGUARDANDO JANELA")
      : (candidate.status === "WINDOW_MISSED" ? "OPORTUNIDADE PERDIDA" : candidate.status === "CANCELLED" || candidate.status === "GATE_BLOCKED" ? "OPORTUNIDADE CANCELADA" : "OPORTUNIDADE IDENTIFICADA");
    return {
      candidateId: candidate.id, action: candidate.action, status: candidate.status, stage,
      createdAt: candidate.createdAt, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, submitAt: candidate.submitAt,
      revalidatedAt: candidate.revalidatedAt ?? null, confirmedAt: candidate.confirmedAt ?? null, cancelReason: candidate.cancelReason ?? candidate.lastCancelReason ?? null,
      entryLeadMs: candidate.entryLeadMs, candidateChangedBeforeEntry: candidate.changes?.changed === true, changedFields: candidate.changes?.changes ?? [],
      secondsToRevalidation: active ? Math.max(0, Math.round((active.submitAt - serverNow) / 1000)) : null,
      secondsToEntry: active ? Math.max(0, Math.round((active.targetEntryAt - serverNow) / 1000)) : null,
    };
  }

  #auditRecord(correlationId, marketKey, stage, detail = {}, { persist = false } = {}) {
    const record = { correlationId, marketKey, stage, detail, at: this.now() };
    this.audit.push(record);
    if (this.audit.length > 800) this.audit.splice(0, this.audit.length - 800);
    if (persist) void (async () => { try { if (!await this.#ensureDb()) return; await this.pool.query("INSERT INTO iq_audit_trail(correlation_id,market_key,stage,detail) VALUES($1,$2,$3,$4::jsonb)", [correlationId, marketKey, stage, JSON.stringify(detail)]); } catch { /* best effort */ } })();
    return record;
  }

  auditTrail({ correlationId = null, marketKey = null, limit = 100 } = {}) {
    const bounded = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = [...this.audit].reverse().filter((row) => (!correlationId || row.correlationId === correlationId) && (!marketKey || row.marketKey === marketKey)).slice(0, bounded);
    return { audit: rows, total: this.audit.length };
  }

  #setAgent(ctx, state, reason = null) {
    if (!AGENT_STATES.includes(state)) return;
    if (ctx.agentState === state && state !== "WAIT") return;
    ctx.agentState = state; ctx.agentSince = this.now(); ctx.agentReason = reason;
  }

  /* ------------------------------- indicativo ------------------------------- */

  #updateIndicative(ctx) {
    const position = ctx.positionState;
    if (!position || position.status !== "OPEN" || !Number.isFinite(Number(position.entryPrice)) || !ctx.lastCandle) { ctx.indicative = { state: "NEUTRAL", delta: null, indicativePnl: null, updatedAt: this.now() }; return; }
    const price = ctx.lastCandle.close;
    const delta = price - position.entryPrice;
    const epsilon = Math.abs(position.entryPrice) * 1e-6;
    const favorable = position.direction === "CALL" ? delta > epsilon : delta < -epsilon;
    const unfavorable = position.direction === "CALL" ? delta < -epsilon : delta > epsilon;
    const state = favorable ? "FAVORABLE" : unfavorable ? "UNFAVORABLE" : "NEUTRAL";
    const payoutFraction = this.#payoutFraction(ctx);
    const indicativePnl = state === "FAVORABLE" ? Number((position.stake * payoutFraction).toFixed(4)) : state === "UNFAVORABLE" ? -Number(position.stake) : 0;
    ctx.indicative = { state, delta: Number(delta.toFixed(8)), indicativePnl, updatedAt: this.now(), indicative: true };
    if (this.now() - (ctx.lastIndicativeEmit ?? 0) > 2_000) { ctx.lastIndicativeEmit = this.now(); this.#emitEvent("position.indicative", { marketKey: ctx.marketKey, state, indicativePnl, delta: ctx.indicative.delta }); }
  }

  #payoutFraction(ctx) {
    const payout = Number(ctx.payout);
    if (!Number.isFinite(payout) || payout <= 0) return 0.85; // fracao conservadora apenas para exibicao indicativa
    return payout > 1 ? payout / 100 : payout;
  }

  /* ------------------------------- execucao ------------------------------- */

  /* ------------------------------- signal -> disposicao (observabilidade obrigatoria) ------------------------------- */

  #signalStatsFor(key) {
    if (!this.signalStats.has(key)) this.signalStats.set(key, { total: 0, executed: 0, blocked: 0, expired: 0, duplicate: 0, wins: 0, losses: 0, draws: 0, settledPnl: 0 });
    return this.signalStats.get(key);
  }

  /** Registra TODO sinal com destino observavel: EXECUTED | BLOCKED | EXPIRED | DUPLICATE + motivo humano. */
  async #handleSignal(ctx, action, brain, list, entryTiming = null) {
    const now = this.now();
    const bucket = ctx.lastCandle?.bucketStart ?? null;
    const idempotencyKey = `${ctx.marketKey}:${bucket}:${action}`;
    const existing = this.signalLog.find((row) => row.idempotencyKey === idempotencyKey);
    if (existing) {
      const stats = this.#signalStatsFor(ctx.marketKey);
      stats.duplicate += 1;
      existing.attempts = (existing.attempts ?? 1) + 1;
      if (!existing.duplicateLogged) { existing.duplicateLogged = true; this.#emitEvent("signal.disposition", { marketKey: ctx.marketKey, action, disposition: "DUPLICATE", reason: "SINAL_JA_REGISTRADO", signalId: existing.id }); }
      return existing;
    }
    const resolved = resolveFinalStake({ marketConfiguredStake: ctx.configuredStake, configuredStake: this.config.defaultStake, calculatedBankrollStake: this.config.calculatedBankrollStake, marketMaxStake: ctx.maxStake, globalMaxStake: this.config.globalMaxStake, hardCap: this.config.hardCap });
    const last = list[list.length - 1] ?? ctx.lastCandle ?? null;
    const horizonSeconds = BRAIN_HORIZON_SECONDS;
    const freshness = { fresh: Boolean(ctx.featureState?.fresh) && ctx.lastTickAt !== null && now - ctx.lastTickAt <= MARKET_TICK_AGE_MS, tickAgeMs: ctx.lastTickAt === null ? null : now - ctx.lastTickAt, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE" };
    const realAuthorized = this.config.mode === "REAL" && this.realMode.authorized();
    const brainValid = Boolean(brain?.setup && brain.setup !== "NO_VALID_SETUP");
    const gate = this.gate.evaluate({
      market: { ...ctx, marketKey: ctx.marketKey }, marketKey: ctx.marketKey, requestedMode: this.config.mode, realAuthorized,
      connection: { connected: this.session.connected, timeValid: this.session.timeValid, host: this.session.host },
      serverTime: { ms: this.client?.serverNow() ?? now, skewMs: this.session.clockSkewMs },
      freshness, decision: { action, ageMs: 0, horizonSeconds, reason: ctx.decisionState.reason }, strategy: { valid: brainValid, variantId: brain?.setup ?? null, reason: brainValid ? null : "SEM_SETUP" },
      price: last?.close ?? null, stake: resolved.finalStake, configuredStake: this.config.defaultStake, globalMaxStake: this.config.globalMaxStake, calculatedBankrollStake: this.config.calculatedBankrollStake,
      openPositions: [...this.openPositions.values()], pendingOrderKeys: [...this.pendingOrders.keys()], usedIdempotencyKeys: [...this.idempotency.byKey.keys()], activeMarketKeys: this.activeMarketKeys(),
      killSwitch: this.killSwitch.status(), idempotencyKey, horizonSeconds,
    });
    let disposition = "EXECUTED"; let reason = "AUTORIZADO";
    if (this.killSwitch.status().executionEnabled !== true) { disposition = "BLOCKED"; reason = "PARADA_DE_EMERGENCIA"; }
    else if (this.config.autoExecute !== true) { disposition = "BLOCKED"; reason = "AUTO_DESLIGADO"; }
    else if (this.armState.armed !== true) { disposition = "BLOCKED"; reason = "SISTEMA_DESARMADO"; }
    else if (ctx.paused === true) { disposition = "BLOCKED"; reason = "AGENTE_PAUSADO"; }
    else if (!this.session.connected) { disposition = "BLOCKED"; reason = "SEM_CONEXAO_IQ"; }
    else if (this.pendingOrders.has(ctx.marketKey)) { disposition = "BLOCKED"; reason = "ORDEM_EM_ANDAMENTO"; }
    else if (this.openPositions.has(ctx.marketKey)) { disposition = "BLOCKED"; reason = "POSICAO_JA_ABERTA"; }
    else if (!gate.allowed) { disposition = "BLOCKED"; reason = `GATE_${gate.code}`; }
    const record = {
      id: ++this.signalSeq, marketKey: ctx.marketKey, marketType: ctx.marketType, canonical: ctx.canonical, display: ctx.display, activeId: ctx.activeId,
      action, setup: brain?.setup ?? null, regime: brain?.regime ?? null, strategyVariantId: null, strategySource: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, at: now, bucketStart: bucket, horizonSeconds,
      stakeConfigured: resolved.requestedStake, stakeRequested: resolved.requestedStake, stakeCalculated: Number(this.config.calculatedBankrollStake), stakeFinal: resolved.finalStake, cappedBy: resolved.cappedBy, stakeSource: resolved.source, stakeAdjustment: resolved.adjustment,
      payout: ctx.payout, auto: this.config.autoExecute === true, armed: this.armState.armed === true, mode: this.config.mode,
      entryTiming: entryTiming ? { candidateId: entryTiming.candidateId, targetEntryAt: entryTiming.targetEntryAt, targetExpiryAt: entryTiming.targetExpiryAt, submitAt: entryTiming.submitAt, entryLeadMs: entryTiming.entryLeadMs, revalidatedAt: entryTiming.revalidatedAt, candidateChangedBeforeEntry: entryTiming.candidateChangedBeforeEntry, changedFields: entryTiming.changedFields ?? [] } : null,
      disposition, reason, idempotencyKey, gate: { allowed: gate.allowed, code: gate.code, reasons: gate.reasons, failed: gate.checks.filter((check) => !check.ok).map((check) => check.name) },
      executionId: null, brokerOrderId: null, ackAt: null, settledAt: null, result: null, profit: null, duplicateOf: existing?.id ?? null,
    };
    this.signalLog.push(record);
    if (this.signalLog.length > 500) this.signalLog.splice(0, this.signalLog.length - 500);
    const stats = this.#signalStatsFor(ctx.marketKey); stats.total += 1;
    if (disposition === "BLOCKED") stats.blocked += 1; else stats.executed += 1;
    this.#emitEvent("signal.disposition", { marketKey: ctx.marketKey, action, disposition, reason, signalId: record.id, stakeFinal: record.stakeFinal, auto: record.auto, armed: record.armed });
    this.#safe(() => this.log("IQ_MULTI_SIGNAL_DISPOSITION", JSON.stringify({ signalId: record.id, marketKey: ctx.marketKey, action, disposition, reason, stakeFinal: record.stakeFinal, auto: record.auto, armed: record.armed })));
    if (disposition === "BLOCKED" || disposition === "DUPLICATE") return record;
    try {
      const orderSource = brain?.setup === "SYNTHETIC_TEST" ? "DIAGNOSTIC_SIGNAL" : "AUTO_DECISION";
      const result = await this.requestOrder({ marketKey: ctx.marketKey, direction: action, stake: null, decisionId: `auto_${ctx.marketKey}_${bucket}`, idempotencyKey, source: orderSource, horizonSeconds, decisionAgeMs: Math.max(0, this.now() - now), entryTiming });
      if (result.duplicate) { record.disposition = "DUPLICATE"; record.reason = "IDEMPOTENCIA"; stats.executed = Math.max(0, stats.executed - 1); stats.duplicate += 1; }
      else {
        record.executionId = result.executionId ?? null; record.brokerOrderId = result.brokerOrderId ?? null; record.ackAt = result.state === "ACKNOWLEDGED" ? this.now() : null;
        if (result.state !== "ACKNOWLEDGED") { record.disposition = "BLOCKED"; record.reason = result.state === "UNKNOWN" ? "ACK_DESCONHECIDO" : String(result.state); stats.executed = Math.max(0, stats.executed - 1); stats.blocked += 1; }
      }
      this.#emitEvent("signal.disposition.final", { marketKey: ctx.marketKey, signalId: record.id, disposition: record.disposition, reason: record.reason, brokerOrderId: record.brokerOrderId });
      return record;
    } catch (error) {
      record.disposition = "BLOCKED"; record.reason = String(error?.code ?? error?.message ?? error).slice(0, 80);
      stats.executed = Math.max(0, stats.executed - 1); stats.blocked += 1;
      this.#emitEvent("signal.disposition.final", { marketKey: ctx.marketKey, signalId: record.id, disposition: "BLOCKED", reason: record.reason });
      return record;
    }
  }

  /** Sinal bloqueado que ficou velho sem execucao vira EXPIRED (nunca desaparece silenciosamente). */
  #expireSignals(ctx) {
    const now = this.now();
    for (const record of this.signalLog) {
      if (record.marketKey !== ctx.marketKey || record.disposition !== "BLOCKED") continue;
      if (now - record.at < 60_000) continue;
      record.disposition = "EXPIRED"; record.expiredAt = now; record.blockedReason = record.reason; record.reason = `${record.reason}_EXPIRADO`;
      const stats = this.#signalStatsFor(ctx.marketKey); stats.blocked = Math.max(0, stats.blocked - 1); stats.expired += 1;
    }
  }

  signals(limit = 50, marketKeyFilter = null) {
    const bounded = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = [...this.signalLog].reverse().filter((row) => !marketKeyFilter || row.marketKey === marketKeyFilter).slice(0, bounded);
    return { signals: rows, stats: Object.fromEntries(this.signalStats), total: this.signalLog.length };
  }

  /** Sinal sintetico para diagnostico/teste: registra disposicao passando por TODOS os gates reais. */
  async simulateSignal(marketKey, action, { strategy = null } = {}) {
    const ctx = this.markets.get(marketKey);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(marketKey));
    if (action !== "BUY" && action !== "SELL") throw new IqWsError("INVALID_DIRECTION", String(action));
    const setupFromBrain = ctx.decisionState?.setup && ctx.decisionState.setup !== "NO_VALID_SETUP" ? ctx.decisionState.setup : null;
    const brain = { setup: strategy ?? setupFromBrain ?? "SYNTHETIC_TEST", regime: ctx.decisionState?.regime ?? null };
    return this.#handleSignal(ctx, action, brain, this.#candleList(ctx));
  }

  expireSignals() { for (const ctx of this.markets.values()) this.#expireSignals(ctx); return this.signalLog.filter((row) => row.disposition === "EXPIRED").length; }

  /* ------------------------------- intelligence / research / supervisor / knowledge ------------------------------- */

  intelligenceStatus() { return { version: this.intelligence.status(), domains: [...INTELLIGENCE_DOMAINS], feeds: this.feeds.status(), knowledge: this.knowledge.status(), secondBrain: this.secondBrain.status(), brainGeneration: BRAIN_GENERATION, brainVersion: BRAIN_VERSION }; }

  /** Publica itens externos reais (nunca inventados; item sem publishedAt nao entra). */
  #applyExternalItems(kind, items) {
    let applied = 0;
    for (const item of Array.isArray(items) ? items : []) {
      if (!item?.meta) continue;
      this.intelligence.publish(kind, item.payload, item.meta);
      applied += 1;
    }
    if (applied) this.#emitEvent("intelligence.external", { kind, items: applied });
    return applied;
  }

  /** Supervisor monitora qualidade e solicita REVIEW_REQUIRED; NAO troca metodologia nem inventa estrategia. */
  async #runSupervisorCheck(ctx) {
    const agentId = this.#agentId(ctx);
    const memory = this.journal.agentMemory(agentId);
    const review = this.supervisor.evaluate({ agentId, marketKey: ctx.marketKey, stats: memory.stats, review: this.hypotheses.list().filter((item) => item.marketKey === ctx.marketKey).slice(0, 3) });
    if (review.status !== "OK") {
      this.#emitEvent("supervisor.review", { marketKey: ctx.marketKey, agentId, status: review.status, reasons: review.reasons });
      this.#auditRecord(`sup_${review.id}`, ctx.marketKey, "SUPERVISOR", { status: review.status, reasons: review.reasons }, { persist: true });
      this.#safe(() => this.log("IQ_MULTI_SUPERVISOR_REVIEW", JSON.stringify({ marketKey: ctx.marketKey, status: review.status, reasons: review.reasons })));
    }
    return review;
  }

  supervisorStatus() { return this.supervisor.status(); }
  setSupervisorConfig(patch = {}) {
    const allowed = ["minSamples", "maxDrawdown", "maxConsecutiveLosses", "minDecisionQuality", "reviewCooldownMs"];
    const next = { ...this.supervisor.config };
    for (const [key, value] of Object.entries(patch)) { if (allowed.includes(key) && Number.isFinite(Number(value)) && Number(value) >= 0) next[key] = Number(value); }
    this.supervisor.config = next;
    this.config.revision = Number(this.config.revision || 0) + 1;
    void this.#persistConfig();
    this.#emitEvent("supervisor.config", { config: next });
    return { ...next };
  }

  knowledgeStatus() { return this.knowledge.status(); }
  async knowledgeRebuild() { const result = await this.knowledge.rebuild(); this.knowledgeRebuiltAt = this.now(); return result; }
  knowledgeSearch(query = {}) { return this.knowledge.search(query); }
  async secondBrainProbe() { return this.secondBrain.probe(); }

  journalSummary() {
    const agentIds = [...this.journal.agentStats.keys()];
    return { version: "trade-journal-v1", agents: agentIds.map((agentId) => ({ agentId, stats: this.journal.agentMemory(agentId).stats })), recentTrades: this.journal.trades.slice(-30).reverse(), daily: this.journal.dailyReport() };
  }
  agentMemory(agentId) { return this.journal.agentMemory(agentId); }
  async writeDailyReport(date = null) { return this.journal.writeDailyReport(date ?? new Date(this.now()).toISOString().slice(0, 10)); }
  hypothesesStatus() { return { items: this.hypotheses.list(), defaults: this.hypotheses.config }; }
  createHypothesis(input = {}) { return this.hypotheses.create(input); }
  evaluateHypothesis(id) { return this.hypotheses.evaluate(id); }

  apprenticeStatus() { return this.apprentice.scoreboard(); }
  apprenticeTrades(limit = 30) { return { trades: this.apprentice.recentTrades(limit), execution: "SHADOW_ONLY" }; }
  setApprenticeConfig(patch = {}) {
    const allowed = ["enabled", "reviewEverySettlements", "minCandidateSamples", "minPerformanceDelta", "maxCandidates", "cooldownSettlements", "maxLessonsPerWindow", "lessonWindowSettlements"];
    const next = { ...this.apprentice.config };
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.includes(key)) continue;
      if (key === "enabled") next.enabled = value === true;
      else if (Number.isFinite(Number(value))) next[key] = Math.max(1, Number(value));
    }
    next.execution = "SHADOW_ONLY";
    this.apprentice.config = next;
    this.config.revision = Number(this.config.revision || 0) + 1;
    void this.#persistConfig();
    this.#emitEvent("apprentice.config", { enabled: next.enabled, reviewEverySettlements: next.reviewEverySettlements });
    return { ...next };
  }

  researchScoreboard({ marketKey = null } = {}) {    if (marketKey) return { marketKey, board: this.research.scoreboard(marketKey), recentTrades: this.research.recentTrades(marketKey, 30) };
    return { scoreboard: this.research.scoreboardAll(), ab: this.ab.scoreboard(), note: "Setups do Professional Brain; nenhuma variante V1/V2/V3/V8." };
  }


  portfolioSnapshot() {
    const openPositions = [...this.openPositions.values()];
    const exposure = concentrationExposure(openPositions);
    const settled = [...this.markets.values()].reduce((acc, ctx) => {
      acc.wins += ctx.settlementState.daily.wins; acc.losses += ctx.settlementState.daily.losses; acc.draws += ctx.settlementState.daily.draws; acc.pnl += ctx.settlementState.daily.settledPnl; acc.trades += ctx.settlementState.daily.trades;
      return acc;
    }, { wins: 0, losses: 0, draws: 0, pnl: 0, trades: 0 });
    return { openPositions: openPositions.map((position) => ({ marketKey: position.marketKey, direction: position.direction, stake: position.stake, entryPrice: position.entryPrice, brokerOrderId: position.brokerOrderId, openedAt: position.openedAt, indicative: position.indicative ?? null })), exposure: exposure.exposures, concentrationWarnings: exposure.warnings, settled: { ...settled, pnl: Number(settled.pnl.toFixed(4)) }, practiceBalance: this.account.practice.balance, realBalance: this.account.real.balance };
  }

  async requestOrder({ marketKey: key, direction, stake = null, decisionId = null, horizonSeconds = 60, idempotencyKey = null, source = "MANUAL", autoDisarmAfterAck = false, decisionAgeMs = 0, entryTiming = null } = {}) {
    const ctx = this.markets.get(key);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    if (!this.client || !this.session.connected) throw new IqWsError("WS_DISCONNECTED");
    if (this.pendingOrders.has(key)) throw new IqWsError("ORDER_IN_FLIGHT", key);
    if (this.openPositions.has(key)) throw new IqWsError("POSITION_ALREADY_OPEN", key);
    if (this.config.mode === "REAL" && !this.account.real.available) throw new IqWsError("REAL_BALANCE_UNAVAILABLE");
    const last = this.#candleList(ctx).pop();
    const freshness = { fresh: Boolean(ctx.featureState?.fresh) && ctx.lastTickAt !== null && this.now() - ctx.lastTickAt <= MARKET_TICK_AGE_MS, tickAgeMs: ctx.lastTickAt === null ? null : this.now() - ctx.lastTickAt, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE" };
    const realAuthorized = this.config.mode === "REAL" && this.realMode.authorized();
    const resolvedStake = resolveFinalStake({ requestedStake: Number.isFinite(Number(stake)) && Number(stake) > 0 ? Number(stake) : undefined, marketConfiguredStake: ctx.configuredStake, configuredStake: this.config.defaultStake, calculatedBankrollStake: this.config.calculatedBankrollStake, marketMaxStake: ctx.maxStake, globalMaxStake: this.config.globalMaxStake, hardCap: this.config.hardCap });
    const finalStake = resolvedStake.finalStake;
    if (!Number.isFinite(finalStake) || finalStake <= 0) throw new IqWsError("NO_STAKE_CONFIGURED");
    const requestedKey = String(idempotencyKey ?? `${key}:${decisionId ?? this.now()}`).slice(0, 160);
    const existingRecord = this.idempotency.get(requestedKey);
    if (existingRecord) return { duplicate: true, marketKey: key, state: existingRecord.state, executionId: existingRecord.executionId, brokerOrderId: existingRecord.brokerOrderId, idempotencyKey: requestedKey };
    const decisionAction = direction === "BUY" || direction === "CALL" ? "BUY" : direction === "SELL" || direction === "PUT" ? "SELL" : null;
    if (!decisionAction) throw new IqWsError("INVALID_DIRECTION", String(direction));
    const setupFromState = ctx.decisionState?.setup && ctx.decisionState.setup !== "NO_VALID_SETUP" ? ctx.decisionState.setup : null;
    const brainSetup = { setup: setupFromState ?? "SYNTHETIC_TEST", regime: ctx.decisionState?.regime ?? null };
    // Ordem manual/API e acao deliberada do operador; o gate de setup vale para decisoes AUTO do brain.
    const setupValid = source !== "AUTO_DECISION" || (brainSetup.setup !== "NO_VALID_SETUP" && brainSetup.setup !== "SYNTHETIC_TEST");
    const gateResult = this.gate.evaluate({
      market: { ...ctx, maxStake: ctx.maxStake, marketKey: key }, marketKey: key, requestedMode: this.config.mode, realAuthorized,
      connection: { connected: this.session.connected, timeValid: this.session.timeValid, host: this.session.host },
      serverTime: { ms: this.client.serverNow(), skewMs: this.session.clockSkewMs },
      freshness, decision: { action: decisionAction, ageMs: Number(decisionAgeMs) || 0, horizonSeconds, reason: ctx.decisionState.reason }, strategy: { valid: setupValid, variantId: brainSetup.setup, reason: setupValid ? null : "SEM_SETUP_VALIDO" },
      price: last?.close ?? null, stake: finalStake, configuredStake: this.config.defaultStake, globalMaxStake: this.config.globalMaxStake, calculatedBankrollStake: this.config.calculatedBankrollStake,
      openPositions: [...this.openPositions.values()], pendingOrderKeys: [...this.pendingOrders.keys()], usedIdempotencyKeys: [...this.idempotency.byKey.keys()], activeMarketKeys: this.activeMarketKeys(), killSwitch: this.killSwitch.status(), idempotencyKey: requestedKey, horizonSeconds,
    });
    if (!gateResult.allowed) throw new IqWsError(`PORTFOLIO_GATE_${gateResult.code}`, gateResult.reasons.join(","));
    let record;
    let mode = this.config.mode;
    if (mode === "PRACTICE") {
      const practice = executionGate(
        { action: decisionAction, stake: finalStake, decisionId: decisionId ?? `ord_${this.now()}`, asset: key, horizonSeconds, decisionAgeMs: Number(decisionAgeMs) || 0, marketOpen: true, idempotencyKey: requestedKey },
        { armState: this.armState, userLimitBrl: Math.min(this.config.globalMaxStake, ctx.maxStake), brokerCurrency: this.account.practice.currency ?? "BRL", fxRate: 1, killSwitch: this.killSwitch, idempotency: this.idempotency, accountType: "PRACTICE", expectedAsset: key },
      );
      if (practice.duplicate) return { duplicate: true, marketKey: key, state: practice.record.state, executionId: practice.record.executionId, brokerOrderId: practice.record.brokerOrderId, idempotencyKey: requestedKey };
      record = practice.record;
    } else {
      this.realMode.authorizeOrder({ stake: finalStake, marketKey: key });
      const registered = this.idempotency.register(requestedKey, { direction: decisionAction, stake: finalStake, asset: key, horizonSeconds, decisionId: decisionId ?? null, mode: "REAL" });
      if (registered.duplicate) return { duplicate: true, marketKey: key, state: registered.record.state, executionId: registered.record.executionId, brokerOrderId: registered.record.brokerOrderId, idempotencyKey: requestedKey };
      record = registered.record;
    }
    const serverSec = (this.client.serverNow() ?? this.now()) / 1000;
    const expiration = computeExpiration(serverSec, Math.max(1, Math.round(Number(horizonSeconds) / 60)));
    if (expiration.optionKind === "turbo" && Array.isArray(ctx.instrumentTypes) && ctx.instrumentTypes.length && !ctx.instrumentTypes.includes("turbo")) throw new IqWsError("INSTRUMENT_NOT_AVAILABLE_FOR_HORIZON", `${key}: turbo indisponivel (${ctx.instrumentTypes.join(",")})`);
    // JIT: o contrato precisa expirar exatamente no targetExpiryAt do candidato; fail-closed se o broker nao aceitar essa janela.
    if (entryTiming?.targetExpirySec && Number(expiration.expiration) !== Number(entryTiming.targetExpirySec)) throw new IqWsError("ENTRY_EXPIRATION_MISMATCH", `broker=${expiration.expiration} target=${entryTiming.targetExpirySec}`);
    const submitAtMs = this.now();
    const entryPrice = last?.close ?? null;
    const directionWire = decisionAction === "BUY" ? "CALL" : "PUT";
    const pending = {
      executionId: record.executionId, idempotencyKey: requestedKey, requestId: requestedKey, marketKey: key, mode, direction: directionWire, action: decisionAction,
      stake: finalStake, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeAdjustment: resolvedStake.adjustment, activeId: ctx.activeId, symbol: ctx.display, expirationSec: expiration.expiration, optionKind: expiration.optionKind,
      entryPrice, requestedAt: this.now(), connectionId: this.connection?.connectionId ?? null, autoDisarmAfterAck: autoDisarmAfterAck === true, source, ackResolved: false, settling: false,
      correlationId: ctx.agents?.correlationId ?? `corr_exec_${record.executionId}`,
      entryTiming: entryTiming ? { candidateId: entryTiming.candidateId, targetEntryAt: entryTiming.targetEntryAt, targetExpiryAt: entryTiming.targetExpiryAt, targetExpirySec: Number(entryTiming.targetExpirySec ?? Math.round(entryTiming.targetExpiryAt / 1000)), submitAt: entryTiming.submitAt, submitAtMs, entryLeadMs: entryTiming.entryLeadMs, revalidatedAt: entryTiming.revalidatedAt, candidateChangedBeforeEntry: entryTiming.candidateChangedBeforeEntry === true } : null,
    };
    this.#auditRecord(pending.correlationId, key, "ORDER_SENT", { executionId: record.executionId, direction: directionWire, stake: finalStake, requestedStake: resolvedStake.requestedStake, stakeSource: resolvedStake.source, mode, source, expiration: expiration.expiration, optionKind: expiration.optionKind, candidateId: entryTiming?.candidateId ?? null, targetEntryAt: entryTiming?.targetEntryAt ?? null, submitAtMs, entryLeadMs: entryTiming?.entryLeadMs ?? null }, { persist: true });
    const ackPromise = new Promise((resolve) => { pending.ackResolve = resolve; });
    this.pendingOrders.set(key, pending);
    ctx.positionState = { status: "ORDERING", direction: directionWire, entryPrice, stake: finalStake, brokerOrderId: null, requestId: requestedKey, expirationSec: expiration.expiration, openedAt: this.now(), settledAt: null, result: null, profit: null, mode };
    this.#setAgent(ctx, "ORDERING", source);
    this.#emitEvent("order.pending", { marketKey: key, direction: directionWire, stake: finalStake, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeAdjustment: resolvedStake.adjustment, mode, expirationSec: expiration.expiration });
    await this.#persistExecution({ executionId: record.executionId, idempotencyKey: requestedKey, decisionId: record.payload?.decisionId ?? decisionId ?? null, marketKey: key, mode, connectionId: pending.connectionId, accountType: mode, brokerOrderId: null, symbol: ctx.display, activeId: ctx.activeId, direction: directionWire, stake: finalStake, currency: mode === "REAL" ? this.account.real.currency : this.account.practice.currency, state: "REQUESTED", requestId: requestedKey, expirationAt: nowIso(expiration.expiration * 1000), entryPrice, payout: ctx.payout, optionKind: expiration.optionKind, meta: { source, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeAdjustment: resolvedStake.adjustment, setup: brainSetup.setup, strategyVariantId: null, strategySource: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, entryTiming: pending.entryTiming ? { candidateId: pending.entryTiming.candidateId, targetEntryAt: pending.entryTiming.targetEntryAt, targetExpiryAt: pending.entryTiming.targetExpiryAt, submitAt: pending.entryTiming.submitAt, submitAtMs, entryLeadMs: pending.entryTiming.entryLeadMs, revalidatedAt: pending.entryTiming.revalidatedAt, candidateChangedBeforeEntry: pending.entryTiming.candidateChangedBeforeEntry } : null } });
    try {
      const balanceId = mode === "REAL" ? this.account.real.balanceId : this.account.practice.balanceId;
      this.client.placeOrder({ price: finalStake, activeId: ctx.activeId, direction: directionWire, expiration: expiration.expiration, optionTypeId: expiration.optionTypeId, balanceId, requestId: requestedKey });
      this.#safe(() => this.log("IQ_MULTI_ORDER_SENT", JSON.stringify({ marketKey: key, executionId: record.executionId, direction: directionWire, stake: finalStake, mode, activeId: ctx.activeId, expiration: expiration.expiration, optionKind: expiration.optionKind, source })));
    } catch (error) {
      this.pendingOrders.delete(key);
      ctx.positionState = { ...ctx.positionState, status: "ERROR" };
      this.#setAgent(ctx, "ERROR", "ORDER_SEND_FAILED");
      await this.#persistExecution({ executionId: record.executionId, state: "UNKNOWN", error: String(error?.code ?? error?.message ?? error).slice(0, 160) });
      throw new IqWsError("ORDER_SEND_FAILED", String(error?.code ?? error?.message ?? error));
    }
    const ackTimer = setTimeout(() => {
      const current = this.pendingOrders.get(key);
      if (!current || current.ackResolved) return;
      current.ackResolved = true;
      try { this.armState.disarm("ORDER_ACK_UNKNOWN"); } catch { /* noop */ }
      this.realMode.revoke("ORDER_ACK_UNKNOWN");
      current.ackResolve?.({ state: "UNKNOWN", brokerOrderId: null, timedOut: true });
    }, this.ackTimeoutMs);
    ackTimer.unref?.();
    const outcome = await ackPromise;
    clearTimeout(ackTimer);
    return { duplicate: false, marketKey: key, executionId: record.executionId, idempotencyKey: requestedKey, requestId: requestedKey, mode, ...outcome };
  }

  /** Snapshot t0 (decisionSnapshot) capturado no ACK: prova auditavel do que o Brain viu na decisao. */
  #decisionSnapshot(ctx, pending = {}) {
    const trader = ctx.agents?.trader ?? null;
    const critic = ctx.agents?.critic ?? null;
    return {
      source: "T0_DECISION_SNAPSHOT",
      marketKey: ctx.marketKey, marketType: ctx.marketType, capturedAt: this.now(),
      decisionAt: ctx.decisionState?.evaluatedAt ?? null, decisionId: pending.decisionId ?? null, correlationId: pending.correlationId ?? ctx.agents?.correlationId ?? null,
      action: pending.direction === "CALL" ? "BUY" : pending.direction === "PUT" ? "SELL" : (trader?.action ?? null),
      regime: ctx.decisionState?.regime ?? null, setup: ctx.decisionState?.setup ?? null, trigger: ctx.decisionState?.trigger ?? null,
      waitReason: ctx.decisionState?.waitReason ?? null, confidence: ctx.decisionState?.confidence ?? null,
      structure: trader?.structure ?? null, location: trader?.location ?? null, momentum: trader?.momentum ?? null, strength: trader?.strength ?? null,
      volatility: trader?.volatility ?? null, microstructure: trader?.microstructure ?? null,
      supportingEvidence: trader?.supportingEvidence ?? [], contradictingEvidence: trader?.contradictingEvidence ?? [],
      primaryRisk: trader?.primaryRisk ?? null, analysisConfidence: trader?.analysisConfidence ?? null, processLog: trader?.processLog ?? [],
      features: ctx.agents?.features ?? null,
      critic: critic ? { verdict: critic.traderAssessment, independentAction: critic.independentAction, contradictions: critic.contradictions, riskFlags: critic.riskFlags, finalRecommendation: critic.finalRecommendation } : null,
      consensus: ctx.decisionState?.consensus ?? null,
      knowledgeContextIds: ctx.decisionState?.knowledge?.ids ?? [], knowledgeVersion: ctx.decisionState?.knowledge?.version ?? null, knowledgeUsed: ctx.decisionState?.knowledge?.used ?? false,
      freshness: { fresh: ctx.featureState?.fresh === true, reason: ctx.featureState?.freshnessReason ?? null, tickAgeMs: ctx.lastTickAt === null ? null : this.now() - ctx.lastTickAt },
      brainGeneration: BRAIN_GENERATION,
    };
  }

  #onOrderEvent(event, kind) {
    const msg = event.msg ?? {};
    const candidates = [...this.pendingOrders.values()].filter((pending) => pending.connectionId === event.connectionId);
    let pending = null;
    if (kind === "option") pending = candidates.find((row) => String(event.requestId) === String(row.requestId)) ?? null;
    if (kind === "buyComplete") pending = (msg.isSuccessful === false || msg.result?.id === undefined || candidates.length !== 1) ? null : candidates[0];
    if (kind === "socket-option-opened") {
      pending = candidates.find((row) => (msg.active_id === undefined || Number(msg.active_id) === Number(row.activeId)) && (msg.expired === undefined || Number(msg.expired) === Number(row.expirationSec)) && (msg.price === undefined || Number(msg.price) === Number(row.stake))) ?? null;
    }
    if (kind === "result") {
      if (msg.success !== true && candidates.length === 1) this.#failPending(candidates[0], "REJECTED", msg.message ?? "RESULT_SUCCESS_FALSE");
      return;
    }
    if (!pending) return;
    if (msg.message) { this.#failPending(pending, "REJECTED", msg.message); return; }
    const orderId = msg.id ?? msg.result?.id ?? null;
    if (orderId === null || orderId === undefined) return;
    void this.#ackPending(pending, String(orderId), kind);
  }

  async #ackPending(pending, brokerOrderId, source) {
    if (pending.ackResolved) return;
    pending.ackResolved = true;
    const record = this.idempotency.get(pending.idempotencyKey);
    if (record) applyBrokerAcknowledgement(record, { orderId: brokerOrderId });
    const signalRecord = this.signalLog.find((row) => row.executionId === pending.executionId && row.disposition === "EXECUTED");
    if (signalRecord) { signalRecord.brokerOrderId = brokerOrderId; signalRecord.ackAt = this.now(); }
    pending.brokerOrderId = brokerOrderId;
    const ackedAt = this.now();
    const ackMs = ackedAt - pending.requestedAt;
    const entryTimingAck = pending.entryTiming ? { ...pending.entryTiming, ackedAt, effectiveEntryAt: ackedAt, entryDriftMs: pending.entryTiming.targetEntryAt ? ackedAt - pending.entryTiming.targetEntryAt : null } : null;
    const ctx = this.markets.get(pending.marketKey);
    if (ctx) {
      this.#recordLatency(ctx, "orderAck", ackMs);
      ctx.positionState = { ...ctx.positionState, status: "OPEN", brokerOrderId, openedAt: ackedAt };
      ctx.positionState.indicative = null;
      this.#setAgent(ctx, "IN_POSITION", source);
      if (entryTimingAck && (ctx.candidate?.id === entryTimingAck.candidateId || ctx.lastCandidate?.id === entryTimingAck.candidateId)) {
        if (ctx.candidate?.id === entryTimingAck.candidateId) { ctx.candidate.status = "POSITION_OPEN"; ctx.candidate.entryDriftMs = entryTimingAck.entryDriftMs; ctx.candidate.ackedAt = ackedAt; ctx.lastCandidate = { ...ctx.candidate, initialFull: undefined }; ctx.candidate = null; }
        if (ctx.lastCandidate?.id === entryTimingAck.candidateId) { ctx.lastCandidate.entryDriftMs = entryTimingAck.entryDriftMs; }
      }
    }
    const position = { marketKey: pending.marketKey, mode: pending.mode, direction: pending.direction, stake: pending.stake, entryPrice: pending.entryPrice, brokerOrderId, expirationSec: pending.expirationSec, openedAt: ackedAt, executionId: pending.executionId, source, connectionId: pending.connectionId, correlationId: pending.correlationId ?? null, entryTiming: entryTimingAck, decisionSnapshot: ctx ? { ...this.#decisionSnapshot(ctx, pending), entryTiming: entryTimingAck } : null };
    this.openPositions.set(pending.marketKey, position);
    this.orderIndex.set(String(brokerOrderId), pending.marketKey);
    this.pendingOrders.delete(pending.marketKey);
    await this.#persistExecution({ executionId: pending.executionId, brokerOrderId, state: "ACKNOWLEDGED", ackedAt: nowIso(ackedAt), error: null, meta: entryTimingAck ? { effectiveEntryAt: ackedAt, entryDriftMs: entryTimingAck.entryDriftMs, ackMs } : { ackMs } });
    this.#auditRecord(pending.correlationId ?? `corr_exec_${pending.executionId}`, pending.marketKey, "BROKER_ACK", { brokerOrderId, source, ackMs, candidateId: entryTimingAck?.candidateId ?? null, targetEntryAt: entryTimingAck?.targetEntryAt ?? null, effectiveEntryAt: ackedAt, entryDriftMs: entryTimingAck?.entryDriftMs ?? null }, { persist: true });
    this.#emitEvent("order.ack", { marketKey: pending.marketKey, brokerOrderId, ackMs, source, mode: pending.mode, entryDriftMs: entryTimingAck?.entryDriftMs ?? null, targetEntryAt: entryTimingAck?.targetEntryAt ?? null });
    this.#emitEvent("position.open", { marketKey: pending.marketKey, direction: pending.direction, stake: pending.stake, entryPrice: pending.entryPrice, brokerOrderId });
    this.#safe(() => this.log("IQ_MULTI_ORDER_ACK", JSON.stringify({ marketKey: pending.marketKey, executionId: pending.executionId, brokerOrderId, source, ackMs })));
    pending.ackResolve?.({ state: "ACKNOWLEDGED", brokerOrderId, ackMs, source });
    if (pending.autoDisarmAfterAck === true) {
      try { this.armState.disarm("SMOKE_AUTO_DISARM"); } catch { /* noop */ }
      this.#safe(() => this.log("IQ_MULTI_SMOKE_AUTO_DISARM", JSON.stringify({ marketKey: pending.marketKey, brokerOrderId })));
    }
    this.#scheduleSettlement(pending.executionId, brokerOrderId, pending.expirationSec, pending.marketKey);
  }

  async #failPending(pending, state, reason) {
    if (pending.ackResolved) return;
    pending.ackResolved = true;
    this.pendingOrders.delete(pending.marketKey);
    const ctx = this.markets.get(pending.marketKey);
    if (ctx) { ctx.positionState = { ...ctx.positionState, status: state }; this.#setAgent(ctx, state === "REJECTED" ? "ERROR" : state, String(reason).slice(0, 80)); }
    await this.#persistExecution({ executionId: pending.executionId, state, error: String(reason).slice(0, 160) });
    this.#emitEvent("order.rejected", { marketKey: pending.marketKey, reason: String(reason).slice(0, 120) });
    pending.ackResolve?.({ state, brokerOrderId: null, reason: String(reason).slice(0, 160) });
  }

  #onSettlementEvent(event, kind) {
    const orderId = kind === "socket-option-closed" ? event.msg?.id : event.msg?.option_id;
    if (orderId === null || orderId === undefined) return;
    void this.#settleOrder(String(orderId), event.msg ?? {}, parseSettlement(event.msg));
  }

  async #settleOrder(brokerOrderId, rawMsg, broker) {
    const key = this.orderIndex.get(String(brokerOrderId));
    if (!key) return;
    const ctx = this.markets.get(key);
    const position = this.openPositions.get(key);
    if (!ctx || !position || position.settling === true) return;
    if (broker.result === "UNKNOWN") { this.#safe(() => this.log("IQ_MULTI_SETTLEMENT_UNKNOWN", JSON.stringify({ marketKey: key, brokerOrderId }))); return; }
    position.settling = true;
    const settlement = this.#causalSettlement(ctx, position);
    const comparison = compareSettlement(broker.result, settlement.result);
    const settledAt = this.now();
    ctx.positionState = { ...ctx.positionState, status: "SETTLED", settledAt, result: broker.result, profit: broker.profit, brokerOrderId };
    ctx.settlementState = { lastResult: broker.result, lastProfit: broker.profit, lastAt: settledAt, daily: { wins: ctx.settlementState.daily.wins + (broker.result === "WIN" ? 1 : 0), losses: ctx.settlementState.daily.losses + (broker.result === "LOSS" ? 1 : 0), draws: ctx.settlementState.daily.draws + (broker.result === "DRAW" ? 1 : 0), settledPnl: Number((ctx.settlementState.daily.settledPnl + (Number(broker.profit) || 0)).toFixed(4)), trades: ctx.settlementState.daily.trades + 1 } };
    ctx.lastTrade = { marketKey: key, brokerOrderId, direction: position.direction, stake: position.stake, result: broker.result, profit: broker.profit, causalResult: settlement.result, mismatch: comparison.mismatch, at: settledAt };
    const agentState = broker.result === "WIN" ? "WIN" : broker.result === "LOSS" ? "LOSS" : "DRAW";
    this.#setAgent(ctx, agentState, comparison.reason);
    const signalRecord = this.signalLog.find((row) => row.executionId === position.executionId && row.disposition === "EXECUTED");
    if (signalRecord) { signalRecord.settledAt = settledAt; signalRecord.result = broker.result; signalRecord.profit = broker.profit; }
    const signalStats = this.#signalStatsFor(key);
    if (broker.result === "WIN") signalStats.wins += 1; else if (broker.result === "LOSS") signalStats.losses += 1; else if (broker.result === "DRAW") signalStats.draws += 1;
    signalStats.settledPnl = Number((signalStats.settledPnl + (Number(broker.profit) || 0)).toFixed(4));
    ctx.indicative = { state: "NEUTRAL", delta: null, indicativePnl: null, updatedAt: settledAt };
    this.openPositions.delete(key); this.orderIndex.delete(String(brokerOrderId));
    await this.#persistExecution({ executionId: position.executionId, brokerOrderId: String(brokerOrderId), state: "SETTLED", settledAt: nowIso(settledAt), brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit, meta: { settlementReason: comparison.reason, causal: settlement.detail, marketKey: key } });
    this.#emitEvent("position.settled", { marketKey: key, brokerOrderId, brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit, correlationId: position.correlationId ?? null });
    this.#auditRecord(position.correlationId ?? `corr${position.executionId}`, key, "SETTLEMENT", { brokerOrderId, brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit }, { persist: true });
    // Fase 6: Professor avalia qualidade (snapshot t0) antes/depois do outcome; Journal registra memoria estruturada.
    const snapshot = position.decisionSnapshot ?? { source: "SETTLEMENT_FALLBACK", marketKey: key, regime: ctx.decisionState?.regime ?? null, setup: ctx.decisionState?.setup ?? null, action: position.action ?? null, trigger: ctx.decisionState?.trigger ?? null, location: ctx.decisionState?.location ?? null, momentum: ctx.decisionState?.momentum ?? null, strength: ctx.decisionState?.strength ?? null, volatility: ctx.decisionState?.volatility ?? null, contradictingEvidence: ctx.decisionState?.contradictingEvidence ?? [], supportingEvidence: ctx.decisionState?.supportingEvidence ?? [], processLog: ctx.decisionState?.processLog ?? [], knowledgeContextIds: ctx.decisionState?.knowledge?.ids ?? [], knowledgeVersion: ctx.decisionState?.knowledge?.version ?? null, critic: ctx.decisionState?.consensus ?? null };
    const review = reviewTrade({ snapshot, outcome: broker.result, result: broker.result });
    const initialSnapshot = position.entryTiming?.initialSnapshot ?? null;
    const initialReview = initialSnapshot ? reviewTrade({ snapshot: initialSnapshot, outcome: broker.result, result: broker.result }) : null;
    const reviewWithTiming = initialReview
      ? { ...review, initialDecisionQuality: initialReview.decisionQuality, finalDecisionQuality: review.decisionQuality, entryTiming: { candidateChangedBeforeEntry: position.entryTiming?.candidateChangedBeforeEntry === true, entryLeadMs: position.entryTiming?.entryLeadMs ?? null, entryDriftMs: position.entryTiming?.entryDriftMs ?? null } }
      : { ...review, finalDecisionQuality: review.decisionQuality };
    if (position.entryTiming?.candidateId) this.jit.recordExecution({ marketKey: key, candidateId: position.entryTiming.candidateId, action: position.action ?? (position.direction === "CALL" ? "BUY" : "SELL"), result: broker.result, stake: position.stake, payout: ctx.payout, entryAt: position.openedAt ?? null, settlementAt: settledAt, entryPrice: position.entryPrice ?? null });
    this.#emitEvent("professor.review", { marketKey: key, correlationId: position.correlationId ?? null, decisionQuality: review.decisionQuality, outcome: review.outcome, mistakes: review.mistakes.map((mistake) => mistake.code), wouldWaitBeBetter: review.wouldWaitBeBetter });
    this.#auditRecord(position.correlationId ?? `corr${position.executionId}`, key, "PROFESSOR_REVIEW", { decisionQuality: review.decisionQuality, outcome: review.outcome, mistakes: review.mistakes.map((mistake) => mistake.code), wouldWaitBeBetter: review.wouldWaitBeBetter }, { persist: true });
    void this.journal.recordTrade({ tradeId: position.executionId, decisionId: ctx.decisionState?.decisionId ?? null, correlationId: position.correlationId ?? null, agentId: this.#agentId(ctx), marketKey: key, marketType: ctx.marketType, entryAt: position.openedAt ?? null, settlementAt: settledAt, payout: ctx.payout, stake: position.stake, direction: position.direction, result: broker.result, profit: broker.profit, snapshot, review: reviewWithTiming, initialReview, initialSnapshot, entryTiming: position.entryTiming ?? null, intelligence: ctx.agents?.intelligenceContext ?? null });
    void this.#runSupervisorCheck(ctx);
    this.#safe(() => this.log("IQ_MULTI_ORDER_SETTLED", JSON.stringify({ marketKey: key, brokerOrderId, brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit })));
    if (comparison.mismatch) this.#safe(() => this.log("IQ_MULTI_SETTLEMENT_MISMATCH", JSON.stringify({ marketKey: key, executionId: position.executionId, broker: broker.result, causal: settlement.result })));
    if (this.killSwitch.status().executionEnabled === true && ctx.enabled && !ctx.paused) this.#setAgent(ctx, ctx.availability === "OPEN" ? "WAIT" : "UNAVAILABLE", "POST_SETTLEMENT");
  }

  #causalSettlement(ctx, position) {
    const list = this.#candleList(ctx);
    const entry = Number(position.entryPrice);
    const expirationMs = Number(position.expirationSec) * 1000;
    const settlement = list.filter((candle) => candle.bucketStart <= expirationMs).pop()?.close ?? null;
    if (!Number.isFinite(entry) || settlement === null) return { result: "UNKNOWN", detail: { reason: "INSUFFICIENT_CANDLES" } };
    const result = position.direction === "CALL" ? (settlement > entry ? "WIN" : settlement < entry ? "LOSS" : "DRAW") : (settlement < entry ? "WIN" : settlement > entry ? "LOSS" : "DRAW");
    return { result, detail: { entry, settlement, direction: position.direction } };
  }

  #scheduleSettlement(executionId, brokerOrderId, expirationSec, key) {
    const delay = Math.max(5_000, expirationSec * 1000 - this.now() + 3_000);
    const timer = setTimeout(() => { void this.#pollSettlement(key, brokerOrderId); }, delay);
    timer.unref?.();
  }

  async #pollSettlement(key, brokerOrderId) {
    const position = this.openPositions.get(key);
    if (!position || !this.client || !this.session.connected) return;
    try {
      const { response } = await this.client.getOptions({ limit: 60, instrumentType: "binary,turbo", balanceId: position.mode === "REAL" ? this.account.real.balanceId : this.account.practice.balanceId });
      const closed = response.msg?.closed_options ?? response.msg?.closedOptions ?? [];
      const match = closed.find((row) => String(row?.id?.[0] ?? row?.id ?? "") === String(brokerOrderId));
      if (match) await this.#settleOrder(String(brokerOrderId), match, parseSettlement(match));
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_SETTLEMENT_POLL_FAILED", `${key}:${String(error?.code ?? error?.message ?? error).slice(0, 80)}`)); }
  }

  async reconcileOrphans() {
    const mark = (patch) => { this.reconcile = { ...this.reconcile, lastRunAt: this.now(), ...patch }; };
    if (!this.pool || !this.client || !this.session.connected) { mark({ checked: 0, settled: 0, unknown: 0, error: "NOT_CONNECTED" }); return { checked: 0, settled: 0, unknown: 0 }; }
    if (!await this.#ensureDb()) { mark({ checked: 0, settled: 0, unknown: 0, error: "DB_UNAVAILABLE" }); return { checked: 0, settled: 0, unknown: 0 }; }
    let rows = [];
    try { rows = (await this.pool.query("SELECT execution_id, market_key, broker_order_id, direction, symbol, active_id, stake, expiration_at, entry_price, mode FROM iq_executions WHERE state IN ('REQUESTED','ACKNOWLEDGED') AND requested_at < now() - interval '2 minutes' ORDER BY requested_at DESC LIMIT 20")).rows; }
    catch (error) { this.#safe(() => this.log("IQ_MULTI_RECONCILE_QUERY_FAILED", String(error?.message ?? error).slice(0, 120))); mark({ checked: 0, settled: 0, unknown: 0, error: "QUERY_FAILED" }); return { checked: 0, settled: 0, unknown: 0 }; }
    if (!rows.length) { mark({ checked: 0, settled: 0, unknown: 0, error: null }); return { checked: 0, settled: 0, unknown: 0 }; }
    const result = { checked: rows.length, settled: 0, unknown: 0 };
    let closed = [];
    try { const { response } = await this.client.getOptions({ limit: 100, instrumentType: "binary,turbo", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId }); closed = response.msg?.closed_options ?? response.msg?.closedOptions ?? []; }
    catch (error) { this.#safe(() => this.log("IQ_MULTI_RECONCILE_OPTIONS_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 80))); }
    for (const row of rows) {
      if (!row.broker_order_id) { await this.#persistExecution({ executionId: row.execution_id, state: "UNKNOWN", error: "ORPHANED_NO_ACK_RECONCILED" }); result.unknown += 1; continue; }
      const match = closed.find((entry) => String(entry?.id?.[0] ?? entry?.id ?? "") === String(row.broker_order_id));
      if (!match) continue;
      const broker = parseSettlement(match);
      if (broker.result === "UNKNOWN") continue;
      const comparison = compareSettlement(broker.result, "UNKNOWN");
      await this.#persistExecution({ executionId: row.execution_id, state: "SETTLED", brokerOrderId: String(row.broker_order_id), settledAt: nowIso(this.now()), brokerResult: broker.result, causalResult: "UNKNOWN", mismatch: comparison.mismatch, profit: broker.profit, meta: { reconciled: true, reason: comparison.reason } });
      result.settled += 1;
      this.#safe(() => this.log("IQ_MULTI_RECONCILED", JSON.stringify({ executionId: row.execution_id, marketKey: row.market_key ?? null, brokerOrderId: String(row.broker_order_id), brokerResult: broker.result })));
    }
    mark({ checked: result.checked, settled: result.settled, unknown: result.unknown, error: null });
    return result;
  }

  /* ------------------------------- persistencia ------------------------------- */

  async #ensureDb() {
    if (!this.pool) return false;
    if (this.dbReady !== undefined) return this.dbReady;
    try { const result = await this.pool.query("SELECT to_regclass('public.iq_executions') AS table_name"); this.dbReady = Boolean(result.rows[0]?.table_name); } catch { this.dbReady = false; }
    return this.dbReady;
  }

  async #persistExecution(row) {
    try {
      if (!await this.#ensureDb()) return false;
      const updated = await this.pool.query(
        `UPDATE iq_executions SET idempotency_key=COALESCE($2,idempotency_key), decision_id=COALESCE($3,decision_id), market_key=COALESCE($4,market_key), mode=COALESCE($5,mode), connection_id=COALESCE($6,connection_id), account_type=COALESCE($7,account_type), broker_order_id=COALESCE($8,broker_order_id), symbol=COALESCE($9,symbol), active_id=COALESCE($10,active_id), direction=COALESCE($11,direction), stake=COALESCE($12,stake), currency=COALESCE($13,currency), state=$14, request_id=COALESCE($15,request_id), expiration_at=COALESCE($16,expiration_at), entry_price=COALESCE($17,entry_price), acked_at=COALESCE($18,acked_at), settled_at=COALESCE($19,settled_at), broker_result=COALESCE($20,broker_result), causal_result=COALESCE($21,causal_result), settlement_mismatch=($22 OR settlement_mismatch), profit=COALESCE($23,profit), error=COALESCE($24,error), payout=COALESCE($25,payout), option_kind=COALESCE($26,option_kind), meta=COALESCE(iq_executions.meta,'{}'::jsonb) || COALESCE($27::jsonb,'{}'::jsonb), updated_at=now() WHERE execution_id=$1`,
        [row.executionId, row.idempotencyKey ?? null, row.decisionId ?? null, row.marketKey ?? null, row.mode ?? null, row.connectionId ?? null, row.accountType ?? null, row.brokerOrderId ?? null, row.symbol ?? null, row.activeId ?? null, row.direction ?? null, row.stake ?? null, row.currency ?? null, row.state, row.requestId ?? null, row.expirationAt ?? null, row.entryPrice ?? null, row.ackedAt ?? null, row.settledAt ?? null, row.brokerResult ?? null, row.causalResult ?? null, row.mismatch === true, row.profit ?? null, row.error ?? null, row.payout ?? null, row.optionKind ?? null, row.meta ? JSON.stringify(row.meta) : null],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await this.pool.query(
          `INSERT INTO iq_executions(execution_id,idempotency_key,decision_id,market_key,mode,connection_id,account_type,broker_order_id,symbol,active_id,direction,stake,currency,state,request_id,expiration_at,entry_price,acked_at,settled_at,broker_result,causal_result,settlement_mismatch,profit,error,payout,option_kind,meta,requested_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,now(),now())`,
          [row.executionId, row.idempotencyKey ?? null, row.decisionId ?? null, row.marketKey ?? null, row.mode ?? "PRACTICE", row.connectionId ?? null, row.accountType ?? "PRACTICE", row.brokerOrderId ?? null, row.symbol ?? null, row.activeId ?? null, row.direction ?? null, row.stake ?? null, row.currency ?? null, row.state, row.requestId ?? null, row.expirationAt ?? null, row.entryPrice ?? null, row.ackedAt ?? null, row.settledAt ?? null, row.brokerResult ?? null, row.causalResult ?? null, row.mismatch === true, row.profit ?? null, row.error ?? null, row.payout ?? null, row.optionKind ?? null, row.meta ? JSON.stringify(row.meta) : JSON.stringify({})],
        );
      }
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160))); return false; }
  }

  async recentExecutions(limit = 50, marketKeyFilter = null) {
    const bounded = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
      if (!await this.#ensureDb()) return [];
      const args = [bounded]; let where = "";
      if (marketKeyFilter) { where = " WHERE market_key=$2"; args.push(marketKeyFilter); }
      return (await this.pool.query(`SELECT execution_id AS "executionId", idempotency_key AS "idempotencyKey", decision_id AS "decisionId", market_key AS "marketKey", mode, account_type AS "accountType", broker_order_id AS "brokerOrderId", symbol, active_id AS "activeId", direction, stake, currency, state, entry_price AS "entryPrice", broker_result AS "brokerResult", causal_result AS "causalResult", settlement_mismatch AS "settlementMismatch", profit, payout, error, requested_at AS "requestedAt", acked_at AS "ackedAt", settled_at AS "settledAt", expiration_at AS "expirationAt" FROM iq_executions${where} ORDER BY requested_at DESC LIMIT $1`, args)).rows.map((row) => ({ ...row, settlementMismatch: row.settlementMismatch === true }));
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_EXECUTIONS_READ_FAILED", String(error?.message ?? error).slice(0, 120))); return []; }
  }

  async #persistMarket(ctx) {
    try {
      if (!this.pool || !await this.#ensureDb()) return false;
      await this.pool.query("INSERT INTO iq_markets(market_key,symbol,display,market_type,canonical,enabled,paused,max_stake,configured_stake,strategy,strategy_variant_id,revision,active_id,instrument_types,availability,payout,payout_source,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,now()) ON CONFLICT(market_key) DO UPDATE SET enabled=EXCLUDED.enabled, paused=EXCLUDED.paused, max_stake=EXCLUDED.max_stake, configured_stake=EXCLUDED.configured_stake, strategy=EXCLUDED.strategy, strategy_variant_id=EXCLUDED.strategy_variant_id, revision=EXCLUDED.revision, active_id=EXCLUDED.active_id, instrument_types=EXCLUDED.instrument_types, availability=EXCLUDED.availability, payout=EXCLUDED.payout, payout_source=EXCLUDED.payout_source, updated_at=now()",
        [ctx.marketKey, ctx.symbol, ctx.display, ctx.marketType, ctx.canonical, ctx.enabled, ctx.paused, ctx.maxStake, ctx.configuredStake, ctx.strategy, ctx.strategyVariantId, Number(ctx.revision || 0), ctx.activeId, JSON.stringify(ctx.instrumentTypes ?? []), ctx.availability, ctx.payout, ctx.payoutSource]);
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_MARKET_PERSIST_FAILED", String(error?.message ?? error).slice(0, 120))); return false; }
  }

  async #persistConfig() {
    try {
      if (!this.pool || !await this.#ensureDb("iq_runtime_config")) return false;
      await this.pool.query("INSERT INTO iq_runtime_config(id,mode,global_max_stake,default_stake,calculated_bankroll_stake,auto_execute,selection_json,resolver_json,research_json,supervisor_json,apprentice_json,hypotheses_json,jit_enabled,entry_lead_ms,entry_window_max_drift_ms,revision,updated_at) VALUES(1,$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,now()) ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode, global_max_stake=EXCLUDED.global_max_stake, default_stake=EXCLUDED.default_stake, calculated_bankroll_stake=EXCLUDED.calculated_bankroll_stake, auto_execute=EXCLUDED.auto_execute, selection_json=EXCLUDED.selection_json, resolver_json=EXCLUDED.resolver_json, research_json=EXCLUDED.research_json, supervisor_json=EXCLUDED.supervisor_json, apprentice_json=EXCLUDED.apprentice_json, hypotheses_json=EXCLUDED.hypotheses_json, jit_enabled=EXCLUDED.jit_enabled, entry_lead_ms=EXCLUDED.entry_lead_ms, entry_window_max_drift_ms=EXCLUDED.entry_window_max_drift_ms, revision=EXCLUDED.revision, updated_at=now()",
        [this.config.mode, this.config.globalMaxStake, this.config.defaultStake, this.config.calculatedBankrollStake, this.config.autoExecute, JSON.stringify({ legacy: "LEGACY_STRATEGY_AUDIT", brainGeneration: BRAIN_GENERATION }), JSON.stringify(this.resolver.toJSON()), JSON.stringify({ ...this.research.toJSON(), entryTiming: this.jit.toJSON() }), JSON.stringify(this.supervisor.toJSON()), JSON.stringify(this.apprentice.toJSON()), JSON.stringify({ items: this.hypotheses.list() }), this.config.jitEnabled === true, this.config.entryLeadMs, this.#entryMaxDriftMs(), Number(this.config.revision || 0)]);
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_CONFIG_PERSIST_FAILED", String(error?.message ?? error).slice(0, 120))); return false; }
  }

  async #loadPersistedConfig() {
    if (this.configLoaded || !this.pool) return;
    this.configLoaded = true;
    try {
      const row = (await this.pool.query("SELECT * FROM iq_runtime_config WHERE id=1")).rows[0];
      if (row) {
        this.config.globalMaxStake = Number(row.global_max_stake) || this.config.globalMaxStake;
        this.config.defaultStake = Number(row.default_stake) || this.config.defaultStake;
        this.config.calculatedBankrollStake = Number(row.calculated_bankroll_stake) || this.config.calculatedBankrollStake;
        this.config.autoExecute = row.auto_execute === true;
        this.config.revision = Number(row.revision) || 0;
        const sameGeneration = Number(row.selection_json?.brainGeneration) === BRAIN_GENERATION;
        if (row.jit_enabled !== null && row.jit_enabled !== undefined) this.config.jitEnabled = row.jit_enabled === true;
        if (Number.isFinite(Number(row.entry_lead_ms))) this.config.entryLeadMs = Math.max(MIN_ENTRY_LEAD_MS, Math.min(MAX_ENTRY_LEAD_MS, Math.round(Number(row.entry_lead_ms))));
        if (Number.isFinite(Number(row.entry_window_max_drift_ms))) this.config.entryWindowMaxDriftMs = Math.max(0, Math.round(Number(row.entry_window_max_drift_ms)));
        if (row.resolver_json) this.resolver.loadFrom(row.resolver_json);
        if (row.research_json && sameGeneration) this.research.loadFrom(row.research_json);
        if (row.research_json?.entryTiming) this.jit.loadFrom(row.research_json.entryTiming);
        if (row.supervisor_json) this.supervisor.loadFrom(row.supervisor_json);
        if (row.hypotheses_json && Array.isArray(row.hypotheses_json.items)) for (const item of row.hypotheses_json.items) this.hypotheses.items.set(item.id, item);
        if (row.apprentice_json && sameGeneration) this.apprentice.loadFrom(row.apprentice_json);
        if (row.mode === "REAL") { this.config.mode = "REAL"; this.realMode.revoke("RESTART"); }
      }
      const markets = (await this.pool.query("SELECT * FROM iq_markets")).rows;
      for (const market of markets) {
        const ctx = this.markets.get(market.market_key);
        if (!ctx) continue;
        ctx.enabled = market.enabled === true; ctx.paused = market.paused === true;
        ctx.maxStake = Number(market.max_stake) || ctx.maxStake;
        ctx.configuredStake = Number.isFinite(Number(market.configured_stake)) ? Number(market.configured_stake) : ctx.configuredStake;
        /* Fase 6: strategy/strategy_variant_id legados nao sao carregados (LEGACY_STRATEGY_AUDIT). */
        ctx.revision = Number(market.revision) || 0;
        if (market.active_id !== null && market.active_id !== undefined) ctx.activeId = Number(market.active_id);
        if (Array.isArray(market.instrument_types)) ctx.instrumentTypes = market.instrument_types;
        if (market.availability) ctx.availability = market.availability;
        if (market.payout !== null && market.payout !== undefined) ctx.payout = Number(market.payout);
      }
      this.#safe(() => this.log("IQ_MULTI_CONFIG_LOADED", JSON.stringify({ markets: markets.length, globalMaxStake: this.config.globalMaxStake, defaultStake: this.config.defaultStake, mode: this.config.mode, autoExecute: this.config.autoExecute, revision: this.config.revision })));
      const enabled = [...this.markets.values()].filter((ctx) => ctx.enabled);
      if (enabled.length > this.config.maxActiveMarkets) {
        for (const ctx of enabled.slice(this.config.maxActiveMarkets)) { ctx.enabled = false; void this.#persistMarket(ctx); }
        this.#safe(() => this.log("IQ_MULTI_LIMIT_ENFORCED_ON_LOAD", JSON.stringify({ before: enabled.length, after: this.config.maxActiveMarkets })));
      }
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_CONFIG_LOAD_FAILED", String(error?.message ?? error).slice(0, 120))); }
  }

  async #loadDailyStats() {
    if (!this.pool || !await this.#ensureDb()) return;
    try {
      const rows = (await this.pool.query("SELECT market_key, count(*) FILTER (WHERE broker_result='WIN')::int AS wins, count(*) FILTER (WHERE broker_result='LOSS')::int AS losses, count(*) FILTER (WHERE broker_result='DRAW')::int AS draws, COALESCE(sum(profit),0)::float AS pnl, count(*)::int AS trades FROM iq_executions WHERE state='SETTLED' AND settled_at >= date_trunc('day', now()) GROUP BY market_key")).rows;
      for (const row of rows) {
        const ctx = this.markets.get(row.market_key);
        if (!ctx) continue;
        ctx.settlementState.daily = { wins: row.wins, losses: row.losses, draws: row.draws, settledPnl: Number(row.pnl) || 0, trades: row.trades };
      }
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_DAILY_STATS_FAILED", String(error?.message ?? error).slice(0, 120))); }
  }

  async dailyEquityCurve(limit = 120) {
    try {
      if (!this.pool || !await this.#ensureDb()) return [];
      const rows = (await this.pool.query("SELECT settled_at AS at, profit FROM iq_executions WHERE state='SETTLED' AND settled_at >= date_trunc('day', now()) ORDER BY settled_at ASC LIMIT $1", [Math.max(1, Math.min(500, limit))])).rows;
      let cumulative = 0;
      return rows.map((row) => { cumulative = Number((cumulative + (Number(row.profit) || 0)).toFixed(4)); return { at: row.at, cumulative }; });
    } catch { return []; }
  }

  /* ------------------------------- eventos/status ------------------------------- */

  /** Emitido com o tipo SEMPRE por ultimo: payload nunca sobrescreve `type`/`seq`. */
  #emitEvent(type, payload = {}) {
    const event = { ...payload, seq: ++this.eventSeq, type, at: this.now() };
    this.events.push(event);
    if (this.events.length > EVENT_BUFFER) this.events.splice(0, this.events.length - EVENT_BUFFER);
    this.emit("event", event);
    return event;
  }

  eventsAfter(seq, limit = 200) {
    const from = Math.max(0, Number(seq) || 0);
    return { events: this.events.filter((event) => event.seq > from).slice(0, Math.max(1, Math.min(500, limit))), cursor: this.eventSeq };
  }

  #publicMarket(ctx) {
    return {
      marketKey: ctx.marketKey, marketType: ctx.marketType, canonical: ctx.canonical, symbol: ctx.symbol, display: ctx.display,
      enabled: ctx.enabled, paused: ctx.paused, maxStake: ctx.maxStake, configuredStake: ctx.configuredStake, strategy: ctx.strategy ?? null,
      setup: ctx.decisionState?.setup ?? null, regime: ctx.decisionState?.regime ?? null, revision: Number(ctx.revision || 0), brainGeneration: BRAIN_GENERATION,
      agents: ctx.agents ? {
        at: ctx.agents.at, correlationId: ctx.agents.correlationId, setup: ctx.agents.trader?.setup ?? null,
        trader: { action: ctx.agents.trader.action, confidence: ctx.agents.trader.analysisConfidence, regime: ctx.agents.trader.regime, bias: ctx.agents.trader.structuralBias, primaryRisk: ctx.agents.trader.primaryRisk, supporting: ctx.agents.trader.supportingEvidence, contradicting: ctx.agents.trader.contradictingEvidence, latencyMs: ctx.agents.trader.latencyMs },
        critic: { independentAction: ctx.agents.critic.independentAction, verdict: ctx.agents.critic.traderAssessment, contradictions: ctx.agents.critic.contradictions, riskFlags: ctx.agents.critic.riskFlags, finalRecommendation: ctx.agents.critic.finalRecommendation, latencyMs: ctx.agents.critic.latencyMs },
        consensus: { action: ctx.agents.consensus.action, status: ctx.agents.consensus.status, reason: ctx.agents.consensus.reason, rules: ctx.agents.consensus.rules, confidence: ctx.agents.consensus.analysisConfidence, estimatedWinProbability: null, latencyMs: ctx.agents.consensus.latencyMs },
      } : null,
      activeId: ctx.activeId, instrumentTypes: ctx.instrumentTypes, availability: ctx.availability, payout: ctx.payout, payoutSource: ctx.payoutSource, resolvedAt: ctx.resolvedAt,
      connectionHealth: ctx.connectionHealth, serverTime: ctx.serverTime,
      lastTick: ctx.lastTick, candles5s: ctx.candles.size,
      featureState: ctx.featureState ? { builtAt: ctx.featureState.builtAt, fresh: ctx.featureState.fresh, freshnessReason: ctx.featureState.freshnessReason, rsi14: ctx.featureState.context?.deterministicIndicators?.rsi14?.value ?? null, atr14: ctx.featureState.context?.deterministicIndicators?.atr14?.value ?? null, adx14: ctx.featureState.context?.deterministicIndicators?.adx14?.value ?? null, donchianPosition: ctx.featureState.context?.deterministicIndicators?.donchianPosition?.value ?? null, microstructureStreak: ctx.featureState.context?.microstructure?.streak ?? null } : null,
      decisionState: ctx.decisionState, positionState: ctx.positionState, settlementState: ctx.settlementState, indicative: ctx.indicative,
      latency: { serverToReceived: latencySummary(ctx.latency.serverToReceived), receivedToNormalized: latencySummary(ctx.latency.receivedToNormalized), normalizedToFeature: latencySummary(ctx.latency.normalizedToFeature), orderAck: latencySummary(ctx.latency.orderAck) },
      stats: ctx.stats,
      agentState: ctx.agentState, agentSince: ctx.agentSince, agentReason: ctx.agentReason ?? null,
      lastSignal: ctx.lastSignal, lastDecision: ctx.lastDecision, lastTrade: ctx.lastTrade,
      selectionReason: ctx.selectionReason ?? null, brainGeneration: BRAIN_GENERATION,
      entryTiming: this.#publicEntryTiming(ctx, this.client?.serverNow?.() ?? this.now()),
    };
  }

  office() {
    if (this.now() - this.equityRefreshedAt > 30_000) { this.equityRefreshedAt = this.now(); void this.refreshEquityCurve(); }
    if (this.now() - (this.lastResearchPersist ?? 0) > 60_000) { this.lastResearchPersist = this.now(); void this.#persistConfig(); }
    const markets = [...this.markets.values()].map((ctx) => this.#publicMarket(ctx));
    const portfolio = this.portfolioSnapshot();
    const compliance = {
      mode: this.config.mode, armState: this.armState.snapshot(), killSwitch: this.killSwitch.status(), hardCap: this.config.hardCap,
      realMode: this.realMode.status(),
      invariants: { practiceOnlyDefault: true, realRequiresExplicitConfirmation: true, oneOrderPerDecision: true, onePositionPerMarket: true, normalNeverFallsBackToOtc: true, maxActiveMarkets: this.config.maxActiveMarkets },
    };
    const executionGate = {
      state: this.killSwitch.status().executionEnabled !== true ? "BLOCKED" : this.armState.armed === true ? (this.pendingOrders.size ? "ORDERING" : "ARMED") : "DISARMED",
      armed: this.armState.armed === true, pendingOrders: this.pendingOrders.size, allowedMarkets: markets.filter((market) => market.enabled && market.availability === "OPEN").map((market) => market.marketKey),
      blockedMarkets: markets.filter((market) => !market.enabled || market.availability !== "OPEN").map((market) => market.marketKey), reasons: this.connectionHealth().reasons,
    };
    return {
      version: RUNTIME_VERSION, at: this.now(), serverTime: this.session.serverTimeMs,
      connection: { ...this.session, reconnects: this.reconnects, healthy: this.connectionHealth().healthy },
      mode: this.config.mode, modeState: this.modeState(),
      config: { globalMaxStake: this.config.globalMaxStake, defaultStake: this.config.defaultStake, calculatedBankrollStake: this.config.calculatedBankrollStake, hardCap: this.config.hardCap, maxActiveMarkets: this.config.maxActiveMarkets, autoExecute: this.config.autoExecute, revision: this.config.revision, brainGeneration: BRAIN_GENERATION, jitEnabled: this.config.jitEnabled === true, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.#entryMaxDriftMs() },
      activeCount: this.activeMarketKeys().length, activeLimit: this.config.maxActiveMarkets, universeCount: this.markets.size,
      portfolio: { ...portfolio, equityCurve: this.equityCurveCache ?? [] },
      markets,
      aux: {
        risk: { openPositions: portfolio.openPositions.length, stakeAtRisk: Number(portfolio.openPositions.reduce((sum, position) => sum + (Number(position.stake) || 0), 0).toFixed(4)), exposure: portfolio.exposure, concentrationWarnings: portfolio.concentrationWarnings, limits: { maxActiveMarkets: this.config.maxActiveMarkets, maxOpenPerMarket: MAX_OPEN_POSITIONS_PER_MARKET, hardCap: this.config.hardCap } },
        compliance,
        macro: this.macroContext ?? { status: "NO_FEED", note: "contexto macro nao conectado nesta fase" },
        news: this.newsContext ?? { status: "NO_FEED", note: "interface pronta; nenhum evento inventado" },
        executionGate,
        portfolioControl: { activeMarkets: this.activeMarketKeys(), openPositions: portfolio.openPositions.length, settledPnl: portfolio.settled.pnl, wins: portfolio.settled.wins, losses: portfolio.settled.losses, draws: portfolio.settled.draws, agentsOnline: markets.filter((market) => market.agentState !== "OFFLINE" && market.agentState !== "UNAVAILABLE").length },
      },
      resolver: { lastResolvedAt: this.resolver.lastResolvedAt, resolvedCount: this.resolver.resolvedCount(), sampleActiveKeys: this.resolver.sampleActiveKeys, lastError: this.resolver.lastError },
      intelligence: this.intelligence.status(),
      knowledge: { ...this.knowledge.status(), secondBrain: this.secondBrain.status() },
      journal: { trades: this.journal.trades.length, decisions: this.journal.decisions.length },
      hypotheses: this.hypotheses.list().length,
      feeds: this.feeds.status(),
      apprentice: this.apprentice.scoreboard(),
      supervisor: this.supervisor.status(),
      brain: { generation: BRAIN_GENERATION, version: BRAIN_VERSION, principles: CORE_BRAIN.principles.length, setups: Object.keys(CORE_BRAIN.setups).length, process: CORE_BRAIN.process },
      entryTiming: { version: ENTRY_TIMING_VERSION, jitEnabled: this.config.jitEnabled === true, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.#entryMaxDriftMs(), scoreboard: this.jit.scoreboard() },
      research: {
        agentLatency: latencySummary(this.agentLatency),
        setups: Object.fromEntries([...this.markets.values()].filter((ctx) => ctx.enabled).map((ctx) => [ctx.marketKey, this.research.scoreboard(ctx.marketKey)])),
        ab: this.ab.scoreboard(),
      },
      signals: [...this.signalLog].reverse().slice(0, 40),
      signalStats: Object.fromEntries(this.signalStats),
      reconcile: this.reconcile,
      metrics: { messages: this.metrics.messages, candles: this.metrics.candles, rejected: this.metrics.rejected, reconnects: this.reconnects, memoryMb: Number((process.memoryUsage().rss / 1048576).toFixed(1)), cpuUserMs: process.cpuUsage().user, uptimeSec: Math.round(process.uptime()) },
      stress: { running: this.stress.running, report: this.stress.report },
      eventsCursor: this.eventSeq,
      legacy: this.#legacyStatus(),
    };
  }

  /** Compatibilidade com a pagina/gauntlet da Fase 3 (single-market view) + resumo multi. */
  status() {
    const office = this.office();
    const legacy = office.legacy;
    return {
      ...legacy,
      runtimeVersion: RUNTIME_VERSION,
      mode: this.config.mode,
      activeCount: office.activeCount, activeLimit: office.activeLimit,
      realMode: this.realMode.status().realModeEnabled,
      marketsSummary: office.markets.map((market) => ({ marketKey: market.marketKey, marketType: market.marketType, enabled: market.enabled, availability: market.availability, activeId: market.activeId, candles5s: market.candles5s, agentState: market.agentState, payout: market.payout, maxStake: market.maxStake })),
    };
  }

  async refreshEquityCurve() { this.equityCurveCache = await this.dailyEquityCurve(); return this.equityCurveCache; }

  #legacyStatus() {
    const primary = this.markets.get("EURUSD:NORMAL")?.lastCandle ? this.markets.get("EURUSD:NORMAL") : [...this.markets.values()].find((ctx) => ctx.enabled && ctx.lastCandle) ?? [...this.markets.values()].find((ctx) => ctx.lastCandle) ?? null;
    const candles = primary ? this.#candleList(primary) : [];
    return {
      marketData: primary ? {
        connected: this.session.connected, host: this.session.host, hostExpectedFromRepo: "iqoption.com", connectionId: this.session.connectionId,
        serverTime: Number.isFinite(this.client?.serverNow()) ? nowIso(this.client.serverNow()) : null, serverTimeMs: this.client?.serverNow() ?? this.session.serverTimeMs, clockSkewMs: this.session.clockSkewMs, timeValid: this.session.timeValid,
        symbol: primary.symbol, activeId: primary.activeId, activeExpectedFromRepo: primary.canonical === "EURUSD" ? (primary.marketType === "NORMAL" ? EXPECTED_EURUSD_ACTIVE_ID_FROM_REPO : EXPECTED_EURUSD_OTC_ACTIVE_ID_FROM_REPO) : null, activeActual2026: primary.activeId, activeExpectedVsActual: primary.marketType === "NORMAL" ? "MATCH" : "OTC", activeSection: primary.instrumentTypes[0] ?? null, activeOtc: primary.marketType === "OTC", activeCandidates: primary.candidates ?? [],
        candles5s: candles.length, lastTick: primary.lastTick, latencyMs: { serverToReceived: latencySummary(primary.latency.serverToReceived), receivedToNormalized: latencySummary(primary.latency.receivedToNormalized), normalizedToFeature: latencySummary(primary.latency.normalizedToFeature), orderAck: latencySummary(primary.latency.orderAck), visionP95ReferenceMs: 27_500 },
        healthy: this.connectionHealth().healthy && primary.featureState?.fresh === true, healthReasons: [...this.connectionHealth().reasons, ...(primary.featureState?.fresh === true ? [] : ["FEATURE_NOT_FRESH"])],
        candleDiagnostics: { rejected: this.metrics.rejected, lastCode: null, lastReason: null, rawShape: null, rawShapeAt: null }, reconcile: this.reconcile,
        recentCandles: candles.slice(-12).map((candle) => ({ bucketStart: candle.bucketStart, bucketEnd: candle.bucketEnd, open: candle.open, high: candle.high, low: candle.low, close: candle.close, serverTimestamp: candle.serverTimestamp, receivedAt: candle.receivedAt, segmentId: candle.segmentId })),
        features: primary.featureState ? { builtAt: primary.featureState.builtAt, fresh: primary.featureState.fresh, freshnessReason: primary.featureState.freshnessReason, rsi14: primary.featureState.context?.deterministicIndicators?.rsi14?.value ?? null, atr14: primary.featureState.context?.deterministicIndicators?.atr14?.value ?? null, adx14: primary.featureState.context?.deterministicIndicators?.adx14?.value ?? null, donchianPosition: primary.featureState.context?.deterministicIndicators?.donchianPosition?.value ?? null, microstructureStreak: primary.featureState.context?.microstructure?.streak ?? null } : null,
      } : { connected: this.session.connected, host: this.session.host, hostExpectedFromRepo: "iqoption.com", connectionId: this.session.connectionId, serverTime: Number.isFinite(this.client?.serverNow()) ? nowIso(this.client.serverNow()) : null, serverTimeMs: this.session.serverTimeMs, clockSkewMs: this.session.clockSkewMs, timeValid: this.session.timeValid, candles5s: 0, healthy: false, healthReasons: ["NO_MARKET_DATA_WITH_CANDLES"], recentCandles: [], features: null, latencyMs: { serverToReceived: latencySummary([]), receivedToNormalized: latencySummary([]), normalizedToFeature: latencySummary([]), orderAck: latencySummary([]), visionP95ReferenceMs: 27_500 } },
      account: { verified: this.account.practice.verified, type: this.account.type, currency: this.account.practice.currency, balance: this.account.practice.balance, hasReal: this.account.hasReal, checkedAt: this.account.checkedAt, balanceFailure: null, practiceOnly: true, realExecutionForbidden: true },
      execution: { ...this.armState.snapshot(), killSwitch: this.killSwitch.status(), userLimitBrl: this.userLimitBrl ?? null, pendingOrder: this.pendingOrders.size ? { count: this.pendingOrders.size, keys: [...this.pendingOrders.keys()] } : null, lastExecution: [...this.markets.values()].map((ctx) => ctx.lastTrade).filter(Boolean).sort((a, b) => b.at - a.at)[0] ?? null },
      brokerAutomation: "WS_ONLY_PRACTICE",
    };
  }

  /* ------------------------------- stress multimercado ------------------------------- */

  startStress({ stages = [1, 3, 5, 10], secondsPerStage = 45 } = {}) {
    if (this.stress.running) throw new IqWsError("STRESS_ALREADY_RUNNING");
    if (!this.session.connected) throw new IqWsError("WS_DISCONNECTED");
    const normalizedStages = [...new Set(stages.map((value) => Math.max(1, Math.min(this.config.maxActiveMarkets, Number(value) || 1))))].sort((a, b) => a - b);
    const windowSeconds = Math.max(5, Math.min(300, Number(secondsPerStage) || 45));
    const originalEnabled = this.activeMarketKeys();
    this.stress = { running: true, startedAt: this.now(), stages: normalizedStages, secondsPerStage: windowSeconds, report: null, originalEnabled };
    void this.#runStress(normalizedStages, windowSeconds, originalEnabled);
    return { started: true, stages: normalizedStages, secondsPerStage: windowSeconds };
  }

  async #runStress(stages, secondsPerStage, originalEnabled) {
    const candidates = [...this.markets.values()].filter((ctx) => ctx.availability === "OPEN" && ctx.activeId !== null).sort((a, b) => (a.marketType === b.marketType ? 0 : a.marketType === "NORMAL" ? -1 : 1));
    const results = [];
    try {
      for (const stage of stages) {
        if (this.stress.cancelRequested) { results.push({ stage, cancelled: true }); break; }
        for (const ctx of this.markets.values()) { if (ctx.enabled && !candidates.slice(0, stage).includes(ctx)) { try { this.setMarket(ctx.marketKey, { enabled: false }, { persist: false }); } catch { /* noop */ } } }
        for (const ctx of candidates.slice(0, stage)) { if (!ctx.enabled) { try { this.setMarket(ctx.marketKey, { enabled: true }, { persist: false }); } catch (error) { this.#safe(() => this.log("IQ_MULTI_STRESS_ENABLE_FAILED", `${ctx.marketKey}:${String(error?.code ?? error.message)}`)); } } }
        const baseline = Object.fromEntries(candidates.slice(0, stage).map((ctx) => [ctx.marketKey, { messages: ctx.stats.messages, candles: ctx.stats.candlesProcessed, rejected: ctx.stats.rejected, duplicates: ctx.stats.duplicates, reorder: ctx.stats.reorder, gaps: ctx.stats.gaps, reconnects: this.reconnects }]));
        const started = this.now(); const cpuStart = process.cpuUsage();
        await sleep(secondsPerStage * 1000);
        if (this.stress.cancelRequested) { results.push({ stage, cancelled: true }); break; }
        const cpuEnd = process.cpuUsage(cpuStart);
        const perMarket = candidates.slice(0, stage).map((ctx) => ({
          marketKey: ctx.marketKey, activeId: ctx.activeId, candles: ctx.candles.size,
          newMessages: ctx.stats.messages - baseline[ctx.marketKey].messages, newCandles: ctx.stats.candlesProcessed - baseline[ctx.marketKey].candles,
          rejected: ctx.stats.rejected - baseline[ctx.marketKey].rejected, duplicates: ctx.stats.duplicates - baseline[ctx.marketKey].duplicates,
          reorder: ctx.stats.reorder - baseline[ctx.marketKey].reorder, gaps: ctx.stats.gaps - baseline[ctx.marketKey].gaps,
          p50: latencySummary(ctx.latency.serverToReceived).p50, p95: latencySummary(ctx.latency.serverToReceived).p95, fresh: ctx.featureState?.fresh === true,
          tickAgeMs: ctx.lastTickAt === null ? null : this.now() - ctx.lastTickAt,
        }));
        results.push({ stage, windowSec: Math.round((this.now() - started) / 1000), markets: perMarket, cpuUserMs: Math.round(cpuEnd.user / 1000), cpuSystemMs: Math.round(cpuEnd.system / 1000), memoryMb: Number((process.memoryUsage().rss / 1048576).toFixed(1)), reconnects: this.reconnects, totalMessages: this.metrics.messages });
      }
    } catch (error) {
      results.push({ stage: "ERROR", detail: String(error?.message ?? error).slice(0, 160) });
    } finally {
      for (const ctx of this.markets.values()) {
        const shouldBeEnabled = originalEnabled.includes(ctx.marketKey);
        if (ctx.enabled !== shouldBeEnabled) { try { this.setMarket(ctx.marketKey, { enabled: shouldBeEnabled }, { persist: true }); } catch { /* noop */ } }
      }
      this.stress = { running: false, startedAt: this.stress.startedAt, stages, secondsPerStage, report: { finishedAt: this.now(), cancelled: this.stress.cancelRequested === true, results }, originalEnabled };
      this.#safe(() => this.log("IQ_MULTI_STRESS_DONE", JSON.stringify({ stages, cancelled: this.stress.report.cancelled, results: results.map((row) => ({ stage: row.stage, markets: row.markets?.length ?? 0, cpuUserMs: row.cpuUserMs, memoryMb: row.memoryMb })) })));
    }
  }

  stopStress(reason = "CANCEL") {
    if (!this.stress.running) return { stopped: false, reason: "NOT_RUNNING" };
    this.stress = { ...this.stress, cancelRequested: true };
    this.#emitEvent("stress.cancel", { reason });
    return { stopped: true, reason };
  }

  stressReport() { return { running: this.stress.running, startedAt: this.stress.startedAt ?? null, stages: this.stress.stages ?? null, secondsPerStage: this.stress.secondsPerStage ?? null, cancelRequested: this.stress.cancelRequested === true, report: this.stress.report ?? null }; }
}
