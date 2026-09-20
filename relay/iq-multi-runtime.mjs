/**
 * IQ MULTI-MARKET RUNTIME (Fase 4) â€” uma conexao WS, N mercados independentes (ate 10 ativos).
 *
 * Invariantes:
 *  - NORMAL â‰  OTC: `markets` e chaveado por marketKey (EURUSD:NORMAL / EURUSD:OTC); nenhum
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
import { AccountContextController, PRACTICE as ACCOUNT_PRACTICE, REAL as ACCOUNT_REAL, filterByAccountContext } from "./account-context.mjs";
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
import { TRADE_QUALITY_VERSION, ARM_IDS, DEFAULT_MIN_TRADE_QUALITY_SCORE, MIN_TRADE_QUALITY_SCORE_LIMIT, MAX_TRADE_QUALITY_SCORE_LIMIT, evaluateShadowArms, featuresFromSnapshot, performanceHealth, BREAK_EVEN_WR, scoreTradeQuality, entryLocationCheck, finalMicrostructureVeto } from "./trade-quality.mjs";
import { ShadowLab, decisionSourceOf, PROSPECTIVE_CHECKPOINT_N } from "./shadow-lab.mjs";
import { LateWindowTimingShadow, TIMING_POLICY_CURRENT, TIMING_POLICY_LATE, LATE_WINDOW_POLICY, LATE_WINDOW_VERSION, adaptiveLateMarginMs } from "./late-window-timing.mjs";
// SCENARIO ENGINE V3 (SHADOW): observacao independente. NUNCA toca Brain/Trader/Critic/Consensus/Quality Gate/JIT/Execution Gate.
import { ScenarioShadow, analyzeScenarioSnapshot, scenarioShadowStatus as buildScenarioShadowStatus, setScenarioEngineLogSink } from "./scenario-shadow.mjs";
// INTERSECAO OBSERVACIONAL: unico ponto que compara scenario x timing (somente leitura dos dois estados).
import { ScenarioTimingIntersectionShadow } from "./scenario-timing-intersection.mjs";
import { ScenarioShadowSettlement } from "./scenario-shadow-settlement.mjs";
import { UNIVERSE, marketKey, entryForKey, segmentIdFor, MAX_ACTIVE_MARKETS, MAX_OPEN_POSITIONS_PER_MARKET, HARD_CAP_STAKE, DEFAULT_GLOBAL_MAX_STAKE, concentrationExposure } from "./market-universe.mjs";
// DATAHUB + PROFESSIONAL_AGENT_SYSTEM_V4 (SHADOW): observabilidade/benchmark. NUNCA decide nem executa.
import { EventBus } from "./datahub/event-bus.mjs";
import { buildT0Enriched } from "./datahub/t0-enriched.mjs";
import { dataQualityInputFromRuntime, DATA_QUALITY_THRESHOLDS } from "./datahub/data-quality-agent.mjs";
import { AgentsV4Engine } from "./agents-v4/engine.mjs";
import { AgentsV4Persistence } from "./agents-v4/persistence.mjs";
import { AgentsV4Settlement } from "./agents-v4/settlement.mjs";
// DUAL_REASONING_V1_SHADOW: experimento independente (A estrutural x B curto prazo). NUNCA executa.
import { DualReasoningEngine } from "./dual-reasoning.mjs";
// Sidecar EXTERNO de deltas de mercado entre rodadas (observacao unidirecional; nunca alimenta A/B/Sintese).
import { DualRoundMarketDeltaObserver } from "./dual-round-observer.mjs";
// SOLO_REASONING_V1_SHADOW: controle de simplicidade (1 analista, 1 passada). NUNCA executa.
import { SoloReasoningEngine } from "./solo-reasoning.mjs";
// PRACTICE_FOUR_WAY_3X_TEST_V1: harness de execucao experimental (DRY_RUN default; nunca segundo caminho de broker).
import { FourWayExperiment, EXPERIMENT_ID as FOUR_WAY_EXPERIMENT_ID } from "./four-way-experiment.mjs";
// INDICATOR_5M_V1: control group simples (RSI + DMI/ADX + Bollinger) com entrada tardia.
import { Indicator5MEngine, effectiveSafetyMarginMs } from "./indicator-5m.mjs";
// RSI_REVERSAL_CONFLUENCE_V1: experimento separado (RSI extremo + Bollinger + DMI/ADX, janela T-5s).
import { RsiReversalExperiment } from "./rsi-reversal.mjs";
// RSI_STRICT_PULLBACK_2X2_V1: comparativo separado (STRICT vs PULLBACK) sobre 10 OTCs, caps no banco.
import { RsiVariantsRunner } from "./rsi-variants.mjs";
// RSI AGENTS 5x5: 10 agentes da rodada anterior (V1) — PAUSADOS durante a migracao (nenhuma ordem).
import { RsiAgents5x5 } from "./rsi-agents-5x5.mjs";
// RSI AGENTS V2: 50/50 STRICT/PULLBACK da rodada anterior — CONGELADOS (nao executam; decisao V2 apenas em shadow).
import { RsiAgentsV2 } from "./rsi-agents-v2.mjs";
// RSI AGENTS V3: estrategia UNICA RSI_REVERSAL_PULLBACK_V3 em todo o universo elegivel (executa via submitAgentV3Order).
import { RsiAgentsV3 } from "./rsi-agents-v3.mjs";
import { RsiAgentsV4 } from "./rsi-agents-v4.mjs";
import { RsiAgentsV2Live } from "./rsi-agents-v2-live.mjs";
import { IqMcpClient, IQ_MCP_ENDPOINTS } from "./iq-mcp-client.mjs";
import { RsiAgentsV2Blitz } from "./rsi-agents-v2-blitz.mjs";
import { RSI_V3_WATCH_POLICY, shouldEvaluate } from "./rsi-v3-watch.mjs";

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

/** Helpers do registry de instrumentos (MESAS) — nunca expor dados sensiveis. */
const toNum = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const sanitizeInstrumentRow = (row) => (row && typeof row === "object"
  ? Object.fromEntries(Object.entries(row).filter(([key]) => !/ssid|token|bearer|authorization|cookie|password|secret|email|user|balance/i.test(key)).slice(0, 32))
  : null);

export class IqMultiRuntime extends EventEmitter {
  #disconnectedWaiter = null;
  #dbProbeAt = null;

