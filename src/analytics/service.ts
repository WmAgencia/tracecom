/**
 * AnalyticsService — registra decisões e valida o resultado posteriormente.
 *
 * Causalidade correta: ao registrar uma decisão usamos apenas dados do momento
 * (`entryTime/entryPrice`). Ao validar, SÓ então consultamos candles futuros
 * (horizonte já decorrido) e medimos o retorno real. Nunca a validação informa
 * a decisão (é posterior).
 */
import type { DecisionRecord, DecisionStats, Outcome, ProbabilitySource, ValidationConfig } from "./types";
import { TIMEFRAME_MS, Timeframe } from "../market/model";
import type { MarketCandle } from "../market/model";
import { getCalibrationReport, type CalibrationReport } from "./calibration";
import { buildPerfSnapshotFromRecords, type PerfSnapshot } from "./pnl-snapshot";
import { openShadowTrade, evaluateShadowTrade, DEFAULT_COOLDOWN_MINUTES, type ShadowTrade, type ShadowOutcome } from "./shadow";
import type { ShadowRepository, ShadowStats, ShadowFilter } from "../store/repositories/shadowRepository";
import type { CalibrationEngine } from "./calibration-engine";
import type { AdaptiveRepository } from "../store/repositories/adaptiveRepository";
import { executionCostPct, netReturnAfterCosts } from "../risk/fees";
import type { EnsembleRepository } from "../store/repositories/ensembleRepository";
import { adaptiveKey } from "../store/repositories/ensembleRepository";

/**
 * B7: limiares iniciais para alertas de drift (documentados em JSDoc).
 * Estes valores são arbitrários (primeira passagem) — calibrar com dados
 * empíricos assim que houver ≥30 dias de produção.
 */
export const DEFAULT_DRIFT_BRIER_THRESHOLD = 0.20;
export const DEFAULT_DRIFT_ECE_THRESHOLD = 0.15;

export const DEFAULT_VALIDATION: ValidationConfig = { minMovePct: 0.5, lookback: 1000 };

function normalizeProbabilities(input: Pick<FusedDecisionInput, "decision" | "probability" | "pBuy" | "pSell" | "pWait">): { pBuy: number | null; pSell: number | null; pWait: number | null; source: ProbabilitySource } {
  const pBuy = Number(input.pBuy); const pSell = Number(input.pSell); const pWait = Number(input.pWait);
  if ([pBuy, pSell, pWait].every((value) => Number.isFinite(value) && value >= 0)) {
    const total = pBuy + pSell + pWait;
    if (total > 0) {
      return { pBuy: pBuy / total, pSell: pSell / total, pWait: pWait / total, source: "provided" };
    }
  }
  if (typeof input.probability === "number" && Number.isFinite(input.probability) && input.probability >= 0 && input.probability <= 1) {
    const wait = 1 - input.probability;
    return { pBuy: input.decision === "BUY" ? input.probability : 0, pSell: input.decision === "SELL" ? input.probability : 0, pWait: wait, source: "derived_directional" };
  }
  return { pBuy: null, pSell: null, pWait: null, source: "unavailable" };
}

export interface FusedDecisionInput {
  readonly symbol: string;
  readonly timeframe: string;
  readonly direction: string;
  readonly decision: "BUY" | "SELL" | "WAIT";
  readonly horizon: number;
  readonly entryTime: number;
  readonly entryPrice: number | null;
  readonly score: number;
  readonly confidence: number;
  readonly probability: number | null;
  readonly pBuy?: number | null;
  readonly pSell?: number | null;
  readonly pWait?: number | null;
  readonly sampleSize: number;
  readonly regime: string | null;
  readonly rationale: string;
  /** P-R: snapshots de auditoria do registro. */
  readonly providerId?: string | null;
  readonly modelVersion?: string | null;
  readonly featureVersion?: string | null;
}

