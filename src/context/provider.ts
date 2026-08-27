/**
 * NewsProvider via Free Crypto News API (cryptocurrency.cv) — verificada.
 *
 * Fonte real: `https://cryptocurrency.cv/api/news?category=<asset>&lang=en`
 * retorna artigos com título, link, pubDate, fonte, credibilidade e reputação.
 * Keyless no free tier (verificado). `/breaking` e alguns endpoints exigem
 * plano pago (402) — não usados.
 *
 * NOTE: sem credencial de provedor comercial, esta é a fonte padrão. Cache é
 * feito no serviço (não duplicar chamadas a cada candle).
 */
import type { NewsItem, NewsProvider, NewsResult } from "./types";

const BASE = "https://cryptocurrency.cv/api";

export interface CvApiArticle {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  source?: string;
  category?: string;
  credibility?: number;
  reputation?: number;
  author?: string;
}

export class FreeCryptoNewsProvider implements NewsProvider {
  readonly id = "free-crypto-news";

  async searchNews(params: { query?: string; asset?: string; limit?: number }): Promise<NewsResult> {
    try {
      const category = (params.asset ?? params.query ?? "bitcoin").toLowerCase();
      const url = `${BASE}/news?category=${encodeURIComponent(category)}&lang=en`;
      const res = await fetch(url, { headers: { "User-Agent": "tracecon/0.1" } });
      if (!res.ok) {
        return { available: false, items: [], fetchedAt: Date.now(), source: this.id, note: `HTTP ${res.status}` };
      }
      const json = (await res.json()) as { articles?: CvApiArticle[] };
      const limit = params.limit ?? 10;
      const items: NewsItem[] = (json.articles ?? [])
        .slice(0, limit)
        .map((a, i) => normalize(a, category, i));
      return { available: true, items, fetchedAt: Date.now(), source: this.id };
    } catch {
      return { available: false, items: [], fetchedAt: Date.now(), source: this.id, note: "fetch falhou" };
    }
  }
}

function normalize(a: CvApiArticle, category: string, idx: number): NewsItem {
  const publishedAt = a.pubDate ? Date.parse(a.pubDate) : Date.now();
  return {
    id: `${a.source ?? "cv"}:${a.link ?? idx}:${publishedAt}`,
    title: a.title,
    summary: a.description ?? null,
    url: a.link,
    source: a.source ?? "unknown",
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    fetchedAt: Date.now(),
    category: a.category ?? category,
    assetTags: mapAssetTags(category),
    credibility: a.credibility ?? 0.5,
    reputation: a.reputation ?? 0,
    bias: null, // bias só é atribuído por análise (derivada), nunca presumido
  };
}

function mapAssetTags(category: string): string[] {
  const c = category.toLowerCase();
  if (c.includes("bitcoin") || c.includes("btc")) return ["BTC"];
  if (c.includes("ethereum") || c.includes("eth")) return ["ETH"];
  if (c.includes("solana") || c.includes("sol")) return ["SOL"];
  if (c) return [c.toUpperCase()];
  return [];
}
