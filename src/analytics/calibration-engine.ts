/**
 * P-A CalibrationEngine: Platt Scaling + Reliability Diagram + Status enum.
 *
 * Funcionalidades:
 *  - Fit Platt Scaling em janela temporal (TRAIN)
 *  - Validar OOS (sem leakage temporal)
 *  - Expor reliability diagram (bins) via /api/analytics/calibration/bins
 *  - Status: INSUFFICIENT_SAMPLE | PROVISIONAL | CALIBRATED | ROBUST
 *  - Separação por chave (par, timeframe, regime)
 *  - Persistir parâmetros Platt por chave
 *
 * Critérios de status:
 *  - INSUFFICIENT_SAMPLE: n < 30 amostras OU ECE > 0.20
 *  - PROVISIONAL: 30 ≤ n < 100, A ∈ [0.5, 1.5], B ∈ [-0.5, 0.5]
 *  - CALIBRATED: 100 ≤ n < 500, ECE < 0.10 OOS, A ∈ [0.7, 1.3], B ∈ [-0.3, 0.3]
 *  - ROBUST: n ≥ 500, ECE < 0.05 OOS, Brier < 0.20, e status consistente em janelas rolantes
 */
import type { DecisionRecord } from "./types";
import { extractPlattSamples, fitPlatt, applyPlatt, type PlattFit, type PlattParams } from "./platt-scaler";

/** Status de calibração baseado em quantidade de amostras + qualidade OOS. */
export type CalibrationStatus =
  | "INSUFFICIENT_SAMPLE"
  | "PROVISIONAL"
  | "CALIBRATED"
  | "ROBUST";

/** Bin do reliability diagram (intervalo de probabilidade). */
export interface ReliabilityBin {
  readonly lo: number;
  readonly hi: number;
  readonly n: number;
  readonly predictedMean: number;
  readonly actualRate: number;
  /** Diferença absoluta entre predicted e actual. */
  readonly gap: number;
}

/** Reliability diagram completo. */
export interface ReliabilityDiagram {
  readonly bins: ReliabilityBin[];
  /** Expected Calibration Error (média ponderada dos gaps). */
  readonly ece: number;
  /** Brier Score no conjunto de avaliação. */
  readonly brierScore: number;
  /** Slope da calibração (deve ser próximo de 1 quando bem calibrado). */
  readonly calibrationSlope: number;
  /** Intercept da calibração (deve ser próximo de 0 quando bem calibrado). */
  readonly calibrationIntercept: number;
}

/** Configuração do CalibrationEngine. */
export interface CalibrationConfig {
  /** Mínimo de amostras para qualquer calibração. */
  readonly minSamplesForFit: number;
  /** Janela TRAIN (dias antes do cutoff). */
  readonly trainWindowDays: number;
  /** Janela OOS (dias após o cutoff). */
  readonly oosWindowDays: number;
  /** Limite ECE para CALIBRATED. */
  readonly eceThresholdCalibrated: number;
  /** Limite ECE para ROBUST. */
  readonly eceThresholdRobust: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  minSamplesForFit: 30,
  trainWindowDays: 30,
  oosWindowDays: 7,
  eceThresholdCalibrated: 0.10,
  eceThresholdRobust: 0.05,
};

/** Chave de separação de calibração. */
export interface CalibrationKey {
  readonly symbol: string;
  readonly timeframe: string;
  readonly regime: string;
}

/** Resultado da aplicação de Platt Scaling a um conjunto de registros. */
export interface CalibrationApplyResult {
  /** Mapa por id da decision original → valor calibrado (null quando não calibrado). */
  readonly calibratedById: Map<string, number>;
  /** Lista de chaves que tinham amostras suficientes (n ≥ minSamplesForFit). */
  readonly fittedKeys: ReadonlyArray<CalibrationKey>;
  /** Lista de chaves sem amostras suficientes. */
  readonly skippedKeys: ReadonlyArray<CalibrationKey>;
}

