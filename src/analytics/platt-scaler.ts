/**
 * P-A Calibration: Platt Scaling + Isotonic Regression.
 *
 * Platt Scaling transforma a probabilidade crua p_raw em p_calibrated usando
 * regressão logística sobre o logit:
 *
 *   p_calibrated = sigmoid(A * logit(p_raw) + B)
 *
 * Implementação com Newton-Raphson. Se a Hessiana degenerar ou A convergir
 * para <= 0 (modelo inútil), faz fallback automático para Isotonic Regression
 * (algoritmo PAVA — Pair-Adjacent-Violators) que sempre produz um mapeamento
 * monotônico válido.
 *
 * Requisitos:
 *   - n_amostras >= 30 para fit confiável.
 *   - Sem data leakage: treina em janela TRAIN, valida em janela OOS.
 *   - Persiste A,B por (par, timeframe, regime) para permitir retreino.
 */
import type { DecisionRecord } from "./types";

export type PlattMethod = "platt" | "isotonic";

export interface PlattParams {
  /** Método aplicado. */
  readonly method: PlattMethod;
  /** Coeficiente linear no logit (Platt) — apenas se method="platt". */
  readonly A: number;
  /** Coeficiente bias no logit (Platt) — apenas se method="platt". */
  readonly B: number;
  /** Pontos calibrados (prob_raw → prob_cal) — apenas se method="isotonic". */
  readonly iso?: ReadonlyArray<{ x: number; y: number }>;
}

export interface PlattFit {
  readonly params: PlattParams;
  readonly nSamples: number;
  readonly nHits: number;
  readonly nMisses: number;
  readonly logLoss: number;
  readonly brierScore: number;
  readonly trainedOn: { from: number; to: number };
  readonly trainedAt: number;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function logit(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-15), 1 - 1e-15);
  return Math.log(clamped / (1 - clamped));
}

function binaryLogLoss(p: number, y: number): number {
  const clamped = Math.min(Math.max(p, 1e-15), 1 - 1e-15);
  return -(y * Math.log(clamped) + (1 - y) * Math.log(1 - clamped));
}

function binaryBrier(p: number, y: number): number {
  return (p - y) ** 2;
}

/** Isotonic Regression via PAVA (Pool-Adjacent-Violators Algorithm). */
function isotonicRegression(
  samples: ReadonlyArray<{ p: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (samples.length === 0) return [];
  // 1. Sort by x.
  const sorted = [...samples].sort((a, b) => a.p - b.p);
  // 2. Empata observações com a mesma probabilidade antes do PAVA. Sem isso,
  // uma série de `p=0.70` poderia produzir vários blocos no mesmo x e a
  // previsão retornaria arbitrariamente o primeiro (inclusive 0 ou 1).
  const grouped: Array<{ p: number; sumY: number; n: number }> = [];
  for (const s of sorted) {
    const last = grouped[grouped.length - 1];
    if (last && last.p === s.p) {
      last.sumY += s.y;
      last.n += 1;
    } else {
      grouped.push({ p: s.p, sumY: s.y, n: 1 });
    }
  }
  // 3. PAVA: agrupa blocos monotônicos crescentes.
  const blocks: Array<{ x0: number; x1: number; sumY: number; n: number }> = [];
  for (const s of grouped) {
    const newBlock = { x0: s.p, x1: s.p, sumY: s.sumY, n: s.n };
    blocks.push(newBlock);
    // Merge backward enquanto o block anterior tiver y médio > block atual.
    while (blocks.length >= 2) {
      const prev = blocks[blocks.length - 2]!;
      const cur = blocks[blocks.length - 1]!;
      const prevAvg = prev.sumY / prev.n;
      const curAvg = cur.sumY / cur.n;
      if (prevAvg <= curAvg) break;
      // Merge.
      prev.x1 = cur.x1;
      prev.sumY += cur.sumY;
      prev.n += cur.n;
      blocks.pop();
    }
  }
  // 4. Saída: pontos (x_médio do bloco, y_médio do bloco).
  return blocks.map((b) => ({
    x: (b.x0 + b.x1) / 2,
    y: b.sumY / b.n,
  }));
}

/** Interpolação linear monotônica a partir dos pontos isotônicos. */
function isotonicPredict(x: number, pts: ReadonlyArray<{ x: number; y: number }>): number {
  if (pts.length === 0) return x;
  if (x <= pts[0]!.x) return pts[0]!.y;
  if (x >= pts[pts.length - 1]!.x) return pts[pts.length - 1]!.y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      return a.y + t * (b.y - a.y);
    }
  }
  return x; // fallback
}

