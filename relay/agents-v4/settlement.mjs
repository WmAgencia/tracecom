/**
 * AGENTS V4 SETTLEMENT — liquidacao CAUSAL observacional (PROSPECTIVE_SHADOW).
 *
 * - NUNCA marca BROKER_EXECUTED (exclusivo do settlement real do broker);
 * - toda liquidacao e CAUSAL_COUNTERFACTUAL com provenance PROSPECTIVE_SHADOW;
 * - idempotente (linha ja liquidada nunca e reescrita);
 * - apenas observacoes com direcao BUY/SELL sao liquidadas; WAIT/NO_TRADE nao tem preco de entrada.
 */
import { settleDirectionalOutcome, causalPricesFromCandles } from "../scenario-shadow-settlement.mjs";
import { normalizedOutcomePnl } from "../shadow-lab.mjs";

export const AGENTS_V4_SETTLEMENT_VERSION = "agents-v4-settlement-v1";
export const AGENTS_V4_SETTLEMENT_BASIS = "CAUSAL_COUNTERFACTUAL";
export const AGENTS_V4_SETTLEMENT_PROVENANCE = "PROSPECTIVE_SHADOW";
export const AGENTS_V4_SETTLEMENT_POLICY = Object.freeze({
  version: AGENTS_V4_SETTLEMENT_VERSION,
  execution: "SHADOW_ONLY",
  controlsExecution: false,
  sendsOrders: false,
  basis: AGENTS_V4_SETTLEMENT_BASIS,
  provenance: AGENTS_V4_SETTLEMENT_PROVENANCE,
  outcomeUsedInClassification: false,
  feedableToClassification: false,
  brokerBasisForbidden: true,
  note: "Liquidacao causal de observacoes V4; nunca broker, nunca realimenta a classificacao.",
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

function isPendingSettleable(observation) {
  if (!observation || typeof observation !== "object") return false;
  if (observation.outcome != null || observation.settlementBasis != null || observation.theoreticalResult != null) return false;
  if (observation.status === "SETTLED") return false;
  if (observation.direction !== "BUY" && observation.direction !== "SELL") return false;
  if (num(observation.targetExpiryAt) === null) return false;
  return true;
}

export class AgentsV4Settlement {
  constructor({ observationSource = null, persistence = null, now = () => Date.now(), log = () => {}, maxPerMarket = 2_000 } = {}) {
    this.observationSource = observationSource;
    this.persistence = persistence;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxPerMarket = maxPerMarket;
    this.settled = { total: 0, wins: 0, losses: 0, draws: 0, skippedNoDirection: 0, lastAt: null };
  }

  list() {
    if (typeof this.observationSource?.list === "function") return this.observationSource.list();
    return [];
  }

  pendingForMarket(marketKey) {
    return this.list().filter((observation) => observation?.marketKey === marketKey && isPendingSettleable(observation)).slice(0, this.maxPerMarket);
  }

  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const observedUntil = num(candles[index]?.bucketStart);
    if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now();
    let settled = 0;
    for (const observation of this.pendingForMarket(marketKey)) {
      const targetExpiryAt = num(observation.targetExpiryAt);
      if (targetExpiryAt === null || observedUntil < targetExpiryAt) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: observation.targetEntryAt, targetExpiryAt });
      const result = settleDirectionalOutcome({ direction: observation.direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice });
      if (!result) continue;
      this.#applySettlement(observation, { result, prices, atMs });
      settled += 1;
    }
    if (settled > 0) this.log("AGENTS_V4_SETTLED", JSON.stringify({ marketKey, settled, at: atMs }));
    return settled;
  }

  #applySettlement(observation, { result, prices, atMs }) {
    const payout = num(observation.payout);
    const normalizedPnl = normalizedOutcomePnl({ result, payout });
    observation.outcome = {
      result,
      entryPrice: prices.entryPrice,
      expiryPrice: prices.expiryPrice,
      settlementPrice: prices.expiryPrice,
      entryBucketStart: prices.entryBucketStart,
      expiryBucketStart: prices.expiryBucketStart,
      settlementBasis: AGENTS_V4_SETTLEMENT_BASIS,
      provenance: AGENTS_V4_SETTLEMENT_PROVENANCE,
      at: atMs,
      outcomeUsedInClassification: false,
      feedableToClassification: false,
      note: "OUTCOME causal pos-classificacao (contrafactual prospectivo V4); nunca broker.",
    };
    observation.outcomeAt = atMs;
    observation.settlementBasis = AGENTS_V4_SETTLEMENT_BASIS;
    observation.theoreticalResult = result;
    observation.theoreticalPnl = normalizedPnl;
    observation.status = "SETTLED";
    observation.updatedAt = atMs;
    this.settled.total += 1;
    if (result === "WIN") this.settled.wins += 1;
    else if (result === "LOSS") this.settled.losses += 1;
    else this.settled.draws += 1;
    this.settled.lastAt = atMs;
    void this.persistence?.markSettled?.(observation);
  }

  status() {
    return {
      version: AGENTS_V4_SETTLEMENT_VERSION,
      policy: AGENTS_V4_SETTLEMENT_POLICY,
      settlementBasis: AGENTS_V4_SETTLEMENT_BASIS,
      settled: { ...this.settled },
      enabled: Boolean(this.observationSource),
      controlsExecution: false,
      sendsOrders: false,
      persistence: this.persistence?.status?.() ?? null,
    };
  }
}
