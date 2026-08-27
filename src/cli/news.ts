/**
 * CLI de Notícias / Contexto (Etapa 6).
 *
 *   npm run news BTC
 */
import { loadConfig } from "../config/env";
import { createMarketRuntime } from "../market/runtime";

async function main(): Promise<void> {
  const config = loadConfig();
  const asset = process.argv[2] ?? "bitcoin";
  const rt = createMarketRuntime(config, { symbols: [] });

  console.log(`Buscando notícias reais: ${asset}`);
  const res = await rt.news.searchNews({ query: asset, asset, limit: 8 });
  if (!res.available) {
    console.log("Notícias: indisponíveis —", res.note ?? "PROVIDER_NOT_CONFIGURED");
    return;
  }
  const bias = rt.news.deriveBias(res.items);
  const quality = rt.news.quality(res.items);
  console.log(`Fonte: ${res.source} | viés léxico: ${bias} | itens: ${quality.total} | cred média: ${quality.avgCredibility.toFixed(2)}`);
  console.log("");
  for (const n of res.items) {
    console.log(`• [${new Date(n.publishedAt).toISOString()}] (${n.source} · cred ${n.credibility})`);
    console.log(`    ${n.title}`);
    if (n.summary) console.log(`    ${n.summary.slice(0, 160)}`);
    console.log(`    ${n.url}`);
  }
  rt.stop();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