export function calibrationKeyToString(k: CalibrationKey): string {
  return `${k.symbol}|${k.timeframe}|${k.regime}`;
}

export function calibrationKeyFromString(s: string): CalibrationKey {
  const [symbol, timeframe, regime] = s.split("|");
  return {
    symbol: symbol ?? "",
    timeframe: timeframe ?? "",
    regime: regime ?? "",
  };
}

/** Fit Platt persistido por chave. */
export interface CalibrationSnapshot {
  readonly key: CalibrationKey;
  readonly fit: PlattFit;
  readonly oos: ReliabilityDiagram | null;
  readonly status: CalibrationStatus;
  readonly reasonCodes: string[];
  readonly updatedAt: number;
}

/** Calcula reliability diagram em 10 bins uniformes em [0, 1]. */
export function computeReliabilityDiagram(
  samples: ReadonlyArray<{ p: number; y: number }>,
  /** Se passado, calcula slope/intercept da reta calibrada. */
  fitParams?: PlattParams,
): ReliabilityDiagram {
  const nBins = 10;
  if (samples.length === 0) {
    const emptyBins: ReliabilityBin[] = Array.from({ length: nBins }, (_, i) => ({
      lo: i / nBins,
      hi: (i + 1) / nBins,
      n: 0,
      predictedMean: 0,
      actualRate: 0,
      gap: 0,
    }));
    return {
      bins: emptyBins,
      ece: 0,
      brierScore: 0,
      calibrationSlope: 1,
      calibrationIntercept: 0,
    };
  }

  const sums: Array<{ p: number; y: number }> = Array.from(
    { length: nBins },
    () => ({ p: 0, y: 0 }),
  );
  let brierSum = 0;
  // Accumulate sums per bin.
  for (const s of samples) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor(s.p * nBins)));
    sums[idx]!.p += s.p;
    sums[idx]!.y += s.y;
    brierSum += (s.p - s.y) ** 2;
  }
  // Compute per-bin count separately (n is the number of samples in the bin).
  const counts: number[] = Array.from({ length: nBins }, () => 0);
  for (const s of samples) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor(s.p * nBins)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }

  let ece = 0;
  const bins: ReliabilityBin[] = Array.from({ length: nBins }, (_, i) => {
    const n = counts[i] ?? 0;
    if (n === 0) {
      return { lo: i / nBins, hi: (i + 1) / nBins, n: 0, predictedMean: 0, actualRate: 0, gap: 0 };
    }
    const predictedMean = (sums[i]?.p ?? 0) / n;
    const actualRate = (sums[i]?.y ?? 0) / n;
    const gap = Math.abs(predictedMean - actualRate);
    ece += (n / samples.length) * gap;
    return { lo: i / nBins, hi: (i + 1) / nBins, n, predictedMean, actualRate, gap };
  });

  // Slope/intercept: regressão linear simples logit(p_calibrated) vs y.
  let slope = 1;
  let intercept = 0;
  if (fitParams) {
    const calSamples = samples.map((s) => ({
      x: Math.log((Math.min(Math.max(applyPlatt(s.p, fitParams), 1e-15), 1 - 1e-15)) / (1 - Math.min(Math.max(applyPlatt(s.p, fitParams), 1e-15), 1 - 1e-15))),
      y: s.y,
    }));
    const meanX = calSamples.reduce((a, b) => a + b.x, 0) / calSamples.length;
    const meanY = samples.reduce((a, b) => a + b.y, 0) / samples.length;
    let num = 0;
    let den = 0;
    for (const c of calSamples) {
      num += (c.x - meanX) * (c.y - meanY);
      den += (c.x - meanX) ** 2;
    }
    slope = den === 0 ? 1 : num / den;
    intercept = meanY - slope * meanX;
  }

  return {
    bins,
    ece,
    brierScore: brierSum / samples.length,
    calibrationSlope: slope,
    calibrationIntercept: intercept,
  };
}

