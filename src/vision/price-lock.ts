export type PriceObservation = { value: number; timestamp: number; confidence: number; source: string };

export function lockCausalPrice(observations: readonly PriceObservation[], targetTimestamp: number, toleranceMs = 3_000): PriceObservation | null {
  return observations.filter((item) => Number.isFinite(item.value) && item.timestamp <= targetTimestamp && targetTimestamp - item.timestamp <= toleranceMs && item.confidence >= .6).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}
