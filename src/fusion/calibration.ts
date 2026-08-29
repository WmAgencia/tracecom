/**
 * CAMADA 2 — Calibração estatística (Wilson).
 *
 * Conjunto isolado de funções para:
 *   - Intervalo de confiança Wilson (lower / upper / interval).
 *   - Decisão "actionable": ciLower excede baseline + margem mínima.
 *   - Valor esperado (EV) de uma aposta binária.
 *   - Relatório de calibração: Brier + ECE em 10 bins.
 *
 * Mantido isolado de src/backtest/probability.ts por design — a fusão
 * não depende do mecanismo de backtest; esta camada é puramente
 * matemática e opera em proporções observadas.
 *
 * Fórmulas Wilson: Newcombe (1998). Para z=1.96 (95%), n=100, x=50:
 *   lower ≈ 0.4074, upper ≈ 0.5926 (não 0.40 / 0.60 — essa é a aproximação
 *   ingênua ±1.96/sqrt(n)≈0.10).
 *
 *   Para n=10, x=5:
 *   lower ≈ 0.3097, upper ≈ 0.6903 (muito mais largo, apropriado para n pequeno).
 */

export interface WilsonCI {
  readonly lower: number;
  readonly upper: number;
}

export interface ActionableParams {
  readonly probability: number;
  readonly ciLower: number;
  readonly baseline: number;
  readonly minMargin?: number;
}

export interface EVParams {
  readonly probability: number;
  readonly gain?: number;
  readonly loss?: number;
}

export interface CalibrationPoint {
  readonly probabilityEmitted: number;
  readonly outcome: 0 | 1;
}

export interface CalibrationBin {
  readonly bin: string;
  readonly predictedMean: number;
  readonly observedFreq: number;
  readonly n: number;
}

export interface CalibrationReport {
  readonly n: number;
  readonly brierScore: number;
  readonly ece: number;
  readonly reliability: ReadonlyArray<CalibrationBin>;
}

const DEFAULT_Z = 1.96;
const DEFAULT_MIN_MARGIN = 0.05;
const DEFAULT_GAIN = 1;
const DEFAULT_LOSS = 1;
const ECE_BINS = 10;

/**
 * Wilson score interval — limite INFERIOR.
 *
 * Fórmula padrão (Newcombe, 1998):
 *   centre = p + z² / (2n)
 *   margin = z * sqrt( p(1-p)/n + z²/(4n²) )
 *   denom   = 1 + z²/n
 *   lower  = (centre − margin) / denom
 *
 * Para n≤0, devolve 0 (sem evidência o lower não pode ser estimado).
 */
export function wilsonLowerBound(successes: number, total: number, z: number = DEFAULT_Z): number {
  if (total <= 0) return 0;
  const s = Math.max(0, Math.min(successes, total));
  const n = total;
  const p = s / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lower = (centre - margin) / denom;
  return Math.max(0, Math.min(1, lower));
}

/** Limite superior (simétrico ao inferior). */
export function wilsonUpperBound(successes: number, total: number, z: number = DEFAULT_Z): number {
  if (total <= 0) return 0;
  const s = Math.max(0, Math.min(successes, total));
  const n = total;
  const p = s / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const upper = (centre + margin) / denom;
  return Math.max(0, Math.min(1, upper));
}

/** Atalho: devolve {lower, upper}. */
export function wilsonInterval(successes: number, total: number, z: number = DEFAULT_Z): WilsonCI {
  return {
    lower: wilsonLowerBound(successes, total, z),
    upper: wilsonUpperBound(successes, total, z),
  };
}

/**
 * Um sinal só é "actionable" se o limite inferior do IC Wilson
 * exceder o baseline por uma margem mínima (default 5 pontos percentuais).
 *
 * A probabilidade pontual é IGNORADA — usamos o ciLower, porque é
 * o que reflete significância estatística.
 *
 *   ciLower > baseline + minMargin   → actionable = true
 *
 * Requer `>` estrito (não `>=`) para evitar que 0.50 = 0.50 + 0 seja
 * tratado como ação.
 */
export function isActionable(p: ActionableParams): boolean {
  const margin = p.minMargin ?? DEFAULT_MIN_MARGIN;
  return p.ciLower > p.baseline + margin;
}

/**
 * Valor esperado de uma aposta binária:
 *   EV = p * gain − (1 − p) * loss
 *
 * Defaults: ganho=1, perda=1.
 */
export function expectedValue(p: EVParams): number {
  const gain = p.gain ?? DEFAULT_GAIN;
  const loss = p.loss ?? DEFAULT_LOSS;
  const prob = Math.max(0, Math.min(1, p.probability));
  return prob * gain - (1 - prob) * loss;
}

/**
 * Relatório de calibração sobre uma amostra (prob_emitted, outcome) ∈ [0,1] × {0,1}.
 *
 *   - Brier score: média de (p − y)².
 *   - ECE (Expected Calibration Error): soma sobre 10 bins uniformes [0,1)
 *     de |pred_mean − obs_freq| × (n_bin / n_total).
 *   - reliability: detalhamento por bin (range textual, média predita, freq. observada, n).
 *
 * Edge cases:
 *   - Lista vazia → { n:0, brierScore:0, ece:0, reliability:[] }.
 *   - Bin vazio é omitido de `reliability`.
 *   - Probabilidades fora de [0,1] são clipadas.
 */
export function calibrate(points: readonly CalibrationPoint[]): CalibrationReport {
  const n = points.length;
  if (n === 0) {
    return { n: 0, brierScore: 0, ece: 0, reliability: [] };
  }

  // Brier: acumular primeiro o quadrado do erro.
  let sumSq = 0;
  const binSum: number[] = new Array(ECE_BINS).fill(0);
  const binSuccess: number[] = new Array(ECE_BINS).fill(0);
  const binSize: number[] = new Array(ECE_BINS).fill(0);

  for (const pt of points) {
    const p = Math.max(0, Math.min(1, pt.probabilityEmitted));
    const y = pt.outcome === 1 ? 1 : 0;
    const d = p - y;
    sumSq += d * d;

    // Bins: [0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]. Prob==1 vai para o último.
    let idx = Math.floor(p * ECE_BINS);
    if (idx >= ECE_BINS) idx = ECE_BINS - 1;
    if (idx < 0) idx = 0;
    binSum[idx] = (binSum[idx] ?? 0) + p;
    binSuccess[idx] = (binSuccess[idx] ?? 0) + y;
    binSize[idx] = (binSize[idx] ?? 0) + 1;
  }

  const brierScore = sumSq / n;

  // ECE + reliability (uma passada só).
  let ece = 0;
  const reliability: CalibrationBin[] = [];
  for (let i = 0; i < ECE_BINS; i++) {
    const size = binSize[i] ?? 0;
    if (size === 0) continue;
    const predictedMean = (binSum[i] ?? 0) / size;
    const observedFreq = (binSuccess[i] ?? 0) / size;
    ece += Math.abs(predictedMean - observedFreq) * (size / n);
    const binLow = i / ECE_BINS;
    const binHigh = (i + 1) / ECE_BINS;
    reliability.push({
      bin: `[${binLow.toFixed(1)}, ${binHigh.toFixed(1)})`,
      predictedMean,
      observedFreq,
      n: size,
    });
  }

  return {
    n,
    brierScore,
    ece,
    reliability,
  };
}