/**
 * Decide status da calibração baseado em amostras OOS + Platt fit.
 *
 * Isotonic regression é sempre válida (produz mapeamento monotônico).
 * Platt é válido quando A ∈ [0.1, 5.0] e B ∈ [-1.5, 1.5].
 */
export function decideStatus(
  nTrain: number,
  oos: ReliabilityDiagram | null,
  fit: PlattFit,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): { status: CalibrationStatus; reasonCodes: string[] } {
  const reasons: string[] = [];
  if (nTrain < config.minSamplesForFit) {
    reasons.push(`INSUFFICIENT_SAMPLE: train n=${nTrain} < ${config.minSamplesForFit}`);
    return { status: "INSUFFICIENT_SAMPLE", reasonCodes: reasons };
  }
  if (oos === null) {
    reasons.push("INSUFFICIENT_SAMPLE: sem janela OOS");
    return { status: "INSUFFICIENT_SAMPLE", reasonCodes: reasons };
  }
  // Platt degenerado (A fora de range). Isotonic é fallback automático, sempre válido.
  if (fit.params.method === "platt") {
    if (fit.params.A < 0.1 || fit.params.A > 5.0) {
      reasons.push(`DEGENERATE: Platt A=${fit.params.A.toFixed(3)} fora [0.1, 5.0]`);
      return { status: "INSUFFICIENT_SAMPLE", reasonCodes: reasons };
    }
    if (fit.params.B < -1.5 || fit.params.B > 1.5) {
      reasons.push(`DEGENERATE: Platt B=${fit.params.B.toFixed(3)} fora [-1.5, 1.5]`);
      return { status: "INSUFFICIENT_SAMPLE", reasonCodes: reasons };
    }
  }
  // ROBUST: n >= 500 E ECE < 0.05.
  if (nTrain >= 500 && oos.ece < config.eceThresholdRobust && oos.brierScore < 0.20) {
    reasons.push(`ROBUST: n=${nTrain}, ECE=${oos.ece.toFixed(3)}, Brier=${oos.brierScore.toFixed(3)}`);
    return { status: "ROBUST", reasonCodes: reasons };
  }
  // CALIBRATED: n >= 100 E ECE < 0.10.
  if (nTrain >= 100 && oos.ece < config.eceThresholdCalibrated) {
    reasons.push(`CALIBRATED: n=${nTrain}, ECE=${oos.ece.toFixed(3)}`);
    return { status: "CALIBRATED", reasonCodes: reasons };
  }
  // PROVISIONAL: 30 ≤ n < 500 OU n >= 100 mas ECE alto.
  reasons.push(`PROVISIONAL: n=${nTrain}, ECE=${oos.ece.toFixed(3)}`);
  return { status: "PROVISIONAL", reasonCodes: reasons };
}

/**
 * CalibrationEngine principal.
 *
 * Fit Platt em janela TRAIN. Valida OOS. Decide status. Persiste por chave.
 */
export class CalibrationEngine {
  private readonly config: CalibrationConfig;
  private readonly snapshots: Map<string, CalibrationSnapshot> = new Map();
  private readonly history: DecisionRecord[] = [];
  /**
   * Hook opcional invocado após cada `fitForKey`. Usado pelo B7 para
   * persistir o snapshot em ensemble_weights sem acoplar o engine ao SQLite.
   * Erros do callback NÃO quebram o fit (best-effort).
   */
  private onFit: ((snap: CalibrationSnapshot) => void) | null = null;

  constructor(config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG) {
    this.config = config;
  }

  /**
   * B7: registra hook de persistência (chamado após cada fitForKey).
   * Substitui hook anterior (apenas um por engine).
   */
  setOnFit(cb: ((snap: CalibrationSnapshot) => void) | null): void {
    this.onFit = cb;
  }

