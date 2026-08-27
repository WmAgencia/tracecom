/**
 * NewsService — busca notícias com cache em memória (para não chamar a fonte a
 * cada candle / para uso em timeframes curtos) e derivação explícita de um viés
 * por palavras-chave (documentado — não é "achismo": é um classificador léxico
 * simples, marcado pela fonte e sem afirmar causalidade de preço).
 */
import type { ContextBias, NewsItem, NewsProvider, NewsResult } from "./types";

export interface NewsServiceOptions {
  readonly provider: NewsProvider | null;
  readonly cacheTtlMs?: number;
  readonly logger?: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void };
}

interface CacheEntry {
  readonly result: NewsResult;
  readonly at: number;
}

const BULLISH_WORDS = ["surge", "rally", "record high", "approval", "adoption", "inflow", "bullish", "break above", "recovery", "buy", "upgrade", "partner"];
const BEARISH_WORDS = ["crash", "plunge", "dump", "loss", "sells", "flash crash", "bearish", "outflow", "hack", "exploit", "ban", "warning", "decline", "lawsuit"];

export class NewsService {
  private readonly provider: NewsProvider | null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly log?: NewsServiceOptions["logger"];

  constructor(opts: NewsServiceOptions) {
    this.provider = opts.provider;
    this.ttl = opts.cacheTtlMs ?? 30_000;
    this.log = opts.logger;
  }

  async searchNews(params: { query: string; asset?: string; limit?: number }): Promise<NewsResult> {
    if (!this.provider) {
      return { available: false, items: [], fetchedAt: Date.now(), source: "none", note: "PROVIDER_NOT_CONFIGURED" };
    }
    const key = `${params.query}:${params.asset ?? ""}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttl) {
      return { ...cached.result, note: "cache" };
    }
    const result = await this.provider.searchNews(params);
    this.cache.set(key, { result, at: Date.now() });
    return result;
  }

  /** Deriva um viés léxico a partir de títulos/resumos (NUNCA inventa dados). */
  deriveBias(items: readonly NewsItem[]): ContextBias | null {
    if (items.length === 0) return null;
    let bull = 0;
    let bear = 0;
    for (const item of items) {
      const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      for (const w of BULLISH_WORDS) if (text.includes(w)) bull += item.credibility;
      for (const w of BEARISH_WORDS) if (text.includes(w)) bear += item.credibility;
    }
    if (bull === bear) return "neutral";
    return bull > bear ? "bullish" : "bearish";
  }

  /** Resumo de assinatura de reputação/credibilidade (p/ auditoria de qualidade). */
  quality(items: readonly NewsItem[]): { avgCredibility: number; total: number } {
    if (items.length === 0) return { avgCredibility: 0, total: 0 };
    return {
      avgCredibility: items.reduce((s, i) => s + i.credibility, 0) / items.length,
      total: items.length,
    };
  }
}
