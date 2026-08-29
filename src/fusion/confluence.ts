/**
 * CAMADA 1 — Confluência multi-timeframe (TRACECON).
 *
 * Função pura, sem I/O. Recebe snapshots de candles de 1 a 3 timeframes
 * (15m, 1h, 4h) e uma direção desejada, e retorna:
 *   - direction final ('up' | 'down' | 'neutral')
 *   - agreementScore (0..1) = soma(pesos alinhados) / soma(pesos totais)
 *   - confidenceBoost (0..0.3) = agreementScore * 0.3
 *   - detalhe por TF (alinhado, peso, technicalScore, RSI)
 *   - reason textual explicando o resultado
 *
 * Pesos por TF:
 *   1h = 1.0  (operação)
 *   4h = 0.9  (contexto)
 *   15m = 0.7 (ruído)
 *
 * Um TF é considerado "alinhado" quando, simultaneamente:
 *   - possui candles suficientes (>= 30)
 *   - RSI está em faixa "não extrema" (30..70)
 *   - technical_score implícito tem o mesmo sinal da direção solicitada
 *     (technical_score = sign(close - sma20) — simples, suficiente p/ gating)
 *
 * Decisão final:
 *   - 'neutral' se agreementScore <= 0.5 (regra: estritamente maior)
 *   - 'neutral' se menos de 2 TFs estão alinhados
 *   - caso contrário, devolve a direção solicitada
 */

export type Timeframe = '15m' | '1h' | '4h';

export interface TFCandle {
  readonly close: number;
  readonly high: number;
  readonly low: number;
}

export interface TFSnapshot {
  readonly tf: Timeframe;
  readonly candles: readonly TFCandle[];
}

export interface ConfluenceInput {
  /** 1 a 3 timeframes. */
  readonly perTf: readonly TFSnapshot[];
  readonly direction: 'up' | 'down';
}

export interface ConfluencePerTf {
  readonly tf: string;
  readonly aligned: boolean;
  readonly weight: number;
  readonly technicalScore: number;
  readonly rsi: number | null;
}

export interface ConfluenceResult {
  readonly direction: 'up' | 'down' | 'neutral';
  readonly agreementScore: number; // 0..1
  readonly confidenceBoost: number; // 0..0.3
  readonly perTf: ReadonlyArray<ConfluencePerTf>;
  readonly reason: string;
}

const TF_WEIGHTS: Readonly<Record<Timeframe, number>> = {
  '1h': 1.0,
  '4h': 0.9,
  '15m': 0.7,
};

const MIN_CANDLES = 30;
const RSI_PERIOD = 14;
const NEUTRAL_BOOST = 0.3;
const NEUTRAL_THRESHOLD = 0.5; // estritamente maior → neutral

/**
 * Média móvel simples dos últimos `period` closes.
 * Retorna null se não houver dados suficientes.
 */
function sma(values: readonly number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i]!;
  }
  return sum / period;
}

/**
 * RSI (Wilder smoothing) sobre uma janela.
 *
 * Implementação canônica:
 *   1. Calcula deltas entre closes consecutivos.
 *   2. Primeira média de gain/loss = média aritmética simples dos
 *      primeiros `period` deltas.
 *   3. A partir daí, aplica Wilder: avg = (prev * (period-1) + current) / period.
 *
 * Retorna null se candles < period + 1 (precisa de N+1 preços para N deltas).
 */
