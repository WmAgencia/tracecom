/**
 * B7 — EnsembleRepository: writers para as 4 tabelas adaptativas.
 *
 * Resolve o "schema órfão" do backlog TRACECON: as 4 tabelas existem no schema
 * (definidas em src/store/db.ts linhas ~189-228) mas nenhum produtor em código
 * de produção gravava nelas. Esta classe é o produtor.
 *
 * Tabelas cobertas (schema REAL em db.ts — não inventado):
 *  - ensemble_weights: PK = id (singleton, CHECK id=1). Colunas:
 *      weights_json, baseline_brier_json, trained_at, sample_size, holdout_brier.
 *  - retrain_history: PK = id AUTOINCREMENT. Colunas:
 *      trained_at, trigger, weights_json, holdout_brier, deployed.
 *  - model_daily_metrics: PK composta = (date, model). Colunas:
 *      date, model, brier, win_rate, n_trades.
 *  - drift_alerts: PK = id AUTOINCREMENT. Colunas:
 *      detected_at, model, severity, action_taken, details_json.
 *
 * Princípios:
 *  - Use prepared statements parametrizados (sem interpolação de user data).
 *  - Falha silenciosa para writers no-op quando `store.available === false`.
 *  - Idempotente onde faz sentido (ensemble_weights, model_daily_metrics).
 *  - Append-only para trilha de auditoria (retrain_history, drift_alerts).
 */
import type { Datastore } from "../db";

/** Chave canônica usada para identificar um bucket adaptativo (symbol|timeframe|regime). */
export type AdaptiveKey = string;

export function adaptiveKey(symbol: string, timeframe: string, regime: string | null): AdaptiveKey {
  return `${symbol}|${timeframe}|${regime ?? "unknown"}`;
}

/** Payload para `model_daily_metrics` (UPSERT por date+model). */
export interface DailyMetricInput {
  /** YYYY-MM-DD UTC. */
  readonly date: string;
  /** Chave do modelo (use `adaptiveKey(...)`). */
  readonly model: AdaptiveKey;
  /** Brier score observado no dia. */
  readonly brier: number | null;
  /** Win rate observada no dia (0..1). */
  readonly winRate: number | null;
  /** n de trades avaliados neste dia. */
  readonly n: number;
}

/** Payload para `drift_alerts` (INSERT-only). */
export interface DriftAlertInput {
  readonly key: AdaptiveKey;
  readonly alertType: string;
  readonly severity: "info" | "mild" | "warning" | "critical";
  readonly message: string;
  readonly detectedAt: number;
  /** Snapshot JSON livre. */
  readonly snapshot: Record<string, unknown>;
  /** Ação tomada pelo sistema. Default: "alert". */
  readonly actionTaken?: string;
}

/** Linha retornada por `getLatestWeights`. */
export interface EnsembleWeightsRow {
  readonly weightsJson: string;
  readonly baselineBrierJson: string;
  readonly trainedAt: number;
  readonly sampleSize: number;
  readonly holdoutBrier: number | null;
}

/** Linha de `drift_alerts` retornada por `getRecentDriftAlerts`. */
export interface DriftAlertRow {
  readonly id: number;
  readonly model: string;
  readonly severity: string;
  readonly actionTaken: string;
  readonly detectedAt: number;
  readonly detailsJson: string | null;
}

/** Forma parseada do payload ao chamar `recordDriftAlert`. */
export interface DriftAlertParsedRow extends DriftAlertRow {
  readonly parsed: {
    readonly alertType: string;
    readonly message: string;
    readonly snapshot: Record<string, unknown>;
  };
}

interface WeightsDbRow {
  readonly weights_json: string;
  readonly baseline_brier_json: string;
  readonly trained_at: number;
  readonly sample_size: number;
  readonly holdout_brier: number | null;
}

interface DriftAlertDbRow {
  readonly id: number;
  readonly detected_at: number;
  readonly model: string;
  readonly severity: string;
  readonly action_taken: string;
  readonly details_json: string | null;
}

