/**
 * RSI_STRICT_PULLBACK_2X2_V1 — comparativo DIRETO entre:
 *   RSI_REVERSAL_STRICT_V1   (exige DMI/ADX confirmando enfraquecimento/virada)
 *   RSI_EXTREME_PULLBACK_V1  (aceita pullback curto contra tendencia estrutural; bloqueia band riding/aceleracao forte)
 *
 * Mesmo detector (RSI extremo + Bollinger 20/2 via rsi-reversal.mjs), mesma janela tardia [T-5s, T-safe],
 * mesma expiracao, PRACTICE-only, stake R$1, cap 2 por variante — contadores AUTORITATIVOS no banco
 * (sobrevivem a restart; nada de estado em memoria governando cap).
 * Nunca altera FIVE_WAY nem RSI_REVERSAL_CONFLUENCE_V1.
 */
import { evaluateRsiReversal, effectiveSafeMarginMs, entryWindow } from "./rsi-reversal.mjs";
import { settleDirectionalOutcome, causalPricesFromCandles } from "./scenario-shadow-settlement.mjs";
import { normalizedOutcomePnl } from "./shadow-lab.mjs";

export const RSI_VARIANTS_VERSION = "RSI_STRICT_PULLBACK_2X2_V1";
export const RSI_VARIANTS_EXPERIMENT_ID = "RSI_STRICT_PULLBACK_2X2_V1";
export const STRICT_ID = "RSI_REVERSAL_STRICT_V1";
export const PULLBACK_ID = "RSI_EXTREME_PULLBACK_V1";
export const RSI_VARIANTS = Object.freeze([STRICT_ID, PULLBACK_ID]);
export const RSI_VARIANTS_ARM_PHRASE = "CONTA PRACTICE \u2192 ARMAR RSI STRICT PULLBACK 2X2";
export const RSI_VARIANTS_POLICY = Object.freeze({
  version: RSI_VARIANTS_VERSION, practiceOnly: true, stakeBrl: 1, maxPerVariant: 2, maxTotal: 4,
  otcUniverseSize: 10, finalWindowMs: 5000, minimumSafeMarginMs: 3000, turbCutoffMs: 30_000,
  autoInvert: false, sameExpiryRequired: true, countersAuthority: "POSTGRES (reconstruido a cada status)",
});
const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const DECIDED = new Set(["WIN", "LOSS", "DRAW"]);

/** STRICT exige confirmacao DMI/ADX completa; PULLBACK aceita pullback mas bloqueia band riding/aceleracao. */
export function evaluateVariant({ variant, candles, now = Date.now() } = {}) {
  const base = evaluateRsiReversal({ candles, now });
  const strongAccel = (() => {
    if (!base?.dmi || !base?.adx) return false;
    const expanding = base.bollinger?.expanding === true;
    if (base.direction === "BUY") return Boolean(expanding && base.dmi.minusDI > base.dmi.plusDI && base.dmi.minusSlope !== null && base.dmi.minusSlope > 0 && (base.adx.slope === null || base.adx.slope >= 0));
    if (base.direction === "SELL") return Boolean(expanding && base.dmi.plusDI > base.dmi.minusDI && base.dmi.plusSlope !== null && base.dmi.plusSlope > 0 && (base.adx.slope === null || base.adx.slope >= 0));
    return false;
  })();
  const bandRiding = base.bandRiding === true;
  if (!base.direction) return { ...base, variant, accepted: false, strongAccel, reason: base.status };
  if (variant === STRICT_ID) {
    const accepted = base.bollingerConfirmed === true && base.dmiConfirmed === true && !base.rejectedStrongTrend && !strongAccel;
    return { ...base, variant, accepted, strongAccel, rejectedStrongTrend: base.rejectedStrongTrend || strongAccel, status: accepted ? "CANDIDATE" : (!accepted && (base.rejectedStrongTrend || strongAccel) ? "REVERSAL_REJECTED_STRONG_TREND" : "WAITING_CONFIRMATION") };
  }
  const accepted = base.bollingerConfirmed === true && !bandRiding && !strongAccel;
  return { ...base, variant, accepted, strongAccel, status: accepted ? "CANDIDATE" : bandRiding || strongAccel ? "REVERSAL_REJECTED_STRONG_TREND" : "WAITING_CONFIRMATION" };
}

