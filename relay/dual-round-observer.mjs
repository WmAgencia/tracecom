/**
 * DUAL_ROUND_MARKET_DELTA_OBSERVER — sidecar EXTERNO e UNIDIRECIONAL do DUAL_REASONING_V1 (congelado).
 *
 * - Nao alimenta Agent A/B/Synthesis; falha aqui nunca afeta o Dual (fail-safe).
 * - Observa os T0/T1/T2 ja produzidos e registra deltas reais entre rodadas consecutivas.
 * - Sem dado real => NOT_MEASURABLE (nunca infere ticks/candles por diferenca de horario).
 * - Historical (antes do deploy): NOT_MEASURABLE por construcao.
 */
export const DUAL_ROUND_OBSERVER_VERSION = "dual-round-market-delta-observer-v1";
export const MATERIAL_MARKET_CHANGE_POLICY = Object.freeze({
  version: "material-market-change-v1",
  definition: "mudanca material = (novo candle 5s fechado >= 1) OU (novo tick >= 5) OU |priceDeltaATR| >= 0.25 OU |velocityDelta| >= 0.25*ATR OU mudanca de structure/regime/scenario/location/trigger/shortImpulse.",
  usage: "ANALISE APENAS; nunca filtro de decisao.",
});

const num = (value) => (value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null));
const sign = (value) => { const n = num(value); return n === null ? null : Math.sign(n); };

function snapshotView(t0) {
  if (!t0 || typeof t0 !== "object") return null;
  return {
    snapshotId: t0.snapshotId ?? null,
    price: num(t0.price?.last),
    atr: num(t0.indicators?.atr14),
    velocity: num(t0.momentum?.velocity),
    acceleration: num(t0.momentum?.acceleration),
    rsi: num(t0.indicators?.rsi14),
    diSpread: num(t0.indicators?.diSpread),
    tickCount: num(t0.ticks?.count),
    closed5s: num(t0.candles5s?.closedCount),
    structure: t0.structure?.label ?? null,
    regime: null,
    scenario: null,
    location: t0.location?.zone ?? null,
    trigger: t0.momentum?.persistenceDirection ?? null,
    priceAction: t0.candles5s?.lastClosed?.direction ?? null,
    shortImpulse: sign(t0.momentum?.velocity) ?? sign(t0.momentum?.acceleration),
  };
}

export function buildRoundDelta({ previous = null, current = null, round = null, observationId = null, marketKey = null, observedAt = Date.now() } = {}) {
  const prev = snapshotView(previous);
  const cur = snapshotView(current);
  const base = { version: DUAL_ROUND_OBSERVER_VERSION, observationId, marketKey, round, observedAt, snapshotId: cur?.snapshotId ?? null, previousSnapshotId: prev?.snapshotId ?? null, notMeasurable: false };
  if (!prev || !cur) return { ...base, notMeasurable: true, reason: "NO_PREVIOUS_SNAPSHOT" };
  if (prev.snapshotId && cur.snapshotId && prev.snapshotId === cur.snapshotId) return { ...base, notMeasurable: true, reason: "SAME_SNAPSHOT_ID" };
  const atr = cur.atr ?? prev.atr;
  const newTicks = prev.tickCount !== null && cur.tickCount !== null ? Math.max(0, cur.tickCount - prev.tickCount) : null;
  const newCandles = prev.closed5s !== null && cur.closed5s !== null ? Math.max(0, cur.closed5s - prev.closed5s) : null;
  const priceDelta = prev.price !== null && cur.price !== null ? Number((cur.price - prev.price).toFixed(8)) : null;
  const priceDeltaATR = priceDelta !== null && atr ? Number((priceDelta / atr).toFixed(4)) : null;
  const velocityDelta = prev.velocity !== null && cur.velocity !== null ? Number((cur.velocity - prev.velocity).toFixed(8)) : null;
  const accelerationDelta = prev.acceleration !== null && cur.acceleration !== null ? Number((cur.acceleration - prev.acceleration).toFixed(8)) : null;
  const rsiDelta = prev.rsi !== null && cur.rsi !== null ? Number((cur.rsi - prev.rsi).toFixed(4)) : null;
  const diSpreadDelta = prev.diSpread !== null && cur.diSpread !== null ? Number((cur.diSpread - prev.diSpread).toFixed(4)) : null;
  const atrDelta = prev.atr !== null && cur.atr !== null ? Number((cur.atr - prev.atr).toFixed(8)) : null;
  const changes = {
    structureChanged: prev.structure !== cur.structure,
    regimeChanged: prev.regime !== cur.regime,
    scenarioChanged: prev.scenario !== cur.scenario,
    locationChanged: prev.location !== cur.location,
    triggerChanged: prev.trigger !== cur.trigger,
    shortImpulseChanged: prev.shortImpulse !== cur.shortImpulse,
    priceActionChanged: prev.priceAction !== cur.priceAction,
  };
  const material = (newCandles !== null && newCandles >= 1)
    || (newTicks !== null && newTicks >= 5)
    || (priceDeltaATR !== null && Math.abs(priceDeltaATR) >= 0.25)
    || (velocityDelta !== null && atr ? Math.abs(velocityDelta) >= 0.25 * atr : false)
    || Object.values(changes).some(Boolean);
  return { ...base, elapsedMsFromPrevious: null, newTickCount: newTicks, newClosed5sCandleCount: newCandles, price: cur.price, priceDelta, priceDeltaATR, velocity: cur.velocity, velocityDelta, acceleration: cur.acceleration, accelerationDelta, rsi: cur.rsi, rsiDelta, diSpread: cur.diSpread, diSpreadDelta, atr, atrDelta, ...changes, materialMarketChange: material, materialPolicy: MATERIAL_MARKET_CHANGE_POLICY.version };
}

