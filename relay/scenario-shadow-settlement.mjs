/**
 * SCENARIO SHADOW SETTLEMENT — liquidacao CAUSAL observacional (PROSPECTIVE_SHADOW).
 *
 * Corrige a quebra da cadeia `observacao prospectiva -> target expiry -> preco no expiry ->
 * WIN/LOSS/DRAW` SEM tocar na estrategia nem no motor congelado:
 *   - NAO altera `relay/scenario-engine.mjs`, `relay/scenario-shadow.mjs` nem
 *     `relay/scenario-timing-intersection.mjs` (sha256 do freeze intactos);
 *   - NUNCA marca `BROKER_EXECUTED` (isso continua exclusivo do settlement do broker em
 *     `ScenarioShadow.recordOutcome`, chamado pelo runtime no settlement da posicao);
 *   - toda liquidacao daqui e `CAUSAL_COUNTERFACTUAL` e carrega `provenance=PROSPECTIVE_SHADOW`;
 *   - outcome e POS-classificacao: `outcomeUsedInClassification:false`/`feedableToClassification:false`;
 *   - idempotente: linha ja liquidada (outcome/settlementBasis/theoreticalResult) nunca e reescrita;
 *   - usa a MESMA regra causal do ShadowLab.settleCausal (close do ultimo candle com
 *     bucketStart <= targetExpiryAt e entrada no candle com bucketStart <= targetEntryAt).
 *
 * Este modulo e a UNICA infraestrutura observacional nova desta rodada; nao decide, nao envia ordem,
 * nao controla stake/direcao/threshold/JIT/Execution Gate.
 */
import { normalizedOutcomePnl } from "./shadow-lab.mjs";

