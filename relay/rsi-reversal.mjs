/**
 * RSI_REVERSAL_CONFLUENCE_V1 â€” experimento SEPARADO (PRACTICE): reversao por RSI extremo confirmada por
 * Bollinger(20,2) E DMI/ADX. RSI e o DETECTOR; Bollinger e DMI/ADX sao confirmacoes obrigatorias (ambas).
 * Ordem SO pode ser enviada nos ULTIMOS 5s antes do cutoff da MESMA expiracao (T-5s .. T-safe).
 * Nunca executa direto: encaminha pelo harness/Execution Gate (runtime.experimentRequestOrder).
 * Nao altera FIVE_WAY/G2/V4/Dual/Solo/Indicator/Late Window/Gates/stake/REAL.
 */
import crypto from "node:crypto";
import { rsiWilder, adxWilder } from "./feature-engine.mjs";
import { settleDirectionalOutcome, causalPricesFromCandles } from "./scenario-shadow-settlement.mjs";
import { normalizedOutcomePnl } from "./shadow-lab.mjs";
import { RollingWindow } from "./datahub/metrics.mjs";

export const RSI_REVERSAL_VERSION = "RSI_REVERSAL_CONFLUENCE_V1";
export const RSI_REVERSAL_EXPERIMENT_ID = "RSI_REVERSAL_CONFLUENCE_V1";
export const RSI_REVERSAL_STRATEGY_ID = "RSI_REVERSAL_CONFLUENCE_V1";
export const RSI_REVERSAL_ARM_PHRASE = "CONTA PRACTICE \u2192 ARMAR RSI REVERSAL 5S";
export const RSI_REVERSAL_POLICY = Object.freeze({
  version: RSI_REVERSAL_VERSION, mode: "PRACTICE_EXPERIMENT", practiceOnly: true, controlsExecution: false,
  detector: "RSI14_EXTREME", rsiBuyThreshold: 30, rsiSellThreshold: 70, bollingerPeriod: 20, bollingerStdDev: 2,
  minClosedCandles5s: 60, finalWindowMs: 5000, minimumSafeMarginMs: 3000, turbCutoffMs: 30_000,
  maxTotalBrokerAccepted: 30, stakeBrl: 1, autoInvert: false, sameExpiryRequired: true,
  confluence: "BOLLINGER_AND_DMI_ADX", settlementBasis: "CAUSAL_COUNTERFACTUAL",
});
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
export const RSI_BANDS_BUY = Object.freeze([[20, 30, "20-30"], [15, 20, "15-20"], [10, 15, "10-15"], [0, 10, "0-10"]]);
export const RSI_BANDS_SELL = Object.freeze([[70, 80, "70-80"], [80, 85, "80-85"], [85, 90, "85-90"], [90, 100, "90-100"]]);
export function rsiBand(value, side) { const bands = side === "BUY" ? RSI_BANDS_BUY : RSI_BANDS_SELL; for (const [low, high, label] of bands) if (value >= low && value < high) return label; return side === "BUY" ? "0-10" : "90-100"; }

/* ------------------------------- indicadores ------------------------------- */
function bollinger(closes) {
  const period = RSI_REVERSAL_POLICY.bollingerPeriod;
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const deviation = Math.sqrt(window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period);
  const upper = middle + RSI_REVERSAL_POLICY.bollingerStdDev * deviation, lower = middle - RSI_REVERSAL_POLICY.bollingerStdDev * deviation;
  const width = upper - lower, close = closes[closes.length - 1];
  return { upper, middle, lower, width, close, position: width > 0 ? (close - lower) / width : 0.5, distanceToUpper: upper - close, distanceToLower: close - lower };
}

