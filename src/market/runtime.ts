/**
 * Composição (etapa 2): provider + real-time pipeline + service + catálogo.
 *
 * Ponto único para o resto do sistema obter dados de mercado reais sem
 * conhecer detalhes do provedor.
 */
import type { EnvConfig } from "../config/env";
import { resolveProvider } from "./registryV2";
import { MarketPipeline } from "./pipeline";
import { MarketDataService } from "./service";
import { StaticAssetCatalog, DEFAULT_CRYPTO_CATALOG, DEFAULT_FOREX_CATALOG } from "./catalog";
import type { AssetCatalog } from "./catalog";
import type { MarketDataProvider } from "./providerV2";
import type { PipelineSymbolConfig } from "./pipeline";
import { QuantEngine, DEFAULT_CONFIG } from "../quant/engine";
import { buildMarketContext } from "./context";
import type { MarketContext, MarketQuantFeatures } from "./context";
import { TIMEFRAME_MS, type Timeframe } from "./model";
import { Datastore } from "../store/db";
import { CandleRepository } from "../store/repositories/candleRepository";
import { Backtester } from "../backtest/backtest";
import { FusionService } from "../fusion/service";
import { NewsService } from "../context/service";
import { FreeCryptoNewsProvider } from "../context/provider";
import type { NewsResult } from "../context/types";
import { AnalyticsService } from "../analytics/service";
import { CalibrationEngine, calibrationKeyToString } from "../analytics/calibration-engine";
import { DecisionRepository } from "../store/repositories/decisionRepository";
import { GuardRepository } from "../store/repositories/guardRepository";
import { ShadowRepository } from "../store/repositories/shadowRepository";
import { SignalRepository } from "../store/repositories/signalRepository";
import { AdaptiveRepository } from "../store/repositories/adaptiveRepository";
import { OandaForexProvider } from "./forex/oanda-provider";
import { ForexMarketScanner } from "./forex/scanner";
import { freshGuardState, type GuardState } from "../fusion/guards";

/**
 * Constrói um provider de candles multi-TF a partir do pipeline.
 * Garante retorno de array mesmo quando não há backfill (camada vazia).
 */
function makeMultiTfCandlesProvider(
  pipeline: MarketPipeline,
): (symbol: string) => Partial<Record<Timeframe, readonly import("./model").MarketCandle[]>> {
  return (symbol: string) => ({
    "5m": pipeline.state.getCandles(symbol, "5m"),
    "15m": pipeline.state.getCandles(symbol, "15m"),
    "1h": pipeline.state.getCandles(symbol, "1h"),
    "4h": pipeline.state.getCandles(symbol, "4h"),
  });
}

/**
 * Idade do último candle do ativo/timeframe solicitado (ou null se sem dados).
 * Usado pelo guard de staleness do FusionService.
 */
function makeLastCandleAgeProvider(
  pipeline: MarketPipeline,
): (symbol?: string, timeframe?: Timeframe) => number | null {
  return (symbol = "BTCUSDT", timeframe = "1m") => {
    const last = pipeline.state.getCandles(symbol, timeframe).at(-1);
    return last ? Math.max(0, Date.now() - (last.timestamp + TIMEFRAME_MS[timeframe])) : null;
  };
}

export interface MarketRuntimeOptions {
  readonly symbols: readonly PipelineSymbolConfig[];
}

