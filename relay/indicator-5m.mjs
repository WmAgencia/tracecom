/**
 * INDICATOR_5M_V1 — CONTROL GROUP de baixa complexidade (SHADOW/experimento): RSI14 + DMI/ADX + Bollinger(20,2)
 * sobre no minimo 5 minutos completos (60 candles 5s fechados). Confluencia dos tres gera BUY/SELL; senao WAIT.
 * Entrada tardia: alvo = purchaseCutoff - margin, com margin = max(3000ms, margem segura medida).
 * Sem auto-inversao; mesma expiracao obrigatoria; nunca executa por conta propria (so via harness/Execution Gate).
 */
import { rsiWilder, adxWilder, atrWilder } from "./feature-engine.mjs";
import { settleDirectionalOutcome, causalPricesFromCandles } from "./scenario-shadow-settlement.mjs";
import { normalizedOutcomePnl } from "./shadow-lab.mjs";
import { RollingWindow } from "./datahub/metrics.mjs";

export const INDICATOR_5M_VERSION = "INDICATOR_5M_V1";
export const INDICATOR_5M_POLICY = Object.freeze({
  version: INDICATOR_5M_VERSION, mode: "SHADOW_ONLY", controlsExecution: false, sendsOrders: false,
  minClosedCandles5s: 60, minContextMinutes: 5, bollingerPeriod: 20, bollingerStdDev: 2, rsiPeriod: 14,
  adxPeriod: 14, minimumRequestedSafetyMarginMs: 3000, autoInvert: false, sameExpiryRequired: true,
  turbCutoffMs: 30_000, settlementBasis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW",
});
const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));

/* ---------------------------- indicadores ---------------------------- */
function bollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const deviation = Math.sqrt(window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period);
  const upper = middle + multiplier * deviation, lower = middle - multiplier * deviation;
  const width = upper - lower;
  const close = closes[closes.length - 1];
  return { upper, middle, lower, width, position: width > 0 ? (close - lower) / width : 0.5, distanceToUpper: upper - close, distanceToLower: close - lower, compression: deviation !== null && middle > 0 ? width / middle < 0.004 : false };
}

function diCrossHistory(candles, period = 14) {
  const crosses = [];
  let previous = null;
  for (let index = period * 2 + 1; index <= candles.length; index += 1) {
    const adx = adxWilder(candles.slice(0, index), period);
    if (!adx) continue;
    const state = adx.plusDI > adx.minusDI ? "BULL" : adx.minusDI > adx.plusDI ? "BEAR" : "FLAT";
    if (previous && state !== previous && state !== "FLAT") crosses.push({ at: candles[index - 1].bucketStart ?? candles[index - 1].start ?? null, direction: state });
    previous = state;
  }
  return crosses.slice(-4);
}