export interface AnalyticsDeps {
  readonly persist: {
    save(record: DecisionRecord): Promise<void>;
    /** Idempotente: não sobrescreve outcomes já avaliados nem registros locked. */
    updateOutcome(id: string, record: Partial<DecisionRecord>): Promise<void>;
    incrementAttempts(id: string, error?: string): Promise<void>;
    listPending(filter: { symbol?: string; timeframe?: string }): Promise<DecisionRecord[]>;
    listAll(filter: { sinceMs?: number }): Promise<DecisionRecord[]>;
    stats(filter: { symbol?: string; timeframe?: string }): Promise<DecisionStats>;
    lastEvaluated(): Promise<number | null>;
  };
  readonly candles: (symbol: string, timeframe: Timeframe) => readonly MarketCandle[];
  readonly cfg?: ValidationConfig;
  readonly shadowRepo?: ShadowRepository;
  /** P-A: motor de calibração. Se presente, aplica Platt Scaling aos registros
   * recém-avaliados em `evaluatePending`. Opcional — service não falha se ausente. */
  readonly calibrationEngine?: CalibrationEngine;
  /** B7: writers para tabelas adaptativas (ensemble_weights, retrain_history,
   * model_daily_metrics, drift_alerts). Opcional — se ausente, writers são no-op. */
  readonly adaptiveRepo?: AdaptiveRepository;
  /** B7: limiar relativo de drift para disparar alerta (ECE atual vs média móvel 7d).
   * Default 0.50 = +50% acima da média. */
  readonly driftEceThreshold?: number;
}

export class AnalyticsService {
  private readonly deps: AnalyticsDeps;

  constructor(deps: AnalyticsDeps) {
    this.deps = deps;
  }

  private get persist() { return this.deps.persist; }
  private get candles() { return this.deps.candles; }
  private get cfg(): ValidationConfig { return this.deps.cfg ?? DEFAULT_VALIDATION; }
  private get shadowRepo() { return this.deps.shadowRepo; }
  private get calibrationEngine() { return this.deps.calibrationEngine; }
  private get adaptiveRepo() { return this.deps.adaptiveRepo; }

  /** Registra uma decisão saída da fusão. */
  async recordDecision(input: FusedDecisionInput): Promise<DecisionRecord> {
    const probabilities = normalizeProbabilities(input);
    // P-A (B2): Platt-scaled probability via wrapper `calibrateProbability` no
    // CalibrationEngine. Regras (alinhadas ao brief B2):
    //  - engine ausente → `probabilityCalibrated = null`.
    //  - rawProbability ausente/inválido → `null`.
    //  - chave nunca vista → fallback para rawProb.
    //  - snapshot INSUFFICIENT_SAMPLE (n < 30) → `null` (passthrough).
    //  - demais casos (PROVISIONAL | CALIBRATED | ROBUST) → Platt-scaled.
    const rawProb = input.probability;
    const engine = this.calibrationEngine;
    let probabilityCalibrated: number | null = null;
    if (engine && typeof rawProb === "number" && Number.isFinite(rawProb) && rawProb >= 0 && rawProb <= 1) {
      const key = {
        symbol: input.symbol,
        timeframe: input.timeframe,
        regime: input.regime ?? "unknown",
      };
      probabilityCalibrated = engine.calibrateProbability(rawProb, key);
    }

    const record: DecisionRecord = {
      id: crypto.randomUUID(),
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: input.direction,
      decision: input.decision,
      horizon: input.horizon,
      entryTime: input.entryTime,
      entryPrice: input.entryPrice,
      score: input.score,
      confidence: input.confidence,
      probability: rawProb,
      pBuy: probabilities.pBuy,
      pSell: probabilities.pSell,
      pWait: probabilities.pWait,
      probabilitySource: probabilities.source,
      probabilityCalibrated,
      sampleSize: input.sampleSize,
      regime: input.regime,
      rationale: input.rationale,
      providerId: input.providerId ?? null,
      modelVersion: input.modelVersion ?? null,
      featureVersion: input.featureVersion ?? null,
      outcome: "pending",
      exitTime: null,
      exitPrice: null,
      returnPct: null,
      grossReturnPct: null,
      costPct: null,
      evaluatedAt: null,
      evaluationAttempts: 0,
      lastEvaluationError: null,
      evaluationLocked: false,
      createdAt: Date.now(),
    };
    await this.persist.save(record);
    return record;
  }