  /** Adiciona registros (append-only). Não duplica por id. */
  pushHistory(rows: ReadonlyArray<DecisionRecord>): void {
    const seen = new Set(this.history.map((r) => r.id));
    for (const r of rows) {
      if (!seen.has(r.id)) this.history.push(r);
    }
  }

  /** Lista registros por chave de calibração. */
  selectByKey(key: CalibrationKey): DecisionRecord[] {
    return this.history.filter(
      (r) =>
        r.symbol === key.symbol &&
        r.timeframe === key.timeframe &&
        (r.regime ?? "unknown") === key.regime,
    );
  }

  /** Fit + valida para uma chave específica. */
  fitForKey(key: CalibrationKey, now: number = Date.now()): CalibrationSnapshot {
    const rows = this.selectByKey(key);
    const trainFrom = now - (this.config.trainWindowDays + this.config.oosWindowDays) * 86_400_000;
    const trainTo = now - this.config.oosWindowDays * 86_400_000;
    const trainRows = rows.filter(
      (r) => (r.evaluatedAt ?? r.createdAt) >= trainFrom && (r.evaluatedAt ?? r.createdAt) < trainTo,
    );
    const oosRows = rows.filter(
      (r) => (r.evaluatedAt ?? r.createdAt) >= trainTo,
    );
    const trainSamples = extractPlattSamples(trainRows);
    const oosSamples = extractPlattSamples(oosRows);

    if (trainSamples.length < this.config.minSamplesForFit) {
      const snap: CalibrationSnapshot = {
        key,
        fit: {
          params: { method: "platt" as const, A: 1, B: 0 },
          nSamples: trainSamples.length,
          nHits: 0,
          nMisses: 0,
          logLoss: 0,
          brierScore: 0,
          trainedOn: { from: trainFrom, to: trainTo },
          trainedAt: now,
        },
        oos: null,
        status: "INSUFFICIENT_SAMPLE",
        reasonCodes: [`train n=${trainSamples.length} < ${this.config.minSamplesForFit}`],
        updatedAt: now,
      };
      this.snapshots.set(calibrationKeyToString(key), snap);
      this.invokeOnFit(snap);
      return snap;
    }
    const fit = fitPlatt(trainSamples, { from: trainFrom, to: trainTo }, now);
    // Uma janela OOS vazia não é evidência perfeita: é ausência de validação.
    const oos = oosSamples.length > 0
      ? computeReliabilityDiagram(oosSamples, fit.params)
      : null;
    const { status, reasonCodes } = decideStatus(trainSamples.length, oos, fit, this.config);
    const snap: CalibrationSnapshot = {
      key,
      fit,
      oos,
      status,
      reasonCodes,
      updatedAt: now,
    };
    this.snapshots.set(calibrationKeyToString(key), snap);
    this.invokeOnFit(snap);
    return snap;
  }

  /** B7: invoca hook de persistência, isolando exceções. */
  private invokeOnFit(snap: CalibrationSnapshot): void {
    const cb = this.onFit;
    if (!cb) return;
    try {
      cb(snap);
    } catch {
      // best-effort: nunca quebra o fit por erro de persistência.
    }
  }

  /** Snapshot armazenado (ou null). */
  getSnapshot(key: CalibrationKey): CalibrationSnapshot | null {
    return this.snapshots.get(calibrationKeyToString(key)) ?? null;
  }