function compactIndicators(evaluation) {
  if (!evaluation) return null;
  return {
    rsi: evaluation.rsi ?? null, rsiBand: evaluation.rsiBand ?? null, rsiTrajectory: evaluation.rsiTrajectory ?? null,
    plusDI: evaluation.dmi?.plusDI ?? null, minusDI: evaluation.dmi?.minusDI ?? null, spread: evaluation.dmi?.spread ?? null,
    adx: evaluation.adx?.value ?? null, adxSlope: evaluation.adx?.slope ?? null,
    bollinger: evaluation.bollinger ? { upper: evaluation.bollinger.upper, middle: evaluation.bollinger.middle, lower: evaluation.bollinger.lower, position: evaluation.bollinger.position } : null,
    bollingerConfirmed: evaluation.bollingerConfirmed ?? false, bandRiding: evaluation.bandRiding ?? false,
  };
}

export class RsiVariantsRunner {
  constructor({ pool = null, runtime = null, now = () => Date.now(), log = () => {}, enabled = true } = {}) {
    this.pool = pool; this.runtime = runtime; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.state = "DRY_RUN";
    this.observations = new Map(); this.order = [];
    this.marketState = new Map();
    this.counters = { evaluations: {}, opportunities: {}, accepted: {}, brokerAccepted: {}, settled: {}, waits: {}, rejectedStrongTrend: {}, cancelled: {}, missed: {} };
    for (const variant of RSI_VARIANTS) { for (const key of Object.keys(this.counters)) this.counters[key][variant] = 0; }
    this.settled = { [STRICT_ID]: { wins: 0, losses: 0, draws: 0, pnl: 0 }, [PULLBACK_ID]: { wins: 0, losses: 0, draws: 0, pnl: 0 } };
    this.rejections = [];
    this.lastByMarket = new Map();
    this.otcKeys = null;
  }

  /** Universo: ate 10 OTC ativos descobertos dinamicamente (enabled+OPEN), sem hardcode. */
  selectOtcUniverse(markets = []) {
    if (this.otcKeys && this.otcKeys.length) return this.otcKeys;
    this.otcKeys = markets.filter((market) => market.marketType === "OTC" && market.enabled === true && market.availability === "OPEN").slice(0, RSI_VARIANTS_POLICY.otcUniverseSize).map((market) => market.marketKey);
    return this.otcKeys;
  }

