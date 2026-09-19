/**
 * NATIVE FACTORS — fatores do TraceCom (feed real 5s + ticks), com metadados completos.
 *
 * Fonte: DETERMINISTIC_CALCULATION sobre candles causais e tick ring; nada de volume/order book OTC.
 */
import { rsiWilder, atrWilder, adxWilder, donchian, microstructure } from "../../feature-engine.mjs";
import { computeStructureFeatures } from "../../price-structure.mjs";
import { tsMean, tsSlope, tsStd, tsMax, tsMin } from "../ops.mjs";

export const NATIVE_FACTORS_VERSION = "tracecom-native-factors-v1";

const candlesUpTo = (ctx) => (Array.isArray(ctx?.candles) ? ctx.candles.slice(0, (ctx.index ?? ctx.candles.length - 1) + 1) : []);
const closesOf = (list) => list.map((candle) => candle.close);

function atrOf(list) { return atrWilder(list, 14); }

function rsiSeries(list, period = 14) {
  const closes = closesOf(list);
  const series = [];
  for (let index = period + 1; index < closes.length; index += 1) series.push(rsiWilder(closes.slice(0, index + 1), period));
  return series;
}

export const NATIVE_FACTORS = [
  {
    factorId: "tc_rsi14", name: "RSI Wilder 14", category: "MOMENTUM", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "rsiWilder(closes,14)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => rsiWilder(closesOf(candlesUpTo(ctx)), 14),
  },
  {
    factorId: "tc_rsi_slope5", name: "RSI slope 5", category: "MOMENTUM", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "slope(rsiSeries,5)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => tsSlope(rsiSeries(candlesUpTo(ctx)), 5),
  },
  {
    factorId: "tc_velocity_atr", name: "Velocity / ATR", category: "MOMENTUM", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "((close_t-close_{t-3})/3)/atr14", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const closes = closesOf(list); const atr = atrOf(list);
      if (!atr || closes.length < 4) return null;
      return Number((((closes[closes.length - 1] - closes[closes.length - 4]) / 3) / atr).toFixed(6));
    },
  },
  {
    factorId: "tc_acceleration_atr", name: "Acceleration / ATR", category: "MOMENTUM", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "velocity_t - velocity_{t-3} (normalizado por ATR)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const closes = closesOf(list); const atr = atrOf(list);
      if (!atr || closes.length < 7) return null;
      const recent = (closes[closes.length - 1] - closes[closes.length - 4]) / 3;
      const prior = (closes[closes.length - 4] - closes[closes.length - 7]) / 3;
      return Number(((recent - prior) / atr).toFixed(6));
    },
  },
  {
    factorId: "tc_adx14", name: "ADX Wilder 14", category: "TREND", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "adxWilder(candles,14).adx", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => { const adx = adxWilder(candlesUpTo(ctx), 14); return adx?.adx ?? null; },
  },
  {
    factorId: "tc_di_spread", name: "+DI - -DI", category: "TREND", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "plusDI - minusDI", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => { const adx = adxWilder(candlesUpTo(ctx), 14); return adx ? Number((adx.plusDI - adx.minusDI).toFixed(4)) : null; },
  },
  {
    factorId: "tc_atr_ratio", name: "ATR ratio (vs baseline 20)", category: "VOLATILITY", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "atr14 / mean(atr14 historico)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx);
      const structure = computeStructureFeatures(list, list.length - 1, { atr: atrOf(list) });
      return structure?.volatility?.atrRatio ?? null;
    },
  },
  {
    factorId: "tc_realized_vol20", name: "Realized vol 20 (stdev de retornos)", category: "VOLATILITY", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "stdev(returns[1..20])", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const closes = closesOf(candlesUpTo(ctx));
      if (closes.length < 21) return null;
      const returns = [];
      for (let index = closes.length - 20; index < closes.length; index += 1) returns.push((closes[index] - closes[index - 1]) / closes[index - 1]);
      return tsStd(returns);
    },
  },
  {
    factorId: "tc_donchian_position", name: "Donchian position 20", category: "STRUCTURE", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "donchian(candles,20).position", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => donchian(candlesUpTo(ctx), 20)?.position ?? null,
  },
  {
    factorId: "tc_donchian_width_atr", name: "Donchian width / ATR", category: "VOLATILITY", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "donchian.width / atr14", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const channel = donchian(list, 20); const atr = atrOf(list);
      return channel && atr ? Number((channel.width / atr).toFixed(4)) : null;
    },
  },
  {
    factorId: "tc_dist_upper_atr", name: "Distancia ao topo do canal / ATR", category: "STRUCTURE", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "(channelHigh - close)/atr", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const channel = donchian(list, 20); const atr = atrOf(list);
      const close = closesOf(list).at(-1) ?? null;
      return channel && atr && close !== null ? Number(((channel.upper - close) / atr).toFixed(4)) : null;
    },
  },
  {
    factorId: "tc_dist_lower_atr", name: "Distancia ao fundo do canal / ATR", category: "STRUCTURE", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "(close - channelLow)/atr", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const channel = donchian(list, 20); const atr = atrOf(list);
      const close = closesOf(list).at(-1) ?? null;
      return channel && atr && close !== null ? Number(((close - channel.lower) / atr).toFixed(4)) : null;
    },
  },
  {
    factorId: "tc_body_ratio", name: "Body ratio do ultimo candle", category: "PRICE_ACTION", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "|close-open|/(high-low)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const candle = list.at(-1); if (!candle) return null;
      const range = candle.high - candle.low;
      return range > 0 ? Number((Math.abs(candle.close - candle.open) / range).toFixed(4)) : 0;
    },
  },
  {
    factorId: "tc_close_location", name: "Close location no range", category: "PRICE_ACTION", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "(close-low)/(high-low)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const candle = candlesUpTo(ctx).at(-1); if (!candle) return null;
      const range = candle.high - candle.low;
      return range > 0 ? Number(((candle.close - candle.low) / range).toFixed(4)) : 0.5;
    },
  },
  {
    factorId: "tc_upper_wick", name: "Upper wick relativo", category: "PRICE_ACTION", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "(high-max(open,close))/(high-low)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const candle = candlesUpTo(ctx).at(-1); if (!candle) return null;
      const range = candle.high - candle.low;
      return range > 0 ? Number(((candle.high - Math.max(candle.open, candle.close)) / range).toFixed(4)) : 0;
    },
  },
  {
    factorId: "tc_lower_wick", name: "Lower wick relativo", category: "PRICE_ACTION", nativeOrDerived: "NATIVE",
    requiredData: ["CANDLE_5S"], formula: "(min(open,close)-low)/(high-low)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const candle = candlesUpTo(ctx).at(-1); if (!candle) return null;
      const range = candle.high - candle.low;
      return range > 0 ? Number(((Math.min(candle.open, candle.close) - candle.low) / range).toFixed(4)) : 0;
    },
  },
  {
    factorId: "tc_hh_hl_flag", name: "Estrutura HH+HL", category: "STRUCTURE", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "1 se ultimo topo/fundo sao ambos ascendentes; -1 se ambos descendentes; 0 misto",
    availableAtSemantics: "swings confirmados com lookback 2 (causal)",
    compute: (ctx) => {
      const list = candlesUpTo(ctx);
      if (list.length < 30) return null;
      const structure = computeStructureFeatures(list, list.length - 1, { atr: atrOf(list) });
      if (!structure) return null;
      if (structure.structure.label === "UP") return 1;
      if (structure.structure.label === "DOWN") return -1;
      return 0;
    },
  },
  {
    factorId: "tc_candle_streak", name: "Streak de corpos", category: "PRICE_ACTION", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "microstructure(candles,6).streak", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => microstructure(candlesUpTo(ctx), 6)?.streak ?? null,
  },
  {
    factorId: "tc_micro_compression", name: "Micro compression (corpos 2a metade/1a)", category: "VOLATILITY", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "microstructure(candles,6).compression", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => microstructure(candlesUpTo(ctx), 6)?.compression ?? null,
  },
  {
    factorId: "tc_tick_pressure", name: "Tick pressure (ups-downs)/(total)", category: "MICROSTRUCTURE", nativeOrDerived: "DERIVED",
    requiredData: ["TICK_RING"], formula: "(up-down)/(up+down+flat) sobre tick ring", availableAtSemantics: "receivedAt do ultimo tick",
    compute: (ctx) => {
      const ticks = Array.isArray(ctx?.ticks) ? ctx.ticks : [];
      if (ticks.length < 3) return null;
      let up = 0, down = 0, flat = 0;
      for (let index = 1; index < ticks.length; index += 1) {
        const delta = Number(ticks[index].price) - Number(ticks[index - 1].price);
        if (delta > 0) up += 1; else if (delta < 0) down += 1; else flat += 1;
      }
      return Number(((up - down) / (up + down + flat || 1)).toFixed(4));
    },
  },
  {
    factorId: "tc_tick_momentum", name: "Tick momentum (ultimos 6 / anteriores 6)", category: "MICROSTRUCTURE", nativeOrDerived: "DERIVED",
    requiredData: ["TICK_RING"], formula: "(last-first)/janela dos ultimos 6 ticks menos anteriores", availableAtSemantics: "receivedAt do ultimo tick",
    compute: (ctx) => {
      const ticks = Array.isArray(ctx?.ticks) ? ctx.ticks : [];
      if (ticks.length < 12) return null;
      const recent = ticks.slice(-6), prior = ticks.slice(-12, -6);
      const slope = (list) => {
        const span = Number(list[list.length - 1].at) - Number(list[0].at);
        return span > 0 ? (Number(list[list.length - 1].price) - Number(list[0].price)) / span : 0;
      };
      return Number((slope(recent) - slope(prior)).toFixed(8));
    },
  },
  {
    factorId: "tc_range_position_ext", name: "Posicao no range de 20 candles (percentil)", category: "STRUCTURE", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "(close - min20)/(max20-min20)", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const closes = closesOf(list);
      if (closes.length < 20) return null;
      const high = tsMax(closes, 20), low = tsMin(closes, 20), close = closes.at(-1);
      return high !== null && low !== null && high > low ? Number(((close - low) / (high - low)).toFixed(4)) : 0.5;
    },
  },
  {
    factorId: "tc_ma_gap5", name: "Gap close vs MA5 (% do ATR)", category: "TREND", nativeOrDerived: "DERIVED",
    requiredData: ["CANDLE_5S"], formula: "(close - mean5)/atr", availableAtSemantics: "close do candle 5s fechado",
    compute: (ctx) => {
      const list = candlesUpTo(ctx); const closes = closesOf(list); const atr = atrOf(list);
      const avg = tsMean(closes, 5);
      if (!atr || avg === null) return null;
      return Number(((closes.at(-1) - avg) / atr).toFixed(4));
    },
  },
];

export function nativeFactorMap() {
  return Object.fromEntries(NATIVE_FACTORS.map((factor) => [factor.factorId, factor]));
}