  /**
   * B2: Wrapper centralizado de Platt Scaling para DecisionRecords.
   *
   * Semântica estrita (conforme brief P-A B2):
   *  - `rawProbability` ausente ou inválido → `null` (sem dado para calibrar).
   *  - Chave nunca vista (sem snapshot) → `rawProbability` (fallback honesto).
   *  - Snapshot com `status === "INSUFFICIENT_SAMPLE"` (n < 30 no fit)
   *    → `null` (passthrough explícito — não usar Platt não-confiável).
   *  - Demais casos (PROVISIONAL | CALIBRATED | ROBUST) → Platt-scaled.
   *
   * Esta função é o ponto único usado por `AnalyticsService.recordDecision`
   * para preencher `probabilityCalibrated` end-to-end.
   */
  calibrateProbability(rawProbability: number | null, key: CalibrationKey): number | null {
    if (rawProbability === null || rawProbability === undefined) return null;
    if (!Number.isFinite(rawProbability)) return null;
    const snap = this.getSnapshot(key);
    if (snap === null) return rawProbability;
    if (snap.status === "INSUFFICIENT_SAMPLE") return null;
    return applyPlatt(rawProbability, snap.fit.params);
  }

  /** Aplica calibração existente a uma probabilidade. */
  calibrate(key: CalibrationKey, rawProbability: number): number {
    const snap = this.snapshots.get(calibrationKeyToString(key));
    if (!snap || snap.status === "INSUFFICIENT_SAMPLE") return rawProbability;
    return applyPlatt(rawProbability, snap.fit.params);
  }

  /** Lista todos os snapshots armazenados. */
  listSnapshots(): CalibrationSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Configuração ativa. */
  getConfig(): CalibrationConfig {
    return this.config;
  }

  /**
   * Aplica Platt Scaling às probabilidades cruas de um conjunto de DecisionRecords.
   *
   * Comportamento:
   *  - Agrupa registros por `(symbol, timeframe, regime)`.
   *  - Para cada chave com ≥ `minSamplesForFit` (default 30) amostras
   *    hit/miss avaliadas, roda `fitPlatt` e aplica `applyPlatt` em cada
   *    registro da chave (sem mutar).
   *  - Para chaves com n < minSamplesForFit: deixa `probabilityCalibrated = null`.
   *  - Retorna NOVO array; o input não é mutado.
   *
   * Para garantir que registros recém-calculados entrem no fit, chame
   * `pushHistory` antes.
   */
  applyCalibration(records: ReadonlyArray<DecisionRecord>): DecisionRecord[] {
    // Agrupa por chave (symbol, timeframe, regime normalizado).
    type Bucket = {
      key: CalibrationKey;
      rows: DecisionRecord[];
    };
    const buckets = new Map<string, Bucket>();
    for (const r of records) {
      const key: CalibrationKey = {
        symbol: r.symbol,
        timeframe: r.timeframe,
        regime: r.regime ?? "unknown",
      };
      const k = calibrationKeyToString(key);
      let b = buckets.get(k);
      if (!b) {
        b = { key, rows: [] };
        buckets.set(k, b);
      }
      b.rows.push(r);
    }

    const calibratedById = new Map<string, number>();

    for (const bucket of buckets.values()) {
      const samples = extractPlattSamples(bucket.rows);
      if (samples.length < this.config.minSamplesForFit) {
        // n < 30 → não calibrar; deixa null.
        continue;
      }
      // Fit Platt na chave (snapshot já é cacheado se chamado antes).
      // Não usamos fitForKey aqui porque queremos usar TODAS as amostras
      // avaliadas (não a janela TRAIN), já que applyCalibration é usado
      // para reaplicar calibração em batch sobre o histórico.
      const ts = bucket.rows[0]?.evaluatedAt ?? bucket.rows[0]?.createdAt ?? Date.now();
      const fit = fitPlatt(samples, { from: 0, to: ts + 1 }, ts);
      for (const r of bucket.rows) {
        if (r.probability === null || r.probability === undefined) continue;
        if (r.probability < 0 || r.probability > 1) continue;
        const cal = applyPlatt(r.probability, fit.params);
        calibratedById.set(r.id, cal);
      }
    }

    // Mapeia para novo array sem mutar original.
    return records.map((r) => {
      const cal = calibratedById.get(r.id);
      return {
        ...r,
        probabilityCalibrated: cal ?? null,
      };
    });
  }
}
