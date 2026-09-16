/** FROZEN strategy registry — V1/V2/V3/V8, hashes auditados 2026-09-16.
 *
 * ENTRY_LOGIC_HASH e igual em todos os horizontes de uma familia: o horizonte apenas
 * define o candle de settlement (T+H). Ver specs:
 *  - V1 reversion-v1-fib      hash 70a7bfcb568bec8c  horizontes [300]
 *  - V2 rsi_vol .22/.0012+fib hash 6f8b9001c63b7597  horizontes [60, 120]
 *  - V3 reversion-v3-fib      hash acf733a866146537  horizontes [45, 60, 120, 180, 300]
 *  - V8 gateFib(struct_f)     hash 712373de3372e158  horizontes [45, 60]
 * V7 preservada internamente (nao operacional).
 */
import { computeFrozenFeatures, fibOk, type FrozenCandle, type FrozenDirection, type FrozenFeatures } from "./features.js";

export type FrozenFamily = "V1" | "V2" | "V3" | "V8";

export interface FrozenVariant {
  family: FrozenFamily;
  /** identificador estavel no formato family-horizon (ex.: "V3-60"). */
  variantId: string;
  horizonSeconds: 45 | 60 | 120 | 180 | 300;
  entryLogicHash: string;
}

export interface FrozenStrategyDefinition {
  family: FrozenFamily;
  entryLogicHash: string;
  horizons: readonly (45 | 60 | 120 | 180 | 300)[];
  label: string;
}

export const FROZEN_STRATEGIES: readonly FrozenStrategyDefinition[] = [
  { family: "V1", entryLogicHash: "70a7bfcb568bec8c", horizons: [300], label: "V1 + Fibonacci" },
  { family: "V2", entryLogicHash: "6f8b9001c63b7597", horizons: [60, 120], label: "V2 + Fibonacci" },
  { family: "V3", entryLogicHash: "acf733a866146537", horizons: [45, 60, 120, 180, 300], label: "V3 + Fibonacci" },
  { family: "V8", entryLogicHash: "712373de3372e158", horizons: [45, 60], label: "V8 Structure + Fibonacci" },
] as const;

export const FROZEN_VARIANTS: readonly FrozenVariant[] = FROZEN_STRATEGIES.flatMap((strategy) =>
  strategy.horizons.map((horizonSeconds) => ({
    family: strategy.family,
    variantId: `${strategy.family}-${horizonSeconds}`,
    horizonSeconds,
    entryLogicHash: strategy.entryLogicHash,
  })),
);

export function getFrozenStrategy(family: FrozenFamily): FrozenStrategyDefinition {
  const found = FROZEN_STRATEGIES.find((strategy) => strategy.family === family);
  if (found === undefined) throw new Error(`unknown frozen family ${family}`);
  return found;
}

export function isValidVariant(family: FrozenFamily, horizonSeconds: number): boolean {
  return getFrozenStrategy(family).horizons.includes(horizonSeconds as 45 | 60 | 120 | 180 | 300);
}

/** Avaliacao determinista do sinal para uma familia (entry logic congelada, sem horizonte). */
export function evaluateFrozenSignal(family: FrozenFamily, features: FrozenFeatures): FrozenDirection | null {
  switch (family) {
    case "V1": {
      if (!(features.vol12 < 0.0009)) return null;
      const direction: FrozenDirection | null = features.s > 0.33 ? "BUY" : features.s < -0.33 ? "SELL" : null;
      if (direction === null) return null;
      return fibOk(features, direction) ? direction : null;
    }
    case "V2": {
      if (!(features.vol12 < 0.0012)) return null;
      const direction: FrozenDirection | null = features.s > 0.22 ? "BUY" : features.s < -0.22 ? "SELL" : null;
      if (direction === null) return null;
      return fibOk(features, direction) ? direction : null;
    }
    case "V3": {
      if (!(features.vol12 < 0.0012)) return null;
      const direction: FrozenDirection | null =
        features.s > 0.22 && features.r24 > 0 ? "BUY" : features.s < -0.22 && features.r24 < 0 ? "SELL" : null;
      if (direction === null) return null;
      return fibOk(features, direction) ? direction : null;
    }
    case "V8": {
      const direction: FrozenDirection | null = features.structureUp ? "BUY" : features.structureDown ? "SELL" : null;
      if (direction === null) return null;
      return fibOk(features, direction) ? direction : null;
    }
    default:
      return null;
  }
}

export function evaluateCandlesAt(family: FrozenFamily, candles: readonly FrozenCandle[], index: number): FrozenDirection | null {
  const features = computeFrozenFeatures(candles, index);
  if (features === null) return null;
  return evaluateFrozenSignal(family, features);
}

/** Settlement exato por candle: T+H contado do bucket do candle do sinal; close do candle em bucket+H*1000. */
export type FrozenOutcome = "WIN" | "LOSS" | "DRAW" | "UNKNOWN";

export function settleFrozenAt(
  candles: readonly FrozenCandle[],
  signalBucket: number,
  horizonSeconds: number,
  direction: FrozenDirection,
  entryPrice: number,
): { outcome: FrozenOutcome; settlementPrice: number | null; settlementBucket: number } {
  const settlementBucket = signalBucket + horizonSeconds * 1000;
  const candle = candles.find((candidate) => candidate.bucket === settlementBucket);
  if (candle === undefined) return { outcome: "UNKNOWN", settlementPrice: null, settlementBucket };
  if (candle.close === entryPrice) return { outcome: "DRAW", settlementPrice: candle.close, settlementBucket };
  const rose = candle.close > entryPrice;
  return { outcome: (direction === "BUY") === rose ? "WIN" : "LOSS", settlementPrice: candle.close, settlementBucket };
}