  constructor({ pool = null, getSsid = () => null, armState = new ExecutionArmState(), killSwitch = new KillSwitch(), idempotency = new IdempotencyStore(), hosts = IQ_WS_CANDIDATE_HOSTS, now = () => Date.now(), log = () => {}, maxLatencySamples = 300, ackTimeoutMs = ACK_TIMEOUT_MS, realMode = new RealModeController({ now }), accountContext = new AccountContextController({ now, hardCap: HARD_CAP_STAKE, realTradingEnabled: process.env.REAL_TRADING_ENABLED === "true" }), gate = new PortfolioExecutionGate(), resolver = new RuntimeAssetResolver({ now }), autoExecute = false, decisionOverride = null, scenarioShadowEnabled = true, scenarioTimingIntersectionEnabled = true, agentsV4Enabled = true, dataHubEnabled = true, dualReasoningEnabled = true, soloReasoningEnabled = true, indicator5mEnabled = true, rsiReversalEnabled = true, rsiVariantsEnabled = true, rsiAgentsEnabled = false, rsiAgentsV2Enabled = false, rsiAgentsV3Enabled = true, rsiAgentsV4Enabled = false, rsiAgentsV2LiveEnabled = false, rsiAgentsV2BlitzEnabled = false, executionAllowlist = null, executionPolicyName = null } = {}) {
    super();
    this.pool = pool; this.getSsid = getSsid; this.armState = armState; this.killSwitch = killSwitch; this.idempotency = idempotency;
    this.hosts = hosts; this.now = now; this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxLatencySamples = maxLatencySamples; this.ackTimeoutMs = ackTimeoutMs;
    // Politica de roteamento de execucao: null = permissiva (dev/testes); array = allowlist fail-closed.
    this.executionAllowlist = Array.isArray(executionAllowlist) ? [...executionAllowlist] : null;
    this.executionPolicyName = typeof executionPolicyName === "string" && executionPolicyName ? executionPolicyName : null;
    this.realMode = realMode; this.accountContext = accountContext; this.gate = gate; this.resolver = resolver;
    this.accountContext.onEvent = (event, payload) => this.#emitEvent(`account_context.${event.toLowerCase()}`, payload ?? {});
    this.decisionOverride = typeof decisionOverride === "function" ? decisionOverride : null; // diagnostico/testes deterministicos (nunca usado em producao)
    this.running = false; this.client = null; this.connection = null; this.stopRequested = false;
    this.reconnects = 0; this.connectionStartedAt = null;
    this.session = { connected: false, host: null, connectionId: null, serverTimeMs: null, clockSkewMs: null, timeValid: false, connectedAt: null };
    this.account = { practice: { verified: false, balanceId: null, balance: null, currency: null }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: null, type: "UNKNOWN" };
    this.config = { mode: "PRACTICE", globalMaxStake: HARD_CAP_STAKE, defaultStake: 1, calculatedBankrollStake: 1, hardCap: HARD_CAP_STAKE, maxActiveMarkets: MAX_ACTIVE_MARKETS, autoExecute: autoExecute === true, revision: 0, brainGeneration: BRAIN_GENERATION, jitEnabled: true, entryLeadMs: DEFAULT_ENTRY_LEAD_MS, entryWindowMaxDriftMs: DEFAULT_MAX_DRIFT_MS, qualityGateEnabled: true, minTradeQualityScore: DEFAULT_MIN_TRADE_QUALITY_SCORE, scenarioShadowEnabled: scenarioShadowEnabled === true, scenarioTimingIntersectionEnabled: scenarioTimingIntersectionEnabled === true, agentsV4ShadowEnabled: agentsV4Enabled === true, dualReasoningShadowEnabled: dualReasoningEnabled === true, soloReasoningShadowEnabled: soloReasoningEnabled === true, indicator5mShadowEnabled: indicator5mEnabled === true };
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
    // PROSPECTIVE SHADOW LAB: observacao/contrafactual de pesquisa. NUNCA controla execucao.
    this.shadowLab = new ShadowLab({ pool, now, log: this.log });
    // LATE WINDOW TIMING (Fase 4): LATE_WINDOW_V2 vs CURRENT_V1. SHADOW_ONLY, nunca envia ordem.
    this.timingShadow = new LateWindowTimingShadow({ pool, now, log: this.log });
    // SCENARIO ENGINE V3 (SHADOW): estado proprio, independente do timing (nunca chama metodos do timing).
    this.scenarioShadow = new ScenarioShadow({ pool, now, log: this.log, enabled: scenarioShadowEnabled === true });
    // INTERSECAO OBSERVACIONAL: compara os dois estados como dado (nunca controla nenhum dos lados).
    this.scenarioTimingIntersection = new ScenarioTimingIntersectionShadow({ pool, now, log: this.log, enabled: scenarioTimingIntersectionEnabled === true });
    // LIQUIDACAO CAUSAL OBSERVACIONAL das observacoes prospectivas do cenario (nunca broker, nunca decide).
    this.scenarioSettlement = new ScenarioShadowSettlement({ scenarioShadow: this.scenarioShadow, pool, now, log: this.log });
    setScenarioEngineLogSink((event, payload) => this.#safe(() => this.log(event, payload)));
    // DATAHUB (event bus nao bloqueante) + AGENT SYSTEM V4 (SHADOW). Missing pool => memoria apenas.
    this.dataHub = dataHubEnabled === true ? new EventBus({ now: this.now, log: this.log }) : null;
    if (this.dataHub) this.dataHub.subscribe({ id: "runtime-telemetry", maxQueue: 256, handler: () => {} });
    this.agentsV4Persistence = new AgentsV4Persistence({ pool, now: this.now, log: this.log });
    this.agentsV4 = new AgentsV4Engine({ dataHub: this.dataHub, persistence: this.agentsV4Persistence, now: this.now, log: this.log, enabled: agentsV4Enabled === true });
    this.agentsV4Settlement = new AgentsV4Settlement({
      observationSource: this.agentsV4, persistence: this.agentsV4Persistence, now: this.now, log: this.log,
      onSettled: (observation) => this.#safe(() => this.dataHub?.publish({
        eventType: "SETTLEMENT", marketKey: observation.marketKey, marketType: observation.marketType, activeId: observation.activeId,
        producer: "agents-v4", source: "agents-v4-settlement", provenance: { basis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW", observationId: observation.id },
        accountContext: observation.accountContext, payload: { result: observation.theoreticalResult, basis: "CAUSAL_COUNTERFACTUAL", observationId: observation.id },
      })),
    });
    this.agentsV4.attachSettlement(this.agentsV4Settlement);
    // DUAL_REASONING_V1_SHADOW (experimento independente; sem LLM no deadline; zero ordem).
    this.dual = new DualReasoningEngine({ pool, dataHub: this.dataHub, now: this.now, log: this.log, enabled: dualReasoningEnabled === true });
    this.dualObserver = new DualRoundMarketDeltaObserver({ pool, now: this.now, log: this.log, enabled: dualReasoningEnabled === true });
    this.solo = new SoloReasoningEngine({ pool, now: this.now, log: this.log, enabled: soloReasoningEnabled === true });
    this.fourWay = new FourWayExperiment({ pool, runtime: this, now: this.now, log: this.log, minStakeBrl: 1 });
    this.indicator5m = new Indicator5MEngine({ pool, now: this.now, log: this.log, enabled: indicator5mEnabled === true });
    this.rsiReversal = new RsiReversalExperiment({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiReversalEnabled === true });
    this.rsiVariants = new RsiVariantsRunner({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiVariantsEnabled === true });
    this.rsiAgents = new RsiAgents5x5({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiAgentsEnabled === true });
    // V2: 50/50 dinamico; V1 fica explicitamente pausado (enabled=false) durante a migracao.
    this.rsiAgentsV2 = new RsiAgentsV2({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiAgentsV2Enabled === true });
    // V3: estrategia unica no universo elegivel; V2 permanece congelada apenas como referencia/shadow.
    this.rsiAgentsV3 = new RsiAgentsV3({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiAgentsV3Enabled === true });
    this.rsiAgentsV4 = new RsiAgentsV4({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiAgentsV4Enabled === true, controlsExecution: false });
    this.rsiAgentsV2Live = new RsiAgentsV2Live({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiAgentsV2LiveEnabled === true });
    this.iqMcp = new IqMcpClient({ endpoint: IQ_MCP_ENDPOINTS.blitz, log: this.log, now: this.now });
    this.iqMcpBinary = new IqMcpClient({ endpoint: IQ_MCP_ENDPOINTS.binary, log: this.log, now: this.now });
    this.rsiAgentsV2Blitz = new RsiAgentsV2Blitz({ pool, runtime: this, now: this.now, log: this.log, enabled: rsiAgentsV2BlitzEnabled === true });
    this.agentState = new Map();
    this.audit = []; this.correlationSeq = 0;
    this.agentLatency = [];
    this.events = []; this.eventSeq = 0;
    this.stress = { running: false, report: null };
    this.metrics = { messages: 0, candles: 0, reorder: 0, duplicates: 0, rejected: 0, startedAt: null, cpuBase: process.cpuUsage(), reconnects: 0 };
    this.reconcile = { lastRunAt: null, checked: 0, settled: 0, unknown: 0, error: null };
    this.configLoaded = false;
    this.configHydrated = false;
    this.rsiV4UniverseEmpty = false;
    this.endpointCache = new Map();
    this.persistence = {
      lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0, readOnlyDetectedAt: null,
      auditAttempts: 0, auditFailures: 0, auditLastOkAt: null, auditLastErrorAt: null, auditLastError: null,
      configLastOkAt: null, configLastErrorAt: null, configLastError: null,
      marketLastOkAt: null, marketLastErrorAt: null, marketLastError: null,
      executionLastOkAt: null, executionLastErrorAt: null, executionLastError: null,
    };
    this.availabilityTimer = null;
    this.equityCurveCache = []; this.equityRefreshedAt = 0;
    this.periodPnlCache = { weekly: null, monthly: null, weeklyTrades: null, monthlyTrades: null, context: null, refreshedAt: 0 };
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
      latency: { serverToReceived: [], receivedToNormalized: [], normalizedToFeature: [], orderAck: [], dbPersist: [], decisionToSubmit: [] },
      stats: { messages: 0, candlesProcessed: 0, duplicates: 0, reorder: 0, gaps: 0, rejected: 0, lastBucketStart: null },
      agentState: "OFFLINE", agentSince: null, lastSignal: null, lastDecision: null, lastTrade: null, indicatorHistory: [], tickHistory: [], agentsV4MarketAt: 0, last1mPublished: null,
      dqWindow: { gapAt: [], duplicateAt: [], reorderAt: [] },
    };
  }

  /* ------------------------------- lifecycle ------------------------------- */

  start() {
    if (this.running) return { started: false, reason: "ALREADY_RUNNING" };
    this.running = true; this.stopRequested = false;
    void this.knowledge.rebuild();
    void this.#runLoop();
    // Auto-recuperacao: boot com DB lento nao pode deixar a config default (stake/autoExecute) presa para sempre.
    if (!this.configHydrationRetry) {
      this.configHydrationRetry = setInterval(() => {
        if (!this.running || this.configHydrated || !this.pool) return;
        void this.#loadPersistedConfig().then(() => {
          // Depois de hidratar: se a config persistida nao tem mercados ativos, aplica o default (com persistencia).
          if (this.configHydrated && !this.activeMarketKeys().length) this.#applyDefaultSelection();
        }).catch(() => undefined);
      }, 20_000);
      if (typeof this.configHydrationRetry.unref === "function") this.configHydrationRetry.unref();
    }
    return { started: true, version: RUNTIME_VERSION };
  }

  stop(reason = "STOP_REQUESTED") {
    this.running = false; this.stopRequested = true;
    if (this.configHydrationRetry) { clearInterval(this.configHydrationRetry); this.configHydrationRetry = null; }
    if (this.availabilityTimer) { clearTimeout(this.availabilityTimer); this.availabilityTimer = null; }
    const waiter = this.#disconnectedWaiter; if (waiter) { this.#disconnectedWaiter = null; waiter(); }
    try { this.client?.close(reason); } catch { /* noop */ }
    this.client = null;
    this.session = { ...this.session, connected: false };
    this.realMode.revoke("RUNTIME_STOP");
    this.accountContext.lock("RUNTIME_STOP");
    try { this.armState.disarm("WS_DISCONNECTED"); } catch { /* noop */ }
    for (const ctx of this.markets.values()) { if (ctx.candidate) this.#cancelCandidate(ctx, "CANDIDATE_SESSION_LOST", { reason }); this.#setAgent(ctx, "OFFLINE", "RUNTIME_STOP"); this.timingShadow.finalize({ marketKey: ctx.marketKey, atMs: this.now(), reason: "SESSION_LOST" }); this.#observeScenarioTimingIntersectionsForMarket(ctx.marketKey); }
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
        // FAIL CLOSED: reconnect/token refresh/sessao nova => REAL LOCKED (nunca restaura ARMED).
        this.accountContext.beginSession(ready.connectionId);
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
        // FAIL CLOSED: qualquer queda de WS rebaixa REAL para LOCKED imediatamente.
        this.accountContext.lock("WS_DISCONNECTED");
        for (const ctx of this.markets.values()) { if (ctx.candidate) this.#cancelCandidate(ctx, "CANDIDATE_SESSION_LOST", { reason: "WS_DISCONNECTED" }); this.timingShadow.finalize({ marketKey: ctx.marketKey, atMs: this.now(), reason: "WS_DISCONNECTED" }); this.#observeScenarioTimingIntersectionsForMarket(ctx.marketKey); if (ctx.enabled) this.#setAgent(ctx, ctx.availability === "OPEN" ? "WAIT" : "UNAVAILABLE", "WS_DISCONNECTED"); }
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
    await this.#refreshBrokerAvailability(client, "BOOTSTRAP");
    try { const { response } = await client.getBalances(); this.#applyBalances(response.msg); } catch (error) { this.#safe(() => this.log("IQ_MULTI_BALANCES_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 120))); }
    try {
      const { response } = await client.getOptions({ limit: 30, instrumentType: "binary,turbo", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId });
      this.resolver.ingestAuxiliary(response.msg);
      this.#applyResolver({ reason: "BOOTSTRAP_OPTIONS" });
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_OPTIONS_BOOTSTRAP_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 80))); }
    this.#startAvailabilityLoop();
    try {
      for (const instrument of ["binary-option", "turbo-option"]) client.send("subscribeMessage", { name: "commission-changed", params: { routingFilters: { instrument_type: instrument } }, version: "1.0" });
      this.#safe(() => this.log("IQ_MULTI_PAYOUT_SUBSCRIBED", "binary-option,turbo-option"));
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_PAYOUT_SUBSCRIBE_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 80))); }
    if (!this.activeMarketKeys().length && this.configHydrated === true) this.#applyDefaultSelection();
    for (const ctx of this.markets.values()) this.#subscribeCtx(client, ctx);
    // Fontes externas reais ainda nao integradas: registra NO_FEED honesto (nunca inventa noticia/macro).
    this.intelligence.publish("MACRO", { note: "sem integracao externa de macro conectada" }, { source: "none", sourceType: "EXTERNAL", dataQuality: "UNAVAILABLE", status: "NO_FEED" });
    this.intelligence.publish("NEWS", { note: "sem integracao externa de noticias conectada" }, { source: "none", sourceType: "EXTERNAL", dataQuality: "UNAVAILABLE", status: "NO_FEED" });
    if (process.env.EXTERNAL_FEED_SYNC !== "false") this.feeds.start();
    await this.#loadDailyStats();
    void this.reconcileOrphans();
    void this.refreshEquityCurve();
    void this.refreshPeriodPnl();
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
    this.#syncAccountContext();
    this.#emitEvent("account.balances", { practice: this.account.practice.verified, real: this.account.real.available, currency: this.account.practice.currency, type: this.account.type });
  }

  #onBalances(event) { const list = Array.isArray(event.msg) ? event.msg : Array.isArray(event.msg?.balances) ? event.msg.balances : []; this.#applyBalances(list); }
  #onBalanceChanged(event) {
    const current = event.msg?.current_balance;
    if (!current) return;
    if (Number(current.id) === Number(this.account.practice.balanceId)) this.account.practice.balance = Number.isFinite(Number(current.amount)) ? Number(current.amount) : this.account.practice.balance;
    if (Number(current.id) === Number(this.account.real.balanceId)) this.account.real.balance = Number.isFinite(Number(current.amount)) ? Number(current.amount) : this.account.real.balance;
    this.#syncAccountContext();
  }

  /* ------------------------------- resolver/markets ------------------------------- */

  /**
   * Disponibilidade operacional SEMPRE do broker em tempo real (nunca de horario teorico nem de cache):
   * get-initialization-data traz `is_suspended` por ativo; get-options complementa payout. NORMAL e OTC
   * continuam 100% separados (o resolver nao faz fallback entre eles).
   */
  async #refreshBrokerAvailability(client = this.client, reason = "PERIODIC") {
    if (!client || !this.session.connected) return false;
    try {
      const { response } = await client.getInitializationData();
      this.resolver.ingestInitializationData(response.msg);
      this.#applyResolver({ reason });
      const { response: options } = await client.getOptions({ limit: 30, instrumentType: "binary,turbo", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId });
      this.resolver.ingestAuxiliary(options.msg);
      this.#applyResolver({ reason: `${reason}_OPTIONS` });
      return true;
    } catch (error) {
      this.#safe(() => this.log("IQ_MULTI_AVAILABILITY_REFRESH_FAILED", String(error?.code ?? error?.message ?? error).slice(0, 120)));
      return false;
    }
  }

  /** Loop de disponibilidade: 60s normal; 20s enquanto algum mercado habilitado nao estiver OPEN (suspensao/manutencao). */
  #startAvailabilityLoop() {
    if (this.availabilityTimer) return;
    const tick = async () => {
      if (this.stopRequested) return;
      const enabled = [...this.markets.values()].filter((ctx) => ctx.enabled);
      const needsFast = enabled.some((ctx) => ctx.availability !== "OPEN");
      const interval = needsFast ? 20_000 : 60_000;
      const ok = await this.#refreshBrokerAvailability(this.client, needsFast ? "SUSPENDED_FAST" : "PERIODIC");
      if (ok && needsFast) this.#emitEvent("markets.availability_refreshed", { open: this.marketsOpenCount() });
      this.availabilityTimer = setTimeout(tick, interval);
      this.availabilityTimer.unref?.();
    };
    this.availabilityTimer = setTimeout(tick, 30_000);
    this.availabilityTimer.unref?.();
  }
  #applyResolver({ reason }) {
    let changed = 0;
    for (const ctx of this.markets.values()) {
      const resolved = this.resolver.get(ctx.marketKey);
      if (!resolved) continue;
      const previous = ctx.availability;
      ctx.activeId = resolved.activeId; ctx.instrumentTypes = resolved.instrumentTypes; ctx.availability = resolved.availability;
      ctx.payout = resolved.payout; ctx.payoutSource = resolved.payoutSource; ctx.resolvedAt = resolved.resolvedAt;
      if (ctx.probeOverride && ctx.probeOverride.until > this.now()) ctx.availability = ctx.probeOverride.availability;
      ctx.connectionHealth = { ...ctx.connectionHealth, connected: this.session.connected };
      // Fase 6.5: transicoes de disponibilidade acordam/dormem o agente SEM restart (fonte de verdade = broker).
      if (ctx.enabled && previous !== "OPEN" && resolved.availability === "OPEN") {
        const serverNow = this.client?.serverNow?.() ?? this.now();
        const feedFresh = ctx.lastTickAt !== null && this.now() - ctx.lastTickAt <= MARKET_TICK_AGE_MS;
        const validation = {
          brokerOpen: resolved.enabledLive === true && resolved.suspended === false, resolverOpen: resolved.availability === "OPEN",
          agentAwake: true, feedFresh, armed: this.armState.armed === true, serverNow,
          evidence: { activeId: resolved.activeId, product: resolved.product ?? null, instrumentTypes: resolved.instrumentTypes ?? [], offered: resolved.offered ?? null, candidates: resolved.candidates ?? [], payout: resolved.payout ?? null },
          reason: `${previous}->OPEN`,
        };
        this.#setAgent(ctx, "WAIT", "MARKET_REOPENED_BY_BROKER");
        this.#emitEvent("market.reopened", { marketKey: ctx.marketKey, activeId: ctx.activeId, reason, serverNow, validation });
        this.#auditRecord(`reopen_${ctx.marketKey}_${this.now()}`, ctx.marketKey, "MARKET_REOPENED", validation, { persist: true });
        this.#auditRecord(`reopen_check_${ctx.marketKey}_${this.now()}`, ctx.marketKey, "REOPEN_VALIDATION", validation, { persist: true });
        this.#safe(() => this.log("IQ_MULTI_MARKET_REOPENED", JSON.stringify({ marketKey: ctx.marketKey, activeId: ctx.activeId, reason, feedFresh, armed: validation.armed })));
      } else if (ctx.enabled && resolved.availability !== "OPEN" && (previous !== resolved.availability || ctx.agentState === "OFFLINE") && !this.openPositions.has(ctx.marketKey)) {
        this.#setAgent(ctx, "UNAVAILABLE", `MARKET_${resolved.availability}`);
        this.#emitEvent("market.unavailable", { marketKey: ctx.marketKey, availability: resolved.availability, reason });
      }
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

  setMarket(key, patch = {}, { persist = true, actor = "system", requestId = null } = {}) {
    const ctx = this.markets.get(key);
      if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    const previous = { enabled: ctx.enabled, paused: ctx.paused, configuredStake: ctx.configuredStake, maxStake: ctx.maxStake };
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
    this.#auditRecord(`market_${key}_${this.now()}`, key, "MARKET_CONFIG", { oldValue: previous, newValue: { enabled: ctx.enabled, paused: ctx.paused, configuredStake: ctx.configuredStake, maxStake: ctx.maxStake }, patch: next, actor, requestId }, { persist: true });
    return this.#publicMarket(ctx);
  }

  /** Valor por operacao (configuredStake). APPLY TO ALL sobrescreve os valores individuais dos mercados alvo. */
  applyGlobalMaxStake(value, keys = null, meta = null) {
    const limit = Number(value);
    const previousStake = Number(this.config.defaultStake) || null;
    if (!Number.isFinite(limit) || limit <= 0 || limit > this.config.hardCap) throw new IqWsError("INVALID_GLOBAL_STAKE", String(value));
    this.config.defaultStake = limit;
    this.config.globalMaxStake = Math.max(Number(this.config.globalMaxStake) || 0, limit);
    this.config.revision = Number(this.config.revision || 0) + 1;
    const targets = Array.isArray(keys) && keys.length ? keys : [...this.markets.keys()];
    let applied = 0;
    for (const key of targets) {
      const ctx = this.markets.get(key);
      if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
      if (!ctx) continue;
      ctx.configuredStake = limit;
      if (Number(ctx.maxStake) < limit) ctx.maxStake = Math.min(this.config.hardCap, limit);
      ctx.revision = Number(ctx.revision || 0) + 1;
      applied += 1;
      void this.#persistMarket(ctx);
    }
    void this.#persistConfig();
    this.#emitEvent("config.global_stake", { defaultStake: limit, globalMaxStake: this.config.globalMaxStake, appliedTo: applied });
    this.#auditRecord(`stake_${this.now()}`, null, "STAKE_CHANGE", { oldValue: previousStake, newValue: limit, appliedTo: applied, keys: Array.isArray(keys) ? keys.slice(0, 54) : null, actor: meta?.actor ?? "system", requestId: meta?.requestId ?? null }, { persist: true });
    return { defaultStake: limit, globalMaxStake: this.config.globalMaxStake, appliedTo: applied };
  }

  setAutoExecute(enabled, meta = null) { const previous = this.config.autoExecute === true; this.config.autoExecute = enabled === true; void this.#persistConfig(); this.#auditRecord(`auto_${this.now()}`, null, this.config.autoExecute ? "AUTO_ON" : "AUTO_OFF", { oldValue: previous, newValue: this.config.autoExecute, actor: meta?.actor ?? "system", requestId: meta?.requestId ?? null }, { persist: true }); return { autoExecute: this.config.autoExecute }; }

  setMode(mode, meta = null) {
    const previousMode = this.config.mode;
    const next = mode === "REAL" ? "REAL" : "PRACTICE";
    if (next === this.config.mode) return this.modeState();
    if (next === "REAL" && process.env.REAL_TRADING_ENABLED === "true" !== true) throw new IqWsError("REAL_MODE_REQUIRES_ENV");
    try { this.armState.disarm("MODE_SWITCH"); } catch { /* noop */ }
    if (next === "PRACTICE") this.realMode.revoke("MODE_SWITCH_TO_PRACTICE");
    // Fase 6: sem Strategy Manager; Performance Supervisor nao altera metodologia em REAL.
    this.config.mode = next;
    void this.#persistConfig();
    this.#emitEvent("mode.changed", { mode: next, armed: false });
    this.#auditRecord(`mode_${this.now()}`, null, "ACCOUNT_MODE_CHANGE", { oldValue: previousMode, newValue: next, armed: false, actor: meta?.actor ?? "system", requestId: meta?.requestId ?? null }, { persist: true });
    return this.modeState();
  }

  modeState() {
    return {
      mode: this.config.mode, practice: { verified: this.account.practice.verified, balance: this.account.practice.balance, currency: this.account.practice.currency }, real: { available: this.account.real.available, balance: this.account.real.balance, currency: this.account.real.currency }, realMode: this.realMode.status(),
    };
  }

  /* --------------------- ACCOUNT CONTEXT (PRACTICE x REAL) --------------------- */

  /** Snapshot read-only da conta real. Nunca inventa saldo: indisponivel => available:false. */
  #realAccountSnapshot() {
    const rawBalance = this.account.real.balance;
    const balance = rawBalance === null || rawBalance === undefined || rawBalance === "" ? null : Number(rawBalance);
    return {
      available: this.account.real.available === true,
      balance: Number.isFinite(balance) ? balance : null,
      currency: this.account.real.currency ?? null,
      balanceId: this.account.real.balanceId ?? null,
      checkedAt: this.account.checkedAt ?? null,
      readOnly: true,
      error: this.account.real.available === true ? null : "REAL_ACCOUNT_UNAVAILABLE",
    };
  }

  /** Sincroniza o controller com os saldos broker: ambiguidade/indisponibilidade => LOCKED. */
  #syncAccountContext() {
    const real = this.#realAccountSnapshot();
    const ambiguous = real.balanceId === null || real.balanceId === undefined || (real.available && !(Number(real.balance) > 0));
    this.accountContext.reportRealAccount(ambiguous ? { available: false, error: "REAL_ACCOUNT_AMBIGUOUS" } : real);
    return this.accountContext.status();
  }

  #dataQuality() {
    const health = this.connectionHealth();
    return health.healthy && this.session.timeValid === true ? "HEALTHY" : "DEGRADED";
  }

  /** Avaliacao do gate REAL com estado real do runtime (nunca envia ordem). */
  #realGateInput(overrides = {}) {
    const real = this.#realAccountSnapshot();
    const openReal = [...this.openPositions.values()].filter((position) => position.accountContext === ACCOUNT_REAL);
    const realExposure = Number(openReal.reduce((sum, position) => sum + (Number(position.stake) || 0), 0).toFixed(4));
    const riskGate = openReal.length <= this.accountContext.maxPositions && realExposure <= this.accountContext.maxExposure ? "PASS" : "BLOCK";
    const openMarkets = [...this.markets.values()].filter((ctx) => ctx.enabled === true && ctx.availability === "OPEN" && ctx.activeId !== null);
    return {
      accountContext: this.accountContext.context,
      armed: this.accountContext.armed === true,
      killSwitch: this.killSwitch.status(),
      riskGate: overrides.riskGate ?? riskGate,
      dataQuality: overrides.dataQuality ?? this.#dataQuality(),
      strategy: overrides.strategy ?? `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`,
      stake: overrides.stake ?? Math.min(this.config.globalMaxStake, this.config.hardCap),
      hardCap: this.config.hardCap,
      marketAllowed: overrides.marketAllowed ?? (overrides.marketKey ? Boolean(this.markets.get(overrides.marketKey)?.enabled && this.markets.get(overrides.marketKey)?.availability === "OPEN") : openMarkets.length > 0),
      idempotencyValid: overrides.idempotencyValid ?? true,
      accountAccessible: overrides.accountAccessible ?? real.available,
      accountUnambiguous: overrides.accountUnambiguous ?? (real.balanceId !== null && real.balanceId !== undefined),
      ...(overrides.overrides ?? {}),
    };
  }

  /** Estado completo do contexto + contas isoladas (sem segredos, sem saldo simulado). */
  accountContextState() {
    const real = this.#realAccountSnapshot();
    return {
      ...this.accountContext.status(),
      realAccount: {
        available: real.available,
        balance: real.balance,
        currency: real.currency,
        balanceIdMasked: real.balanceId === null || real.balanceId === undefined ? null : `***${String(real.balanceId).slice(-4)}`,
        checkedAt: real.checkedAt,
        readOnly: true,
        error: real.error,
      },
      practiceAccount: {
        verified: this.account.practice.verified === true,
        balance: this.account.practice.balance ?? null,
        currency: this.account.practice.currency ?? null,
        balanceIdMasked: this.account.practice.balanceId === null || this.account.practice.balanceId === undefined ? null : `***${String(this.account.practice.balanceId).slice(-4)}`,
        readOnly: true,
      },
      hasReal: this.account.hasReal === true,
      checkedAt: this.account.checkedAt ?? null,
      sessionId: this.session.connectionId ?? this.accountContext.sessionId,
      brokerAutomation: "NONE",
      practiceOnly: this.accountContext.context === ACCOUNT_PRACTICE,
      realExecutionForbidden: this.accountContext.isRealArmed() !== true,
    };
  }

  /** Seleciona o contexto de conta: separa TODA a visao PRACTICE x REAL. */
  selectAccount(context) {
    const selected = this.accountContext.select(context);
    if (selected.context === ACCOUNT_PRACTICE) {
      try { this.armState.disarm("MODE_SWITCH"); } catch { /* noop */ }
      this.realMode.revoke("CONTEXT_SWITCH_TO_PRACTICE");
    }
    const real = this.#realAccountSnapshot();
    if (selected.context === ACCOUNT_REAL) {
      if (real.available) this.accountContext.reportRealAccount(real);
      else this.accountContext.reportRealAccount({ available: false, error: real.error ?? "REAL_ACCOUNT_UNAVAILABLE" });
    }
    const state = this.accountContextState();
    this.#emitEvent("account.context_changed", { context: state.context, state: state.state, lockedReason: state.lockedReason });
    this.#auditRecord(`acct_${state.context}_${this.now()}`, null, "ACCOUNT_CONTEXT_SELECTED", { accountContext: state.context, state: state.state, lockedReason: state.lockedReason, realAccessible: real.available }, { persist: true, accountContext: state.context });
    return state;
  }

  /** Preflight REAL (somente leitura): lista checks PASS/BLOCK sem nenhuma ordem. */
  realPreflight(overrides = {}) {
    const input = this.#realGateInput(overrides);
    const result = this.accountContext.preflight(input, { audit: false });
    return { ...result, input: { ...input, killSwitch: input.killSwitch }, accountContext: this.accountContext.context };
  }

  /**
   * Arma REAL para a sessao. Exige preflight completo + confirmacao explicita.
   * NUNCA persiste ARMED; restart/reconnect devolvem LOCKED.
   */
  armReal({ phrase = null, acknowledgeRisk = false, maxStake = null, strategy = null, actor = "ui" } = {}) {
    const real = this.#realAccountSnapshot();
    if (!real.available || real.balanceId === null || real.balanceId === undefined) throw new IqWsError("REAL_ACCOUNT_UNAVAILABLE");
    this.accountContext.reportRealAccount(real);
    const resolvedStrategy = strategy ?? `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`;
    const limit = Number(maxStake ?? Math.min(this.config.globalMaxStake, this.config.hardCap));
    const input = this.#realGateInput({ strategy: resolvedStrategy, stake: limit, accountAccessible: true, accountUnambiguous: true });
    const status = this.accountContext.arm({
      confirmationPhrase: phrase, acknowledge: acknowledgeRisk === true,
      realBalance: real.balance, realBalanceId: real.balanceId, maxStake: limit,
      strategy: resolvedStrategy, autoStatus: this.config.autoExecute === true, preflightInput: input, actor,
    });
    this.#emitEvent("real.armed", { strategy: resolvedStrategy, maxStake: limit, autoStatus: this.config.autoExecute === true });
    this.accountContext.recordRealAttempt("ARM", { strategy: resolvedStrategy, stake: limit, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, send: false, autoStatus: this.config.autoExecute === true });
    this.#auditRecord(`real_arm_${this.now()}`, null, "REAL_ARMED", { accountContext: ACCOUNT_REAL, strategy: resolvedStrategy, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, stake: limit, maxExposure: status.maxExposure, maxPositions: status.maxPositions, autoStatus: this.config.autoExecute === true, realBalanceSeen: real.balance }, { persist: true, accountContext: ACCOUNT_REAL });
    return this.accountContextState();
  }

  disarmReal(reason = "MANUAL_UI") {
    const status = this.accountContext.disarm(reason);
    this.#emitEvent("real.disarmed", { reason: String(reason).slice(0, 60) });
    this.#auditRecord(`real_disarm_${this.now()}`, null, "REAL_DISARMED", { accountContext: ACCOUNT_REAL, reason: String(reason).slice(0, 60) }, { persist: true, accountContext: ACCOUNT_REAL });
    return { ...status, realExecutionForbidden: true };
  }

  setKillSwitch(engaged, reason = "UI", meta = null) {
    const previous = this.killSwitch.status().executionEnabled === true;
    if (engaged === true) { this.killSwitch.engage(); try { this.armState.disarm("KILL_SWITCH"); } catch { /* noop */ } this.realMode.revoke("KILL_SWITCH"); }
    else this.killSwitch.release();
    this.#emitEvent("kill_switch", { executionEnabled: this.killSwitch.status().executionEnabled, reason });
    this.#auditRecord(`kill_switch_${this.now()}`, null, "KILL_SWITCH", { oldValue: previous, newValue: this.killSwitch.status().executionEnabled === true, reason: String(reason).slice(0, 60), actor: meta?.actor ?? "system", requestId: meta?.requestId ?? null }, { persist: true });
    return { killSwitch: this.killSwitch.status(), armState: this.armState.snapshot() };
  }

  arm(limitBrl, { confirmation = false, actor = "ui", requestId = null } = {}) {
    if (!this.account.practice.verified) throw new IqWsError("PRACTICE_ACCOUNT_NOT_VERIFIED");
    if (this.config.mode === "REAL" && process.env.REAL_TRADING_ENABLED === "true" !== true) throw new IqWsError("REAL_MODE_REQUIRES_ENV");
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("KILL_SWITCH_ACTIVE");
    const health = this.connectionHealth();
    if (!health.healthy) throw new IqWsError("CONNECTION_UNHEALTHY", health.reasons.join(","));
    const enabled = [...this.markets.values()].filter((ctx) => ctx.enabled);
    if (!enabled.length) throw new IqWsError("NO_ACTIVE_MARKET", "nenhum mercado habilitado pelo operador");
    // Fase 6.5: ARM nao depende de mercado OPEN agora (o broker pode estar em manutencao).
    // A execucao continua bloqueada pelo PortfolioExecutionGate ate existir mercado realmente OPEN.
    if (!this.armState.connectedAccountType) this.armState.onConnected("PRACTICE");
    this.armState.onMarketData(true);
    const limit = Number(limitBrl);
    const arm = this.armState.arm(limit, { explicitConfirmation: confirmation === true });
    this.userLimitBrl = Math.min(limit, this.config.hardCap);
    const openMarkets = enabled.filter((ctx) => ctx.availability === "OPEN");
    const warning = openMarkets.length ? null : "NO_OPEN_MARKET_NOW";
    this.#emitEvent("execution.armed", { limitBrl: this.userLimitBrl, mode: this.config.mode, actor, warning, openMarkets: openMarkets.length });
    this.#auditRecord(`arm_${this.now()}`, null, "ARM", { oldValue: false, newValue: arm.armed === true, limitBrl: this.userLimitBrl, mode: this.config.mode, openMarkets: openMarkets.length, warning, actor, requestId }, { persist: true });
    return { ...arm, userLimitBrl: this.userLimitBrl, mode: this.config.mode, currency: this.account.practice.currency, fxMode: this.account.practice.currency === "BRL" ? "BRL_NATIVE" : "NOMINAL_BROKER_CURRENCY_CAP", warning, openMarkets: openMarkets.length, marketsEnabled: enabled.length, markets: enabled.map((ctx) => ({ marketKey: ctx.marketKey, availability: ctx.availability })) };
  }

  disarm(reason = "MANUAL", meta = null) { const previous = this.armState.snapshot().armed === true; const result = this.armState.disarm(reason); this.#emitEvent("execution.disarmed", { reason }); this.#auditRecord(`disarm_${this.now()}`, null, "DISARM", { oldValue: previous, newValue: result.armed === true, reason: String(reason).slice(0, 60), actor: meta?.actor ?? "system", requestId: meta?.requestId ?? null }, { persist: true }); return result; }

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
      this.#ingestCandle(ctx, raw, { receivedAt, serverTimestamp, connectionId: event.connectionId, batch: allSizes });
    }
  }

  #ingestCandle(ctx, raw, { receivedAt, serverTimestamp, connectionId, batch = false }) {
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
      if (ctx.stats.lastBucketStart !== null && candle.bucketStart < ctx.stats.lastBucketStart) { ctx.stats.reorder += 1; ctx.dqWindow?.reorderAt?.push(receivedAt); }
      else if (ctx.stats.lastBucketStart !== null && candle.bucketStart > ctx.stats.lastBucketStart + CANDLE_SIZE_SECONDS * 1000) { ctx.stats.gaps += 1; ctx.dqWindow?.gapAt?.push(receivedAt); }
      ctx.stats.candlesProcessed += 1; this.metrics.candles += 1;
    } else {
      ctx.stats.duplicates += 1;
      // Para o DQ, so conta anomalia real: reentrega de bucket JA FECHADO fora de mensagem em lote
      // (candles-generated reenvia historico por protocolo; isso e esperado e nao degrada os dados).
      if (!batch && candle.bucketEnd <= receivedAt) ctx.dqWindow?.duplicateAt?.push(receivedAt);
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
    // DATAHUB: tick ring real (candle updates do feed) + eventos CANDLE_5S/MARKET_TICK. Nunca bloqueia.
    ctx.tickHistory.push({ price: candle.close, at: candle.receivedAt, receivedAt: candle.receivedAt, bucketStart: candle.bucketStart, source: candle.source });
    if (ctx.tickHistory.length > 240) ctx.tickHistory.splice(0, ctx.tickHistory.length - 240);
    if (this.dataHub) {
      const accountContext = this.accountContext.context;
      this.#safe(() => this.dataHub.publish({
        eventType: "CANDLE_5S", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: candle.serverTimestamp, receivedAt: candle.receivedAt, availableAt: candle.receivedAt,
        producer: "iq-multi-runtime", source: "IQ_OPTION_WS", accountContext,
        provenance: { segmentId: candle.segmentId, candleSource: candle.source, connectionId: connectionId ?? null },
        payload: { bucketStart: candle.bucketStart, open: candle.open, high: candle.high, low: candle.low, close: candle.close },
      }));
      const lastTickEmitAt = this.lastTickEmit.get(ctx.marketKey) ?? 0;
      if (this.now() - lastTickEmitAt >= 1_000) {
        this.#safe(() => this.dataHub.publish({
          eventType: "MARKET_TICK", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
          serverTime: candle.serverTimestamp, receivedAt: candle.receivedAt, availableAt: candle.receivedAt,
          producer: "iq-multi-runtime", source: "IQ_OPTION_WS", accountContext,
          payload: { price: candle.close, ageMs: this.now() - candle.receivedAt },
        }));
      }
    }
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
      // SHADOW LAB: settle causal (mesma regra do #causalSettlement) das oportunidades NAO executadas.
      void this.shadowLab.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // LATE WINDOW TIMING (SHADOW): liquidacao causal do braco LATE_WINDOW_V2 (nunca broker).
      this.timingShadow.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // SCENARIO SHADOW (PROSPECTIVE): liquidacao causal observacional no expiry (nunca broker, nunca decide).
      void this.scenarioSettlement.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // AGENTS V4 (SHADOW): liquidacao causal das observacoes V4 pendentes (nunca broker).
      this.agentsV4Settlement.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // DUAL_REASONING (SHADOW): liquidacao causal PROSPECTIVE_SHADOW (nunca broker).
      this.dual.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // SOLO_REASONING (SHADOW): liquidacao causal do final e do contrafactual da tese inicial.
      this.solo.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // RSI_REVERSAL (PRACTICE experiment): liquidacao causal observacional.
      this.rsiReversal.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // INDICATOR_5M_V1: liquidacao causal (PROSPECTIVE_SHADOW; nunca broker).
      this.indicator5m.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // RSI_REVERSAL (experimento PRACTICE): avaliacao por mercado (isolada) + liquidacao causal.
      this.#safe(() => this.#observeRsiReversal(ctx, list, now));
      this.rsiReversal.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // RSI VARIANTS 2x2 (STRICT x PULLBACK; 10 OTCs dinamicos): avaliacao + liquidacao causal.
      this.#safe(() => this.#observeRsiVariants(ctx, list, now));
      this.rsiVariants.settleCausal({ marketKey: ctx.marketKey, candles: list, index: list.length - 1, nowMs: now });
      // RSI AGENTS 5x5 (agentes normais): avaliacao por mercado atribuido.
      this.#safe(() => this.#observeRsiAgents(ctx, list, now));
      // RSI AGENTS V4 (MESAS-driven; UNICO executavel da rodada V4 quando habilitado).
      this.#safe(() => this.#observeRsiAgentsV4(ctx, list, now));
      // RSI AGENTS V2 LIVE (Strategy Core = V2 ORIGINAL; CONTROLADOR de execucao da rodada).
      this.#safe(() => this.#observeRsiAgentsV2Live(ctx, list, now));
      // RSI AGENTS V2 BLITZ (API oficial MCP; 45s; fast lane = ativos com feed WS).
      this.#safe(() => this.#observeRsiAgentsV2Blitz(ctx, list, now));
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

  /** Features causais para o brain (momentum normalizado, r24, vol12) â€” derivadas do Feature Engine, sem variantes antigas. */
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
      structureFeatures = computeStructureFeatures(list, list.length - 1, { atr: ctx.featureState?.context?.deterministicIndicators?.atr14?.value ?? null });
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
    // Trajetorias (Fase 6.3): ring buffer por mercado para slopes de RSI/ADX/DI/ATR/Donchian (somente observabilidade).
    ctx.indicatorHistory.push({ at: now, rsi: trader?.momentum?.rsi14 ?? null, adx: trader?.strength?.adx14 ?? null, diSpread: trader?.strength?.diSpread ?? null, atrRatio: trader?.volatility?.atrRatio ?? null, donchianPosition: trader?.location?.donchianPosition ?? null });
    if (ctx.indicatorHistory.length > 60) ctx.indicatorHistory.splice(0, ctx.indicatorHistory.length - 60);
    this.agentLatency.push(trader.latencyMs + critic.latencyMs + consensus.latencyMs);
    if (this.agentLatency.length > this.maxLatencySamples) this.agentLatency.splice(0, this.agentLatency.length - this.maxLatencySamples);
    this.#emitEvent("agent.trader", { marketKey: ctx.marketKey, correlationId, action: trader.action, confidence: trader.analysisConfidence, regime, setup: trader.setup, brainGeneration: BRAIN_GENERATION, ...this.#executionMeta({ source: "AUTO_DECISION", agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` }) });
    this.#emitEvent("agent.critic", { marketKey: ctx.marketKey, correlationId, independentAction: critic.independentAction, verdict: critic.traderAssessment, riskFlags: critic.riskFlags.length, ...this.#executionMeta({ source: "AUTO_DECISION", agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` }) });
    this.#emitEvent("agent.consensus", { marketKey: ctx.marketKey, correlationId, action: consensus.action, status: consensus.status, reason: consensus.reason, ...this.#executionMeta({ source: "AUTO_DECISION", agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` }) });
    this.#auditRecord(correlationId, ctx.marketKey, "AGENTS", { brainGeneration: BRAIN_GENERATION, brainVersion: BRAIN_VERSION, trader: trader.action, setup: trader.setup, criticVerdict: critic.traderAssessment, criticIndependent: critic.independentAction, consensus: consensus.action, consensusStatus: consensus.status, regime, knowledgeIds: knowledgeContext.knowledgeIds, knowledgeUsed: knowledgeContext.used }, { persist: consensus.action === "BUY" || consensus.action === "SELL" });
    // Research shadow por SETUP + A/B v2 (mesmo snapshot causal).
    this.research.observeCandle({ marketKey: ctx.marketKey, marketType: ctx.marketType, candles: list, index: list.length - 1, brain: { setup: trader.setup, action: consensus.action, regime, trigger: trader.trigger }, payout: ctx.payout, atMs: now });
    this.ab.settle({ marketKey: ctx.marketKey, candles: list, index: list.length - 1 });
    this.ab.record({ marketKey: ctx.marketKey, marketType: ctx.marketType, atMs: now, setup: trader.setup, entryPrice: ctx.lastCandle?.close ?? null, settlementAfterMs: (ctx.lastCandle?.bucketStart ?? now) + BRAIN_HORIZON_SECONDS * 1000, payout: ctx.payout, actions: { A_TRADER: trader.action, B_TRADER_CRITIC: consensus.action, C_PLUS_INTELLIGENCE: consensus.action === "WAIT" || intelligenceContext?.news?.importance < 0.9 ? consensus.action : "WAIT", D_APPRENTICE: trader.action } });
    const action = consensus.action;
    const reason = consensus.status === "CONFIRMED" ? "CONSENSUS_CONFIRMED" : consensus.reason;
    const confidence = consensus.analysisConfidence;
    // AGENTS V4 (SHADOW): estado de mercado continuo por ativo (throttle 15s). Fail-safe: nunca sobe para o hot path.
    this.#safe(() => this.#observeAgentsV4MarketState(ctx, list, now));
    ctx.decisionState = {
      action, reason, confidence, setup: trader.setup, regime, horizonSeconds: BRAIN_HORIZON_SECONDS, evaluatedAt: now, featuresAvailable: Boolean(structureFeatures),
      trigger: trader.trigger, waitReason: trader.waitReason,
      consensus: { status: consensus.status, reason: consensus.reason, traderAction: trader.action, criticIndependent: critic.independentAction, criticVerdict: critic.traderAssessment },
      processLog: trader.processLog, knowledge: { used: knowledgeContext.used, ids: knowledgeContext.knowledgeIds, version: knowledgeContext.knowledgeVersion, latencyMs: knowledgeContext.retrievalLatencyMs },
      brainGeneration: BRAIN_GENERATION,
    };
    ctx.lastDecision = ctx.decisionState;
    this.journal.recordDecision({ agentId: this.#agentId(ctx), marketKey: ctx.marketKey, marketType: ctx.marketType, decisionAt: now, snapshot: { ...ctx.decisionState, critic: { verdict: critic.traderAssessment, independent: critic.independentAction }, consensus: { status: consensus.status, action: consensus.action }, knowledgeContextIds: knowledgeContext.knowledgeIds } });
    this.#emitEvent("market.decision", { marketKey: ctx.marketKey, action, reason, confidence, setup: trader.setup, regime, consensus: consensus.status, ...this.#executionMeta({ source: "AUTO_DECISION", agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` }) });
    if (action === "BUY" || action === "SELL") {
      ctx.lastSignal = { action, at: this.now(), bucketStart: ctx.lastCandle?.bucketStart ?? null, setup: trader.setup };
      this.#emitEvent("market.signal", { marketKey: ctx.marketKey, action, bucketStart: ctx.lastSignal.bucketStart, setup: trader.setup, consensus: consensus.status, correlationId, ...this.#executionMeta({ source: "AUTO_DECISION", agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` }) });
    } else {
      if (ctx.positionState?.status === "OPEN" || ctx.positionState?.status === "ORDERING") this.#setAgent(ctx, ctx.positionState.status === "OPEN" ? "IN_POSITION" : "ORDERING", "POSITION_OPEN");
      else if (!ctx.candidate) this.#setAgent(ctx, "WAIT", reason);
      if (this.now() - (ctx.lastWaitEmit ?? 0) > 5_000) { ctx.lastWaitEmit = this.now(); this.#emitEvent("market.wait", { marketKey: ctx.marketKey, reason, waitReason: trader.waitReason, setup: trader.setup, consensus: consensus.status, ...this.#executionMeta({ source: "AUTO_DECISION", agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` }) }); }
      this.#expireSignals(ctx);
    }
    void this.#entryPipeline(ctx, { action, trader, critic, consensus, fresh: effectiveFresh, knowledgeContext, intelligenceContext, now, correlationId });
    this.#observeTimingShadow(ctx, { action, trader, critic, consensus, fresh: effectiveFresh, now, list });
    this.#observeScenarioShadow(ctx, { action, trader, critic, consensus, now, list });
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
      this.#beginTimingShadow(ctx, { candidate, action, snapshot, serverNow });
      this.#beginScenarioShadow(ctx, { candidate, action, trader, critic, consensus, now });
      this.#safe(() => this.#observeAgentsV4Candidate(ctx, { candidate, action, trader, critic, consensus, now, list: this.#candleList(ctx) }));
      this.#safe(() => this.#observeDualRound1(ctx, candidate, now));
      // SOLO_REASONING (SHADOW): uma passada, mesmo T0; nunca influencia nada.
      this.#safe(() => this.#observeSolo(ctx, candidate, now));
      // HARNESS 5x3 (DRY_RUN): registra as decisoes finais existentes; nunca altera estrategia.
      this.#safe(() => this.#observeFourWay(ctx, candidate, now, action));
      // INDICATOR_5M_V1: analise inicial (candidate) com entrada tardia planejada.
      this.#safe(() => this.#observeIndicator5M(ctx, candidate, now));
      this.#setAgent(ctx, "SIGNAL", `CANDIDATE_${action}`);
      this.#emitEvent("candidate.created", { marketKey: ctx.marketKey, candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, submitAt: candidate.submitAt, entryLeadMs: leadMs, secondsToWindow: Math.max(0, Math.round((candidate.targetEntryAt - serverNow) / 1000)) });
      this.#auditRecord(correlationId ?? candidate.id, ctx.marketKey, "CANDIDATE_CREATED", { candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, submitAt: candidate.submitAt, entryLeadMs: leadMs, serverNow, regime: snapshot.regime, setup: snapshot.setup, trigger: snapshot.trigger }, { persist: true });
      this.#safe(() => this.log("IQ_ENTRY_CANDIDATE_CREATED", JSON.stringify({ marketKey: ctx.marketKey, candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, entryLeadMs: leadMs })));
      return;
    }

    const candidate = ctx.candidate;
    this.#safe(() => this.#observeDualRound2(ctx, candidate, now));
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

  /* ------------------- LATE WINDOW TIMING (SHADOW, nunca executa) ------------------- */

  /** Amostras reais de latencia para a margem adaptativa (ACK do broker, persistencia DB, decisao). */
  #timingLatencySamples() {
    const markets = [...this.markets.values()];
    return {
      ackSamples: markets.flatMap((ctx) => ctx.latency.orderAck ?? []).slice(-80),
      persistSamples: markets.flatMap((ctx) => ctx.latency.dbPersist ?? []).slice(-80),
      decisionSamples: markets.flatMap((ctx) => ctx.latency.decisionToSubmit ?? []).slice(-80),
    };
  }

  #beginTimingShadow(ctx, { candidate, action, snapshot, serverNow }) {
    if (this.config.jitEnabled !== true) return null;
    try {
      const expiration = computeExpiration(Number(serverNow) / 1000, Math.max(1, Math.round(BRAIN_HORIZON_SECONDS / 60)));
      // OBSERVABILIDADE: se begin() supersede a observacao LATE anterior da mesma janela, a interseccao
      // antiga precisa ser reobservada com o desfecho real (antes ficava presa em LATE_OBSERVING).
      const windowKey = `${ctx.marketKey}:${candidate.targetExpiryAt}`;
      const previousTiming = this.timingShadow.getByWindow(windowKey);
      const observation = this.timingShadow.begin({
        marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId, agentId: this.#agentId(ctx),
        candidateId: candidate.id, correlationId: candidate.correlationId ?? null, direction: action,
        candidateSnapshot: candidate.initialFull ?? snapshot ?? {}, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt,
        currentSubmitAt: candidate.submitAt, currentLeadMs: candidate.entryLeadMs, productKind: expiration.optionKind,
        payout: ctx.payout, serverNowMs: serverNow, latency: this.#timingLatencySamples(), atMs: candidate.createdAt,
      });
      if (previousTiming && previousTiming.candidateId && previousTiming.candidateId !== candidate.id && previousTiming.outcome !== "OBSERVING") {
        this.#observeScenarioTimingIntersection(previousTiming.candidateId);
      }
      return observation;
    } catch (error) { this.#safe(() => this.log("IQ_TIMING_SHADOW_BEGIN_FAILED", String(error?.message ?? error).slice(0, 160))); return null; }
  }

  /** Reavalia TODAS as janelas LATE abertas do mercado (expiracao corrente e anterior). Nunca envia ordem. */
  #observeTimingShadow(ctx, { action, trader, critic, consensus, fresh, now, list }) {
    if (this.config.jitEnabled !== true) return null;
    const actives = this.timingShadow.activeObservationsForMarket(ctx.marketKey);
    if (!actives.length) return null;
    const serverNow = this.client?.serverNow?.() ?? now;
    const finalDecision = { action, regime: ctx.decisionState?.regime ?? null, setup: trader?.setup ?? null, trigger: trader?.trigger ?? null, criticVerdict: critic?.traderAssessment ?? null, consensusStatus: consensus?.status ?? null };
    const latest = this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
    const threshold = this.#minTradeQualityScore();
    const gateEnabled = this.config.qualityGateEnabled === true;
    const candles = list ?? this.#candleList(ctx);
    for (const active of actives) {
      try {
        const direction = active.direction ?? action;
        const timing = {
          candidateAgeMs: Math.max(0, now - (active.t0?.candidateAt ?? now)), directionChanges: 0,
          candidateChangedBeforeEntry: active.late?.becameInvalidAt !== null, candidatePrice: active.t0?.price ?? null,
          entryPrice: ctx.lastCandle?.close ?? null, knowledgeContextIds: ctx.decisionState?.knowledge?.ids ?? [],
        };
        const qualityFeatures = featuresFromSnapshot(latest, { direction, payout: ctx.payout, timing });
        const quality = scoreTradeQuality(qualityFeatures);
        const location = entryLocationCheck(qualityFeatures);
        const microVeto = finalMicrostructureVeto({ direction, atr: qualityFeatures.atr, lastTick: ctx.lastTick ? { price: ctx.lastTick.price, ageMs: ctx.lastTick.ageMs ?? null } : null, lastClose: ctx.lastCandle?.close ?? null });
        this.timingShadow.observe({
          marketKey: ctx.marketKey, candidateId: active.candidateId, atMs: now, serverNowMs: serverNow,
          final: finalDecision, freshness: { fresh: fresh?.fresh === true, reason: fresh?.reason ?? null }, latestSnapshot: latest,
          score: quality.score, threshold, locationOk: location.ok, microVeto: microVeto.veto,
          gateEnabled, price: ctx.lastCandle?.close ?? null,
          candles, payout: ctx.payout,
        });
      } catch (error) { this.#safe(() => this.log("IQ_TIMING_SHADOW_OBSERVE_FAILED", String(error?.message ?? error).slice(0, 160))); }
    }
    return actives.length;
  }

  /* ------------------- SCENARIO ENGINE V3 (SHADOW, nunca executa) ------------------- */

  /** Cria a observacao de cenario no candidato (Critic independente fase 1 + Trader fase 2). Observacional. */
  #beginScenarioShadow(ctx, { candidate, action, trader, critic, consensus, now }) {
    if (this.config.scenarioShadowEnabled !== true) return null;
    try {
      const snapshot = candidate.initialFull ?? this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
      const observation = this.scenarioShadow.observe({
        snapshot, direction: candidate.action,
        traderView: { action, currentDecision: ctx.decisionState?.action ?? null, waitReason: ctx.decisionState?.waitReason ?? null },
        criticView: { traderAssessment: critic?.traderAssessment ?? null, independentAction: critic?.independentAction ?? null, contradictions: critic?.contradictions ?? [], riskFlags: critic?.riskFlags ?? [] },
        marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId, agentId: this.#agentId(ctx),
        candidateId: candidate.id, correlationId: candidate.correlationId ?? null,
        payout: ctx.payout, provenance: "PROSPECTIVE",
        candidateAt: candidate.createdAt, decisionAt: now, jitAt: candidate.submitAt, finalEntryAt: null,
        targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt,
        location: trader?.location ?? null, momentum: trader?.momentum ?? null,
        // Timing OPAQUE (o scenario nao conhece a politica): deadline propria = entrada agendada do JIT.
        timingView: { timingPolicyVersion: TIMING_POLICY_CURRENT, currentTimingPolicyVersion: TIMING_POLICY_CURRENT, deadlineAt: candidate.targetEntryAt, supported: true, source: "RUNTIME_CURRENT_JIT" },
      });
      this.#observeScenarioTimingIntersection(candidate.id);
      return observation;
    } catch (error) { this.#safe(() => this.log("IQ_SCENARIO_SHADOW_BEGIN_FAILED", String(error?.message ?? error).slice(0, 160))); return null; }
  }

  /** Estagios intermediarios (REVALIDATION_1/2) a cada avaliacao. Somente leitura do pipeline. */
  #observeScenarioShadow(ctx, { action, trader, critic, consensus, now }) {
    if (this.config.scenarioShadowEnabled !== true) return null;
    const candidate = ctx.candidate;
    if (!candidate) return null;
    const observation = this.scenarioShadow.getByCandidate(candidate.id);
    if (!observation) return null;
    try {
      const stage = observation.stages.some((row) => row.stage === "REVALIDATION_1") ? "REVALIDATION_2" : "REVALIDATION_1";
      const snapshot = this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
      const analysis = analyzeScenarioSnapshot({ snapshot, direction: candidate.action });
      const result = this.scenarioShadow.recordStage({ candidateId: candidate.id, stage, analysis, location: trader?.location ?? null, momentum: trader?.momentum ?? null, atMs: now, source: "RUNTIME_OBSERVE" });
      this.#observeScenarioTimingIntersection(candidate.id);
      return result;
    } catch (error) { this.#safe(() => this.log("IQ_SCENARIO_SHADOW_OBSERVE_FAILED", String(error?.message ?? error).slice(0, 160))); return null; }
  }

  /** Revalidacao final do cenario (desacoplada do timing; deadline = entrada agendada do candidato). */
  #finalizeScenarioShadow(ctx, { candidate, action, trader, critic, consensus, now }) {
    if (this.config.scenarioShadowEnabled !== true) return null;
    try {
      const observation = this.scenarioShadow.getByCandidate(candidate.id);
      if (!observation) return null;
      const snapshot = this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
      const analysis = analyzeScenarioSnapshot({ snapshot, direction: candidate.action });
      const result = this.scenarioShadow.revalidateFinal({
        candidateId: candidate.id, analysis, atMs: now, deadlineAt: candidate.targetEntryAt,
        timingView: { timingPolicyVersion: TIMING_POLICY_CURRENT, currentTimingPolicyVersion: TIMING_POLICY_CURRENT, deadlineAt: candidate.targetEntryAt, source: "RUNTIME_REVALIDATION" },
        location: trader?.location ?? null, momentum: trader?.momentum ?? null,
      });
      this.#observeScenarioTimingIntersection(candidate.id);
      return result;
    } catch (error) { this.#safe(() => this.log("IQ_SCENARIO_SHADOW_FINALIZE_FAILED", String(error?.message ?? error).slice(0, 160))); return null; }
  }

  /** Reobserva interseccoes de LATE ja finalizados do mercado (evita interseccao presa em LATE_OBSERVING). */
  #observeScenarioTimingIntersectionsForMarket(marketKey) {
    if (this.config.scenarioTimingIntersectionEnabled !== true) return 0;
    let count = 0;
    for (const observation of this.timingShadow.list()) {
      if (observation?.marketKey !== marketKey || !observation.candidateId) continue;
      if (observation.outcome === "OBSERVING") continue;
      if (this.#observeScenarioTimingIntersection(observation.candidateId)) count += 1;
    }
    return count;
  }

  /** Registra a intersecao observacional scenario x timing (somente leitura dos dois estados). */
  #observeScenarioTimingIntersection(candidateId) {
    if (this.config.scenarioTimingIntersectionEnabled !== true) return null;
    if (!candidateId) return null;
    try {
      const scenarioObservation = this.scenarioShadow.getByCandidate(candidateId);
      const timingObservation = this.timingShadow.getByCandidate(candidateId);
      if (!scenarioObservation && !timingObservation) return null;
      return this.scenarioTimingIntersection.observe({ scenarioObservation, timingObservation, atMs: this.now() });
    } catch (error) { this.#safe(() => this.log("IQ_SCENARIO_TIMING_INTERSECTION_FAILED", String(error?.message ?? error).slice(0, 160))); return null; }
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
    // SCENARIO ENGINE V3 (SHADOW): revalidacao final do cenario (independente do gate; nunca altera a decisao).
    this.#finalizeScenarioShadow(ctx, { candidate, action, trader, critic, consensus, now });
    // AGENTS V4 (SHADOW): reavaliacao final observacional no instante do JIT.
    this.#safe(() => this.#finalizeAgentsV4Candidate(ctx, { candidate, now, list: this.#candleList(ctx) }));
    // DUAL_REASONING_V1_SHADOW: round final T2 + cross-examination final + DUAL_SYNTHESIS_V1 (observacional).
    this.#safe(() => this.#finalizeDual(ctx, candidate, action, now));
    // INDICATOR_5M_V1: revalidacao no limite + encaminhamento ao harness (DRY_RUN nao envia ordem).
    this.#safe(() => this.#finalizeIndicator5M(ctx, candidate, now));
    if (!revalidation.ok) { this.#cancelCandidate(ctx, revalidation.reason ?? "CANDIDATE_REVALIDATION_FAILED", { checks: revalidation.checks }); return; }
    candidate.status = "CONFIRMED"; candidate.confirmedAt = now;
    this.#emitEvent("candidate.confirmed", { marketKey: ctx.marketKey, candidateId: candidate.id, action, secondsToEntry: Math.max(0, Math.round((candidate.targetEntryAt - serverNow) / 1000)) });
    // SHADOW (Fase 6.3): decide bracos de qualidade com o snapshot t0; NUNCA altera a direcao nem bloqueia.
    const shadowTiming = { candidateAgeMs: Math.max(0, now - candidate.createdAt), directionChanges: candidate.changes?.changes?.filter((change) => change.field === "action").length ?? 0, candidateChangedBeforeEntry: candidate.changes?.changed === true, candidatePrice: candidate.initialFull?.price ?? candidate.initial?.price ?? null };
    const shadowFeatures = featuresFromSnapshot(candidate.initialFull ?? {}, { direction: candidate.action, payout: ctx.payout, timing: shadowTiming });
    const shadowArms = evaluateShadowArms(shadowFeatures);
    // Rubrica de qualidade (0-100) + Entry Location Quality + Veto final de microestrutura (nunca cria direcao).
    const qualityTiming = { ...shadowTiming, entryPrice: ctx.lastCandle?.close ?? null, fresh: fresh?.fresh !== false, knowledgeContextIds: ctx.decisionState?.knowledge?.ids ?? [] };
    const qualityFeatures = featuresFromSnapshot(candidate.initialFull ?? {}, { direction: candidate.action, payout: ctx.payout, timing: qualityTiming });
    const quality = scoreTradeQuality(qualityFeatures);
    const location = entryLocationCheck(qualityFeatures);
    const microVeto = finalMicrostructureVeto({ direction: candidate.action, atr: qualityFeatures.atr, lastTick: ctx.lastTick ? { price: ctx.lastTick.price, ageMs: ctx.lastTick.ageMs ?? null } : null, lastClose: ctx.lastCandle?.close ?? null });
    candidate.quality = { score: quality.score, checks: quality.checks, adverseDisplacement: quality.adverseDisplacement };
    candidate.entryLocation = location;
    candidate.microVeto = microVeto;
    this.#emitEvent("shadow.arms", { marketKey: ctx.marketKey, candidateId: candidate.id, arms: Object.fromEntries(Object.entries(shadowArms).map(([arm, value]) => [arm, value.decision])), qualityScore: quality.score });
    this.#auditRecord(correlationId ?? candidate.id, ctx.marketKey, "SHADOW_ARMS", { candidateId: candidate.id, arms: shadowArms, qualityScore: quality.score, minTradeQualityScore: this.config.minTradeQualityScore, entryLocation: location, microVeto }, { persist: true });
    // PROSPECTIVE SHADOW LAB: registra T0/H1/H2/H3/degradacao/contrafactual da oportunidade. Observacional puro.
    const qualityThreshold = this.#minTradeQualityScore();
    const gateAccepted = this.config.qualityGateEnabled !== true || (location.ok && !microVeto.veto && quality.score >= qualityThreshold);
    const gateReason = gateAccepted ? (this.config.qualityGateEnabled !== true ? "QUALITY_GATE_DISABLED" : null)
      : !location.ok ? "VALID_SETUP_BUT_BAD_ENTRY_PRICE" : microVeto.veto ? `MICROSTRUCTURE_${microVeto.reason}` : "QUALITY_SCORE_BELOW_THRESHOLD";
    const jitFull = this.#candidateSnapshot(ctx, { action, trader, critic, consensus, now });
    const observation = this.shadowLab.observeCandidate({
      marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId, agentId: this.#agentId(ctx),
      candidateId: candidate.id, correlationId: correlationId ?? candidate.id, decisionSource: "G2_AUTO",
      candidateAt: candidate.createdAt, decisionAt: now, jitAt: now, sendAt: now, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt,
      payout: ctx.payout, candidateSnapshot: candidate.initialFull ?? {}, jitSnapshot: jitFull,
      candidatePrice: candidate.initialFull?.price ?? candidate.initial?.price ?? null, jitPrice: jitFull?.price ?? null, actualEntryPrice: ctx.lastCandle?.close ?? null,
      direction: candidate.action, atr: qualityFeatures.atr, quality, location, microVeto, revalidation,
      qualityTiming, candidateTiming: shadowTiming, threshold: qualityThreshold, candles: this.#candleList(ctx),
      currentExecution: "PENDING", currentExecutionReason: null, gateAccepted, gateReason,
    });
    if (this.config.qualityGateEnabled === true) {
      if (!location.ok) { this.shadowLab.markExecution({ observationId: observation?.id ?? null, candidateId: candidate.id, currentExecution: "REJECT", reason: "VALID_SETUP_BUT_BAD_ENTRY_PRICE" }); this.#cancelCandidate(ctx, "VALID_SETUP_BUT_BAD_ENTRY_PRICE", { reasons: location.reasons, score: quality.score }); return; }
      if (microVeto.veto) { this.shadowLab.markExecution({ observationId: observation?.id ?? null, candidateId: candidate.id, currentExecution: "REJECT", reason: `MICROSTRUCTURE_${microVeto.reason}` }); this.#cancelCandidate(ctx, `MICROSTRUCTURE_${microVeto.reason}`, microVeto.detail ?? {}); return; }
      if (quality.score < this.#minTradeQualityScore()) { this.shadowLab.markExecution({ observationId: observation?.id ?? null, candidateId: candidate.id, currentExecution: "REJECT", reason: "QUALITY_SCORE_BELOW_THRESHOLD" }); this.#cancelCandidate(ctx, "QUALITY_SCORE_BELOW_THRESHOLD", { score: quality.score, threshold: this.#minTradeQualityScore(), failedChecks: quality.checks.filter((check) => !check.ok).map((check) => check.id) }); return; }
    }
    const entryTiming = {
      candidateId: candidate.id, action, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, targetExpirySec: Math.round(candidate.targetExpiryAt / 1000),
      submitAt: candidate.submitAt, entryLeadMs: candidate.entryLeadMs, revalidatedAt: now, candidateChangedBeforeEntry: candidate.changes.changed, changedFields: candidate.changes.changes,
      initialSnapshot: candidate.initialFull, t0Snapshot: candidate.initialFull, shadowObservationId: observation?.id ?? null,
      revalidationChecks: revalidation.checks, shadowArms, candidatePrice: candidate.initialFull?.price ?? null,
      qualityScore: candidate.quality?.score ?? null, qualityChecks: candidate.quality?.checks ?? null, entryLocation: candidate.entryLocation ?? null, microVeto: candidate.microVeto ?? null,
    };
    const record = await this.#handleSignal(ctx, action, trader, this.#candleList(ctx), entryTiming);
    if (this.dataHub) {
      this.#safe(() => this.dataHub.publish({
        eventType: "EXECUTION_STATE", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: this.now(), availableAt: this.now(), producer: "iq-multi-runtime", source: "execution-gate",
        accountContext: record?.accountContext ?? this.accountContext.context,
        provenance: { gate: record?.gate?.allowed === true ? "ALLOWED" : "BLOCKED", candidateId: candidate.id },
        payload: { executionId: record?.executionId ?? null, disposition: record?.disposition ?? null, reason: record?.reason ?? null, stakeFinal: record?.stakeFinal ?? null },
      }));
    }
    this.timingShadow.markCurrentSend({ candidateId: candidate.id, executionId: record?.executionId ?? null, disposition: record?.disposition ?? null, reason: record?.reason ?? null, atMs: this.now() });
    this.shadowLab.markExecution({
      observationId: observation?.id ?? null, candidateId: candidate.id, executionId: record?.executionId ?? null,
      currentExecution: record?.disposition === "EXECUTED" ? "EXECUTE" : "REJECT",
      reason: record?.disposition === "EXECUTED" ? null : (record?.disposition === "DUPLICATE" ? "CANDIDATE_DUPLICATE" : (record?.reason ?? "BLOCKED")),
    });
    if (record?.disposition === "EXECUTED") { candidate.status = "ORDER_SENT"; this.#setAgent(ctx, "IN_POSITION", "ORDER_SENT"); }
    else if (record?.disposition === "DUPLICATE") { candidate.status = "DUPLICATE"; this.#commitCandidate(ctx, "CANDIDATE_DUPLICATE", { signalId: record?.id ?? null }); }
    else { candidate.status = "GATE_BLOCKED"; this.#cancelCandidate(ctx, `ORDER_${record?.reason ?? "BLOCKED"}`, { signalId: record?.id ?? null, reason: record?.reason ?? null }); }
  }

  /* ------------------- AGENTS V4 (SHADOW, nunca decide/executa) ------------------- */

  /** T0 enriquecido point-in-time do ctx (mesmos insumos causais do G2 + ticks reais do feed). */
  #buildT0ForV4(ctx, list, { now, execution = null, candidate = null } = {}) {
    return buildT0Enriched({
      marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
      accountContext: this.accountContext.context, decisionAt: now,
      price: ctx.lastCandle?.close ?? null, candles5s: list, ticks: ctx.tickHistory ?? [],
      featureContext: ctx.featureState?.context ?? null, structureFeatures: ctx.agents?.structureFeatures ?? null,
      trajectory: this.#trajectory(ctx), payout: ctx.payout,
      marketMeta: { symbol: ctx.display ?? null, availability: ctx.availability ?? null, productKind: candidate?.productKind ?? null },
      snapshotId: `${ctx.marketKey}:${candidate?.id ?? now}`,
    });
  }

  /* ------------------- RSI AGENTS V3 (estrategia unica; ordem via submitAgentV3Order) ------------------- */
  #observeRsiAgents(ctx, list, now) {
    if (!this.rsiAgentsV3?.enabled) return null;
    // V3.1 WATCH: candidate vivo => sem throttle generico (exatamente 1 avaliacao por candle de 5s,
    // event-driven pelo fechamento do candle); sem candidate => throttle curto anti-duplicata.
    // Dedupe por candle (bucketEnd) nos dois modos: nunca avalia o mesmo candle duas vezes.
    const candidateActive = this.rsiAgentsV3.hasActiveCandidate?.(ctx.marketKey) === true;
    const bucketEnd = Number(list?.[list.length - 1]?.bucketEnd);
    const evaluate = shouldEvaluate({
      now, lastAt: ctx.rsiAgentsAt ?? null,
      bucketEnd: Number.isFinite(bucketEnd) ? bucketEnd : null, lastBucket: ctx.rsiAgentsBucket ?? null,
      candidateActive, throttleMs: RSI_V3_WATCH_POLICY.normalThrottleMs,
    });
    if (!evaluate) { ctx.rsiAgentsSkips = (ctx.rsiAgentsSkips ?? 0) + 1; return null; }
    ctx.rsiAgentsAt = now;
    if (Number.isFinite(bucketEnd)) ctx.rsiAgentsBucket = bucketEnd;
    // Universo reconciliado periodicamente (throttle interno): mercado novo entra; mercado que sai do feed fica bloqueado.
    void this.rsiAgentsV3.assignUniverse([...this.markets.values()]);
    if (!this.rsiAgentsV3.assignments.has(ctx.marketKey)) return null;
    const serverNow = this.client?.serverNow?.() ?? now;
    const targetExpiryAt = Math.ceil(serverNow / 60_000) * 60_000;
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    const persistSamples = ctx.latency?.dbPersist ?? [];
    const persistP95 = persistSamples.length ? [...persistSamples].sort((a, b) => a - b)[Math.min(persistSamples.length - 1, Math.ceil(0.95 * persistSamples.length) - 1)] : 0;
    const promise = this.rsiAgentsV3.observeMarket({ marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId, candles: list, targetExpiryAt, payout: ctx.payout, now, latency: { ackP95Ms: ackP95, persistP95Ms: persistP95, decisionMs: 30, jitterMs: 300, bufferMs: 150 } });
    if (promise && typeof promise.then === "function") promise.then((state) => this.#emitRsiAgentDecision(ctx, state, now)).catch(() => undefined);
    return promise;
  }

  /* ------------------- RSI AGENTS V4 (MESAS-driven; ordem via submitAgentV4Order) ------------------- */
  #observeRsiAgentsV4(ctx, list, now) {
    if (!this.rsiAgentsV4?.enabled) return null;
    const candidateActive = this.rsiAgentsV4.hasActiveCandidate(ctx.marketKey, "BINARY") === true || this.rsiAgentsV4.hasActiveCandidate(ctx.marketKey, "BLITZ_45S") === true;
    const bucketEnd = Number(list?.[list.length - 1]?.bucketEnd);
    const evaluate = shouldEvaluate({
      now, lastAt: ctx.rsiAgentsV4At ?? null,
      bucketEnd: Number.isFinite(bucketEnd) ? bucketEnd : null, lastBucket: ctx.rsiAgentsV4Bucket ?? null,
      candidateActive, throttleMs: RSI_V3_WATCH_POLICY.normalThrottleMs,
    });
    if (!evaluate) { ctx.rsiAgentsV4Skips = (ctx.rsiAgentsV4Skips ?? 0) + 1; return null; }
    ctx.rsiAgentsV4At = now;
    if (Number.isFinite(bucketEnd)) ctx.rsiAgentsV4Bucket = bucketEnd;
    void this.refreshInstrumentRegistry();
    if (!this.rsiAgentsV4.assignments.has(ctx.marketKey)) return null;
    const serverNow = this.client?.serverNow?.() ?? now;
    const targetExpiryAt = Math.ceil(serverNow / 60_000) * 60_000;
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    const persistSamples = ctx.latency?.dbPersist ?? [];
    const persistP95 = persistSamples.length ? [...persistSamples].sort((a, b) => a - b)[Math.min(persistSamples.length - 1, Math.ceil(0.95 * persistSamples.length) - 1)] : 0;
    const instruments = [...this.rsiAgentsV4.instruments.values()].filter((row) => row.marketKey === ctx.marketKey && row.enabled === true);
    const promises = instruments.map((row) => this.rsiAgentsV4.observeMarket({
      marketKey: ctx.marketKey, instrumentType: row.instrumentType, durationSeconds: row.durationSeconds, marketType: ctx.marketType,
      candles: list, targetExpiryAt, payout: ctx.payout, now, latency: { ackP95Ms: ackP95, persistP95Ms: persistP95, decisionMs: 30, jitterMs: 300, bufferMs: 150 },
    }));
    return Promise.all(promises).then((states) => { for (const state of states) this.#emitRsiAgentDecision(ctx, state, now); });
  }

  /* ------------------- RSI AGENTS V2 LIVE (Strategy Core = V2 ORIGINAL; infra atual) ------------------- */
  #observeRsiAgentsV2Live(ctx, list, now) {
    if (!this.rsiAgentsV2Live?.enabled) return null;
    const candidateActive = this.rsiAgentsV2Live.hasActiveCandidate(ctx.marketKey) === true;
    const bucketEnd = Number(list?.[list.length - 1]?.bucketEnd);
    const evaluate = shouldEvaluate({
      now, lastAt: ctx.rsiAgentsV2LiveAt ?? null,
      bucketEnd: Number.isFinite(bucketEnd) ? bucketEnd : null, lastBucket: ctx.rsiAgentsV2LiveBucket ?? null,
      candidateActive, throttleMs: RSI_V3_WATCH_POLICY.normalThrottleMs,
    });
    if (!evaluate) { ctx.rsiAgentsV2LiveSkips = (ctx.rsiAgentsV2LiveSkips ?? 0) + 1; return null; }
    ctx.rsiAgentsV2LiveAt = now;
    if (Number.isFinite(bucketEnd)) ctx.rsiAgentsV2LiveBucket = bucketEnd;
    void this.refreshInstrumentRegistry();
    if (!this.rsiAgentsV2Live.assignments.has(ctx.marketKey)) return null;
    const serverNow = this.client?.serverNow?.() ?? now;
    const targetExpiryAt = Math.ceil(serverNow / 60_000) * 60_000;
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    const persistSamples = ctx.latency?.dbPersist ?? [];
    const persistP95 = persistSamples.length ? [...persistSamples].sort((a, b) => a - b)[Math.min(persistSamples.length - 1, Math.ceil(0.95 * persistSamples.length) - 1)] : 0;
    const promise = this.rsiAgentsV2Live.observeMarket({
      marketKey: ctx.marketKey, instrumentType: "BINARY", durationSeconds: 60, marketType: ctx.marketType,
      candles: list, targetExpiryAt, payout: ctx.payout, now, latency: { ackP95Ms: ackP95, persistP95Ms: persistP95, decisionMs: 30, jitterMs: 300, bufferMs: 150 },
    });
    if (promise && typeof promise.then === "function") promise.then((state) => this.#emitRsiAgentDecision(ctx, state, now)).catch(() => undefined);
    this.#scheduleV2LiveTicks();
    return promise;
  }

  /**
   * (1) TICK-WATCH do PRIORITY_FINAL_WATCH: enquanto o mercado tem candidate vivo e estamos na regiao
   * T-45s..cutoff da expiracao alvo, reavalia a cada ~1s (nao so por candle), aumentando a chance de
   * pegar a aprovacao V2 dentro da janela. Mesmas regras V2; muda apenas QUANDO avaliamos.
   */
  #scheduleV2LiveTicks() {
    if (this.rsiAgentsV2LiveTickTimer) return;
    const tick = () => {
      this.rsiAgentsV2LiveTickTimer = setTimeout(() => {
        this.#safe(() => this.#observeRsiAgentsV2LiveTicks());
        tick();
      }, 1000);
      if (this.rsiAgentsV2LiveTickTimer?.unref) this.rsiAgentsV2LiveTickTimer.unref();
    };
    tick();
  }

  #observeRsiAgentsV2LiveTicks() {
    if (!this.rsiAgentsV2Live?.enabled) return;
    const now = this.now();
    this.#pollBlitzSettlements();
    this.#pollMcpBinarySettlements();
    for (const ctx of this.markets.values()) {
      if (ctx.enabled !== true || ctx.availability !== "OPEN") continue;
      if (!this.rsiAgentsV2Live.hasActiveCandidate(ctx.marketKey)) continue;
      const serverNow = this.client?.serverNow?.() ?? now;
      const targetExpiryAt = Math.ceil(serverNow / 60_000) * 60_000;
      if (now < targetExpiryAt - 45_000 || now > targetExpiryAt - 30_000) continue;
      const list = this.#candleList(ctx);
      if (list.length < 3) continue;
      void this.rsiAgentsV2Live.observeMarket({
        marketKey: ctx.marketKey, instrumentType: "BINARY", durationSeconds: 60, marketType: ctx.marketType,
        candles: list, targetExpiryAt, payout: ctx.payout, now, latency: {},
      });
    }
  }

  async #pollMcpBinarySettlements() {
    if (!this.iqMcpBinary?.enabled || !this.pool?.query) return;
    const now = this.now();
    if (now - (this.lastMcpBinPoll ?? 0) < 30_000) return;
    this.lastMcpBinPoll = now;
    try {
      const trades = await this.iqMcpBinary.getTradeHistory({ limit: 30 });
      for (const t of trades) {
        const raw = String(t.result ?? "").toLowerCase();
        const mapped = raw === "win" ? "WIN" : ["loose", "loss"].includes(raw) ? "LOSS" : ["equal", "draw"].includes(raw) ? "DRAW" : null;
        const pid = String(t.position_id ?? "");
        if (!mapped || !pid) continue;
        await this.pool.query("UPDATE iq_executions SET state='SETTLED', broker_result=$2, profit=$3, settled_at=now() WHERE broker_order_id=$1 AND broker_result IS NULL", [pid, mapped, Number(t.profit) || 0]).catch(() => undefined);
        this.#emitEvent("order.mcp.settlement", { positionId: pid, result: mapped, profit: Number(t.profit) || 0 });
      }
    } catch (error) { this.#safe(() => this.log("MCP_BINARY_SETTLE_FAIL", String(error?.message ?? error).slice(0, 120))); }
  }

  /** V2 BLITZ por candle (fast lane: ativos Blitz com feed WS; 45s; ordem via MCP oficial). */
  #observeRsiAgentsV2Blitz(ctx, list, now) {
    if (!this.rsiAgentsV2Blitz?.enabled) return null;
    if (!Array.isArray(list) || list.length < 3) return null;
    const instruments = [...this.rsiAgentsV2Blitz.instruments.values()].filter((row) => row.marketKey === ctx.marketKey && row.enabled === true);
    if (!instruments.length) return null;
    const promises = instruments.map((row) => this.rsiAgentsV2Blitz.observeMarket({ marketKey: ctx.marketKey, instrumentType: "BLITZ_45S", durationSeconds: 45, candles: list, payout: ctx.payout, now }));
    return Promise.all(promises).then((states) => { for (const state of states) this.#emitRsiAgentDecision(ctx, state, now); });
  }

  /** Settlement Blitz via API oficial (get_trade_history, 1 leitura/30s) — atualiza oportunidades/estado. */
  #pollBlitzSettlements() {
    if (!this.rsiAgentsV2Blitz?.enabled || !this.iqMcp?.enabled || !this.pool?.query) return;
    const now = this.now();
    if (now - (this.lastBlitzSettlePoll ?? 0) < 30_000) return;
    this.lastBlitzSettlePoll = now;
    void (async () => {
      try {
        const trades = await this.iqMcp.getTradeHistory({ limit: 30 });
        for (const trade of trades) {
          const raw = String(trade.result ?? "").toLowerCase();
          const mapped = raw === "win" ? "WIN" : raw === "loose" || raw === "loss" ? "LOSS" : raw === "equal" || raw === "draw" ? "DRAW" : null;
          if (!mapped) continue;
          const positionId = String(trade.position_id ?? "");
          if (!positionId) continue;
          const row = (await this.pool.query("SELECT opportunity_id, market_key FROM iq_rsi_opportunities_v2live WHERE instrument_type='BLITZ_45S' AND order_id=$1 AND result IS NULL LIMIT 1", [positionId])).rows?.[0] ?? null;
          if (!row) continue;
          await this.pool.query("UPDATE iq_rsi_opportunities_v2live SET result=$2, profit=$3, expiry_price=$4, settlement_basis='IQ_MCP_BLITZ' WHERE opportunity_id=$1", [row.opportunity_id, mapped, num(trade.profit), num(trade.close_price)]).catch(() => undefined);
          this.rsiAgentsV2Blitz.recordSettlement({ marketKey: row.market_key, result: mapped, profit: num(trade.profit) });
          this.#emitEvent("blitz.settlement", { positionId, marketKey: row.market_key, result: mapped, profit: num(trade.profit) });
        }
      } catch (error) { this.#safe(() => this.log("BLITZ_SETTLE_POLL_FAIL", String(error?.message ?? error).slice(0, 120))); }
    })();
  }
  async refreshInstrumentRegistry({ force = false } = {}) {
    if (!this.pool?.query || !this.rsiAgentsV4) return null;
    if (!force && this.now() - (this.lastInstrumentSync ?? 0) < 15_000) return null;
    this.lastInstrumentSync = this.now();
    if (this.registrySyncInFlight === true) return null;
    this.registrySyncInFlight = true;
    try {
      // 1) Universo executavel PRIMEIRO: nunca depende do seed nem de escrita.
      const rows = (await this.pool.query("SELECT market_key, instrument_type, duration_seconds, market_type, canonical, enabled, status, payout FROM iq_rsi_instruments ORDER BY market_key, instrument_type")).rows ?? [];
      const merged = rows.map((row) => {
        const ctx = this.markets.get(row.market_key);
        return {
          marketKey: row.market_key, instrumentType: row.instrument_type, durationSeconds: toNum(row.duration_seconds) ?? 60,
          marketType: ctx?.marketType ?? row.market_type ?? null, canonical: ctx?.canonical ?? row.canonical ?? null,
          enabled: row.enabled === true, availability: ctx?.availability ?? row.status ?? "UNKNOWN", status: ctx?.availability ?? row.status ?? "UNKNOWN",
          activeId: ctx?.activeId ?? null, payout: ctx?.payout ?? toNum(row.payout),
        };
      });
      this.rsiAgentsV4.assignUniverse(merged.filter((row) => row.instrumentType === "BINARY"));
      this.rsiAgentsV2Live?.assignUniverse?.(merged.filter((row) => row.instrumentType === "BINARY"));
      this.rsiAgentsV2Blitz?.assignUniverse?.(merged.filter((row) => row.instrumentType === "BLITZ_45S"));
      const enabled = merged.filter((row) => row.enabled).length;
      const legacyEnabledOpen = [...this.markets.values()].filter((ctx) => ctx.enabled === true && ctx.availability === "OPEN").length;
      // Alarme cobre registry vazio (total 0, ex.: DB recriado) e 0/N com mercados legados ligados.
      const empty = enabled === 0 && this.configHydrated === true && legacyEnabledOpen > 0;
      if (empty && this.rsiV4UniverseEmpty !== true) {
        this.rsiV4UniverseEmpty = true;
        this.#emitEvent("rsi.v4.universe_empty", {
          total: merged.length, enabled, blocked: merged.length,
          registryEmpty: merged.length === 0,
          legacyEnabled: legacyEnabledOpen,
          reason: merged.length === 0 ? "MESAS_REGISTRY_EMPTY" : "MESAS_ZERO_ENABLED",
          note: "Nenhum instrumento executavel em MESAS: o runner V4 avalia zero mercados (nenhuma ordem e possivel).",
        });
        this.#safe(() => this.log("RSI_V4_UNIVERSE_EMPTY", JSON.stringify({ total: merged.length, registryEmpty: merged.length === 0, legacyEnabled: legacyEnabledOpen })));
      } else if (!empty && this.rsiV4UniverseEmpty === true) {
        this.rsiV4UniverseEmpty = false;
        this.#emitEvent("rsi.v4.universe_restored", { total: merged.length, enabled });
      }
      // 2) Seed best-effort, so depois do config hidratado (nunca grava enabled=false as cegas)
      //    e SOMENTE para instrumentos ausentes no registry (sem rajada de upserts a cada sync).
      if (this.configHydrated === true) {
        const existing = new Set(merged.map((row) => `${row.marketKey}|${row.instrumentType}`));
        const seeds = [];
        for (const ctx of this.markets.values()) {
          if (!Array.isArray(ctx.instrumentTypes) || !ctx.instrumentTypes.includes("binary")) continue;
          if (existing.has(`${ctx.marketKey}|BINARY`)) continue;
          const seedEnabled = ctx.enabled === true && ctx.availability === "OPEN";
          seeds.push(this.pool.query(
            `INSERT INTO iq_rsi_instruments(market_key, instrument_type, duration_seconds, market_type, canonical, active_id, enabled, status, payout, source, payload, updated_at)
             VALUES($1,'BINARY',60,$2,$3,$4,$5,$6,$7,'SEED_UNIVERSE','{}'::jsonb, now())
             ON CONFLICT(market_key, instrument_type, duration_seconds) DO UPDATE SET market_type=$2, canonical=$3, active_id=$4, status=$6, payout=$7, updated_at=now()`,
            [ctx.marketKey, ctx.marketType, ctx.canonical, ctx.activeId, seedEnabled, ctx.availability, ctx.payout],
          ).catch(() => undefined));
        }
        await Promise.allSettled(seeds);
      }
      return { total: merged.length, enabled, empty };
    } catch (error) {
      this.#safe(() => this.log("RSI_V4_REGISTRY_SYNC_FAIL", String(error?.message ?? error)));
      return null;
    } finally {
      this.registrySyncInFlight = false;
    }
  }

  /** Lista para o MESAS (registry + disponibilidade viva). Em memoria quando possivel
   *  (o registry e sincronizado do banco a cada 15s e apos cada mutacao); DB apenas no cold start. */
  async mesasList() {
    if (!this.pool?.query) return { rows: [], totals: { total: 0, enabled: 0, byType: {}, byMarketType: {} } };
    const inMemory = this.rsiAgentsV4 ? [...this.rsiAgentsV4.instruments.values()] : [];
    if (inMemory.length > 0) {
      const view = inMemory.map((row) => this.#mesasView(row));
      const byType = {}; const byMarketType = {};
      for (const row of view) { byType[row.category] = (byType[row.category] ?? 0) + 1; byMarketType[row.marketType] = (byMarketType[row.marketType] ?? 0) + 1; }
      return { rows: view, totals: { total: view.length, enabled: view.filter((row) => row.enabled).length, byType, byMarketType }, source: "IN_MEMORY_REGISTRY", syncedAt: this.rsiAgentsV4.universe?.at ?? null };
    }
    return this.cachedRead("mesas", 10_000, async () => {
    const rows = (await this.pool.query("SELECT market_key, instrument_type, duration_seconds, market_type, canonical, active_id, enabled, status, payout, source, updated_at FROM iq_rsi_instruments ORDER BY instrument_type, market_type, market_key")).rows ?? [];
    const view = rows.map((row) => this.#mesasView(row));
    const byType = {}; const byMarketType = {};
    for (const row of view) { byType[row.category] = (byType[row.category] ?? 0) + 1; byMarketType[row.marketType] = (byMarketType[row.marketType] ?? 0) + 1; }
    return { rows: view, totals: { total: view.length, enabled: view.filter((row) => row.enabled).length, byType, byMarketType } };
    });
  }

  /** View publica do MESAS (aceita linha do banco snake_case ou do registry em memoria). */
  #mesasView(row = {}) {
    const marketKey = row.marketKey ?? row.market_key ?? null;
    const ctx = marketKey ? this.markets.get(marketKey) : null;
    const canonical = ctx?.canonical ?? row.canonical ?? String(marketKey ?? "").split(":")[0];
    const isCrypto = /BTC|ETH|LTC|XRP|ADA|SOL|DOGE/.test(String(canonical).toUpperCase());
    const instrumentType = String(row.instrumentType ?? row.instrument_type ?? "BINARY");
    return {
      marketKey, instrumentType, durationSeconds: toNum(row.durationSeconds ?? row.duration_seconds) ?? 60,
      marketType: ctx?.marketType ?? row.marketType ?? row.market_type ?? (String(marketKey ?? "").includes(":OTC") ? "OTC" : "NORMAL"),
      category: instrumentType === "BINARY" ? "BINARY" : instrumentType === "BLITZ_45S" ? "BLITZ" : "OTHER",
      assetClass: isCrypto ? "CRYPTO" : "FOREX", canonical,
      payout: toNum(ctx?.payout ?? row.payout), status: ctx?.availability ?? row.status ?? "UNKNOWN",
      liveAvailability: ctx?.availability ?? row.liveAvailability ?? null,
      activeId: toNum(ctx?.activeId ?? row.activeId ?? row.active_id),
      enabled: row.enabled === true,
      source: row.source ?? "IN_MEMORY_REGISTRY",
      updatedAt: row.updatedAt ?? row.updated_at ?? (this.rsiAgentsV4?.universe?.at ? new Date(this.rsiAgentsV4.universe.at).toISOString() : null),
    };
  }

  async setInstrumentEnabled({ marketKey, instrumentType, durationSeconds = 60, enabled, meta = null }) {
    if (!this.pool?.query) throw new IqWsError("MESAS_NO_DB");
    const type = String(instrumentType).toUpperCase();
    const previous = (await this.pool.query("SELECT enabled FROM iq_rsi_instruments WHERE market_key=$1 AND instrument_type=$2 AND duration_seconds=$3", [marketKey, type, Number(durationSeconds)]).catch(() => ({ rows: [] }))).rows?.[0] ?? null;
    const result = await this.pool.query("UPDATE iq_rsi_instruments SET enabled=$4, updated_at=now() WHERE market_key=$1 AND instrument_type=$2 AND duration_seconds=$3 RETURNING *", [marketKey, type, Number(durationSeconds), enabled === true]);
    if (!result.rows?.length) throw new IqWsError("MESAS_INSTRUMENT_NOT_FOUND", `${marketKey}:${type}:${durationSeconds}`);
    this.#emitEvent("mesas.instrument", { marketKey, instrumentType: type, durationSeconds: Number(durationSeconds), enabled: enabled === true });
    // Auditoria persistida (MESAS controla o universo executavel V4; toggle nunca pode ser invisivel).
    this.#auditRecord(`mesas_${type}_${marketKey}_${this.now()}`, marketKey, "MESAS_INSTRUMENT", { instrumentType: type, durationSeconds: Number(durationSeconds), oldValue: previous?.enabled ?? null, newValue: enabled === true, enabled: enabled === true, actor: meta?.actor ?? "OPERATOR_UI", requestId: meta?.requestId ?? null }, { persist: true });
    await this.refreshInstrumentRegistry({ force: true });
    return result.rows[0];
  }

  async bulkSetInstruments({ filter = {}, enabled = false, confirmZeroUniverse = false, meta = null } = {}) {
    if (!this.pool?.query) throw new IqWsError("MESAS_NO_DB");
    const clauses = []; const values = [];
    if (filter.instrumentType) { values.push(String(filter.instrumentType).toUpperCase()); clauses.push(`instrument_type=$${values.length}`); }
    if (filter.marketType) { values.push(String(filter.marketType).toUpperCase()); clauses.push(`market_type=$${values.length}`); }
    if (filter.category) {
      const category = String(filter.category).toUpperCase();
      if (category === "BLITZ") clauses.push("instrument_type IN ('BLITZ_45S','BLITZ')");
      else if (category === "BINARY") clauses.push("instrument_type='BINARY'");
      else if (category === "CRYPTO") clauses.push("(canonical ILIKE '%BTC%' OR canonical ILIKE '%ETH%' OR canonical ILIKE '%LTC%' OR canonical ILIKE '%XRP%' OR canonical ILIKE '%ADA%' OR canonical ILIKE '%SOL%' OR canonical ILIKE '%DOGE%')");
    }
    if (filter.marketKey) { values.push(filter.marketKey); clauses.push(`market_key=$${values.length}`); }
    // Fail closed: bulk sem filtro explicito NUNCA pode virar "todos".
    if (!clauses.length) throw new IqWsError("MESAS_FILTER_REQUIRED", "filter explicito obrigatorio (instrumentType/marketType/category/marketKey)");
    const where = `WHERE ${clauses.join(" AND ")}`;
    const enabledBefore = Number((await this.pool.query("SELECT count(*)::int AS n FROM iq_rsi_instruments WHERE enabled=true")).rows?.[0]?.n) || 0;
    let matchedEnabled = 0;
    if (enabled !== true) {
      matchedEnabled = Number((await this.pool.query(`SELECT count(*)::int AS n FROM iq_rsi_instruments ${where} AND enabled=true`, values)).rows?.[0]?.n) || 0;
      const enabledAfter = enabledBefore - matchedEnabled;
      if (enabledBefore > 0 && enabledAfter === 0 && confirmZeroUniverse !== true) {
        throw new IqWsError("MESAS_ZERO_UNIVERSE_CONFIRMATION_REQUIRED", `desligaria ${matchedEnabled} de ${enabledBefore} instrumentos ativos; envie confirmZeroUniverse=true para confirmar`);
      }
    }
    values.push(enabled === true);
    const result = await this.pool.query(`UPDATE iq_rsi_instruments SET enabled=$${values.length}, updated_at=now() ${where} RETURNING market_key, instrument_type`, values);
    const changed = result.rows?.length ?? 0;
    const enabledAfterFinal = enabled === true ? enabledBefore + changed : enabledBefore - matchedEnabled;
    this.#emitEvent("mesas.bulk", { filter, enabled: enabled === true, changed, enabledBefore, enabledAfter: enabledAfterFinal });
    this.#auditRecord(`mesas_bulk_${this.now()}`, null, "MESAS_BULK", { filter, enabled: enabled === true, confirmZeroUniverse: confirmZeroUniverse === true, changed, enabledBefore, enabledAfter: enabledAfterFinal, oldValue: enabledBefore, newValue: enabledAfterFinal, actor: meta?.actor ?? "OPERATOR_UI", requestId: meta?.requestId ?? null }, { persist: true });
    if (enabled === true || enabledBefore === 0 || enabledAfterFinal > 0) {
      // ok
    } else {
      this.#emitEvent("mesas.bulk_zero_universe", { filter, matchedEnabled, enabledBefore, enabledAfter: enabledAfterFinal, confirmZeroUniverse: confirmZeroUniverse === true, actor: meta?.actor ?? "OPERATOR_UI", requestId: meta?.requestId ?? null });
      this.#safe(() => this.log("MESAS_BULK_ZERO_UNIVERSE", JSON.stringify({ matchedEnabled, enabledBefore, filter })));
    }
    await this.refreshInstrumentRegistry({ force: true });
    return { changed, enabled: enabled === true, enabledBefore, enabledAfter: enabledAfterFinal };
  }

  /** Eventos persistidos da V4 (read-only, auditoria do funil DETECT->WATCH->GATE->SUBMIT). Cache curto + single-flight. */
  async rsiV4Events(params = {}) {
    if (!this.rsiAgentsV4?.events) return { events: [], unavailable: true };
    return this.cachedRead(`v4-events:${params.marketKey ?? "-"}:${params.limit ?? 100}`, 5_000, () => this.rsiAgentsV4.events(params));
  }

  async rsiV4EventsFunnel(params = {}) {
    if (!this.rsiAgentsV4?.eventsFunnel) return { funnel: [], unavailable: true };
    return this.cachedRead(`v4-funnel:${params.marketKey ?? "-"}`, 15_000, () => this.rsiAgentsV4.eventsFunnel(params));
  }

  /**
   * DESCOBERTA BLITZ pelo protocolo atual (read-only). Registra o que o broker realmente oferecer;
   * nunca inventa IDs e NUNCA habilita execucao automaticamente (enabled=false, orderPath unverified).
   */
  async discoverBlitzInstruments() {
    if (this.blitzDiscoveryCache && this.now() - (this.blitzDiscoveryAt ?? 0) < 600_000) return this.blitzDiscoveryCache;
    const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`TIMEOUT_${label}`)), ms))]);
    const report = { schema: "blitz-discovery-v1", at: new Date(this.now()).toISOString(), supported: false, instruments: [], durations: [], payout: {}, orderPath: { supported: false, reason: "ORDER_MESSAGE_UNVERIFIED" }, errors: [] };
    const collect = (() => { const sections = new Set(); const rows = []; return { sections, rows }; })();
    try {
      const init = await withTimeout(this.client.getInitializationData(), 6_000, "INIT");
      const payload = init?.msg ?? init?.message ?? init ?? {};
      for (const [section, data] of Object.entries(payload ?? {})) {
        if (!data || typeof data !== "object") continue;
        if (/blitz/i.test(section)) collect.sections.add(section);
        const actives = data.actives ?? null;
        if (actives && typeof actives === "object" && /blitz/i.test(section)) {
          for (const [id, row] of Object.entries(actives)) rows.push({ section, activeId: Number(id), name: row?.name ?? null, enabled: row?.enabled === true, suspended: row?.suspended === true });
        }
      }
      report.initSectionsWithBlitz = [...collect.sections];
      report.instruments = collect.rows;
    } catch (error) { report.errors.push(`init:${String(error?.message ?? error).slice(0, 120)}`); }
    for (const type of ["blitz-option"]) {
      try {
        const response = await withTimeout(this.client.getInstruments({ type }), 6_000, "INSTRUMENTS");
        const payload = response?.msg ?? response?.message ?? response ?? {};
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.instruments) ? payload.instruments : Array.isArray(payload?.result) ? payload.result : [];
        report.instruments = [...report.instruments, ...list.map((row) => ({ type, raw: sanitizeInstrumentRow(row) }))];
      } catch (error) { report.errors.push(`instruments:${type}:${String(error?.message ?? error).slice(0, 120)}`); }
      try {
        const response = await withTimeout(this.client.getOptions({ limit: 30, instrumentType: "blitz" }), 6_000, "OPTIONS");
        const payload = response?.msg ?? response?.message ?? response ?? {};
        const options = payload?.result ?? payload?.options ?? [];
        for (const option of Array.isArray(options) ? options : []) {
          const durationMs = Number(option.expiration ?? option.expired ?? 0) - Number(option.created_at ?? 0);
          report.durations.push(durationMs > 0 ? Math.round(durationMs / 1000) : null);
          if (option.active_id) report.payout[String(option.active_id)] = option.win_amount ?? option.payout ?? null;
        }
      } catch (error) { report.errors.push(`options:blitz:${String(error?.message ?? error).slice(0, 120)}`); }
    }
    report.durations = [...new Set(report.durations.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
    report.supported = report.instruments.length > 0 || report.durations.length > 0;
    report.supports45s = report.durations.includes(45);
    report.orderPath = report.supported ? { supported: false, reason: "ORDER_MESSAGE_UNVERIFIED" } : { supported: false, reason: "BLITZ_NOT_OFFERED" };
    this.blitzDiscoveryCache = report;
    this.blitzDiscoveryAt = this.now();
    return report;
  }

  /** LOGS: decisao RSI V3 com agentId/strategyId/decisionSource/controlsExecution (throttle + mudanca de estado). */
  #emitRsiAgentDecision(ctx, state, now) {
    if (!state?.strategy) return;
    const signature = `${state.decision}|${state.waitReason ?? ""}|${state.candidateAt ?? ""}|${state.lastResult ?? ""}|${state.entryMode ?? ""}`;
    const previous = ctx.rsiAgentDecision ?? null;
    const changed = !previous || previous.signature !== signature;
    const elapsed = previous ? now - previous.at : Infinity;
    if (!changed || elapsed < 30_000) return;
    ctx.rsiAgentDecision = { signature, at: now };
    this.#emitEvent("rsi.agent.decision", {
      marketKey: ctx.marketKey, agentId: state.agentId, strategyId: state.strategy,
      decision: state.decision, reason: state.waitReason ?? state.reason ?? null,
      rsi: state.rsi ?? null, candidateAt: state.candidateAt ?? null,
      candidateRsi: state.candidateRsi ?? null, stage: state.stage ?? null, strength: state.strength ?? null,
      entryMode: state.entryMode ?? null, expectedCushion: state.expectedCushion ?? null,
      watch: state.watch ?? null,
          strictV2Decision: state.strictV2Decision ?? null, pullbackV2Decision: state.pullbackV2Decision ?? null,
          ...this.#executionMeta({ source: `agent-${state.strategy === "RSI_REVERSAL_V4" ? "v4" : "v3"}:${state.strategy}`, marketKey: ctx.marketKey }),
    });
  }

  /**
   * Caminho NORMAL de ordem V3 (UNICO executavel desta rodada): exige ARM PRACTICE + autoExecute +
   * kill switch OFF + migracao V3 completa + assignment V3 valido + stake esperada (R$10) nos limites oficiais.
   * Sempre termina em requestOrder (Execution Gate unico). REAL nunca passa.
   */
  async submitAgentV3Order({ marketKey, direction, strategyId = null, skill = null, stake = 10, expectedStake = 10, decisionId = null, idempotencyKey = null, candidateAt = null, expiryAt = null, entryMode = null, projection = null, shadow = null } = {}) {
    if (String(this.config.mode).toUpperCase() !== "PRACTICE") throw new IqWsError("AGENT_ORDER_PRACTICE_ONLY", String(this.config.mode));
    if (this.accountContext.context !== ACCOUNT_PRACTICE) throw new IqWsError("AGENT_ORDER_ACCOUNT_NOT_PRACTICE", this.accountContext.context);
    if (this.armState.armed !== true) throw new IqWsError("AGENT_ORDER_SYSTEM_NOT_ARMED");
    if (this.config.autoExecute !== true) throw new IqWsError("AGENT_ORDER_AUTO_EXECUTE_OFF");
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("AGENT_ORDER_KILL_SWITCH");
    if (this.rsiAgentsV3?.migration?.complete !== true) throw new IqWsError("AGENT_ORDER_MIGRATION_IN_PROGRESS");
    const assignment = this.rsiAgentsV3?.assignments?.get(marketKey);
    if (!assignment || assignment.strategy !== strategyId) throw new IqWsError("AGENT_ORDER_ASSIGNMENT_MISMATCH", `${marketKey}:${strategyId}`);
    if (assignment.blocked === true || assignment.eligible !== true) throw new IqWsError("AGENT_ORDER_ASSIGNMENT_BLOCKED", assignment.blockReason ?? "NOT_ELIGIBLE");
    const ctx = this.markets.get(marketKey);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(marketKey));
    const requested = Number(stake);
    const expected = Number(expectedStake);
    if (!Number.isFinite(requested) || requested <= 0) throw new IqWsError("AGENT_ORDER_STAKE_REQUIRED");
    if (!Number.isFinite(expected) || expected !== requested) throw new IqWsError("AGENT_ORDER_STAKE_MISMATCH", `${requested}!=${expected}`);
    const officialCap = Math.min(Number(this.config.globalMaxStake) || expected, Number(ctx.maxStake) || expected, Number(this.config.hardCap) || expected);
    if (expected > officialCap) throw new IqWsError("AGENT_ORDER_STAKE_ABOVE_OFFICIAL_CAP", `${expected}>${officialCap}`);
    return this.requestOrder({ marketKey, direction, stake: requested, decisionId, idempotencyKey, source: "agent-v3:" + (strategyId || "rsi-agents-v3") + ":" + (skill || strategyId || "skill"), horizonSeconds: 60 });
  }

  /**
   * Caminho normal de ordem V4 (UNICO executavel apos a rodada V4): BINARY sincronizado com o broker;
   * BLITZ somente quando o instrumento foi DESCOBERTO e o caminho de ordem verificado (fail-closed).
   * Sempre termina em requestOrder (Execution Gate unico). REAL nunca passa.
   */
  async submitAgentV4Order({ marketKey, direction, strategyId = null, skill = null, stake = 10, expectedStake = 10, decisionId = null, idempotencyKey = null, candidateAt = null, expiryAt = null, instrumentType = "BINARY", durationSeconds = 60, entryMode = null, projection = null, counterEvidence = [] } = {}) {
    if (String(this.config.mode).toUpperCase() !== "PRACTICE") throw new IqWsError("AGENT_ORDER_PRACTICE_ONLY", String(this.config.mode));
    if (this.accountContext.context !== ACCOUNT_PRACTICE) throw new IqWsError("AGENT_ORDER_ACCOUNT_NOT_PRACTICE", this.accountContext.context);
    if (this.armState.armed !== true) throw new IqWsError("AGENT_ORDER_SYSTEM_NOT_ARMED");
    if (this.config.autoExecute !== true) throw new IqWsError("AGENT_ORDER_AUTO_EXECUTE_OFF");
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("AGENT_ORDER_KILL_SWITCH");
    if (this.rsiAgentsV4?.migration?.complete !== true) throw new IqWsError("AGENT_ORDER_MIGRATION_IN_PROGRESS");
    const registry = this.rsiAgentsV4?.instruments?.get?.(`${marketKey}|${String(instrumentType).toUpperCase()}`) ?? null;
    if (!registry || registry.enabled !== true) throw new IqWsError("AGENT_ORDER_MARKET_DISABLED_BY_USER", `${marketKey}:${instrumentType}`);
    const ctx = this.markets.get(marketKey);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(marketKey));
    const requested = Number(stake);
    const expected = Number(expectedStake);
    if (!Number.isFinite(requested) || requested <= 0) throw new IqWsError("AGENT_ORDER_STAKE_REQUIRED");
    if (!Number.isFinite(expected) || expected !== requested) throw new IqWsError("AGENT_ORDER_STAKE_MISMATCH", `${requested}!=${expected}`);
    const officialCap = Math.min(Number(this.config.globalMaxStake) || expected, Number(ctx.maxStake) || expected, Number(this.config.hardCap) || expected);
    if (expected > officialCap) throw new IqWsError("AGENT_ORDER_STAKE_ABOVE_OFFICIAL_CAP", `${expected}>${officialCap}`);
    const instrument = String(instrumentType).toUpperCase();
    const source = "agent-v4:" + (strategyId || "rsi-agents-v4") + ":" + (skill || strategyId || "skill");
    if (instrument === "BLITZ_45S" || instrument === "BLITZ") {
      const duration = Number(durationSeconds) || 45;
      const capability = await this.#blitzCapability({ marketKey, durationSeconds: duration });
      if (capability.supported !== true) throw new IqWsError("BLITZ_ORDER_PATH_UNSUPPORTED", capability.reason);
      return this.requestOrder({ marketKey, direction, stake: requested, decisionId, idempotencyKey, source, horizonSeconds: duration, entryTiming: { instrumentType: "BLITZ_45S", durationSeconds: duration, requestedDuration: duration } });
    }
    return this.requestOrder({ marketKey, direction, stake: requested, decisionId, idempotencyKey, source, horizonSeconds: 60 });
  }

  /**
   * BLITZ so executa quando o instrumento foi descoberto no broker E o caminho de ordem foi verificado.
   * Enquanto nao houver verificacao, permanece fail-closed (nunca simular).
   */
  async #blitzCapability({ marketKey = null, durationSeconds = 45 } = {}) {
    if (!this.pool?.query) return { supported: false, reason: "BLITZ_NO_DB", instrument: null };
    try {
      const rows = (await this.pool.query("SELECT market_key, instrument_type, duration_seconds, enabled, status, payout, payload FROM iq_rsi_instruments WHERE market_key=$1 AND instrument_type IN ('BLITZ_45S','BLITZ') AND duration_seconds=$2", [marketKey, Number(durationSeconds)])).rows ?? [];
      const row = rows[0] ?? null;
      if (!row) return { supported: false, reason: "BLITZ_INSTRUMENT_NOT_OFFERED", instrument: null };
      if (row.enabled !== true) return { supported: false, reason: "BLITZ_DISABLED_BY_USER", instrument: row.instrument_type };
      if (String(row.status ?? "").toUpperCase() !== "OPEN") return { supported: false, reason: `BLITZ_STATUS_${row.status}`, instrument: row.instrument_type };
      const orderPath = row.payload?.orderPath ?? null;
      if (orderPath !== "VERIFIED") return { supported: false, reason: "BLITZ_ORDER_MESSAGE_UNVERIFIED", instrument: row.instrument_type };
      return { supported: true, reason: "BLITZ_ORDER_PATH_VERIFIED", instrument: row.instrument_type };
    } catch (error) {
      return { supported: false, reason: `BLITZ_CAPABILITY_ERROR:${String(error?.message ?? error).slice(0, 80)}`, instrument: null };
    }
  }

  /** V2 LIVE: Strategy Core V2 ORIGINAL (rsi-skills-v2, congelada) com infraestrutura atual. */
  async submitAgentV2LiveOrder({ marketKey, direction, strategyId = null, skill = null, stake = 10, expectedStake = 10, decisionId = null, idempotencyKey = null, candidateAt = null, expiryAt = null, entryMode = null, projection = null, counterEvidence = [] } = {}) {
    const contextPractice = this.accountContext.context === ACCOUNT_PRACTICE;
    const contextRealArmed = this.config.mode === "REAL" && process.env.REAL_TRADING_ENABLED === "true";
    if (!contextPractice && !contextRealArmed) throw new IqWsError("AGENT_ORDER_ACCOUNT_CONTEXT_BLOCKED", String(this.accountContext.context));
    if (String(this.config.mode).toUpperCase() !== "PRACTICE" && !contextRealArmed) throw new IqWsError("AGENT_ORDER_PRACTICE_ONLY", String(this.config.mode));
    if (this.armState.armed !== true) throw new IqWsError("AGENT_ORDER_SYSTEM_NOT_ARMED");
    if (this.config.autoExecute !== true) throw new IqWsError("AGENT_ORDER_AUTO_EXECUTE_OFF");
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("AGENT_ORDER_KILL_SWITCH");
    if (this.rsiAgentsV2Live?.migration?.complete !== true) throw new IqWsError("AGENT_ORDER_MIGRATION_IN_PROGRESS");
    if (this.config.mode === "REAL") {
      const mcp = this.iqMcpBinary;
      if (!mcp?.enabled) throw new IqWsError("MCP_UNAVAILABLE");
      const contract = String(marketKey).includes(":OTC") ? "OTC" : "NORMAL";
      const canonical = String(marketKey).split(":")[0];
      const stamp = this.now();
      if (!this.binaryMcpAssets || stamp - (this.binaryMcpAssetsAt ?? 0) > 600_000) { this.binaryMcpAssets = await mcp.listAssets(); this.binaryMcpAssetsAt = stamp; }
      const norm = (name) => String(name ?? "").replace(/\s*\(OTC\)\s*/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const asset = this.binaryMcpAssets.find((a) => norm(a.name) === canonical && (/OTC/i.test(String(a.name ?? "")) ? "OTC" : "NORMAL") === contract) ?? this.binaryMcpAssets.find((a) => norm(a.name) === canonical);
      if (!asset) throw new IqWsError("MCP_ASSET_NOT_FOUND", canonical);
      if (!this.binaryMcpBalances || stamp - (this.binaryMcpBalancesAt ?? 0) > 60_000) { this.binaryMcpBalances = await mcp.listBalances(); this.binaryMcpBalancesAt = stamp; }
      const balance = this.binaryMcpBalances.find((b) => /regular|real/i.test(String(b.type ?? ""))) ?? this.binaryMcpBalances[0];
      const balanceId = Number(balance?.balance_id ?? balance?.id);
      if (!Number.isFinite(balanceId)) throw new IqWsError("MCP_BALANCE_UNAVAILABLE");
      const uiStake = Number(this.config?.defaultStake) > 0 ? Number(this.config.defaultStake) : Number(this.stakeBrl ?? 1);
      const amount = Number(stake) > 0 ? Number(stake) : uiStake;
      const sizes = Array.isArray(asset.expiration_sizes_seconds) && asset.expiration_sizes_seconds.length ? asset.expiration_sizes_seconds : [60];
      const expirationSize = sizes.includes(60) ? 60 : sizes[0];
      let trade;
      try { trade = await mcp.placeTrade({ balanceId, assetId: asset.asset_id, direction: direction === "SELL" ? "SELL" : "BUY", amount, profitPercent: asset.profit_percent, expirationSize }); }
      catch (error) { if (/profit|stale|price|expiration|size/i.test(String(error?.message ?? ""))) { this.binaryMcpAssets = await mcp.listAssets(); this.binaryMcpAssetsAt = this.now(); const fresh = this.binaryMcpAssets.find((a) => Number(a.asset_id) === Number(asset.asset_id)) ?? asset; trade = await mcp.placeTrade({ balanceId, assetId: fresh.asset_id, direction: direction === "SELL" ? "SELL" : "BUY", amount, profitPercent: fresh.profit_percent, expirationSize }); } else throw error; }
      const positionId = trade?.position_id ?? trade?.id ?? null;
      if (this.pool?.query) await this.pool.query("INSERT INTO iq_executions(requested_at, market_key, direction, stake, state, meta, broker_order_id, account_context) VALUES(now(),$1,$2,$3,'ACKNOWLEDGED',$4::jsonb,$5,'REAL')", [marketKey, direction, amount, JSON.stringify({ source: "agent-v2:" + (strategyId || "rsi-v2") + ":mcp-binary", accountContext: "REAL", mcp: true, assetId: asset.asset_id, entryMode }), positionId !== null ? String(positionId) : null]).catch(() => undefined);
      this.#emitEvent("order.mcp", { marketKey, assetId: asset.asset_id, amount, positionId, mode: "REAL" });
      return { state: "ACKNOWLEDGED", disposition: "EXECUTED", brokerOrderId: positionId, executionId: "mcp-binary-" + positionId, stake: amount, stakeRequested: amount, effectiveStake: amount, mode: "REAL", instrumentType: "BINARY", durationSeconds: expirationSize };
    }
    const registry = this.rsiAgentsV2Live?.instruments?.get?.(`${marketKey}|BINARY`) ?? null;
    if (!registry || registry.enabled !== true) throw new IqWsError("AGENT_ORDER_MARKET_DISABLED_BY_USER", `${marketKey}:BINARY`);
    const ctx = this.markets.get(marketKey);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(marketKey));
    const requested = Number(stake);
    const expected = Number(expectedStake);
    if (!Number.isFinite(requested) || requested <= 0) throw new IqWsError("AGENT_ORDER_STAKE_REQUIRED");
    if (!Number.isFinite(expected) || expected !== requested) throw new IqWsError("AGENT_ORDER_STAKE_MISMATCH", `${requested}!=${expected}`);
    const officialCap = Math.min(Number(this.config.globalMaxStake) || expected, Number(ctx.maxStake) || expected, Number(this.config.hardCap) || expected);
    if (expected > officialCap) throw new IqWsError("AGENT_ORDER_STAKE_ABOVE_OFFICIAL_CAP", `${expected}>${officialCap}`);
    return this.requestOrder({ marketKey, direction, stake: requested, decisionId, idempotencyKey, source: "agent-v2:" + (strategyId || "rsi-agents-v2") + ":" + (skill || strategyId || "skill"), horizonSeconds: 60 });
  }

  /**
   * REGISTRY BLITZ (API OFICIAL/MCP): importa TODOS os ativos habilitados com duracao 45s.
   * Nunca inventa ativo: usa asset_id/name/profit_percent exatamente como o broker devolve.
   */
  async refreshBlitzRegistry({ force = false } = {}) {
    if (!this.iqMcp?.enabled) return { ok: false, reason: "IQ_MCP_TOKEN_MISSING" };
    if (!force && this.now() - (this.lastBlitzSync ?? 0) < 600_000) return { ok: true, cached: true };
    this.lastBlitzSync = this.now();
    try {
      const assets = await this.iqMcp.listAssets({ onlyEnabled: true });
      let upserted = 0;
      for (const asset of assets) {
        const name = String(asset.name ?? "");
        const marketType = /\(OTC\)/i.test(name) ? "OTC" : "NORMAL";
        const canonical = name.replace(/\s*\(OTC\)\s*/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const marketKey = `${canonical}:${marketType}`;
        await this.pool.query(
          `INSERT INTO iq_rsi_instruments(market_key, instrument_type, duration_seconds, market_type, canonical, active_id, enabled, status, payout, source, payload, updated_at)
           VALUES($1,'BLITZ_45S',45,$2,$3,$4,true,'OPEN',$5,'IQ_MCP_BLITZ',$6::jsonb, now())
           ON CONFLICT(market_key, instrument_type, duration_seconds) DO UPDATE SET active_id=$4, status='OPEN', payout=$5, payload=$6::jsonb, updated_at=now()`,
          [marketKey, marketType, canonical, Number(asset.asset_id) || null, Number(asset.profit_percent) || null, JSON.stringify({ assetId: asset.asset_id, name, profitPercent: asset.profit_percent, sizes: asset.expiration_sizes_seconds ?? [], minAmount: asset.minimum_amount ?? null, maxAmount: asset.maximum_amount ?? null })],
        ).catch(() => undefined);
        upserted += 1;
      }
      this.blitzRegistry = { at: this.now(), total: upserted };
      this.#emitEvent("blitz.registry", { total: upserted });
      return { ok: true, total: upserted };
    } catch (error) {
      return { ok: false, reason: String(error?.code ?? error?.message ?? error).slice(0, 140) };
    }
  }

  async blitzAssets() {
    if (!this.pool?.query) return { rows: [], total: 0, enabled: 0 };
    const rows = (await this.pool.query("SELECT market_key, canonical, market_type, active_id, enabled, status, payout, payload, updated_at FROM iq_rsi_instruments WHERE instrument_type='BLITZ_45S' AND duration_seconds=45 ORDER BY market_key")).rows ?? [];
    return { rows, total: rows.length, enabled: rows.filter((row) => row.enabled === true).length, lastSync: this.blitzRegistry ?? null };
  }

  /**
   * ORDEM BLITZ via API OFICIAL (MCP) — MESMO Execution Gate: PRACTICE, ARM, autoExecute, kill switch,
   * stake R$10 e allowlist. Duracao fixa 45s. Nunca chamado sem aprovacao da estrategia.
   */
  async submitAgentBlitzOrder({ marketKey, direction, stake = 10, expectedStake = 10, idempotencyKey = null, entryMode = "BLITZ_IMMEDIATE_45S", decisionId = null } = {}) {
    const source = "agent-v2:RSI_REVERSAL_V2_BLITZ:RSI_REVERSAL_V2_BLITZ";
    const routing = this.#executionRouting(source);
    if (!routing.allowed) {
      this.#auditRecord(`routing_${this.now()}`, marketKey, "EXECUTION_SOURCE_BLOCKED", { marketKey, source, policy: routing.policy, controlsExecution: false }, { persist: true });
      throw new IqWsError("EXECUTION_SOURCE_BLOCKED", `${source} bloqueado pela politica ${routing.policy}`);
    }
    if (String(this.config.mode).toUpperCase() !== "PRACTICE") throw new IqWsError("AGENT_ORDER_PRACTICE_ONLY", String(this.config.mode));
    if (this.accountContext.context !== ACCOUNT_PRACTICE) throw new IqWsError("AGENT_ORDER_ACCOUNT_NOT_PRACTICE", this.accountContext.context);
    if (this.armState.armed !== true) throw new IqWsError("AGENT_ORDER_SYSTEM_NOT_ARMED");
    if (this.config.autoExecute !== true) throw new IqWsError("AGENT_ORDER_AUTO_EXECUTE_OFF");
    if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("AGENT_ORDER_KILL_SWITCH");
    const requested = Number(stake); const expected = Number(expectedStake);
    if (!Number.isFinite(requested) || requested <= 0) throw new IqWsError("AGENT_ORDER_STAKE_REQUIRED");
    if (!Number.isFinite(expected) || expected !== requested) throw new IqWsError("AGENT_ORDER_STAKE_MISMATCH", `${requested}!=${expected}`);
    if (expected > 10) throw new IqWsError("AGENT_ORDER_STAKE_ABOVE_OFFICIAL_CAP", `${expected}>10`);
    const row = (await this.pool.query("SELECT active_id, payload FROM iq_rsi_instruments WHERE market_key=$1 AND instrument_type='BLITZ_45S' AND duration_seconds=45", [marketKey])).rows?.[0] ?? null;
    if (!row) throw new IqWsError("BLITZ_ASSET_NOT_REGISTERED", String(marketKey));
    const assetId = Number(row.active_id);
    let profitPercent = Number(row.payload?.profitPercent);
    if (!Number.isFinite(assetId) || !Number.isFinite(profitPercent)) throw new IqWsError("BLITZ_ASSET_METADATA_MISSING", String(marketKey));
    const balances = await this.iqMcp.listBalances();
    const practice = balances.find((b) => /practice/i.test(String(b.type ?? b.balance_type ?? "")) || b.is_practice === true) ?? balances[0] ?? null;
    const balanceId = Number(practice?.balance_id ?? practice?.id);
    if (!Number.isFinite(balanceId)) throw new IqWsError("BLITZ_BALANCE_UNAVAILABLE");
    let result;
    try {
      result = await this.iqMcp.placeTrade({ balanceId, assetId, direction, amount: requested, profitPercent, expirationSize: 45 });
    } catch (error) {
      // profit_percent velho/divergente: re-sincroniza o registry e tenta 1x com o valor atual.
      if (/profit|stale|price/i.test(String(error?.message ?? ""))) {
        await this.refreshBlitzRegistry({ force: true });
        const fresh = (await this.pool.query("SELECT payload FROM iq_rsi_instruments WHERE market_key=$1 AND instrument_type='BLITZ_45S' AND duration_seconds=45", [marketKey])).rows?.[0]?.payload ?? null;
        profitPercent = Number(fresh?.profitPercent);
        result = await this.iqMcp.placeTrade({ balanceId, assetId, direction, amount: requested, profitPercent, expirationSize: 45 });
      } else throw error;
    }
    this.#emitEvent("blitz.order", { marketKey, assetId, direction, stake: requested, entryMode, positionId: result?.position_id ?? result?.id ?? null });
    return { state: "ACKNOWLEDGED", disposition: "EXECUTED", brokerOrderId: result?.position_id ?? result?.id ?? null, executionId: `blitz-${assetId}-${this.now()}`, stake: requested, stakeRequested: requested, effectiveStake: requested, instrumentType: "BLITZ_45S", durationSeconds: 45, mode: "PRACTICE", entryMode, raw: result };
  }

  /** V1 e V2 nao executam nesta rodada (fail closed explicito). */
  async submitAgentOrder() {
    throw new IqWsError("AGENT_ORDER_V1_PAUSED", "RSI_AGENTS_5x5 pausado (migrado para V3)");
  }

  async submitAgentV2Order() {
    throw new IqWsError("AGENT_ORDER_V2_EXECUTION_DISABLED", "V2 congelada: apenas SHADOW na rodada V3");
  }

  /** Status V3 (rotas legadas /rsi-agents e /rsi-agents-v2 reportam V3 + estado das anteriores). */
  async rsiAgentsStatus() {
    const status = await this.rsiAgentsV3.status();
    const officialStake = { policyStakeBrl: status.stakeBrl ?? null, calculatedBankrollStake: this.config.calculatedBankrollStake, globalMaxStake: this.config.globalMaxStake, hardCap: this.config.hardCap, defaultStake: this.config.defaultStake };
    return { ...status, stake: officialStake, legacyV2: { module: "rsi-agents-v2", frozen: true, enabled: this.rsiAgentsV2?.enabled === true, controlsExecution: false }, context: { mode: this.config.mode, accountContext: this.accountContext.context, armed: this.armState.armed === true, autoExecute: this.config.autoExecute === true, killSwitchEngaged: this.killSwitch.status().executionEnabled !== true, realState: this.realMode.authorized() ? "ARMED" : "LOCKED" }, realAllowlistUntouched: true };
  }

  /* ------------------- RSI VARIANTS 2x2 (STRICT x PULLBACK; 10 OTCs; ordem so via harness) ------------------- */
  #observeRsiVariants(ctx, list, now) {
    if (!this.rsiVariants?.enabled) return null;
    this.rsiVariants.selectOtcUniverse([...this.markets.values()]);
    if (!this.rsiVariants.otcKeys?.includes(ctx.marketKey)) return null;
    if (now - (ctx.rsiVariantsAt ?? 0) < 5_000) return null;
    ctx.rsiVariantsAt = now;
    const serverNow = this.client?.serverNow?.() ?? now;
    const targetExpiryAt = Math.ceil(serverNow / 60_000) * 60_000;
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    const persistSamples = ctx.latency?.dbPersist ?? [];
    const persistP95 = persistSamples.length ? [...persistSamples].sort((a, b) => a - b)[Math.min(persistSamples.length - 1, Math.ceil(0.95 * persistSamples.length) - 1)] : 0;
    return this.rsiVariants.observeMarket({ marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId, candles: list, targetExpiryAt, payout: ctx.payout, now, latency: { ackP95Ms: ackP95, persistP95Ms: persistP95, decisionMs: 30, jitterMs: 300, bufferMs: 150 } });
  }
  async rsiVariantsStatus() { const status = await this.rsiVariants.status(); return { ...status, context: { accountContext: this.accountContext.context, realState: this.realMode.authorized() ? "ARMED" : "LOCKED", killSwitchEngaged: this.killSwitch.status().executionEnabled !== true, brokerConnected: this.session.connected === true }, realAllowlistUntouched: true, fiveWayUntouched: true, rsiReversalUntouched: true }; }
  async rsiVariantsPrepare() { return this.rsiVariants.prepare({ preflight: this.#rsiReversalPreflight() }); }
  async rsiVariantsArm({ phrase = "", actor = "owner" } = {}) { return this.rsiVariants.arm({ phrase, actor, preflight: this.#rsiReversalPreflight() }); }
  async rsiVariantsStop(reason = "MANUAL_STOP") { return this.rsiVariants.stop(reason); }

  /* ------------------- RSI_REVERSAL_CONFLUENCE_V1 (experimento separado; ordem so via harness) ------------------- */
  #observeRsiReversal(ctx, list, now) {
    if (!this.rsiReversal?.enabled) return null;
    if (now - (ctx.rsi5sAt ?? 0) < 5_000) return null; // avaliacao a cada ~5s por mercado
    ctx.rsi5sAt = now;
    const serverNow = this.client?.serverNow?.() ?? now;
    const targetExpiryAt = Math.ceil(serverNow / 60_000) * 60_000; // mesma expiracao Turbo 1m
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    const persistSamples = ctx.latency?.dbPersist ?? [];
    const persistP95 = persistSamples.length ? [...persistSamples].sort((a, b) => a - b)[Math.min(persistSamples.length - 1, Math.ceil(0.95 * persistSamples.length) - 1)] : 0;
    return this.rsiReversal.observeMarket({
      marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId, candles: list,
      targetExpiryAt, payout: ctx.payout, now,
      latency: { ackP95Ms: ackP95, persistP95Ms: persistP95, decisionMs: 30, jitterMs: 300, bufferMs: 150 },
    });
  }

  async rsiReversalStatus() {
    const status = await this.rsiReversal.status();
    return { ...status, context: { accountContext: this.accountContext.context, realState: this.realMode.authorized() ? "ARMED" : "LOCKED", killSwitchEngaged: this.killSwitch.status().executionEnabled !== true, brokerConnected: this.session.connected === true }, realAllowlistUntouched: true, fiveWayUntouched: true };
  }
  async rsiReversalPrepare() { return this.rsiReversal.prepare({ preflight: this.#rsiReversalPreflight() }); }
  async rsiReversalArm({ phrase = "", actor = "owner" } = {}) { return this.rsiReversal.arm({ phrase, actor, preflight: this.#rsiReversalPreflight() }); }
  async rsiReversalStop(reason = "MANUAL_STOP") { return this.rsiReversal.stop(reason); }
  #rsiReversalPreflight() {
    return { accountContext: this.accountContext.context, realState: this.realMode.authorized() ? "ARMED" : "LOCKED", killSwitchEngaged: this.killSwitch.status().executionEnabled !== true, brokerConnected: this.session.connected === true, stakeBrl: 1 };
  }

  /* ------------------- INDICATOR_5M_V1 (control group; nunca executa direto) ------------------- */
  #observeIndicator5M(ctx, candidate, now) {
    if (!this.indicator5m?.enabled || !candidate) return null;
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    const persistSamples = ctx.latency?.dbPersist ?? [];
    const persistP95 = persistSamples.length ? [...persistSamples].sort((a, b) => a - b)[Math.min(persistSamples.length - 1, Math.ceil(0.95 * persistSamples.length) - 1)] : 0;
    const observation = this.indicator5m.observeCandidate({
      marketKey: ctx.marketKey, marketType: ctx.marketType, candles: this.#candleList(ctx),
      targetEntryAt: candidate.targetEntryAt ?? null, targetExpiryAt: candidate.targetExpiryAt ?? null, payout: ctx.payout,
      latency: { ackP95Ms: ackP95, persistP95Ms: persistP95, decisionMs: 50, jitterMs: 300, bufferMs: 150 },
    });
    if (observation) ctx.indicator5mId = observation.id;
    return observation;
  }

  #finalizeIndicator5M(ctx, candidate, now) {
    if (!this.indicator5m?.enabled || !candidate || !ctx.indicator5mId) return null;
    const observation = this.indicator5m.revalidateFinal({ observationId: ctx.indicator5mId, candles: this.#candleList(ctx), atMs: now });
    if (!observation || observation.status !== "READY") return observation;
    const ackSamples = ctx.latency?.orderAck ?? [];
    const ackP95 = ackSamples.length ? [...ackSamples].sort((a, b) => a - b)[Math.min(ackSamples.length - 1, Math.ceil(0.95 * ackSamples.length) - 1)] : 0;
    // Encaminha ao MESMO harness/Execution Gate; em DRY_RUN apenas registra WOULD_EXECUTE.
    void this.fourWay.observeDecision({
      strategyId: "INDICATOR_5M_V1", opportunityId: candidate.id, decisionId: candidate.id,
      marketKey: ctx.marketKey, marketType: ctx.marketType, direction: observation.direction,
      scenario: observation.initialDecision?.confluence ?? null, whyNow: observation.initialDecision?.whyNow ?? null,
      targetEntryAt: candidate.targetEntryAt ?? null, targetExpiryAt: candidate.targetExpiryAt ?? null, payout: ctx.payout,
      snapshot: { marketKey: ctx.marketKey, marketType: ctx.marketType, rsi: observation.initialDecision?.states?.rsiState ?? null, dmi: observation.initialDecision?.states?.dmiDirection ?? null, adx: observation.initialDecision?.states?.adxStrength ?? null, bollinger: observation.initialDecision?.states?.bollingerState ?? null, confluence: observation.initialDecision?.confluence ?? null, timing: observation.timing ?? null, ackP95Ms: ackP95 },
      context: {
        accountContext: this.accountContext.context, brokerAccountType: this.accountContext.context,
        realState: this.realMode.authorized() ? "ARMED" : "LOCKED", realTradingEnabled: process.env.REAL_TRADING_ENABLED === "true",
        killSwitchEngaged: this.killSwitch.status().executionEnabled !== true, brokerConnected: this.session.connected === true,
        dataQuality: "HEALTHY", marketValid: Boolean(ctx.marketKey && ctx.activeId),
      },
    });
    return observation;
  }

  /** Status do INDICATOR_5M_V1 (control group; DRY_RUN ate ARM explicito do harness). */
  indicator5mStatus() {
    const status = this.indicator5m.status();
    return { ...status, enabled: this.config.indicator5mShadowEnabled === true && this.indicator5m.enabled === true, isolation: { shadowOnly: true, controlsExecution: false, sendsOrders: false, sameExpiryRequired: true, autoInvert: false, minimumSafetyMarginMs: 3000 }, realAllowlistUntouched: true };
  }

  /* ------------------- HARNESS PRACTICE_FIVE_WAY_3X_TEST_V1 (DRY_RUN default) ------------------- */
  /** Observa as decisoes finais JA existentes (nao recalcula); WAIT nunca executa. */
  #observeFourWay(ctx, candidate, now, action) {
    if (!this.fourWay || !candidate) return null;
    const snapshotBase = { marketKey: ctx.marketKey, marketType: ctx.marketType, regime: ctx.decisionState?.regime ?? null, setup: ctx.decisionState?.setup ?? null, payout: ctx.payout };
    const context = {
      accountContext: this.accountContext.context,
      brokerAccountType: this.accountContext.context,
      realState: this.realMode.authorized() ? "ARMED" : "LOCKED",
      realTradingEnabled: process.env.REAL_TRADING_ENABLED === "true",
      killSwitchEngaged: this.killSwitch.status().executionEnabled !== true,
      brokerConnected: this.session.connected === true,
      dataQuality: ctx.decisionState?.featuresAvailable === false ? "UNSAFE" : "HEALTHY",
      marketValid: Boolean(ctx.marketKey && ctx.activeId),
    };
    const definitions = [
      { strategyId: "PROFESSIONAL_BRAIN_G2", direction: action, snapshot: { ...snapshotBase, trader: ctx.agents?.trader?.action ?? null, critic: ctx.agents?.critic?.traderAssessment ?? null, consensus: ctx.agents?.consensus?.status ?? null, qualityScore: candidate.quality?.score ?? null, jit: candidate.status ?? null } },
      { strategyId: "PROFESSIONAL_AGENT_SYSTEM_V4", direction: ctx.lastAgentsV4?.action ?? null, snapshot: { ...snapshotBase, scenario: ctx.lastAgentsV4?.scenario ?? null, whyNow: ctx.lastAgentsV4?.whyNow ?? null } },
      { strategyId: "DUAL_REASONING_V1", direction: this.dual?.observations?.get(this.#dualObservationId(ctx, candidate))?.finalAction ?? null, snapshot: { ...snapshotBase, survival: this.dual?.observations?.get(this.#dualObservationId(ctx, candidate))?.thesisSurvival ?? null } },
      { strategyId: "SOLO_REASONING_V1", direction: this.solo?.observations?.get(`solo:${ctx.marketKey}:${candidate.id}`)?.finalAction ?? null, snapshot: { ...snapshotBase, scenario: this.solo?.observations?.get(`solo:${ctx.marketKey}:${candidate.id}`)?.discovery?.primaryScenario ?? null, survival: this.solo?.observations?.get(`solo:${ctx.marketKey}:${candidate.id}`)?.refutation?.survival ?? null } },
    ];
    for (const definition of definitions) {
      if (definition.direction !== "BUY" && definition.direction !== "SELL") continue;
      void this.fourWay.observeDecision({
        strategyId: definition.strategyId, opportunityId: candidate.id, decisionId: candidate.id,
        marketKey: ctx.marketKey, marketType: ctx.marketType, direction: definition.direction,
        scenario: definition.snapshot.scenario ?? null, whyNow: definition.snapshot.whyNow ?? null,
        targetEntryAt: candidate.targetEntryAt ?? null, targetExpiryAt: candidate.targetExpiryAt ?? null,
        payout: ctx.payout, snapshot: definition.snapshot, context,
      });
    }
    return definitions.length;
  }

  /** UNICO ponto de ordem experimental: reusa requestOrder (mesmo Execution Gate/broker adapter). */
  async experimentRequestOrder({ marketKey, direction, stake, decisionId = null, idempotencyKey = null, strategyId = null, experimentId = null } = {}) {
    if (experimentId !== FOUR_WAY_EXPERIMENT_ID) throw new IqWsError("EXPERIMENT_ID_MISMATCH", String(experimentId));
    if (ACCOUNT_PRACTICE !== this.accountContext.context) throw new IqWsError("EXPERIMENT_PRACTICE_ONLY", this.accountContext.context);
    return this.requestOrder({ marketKey, direction, stake, decisionId, idempotencyKey, source: `experiment:${strategyId ?? "unknown"}`, horizonSeconds: 60 });
  }

  /** Status do harness 4x3 (DRY_RUN por padrao; arm independente do REAL). */
  async fourWayStatus() {
    const status = await this.fourWay.status();
    return {
      ...status,
      context: {
        accountContext: this.accountContext.context,
        realState: this.realMode.authorized() ? "ARMED" : "LOCKED",
        killSwitchEngaged: this.killSwitch.status().executionEnabled !== true,
        brokerConnected: this.session.connected === true,
        autoExecute: this.config.autoExecute === true,
      },
      realAllowlistUntouched: true,
    };
  }

  /* ------------------- SOLO_REASONING_V1_SHADOW (controle de simplicidade) ------------------- */
  #observeSolo(ctx, candidate, now) {
    if (!this.solo?.enabled || !candidate) return null;
    const t0 = this.#buildT0ForV4(ctx, this.#candleList(ctx), { now, candidate });
    return this.solo.observe({
      t0,
      candidate: { candidateId: candidate.id, correlationId: candidate.correlationId ?? null, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, payout: ctx.payout },
      g2Action: candidate.action ?? null, v4Action: ctx.lastAgentsV4?.action ?? null,
      dualAction: this.dual?.observations?.get(this.#dualObservationId(ctx, candidate))?.finalAction ?? null,
    });
  }

  /* ------------------- DUAL_REASONING_V1_SHADOW (experimento independente) ------------------- */
  #dualObservationId(ctx, candidate) { return `dual:${ctx?.marketKey ?? "UNKNOWN"}:${candidate?.id ?? "unknown"}`; }
  #observeDualRound1(ctx, candidate, now) {
    if (!this.dual?.enabled || !candidate) return null;
    const t0 = this.#buildT0ForV4(ctx, this.#candleList(ctx), { now, candidate });
    const dualResult = this.dual.observeRound1({
      t0, candidate: { candidateId: candidate.id, correlationId: candidate.correlationId ?? null, targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, payout: ctx.payout },
      g2Action: candidate.action ?? null, v4Action: ctx.lastAgentsV4?.action ?? null, execution: this.#agentsV4Execution(ctx, { now, candidate }),
    });
    // Sidecar: observa o T0 ja produzido, apos a rodada; nunca influencia a decisao.
    this.dualObserver.observe({ observationId: this.#dualObservationId(ctx, candidate), marketKey: ctx.marketKey, round: "R1", t0 });
    return dualResult;
  }
  #observeDualRound2(ctx, candidate, now) {
    if (!this.dual?.enabled || !candidate || candidate.evaluations < 1) return null;
    const observationId = this.#dualObservationId(ctx, candidate);
    if (!this.dual.observations.has(observationId)) return null;
    const t0 = this.#buildT0ForV4(ctx, this.#candleList(ctx), { now, candidate });
    const dualResult = this.dual.observeRound2({ observationId, t0, execution: this.#agentsV4Execution(ctx, { now, candidate }), g2Action: candidate.action ?? null, v4Action: ctx.lastAgentsV4?.action ?? null });
    this.dualObserver.observe({ observationId, marketKey: ctx.marketKey, round: "R2", t0 });
    return dualResult;
  }
  #finalizeDual(ctx, candidate, action, now) {
    if (!this.dual?.enabled || !candidate) return null;
    const observationId = this.#dualObservationId(ctx, candidate);
    if (!this.dual.observations.has(observationId)) return null;
    const t0 = this.#buildT0ForV4(ctx, this.#candleList(ctx), { now, candidate });
    const timingObservation = this.timingShadow.getByCandidate(candidate.id);
    const dualResult = this.dual.finalize({
      observationId, t0, execution: this.#agentsV4Execution(ctx, { now, candidate }),
      candidate: { targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, payout: ctx.payout },
      g2Action: candidate.action ?? null, v4Action: action ?? null,
      lateView: timingObservation ? { lateVerdict: timingObservation.late?.verdict ?? null } : null,
    });
    this.dualObserver.observe({ observationId, marketKey: ctx.marketKey, round: "FINAL", t0 });
    return dualResult;
  }

  #agentsV4RiskContext(ctx, now) {
    const positions = [...this.openPositions.values()].filter((position) => position.marketKey === ctx.marketKey);
    const settled = ctx.settlementState?.daily ?? emptyDailyStats();
    return {
      accountContext: this.accountContext.context, openPositions: positions.length, consecutiveLosses: this.consecutiveLosses ?? 0,
      dailyDrawdownPct: null, payout: ctx.payout, exposure: positions.reduce((sum, position) => sum + (Number(position.stake) || 0), 0),
      stakeCap: Number(this.config.globalMaxStake) || HARD_CAP_STAKE, marketHealthy: ctx.connectionHealth?.connected === true,
      daily: { trades: settled.trades ?? 0, wins: settled.wins ?? 0, losses: settled.losses ?? 0 },
    };
  }

  #agentsV4Execution(ctx, { now, candidate = null } = {}) {
    if (!candidate) return null;
    const serverNow = this.client?.serverNow?.() ?? now;
    const snapshot = candidate.initialFull ?? {};
    const displacement = Number(snapshot?.displacement?.displacementATR ?? snapshot?.displacement ?? null);
    return {
      nowMs: serverNow, candidateAgeMs: Math.max(0, now - (candidate.createdAt ?? now)),
      targetEntryAt: candidate.targetEntryAt ?? null, targetExpiryAt: candidate.targetExpiryAt ?? null,
      submitAt: candidate.submitAt ?? null,
      latencyMs: ctx.latency?.orderAck?.length ? ctx.latency.orderAck[ctx.latency.orderAck.length - 1] : null,
      displacementATR: Number.isFinite(displacement) ? displacement : null,
      newCandlesSinceCandidate: candidate.evaluations ?? null,
      newTicksSinceCandidate: ctx.tickHistory?.length ? Math.max(0, (ctx.tickHistory[ctx.tickHistory.length - 1]?.at ?? 0) - (candidate.createdAt ?? 0)) : null,
      degraded: candidate.changes?.changed === true,
      accountContext: this.accountContext.context,
    };
  }

  #agentsV4DataQuality(ctx, now) {
    // Janelas recentes (5 min): contadores cumulativos tornariam o DQ UNSAFE para sempre apos um reconnect.
    const windowMs = 300_000;
    const countSince = (marks) => (Array.isArray(marks) ? marks.filter((at) => now - at <= windowMs).length : 0);
    const prune = (marks) => { if (Array.isArray(marks)) { const floor = marks.filter((at) => now - at <= windowMs); marks.length = 0; marks.push(...floor); } };
    // `ctx.stats.duplicates` continua medindo reentregas do feed (observabilidade), mas o CHECK de
    // qualidade nao usa esse numero: o protocolo IQ reenvia historico/ultima vela por desenho.
    // Anomalias reais de fluxo aparecem como reorder/gap de sequencia nas janelas abaixo.
    const duplicatesWindow = 0;
    const reorderWindow = countSince(ctx.dqWindow?.reorderAt);
    const gapsWindow = countSince(ctx.dqWindow?.gapAt);
    prune(ctx.dqWindow?.reorderAt); prune(ctx.dqWindow?.gapAt);
    return dataQualityInputFromRuntime(
      {
        ...ctx,
        accountContext: this.accountContext.context,
        timeValid: this.session.timeValid === true,
        clockSkewMs: Number.isFinite(Number(this.session.clockSkewMs)) ? Number(this.session.clockSkewMs) : null,
        connectionHealth: { ...(ctx.connectionHealth ?? {}), connected: ctx.connectionHealth?.connected === true && this.session.connected === true },
      },
      { now, sequenceGaps: gapsWindow, duplicateWindow: duplicatesWindow, reorderWindow, featureStaleMs: DATA_QUALITY_THRESHOLDS.featureStaleMs },
    );
  }

  #observeAgentsV4MarketState(ctx, list, now) {
    if (!this.agentsV4?.enabled) return null;
    if (now - (ctx.agentsV4MarketAt ?? 0) < 15_000) return null;
    ctx.agentsV4MarketAt = now;
    const t0 = this.#buildT0ForV4(ctx, list, { now });
    const view = this.agentsV4.observeMarketState({ t0, risk: this.#agentsV4RiskContext(ctx, now), dataQualityInput: this.#agentsV4DataQuality(ctx, now) });
    if (view && this.dataHub) {
      this.#safe(() => this.dataHub.publish({
        eventType: "FEATURE_SNAPSHOT", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "t0-enriched-v1",
        accountContext: this.accountContext.context, payload: { snapshotId: t0.snapshotId, availableAt: t0.times.availableAt },
      }));
      this.#safe(() => this.dataHub.publish({
        eventType: "AGENT_ANALYSIS", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "agents-v4-engine",
        accountContext: this.accountContext.context, payload: { action: view.result.finalAction, scenario: view.result.scenario.primary, regime: view.result.specialists.MARKET_REGIME_AGENT?.state ?? null, dataQuality: view.result.dataQuality.state, latencyMs: view.latencyMs },
      }));
      this.#safe(() => this.dataHub.publish({
        eventType: "DATA_QUALITY_UPDATE", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "data-quality-agent-v1",
        accountContext: this.accountContext.context, payload: { state: view.result.dataQuality.state, unsafeReasons: view.result.dataQuality.unsafeReasons },
      }));
      this.#safe(() => this.dataHub.publish({
        eventType: "REGIME_UPDATE", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "market-regime-agent-v1",
        accountContext: this.accountContext.context, payload: { regime: view.result.specialists.MARKET_REGIME_AGENT?.state ?? null },
      }));
      this.#safe(() => this.dataHub.publish({
        eventType: "STRUCTURE_UPDATE", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "market-structure-agent-v1",
        accountContext: this.accountContext.context, payload: { structure: view.result.specialists.MARKET_STRUCTURE_AGENT?.state ?? null, bos: t0.structure?.bos?.type ?? null },
      }));
      this.#safe(() => this.dataHub.publish({
        eventType: "SCENARIO_UPDATE", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "scenario-agent-v1",
        accountContext: this.accountContext.context, payload: { scenario: view.result.scenario.primary, direction: view.result.scenario.direction, triggerState: view.result.triggerState, action: view.result.finalAction },
      }));
      const structure1m = t0.timeframes?.structure1m ?? null;
      if (structure1m && ctx.last1mPublished !== structure1m.closedCount) {
        ctx.last1mPublished = structure1m.closedCount;
        this.#safe(() => this.dataHub.publish({
          eventType: "CANDLE_1M", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
          serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "iq-multi-runtime", source: "CANDLE_5S_DERIVED",
          accountContext: this.accountContext.context, payload: { derivedFrom: "CANDLE_5S", closedCount: structure1m.closedCount, label: structure1m.label ?? null },
        }));
      }
      this.#safe(() => this.dataHub.publish({
        eventType: "CANDLE_CONTEXT", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "iq-multi-runtime", source: "T0_ENRICHED_MULTITF",
        accountContext: this.accountContext.context, payload: { structure1m: structure1m?.label ?? null, context5m: t0.timeframes?.context5m?.direction ?? null },
      }));
    }
    return view;
  }

  /** Observacao V4 no candidato G2 (benchmark G2 x V3 x V4) â€” puro SHADOW, zero ordem. */
  #observeAgentsV4Candidate(ctx, { candidate, action, trader, critic, consensus, now, list }) {
    if (!this.agentsV4?.enabled) return null;
    const t0 = this.#buildT0ForV4(ctx, list, { now, candidate });
    const observation = this.agentsV4.observeCandidate({
      t0,
      candidate: {
        candidateId: candidate.id, correlationId: candidate.correlationId ?? null, createdAt: candidate.createdAt,
        targetEntryAt: candidate.targetEntryAt, targetExpiryAt: candidate.targetExpiryAt, entryPrice: candidate.initialFull?.price ?? ctx.lastCandle?.close ?? null,
        payout: ctx.payout, productKind: candidate.initialFull?.productKind ?? null,
      },
      g2Action: action,
      v3Runner: () => {
        const scenario = this.scenarioShadow.getByCandidate(candidate.id);
        const analysis = scenario?.traderScenario ?? scenario?.finalScenario ?? null;
        return { action: scenario?.finalAction ?? "WAIT", primaryScenario: analysis?.primaryScenario ?? null, marketRegime: analysis?.marketRegime ?? null, version: "SCENARIO_ENGINE_V3_FROZEN" };
      },
      execution: this.#agentsV4Execution(ctx, { now, candidate }),
      risk: this.#agentsV4RiskContext(ctx, now),
      dataQualityInput: this.#agentsV4DataQuality(ctx, now),
    });
    if (observation) {
      ctx.lastAgentsV4 = { observationId: observation.id, at: now, action: observation.finalAction, scenario: observation.scenario };
      this.#safe(() => this.dataHub?.publish({
        eventType: "CANDIDATE", marketKey: ctx.marketKey, marketType: ctx.marketType, activeId: ctx.activeId,
        serverTime: ctx.serverTime, receivedAt: now, availableAt: t0.times.availableAt, producer: "agents-v4", source: "agents-v4-engine",
        accountContext: this.accountContext.context, payload: { candidateId: candidate.id, action: observation.finalAction, shadowOnly: true },
      }));
    }
    return observation;
  }

  #finalizeAgentsV4Candidate(ctx, { candidate, now, list }) {
    if (!this.agentsV4?.enabled || !candidate) return null;
    const observationId = ctx.lastAgentsV4?.observationId ?? null;
    if (!observationId) return null;
    const t0 = this.#buildT0ForV4(ctx, list, { now, candidate });
    return this.agentsV4.finalize({
      observationId, t0,
      execution: this.#agentsV4Execution(ctx, { now, candidate }),
      risk: this.#agentsV4RiskContext(ctx, now),
      dataQualityInput: this.#agentsV4DataQuality(ctx, now),
    });
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
      price: ctx.lastCandle?.close ?? null,
      trajectory: this.#trajectory(ctx),
      brainGeneration: BRAIN_GENERATION,
    };
  }

  /** Slopes por avaliacao (ring buffer local; apenas contexto observavel em t0). */
  #trajectory(ctx) {
    const history = (ctx.indicatorHistory ?? []).slice(-10);
    const slope = (pick) => {
      const values = history.map(pick).filter((value) => Number.isFinite(value));
      if (values.length < 3) return null;
      const first = values[0], last = values[values.length - 1];
      return Number(((last - first) / (values.length - 1)).toFixed(4));
    };
    return { rsiSlope: slope((row) => row.rsi), adxSlope: slope((row) => row.adx), diSpreadSlope: slope((row) => row.diSpread), atrSlope: slope((row) => row.atrRatio), donchianDelta: slope((row) => row.donchianPosition), samples: history.length };
  }

  #entryLeadMs() {
    const samples = this.agentLatency.length ? [...this.agentLatency] : [];
    const ackSamples = [...this.markets.values()].flatMap((ctx) => ctx.latency.orderAck).slice(-50);
    return dynamicEntryLeadMs([...ackSamples, ...samples.map((value) => Math.round(value / 10))], { fallback: this.config.entryLeadMs ?? DEFAULT_ENTRY_LEAD_MS });
  }

  #entryMaxDriftMs() { const value = Number(this.config.entryWindowMaxDriftMs); return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_DRIFT_MS; }

  #minTradeQualityScore() { const value = Number(this.config.minTradeQualityScore); return Number.isFinite(value) ? Math.max(MIN_TRADE_QUALITY_SCORE_LIMIT, Math.min(MAX_TRADE_QUALITY_SCORE_LIMIT, Math.round(value))) : DEFAULT_MIN_TRADE_QUALITY_SCORE; }

  #commitCandidate(ctx, reason, detail = {}) {
    const candidate = ctx.candidate;
    if (!candidate) return null;
    if (candidate.finalizeTimer) { clearTimeout(candidate.finalizeTimer); candidate.finalizeTimer = null; }
    candidate.status = "CANCELLED"; candidate.cancelReason = reason; candidate.closedAt = this.now();
    this.timingShadow.markCurrentCancel({ candidateId: candidate.id, reason, atMs: this.now() });
    this.#observeScenarioTimingIntersection(candidate.id);
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
    const allowed = ["jitEnabled", "entryLeadMs", "entryWindowMaxDriftMs", "qualityGateEnabled", "minTradeQualityScore"];
    const next = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!allowed.includes(key)) continue;
      if (key === "jitEnabled" || key === "qualityGateEnabled") next[key] = value === true;
      else if (key === "minTradeQualityScore") next[key] = Math.max(MIN_TRADE_QUALITY_SCORE_LIMIT, Math.min(MAX_TRADE_QUALITY_SCORE_LIMIT, Math.round(Number(value))));
      else if (Number.isFinite(Number(value))) next[key] = key === "entryLeadMs" ? Math.max(MIN_ENTRY_LEAD_MS, Math.min(MAX_ENTRY_LEAD_MS, Math.round(Number(value)))) : Math.max(0, Math.round(Number(value)));
    }
    Object.assign(this.config, next);
    this.config.revision = Number(this.config.revision || 0) + 1;
    void this.#persistConfig();
    this.#emitEvent("entry.config", { config: { jitEnabled: this.config.jitEnabled, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.config.entryWindowMaxDriftMs, qualityGateEnabled: this.config.qualityGateEnabled, minTradeQualityScore: this.#minTradeQualityScore() } });
    return { jitEnabled: this.config.jitEnabled, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.config.entryWindowMaxDriftMs, qualityGateEnabled: this.config.qualityGateEnabled === true, minTradeQualityScore: this.#minTradeQualityScore() };
  }

  entryTimingStatus() {
    const now = this.now();
    const serverNow = this.client?.serverNow?.() ?? now;
    const markets = [...this.markets.values()].filter((ctx) => ctx.candidate || ctx.lastCandidate).map((ctx) => this.#publicEntryTiming(ctx, serverNow));
    return { version: ENTRY_TIMING_VERSION, jitEnabled: this.config.jitEnabled === true, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.#entryMaxDriftMs(), qualityGateEnabled: this.config.qualityGateEnabled === true, minTradeQualityScore: this.#minTradeQualityScore(), markets, scoreboard: this.jit.scoreboard() };
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

  /** LATE WINDOW TIMING (Fase 4): status da politica NOVA em SHADOW (nunca executa nem promove). */
  timingPolicyStatus() {
    const now = this.now();
    const serverNow = this.client?.serverNow?.() ?? now;
    const latency = this.#timingLatencySamples();
    const markets = [...this.markets.values()].flatMap((ctx) => this.timingShadow.activeObservationsForMarket(ctx.marketKey).map((observation) => ({
      marketKey: ctx.marketKey, marketType: ctx.marketType, candidateId: observation.candidateId, direction: observation.direction,
      targetEntryAt: observation.targetEntryAt, targetExpiryAt: observation.targetExpiryAt,
      cutoffExclusiveAt: observation.policy?.window?.cutoffExclusiveAt ?? null, lateDeadlineAt: observation.late?.deadlineAt ?? null,
      marginMs: observation.policy?.margin?.marginMs ?? null, verdict: observation.late?.verdict ?? null,
      secondsToDeadline: observation.late?.deadlineAt === null || observation.late?.deadlineAt === undefined ? null : Math.max(0, Math.round((observation.late.deadlineAt - serverNow) / 1000)),
      evaluations: observation.late?.evaluations?.length ?? 0,
      currentExecuted: observation.current?.ackedAt !== null && observation.current?.ackedAt !== undefined,
      currentCancelReason: observation.current?.cancelReason ?? null,
    })));
    return {
      version: LATE_WINDOW_VERSION, timingPolicyVersion: TIMING_POLICY_LATE, currentPolicyVersion: TIMING_POLICY_CURRENT,
      execution: LATE_WINDOW_POLICY.execution, shadowOnly: true, brokerAutomation: "NONE",
      controlsExecution: false, controlsDirection: false, controlsStake: false,
      scope: LATE_WINDOW_POLICY.scope, cutoffRule: LATE_WINDOW_POLICY.cutoffRule,
      margin: adaptiveLateMarginMs(latency),
      latencySamples: { ack: latency.ackSamples.length, persist: latency.persistSamples.length, decision: latency.decisionSamples.length },
      markets, summary: this.timingShadow.summary(), persist: this.timingShadow.statusSnapshot().persist,
    };
  }

  /** SCENARIO ENGINE V3 (SHADOW): status/observacoes + intersecao observacional com o timing (nunca executa). */
  scenarioShadowStatus() {
    const status = buildScenarioShadowStatus({ observations: this.scenarioShadow.list(), enabled: this.config.scenarioShadowEnabled === true });
    return {
      ...status,
      enabled: this.config.scenarioShadowEnabled === true,
      persist: { ...status.persist, mode: this.scenarioShadow.pool ? "POSTGRES" : "MEMORY" },
      settlement: this.scenarioSettlement.status(),
      intersections: this.scenarioTimingIntersection.status(),
      isolation: {
        ...status.isolation,
        scenarioControlsTiming: false, timingControlsScenario: false, mutatesNeither: true,
        intersectionLayer: "READ_ONLY_COMPARISON",
      },
    };
  }

  /** Status do PROFESSIONAL_AGENT_SYSTEM_V4 (SHADOW) + DataHub. Nunca controla execucao. */
  agentsV4Status() {
    const status = this.agentsV4.status({ benchmarkLimit: 500 });
    return {
      ...status,
      enabled: this.config.agentsV4ShadowEnabled === true && this.agentsV4.enabled === true,
      accountContext: this.accountContext.context,
      dataHub: this.dataHub ? { ...this.dataHub.stats(), epoch: this.dataHub.epochNumber } : null,
      isolation: {
        shadowOnly: true,
        controlsExecution: false,
        sendsOrders: false,
        g2Untouched: true, v3Untouched: true, lateWindowUntouched: true, qualityGateUntouched: true,
        executionGateUntouched: true, stakeUntouched: true, realAllowlistUntouched: true,
      },
    };
  }

  /** Status do DUAL_REASONING_V1_SHADOW (experimento independente; nunca executa). */
  dualReasoningStatus() {
    const status = this.dual.status();
    return {
      ...status,
      enabled: this.config.dualReasoningShadowEnabled === true && this.dual.enabled === true,
      isolation: { shadowOnly: true, controlsExecution: false, sendsOrders: false, redTeamUntouched: true, lateWindowDecoupled: true, g2Untouched: true, v3Untouched: true, v4Untouched: true, stakeUntouched: true, realAllowlistUntouched: true },
      observer: this.dualObserver.status(),
      realAllowlistUntouched: true,
    };
  }

  /** Status do SOLO_REASONING_V1_SHADOW (controle de simplicidade; nunca executa). */
  soloReasoningStatus() {
    const status = this.solo.status();
    return {
      ...status,
      enabled: this.config.soloReasoningShadowEnabled === true && this.solo.enabled === true,
      isolation: { shadowOnly: true, controlsExecution: false, sendsOrders: false, rounds: 1, voting: false, committees: false, g2Untouched: true, v3Untouched: true, v4Untouched: true, dualUntouched: true, lateWindowDecoupled: true, stakeUntouched: true, realAllowlistUntouched: true },
      realAllowlistUntouched: true,
    };
  }

  /** Relatorio observacional do SOLO (rolling; checkpoints imutaveis sao gerados pelo script). */
  async soloReport() {
    const status = this.soloReasoningStatus();
    const observations = this.solo.list();
    const cohort = observations.filter((o) => o.direction === "BUY" || o.direction === "SELL");
    return {
      version: status.version, mode: "SHADOW_ONLY", generatedAtUtc: new Date().toISOString(),
      enabled: status.enabled, isolation: status.isolation, counters: status.counters,
      distributions: status.distributions, selfRefutation: status.selfRefutation,
      projectionAccuracy: status.projectionAccuracy, settlement: status.settlement, latencyMs: status.latencyMs,
      rolling: { label: "ROLLING / NOT CHECKPOINT", directionalSettled: observations.filter((o) => ["WIN", "LOSS", "DRAW"].includes(o.theoreticalResult)).length, observations: observations.length, note: "checkpoints imutaveis (30/60/100/200/500) sao artefatos separados." },
      fourWayCohort: observations.slice(-500).map((o) => ({ id: o.id, marketKey: o.marketKey, at: o.createdAt, g2Action: o.g2Action, v4Action: o.v4Action, dualAction: o.dualAction, soloInitial: o.thesis?.initialAction ?? null, soloFinal: o.finalAction, survival: o.refutation?.survival ?? null, direction: o.direction, result: o.theoreticalResult, initialCounterfactual: o.initialCounterfactual?.result ?? null, scenario: o.discovery?.primaryScenario ?? null })),
      recentDecisions: cohort.slice(-40).map((o) => ({ id: o.id, scenario: o.discovery?.primaryScenario, initial: o.thesis?.initialAction, final: o.finalAction, survival: o.refutation?.survival, strength: o.refutation?.refutationStrength, whyNow: o.thesis?.whyNow })),
      researchOnly: true, controlsExecution: false, sendsOrders: false,
    };
  }

  /** Liga/desliga APENAS o experimento Solo Reasoning. */
  setSoloReasoningEnabled(enabled) {
    this.config.soloReasoningShadowEnabled = enabled === true;
    this.solo.setEnabled(enabled === true);
    this.#emitEvent("solo.reasoning.config", { enabled: this.config.soloReasoningShadowEnabled });
    return { enabled: this.config.soloReasoningShadowEnabled };
  }

  /** Liga/desliga APENAS o experimento Dual Reasoning. */
  setDualReasoningEnabled(enabled) {
    this.config.dualReasoningShadowEnabled = enabled === true;
    this.dual.setEnabled(enabled === true);
    this.#emitEvent("dual.reasoning.config", { enabled: this.config.dualReasoningShadowEnabled });
    return { enabled: this.config.dualReasoningShadowEnabled };
  }

  /** Liga/desliga APENAS a observacao V4 (G2/V3/JIT seguem identicos; nao toca producao). */
  setAgentsV4Enabled(enabled) {
    this.config.agentsV4ShadowEnabled = enabled === true;
    this.agentsV4.setEnabled(enabled === true);
    this.#emitEvent("agents.v4.config", { enabled: this.config.agentsV4ShadowEnabled });
    return { enabled: this.config.agentsV4ShadowEnabled };
  }

  /** Liga/desliga APENAS a observacao de cenario (o timing continua identico; nao toca producao). */
  setScenarioShadowEnabled(enabled) {
    this.config.scenarioShadowEnabled = enabled === true;
    this.scenarioShadow.setEnabled(enabled === true);
    this.#emitEvent("scenario.shadow.config", { enabled: this.config.scenarioShadowEnabled });
    return { enabled: this.config.scenarioShadowEnabled };
  }

  /** Liga/desliga APENAS a intersecao observacional (nenhum dos dois lados e afetado). */
  setScenarioTimingIntersectionEnabled(enabled) {
    this.config.scenarioTimingIntersectionEnabled = enabled === true;
    this.scenarioTimingIntersection.setEnabled(enabled === true);
    return { enabled: this.config.scenarioTimingIntersectionEnabled };
  }

  #auditRecord(correlationId, marketKey, stage, detail = {}, { persist = false, accountContext = null } = {}) {
    const context = accountContext ?? (this.config.mode === "REAL" ? ACCOUNT_REAL : ACCOUNT_PRACTICE);
    const payload = { ...detail, accountContext: detail.accountContext ?? context };
    const record = { correlationId, marketKey, stage, detail: payload, accountContext: context, at: this.now() };
    this.audit.push(record);
    if (this.audit.length > 800) this.audit.splice(0, this.audit.length - 800);
    if (persist) void (async () => {
      try {
        if (!await this.#ensureDb()) { this.#recordPersistResult("audit", false, { code: "DB_UNAVAILABLE", message: "audit persistence unavailable (db not ready)" }); return; }
        // Auditoria OPERACIONAL e prioritaria (nunca dropada pelo scheduler sob pressao).
        const operational = /^(ARM|DISARM|AUTO_ON|AUTO_OFF|STAKE_CHANGE|MESAS_|KILL_SWITCH|ACCOUNT_MODE_CHANGE|MARKET_CONFIG|REAL_)/.test(String(stage ?? ""));
        await this.pool.query(`${operational ? "/*tc-critical*/" : ""}INSERT INTO iq_audit_trail(correlation_id,market_key,stage,detail,account_context) VALUES($1,$2,$3,$4::jsonb,$5)`, [correlationId, marketKey, stage, JSON.stringify(payload), context]);
        this.#recordPersistResult("audit", true);
      } catch (error) { this.#recordPersistResult("audit", false, error); }
    })();
    return record;
  }

  auditTrail({ correlationId = null, marketKey = null, stage = null, limit = 100, accountContext = null } = {}) {
    const bounded = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = [...this.audit].reverse().filter((row) => (!correlationId || row.correlationId === correlationId) && (!marketKey || row.marketKey === marketKey) && (!stage || row.stage === stage) && (!accountContext || row.accountContext === accountContext)).slice(0, bounded);
    return { audit: rows, total: this.audit.length, accountContext: accountContext ?? "ALL" };
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
  async #handleSignal(ctx, action, brain, list, entryTiming = null, options = {}) {
    const now = this.now();
    const signalSource = brain?.setup === "SYNTHETIC_TEST" ? "DIAGNOSTIC_SIGNAL" : "AUTO_DECISION";
    const signalMeta = this.#executionMeta({ source: signalSource, agentId: this.#agentId(ctx), strategyId: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` });
    const bucket = ctx.lastCandle?.bucketStart ?? null;
    const idempotencyKey = `${ctx.marketKey}:${bucket}:${action}`;
    const existing = this.signalLog.find((row) => row.idempotencyKey === idempotencyKey);
    if (existing) {
      const stats = this.#signalStatsFor(ctx.marketKey);
      stats.duplicate += 1;
      existing.attempts = (existing.attempts ?? 1) + 1;
      if (!existing.duplicateLogged) { existing.duplicateLogged = true; this.#emitEvent("signal.disposition", { marketKey: ctx.marketKey, action, disposition: "DUPLICATE", reason: "SINAL_JA_REGISTRADO", signalId: existing.id, ...signalMeta }); }
      return existing;
    }
    const resolved = resolveFinalStake({ marketConfiguredStake: ctx?.configuredStake ?? null, configuredStake: this.config.defaultStake, calculatedBankrollStake: this.config.calculatedBankrollStake, marketMaxStake: ctx.maxStake, globalMaxStake: this.config.globalMaxStake, hardCap: this.config.hardCap });
    const last = list[list.length - 1] ?? ctx.lastCandle ?? null;
    const horizonSeconds = BRAIN_HORIZON_SECONDS;
    const freshness = { fresh: Boolean(ctx.featureState?.fresh) && ctx.lastTickAt !== null && now - ctx.lastTickAt <= MARKET_TICK_AGE_MS, tickAgeMs: ctx.lastTickAt === null ? null : now - ctx.lastTickAt, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE" };
    const realAuthorized = this.config.mode === "REAL" && process.env.REAL_TRADING_ENABLED === "true";
    const brainValid = Boolean(brain?.setup && brain.setup !== "NO_VALID_SETUP");
    const gate = this.gate.evaluate({
      market: options?.probe === true ? { ...ctx, marketKey: ctx.marketKey, availability: "OPEN", paused: false } : { ...ctx, marketKey: ctx.marketKey }, marketKey: ctx.marketKey, requestedMode: this.config.mode, realAuthorized,
      connection: { connected: this.session.connected, timeValid: this.session.timeValid, host: this.session.host },
      serverTime: { ms: this.client?.serverNow() ?? now, skewMs: this.session.clockSkewMs },
      freshness, decision: { action, ageMs: 0, horizonSeconds, reason: ctx.decisionState.reason }, strategy: { valid: brainValid, variantId: brain?.setup ?? null, reason: brainValid ? null : "SEM_SETUP" },
      price: last?.close ?? null, stake: resolved.finalStake, configuredStake: this.config.defaultStake, globalMaxStake: this.config.globalMaxStake, calculatedBankrollStake: this.config.calculatedBankrollStake,
      openPositions: [...this.openPositions.values()], pendingOrderKeys: [...this.pendingOrders.keys()], usedIdempotencyKeys: [...this.idempotency.byKey.keys()], activeMarketKeys: this.activeMarketKeys(),
      killSwitch: this.killSwitch.status(), idempotencyKey, horizonSeconds,
    });
    let disposition = "EXECUTED"; let reason = "AUTORIZADO";
    if (this.killSwitch.status().executionEnabled !== true) { disposition = "BLOCKED"; reason = "PARADA_DE_EMERGENCIA"; }
    else if (this.config.autoExecute !== true && options?.probe !== true) { disposition = "BLOCKED"; reason = "AUTO_DESLIGADO"; }
    else if (this.armState.armed !== true) { disposition = "BLOCKED"; reason = "SISTEMA_DESARMADO"; }
    else if (ctx.paused === true) { disposition = "BLOCKED"; reason = "AGENTE_PAUSADO"; }
    else if (!this.session.connected) { disposition = "BLOCKED"; reason = "SEM_CONEXAO_IQ"; }
    else if (this.pendingOrders.has(ctx.marketKey)) { disposition = "BLOCKED"; reason = "ORDEM_EM_ANDAMENTO"; }
    else if (this.openPositions.has(ctx.marketKey)) { disposition = "BLOCKED"; reason = "POSICAO_JA_ABERTA"; }
    else if (!gate.allowed) { disposition = "BLOCKED"; reason = `GATE_${gate.code}`; }
    const record = {
      id: ++this.signalSeq, marketKey: ctx.marketKey, marketType: ctx.marketType, canonical: ctx.canonical, display: ctx.display, activeId: ctx.activeId,
      accountContext: this.config.mode === "REAL" ? ACCOUNT_REAL : ACCOUNT_PRACTICE,
      action, setup: brain?.setup ?? null, regime: brain?.regime ?? null, strategyVariantId: null, strategySource: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, at: now, bucketStart: bucket, horizonSeconds,
      stakeConfigured: resolved.requestedStake, stakeRequested: resolved.requestedStake, stakeCalculated: Number(this.config.calculatedBankrollStake), stakeFinal: resolved.finalStake, cappedBy: resolved.cappedBy, stakeSource: resolved.source, stakeAdjustment: resolved.adjustment,
      payout: ctx.payout, auto: this.config.autoExecute === true, armed: this.armState.armed === true, mode: this.config.mode,
      entryTiming: entryTiming ? { candidateId: entryTiming.candidateId, targetEntryAt: entryTiming.targetEntryAt, targetExpiryAt: entryTiming.targetExpiryAt, submitAt: entryTiming.submitAt, entryLeadMs: entryTiming.entryLeadMs, revalidatedAt: entryTiming.revalidatedAt, candidateChangedBeforeEntry: entryTiming.candidateChangedBeforeEntry, changedFields: entryTiming.changedFields ?? [] } : null,
      disposition, reason, idempotencyKey, infraProbe: options?.infra === true, excludedFromStats: options?.infra === true, gate: { allowed: gate.allowed, code: gate.code, reasons: gate.reasons, failed: gate.checks.filter((check) => !check.ok).map((check) => check.name) },
      executionId: null, brokerOrderId: null, ackAt: null, settledAt: null, result: null, profit: null, duplicateOf: existing?.id ?? null,
    };
    this.signalLog.push(record);
    if (this.signalLog.length > 500) this.signalLog.splice(0, this.signalLog.length - 500);
    const stats = this.#signalStatsFor(ctx.marketKey); stats.total += 1;
    if (disposition === "BLOCKED") stats.blocked += 1; else stats.executed += 1;
    this.#emitEvent("signal.disposition", { marketKey: ctx.marketKey, action, disposition, reason, signalId: record.id, stakeFinal: record.stakeFinal, auto: record.auto, armed: record.armed, ...signalMeta });
    this.#safe(() => this.log("IQ_MULTI_SIGNAL_DISPOSITION", JSON.stringify({ signalId: record.id, marketKey: ctx.marketKey, action, disposition, reason, stakeFinal: record.stakeFinal, auto: record.auto, armed: record.armed })));
    if (disposition === "BLOCKED" || disposition === "DUPLICATE") return record;
    try {
      const orderSource = signalSource;
      const result = await this.requestOrder({ marketKey: ctx.marketKey, direction: action, stake: null, decisionId: `auto_${ctx.marketKey}_${bucket}`, idempotencyKey, source: orderSource, horizonSeconds, decisionAgeMs: Math.max(0, this.now() - now), entryTiming, infraProbe: options?.infra === true });
      if (result.duplicate) { record.disposition = "DUPLICATE"; record.reason = "IDEMPOTENCIA"; stats.executed = Math.max(0, stats.executed - 1); stats.duplicate += 1; }
      else {
        record.executionId = result.executionId ?? null; record.brokerOrderId = result.brokerOrderId ?? null; record.ackAt = result.state === "ACKNOWLEDGED" ? this.now() : null;
        if (result.state !== "ACKNOWLEDGED") { record.disposition = "BLOCKED"; record.reason = result.state === "UNKNOWN" ? "ACK_DESCONHECIDO" : String(result.state); stats.executed = Math.max(0, stats.executed - 1); stats.blocked += 1; }
      }
      this.#emitEvent("signal.disposition.final", { marketKey: ctx.marketKey, signalId: record.id, disposition: record.disposition, reason: record.reason, brokerOrderId: record.brokerOrderId, ...signalMeta });
      return record;
    } catch (error) {
      record.disposition = "BLOCKED"; record.reason = String(error?.code ?? error?.message ?? error).slice(0, 80);
      stats.executed = Math.max(0, stats.executed - 1); stats.blocked += 1;
      this.#emitEvent("signal.disposition.final", { marketKey: ctx.marketKey, signalId: record.id, disposition: "BLOCKED", reason: record.reason, ...signalMeta });
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

  signals(limit = 50, marketKeyFilter = null, accountContext = null) {
    const bounded = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = [...this.signalLog].reverse().filter((row) => (!marketKeyFilter || row.marketKey === marketKeyFilter) && (!accountContext || row.accountContext === accountContext)).slice(0, bounded);
    const stats = accountContext ? Object.fromEntries([...this.signalStats].filter(([key]) => [...this.signalLog].some((row) => row.accountContext === accountContext && row.marketKey === key))) : Object.fromEntries(this.signalStats);
    return { signals: rows, stats, total: this.signalLog.length, accountContext: accountContext ?? "ALL" };
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

  /**
   * Verificacao de tradabilidade SEM criar posicao (padrao): usa somente estado oficial da sessao
   * (initialization-data: enabled/is_suspended), liveness do get-options e opcoes abertas do ativo.
   * Nenhuma ordem e enviada; nada entra em journal/WR/PnL.
   */
  async tradabilityCheck(marketKey) {
    const ctx = this.markets.get(marketKey);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(marketKey));
    const resolved = this.resolver.get(marketKey) ?? {};
    const evidence = { brokerEnabled: resolved.enabledLive ?? null, brokerSuspended: resolved.suspended ?? null, offered: resolved.offered ?? null, product: resolved.product ?? null, activeId: resolved.activeId ?? null, instrumentTypes: resolved.instrumentTypes ?? [] };
    let optionsLiveness = "NOT_CHECKED";
    let openOptionsForActive = 0;
    if (this.client && this.session.connected) {
      try {
        const { response } = await this.client.getOptions({ limit: 30, instrumentType: "binary,turbo", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId });
        optionsLiveness = "OK";
        openOptionsForActive = (response.msg?.open_options ?? []).filter((row) => Number(row?.active_id ?? row?.activeId) === Number(ctx.activeId)).length;
      } catch (error) { optionsLiveness = `ERROR:${String(error?.code ?? error?.message ?? error).slice(0, 60)}`; }
    }
    const brokerOpen = evidence.brokerEnabled === true && evidence.brokerSuspended === false;
    const tradable = brokerOpen === true ? true : (evidence.offered === true || evidence.offered === false ? false : null);
    return { marketKey, tradable, ordering: false, availability: ctx.availability, evidence: { ...evidence, optionsLiveness, openOptionsForActive, sessionConnected: this.session.connected, timeValid: this.session.timeValid }, checkedAt: this.now() };
  }

  /**
   * Probe de ORDEM (debug manual explicito, nunca periodico): tenta uma ordem minima PRACTICE e, se
   * aceita, marca OPEN por 120s. Marcado como infra: NUNCA entra em journal/WR/PnL/Professor/dataset.
   */
  async probeTradability(marketKey, { stake = null, createPosition = false } = {}) {
    if (createPosition !== true) return this.tradabilityCheck(marketKey);
    const ctx = this.markets.get(marketKey);
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(marketKey));
    const availabilityBefore = ctx.availability;
    const probeStake = Math.max(1, Math.min(10, Number(stake) || this.config.defaultStake || 10));
    const brain = { setup: "INFRA_PROBE", regime: ctx.decisionState?.regime ?? null };
    const record = await this.#handleSignal(ctx, "BUY", brain, this.#candleList(ctx), null, { probe: true, infra: true }).catch((error) => ({ disposition: "BLOCKED", reason: String(error?.code ?? error?.message ?? error), probeError: true }));
    const accepted = record?.disposition === "EXECUTED" || ["ACKNOWLEDGED", "REQUESTED"].includes(String(record?.state ?? ""));
    if (accepted) ctx.probeOverride = { availability: "OPEN", until: this.now() + 120_000, at: this.now(), brokerOrderId: record?.brokerOrderId ?? null };
    this.#auditRecord(`probe_${marketKey}_${this.now()}`, marketKey, "TRADABILITY_ORDER_PROBE", { availabilityBefore, accepted, disposition: record?.disposition ?? null, reason: record?.reason ?? null, brokerOrderId: record?.brokerOrderId ?? null, stake: probeStake, infraProbe: true, excludedFromStats: true }, { persist: true });
    this.#emitEvent("market.tradability_probe", { marketKey, availabilityBefore, accepted, reason: record?.reason ?? null, infraProbe: true });
    return { marketKey, availabilityBefore, availabilityAfter: ctx.availability, accepted, disposition: record?.disposition ?? null, reason: record?.reason ?? null, brokerOrderId: record?.brokerOrderId ?? null, executionId: record?.executionId ?? null, stake: probeStake, infraProbe: true, excludedFromStats: true, practiceOnly: true };
  }

  /** DEBUG temporario: resposta bruta relevante do broker lado a lado com o resolver (nunca adivinha). */  async brokerAudit({ live = true, deep = false } = {}) {
    let probeError = null;
    let openOptions = [];
    if (live && this.client && this.session.connected) {
      try {
        const { response } = await this.client.getInitializationData();
        this.resolver.ingestInitializationData(response.msg);
        this.#applyResolver({ reason: "BROKER_AUDIT" });
      } catch (error) { probeError = `INIT:${String(error?.code ?? error?.message ?? error).slice(0, 80)}`; }
      try {
        const { response } = await this.client.getOptions({ limit: 60, instrumentType: "binary,turbo,digital", balanceId: this.account.practice.balanceId ?? this.account.real.balanceId });
        this.resolver.ingestAuxiliary(response.msg);
        openOptions = (response.msg?.open_options ?? []).map((row) => ({ activeId: Number(row?.active_id ?? row?.activeId ?? null), instrumentType: row?.instrument_type ?? null, optionTypeId: row?.option_type_id ?? null, expired: row?.expired ?? null }));
      } catch (error) { probeError = `${probeError ? probeError + ";" : ""}OPTIONS:${String(error?.code ?? error?.message ?? error).slice(0, 80)}`; }
    }
    const markets = [...this.markets.keys()];
    const evidence = this.resolver.evidence(markets);
    const openOptionsByActive = {};
    for (const option of openOptions) { if (Number.isFinite(option.activeId)) openOptionsByActive[option.activeId] = (openOptionsByActive[option.activeId] ?? 0) + 1; }
    let deepEvidence = null;
    if (deep && live && this.client && this.session.connected) {
      const normalize = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const ourSymbols = new Set();
      for (const ctx of this.markets.values()) { ourSymbols.add(normalize(`${ctx.canonical}${ctx.marketType === "OTC" ? "OTC" : ""}`)); ourSymbols.add(normalize(`${ctx.canonical}-OTC`)); ourSymbols.add(normalize(ctx.canonical)); }
      const instruments = {};
      for (const type of ["turbo-option", "binary-option", "digital-option", "blitz-option"]) {
        try {
          const { response } = await this.client.getInstruments({ type });
          const msg = response?.msg ?? {};
          const rows = Array.isArray(msg) ? msg : (msg.instruments ?? msg.instruments_list ?? msg.data ?? []);
          const matches = rows.filter((row) => ourSymbols.has(normalize(row?.name ?? row?.instrument ?? row?.ticker))).slice(0, 30);
          instruments[type] = { count: rows.length, msgKeys: Object.keys(msg).slice(0, 10), matches: matches.map((row) => ({ name: row?.name ?? row?.instrument ?? null, id: row?.id ?? row?.active_id ?? row?.instrument_id ?? null, enabled: row?.enabled ?? null, suspended: row?.is_suspended ?? null, expiration: row?.expiration ?? row?.expirations ?? null })) };
        } catch (error) { instruments[type] = { error: String(error?.code ?? error?.message ?? error).slice(0, 60) }; }
      }
      const optionsLiveness = {};
      for (const instrumentType of ["turbo", "binary", "digital", "blitz"]) {
        try { const { response } = await this.client.getOptions({ limit: 20, instrumentType, balanceId: this.account.practice.balanceId ?? this.account.real.balanceId }); optionsLiveness[instrumentType] = { msgKeys: Object.keys(response?.msg ?? {}).slice(0, 10), openOptions: (response?.msg?.open_options ?? []).length }; }
        catch (error) { optionsLiveness[instrumentType] = { error: String(error?.code ?? error?.message ?? error).slice(0, 60) }; }
      }
      deepEvidence = { instruments, optionsLiveness };
    }
    return {
      version: "broker-audit-v1", at: this.now(), live, probeError,
      persistence: this.persistenceHealth(),
      connected: this.session.connected, timeValid: this.session.timeValid, host: this.session.host,
      resolver: this.resolver.status(), evidence,
      openOptions: { count: openOptions.length, byActive: openOptionsByActive, sample: openOptions.slice(0, 12) },
      deep: deepEvidence,
      runtimeMarkets: [...this.markets.values()].map((ctx) => ({ marketKey: ctx.marketKey, enabled: ctx.enabled, availability: ctx.availability, activeId: ctx.activeId, instrumentTypes: ctx.instrumentTypes, agentState: ctx.agentState, lastTickAgeMs: ctx.lastTickAt === null ? null : this.now() - ctx.lastTickAt, candles: ctx.candles.size })),
    };
  }

  /** PROSPECTIVE SHADOW LAB (pesquisa): BROKER_EXECUTED / COUNTERFACTUAL / HISTORICAL / PROSPECTIVE separados. */
  shadowLabStatus() {
    const executedTrades = this.journal.trades.map((trade) => ({
      tradeId: trade.tradeId ?? null, marketKey: trade.marketKey ?? null, result: trade.result ?? null,
      pnl: trade.profit ?? trade.pnl ?? null, stake: trade.stake ?? null, payout: trade.payout ?? null, direction: trade.direction ?? null,
      decisionSource: trade.snapshot?.decisionSource ?? null,
    }));
    return {
      ...this.shadowLab.status({ executedTrades }),
      checkpointN: PROSPECTIVE_CHECKPOINT_N,
      note: "SHADOW_ONLY; GATE_CORRECTED_SHADOW/H1/H2/H3/degradacao/contrafactual nunca entram no PnL do broker.",
    };
  }

  /** SHADOW (Fase 6.3): estatisticas por braco de qualidade; nunca altera decisoes. */
  qualityStatus() {
    const trades = this.journal.trades.filter((trade) => trade.entryTiming?.shadowArms && (trade.result === "WIN" || trade.result === "LOSS" || trade.result === "DRAW"));
    const summarize = (rows) => {
      const decided = rows.filter((row) => row.result === "WIN" || row.result === "LOSS" || row.result === "DRAW");
      const wins = decided.filter((row) => row.result === "WIN").length;
      const losses = decided.filter((row) => row.result === "LOSS").length;
      const draws = decided.filter((row) => row.result === "DRAW").length;
      const normalizedPnl = Number(rows.reduce((sum, row) => sum + ((Number(row.pnl) || 0) / (Number(row.stake) || 1)), 0).toFixed(4));
      return { accepted: rows.length, wins, losses, draws, wr: decided.length ? Number((wins / decided.length).toFixed(4)) : null, normalizedPnl, expectancyPerTrade: decided.length ? Number((normalizedPnl / decided.length).toFixed(4)) : null };
    };
    const arms = Object.fromEntries(ARM_IDS.map((arm) => [arm, summarize(trades.filter((trade) => trade.entryTiming.shadowArms[arm]?.decision === "ACCEPT"))]));
    const payoutAvg = trades.length ? Number((trades.reduce((sum, trade) => sum + (Number(trade.payout) || 0), 0) / trades.length).toFixed(2)) : (() => { const payouts = [...this.markets.values()].filter((ctx) => ctx.enabled && Number.isFinite(Number(ctx.payout)) && Number(ctx.payout) > 0).map((ctx) => Number(ctx.payout)); return payouts.length ? Number((payouts.reduce((sum, value) => sum + value, 0) / payouts.length).toFixed(2)) : null; })();
    const health = performanceHealth({ trades: trades.map((trade) => ({ result: trade.result, normalizedPnl: (Number(trade.pnl) || 0) / (Number(trade.stake) || 1) })), coverage: this.jit.counters.candidates ? trades.length / this.jit.counters.candidates : null });
    const outcomes = trades.filter((trade) => trade.review?.initialDecisionQuality || trade.review?.finalDecisionQuality).map((trade) => ({ tradeId: trade.tradeId, initial: trade.review?.initialDecisionQuality ?? null, final: trade.review?.finalDecisionQuality ?? trade.review?.decisionQuality ?? null, outcome: trade.result }));
    return {
      version: TRADE_QUALITY_VERSION, shadowOnly: true, mode: this.config.mode, stake: Number(this.config.defaultStake),
      trades: trades.length, breakEvenWR: payoutAvg ? BREAK_EVEN_WR(payoutAvg) : null, avgPayout: payoutAvg,
      arms, health, outcomes,
      counters: this.jit.counters, note: "Bracos SHADOW; nenhuma alteracao de direcao ou bloqueio operacional. Evidencia prospectiva comeca na data de implantacao.",
    };
  }
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

  journalSummary(accountContext = null) {
    const tradeContext = (trade) => trade.accountContext === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE;
    const trades = accountContext ? this.journal.trades.filter((trade) => tradeContext(trade) === accountContext) : this.journal.trades;
    const agentIds = [...new Set(trades.map((trade) => trade.agentId).filter(Boolean))];
    return {
      version: "trade-journal-v1", accountContext: accountContext ?? "ALL",
      agents: agentIds.map((agentId) => ({ agentId, stats: this.journal.agentMemory(agentId).stats })),
      recentTrades: trades.slice(-30).reverse(),
      daily: accountContext ? null : this.journal.dailyReport(),
      isolation: { practiceTrades: this.journal.trades.filter((trade) => tradeContext(trade) === ACCOUNT_PRACTICE).length, realTrades: this.journal.trades.filter((trade) => tradeContext(trade) === ACCOUNT_REAL).length },
    };
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


  portfolioSnapshot(accountContext = null) {
    const allPositions = [...this.openPositions.values()].map((position) => ({ ...position, accountContext: position.accountContext ?? ACCOUNT_PRACTICE }));
    const openPositions = accountContext ? filterByAccountContext(allPositions, accountContext) : allPositions;
    const exposure = concentrationExposure(openPositions);
    const dailyFor = (context) => {
      if (context) {
        const buckets = [...this.markets.values()].map((ctx) => ctx.settlementState?.dailyByContext?.[context]).filter(Boolean);
        const bucket = { wins: 0, losses: 0, draws: 0, pnl: 0, trades: 0 };
        for (const row of buckets) { bucket.wins += row.wins; bucket.losses += row.losses; bucket.draws += row.draws; bucket.pnl += row.settledPnl; bucket.trades += row.trades; }
        return bucket;
      }
      return [...this.markets.values()].reduce((acc, ctx) => {
        acc.wins += ctx.settlementState.daily.wins; acc.losses += ctx.settlementState.daily.losses; acc.draws += ctx.settlementState.daily.draws; acc.pnl += ctx.settlementState.daily.settledPnl; acc.trades += ctx.settlementState.daily.trades;
        return acc;
      }, { wins: 0, losses: 0, draws: 0, pnl: 0, trades: 0 });
    };
    const settled = dailyFor(accountContext);
    const byContext = {
      PRACTICE: { ...dailyFor(ACCOUNT_PRACTICE), pnl: Number(dailyFor(ACCOUNT_PRACTICE).pnl.toFixed(4)), openPositions: filterByAccountContext(allPositions, ACCOUNT_PRACTICE).length },
      REAL: { ...dailyFor(ACCOUNT_REAL), pnl: Number(dailyFor(ACCOUNT_REAL).pnl.toFixed(4)), openPositions: filterByAccountContext(allPositions, ACCOUNT_REAL).length },
    };
    return {
      accountContext: accountContext ?? "ALL",
      openPositions: openPositions.map((position) => ({ marketKey: position.marketKey, accountContext: position.accountContext, direction: position.direction, stake: position.stake, entryPrice: position.entryPrice, brokerOrderId: position.brokerOrderId, openedAt: position.openedAt, indicative: position.indicative ?? null })),
      exposure: exposure.exposures, concentrationWarnings: exposure.warnings,
      settled: { ...settled, pnl: Number(settled.pnl.toFixed(4)) }, byContext,
      practiceBalance: this.account.practice.balance, realBalance: this.account.real.balance,
    };
  }

  /**
   * ROTEAMENTO DE EXECUCAO (fail-closed): com `executionAllowlist` definida, SOMENTE fontes
   * da allowlist podem chegar ao broker. Qualquer outra origem (brain G2/AUTO_DECISION,
   * diagnostico, experimentos, manual) e bloqueada e auditada — nenhuma delas executa.
   */
  #decisionSourceFor(source) {
    const raw = String(source ?? "");
    if (raw.startsWith("agent-v4:")) return "AGENT_V4";
    if (raw.startsWith("agent-v3:")) return "AGENT_V3";
    if (raw.startsWith("agent-v2:")) return "AGENT_V2";
    if (raw.startsWith("agent:")) return "AGENT_V1";
    if (raw.startsWith("experiment:")) return "EXPERIMENT";
    return decisionSourceOf({ source: raw, setup: null, infraProbe: raw === "INFRA_PROBE" });
  }

  #executionPolicyLabel() {
    if (this.executionPolicyName) return this.executionPolicyName;
    const list = Array.isArray(this.executionAllowlist) ? this.executionAllowlist : null;
    if (!list) return "PERMISSIVE";
    if (list.some((entry) => String(entry).startsWith("agent-v4:"))) return "RSI_V4_ONLY";
    if (list.some((entry) => String(entry).startsWith("agent-v3:"))) return "RSI_V3_ONLY";
    if (list.some((entry) => String(entry).startsWith("agent-v2:"))) return "RSI_V2_ONLY";
    return "CUSTOM_ALLOWLIST";
  }

  #executionRouting(source) {
    const raw = String(source ?? "MANUAL");
    const allowlist = Array.isArray(this.executionAllowlist) ? this.executionAllowlist : null;
    const allowed = !allowlist || allowlist.some((prefix) => raw === prefix || raw.startsWith(`${prefix}:`) || raw.startsWith(`${prefix}|`) || raw.startsWith(`${prefix},`));
    const isAgent = raw.startsWith("agent-v2:") || raw.startsWith("agent-v3:") || raw.startsWith("agent-v4:");
    const strategyId = isAgent ? raw.split(":")[1] ?? null : raw === "AUTO_DECISION" || raw === "DIAGNOSTIC_SIGNAL" ? `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}` : raw.startsWith("experiment:") ? raw.slice("experiment:".length) : null;
    return { source: raw, allowed, policy: this.#executionPolicyLabel(), strategyId, decisionSource: this.#decisionSourceFor(raw), controlsExecution: allowed === true };
  }

  #executionMeta({ source, agentId = null, strategyId = null, marketKey = null } = {}) {
    const routing = this.#executionRouting(source);
    const agentSource = routing.source.startsWith("agent-v2:") || routing.source.startsWith("agent-v3:") || routing.source.startsWith("agent-v4:");
    return {
      agentId: agentId ?? (agentSource && marketKey ? `${routing.strategyId}:${marketKey}` : null),
      strategyId: strategyId ?? routing.strategyId,
      decisionSource: routing.decisionSource,
      controlsExecution: routing.controlsExecution,
      executionPolicy: routing.policy,
    };
  }

  /** Prova de roteamento: para cada origem conhecida, pode ou nao chegar a requestOrder. */
  executionRoutingStatus() {
    const allowlist = Array.isArray(this.executionAllowlist) ? this.executionAllowlist : null;
    const row = (source, agentId = null, strategyId = null) => {
      const routing = this.#executionRouting(source);
      return { source, agentId, strategyId: strategyId ?? routing.strategyId, decisionSource: routing.decisionSource, controlsExecution: routing.controlsExecution, canReachRequestOrder: routing.allowed === true && this.killSwitch.status().executionEnabled === true, reason: routing.allowed ? "ALLOWED_BY_POLICY" : "EXECUTION_SOURCE_BLOCKED" };
    };
    return {
      version: "execution-routing-v1",
      policy: this.#executionPolicyLabel(),
      enabled: allowlist !== null,
      allowlist,
      mode: this.config.mode,
      armed: this.armState.armed === true,
      autoExecute: this.config.autoExecute === true,
      killSwitchExecutionEnabled: this.killSwitch.status().executionEnabled === true,
      realLocked: !this.realMode.authorized(),
      practiceOnly: String(this.config.mode).toUpperCase() === "PRACTICE",
      singleGate: "runtime.requestOrder (Execution Gate unico)",
      sources: [
        row("agent-v4:RSI_REVERSAL_V4:RSI_REVERSAL_V4", "RSI_REVERSAL_V4:<marketKey>", "RSI_REVERSAL_V4"),
        row("agent-v3:RSI_REVERSAL_PULLBACK_V3:RSI_REVERSAL_PULLBACK_V3", "RSI_REVERSAL_PULLBACK_V3:<marketKey>", "RSI_REVERSAL_PULLBACK_V3"),
        row("agent-v2:RSI_REVERSAL_STRICT_V2:RSI_REVERSAL_STRICT_V2", "RSI_REVERSAL_STRICT_V2:<marketKey>", "RSI_REVERSAL_STRICT_V2"),
        row("agent-v2:RSI_EXTREME_PULLBACK_V2:RSI_EXTREME_PULLBACK_V2", "RSI_EXTREME_PULLBACK_V2:<marketKey>", "RSI_EXTREME_PULLBACK_V2"),
        row("agent:RSI_REVERSAL_STRICT:RSI_REVERSAL_STRICT_V1", null, "RSI_REVERSAL_STRICT_V1"),
        row("agent:RSI_EXTREME_PULLBACK:RSI_EXTREME_PULLBACK_V1", null, "RSI_EXTREME_PULLBACK_V1"),
        row("AUTO_DECISION", "trader:<marketKey>", `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`),
        row("DIAGNOSTIC_SIGNAL", "trader:<marketKey>", `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`),
        row("MANUAL", null, null),
        row("INFRA_PROBE", null, "INFRA_PROBE"),
        row("experiment:RSI_REVERSAL_CONFLUENCE_V1", null, "RSI_REVERSAL_CONFLUENCE_V1"),
        row("experiment:RSI_STRICT_PULLBACK_2X2_V1", null, "RSI_STRICT_PULLBACK_2X2_V1"),
        row("experiment:PRACTICE_FOUR_WAY_3X_TEST_V1", null, "PRACTICE_FOUR_WAY_3X_TEST_V1"),
        row("experiment:INDICATOR_5M_V1", null, "INDICATOR_5M_V1"),
      ],
    };
  }

  async requestOrder({ marketKey: key, direction, stake = null, decisionId = null, horizonSeconds = 60, idempotencyKey = null, source = "MANUAL", autoDisarmAfterAck = false, decisionAgeMs = 0, entryTiming = null, infraProbe = false } = {}) {
    const routing = this.#executionRouting(source);
    if (!routing.allowed) {
      this.#safe(() => this.log("IQ_MULTI_EXECUTION_SOURCE_BLOCKED", JSON.stringify({ marketKey: key, source: routing.source, policy: routing.policy, reason: routing.reason ?? "EXECUTION_SOURCE_BLOCKED" })));
      this.#auditRecord(`routing_${this.now()}`, key, "EXECUTION_SOURCE_BLOCKED", { marketKey: key, source: routing.source, strategyId: routing.strategyId, decisionSource: routing.decisionSource, policy: routing.policy, allowlist: this.executionAllowlist ?? null, controlsExecution: false }, { persist: true });
      this.#emitEvent("execution.source_blocked", { marketKey: key, source: routing.source, strategyId: routing.strategyId, decisionSource: routing.decisionSource, controlsExecution: false, policy: routing.policy, reason: "EXECUTION_SOURCE_BLOCKED" });
      throw new IqWsError("EXECUTION_SOURCE_BLOCKED", `${routing.source} bloqueado pela politica ${routing.policy}`);
    }
    const ctx = this.markets.get(key);
      if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    if (!this.client || !this.session.connected) throw new IqWsError("WS_DISCONNECTED");
    if (this.pendingOrders.has(key)) throw new IqWsError("ORDER_IN_FLIGHT", key);
    if (this.openPositions.has(key)) throw new IqWsError("POSITION_ALREADY_OPEN", key);
    if (this.config.mode === "REAL" && !this.account.real.available) throw new IqWsError("REAL_BALANCE_UNAVAILABLE");
    const last = this.#candleList(ctx).pop();
    const freshness = { fresh: Boolean(ctx.featureState?.fresh) && ctx.lastTickAt !== null && this.now() - ctx.lastTickAt <= MARKET_TICK_AGE_MS, tickAgeMs: ctx.lastTickAt === null ? null : this.now() - ctx.lastTickAt, reason: ctx.featureState?.freshnessReason ?? "NO_FEATURE" };
    const realAuthorized = this.config.mode === "REAL" && process.env.REAL_TRADING_ENABLED === "true";
    const resolvedStake = resolveFinalStake({ requestedStake: Number.isFinite(Number(stake)) && Number(stake) > 0 ? Number(stake) : undefined, marketConfiguredStake: ctx?.configuredStake ?? null, configuredStake: this.config.defaultStake, calculatedBankrollStake: this.config.calculatedBankrollStake, marketMaxStake: ctx.maxStake, globalMaxStake: this.config.globalMaxStake, hardCap: this.config.hardCap });
    const finalStake = resolvedStake.finalStake;
    if (!Number.isFinite(finalStake) || finalStake <= 0) throw new IqWsError("NO_STAKE_CONFIGURED");
    const requestedKey = String(idempotencyKey ?? `${key}:${decisionId ?? this.now()}`).slice(0, 160);
    const existingRecord = this.idempotency.get(requestedKey);
    if (existingRecord) return { duplicate: true, marketKey: key, state: existingRecord.state, executionId: existingRecord.executionId, brokerOrderId: existingRecord.brokerOrderId, idempotencyKey: requestedKey, stake: Number.isFinite(Number(existingRecord.stake)) ? Number(existingRecord.stake) : null, stakeRequested: Number.isFinite(Number(stake)) && Number(stake) > 0 ? Number(stake) : null };
    const decisionAction = direction === "BUY" || direction === "CALL" ? "BUY" : direction === "SELL" || direction === "PUT" ? "SELL" : null;
    if (!decisionAction) throw new IqWsError("INVALID_DIRECTION", String(direction));
    const setupFromState = ctx.decisionState?.setup && ctx.decisionState.setup !== "NO_VALID_SETUP" ? ctx.decisionState.setup : null;
    const brainSetup = { setup: setupFromState ?? "SYNTHETIC_TEST", regime: ctx.decisionState?.regime ?? null };
    // Ordem manual/API e acao deliberada do operador; o gate de setup vale para decisoes AUTO do brain.
    const setupValid = source !== "AUTO_DECISION" || (brainSetup.setup !== "NO_VALID_SETUP" && brainSetup.setup !== "SYNTHETIC_TEST");
    const gateResult = this.gate.evaluate({
      market: { ...(ctx ?? {}), maxStake: ctx?.maxStake ?? this.config.hardCap, marketKey: key }, marketKey: key, requestedMode: this.config.mode, realAuthorized,
      connection: { connected: this.session.connected, timeValid: this.session.timeValid, host: this.session.host },
      serverTime: { ms: this.client.serverNow(), skewMs: this.session.clockSkewMs },
      freshness, decision: { action: decisionAction, ageMs: Number(decisionAgeMs) || 0, horizonSeconds, reason: ctx.decisionState.reason }, strategy: { valid: setupValid, variantId: brainSetup.setup, reason: setupValid ? null : "SEM_SETUP_VALIDO" },
      price: last?.close ?? null, stake: finalStake, configuredStake: this.config.defaultStake, globalMaxStake: this.config.globalMaxStake, calculatedBankrollStake: this.config.calculatedBankrollStake,
      openPositions: [...this.openPositions.values()], pendingOrderKeys: [...this.pendingOrders.keys()], usedIdempotencyKeys: [...this.idempotency.byKey.keys()], activeMarketKeys: this.activeMarketKeys(), killSwitch: this.killSwitch.status(), idempotencyKey: requestedKey, horizonSeconds,
    });
    if (!gateResult.allowed) throw new IqWsError(`PORTFOLIO_GATE_${gateResult.code}`, gateResult.reasons.join(","));
    let record;
    let mode = this.config.mode;
    const orderContext = mode === "REAL" ? ACCOUNT_REAL : ACCOUNT_PRACTICE;
    if (mode === "REAL") {
      // ISOLAMENTO + FAIL CLOSED: ordem REAL so existe com accountContext=REAL, ARM explicito,
      // REAL_TRADING_ENABLED, killSwitch OFF, riskGate PASS, dataQuality HEALTHY, strategy no
      // allowlist congelado, stake <= hardCap, mercado permitido, idempotencia valida e conta
      // real acessivel/sem ambiguidade. Qualquer falha => BLOCK (nunca envia).
      const accountGate = this.accountContext.evaluateSend(this.#realGateInput({
        strategy: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`,
        stake: finalStake,
        marketKey: key,
        marketAllowed: ctx.enabled === true && ctx.availability === "OPEN",
        idempotencyValid: existingRecord === null,
        riskGate: "PASS",
        accountAccessible: this.account.real.available === true,
        accountUnambiguous: this.account.real.balanceId !== null && this.account.real.balanceId !== undefined,
      }));
      this.accountContext.recordRealAttempt("GATE", {
        strategy: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`,
        decisionId: decisionId ?? null, stake: finalStake, marketKey: key, direction: decisionAction,
        expiry: null, send: false, ack: null, brokerOrderId: null, settlement: null, blockedBy: accountGate.blockedBy,
      });
      if (!accountGate.ok) throw new IqWsError("REAL_GATE_BLOCKED", accountGate.blockedBy.join(","));
      this.#auditRecord(`real_gate_${this.now()}`, key, "REAL_GATE_PASS", { accountContext: ACCOUNT_REAL, strategy: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, stake: finalStake, direction: decisionAction, checks: accountGate.checks.map((check) => ({ id: check.id, ok: check.ok })) }, { persist: true, accountContext: ACCOUNT_REAL });
    }
    if (mode === "PRACTICE") {
      const practice = executionGate(
        { action: decisionAction, stake: finalStake, decisionId: decisionId ?? `ord_${this.now()}`, asset: key, horizonSeconds, decisionAgeMs: Number(decisionAgeMs) || 0, marketOpen: true, idempotencyKey: requestedKey },
        { armState: this.armState, userLimitBrl: Math.min(this.config.globalMaxStake, ctx.maxStake), brokerCurrency: this.account.practice.currency ?? "BRL", fxRate: 1, killSwitch: this.killSwitch, idempotency: this.idempotency, accountType: "PRACTICE", expectedAsset: key },
      );
      if (practice.duplicate) return { duplicate: true, marketKey: key, state: practice.record.state, executionId: practice.record.executionId, brokerOrderId: practice.record.brokerOrderId, idempotencyKey: requestedKey, stake: finalStake, stakeRequested: resolvedStake.requestedStake };
      record = practice.record;
    } else {
      this.realMode.authorizeOrder({ stake: finalStake, marketKey: key });
      const registered = this.idempotency.register(requestedKey, { direction: decisionAction, stake: finalStake, asset: key, horizonSeconds, decisionId: decisionId ?? null, mode: "REAL" });
      if (registered.duplicate) return { duplicate: true, marketKey: key, state: registered.record.state, executionId: registered.record.executionId, brokerOrderId: registered.record.brokerOrderId, idempotencyKey: requestedKey, stake: finalStake, stakeRequested: resolvedStake.requestedStake };
      record = registered.record;
    }
    const serverSec = (this.client.serverNow() ?? this.now()) / 1000;
    const expiration = computeExpiration(serverSec, Math.max(1, Math.round(Number(horizonSeconds) / 60)));
    if (expiration.optionKind === "turbo" && Array.isArray(ctx.instrumentTypes) && ctx.instrumentTypes.length && !ctx.instrumentTypes.includes("turbo")) throw new IqWsError("INSTRUMENT_NOT_AVAILABLE_FOR_HORIZON", `${key}: turbo indisponivel (${ctx.instrumentTypes.join(",")})`);
    // JIT: o contrato precisa expirar exatamente no targetExpiryAt do candidato; fail-closed se o broker nao aceitar essa janela.
    if (entryTiming?.targetExpirySec && Number(expiration.expiration) !== Number(entryTiming.targetExpirySec)) throw new IqWsError("ENTRY_EXPIRATION_MISMATCH", `broker=${expiration.expiration} target=${entryTiming.targetExpirySec}`);
    const submitAtMs = this.now();
    if (entryTiming?.revalidatedAt) this.#recordLatency(ctx, "decisionToSubmit", Math.max(0, submitAtMs - Number(entryTiming.revalidatedAt)));
    const entryPrice = last?.close ?? null;
    const directionWire = decisionAction === "BUY" ? "CALL" : "PUT";
    const pending = {
      executionId: record.executionId, idempotencyKey: requestedKey, requestId: requestedKey, marketKey: key, mode, direction: directionWire, action: decisionAction,
      accountContext: orderContext,
      stake: finalStake, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeAdjustment: resolvedStake.adjustment, activeId: ctx.activeId, symbol: ctx.display, expirationSec: expiration.expiration, optionKind: expiration.optionKind,
      entryPrice, requestedAt: this.now(), connectionId: this.connection?.connectionId ?? null, autoDisarmAfterAck: autoDisarmAfterAck === true, source, ackResolved: false, settling: false,
      correlationId: ctx.agents?.correlationId ?? `corr_exec_${record.executionId}`,
      infraProbe: infraProbe === true,
      entryTiming: entryTiming ? { candidateId: entryTiming.candidateId, targetEntryAt: entryTiming.targetEntryAt, targetExpiryAt: entryTiming.targetExpiryAt, targetExpirySec: Number(entryTiming.targetExpirySec ?? Math.round(entryTiming.targetExpiryAt / 1000)), submitAt: entryTiming.submitAt, submitAtMs, entryLeadMs: entryTiming.entryLeadMs, revalidatedAt: entryTiming.revalidatedAt, candidateChangedBeforeEntry: entryTiming.candidateChangedBeforeEntry === true, shadowArms: entryTiming.shadowArms ?? null, t0Snapshot: entryTiming.t0Snapshot ?? entryTiming.initialSnapshot ?? null, shadowObservationId: entryTiming.shadowObservationId ?? null, directionChanges: (entryTiming.changedFields ?? []).filter((change) => change.field === "action").length } : null,
    };
    this.#auditRecord(pending.correlationId, key, "ORDER_SENT", { executionId: record.executionId, direction: directionWire, stake: finalStake, requestedStake: resolvedStake.requestedStake, stakeSource: resolvedStake.source, mode, source, expiration: expiration.expiration, optionKind: expiration.optionKind, candidateId: entryTiming?.candidateId ?? null, targetEntryAt: entryTiming?.targetEntryAt ?? null, submitAtMs, entryLeadMs: entryTiming?.entryLeadMs ?? null }, { persist: true });
    const ackPromise = new Promise((resolve) => { pending.ackResolve = resolve; });
    this.pendingOrders.set(key, pending);
    ctx.positionState = { status: "ORDERING", direction: directionWire, entryPrice, stake: finalStake, brokerOrderId: null, requestId: requestedKey, expirationSec: expiration.expiration, openedAt: this.now(), settledAt: null, result: null, profit: null, mode, accountContext: orderContext };
    this.#setAgent(ctx, "ORDERING", source);
    this.#emitEvent("order.pending", { marketKey: key, direction: directionWire, stake: finalStake, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeAdjustment: resolvedStake.adjustment, mode, expirationSec: expiration.expiration, source, ...this.#executionMeta({ source, marketKey: key }) });
    const persistStartedAt = this.now();
    await this.#persistExecution({ executionId: record.executionId, idempotencyKey: requestedKey, decisionId: record.payload?.decisionId ?? decisionId ?? null, marketKey: key, mode, accountContext: orderContext, connectionId: pending.connectionId, accountType: mode, brokerOrderId: null, symbol: ctx.display, activeId: ctx.activeId, direction: directionWire, stake: finalStake, currency: mode === "REAL" ? this.account.real.currency : this.account.practice.currency, state: "REQUESTED", requestId: requestedKey, expirationAt: nowIso(expiration.expiration * 1000), entryPrice, payout: ctx.payout, optionKind: expiration.optionKind, meta: { source, infraProbe: infraProbe === true, excludedFromStats: infraProbe === true, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeAdjustment: resolvedStake.adjustment, setup: brainSetup.setup, strategyVariantId: null, strategySource: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, entryTiming: pending.entryTiming ? { candidateId: pending.entryTiming.candidateId, targetEntryAt: pending.entryTiming.targetEntryAt, targetExpiryAt: pending.entryTiming.targetExpiryAt, submitAt: pending.entryTiming.submitAt, submitAtMs, entryLeadMs: pending.entryTiming.entryLeadMs, revalidatedAt: pending.entryTiming.revalidatedAt, candidateChangedBeforeEntry: pending.entryTiming.candidateChangedBeforeEntry } : null } });
    this.#recordLatency(ctx, "dbPersist", Math.max(0, this.now() - persistStartedAt));
    try {
      const balanceId = mode === "REAL" ? this.account.real.balanceId : this.account.practice.balanceId;
      if (orderContext === ACCOUNT_REAL) {
        this.accountContext.recordRealAttempt("SEND", { strategy: this.accountContext.armedMeta?.strategy ?? null, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, candidateId: entryTiming?.candidateId ?? null, decisionId: decisionId ?? null, stake: finalStake, marketKey: key, direction: decisionAction, expiry: expiration.expiration, send: true, ack: null, brokerOrderId: null, settlement: null, executionId: record.executionId, idempotencyKey: requestedKey, mode });
        this.#auditRecord(record.executionId, key, "REAL_ORDER_SENT", { accountContext: ACCOUNT_REAL, strategy: this.accountContext.armedMeta?.strategy ?? null, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, candidateId: entryTiming?.candidateId ?? null, decisionId: decisionId ?? null, stake: finalStake, direction: directionAction, expiry: expiration.expiration, source }, { persist: true, accountContext: ACCOUNT_REAL });
      }
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
    return { duplicate: false, marketKey: key, executionId: record.executionId, idempotencyKey: requestedKey, requestId: requestedKey, mode, stake: finalStake, stakeRequested: resolvedStake.requestedStake, stakeSource: resolvedStake.source, stakeCappedBy: resolvedStake.cappedBy ?? null, ...outcome };
  }

  /**
   * Snapshot t0 (decisionSnapshot) capturado no ACK: prova auditavel do que o Brain viu na decisao.
   * D3: `action` e SEMPRE a decisao do Brain (nunca a direcao da ordem manual); a direcao pedida
   * pela ordem fica em `manualRequestedDirection`/`executedDirection` e a origem em `decisionSource`.
   */
  #decisionSnapshot(ctx, pending = {}) {
    const trader = ctx.agents?.trader ?? null;
    const critic = ctx.agents?.critic ?? null;
    const orderDirection = pending.direction === "CALL" ? "BUY" : pending.direction === "PUT" ? "SELL" : null;
    const decisionSource = decisionSourceOf({ source: pending.source ?? null, setup: ctx.decisionState?.setup ?? null, infraProbe: pending.infraProbe === true });
    const brainDecision = ctx.decisionState?.action ?? trader?.action ?? null;
    const manualRequestedDirection = decisionSource === "MANUAL_UI" || decisionSource === "TEST" ? orderDirection : null;
    return {
      source: "T0_DECISION_SNAPSHOT",
      decisionSource, brainDecision, manualRequestedDirection, executedDirection: orderDirection,
      marketKey: ctx.marketKey, marketType: ctx.marketType, capturedAt: this.now(),
      decisionAt: ctx.decisionState?.evaluatedAt ?? null, decisionId: pending.decisionId ?? null, correlationId: pending.correlationId ?? ctx.agents?.correlationId ?? null,
      action: brainDecision,
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
    void this.#ackPending(pending, String(orderId), kind, msg);
  }

  async #ackPending(pending, brokerOrderId, source, brokerMsg = null) {
    if (pending.ackResolved) return;
    pending.ackResolved = true;
    const record = this.idempotency.get(pending.idempotencyKey);
    if (record) applyBrokerAcknowledgement(record, { orderId: brokerOrderId });
    const signalRecord = this.signalLog.find((row) => row.executionId === pending.executionId && row.disposition === "EXECUTED");
    if (signalRecord) { signalRecord.brokerOrderId = brokerOrderId; signalRecord.ackAt = this.now(); }
    pending.brokerOrderId = brokerOrderId;
    const ackedAt = this.now();
    const ackMs = ackedAt - pending.requestedAt;
    // Expiracao REALMENTE aceita pelo broker (quando o evento informa `expired`): qualquer divergencia
    // da solicitada e registrada como inconsistencia; nunca ajusta posicao silenciosamente.
    const brokerExpirationSec = Number.isFinite(Number(brokerMsg?.expired)) ? Number(brokerMsg.expired) : null;
    const expirationMismatch = brokerExpirationSec !== null && brokerExpirationSec !== Number(pending.expirationSec);
    const entryTimingAck = pending.entryTiming ? { ...pending.entryTiming, ackedAt, effectiveEntryAt: ackedAt, entryDriftMs: pending.entryTiming.targetEntryAt ? ackedAt - pending.entryTiming.targetEntryAt : null, brokerExpirationSec, expirationMismatch } : null;
    const ctx = this.markets.get(pending.marketKey);
    if (ctx) {
      this.#recordLatency(ctx, "orderAck", ackMs);
      ctx.positionState = { ...ctx.positionState, status: "OPEN", brokerOrderId, openedAt: ackedAt, accountContext: pending.accountContext ?? ctx.positionState?.accountContext ?? null };
      ctx.positionState.indicative = null;
      this.#setAgent(ctx, "IN_POSITION", source);
      if (entryTimingAck && (ctx.candidate?.id === entryTimingAck.candidateId || ctx.lastCandidate?.id === entryTimingAck.candidateId)) {
        if (ctx.candidate?.id === entryTimingAck.candidateId) { ctx.candidate.status = "POSITION_OPEN"; ctx.candidate.entryDriftMs = entryTimingAck.entryDriftMs; ctx.candidate.ackedAt = ackedAt; ctx.lastCandidate = { ...ctx.candidate, initialFull: undefined }; ctx.candidate = null; }
        if (ctx.lastCandidate?.id === entryTimingAck.candidateId) { ctx.lastCandidate.entryDriftMs = entryTimingAck.entryDriftMs; }
      }
    }
    const position = { marketKey: pending.marketKey, mode: pending.mode, accountContext: pending.accountContext ?? ACCOUNT_PRACTICE, direction: pending.direction, stake: pending.stake, entryPrice: pending.entryPrice, brokerOrderId, expirationSec: pending.expirationSec, openedAt: ackedAt, executionId: pending.executionId, source, connectionId: pending.connectionId, correlationId: pending.correlationId ?? null, infraProbe: pending.infraProbe === true, t0Snapshot: pending.t0Snapshot ?? entryTimingAck?.t0Snapshot ?? null, entryTiming: entryTimingAck, decisionSnapshot: ctx ? { ...this.#decisionSnapshot(ctx, pending), entryTiming: entryTimingAck } : null };
    this.openPositions.set(pending.marketKey, position);
    // SHADOW LAB (observacional): completa H1/H2 com o preco de entrada efetivo do runtime.
    if (entryTimingAck?.candidateId) this.shadowLab.markEntry({ observationId: entryTimingAck.shadowObservationId ?? null, candidateId: entryTimingAck.candidateId, executionId: pending.executionId, actualEntryPrice: pending.entryPrice, entryAt: ackedAt });
    // LATE WINDOW TIMING (SHADOW): registra ACK + expiracao aceita da perna CURRENT_V1 (nao decide nada).
    if (entryTimingAck?.candidateId) this.timingShadow.markCurrentAck({ candidateId: entryTimingAck.candidateId, atMs: ackedAt, brokerOrderId, brokerExpirationSec, entryPrice: pending.entryPrice });
    // INTERSECAO OBSERVACIONAL (SHADOW): compara estado do cenario x timing (nunca controla nada).
    if (entryTimingAck?.candidateId) this.#observeScenarioTimingIntersection(entryTimingAck.candidateId);
    if (expirationMismatch) {
      this.#auditRecord(pending.correlationId ?? `corr_exec_${pending.executionId}`, pending.marketKey, "BROKER_EXPIRATION_MISMATCH", { executionId: pending.executionId, brokerOrderId, requestedExpirationSec: pending.expirationSec, acceptedExpirationSec: brokerExpirationSec, candidateId: entryTimingAck?.candidateId ?? null }, { persist: true });
      this.#emitEvent("order.expiration_mismatch", { marketKey: pending.marketKey, brokerOrderId, requestedExpirationSec: pending.expirationSec, acceptedExpirationSec: brokerExpirationSec });
      this.#safe(() => this.log("IQ_MULTI_EXPIRATION_MISMATCH", JSON.stringify({ marketKey: pending.marketKey, executionId: pending.executionId, brokerOrderId, requestedExpirationSec: pending.expirationSec, acceptedExpirationSec: brokerExpirationSec })));
    }
    this.orderIndex.set(String(brokerOrderId), pending.marketKey);
    this.pendingOrders.delete(pending.marketKey);
    await this.#persistExecution({ executionId: pending.executionId, brokerOrderId, state: "ACKNOWLEDGED", ackedAt: nowIso(ackedAt), error: null, meta: entryTimingAck ? { effectiveEntryAt: ackedAt, entryDriftMs: entryTimingAck.entryDriftMs, ackMs, brokerExpirationSec, expirationMismatch } : { ackMs } });
    this.#auditRecord(pending.correlationId ?? `corr_exec_${pending.executionId}`, pending.marketKey, "BROKER_ACK", { brokerOrderId, source, ackMs, candidateId: entryTimingAck?.candidateId ?? null, targetEntryAt: entryTimingAck?.targetEntryAt ?? null, effectiveEntryAt: ackedAt, entryDriftMs: entryTimingAck?.entryDriftMs ?? null }, { persist: true });
    if (pending.accountContext === ACCOUNT_REAL) {
      this.accountContext.recordRealAttempt("ACK", { strategy: this.accountContext.armedMeta?.strategy ?? null, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, candidateId: entryTimingAck?.candidateId ?? null, decisionId: null, stake: pending.stake, marketKey: pending.marketKey, direction: pending.direction, expiry: pending.expirationSec, send: true, ack: "ACKNOWLEDGED", brokerOrderId, settlement: null });
      this.#auditRecord(pending.correlationId ?? `corr_exec_${pending.executionId}`, pending.marketKey, "REAL_BROKER_ACK", { accountContext: ACCOUNT_REAL, brokerOrderId, ackMs, stake: pending.stake, direction: pending.direction, expiry: pending.expirationSec }, { persist: true, accountContext: ACCOUNT_REAL });
    }
    this.#emitEvent("order.ack", { marketKey: pending.marketKey, brokerOrderId, ackMs, source, mode: pending.mode, entryDriftMs: entryTimingAck?.entryDriftMs ?? null, targetEntryAt: entryTimingAck?.targetEntryAt ?? null, ...this.#executionMeta({ source: pending.source, marketKey: pending.marketKey }) });
    if (this.dataHub) this.#safe(() => this.dataHub.publish({
      eventType: "BROKER_ACK", marketKey: pending.marketKey, marketType: ctx?.marketType ?? null, activeId: ctx?.activeId ?? null,
      serverTime: this.session.serverTimeMs, receivedAt: ackedAt, availableAt: ackedAt, producer: "iq-multi-runtime", source: "iq-ws-ack",
      accountContext: pending.accountContext ?? this.accountContext.context,
      provenance: { basis: "BROKER_EXECUTED", resolution: source },
      payload: { executionId: pending.executionId, brokerOrderId, ackMs, expirationMismatch },
    }));
    this.#emitEvent("position.open", { marketKey: pending.marketKey, direction: pending.direction, stake: pending.stake, entryPrice: pending.entryPrice, brokerOrderId, source: pending.source, ...this.#executionMeta({ source: pending.source, marketKey: pending.marketKey }) });
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
    if (pending.entryTiming?.candidateId) this.shadowLab.markExecution({ observationId: pending.entryTiming.shadowObservationId ?? null, candidateId: pending.entryTiming.candidateId, executionId: pending.executionId, currentExecution: "REJECT", reason: String(reason ?? state).slice(0, 80) });
    if (pending.entryTiming?.candidateId) this.timingShadow.markCurrentReject({ candidateId: pending.entryTiming.candidateId, reason: String(reason ?? state).slice(0, 120), atMs: this.now() });
    this.pendingOrders.delete(pending.marketKey);
    const ctx = this.markets.get(pending.marketKey);
    if (ctx) { ctx.positionState = { ...ctx.positionState, status: state }; this.#setAgent(ctx, state === "REJECTED" ? "ERROR" : state, String(reason).slice(0, 80)); }
    await this.#persistExecution({ executionId: pending.executionId, state, error: String(reason).slice(0, 160) });
    this.#emitEvent("order.rejected", { marketKey: pending.marketKey, reason: String(reason).slice(0, 120), source: pending.source, ...this.#executionMeta({ source: pending.source, marketKey: pending.marketKey }) });
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
      if (!ctx) throw new IqWsError("UNKNOWN_MARKET", String(key));
    const position = this.openPositions.get(key);
    if (!ctx || !position || position.settling === true) return;
    if (broker.result === "UNKNOWN") { this.#safe(() => this.log("IQ_MULTI_SETTLEMENT_UNKNOWN", JSON.stringify({ marketKey: key, brokerOrderId }))); return; }
    position.settling = true;
    const settlement = this.#causalSettlement(ctx, position);
    const comparison = compareSettlement(broker.result, settlement.result);
    const settledAt = this.now();
    ctx.positionState = { ...ctx.positionState, status: "SETTLED", settledAt, result: broker.result, profit: broker.profit, brokerOrderId };
    if (position.entryTiming?.candidateId) this.timingShadow.markCurrentSettle({ candidateId: position.entryTiming.candidateId, result: broker.result, profit: broker.profit, stake: position.stake, atMs: settledAt });
    // SCENARIO ENGINE V3 (SHADOW): outcome BROKER_EXECUTED (pos-classificacao; nunca realimenta T0).
    if (position.entryTiming?.candidateId) {
      this.scenarioShadow.recordOutcome({ candidateId: position.entryTiming.candidateId, result: broker.result, profit: broker.profit, stake: position.stake, payout: ctx.payout, settlementBasis: "BROKER_EXECUTED", atMs: settledAt });
      this.#observeScenarioTimingIntersection(position.entryTiming.candidateId);
    }
    const settlementContext = position.accountContext === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE;
    const nextDaily = { wins: ctx.settlementState.daily.wins + (broker.result === "WIN" ? 1 : 0), losses: ctx.settlementState.daily.losses + (broker.result === "LOSS" ? 1 : 0), draws: ctx.settlementState.daily.draws + (broker.result === "DRAW" ? 1 : 0), settledPnl: Number((ctx.settlementState.daily.settledPnl + (Number(broker.profit) || 0)).toFixed(4)), trades: ctx.settlementState.daily.trades + 1 };
    const dailyByContext = { ...(ctx.settlementState.dailyByContext ?? {}) };
    const existingBucket = dailyByContext[settlementContext] ?? emptyDailyStats();
    dailyByContext[settlementContext] = { wins: existingBucket.wins + (broker.result === "WIN" ? 1 : 0), losses: existingBucket.losses + (broker.result === "LOSS" ? 1 : 0), draws: existingBucket.draws + (broker.result === "DRAW" ? 1 : 0), settledPnl: Number((existingBucket.settledPnl + (Number(broker.profit) || 0)).toFixed(4)), trades: existingBucket.trades + 1 };
    ctx.settlementState = { lastResult: broker.result, lastProfit: broker.profit, lastAt: settledAt, daily: settlementContext === ACCOUNT_PRACTICE ? nextDaily : ctx.settlementState.daily, dailyByContext };
    ctx.lastTrade = { marketKey: key, accountContext: settlementContext, brokerOrderId, direction: position.direction, stake: position.stake, result: broker.result, profit: broker.profit, causalResult: settlement.result, mismatch: comparison.mismatch, at: settledAt };
    const agentState = broker.result === "WIN" ? "WIN" : broker.result === "LOSS" ? "LOSS" : "DRAW";
    this.#setAgent(ctx, agentState, comparison.reason);
    const signalRecord = this.signalLog.find((row) => row.executionId === position.executionId && row.disposition === "EXECUTED");
    if (signalRecord) { signalRecord.settledAt = settledAt; signalRecord.result = broker.result; signalRecord.profit = broker.profit; }
    const signalStats = this.#signalStatsFor(key);
    if (broker.result === "WIN") signalStats.wins += 1; else if (broker.result === "LOSS") signalStats.losses += 1; else if (broker.result === "DRAW") signalStats.draws += 1;
    signalStats.settledPnl = Number((signalStats.settledPnl + (Number(broker.profit) || 0)).toFixed(4));
    ctx.indicative = { state: "NEUTRAL", delta: null, indicativePnl: null, updatedAt: settledAt };
    this.openPositions.delete(key); this.orderIndex.delete(String(brokerOrderId));
    await this.#persistExecution({ executionId: position.executionId, brokerOrderId: String(brokerOrderId), state: "SETTLED", accountContext: settlementContext, settledAt: nowIso(settledAt), brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit, meta: { settlementReason: comparison.reason, causal: settlement.detail, marketKey: key } });
    this.#emitEvent("position.settled", { marketKey: key, brokerOrderId, brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit, correlationId: position.correlationId ?? null, accountContext: settlementContext, source: position.source ?? null, ...this.#executionMeta({ source: position.source ?? "UNKNOWN", marketKey: key }) });
    // Harness 4x3: marca settlement da execucao experimental (idempotente; no-op se a ordem nao for do experimento).
    void this.fourWay?.recordSettlementByBrokerOrder({ brokerOrderId, result: broker.result, profit: broker.profit, entryPrice: position.entryPrice ?? null, expiryPrice: settlement.detail?.settlement ?? null });
    try { this.rsiAgentsV3?.recordSettlement({ marketKey: key, result: broker.result, profit: broker.profit, entryPrice: position.entryPrice ?? null, expiryPrice: settlement.detail?.settlement ?? null, payout: ctx.payout }); } catch { /* observabilidade nunca derruba settlement */ }
    if (this.dataHub) this.#safe(() => this.dataHub.publish({
      eventType: "SETTLEMENT", marketKey: key, marketType: ctx.marketType, activeId: ctx.activeId,
      serverTime: ctx.serverTime, receivedAt: settledAt, availableAt: settledAt, producer: "iq-multi-runtime", source: "broker-settlement",
      accountContext: settlementContext, provenance: { basis: "BROKER_EXECUTED", executionId: position.executionId },
      payload: { brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit },
    }));
    this.#auditRecord(position.correlationId ?? `corr${position.executionId}`, key, "SETTLEMENT", { brokerOrderId, brokerResult: broker.result, causalResult: settlement.result, mismatch: comparison.mismatch, profit: broker.profit, accountContext: settlementContext }, { persist: true, accountContext: settlementContext });
    if (settlementContext === ACCOUNT_REAL) {
      this.accountContext.recordRealAttempt("SETTLEMENT", { strategy: this.accountContext.armedMeta?.strategy ?? null, agentVersion: `PROFESSIONAL_BRAIN_G${BRAIN_GENERATION}`, decisionId: position.decisionSnapshot?.decisionId ?? null, stake: position.stake, marketKey: key, direction: position.direction, expiry: position.expirationSec, send: true, ack: "ACKNOWLEDGED", brokerOrderId, settlement: { result: broker.result, profit: broker.profit, at: settledAt, mismatch: comparison.mismatch } });
    }
    // Fase 6: Professor avalia qualidade (snapshot t0) antes/depois do outcome; Journal registra memoria estruturada.
    const snapshot = position.decisionSnapshot ?? { source: "SETTLEMENT_FALLBACK", marketKey: key, regime: ctx.decisionState?.regime ?? null, setup: ctx.decisionState?.setup ?? null, action: position.action ?? null, trigger: ctx.decisionState?.trigger ?? null, location: ctx.decisionState?.location ?? null, momentum: ctx.decisionState?.momentum ?? null, strength: ctx.decisionState?.strength ?? null, volatility: ctx.decisionState?.volatility ?? null, contradictingEvidence: ctx.decisionState?.contradictingEvidence ?? [], supportingEvidence: ctx.decisionState?.supportingEvidence ?? [], processLog: ctx.decisionState?.processLog ?? [], knowledgeContextIds: ctx.decisionState?.knowledge?.ids ?? [], knowledgeVersion: ctx.decisionState?.knowledge?.version ?? null, critic: ctx.decisionState?.consensus ?? null };
    if (position.infraProbe === true) { this.#auditRecord(position.correlationId ?? `probe_${position.executionId}`, key, "INFRA_PROBE_SETTLED", { brokerOrderId, result: broker.result, profit: broker.profit, excludedFromStats: true }, { persist: true }); this.#safe(() => this.log("IQ_INFRA_PROBE_SETTLED", JSON.stringify({ marketKey: key, brokerOrderId, result: broker.result }))); return; }
    const review = reviewTrade({ snapshot, outcome: broker.result, result: broker.result });
    const initialSnapshot = position.t0Snapshot ?? position.entryTiming?.t0Snapshot ?? position.entryTiming?.initialSnapshot ?? null;
    const initialReview = initialSnapshot ? reviewTrade({ snapshot: initialSnapshot, outcome: broker.result, result: broker.result }) : null;
    const reviewWithTiming = initialReview
      ? { ...review, initialDecisionQuality: initialReview.decisionQuality, finalDecisionQuality: review.decisionQuality, entryTiming: { candidateChangedBeforeEntry: position.entryTiming?.candidateChangedBeforeEntry === true, entryLeadMs: position.entryTiming?.entryLeadMs ?? null, entryDriftMs: position.entryTiming?.entryDriftMs ?? null } }
      : { ...review, finalDecisionQuality: review.decisionQuality };
    if (position.entryTiming?.candidateId) this.jit.recordExecution({ marketKey: key, candidateId: position.entryTiming.candidateId, action: position.action ?? (position.direction === "CALL" ? "BUY" : "SELL"), result: broker.result, stake: position.stake, payout: ctx.payout, entryAt: position.openedAt ?? null, settlementAt: settledAt, entryPrice: position.entryPrice ?? null });
    this.#emitEvent("professor.review", { marketKey: key, correlationId: position.correlationId ?? null, decisionQuality: review.decisionQuality, outcome: review.outcome, mistakes: review.mistakes.map((mistake) => mistake.code), wouldWaitBeBetter: review.wouldWaitBeBetter });
    this.#auditRecord(position.correlationId ?? `corr${position.executionId}`, key, "PROFESSOR_REVIEW", { decisionQuality: review.decisionQuality, outcome: review.outcome, mistakes: review.mistakes.map((mistake) => mistake.code), wouldWaitBeBetter: review.wouldWaitBeBetter }, { persist: true });
    void this.journal.recordTrade({ tradeId: position.executionId, decisionId: ctx.decisionState?.decisionId ?? null, correlationId: position.correlationId ?? null, agentId: this.#agentId(ctx), marketKey: key, marketType: ctx.marketType, entryAt: position.openedAt ?? null, settlementAt: settledAt, payout: ctx.payout, stake: position.stake, direction: position.direction, result: broker.result, profit: broker.profit, accountContext: settlementContext, snapshot, review: reviewWithTiming, initialReview, initialSnapshot, entryTiming: position.entryTiming ?? null, intelligence: ctx.agents?.intelligenceContext ?? null });
    // SHADOW LAB (observacional): settlement BROKER_EXECUTED + janela POST diagnostic_only. Nunca entra no P&L do broker.
    void this.shadowLab.settleExecuted({
      observationId: position.entryTiming?.shadowObservationId ?? null,
      candidateId: position.entryTiming?.candidateId ?? null, executionId: position.executionId, tradeId: position.executionId,
      brokerResult: broker.result, profit: broker.profit, stake: position.stake, payout: ctx.payout,
      settlementAt: settledAt, entryAt: position.openedAt ?? null, entryPrice: position.entryPrice ?? null, settlementPrice: settlement.detail?.settlement ?? null,
      candles: this.#candleList(ctx), decisionSource: decisionSourceOf({ source: position.source, infraProbe: position.infraProbe === true }), marketKey: key,
    });
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

  async #ensureDb(table = "iq_executions") {
    if (!this.pool) { this.dbReady = false; return false; }
    if (this.dbReady === true) return true;
    if (this.#dbProbeAt !== null && this.now() - this.#dbProbeAt < 10_000) return this.dbReady === true;
    this.#dbProbeAt = this.now();
    try {
      const result = await this.pool.query("SELECT to_regclass($1) AS table_name, current_setting('transaction_read_only') AS read_only", [`public.${table}`]);
      this.dbReady = Boolean(result.rows?.[0]?.table_name);
      if (String(result.rows?.[0]?.read_only ?? "").toLowerCase() === "on") this.#markReadOnly();
    } catch { this.dbReady = false; }
    return this.dbReady;
  }

  #markReadOnly() {
    if (this.persistence.readOnlyDetectedAt === null) this.persistence.readOnlyDetectedAt = this.now();
  }

  #recordPersistResult(kind, ok, error = null) {
    const p = this.persistence;
    const at = this.now();
    if (ok === true) {
      p.lastSuccessAt = at;
      p.consecutiveFailures = 0;
      p.lastError = null;
      p.readOnlyDetectedAt = null;
      if (kind === "audit") { p.auditAttempts += 1; p.auditLastOkAt = at; }
      else if (kind === "config") p.configLastOkAt = at;
      else if (kind === "market") p.marketLastOkAt = at;
      else if (kind === "execution") p.executionLastOkAt = at;
      return;
    }
    const message = String(error?.message ?? error ?? "PERSIST_FAILED").slice(0, 200);
    const code = error?.code ?? null;
    p.consecutiveFailures = Number(p.consecutiveFailures || 0) + 1;
    p.lastFailureAt = at;
    p.lastError = { kind, code, message, at };
    if (kind === "audit") { p.auditAttempts += 1; p.auditFailures += 1; p.auditLastErrorAt = at; p.auditLastError = p.lastError; }
    else if (kind === "config") { p.configLastErrorAt = at; p.configLastError = p.lastError; }
    else if (kind === "market") { p.marketLastErrorAt = at; p.marketLastError = p.lastError; }
    else if (kind === "execution") { p.executionLastErrorAt = at; p.executionLastError = p.lastError; }
    if (code === "25006" || /read-only transaction/i.test(message)) this.#markReadOnly();
  }

  /** Saude operacional da persistencia: nunca HEALTHY enquanto o audit nao persiste (DB read-only tolerado para disponibilidade). */
  persistenceHealth() {
    const p = this.persistence;
    const hasPool = Boolean(this.pool);
    const dbReady = this.dbReady === true;
    const readOnly = p.readOnlyDetectedAt !== null;
    const auditFailing = p.auditFailures > 0 && (p.auditLastOkAt === null || p.auditLastOkAt < (p.auditLastErrorAt ?? 0));
    const writeFailing = p.consecutiveFailures > 0 && !auditFailing;
    const wroteSomething = p.lastSuccessAt !== null || p.auditLastOkAt !== null || p.configLastOkAt !== null || p.marketLastOkAt !== null;
    let state = "HEALTHY";
    if (!hasPool || !dbReady || readOnly) state = "UNAVAILABLE";
    else if (auditFailing || writeFailing) state = "DEGRADED";
    else if (!wroteSomething) state = "UNKNOWN";
    const alerts = [];
    if (state === "UNAVAILABLE") alerts.push("PERSISTENCE_UNAVAILABLE");
    if (state === "DEGRADED" || readOnly) alerts.push("DB_DEGRADED");
    return {
      ok: state === "HEALTHY",
      state,
      alerts,
      dbReady: this.dbReady ?? null,
      readOnly,
      auditPersisting: !(readOnly || auditFailing),
      lastSuccessAt: p.lastSuccessAt,
      lastFailureAt: p.lastFailureAt,
      consecutiveFailures: p.consecutiveFailures,
      lastError: p.lastError,
      audit: { attempts: p.auditAttempts, failures: p.auditFailures, lastOkAt: p.auditLastOkAt, lastErrorAt: p.auditLastErrorAt, lastError: p.auditLastError },
      config: { lastOkAt: p.configLastOkAt, lastErrorAt: p.configLastErrorAt, lastError: p.configLastError },
      market: { lastOkAt: p.marketLastOkAt, lastErrorAt: p.marketLastErrorAt, lastError: p.marketLastError },
      pool: this.poolStats(),
    };
  }

  /** Diagnostico do pool Postgres (sem segredos): usado para investigar saturacao/checkout timeout. */
  poolStats() {
    const pool = this.pool;
    if (!pool) return null;
    return {
      total: Number.isFinite(Number(pool.totalCount)) ? Number(pool.totalCount) : null,
      idle: Number.isFinite(Number(pool.idleCount)) ? Number(pool.idleCount) : null,
      waiting: Number.isFinite(Number(pool.waitingCount)) ? Number(pool.waitingCount) : null,
      max: Number.isFinite(Number(pool.options?.max)) ? Number(pool.options.max) : null,
      scheduler: typeof pool.schedulerStats === "function" ? pool.schedulerStats() : null,
    };
  }

  /** Cache curto + single-flight para leituras de observabilidade (nunca compete com o runtime por conexoes). */
  async cachedRead(key, ttlMs, loader) {
    const now = this.now();
    const hit = this.endpointCache.get(key);
    if (hit?.pending) return hit.pending;
    if (hit && now - hit.at < ttlMs) return hit.value;
    const pending = (async () => {
      try {
        const value = await loader();
        this.endpointCache.set(key, { at: this.now(), value });
        return value;
      } finally {
        const current = this.endpointCache.get(key);
        if (current?.pending) this.endpointCache.set(key, { at: current.at ?? 0, value: current.value });
      }
    })();
    this.endpointCache.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
    return pending;
  }

  /** Probe explicito de persistencia do audit trail (escrita 1 linha + leitura de volta). Usado apenas manualmente/pos-espaco. */
  async persistProbe({ marketKey = null, detail = {} } = {}) {
    if (!this.pool) return { ok: false, persisted: false, error: "NO_POOL", health: this.persistenceHealth() };
    if (!await this.#ensureDb()) return { ok: false, persisted: false, error: "DB_UNAVAILABLE", health: this.persistenceHealth() };
    const correlationId = `persistence_probe_${this.now()}`;
    const at = new Date(this.now()).toISOString();
    try {
      const inserted = await this.pool.query(
        "INSERT INTO iq_audit_trail(correlation_id, market_key, stage, detail) VALUES($1,$2,$3,$4::jsonb) RETURNING id, created_at",
        [correlationId, marketKey, "PERSISTENCE_PROBE", JSON.stringify({ probe: true, at, ...detail })],
      );
      const id = Number(inserted.rows?.[0]?.id) || null;
      this.#recordPersistResult("audit", true);
      if (id === null) return { ok: true, persisted: true, readBackOk: false, insertedId: null, correlationId, error: "NO_ID_RETURNED", health: this.persistenceHealth() };
      try {
        const readBack = (await this.pool.query("SELECT id, correlation_id, market_key, stage, detail, created_at FROM iq_audit_trail WHERE id=$1", [id])).rows?.[0] ?? null;
        return { ok: true, persisted: true, readBackOk: Boolean(readBack), insertedId: id, correlationId, readBack, health: this.persistenceHealth() };
      } catch (error) {
        return { ok: true, persisted: true, readBackOk: false, insertedId: id, correlationId, error: String(error?.message ?? error).slice(0, 160), health: this.persistenceHealth() };
      }
    } catch (error) {
      this.#recordPersistResult("audit", false, error);
      return { ok: false, persisted: false, error: String(error?.message ?? error).slice(0, 200), code: error?.code ?? null, correlationId, health: this.persistenceHealth() };
    }
  }

  async #persistExecution(row) {
    try {
      if (!await this.#ensureDb()) { this.#recordPersistResult("execution", false, { code: "DB_UNAVAILABLE", message: "execution persistence unavailable (db not ready)" }); return false; }
      const updated = await this.pool.query(
        `UPDATE iq_executions SET idempotency_key=COALESCE($2,idempotency_key), decision_id=COALESCE($3,decision_id), market_key=COALESCE($4,market_key), mode=COALESCE($5,mode), connection_id=COALESCE($6,connection_id), account_type=COALESCE($7,account_type), broker_order_id=COALESCE($8,broker_order_id), symbol=COALESCE($9,symbol), active_id=COALESCE($10,active_id), direction=COALESCE($11,direction), stake=COALESCE($12,stake), currency=COALESCE($13,currency), state=$14, request_id=COALESCE($15,request_id), expiration_at=COALESCE($16,expiration_at), entry_price=COALESCE($17,entry_price), acked_at=COALESCE($18,acked_at), settled_at=COALESCE($19,settled_at), broker_result=COALESCE($20,broker_result), causal_result=COALESCE($21,causal_result), settlement_mismatch=($22 OR settlement_mismatch), profit=COALESCE($23,profit), error=COALESCE($24,error), payout=COALESCE($25,payout), option_kind=COALESCE($26,option_kind), meta=COALESCE(iq_executions.meta,'{}'::jsonb) || COALESCE($27::jsonb,'{}'::jsonb), account_context=COALESCE($28,account_context), updated_at=now() WHERE execution_id=$1`,
        [row.executionId, row.idempotencyKey ?? null, row.decisionId ?? null, row.marketKey ?? null, row.mode ?? null, row.connectionId ?? null, row.accountType ?? null, row.brokerOrderId ?? null, row.symbol ?? null, row.activeId ?? null, row.direction ?? null, row.stake ?? null, row.currency ?? null, row.state, row.requestId ?? null, row.expirationAt ?? null, row.entryPrice ?? null, row.ackedAt ?? null, row.settledAt ?? null, row.brokerResult ?? null, row.causalResult ?? null, row.mismatch === true, row.profit ?? null, row.error ?? null, row.payout ?? null, row.optionKind ?? null, row.meta ? JSON.stringify(row.meta) : null, row.accountContext ?? (row.mode === "REAL" ? ACCOUNT_REAL : null)],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await this.pool.query(
          `INSERT INTO iq_executions(execution_id,idempotency_key,decision_id,market_key,mode,connection_id,account_type,broker_order_id,symbol,active_id,direction,stake,currency,state,request_id,expiration_at,entry_price,acked_at,settled_at,broker_result,causal_result,settlement_mismatch,profit,error,payout,option_kind,meta,account_context,requested_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,now(),now())`,
          [row.executionId, row.idempotencyKey ?? null, row.decisionId ?? null, row.marketKey ?? null, row.mode ?? "PRACTICE", row.connectionId ?? null, row.accountType ?? "PRACTICE", row.brokerOrderId ?? null, row.symbol ?? null, row.activeId ?? null, row.direction ?? null, row.stake ?? null, row.currency ?? null, row.state, row.requestId ?? null, row.expirationAt ?? null, row.entryPrice ?? null, row.ackedAt ?? null, row.settledAt ?? null, row.brokerResult ?? null, row.causalResult ?? null, row.mismatch === true, row.profit ?? null, row.error ?? null, row.payout ?? null, row.optionKind ?? null, row.meta ? JSON.stringify(row.meta) : JSON.stringify({}), row.accountContext ?? (row.mode === "REAL" ? ACCOUNT_REAL : ACCOUNT_PRACTICE)],
        );
      }
      this.#recordPersistResult("execution", true);
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160))); this.#recordPersistResult("execution", false, error); return false; }
  }

  async recentExecutions(limit = 50, marketKeyFilter = null, accountContext = null) {
    const bounded = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
      if (!await this.#ensureDb()) return [];
      const args = [bounded]; const filters = [];
      if (marketKeyFilter) { args.push(marketKeyFilter); filters.push(`market_key=$${args.length}`); }
      if (accountContext) { args.push(accountContext); filters.push(`account_context=$${args.length}`); }
      const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
      return (await this.pool.query(`SELECT execution_id AS "executionId", idempotency_key AS "idempotencyKey", decision_id AS "decisionId", market_key AS "marketKey", mode, account_type AS "accountType", account_context AS "accountContext", broker_order_id AS "brokerOrderId", symbol, active_id AS "activeId", direction, stake, currency, state, entry_price AS "entryPrice", broker_result AS "brokerResult", causal_result AS "causalResult", settlement_mismatch AS "settlementMismatch", profit, payout, error, meta, requested_at AS "requestedAt", acked_at AS "ackedAt", settled_at AS "settledAt", expiration_at AS "expirationAt" FROM iq_executions${where} ORDER BY requested_at DESC LIMIT $1`, args)).rows.map((row) => ({ ...row, settlementMismatch: row.settlementMismatch === true }));
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_EXECUTIONS_READ_FAILED", String(error?.message ?? error).slice(0, 120))); return []; }
  }

  async #persistMarket(ctx) {
    try {
      if (!this.pool) return false;
      if (!await this.#ensureDb()) { this.#recordPersistResult("market", false, { code: "DB_UNAVAILABLE", message: "market persistence unavailable (db not ready)" }); return false; }
      await this.pool.query("INSERT INTO iq_markets(market_key,symbol,display,market_type,canonical,enabled,paused,max_stake,configured_stake,strategy,strategy_variant_id,revision,active_id,instrument_types,availability,payout,payout_source,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,now()) ON CONFLICT(market_key) DO UPDATE SET enabled=EXCLUDED.enabled, paused=EXCLUDED.paused, max_stake=EXCLUDED.max_stake, configured_stake=EXCLUDED.configured_stake, strategy=EXCLUDED.strategy, strategy_variant_id=EXCLUDED.strategy_variant_id, revision=EXCLUDED.revision, active_id=EXCLUDED.active_id, instrument_types=EXCLUDED.instrument_types, availability=EXCLUDED.availability, payout=EXCLUDED.payout, payout_source=EXCLUDED.payout_source, updated_at=now()",
        [ctx.marketKey, ctx.symbol, ctx.display, ctx.marketType, ctx.canonical, ctx.enabled, ctx.paused, ctx.maxStake, ctx.configuredStake, ctx.strategy, ctx.strategyVariantId, Number(ctx.revision || 0), ctx.activeId, JSON.stringify(ctx.instrumentTypes ?? []), ctx.availability, ctx.payout, ctx.payoutSource]);
      this.#recordPersistResult("market", true);
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_MARKET_PERSIST_FAILED", String(error?.message ?? error).slice(0, 120))); this.#recordPersistResult("market", false, error); return false; }
  }

  async #persistConfig() {
    try {
      if (!this.pool) return false;
      if (!await this.#ensureDb("iq_runtime_config")) { this.#recordPersistResult("config", false, { code: "DB_UNAVAILABLE", message: "runtime config persistence unavailable (db not ready)" }); return false; }
      await this.pool.query("INSERT INTO iq_runtime_config(id,mode,global_max_stake,default_stake,calculated_bankroll_stake,auto_execute,selection_json,resolver_json,research_json,supervisor_json,apprentice_json,hypotheses_json,jit_enabled,entry_lead_ms,entry_window_max_drift_ms,quality_gate_enabled,min_trade_quality_score,revision,updated_at) VALUES(1,$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,now()) ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode, global_max_stake=EXCLUDED.global_max_stake, default_stake=EXCLUDED.default_stake, calculated_bankroll_stake=EXCLUDED.calculated_bankroll_stake, auto_execute=EXCLUDED.auto_execute, selection_json=EXCLUDED.selection_json, resolver_json=EXCLUDED.resolver_json, research_json=EXCLUDED.research_json, supervisor_json=EXCLUDED.supervisor_json, apprentice_json=EXCLUDED.apprentice_json, hypotheses_json=EXCLUDED.hypotheses_json, jit_enabled=EXCLUDED.jit_enabled, entry_lead_ms=EXCLUDED.entry_lead_ms, entry_window_max_drift_ms=EXCLUDED.entry_window_max_drift_ms, quality_gate_enabled=EXCLUDED.quality_gate_enabled, min_trade_quality_score=EXCLUDED.min_trade_quality_score, revision=EXCLUDED.revision, updated_at=now()",
        [this.config.mode, this.config.globalMaxStake, this.config.defaultStake, this.config.calculatedBankrollStake, this.config.autoExecute, JSON.stringify({ legacy: "LEGACY_STRATEGY_AUDIT", brainGeneration: BRAIN_GENERATION }), JSON.stringify(this.resolver.toJSON()), JSON.stringify({ ...this.research.toJSON(), entryTiming: this.jit.toJSON() }), JSON.stringify(this.supervisor.toJSON()), JSON.stringify(this.apprentice.toJSON()), JSON.stringify({ items: this.hypotheses.list() }), this.config.jitEnabled === true, this.config.entryLeadMs, this.#entryMaxDriftMs(), this.config.qualityGateEnabled === true, this.#minTradeQualityScore(), Number(this.config.revision || 0)]);
      this.#recordPersistResult("config", true);
      return true;
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_CONFIG_PERSIST_FAILED", String(error?.message ?? error).slice(0, 120))); this.#recordPersistResult("config", false, error); return false; }
  }

  async #loadPersistedConfig() {
    if (this.configLoaded || !this.pool) return;
    this.configLoaded = true;
    this.configHydrated = false;
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
        if (row.quality_gate_enabled !== null && row.quality_gate_enabled !== undefined) this.config.qualityGateEnabled = row.quality_gate_enabled === true;
        if (Number.isFinite(Number(row.min_trade_quality_score))) this.config.minTradeQualityScore = Math.max(MIN_TRADE_QUALITY_SCORE_LIMIT, Math.min(MAX_TRADE_QUALITY_SCORE_LIMIT, Math.round(Number(row.min_trade_quality_score))));
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
      this.configHydrated = true;
      const enabled = [...this.markets.values()].filter((ctx) => ctx.enabled);
      if (enabled.length > this.config.maxActiveMarkets) {
        for (const ctx of enabled.slice(this.config.maxActiveMarkets)) { ctx.enabled = false; void this.#persistMarket(ctx); }
        this.#safe(() => this.log("IQ_MULTI_LIMIT_ENFORCED_ON_LOAD", JSON.stringify({ before: enabled.length, after: this.config.maxActiveMarkets })));
      }
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_CONFIG_LOAD_FAILED", String(error?.message ?? error).slice(0, 120))); this.configLoaded = false; this.configHydrated = false; }
  }

  async #loadDailyStats() {
    if (!this.pool || !await this.#ensureDb()) return;
    try {
      const rows = (await this.pool.query("SELECT market_key, account_context, count(*) FILTER (WHERE broker_result='WIN')::int AS wins, count(*) FILTER (WHERE broker_result='LOSS')::int AS losses, count(*) FILTER (WHERE broker_result='DRAW')::int AS draws, COALESCE(sum(profit),0)::float AS pnl, count(*)::int AS trades FROM iq_executions WHERE state='SETTLED' AND settled_at >= date_trunc('day', now()) GROUP BY market_key, account_context")).rows;
      for (const ctx of this.markets.values()) ctx.settlementState.dailyByContext = {};
      for (const row of rows) {
        const ctx = this.markets.get(row.market_key);
        if (!ctx) continue;
        const context = row.account_context === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE;
        const bucket = { wins: row.wins, losses: row.losses, draws: row.draws, settledPnl: Number(row.pnl) || 0, trades: row.trades };
        ctx.settlementState.dailyByContext[context] = bucket;
        if (context === ACCOUNT_PRACTICE) ctx.settlementState.daily = bucket;
      }
    } catch (error) { this.#safe(() => this.log("IQ_MULTI_DAILY_STATS_FAILED", String(error?.message ?? error).slice(0, 120))); }
  }

  async dailyEquityCurve(limit = 120, accountContext = null) {
    try {
      if (!this.pool || !await this.#ensureDb()) return [];
      const context = accountContext ?? (this.accountContext.context === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE);
      const rows = (await this.pool.query("SELECT settled_at AS at, profit FROM iq_executions WHERE state='SETTLED' AND account_context=$2 AND settled_at >= date_trunc('day', now()) ORDER BY settled_at ASC LIMIT $1", [Math.max(1, Math.min(500, limit)), context])).rows;
      let cumulative = 0;
      return rows.map((row) => { cumulative = Number((cumulative + (Number(row.profit) || 0)).toFixed(4)); return { at: row.at, cumulative }; });
    } catch { return []; }
  }

  /**
   * PnL REAL semanal/mensal por contexto de conta, direto de iq_executions (mesma fonte do dia).
   * Somente dados liquidados; sem estimativa. Cacheado (30s) como a equity curve.
   */
  async refreshPeriodPnl() {
    try {
      if (!this.pool || !await this.#ensureDb()) return this.periodPnlCache;
      const context = this.accountContext.context === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE;
      const row = (await this.pool.query(
        `SELECT
           COALESCE(sum(profit) FILTER (WHERE settled_at >= date_trunc('week', now())), 0)::float AS weekly_pnl,
           COALESCE(sum(profit) FILTER (WHERE settled_at >= date_trunc('month', now())), 0)::float AS monthly_pnl,
           count(*) FILTER (WHERE settled_at >= date_trunc('week', now()))::int AS weekly_trades,
           count(*) FILTER (WHERE settled_at >= date_trunc('month', now()))::int AS monthly_trades,
           count(*)::int AS total_settled
         FROM iq_executions
         WHERE state='SETTLED' AND account_context=$1 AND settled_at >= date_trunc('month', now())`, [context],
      )).rows[0];
      const weekly = row && row.weekly_pnl !== null && row.weekly_pnl !== undefined ? Number(row.weekly_pnl) : null;
      const monthly = row && row.monthly_pnl !== null && row.monthly_pnl !== undefined ? Number(row.monthly_pnl) : null;
      this.periodPnlCache = {
        weekly: Number.isFinite(weekly) ? weekly : null,
        monthly: Number.isFinite(monthly) ? monthly : null,
        weeklyTrades: row ? Number(row.weekly_trades) || 0 : null,
        monthlyTrades: row ? Number(row.monthly_trades) || 0 : null,
        context, refreshedAt: this.now(),
      };
    } catch { /* fail-soft: UI mostra N/A ate existir leitura real */ }
    return this.periodPnlCache;
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
      rsiAgent: this.rsiAgentsV2Live?.stateFor(ctx.marketKey) ?? this.rsiAgentsV4?.stateFor(ctx.marketKey) ?? this.rsiAgentsV3?.stateFor(ctx.marketKey) ?? null,
      rsiInstruments: this.rsiAgentsV4 ? [...this.rsiAgentsV4.instruments.values()].filter((row) => row.marketKey === ctx.marketKey).map((row) => ({ instrumentType: row.instrumentType, durationSeconds: row.durationSeconds, enabled: row.enabled === true, payout: row.payout ?? null, status: row.status ?? null })) : [],
      entryTiming: this.#publicEntryTiming(ctx, this.client?.serverNow?.() ?? this.now()),
    };
  }

  office() {
    if (this.now() - this.equityRefreshedAt > 30_000) { this.equityRefreshedAt = this.now(); void this.refreshEquityCurve(); void this.refreshPeriodPnl(); }
    if (this.now() - (this.lastResearchPersist ?? 0) > 60_000) { this.lastResearchPersist = this.now(); void this.#persistConfig(); }
    const activeContext = this.accountContext.context;
    const contextState = this.accountContextState();
    const marketRows = [...this.markets.values()].map((ctx) => this.#publicMarket(ctx));
    // Office V3: agentes RSI V3 primeiro (topo); mercados sem agente no meio; legado PULLBACK V2 (se houver) na base.
    const strategyRank = (row) => {
      const strategy = row.rsiAgent?.strategyId;
      if (strategy === "RSI_REVERSAL_V4" || strategy === "RSI_REVERSAL_PULLBACK_V3" || strategy === "RSI_REVERSAL_STRICT_V2") return 0;
      if (strategy === "RSI_EXTREME_PULLBACK_V2") return 2;
      return 1;
    };
    const markets = marketRows.map((row, index) => ({ row, index })).sort((a, b) => strategyRank(a.row) - strategyRank(b.row) || a.index - b.index).map((entry) => entry.row);
    const portfolio = this.portfolioSnapshot(activeContext);
    const contextSignals = [...this.signalLog].reverse().filter((row) => (row.accountContext ?? ACCOUNT_PRACTICE) === activeContext).slice(0, 40);
    const contextJournalTrades = this.journal.trades.filter((trade) => (trade.accountContext === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE) === activeContext).length;
    const compliance = {
      mode: this.config.mode, armState: this.armState.snapshot(), killSwitch: this.killSwitch.status(), hardCap: this.config.hardCap,
      realMode: this.realMode.status(),
      accountContext: { context: activeContext, state: contextState.state, armed: contextState.armed, lockedReason: contextState.lockedReason, realTradingEnabled: contextState.realTradingEnabled },
      invariants: { practiceOnlyDefault: true, realRequiresExplicitConfirmation: true, oneOrderPerDecision: true, onePositionPerMarket: true, normalNeverFallsBackToOtc: true, maxActiveMarkets: this.config.maxActiveMarkets, crossContextBlocked: true },
    };
    const executionGate = {
      state: this.killSwitch.status().executionEnabled !== true ? "BLOCKED" : this.armState.armed === true ? (this.pendingOrders.size ? "ORDERING" : "ARMED") : "DISARMED",
      armed: this.armState.armed === true, pendingOrders: this.pendingOrders.size, allowedMarkets: markets.filter((market) => market.enabled && market.availability === "OPEN").map((market) => market.marketKey),
      blockedMarkets: markets.filter((market) => !market.enabled || market.availability !== "OPEN").map((market) => market.marketKey), reasons: this.connectionHealth().reasons,
      accountContext: activeContext, realState: contextState.state,
    };
    return {
      version: RUNTIME_VERSION, at: this.now(), serverTime: this.session.serverTimeMs,
      connection: { ...this.session, reconnects: this.reconnects, healthy: this.connectionHealth().healthy },
      mode: this.config.mode, modeState: this.modeState(),
      accountContext: contextState,
      health: this.persistenceHealth(),
      config: { globalMaxStake: this.config.globalMaxStake, defaultStake: this.config.defaultStake, calculatedBankrollStake: this.config.calculatedBankrollStake, hardCap: this.config.hardCap, maxActiveMarkets: this.config.maxActiveMarkets, autoExecute: this.config.autoExecute, revision: this.config.revision, brainGeneration: BRAIN_GENERATION, jitEnabled: this.config.jitEnabled === true, entryLeadMs: this.config.entryLeadMs, entryWindowMaxDriftMs: this.#entryMaxDriftMs(), qualityGateEnabled: this.config.qualityGateEnabled === true, minTradeQualityScore: this.#minTradeQualityScore() },
      activeCount: this.activeMarketKeys().length, activeLimit: this.config.maxActiveMarkets, universeCount: this.markets.size,
      portfolio: { ...portfolio, equityCurve: this.equityCurveCache ?? [], weekly: { pnl: this.periodPnlCache.weekly, trades: this.periodPnlCache.weeklyTrades, context: this.periodPnlCache.context, refreshedAt: this.periodPnlCache.refreshedAt || null }, monthly: { pnl: this.periodPnlCache.monthly, trades: this.periodPnlCache.monthlyTrades, context: this.periodPnlCache.context, refreshedAt: this.periodPnlCache.refreshedAt || null } },
      markets,
      aux: {
        risk: { openPositions: portfolio.openPositions.length, stakeAtRisk: Number(portfolio.openPositions.reduce((sum, position) => sum + (Number(position.stake) || 0), 0).toFixed(4)), exposure: portfolio.exposure, concentrationWarnings: portfolio.concentrationWarnings, limits: { maxActiveMarkets: this.config.maxActiveMarkets, maxOpenPerMarket: MAX_OPEN_POSITIONS_PER_MARKET, hardCap: this.config.hardCap } },
        compliance,
        macro: this.macroContext ?? { status: "NO_FEED", note: "contexto macro nao conectado nesta fase" },
        news: this.newsContext ?? { status: "NO_FEED", note: "interface pronta; nenhum evento inventado" },
        executionGate,
        portfolioControl: { activeMarkets: this.activeMarketKeys(), openPositions: portfolio.openPositions.length, settledPnl: portfolio.settled.pnl, wins: portfolio.settled.wins, losses: portfolio.settled.losses, draws: portfolio.settled.draws, agentsOnline: markets.filter((market) => market.agentState !== "OFFLINE" && market.agentState !== "UNAVAILABLE").length },
        rsiAgentsV2Live: this.rsiAgentsV2Live?.status?.() ?? { version: "rsi-agents-v2-live-v1", enabled: this.rsiAgentsV2Live?.enabled === true, strategy: "RSI_V2_ORIGINAL", routing: "RSI_V2_ONLY" },
        rsiAgentsV4: this.rsiAgentsV4?.status?.() ?? { version: "rsi-agents-v4-single-v1", enabled: this.rsiAgentsV4?.enabled === true, strategy: "RSI_REVERSAL_V4", routing: "RSI_V4_ONLY", controlsExecution: false },
        rsiAgentsV3: this.rsiAgentsV3?.snapshot?.() ?? { version: "rsi-agents-v3-single-v1", enabled: this.rsiAgentsV3?.enabled === true, migration: this.rsiAgentsV3?.migration ?? null, universe: { eligible: this.rsiAgentsV3?.universe?.eligible?.length ?? 0 }, strategy: "RSI_REVERSAL_PULLBACK_V3" },
        rsiAgentsV2: { module: "rsi-agents-v2", frozen: true, enabled: this.rsiAgentsV2?.enabled === true, controlsExecution: false },
        executionRouting: this.executionRoutingStatus(),
      },
      resolver: { lastResolvedAt: this.resolver.lastResolvedAt, resolvedCount: this.resolver.resolvedCount(), sampleActiveKeys: this.resolver.sampleActiveKeys, lastError: this.resolver.lastError },
      intelligence: this.intelligence.status(),
      knowledge: { ...this.knowledge.status(), secondBrain: this.secondBrain.status() },
      journal: { trades: contextJournalTrades, decisions: this.journal.decisions.length, accountContext: activeContext },
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
      signals: contextSignals,
      signalsTotal: this.signalLog.length,
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

  async refreshEquityCurve() { this.equityCurveCache = await this.dailyEquityCurve(); return this.equityCurveCache; }  #legacyStatus() {
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