export const SCENARIO_SHADOW_SETTLEMENT_VERSION = "scenario-shadow-settlement-v1";
export const SCENARIO_SHADOW_SETTLEMENT_BASIS = "CAUSAL_COUNTERFACTUAL";
export const SCENARIO_SHADOW_SETTLEMENT_PROVENANCE = "PROSPECTIVE_SHADOW";
export const SCENARIO_SHADOW_SETTLEMENT_POLICY = Object.freeze({
  version: SCENARIO_SHADOW_SETTLEMENT_VERSION,
  execution: "SHADOW_ONLY",
  controlsExecution: false,
  sendsOrders: false,
  basis: SCENARIO_SHADOW_SETTLEMENT_BASIS,
  outcomeUsedInClassification: false,
  feedableToClassification: false,
  brokerBasisForbidden: true,
  note: "Liquidacao observacional de observacoes prospectivas; nunca broker, nunca realimenta a classificacao.",
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

/** WIN/LOSS/DRAW direcional puro (mesma convencao do ShadowLab/LateWindow). */
export function settleDirectionalOutcome({ direction = null, entryPrice = null, expiryPrice = null } = {}) {
  const entry = num(entryPrice);
  const expiry = num(expiryPrice);
  if (entry === null || expiry === null) return null;
  if (expiry === entry) return "DRAW";
  const up = expiry > entry;
  if (direction === "BUY") return up ? "WIN" : "LOSS";
  if (direction === "SELL") return !up ? "WIN" : "LOSS";
  return null;
}

/**
 * Precos causais a partir dos candles do pipeline: entrada = close do ultimo candle com
 * `bucketStart <= targetEntryAt`; liquidacao = close do ultimo candle com `bucketStart <= targetExpiryAt`.
 * `complete` só e true quando algum candle alcancou o expiry.
 */
export function causalPricesFromCandles({ candles = [], targetEntryAt = null, targetExpiryAt = null } = {}) {
  const list = (Array.isArray(candles) ? candles : [])
    .filter((candle) => candle && Number.isFinite(Number(candle.bucketStart)) && Number.isFinite(Number(candle.close)))
    .map((candle) => ({ bucketStart: Number(candle.bucketStart), close: Number(candle.close) }))
    .sort((a, b) => a.bucketStart - b.bucketStart);
  const entryTarget = num(targetEntryAt);
  const expiryTarget = num(targetExpiryAt);
  const entryCandle = entryTarget === null ? null : [...list].reverse().find((candle) => candle.bucketStart <= entryTarget) ?? null;
  const expiryCandle = expiryTarget === null ? null : [...list].reverse().find((candle) => candle.bucketStart <= expiryTarget) ?? null;
  const reached = expiryTarget !== null && list.length > 0 && list[list.length - 1].bucketStart >= expiryTarget;
  return {
    entryPrice: entryCandle?.close ?? null,
    expiryPrice: expiryCandle?.close ?? null,
    entryBucketStart: entryCandle?.bucketStart ?? null,
    expiryBucketStart: expiryCandle?.bucketStart ?? null,
    observedUntil: list.length ? list[list.length - 1].bucketStart : null,
    complete: Boolean(reached && entryCandle && expiryCandle),
  };
}

function isPendingProspective(observation) {
  if (!observation || typeof observation !== "object") return false;
  if ((observation.provenance ?? "PROSPECTIVE") !== "PROSPECTIVE") return false;
  if (observation.outcome != null) return false;
  if (observation.settlementBasis != null) return false;
  if (observation.theoreticalResult != null) return false;
  if (observation.status === "SETTLED") return false;
  if (num(observation.targetExpiryAt) === null) return false;
  if (observation.direction !== "BUY" && observation.direction !== "SELL") return false;
  return true;
}

export class ScenarioShadowSettlement {
  constructor({ scenarioShadow = null, pool = null, now = () => Date.now(), log = () => {}, maxPerMarket = 2_000 } = {}) {
    this.scenarioShadow = scenarioShadow;
    this.pool = pool;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.maxPerMarket = maxPerMarket;
    this.persist = { attempts: 0, ok: 0, failures: 0, lastError: null, lastOkAt: null };
    this.settled = { total: 0, wins: 0, losses: 0, draws: 0, lastAt: null };
  }

  /** Observacoes prospectivas ainda pendentes do mercado (somente leitura do estado SHADOW). */
  pendingForMarket(marketKey) {
    const list = typeof this.scenarioShadow?.list === "function" ? this.scenarioShadow.list() : [];
    return list.filter((observation) => observation?.marketKey === marketKey && isPendingProspective(observation));
  }

  /**
   * Liquidacao causal chamada no mesmo ponto do pipeline de candles do ShadowLab/Timing.
   * NUNCA envia ordem, NUNCA usa resultado de broker, NUNCA altera a classificacao.
   */
  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0 || index >= candles.length) return 0;
    const candle = candles[index];
    const observedUntil = num(candle?.bucketStart);
    if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now();
    let settled = 0;
    for (const observation of this.pendingForMarket(marketKey).slice(0, this.maxPerMarket)) {
      const targetExpiryAt = num(observation.targetExpiryAt);
      if (targetExpiryAt === null || observedUntil < targetExpiryAt) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: observation.targetEntryAt, targetExpiryAt });
      const result = settleDirectionalOutcome({ direction: observation.direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice });
      if (!result) continue;
      this.#applySettlement(observation, { result, prices, atMs });
      settled += 1;
    }
    if (settled > 0) this.#safeLog("SCENARIO_SHADOW_SETTLED", { marketKey, settled, at: atMs });
    return settled;
  }

  #applySettlement(observation, { result, prices, atMs }) {
    const payout = num(observation.payout);
    const normalized = normalizedOutcomePnl({ result, payout });
    observation.outcome = {
      result,
      profit: null,
      stake: null,
      payout,
      normalizedPnl: normalized,
      entryPrice: prices.entryPrice,
      expiryPrice: prices.expiryPrice,
      settlementPrice: prices.expiryPrice,
      entryBucketStart: prices.entryBucketStart,
      expiryBucketStart: prices.expiryBucketStart,
      settlementBasis: SCENARIO_SHADOW_SETTLEMENT_BASIS,
      provenance: SCENARIO_SHADOW_SETTLEMENT_PROVENANCE,
      at: atMs,
      outcomeUsedInClassification: false,
      feedableToClassification: false,
      postWindowDiagnosticOnly: true,
      note: "OUTCOME causal pos-classificacao (contrafactual prospectivo); nunca broker, nunca realimenta a classificacao.",
    };
    observation.outcomeAt = atMs;
    observation.outcomeUsedInClassification = false;
    observation.settlementBasis = SCENARIO_SHADOW_SETTLEMENT_BASIS;
    observation.theoreticalResult = result;
    observation.theoreticalPnl = normalized;
    observation.status = "SETTLED";
    observation.updatedAt = atMs;
    this.settled.total += 1;
    if (result === "WIN") this.settled.wins += 1;
    else if (result === "LOSS") this.settled.losses += 1;
    else if (result === "DRAW") this.settled.draws += 1;
    this.settled.lastAt = atMs;
    void this.#persistSettlement(observation);
  }

  async #persistSettlement(observation) {
    if (!this.pool?.query || !observation?.id) return false;
    this.persist.attempts += 1;
    try {
      await this.pool.query(
        `UPDATE iq_scenario_shadow_observations
            SET outcome=$2::jsonb, settlement_basis=$3, theoretical_result=$4, theoretical_pnl=$5, updated_at=now()
          WHERE observation_id=$1 AND (outcome IS NULL OR outcome = 'null'::jsonb) AND settlement_basis IS NULL`,
        [
          observation.id,
          JSON.stringify(observation.outcome),
          SCENARIO_SHADOW_SETTLEMENT_BASIS,
          observation.theoreticalResult,
          observation.theoreticalPnl,
        ],
      );
      this.persist.ok += 1;
      this.persist.lastOkAt = this.now();
      return true;
    } catch (error) {
      this.persist.failures += 1;
      this.persist.lastError = String(error?.message ?? error).slice(0, 200);
      this.#safeLog("SCENARIO_SHADOW_SETTLEMENT_PERSIST_FAILED", { observationId: observation.id, error: this.persist.lastError });
      return false;
    }
  }

  status() {
    return {
      version: SCENARIO_SHADOW_SETTLEMENT_VERSION,
      policy: SCENARIO_SHADOW_SETTLEMENT_POLICY,
      settlementBasis: SCENARIO_SHADOW_SETTLEMENT_BASIS,
      settled: { ...this.settled },
      persist: { ...this.persist, mode: this.pool ? "POSTGRES" : "MEMORY" },
      enabled: Boolean(this.scenarioShadow),
      controlsExecution: false,
      sendsOrders: false,
    };
  }

  #safeLog(event, payload) { this.log(event, JSON.stringify(payload)); }
}
