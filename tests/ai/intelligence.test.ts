/** Fase 5 — Global Intelligence State: point-in-time, TTL, NO_FEED honesto e isolamento NORMAL/OTC. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const intelligence = await import("../../relay/intelligence.mjs");
const { GlobalIntelligenceState, INTELLIGENCE_DOMAINS, normalizeExternalItem } = intelligence as unknown as Record<string, any>;

describe("INTELLIGENCE — snapshots point-in-time e TTL", () => {
  it("informacao futura nunca aparece no passado; expirada nao entra em decisao", () => {
    let now = 1_000_000;
    const state = new GlobalIntelligenceState({ now: () => now }) as any;
    state.publish("MACRO", { event: "CPI" }, { source: "test", sourceType: "EXTERNAL", observedAt: now, publishedAt: now, ttlMs: 60_000, marketsAffected: ["EURUSD:NORMAL"] });
    expect(state.snapshot("MACRO", { atMs: now - 1 })).toBeNull();
    expect(state.snapshot("MACRO", { atMs: now }).payload.event).toBe("CPI");
    now += 60_001;
    expect(state.snapshot("MACRO", { atMs: now })).toBeNull();
  });
  it("publicacao depois da decisao nao retroage (point-in-time correto)", () => {
    let now = 5_000_000;
    const state = new GlobalIntelligenceState({ now: () => now }) as any;
    state.publish("MACRO", { event: "PRE" }, { source: "test", ttlMs: 600_000, marketsAffected: ["EURUSD:NORMAL"] });
    const decisionAt = now;
    now += 1_000;
    state.publish("MACRO", { event: "POS" }, { source: "test", ttlMs: 600_000, marketsAffected: ["EURUSD:NORMAL"] });
    expect(state.snapshot("MACRO", { atMs: decisionAt }).payload.event).toBe("PRE");
    expect(state.snapshot("MACRO", { atMs: now }).payload.event).toBe("POS");
  });
  it("ausencia de integracao = NO_FEED (nunca 'neutro' inventado)", () => {
    const state = new GlobalIntelligenceState({ now: () => Date.now() }) as any;
    state.publish("NEWS", {}, { source: "none", sourceType: "EXTERNAL", dataQuality: "UNAVAILABLE", status: "NO_FEED" });
    expect(state.snapshot("NEWS", {})).toBeNull();
    expect(state.status().NEWS.status).toBe("NO_FEED");
    expect(state.status().MACRO.status).toBe("NO_FEED");
  });
  it("METADATA obrigatoria e normalizada (source/sourceType/publishedAt/receivedAt/expiresAt/provenance)", () => {
    const item = normalizeExternalItem({ source: "x", sourceType: "EXTERNAL", observedAt: 100, publishedAt: 90, currenciesAffected: ["eur"], importance: 2, dataQuality: "WEIRD" }, { now: 100, defaultTtlMs: 50 }) as any;
    expect(item).toMatchObject({ source: "x", sourceType: "EXTERNAL", observedAt: 100, publishedAt: 90, receivedAt: 100, importance: 1, dataQuality: "OK" });
    expect(item.currenciesAffected).toEqual(["EUR"]);
    expect(item.expiresAt).toBe(150);
  });
});

describe("INTELLIGENCE — contexto por mercado (NORMAL != OTC)", () => {
  it("noticia de NORMAL nao se aplica a OTC; OTC e marcado experimental", () => {
    const state = new GlobalIntelligenceState({ now: () => 10_000 }) as any;
    state.publish("NEWS", { headline: "ECB" }, { source: "test", sourceType: "EXTERNAL", ttlMs: 600_000, marketsAffected: ["EURUSD:NORMAL"], currenciesAffected: ["EUR"] });
    const normal = state.contextForMarket("EURUSD:NORMAL", "NORMAL", { atMs: 10_000 });
    const otc = state.contextForMarket("EURUSD:OTC", "OTC", { atMs: 10_000 });
    expect(normal.news?.payload.headline).toBe("ECB");
    expect(otc.news).toBeNull();
    expect(otc.experimental).toBe(true);
    // mesmo com noticia marcada para o OTC, o contexto permanece experimental
    state.publish("NEWS", { headline: "OTC-NEWS" }, { source: "test", sourceType: "EXTERNAL", ttlMs: 600_000, marketsAffected: ["EURUSD:OTC"], currenciesAffected: ["EUR"] });
    const otc2 = state.contextForMarket("EURUSD:OTC", "OTC", { atMs: 10_000 });
    expect(otc2.news?.payload.headline).toBe("OTC-NEWS");
    expect(otc2.experimental).toBe(true);
    expect(String(otc2.note)).toContain("experimental");
  });
  it("status expoe dominios, versao e idade sem inventar payload", () => {
    const state = new GlobalIntelligenceState({ now: () => 20_000 }) as any;
    expect(Object.keys(state.status()).sort()).toEqual([...INTELLIGENCE_DOMAINS].sort());
    state.publish("RISK", { openPositions: 1 }, { source: "rt" });
    const status = state.status().RISK;
    expect(status.status).toBe("OK");
    expect(status.ageMs).toBe(0);
    expect(status.sourceType).toBe("INTERNAL");
  });
});
