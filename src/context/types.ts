/**
 * Tipos de contexto (notícias / eventos / macro) da Tracecon.
 *
 * REGRA: cada item carrega fonte (URL), timestamp de publicação, título,
 * resumo, relevância, qualidade/credibilidade e origem. Conflito entre fontes
 * é registrado. Nada é inventado; se a fonte não estiver disponível, o campo
 * `available=false` e nenhum item é fabricado.
 */

/** Direção de impacto de uma notícia/evento. */
export type ContextBias = "bullish" | "bearish" | "neutral";

export interface NewsItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly url: string;
  readonly source: string;
  readonly publishedAt: number; // ms epoch
  readonly fetchedAt: number; // quando a Tracecon obteve
  readonly category: string | null;
  readonly assetTags: readonly string[];
  readonly credibility: number; // 0..1
  readonly reputation: number; // 0..100 (fonte)
  readonly bias: ContextBias | null; // só se derivado de dados, senão null
}

/** Resultado de uma busca de notícias. */
export interface NewsResult {
  readonly available: boolean;
  readonly items: readonly NewsItem[];
  readonly fetchedAt: number;
  readonly source: string;
  readonly note?: string; // ex.: "PROVIDER_NOT_CONFIGURED" | "cache" | limite
}

/** Interface de um serviço de notícias. */
export interface NewsProvider {
  readonly id: string;
  searchNews(params: { query: string; asset?: string; limit?: number }): Promise<NewsResult>;
}