  /**
   * Avalia decisões pendentes cujo horizonte já decorreu (dados reais).
   * Sem lookahead: só consulta candles com timestamp >= exitTime.
   * Idempotente: reroda o scheduler é seguro (updateOutcome + incrementAttempts).
   */
  async evaluatePending(filter: { symbol?: string; timeframe?: string } = {}): Promise<{ evaluated: number; outcomes: Record<Outcome, number> }> {
    const pending = await this.persist.listPending(filter);
    let evaluated = 0;
    const outcomes: Record<Outcome, number> = {
      hit: 0, miss: 0, flat: 0, pending: 0, stalled: 0, error: 0,
    };
    const now = Date.now();

    for (const rec of pending) {
      const tf = rec.timeframe as Timeframe;
      const step = TIMEFRAME_MS[tf];
      if (!step) {
        await this.markError(rec.id, `timeframe desconhecido: ${tf}`);
        outcomes.error++;
        continue;
      }
      const exitTime = rec.entryTime + rec.horizon * step;
      if (exitTime > now) continue; // horizonte ainda não decorreu (P-R pending puro)

      const candles = this.candles(rec.symbol, tf);
       const entry = candles.filter((c) => c.timestamp <= rec.entryTime).at(-1) ?? candles.find((c) => c.timestamp > rec.entryTime && c.timestamp < rec.entryTime + step);
       const exit = candles.find((c) => c.timestamp >= exitTime && c.timestamp < exitTime + step);
      if (!entry || !exit) {
        // P-R: dados futuros indisponíveis — marca "stalled" para distinguir
        // de "pending" (nunca tentado). NÃO entra em calibração win/loss.
        await this.persist.updateOutcome(rec.id, {
          outcome: "stalled",
          evaluatedAt: now,
          evaluationAttempts: (rec.evaluationAttempts ?? 0) + 1,
          lastEvaluationError: `candles insuficientes (entry=${!!entry}, exit=${!!exit})`,
        });
        outcomes.stalled++;
        continue;
      }

       const entryPrice = rec.entryPrice ?? entry.close;
       const outcome = this.outcomeOf(rec, entryPrice, exit.close);
      // P-T: separar grossReturnPct (antes de custos) do líquido.
       const rawReturnPct = ((exit.close - entryPrice) / (entryPrice || 1)) * 100;
      const grossReturnPct = rec.direction === "down" ? -rawReturnPct : rawReturnPct;
      const hasExposure = rec.decision === "BUY" || rec.decision === "SELL";
      const market = marketForProvider(rec.providerId);
      const costPct = executionCostPct({ market });
      const netReturnPct = hasExposure ? netReturnAfterCosts(grossReturnPct, costPct) : null;
      await this.persist.updateOutcome(rec.id, {
        outcome,
        exitTime,
        exitPrice: exit.close,
        returnPct: netReturnPct,
        grossReturnPct: hasExposure ? grossReturnPct : null,
        costPct: hasExposure ? costPct : null,
        evaluatedAt: now,
        evaluationAttempts: (rec.evaluationAttempts ?? 0) + 1,
        lastEvaluationError: null,
      });
      outcomes[outcome]++;
      evaluated++;
    }
    // P-A: aplica Platt Scaling aos registros recém-avaliados (best-effort).
    // NÃO falha se o engine não estiver configurado.
    if (evaluated > 0 && this.calibrationEngine) {
      try {
        await this.applyPlattToRecentlyEvaluated();
      } catch (e) {
        // Calibração é best-effort: nunca derruba o loop de avaliação.
        // eslint-disable-next-line no-console
        console.warn("[analytics] Platt scaling falhou:", String(e));
      }
    }
    // B7: writers adaptativos (ensemble_weights, retrain_history,
    // model_daily_metrics, drift_alerts). Best-effort — nunca falha a
    // avaliação. Roda mesmo sem calibrationEngine porque a métrica diária
    // depende apenas de `listAll` + ECE do relatório.
    if (this.adaptiveRepo) {
      try {
        await this.recordAdaptiveSnapshots();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[analytics] adaptive writers falharam:", String(e));
      }
    }
    return { evaluated, outcomes };
  }

