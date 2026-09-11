import type { MarketCandle } from "../market/model";
import type { MarketStructure } from "./types";

export interface FairValueGap {
  readonly direction: "bullish" | "bearish";
  readonly from: number;
  readonly to: number;
  readonly createdAt: number;
  readonly filled: boolean;
}

export interface OrderBlock {
  readonly direction: "bullish" | "bearish";
  readonly low: number;
  readonly high: number;
  readonly createdAt: number;
  readonly invalidated: boolean;
}

export interface StructureBreak {
  readonly kind: "BOS" | "CHOCH";
  readonly direction: "bullish" | "bearish";
  readonly level: number;
  readonly timestamp: number;
}

export interface SmcResult {
  readonly fairValueGaps: readonly FairValueGap[];
  readonly orderBlocks: readonly OrderBlock[];
  readonly structureBreak: StructureBreak | null;
  readonly displacement: "bullish" | "bearish" | "none";
  readonly dealingRange: { low: number; high: number; equilibrium: number; zone: "premium" | "discount" | "equilibrium" } | null;
  readonly biasScore: number;
}

/**
 * Definições algorítmicas, sem interpretação visual:
 * FVG = gap entre candle i e i-2; displacement = corpo >= 1.8x mediana;
 * OB = último candle oposto imediatamente antes do displacement;
 * BOS/CHoCH = fechamento além do último swing, classificado pelo trend anterior.
 */
export function analyzeSmc(candles: readonly MarketCandle[], structure: MarketStructure): SmcResult {
  if (candles.length < 3) {
    return { fairValueGaps: [], orderBlocks: [], structureBreak: null, displacement: "none", dealingRange: null, biasScore: 0 };
  }
  const bodies = candles.slice(-30).map((c) => Math.abs(c.close - c.open)).sort((a, b) => a - b);
  const medianBody = bodies[Math.floor(bodies.length / 2)] ?? 0;
  const last = candles.at(-1)!;
  const lastBody = Math.abs(last.close - last.open);
  const displacement = medianBody > 0 && lastBody >= medianBody * 1.8
    ? last.close > last.open ? "bullish" : last.close < last.open ? "bearish" : "none"
    : "none";

  const fairValueGaps: FairValueGap[] = [];
  for (let i = 2; i < candles.length; i++) {
    const left = candles[i - 2]!;
    const right = candles[i]!;
    if (right.low > left.high) {
      const subsequent = candles.slice(i + 1);
      fairValueGaps.push({
        direction: "bullish", from: left.high, to: right.low, createdAt: right.timestamp,
        filled: subsequent.some((c) => c.low <= left.high),
      });
    } else if (right.high < left.low) {
      const subsequent = candles.slice(i + 1);
      fairValueGaps.push({
        direction: "bearish", from: right.high, to: left.low, createdAt: right.timestamp,
        filled: subsequent.some((c) => c.high >= left.low),
      });
    }
  }

  const orderBlocks: OrderBlock[] = [];
  for (let i = 1; i < candles.length; i++) {
    const impulse = candles[i]!;
    const previous = candles[i - 1]!;
    const body = Math.abs(impulse.close - impulse.open);
    if (medianBody <= 0 || body < medianBody * 1.8) continue;
    const bullish = impulse.close > impulse.open && previous.close < previous.open;
    const bearish = impulse.close < impulse.open && previous.close > previous.open;
    if (!bullish && !bearish) continue;
    const later = candles.slice(i + 1);
    orderBlocks.push({
      direction: bullish ? "bullish" : "bearish",
      low: previous.low, high: previous.high, createdAt: previous.timestamp,
      invalidated: bullish
        ? later.some((c) => c.close < previous.low)
        : later.some((c) => c.close > previous.high),
    });
  }

  const swingHigh = [...structure.swings].reverse().find((s) => s.kind === "HH" || s.kind === "LH");
  const swingLow = [...structure.swings].reverse().find((s) => s.kind === "HL" || s.kind === "LL");
  let structureBreak: StructureBreak | null = null;
  if (swingHigh && last.close > swingHigh.price) {
    structureBreak = { kind: structure.trend === "down" ? "CHOCH" : "BOS", direction: "bullish", level: swingHigh.price, timestamp: last.timestamp };
  } else if (swingLow && last.close < swingLow.price) {
    structureBreak = { kind: structure.trend === "up" ? "CHOCH" : "BOS", direction: "bearish", level: swingLow.price, timestamp: last.timestamp };
  }

  const window = candles.slice(-100);
  const low = Math.min(...window.map((c) => c.low));
  const high = Math.max(...window.map((c) => c.high));
  const equilibrium = (low + high) / 2;
  const band = (high - low) * 0.02;
  const zone = Math.abs(last.close - equilibrium) <= band ? "equilibrium" : last.close > equilibrium ? "premium" : "discount";
  const dealingRange = { low, high, equilibrium, zone } as const;

  let biasScore = 0;
  if (structureBreak) biasScore += structureBreak.direction === "bullish" ? 0.5 : -0.5;
  if (displacement !== "none") biasScore += displacement === "bullish" ? 0.25 : -0.25;
  const activeGap = [...fairValueGaps].reverse().find((g) => !g.filled);
  if (activeGap) biasScore += activeGap.direction === "bullish" ? 0.15 : -0.15;
  if (zone === "discount") biasScore += 0.1;
  if (zone === "premium") biasScore -= 0.1;

  return {
    fairValueGaps, orderBlocks, structureBreak, displacement, dealingRange,
    biasScore: Math.max(-1, Math.min(1, biasScore)),
  };
}
