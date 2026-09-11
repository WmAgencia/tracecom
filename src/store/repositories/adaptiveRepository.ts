/**
 * B7 — Adaptive writers para as 4 tabelas órfãs do schema adaptativo.
 *
 * Tabelas cobertas (declaradas em src/store/db.ts linhas 173-213):
 *  - ensemble_weights (singleton, id=1): UPSERT por id. Armazena pesos do
 *    ensemble + Platt A/B por chave + ECE/status OOS em JSON (consultável).
 *  - retrain_history (AUTOINCREMENT): INSERT-only. Auditoria de cada fit.
 *  - model_daily_metrics (PK date+model): UPSERT (idempotente por dia).
 *  - drift_alerts (AUTOINCREMENT): INSERT-only. Trilha de auditoria.
 *
 * Toda escrita é idempotente quando faz sentido (ensemble_weights, daily
 * metrics). Histórico e alertas são append-only porque são trilha de auditoria.
 */
import type { Datastore } from "../db";

/** Chave canônica usada nas 4 tabelas (símbolo|timeframe|regime). */
export type AdaptiveKey = string;

/** Payload de ensemble_weights — singleton (id=1). */
export interface EnsembleWeightsInput {
  /** Chave lógica (symbol|timeframe|regime). */
  readonly key: AdaptiveKey;
  /** Coeficiente A do Platt (1.0 = identidade). */
  readonly A: number;
  /** Bias B do Platt (0.0 = sem shift). */
  readonly B: number;
  /** Status de calibração (INSUFFICIENT_SAMPLE | PROVISIONAL | CALIBRATED | ROBUST). */
  readonly status: string;
  /** n amostras TREINO usadas no fit. */
  readonly nSamples: number;
  /** ECE OOS (0 quando status=INSUFFICIENT_SAMPLE). */
  readonly ece: number;
  /** Timestamp ms do fit. */
  readonly updatedAt: number;
  /** Brier baseline OOS (opcional, para auditoria). */
  readonly baselineBrier?: number | null;
  /** Holdout Brier (opcional, espelha schema). */
  readonly holdoutBrier?: number | null;
}

/** Linha retornada por getEnsembleWeights. */
export interface EnsembleWeightsRow {
  readonly key: AdaptiveKey;
  readonly A: number;
  readonly B: number;
  readonly status: string;
  readonly nSamples: number;
  readonly ece: number;
  readonly updatedAt: number;
  readonly baselineBrier: number | null;
  readonly holdoutBrier: number | null;
}

/** Payload para retrain_history — append-only. */
export interface RetrainRecordInput {
  readonly key: AdaptiveKey;
  readonly beforeN: number;
  readonly afterN: number;
  readonly beforeEce: number;
  readonly afterEce: number;
  readonly triggeredAt: number;
  readonly reason: string;
  readonly weightsJson?: string;
  readonly holdoutBrier?: number | null;
  readonly deployed?: 0 | 1;
}

/** Payload para model_daily_metrics — UPSERT (date, model). */
export interface DailyMetricInput {
  /** YYYY-MM-DD UTC. */
  readonly date: string;
  /** Chave lógica (symbol|timeframe|regime). */
  readonly model: AdaptiveKey;
  /** n trades avaliados neste dia. */
  readonly n: number;
  /** Win rate (0..1) sobre direcional. */
  readonly winRate: number;
  /** Brier score (0..1). */
  readonly brier: number;
}

/** Payload para drift_alerts — INSERT-only (audit trail). */
export interface DriftAlertInput {
  readonly key: AdaptiveKey;
  readonly alertType: string;
  readonly severity: "info" | "mild" | "warning" | "critical";
  readonly message: string;
  readonly detectedAt: number;
  /** Snapshot JSON livre (ECE baseline, ECE atual, etc.). */
  readonly snapshot: Record<string, unknown>;
  /** Ação tomada pelo sistema ("alert", "rollback", etc.). */
  readonly actionTaken?: string;
}

/** Linha de drift_alerts retornada por listDriftAlerts. */
export interface DriftAlertRow {
  readonly id: number;
  readonly key: AdaptiveKey;
  readonly alertType: string;
  readonly severity: string;
  readonly message: string;
  readonly detectedAt: number;
  readonly snapshot: Record<string, unknown>;
  readonly actionTaken: string;
}

interface EnsembleRow {
  readonly id: number;
  readonly weights_json: string;
  readonly baseline_brier_json: string;
  readonly trained_at: number;
  readonly sample_size: number;
  readonly holdout_brier: number | null;
}

interface RetrainRow {
  readonly id: number;
  readonly trained_at: number;
  readonly trigger: string;
  readonly weights_json: string;
  readonly holdout_brier: number | null;
  readonly deployed: number;
}

interface DailyMetricRow {
  readonly date: string;
  readonly model: string;
  readonly brier: number | null;
  readonly win_rate: number | null;
  readonly n_trades: number | null;
}

