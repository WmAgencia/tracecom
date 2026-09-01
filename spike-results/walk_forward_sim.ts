// walk_forward_sim.ts — simulador walk-forward do motor TRACECON (v2, multi-modo).
//
// Para cada candle i (a partir de 250):
//   - features: candles[0..i-1] (causal, sem look-ahead)
//   - quant.analyze(...) sobre candles[0..i-1]
//   - Para AMBAS as direções (up, down):
//       - backtester.probabilityForSetup({queryIndex: i-1, target: {direction, horizon: 12, minMovePct: 0.3}})
//       - assessRisk(...)
//       - fusion.fuse(...)
//   - Seleciona a direção com maior edge se passar nos filtros:
//     * MODO 1 (wilson): r.decision !== WAIT AND ciLower > baseline + 0.05
//     * MODO 2 (fusion): r.decision !== WAIT (sem filtro Wilson adicional)
//     * MODO 3 (score):  |technicalScore| > 0.18 na direção do sinal
//   - Em qualquer modo aprovado, registra trade com outcome real (entry=i, exit=i+12).

import { readFileSync, writeFileSync } from "node:fs";
import { QuantEngine } from "../src/quant/engine.js";
import { Backtester, DEFAULT_CRITERIA } from "../src/backtest/backtest.js";
import { FusionEngine } from "../src/fusion/fusion.js";
import { assessRisk } from "../src/fusion/risk.js";
import { isActionable, wilsonLowerBound } from "../src/fusion/calibration.js";
import type { MarketCandle } from "../src/market/model.js";
import type { Direction } from "../src/backtest/types.js";
import type { FusionInput } from "../src/fusion/types.js";

interface BinanceKline { [n: number]: string | number; }

function parseKlines(raw: unknown): MarketCandle[] {
  const arr = raw as BinanceKline[];
  return arr.map((k) => {
    const ts = k[0] as number;
    return {
      provider: "binance",
      symbol: "BTCUSDT",
      timeframe: "1h",
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      timestamp: ts,
      receivedAt: ts,
      isClosed: true,
      source: "rest",
      quality: "high",
      estimatedDelayMs: 0,
    };
  });
}

interface Trade {
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  direction: "up" | "down";
  outcome: "hit" | "miss" | "flat";
  returnPct: number;
  technicalScore: number | null;
  probability: number;
  baseline: number;
  ciLower: number;
  edge: number;
  regime: string | null;
  rsi: number | null;
}

const HORIZON = 12;
const MIN_HISTORY = 250;
const FLAT_THRESHOLD_PCT = 0.3;

