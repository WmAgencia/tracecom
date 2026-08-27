import { describe, expect, it } from "vitest";
import { NewsService } from "../../src/context/service";
import type { NewsItem, NewsProvider, NewsResult } from "../../src/context/types";

function mk(title: string, credibility = 0.5, summary = ""): NewsItem {
  return {
    id: title, title, summary: summary || null, url: "https://x.com/a", source: "src",
    publishedAt: Date.now(), fetchedAt: Date.now(), category: "bitcoin", assetTags: ["BTC"],
    credibility, reputation: 50, bias: null,
  };
}

/** Provider fake usado apenas para testar cache/bias (não integra dados). */
class FakeNewsProvider implements NewsProvider {
  id = "fake";
  constructor(private readonly items: NewsItem[], private calls = { n: 0 }) {}
  async searchNews(): Promise<NewsResult> {
    this.calls.n++;
    return { available: true, items: this.items, fetchedAt: Date.now(), source: this.id };
  }
  get callCount(): number {
    return this.calls.n;
  }
}

describe("NewsService", () => {
  it("sem provider → PROVIDER_NOT_CONFIGURED (nunca inventa)", async () => {
    const svc = new NewsService({ provider: null });
    const r = await svc.searchNews({ query: "BTC" });
    expect(r.available).toBe(false);
    expect(r.note).toBe("PROVIDER_NOT_CONFIGURED");
    expect(r.items).toHaveLength(0);
  });

  it("cache evita chamadas repetidas dentro do TTL", async () => {
    const p = new FakeNewsProvider([mk("title")]);
    const svc = new NewsService({ provider: p, cacheTtlMs: 60_000 });
    await svc.searchNews({ query: "a" });
    const r = await svc.searchNews({ query: "a" });
    expect(p.callCount).toBe(1);
    expect(r.note).toBe("cache");
  });

  it("deriveBias: palavras-chave bullish > bearish → bullish", () => {
    const svc = new NewsService({ provider: null });
    expect(svc.deriveBias([mk("BTC surges to record high after approval and inflows", 0.7)])).toBe("bullish");
  });

  it("deriveBias: bearish supera → bearish", () => {
    const svc = new NewsService({ provider: null });
    expect(svc.deriveBias([mk("Exchange hack leads to flash crash, sells and outflow", 0.7)])).toBe("bearish");
  });

  it("deriveBias: sem itens → null (não inventa sentimento)", () => {
    const svc = new NewsService({ provider: null });
    expect(svc.deriveBias([])).toBeNull();
  });

  it("quality soma credibilidade média", () => {
    const svc = new NewsService({ provider: null });
    const q = svc.quality([mk("a", 0.6), mk("b", 0.4)]);
    expect(q.total).toBe(2);
    expect(q.avgCredibility).toBeCloseTo(0.5, 2);
  });
});