  /**
   * B7: deriva writers adaptativos a partir do estado atual.
   *
   *  - `recordRetrain` quando o status muda em relação ao snapshot persistido
   *    (ex.: INSUFFICIENT_SAMPLE → PROVISIONAL).
   *  - `recordDailyMetric` por chave (symbol|tf|regime) uma vez por dia UTC.
   *  - `recordDriftAlert` quando ECE atual > média móvel 7d × (1+threshold).
   *
   * É no-op quando `adaptiveRepo` ausente ou não há dados suficientes.
   */
  private async recordAdaptiveSnapshots(): Promise<void> {
    const repo = this.adaptiveRepo;
    if (!repo) return;
    const driftThreshold = this.deps.driftEceThreshold ?? 0.5;
    const engine = this.calibrationEngine;
    // Coleta todas as chaves distintas do histórico do engine (se houver)
    // ou deriva do listAll como fallback.
    const keyMap = new Map<string, { symbol: string; timeframe: string; regime: string }>();
    if (engine) {
      for (const snap of engine.listSnapshots()) {
        const k = `${snap.key.symbol}|${snap.key.timeframe}|${snap.key.regime}`;
        if (!keyMap.has(k)) keyMap.set(k, snap.key);
      }
    }
    // Adiciona chaves dos registros avaliados (caso engine vazio).
    const since30 = Date.now() - 30 * 86_400_000;
    const recent = await this.persist.listAll({ sinceMs: since30 });
    for (const r of recent) {
      const k = `${r.symbol}|${r.timeframe}|${r.regime ?? "unknown"}`;
      if (!keyMap.has(k)) keyMap.set(k, { symbol: r.symbol, timeframe: r.timeframe, regime: r.regime ?? "unknown" });
    }
    if (keyMap.size === 0) return;

    const today = new Date().toISOString().slice(0, 10);

    for (const [key, parsed] of keyMap) {
      const snap = engine ? engine.getSnapshot(parsed) : null;
      const status = snap?.status ?? "INSUFFICIENT_SAMPLE";
      const A = snap?.fit.params.A ?? 1;
      const B = snap?.fit.params.B ?? 0;
      const nSamples = snap?.fit.nSamples ?? 0;
      const ece = snap?.oos?.ece ?? 0;
      const updatedAt = snap?.updatedAt ?? Date.now();

      // (1) ensemble_weights (singleton) — atualiza SEMPRE (não é histórico).
      // Upsert idempotente: mesma payload duas vezes = mesma linha.
      const previous = repo.getEnsembleWeights(key);
      try {
        repo.upsertEnsembleWeights({
          key,
          A,
          B,
          status,
          nSamples,
          ece,
          updatedAt,
          holdoutBrier: snap?.oos?.brierScore ?? null,
        });
      } catch (e) {
        console.warn("[analytics] upsertEnsembleWeights falhou:", String(e));
      }

      // (2) retrain_history — SÓ quando status mudou (significativo: INSUFFICIENT_SAMPLE → outros, ou entre tiers).
      if (previous && previous.status !== status && status !== "INSUFFICIENT_SAMPLE") {
        // Status subiu de nível (ou regrediu) → registra auditoria.
        repo.recordRetrain({
          key,
          beforeN: previous.nSamples,
          afterN: nSamples,
          beforeEce: previous.ece,
          afterEce: ece,
          triggeredAt: updatedAt,
          reason: `status_change:${previous.status}->${status}`,
        });
      }

      // (3) model_daily_metrics — UPSERT por dia.
      // Calcula win rate e brier do conjunto de decisões AVALIADAS dessa chave
      // nos candles que caem no dia UTC de hoje.
      try {
        const keyDecisions = recent.filter(
          (r) =>
            r.symbol === parsed.symbol &&
            r.timeframe === parsed.timeframe &&
            (r.regime ?? "unknown") === parsed.regime &&
            r.outcome !== "pending",
        );
        const todayMs = Date.now();
        const dayStart = Math.floor(todayMs / 86_400_000) * 86_400_000;
        const dayEnd = dayStart + 86_400_000;
        const todayRows = keyDecisions.filter((r) => {
          const ts = r.evaluatedAt ?? r.createdAt;
          return ts >= dayStart && ts < dayEnd;
        });
        if (todayRows.length > 0) {
          let wins = 0;
          let brierSum = 0;
          let brierN = 0;
          for (const r of todayRows) {
            if (r.outcome === "hit") wins++;
            if (typeof r.probability === "number" && (r.outcome === "hit" || r.outcome === "miss")) {
              const y = r.outcome === "hit" ? 1 : 0;
              brierSum += (r.probability - y) ** 2;
              brierN++;
            }
          }
          const directional = todayRows.filter(
            (r) => r.outcome === "hit" || r.outcome === "miss",
          ).length;
          const winRate = directional > 0 ? wins / directional : 0;
          const brier = brierN > 0 ? brierSum / brierN : 0;
          repo.recordDailyMetric({
            date: today,
            model: key,
            n: directional,
            winRate,
            brier,
          });
        }
      } catch (e) {
        console.warn("[analytics] recordDailyMetric falhou:", String(e));
      }

      // (4) drift_alerts — quando o Brier OOS atual > média móvel 7d ×
      // (1 + threshold). A tabela diária persiste Brier (não ECE), portanto
      // comparamos a mesma métrica em ambos os lados.
      try {
        const avg = repo.dailyMetricAvg({ model: key, days: 7 });
        const latest = repo.latestDailyMetric(key);
        const currentBrier = snap?.oos?.brierScore ?? null;
        // Comparação só faz sentido se houver histórico de 7 dias
        // (avg.n >= MIN_DAILY_SAMPLES_FOR_DRIFT).
        const MIN_DAILY_SAMPLES_FOR_DRIFT = 20;
        if (avg && avg.n >= MIN_DAILY_SAMPLES_FOR_DRIFT && currentBrier !== null && currentBrier > 0) {
          const baselineBrier = avg.avgBrier;
          if (
            baselineBrier > 0 &&
            currentBrier > baselineBrier * (1 + driftThreshold) &&
            (!latest || latest.date !== today)
          ) {
            repo.recordDriftAlert({
              key,
              alertType: "brier_drift",
              severity: currentBrier > baselineBrier * (1 + driftThreshold * 2) ? "critical" : "warning",
              message: `Brier OOS ${currentBrier.toFixed(4)} > média 7d ${baselineBrier.toFixed(4)} (+${(driftThreshold * 100).toFixed(0)}%)`,
              detectedAt: Date.now(),
              snapshot: {
                currentBrier,
                baselineBrier,
                threshold: driftThreshold,
                n: avg.n,
              },
              actionTaken: "alert",
            });
          }
        }
      } catch (e) {
        console.warn("[analytics] recordDriftAlert falhou:", String(e));
      }
    }
  }

