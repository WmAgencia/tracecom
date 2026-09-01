/**
 * DIAG_HYPC: hipótese C — OOS ratio
 *
 * Testa se reduzir a fração reservada para out-of-sample aumenta o pool
 * in-sample disponível para a probabilidade empírica. Threshold fixo em 0.80,
 * varia oosRatio em [0.25, 0.50, 0.75].
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QuantFeatureExtractor, findSimilar } from "../src/backtest/similarity";
import { DEFAULT_CRITERIA } from "../src/backtest/backtest";
import { evaluateOutcome, wilsonInterval } from "../src/backtest/probability";
import type { MarketCandle } from "../src/market/model";

interface RawCandle {
  0: number; 1: string; 2: string; 3: string; 4: string; 5: string;
  6: number; 7: string; 8: number; 9: string; 10: string; 11: string;
}

function loadCandles(path: string): MarketCandle[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as RawCandle[];
  return raw.map((r) => ({
    provider: "binance",
    symbol: "BTCUSDT",
    timeframe: "1h" as const,
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
    timestamp: r[0],
    receivedAt: r[6] ?? r[0],
    isClosed: true,
    source: "spike:candles-btc-1h-90d",
    quality: "high" as const,
  }));
}

function pickQueryIndices(n: number, total: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = 250; i < total - 13; i += stride) out.push(i);
  return out.slice(0, n);
}

async function run(candles: MarketCandle[], queryIndices: number[], oosRatio: number) {
  const criteria = { ...DEFAULT_CRITERIA };
  const extractor = new QuantFeatureExtractor();
  const vectors = extractor.extractAll(candles);
  const oosStart = candles.length - Math.floor(candles.length * oosRatio);

  let totalSamples = 0;
  let totalFavorable = 0;
  let baselineSample = 0;
  let baselineFavorable = 0;
  const perQuery: { prob: number; baseline: number; ciLower: number; matches: number }[] = [];

  for (const qi of queryIndices) {
    // query do fim do treino in-sample
    const queryIdx = Math.min(qi, oosStart - 1);
    const query = { timestamp: candles[queryIdx]!.timestamp, features: vectors[queryIdx]! };
    const { matches } = findSimilar(query, candles, extractor, criteria);
    let favorable = 0;
    let sample = 0;
    let bSample = 0;
    let bFavorable = 0;
    for (const m of matches) {
      const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
      if (idx < 0) continue;
      const o = evaluateOutcome(candles, idx, {
        direction: "up",
        horizon: 12,
        minMovePct: 0.3,
      });
      if (o === "insufficient") continue;
      sample++;
      const isHit = o === "hit";
      if (isHit) favorable++;
      if (idx < oosStart && o !== "flat") {
        bSample++;
        if (isHit) bFavorable++;
      }
    }
    const prob = sample === 0 ? 0 : favorable / sample;
    const baseline = bSample === 0 ? 0 : bFavorable / bSample;
    const ci = wilsonInterval(favorable, sample);
    perQuery.push({ prob, baseline, ciLower: ci.lower, matches: matches.length });
    totalSamples += sample;
    totalFavorable += favorable;
    baselineSample += bSample;
    baselineFavorable += bFavorable;
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    oosRatio,
    inSampleCandles: oosStart,
    queries: queryIndices.length,
    meanSamples: mean(perQuery.map((p) => p.matches)),
    meanProb: mean(perQuery.map((p) => p.prob)),
    meanBaseline: mean(perQuery.map((p) => p.baseline)),
    meanCiLower: mean(perQuery.map((p) => p.ciLower)),
    edgeMean: mean(perQuery.map((p) => p.prob - p.baseline)),
    profitableQueries: perQuery.filter((p) => p.ciLower > p.baseline + 0.05).length,
    totalSamples,
    totalFavorable,
    baselineSample,
    baselineFavorable,
  };
}

async function main() {
  console.log("[DIAG_HYPC] carregando candles...");
  const candles = loadCandles("spike-results/candles-btc-1h-90d.json");
  console.log(`[DIAG_HYPC] ${candles.length} candles`);

  const queryIndices = pickQueryIndices(100, candles.length, 19);
  console.log(`[DIAG_HYPC] ${queryIndices.length} queries`);

  console.log("\n=== HIPÓTESE C: OOS ratio ===");
  console.log("oosRatio | inSampleCandles | meanSamples | meanProb | meanBaseline | meanCiLower | edgeMean | profitableQueries | totalSamples");
  console.log("-".repeat(140));

  const rows = [];
  for (const oos of [0.25, 0.50, 0.75]) {
    const r = await run(candles, queryIndices, oos);
    rows.push(r);
    console.log(
      [
        r.oosRatio.toFixed(2).padStart(8),
        String(r.inSampleCandles).padStart(16),
        r.meanSamples.toFixed(1).padStart(12),
        r.meanProb.toFixed(3).padStart(9),
        r.meanBaseline.toFixed(3).padStart(13),
        r.meanCiLower.toFixed(3).padStart(12),
        r.edgeMean.toFixed(3).padStart(9),
        String(r.profitableQueries).padStart(18),
        String(r.totalSamples).padStart(14),
      ].join(" | "),
    );
  }

  writeFileSync(
    "diagnostic-results/hypc_results.json",
    JSON.stringify(rows, null, 2),
  );
  console.log("\n[DIAG_HYPC] resultados salvos");
}

main().catch((e) => {
  console.error("[DIAG_HYPC] ERRO:", e);
  process.exit(1);
});
