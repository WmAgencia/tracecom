// diagnose_v2.ts — diagnóstico mais profundo + modo "no-wilson" (só usa prob > base + 0.05 do fusion).
// Mostra o que aconteceria se desligássemos a camada Wilson e só ficássemos com o filtro interno do fusion.

import { readFileSync, writeFileSync } from "node:fs";
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

interface Trade {
  entryIndex: number; entryTime: number; entryPrice: number;
  exitIndex: number; exitTime: number; exitPrice: number;
  direction: "up" | "down"; outcome: "hit" | "miss" | "flat"; returnPct: number;
  ciLower: number; baseline: number; edge: number; probability: number;
  decision: string; actionable_wilson: boolean;
}

(async () => {
const raw = JSON.parse(readFileSync("candles-btc-1h-90d.json","utf-8"));
const candles = parseKlines(raw);
console.log("total candles:", candles.length);

const quant = new QuantEngine();
const bt = new Backtester();
const fusion = new FusionEngine();

const HORIZON = 12;
const tradesWilson: Trade[] = [];   // acionável Wilson (padrão do motor)
const tradesFusion: Trade[] = [];   // só filtro prob > base + 0.05 (fusion clássico)
const tradesScoreOnly: Trade[] = []; // só score técnico > 0.18 e direção alinhada

let nEval = 0, nProbOk = 0, nFusionBuySell = 0, nActionableWilson = 0;

for (let i = 250; i < candles.length - HORIZON; i++) {
  const features = candles.slice(0, i);
  let summary;
  try { summary = quant.analyze({ candles: features, symbol:"BTCUSDT", timeframe:"1h" }); } catch { continue; }

  // Escolhe direção pelo sinal do technical score
  const direction: "up" | "down" = summary.technicalScore > 0 ? "up" : "down";

  const prob = await bt.probabilityForSetup({
    candles: features, queryIndex: features.length - 1,
    target: { direction, horizon: HORIZON, minMovePct: 0.3 },
    criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 },
    oosRatio: 0.25,
  });
  if (prob.sampleSize < 30) continue;
  nProbOk++;
  nEval++;

  const ciLower = prob.confidenceInterval?.lower ?? wilsonLowerBound(prob.favorable, prob.sampleSize);
  const base = prob.baseline ?? 0.5;
  const edge = prob.probability - base;
  const actionableWilson = isActionable({ probability: prob.probability, ciLower, baseline: base, minMargin: 0.05 });

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
  if (r.decision !== "WAIT") nFusionBuySell++;

  // Trade outcome
  const entryC = candles[i]!;
  const exitC = candles[i + HORIZON]!;
  const movePct = ((exitC.close - entryC.close) / entryC.close) * 100;
  let outcome: "hit" | "miss" | "flat";
  let returnPct: number;
  if (Math.abs(movePct) < 0.3) { outcome = "flat"; returnPct = 0; }
  else if (direction === "up") { outcome = movePct > 0 ? "hit" : "miss"; returnPct = movePct; }
  else { outcome = movePct < 0 ? "hit" : "miss"; returnPct = -movePct; }

  const trade: Trade = {
    entryIndex: i, entryTime: entryC.timestamp, entryPrice: entryC.close,
    exitIndex: i + HORIZON, exitTime: exitC.timestamp, exitPrice: exitC.close,
    direction, outcome, returnPct, ciLower, baseline: base, edge,
    probability: prob.probability, decision: r.decision, actionable_wilson: actionableWilson,
  };

  // Modo 1: acionável Wilson (padrão do motor)
  if (r.decision !== "WAIT" && actionableWilson) {
    tradesWilson.push(trade);
    nActionableWilson++;
  }
  // Modo 2: fusion clássico sem Wilson — exige prob > base + 0.05 (interno do fusion)
  if (r.decision !== "WAIT") {
    tradesFusion.push(trade);
  }
  // Modo 3: só score técnico forte (|score| > 0.18) e direção alinhada
  if (Math.abs(summary.technicalScore) > 0.18) {
    tradesScoreOnly.push(trade);
  }
}

console.log(`\n=== ESTATÍSTICAS ===`);
console.log(`amostras avaliadas:           ${nEval}`);
console.log(`fusion BUY/SELL:              ${nFusionBuySell}`);
console.log(`fusion BUY/SELL + Wilson:     ${nActionableWilson}`);
console.log(`tradesWilson:                 ${tradesWilson.length}`);
console.log(`tradesFusion (sem Wilson):    ${tradesFusion.length}`);
console.log(`tradesScoreOnly (|score|>0.18): ${tradesScoreOnly.length}`);

// Salvar 3 arquivos de trade
writeFileSync("trades_wilson.json", JSON.stringify({ trades: tradesWilson, mode: "wilson", nCandles: candles.length }, null, 2));
writeFileSync("trades_fusion.json", JSON.stringify({ trades: tradesFusion, mode: "fusion_no_wilson", nCandles: candles.length }, null, 2));
writeFileSync("trades_score.json", JSON.stringify({ trades: tradesScoreOnly, mode: "score_only", nCandles: candles.length }, null, 2));

// Métricas simples por modo
function metrics(label: string, ts: Trade[]) {
  const dec = ts.filter((t) => t.outcome !== "flat");
  const hits = dec.filter((t) => t.outcome === "hit").length;
  const total = dec.length;
  const wr = total === 0 ? null : hits / total;
  const rets = dec.map((t) => t.returnPct);
  const avg = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const winAvg = dec.filter((t) => t.outcome === "hit").map((t) => t.returnPct).reduce((a, b) => a + b, 0) / Math.max(1, hits);
  const lossAvg = dec.filter((t) => t.outcome === "miss").map((t) => t.returnPct).reduce((a, b) => a + b, 0) / Math.max(1, total - hits);
  console.log(`\n[${label}]`);
  console.log(`  n=${ts.length} hits=${hits} miss=${total - hits} flat=${ts.length - total}`);
  console.log(`  win rate (excl flat): ${wr === null ? "n/a" : (wr*100).toFixed(1) + "%"}`);
  console.log(`  avg return/trade (dec): ${avg.toFixed(3)}%`);
  console.log(`  avg win: ${isFinite(winAvg) ? winAvg.toFixed(3) : "n/a"}%`);
  console.log(`  avg loss: ${isFinite(lossAvg) ? lossAvg.toFixed(3) : "n/a"}%`);
  console.log(`  expectancy (por trade): ${wr === null ? "n/a" : ((wr * winAvg) - (1-wr) * Math.abs(lossAvg)).toFixed(3)}%`);
}

metrics("MODO WILSON (motor completo)", tradesWilson);
metrics("MODO FUSION (sem Wilson)", tradesFusion);
metrics("MODO SCORE ONLY", tradesScoreOnly);
})();