interface DriftAlertDbRow {
  readonly id: number;
  readonly detected_at: number;
  readonly model: string;
  readonly severity: string;
  readonly action_taken: string;
  readonly details_json: string | null;
}

export class AdaptiveRepository {
  constructor(private readonly store: Datastore) {}

  /**
   * Singleton UPSERT em ensemble_weights (PK=1).
   *
   * `key` é a chave lógica armazenada dentro do JSON (a tabela tem apenas
   * um slot; snapshot mais recente vence). Idempotente: rodar 2× com mesmo
   * payload = 1 linha.
   */
  upsertEnsembleWeights(input: EnsembleWeightsInput): void {
    const weights: Record<string, unknown> = {
      key: input.key,
      A: input.A,
      B: input.B,
      status: input.status,
      nSamples: input.nSamples,
      ece: input.ece,
      updatedAt: input.updatedAt,
      holdoutBrier: input.holdoutBrier ?? null,
    };
    const baseline: Record<string, unknown> = {
      key: input.key,
      baselineBrier: input.baselineBrier ?? null,
    };
    const current = this.store.db
      .prepare("SELECT weights_json, baseline_brier_json FROM ensemble_weights WHERE id = 1")
      .get() as { weights_json: string; baseline_brier_json: string } | undefined;
    const entries: Record<string, Record<string, unknown>> = {};
    const baselines: Record<string, Record<string, unknown>> = {};
    if (current) {
      try {
        const parsed = JSON.parse(current.weights_json) as Record<string, unknown>;
        if (parsed.entries && typeof parsed.entries === "object") {
          Object.assign(entries, parsed.entries);
        } else if (typeof parsed.key === "string") {
          entries[parsed.key] = parsed;
        }
        const parsedBaselines = JSON.parse(current.baseline_brier_json) as Record<string, unknown>;
        if (parsedBaselines.entries && typeof parsedBaselines.entries === "object") {
          Object.assign(baselines, parsedBaselines.entries);
        } else if (typeof parsedBaselines.key === "string") {
          baselines[parsedBaselines.key] = parsedBaselines;
        }
      } catch {
        // Linha legada/corrompida é substituída por um snapshot v2 válido.
      }
    }
    entries[input.key] = weights;
    baselines[input.key] = baseline;
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
        JSON.stringify({ version: 2, entries }),
        JSON.stringify({ version: 2, entries: baselines }),
        input.updatedAt,
        input.nSamples,
        input.holdoutBrier ?? null,
      );
  }

  /**
   * INSERT em retrain_history (autoincrement). Audit trail — não idempotente.
   */
  recordRetrain(input: RetrainRecordInput): number {
    const weightsJson = input.weightsJson ?? JSON.stringify({
      key: input.key,
      beforeN: input.beforeN,
      afterN: input.afterN,
      beforeEce: input.beforeEce,
      afterEce: input.afterEce,
    });
    const result = this.store.db
      .prepare(
        `INSERT INTO retrain_history
          (trained_at, trigger, weights_json, holdout_brier, deployed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.triggeredAt,
        input.reason,
        weightsJson,
        input.holdoutBrier ?? null,
        input.deployed ?? 1,
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * UPSERT em model_daily_metrics (PK = date, model). Idempotente — rodar
   * 2× no mesmo dia apenas atualiza contadores, sem duplicar.
   */
  recordDailyMetric(input: DailyMetricInput): void {
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
      .run(input.date, input.model, input.brier, input.winRate, input.n);
  }

  /** INSERT em drift_alerts (autoincrement). Audit trail — não idempotente. */
  recordDriftAlert(input: DriftAlertInput): number {
    const actionTaken = input.actionTaken ?? "alert";
    const result = this.store.db
      .prepare(
        `INSERT INTO drift_alerts
          (detected_at, model, severity, action_taken, details_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.detectedAt,
        input.key,
        input.severity,
        actionTaken,
        JSON.stringify({
          alertType: input.alertType,
          message: input.message,
          snapshot: input.snapshot,
        }),
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * Lista alertas de drift desde `sinceMs` (ms epoch). Sem filtro = todo o
   * histórico. Ordenado mais recente → mais antigo.
   */
  listDriftAlerts(opts: { sinceMs?: number } = {}): DriftAlertRow[] {
    const sinceMs = opts.sinceMs ?? 0;
    const rows = this.store.db
      .prepare(
        `SELECT id, detected_at, model, severity, action_taken, details_json
         FROM drift_alerts
         WHERE detected_at >= ?
         ORDER BY detected_at DESC`,
      )
      .all(sinceMs) as unknown as DriftAlertDbRow[];
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const details = parseDetails(r.details_json);
      return {
        id: r.id,
        key: r.model,
        alertType: details.alertType ?? "unknown",
        severity: r.severity,
        message: details.message ?? "",
        detectedAt: r.detected_at,
        snapshot: (details.snapshot ?? {}) as Record<string, unknown>,
        actionTaken: r.action_taken,
      };
    });
  }

  /** Recupera os pesos correntes (singleton). Null se nada foi gravado. */
  getEnsembleWeights(key?: AdaptiveKey): EnsembleWeightsRow | null {
    const row = this.store.db
      .prepare(
        `SELECT id, weights_json, baseline_brier_json, trained_at, sample_size, holdout_brier
         FROM ensemble_weights WHERE id = 1`,
      )
      .get() as EnsembleRow | undefined;
    if (!row) return null;
    let parsed: Record<string, unknown>;
    let baseline: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.weights_json) as Record<string, unknown>;
      baseline = JSON.parse(row.baseline_brier_json) as Record<string, unknown>;
    } catch {
      return null;
    }
    const entryMap = parsed.entries && typeof parsed.entries === "object"
      ? parsed.entries as Record<string, Record<string, unknown>>
      : null;
    const baselineMap = baseline.entries && typeof baseline.entries === "object"
      ? baseline.entries as Record<string, Record<string, unknown>>
      : null;
    let selected = parsed;
    let selectedBaseline = baseline;
    if (entryMap) {
      if (key !== undefined) {
        selected = entryMap[key] ?? {};
        selectedBaseline = baselineMap?.[key] ?? {};
      } else {
        selected = Object.values(entryMap)
          .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))[0] ?? {};
        const selectedKey = String(selected.key ?? "");
        selectedBaseline = baselineMap?.[selectedKey] ?? {};
      }
    }
    const rowKey = String(selected.key ?? "");
    if (key !== undefined && rowKey !== key) return null;
    const A = Number(selected.A ?? 1);
    const B = Number(selected.B ?? 0);
    const status = String(selected.status ?? "INSUFFICIENT_SAMPLE");
    const nSamples = Number(selected.nSamples ?? row.sample_size);
    const ece = Number(selected.ece ?? 0);
    const updatedAt = Number(selected.updatedAt ?? row.trained_at);
    const baselineBrier =
      typeof selectedBaseline.baselineBrier === "number" ? selectedBaseline.baselineBrier : null;
    return {
      key: rowKey,
      A,
      B,
      status,
      nSamples,
      ece,
      updatedAt,
      baselineBrier,
      holdoutBrier: typeof selected.holdoutBrier === "number"
        ? selected.holdoutBrier
        : row.holdout_brier,
    };
  }

  /**
   * Métrica mais recente (qualquer data) por modelo — usado para detectar
   * drift comparando contra a média móvel 7d.
   */
  latestDailyMetric(model: AdaptiveKey): DailyMetricRow | null {
    const row = this.store.db
      .prepare(
        `SELECT date, model, brier, win_rate, n_trades
         FROM model_daily_metrics
         WHERE model = ?
         ORDER BY date DESC LIMIT 1`,
      )
      .get(model) as DailyMetricRow | undefined;
    return row ?? null;
  }

  /** Média de ECE/Brier/win_rate dos últimos N dias para uma chave. */
  dailyMetricAvg(opts: { model: AdaptiveKey; days: number }): {
    avgBrier: number;
    avgWinRate: number;
    n: number;
  } | null {
    // ISO date YYYY-MM-DD, comparamos lexicograficamente (UTC).
    const cutoff = new Date(Date.now() - opts.days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const row = this.store.db
      .prepare(
        `SELECT AVG(brier) AS brier, AVG(win_rate) AS win_rate, SUM(n_trades) AS total
         FROM model_daily_metrics
         WHERE model = ? AND date >= ?`,
      )
      .get(opts.model, cutoff) as
      | { brier: number | null; win_rate: number | null; total: number | null }
      | undefined;
    if (!row || row.total === null || row.total === 0) return null;
    return {
      avgBrier: Number(row.brier ?? 0),
      avgWinRate: Number(row.win_rate ?? 0),
      n: Number(row.total),
    };
  }

  /** Lista métrica diária (helper para inspeção em testes). */
  listDailyMetrics(opts: { model?: AdaptiveKey; sinceDate?: string } = {}): DailyMetricRow[] {
    const params: (string)[] = [];
    const where: string[] = [];
    if (opts.model) { where.push("model = ?"); params.push(opts.model); }
    if (opts.sinceDate) { where.push("date >= ?"); params.push(opts.sinceDate); }
    const sql = `SELECT date, model, brier, win_rate, n_trades
                 FROM model_daily_metrics
                 ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY date DESC`;
    return this.store.db.prepare(sql).all(...params) as unknown as DailyMetricRow[];
  }

  /** Lista histórico de retreinos (helper p/ auditoria/testes). */
  listRetrainHistory(): RetrainRow[] {
    return this.store.db
      .prepare(
        `SELECT id, trained_at, trigger, weights_json, holdout_brier, deployed
         FROM retrain_history ORDER BY trained_at DESC`,
      )
      .all() as unknown as RetrainRow[];
  }
}

function parseDetails(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, any>)
      : {};
  } catch {
    return {};
  }
}
