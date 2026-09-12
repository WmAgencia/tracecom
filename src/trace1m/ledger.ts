import { createHash } from "node:crypto";
import type { Datastore } from "../store/db";

export type TraceDecision = "BUY" | "SELL" | "WAIT";
export type WaitReason = "LOW_CONFIDENCE" | "SPREAD_HIGH" | "NEWS_RISK" | "DATA_STALE" | "DATA_MISMATCH" | "INSUFFICIENT_HISTORY" | "NO_EDGE" | "RISK_BLOCK" | "70_GATE_FAIL";
export type ProviderRole = "PRIMARY" | "FALLBACK";

export interface TimedNewsItem {
  readonly publishedAt: number;
  readonly receivedAt: number;
  readonly currencies: readonly string[];
  readonly impact: string;
  readonly source: string;
  readonly eventType: string;
}

export interface TimedMacroEvent {
  readonly scheduledAt: number;
  readonly publishedAt?: number;
  readonly receivedAt: number;
  readonly currency: string;
  readonly importance: string;
  readonly eventType: string;
  readonly expected?: number;
  readonly previous?: number;
  readonly actual?: number;
  readonly surprise?: number;
  readonly source: string;
}

export interface QuoteObservation {
  readonly pair: string;
  readonly provider: string;
  readonly providerRole: ProviderRole;
  readonly providerTimestamp: number;
  readonly receivedAt: number;
  readonly bid: number;
  readonly ask: number;
  readonly pipSize: number;
  readonly providerVersion: string;
}

export interface SnapshotContext {
  readonly session: string;
  readonly candleState: unknown;
  readonly candles1m: unknown;
  readonly context5m: unknown;
  readonly context15m: unknown;
  readonly professional: unknown;
  readonly microstructure: unknown | null;
  readonly news: readonly TimedNewsItem[] | null;
  readonly macro: readonly TimedMacroEvent[] | null;
  readonly modelVersion: string;
  readonly featureVersion: string;
  readonly historySufficient: boolean;
  readonly newsFresh: boolean;
  readonly calendarFresh: boolean;
}

export interface CollectRequest {
  readonly quote: QuoteObservation;
  readonly fallbackQuote?: QuoteObservation;
  readonly context: SnapshotContext;
  readonly researchDecision: TraceDecision;
  readonly productionGatePassed: boolean;
  readonly productionGateEvidence?: { readonly passed: boolean; readonly threshold: number; readonly lowerBound: number; readonly netEv: number; readonly reasonCodes: readonly string[] };
  readonly confidence?: number;
  readonly maxQuoteAgeMs?: number;
  readonly maxProviderMismatchPips?: number;
  readonly maxSpreadPips?: number;
  readonly now?: number;
}

export interface TraceStatus {
  readonly phase: "COLLECTOR_READY" | "PHASE_A";
  readonly startedAt: number | null;
  readonly totalSnapshots: number;
  readonly totalWAIT: number;
  readonly actionableTrades: number;
  readonly evaluatedTrades: number;
  readonly wins: number;
  readonly losses: number;
  readonly unknown: number;
  readonly currentWR: number | null;
  readonly currentNetEV: number | null;
  readonly currentCoverage: number;
  readonly lastTradeAt: number | null;
  readonly providers: readonly string[];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string { return createHash("sha256").update(stable(value)).digest("hex"); }
function finiteTimestamp(value: number): boolean { return Number.isFinite(value) && value > 0; }

export function causalNews(items: readonly TimedNewsItem[] | null, at: number): readonly TimedNewsItem[] | null {
  if (items === null) return null;
  return items.filter((item) => finiteTimestamp(item.publishedAt) && finiteTimestamp(item.receivedAt) && item.publishedAt <= at && item.receivedAt <= at && item.source.trim() !== "");
}

export function causalMacro(items: readonly TimedMacroEvent[] | null, at: number): readonly TimedMacroEvent[] | null {
  if (items === null) return null;
  return items.filter((item) => finiteTimestamp(item.scheduledAt) && finiteTimestamp(item.receivedAt) && item.receivedAt <= at && item.source.trim() !== "" && (item.publishedAt === undefined || (finiteTimestamp(item.publishedAt) && item.publishedAt <= at && item.receivedAt >= item.publishedAt)) && ((item.actual === undefined && item.surprise === undefined) || item.publishedAt !== undefined));
}

function validateQuote(q: QuoteObservation, now: number, expectedRole?: ProviderRole): void {
  if (![q.bid, q.ask, q.pipSize, q.providerTimestamp, q.receivedAt].every(Number.isFinite) || q.bid <= 0 || q.ask < q.bid || q.pipSize <= 0) throw new Error("Invalid executable bid/ask quote");
  if (!q.provider.trim() || !q.pair.trim() || (expectedRole && q.providerRole !== expectedRole)) throw new Error("Invalid quote provenance");
  if (!finiteTimestamp(q.providerTimestamp) || !finiteTimestamp(q.receivedAt) || q.providerTimestamp > q.receivedAt || q.receivedAt > now) throw new Error("Invalid or future quote timestamp");
}

function sessionAt(timestamp: number): string {
  const hour = new Date(timestamp).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 16) return "OVERLAP";
  if (hour < 21) return "NEW_YORK";
  return "OFF_HOURS";
}

