import { AssetContext, ASSET_CONTEXT_WINDOW_CANDLES, MAX_CONTEXT_AGE_MS, OPERATIONAL_CANDLE_INTERVAL_MS, MIN_CONTEXT_OBSERVATIONS } from "./asset-context.mjs";
import { computeFeatures, deepFreeze } from "./features.mjs";
import { runSpecialists } from "./specialists.mjs";
import { consensus } from "./consensus.mjs";
import { buildDecisionSnapshot } from "./decision-snapshot.mjs";

export const HYDRATION_PENDING = "HYDRATION_PENDING";
export const HYDRATION_READY = "HYDRATION_READY";
export const HYDRATION_PARTIAL = "HYDRATION_PARTIAL";
export const HYDRATION_FAILED = "HYDRATION_FAILED";
export const MIN_CONTEXT_CANDLES = MIN_CONTEXT_OBSERVATIONS;

export const PRODUCT_OFF = "OFF";
export const PRODUCT_SEM_FEED = "SEM FEED";
export const PRODUCT_SEM_COMPRA = "SEM COMPRA";
export const PRODUCT_ASSISTINDO = "ASSISTINDO";
export const PRODUCT_WAIT = "WAIT";
export const PRODUCT_BUY = "BUY";
export const PRODUCT_SELL = "SELL";

export function productState({ enabled = false, feedStatus = "ABSENT", purchaseStatus = "UNKNOWN", hydration = HYDRATION_PENDING, consensusSide = null } = {}) {
  if (enabled !== true) return PRODUCT_OFF;
  if (feedStatus !== "OK") return PRODUCT_SEM_FEED;
  if (purchaseStatus === "UNAVAILABLE") return PRODUCT_SEM_COMPRA;
  if (hydration !== HYDRATION_READY) return PRODUCT_ASSISTINDO;
  if (consensusSide === "BUY") return PRODUCT_BUY;
  if (consensusSide === "SELL") return PRODUCT_SELL;
  return PRODUCT_WAIT;
}

export class AssetPipeline {
  constructor({ marketKey, maxCandles = ASSET_CONTEXT_WINDOW_CANDLES, minCandles = MIN_CONTEXT_CANDLES, now = () => Date.now() } = {}) {
    this.marketKey = marketKey ?? null;
    this.ctx = new AssetContext({ marketKey: this.marketKey, maxCandles });
    this.minCandles = minCandles;
    this.now = now;
    this.hydration = HYDRATION_PENDING;
    this.hydrationDetail = { loaded: 0, at: null, reason: null, coverageMs: 0, intervalMs: null, observations: 0, gapRatio: 0, future: 0, rejected: 0 };
    this.readiness = null;
    this.readinessOptions = { expectedIntervalMs: OPERATIONAL_CANDLE_INTERVAL_MS, maxAgeMs: MAX_CONTEXT_AGE_MS, minObservations: MIN_CONTEXT_OBSERVATIONS };
    this.intervalIncompatible = false;
    this.features = null;
    this.specialists = null;
    this.consensus = null;
    this.lastSnapshot = null;
    this.featuresComputed = 0;
    this.submitted = new Set();
  }

  get ready() { return this.hydration === HYDRATION_READY; }

  get observable() { return this.hydration !== HYDRATION_FAILED && this.ctx.candles.length >= this.minCandles; }

  hydrate(candles = [], { expectedIntervalMs = OPERATIONAL_CANDLE_INTERVAL_MS, maxAgeMs = MAX_CONTEXT_AGE_MS, minObservations = MIN_CONTEXT_OBSERVATIONS } = {}) {
    this.readinessOptions = { expectedIntervalMs, maxAgeMs, minObservations };
    this.intervalIncompatible = false;
    try {
      const list = Array.isArray(candles) ? candles : [];
      if (!list.length) {
        this.hydration = HYDRATION_FAILED;
        this.hydrationDetail = { loaded: 0, at: this.now(), reason: "NO_HISTORY", coverageMs: 0, intervalMs: null, observations: 0, gapRatio: 0, future: 0, rejected: 0 };
        return this.hydration;
      }
      const now = this.now();
      const future = list.filter((c) => Number(c?.at) > now + expectedIntervalMs).length;
      const loaded = this.ctx.hydrate(list);
      const readiness = this.ctx.assessReadiness({ expectedIntervalMs, maxAgeMs, minObservations });
      this.readiness = readiness;
      this.hydrationDetail = {
        loaded,
        at: now,
        reason: readiness.reason,
        coverageMs: readiness.coverageMs,
        intervalMs: readiness.intervalMs,
        observations: readiness.observations,
        gapRatio: readiness.gapRatio,
        future,
        rejected: readiness.rejectedInvalid + readiness.rejectedOutOfOrder,
      };
      if (future > 0) { this.hydration = HYDRATION_FAILED; this.hydrationDetail.reason = "FUTURE_CANDLES"; return this.hydration; }
      if (readiness.reason === "INTERVAL_INCOMPATIBLE") this.intervalIncompatible = true;
      this.hydration = readiness.status === "READY" ? HYDRATION_READY : readiness.status === "PARTIAL" ? HYDRATION_PARTIAL : HYDRATION_FAILED;
      if (this.ready) this.#recompute();
      return this.hydration;
    } catch (error) {
      this.hydration = HYDRATION_FAILED;
      this.hydrationDetail = { loaded: this.ctx.candles.length, at: this.now(), reason: String(error?.message ?? error).slice(0, 120), coverageMs: 0, intervalMs: null, observations: 0, gapRatio: 0, future: 0, rejected: 0 };
      return this.hydration;
    }
  }

