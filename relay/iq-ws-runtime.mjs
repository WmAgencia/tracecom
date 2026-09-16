/**
 * IQ WS RUNTIME — orquestra o market data real da IQ Option (WS) e a execucao PRACTICE.
 *
 * Invariantes:
 *  - Execucao SOMENTE PRACTICE (account.type vem de get_balances server-side; REAL => EXECUTION FORBIDDEN).
 *  - WS caiu => AUTO-DISARM (armState.disarm("WS_DISCONNECTED")).
 *  - Uma decisao -> no maximo UMA ordem (IdempotencyStore); sem ACK real = UNKNOWN e NUNCA reenvia.
 *  - Nenhum SSID/segredo em status/log/persistencia.
 *  - Candles 5s causais: dedupe por bucket, ordem, sem futuro; alimentam buildFeatureContext.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { IqWsClient, IqWsError, IQ_WS_CANDIDATE_HOSTS, CANDLE_SIZE_SECONDS, classifyBalances, computeExpiration, normalizeCandle, parseSettlement, resolveEurUsdActive, toEpochMs } from "./iqoption-ws.mjs";
import { buildFeatureContext, freshnessGate } from "./feature-engine.mjs";
import { executionGate, applyBrokerAcknowledgement, compareSettlement, ExecutionArmState, IdempotencyStore, KillSwitch, MAX_PRACTICE_STAKE_BRL } from "./iqoption-connector.mjs";

export const RUNTIME_VERSION = "iq-ws-runtime-v1";
export const DEFAULT_SYMBOL = "EUR/USD";
export const MARKET_DATA_MAX_TICK_AGE_MS = 15_000;
export const MIN_CANDLES_FOR_HEALTH = 30;
export const ACK_TIMEOUT_MS = 15_000;
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
export const MAX_CANDLE_BUFFER = 900;

export function percentile(values, fraction) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index]);
}
export function latencySummary(samples) { return { count: samples.length, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99), max: samples.length ? Math.round(Math.max(...samples)) : null }; }

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class IqWsRuntime extends EventEmitter {
  #disconnectedWaiter;

  constructor({ pool = null, getSsid = () => null, armState = new ExecutionArmState(), killSwitch = new KillSwitch(), idempotency = new IdempotencyStore(), hosts = IQ_WS_CANDIDATE_HOSTS, now = () => Date.now(), log = () => {}, symbol = DEFAULT_SYMBOL, maxLatencySamples = 300, smokeAutoDisarm = false, ackTimeoutMs = ACK_TIMEOUT_MS } = {}) {
    super();
    this.#disconnectedWaiter = null;
    this.pool = pool;
    this.getSsid = getSsid;
    this.armState = armState;
    this.killSwitch = killSwitch;
    this.idempotency = idempotency;
    this.hosts = hosts;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* log nunca derruba o runtime */ } };
    this.symbol = symbol;
    this.smokeAutoDisarm = smokeAutoDisarm !== false;
    this.ackTimeoutMs = Number(ackTimeoutMs) > 0 ? Number(ackTimeoutMs) : ACK_TIMEOUT_MS;
    this.maxLatencySamples = maxLatencySamples;
    this.running = false; this.client = null; this.connection = null; this.stopRequested = false;
    this.session = { connected: false, host: null, connectionId: null, connectedAt: null, serverTimeMs: null, clockSkewMs: null, timeValid: false, lastTimeSyncAt: null };
    this.account = { verified: false, type: "UNKNOWN", currency: null, balance: null, balanceId: null, hasReal: false, checkedAt: null };
    this.active = { symbol, activeId: null, expectedFromRepo: 1, actual2026: null, section: null, otc: null, enabled: null, expectedVsActual: null, resolvedAt: null, candidates: [] };
    this.candles = new Map();
    this.lastCandle = null; this.lastCandleReceivedAt = null;
    this.candleDiagnostics = { rejected: 0, lastCode: null, lastReason: null, rawShape: null, rawShapeAt: null };
    this.lastContext = null; this.lastFeatureAt = null;
    this.latency = { serverToReceived: [], receivedToNormalized: [], normalizedToFeature: [], orderAck: [] };
    this.pendingOrder = null; this.lastExecution = null; this.executionsCache = [];
    this.userLimitBrl = null; this.balanceFailure = null; this.dbReady = null;
  }

  /* ----------------------------- lifecycle ----------------------------- */

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
    this.account = { verified: false, type: "UNKNOWN", currency: null, balance: null, balanceId: null, hasReal: false, checkedAt: null };
    this.armState.disarm("WS_DISCONNECTED");
    return { stopped: true, reason };
  }

  onSessionAvailable() { this.log("IQ_WS_SESSION_AVAILABLE"); this.start(); }
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
        this.session = { connected: true, host: ready.host, connectionId: ready.connectionId, connectedAt: this.now(), serverTimeMs: ready.serverTimeMs, clockSkewMs: ready.clockSkewMs, timeValid: ready.timeValid, lastTimeSyncAt: this.now() };
        this.emit("session", { ...this.session });
        this.#safe(() => this.log("IQ_WS_READY", JSON.stringify({ host: ready.host, expectedFromRepo: ready.host === "iqoption.com" ? "MATCH" : "DIFFERENT", clockSkewMs: ready.clockSkewMs, timeValid: ready.timeValid })));
        await this.#bootstrap(client);
        attempt = 0;
        await new Promise((resolve) => { this.#disconnectedWaiter = resolve; if (!this.running) resolve(); });
      } catch (error) {
        this.#safe(() => this.log("IQ_WS_CONNECT_FAILED", JSON.stringify({ code: error?.code ?? "UNKNOWN", detail: String(error?.message ?? error).slice(0, 200) })));
        try { client?.close("CONNECT_FAILED"); } catch { /* noop */ }
      } finally {
        this.client = null; this.#disconnectedWaiter = null;
        this.session = { ...this.session, connected: false };
        this.pendingOrder = null;
        try { this.armState.disarm("WS_DISCONNECTED"); } catch { /* noop */ }
      }
      if (!this.running || this.stopRequested) break;
      const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
      attempt += 1;
      this.emit("disconnected", { at: this.now(), nextAttemptInMs: delay, autoDisarmReason: "WS_DISCONNECTED" });
      await sleep(delay + Math.floor(Math.random() * 500));
    }
    this.running = false;
  }

  #safe(fn) { try { fn(); } catch (error) { this.log("IQ_WS_RUNTIME_LOG_ERROR", String(error?.message ?? error)); } }

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
  }

  /** Ponto unico de ingestao de eventos do WS (testavel sem rede/socket). */
  ingestEvent(kind, event) {
    const normalized = event && typeof event === "object" ? { name: kind, ...event } : { name: kind, msg: event };
    if (kind === "candle-generated" || kind === "candles-generated") return this.#onCandleEvent(normalized, { allSizes: kind === "candles-generated" });
    if (kind === "balances") return this.#onBalances(normalized);
    if (kind === "balance-changed") return this.#onBalanceChanged(normalized);
    if (kind === "option" || kind === "buyComplete" || kind === "result" || kind === "socket-option-opened") return this.#onOrderEvent(normalized, kind);
    if (kind === "socket-option-closed" || kind === "option-closed") return this.#onSettlementEvent(normalized, kind);
    return undefined;
  }

  async #bootstrap(client) {
    client.subscribeCandles(this.active.activeId ?? 0, CANDLE_SIZE_SECONDS);
    let resolved = null;
    try {
      const { response } = await client.getInitializationData();
      resolved = resolveEurUsdActive(response.msg);
      if (resolved.selected) {
        this.active = {
          symbol: this.symbol, activeId: resolved.selected.activeId, expectedFromRepo: resolved.expectedFromRepo,
          actual2026: resolved.selected.activeId, section: resolved.selected.section, otc: resolved.selected.otc, enabled: resolved.selected.open,
          expectedVsActual: resolved.selected.activeId === resolved.expectedFromRepo ? "MATCH" : (resolved.selected.otc ? "DIFFERENT_OTC" : "DIFFERENT"),
          resolvedAt: this.now(), candidates: resolved.candidates.map((row) => ({ activeId: row.activeId, section: row.section, otc: row.otc, open: row.open })),
        };
        this.#safe(() => this.log("IQ_WS_EURUSD_RESOLVED", JSON.stringify({ expectedFromRepo: resolved.expectedFromRepo, actual2026: resolved.selected.activeId, otc: resolved.selected.otc, section: resolved.selected.section, candidates: this.active.candidates })));
        try { client.unsubscribeCandles(0, CANDLE_SIZE_SECONDS); } catch { /* noop */ }
        client.subscribeCandles(this.active.activeId, CANDLE_SIZE_SECONDS);
      } else {
        this.#safe(() => this.log("IQ_WS_EURUSD_NOT_FOUND", "initialization-data sem EUR/USD habilitado"));
      }
    } catch (error) { this.#safe(() => this.log("IQ_WS_INIT_DATA_FAILED", String(error?.code ?? error?.message ?? error))); }
    try {
      const { response } = await client.getBalances();
      const rawList = Array.isArray(response.msg) ? response.msg : Array.isArray(response.msg?.balances) ? response.msg.balances : [];
      this.#applyBalances(rawList);
    } catch (error) { this.balanceFailure = String(error?.code ?? error?.message ?? error).slice(0, 120); this.#safe(() => this.log("IQ_WS_BALANCES_FAILED", this.balanceFailure)); }
    this.#evaluateHealth();
    void this.reconcileOrphans();
  }

  /** Ordens REQUESTED/ACKNOWLEDGED antigas (ex.: relay reiniciou com ordem em voo): nunca reenvia;
   *  consulta get-options e liquida com o resultado real; sem brokerOrderId persistido -> UNKNOWN. */
  async reconcileOrphans() {
    if (!this.pool || !this.client || !this.session.connected) return { checked: 0, settled: 0, unknown: 0 };
    if (!await this.#ensureDb()) return { checked: 0, settled: 0, unknown: 0 };
    let rows = [];
    try { rows = (await this.pool.query("SELECT execution_id, idempotency_key, broker_order_id, direction, symbol, active_id, stake, expiration_at, entry_price FROM iq_executions WHERE state IN ('REQUESTED','ACKNOWLEDGED') AND requested_at < now() - interval '2 minutes' ORDER BY requested_at DESC LIMIT 10")).rows; }
    catch (error) { this.#safe(() => this.log("IQ_WS_RECONCILE_QUERY_FAILED", String(error?.message ?? error).slice(0, 120))); return { checked: 0, settled: 0, unknown: 0 }; }
    if (!rows.length) return { checked: 0, settled: 0, unknown: 0 };
    const result = { checked: rows.length, settled: 0, unknown: 0 };
    let closed = [];
    try {
      const { response } = await this.client.getOptions({ limit: 100, instrumentType: "binary,turbo", balanceId: this.account.balanceId });
      closed = response.msg?.closed_options ?? response.msg?.closedOptions ?? [];
    } catch (error) { this.#safe(() => this.log("IQ_WS_RECONCILE_OPTIONS_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 120))); }
    for (const row of rows) {
      if (!row.broker_order_id) {
        await this.#persistExecution({ executionId: row.execution_id, state: "UNKNOWN", error: "ORPHANED_NO_ACK_RECONCILED" });
        result.unknown += 1;
        continue;
      }
      const match = closed.find((entry) => String(entry?.id?.[0] ?? entry?.id ?? "") === String(row.broker_order_id));
      if (!match) continue;
      const broker = parseSettlement(match);
      if (broker.result === "UNKNOWN") continue;
      const comparison = compareSettlement(broker.result, "UNKNOWN");
      await this.#persistExecution({ executionId: row.execution_id, state: "SETTLED", brokerOrderId: String(row.broker_order_id), settledAt: new Date().toISOString(), brokerResult: broker.result, causalResult: "UNKNOWN", mismatch: comparison.mismatch, profit: broker.profit, meta: { reconciled: true, reason: comparison.reason } });
      result.settled += 1;
      this.#safe(() => this.log("IQ_WS_RECONCILED", JSON.stringify({ executionId: row.execution_id, brokerOrderId: String(row.broker_order_id), brokerResult: broker.result })));
      this.lastExecution = this.lastExecution ?? { executionId: row.execution_id, brokerOrderId: String(row.broker_order_id), state: "SETTLED", brokerResult: broker.result, causalResult: "UNKNOWN", mismatch: comparison.mismatch, profit: broker.profit, at: this.now(), reason: comparison.reason };
    }
    return result;
  }

  /* ----------------------------- market data ----------------------------- */

  #onCandleEvent(event, { allSizes = false } = {}) {
    if (!this.#isCurrentConnection(event)) return;
    if (!this.active.activeId) return;
    const receivedAt = event.receivedAt ?? this.now();
    const serverTimestamp = this.client?.serverNow() ?? toEpochMs(event.msg?.at) ?? receivedAt;
    const raws = [];
    if (allSizes) {
      const candles = event.msg?.candles;
      if (candles && typeof candles === "object") {
        const five = candles[String(CANDLE_SIZE_SECONDS)] ?? candles[CANDLE_SIZE_SECONDS];
        if (five) raws.push({ ...five, active_id: event.msg?.active_id, at: event.msg?.at, ask: event.msg?.ask, bid: event.msg?.bid, size: CANDLE_SIZE_SECONDS });
      }
    } else if (event.name === "candle-generated" && Number(event.msg?.size) === CANDLE_SIZE_SECONDS) {
      raws.push(event.msg);
    }
    for (const raw of raws) {
      let candle;
      try { candle = normalizeCandle(raw, { symbol: this.symbol, activeId: this.active.activeId, serverTimestamp, receivedAt, connectionId: event.connectionId, sizeSeconds: CANDLE_SIZE_SECONDS }); }
      catch (error) {
        this.candleDiagnostics.rejected += 1;
        this.candleDiagnostics.lastCode = error?.code ?? "UNKNOWN";
        this.candleDiagnostics.lastReason = String(error?.message ?? error).slice(0, 200);
        if (!this.candleDiagnostics.rawShape && error?.code === "INVALID_CANDLE_PRICE") {
          this.candleDiagnostics.rawShape = JSON.stringify(raw).slice(0, 500);
          this.candleDiagnostics.rawShapeAt = this.now();
          this.#safe(() => this.log("IQ_WS_CANDLE_RAW_SHAPE", this.candleDiagnostics.rawShape));
        }
        continue;
      }
      const existing = this.candles.get(candle.bucketStart);
      if (existing && existing.bucketEnd === candle.bucketEnd && existing.close === candle.close && existing.high === candle.high && existing.low === candle.low) continue;
      this.candles.set(candle.bucketStart, { ...(existing ?? {}), ...candle });
      if (this.candles.size > MAX_CANDLE_BUFFER) this.candles.delete(Math.min(...this.candles.keys()));
      this.lastCandle = candle; this.lastCandleReceivedAt = receivedAt;
      const serverStamp = Number.isFinite(Number(candle.serverTimestamp)) ? Number(candle.serverTimestamp) : null;
      if (serverStamp) this.#recordLatency("serverToReceived", Math.max(0, receivedAt - serverStamp));
      this.#recordLatency("receivedToNormalized", Math.max(0, (candle.receivedAt ?? receivedAt) - receivedAt));
      this.emit("candle", { ...candle });
    }
    this.#evaluateHealth();
    this.#maybeBuildFeatures();
  }

  #maybeBuildFeatures() {
    const now = this.now();
    if (this.lastFeatureAt && now - this.lastFeatureAt < 1_000) return;
    const list = this.candleList();
    if (list.length < 3) return;
    try {
      const context = buildFeatureContext({ candles: list, now, frameCapturedAt: this.lastCandleReceivedAt ?? now, timeframeSeconds: CANDLE_SIZE_SECONDS, provenanceExtra: { source: "IQ_OPTION_WS", connectionId: this.connection?.connectionId ?? null, activeId: this.active.activeId } });
      const fresh = freshnessGate(context);
      this.lastContext = { context, fresh, builtAt: now };
      this.lastFeatureAt = now;
      if (this.lastCandleReceivedAt !== null) this.#recordLatency("normalizedToFeature", Math.max(0, now - this.lastCandleReceivedAt));
    } catch (error) { this.#safe(() => this.log("IQ_WS_FEATURE_FAILED", String(error?.message ?? error))); }
  }

  candleList() { return [...this.candles.values()].sort((a, b) => a.bucketStart - b.bucketStart); }

  #recordLatency(stage, value) { const list = this.latency[stage]; if (!Array.isArray(list)) return; list.push(Math.max(0, Math.round(value))); if (list.length > this.maxLatencySamples) list.splice(0, list.length - this.maxLatencySamples); }

  #isCurrentConnection(event) {
    if (!event) return false;
    const current = this.connection?.connectionId ?? null;
    if (!current) return false;
    return event.connectionId === current;
  }

  /* ----------------------------- account ----------------------------- */

  #onBalances(event) {
    if (!this.#isCurrentConnection(event)) return;
    const list = Array.isArray(event.msg) ? event.msg : Array.isArray(event.msg?.balances) ? event.msg.balances : [];
    this.#applyBalances(list);
  }
  #onBalanceChanged(event) {
    if (!this.#isCurrentConnection(event)) return;
    const current = event.msg?.current_balance;
    if (current && Number(current.id) === Number(this.account.balanceId)) this.account = { ...this.account, balance: Number.isFinite(Number(current.amount)) ? Number(current.amount) : this.account.balance };
  }

  #applyBalances(rawList) {
    const classified = classifyBalances(rawList);
    const selected = classified.selected;
    this.account = {
      verified: classified.verifiedPractice,
      type: classified.type,
      currency: selected?.currency ?? null,
      balance: selected?.amount ?? null,
      balanceId: selected?.id ?? null,
      hasReal: classified.hasReal,
      checkedAt: this.now(),
      balancesSeen: classified.balances.map((row) => ({ id: row.id, type: row.type, currency: row.currency, amount: row.amount, isDefault: row.isDefault })),
    };
    this.balanceFailure = null;
    if (classified.verifiedPractice) {
      try { this.armState.onConnected("PRACTICE"); } catch (error) { this.#safe(() => this.log("IQ_WS_ARM_STATE_FAILED", String(error?.code ?? error?.message ?? error))); }
    }
  }

  /* ----------------------------- health ----------------------------- */

  marketDataHealth() {
    const reasons = [];
    const now = this.now();
    if (!this.session.connected) reasons.push("WS_DISCONNECTED");
    if (!this.session.timeValid) reasons.push("TIME_SYNC_INVALID");
    if (!this.active.activeId) reasons.push("ACTIVE_ID_UNRESOLVED");
    if (this.candles.size < MIN_CANDLES_FOR_HEALTH) reasons.push("INSUFFICIENT_CANDLES");
    const tickAge = this.lastCandleReceivedAt === null ? null : now - this.lastCandleReceivedAt;
    if (tickAge === null || tickAge > MARKET_DATA_MAX_TICK_AGE_MS) reasons.push("STALE_TICKS");
    return { healthy: reasons.length === 0, reasons, tickAgeMs: tickAge, candles: this.candles.size };
  }

  #evaluateHealth() {
    const health = this.marketDataHealth();
    try { this.armState.onMarketData(health.healthy); } catch { /* noop */ }
    return health;
  }

  /* ----------------------------- arm/disarm ----------------------------- */

  arm(limitBrl, { confirmation = false, actor = "ui" } = {}) {
    if (!this.account.verified) throw new IqWsError("PRACTICE_ACCOUNT_NOT_VERIFIED", `type=${this.account.type}`);
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("KILL_SWITCH_ACTIVE");
    const health = this.marketDataHealth();
    if (!health.healthy) throw new IqWsError("MARKET_DATA_UNHEALTHY", health.reasons.join(","));
    if (!this.armState.connectedAccountType) this.armState.onConnected("PRACTICE");
    this.armState.onMarketData(health.healthy);
    const limitBrlNumber = Number(limitBrl);
    const arm = this.armState.arm(limitBrlNumber, { explicitConfirmation: confirmation === true });
    this.userLimitBrl = Math.min(limitBrlNumber, MAX_PRACTICE_STAKE_BRL);
    const fxMode = this.account.currency === "BRL" ? "BRL_NATIVE" : "NOMINAL_BROKER_CURRENCY_CAP";
    this.#safe(() => this.log("IQ_WS_ARMED", JSON.stringify({ limitBrl: this.userLimitBrl, currency: this.account.currency, fxMode, actor })));
    return { ...arm, userLimitBrl: this.userLimitBrl, currency: this.account.currency, fxMode };
  }

  disarm(reason = "MANUAL") { this.#safe(() => this.log("IQ_WS_DISARMED", String(reason).slice(0, 60))); return this.armState.disarm(reason); }

  setKillSwitch(engaged, reason = "UI") {
    if (engaged === true) { this.killSwitch.engage(); this.armState.disarm("KILL_SWITCH"); }
    else this.killSwitch.release();
    this.#safe(() => this.log("IQ_WS_KILL_SWITCH", JSON.stringify({ executionEnabled: this.killSwitch.status().executionEnabled, reason })));
    return { killSwitch: this.killSwitch.status(), armState: this.armState.snapshot() };
  }

  /* ----------------------------- execution ----------------------------- */

  async requestPracticeOrder({ direction, stake, decisionId = null, horizonSeconds = 60, idempotencyKey = null, autoDisarmAfterAck = false, decisionAgeMs = 0, actor = "ui" } = {}) {
    if (this.pendingOrder) throw new IqWsError("ORDER_IN_FLIGHT", this.pendingOrder.executionId);
    const client = this.client;
    if (!client || !this.session.connected) throw new IqWsError("WS_DISCONNECTED");
    const key = String(idempotencyKey ?? `ui_${decisionId ?? this.now()}`).slice(0, 120);
    const gate = executionGate({ action: direction, stake: Number(stake), decisionId: decisionId ?? `ui_test_${this.now()}`, asset: this.symbol, horizonSeconds: Number(horizonSeconds), decisionAgeMs: Number(decisionAgeMs) || 0, marketOpen: true, idempotencyKey: key }, {
      armState: this.armState, userLimitBrl: this.userLimitBrl ?? 1, brokerCurrency: this.account.currency ?? "BRL", fxRate: 1, killSwitch: this.killSwitch, idempotency: this.idempotency, accountType: "PRACTICE", expectedAsset: this.symbol,
    });
    if (gate.duplicate) return { duplicate: true, state: gate.record.state, executionId: gate.record.executionId, brokerOrderId: gate.record.brokerOrderId, idempotencyKey: key };
    const record = gate.record;
    const serverSec = (client.serverNow() ?? this.now()) / 1000;
    const expiration = computeExpiration(serverSec, Math.max(1, Math.round(Number(horizonSeconds) / 60)));
    const entryPrice = this.candleList().length ? this.candleList()[this.candleList().length - 1].close : null;
    const requestId = key;
    this.pendingOrder = { executionId: record.executionId, idempotencyKey: key, requestId, direction: gate.direction, action: direction, stake: gate.stake, activeId: this.active.activeId, symbol: this.symbol, expirationSec: expiration.expiration, optionKind: expiration.optionKind, entryPrice, requestedAt: this.now(), connectionId: this.connection?.connectionId ?? null, autoDisarmAfterAck: autoDisarmAfterAck === true || this.smokeAutoDisarm === true, actor, ackResolved: false };
    const ackPromise = new Promise((resolve) => { this.pendingOrder.ackResolve = resolve; });    const payload = { ...record.payload, requestId, expiration: expiration.expiration, optionTypeId: expiration.optionTypeId, entryPrice, connectionId: this.pendingOrder.connectionId };
    await this.#persistExecution({ executionId: record.executionId, idempotencyKey: key, decisionId: record.payload.decisionId, connectionId: this.pendingOrder.connectionId, accountType: "PRACTICE", brokerOrderId: null, symbol: this.symbol, activeId: this.active.activeId, direction: gate.direction, stake: gate.stake, currency: this.account.currency, state: "REQUESTED", requestId, expirationAt: new Date(expiration.expiration * 1000).toISOString(), entryPrice, meta: { optionKind: expiration.optionKind, actor } });
    try {
      client.placeOrder({ price: gate.stake, activeId: this.active.activeId, direction: gate.direction, expiration: expiration.expiration, optionTypeId: expiration.optionTypeId, balanceId: this.account.balanceId, requestId });
      this.#safe(() => this.log("IQ_WS_ORDER_SENT", JSON.stringify({ executionId: record.executionId, direction: gate.direction, stake: gate.stake, activeId: this.active.activeId, expiration: expiration.expiration, optionKind: expiration.optionKind })));
    } catch (error) {
      record.state = "UNKNOWN"; await this.#persistExecution({ executionId: record.executionId, state: "UNKNOWN", error: String(error?.code ?? error?.message ?? error).slice(0, 160) });
      this.pendingOrder = null;
      throw new IqWsError("ORDER_SEND_FAILED", String(error?.code ?? error?.message ?? error));
    }
    const ackTimer = setTimeout(() => { const pending = this.pendingOrder; if (!pending || pending.ackResolved) return; pending.ackResolved = true; this.armState.disarm("ORDER_ACK_UNKNOWN"); pending.ackResolve?.({ state: "UNKNOWN", brokerOrderId: null, timedOut: true }); }, this.ackTimeoutMs);
    ackTimer.unref?.();
    const outcome = await ackPromise;
    clearTimeout(ackTimer);
    return { duplicate: false, executionId: record.executionId, idempotencyKey: key, requestId, ...outcome };
  }

  #onOrderEvent(event, kind) {
    if (!this.#isCurrentConnection(event)) return;
    const pending = this.pendingOrder;
    if (!pending || pending.connectionId !== event.connectionId) return;
    const msg = event.msg ?? {};
    const matchesRequest = event.requestId && String(event.requestId) === String(pending.requestId);
    if (kind === "option" && !matchesRequest) return;
    if (kind === "buyComplete" && (msg.isSuccessful === false || msg.result?.id === undefined)) return;
    if (kind === "socket-option-opened") {
      if (msg.active_id !== undefined && Number(msg.active_id) !== Number(pending.activeId)) return;
      if (msg.expired !== undefined && Number(msg.expired) !== Number(pending.expirationSec)) return;
      if (msg.price !== undefined && Number(msg.price) !== Number(pending.stake)) return;
    }
    const orderId = msg.id ?? msg.result?.id ?? (kind === "socket-option-opened" ? msg.id : null);
    if (kind === "result" && msg.success !== true) { this.#failPending("REJECTED", msg.message ?? "RESULT_SUCCESS_FALSE"); return; }
    if (msg.message) { this.#failPending("REJECTED", msg.message); return; }
    if (orderId === undefined || orderId === null) return;
    this.#ackPending(String(orderId), kind);
  }

  async #ackPending(brokerOrderId, source) {
    const pending = this.pendingOrder;
    if (!pending || pending.ackResolved) return;
    pending.ackResolved = true;
    const record = this.idempotency.get(pending.idempotencyKey);
    if (record) applyBrokerAcknowledgement(record, { orderId: brokerOrderId });
    pending.brokerOrderId = brokerOrderId;
    const ackMs = this.now() - pending.requestedAt;
    this.#recordLatency("orderAck", ackMs);
    this.lastExecution = { executionId: pending.executionId, brokerOrderId, state: "ACKNOWLEDGED", source, direction: pending.direction, stake: pending.stake, ackMs, at: this.now() };
    await this.#persistExecution({ executionId: pending.executionId, brokerOrderId, state: "ACKNOWLEDGED", ackedAt: new Date().toISOString(), error: null });
    this.#safe(() => this.log("IQ_WS_ORDER_ACK", JSON.stringify({ executionId: pending.executionId, brokerOrderId, source, ackMs })));
    this.emit("order-ack", { ...this.lastExecution });
    pending.ackResolve?.({ state: "ACKNOWLEDGED", brokerOrderId, ackMs, source });
    if (pending.autoDisarmAfterAck === true) {
      this.armState.disarm("SMOKE_AUTO_DISARM");
      this.#safe(() => this.log("IQ_WS_SMOKE_AUTO_DISARM", JSON.stringify({ executionId: pending.executionId, brokerOrderId })));
    }
    this.#scheduleSettlementCheck(pending.executionId, pending.brokerOrderId, pending.expirationSec);
  }

  async #failPending(state, reason) {
    const pending = this.pendingOrder;
    if (!pending || pending.ackResolved) return;
    pending.ackResolved = true;
    this.lastExecution = { executionId: pending.executionId, brokerOrderId: null, state, reason: String(reason).slice(0, 160), at: this.now() };
    await this.#persistExecution({ executionId: pending.executionId, state, error: String(reason).slice(0, 160) });
    pending.ackResolve?.({ state, brokerOrderId: null, reason: String(reason).slice(0, 160) });
    if (state === "REJECTED") this.pendingOrder = null;
  }

  #onSettlementEvent(event, kind) {
    if (!this.#isCurrentConnection(event)) return;
    const orderId = kind === "socket-option-closed" ? event.msg?.id : event.msg?.option_id;
    if (orderId === undefined || orderId === null) return;
    void this.#settleOrder(String(orderId), parseSettlement(event.msg));
  }

  async #settleOrder(brokerOrderId, broker) {
    const pending = this.pendingOrder;
    const pendingId = pending?.executionId ?? null;
    if (!pendingId) return;
    if (pending.settling === true) return;
    if (pending.brokerOrderId && String(pending.brokerOrderId) !== String(brokerOrderId)) return;
    if (broker.result === "UNKNOWN") { this.#safe(() => this.log("IQ_WS_SETTLEMENT_UNKNOWN", JSON.stringify({ executionId: pending.executionId, brokerOrderId: String(brokerOrderId) }))); return; }
    pending.settling = true;
    const causal = this.#causalSettlement(pending, pending.expirationSec * 1000);
    const comparison = compareSettlement(broker.result, causal.result);
    const settledAt = new Date().toISOString();
    this.lastExecution = { executionId: pending.executionId, brokerOrderId: String(brokerOrderId), state: "SETTLED", brokerResult: broker.result, causalResult: causal.result, mismatch: comparison.mismatch, profit: broker.profit, at: this.now(), reason: comparison.reason };
    await this.#persistExecution({ executionId: pending.executionId, brokerOrderId: String(brokerOrderId), state: "SETTLED", settledAt, brokerResult: broker.result, causalResult: causal.result, mismatch: comparison.mismatch, profit: broker.profit, meta: { settlementReason: comparison.reason, causal: causal.detail } });
    this.#safe(() => this.log("IQ_WS_ORDER_SETTLED", JSON.stringify({ executionId: pending.executionId, brokerOrderId: String(brokerOrderId), brokerResult: broker.result, causalResult: causal.result, mismatch: comparison.mismatch, profit: broker.profit })));
    if (comparison.mismatch) this.#safe(() => this.log("IQ_WS_SETTLEMENT_MISMATCH", JSON.stringify({ executionId: pending.executionId, broker: broker.result, causal: causal.result })));
    this.emit("settlement", { ...this.lastExecution, comparison });
    this.pendingOrder = null;
  }

  #causalSettlement(pending, expirationMs) {
    const list = this.candleList();
    const entry = pending.entryPrice;
    const settlement = list.filter((candle) => candle.bucketStart <= expirationMs).pop()?.close ?? null;
    if (entry === null || settlement === null) return { result: "UNKNOWN", detail: { entry, settlement, reason: "INSUFFICIENT_CANDLES" } };
    const delta = settlement - entry;
    const result = delta === 0 ? "DRAW" : (pending.direction === "CALL" ? (delta > 0 ? "WIN" : "LOSS") : (delta < 0 ? "WIN" : "LOSS"));
    return { result, detail: { entry, settlement, delta, direction: pending.direction } };
  }

  #scheduleSettlementCheck(executionId, brokerOrderId, expirationSec) {
    const delay = Math.max(5_000, expirationSec * 1000 - this.now() + 3_000);
    const timer = setTimeout(() => { void this.#pollSettlement(executionId, brokerOrderId); }, delay);
    timer.unref?.();
  }

  async #pollSettlement(executionId, brokerOrderId) {
    if (!this.pendingOrder || this.pendingOrder.executionId !== executionId) return;
    if (!this.client || !this.session.connected) return;
    try {
      const { response } = await this.client.getOptions({ limit: 50, instrumentType: "binary,turbo", balanceId: this.account.balanceId });
      const closed = response.msg?.closed_options ?? response.msg?.closedOptions ?? [];
      const match = closed.find((row) => String(row?.id?.[0] ?? row?.id ?? "") === String(brokerOrderId));
      if (match) await this.#settleOrder(String(brokerOrderId), parseSettlement(match));
    } catch (error) { this.#safe(() => this.log("IQ_WS_SETTLEMENT_POLL_FAILED", String(error?.code ?? error?.message ?? error))); }
  }

  /* ----------------------------- persistence ----------------------------- */

  async #ensureDb() {
    if (!this.pool) return false;
    if (this.dbReady !== null) return this.dbReady;
    try {
      const result = await this.pool.query("SELECT to_regclass('public.iq_executions') AS table_name");
      this.dbReady = Boolean(result.rows[0]?.table_name);
    } catch { this.dbReady = false; }
    return this.dbReady;
  }

  async #persistExecution(row) {
    const previous = this.executionsCache.find((item) => item.executionId === row.executionId) ?? {};
    const merged = { ...previous, ...row };
    this.executionsCache = [merged, ...this.executionsCache.filter((item) => item.executionId !== merged.executionId)].slice(0, 50);
    try {
      if (!await this.#ensureDb()) return false;
      const updated = await this.pool.query(
        `UPDATE iq_executions SET idempotency_key=COALESCE($2,idempotency_key), decision_id=COALESCE($3,decision_id), connection_id=COALESCE($4,connection_id), account_type=COALESCE($5,account_type), broker_order_id=COALESCE($6,broker_order_id), symbol=COALESCE($7,symbol), active_id=COALESCE($8,active_id), direction=COALESCE($9,direction), stake=COALESCE($10,stake), currency=COALESCE($11,currency), state=$12, request_id=COALESCE($13,request_id), expiration_at=COALESCE($14,expiration_at), entry_price=COALESCE($15,entry_price), acked_at=COALESCE($16,acked_at), settled_at=COALESCE($17,settled_at), broker_result=COALESCE($18,broker_result), causal_result=COALESCE($19,causal_result), settlement_mismatch=($20 OR settlement_mismatch), profit=COALESCE($21,profit), error=COALESCE($22,error), meta=$23, updated_at=now() WHERE execution_id=$1`,
        [merged.executionId, merged.idempotencyKey ?? null, merged.decisionId ?? null, merged.connectionId ?? null, merged.accountType ?? null, merged.brokerOrderId ?? null, merged.symbol ?? null, merged.activeId ?? null, merged.direction ?? null, merged.stake ?? null, merged.currency ?? null, merged.state, merged.requestId ?? null, merged.expirationAt ?? null, merged.entryPrice ?? null, merged.ackedAt ?? null, merged.settledAt ?? null, merged.brokerResult ?? null, merged.causalResult ?? null, merged.mismatch === true, merged.profit ?? null, merged.error ?? null, JSON.stringify(merged.meta ?? {})],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await this.pool.query(
          `INSERT INTO iq_executions(execution_id,idempotency_key,decision_id,connection_id,account_type,broker_order_id,symbol,active_id,direction,stake,currency,state,request_id,expiration_at,entry_price,acked_at,settled_at,broker_result,causal_result,settlement_mismatch,profit,error,meta,requested_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,now(),now())`,
          [merged.executionId, merged.idempotencyKey ?? null, merged.decisionId ?? null, merged.connectionId ?? null, merged.accountType ?? "PRACTICE", merged.brokerOrderId ?? null, merged.symbol ?? this.symbol, merged.activeId ?? this.active.activeId ?? null, merged.direction ?? null, merged.stake ?? null, merged.currency ?? this.account.currency ?? null, merged.state, merged.requestId ?? null, merged.expirationAt ?? null, merged.entryPrice ?? null, merged.ackedAt ?? null, merged.settledAt ?? null, merged.brokerResult ?? null, merged.causalResult ?? null, merged.mismatch === true, merged.profit ?? null, merged.error ?? null, JSON.stringify(merged.meta ?? {})],
        );
      }
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_WS_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160))); return false; }
  }

  async recentExecutions(limit = 50) {
    const bounded = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
      if (!await this.#ensureDb()) return this.executionsCache.slice(0, bounded);
      const rows = (await this.pool.query("SELECT execution_id AS \"executionId\", idempotency_key AS \"idempotencyKey\", decision_id AS \"decisionId\", account_type AS \"accountType\", broker_order_id AS \"brokerOrderId\", symbol, active_id AS \"activeId\", direction, stake, currency, state, entry_price AS \"entryPrice\", broker_result AS \"brokerResult\", causal_result AS \"causalResult\", settlement_mismatch AS \"settlementMismatch\", profit, error, requested_at AS \"requestedAt\", acked_at AS \"ackedAt\", settled_at AS \"settledAt\", expiration_at AS \"expirationAt\" FROM iq_executions ORDER BY requested_at DESC LIMIT $1", [bounded])).rows;
      this.executionsCache = rows.map((row) => ({ ...row, settlementMismatch: row.settlementMismatch === true }));
      return this.executionsCache;
    } catch (error) { this.#safe(() => this.log("IQ_WS_EXECUTIONS_READ_FAILED", String(error?.message ?? error).slice(0, 120))); return this.executionsCache.slice(0, bounded); }
  }

  /* ----------------------------- status ----------------------------- */

  status() {
    const health = this.marketDataHealth();
    const list = this.candleList();
    const last = this.lastCandle;
    const client = this.client;
    const serverTimeMs = client?.serverNow() ?? this.session.serverTimeMs;
    return {
      runtimeVersion: RUNTIME_VERSION,
      marketData: {
        connected: this.session.connected,
        host: this.session.host,
        hostExpectedFromRepo: "iqoption.com",
        connectionId: this.session.connectionId,
        serverTime: Number.isFinite(serverTimeMs) ? new Date(serverTimeMs).toISOString() : null,
        serverTimeMs: Number.isFinite(serverTimeMs) ? Math.round(serverTimeMs) : null,
        clockSkewMs: this.session.clockSkewMs,
        timeValid: this.session.timeValid,
        symbol: this.symbol,
        activeId: this.active.activeId,
        activeExpectedFromRepo: this.active.expectedFromRepo,
        activeActual2026: this.active.actual2026,
        activeExpectedVsActual: this.active.expectedVsActual,
        activeSection: this.active.section,
        activeOtc: this.active.otc,
        activeCandidates: this.active.candidates,
        candles5s: list.length,
        lastTick: last ? { price: last.close, bucketStart: last.bucketStart, bucketEnd: last.bucketEnd, serverTimestamp: last.serverTimestamp, receivedAt: last.receivedAt, ageMs: this.now() - last.receivedAt, source: last.source, segmentId: last.segmentId } : null,
        latencyMs: {
          serverToReceived: latencySummary(this.latency.serverToReceived),
          receivedToNormalized: latencySummary(this.latency.receivedToNormalized),
          normalizedToFeature: latencySummary(this.latency.normalizedToFeature),
          orderAck: latencySummary(this.latency.orderAck),
          visionP95ReferenceMs: 27_500,
        },
        healthy: health.healthy,
        healthReasons: health.reasons,
        candleDiagnostics: this.candleDiagnostics,
        features: this.lastContext ? {
          builtAt: this.lastContext.builtAt,
          fresh: this.lastContext.fresh.fresh,
          freshnessReason: this.lastContext.fresh.reason,
          rsi14: this.lastContext.context.deterministicIndicators.rsi14.value,
          atr14: this.lastContext.context.deterministicIndicators.atr14.value,
          adx14: this.lastContext.context.deterministicIndicators.adx14.value,
          donchianPosition: this.lastContext.context.deterministicIndicators.donchianPosition.value,
          microstructureStreak: this.lastContext.context.microstructure?.streak ?? null,
        } : null,
      },
      account: {
        verified: this.account.verified,
        type: this.account.type,
        currency: this.account.currency,
        balance: this.account.balance,
        hasReal: this.account.hasReal,
        checkedAt: this.account.checkedAt,
        balanceFailure: this.balanceFailure,
        practiceOnly: true,
        realExecutionForbidden: true,
      },
      execution: {
        ...this.armState.snapshot(),
        killSwitch: this.killSwitch.status(),
        userLimitBrl: this.userLimitBrl,
        pendingOrder: this.pendingOrder ? { executionId: this.pendingOrder.executionId, direction: this.pendingOrder.direction, stake: this.pendingOrder.stake, requestId: this.pendingOrder.requestId, requestedAt: this.pendingOrder.requestedAt, acked: this.pendingOrder.ackResolved === true, brokerOrderId: this.pendingOrder.brokerOrderId ?? null } : null,
        lastExecution: this.lastExecution,
      },
      brokerAutomation: "WS_ONLY_PRACTICE",
    };
  }
}
