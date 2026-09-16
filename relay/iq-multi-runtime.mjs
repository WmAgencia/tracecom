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
import { EventEmitter } from "node:events";
import { IqWsClient, IqWsError, IQ_WS_CANDIDATE_HOSTS, CANDLE_SIZE_SECONDS, classifyBalances, computeExpiration, normalizeCandle, parseSettlement, toEpochMs } from "./iqoption-ws.mjs";
import { buildFeatureContext, freshnessGate } from "./feature-engine.mjs";
import { executionGate, applyBrokerAcknowledgement, compareSettlement, ExecutionArmState, IdempotencyStore, KillSwitch, MAX_PRACTICE_STAKE_BRL } from "./iqoption-connector.mjs";
import { computeFrozenFeatures, evaluateFrozen } from "./frozen-strategies.mjs";
import { RealModeController } from "./real-mode.mjs";
import { PortfolioExecutionGate, resolveFinalStake } from "./portfolio-gate.mjs";
import { RuntimeAssetResolver } from "./asset-resolver.mjs";
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

  constructor({ pool = null, getSsid = () => null, armState = new ExecutionArmState(), killSwitch = new KillSwitch(), idempotency = new IdempotencyStore(), hosts = IQ_WS_CANDIDATE_HOSTS, now = () => Date.now(), log = () => {}, maxLatencySamples = 300, ackTimeoutMs = ACK_TIMEOUT_MS, realMode = new RealModeController({ now }), gate = new PortfolioExecutionGate(), resolver = new RuntimeAssetResolver({ now }), autoExecute = false } = {}) {
    super();
    this.pool = pool; this.getSsid = getSsid; this.armState = armState; this.killSwitch = killSwitch; this.idempotency = idempotency;
    this.hosts = hosts; this.now = now; this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxLatencySamples = maxLatencySamples; this.ackTimeoutMs = ackTimeoutMs;
    this.realMode = realMode; this.gate = gate; this.resolver = resolver;
    this.running = false; this.client = null; this.connection = null; this.stopRequested = false;
    this.reconnects = 0; this.connectionStartedAt = null;
    this.session = { connected: false, host: null, connectionId: null, serverTimeMs: null, clockSkewMs: null, timeValid: false, connectedAt: null };
    this.account = { practice: { verified: false, balanceId: null, balance: null, currency: null }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: null, type: "UNKNOWN" };
    this.config = { mode: "PRACTICE", globalMaxStake: DEFAULT_GLOBAL_MAX_STAKE, calculatedBankrollStake: 1, hardCap: HARD_CAP_STAKE, maxActiveMarkets: MAX_ACTIVE_MARKETS, autoExecute: autoExecute === true, selection: { family: "V3", horizonSeconds: 60, variantId: "V3-60" } };
    this.markets = new Map();
    for (const entry of UNIVERSE) {
      const key = marketKey(entry.canonical, entry.marketType);
      this.markets.set(key, this.#emptyMarket(entry, key));
    }
    this.pendingOrders = new Map();
    this.openPositions = new Map();
    this.orderIndex = new Map();
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
      enabled: false, paused: false, maxStake: DEFAULT_GLOBAL_MAX_STAKE, strategy: null,
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
    for (const ctx of this.markets.values()) this.#setAgent(ctx, "OFFLINE", "RUNTIME_STOP");
    return { stopped: true, reason };
  }

  onSessionAvailable() { this.start(); }
  onSessionRemoved() { this.stop("SESSION_DISCONNECTED"); }

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
        for (const ctx of this.markets.values()) if (ctx.enabled) this.#setAgent(ctx, ctx.availability === "OPEN" ? "WAIT" : "UNAVAILABLE", "WS_DISCONNECTED");
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
    if (next.maxStake !== undefined) {
      const value = Number(next.maxStake);
      if (!Number.isFinite(value) || value <= 0 || value > this.config.hardCap) throw new IqWsError("INVALID_MARKET_STAKE", String(next.maxStake));
      ctx.maxStake = value;
    }
    if (next.strategy !== undefined) {
      const family = String(next.strategy);
      if (!["V1", "V2", "V3", "V8"].includes(family)) throw new IqWsError("INVALID_STRATEGY", family);
      ctx.strategy = family;
    }
    if (next.enabled === undefined && next.paused === undefined && next.maxStake === undefined && next.strategy === undefined) throw new IqWsError("EMPTY_PATCH");
    if (persist) void this.#persistMarket(ctx);
    this.#emitEvent("market.config", { marketKey: key, enabled: ctx.enabled, paused: ctx.paused, maxStake: ctx.maxStake, strategy: ctx.strategy });
    return this.#publicMarket(ctx);
  }

  applyGlobalMaxStake(value, keys = null) {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0 || limit > this.config.hardCap) throw new IqWsError("INVALID_GLOBAL_STAKE", String(value));
    this.config.globalMaxStake = limit;
    const targets = Array.isArray(keys) && keys.length ? keys : [...this.markets.keys()];
    for (const key of targets) {
      const ctx = this.markets.get(key);
      if (ctx) { ctx.maxStake = limit; void this.#persistMarket(ctx); }
    }
    void this.#persistConfig();
    this.#emitEvent("config.global_stake", { globalMaxStake: limit, appliedTo: targets.length });
    return { globalMaxStake: limit, appliedTo: targets.length };
  }

  setAutoExecute(enabled) { this.config.autoExecute = enabled === true; void this.#persistConfig(); return { autoExecute: this.config.autoExecute }; }

  setMode(mode) {
    const next = mode === "REAL" ? "REAL" : "PRACTICE";
    if (next === this.config.mode) return this.modeState();
    if (next === "REAL" && !this.realMode.authorized()) throw new IqWsError("REAL_MODE_NOT_CONFIRMED");
    try { this.armState.disarm("MODE_SWITCH"); } catch { /* noop */ }
    if (next === "PRACTICE") this.realMode.revoke("MODE_SWITCH_TO_PRACTICE");
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
    this.#evaluateDecision(ctx, list);
  }

  #evaluateDecision(ctx, list) {
    const selection = ctx.strategy ? { family: ctx.strategy, horizonSeconds: this.config.selection.horizonSeconds } : this.config.selection;
    let action = "WAIT", reason = "INSUFFICIENT_CANDLES", confidence = null, features = null;
    if (list.length > MIN_CANDLES_FEATURE) {
      features = computeFrozenFeatures(list, list.length - 1);
      if (features) {
        const signal = evaluateFrozen(selection.family, features);
        action = signal ?? "WAIT";
        reason = signal ? "STRATEGY_SIGNAL" : "NO_SETUP";
        confidence = Number.isFinite(features.s) ? Number(Math.min(1, Math.abs(features.s)).toFixed(4)) : null;
      } else reason = "FEATURES_UNAVAILABLE";
    }
    ctx.decisionState = { action, reason, confidence, family: selection.family, horizonSeconds: selection.horizonSeconds, evaluatedAt: this.now(), featuresAvailable: Boolean(features), trigger: features ? { rsi14: features.rsi14, s: features.s, vol12: features.vol12, r24: features.r24 } : null };
    ctx.lastDecision = ctx.decisionState;
    this.#emitEvent("market.decision", { marketKey: ctx.marketKey, action, reason, confidence });
    if (action === "BUY" || action === "SELL") {
      ctx.lastSignal = { action, at: this.now(), bucketStart: ctx.lastCandle?.bucketStart ?? null, family: selection.family };
      this.#setAgent(ctx, "SIGNAL", reason);
      this.#emitEvent("market.signal", { marketKey: ctx.marketKey, action, bucketStart: ctx.lastSignal.bucketStart });
      if (this.config.autoExecute === true) void this.#autoExecute(ctx, action);
    } else {
      this.#setAgent(ctx, "WAIT", reason);
      if (this.now() - (ctx.lastWaitEmit ?? 0) > 5_000) { ctx.lastWaitEmit = this.now(); this.#emitEvent("market.wait", { marketKey: ctx.marketKey, reason }); }
    }
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

  async #autoExecute(ctx, action) {
    if (this.pendingOrders.has(ctx.marketKey) || this.openPositions.has(ctx.marketKey)) return;
    const bucket = ctx.lastSignal?.bucketStart ?? ctx.lastCandle?.bucketStart ?? 0;
    const idempotencyKey = `${ctx.marketKey}:${bucket}:${action}`;
    try { await this.requestOrder({ marketKey: ctx.marketKey, direction: action, decisionId: `auto_${ctx.marketKey}_${bucket}`, idempotencyKey, source: "AUTO_DECISION", horizonSeconds: ctx.decisionState.horizonSeconds }); }
    catch (error) { this.#safe(() => this.log("IQ_MULTI_AUTO_EXEC_BLOCKED", `${ctx.marketKey}:${String(error?.code ?? error?.message ?? error).slice(0, 120)}`)); }
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

  async requestOrder({ marketKey: key, direction, stake = null, decisionId = null, horizonSeconds = 60, idempotencyKey = null, source = "MANUAL", autoDisarmAfterAck = false, decisionAgeMs = 0 } = {}) {
    const ctx = this.markets.get(key);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    if (!this.client || !this.session.connected) throw new IqWsError("WS_DISCONNECTED");
    if (this.pendingOrders.has(key)) throw new IqWsError("ORDER_IN_FLIGHT", key);
    if (this.openPositions.has(key)) throw new IqWsError("POSITION_ALREADY_OPEN", key);
    if (this.config.mode === "REAL" && !this.account.real.available) throw new IqWsError("REAL_BALANCE_UNAVAILABLE");
    const last = this.#candleList(ctx).pop();
    const freshness = { fresh: Boolean(ctx.featureState?.fresh) && ctx.lastTickAt !== null && this.now() - ctx.lastTickAt <= MARKET_TICK_AGE_MS, tickAgeMs: ctx.lastTickAt === null ? null : this.now() - ctx.lastTickAt, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE" };
    const realAuthorized = this.config.mode === "REAL" && this.realMode.authorized();
    const resolvedStake = resolveFinalStake({ calculatedBankrollStake: Number(stake ?? this.config.calculatedBankrollStake), marketMaxStake: ctx.maxStake, globalMaxStake: this.config.globalMaxStake, hardCap: this.config.hardCap });
    const finalStake = resolvedStake.finalStake;
    const requestedKey = String(idempotencyKey ?? `${key}:${decisionId ?? this.now()}`).slice(0, 160);
    const existingRecord = this.idempotency.get(requestedKey);
    if (existingRecord) return { duplicate: true, marketKey: key, state: existingRecord.state, executionId: existingRecord.executionId, brokerOrderId: existingRecord.brokerOrderId, idempotencyKey: requestedKey };
    const decisionAction = direction === "BUY" || direction === "CALL" ? "BUY" : direction === "SELL" || direction === "PUT" ? "SELL" : null;
    if (!decisionAction) throw new IqWsError("INVALID_DIRECTION", String(direction));
    const selection = ctx.strategy ? { family: ctx.strategy, horizonSeconds } : this.config.selection;
    const gateResult = this.gate.evaluate({
      market: { ...ctx, maxStake: ctx.maxStake, marketKey: key }, marketKey: key, requestedMode: this.config.mode, realAuthorized,
      connection: { connected: this.session.connected, timeValid: this.session.timeValid, host: this.session.host },
      serverTime: { ms: this.client.serverNow(), skewMs: this.session.clockSkewMs },
      freshness, decision: { action: decisionAction, ageMs: Number(decisionAgeMs) || 0, horizonSeconds, reason: ctx.decisionState.reason }, strategy: { valid: Boolean(selection.family), variantId: `${selection.family}-${horizonSeconds}`, reason: null },
      price: last?.close ?? null, stake: finalStake, globalMaxStake: this.config.globalMaxStake, calculatedBankrollStake: Number(stake ?? this.config.calculatedBankrollStake),
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
    const entryPrice = last?.close ?? null;
    const directionWire = decisionAction === "BUY" ? "CALL" : "PUT";
    const pending = {
      executionId: record.executionId, idempotencyKey: requestedKey, requestId: requestedKey, marketKey: key, mode, direction: directionWire, action: decisionAction,
      stake: finalStake, activeId: ctx.activeId, symbol: ctx.display, expirationSec: expiration.expiration, optionKind: expiration.optionKind,
      entryPrice, requestedAt: this.now(), connectionId: this.connection?.connectionId ?? null, autoDisarmAfterAck: autoDisarmAfterAck === true, source, ackResolved: false, settling: false,
    };
    const ackPromise = new Promise((resolve) => { pending.ackResolve = resolve; });
    this.pendingOrders.set(key, pending);
    ctx.positionState = { status: "ORDERING", direction: directionWire, entryPrice, stake: finalStake, brokerOrderId: null, requestId: requestedKey, expirationSec: expiration.expiration, openedAt: this.now(), settledAt: null, result: null, profit: null, mode };
    this.#setAgent(ctx, "ORDERING", source);
    this.#emitEvent("order.pending", { marketKey: key, direction: directionWire, stake: finalStake, mode, expirationSec: expiration.expiration });
    await this.#persistExecution({ executionId: record.executionId, idempotencyKey: requestedKey, decisionId: record.payload?.decisionId ?? decisionId ?? null, marketKey: key, mode, connectionId: pending.connectionId, accountType: mode, brokerOrderId: null, symbol: ctx.display, activeId: ctx.activeId, direction: directionWire, stake: finalStake, currency: mode === "REAL" ? this.account.real.currency : this.account.practice.currency, state: "REQUESTED", requestId: requestedKey, expirationAt: nowIso(expiration.expiration * 1000), entryPrice, payout: ctx.payout, optionKind: expiration.optionKind, meta: { source } });
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
    pending.brokerOrderId = brokerOrderId;
    const ackMs = this.now() - pending.requestedAt;
    const ctx = this.markets.get(pending.marketKey);
    if (ctx) {
      this.#recordLatency(ctx, "orderAck", ackMs);
      ctx.positionState = { ...ctx.positionState, status: "OPEN", brokerOrderId, openedAt: this.now() };
      ctx.positionState.indicative = null;
      this.#setAgent(ctx, "IN_POSITION", source);
    }
    const position = { marketKey: pending.marketKey, mode: pending.mode, direction: pending.direction, stake: pending.stake, entryPrice: pending.entryPrice, brokerOrderId, expirationSec: pending.expirationSec, openedAt: this.now(), executionId: pending.executionId, source, connectionId: pending.connectionId };
    this.openPositions.set(pending.marketKey, position);
    this.orderIndex.set(String(brokerOrderId), pending.marketKey);
    this.pendingOrders.delete(pending.marketKey);
    await this.#persistExecution({ executionId: pending.executionId, brokerOrderId, state: "ACKNOWLEDGED", ackedAt: nowIso(this.now()), error: null });
    this.#emitEvent("order.ack", { marketKey: pending.marketKey, brokerOrderId, ackMs, source, mode: pending.mode });
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
    ctx.indicative = { state: "NEUTRAL", delta: null, indicativePnl: null, updatedAt: settledAt };
    this.openPositions.delete(key); this.orderIndex.delete(String(brokerOrderId));
    await this.#persistExecution({ executionId: position.executionId, brokerOrderId: String(brokerOrderId), state: "SETTLED", settledAt: nowIso(settledAt), brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit, meta: { settlementReason: comparison.reason, causal: settlement.detail, marketKey: key } });
    this.#emitEvent("position.settled", { marketKey: key, brokerOrderId, brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit });
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
        `UPDATE iq_executions SET idempotency_key=COALESCE($2,idempotency_key), decision_id=COALESCE($3,decision_id), market_key=COALESCE($4,market_key), mode=COALESCE($5,mode), connection_id=COALESCE($6,connection_id), account_type=COALESCE($7,account_type), broker_order_id=COALESCE($8,broker_order_id), symbol=COALESCE($9,symbol), active_id=COALESCE($10,active_id), direction=COALESCE($11,direction), stake=COALESCE($12,stake), currency=COALESCE($13,currency), state=$14, request_id=COALESCE($15,request_id), expiration_at=COALESCE($16,expiration_at), entry_price=COALESCE($17,entry_price), acked_at=COALESCE($18,acked_at), settled_at=COALESCE($19,settled_at), broker_result=COALESCE($20,broker_result), causal_result=COALESCE($21,causal_result), settlement_mismatch=($22 OR settlement_mismatch), profit=COALESCE($23,profit), error=COALESCE($24,error), payout=COALESCE($25,payout), option_kind=COALESCE($26,option_kind), meta=COALESCE($27,meta), updated_at=now() WHERE execution_id=$1`,
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
      await this.pool.query("INSERT INTO iq_markets(market_key,symbol,display,market_type,canonical,enabled,paused,max_stake,strategy,active_id,instrument_types,availability,payout,payout_source,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,now()) ON CONFLICT(market_key) DO UPDATE SET enabled=EXCLUDED.enabled, paused=EXCLUDED.paused, max_stake=EXCLUDED.max_stake, strategy=EXCLUDED.strategy, active_id=EXCLUDED.active_id, instrument_types=EXCLUDED.instrument_types, availability=EXCLUDED.availability, payout=EXCLUDED.payout, payout_source=EXCLUDED.payout_source, updated_at=now()",
        [ctx.marketKey, ctx.symbol, ctx.display, ctx.marketType, ctx.canonical, ctx.enabled, ctx.paused, ctx.maxStake, ctx.strategy, ctx.activeId, JSON.stringify(ctx.instrumentTypes ?? []), ctx.availability, ctx.payout, ctx.payoutSource]);
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_MARKET_PERSIST_FAILED", String(error?.message ?? error).slice(0, 120))); return false; }
  }

  async #persistConfig() {
    try {
      if (!this.pool || !await this.#ensureDb("iq_runtime_config")) return false;
      await this.pool.query("INSERT INTO iq_runtime_config(id,mode,global_max_stake,calculated_bankroll_stake,auto_execute,selection_json,resolver_json,updated_at) VALUES(1,$1,$2,$3,$4,$5::jsonb,$6::jsonb,now()) ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode, global_max_stake=EXCLUDED.global_max_stake, calculated_bankroll_stake=EXCLUDED.calculated_bankroll_stake, auto_execute=EXCLUDED.auto_execute, selection_json=EXCLUDED.selection_json, resolver_json=EXCLUDED.resolver_json, updated_at=now()",
        [this.config.mode, this.config.globalMaxStake, this.config.calculatedBankrollStake, this.config.autoExecute, JSON.stringify(this.config.selection), JSON.stringify(this.resolver.toJSON())]);
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
        this.config.calculatedBankrollStake = Number(row.calculated_bankroll_stake) || this.config.calculatedBankrollStake;
        this.config.autoExecute = row.auto_execute === true;
        if (row.selection_json && typeof row.selection_json === "object") this.config.selection = { ...this.config.selection, ...row.selection_json };
        if (row.resolver_json) this.resolver.loadFrom(row.resolver_json);
        if (row.mode === "REAL") { this.config.mode = "REAL"; this.realMode.revoke("RESTART"); }
      }
      const markets = (await this.pool.query("SELECT * FROM iq_markets")).rows;
      for (const market of markets) {
        const ctx = this.markets.get(market.market_key);
        if (!ctx) continue;
        ctx.enabled = market.enabled === true; ctx.paused = market.paused === true;
        ctx.maxStake = Number(market.max_stake) || ctx.maxStake;
        ctx.strategy = market.strategy ?? null;
        if (market.active_id !== null && market.active_id !== undefined) ctx.activeId = Number(market.active_id);
        if (Array.isArray(market.instrument_types)) ctx.instrumentTypes = market.instrument_types;
        if (market.availability) ctx.availability = market.availability;
        if (market.payout !== null && market.payout !== undefined) ctx.payout = Number(market.payout);
      }
      this.#safe(() => this.log("IQ_MULTI_CONFIG_LOADED", JSON.stringify({ markets: markets.length, globalMaxStake: this.config.globalMaxStake, mode: this.config.mode, autoExecute: this.config.autoExecute })));
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
      enabled: ctx.enabled, paused: ctx.paused, maxStake: ctx.maxStake, strategy: ctx.strategy ?? this.config.selection.family,
      activeId: ctx.activeId, instrumentTypes: ctx.instrumentTypes, availability: ctx.availability, payout: ctx.payout, payoutSource: ctx.payoutSource, resolvedAt: ctx.resolvedAt,
      connectionHealth: ctx.connectionHealth, serverTime: ctx.serverTime,
      lastTick: ctx.lastTick, candles5s: ctx.candles.size,
      featureState: ctx.featureState ? { builtAt: ctx.featureState.builtAt, fresh: ctx.featureState.fresh, freshnessReason: ctx.featureState.freshnessReason, rsi14: ctx.featureState.context?.deterministicIndicators?.rsi14?.value ?? null, atr14: ctx.featureState.context?.deterministicIndicators?.atr14?.value ?? null, adx14: ctx.featureState.context?.deterministicIndicators?.adx14?.value ?? null, donchianPosition: ctx.featureState.context?.deterministicIndicators?.donchianPosition?.value ?? null, microstructureStreak: ctx.featureState.context?.microstructure?.streak ?? null } : null,
      decisionState: ctx.decisionState, positionState: ctx.positionState, settlementState: ctx.settlementState, indicative: ctx.indicative,
      latency: { serverToReceived: latencySummary(ctx.latency.serverToReceived), receivedToNormalized: latencySummary(ctx.latency.receivedToNormalized), normalizedToFeature: latencySummary(ctx.latency.normalizedToFeature), orderAck: latencySummary(ctx.latency.orderAck) },
      stats: ctx.stats,
      agentState: ctx.agentState, agentSince: ctx.agentSince, agentReason: ctx.agentReason ?? null,
      lastSignal: ctx.lastSignal, lastDecision: ctx.lastDecision, lastTrade: ctx.lastTrade,
      selectionReason: ctx.selectionReason ?? null,
    };
  }

  office() {
    if (this.now() - this.equityRefreshedAt > 30_000) { this.equityRefreshedAt = this.now(); void this.refreshEquityCurve(); }
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
      config: { globalMaxStake: this.config.globalMaxStake, calculatedBankrollStake: this.config.calculatedBankrollStake, hardCap: this.config.hardCap, maxActiveMarkets: this.config.maxActiveMarkets, autoExecute: this.config.autoExecute, selection: this.config.selection },
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
        symbol: primary.symbol, activeId: primary.activeId, activeExpectedFromRepo: primary.marketType === "NORMAL" ? 1 : null, activeActual2026: primary.activeId, activeExpectedVsActual: primary.marketType === "NORMAL" ? "MATCH" : "OTC", activeSection: primary.instrumentTypes[0] ?? null, activeOtc: primary.marketType === "OTC", activeCandidates: primary.candidates ?? [],
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
    const originalEnabled = this.activeMarketKeys();
    this.stress = { running: true, startedAt: this.now(), stages: normalizedStages, secondsPerStage, report: null, originalEnabled };
    void this.#runStress(normalizedStages, secondsPerStage, originalEnabled);
    return { started: true, stages: normalizedStages, secondsPerStage };
  }

  async #runStress(stages, secondsPerStage, originalEnabled) {
    const candidates = [...this.markets.values()].filter((ctx) => ctx.availability === "OPEN" && ctx.activeId !== null).sort((a, b) => (a.marketType === b.marketType ? 0 : a.marketType === "NORMAL" ? -1 : 1));
    const results = [];
    try {
      for (const stage of stages) {
        for (const ctx of this.markets.values()) { if (ctx.enabled && !candidates.slice(0, stage).includes(ctx)) { try { this.setMarket(ctx.marketKey, { enabled: false }, { persist: false }); } catch { /* noop */ } } }
        for (const ctx of candidates.slice(0, stage)) { if (!ctx.enabled) { try { this.setMarket(ctx.marketKey, { enabled: true }, { persist: false }); } catch (error) { this.#safe(() => this.log("IQ_MULTI_STRESS_ENABLE_FAILED", `${ctx.marketKey}:${String(error?.code ?? error.message)}`)); } } }
        const baseline = Object.fromEntries(candidates.slice(0, stage).map((ctx) => [ctx.marketKey, { messages: ctx.stats.messages, candles: ctx.stats.candlesProcessed, rejected: ctx.stats.rejected, duplicates: ctx.stats.duplicates, reorder: ctx.stats.reorder, gaps: ctx.stats.gaps, reconnects: this.reconnects }]));
        const started = this.now(); const cpuStart = process.cpuUsage();
        await sleep(Math.max(5_000, secondsPerStage) * 1000);
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
      this.stress = { running: false, startedAt: this.stress.startedAt, stages, secondsPerStage, report: { finishedAt: this.now(), results }, originalEnabled };
      this.#safe(() => this.log("IQ_MULTI_STRESS_DONE", JSON.stringify({ stages, results: results.map((row) => ({ stage: row.stage, markets: row.markets?.length ?? 0, cpuUserMs: row.cpuUserMs, memoryMb: row.memoryMb })) })));
    }
  }

  stressReport() { return { running: this.stress.running, startedAt: this.stress.startedAt ?? null, stages: this.stress.stages ?? null, secondsPerStage: this.stress.secondsPerStage ?? null, report: this.stress.report ?? null }; }
}