export function analyzeIndicators({ candles, now = Date.now() } = {}) {
  const closed = (Array.isArray(candles) ? candles : []).filter((candle) => num(candle?.bucketEnd) !== null && Number(candle.bucketEnd) <= Number(now) && Number.isFinite(Number(candle.close)));
  if (closed.length < INDICATOR_5M_POLICY.minClosedCandles5s) return { available: false, reason: "INSUFFICIENT_HISTORY", closedCandles: closed.length };
  const closes = closed.map((candle) => Number(candle.close));
  const rsiSeries = [];
  for (let index = INDICATOR_5M_POLICY.rsiPeriod + 1; index <= closes.length; index += 1) rsiSeries.push(rsiWilder(closes.slice(0, index), 14));
  const rsi = rsiSeries[rsiSeries.length - 1] ?? null;
  const rsiSlope = rsiSeries.length >= 4 ? Number(((rsiSeries[rsiSeries.length - 1] - rsiSeries[rsiSeries.length - 4]) / 3).toFixed(4)) : null;
  const adx = adxWilder(closed, 14);
  const adxSeries = [];
  for (let index = Math.max(30, closed.length - 12); index <= closed.length; index += 1) { const value = adxWilder(closed.slice(0, index), 14); if (value) adxSeries.push(value.adx); }
  const adxSlope = adxSeries.length >= 4 ? Number(((adxSeries[adxSeries.length - 1] - adxSeries[adxSeries.length - 4]) / 3).toFixed(4)) : null;
  const bands = bollinger(closes);
  const previousBands = bollinger(closes.slice(0, -1));
  const bandWidthTrajectory = bands && previousBands && previousBands.width > 0 ? Number(((bands.width - previousBands.width) / previousBands.width).toFixed(4)) : null;
  const cross = diCrossHistory(closed);
  const lastCross = cross[cross.length - 1] ?? null;
  const atr = atrWilder(closed, 14);
  return {
    available: true, closedCandles: closed.length, minutesAvailable: Number((closed.length * 5 / 60).toFixed(2)),
    rsi: { value: rsi, slope: rsiSlope, state: rsi === null ? "NEUTRAL" : rsi <= 30 ? "OVERSOLD" : rsi < 45 ? "LOW" : rsi <= 55 ? "NEUTRAL" : rsi < 70 ? "HIGH" : "OVERBOUGHT" },
    dmi: adx ? { plusDI: Number(adx.plusDI.toFixed(4)), minusDI: Number(adx.minusDI.toFixed(4)), spread: Number((adx.plusDI - adx.minusDI).toFixed(4)), direction: adx.plusDI > adx.minusDI ? "BULLISH" : adx.minusDI > adx.plusDI ? "BEARISH" : "NEUTRAL", lastCross, lastCrossAgeMs: lastCross?.at ? Math.max(0, Number(now) - Number(lastCross.at)) : null } : null,
    adx: adx ? { value: Number(adx.adx.toFixed(4)), slope: adxSlope, strength: adx.adx >= 40 ? "VERY_STRONG" : adx.adx >= 25 ? "STRONG" : adx.adx >= 18 ? "DEVELOPING" : "WEAK" } : null,
    bollinger: bands ? { upper: Number(bands.upper.toFixed(8)), middle: Number(bands.middle.toFixed(8)), lower: Number(bands.lower.toFixed(8)), width: Number(bands.width.toFixed(8)), widthTrajectory: bandWidthTrajectory, position: Number(bands.position.toFixed(4)), distanceToUpper: Number(bands.distanceToUpper.toFixed(8)), distanceToLower: Number(bands.distanceToLower.toFixed(8)) } : null,
    atr,
    price: closes[closes.length - 1],
    bollingerState: (() => { if (!bands) return "MID"; if (bands.position >= 1) return "BREAK_UP"; if (bands.position <= 0) return "BREAK_DOWN"; if (bands.compression) return "COMPRESSION"; if (bandWidthTrajectory !== null && bandWidthTrajectory > 0.1) return "EXPANSION"; if (bands.position >= 0.85) return "UPPER_EDGE"; if (bands.position <= 0.15) return "LOWER_EDGE"; return "MID"; })(),
  };
}

/* ---------------------------- decisao por confluencia ---------------------------- */
export function decideIndicator5M({ snapshot } = {}) {
  if (!snapshot?.available) return { action: "WAIT", direction: null, confluence: "NONE", reason: snapshot?.reason ?? "INSUFFICIENT_HISTORY", bullishEvidence: [], bearishEvidence: [], riskFlags: ["INSUFFICIENT_HISTORY"], indicatorAgreementCount: 0, invalidation: [] };
  const { rsi, dmi, adx, bollinger, bollingerState } = snapshot;
  const strongTrend = adx && adx.strength !== "WEAK" && dmi && Math.abs(dmi.spread) >= 15 && ["UPPER_EDGE", "BREAK_UP", "LOWER_EDGE", "BREAK_DOWN"].includes(bollingerState);
  const bullish = [], bearish = [], risks = [];
  let agreement = 0, bull = 0, bear = 0;
  if (rsi.state === "OVERSOLD" || (rsi.state === "LOW" && (rsi.slope ?? 0) > 0)) { bull += 1; bullish.push(`rsi:${rsi.state}${rsi.slope > 0 ? "_recuperando" : ""}`); }
  if (rsi.state === "OVERBOUGHT" || (rsi.state === "HIGH" && (rsi.slope ?? 0) < 0)) { bear += 1; bearish.push(`rsi:${rsi.state}${rsi.slope < 0 ? "_perdendo_forca" : ""}`); }
  if (dmi?.direction === "BULLISH") { bull += 1; bullish.push(`+DI>-DI spread=${dmi.spread}`); }
  if (dmi?.direction === "BEARISH") { bear += 1; bearish.push(`-DI>+DI spread=${dmi.spread}`); }
  if (bollingerState === "LOWER_EDGE" || bollingerState === "BREAK_DOWN") { bull += 1; bullish.push(`bollinger:${bollingerState}`); }
  if (bollingerState === "UPPER_EDGE" || bollingerState === "BREAK_UP") { bear += 1; bearish.push(`bollinger:${bollingerState}`); }
  if (strongTrend) {
    const trendUp = dmi.direction === "BULLISH";
    risks.push(`STRONG_${trendUp ? "BULLISH" : "BEARISH"}_TREND`);
    if (trendUp) { bear = 0; bullish.push("trend_forte_impede_reversao"); } else { bull = 0; bearish.push("trend_forte_impede_reversao"); }
  }
  const conflict = bull > 0 && bear > 0;
  const confluence = conflict ? "CONFLICTED" : bull >= 2 && bear === 0 ? "BULLISH" : bear >= 2 && bull === 0 ? "BEARISH" : "NONE";
  const action = confluence === "BULLISH" ? "BUY" : confluence === "BEARISH" ? "SELL" : "WAIT";
  agreement = action === "BUY" ? bull : action === "SELL" ? bear : 0;
  return {
    action, direction: action === "BUY" ? "BULLISH" : action === "SELL" ? "BEARISH" : null, confluence,
    reason: action === "WAIT" ? (conflict ? "INDICATORS_CONFLICTED" : "NO_CONFLUENCE") : "CONFLUENCE_3_INDICATORS",
    states: { rsiState: rsi.state, dmiDirection: dmi?.direction ?? "NEUTRAL", adxStrength: adx?.strength ?? "WEAK", bollingerState },
    bullishEvidence: bullish.slice(0, 6), bearishEvidence: bearish.slice(0, 6), riskFlags: risks,
    indicatorAgreementCount: agreement,
    whyNow: action === "WAIT" ? null : `confluencia ${confluence}: ${(action === "BUY" ? bullish : bearish).join("; ")}`,
    invalidation: action === "BUY" ? ["rsi_perde_recuperacao", "-DI_retoma_dominancia", "perda_da_banda_inferior"] : action === "SELL" ? ["rsi_perde_queda", "+DI_retoma_dominancia", "perda_da_banda_superior"] : [],
  };
}

