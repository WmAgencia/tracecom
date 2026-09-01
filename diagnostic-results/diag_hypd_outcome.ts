/**
 * DIAG_HYPD: hipótese D — feature similarity vs outcome similarity
 *
 * Compara duas estratégias:
 *  (1) match por feature similar (como o código atual faz) — busca candles
 *      com vetor de features próximo ao vetor-alvo
 *  (2) match por outcome vizinho — busca candles passados em uma janela
 *      de curto prazo (ex: 12 candles antes) que tiveram outcome similar
 *
 * Para cada estratégia, mede a WIN RATE média e edge sobre o baseline.
 * Se (2) for muito melhor que (1), o approach baseado em feature similarity
 * não captura o sinal.
 *
 * "Match por outcome vizinho": usa candles passados onde o retorno de 12h
 * atrás ficou dentro de uma banda (ex: ±0.5%) do alvo.
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

// estratégia 1: feature similarity (como o código atual)
async function featureStrategy(candles: MarketCandle[], queryIndices: number[]) {
  const extractor = new QuantFeatureExtractor();
  const vectors = extractor.extractAll(candles);
  const criteria = { ...DEFAULT_CRITERIA };

  let totalSamples = 0;
  let totalFavorable = 0;
  let baselineSample = 0;
  let baselineFavorable = 0;
  const perQuery: { prob: number; baseline: number; matches: number }[] = [];

  for (const qi of queryIndices) {
    const query = { timestamp: candles[qi]!.timestamp, features: vectors[qi]! };
    const { matches } = findSimilar(query, candles, extractor, criteria);
    let favorable = 0;
    let sample = 0;
    let bSample = 0;
    let bFavorable = 0;
    for (const m of matches) {
      const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
      if (idx < 0) continue;
      const o = evaluateOutcome(candles, idx, {
        direction: "up", horizon: 12, minMovePct: 0.3,
      });
      if (o === "insufficient") continue;
      sample++;
      const isHit = o === "hit";
      if (isHit) favorable++;
      if (o !== "flat") {
        bSample++;
        if (isHit) bFavorable++;
      }
    }
    const prob = sample === 0 ? 0 : favorable / sample;
    const baseline = bSample === 0 ? 0 : bFavorable / bSample;
    perQuery.push({ prob, baseline, matches: matches.length });
    totalSamples += sample;
    totalFavorable += favorable;
    baselineSample += bSample;
    baselineFavorable += bFavorable;
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    name: "feature_similarity",
    queries: queryIndices.length,
    meanSamples: mean(perQuery.map((p) => p.matches)),
    meanProb: mean(perQuery.map((p) => p.prob)),
    meanBaseline: mean(perQuery.map((p) => p.baseline)),
    edgeMean: mean(perQuery.map((p) => p.prob - p.baseline)),
    totalSamples,
    totalFavorable,
    baselineSample,
    baselineFavorable,
    baselineRate: baselineSample === 0 ? 0 : baselineFavorable / baselineSample,
  };
}

// estratégia 2: outcome similarity — busca candles passados que tiveram
// movimento similar nos últimos N candles (causal)
async function outcomeStrategy(candles: MarketCandle[], queryIndices: number[], lookback: number, tolPct: number) {
  let totalSamples = 0;
  let totalFavorable = 0;
  let baselineSample = 0;
  let baselineFavorable = 0;
  const perQuery: { prob: number; baseline: number; matches: number }[] = [];

  for (const qi of queryIndices) {
    const targetMove = (candles[qi]!.close - candles[qi - lookback]!.close) / candles[qi - lookback]!.close;
    const matches: number[] = [];
    for (let i = lookback + 50; i < qi; i++) {
      const move = (candles[i]!.close - candles[i - lookback]!.close) / candles[i - lookback]!.close;
      if (Math.abs(move - targetMove) <= tolPct) matches.push(i);
    }
    let favorable = 0;
    let sample = 0;
    let bSample = 0;
    let bFavorable = 0;
    for (const idx of matches) {
      const o = evaluateOutcome(candles, idx, {
        direction: "up", horizon: 12, minMovePct: 0.3,
      });
      if (o === "insufficient") continue;
      sample++;
      const isHit = o === "hit";
      if (isHit) favorable++;
      if (o !== "flat") {
        bSample++;
        if (isHit) bFavorable++;
      }
    }
    const prob = sample === 0 ? 0 : favorable / sample;
    const baseline = bSample === 0 ? 0 : bFavorable / bSample;
    perQuery.push({ prob, baseline, matches: matches.length });
    totalSamples += sample;
    totalFavorable += favorable;
    baselineSample += bSample;
    baselineFavorable += bFavorable;
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    name: `outcome_similarity_lb${lookback}_tol${(tolPct * 100).toFixed(1)}pct`,
    queries: queryIndices.length,
    meanSamples: mean(perQuery.map((p) => p.matches)),
    meanProb: mean(perQuery.map((p) => p.prob)),
    meanBaseline: mean(perQuery.map((p) => p.baseline)),
    edgeMean: mean(perQuery.map((p) => p.prob - p.baseline)),
    totalSamples,
    totalFavorable,
    baselineSample,
    baselineFavorable,
    baselineRate: baselineSample === 0 ? 0 : baselineFavorable / baselineSample,
  };
}

async function main() {
  console.log("[DIAG_HYPD] carregando candles...");
  const candles = loadCandles("spike-results/candles-btc-1h-90d.json");
  console.log(`[DIAG_HYPD] ${candles.length} candles`);

  const queryIndices = pickQueryIndices(100, candles.length, 19);

  console.log("\n=== HIPÓTESE D: feature similarity vs outcome similarity ===");
  console.log("estratégia | meanSamples | meanProb | meanBaseline | edgeMean | baselineRate");
  console.log("-".repeat(110));

  const rows: unknown[] = [];
  const f1 = await featureStrategy(candles, queryIndices);
  rows.push(f1);
  console.log(
    [f1.name.padEnd(40), f1.meanSamples.toFixed(1).padStart(12), f1.meanProb.toFixed(3).padStart(9), f1.meanBaseline.toFixed(3).padStart(13), f1.edgeMean.toFixed(3).padStart(9), f1.baselineRate.toFixed(3).padStart(13)].join(" | "),
  );

  // variações de outcome similarity
  for (const lb of [6, 12, 24]) {
    for (const tol of [0.001, 0.003, 0.005, 0.01]) {
      const r = await outcomeStrategy(candles, queryIndices, lb, tol);
      rows.push(r);
      console.log(
        [r.name.padEnd(40), r.meanSamples.toFixed(1).padStart(12), r.meanProb.toFixed(3).padStart(9), r.meanBaseline.toFixed(3).padStart(13), r.edgeMean.toFixed(3).padStart(9), r.baselineRate.toFixed(3).padStart(13)].join(" | "),
      );
    }
  }

  writeFileSync(
    "diagnostic-results/hypd_results.json",
    JSON.stringify(rows, null, 2),
  );
  console.log("\n[DIAG_HYPD] resultados salvos");
}

main().catch((e) => {
  console.error("[DIAG_HYPD] ERRO:", e);
  process.exit(1);
});