  /**
   * P-A (B2): após cada tick de `evaluatePending`, recalcula Platt Scaling
   * sobre o histórico disponível e atualiza `probability_calibrated` dos
   * registros recém-avaliados (últimos 5 minutos).
   *
   * Best-effort: nunca falha a avaliação.
   */
  private async applyPlattToRecentlyEvaluated(): Promise<void> {
    const engine = this.calibrationEngine;
    if (!engine) return;
    const sinceMs = Date.now() - 45 * 86_400_000;
    const all = await this.persist.listAll({ sinceMs });
    if (all.length === 0) return;
    // Atualiza o histórico do engine para garantir que o fit use dados recentes.
    engine.pushHistory(all);
    // Aplica calibração e persiste o resultado no banco.
    const keys = new Map<string, { symbol: string; timeframe: string; regime: string }>();
    for (const r of all) {
      const key = { symbol: r.symbol, timeframe: r.timeframe, regime: r.regime ?? "unknown" };
      keys.set(`${key.symbol}|${key.timeframe}|${key.regime}`, key);
    }
    for (const key of keys.values()) engine.fitForKey(key);
    for (const r of all) {
      const probabilityCalibrated = engine.calibrateProbability(r.probability, {
        symbol: r.symbol,
        timeframe: r.timeframe,
        regime: r.regime ?? "unknown",
      });
      await this.persist.updateOutcome(r.id, { probabilityCalibrated });
    }
  }