/* ---------------------------- margem e timing ---------------------------- */
export function effectiveSafetyMarginMs({ ackP95Ms = 0, persistP95Ms = 0, decisionMs = 0, jitterMs = 300, bufferMs = 150 } = {}) {
  const measured = Number(ackP95Ms || 0) + Number(persistP95Ms || 0) + Number(decisionMs || 0) + Number(jitterMs || 0) + Number(bufferMs || 0);
  return Math.max(INDICATOR_5M_POLICY.minimumRequestedSafetyMarginMs, Math.round(measured));
}

export function planLateEntry({ targetExpiryAt, latency = {} } = {}) {
  const expiry = num(targetExpiryAt);
  if (expiry === null) return null;
  const cutoffAt = expiry - INDICATOR_5M_POLICY.turbCutoffMs;
  const marginMs = effectiveSafetyMarginMs(latency);
  return { purchaseCutoffAt: cutoffAt, effectiveSafetyMarginMs: marginMs, targetSubmitAt: cutoffAt - marginMs, requestedMarginMs: INDICATOR_5M_POLICY.minimumRequestedSafetyMarginMs };
}

/* ---------------------------- engine ---------------------------- */
export class Indicator5MEngine {
  constructor({ pool = null, now = () => Date.now(), log = () => {}, enabled = true, maxObservationsPerMarket = 200, maxObservations = 1000 } = {}) {
    this.pool = pool; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true; this.maxObservationsPerMarket = maxObservationsPerMarket; this.maxObservations = maxObservations;
    this.observations = new Map(); this.order = [];
    this.latency = { analysis: new RollingWindow({ maxSamples: 512 }), revalidation: new RollingWindow({ maxSamples: 512 }), total: new RollingWindow({ maxSamples: 512 }) };
    this.counters = { observations: 0, candidates: 0, waits: 0, cancelledByRevalidation: 0, missedExpiry: 0, settled: 0, errors: 0 };
    this.settled = { total: 0, wins: 0, losses: 0, draws: 0 };
  }
  setEnabled(enabled) { this.enabled = enabled === true; return { enabled: this.enabled }; }
  list() { return this.order.map((id) => this.observations.get(id)).filter(Boolean); }

