/**
 * NATIVE FACTORS VIA T0 — leitores point-in-time direto do T0 enriquecido (sem recalcular feed).
 *
 * Usado pelo Alpha Bench sobre observacoes prospectivas persistidas (payload->'t0').
 */
export const FROM_T0_VERSION = "native-factors-from-t0-v1";

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

export const FROM_T0_READERS = Object.freeze({
  tc_rsi14: (t0) => num(t0?.indicators?.rsi14),
  tc_rsi_slope5: (t0) => num(t0?.indicators?.rsiSlope),
  tc_velocity_atr: (t0) => ratio(t0?.momentum?.velocity, t0?.indicators?.atr14),
  tc_acceleration_atr: (t0) => ratio(t0?.momentum?.acceleration, t0?.indicators?.atr14),
  tc_adx14: (t0) => num(t0?.indicators?.adx14),
  tc_di_spread: (t0) => { const plus = num(t0?.indicators?.plusDI), minus = num(t0?.indicators?.minusDI); return plus !== null && minus !== null ? Number((plus - minus).toFixed(4)) : null; },
  tc_atr_ratio: (t0) => num(t0?.indicators?.atrRatio),
  tc_realized_vol20: (t0) => num(t0?.indicators?.realizedVol),
  tc_donchian_position: (t0) => num(t0?.indicators?.donchian?.position) ?? num(t0?.location?.donchianPosition),
  tc_donchian_width_atr: (t0) => num(t0?.indicators?.donchian?.widthATR),
  tc_dist_upper_atr: (t0) => num(t0?.location?.distanceToUpperATR),
  tc_dist_lower_atr: (t0) => num(t0?.location?.distanceToLowerATR),
  tc_body_ratio: (t0) => num(t0?.candles5s?.lastClosed?.bodyRatio),
  tc_close_location: (t0) => num(t0?.candles5s?.lastClosed?.closeLocation),
  tc_upper_wick: (t0) => num(t0?.candles5s?.lastClosed?.upperWick),
  tc_lower_wick: (t0) => num(t0?.candles5s?.lastClosed?.lowerWick),
  tc_hh_hl_flag: (t0) => (t0?.structure?.label === "UP" ? 1 : t0?.structure?.label === "DOWN" ? -1 : t0?.structure?.label === "RANGE" ? 0 : null),
  tc_candle_streak: (t0) => num(t0?.candles5s?.sequence?.streak),
  tc_micro_compression: (t0) => num(t0?.compression?.atrRatio) === null ? null : (t0.compression.compressed ? 1 : t0.compression.expanded ? -1 : 0),
  tc_tick_pressure: (t0) => num(t0?.ticks?.pressure),
  tc_tick_momentum: (t0) => num(t0?.ticks?.acceleration),
  tc_range_position_ext: (t0) => num(t0?.indicators?.donchian?.position) ?? num(t0?.location?.donchianPosition),
  tc_ma_gap5: () => null,
});

function ratio(numerator, denominator) {
  const a = num(numerator), b = num(denominator);
  if (a === null || b === null || b === 0) return null;
  return Number((a / b).toFixed(6));
}