export interface MarketRuntime {
  readonly provider: MarketDataProvider | null;
  readonly pipeline: MarketPipeline | null;
  readonly service: MarketDataService;
  readonly catalog: AssetCatalog;
  readonly configured: boolean;
  readonly quant: QuantEngine;
  readonly store: Datastore;
  readonly candleRepo: CandleRepository;
  readonly backtester: Backtester;
  readonly fusion: FusionService;
  readonly news: NewsService;
  readonly analytics: AnalyticsService;
  readonly calibrationEngine: CalibrationEngine;
  /** Persistência adaptativa de ensemble, retraining, métricas e drift. */
  readonly adaptiveRepo?: AdaptiveRepository;
  /** Scanner real de Forex, apenas quando as credenciais OANDA existem. */
  readonly forexScanner?: ForexMarketScanner;
  readonly guardRepo?: GuardRepository;
  readonly shadowRepo?: ShadowRepository;
  /** Sinais paper persistidos e sua trilha de transições. */
  readonly signalRepo?: SignalRepository;
  readonly getGuardState: () => GuardState;
  /** Persiste o estado atual dos guards no SQLite. */
  persistGuards(state: GuardState): void;
  /** Reseta o circuit breaker no SQLite (intervenção manual). */
  resetBreaker(): void;
  start(): Promise<void>;
  stop(): void;
  /** Monta o MarketContext enriquecido com features do Quant Engine. */
  buildContext(symbol: string, timeframe: Timeframe): Promise<MarketContext>;
}