async function main() {
  console.error("Carregando candles...");
  const raw = JSON.parse(readFileSync("candles-btc-1h-90d.json", "utf-8")) as BinanceKline[];
  const candles: MarketCandle[] = parseKlines(raw);
  console.error(`Total candles: ${candles.length}`);

  const quant = new QuantEngine();
  const backtester = new Backtester();
  const fusion = new FusionEngine();

  const tradesWilson: Trade[] = [];
  const tradesFusion: Trade[] = [];
  const tradesScore: Trade[] = [];

  let decisionsEvaluated = 0;
  let nFusionBuySell = 0;
  let nActionableWilson = 0;
  let nScoreStrong = 0;
  const start = Date.now();

  for (let i = MIN_HISTORY; i < candles.length - HORIZON; i++) {
    const features = candles.slice(0, i); // causal
    const entryCandle = candles[i]!;

    let summary;
    try {
      summary = quant.analyze({ candles: features, symbol: "BTCUSDT", timeframe: "1h" });
    } catch {
      continue;
    }

    const directions: Direction[] = ["up", "down"];
    let bestForWilson: Trade | null = null;
    let bestForFusion: Trade | null = null;
    let bestForScore: Trade | null = null;

    for (const direction of directions) {
      decisionsEvaluated++;
      let probability;
      try {
        probability = await backtester.probabilityForSetup({
          candles: features,
          queryIndex: features.length - 1,
          target: { direction, horizon: HORIZON, minMovePct: FLAT_THRESHOLD_PCT },
          criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 },
          oosRatio: 0.25,
        });
      } catch {
        continue;
      }
      if (!probability || probability.sampleSize < 30) continue;

      const ciLower = probability.confidenceInterval?.lower ?? wilsonLowerBound(probability.favorable, probability.sampleSize);
      const base = probability.baseline ?? 0.5;
      const edge = probability.probability - base;

      const risk = assessRisk({
        regime: summary.regime.regime,
        annualizedVolatility: summary.volatility.annualized * 100,
        atrPct: summary.volatility.atrPct,
        windowVolatility: summary.volatility.windowVolatility,
        dataQuality: "high",
        eventRisk: false,
        hasHistoricalSupport: probability.sampleSize >= 30,
      });

      const lastRsi = lastNonNull(summary.indicators.rsi);

      const input: FusionInput = {
        symbol: "BTCUSDT",
        timeframe: "1h",
        direction,
        horizon: `${HORIZON} candles`,
        technical: {
          score: summary.technicalScore,
          regime: summary.regime.regime,
          structureTrend: summary.structure.trend,
          rsi: lastRsi,
          supports: summary.levels.supports.map((l) => l.price),
          resistances: summary.levels.resistances.map((l) => l.price),
        },
        probability,
        risk,
        context: { newsBias: null, macroBias: null, eventRisk: false },
        dataQuality: "high",
      };

      const result = fusion.fuse(input);
      if (result.decision !== "WAIT") nFusionBuySell++;

      const actionableWilson = isActionable({ probability: probability.probability, ciLower, baseline: base, minMargin: 0.05 });
      if (actionableWilson) nActionableWilson++;

      // exit candle
      const exitCandle = candles[i + HORIZON]!;
      const entryPrice = entryCandle.close;
      const exitPrice = exitCandle.close;
      const movePct = ((exitPrice - entryPrice) / entryPrice) * 100;
      let outcome: "hit" | "miss" | "flat";
      let returnPct: number;
      if (Math.abs(movePct) < FLAT_THRESHOLD_PCT) { outcome = "flat"; returnPct = 0; }
      else if (direction === "up") { outcome = movePct > 0 ? "hit" : "miss"; returnPct = movePct; }
      else { outcome = movePct < 0 ? "hit" : "miss"; returnPct = -movePct; }

      const trade: Trade = {
        entryIndex: i,
        entryTime: entryCandle.timestamp,
        entryPrice,
        exitIndex: i + HORIZON,
        exitTime: exitCandle.timestamp,
        exitPrice,
        direction,
        outcome,
        returnPct,
        technicalScore: summary.technicalScore,
        probability: probability.probability,
        baseline: base,
        ciLower,
        edge,
        regime: summary.regime.regime,
        rsi: lastRsi,
      };

      // MODO 1 (Wilson): precisa fusion!=WAIT AND actionable Wilson
      if (result.decision !== "WAIT" && actionableWilson) {
        if (!bestForWilson || edge > bestForWilson.edge) bestForWilson = trade;
      }
      // MODO 2 (Fusion): precisa fusion!=WAIT (prob>base+0.05 já é interno do fusion)
      if (result.decision !== "WAIT") {
        if (!bestForFusion || edge > bestForFusion.edge) bestForFusion = trade;
      }
      // MODO 3 (Score): precisa |score| > 0.18 alinhado com a direção
      const score = summary.technicalScore;
      const aligned = (score > 0 && direction === "up") || (score < 0 && direction === "down");
      if (Math.abs(score) > 0.18 && aligned) {
        nScoreStrong++;
        if (!bestForScore || edge > bestForScore.edge) bestForScore = trade;
      }
    }

    if (bestForWilson) tradesWilson.push(bestForWilson);
    if (bestForFusion) tradesFusion.push(bestForFusion);
    if (bestForScore) tradesScore.push(bestForScore);

    if ((i - MIN_HISTORY) % 200 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      console.error(`[${i}/${candles.length}] wilson=${tradesWilson.length} fusion=${tradesFusion.length} score=${tradesScore.length} (${elapsed.toFixed(1)}s)`);
    }
  }

  const elapsed = (Date.now() - start) / 1000;
  console.error(`\nFINAL em ${elapsed.toFixed(1)}s`);
  console.error(`wilson: ${tradesWilson.length}`);
  console.error(`fusion: ${tradesFusion.length}`);
  console.error(`score:  ${tradesScore.length}`);
  console.error(`decisões avaliadas: ${decisionsEvaluated}, fusion BUY/SELL: ${nFusionBuySell}, actionable Wilson: ${nActionableWilson}, |score|>0.18 alinhados: ${nScoreStrong}`);

  writeFileSync("trades.json", JSON.stringify({
    mode: "all_3_modes",
    wilson: tradesWilson,
    fusion: tradesFusion,
    score: tradesScore,
    totalCandles: candles.length,
    generatedAt: Date.now(),
  }, null, 2));
  console.error("Salvo em trades.json (com 3 modos: wilson, fusion, score)");
}

function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null) return v;
  }
  return null;
}

main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });
