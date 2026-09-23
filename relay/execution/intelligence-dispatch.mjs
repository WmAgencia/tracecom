import { ACCOUNT_PRACTICE, ACCOUNT_REAL } from "./account-router.mjs";
import { OPERATIONAL_EXPIRY_SECONDS } from "./binary300.mjs";
import { FEED_OK } from "../intelligence/runtime-adapter.mjs";

export const DISPATCH_VERSION = "intelligence-dispatch-v1";

export class IntelligenceDispatch {
  constructor({
    intelligence = null,
    singlePath = null,
    strategy = null,
    requestOrder = null,
    killSwitchEngaged = () => false,
    accountMode = ACCOUNT_PRACTICE,
    realArmed = () => false,
    accountContext = () => null,
    serverTimeMs = () => null,
    marketStateFor = () => ({ tradable: true, purchaseStatus: "AVAILABLE" }),
    sourceFor = null,
    log = () => {},
    now = () => Date.now(),
    historyLimit = 64,
  } = {}) {
    this.intelligence = intelligence;
    this.singlePath = singlePath;
    this.strategy = strategy;
    this.requestOrder = requestOrder;
    this.killSwitchEngaged = killSwitchEngaged;
    this.accountMode = accountMode;
    this.realArmed = realArmed;
    this.accountContext = accountContext;
    this.serverTimeMs = serverTimeMs;
    this.marketStateFor = marketStateFor;
    this.sourceFor = typeof sourceFor === "function" ? sourceFor : null;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.now = now;
    this.historyLimit = historyLimit;
    this.claimed = new Set();
    this.inFlight = new Set();
    this.history = [];
    this.counters = { pumps: 0, considered: 0, denied: 0, skipped: 0, submitted: 0, errors: 0, duplicates: 0 };
  }

