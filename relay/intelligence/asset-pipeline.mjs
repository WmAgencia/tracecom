import { AssetContext, ASSET_CONTEXT_WINDOW_CANDLES } from "./asset-context.mjs";
import { computeFeatures, deepFreeze } from "./features.mjs";
import { runSpecialists } from "./specialists.mjs";
import { consensus } from "./consensus.mjs";
import { buildDecisionSnapshot } from "./decision-snapshot.mjs";

export const HYDRATION_PENDING = "HYDRATION_PENDING";
export const HYDRATION_READY = "HYDRATION_READY";
export const HYDRATION_PARTIAL = "HYDRATION_PARTIAL";
export const HYDRATION_FAILED = "HYDRATION_FAILED";
export const MIN_CONTEXT_CANDLES = 25;

export class AssetPipeline {
  constructor({ marketKey, maxCandles = ASSET_CONTEXT_WINDOW_CANDLES, minCandles = MIN_CONTEXT_CANDLES, now = () => Date.now() } = {}) {
    this.marketKey = marketKey ?? null;
    this.ctx = new AssetContext({ marketKey: this.marketKey, maxCandles });
    this.minCandles = minCandles;
    this.now = now;
    this.hydration = HYDRATION_PENDING;
    this.hydrationDetail = { loaded: 0, expected: maxCandles, at: null, reason: null };
    this.features = null;
    this.specialists = null;
    this.consensus = null;
    this.lastSnapshot = null;
    this.featuresComputed = 0;
    this.submitted = new Set();
  }

  get ready() { return (this.hydration === HYDRATION_READY || this.hydration === HYDRATION_PARTIAL) && this.ctx.candles.length >= this.minCandles; }

  hydrate(candles) {
    try {
      const list = Array.isArray(candles) ? candles : [];
      if (!list.length) {
        this.hydration = HYDRATION_FAILED;
        this.hydrationDetail = { loaded: 0, expected: this.ctx.maxCandles, at: this.now(), reason: "NO_HISTORY" };
        return this.hydration;
      }
      const loaded = this.ctx.hydrate(list);
      this.hydrationDetail = { loaded, expected: this.ctx.maxCandles, at: this.now(), reason: loaded < this.minCandles ? "INSUFFICIENT_HISTORY" : null };
      this.hydration = loaded < this.minCandles ? HYDRATION_FAILED : loaded >= this.ctx.maxCandles ? HYDRATION_READY : HYDRATION_PARTIAL;
      if (this.ready) this.#recompute();
      return this.hydration;
    } catch (error) {
      this.hydration = HYDRATION_FAILED;
      this.hydrationDetail = { loaded: this.ctx.candles.length, expected: this.ctx.maxCandles, at: this.now(), reason: String(error?.message ?? error).slice(0, 120) };
      return this.hydration;
    }
  }

  onCandle(candle) {
    if (!this.ctx.ingest(candle)) return null;
    if (!this.ready) return null;
    return this.#recompute();
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

  status() {
    return {
      marketKey: this.marketKey,
      hydration: this.hydration,
      hydrationReason: this.hydrationDetail.reason,
      ready: this.ready,
      candles: this.ctx.candles.length,
      hydrationLoaded: this.hydrationDetail.loaded,
      featuresVersion: this.features?.version ?? null,
      featuresAt: this.features?.at ?? null,
      featuresComputed: this.featuresComputed,
      consensusSide: this.consensus?.side ?? null,
      lastSnapshotId: this.lastSnapshot?.id ?? null,
    };
  }
}

export class PipelineRegistry {
  constructor({ now = () => Date.now(), loader = null } = {}) {
    this.now = now;
    this.loader = loader;
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
      try { history = this.loader ? await this.loader(marketKey) : []; } catch { history = []; }
      const status = pipeline.hydrate(history);
      report[status === HYDRATION_READY ? "ready" : status === HYDRATION_PARTIAL ? "partial" : "failed"] += 1;
      report.assets.push({ marketKey, status, candles: pipeline.ctx.candles.length });
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
