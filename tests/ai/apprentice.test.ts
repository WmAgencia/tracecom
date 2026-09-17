/** Fase 5.1 — MENTOR + APRENDIZ: tecnicas proprias em shadow, licoes de LOSS, promocao com evidencia, nunca ordem. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const apprenticeModule = await import("../../relay/apprentice.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const feedsModule = await import("../../relay/external-feeds.mjs");
const { ApprenticeDesk, TECHNIQUE_SEEDS, TECHNIQUE_BOUNDS, APPRENTICE_DEFAULTS, evaluateTechnique } = apprenticeModule as unknown as Record<string, any>;
const { parseMacroCalendar, parseNewsRss, normalKeysForCurrencies, ExternalFeedSync } = feedsModule as unknown as Record<string, any>;

const fixture = JSON.parse(readFileSync(new URL("../fixtures/frozen-candles-10h.json", import.meta.url), "utf8")) as { candles: Array<{ bucket: number; open: number; high: number; low: number; close: number }> };
const candles = () => fixture.candles.map((candle) => ({ start: candle.bucket, bucketStart: candle.bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close }));
const base = 1_700_000_000_000;
const contextOf = (adx: number, rsi: number, position = 0.5, streak = 1) => ({ deterministicIndicators: { rsi14: { value: rsi }, adx14: { value: adx }, diSpread: { value: 8 }, atrNormalized: { value: 0.0004 }, donchianPosition: { value: position } }, microstructure: { streak } });

describe("APRENDIZ — mesa de laboratorio (shadow-only)", () => {
  it("executa SEMPRE em shadow: nenhum caminho de ordem existe", () => {
    expect(APPRENTICE_DEFAULTS.execution).toBe("SHADOW_ONLY");
    const source = readFileSync(new URL("../../relay/apprentice.mjs", import.meta.url), "utf8");
    expect(source.includes("requestOrder")).toBe(false);
    expect(source.includes("executionGate")).toBe(false);
    expect(source.includes("placeOrder")).toBe(false);
    const desk = new ApprenticeDesk({ now: () => base }) as any;
    expect(desk.scoreboard().execution).toBe("SHADOW_ONLY");
  });
  it("avaliacao das tecnicas e causal (usa apenas features/contexto do instante)", () => {
    const rsiTech = TECHNIQUE_SEEDS.find((seed: any) => seed.id === "T1_RSI_REVERSION");
    expect(evaluateTechnique(rsiTech, { s: 0 }, contextOf(10, 25, 0.1, 0))).toBe("BUY");
    expect(evaluateTechnique(rsiTech, { s: 0 }, contextOf(10, 75, 0.9, 0))).toBe("SELL");
    const trendTech = TECHNIQUE_SEEDS.find((seed: any) => seed.id === "T5_DI_TREND");
    expect(evaluateTechnique(trendTech, { s: 0.4 }, contextOf(30, 55, 0.5, 1))).toBe("BUY");
    expect(evaluateTechnique(trendTech, { s: 0.4 }, contextOf(12, 55, 0.5, 1))).toBeNull();
    expect(evaluateTechnique(rsiTech, null, contextOf(10, 25))).toBeNull();
  });
  it("roda todas as tecnicas em shadow por candle e liquida causalmente", () => {
    const desk = new ApprenticeDesk({ now: () => base }) as any;
    const list = candles();
    let opened = 0, settled = 0;
    for (const candle of list) {
      const index = list.indexOf(candle);
      const out = desk.observeCandle({ marketKey: "EURUSD:OTC", marketType: "OTC", candles: list, index, features: null, context: null, payout: 85, atMs: candle.bucketStart });
      opened += out.opened; settled += out.settled;
    }
    expect(opened).toBe(0); // sem features nao abre (causal)
    // agora com features determinísticas por candle
    for (let index = 30; index < list.length; index += 1) {
      const out = desk.observeCandle({ marketKey: "EURUSD:OTC", marketType: "OTC", candles: list, index, features: { rsi14: 28, s: -0.5, r24: -0.001 }, context: contextOf(12, 28, 0.1, -2), payout: 85, atMs: list[index]!.bucketStart });
      opened += out.opened; settled += out.settled;
    }
    expect(opened).toBeGreaterThan(0);
    expect(settled).toBeGreaterThan(0);
    const trades = desk.recentTrades(200);
    for (const trade of trades) expect(trade.settlementBucket).toBeGreaterThanOrEqual(trade.entryBucket + 45_000);
  });
  it("mentor extrai licao do LOSS e propoe ajuste limitado dentro dos bounds", () => {
    const desk = new ApprenticeDesk({ now: () => base }) as any;
    const lesson = desk.mentorAnalyzeLoss("EURUSD:OTC", "OTC", { techniqueId: "T5_DI_TREND", direction: "BUY", entryPrice: 1.1, entryBucket: base, entryFeatures: { adx14: 12, streak: -2, position: 0.9, s: 0.4 } }, { close: 1.09, bucketStart: base + 60_000 }, { atMs: base });
    expect(lesson).toBeTruthy();
    expect(lesson.reasons.length).toBeGreaterThan(0);
    expect(lesson.candidateId).toBeTruthy();
    const candidate = desk.techniques.get(lesson.candidateId);
    expect(candidate.status).toBe("CANDIDATE");
    expect(candidate.generation).toBe(2);
    for (const [name, value] of Object.entries(lesson.adjustment.params)) {
      const bounds = TECHNIQUE_BOUNDS[name];
      if (bounds) { expect(Number(value)).toBeGreaterThanOrEqual(bounds[0]); expect(Number(value)).toBeLessThanOrEqual(bounds[1]); }
    }
  });
  it("promocao exige amostra/vantagem/cooldown (nunca 'ultimos 10')", () => {
    const desk = new ApprenticeDesk({ now: () => base }) as any;
    desk.techniques.set("CAND_X", { id: "CAND_X", label: "cand", status: "CANDIDATE", generation: 2, params: { ...TECHNIQUE_SEEDS[0].params }, parent: desk.currentTechniqueId, createdAt: base });
    const stats = (trades: number, pnl: number) => ({ trades, wins: Math.round(trades * 0.7), losses: Math.round(trades * 0.3), draws: 0, pnl, lastResults: [], maxDrawdown: 1, equity: pnl, peak: pnl, lessons: 0 });
    desk.markets.set("EURUSD:OTC", { stats: new Map([[desk.currentTechniqueId, stats(200, 10)], ["CAND_X", stats(30, 9)]]), open: new Map(), trades: [] });
    const review = desk.review({ marketKey: "EURUSD:OTC" });
    expect(review.decision).toBe("PROMOTE");
    expect(desk.currentTechniqueId).toBe("CAND_X");
    // cooldown imediato bloqueia nova promocao
    desk.techniques.set("CAND_Y", { id: "CAND_Y", label: "cand2", status: "CANDIDATE", generation: 3, params: { ...TECHNIQUE_SEEDS[0].params }, parent: "CAND_X", createdAt: base });
    desk.markets.get("EURUSD:OTC").stats.set("CAND_Y", stats(40, 30));
    const second = desk.review({ marketKey: "EURUSD:OTC" });
    expect(second.decision).toBe("HOLD_COOLDOWN");
  });
  it("restart preserva tecnica atual, licoes e promocoes", () => {
    const desk = new ApprenticeDesk({ now: () => base }) as any;
    desk.currentTechniqueId = "T3_MOMENTUM";
    desk.lessons.push({ id: 1, reasons: [{ code: "ADX_FRACO" }], adjustment: { params: { minAdx: 22 } } });
    desk.promotions.push({ id: 2, from: "T1_RSI_REVERSION", to: "T3_MOMENTUM", delta: 0.2 });
    const reloaded = new ApprenticeDesk({ now: () => base }) as any;
    expect(reloaded.loadFrom(desk.toJSON())).toBe(true);
    expect(reloaded.currentTechniqueId).toBe("T3_MOMENTUM");
    expect(reloaded.lessons).toHaveLength(1);
    expect(reloaded.promotions).toHaveLength(1);
  });
});

describe("FEEDS EXTERNOS — reais, point-in-time, NORMAL-only", () => {
  it("calendario macro: publica apenas eventos High/Medium com mercado NORMAL afetado", () => {
    const now = base;
    const rows = [
      { title: "CPI", country: "US", date: new Date(now + 3_600_000).toISOString(), impact: "High", forecast: "3.1%", previous: "3.0%" },
      { title: "Low impact", country: "US", date: new Date(now + 3_600_000).toISOString(), impact: "Low" },
      { title: "Antigo", country: "EU", date: new Date(now - 12 * 3_600_000).toISOString(), impact: "High" },
    ];
    const universe = [{ canonical: "EURUSD", marketType: "NORMAL", currencies: ["EUR", "USD"] }, { canonical: "EURUSD", marketType: "OTC", currencies: ["EUR", "USD"] }];
    const items = parseMacroCalendar(rows, { universe, now }) as any[];
    expect(items).toHaveLength(1);
    expect(items[0].payload.title).toBe("CPI");
    expect(items[0].meta.marketsAffected).toEqual(["EURUSD:NORMAL"]);
    expect(items[0].meta.marketsAffected.includes("EURUSD:OTC")).toBe(false);
    expect(items[0].meta.publishedAt).toBeGreaterThan(now);
  });
  it("RSS de noticias: extrai pubDate (point-in-time) e moedas do titulo", () => {
    const now = base;
    const xml = `<rss><channel><item><title>EUR/USD sobe com dados dos EUA</title><pubDate>${new Date(now - 60_000).toUTCString()}</pubDate></item><item><title>Sem data</title></item></channel></rss>`;
    const universe = [{ canonical: "EURUSD", marketType: "NORMAL", currencies: ["EUR", "USD"] }];
    const items = parseNewsRss(xml, { universe, now }) as any[];
    expect(items).toHaveLength(1);
    expect(items[0].payload.currencies.sort()).toEqual(["EUR", "USD"]);
    expect(items[0].meta.marketsAffected).toEqual(["EURUSD:NORMAL"]);
    expect(items[0].meta.sourceType).toBe("EXTERNAL");
  });
  it("falha de rede NUNCA inventa: mantem NO_FEED e reporta erro", async () => {
    const published: any[] = [];
    const sync = new ExternalFeedSync({ fetchImpl: async () => { throw new Error("ENETUNREACH"); }, apply: (kind: string, items: any[]) => published.push({ kind, items }), universe: [], now: () => base }) as any;
    await sync.syncMacro(); await sync.syncNews();
    expect(published).toHaveLength(0);
    expect(sync.status().state.MACRO.status).toBe("NO_FEED");
    expect(sync.status().state.NEWS.status).toBe("NO_FEED");
    expect(sync.status().state.MACRO.lastError).toContain("ENETUNREACH");
  });
  it("normalKeysForCurrencies nunca inclui OTC", () => {
    const universe = [{ canonical: "EURUSD", marketType: "NORMAL", currencies: ["EUR", "USD"] }, { canonical: "EURUSD", marketType: "OTC", currencies: ["EUR", "USD"] }];
    expect(normalKeysForCurrencies(["USD"], universe)).toEqual(["EURUSD:NORMAL"]);
  });
});