export class DualRoundMarketDeltaObserver {
  constructor({ pool = null, now = () => Date.now(), log = () => {}, enabled = true } = {}) {
    this.pool = pool; this.now = now; this.log = (...a) => { try { log(...a); } catch { /* noop */ } };
    this.enabled = enabled === true;
    this.state = { observed: 0, notMeasurable: 0, persisted: 0, failures: 0, materialChanges: 0 };
    this.lastByCandidate = new Map();
  }
  setEnabled(enabled) { this.enabled = enabled === true; return { enabled: this.enabled }; }

  /** Unidirecional: chamado APOS as rodadas do Dual; nunca impacta a decisao. */
  observe({ observationId = null, marketKey = null, round = null, t0 = null } = {}) {
    if (!this.enabled || !observationId || !t0) return null;
    try {
      const previous = this.lastByCandidate.get(observationId) ?? null;
      const delta = buildRoundDelta({ previous, current: t0, round, observationId, marketKey, observedAt: this.now() });
      if (previous) { const elapsed = this.now() - previous.receivedAt; delta.elapsedMsFromPrevious = elapsed; }
      this.lastByCandidate.set(observationId, { t0, receivedAt: this.now() });
      if (delta.notMeasurable) this.state.notMeasurable += 1; else this.state.observed += 1;
      if (delta.materialMarketChange) this.state.materialChanges += 1;
      this.#persist(delta);
      return delta;
    } catch (error) { this.state.failures += 1; this.log("DUAL_ROUND_OBSERVER_FAILED", String(error?.message ?? error).slice(0, 160)); return null; }
  }

  status() { return { version: DUAL_ROUND_OBSERVER_VERSION, enabled: this.enabled, state: { ...this.state }, materialPolicy: MATERIAL_MARKET_CHANGE_POLICY, note: "Sidecar externo; nao alimenta A/B/Synthesis; historico anterior = NOT_MEASURABLE." }; }

  #persist(delta) {
    if (!this.pool?.query || !delta?.observationId || delta.notMeasurable) return;
    this.pool.query(
      `INSERT INTO iq_dual_round_deltas(observation_id, market_key, round, snapshot_id, previous_snapshot_id, observed_at, elapsed_ms, new_tick_count, new_closed_5s_count, price, price_delta, price_delta_atr, velocity_delta, acceleration_delta, rsi_delta, di_spread_delta, atr_delta, structure_changed, regime_changed, scenario_changed, location_changed, trigger_changed, short_impulse_changed, price_action_changed, material_market_change, payload, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb, now())
       ON CONFLICT(observation_id, round) DO NOTHING`,
      [delta.observationId, delta.marketKey, delta.round, delta.snapshotId, delta.previousSnapshotId, delta.observedAt, delta.elapsedMsFromPrevious, delta.newTickCount, delta.newClosed5sCandleCount, delta.price, delta.priceDelta, delta.priceDeltaATR, delta.velocityDelta, delta.accelerationDelta, delta.rsiDelta, delta.diSpreadDelta, delta.atrDelta, delta.structureChanged, delta.regimeChanged, delta.scenarioChanged, delta.locationChanged, delta.triggerChanged, delta.shortImpulseChanged, delta.priceActionChanged, delta.materialMarketChange ?? false, JSON.stringify(delta)],
    ).then(() => { this.state.persisted += 1; }).catch((error) => { this.state.failures += 1; this.log("DUAL_ROUND_OBSERVER_PERSIST_FAILED", String(error?.message ?? error).slice(0, 160)); });
  }
}
