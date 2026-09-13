/** GroundTruth + price-observation resolution (pure).
 * Never fabricates observations: missing ids stay LEGACY_INCOMPLETE_PROVENANCE. */
export type PriceObservationRef = { priceObservationId: string; value: number; observedAt: number; status: string };

export type GroundTruthInput = {
  groundTruthId: string; sessionId?: string | null; decisionId?: string | null; signalId?: string | null; operationId?: string | null;
  marketEventId?: string | null; entryPriceObservationId?: string | null; settlementPriceObservationId?: string | null;
  entryPrice?: number | null; settlementPrice?: number | null; result?: string | null; traceId?: string | null; now?: number;
};

export function buildGroundTruth(input: GroundTruthInput) {
  const complete = Boolean(input.entryPriceObservationId && input.settlementPriceObservationId);
  return {
    groundTruthId: input.groundTruthId, sessionId: input.sessionId ?? null, decisionId: input.decisionId ?? null, signalId: input.signalId ?? null,
    operationId: input.operationId ?? null, marketEventId: input.marketEventId ?? null,
    entryPriceObservationId: input.entryPriceObservationId ?? null, settlementPriceObservationId: input.settlementPriceObservationId ?? null,
    entryPrice: Number.isFinite(Number(input.entryPrice)) ? Number(input.entryPrice) : null,
    settlementPrice: Number.isFinite(Number(input.settlementPrice)) ? Number(input.settlementPrice) : null,
    result: input.result ?? null, status: complete ? "COMPLETE" : "LEGACY_INCOMPLETE_PROVENANCE", traceId: input.traceId ?? null, createdAt: input.now ?? Date.now(),
  };
}

export type ChainResolution = { status: "COMPLETE" | "LEGACY_INCOMPLETE_PROVENANCE" | "INVALID"; entry: PriceObservationRef | null; settlement: PriceObservationRef | null; reasons: string[] };

export function resolveGroundTruthChain(input: { entryPriceObservationId?: string | null; settlementPriceObservationId?: string | null; entryTimestamp?: number | null; settlementTimestamp?: number | null; entryPrice?: number | null; settlementPrice?: number | null; observations: readonly PriceObservationRef[] }): ChainResolution {
  const reasons: string[] = [];
  const find = (id?: string | null) => id ? input.observations.find((item) => item.priceObservationId === id) ?? null : null;
  if (!input.entryPriceObservationId || !input.settlementPriceObservationId) return { status: "LEGACY_INCOMPLETE_PROVENANCE", entry: find(input.entryPriceObservationId), settlement: find(input.settlementPriceObservationId), reasons: ["missing_observation_id"] };
  const entry = find(input.entryPriceObservationId); const settlement = find(input.settlementPriceObservationId);
  if (!entry) reasons.push("entry_observation_not_found");
  if (!settlement) reasons.push("settlement_observation_not_found");
  if (entry && entry.status !== "ACCEPTED") reasons.push(`entry_status_${entry.status}`);
  if (settlement && settlement.status !== "ACCEPTED") reasons.push(`settlement_status_${settlement.status}`);
  if (entry && input.entryTimestamp != null && entry.observedAt > input.entryTimestamp + 3_000) reasons.push("entry_observation_not_causal");
  if (settlement && input.settlementTimestamp != null && settlement.observedAt > input.settlementTimestamp + 3_000) reasons.push("settlement_observation_not_causal");
  if (entry && input.entryPrice != null && entry.value !== input.entryPrice) reasons.push("entry_value_mismatch");
  if (settlement && input.settlementPrice != null && settlement.value !== input.settlementPrice) reasons.push("settlement_value_mismatch");
  return { status: reasons.length ? "INVALID" : "COMPLETE", entry, settlement, reasons };
}