  async #ensureRows() {
    if (!this.pool?.query) { this.state = this.state === "DRY_RUN" ? "READY_TO_ARM" : this.state; return; }
    await this.pool.query(`INSERT INTO iq_execution_experiments(id, state, max_total, min_stake_brl) VALUES($1,'DRY_RUN',$2,$3) ON CONFLICT(id) DO NOTHING`, [RSI_VARIANTS_EXPERIMENT_ID, RSI_VARIANTS_POLICY.maxTotal, RSI_VARIANTS_POLICY.stakeBrl]).catch(() => undefined);
    for (const variant of RSI_VARIANTS) await this.pool.query(`INSERT INTO iq_experiment_strategy_state(experiment_id, strategy_id, max_executions) VALUES($1,$2,$3) ON CONFLICT(experiment_id, strategy_id) DO NOTHING`, [RSI_VARIANTS_EXPERIMENT_ID, variant, RSI_VARIANTS_POLICY.maxPerVariant]).catch(() => undefined);
    const rows = await this.pool.query(`SELECT state FROM iq_execution_experiments WHERE id=$1`, [RSI_VARIANTS_EXPERIMENT_ID]).then((r) => r.rows).catch(() => []);
    if (rows[0]?.state) this.state = rows[0].state;
  }

  async counts() {
    if (!this.pool?.query) return { [STRICT_ID]: this.counters.brokerAccepted[STRICT_ID], [PULLBACK_ID]: this.counters.brokerAccepted[PULLBACK_ID] };
    const rows = await this.pool.query(`SELECT strategy_id, executed_count FROM iq_experiment_strategy_state WHERE experiment_id=$1`, [RSI_VARIANTS_EXPERIMENT_ID]).then((r) => r.rows).catch(() => []);
    const result = { [STRICT_ID]: 0, [PULLBACK_ID]: 0 };
    for (const row of rows) if (row.strategy_id in result) result[row.strategy_id] = Number(row.executed_count);
    return result;
  }

  async #setState(next, { reason = null } = {}) {
    this.state = next;
    if (this.pool?.query) await this.pool.query(`UPDATE iq_execution_experiments SET state=$2, stopped_reason=COALESCE($3, stopped_reason), updated_at=now() WHERE id=$1`, [RSI_VARIANTS_EXPERIMENT_ID, next, reason]).catch(() => undefined);
    return { state: next };
  }

  async prepare({ preflight = null } = {}) {
    await this.#ensureRows();
    const checks = {
      practiceAccount: String(preflight?.accountContext ?? "").toUpperCase() === "PRACTICE",
      brokerConnected: preflight?.brokerConnected === true,
      realLocked: preflight?.realState === "LOCKED",
      killSwitchOff: preflight?.killSwitchEngaged !== true,
      stakeOk: Number(preflight?.stakeBrl ?? 1) > 0,
      countersAvailable: true,
    };
    const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([key]) => key);
    if (failed.length) return { ok: false, error: "PREFLIGHT_FAILED", failed };
    await this.#setState("READY_TO_ARM");
    return { ok: true, state: this.state, checks };
  }

  async arm({ phrase = "", actor = "owner", preflight = null } = {}) {
    await this.prepare({ preflight });
    if (phrase !== RSI_VARIANTS_ARM_PHRASE) return { ok: false, error: "ARM_PHRASE_INVALID" };
    const ok = String(preflight?.accountContext ?? "").toUpperCase() === "PRACTICE" && preflight?.realState === "LOCKED" && preflight?.brokerConnected === true && preflight?.killSwitchEngaged !== true;
    if (!ok) return { ok: false, error: "ARM_GUARDS_FAILED" };
    if (this.pool?.query) await this.pool.query(`UPDATE iq_execution_experiments SET state='ARMED_PRACTICE', armed_by=$2, armed_at=now(), updated_at=now() WHERE id=$1`, [RSI_VARIANTS_EXPERIMENT_ID, String(actor).slice(0, 60)]).catch(() => undefined);
    await this.#setState("ARMED_PRACTICE");
    return { ok: true, state: this.state };
  }

  async stop(reason = "MANUAL_STOP") { await this.#setState("STOPPED", { reason }); return { ok: true, state: this.state }; }

  async #reserve(variant) {
    if (!this.pool?.query) { if (this.counters.brokerAccepted[variant] >= RSI_VARIANTS_POLICY.maxPerVariant) return { ok: false, error: "CAP" }; return { ok: true }; }
    const rows = await this.pool.query(`UPDATE iq_experiment_strategy_state SET reserved_count=reserved_count+1, updated_at=now() WHERE experiment_id=$1 AND strategy_id=$2 AND executed_count + reserved_count < max_executions RETURNING executed_count`, [RSI_VARIANTS_EXPERIMENT_ID, variant]).then((r) => r.rows).catch(() => []);
    return rows.length ? { ok: true, executed: rows[0].executed_count } : { ok: false, error: "CAP_REACHED" };
  }
  async #release(variant, { accepted = false } = {}) {
    if (!this.pool?.query) { if (accepted) this.counters.brokerAccepted[variant] += 1; return; }
    await this.pool.query(`UPDATE iq_experiment_strategy_state SET reserved_count=GREATEST(0,reserved_count-1), executed_count=executed_count+$3, updated_at=now() WHERE experiment_id=$1 AND strategy_id=$2`, [RSI_VARIANTS_EXPERIMENT_ID, variant, accepted ? 1 : 0]).catch(() => undefined);
  }

  async observeMarket({ marketKey = null, marketType = null, activeId = null, candles = [], targetExpiryAt = null, payout = null, latency = {}, now = null } = {}) {
    if (!this.enabled || !marketKey) return null;
    if (this.otcKeys && !this.otcKeys.includes(marketKey)) return null; // somente os 10 OTCs do teste
    if (marketType !== "OTC") return null;
    await this.#ensureRows();
    const at = num(now) ?? this.now();
    const results = [];
    for (const variant of RSI_VARIANTS) {
      try {
        const evaluation = evaluateVariant({ variant, candles, now: at });
        this.counters.evaluations[variant] += 1;
        const window = targetExpiryAt ? entryWindow({ targetExpiryAt, safeMarginMs: effectiveSafeMarginMs(latency) }) : null;
        const record = this.observations.get(`${variant}:${marketKey}:${targetExpiryAt}`) ?? { id: `${variant}:${marketKey}:${targetExpiryAt}`, variant, marketKey, marketType, activeId, createdAt: at, targetExpiryAt: num(targetExpiryAt), evaluation: null, status: "OBSERVING", direction: null, outcome: null, settlementBasis: null, theoreticalResult: null, theoreticalPnl: null };
        record.evaluation = evaluation; record.window = window; record.updatedAt = at;
        if (!evaluation.direction) { record.status = "NO_OPPORTUNITY"; this.#store(record); results.push(record); continue; }
        this.counters.opportunities[variant] += 1;
        if (!evaluation.accepted) {
          this.counters.waits[variant] += 1;
          if (evaluation.rejectedStrongTrend) this.counters.rejectedStrongTrend[variant] += 1;
          record.status = evaluation.status === "REVERSAL_REJECTED_STRONG_TREND" ? "REVERSAL_REJECTED_STRONG_TREND" : "WAITING_CONFIRMATION";
          this.#store(record); results.push(record); continue;
        }
        record.status = "CANDIDATE"; record.direction = evaluation.direction;
        this.counters.accepted[variant] += 1;
        if (!window) { this.#store(record); results.push(record); continue; }
        if (at < window.entryWindowOpensAt) { record.status = "OBSERVE_ONLY"; this.#store(record); results.push(record); continue; }
        if (at > window.entryWindowClosesAt) {
          record.status = at > window.purchaseCutoffAt ? "MISSED_ENTRY_WINDOW" : "NO_SAFE_ENTRY_INSIDE_5S_WINDOW";
          this.counters.missed[variant] += 1; this.#store(record); results.push(record); continue;
        }
        const revalidation = evaluateVariant({ variant, candles, now: at });
        record.revalidation = revalidation; record.distanceToCutoffMs = window.purchaseCutoffAt - at;
        if (!revalidation.accepted || revalidation.direction !== record.direction) {
          record.status = "CANCELLED_REVALIDATION"; this.counters.cancelled[variant] += 1;
          this.#store(record); void this.#persist(record); results.push(record); continue;
        }
        record.status = "REVERSAL_CONFIRMED";
        const counts = await this.counts();
        if (counts[variant] >= RSI_VARIANTS_POLICY.maxPerVariant) { record.status = "CAP_REACHED"; this.#store(record); results.push(record); continue; }
        const idempotencyKey = `rsi2x2:${variant}:${marketKey}:${record.targetExpiryAt}:${record.direction}`;
        if (this.observations.has(`exec:${idempotencyKey}`)) { record.status = "DUPLICATE_BLOCKED"; this.#store(record); results.push(record); continue; }
        if (this.state !== "ARMED_PRACTICE" && this.state !== "RUNNING") { record.status = "WOULD_EXECUTE"; this.#store(record); void this.#persist(record); results.push(record); continue; }
        const reservation = await this.#reserve(variant);
        if (!reservation.ok) { record.status = "CAP_REACHED"; this.#store(record); results.push(record); continue; }
        try {
          const order = await this.runtime.experimentRequestOrder({ marketKey, direction: record.direction, stake: RSI_VARIANTS_POLICY.stakeBrl, decisionId: record.id, idempotencyKey, strategyId: variant, experimentId: RSI_VARIANTS_EXPERIMENT_ID });
          const accepted = order?.state === "ACKNOWLEDGED" || order?.disposition === "EXECUTED";
          await this.#release(variant, { accepted });
          record.status = accepted ? "BROKER_ACCEPTED" : "BROKER_REJECTED"; record.brokerOrderId = order?.brokerOrderId ?? null; record.executionId = order?.executionId ?? null; record.submitAt = this.now();
          if (accepted) this.counters.brokerAccepted[variant] += 1; else this.rejections.push({ variant, marketKey, reason: "NOT_ACKNOWLEDGED", at });
          this.observations.set(`exec:${idempotencyKey}`, record);
          const after = await this.counts();
          if (after[STRICT_ID] >= 2 && after[PULLBACK_ID] >= 2) await this.#setState("COMPLETE", { reason: "BOTH_2_OF_2" });
        } catch (error) {
          await this.#release(variant, { accepted: false });
          const code = String(error?.code ?? "ERROR");
          record.status = "BROKER_REJECTED"; record.rejectionReason = code; record.error = `${code}: ${String(error?.message ?? error).slice(0, 180)}`;
          this.rejections.push({ variant, marketKey, reason: code, message: record.error, at });
          this.log("RSI_VARIANTS_REJECTED", JSON.stringify({ variant, marketKey, reason: code }));
        }
        this.#store(record); void this.#persist(record); results.push(record);
      } catch (error) { this.log("RSI_VARIANTS_OBSERVE_FAILED", String(error?.message ?? error).slice(0, 160)); }
    }
    return results;
  }

  settleCausal({ marketKey = null, candles = [], index = -1, nowMs = null } = {}) {
    if (!marketKey || !Array.isArray(candles) || index < 0) return 0;
    const observedUntil = num(candles[index]?.bucketStart); if (observedUntil === null) return 0;
    const atMs = num(nowMs) ?? this.now(); let settled = 0;
    for (const record of this.observations.values()) {
      if (record.marketKey !== marketKey || record.settlementBasis != null) continue;
      if (record.direction !== "BUY" && record.direction !== "SELL") continue;
      if (!["BROKER_ACCEPTED", "REVERSAL_CONFIRMED", "WOULD_EXECUTE"].includes(record.status)) continue;
      const expiry = num(record.targetExpiryAt); if (expiry === null || observedUntil < expiry) continue;
      const prices = causalPricesFromCandles({ candles, targetEntryAt: record.window?.purchaseCutoffAt ?? expiry, targetExpiryAt: expiry });
      const result = settleDirectionalOutcome({ direction: record.direction, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice });
      if (!result) continue;
      const expirySnapshot = evaluateVariant({ variant: record.variant, candles: candles.slice(0, index + 1), now: (prices.expiryBucketStart ?? expiry) + 5_000 });
      record.outcome = { result, entryPrice: prices.entryPrice, expiryPrice: prices.expiryPrice, entryIndicators: compactIndicators(record.evaluation), expiryIndicators: compactIndicators(expirySnapshot), settlementBasis: "CAUSAL_COUNTERFACTUAL", at: atMs, feedableToClassification: false };
      record.theoreticalResult = result; record.theoreticalPnl = normalizedOutcomePnl({ result, payout: record.payout });
      record.settlementBasis = "CAUSAL_COUNTERFACTUAL"; record.status = "SETTLED";
      const bucket = this.settled[record.variant]; bucket.total = (bucket.total ?? 0) + 1;
      if (result === "WIN") bucket.wins += 1; else if (result === "LOSS") bucket.losses += 1; else bucket.draws += 1;
      bucket.pnl = Number(((bucket.pnl ?? 0) + (record.theoreticalPnl ?? 0)).toFixed(4));
      this.counters.settled[record.variant] += 1;
      settled += 1;
    }
    return settled;
  }

  #store(record) {
    if (!this.observations.has(record.id)) this.order.push(record.id);
    this.observations.set(record.id, record);
    if (this.order.length > 3000) { for (const id of this.order.splice(0, this.order.length - 3000)) this.observations.delete(id); }
  }

  async #persist(record) {
    if (!this.pool?.query) return;
    await this.pool.query(
      `INSERT INTO iq_rsi_variant_observations(id, experiment_id, variant, market_key, market_type, active_id, status, direction, rsi, rsi_band, bollinger_confirmed, dmi_confirmed, band_riding, strong_accel, target_expiry_at, purchase_cutoff_at, safe_margin_ms, distance_to_cutoff_ms, rejection_reason, payload, outcome, settlement_basis, theoretical_result, theoretical_pnl, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22,$23,$24, now())
       ON CONFLICT(id) DO UPDATE SET status=$7, direction=$8, distance_to_cutoff_ms=$18, rejection_reason=$19, payload=$20::jsonb, outcome=$21::jsonb, settlement_basis=$22, theoretical_result=$23, theoretical_pnl=$24, updated_at=now()`,
      [record.id, RSI_VARIANTS_EXPERIMENT_ID, record.variant, record.marketKey, record.marketType, record.activeId, record.status, record.direction, record.evaluation?.rsi ?? null, record.evaluation?.rsiBand ?? null, record.evaluation?.bollingerConfirmed ?? false, record.evaluation?.dmiConfirmed ?? false, record.evaluation?.bandRiding ?? false, record.evaluation?.strongAccel ?? false, record.targetExpiryAt, record.window?.purchaseCutoffAt ?? null, record.evaluation ? effectiveSafeMarginMs({}) : null, record.distanceToCutoffMs ?? null, record.rejectionReason ?? null, JSON.stringify({ evaluation: record.evaluation, revalidation: record.revalidation, window: record.window, error: record.error ?? null, extraction: { entry: compactIndicators(record.evaluation), expiry: compactIndicators(record.revalidation) } }), JSON.stringify(record.outcome ?? null), record.settlementBasis, record.theoreticalResult, record.theoreticalPnl],
    ).catch(() => undefined);
  }

  async status() {
    await this.#ensureRows();
    const counts = await this.counts();
    const wr = (bucket) => (bucket.wins + bucket.losses) ? Number((bucket.wins / (bucket.wins + bucket.losses)).toFixed(4)) : null;
    return {
      version: RSI_VARIANTS_VERSION, experimentId: RSI_VARIANTS_EXPERIMENT_ID, state: this.state,
      practiceOnly: true, stakeBrl: RSI_VARIANTS_POLICY.stakeBrl, otcUniverse: this.otcKeys ?? [],
      countersAreDatabaseAuthoritative: true,
      caps: Object.fromEntries(RSI_VARIANTS.map((variant) => [variant, { executed: counts[variant], max: RSI_VARIANTS_POLICY.maxPerVariant }])),
      progress: Object.fromEntries(RSI_VARIANTS.map((variant) => [variant, { accepted: counts[variant], settled: this.counters.settled[variant], wins: this.settled[variant].wins, losses: this.settled[variant].losses, draws: this.settled[variant].draws, wr: wr(this.settled[variant]), pnl: this.settled[variant].pnl, waits: this.counters.waits[variant], opportunities: this.counters.opportunities[variant], rejectedStrongTrend: this.counters.rejectedStrongTrend[variant], cancelled: this.counters.cancelled[variant], missed: this.counters.missed[variant] }])),
      rejections: this.rejections.slice(-50),
      recent: this.order.slice(-30).map((id) => this.observations.get(id)).filter(Boolean).map((record) => ({ id: record.id, variant: record.variant, marketKey: record.marketKey, status: record.status, direction: record.direction, rsi: record.evaluation?.rsi ?? null, band: record.evaluation?.rsiBand ?? null, rejectionReason: record.rejectionReason ?? null, result: record.theoreticalResult })),
      policy: RSI_VARIANTS_POLICY, controlsExecution: false, note: "Comparativo separado; FIVE_WAY e RSI_REVERSAL_CONFLUENCE_V1 intocados.",
    };
  }

  async report() {
    const status = await this.status();
    const trades = [...this.observations.values()].filter((record) => record.theoreticalResult).map((record) => ({ variant: record.variant, marketKey: record.marketKey, direction: record.direction, targetExpiryAt: record.targetExpiryAt, entryPrice: record.outcome.entryPrice, expiryPrice: record.outcome.expiryPrice, payout: record.payout, result: record.theoreticalResult, pnl: record.theoreticalPnl, entryIndicators: record.outcome.entryIndicators, expiryIndicators: record.outcome.expiryIndicators }));
    return { ...status, trades, microSample: true, significant: false, note: "N=2 por variante: sem claim de vencedor." };
  }
}

export function rsiVariantsFreezeManifest() {
  return { schema: "rsi-variants-freeze-v1", version: RSI_VARIANTS_VERSION, frozenAtUtc: new Date().toISOString(), policy: RSI_VARIANTS_POLICY, noTuning: true, rules: { strict: "RSI extremo + Bollinger + DMI/ADX completo; strong trend/band riding bloqueia", pullback: "RSI extremo + Bollinger; aceita tendencia estrutural dominante, bloqueia band riding/aceleracao forte", detector: "RSI<=30 BUY / RSI>=70 SELL", timing: "[T-5s, T-safe]", counters: "POSTGRES autoritativo" } };
}