export function rsiWilder(closes: readonly number[], period: number = RSI_PERIOD): number | null {
  if (closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  // Primeira janela: médias simples dos primeiros `period` deltas (del[1..period]).
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  // Wilder smoothing para os deltas restantes.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) {
    // Sem perdas: RSI = 100 quando há algum gain, senão indefinido.
    return avgGain === 0 ? 50 : 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Technical score simples baseado em SMA20 vs close.
 *   score = clamp((close - sma20) / sma20, -1, 1)
 *
 * Retorna 0 se SMA não puder ser calculada (dados insuficientes).
 */
export function technicalScoreSimple(closes: readonly number[]): number {
  const sma20 = sma(closes, 20);
  const last = closes[closes.length - 1];
  if (sma20 === null || sma20 === 0 || last === undefined) return 0;
  const ratio = (last - sma20) / sma20;
  if (ratio > 1) return 1;
  if (ratio < -1) return -1;
  return ratio;
}

interface PerTfEval {
  readonly tf: string;
  readonly aligned: boolean;
  readonly weight: number;
  readonly technicalScore: number;
  readonly rsi: number | null;
  readonly reason: string;
}

function evaluateSnapshot(snap: TFSnapshot): PerTfEval {
  const closes = snap.candles.map((c) => c.close);
  const rsi = rsiWilder(closes, RSI_PERIOD);
  const score = technicalScoreSimple(closes);
  const weight = TF_WEIGHTS[snap.tf] ?? 0;

  const hasEnoughCandles = snap.candles.length >= MIN_CANDLES;
  // "Não extremo": banda central 30..70 (exclui sobrecompra/sobrevenda).
  const rsiOk = rsi !== null && rsi >= 30 && rsi <= 70;
  // Direção implícita via technical_score tem o mesmo sinal da direção solicitada.
  // (O caller passa a direção; aqui ainda não sabemos. Avaliamos o sinal puro
  //  e devolvemos `aligned` para o orquestrador decidir pelo sinal + direção.)
  const signOk = score > 0 || score < 0; // qualquer valor ≠ 0 conta; o sinal é checado fora

  // Sem candles suficientes → TF nem entra no cálculo (peso = 0, alinhado = false).
  if (!hasEnoughCandles) {
    return {
      tf: snap.tf,
      aligned: false,
      weight: 0,
      technicalScore: score,
      rsi,
      reason: `dados insuficientes (${snap.candles.length} candles, mínimo ${MIN_CANDLES})`,
    };
  }

  return {
    tf: snap.tf,
    aligned: rsiOk && signOk,
    weight,
    technicalScore: score,
    rsi,
    reason: rsiOk && signOk ? 'RSI neutro e technical_score direcional' : 'RSI fora de 30..70 ou technical_score neutro',
  };
}

export function analyzeConfluence(input: ConfluenceInput): ConfluenceResult {
  if (input.perTf.length === 0) {
    return {
      direction: 'neutral',
      agreementScore: 0,
      confidenceBoost: 0,
      perTf: [],
      reason: 'nenhum timeframe fornecido',
    };
  }

  const rawEvals = input.perTf.map(evaluateSnapshot);

  // Reclassifica "alinhado" exigindo que o sinal do technical_score bata com
  // a direção solicitada (up → score > 0; down → score < 0).
  // TFs sem candles suficientes continuam com weight=0 e aligned=false.
  const expectedSign = input.direction === 'up' ? 1 : -1;
  const evals = rawEvals.map((e) => {
    if (e.weight === 0) return e; // mantém peso 0 / aligned false
    const signMatch = expectedSign > 0 ? e.technicalScore > 0 : e.technicalScore < 0;
    return {
      ...e,
      aligned: signMatch && (e.rsi !== null && e.rsi >= 30 && e.rsi <= 70),
      reason:
        signMatch && e.rsi !== null && e.rsi >= 30 && e.rsi <= 70
          ? 'alinhado com a direção solicitada'
          : 'sinal do technical_score ou RSI fora da faixa',
    };
  });

  // Soma total de pesos só dos TFs com candles suficientes.
  const totalWeight = evals.reduce((acc, e) => acc + e.weight, 0);
  const alignedCount = evals.filter((e) => e.aligned).length;
  const alignedWeight = evals.filter((e) => e.aligned).reduce((acc, e) => acc + e.weight, 0);
  const agreement = totalWeight > 0 ? alignedWeight / totalWeight : 0;

  // Decisão final.
  let finalDir: 'up' | 'down' | 'neutral';
  let finalReason: string;

  if (totalWeight === 0) {
    finalDir = 'neutral';
    finalReason = 'todos os TFs sem candles suficientes';
  } else if (alignedCount < 2) {
    finalDir = 'neutral';
    finalReason = `apenas ${alignedCount} TF(s) alinhado(s) — mínimo 2`;
  } else if (agreement <= NEUTRAL_THRESHOLD) {
    finalDir = 'neutral';
    finalReason = `agreement ${agreement.toFixed(3)} <= ${NEUTRAL_THRESHOLD}`;
  } else {
    finalDir = input.direction;
    finalReason = `confluência ${input.direction} confirmada: ${alignedCount}/${evals.length} TFs alinhados, agreement=${agreement.toFixed(3)}`;
  }

  return {
    direction: finalDir,
    agreementScore: agreement,
    confidenceBoost: agreement * NEUTRAL_BOOST,
    perTf: evals.map((e) => ({
      tf: e.tf,
      aligned: e.aligned,
      weight: e.weight,
      technicalScore: e.technicalScore,
      rsi: e.rsi,
    })),
    reason: finalReason,
  };
}