export function evaluateRsiReversal({ candles, now = Date.now(), history = null } = {}) {
  const closed = (Array.isArray(candles) ? candles : []).filter((candle) => num(candle?.bucketEnd) !== null && Number(candle.bucketEnd) <= Number(now) && Number.isFinite(Number(candle.close)));
  const state = { status: "NO_OPPORTUNITY", direction: null, rsi: null, rsiBand: null, bollingerConfirmed: false, dmiConfirmed: false, rejectedStrongTrend: false };
  if (closed.length < RSI_REVERSAL_POLICY.minClosedCandles5s) return { ...state, status: "WAIT", reason: "INSUFFICIENT_HISTORY", closedCandles: closed.length };
  const closes = closed.map((candle) => Number(candle.close));
  const rsiSeries = [];
  for (let index = 16; index <= closes.length; index += 1) rsiSeries.push(rsiWilder(closes.slice(0, index), 14));
  const rsi = rsiSeries[rsiSeries.length - 1];
  const rsiPrevious = rsiSeries[rsiSeries.length - 2] ?? null;
  const rsiSlope = rsiSeries.length >= 4 ? Number(((rsiSeries[rsiSeries.length - 1] - rsiSeries[rsiSeries.length - 4]) / 3).toFixed(4)) : null;
  if (rsi === null) return { ...state, status: "WAIT", reason: "RSI_UNAVAILABLE" };
  const side = rsi <= RSI_REVERSAL_POLICY.rsiBuyThreshold ? "BUY" : rsi >= RSI_REVERSAL_POLICY.rsiSellThreshold ? "SELL" : null;
  if (!side) return { ...state, status: "NO_OPPORTUNITY", rsi: Number(rsi.toFixed(4)) };
  const bands = bollinger(closes);
  const adx = adxWilder(closed, 14);
  const adxSeries = [];
  for (let index = Math.max(30, closed.length - 8); index <= closed.length; index += 1) { const value = adxWilder(closed.slice(0, index), 14); if (value) adxSeries.push(value); }
  const plusSlope = adxSeries.length >= 3 ? Number((adxSeries[adxSeries.length - 1].plusDI - adxSeries[adxSeries.length - 3].plusDI).toFixed(4)) : null;
  const minusSlope = adxSeries.length >= 3 ? Number((adxSeries[adxSeries.length - 1].minusDI - adxSeries[adxSeries.length - 3].minusDI).toFixed(4)) : null;
  const adxSlope = adxSeries.length >= 3 ? Number((adxSeries[adxSeries.length - 1].adx - adxSeries[adxSeries.length - 3].adx).toFixed(4)) : null;
  const previousBand = bollinger(closes.slice(0, -1));
  const expanding = bands && previousBand ? bands.width > previousBand.width : null;

  const rsiExtreme = { value: Number(rsi.toFixed(4)), previous: rsiPrevious === null ? null : Number(rsiPrevious.toFixed(4)), slope: rsiSlope, band: rsiBand(rsi, side) };
  const extreme = history ?? {};
  const rsiTrajectory = history?.lastExtremeAt ? (rsi <= 30 || rsi >= 70 ? "STILL_EXTREME" : "LEAVING_EXTREME") : "ENTERING_EXTREME";

  const lower = bands ? bands.position <= 0.15 || bands.close <= bands.lower : false;
  const upper = bands ? bands.position >= 0.85 || bands.close >= bands.upper : false;
  const riduc = bands ? (side === "BUY" ? (bands.position > (history?.lastBandPosition ?? bands.position) && bands.position < 0) : (bands.position < (history?.lastBandPosition ?? bands.position) && bands.position > 1)) : false;
  const bollingerConfirmed = side === "BUY" ? Boolean(lower || riduc) : Boolean(upper || riduc);
  const bandRiding = side === "BUY" ? Boolean(lower && adx && adx.minusDI > adx.plusDI && minusSlope !== null && minusSlope > 0 && expanding) : Boolean(upper && adx && adx.plusDI > adx.minusDI && plusSlope !== null && plusSlope > 0 && expanding);
  const weakening = side === "BUY"
    ? Boolean(adx && ((minusSlope !== null && minusSlope < 0) || (plusSlope !== null && plusSlope > 0) || adx.plusDI > adx.minusDI))
    : Boolean(adx && ((plusSlope !== null && plusSlope < 0) || (minusSlope !== null && minusSlope > 0) || adx.minusDI > adx.plusDI));
  const strongContinuation = side === "BUY"
    ? Boolean(adx && adx.minusDI > adx.plusDI && minusSlope !== null && minusSlope > 0 && plusSlope !== null && plusSlope < 0 && (adxSlope === null || adxSlope >= 0) && expanding)
    : Boolean(adx && adx.plusDI > adx.minusDI && plusSlope !== null && plusSlope > 0 && minusSlope !== null && minusSlope < 0 && (adxSlope === null || adxSlope >= 0) && expanding);
  const dmiConfirmed = weakening && !strongContinuation && !bandRiding;
  const rejectedStrongTrend = strongContinuation || bandRiding;
  const bothConfirmed = bollingerConfirmed && dmiConfirmed;
  const status = rejectedStrongTrend ? "REVERSAL_REJECTED_STRONG_TREND" : bothConfirmed ? "CANDIDATE" : "WAITING_CONFIRMATION";
  return {
    status, direction: side, rsi: Number(rsi.toFixed(4)), rsiExtreme, rsiTrajectory, rsiBand: rsiExtreme.band,
    bollinger: bands ? { upper: Number(bands.upper.toFixed(8)), middle: Number(bands.middle.toFixed(8)), lower: Number(bands.lower.toFixed(8)), width: Number(bands.width.toFixed(8)), position: Number(bands.position.toFixed(4)), distanceToUpper: Number(bands.distanceToUpper.toFixed(8)), distanceToLower: Number(bands.distanceToLower.toFixed(8)), expanding } : null,
    bollingerConfirmed, bandRiding,
    dmi: adx ? { plusDI: Number(adx.plusDI.toFixed(4)), minusDI: Number(adx.minusDI.toFixed(4)), spread: Number((adx.plusDI - adx.minusDI).toFixed(4)), plusSlope, minusSlope } : null,
    adx: adx ? { value: Number(adx.adx.toFixed(4)), slope: adxSlope } : null,
    dmiConfirmed, rejectedStrongTrend, bothConfirmed,
    reason: rejectedStrongTrend ? `${side === "BUY" ? "STRONG_BEARISH" : "STRONG_BULLISH"}_CONTINUATION` : bothConfirmed ? "REVERSAL_CONFIRMED" : "WAITING_CONFIRMATION",
  };
}