  onCandle(candle) {
    if (!this.ctx.ingest(candle)) return null;
    if (!this.ready) {
      this.#reassess();
      if (!this.ready) return null;
    }
    return this.#recompute();
  }

  #reassess() {
    if (this.ready || this.intervalIncompatible) return false;
    if (this.hydrationDetail.reason === "FUTURE_CANDLES") return false;
    const readiness = this.ctx.assessReadiness(this.readinessOptions);
    this.readiness = readiness;
    this.hydrationDetail = { ...this.hydrationDetail, at: this.now(), reason: readiness.reason, coverageMs: readiness.coverageMs, intervalMs: readiness.intervalMs, observations: readiness.observations, gapRatio: readiness.gapRatio };
    if (readiness.status !== "READY") {
      this.hydration = readiness.status === "PARTIAL" ? HYDRATION_PARTIAL : HYDRATION_FAILED;
      return false;
    }
    this.hydration = HYDRATION_READY;
    this.hydrationDetail.reason = null;
    return true;
  }

  evaluate(features = null) {
    if (features) return this.#apply(features);
    if (!this.ready) return null;
    return this.#recompute();
  }

  #recompute() {
    const features = computeFeatures(this.ctx);
    if (!features) return null;
    return this.#apply(features);
  }

  #apply(features) {
    this.features = deepFreeze(features);
    this.featuresComputed += 1;
    this.specialists = runSpecialists(this.features);
    this.consensus = consensus(this.features, this.specialists);
    if (this.consensus.side !== "WAIT") {
      this.lastSnapshot = buildDecisionSnapshot({ features: this.features, specialists: this.specialists, consensus: this.consensus, decidedAt: this.features.at });
    }
    return { features: this.features, specialists: this.specialists, consensus: this.consensus, snapshot: this.lastSnapshot };
  }

  isDuplicate(snapshotId) { return !snapshotId || this.submitted.has(snapshotId); }

  markSubmitted(snapshotId) {
    if (!snapshotId) return false;
    if (this.submitted.has(snapshotId)) return false;
    this.submitted.add(snapshotId);
    if (this.submitted.size > 256) this.submitted.delete(this.submitted.values().next().value);
    return true;
  }

  analysisState() {
    if (!this.observable && !this.features) return null;
    const consensusSide = this.consensus?.side ?? null;
    return deepFreeze({
      marketKey: this.marketKey,
      at: this.features?.at ?? this.ctx.lastCandle?.at ?? null,
      hydration: this.hydration,
      hydrationReason: this.hydrationDetail.reason ?? null,
      context: this.features ? { regime: this.features.regime, structure: this.features.structure, candles: this.features.candles, coverageMs: this.ctx.coverageMs(), intervalMs: this.ctx.intervalMs } : null,
      specialists: (this.specialists ?? []).map((s) => ({ specialist: s.specialist, domainAssessment: s.domainAssessment, blockers: s.blockers })),
      consensus: consensusSide,
      reason: consensusSide === "WAIT" ? (this.consensus?.unsatisfied ?? []) : (this.consensus?.thesis ?? []),
      snapshotId: consensusSide !== "WAIT" ? (this.lastSnapshot?.id ?? null) : null,
    });
  }

  status() {
    return {
      marketKey: this.marketKey,
      hydration: this.hydration,
      hydrationReason: this.hydrationDetail.reason,
      ready: this.ready,
      observable: this.observable,
      candles: this.ctx.candles.length,
      coverageMs: this.ctx.coverageMs(),
      intervalMs: this.ctx.intervalMs,
      gapRatio: this.hydrationDetail.gapRatio,
      featuresVersion: this.features?.version ?? null,
      featuresAt: this.features?.at ?? null,
      featuresComputed: this.featuresComputed,
      consensusSide: this.consensus?.side ?? null,
      lastSnapshotId: this.lastSnapshot?.id ?? null,
    };
  }
}

export class PipelineRegistry {
  constructor({ now = () => Date.now(), loader = null, hydrationOptions = null } = {}) {
    this.now = now;
    this.loader = loader;
    this.hydrationOptions = hydrationOptions;
    this.assets = new Map();
  }

  ensure(marketKey) {
    if (!this.assets.has(marketKey)) this.assets.set(marketKey, new AssetPipeline({ marketKey, now: this.now }));
    return this.assets.get(marketKey);
  }

  get(marketKey) { return this.assets.get(marketKey) ?? null; }

  async hydrateAll(marketKeys = []) {
    const report = { ready: 0, partial: 0, failed: 0, assets: [] };
    for (const marketKey of marketKeys) {
      const pipeline = this.ensure(marketKey);
      let history = [];
      let options = this.hydrationOptions;
      try { history = this.loader ? await this.loader(marketKey) : []; } catch { history = []; }
      const status = pipeline.hydrate(history, options ?? {});
      report[status === HYDRATION_READY ? "ready" : status === HYDRATION_PARTIAL ? "partial" : "failed"] += 1;
      report.assets.push({ marketKey, status, candles: pipeline.ctx.candles.length, coverageMs: pipeline.ctx.coverageMs(), intervalMs: pipeline.ctx.intervalMs, reason: pipeline.hydrationDetail.reason });
    }
    return report;
  }

  onCandle(marketKey, candle) { return this.ensure(marketKey).onCandle(candle); }

  actionable() {
    return [...this.assets.values()]
      .filter((p) => p.ready && p.consensus && p.consensus.side !== "WAIT" && p.lastSnapshot && !p.isDuplicate(p.lastSnapshot.id))
      .map((p) => ({ marketKey: p.marketKey, side: p.consensus.side, snapshot: p.lastSnapshot, consensus: p.consensus }));
  }

  status() { return [...this.assets.values()].map((p) => p.status()); }
}
