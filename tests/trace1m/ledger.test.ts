import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Datastore } from "../../src/store/db";
import { causalMacro, causalNews, Trace1mLedger, type CollectRequest, type QuoteObservation } from "../../src/trace1m/ledger";

const NOW = 1_800_000_000_000;
const quote = (overrides: Partial<QuoteObservation> = {}): QuoteObservation => ({ pair: "EUR/USD", provider: "oanda", providerRole: "PRIMARY", providerTimestamp: NOW - 100, receivedAt: NOW - 50, bid: 1.1, ask: 1.1001, pipSize: 0.0001, providerVersion: "test", ...overrides });
const request = (overrides: Partial<CollectRequest> = {}): CollectRequest => ({ quote: quote(), context: { session: "LONDON", candleState: {}, candles1m: [], context5m: [], context15m: [], professional: {}, microstructure: {}, news: [], macro: [], modelVersion: "m1", featureVersion: "f1", historySufficient: true, newsFresh: true, calendarFresh: true }, researchDecision: "BUY", productionGatePassed: false, now: NOW, ...overrides });

describe("TRACE_1M immutable causal ledger", () => {
  let store: Datastore;
  let ledger: Trace1mLedger;
  beforeEach(() => { store = new Datastore({ path: ":memory:" }); ledger = new Trace1mLedger(store); });
  afterEach(() => store.close());

  it("is append-only and deduplicates deterministic snapshots/trades", () => {
    const first = ledger.collect(request());
    const duplicate = ledger.collect(request({ now: NOW + 1_000 }));
    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(ledger.status().totalSnapshots).toBe(1);
    expect(() => store.db.prepare("UPDATE trace1m_snapshots SET bid=2").run()).toThrow(/append-only/);
    expect(() => store.db.prepare("DELETE FROM trace1m_decisions").run()).toThrow(/append-only/);
  });

  it("keeps research separate and production fail-closed", () => {
    const result = ledger.collect(request());
    expect(result.researchDecision).toBe("BUY");
    expect(result.productionDecision).toBe("WAIT");
    expect(ledger.status()).toMatchObject({ phase: "PHASE_A", actionableTrades: 1, evaluatedTrades: 0, unknown: 1 });
  });

  it("requires structured 70% gate evidence for a production decision", () => {
    const unproven = ledger.collect(request({ productionGatePassed: true }));
    expect(unproven.productionDecision).toBe("WAIT");
  });

  it("uses ask-to-bid for BUY and bid-to-ask for SELL after 60 seconds", () => {
    const buy = ledger.collect(request());
    expect(ledger.finalize(buy.tradeId, quote({ providerTimestamp: NOW + 60_000, receivedAt: NOW + 60_010, bid: 1.1003, ask: 1.1004 }), 0.00001, NOW + 60_020)).toBe(true);
    const sell = ledger.collect(request({ quote: quote({ providerTimestamp: NOW + 1_000, receivedAt: NOW + 1_010 }), now: NOW + 1_020, researchDecision: "SELL" }));
    expect(ledger.finalize(sell.tradeId, quote({ providerTimestamp: NOW + 61_020, receivedAt: NOW + 61_030, bid: 1.0997, ask: 1.0998 }), 0, NOW + 61_040)).toBe(true);
    expect(ledger.status()).toMatchObject({ wins: 2, losses: 0, evaluatedTrades: 2 });
  });

  it("rejects late or malformed exit quotes", () => {
    const trade = ledger.collect(request());
    expect(() => ledger.finalize(trade.tradeId, quote({ providerTimestamp: NOW + 100_000, receivedAt: NOW + 100_010 }), 0, NOW + 100_020)).toThrow(/expiry tolerance/);
    expect(() => ledger.finalize(trade.tradeId, quote({ providerTimestamp: NOW + 60_000, receivedAt: NOW + 60_010, bid: Number.NaN }), 0, NOW + 60_020)).toThrow(/Invalid executable/);
  });

  it.each([
    ["DATA_STALE", request({ quote: quote({ providerTimestamp: NOW - 10_000 }) })],
    ["SPREAD_HIGH", request({ quote: quote({ ask: 1.101 }) })],
    ["INSUFFICIENT_HISTORY", request({ context: { ...request().context, news: null } })],
    ["LOW_CONFIDENCE", request({ confidence: 0.2 })],
  ])("records %s as WAIT without counting a trade", (reason, input) => {
    const result = ledger.collect(input);
    expect(result).toMatchObject({ researchDecision: "WAIT", waitReason: reason });
    expect(ledger.status()).toMatchObject({ totalWAIT: 1, actionableTrades: 0 });
  });

  it("forces WAIT when independent providers disagree", () => {
    const result = ledger.collect(request({ fallbackQuote: quote({ provider: "secondary", providerRole: "FALLBACK", bid: 1.102, ask: 1.1021 }) }));
    expect(result).toMatchObject({ researchDecision: "WAIT", waitReason: "DATA_MISMATCH" });
  });

  it("rejects malformed fallback provenance and clocks", () => {
    expect(() => ledger.collect(request({ fallbackQuote: quote({ provider: "secondary", providerRole: "PRIMARY" }) }))).toThrow(/provenance/);
    expect(() => ledger.collect(request({ fallbackQuote: quote({ provider: "secondary", providerRole: "FALLBACK", bid: Number.NaN }) }))).toThrow(/Invalid executable/);
  });

  it("rejects invalid/future quote clocks and future news/macro knowledge", () => {
    expect(() => ledger.collect(request({ quote: quote({ providerTimestamp: NOW + 1 }) }))).toThrow(/future quote/);
    expect(causalNews([{ publishedAt: NOW + 1, receivedAt: NOW + 2, currencies: ["USD"], impact: "high", source: "wire", eventType: "CPI" }], NOW)).toEqual([]);
    expect(causalNews([{ publishedAt: Number.NaN, receivedAt: NOW, currencies: [], impact: "", source: "wire", eventType: "" }], NOW)).toEqual([]);
    expect(causalMacro([{ scheduledAt: NOW - 1, publishedAt: NOW + 1, receivedAt: NOW, currency: "USD", importance: "high", eventType: "CPI", source: "calendar" }], NOW)).toEqual([]);
    expect(causalMacro([{ scheduledAt: NOW - 1, receivedAt: NOW, currency: "USD", importance: "high", eventType: "CPI", actual: 3.1, source: "calendar" }], NOW)).toEqual([]);
  });

  it("resumes counters from the persistent ledger", () => {
    ledger.collect(request());
    const resumed = new Trace1mLedger(store);
    expect(resumed.status()).toMatchObject({ totalSnapshots: 1, actionableTrades: 1 });
  });
});
