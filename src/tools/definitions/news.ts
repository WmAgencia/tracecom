/**
 * Ferramenta de busca de notícias / contexto (Etapa 6) para o agente (Groq).
 *
 * Retorna notícias reais verificadas (com fonte, timestamp, credibilidade) e um
 * viés léxico derivado. Se a fonte não estiver configurada, retorna
 * `PROVIDER_NOT_CONFIGURED` — nunca inventa notícia.
 */
import { z } from "zod";
import type { ToolRegistry } from "../registry";
import type { NewsService } from "../../context/service";

const schema = z.object({
  query: z.string().min(1).describe("Tema/ativo a pesquisar."),
  asset: z.string().optional().describe("Ativo (ex.: BTC/ETH) para categorizar."),
});

export function registerNewsTools(registry: ToolRegistry, service: NewsService): void {
  registry.register({
    name: "search_news",
    description:
      "Buscar notícias recentes e verificadas (título, fonte, URL, timestamp, credibilidade) sobre um ativo/tema. Retorna também um viés léxico de sentimento — NUNCA inventa notícia: se a fonte não estiver disponível, informa.",
    schema,
    handler: async (args) => {
      const res = await service.searchNews({ query: args.query, asset: args.asset, limit: 8 });
      if (!res.available) {
        return { availability: "UNAVAILABLE", message: res.note ?? "Fonte de notícias indisponível." };
      }
      const bias = service.deriveBias(res.items);
      return {
        availability: "AVAILABLE",
        source: res.source,
        fetchedAt: res.fetchedAt,
        bias,
        quality: service.quality(res.items),
        items: res.items.map((n) => ({
          title: n.title,
          summary: n.summary,
          url: n.url,
          source: n.source,
          publishedAt: n.publishedAt,
          credibility: n.credibility,
          reputation: n.reputation,
          category: n.category,
        })),
      };
    },
  });
}