  /** Marca um registro como erro operacional (sem mexer no outcome se já avaliado). */
  private async markError(id: string, message: string): Promise<void> {
    await this.persist.incrementAttempts(id, message);
  }

  /** Estatística agregada e calibração. */
  stats(filter: { symbol?: string; timeframe?: string } = {}): Promise<DecisionStats> {
    return this.persist.stats(filter);
  }

  /** Relatório completo de calibração (Brier, ECE, win rate por sinal/TF, drawdown, guard status). */
  async calibration(opts: { days?: number } = {}): Promise<CalibrationReport> {
    const store = {
      listEvaluatedDecisions: async (o: { days?: number } = {}) => {
        const sinceMs = o.days ? Date.now() - o.days * 24 * 60 * 60 * 1000 : undefined;
        return (this.persist as unknown as {
          listAll: (f: { sinceMs?: number }) => Promise<DecisionRecord[]>;
        }).listAll({ sinceMs });
      },
    };
    return getCalibrationReport(store, opts);
  }

  /** Snapshot de PnL e métricas históricas. */
  async perfSnapshot(opts: { lookbackDays?: number; signalFilter?: "BUY" | "SELL" | null } = {}): Promise<PerfSnapshot> {
    const sinceMs = opts.lookbackDays ? Date.now() - opts.lookbackDays * 24 * 60 * 60 * 1000 : undefined;
    const all = await (this.persist as unknown as {
      listAll: (f: { sinceMs?: number }) => Promise<DecisionRecord[]>;
    }).listAll({ sinceMs });
    let rows = all;
    if (opts.signalFilter) rows = rows.filter((r) => r.decision === opts.signalFilter);
    return buildPerfSnapshotFromRecords(rows);
  }

  /** Stats + lista de shadow trades para a vitrine. */
  async shadowStats(filter?: { sinceMs?: number; signal?: "BUY" | "SELL" | null }): Promise<{
    stats: { total: number; evaluated: number; wins: number; misses: number; winRate: number; netReturn: number; avgReturn: number };
    trades: ReturnType<ShadowRepository["list"]>;
  } | null> {
    if (!this.shadowRepo) return null;
    const trades = this.shadowRepo.list(filter);
    const stats = this.shadowRepo.stats(filter);
    return { stats, trades: trades.slice(0, 50) };
  }

  /**
   * Shadow trading (paper trading) — registra o que TERIA acontecido se o
   * usuário tivesse clicado BUY/SELL no momento do sinal. Avalia contra
   * candles futuros reais quando o horizonte decorre.
   *
   * Só funciona se `shadowRepo` foi injetado no constructor (parâmetro opcional).
   */
  async recordShadowTrade(input: {
    symbol: string;
    timeframe: string;
    direction: "up" | "down";
     decision: "BUY" | "SELL" | "WAIT";
    entryTime: number;
    entryPrice: number;
     confidence?: number;
     probability?: number;
     horizon?: number;
    stopLossPct?: number;
    cooldownMinutes?: number;
    providerId?: string | null;
  }): Promise<ShadowTrade | null> {
    if (!this.shadowRepo) return null;
    if (input.decision === "WAIT") return null;
    // Cooldown entre trades do mesmo symbol+decision: se o último foi aberto
    // há menos de `cooldownMinutes` (default 4h), rejeita o novo trade.
    // WAIT nunca respeita cooldown (não tem exposição direcional).
    const cooldownMinutes = input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
    if (Number.isFinite(cooldownMinutes) && cooldownMinutes > 0) {
      const cooldownMs = cooldownMinutes * 60 * 1000;
      const sinceMs = input.entryTime - cooldownMs;
      const recent = this.shadowRepo.list({
        symbol: input.symbol,
        signal: input.decision,
        sinceMs,
      });
      // Filtra: mesmo direction (up/down) e entryTime > sinceMs (i.e. dentro da janela)
      const recentSameDir = recent.filter(
        (t) => t.direction === input.direction && t.entryTime >= sinceMs && t.entryTime < input.entryTime,
      );
      if (recentSameDir.length > 0) {
        // Cooldown ativo: rejeita novo trade (não salva).
        return null;
      }
    }

    const trade = openShadowTrade(input);
    this.shadowRepo.save(trade);
    return trade;
  }