export function createMarketRuntime(
  config: Pick<EnvConfig, "marketDataMode" | "nodeEnv" | "database"> & Partial<Pick<EnvConfig, "oanda">>,
  opts: MarketRuntimeOptions,
): MarketRuntime {
  const provider = resolveProvider(config);
  const catalog = new StaticAssetCatalog(
    config.marketDataMode === "forex" || config.marketDataMode === "auto"
      ? DEFAULT_FOREX_CATALOG
      : DEFAULT_CRYPTO_CATALOG,
  );
  const quant = new QuantEngine(DEFAULT_CONFIG);
  const store = new Datastore({ path: config.database.path });
  const candleRepo = new CandleRepository(store, provider?.id ?? "none");
  const backtester = new Backtester();
  const decisionRepo = new DecisionRepository(store);
  // Repositório de guards — só existe se o SQLite estiver disponível no ambiente.
  const guardRepo: GuardRepository | undefined = store.available
    ? new GuardRepository(store)
    : undefined;
  // Repositório de shadow trading (paper trading).
  const shadowRepo: ShadowRepository | undefined = store.available
    ? new ShadowRepository(store)
    : undefined;
  const signalRepo: SignalRepository | undefined = store.available
    ? new SignalRepository(store)
    : undefined;
  // B7: writers adaptativos (ensemble_weights, retrain_history,
  // model_daily_metrics, drift_alerts). Só existe com SQLite disponível.
  const adaptiveRepo: AdaptiveRepository | undefined = store.available
    ? new AdaptiveRepository(store)
    : undefined;
  const forexScanner = config.oanda?.apiKey && config.oanda.accountId
    ? new ForexMarketScanner({
      provider: new OandaForexProvider({
        apiKey: config.oanda.apiKey,
        accountId: config.oanda.accountId,
        baseUrl: config.oanda.baseUrl,
      }),
      timeframe: "1m",
      candleWindow: 120,
    })
    : undefined;

  if (!provider) {
    // Sem provedor ⇒ SERVICE devolve PROVIDER_NOT_CONFIGURED; pipeline null.
    const service = new MarketDataService({ provider: null, pipeline: null });
    const fusion = makeStubFusion();
    const news = new NewsService({ provider: null });
    // P-A: CalibrationEngine inicializado vazio; histórico é alimentado pelo scheduler.
    const calibrationEngine = new CalibrationEngine();
    // B7: hook fitForKey → AdaptiveRepository.upsertEnsembleWeights.
    if (adaptiveRepo) {
      calibrationEngine.setOnFit((snap) => {
        const key = calibrationKeyToString(snap.key);
        adaptiveRepo.upsertEnsembleWeights({
          key,
          A: snap.fit.params.A,
          B: snap.fit.params.B,
          status: snap.status,
          nSamples: snap.fit.nSamples,
          ece: snap.oos?.ece ?? 0,
          updatedAt: snap.updatedAt,
          holdoutBrier: snap.oos?.brierScore ?? null,
        });
      });
    }
    const analytics = new AnalyticsService({
      persist: decisionRepo,
      candles: () => [],
      ...(shadowRepo ? { shadowRepo } : {}),
      ...(adaptiveRepo ? { adaptiveRepo } : {}),
      calibrationEngine,
    });
    // Estado de guard: carrega do SQLite se houver persistência; senão fresco.
    let runtimeGuardState: GuardState = guardRepo?.load() ?? freshGuardState(Date.now());
    return {
      provider: null,
      pipeline: null,
      service,
      catalog,
      quant,
      store,
      candleRepo,
      backtester,
      fusion,
      news,
      analytics,
      calibrationEngine,
      adaptiveRepo,
      signalRepo,
      forexScanner,
      guardRepo,
      getGuardState: () => runtimeGuardState,
      persistGuards: (s) => {
        runtimeGuardState = s;
        guardRepo?.save(s);
      },
      resetBreaker: () => {
        guardRepo?.reset();
        runtimeGuardState = freshGuardState(Date.now());
      },
      configured: false,
      start: async () => {
        await hydrateCalibration(decisionRepo, calibrationEngine);
      },
      stop: () => store.close(),
      buildContext: async (_s, _tf) =>
        buildMarketContext({
          provider: "none", providerState: "disconnected", symbol: _s, timeframe: _tf,
          currentPrice: null, latestClosedCandle: null, candles: [], volume: null,
          quality: "unknown", freshness: "unavailable",
        }),
    };
  }

  const pipeline = new MarketPipeline({
    provider,
    logger: {
      info: (m, meta) => console.log(JSON.stringify({ event: m, ...(meta as object) })),
      warn: (m, meta) => console.error(JSON.stringify({ event: m, level: "warn", ...(meta as object) })),
      error: (m, meta) => console.error(JSON.stringify({ event: m, level: "error", ...(meta as object) })),
    },
  });
  const service = new MarketDataService({ provider, pipeline });
  const prov: MarketDataProvider = provider; // não-nulo deste ponto em diante
    // The public provider is crypto-only. Applying its lexical headlines to
    // Forex/IQ Option would be false macro evidence, so those modes fail
    // closed with no news provider until a point-in-time FX source exists.
    const news = new NewsService({ provider: config.marketDataMode === "binance" ? new FreeCryptoNewsProvider() : null });
    // Estado de guard: carrega do SQLite se houver persistência; senão fresco.
    let runtimeGuardState: GuardState = guardRepo?.load() ?? freshGuardState(Date.now());
    const fusion = new FusionService({
      quant,
      backtester,
      historySource: candleRepo.source(),
      currentCandles: (symbol, timeframe) => pipeline.state.getCandles(symbol, timeframe),
      // CAMADA 1 — Confluência multi-TF (5m + 15m + 1h + 4h quando disponível)
      currentCandlesMultiTf: makeMultiTfCandlesProvider(pipeline),
      // CAMADA 3 — Guards: estado vem do SQLite (carregado na inicialização).
      // Mutações devem usar runtime.persistGuards(newState) para que reinícios
      // do servidor NÃO percam cooldown/circuit breaker/drawdown diário.
      guardStateProvider: () => runtimeGuardState,
      // Idade do último candle 1m para checagem de staleness
      lastCandleAgeMs: (symbol, timeframe) => makeLastCandleAgeProvider(pipeline)(symbol, timeframe),
      getNewsBias: async (asset) => {
        const res = await news.searchNews({ query: asset, asset, limit: 8 });
        if (!res.available) return null;
        const b = news.deriveBias(res.items);
        return b === "bullish" ? "up" : b === "bearish" ? "down" : "neutral";
      },
    });
    // P-A: CalibrationEngine instanciado no caminho provider-configured.
    // Criado ANTES do AnalyticsService para que o service receba a referência.
    const calibrationEngine = new CalibrationEngine();
    // B7: hook fitForKey → AdaptiveRepository.upsertEnsembleWeights.
    if (adaptiveRepo) {
      calibrationEngine.setOnFit((snap) => {
        const key = calibrationKeyToString(snap.key);
        adaptiveRepo.upsertEnsembleWeights({
          key,
          A: snap.fit.params.A,
          B: snap.fit.params.B,
          status: snap.status,
          nSamples: snap.fit.nSamples,
          ece: snap.oos?.ece ?? 0,
          updatedAt: snap.updatedAt,
          holdoutBrier: snap.oos?.brierScore ?? null,
        });
      });
    }
    const analytics = new AnalyticsService({
      persist: decisionRepo,
      candles: (symbol, timeframe) => pipeline.state.getCandles(symbol, timeframe),
      shadowRepo,
      ...(adaptiveRepo ? { adaptiveRepo } : {}),
      calibrationEngine,
    });

  function persistGuards(state: GuardState): void {
    runtimeGuardState = state;
    guardRepo?.save(state);
  }

  function resetBreaker(): void {
    guardRepo?.reset();
    runtimeGuardState = freshGuardState(Date.now());
  }

  async function buildContext(symbol: string, timeframe: Timeframe): Promise<MarketContext> {
    const md = await service.getMarketData({ symbol, timeframe });
    const candles = pipeline.state.getCandles(symbol, timeframe);
    let quantFeatures: MarketQuantFeatures | undefined;
    if (candles.length >= DEFAULT_CONFIG.atrPeriod) {
      const summary = quant.analyze({ candles, symbol, timeframe });
      quantFeatures = {
        technicalScore: summary.technicalScore,
        rsi: lastNonNull(summary.indicators.rsi),
        macdHistogram: lastNonNull(summary.indicators.macd.histogram),
        atrPct: summary.volatility.atrPct,
        volatilityAnnualized: summary.volatility.annualized * 100,
        marketRegime: summary.regime.regime,
        structureTrend: summary.structure.trend,
        supports: summary.levels.supports.map((l) => l.price),
        resistances: summary.levels.resistances.map((l) => l.price),
        sampleSize: summary.sampleSize,
      };
    }
    return buildMarketContext({
      provider: prov.id,
      providerState: prov.getStatus(),
      symbol,
      timeframe,
      currentPrice: md.currentPrice,
      latestClosedCandle: md.latestClosedCandle,
      candles,
      volume: md.volume,
      quality: md.quality,
      freshness: md.freshness,
      ...(quantFeatures ? { quant: quantFeatures } : {}),
    });
  }

  return {
    provider,
    pipeline,
    service,
    catalog,
    quant,
    store,
    candleRepo,
    backtester,
    fusion,
    news,
    analytics,
    calibrationEngine,
    adaptiveRepo,
    signalRepo,
    forexScanner,
    guardRepo,
    getGuardState: () => runtimeGuardState,
    persistGuards,
    resetBreaker,
    configured: true,
    start: async () => {
      await hydrateCalibration(decisionRepo, calibrationEngine);
      await pipeline.start([...opts.symbols]);
      // Persiste os candles fechados recém-coletados no cold store (dado real).
      for (const c of opts.symbols) {
        const cs = pipeline.state.getCandles(c.symbol, c.timeframe);
        candleRepo.upsert(cs);
      }
    },
    stop: () => {
      pipeline?.stop();
      store.close();
    },
    buildContext,
  };
}

/** Rehydrates causal calibration state after a process restart. */
async function hydrateCalibration(
  decisionRepo: DecisionRepository,
  calibrationEngine: CalibrationEngine,
): Promise<void> {
  const records = await decisionRepo.listAll({ sinceMs: Date.now() - 45 * 86_400_000 });
  if (records.length === 0) return;
  calibrationEngine.pushHistory(records);
  const keys = new Map<string, { symbol: string; timeframe: string; regime: string }>();
  for (const record of records) {
    const key = { symbol: record.symbol, timeframe: record.timeframe, regime: record.regime ?? "unknown" };
    keys.set(`${key.symbol}|${key.timeframe}|${key.regime}`, key);
  }
  for (const key of keys.values()) calibrationEngine.fitForKey(key);
}

function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i] as number;
  return null;
}

/** FusionService vazio (sem provider): retorna sempre WAIT/dados insuficientes. */
function makeStubFusion(): FusionService {
  return new FusionService({
    quant: new QuantEngine(DEFAULT_CONFIG),
    backtester: new Backtester(),
    historySource: { getCandles: async () => [] },
    currentCandles: () => [],
  });
}
