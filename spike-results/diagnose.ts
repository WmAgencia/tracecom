// diagnose.ts — diagnosticar por que o motor não disparou.
// Roda sobre candles e mede a distribuição de score técnico, edge prob-baseline, e blockedByCounterEvidence.

import { readFileSync } from "node:fs";
import { QuantEngine } from "../src/quant/engine.js";
import { Backtester, DEFAULT_CRITERIA } from "../src/backtest/backtest.js";
import { FusionEngine } from "../src/fusion/fusion.js";
import { assessRisk } from "../src/fusion/risk.js";
import { isActionable, wilsonLowerBound } from "../src/fusion/calibration.js";

interface BinanceKline { [n: number]: string | number; }

function parseKlines(raw: BinanceKline[]): any[] {
  return raw.map((k) => ({
    provider:"binance", symbol:"BTCUSDT", timeframe:"1h",
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
    timestamp:k[0], receivedAt:k[0], isClosed:true, source:"rest", quality:"high", estimatedDelayMs:0,
  }));
}

(async () => {
const raw = JSON.parse(readFileSync("candles-btc-1h-90d.json","utf-8"));
const allCandles = parseKlines(raw);
console.log("total candles:", allCandles.length);

const quant = new QuantEngine();
const bt = new Backtester();
const fusion = new FusionEngine();

let nChecked = 0;
let nFusionBuySell = 0;
let nFusionWait = 0;
let nEdgeGt05 = 0;
let nCiLowerGtBase05 = 0;
let nBuySellActionable = 0;

let maxEdge = -Infinity;
let maxCiLowerGtBase = -Infinity;
let edgeSum = 0;
let edgeCount = 0;
let scoreAbsMax = 0;

const samples: any[] = [];

for (let i = 250; i < allCandles.length; i += 10) { // amostragem a cada 10 candles
  const features = allCandles.slice(0, i);
  let summary;
  try { summary = quant.analyze({ candles: features, symbol:"BTCUSDT", timeframe:"1h" }); } catch { continue; }

  for (const direction of ["up", "down"] as const) {
    nChecked++;
    const prob = await bt.probabilityForSetup({
      candles: features, queryIndex: features.length - 1,
      target: { direction, horizon: 12, minMovePct: 0.3 },
      criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 },
      oosRatio: 0.25,
    });
    if (prob.sampleSize < 30) continue;
    const base = prob.baseline ?? 0.5;
    const edge = prob.probability - base;
    const ciLower = prob.confidenceInterval?.lower ?? wilsonLowerBound(prob.favorable, prob.sampleSize);
    edgeSum += edge;
    edgeCount++;
    if (edge > maxEdge) maxEdge = edge;
    if (ciLower - base > maxCiLowerGtBase) maxCiLowerGtBase = ciLower - base;
    if (edge > 0.05) nEdgeGt05++;
    if (ciLower > base + 0.05) nCiLowerGtBase05++;

    scoreAbsMax = Math.max(scoreAbsMax, Math.abs(summary.technicalScore));

    const risk = assessRisk({
      regime: summary.regime.regime,
      annualizedVolatility: summary.volatility.annualized * 100,
      atrPct: summary.volatility.atrPct,
      windowVolatility: summary.volatility.windowVolatility,
      dataQuality: "high",
      eventRisk: false,
      hasHistoricalSupport: prob.sampleSize >= 30,
    });

    const r = fusion.fuse({
      symbol:"BTCUSDT", timeframe:"1h", direction, horizon:"12 candles",
      technical: { score: summary.technicalScore, regime: summary.regime.regime, structureTrend: summary.structure.trend, rsi: null, supports:[], resistances:[] },
      probability: prob, risk,
      context: { newsBias:null, macroBias:null, eventRisk:false },
      dataQuality:"high",
    });

    if (r.decision === "WAIT") nFusionWait++;
    else nFusionBuySell++;

    const actionable = isActionable({ probability: prob.probability, ciLower, baseline: base, minMargin: 0.05 });
    if (actionable && r.decision !== "WAIT") nBuySellActionable++;

    if (samples.length < 6 && edge > 0.04) {
      samples.push({ i, direction, edge, ciLower, base, prob: prob.probability, sampleSize: prob.sampleSize, technicalScore: summary.technicalScore, decision: r.decision, actionable, score: r.score, blockedByCounter: r.blockedByCounterEvidence });
    }
  }
}

console.log("\n=== DIAGNÓSTICO ===");
console.log(`nChecked (samples): ${nChecked}`);
console.log(`edge>0.05 samples: ${nEdgeGt05} (${(100*nEdgeGt05/nChecked).toFixed(1)}%)`);
console.log(`ciLower>base+0.05: ${nCiLowerGtBase05} (${(100*nCiLowerGtBase05/nChecked).toFixed(1)}%)`);
console.log(`fusion BUY/SELL:  ${nFusionBuySell} (${(100*nFusionBuySell/nChecked).toFixed(1)}%)`);
console.log(`fusion WAIT:      ${nFusionWait} (${(100*nFusionWait/nChecked).toFixed(1)}%)`);
console.log(`buySell+actionable: ${nBuySellActionable} (${(100*nBuySellActionable/nChecked).toFixed(1)}%)`);
console.log(`max edge (prob-base): ${maxEdge.toFixed(3)}`);
console.log(`max ciLower - base:    ${maxCiLowerGtBase.toFixed(3)}`);
console.log(`avg edge: ${(edgeSum/Math.max(1,edgeCount)).toFixed(4)}`);
console.log(`max |technicalScore|:  ${scoreAbsMax.toFixed(3)}`);
console.log("\nSamples com edge > 0.04:");
for (const s of samples) console.log(JSON.stringify(s, null, 2));
})();
