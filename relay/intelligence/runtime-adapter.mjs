import { PipelineRegistry, HYDRATION_READY, productState } from "./asset-pipeline.mjs";
import { decisionFromSnapshot } from "./decision-snapshot.mjs";

export const FEED_ABSENT = "ABSENT";
export const FEED_OK = "OK";
export const FEED_STALE = "STALE";

export class RuntimeIntelligence {
  constructor({ now = () => Date.now(), loader = null, strategy = null, expectedIntervalMs = 5000, feedStaleMs = 30_000, seenLimit = 4096 } = {}) {
    this.now = now;
    this.expectedIntervalMs = expectedIntervalMs;
    this.feedStaleMs = feedStaleMs;
    this.seenLimit = seenLimit;
    this.strategy = strategy;
    this.registry = new PipelineRegistry({ now, loader });
    this.seen = new Set();
    this.lastClosedByAsset = new Map();
    this.lastPipelineUpdateAt = null;
    this.ready = false;
    this.initError = null;
    try {
      if (!this.registry) throw new Error("PIPELINE_REGISTRY_NULL");
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.initError = String(error?.message ?? error).slice(0, 120);
    }
  }

  async start(marketKeys = []) {
    try {
      const report = await this.registry.hydrateAll(marketKeys);
      this.lastPipelineUpdateAt = this.now();
      return report;
    } catch (error) {
      this.ready = false;
      this.initError = String(error?.message ?? error).slice(0, 120);
      return null;
    }
  }

  #closedKey(marketKey, at) { return `${marketKey}|${at}|${this.expectedIntervalMs}`; }

  onClosedCandle(marketKey, candle) {
    if (!this.ready) return { processed: false, reason: "INTELLIGENCE_NOT_READY" };
    const at = Number(candle?.at);
    if (!Number.isFinite(at)) return { processed: false, reason: "INVALID_CANDLE" };
    const key = this.#closedKey(marketKey, at);
    if (this.seen.has(key)) return { processed: false, reason: "DUPLICATE_CLOSED_CANDLE" };
    this.seen.add(key);
    if (this.seen.size > this.seenLimit) this.seen.delete(this.seen.values().next().value);
    const result = this.registry.onCandle(marketKey, candle);
    this.lastClosedByAsset.set(marketKey, at);
    this.lastPipelineUpdateAt = this.now();
    return { processed: true, result };
  }

  feedStatusFor(marketKey) {
    const last = this.lastClosedByAsset.get(marketKey) ?? null;
    if (last === null) return FEED_ABSENT;
    return this.now() - last <= this.feedStaleMs ? FEED_OK : FEED_STALE;
  }

  assetStatus(marketKey) {
    const pipeline = this.registry.get(marketKey);
    if (!pipeline) return null;
    return { ...pipeline.status(), feedStatus: this.feedStatusFor(marketKey) };
  }

  productStateFor(marketKey, { enabled = true, purchaseStatus = "AVAILABLE" } = {}) {
    const pipeline = this.registry.get(marketKey);
    return productState({
      enabled,
      feedStatus: this.feedStatusFor(marketKey),
      purchaseStatus,
      hydration: pipeline?.hydration ?? "HYDRATION_PENDING",
      consensusSide: pipeline?.consensus?.side ?? null,
    });
  }

  decisions() {
    if (!this.ready) return [];
    return this.registry.actionable().map(({ marketKey, snapshot }) => ({ marketKey, snapshot, decision: decisionFromSnapshot(snapshot, this.strategy ?? {}) }));
  }

  health() {
    const status = this.registry.status();
    const assetsReady = status.filter((s) => s.hydration === HYDRATION_READY).length;
    const assetsPartial = status.filter((s) => s.hydration === "HYDRATION_PARTIAL").length;
    const assetsFailed = status.filter((s) => s.hydration === "HYDRATION_FAILED").length;
    const intelligenceReady = this.ready === true && this.initError === null;
    return {
      intelligenceReady,
      degraded: intelligenceReady === false || assetsReady === 0,
      initError: this.initError,
      strategyVersion: this.strategy?.version ?? null,
      strategyStatus: this.strategy?.status ?? null,
      assetsTotal: status.length,
      assetsReady,
      assetsPartial,
      assetsFailed,
      lastPipelineUpdateAt: this.lastPipelineUpdateAt,
      expectedIntervalMs: this.expectedIntervalMs,
    };
  }

  allowsExecution(marketKey) {
    if (!this.ready || this.initError) return { allowed: false, reason: "INTELLIGENCE_NOT_READY" };
    const pipeline = this.registry.get(marketKey);
    if (!pipeline || pipeline.hydration !== HYDRATION_READY) return { allowed: false, reason: "HYDRATION_NOT_READY" };
    if (this.feedStatusFor(marketKey) !== FEED_OK) return { allowed: false, reason: "FEED_NOT_OK" };
    if (this.strategy?.status !== "ACTIVE" || this.strategy?.executable !== true) return { allowed: false, reason: "STRATEGY_NOT_ACTIVE" };
    return { allowed: true, reason: null };
  }
}