export class Trace1mLedger {
  constructor(private readonly store: Datastore) {}

  collect(request: CollectRequest): { snapshotId: string; tradeId: string; researchDecision: TraceDecision; productionDecision: TraceDecision; waitReason: WaitReason | null; inserted: boolean } {
    const now = request.now ?? Date.now();
    const q = request.quote;
    validateQuote(q, now, "PRIMARY");
    const spread = q.ask - q.bid;
    const spreadPips = spread / q.pipSize;
    const quoteAgeMs = now - q.providerTimestamp;
    const news = causalNews(request.context.news, now);
    const macro = causalMacro(request.context.macro, now);
    const missing: string[] = [];
    if (request.context.microstructure === null) missing.push("microstructure");
    if (news === null) missing.push("news");
    if (macro === null) missing.push("macro");
    let waitReason: WaitReason | null = null;
    if (quoteAgeMs > (request.maxQuoteAgeMs ?? 5_000)) waitReason = "DATA_STALE";
    const fallback = request.fallbackQuote;
    if (fallback) {
      validateQuote(fallback, now, "FALLBACK");
      if (fallback.pair !== q.pair || fallback.provider === q.provider || fallback.pipSize !== q.pipSize) throw new Error("Fallback provenance is invalid");
      const mismatch = Math.abs(((fallback.bid + fallback.ask) / 2) - ((q.bid + q.ask) / 2)) / q.pipSize;
      if (mismatch > (request.maxProviderMismatchPips ?? 3) || Math.abs(fallback.providerTimestamp - q.providerTimestamp) > (request.maxQuoteAgeMs ?? 5_000)) waitReason = "DATA_MISMATCH";
    }
    if (spreadPips > (request.maxSpreadPips ?? 3)) waitReason ??= "SPREAD_HIGH";
    if (!request.context.historySufficient || missing.length > 0 || !request.context.newsFresh || !request.context.calendarFresh) waitReason ??= "INSUFFICIENT_HISTORY";
    if ((request.confidence ?? 1) < 0.5) waitReason ??= "LOW_CONFIDENCE";
    const researchDecision: TraceDecision = waitReason ? "WAIT" : request.researchDecision;
    if (researchDecision === "WAIT" && !waitReason) waitReason = "NO_EDGE";
    const gate = request.productionGateEvidence;
    const gateProven = Boolean(gate?.passed && gate.threshold >= 0.7 && gate.lowerBound >= 0.7 && gate.netEv > 0 && gate.reasonCodes.length === 0);
    const productionDecision: TraceDecision = gateProven && researchDecision !== "WAIT" ? researchDecision : "WAIT";
    const qualityScore = Math.max(0, Math.min(1, 1 - missing.length * 0.2 - (quoteAgeMs > 1_000 ? 0.2 : 0) - (waitReason ? 0.2 : 0)));
    const payload = {
      schemaVersion: "trace1m.snapshot.v1", observedAt: now, providerTimestamp: q.providerTimestamp, receivedAt: q.receivedAt,
      pair: q.pair, provider: q.provider, providerRole: q.providerRole, bid: q.bid, ask: q.ask, mid: (q.bid + q.ask) / 2,
      spread, spreadPips, quoteAgeMs, dataQuality: waitReason ? "INSUFFICIENT" : "VALID", qualityScore, missingFields: missing,
      providerConsistency: fallback ? (waitReason === "DATA_MISMATCH" ? "MISMATCH" : "CONSISTENT") : "NOT_AVAILABLE",
      session: request.context.session || sessionAt(now), candleState: request.context.candleState, candles1m: request.context.candles1m,
      context5m: request.context.context5m, context15m: request.context.context15m, professional: request.context.professional,
      microstructure: request.context.microstructure, news, macro, modelVersion: request.context.modelVersion,
      featureVersion: request.context.featureVersion, providerVersion: q.providerVersion,
    };
    const payloadHash = hash(payload);
    const sourceIdentityHash = hash([q.provider, q.pair, q.providerTimestamp, q.bid, q.ask, q.providerVersion]);
    const snapshotId = `s_${sourceIdentityHash.slice(0, 32)}`;
    const tradeId = `t_${hash([snapshotId, q.pair, q.providerTimestamp, request.context.modelVersion, request.context.featureVersion]).slice(0, 32)}`;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = Number(this.store.db.prepare(`INSERT OR IGNORE INTO trace1m_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        snapshotId, now, q.providerTimestamp, q.receivedAt, q.pair, q.provider, q.providerRole, q.bid, q.ask, payload.mid, spread, spreadPips,
        quoteAgeMs, qualityScore, payload.dataQuality, payload.session, request.context.modelVersion, request.context.featureVersion, q.providerVersion,
        JSON.stringify(payload), payloadHash, now,
      ).changes) > 0;
      if (inserted) {
        const actualEntry = researchDecision === "WAIT" ? null : now;
        this.store.db.prepare(`INSERT INTO trace1m_decisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          tradeId, snapshotId, q.pair, now, now, actualEntry, actualEntry === null ? null : actualEntry + 60_000,
          researchDecision, productionDecision, waitReason, actualEntry === null ? null : q.bid, actualEntry === null ? null : q.ask,
          request.context.modelVersion, request.context.featureVersion, JSON.stringify({ gateEvidence: gate ?? null, gateProven }), now,
        );
        this.audit(snapshotId, "data_received", q.receivedAt, { provider: q.provider, providerTimestamp: q.providerTimestamp, bid: q.bid, ask: q.ask });
        this.audit(snapshotId, "snapshot_created", now, { provider: q.provider, payloadHash });
        this.audit(tradeId, "decision_created", now, { researchDecision, productionDecision, waitReason });
        if (actualEntry !== null) this.audit(tradeId, "entry_fixed", now, { expiryTimestamp: actualEntry + 60_000 });
      }
      this.store.db.exec("COMMIT");
      return { snapshotId, tradeId, researchDecision, productionDecision, waitReason, inserted };
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
  }