  /** Analise inicial: produz candidate com confluencia; WAIT nao gera candidate. */
  observeCandidate({ marketKey = null, marketType = null, candles = [], targetEntryAt = null, targetExpiryAt = null, payout = null, latency = {} } = {}) {
    if (!this.enabled || !marketKey) return null;
    const startedAt = this.now();
    try {
      const snapshot = analyzeIndicators({ candles, now: this.now() });
      const decision = decideIndicator5M({ snapshot });
      const plan = decision.action !== "WAIT" ? planLateEntry({ targetExpiryAt, latency }) : null;
      const id = `ind5m:${marketKey}:${targetExpiryAt ?? startedAt}`;
      const observation = { id, marketKey, marketType, createdAt: startedAt, targetEntryAt: num(targetEntryAt), targetExpiryAt: num(targetExpiryAt), payout: num(payout), snapshot, initialDecision: decision, plan, finalDecision: null, finalSnapshot: null, timing: null, outcome: null, settlementBasis: null, theoreticalResult: null, theoreticalPnl: null, status: decision.action === "WAIT" ? "WAIT" : "CANDIDATE" };
      this.#store(observation);
      this.counters.observations += 1;
      if (decision.action === "WAIT") this.counters.waits += 1; else this.counters.candidates += 1;
      this.latency.analysis.record(this.now() - startedAt);
      void this.#persist(observation);
      return observation;
    } catch (error) { this.counters.errors += 1; this.log("IND5M_ANALYZE_FAILED", String(error?.message ?? error).slice(0, 160)); return null; }
  }

