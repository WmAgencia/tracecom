/**
 * VWAP, suporte/resistência (pivots) e market structure (swings HH/HL/LH/LL).
 * Determinísticos; consomem candles completos (OHLCV).
 */
import type { MarketCandle } from "../market/model";
import type { Series } from "./types";
import type { PriceLevel, SwingPoint, MarketStructure, SwingKind } from "./types";
import { sma as smaFn } from "./math";
/** VWAP acumulado (preço típico * volume / volume acumulado) a partir do início. */
export function vwap(candles: readonly Pick<MarketCandle, "high" | "low" | "close" | "volume">[]): Series {
  let cumPV = 0;
  let cumV = 0;
  const out: (number | null)[] = [];
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    out.push(cumV === 0 ? null : cumPV / cumV);
  }
  return out;
}

/** Suporte/resistência via pivots (máximo/mínimo local em janela). */
export function levelsFromCandles(
  candles: readonly Pick<MarketCandle, "high" | "low" | "timestamp">[],
  pivotWindow = 5,
): { supports: PriceLevel[]; resistances: PriceLevel[] } {
  const pivotsHigh: number[] = [];
  const pivotsLow: number[] = [];
  for (let i = pivotWindow; i < candles.length - pivotWindow; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= candles[i]!.high) isHigh = false;
      if (candles[j]!.low <= candles[i]!.low) isLow = false;
    }
    if (isHigh) pivotsHigh.push(candles[i]!.high);
    if (isLow) pivotsLow.push(candles[i]!.low);
  }
  const supports = clusterLevels(pivotsLow, "support");
  const resistances = clusterLevels(pivotsHigh, "resistance");
  return { supports, resistances };
}

/** Agrupa preços próximos num nível e retorna força (nº de toques). */
function clusterLevels(prices: number[], kind: "support" | "resistance"): PriceLevel[] {
  const grouped: { price: number; touches: number }[] = [];
  const tolerance = 0.001; // 0.1%
  for (const p of prices) {
    let hit = false;
    for (const g of grouped) {
      if (Math.abs(g.price - p) / g.price < tolerance) {
        g.touches++;
        g.price = (g.price * (g.touches - 1) + p) / g.touches;
        hit = true;
        break;
      }
    }
    if (!hit) grouped.push({ price: p, touches: 1 });
  }
  grouped.sort((a, b) => b.touches - a.touches);
  const maxTouches = Math.max(1, grouped[0]?.touches ?? 1);
  return grouped.slice(0, 5).map((g) => ({ price: g.price, kind, touches: g.touches, strength: g.touches / maxTouches }));
}

/** Detecta swings (fratura de estrutura) e a tendência dominante. */
export function marketStructure(
  candles: readonly Pick<MarketCandle, "high" | "low" | "close" | "timestamp">[],
  pivotWindow = 3,
): MarketStructure {
  const highs: number[] = [];
  const lows: number[] = [];
  const timestamps: number[] = [];
  for (const c of candles) { highs.push(c.high); lows.push(c.low); timestamps.push(c.timestamp); }
  const swingIdx: { index: number; type: "high" | "low" }[] = [];
  for (let i = pivotWindow; i < highs.length - pivotWindow; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      if (highs[j]! >= highs[i]!) isHigh = false;
      if (lows[j]! <= lows[i]!) isLow = false;
    }
    if (isHigh) swingIdx.push({ index: i, type: "high" });
    if (isLow) swingIdx.push({ index: i, type: "low" });
  }
  swingIdx.sort((a, b) => a.index - b.index);

  const swings: SwingPoint[] = [];
  for (const s of swingIdx) {
    let kind: SwingKind;
    if (s.type === "high") {
      const lastHigh = swings.filter((x) => x.kind === "HH" || x.kind === "LH").at(-1);
      kind = lastHigh ? (highs[s.index]! > lastHigh.price ? "HH" : "LH") : "HH";
    } else {
      const lastLow = swings.filter((x) => x.kind === "LL" || x.kind === "HL").at(-1);
      kind = lastLow ? (lows[s.index]! < lastLow.price ? "LL" : "HL") : "LL";
    }
    swings.push({
      index: s.index,
      timestamp: timestamps[s.index]!,
      price: s.type === "high" ? highs[s.index]! : lows[s.index]!,
      kind,
    });
  }

  const last = swings.at(-1);
  const trend: MarketStructure["trend"] = !last ? "sideways"
    : last.kind === "HH" || last.kind === "HL" ? "up"
    : last.kind === "LL" || last.kind === "LH" ? "down"
    : "sideways";

  const structureLabel = last ? `${last.kind} (last)` : "range";

  return { swings, trend, structureLabel };
}

/** Média móvel simples (re-export p/ conveniência). */
export function sma(values: readonly number[], period: number): Series {
  return smaFn(values, period);
}
