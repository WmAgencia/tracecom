// fetch_candles.ts — baixa candles da Binance em batches de 1000.
// Uso: npx tsx fetch_candles.ts
import { writeFileSync } from "node:fs";

const SYMBOL = "BTCUSDT";
const INTERVAL = "1h";
const LIMIT = 1000;
const TARGET_TOTAL = 2160;

// 90 dias atrás, em ms.
const now = Date.now();
const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

interface BinanceKline {
  // [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
  [n: number]: string | number;
}

async function fetchBatch(startTime: number): Promise<BinanceKline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}&startTime=${startTime}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao chamar Binance: ${await res.text()}`);
  }
  return res.json() as Promise<BinanceKline[]>;
}

async function main() {
  const all: BinanceKline[] = [];
  let startTime = ninetyDaysAgo;

  while (all.length < TARGET_TOTAL) {
    console.error(`Buscando batch a partir de ${new Date(startTime).toISOString()}...`);
    const batch = await fetchBatch(startTime);
    if (batch.length === 0) {
      console.error("API retornou batch vazio — parando.");
      break;
    }
    all.push(...batch);
    const lastTs = batch[batch.length - 1]![0] as number;
    const nextStart = lastTs + 60 * 60 * 1000; // +1h
    if (nextStart >= now) break;
    startTime = nextStart;
    // evitar rate limit
    await new Promise((r) => setTimeout(r, 250));
  }

  // Dedup por timestamp
  const seen = new Set<number>();
  const dedup: BinanceKline[] = [];
  for (const k of all) {
    const ts = k[0] as number;
    if (seen.has(ts)) continue;
    seen.add(ts);
    dedup.push(k);
  }
  dedup.sort((a, b) => (a[0] as number) - (b[0] as number));

  const total = dedup.length;
  const first = dedup[0]!;
  const last = dedup[total - 1]!;
  console.error(`Total candles: ${total}`);
  console.error(`First: ${new Date(first[0] as number).toISOString()} close=${first[4]}`);
  console.error(`Last:  ${new Date(last[0] as number).toISOString()} close=${last[4]}`);
  console.error(`Span days: ${((last[0] as number - (first[0] as number)) / 86400000).toFixed(2)}`);

  writeFileSync("candles-btc-1h-90d.json", JSON.stringify(dedup));
  console.error("Salvo em candles-btc-1h-90d.json");
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