/** Fit Platt com fallback automático para isotonic se Platt degenerar. */
export function fitPlatt(
  samples: ReadonlyArray<{ p: number; y: number }>,
  trainedOn: { from: number; to: number },
  trainedAt: number = Date.now(),
): PlattFit {
  if (samples.length === 0) {
    throw new Error("fitPlatt: samples vazio");
  }

  let nHits = 0;
  for (const s of samples) if (s.y === 1) nHits++;
  const prior = nHits / samples.length;

  // TENTATIVA 1: Platt Newton-Raphson.
  let A = 0;
  let B = Math.log((prior + 1e-15) / (1 - prior + 1e-15));
  const maxIter = 100;
  const tol = 1e-4;
  for (let iter = 0; iter < maxIter; iter++) {
    let gA = 0;
    let gB = 0;
    let hAA = 0;
    let hAB = 0;
    let hBB = 0;
    for (const s of samples) {
      const x = logit(s.p);
      const y = s.y;
      const fx = A * x + B;
      const p_hat = sigmoid(fx);
      const w = p_hat * (1 - p_hat);
      const z = y - p_hat;
      gA += w * x * z;
      gB += w * z;
      hAA += w * x * x;
      hAB += w * x;
      hBB += w;
    }
    const det = hAA * hBB - hAB * hAB;
    if (Math.abs(det) < 1e-12) break;
    const dA = (hBB * gA - hAB * gB) / det;
    const dB = (hAA * gB - hAB * gA) / det;
    A += dA;
    B += dB;
    if (Math.abs(dA) < tol && Math.abs(dB) < tol) break;
  }

  // Platt fit confiável apenas se A >= 0.1 e B dentro de range razoável.
  const plattOk = A >= 0.1 && A <= 5.0 && B >= -1.5 && B <= 1.5;

  let params: PlattParams;
  if (plattOk) {
    params = { method: "platt", A, B };
  } else {
    // FALLBACK: isotonic regression (sempre produz mapeamento monotônico válido).
    const iso = isotonicRegression(samples);
    params = { method: "isotonic", A: 1, B: 0, iso };
  }

  // Métricas no conjunto de treino.
  let logLoss = 0;
  let brierSum = 0;
  for (const s of samples) {
    const p_hat = applyPlatt(s.p, params);
    logLoss += binaryLogLoss(p_hat, s.y);
    brierSum += binaryBrier(p_hat, s.y);
  }
  return {
    params,
    nSamples: samples.length,
    nHits,
    nMisses: samples.length - nHits,
    logLoss: logLoss / samples.length,
    brierScore: brierSum / samples.length,
    trainedOn,
    trainedAt,
  };
}

export function applyPlatt(rawProbability: number, params: PlattParams): number {
  if (rawProbability === null || rawProbability === undefined || !Number.isFinite(rawProbability)) {
    return rawProbability;
  }
  if (params.method === "isotonic" && params.iso) {
    // Probabilidades exatas 0/1 comunicam certeza; mantemos uma margem numérica
    // para evitar esse falso grau de certeza em decisões de mercado.
    return Math.min(1 - 1e-6, Math.max(1e-6, isotonicPredict(rawProbability, params.iso)));
  }
  const z = params.A * logit(rawProbability) + params.B;
  return sigmoid(z);
}

export function extractPlattSamples(
  rows: ReadonlyArray<DecisionRecord>,
): Array<{ p: number; y: number }> {
  const out: Array<{ p: number; y: number }> = [];
  for (const r of rows) {
    if (r.outcome !== "hit" && r.outcome !== "miss") continue;
    if (r.probability === null || r.probability === undefined) continue;
    if (r.probability < 0 || r.probability > 1) continue;
    out.push({ p: r.probability, y: r.outcome === "hit" ? 1 : 0 });
  }
  return out;
}