/* ------------------------------- timing ------------------------------- */
export function effectiveSafeMarginMs({ ackP95Ms = 0, persistP95Ms = 0, decisionMs = 0, jitterMs = 300, bufferMs = 150 } = {}) {
  const measured = Number(ackP95Ms || 0) + Number(persistP95Ms || 0) + Number(decisionMs || 0) + Number(jitterMs || 0) + Number(bufferMs || 0);
  return Math.max(RSI_REVERSAL_POLICY.minimumSafeMarginMs, Math.round(measured));
}
export function entryWindow({ targetExpiryAt, safeMarginMs } = {}) {
  const expiry = num(targetExpiryAt); if (expiry === null) return null;
  const cutoff = expiry - RSI_REVERSAL_POLICY.turbCutoffMs;
  const margin = Math.max(RSI_REVERSAL_POLICY.minimumSafeMarginMs, Number(safeMarginMs) || RSI_REVERSAL_POLICY.minimumSafeMarginMs);
  const opens = cutoff - RSI_REVERSAL_POLICY.finalWindowMs;
  const closes = cutoff - margin;
  return { purchaseCutoffAt: cutoff, entryWindowOpensAt: opens, entryWindowClosesAt: closes, safeMarginMs: margin, windowMs: closes - opens };
}

/* ------------------------------- engine/experimento ------------------------------- */
export class RsiReversalExperiment {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.state = "DRY_RUN";
    this.memory = { executions: new Map(), events: [] };
    this.observations = new Map(); this.order = [];
    this.marketState = new Map();
    this.counters = { evaluations: 0, opportunities: 0, buyOpportunities: 0, sellOpportunities: 0, bollingerConfirmed: 0, dmiConfirmed: 0, bothConfirmed: 0, rejectedStrongTrend: 0, cancelledRevalidation: 0, missedWindow: 0, noSafeWindow: 0, brokerAccepted: 0, settled: 0, errors: 0 };
    this.settled = { total: 0, wins: 0, losses: 0, draws: 0, byMarket: {}, byType: {}, byRsiBand: {}, byDirection: {} };
    this.latency = { evaluation: new RollingWindow({ maxSamples: 512 }), submit: new RollingWindow({ maxSamples: 256 }) };
    this.lastByMarket = new Map();
    this.armPhraseHash = null;
  }

  async #ensureExperimentRow() {
    if (!this.pool?.query) { this.state = this.state === "DRY_RUN" ? "READY_TO_ARM" : this.state; return; }
    await this.pool.query(`INSERT INTO iq_execution_experiments(id, state, max_total, min_stake_brl) VALUES($1,'DRY_RUN',$2,$3) ON CONFLICT(id) DO NOTHING`, [RSI_REVERSAL_EXPERIMENT_ID, RSI_REVERSAL_POLICY.maxTotalBrokerAccepted, RSI_REVERSAL_POLICY.stakeBrl]).catch(() => undefined);
    await this.pool.query(`INSERT INTO iq_experiment_strategy_state(experiment_id, strategy_id, max_executions) VALUES($1,$2,$3) ON CONFLICT(experiment_id, strategy_id) DO NOTHING`, [RSI_REVERSAL_EXPERIMENT_ID, RSI_REVERSAL_STRATEGY_ID, RSI_REVERSAL_POLICY.maxTotalBrokerAccepted]).catch(() => undefined);
    const rows = await this.pool.query(`SELECT state FROM iq_execution_experiments WHERE id=$1`, [RSI_REVERSAL_EXPERIMENT_ID]).then((r) => r.rows).catch(() => []);
    if (rows[0]?.state) this.state = rows[0].state;
  }

  async #setState(next, { reason = null } = {}) {
    this.state = next;
    if (this.pool?.query) await this.pool.query(`UPDATE iq_execution_experiments SET state=$2, stopped_reason=COALESCE($3, stopped_reason), updated_at=now() WHERE id=$1`, [RSI_REVERSAL_EXPERIMENT_ID, next, reason]).catch(() => undefined);
    this.#audit(next === "ARMED_PRACTICE" ? "ARMED" : next === "COMPLETE" ? "EXPERIMENT_COMPLETE" : "EXPERIMENT_CREATED", { state: next, reason });
    return { state: next };
  }

  #audit(eventType, payload = {}) { this.memory.events.push({ at: this.now(), eventType, payload }); if (this.memory.events.length > 500) this.memory.events.splice(0, this.memory.events.length - 500); }

  async prepare({ preflight = null } = {}) {
    await this.#ensureExperimentRow();
    const checks = {
      practiceAccount: String(preflight?.accountContext ?? "").toUpperCase() === "PRACTICE",
      brokerConnected: preflight?.brokerConnected === true,
      realLocked: preflight?.realState === "LOCKED",
      killSwitchOff: preflight?.killSwitchEngaged !== true,
      stakeOk: Number(preflight?.stakeBrl ?? 1) > 0,
      capAvailable: (await this.executedCount()) < RSI_REVERSAL_POLICY.maxTotalBrokerAccepted,
    };
    const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([key]) => key);
    if (failed.length) return { ok: false, error: "PREFLIGHT_FAILED", failed };
    await this.#setState("READY_TO_ARM");
    return { ok: true, state: this.state, checks };
  }

  async arm({ phrase = "", actor = "owner", preflight = null } = {}) {
    await this.prepare({ preflight });
    if (phrase !== RSI_REVERSAL_ARM_PHRASE) return { ok: false, error: "ARM_PHRASE_INVALID" };
    const ok = String(preflight?.accountContext ?? "").toUpperCase() === "PRACTICE" && preflight?.realState === "LOCKED" && preflight?.brokerConnected === true && preflight?.killSwitchEngaged !== true;
    if (!ok) return { ok: false, error: "ARM_GUARDS_FAILED" };
    this.armPhraseHash = crypto.createHash("sha256").update(phrase).digest("hex");
    if (this.pool?.query) await this.pool.query(`UPDATE iq_execution_experiments SET state='ARMED_PRACTICE', arm_phrase_hash=$2, armed_by=$3, armed_at=now(), updated_at=now() WHERE id=$1`, [RSI_REVERSAL_EXPERIMENT_ID, this.armPhraseHash, String(actor).slice(0, 60)]).catch(() => undefined);
    await this.#setState("ARMED_PRACTICE");
    return { ok: true, state: this.state };
  }

  async stop(reason = "MANUAL_STOP") { await this.#setState("STOPPED", { reason }); return { ok: true, state: this.state, reason }; }

  async executedCount() {
    if (!this.pool?.query) return this.counters.brokerAccepted;
    return this.pool.query(`SELECT executed_count FROM iq_experiment_strategy_state WHERE experiment_id=$1 AND strategy_id=$2`, [RSI_REVERSAL_EXPERIMENT_ID, RSI_REVERSAL_STRATEGY_ID]).then((r) => Number(r.rows[0]?.executed_count ?? 0)).catch(() => this.counters.brokerAccepted);
  }

  async #reserveSlot() {
    if (!this.pool?.query) { if (this.counters.brokerAccepted >= RSI_REVERSAL_POLICY.maxTotalBrokerAccepted) return { ok: false }; this.counters.brokerAccepted += 0; return { ok: true, dry: true }; }
    const rows = await this.pool.query(
      `UPDATE iq_experiment_strategy_state SET reserved_count = reserved_count + 1, updated_at=now()
        WHERE experiment_id=$1 AND strategy_id=$2 AND executed_count + reserved_count < max_executions
        RETURNING executed_count, reserved_count`,
      [RSI_REVERSAL_EXPERIMENT_ID, RSI_REVERSAL_STRATEGY_ID],
    ).then((r) => r.rows).catch(() => []);
    return rows.length ? { ok: true, executed: rows[0].executed_count } : { ok: false };
  }

  async #releaseSlot({ accepted = false } = {}) {
    if (!this.pool?.query) { if (accepted) this.counters.brokerAccepted += 1; return; }
    await this.pool.query(`UPDATE iq_experiment_strategy_state SET reserved_count=GREATEST(0,reserved_count-1), executed_count=executed_count+$3, updated_at=now() WHERE experiment_id=$1 AND strategy_id=$2`, [RSI_REVERSAL_EXPERIMENT_ID, RSI_REVERSAL_STRATEGY_ID, accepted ? 1 : 0]).catch(() => undefined);
  }

  /** Chamado a cada atualizacao de candle por mercado (todos os mercados ativos; isolado por marketKey). */
  async observeMarket({ marketKey = null, marketType = null, activeId = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled || !marketKey) return null;
    const at = num(now) ?? this.now();
    const startedAt = this.now();
    try {
      const history = this.marketState.get(marketKey) ?? {};
      const evaluation = evaluateRsiReversal({ candles, now: at, history });
      const safeMargin = effectiveSafeMarginMs(latency);
      const window = targetExpiryAt ? entryWindow({ targetExpiryAt, safeMarginMs: safeMargin }) : null;
      const context = this.lastByMarket.get(marketKey) ?? {};
      const record = this.observations.get(`${marketKey}:${targetExpiryAt}`) ?? { id: `rsi5s:${marketKey}:${targetExpiryAt}`, marketKey, marketType, activeId, createdAt: at, targetExpiryAt: num(targetExpiryAt), evaluation: null, status: "OBSERVING", direction: null, outcome: null, settlementBasis: null, theoreticalResult: null, theoreticalPnl: null };
      record.evaluation = evaluation; record.safeMarginMs = safeMargin; record.window = window; record.updatedAt = at;
      if (evaluation.status === "REVERSAL_REJECTED_STRONG_TREND") { this.counters.rejectedStrongTrend += 1; record.status = "REVERSAL_REJECTED_STRONG_TREND"; this.marketState.set(marketKey, { lastExtremeAt: at, lastBandPosition: evaluation.bollinger?.position ?? null }); this.#store(record); return record; }
      if (!evaluation.direction) { record.status = "NO_OPPORTUNITY"; this.#store(record); return record; }
      this.counters.opportunities += 1;
      if (evaluation.direction === "BUY") this.counters.buyOpportunities += 1; else this.counters.sellOpportunities += 1;
      if (evaluation.bollingerConfirmed) this.counters.bollingerConfirmed += 1;
      if (evaluation.dmiConfirmed) this.counters.dmiConfirmed += 1;
      if (!evaluation.bothConfirmed) { record.status = "WAITING_CONFIRMATION"; this.#store(record); return record; }
      this.counters.bothConfirmed += 1;
      record.status = "CANDIDATE"; record.direction = evaluation.direction;
      if (!window) { this.#store(record); return record; }
      if (at < window.entryWindowOpensAt) { record.status = "OBSERVE_ONLY"; this.#store(record); return record; }
      if (at > window.entryWindowClosesAt) {
        const expired = at > window.purchaseCutoffAt;
        record.status = expired ? "MISSED_ENTRY_WINDOW" : "NO_SAFE_ENTRY_INSIDE_5S_WINDOW";
        if (expired) this.counters.missedWindow += 1; else this.counters.noSafeWindow += 1;
        this.#store(record); return record;
      }
      return await this.#finalizeAndMaybeExecute({ record, candles, at, payout, window, context });
    } catch (error) { this.counters.errors += 1; this.log("RSI_REVERSAL_OBSERVE_FAILED", String(error?.message ?? error).slice(0, 160)); return null; }
  }

  async #finalizeAndMaybeExecute({ record, candles, at, payout, window, context }) {
    const revalidation = evaluateRsiReversal({ candles, now: at, history: this.marketState.get(record.marketKey) ?? {} });
    record.revalidation = revalidation; record.revalidationAt = at; record.distanceToCutoffMs = window.purchaseCutoffAt - at;
    const stillValid = revalidation.status === "CANDIDATE" && revalidation.direction === record.direction;
    if (!stillValid) {
      record.status = "CANCELLED_REVALIDATION"; this.counters.cancelledRevalidation += 1;
      this.#store(record); void this.#persist(record); return record;
    }
    record.status = "REVERSAL_CONFIRMED";
    const idempotencyKey = `rsi5s:${record.marketKey}:${record.targetExpiryAt}:${record.direction}`;
    if (this.state !== "ARMED_PRACTICE" && this.state !== "RUNNING") { record.status = "WOULD_EXECUTE"; this.#store(record); void this.#persist(record); return record; }
    if (this.memory.executions.has(idempotencyKey)) { record.status = "DUPLICATE_BLOCKED"; this.#store(record); return record; }
    const reservation = await this.#reserveSlot();
    if (!reservation.ok) { record.status = "CAP_REACHED"; this.#store(record); return record; }
    try {
      const order = await this.runtime.experimentRequestOrder({ marketKey: record.marketKey, direction: record.direction, stake: RSI_REVERSAL_POLICY.stakeBrl, decisionId: record.id, idempotencyKey, strategyId: RSI_REVERSAL_STRATEGY_ID, experimentId: RSI_REVERSAL_EXPERIMENT_ID });
      const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
      await this.#releaseSlot({ accepted });
      record.status = accepted ? "BROKER_ACCEPTED" : "BROKER_REJECTED"; record.brokerOrderId = order?.brokerOrderId ?? null; record.executionId = order?.executionId ?? null; record.submitAt = this.now();
      this.memory.executions.set(idempotencyKey, record);
      this.latency.submit.record(record.submitAt - at);
      if (accepted) this.counters.brokerAccepted += 1;
      if (accepted && (await this.executedCount()) >= RSI_REVERSAL_POLICY.maxTotalBrokerAccepted) await this.#setState("COMPLETE", { reason: "CAP_30_REACHED" });
      if (this.pool?.query) await this.pool.query(`INSERT INTO iq_experiment_executions(experiment_id, strategy_id, opportunity_id, decision_id, execution_id, idempotency_key, market_key, market_type, direction, payout, stake_brl, status, broker_order_id, decision_snapshot, timestamps, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,now()) ON CONFLICT(experiment_id, idempotency_key) DO NOTHING`, [RSI_REVERSAL_EXPERIMENT_ID, RSI_REVERSAL_STRATEGY_ID, record.id, record.id, record.executionId, idempotencyKey, record.marketKey, record.marketType, record.direction, num(payout), RSI_REVERSAL_POLICY.stakeBrl, record.status, record.brokerOrderId, JSON.stringify(record.evaluation), JSON.stringify({ at, distanceToCutoffMs: record.distanceToCutoffMs })]).catch(() => undefined);
      this.#store(record); void this.#persist(record);
      return record;
    } catch (error) {
      await this.#releaseSlot({ accepted: false });
      record.status = "BROKER_REJECTED"; record.error = String(error?.message ?? error).slice(0, 160);
      this.counters.errors += 1; this.#store(record); void this.#persist(record);
      return record;
    }
  }

  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0) return 0;
    const observedUntil = num(candles[index]?.bucketStart); if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now(); let settled = 0;
    for (const record of this.observations.values()) {
      if (record.marketKey !== marketKey || record.settlementBasis != null) continue;
      if (record.direction !== "BUY" && record.direction !== "SELL") continue;
      const expiry = num(record.targetExpiryAt); if (expiry === null || observedUntil < expiry) continue;
      if (!["BROKER_ACCEPTED", "REVERSAL_CONFIRMED", "WOULD_EXECUTE"].includes(record.status)) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: record.window?.purchaseCutoffAt ?? expiry, targetExpiryAt: expiry });
      const result = settleDirectionalOutcome({ direction: record.direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice });
      if (!result) continue;
      record.outcome = { result, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice, settlementBasis: "CAUSAL_COUNTERFACTUAL", at: atMs, feedableToClassification: false };
      record.theoreticalResult = result; record.theoreticalPnl = normalizedOutcomePnl({ result, payout: record.payout });
      record.settlementBasis = "CAUSAL_COUNTERFACTUAL"; record.status = "SETTLED";
      this.#bumpResultBuckets(record, result);
      settled += 1;
    }
    return settled;
  }

  #bumpResultBuckets(record, result) {
    this.counters.settled += 1;
    if (result === "WIN") this.settled.wins += 1; else if (result === "LOSS") this.settled.losses += 1; else this.settled.draws += 1;
    this.settled.total += 1;
    const bump = (bucket, key) => { bucket[key] = bucket[key] ?? { total: 0, wins: 0, losses: 0, draws: 0 }; bucket[key].total += 1; if (result === "WIN") bucket[key].wins += 1; else if (result === "LOSS") bucket[key].losses += 1; else bucket[key].draws += 1; };
    bump(this.settled.byMarket, record.marketKey); bump(this.settled.byType, record.marketType ?? "UNKNOWN");
    bump(this.settled.byRsiBand, `${record.direction}:${record.evaluation?.rsiBand ?? "NA"}`); bump(this.settled.byDirection, record.direction);
  }

  #store(record) {
    if (!this.observations.has(record.id)) this.order.push(record.id);
    this.observations.set(record.id, record);
    if (this.order.length > 2000) { for (const id of this.order.splice(0, this.order.length - 2000)) this.observations.delete(id); }
  }

  async #persist(record) {
    if (!this.pool?.query) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_reversal_observations(id, market_key, market_type, active_id, status, direction, rsi, rsi_band, bollinger_confirmed, dmi_adx_confirmed, rejected_strong_trend, target_expiry_at, purchase_cutoff_at, entry_window_opens_at, safe_margin_ms, revalidation_at, submit_at, distance_to_cutoff_ms, payload, outcome, settlement_basis, theoretical_result, theoretical_pnl, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23, now())
       ON CONFLICT(id) DO UPDATE SET status=$5, direction=$6, bollinger_confirmed=$9, dmi_adx_confirmed=$10, rejected_strong_trend=$11, revalidation_at=$16, submit_at=$17, distance_to_cutoff_ms=$18, payload=$19::jsonb, outcome=$20::jsonb, settlement_basis=$21, theoretical_result=$22, theoretical_pnl=$23, updated_at=now()`,
      [record.id, record.marketKey, record.marketType, record.activeId, record.status, record.direction, record.evaluation?.rsi ?? null, record.evaluation?.rsiBand ?? null, record.evaluation?.bollingerConfirmed ?? false, record.evaluation?.dmiConfirmed ?? false, record.evaluation?.rejectedStrongTrend ?? false, record.targetExpiryAt, record.window?.purchaseCutoffAt ?? null, record.window?.entryWindowOpensAt ?? null, record.safeMarginMs ?? null, record.revalidationAt ?? null, record.submitAt ?? null, record.distanceToCutoffMs ?? null, JSON.stringify({ evaluation: record.evaluation, revalidation: record.revalidation, window: record.window, events: this.memory.events.slice(-20) }), JSON.stringify(record.outcome ?? null), record.settlementBasis, record.theoreticalResult, record.theoreticalPnl],
    ).catch(() => undefined);
  }

  async status() {
    await this.#ensureExperimentRow();
    const executed = await this.executedCount();
    const wr = this.settled.wins + this.settled.losses ? Number((this.settled.wins / (this.settled.wins + this.settled.losses)).toFixed(4)) : null;
    return {
      version: RSI_REVERSAL_VERSION, experimentId: RSI_REVERSAL_EXPERIMENT_ID, state: this.state,
      practiceOnly: true, realTouched: false, stakeBrl: RSI_REVERSAL_POLICY.stakeBrl,
      cap: { maxTotalBrokerAccepted: RSI_REVERSAL_POLICY.maxTotalBrokerAccepted, executed, remaining: Math.max(0, RSI_REVERSAL_POLICY.maxTotalBrokerAccepted - executed), nextCheckpoint: [30].find((level) => level > this.settled.total) ?? null },
      counters: { ...this.counters, brokerAccepted: executed }, settlement: { ...this.settled, decided: this.settled.wins + this.settled.losses, wr, basis: "CAUSAL_COUNTERFACTUAL" },
      latencyMs: { evaluation: this.latency.evaluation.summary(), submit: this.latency.submit.summary() },
      events: this.memory.events.slice(-25),
      recent: this.order.slice(-20).map((id) => this.observations.get(id)).filter(Boolean).map((record) => ({ id: record.id, marketKey: record.marketKey, status: record.status, direction: record.direction, rsi: record.evaluation?.rsi ?? null, band: record.evaluation?.rsiBand ?? null, distanceToCutoffMs: record.distanceToCutoffMs ?? null, result: record.theoreticalResult })),
      policy: RSI_REVERSAL_POLICY, controlsExecution: false, note: "Experimento separado; nao interfere no FIVE_WAY. Ordem apenas via harness/Execution Gate (PRACTICE).",
    };
  }

  async report() {
    const status = await this.status();
    return { ...status, microSample: true, significant: false, note: "N30 e amostra pequena; sem claim de edge." };
  }
}

export function rsiReversalFreezeManifest() {
  return { schema: "rsi-reversal-freeze-v1", version: RSI_REVERSAL_VERSION, frozenAtUtc: new Date().toISOString(), policy: RSI_REVERSAL_POLICY, noTuning: true, rules: { detector: "RSI<=30 BUY / RSI>=70 SELL", confirmations: "Bollinger AND DMI/ADX (both required)", strongTrend: "bloqueia reversao contra tendencia forte/band riding", timing: "ordem somente em [cutoff-5000, cutoff-safeMargin]", safeMargin: "max(3000ms, medido); se >5s cancela NO_SAFE_ENTRY_INSIDE_5S_WINDOW", revalidation: "T-5s com dados mais recentes; sem auto-inversao", sameExpiry: true, cap: 30 } };
}