export class EnsembleRepository {
  constructor(private readonly store: Datastore) {}

  /**
   * UPSERT em `model_daily_metrics` (PK = date, model).
   *
   * Idempotente: rodar 2× no mesmo dia apenas atualiza contadores (não duplica).
   * `n` mapeia para a coluna `n_trades` (legado no schema).
   */
  recordDailyMetrics(m: {
    readonly date: string;
    readonly model: AdaptiveKey;
    readonly brier: number | null;
    readonly winRate: number | null;
    readonly n: number;
  }): void {
    if (!this.store.available) return;
    this.store.db
      .prepare(
        `INSERT INTO model_daily_metrics
          (date, model, brier, win_rate, n_trades)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date, model) DO UPDATE SET
           brier = excluded.brier,
           win_rate = excluded.win_rate,
           n_trades = excluded.n_trades`,
      )
      .run(m.date, m.model, m.brier, m.winRate, m.n);
  }

  /**
   * INSERT em `drift_alerts` (autoincrement). Trilha de auditoria — não idempotente.
   */
  recordDriftAlert(a: DriftAlertInput): number {
    if (!this.store.available) return 0;
    const actionTaken = a.actionTaken ?? "alert";
    const result = this.store.db
      .prepare(
        `INSERT INTO drift_alerts
          (detected_at, model, severity, action_taken, details_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        a.detectedAt,
        a.key,
        a.severity,
        actionTaken,
        JSON.stringify({
          alertType: a.alertType,
          message: a.message,
          snapshot: a.snapshot,
        }),
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * UPSERT em `ensemble_weights` (singleton, id=1).
   *
   * A tabela tem apenas UM slot (id=1, CHECK id=1). O snapshot mais recente
   * vence — schema legada. Para auditoria de versões históricas, use
   * `appendRetrainHistory`. Idempotente.
   */
  upsertEnsembleWeights(input: {
    readonly weightsJson: string;
    readonly baselineBrierJson: string;
    readonly trainedAt: number;
    readonly sampleSize: number;
    readonly holdoutBrier: number | null;
  }): void {
    if (!this.store.available) return;
    this.store.db
      .prepare(
        `INSERT INTO ensemble_weights
          (id, weights_json, baseline_brier_json, trained_at, sample_size, holdout_brier)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           weights_json = excluded.weights_json,
           baseline_brier_json = excluded.baseline_brier_json,
           trained_at = excluded.trained_at,
           sample_size = excluded.sample_size,
           holdout_brier = excluded.holdout_brier`,
      )
      .run(
        input.weightsJson,
        input.baselineBrierJson,
        input.trainedAt,
        input.sampleSize,
        input.holdoutBrier,
      );
  }

  /**
   * INSERT em `retrain_history` (autoincrement). Trilha de auditoria.
   * Não idempotente — cada chamada adiciona uma linha (audit log).
   */
  appendRetrainHistory(e: {
    readonly trainedAt: number;
    readonly trigger: string;
    readonly weightsJson: string;
    readonly holdoutBrier: number | null;
    readonly deployed?: 0 | 1;
  }): number {
    if (!this.store.available) return 0;
    const result = this.store.db
      .prepare(
        `INSERT INTO retrain_history
          (trained_at, trigger, weights_json, holdout_brier, deployed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        e.trainedAt,
        e.trigger,
        e.weightsJson,
        e.holdoutBrier,
        e.deployed ?? 1,
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * Recupera os pesos correntes (singleton).
   * Retorna null se nada foi gravado ou se o store está indisponível.
   */
  getLatestWeights(_symbol: string, _timeframe: string, _regime: string): EnsembleWeightsRow | null {
    if (!this.store.available) return null;
    const row = this.store.db
      .prepare(
        `SELECT weights_json, baseline_brier_json, trained_at, sample_size, holdout_brier
         FROM ensemble_weights WHERE id = 1`,
      )
      .get() as WeightsDbRow | undefined;
    if (!row) return null;
    return {
      weightsJson: row.weights_json,
      baselineBrierJson: row.baseline_brier_json,
      trainedAt: Number(row.trained_at),
      sampleSize: Number(row.sample_size),
      holdoutBrier: row.holdout_brier,
    };
  }

  /**
   * Lista os alertas de drift mais recentes. Default: últimos 20.
   */
  getRecentDriftAlerts(limit = 20): DriftAlertParsedRow[] {
    if (!this.store.available) return [];
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = this.store.db
      .prepare(
        `SELECT id, detected_at, model, severity, action_taken, details_json
         FROM drift_alerts
         ORDER BY detected_at DESC
         LIMIT ?`,
      )
      .all(safeLimit) as unknown as DriftAlertDbRow[];
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const parsed = parseDetails(r.details_json);
      return {
        id: Number(r.id),
        model: r.model,
        severity: r.severity,
        actionTaken: r.action_taken,
        detectedAt: Number(r.detected_at),
        detailsJson: r.details_json,
        parsed,
      };
    });
  }

  /**
   * Lista o histórico de retreinos (mais recente primeiro). Helper de inspeção.
   */
  listRetrainHistory(limit = 100): Array<{
    id: number;
    trainedAt: number;
    trigger: string;
    weightsJson: string;
    holdoutBrier: number | null;
    deployed: 0 | 1;
  }> {
    if (!this.store.available) return [];
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = this.store.db
      .prepare(
        `SELECT id, trained_at, trigger, weights_json, holdout_brier, deployed
         FROM retrain_history ORDER BY trained_at DESC LIMIT ?`,
      )
      .all(safeLimit) as unknown as Array<{
        id: number;
        trained_at: number;
        trigger: string;
        weights_json: string;
        holdout_brier: number | null;
        deployed: number;
      }>;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      id: Number(r.id),
      trainedAt: Number(r.trained_at),
      trigger: r.trigger,
      weightsJson: r.weights_json,
      holdoutBrier: r.holdout_brier,
      deployed: r.deployed === 1 ? 1 : 0,
    }));
  }

  /**
   * Lista métricas diárias (helper de teste/inspeção).
   */
  listDailyMetrics(opts: { model?: AdaptiveKey; sinceDate?: string } = {}): Array<{
    date: string;
    model: string;
    brier: number | null;
    winRate: number | null;
    nTrades: number | null;
  }> {
    if (!this.store.available) return [];
    const where: string[] = [];
    const params: (string)[] = [];
    if (opts.model) { where.push("model = ?"); params.push(opts.model); }
    if (opts.sinceDate) { where.push("date >= ?"); params.push(opts.sinceDate); }
    const sql = `SELECT date, model, brier, win_rate, n_trades
                 FROM model_daily_metrics
                 ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY date DESC`;
    const rows = this.store.db.prepare(sql).all(...params) as unknown as Array<{
      date: string;
      model: string;
      brier: number | null;
      win_rate: number | null;
      n_trades: number | null;
    }>;
    return rows.map((row) => ({
      date: row.date,
      model: row.model,
      brier: row.brier,
      winRate: row.win_rate,
      nTrades: row.n_trades,
    }));
  }
}

function parseDetails(raw: string | null): {
  alertType: string;
  message: string;
  snapshot: Record<string, unknown>;
} {
  if (!raw) return { alertType: "unknown", message: "", snapshot: {} };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { alertType: "unknown", message: "", snapshot: {} };
    }
    const obj = parsed as Record<string, unknown>;
    const snap = obj.snapshot;
    return {
      alertType: typeof obj.alertType === "string" ? obj.alertType : "unknown",
      message: typeof obj.message === "string" ? obj.message : "",
      snapshot: (snap && typeof snap === "object" ? snap : {}) as Record<string, unknown>,
    };
  } catch {
    return { alertType: "unknown", message: "", snapshot: {} };
  }
}