  #record(entry) {
    this.history.push(entry);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    return entry;
  }

  #accountMode() {
    const value = typeof this.accountMode === "function" ? this.accountMode() : this.accountMode;
    return value === ACCOUNT_REAL ? ACCOUNT_REAL : ACCOUNT_PRACTICE;
  }

  #gateInput({ decision, serverNow }) {
    return {
      decision,
      strategy: this.strategy,
      researchOnly: false,
      instrumentType: "BINARY",
      expirySeconds: OPERATIONAL_EXPIRY_SECONDS,
      accountMode: this.#accountMode(),
      realArmed: this.realArmed(),
      killSwitchEngaged: this.killSwitchEngaged(),
      accountContext: this.accountContext(),
      serverTimeMs: Number.isFinite(serverNow) ? serverNow : null,
    };
  }

  #deny(summary, { marketKey, snapshotId, side = null, code, stage }) {
    summary.denied.push({ marketKey, snapshotId, side, code, stage });
    this.counters.denied += 1;
    this.#record({ at: this.now(), marketKey, snapshotId, side, code, stage, account: null, orderState: null });
  }

  async #submit(summary, item, first, serverNow) {
    const marketKey = item.marketKey;
    const snapshotId = item.snapshot?.id ?? null;
    const finalGate = this.singlePath.gate.decide(this.#gateInput({ decision: item.decision, serverNow }));
    if (finalGate.allowed !== true) {
      this.claimed.delete(snapshotId);
      this.inFlight.delete(marketKey);
      this.#deny(summary, { marketKey, snapshotId, side: item.decision?.side ?? null, code: finalGate.code, stage: "PRE_SUBMIT" });
      return;
    }
    let order = null;
    let error = null;
    try {
      order = await this.requestOrder({
        marketKey,
        direction: item.decision.side,
        decisionId: snapshotId,
        idempotencyKey: snapshotId,
        horizonSeconds: OPERATIONAL_EXPIRY_SECONDS,
        source: this.sourceFor ? this.sourceFor(marketKey) : `intelligence:${this.strategy?.version ?? "UNKNOWN"}`,
        entryTiming: { targetExpiryAt: first.timing.expiryAt, targetExpirySec: Math.round(first.timing.expiryAt / 1000), revalidatedAt: first.revalidation?.at ?? this.now() },
      });
    } catch (caught) {
      error = String(caught?.code ?? caught?.message ?? caught).slice(0, 160);
      this.counters.errors += 1;
    } finally {
      this.inFlight.delete(marketKey);
    }
    if (error) {
      this.#deny(summary, { marketKey, snapshotId, side: item.decision.side, code: error, stage: "BROKER" });
      return;
    }
    summary.submitted.push({ marketKey, snapshotId, side: item.decision.side, account: first.route?.account ?? null, state: order?.state ?? null, brokerOrderId: order?.brokerOrderId ?? null });
    this.counters.submitted += 1;
    this.#record({ at: this.now(), marketKey, snapshotId, side: item.decision.side, code: "SUBMITTED", stage: "BROKER", account: first.route?.account ?? null, orderState: order?.state ?? null });
  }

  async dispatchOnce() {
    const summary = { at: this.now(), considered: 0, submitted: [], denied: [], skipped: [], reason: null };
    if (!this.intelligence || !this.singlePath || typeof this.requestOrder !== "function") { summary.reason = "DISPATCH_NOT_WIRED"; return summary; }
    if (this.intelligence.ready !== true) { summary.reason = "INTELLIGENCE_NOT_READY"; return summary; }
    const health = this.intelligence.health();
    if (health.state !== "READY") { summary.reason = health.state === "NOT_READY" ? "INTELLIGENCE_NOT_READY" : "INTELLIGENCE_DEGRADED"; return summary; }
    this.counters.pumps += 1;
    const decisions = this.intelligence.decisions();
    summary.considered = decisions.length;
    this.counters.considered += decisions.length;
    const jobs = [];
    for (const item of decisions) {
      const marketKey = item.marketKey;
      const snapshotId = item.snapshot?.id ?? null;
      if (!snapshotId) { summary.skipped.push({ marketKey, snapshotId, code: "SNAPSHOT_MISSING" }); this.counters.skipped += 1; continue; }
      if (this.claimed.has(snapshotId)) { summary.skipped.push({ marketKey, snapshotId, code: "DUPLICATE_DECISION" }); this.counters.duplicates += 1; continue; }
      if (this.inFlight.has(marketKey)) { summary.skipped.push({ marketKey, snapshotId, code: "ASSET_LOCKED" }); this.counters.skipped += 1; continue; }
      const pipeline = this.intelligence.registry.get(marketKey);
      if (!pipeline) { summary.skipped.push({ marketKey, snapshotId, code: "PIPELINE_MISSING" }); this.counters.skipped += 1; continue; }
      if (pipeline.isDuplicate(snapshotId)) { summary.skipped.push({ marketKey, snapshotId, code: "DUPLICATE_DECISION" }); this.counters.duplicates += 1; continue; }
      const market = this.marketStateFor(marketKey) ?? {};
      if (market.tradable !== true) { this.#deny(summary, { marketKey, snapshotId, side: item.decision?.side ?? null, code: "MARKET_NOT_TRADABLE", stage: "MARKET" }); continue; }
      if (this.intelligence.feedStatusFor(marketKey) !== FEED_OK) { this.#deny(summary, { marketKey, snapshotId, side: item.decision?.side ?? null, code: "FEED_NOT_OK", stage: "FEED" }); continue; }
      if (market.purchaseStatus === "UNAVAILABLE") { this.#deny(summary, { marketKey, snapshotId, side: item.decision?.side ?? null, code: "BROKER_PURCHASE_UNAVAILABLE", stage: "MARKET" }); continue; }
      const serverNow = Number(this.serverTimeMs());
      if (Number.isFinite(serverNow)) { try { this.singlePath.timing.syncServerTime(serverNow); } catch { /* timing fail-closed abaixo */ } }
      const first = this.singlePath.evaluate(this.#gateInput({ decision: item.decision, serverNow }));
      if (first.entry.allowed !== true) { this.#deny(summary, { marketKey, snapshotId, side: item.decision?.side ?? null, code: first.entry.code, stage: "SINGLE_PATH" }); continue; }
      this.claimed.add(snapshotId);
      this.inFlight.add(marketKey);
      jobs.push(this.#submit(summary, item, first, serverNow));
    }
    await Promise.all(jobs);
    return summary;
  }

  status() {
    return {
      version: DISPATCH_VERSION,
      wired: Boolean(this.intelligence && this.singlePath && typeof this.requestOrder === "function"),
      accountMode: this.#accountMode(),
      strategyVersion: this.strategy?.version ?? null,
      strategyStatus: this.strategy?.status ?? null,
      inFlight: [...this.inFlight],
      counters: { ...this.counters },
      recent: this.history.slice(-10),
    };
  }
}
