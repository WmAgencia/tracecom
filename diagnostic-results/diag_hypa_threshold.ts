/**
 * DIAG_HYPA: diagnóstico A — threshold de similaridade
 *
 * Testa se DEFAULT_CRITERIA.similarityThreshold = 0.8 (código atual) é
 * restritivo demais para BTC 1h / horizonte 12h. Varrendo threshold
 * 0.50..0.95, mede:
 *   - tamanho médio do pool de matches
 *   - probability empírica
 *   - baseline
 *   - edge (prob - baseline)
 *   - wilson CI lower
 *   - sinais acionáveis (CI lower > baseline + 0.05)
 *
 * Não modifica src/. Lê o dataset e importa os módulos reais.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QuantFeatureExtractor, findSimilar } from "../src/backtest/similarity";
import { DEFAULT_CRITERIA } from "../src/backtest/backtest";
import { empiricalProbability, evaluateOutcome, wilsonInterval } from "../src/backtest/probability";
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

interface RowStats {
  threshold: number;
  queries: number;
  meanMatches: number;
  medianMatches: number;
  zeroMatchQueries: number;
  totalSamples: number;
  totalFavorable: number;
  probMean: number;
  baselineMean: number;
  edgeMean: number;
  ciLowerMean: number;
  ciLowerAboveBaselineMargin: number;
  profitableQueries: number;
}

async function runThreshold(
  candles: MarketCandle[],
  queryIndices: number[],
  threshold: number,
  oosRatio: number,
): Promise<RowStats> {
  const criteria = { ...DEFAULT_CRITERIA, similarityThreshold: threshold };
  const extractor = new QuantFeatureExtractor();
  const vectors = extractor.extractAll(candles); // O(n) uma vez por run
  const oosStart = candles.length - Math.floor(candles.length * oosRatio);

  let totalSamples = 0;
  let totalFavorable = 0;
  let totalBaselineSample = 0;
  let totalBaselineFavorable = 0;

  const perQueryMatches: number[] = [];
  const perQueryProb: number[] = [];
  const perQueryBaseline: number[] = [];
  const perQueryCiLower: number[] = [];
  let profitableQueries = 0;

  for (const qi of queryIndices) {
    const query = { timestamp: candles[qi]!.timestamp, features: vectors[qi]! };
    const { matches } = findSimilar(query, candles, extractor, criteria);
    perQueryMatches.push(matches.length);

    if (matches.length === 0) {
      perQueryProb.push(0);
      perQueryBaseline.push(0);
      perQueryCiLower.push(0);
      continue;
    }

    let favorable = 0;
    let sample = 0;
    let baselineSample = 0;
    let baselineFavorable = 0;
    const allOutcomes: boolean[] = [];

    for (const m of matches) {
      const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
      if (idx < 0) continue;
      const outcome = evaluateOutcome(candles, idx, {
        direction: "up",
        horizon: 12,
        minMovePct: 0.3,
      });
      if (outcome === "insufficient") continue;
      sample++;
      const isHit = outcome === "hit";
      if (isHit) favorable++;
      allOutcomes.push(isHit);
      // baseline (limitado ao in-sample)
      if (idx < oosStart && outcome !== "flat") {
        baselineSample++;
        if (isHit) baselineFavorable++;
      }
    }

    const prob = sample === 0 ? 0 : favorable / sample;
    const baseline = baselineSample > 0 ? baselineFavorable / baselineSample : 0;
    const ci = wilsonInterval(favorable, sample);
    perQueryProb.push(prob);
    perQueryBaseline.push(baseline);
    perQueryCiLower.push(ci.lower);

    totalSamples += sample;
    totalFavorable += favorable;
    totalBaselineSample += baselineSample;
    totalBaselineFavorable += baselineFavorable;

    if (ci.lower > baseline + 0.05) profitableQueries++;
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sortedMatches = [...perQueryMatches].sort((x, y) => x - y);
  const medianMatches = sortedMatches.length
    ? sortedMatches[Math.floor(sortedMatches.length / 2)]!
    : 0;

  return {
    threshold,
    queries: queryIndices.length,
    meanMatches: mean(perQueryMatches),
    medianMatches,
    zeroMatchQueries: perQueryMatches.filter((m) => m === 0).length,
    totalSamples,
    totalFavorable,
    probMean: mean(perQueryProb),
    baselineMean: mean(perQueryBaseline),
    edgeMean: mean(perQueryProb.map((p, i) => p - perQueryBaseline[i]!)),
    ciLowerMean: mean(perQueryCiLower),
    ciLowerAboveBaselineMargin: profitableQueries,
  };
}

async function main() {
  console.log("[DIAG_HYPA] carregando candles BTC 1h 90d...");
  const candles = loadCandles("spike-results/candles-btc-1h-90d.json");
  console.log(`[DIAG_HYPA] ${candles.length} candles carregados`);

  // 100 queries amostradas a cada 19 candles (cobre 90d)
  const queryIndices = pickQueryIndices(100, candles.length, 19);
  console.log(`[DIAG_HYPA] ${queryIndices.length} queries selecionadas`);

  const thresholds = [0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
  const oosRatio = 0.25;

  console.log("\n=== HIPÓTESE A: threshold de similaridade ===");
  console.log("threshold | meanMatches | medianMatches | zeroMatchQueries | totalSamples | totalFavorable | probMean | baselineMean | edgeMean | ciLowerMean | profitableQueries");
  console.log("-".repeat(160));

  const rows: RowStats[] = [];
  for (const t of thresholds) {
    const r = await runThreshold(candles, queryIndices, t, oosRatio);
    rows.push(r);
    console.log(
      [
        r.threshold.toFixed(2).padStart(9),
        r.meanMatches.toFixed(1).padStart(12),
        String(r.medianMatches).padStart(13),
        String(r.zeroMatchQueries).padStart(17),
        String(r.totalSamples).padStart(13),
        String(r.totalFavorable).padStart(15),
        r.probMean.toFixed(3).padStart(9),
        r.baselineMean.toFixed(3).padStart(13),
        r.edgeMean.toFixed(3).padStart(9),
        r.ciLowerMean.toFixed(3).padStart(12),
        String(r.profitableQueries).padStart(18),
      ].join(" | "),
    );
  }

  console.log("\n=== VEREDITO HIPÓTESE A ===");
  const r08 = rows.find((r) => r.threshold === 0.80)!;
  const r07 = rows.find((r) => r.threshold === 0.70)!;
  const r06 = rows.find((r) => r.threshold === 0.60)!;
  const r05 = rows.find((r) => r.threshold === 0.50)!;
  console.log(`threshold 0.80 (atual): meanMatches=${r08.meanMatches.toFixed(1)}, edge=${r08.edgeMean.toFixed(3)}, profitableQueries=${r08.profitableQueries}/${r08.queries}`);
  console.log(`threshold 0.70:          meanMatches=${r07.meanMatches.toFixed(1)}, edge=${r07.edgeMean.toFixed(3)}, profitableQueries=${r07.profitableQueries}/${r07.queries}`);
  console.log(`threshold 0.60:          meanMatches=${r06.meanMatches.toFixed(1)}, edge=${r06.edgeMean.toFixed(3)}, profitableQueries=${r06.profitableQueries}/${r06.queries}`);
  console.log(`threshold 0.50:          meanMatches=${r05.meanMatches.toFixed(1)}, edge=${r05.edgeMean.toFixed(3)}, profitableQueries=${r05.profitableQueries}/${r05.queries}`);

  writeFileSync(
    "diagnostic-results/hypa_results.json",
    JSON.stringify(rows, null, 2),
  );
  console.log("\n[DIAG_HYPA] resultados salvos em diagnostic-results/hypa_results.json");
}

main().catch((e) => {
  console.error("[DIAG_HYPA] ERRO:", e);
  process.exit(1);
});