  /** Revalidacao no limite: cancelar se confluencia sumiu; nunca inverte; mesma expiracao obrigatoria. */
  revalidateFinal({ observationId = null, candles = [], atMs = null } = {}) {
    const observation = observationId ? this.observations.get(observationId) : null;
    if (!this.enabled || !observation || observation.status !== "CANDIDATE") return null;
    const startedAt = this.now();
    try {
      const now = num(atMs) ?? startedAt;
      const plan = observation.plan;
      if (plan && now > plan.purchaseCutoffAt) {
        observation.status = "MISSED_SAME_EXPIRY_WINDOW"; observation.finalDecision = { action: "WAIT", reason: "MISSED_SAME_EXPIRY_WINDOW" };
        this.counters.missedExpiry += 1; void this.#persist(observation); return observation;
      }
      const finalSnapshot = analyzeIndicators({ candles, now });
      const finalDecision = decideIndicator5M({ snapshot: finalSnapshot });
      observation.finalSnapshot = finalSnapshot; observation.finalDecision = finalDecision;
      observation.timing = { candidateAt: observation.createdAt, revalidationAt: now, purchaseCutoffAt: plan?.purchaseCutoffAt ?? null, targetSubmitAt: plan?.targetSubmitAt ?? null, distanceToCutoffMs: plan ? plan.purchaseCutoffAt - now : null, effectiveSafetyMarginMs: plan?.effectiveSafetyMarginMs ?? null };
      if (finalDecision.action !== observation.initialDecision.action) {
        observation.status = "CANCELLED_REVALIDATION"; this.counters.cancelledByRevalidation += 1;
      } else {
        observation.status = "READY"; observation.direction = finalDecision.action;
      }
      this.latency.revalidation.record(this.now() - startedAt);
      this.latency.total.record(this.now() - startedAt);
      void this.#persist(observation);
      return observation;
    } catch (error) { this.counters.errors += 1; this.log("IND5M_REVALIDATE_FAILED", String(error?.message ?? error).slice(0, 160)); return observation; }
  }

  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0) return 0;
    const observedUntil = num(candles[index]?.bucketStart); if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now(); let settled = 0;
    for (const observation of this.list()) {
      if (observation.marketKey !== marketKey || observation.settlementBasis != null || observation.status === "SETTLED") continue;
      if (observation.direction !== "BUY" && observation.direction !== "SELL") continue;
      const targetExpiryAt = num(observation.targetExpiryAt);
      if (targetExpiryAt === null || observedUntil < targetExpiryAt) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: observation.targetEntryAt, targetExpiryAt });
      const result = settleDirectionalOutcome({ direction: observation.direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice });
      if (!result) continue;
      observation.outcome = { result, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice, settlementBasis: "CAUSAL_COUNTERFACTUAL", provenance: "PROSPECTIVE_SHADOW", at: atMs, feedableToClassification: false };
      observation.theoreticalResult = result; observation.theoreticalPnl = normalizedOutcomePnl({ result, payout: observation.payout });
      observation.settlementBasis = "CAUSAL_COUNTERFACTUAL"; observation.status = "SETTLED";
      this.settled.total += 1;
      if (result === "WIN") this.settled.wins += 1; else if (result === "LOSS") this.settled.losses += 1; else this.settled.draws += 1;
      this.counters.settled += 1; void this.#persist(observation); settled += 1;
    }
    return settled;
  }

  status() {
    const observations = this.list();
    const distribution = { rsiState: {}, dmiDirection: {}, adxStrength: {}, bollingerState: {}, confluence: {}, action: {} };
    for (const observation of observations) {
      const states = observation.initialDecision?.states ?? {};
      for (const [key, pick] of [["rsiState", states.rsiState], ["dmiDirection", states.dmiDirection], ["adxStrength", states.adxStrength], ["bollingerState", states.bollingerState], ["confluence", observation.initialDecision?.confluence], ["action", observation.initialDecision?.action]]) {
        if (pick === undefined || pick === null) continue;
        distribution[key][pick] = (distribution[key][pick] ?? 0) + 1;
      }
    }
    const settled = observations.filter((observation) => DECIDED.has(observation.theoreticalResult));
    return {
      version: INDICATOR_5M_VERSION, mode: "SHADOW_ONLY", enabled: this.enabled, policy: INDICATOR_5M_POLICY,
      counters: { ...this.counters, nextCheckpoint: [3, 30, 60, 100, 200, 500].find((level) => level > settled.length) ?? null },
      distribution,
      settlement: { ...this.settled, decided: this.settled.wins + this.settled.losses, wr: this.settled.wins + this.settled.losses ? Number((this.settled.wins / (this.settled.wins + this.settled.losses)).toFixed(4)) : null },
      latencyMs: Object.fromEntries(Object.entries(this.latency).map(([key, window]) => [key, window.summary()])),
      recent: observations.slice(-20).map((observation) => ({ id: observation.id, marketKey: observation.marketKey, initial: observation.initialDecision?.action, final: observation.finalDecision?.action ?? null, status: observation.status, confluence: observation.initialDecision?.confluence, targetSubmitAt: observation.plan?.targetSubmitAt ?? null, result: observation.theoreticalResult })),
      researchOnly: true, controlsExecution: false, sendsOrders: false,
    };
  }

  #store(observation) {
    if (!this.observations.has(observation.id)) this.order.push(observation.id);
    this.observations.set(observation.id, observation);
    if (this.order.length > this.maxObservations) { for (const id of this.order.splice(0, this.order.length - this.maxObservations)) this.observations.delete(id); }
    const marketIds = this.order.filter((id) => this.observations.get(id)?.marketKey === observation.marketKey);
    if (marketIds.length > this.maxObservationsPerMarket) { for (const id of marketIds.slice(0, marketIds.length - this.maxObservationsPerMarket)) { this.observations.delete(id); const index = this.order.indexOf(id); if (index >= 0) this.order.splice(index, 1); } }
  }

  async #persist(observation) {
    if (!this.pool?.query) return;
    try {
      const payload = { version: INDICATOR_5M_VERSION, initialDecision: observation.initialDecision, finalDecision: observation.finalDecision, snapshot: observation.snapshot, finalSnapshot: observation.finalSnapshot, plan: observation.plan, timing: observation.timing, outcome: observation.outcome, policy: INDICATOR_5M_POLICY };
      await this.pool.query(
        `INSERT INTO iq_indicator_5m_observations(id, market_key, market_type, direction, final_action, status, target_entry_at, target_expiry_at, payout, payload, outcome, settlement_basis, theoretical_result, theoretical_pnl, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14, now(), now())
         ON CONFLICT(id) DO UPDATE SET final_action=$5, status=$6, payload=$10::jsonb, outcome=$11::jsonb, settlement_basis=$12, theoretical_result=$13, theoretical_pnl=$14, updated_at=now()`,
        [observation.id, observation.marketKey, observation.marketType, observation.direction ?? null, observation.finalDecision?.action ?? observation.initialDecision?.action ?? null, observation.status, observation.targetEntryAt, observation.targetExpiryAt, observation.payout, JSON.stringify(payload), JSON.stringify(observation.outcome ?? null), observation.settlementBasis, observation.theoreticalResult, observation.theoreticalPnl],
      );
    } catch (error) { this.log("IND5M_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160)); }
  }
}

export function indicator5mFreezeManifest() {
  return { schema: "indicator-5m-freeze-v1", version: INDICATOR_5M_VERSION, frozenAtUtc: new Date().toISOString(), policy: INDICATOR_5M_POLICY, noTuning: true, rules: { confluence: ">=2 dos 3 indicadores na mesma direcao sem conflito", strongTrend: "trend forte impede reversao por RSI extremo", autoInvert: false, sameExpiryRequired: true, effectiveMargin: "max(3000ms, margem segura medida)" } };
}
