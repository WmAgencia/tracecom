export const CANDLE_SECONDS = 5;
export const VISIBLE_WINDOW_SECONDS = 300;
export const EXPIRATION_SECONDS = 60;

export function candleCloseTimestamp(timestampMs: number, candleSeconds = CANDLE_SECONDS): number {
  return Math.floor(timestampMs / (candleSeconds * 1000)) * candleSeconds * 1000;
}

export function candleId(timestampMs: number, candleSeconds = CANDLE_SECONDS): string {
  return `candle_${candleCloseTimestamp(timestampMs, candleSeconds)}`;
}

export function nextCandleAnalysisAt(timestampMs: number, delayMs = 500, candleSeconds = CANDLE_SECONDS): number {
  const nextClose = (Math.floor(timestampMs / (candleSeconds * 1000)) + 1) * candleSeconds * 1000;
  return nextClose + delayMs;
}