  finalize(tradeId: string, exit: QuoteObservation, costReturn = 0, now = Date.now(), maxExitDelayMs = 30_000): boolean {
    const row = this.store.db.prepare("SELECT research_decision, actual_entry_timestamp, expiry_timestamp, entry_bid, entry_ask, pair FROM trace1m_decisions WHERE trade_id=?").get(tradeId) as Record<string, unknown> | undefined;
    if (!row || row.research_decision === "WAIT") throw new Error("Trade is not actionable");
    validateQuote(exit, now);
    if (exit.pair !== row.pair || exit.providerTimestamp < Number(row.expiry_timestamp) || exit.providerTimestamp > Number(row.expiry_timestamp) + maxExitDelayMs) throw new Error("Exit quote is not causal within expiry tolerance");
    if (!Number.isFinite(costReturn) || costReturn < 0) throw new Error("Invalid fees/slippage cost return");
    const gross = row.research_decision === "BUY" ? (exit.bid - Number(row.entry_ask)) / Number(row.entry_ask) : (Number(row.entry_bid) - exit.ask) / Number(row.entry_bid);
    const net = gross - Math.max(0, costReturn);
    const outcome = net > 0 ? "WIN" : "LOSS";
    const outcomeId = `o_${hash([tradeId, exit.provider, exit.providerTimestamp, exit.bid, exit.ask]).slice(0, 32)}`;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const changes = Number(this.store.db.prepare("INSERT OR IGNORE INTO trace1m_outcomes VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(outcomeId, tradeId, exit.providerTimestamp, exit.bid, exit.ask, gross, Math.max(0, costReturn), net, outcome, JSON.stringify({ provider: exit.provider, receivedAt: exit.receivedAt, expiryDelayMs: exit.providerTimestamp - Number(row.expiry_timestamp), costModel: "executable-spread-plus-fees-v1" }), now).changes);
      if (changes) {
        this.audit(tradeId, "expiry_reached", exit.providerTimestamp, { provider: exit.provider });
        this.audit(tradeId, "outcome_calculated", now, { gross, costReturn, net, outcome });
        this.audit(tradeId, "trade_finalized", now, { outcomeId });
      }
      this.store.db.exec("COMMIT");
      return changes > 0;
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
  }

  status(): TraceStatus {
    const row = this.store.db.prepare(`SELECT
      (SELECT COUNT(*) FROM trace1m_snapshots) totalSnapshots,
      (SELECT COUNT(*) FROM trace1m_decisions WHERE research_decision='WAIT') totalWAIT,
      (SELECT COUNT(*) FROM trace1m_decisions WHERE research_decision IN ('BUY','SELL')) actionableTrades,
      (SELECT COUNT(*) FROM trace1m_outcomes) evaluatedTrades,
      (SELECT COUNT(*) FROM trace1m_outcomes WHERE outcome='WIN') wins,
      (SELECT COUNT(*) FROM trace1m_outcomes WHERE outcome='LOSS') losses,
      (SELECT AVG(net_return) FROM trace1m_outcomes) currentNetEV,
      (SELECT MIN(actual_entry_timestamp) FROM trace1m_decisions WHERE research_decision IN ('BUY','SELL')) startedAt,
      (SELECT MAX(actual_entry_timestamp) FROM trace1m_decisions WHERE research_decision IN ('BUY','SELL')) lastTradeAt`).get() as Record<string, number | null>;
    const providers = (this.store.db.prepare("SELECT DISTINCT provider FROM trace1m_snapshots ORDER BY provider").all() as unknown as Array<{provider: string}>).map((x) => x.provider);
    const actionable = Number(row.actionableTrades);
    const evaluated = Number(row.evaluatedTrades);
    const wins = Number(row.wins);
    return { phase: actionable > 0 ? "PHASE_A" : "COLLECTOR_READY", startedAt: row.startedAt ?? null, totalSnapshots: Number(row.totalSnapshots), totalWAIT: Number(row.totalWAIT), actionableTrades: actionable, evaluatedTrades: evaluated, wins, losses: Number(row.losses), unknown: actionable - evaluated, currentWR: evaluated ? wins / evaluated : null, currentNetEV: row.currentNetEV ?? null, currentCoverage: Math.min(1, evaluated / 1_000), lastTradeAt: row.lastTradeAt ?? null, providers };
  }

  private audit(entityId: string, eventType: string, occurredAt: number, payload: unknown): void {
    const eventId = `e_${hash([entityId, eventType, occurredAt, payload]).slice(0, 32)}`;
    this.store.db.prepare("INSERT OR IGNORE INTO trace1m_audit_events VALUES (?,?,?,?,?,?)").run(eventId, entityId, eventType, occurredAt, JSON.stringify(payload), Date.now());
  }
}
