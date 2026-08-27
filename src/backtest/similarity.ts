/**
 * Similarity Engine — caracteriza um "setup" (vetor de features num instante)
 * e busca situações históricas semelhantes.
 *
 * CAUSALIDADE: o vetor de um setup no índice `i` usa APENAS candles `<= i`.
 * Nunca usa o futuro. Isso é garantido pelos indicadores (que são causais) e
 * pela forma de extração (janela terminando em `i`).
 */
import type { MarketCandle } from "../market/model";
import { QuantEngine, DEFAULT_CONFIG } from "../quant/engine";
import type { SimilarityCriteria, SetupVector, SimilarSetup } from "./types";

/** Retorna o último valor não-nulo de uma série de números. */
function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] != null) return series[i] as number;
  return null;
}

/** Features padrão usadas para caracterizar setups. */
export interface FeatureExtractor {
  extract(candles: readonly MarketCandle[], upTo: number): Readonly<Record<string, number>>;
  /** Pré-computa o vetor de todos os prefixos em O(n) (evita O(n²)). */
  extractAll(candles: readonly MarketCandle[]): Readonly<Record<string, number>>[];
  readonly keys: readonly string[];
}

/**
 * Extrator causal baseado no QuantEngine. Para cada índice produz um vetor
 * de características normalizadas e comparáveis.
 *
 * `extractAll` é implementado incrementalmente para ser viável em backtests
 * com dezenas de milhares de candles (respecting causalidade — janela até i).
 */
export class QuantFeatureExtractor implements FeatureExtractor {
  readonly keys: readonly string[];
  private readonly engine: QuantEngine;

  constructor() {
    this.engine = new QuantEngine(DEFAULT_CONFIG);
    this.keys = ["rsi", "pctFromSma", "slope", "atrPct", "volatility", "macdHistNorm"];
  }

  extract(candles: readonly MarketCandle[], upTo: number): Readonly<Record<string, number>> {
    const all = this.extractAll(candles.slice(0, upTo + 1));
    return all[all.length - 1] ?? toZeroFeatures(this.keys);
  }

  extractAll(candles: readonly MarketCandle[]): Readonly<Record<string, number>>[] {
    // Computamos indicadores sobre a série completa (causais por construção) e
    // derivamos o vetor de cada prefixo a partir dos valores acumulados.
    const closes = candles.map((c) => c.close);
    const ind = this.engine.computeIndicators(candles);
    const out: Readonly<Record<string, number>>[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i < 10) { out.push(toZeroFeatures(this.keys)); continue; }
      const close = closes[i]!;
      const rsi = lastNonNull(ind.rsi.slice(0, i + 1)) ?? 50;
      const smaLast = lastNonNull(ind.sma.slice(0, i + 1)) ?? close;
      const atrLast = lastNonNull(ind.atr.slice(0, i + 1));
      const volLast = lastNonNull(ind.volatility.slice(0, i + 1));
      const macdHist = lastNonNull(ind.macd.histogram.slice(0, i + 1)) ?? 0;
      const base = closes[Math.max(0, i - 5)] ?? close;
      const slope = base !== 0 ? (close - base) / base : 0;
      const scale = atrLast !== null && atrLast > 0 ? atrLast / (close || 1) : 0.001;
      out.push({
        rsi,
        pctFromSma: smaLast !== 0 ? (close - smaLast) / Math.abs(smaLast) : 0,
        slope: slope / Math.max(scale, 1e-6),
        atrPct: atrLast !== null && close !== 0 ? atrLast / close : 0,
        volatility: volLast ?? 0,
        macdHistNorm: macdHist / Math.max(atrLast ?? 1, 1),
      });
    }
    return out;
  }
}

function toZeroFeatures(keys: readonly string[]): Readonly<Record<string, number>> {
  const o: Record<string, number> = {};
  for (const k of keys) o[k] = 0;
  return o;
}

/**
 * Distância de similaridade (0..1) entre dois vetores de features, ponderada.
 * 1 = idêntico; decresce com a distância normalizada.
 */
export function similarityBetween(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
  criteria: SimilarityCriteria,
): number {
  const keys = Object.keys(criteria.weights);
  let weighted = 0;
  let totalWeight = 0;
  for (const k of keys) {
    const w = criteria.weights[k] ?? 0;
    const tol = criteria.tolerance[k] ?? 1;
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (w <= 0) continue;
    totalWeight += w;
    const dist = Math.abs(va - vb);
    // similaridade por-feature: 1 até tol, decai linearmente após tol.
    const featSim = dist <= tol ? 1 : Math.max(0, 1 - (dist - tol) / (tol * 4));
    weighted += w * featSim;
  }
  if (totalWeight === 0) return 0;
  return weighted / totalWeight;
}

/** Caracteriza o setup no último candle (ou índice dado). */
export function buildVector(
  candles: readonly MarketCandle[],
  extractor: FeatureExtractor,
  index: number,
): SetupVector {
  return { timestamp: candles[index]!.timestamp, features: extractor.extract(candles, index) };
}

/**
 * Encontra setups semelhantes ao vetor-alvo.
 *
 * Por padrão remove look-ahead (só `i < queryIndex`). Quando `searchEndIndex`
 * é fornecido (>=0) e `includeAfterQuery` é true, busca em toda a janela
 * `[0, searchEndIndex]` — usado pelo backtest de estratégia (walk-forward),
 * onde o padrão é conhecido e cada trade usa apenas o próprio passado.
 */
export function findSimilar(
  query: SetupVector,
  candles: readonly MarketCandle[],
  extractor: FeatureExtractor,
  criteria: SimilarityCriteria,
  opts: { includeAfterQuery?: boolean; searchEndIndex?: number } = {},
): { matches: SimilarSetup[]; totalCandidates: number } {
  const queryIndex = candles.findIndex((c) => c.timestamp === query.timestamp);
  const vectors = extractor.extractAll(candles); // O(n) uma vez
  const matches: SimilarSetup[] = [];
  let totalCandidates = 0;
  const searchEnd = opts.searchEndIndex !== undefined
    ? Math.min(opts.searchEndIndex + 1, candles.length)
    : queryIndex >= 0 ? queryIndex : candles.length;
  for (let i = 0; i < searchEnd; i++) {
    const v = vectors[i]!;
    const sim = similarityBetween(query.features, v, criteria);
    if (sim >= criteria.similarityThreshold) {
      totalCandidates++;
      matches.push({ timestamp: candles[i]!.timestamp, similarity: sim, features: v });
    }
  }
  return { matches, totalCandidates };
}
