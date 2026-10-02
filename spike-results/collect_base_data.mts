/**
 * Coleta de dados base (somente leitura, sem autenticação, sem operações).
 *
 * Contexto: o MCP "Iq Option" não está acessível a este agente (roteado pelo
 * backend Freebuff) e a API pública antiga da IQ (api.iqoption.com) está
 * morta. Este script coleta a BASE DE REFERÊNCIA REAL disponível hoje via os
 * provedores já integrados no repo:
 *   - Yahoo Finance chart (Forex: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD)
 *   - Binance REST klines (BTCUSDT, ETHUSDT)
 * Os pares Forex correspondem aos ATIVOS SUBJACENTES dos OTC da IQ Option,
 * mas NÃO são os feeds OTC (que só são observáveis via sessão autenticada na
 * traderoom — ver extension/README.md e src/market/providers/iqoption/provider.ts).
 *
 * Saída: CSV por (fonte, ativo, timeframe) + MANIFEST.json com janela temporal,
 * contagem, lacunas e anotação de qualidade.
 *
 * Uso: npx tsx spike-results/collect_base_data.mts [--outdir diagnostic-results/data]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BinanceRestClient } from "../src/market/providers/binance/rest";
import { YahooForexProvider } from "../src/market/providers/forex/yahoo";
import type { MarketCandle, Timeframe } from "../src/market/model";

const FX_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"] as const;
const CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;

const FX_TF: Timeframe = "1h";
const FX_1M_TF: Timeframe = "1m";
const CRYPTO_TF: Timeframe = "1h";
const CRYPTO_1M_TF: Timeframe = "1m";
const CRYPTO_1M_DAYS = 30;
const CRYPTO_1H_DAYS = 365;
const FX_1H_DAYS = 730;
const FX_1M_DAYS = 7; // máximo do Yahoo para 1m
const STEP_MS: Record<string, number> = { "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

const argOutdir = (() => {
  const i = process.argv.indexOf("--outdir");
  return i >= 0 ? process.argv[i + 1] : "diagnostic-results/data";
})();

interface CsvMeta { file: string; provider: string; symbol: string; timeframe: string; rows: number; firstTs: string | null; lastTs: string | null; windowDays: number | null; gaps: number; quality: string; source: string; note: string; }

function toCsv(candles: MarketCandle[]): string {
  const head = "timestamp_iso,timestamp_ms,open,high,low,close,volume,is_closed,provider,symbol,timeframe,source,quality,received_at_ms";
  const lines = candles.map((c) => [new Date(c.timestamp).toISOString(), c.timestamp, c.open, c.high, c.low, c.close, c.volume, c.isClosed, c.provider, c.symbol, c.timeframe, c.source, c.quality, c.receivedAt].join(","));
  return [head, ...lines].join("\n") + "\n";
}

function countGaps(candles: MarketCandle[], stepMs: number): number {
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) if (candles[i].timestamp - candles[i - 1].timestamp > stepMs) gaps++;
  return gaps;
}

/** Espaçamento modal real entre candles (detecta degradação de granularidade). */
function modalSpacingMs(candles: MarketCandle[], stepMs: number): number {
  const counts = new Map<number, number>();
  for (let i = 1; i < candles.length; i++) {
    const d = Math.round((candles[i].timestamp - candles[i - 1].timestamp) / stepMs);
    if (d > 0 && d <= 4) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let best = 1, bestN = 0;
  for (const [d, n] of counts) if (n > bestN) { best = d; bestN = n; }
  return best * stepMs;
}

function meta(file: string, candles: MarketCandle[], stepMs: number, quality: string, source: string, note: string): CsvMeta {
  const first = candles[0]?.timestamp ?? null;
  const last = candles.at(-1)?.timestamp ?? null;
  const spacing = modalSpacingMs(candles, stepMs);
  const degraded = spacing > stepMs;
  if (degraded) note += `; ATENCAO: espacamento modal real ${spacing / 60_000}min (granularidade degradada)`;
  return { file, provider: candles[0]?.provider ?? "?", symbol: candles[0]?.symbol ?? "?", timeframe: candles[0]?.timeframe ?? "?", rows: candles.length, firstTs: first ? new Date(first).toISOString() : null, lastTs: last ? new Date(last).toISOString() : null, windowDays: first && last ? Math.round(((last - first) / 86_400_000) * 10) / 10 : null, gaps: countGaps(candles, stepMs), quality: degraded ? "degraded (granularidade 2x menor que solicitada)" : quality, source, note };
}

async function main(): Promise<void> {
  mkdirSync(argOutdir, { recursive: true });
  const manifest: CsvMeta[] = [];
  const yahoo = new YahooForexProvider();
  const binance = new BinanceRestClient();
  const now = Date.now();

  // ---- Yahoo Forex (referência para os sub+jacentes dos OTC) ----
  for (const symbol of FX_SYMBOLS) {
    try {
      const res = await yahoo.getCandles({ symbol, timeframe: FX_TF, start: now - FX_1H_DAYS * 86_400_000 });
      const file = `fx_${symbol.replace("/", "")}_1h.csv`;
      writeFileSync(join(argOutdir, file), toCsv(res.candles));
      manifest.push(meta(file, res.candles, STEP_MS[FX_TF], res.quality, res.source, "Forex real; subjacente do par OTC equivalente na IQ Option (nao e o feed OTC)"));
      console.log(`${file}: ${res.candles.length} candles`);
    } catch (e) { console.error(`${symbol} ${FX_TF}: falhou (${e instanceof Error ? e.message : e})`); }
    await new Promise((r) => setTimeout(r, 400));

    try {
      const res = await yahoo.getCandles({ symbol, timeframe: FX_1M_TF, start: now - FX_1M_DAYS * 86_400_000 });
      const file = `fx_${symbol.replace("/", "")}_1m.csv`;
      writeFileSync(join(argOutdir, file), toCsv(res.candles));
      manifest.push(meta(file, res.candles, STEP_MS[FX_1M_TF], res.quality, res.source, "Forex real 1m (max ~7d no Yahoo); subjacente do OTC"));
      console.log(`${file}: ${res.candles.length} candles`);
    } catch (e) { console.error(`${symbol} ${FX_1M_TF}: falhou (${e instanceof Error ? e.message : e})`); }
    await new Promise((r) => setTimeout(r, 400));
  }

  // ---- Binance cripto (paginado 1000/req) ----
  for (const symbol of CRYPTO_SYMBOLS) {
    for (const [tf, days] of [[CRYPTO_TF, CRYPTO_1H_DAYS], [CRYPTO_1M_TF, CRYPTO_1M_DAYS]] as const) {
      try {
        const all: MarketCandle[] = [];
        let cursor = now - days * 86_400_000;
        while (cursor < now) {
          const page = await binance.klines({ symbol, timeframe: tf, start: cursor, limit: 1000 });
          if (page.length === 0) break;
          all.push(...page);
          cursor = page.at(-1)!.timestamp + STEP_MS[tf];
          if (page.length < 1000) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        const file = `crypto_${symbol}_${tf}.csv`;
        writeFileSync(join(argOutdir, file), toCsv(all));
        manifest.push(meta(file, all, STEP_MS[tf], "high", "rest:binance", "Cripto real; mercado 24/7 (referencia de volatilidade/estrutura)"));
        console.log(`${file}: ${all.length} candles`);
      } catch (e) { console.error(`${symbol} ${tf}: falhou (${e instanceof Error ? e.message : e})`); }
    }
  }

  const manifestDoc = {
    collectedAt: new Date().toISOString(),
    collector: "spike-results/collect_base_data.mts",
    read_only: true,
    credentials_used: false,
    real_orders: false,
    otc_warning: "NENHUM destes dados e o feed OTC da IQ Option. OTC so e observavel dentro de uma sessao autenticada da traderoom (WebSocket 'candle-generated'); a ponte suportada no repo e a extensao read-only -> POST /api/iq-option/ingest com MARKET_DATA_MODE=iqoption. O MCP 'Iq Option' nao esta acessivel a este agente (roteado pelo backend Freebuff) e a API publica antiga (api.iqoption.com) responde 404.",
    mcp_id_hint: "Iq Option WPMPEwG_E8iHtgzS2P__gRBI-dDNhSNccZmjvlVj",
    files: manifest,
  };
  writeFileSync(join(argOutdir, "MANIFEST.json"), JSON.stringify(manifestDoc, null, 2));
  console.log(`\nManifest: ${join(argOutdir, "MANIFEST.json")} (${manifest.length} arquivos)`);
  const failed = manifest.length < FX_SYMBOLS.length * 2 + CRYPTO_SYMBOLS.length * 2;
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
