/**
 * Detecção de liquidez SMC (Smart Money Concepts).
 *
 * - Equal highs/lows: zonas onde o preço tocou várias vezes no mesmo nível,
 *   indicando pools de liquidez (stops acumulados).
 * - Liquidity sweeps (armadilhas de stops): quando o preço rompe um equal high/low
 *   mas fecha do outro lado (clássica "caça a stops" institucional).
 *
 * Determinístico, puro, consome candles + swings (do marketStructure).
 */
import type { MarketCandle } from "../market/model";
import type { SwingPoint } from "./types";

export interface LiquidityLevel {
  readonly price: number;
  readonly kind: "high" | "low";
  readonly touches: readonly { readonly timestamp: number; readonly index: number }[];
  readonly swept: boolean;
  readonly sweptAt: number | null;
  readonly sweepType: "buy-side" | "sell-side" | null;
}

export interface LiquidityResult {
  readonly levels: readonly LiquidityLevel[];
  readonly buySideSweeps: readonly { readonly timestamp: number; readonly level: number; readonly recoveredTo: number }[];
  readonly sellSideSweeps: readonly { readonly timestamp: number; readonly level: number; readonly recoveredTo: number }[];
}

/**
 * Agrupa swing points próximos (±tolerancePct) em equal highs/lows e detecta
 * liquidity sweeps nas candles subsequentes.
 *
 * @param candles       candles completas (OHLCV) na ordem cronológica.
 * @param swings        swing points vindos de `marketStructure`.
 * @param tolerancePct  tolerância relativa para agrupar níveis (default 0.001 = 0.1%).
 * @param sweepLookback nº máx. de candles APÓS o último touch para considerar um sweep
 *                      (default 5). Candles além deste limite são ignorados.
 */
export function detectLiquidity(
  candles: readonly MarketCandle[],
  swings: readonly SwingPoint[],
  tolerancePct: number = 0.001,
  sweepLookback: number = 5,
): LiquidityResult {
  if (swings.length === 0) {
    return { levels: [], buySideSweeps: [], sellSideSweeps: [] };
  }

  // 1) Agrupar swings do mesmo kind que estão dentro da tolerância.
  //    Agrupamos separadamente highs e lows para não misturar níveis.
  type RawLevel = {
    price: number;
    kind: "high" | "low";
    touches: { timestamp: number; index: number }[];
    lastIndex: number;
  };

  const grouped: RawLevel[] = [];

  // ordena por timestamp para garantir ordem cronológica na agregação
  const ordered = [...swings].sort((a, b) => a.index - b.index);

  for (const s of ordered) {
    // HH/HL partem de swing highs; LH/LL partem de swing lows.
    const kind: "high" | "low" = s.kind === "HH" || s.kind === "LH" ? "high" : "low";

    let matched: RawLevel | null = null;
    for (const g of grouped) {
      if (g.kind !== kind) continue;
      if (g.lastIndex >= s.index) continue; // só agrupar com níveis anteriores
      const ref = g.price === 0 ? 1 : g.price;
      const diff = Math.abs(s.price - g.price) / ref;
      if (diff <= tolerancePct) {
        matched = g;
        break;
      }
    }

    if (matched) {
      // atualiza preço médio e adiciona touch
      const newTouchCount = matched.touches.length + 1;
      matched.price = (matched.price * matched.touches.length + s.price) / newTouchCount;
      matched.touches.push({ timestamp: s.timestamp, index: s.index });
      matched.lastIndex = s.index;
    } else {
      grouped.push({
        price: s.price,
        kind,
        touches: [{ timestamp: s.timestamp, index: s.index }],
        lastIndex: s.index,
      });
    }
  }

  // 2) Construir níveis (qualquer grupo é um nível; equal se touches >= 2).
  // Um pool de liquidez exige ao menos dois toques independentes; um swing
  // isolado não pode ser promovido a equal high/low nem gerar sweep.
  const equalGroups = grouped.filter((g) => g.touches.length >= 2);
  const levels: LiquidityLevel[] = equalGroups.map((g) => ({
    price: g.price,
    kind: g.kind,
    touches: g.touches,
    swept: false,
    sweptAt: null,
    sweepType: null,
  }));

  const buySideSweeps: { timestamp: number; level: number; recoveredTo: number }[] = [];
  const sellSideSweeps: { timestamp: number; level: number; recoveredTo: number }[] = [];

  // 3) Detectar sweeps para cada nível dentro do lookback.
  for (let li = 0; li < equalGroups.length; li++) {
    const g = equalGroups[li]!;
    const lastTouchIdx = g.lastIndex;
    const startScan = lastTouchIdx + 1;
    const endScan = Math.min(candles.length, startScan + sweepLookback);

    let sweepFound = false;
    for (let i = startScan; i < endScan; i++) {
      const c = candles[i];
      if (!c) continue;

      if (g.kind === "high") {
        // buy-side sweep: high rompe acima, mas fecha abaixo do nível
        if (c.high > g.price && c.close < g.price) {
          const recoveredTo = c.close;
          buySideSweeps.push({ timestamp: c.timestamp, level: g.price, recoveredTo });
          levels[li] = {
            price: g.price,
            kind: g.kind,
            touches: g.touches,
            swept: true,
            sweptAt: c.timestamp,
            sweepType: "buy-side",
          };
          sweepFound = true;
          break;
        }
      } else {
        // sell-side sweep: low rompe abaixo, mas fecha acima do nível
        if (c.low < g.price && c.close > g.price) {
          const recoveredTo = c.close;
          sellSideSweeps.push({ timestamp: c.timestamp, level: g.price, recoveredTo });
          levels[li] = {
            price: g.price,
            kind: g.kind,
            touches: g.touches,
            swept: true,
            sweptAt: c.timestamp,
            sweepType: "sell-side",
          };
          sweepFound = true;
          break;
        }
      }
    }

    // manter a referência atualizada em grouped caso tenhamos reatribuído levels[li]
    if (sweepFound) {
      equalGroups[li] = {
        price: g.price,
        kind: g.kind,
        touches: g.touches,
        lastIndex: g.lastIndex,
      };
    }
  }

  return { levels, buySideSweeps, sellSideSweeps };
}