  /**
   * Avalia shadow trades pendentes cujo horizonte JÁ decorreu.
   * Retorna contagem por outcome. Causalidade: só consulta candles futuros
   * depois do horizonte passar (não inventa dados).
   * Retorna null se shadowRepo não foi injetado.
   */
  async evaluatePendingShadows(horizon: number): Promise<{ evaluated: number; outcomes: Record<string, number> } | null> {
    if (!this.shadowRepo) return null;
    const now = Date.now();
    const pending = this.shadowRepo.list().filter((trade) => trade.outcome === "pending" || trade.outcome === "stalled");
    let evaluated = 0;
    const outcomes: Record<string, number> = {
      pending: 0, hit: 0, miss: 0, flat: 0, insufficient: 0, stopped: 0, stalled: 0, error: 0,
    };

    for (const trade of pending) {
      if (trade.outcome !== "pending") continue;
      const tf = trade.timeframe as Timeframe;
      const step = TIMEFRAME_MS[tf];
      if (!step) {
        outcomes.error = (outcomes.error ?? 0) + 1;
        continue;
      }
      const tradeHorizon = trade.horizon && trade.horizon > 0 ? trade.horizon : horizon;
      const exitTime = trade.entryTime + tradeHorizon * step;
      if (exitTime > now) continue;

      const candles = this.candles(trade.symbol, tf);
      const futureCandles = candles
        .filter((c) => c.timestamp >= trade.entryTime)
        .map((c) => ({ timestamp: c.timestamp, close: c.close, high: c.high, low: c.low }));
      const evaluatedTrade = evaluateShadowTrade(trade, futureCandles, tradeHorizon, this.cfg.minMovePct);
      if (evaluatedTrade.outcome === "stalled") {
        this.shadowRepo.update(trade.id, { outcome: "stalled", evaluationAttempts: (trade.evaluationAttempts ?? 0) + 1, lastEvaluationError: "candle de liquidação ainda indisponível" });
        outcomes.stalled = (outcomes.stalled ?? 0) + 1;
        continue;
      }

      this.shadowRepo.update(trade.id, {
        exitTime: evaluatedTrade.exitTime,
        exitPrice: evaluatedTrade.exitPrice,
        outcome: evaluatedTrade.outcome,
        returnPct: evaluatedTrade.returnPct,
        grossReturnPct: evaluatedTrade.grossReturnPct ?? null,
        costPct: evaluatedTrade.costPct ?? null,
        evaluatedAt: evaluatedTrade.evaluatedAt,
        stopLossTriggeredAt: evaluatedTrade.stopLossTriggeredAt ?? null,
        evaluationAttempts: (trade.evaluationAttempts ?? 0) + 1,
        lastEvaluationError: null,
      });
      outcomes[evaluatedTrade.outcome] = (outcomes[evaluatedTrade.outcome] ?? 0) + 1;
      evaluated++;
    }
    return { evaluated, outcomes };
  }

  private outcomeOf(rec: DecisionRecord, entry: number, exit: number): Outcome {
    if (entry === 0) return "flat";
    const pct = ((exit - entry) / entry) * 100;
    if (Math.abs(pct) < this.cfg.minMovePct) return "flat";
    // decisão BUY espera up; SELL espera down; WAIT não é avaliado direcional.
    if (rec.decision === "WAIT") return "flat";
    const expectedUp = rec.decision === "BUY";
    if (expectedUp) return pct > 0 ? "hit" : "miss";
    return pct < 0 ? "hit" : "miss";
  }
}

function marketForProvider(providerId: string | null | undefined): "crypto" | "forex" | "binary" {
  const id = (providerId ?? "").toLowerCase();
  if (id.includes("iqoption") || id.includes("binary")) return "binary";
  if (id.includes("forex") || id.includes("oanda") || id.includes("yahoo")) return "forex";
  return "crypto";
}
