// Diagnóstico rápido: em quantas direções o margin adaptativo seria atingido?
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QuantEngine } from "../src/quant/engine.js";
import { Backtester, DEFAULT_CRITERIA } from "../src/backtest/backtest.js";
import { isActionable, effectiveMargin } from "../src/fusion/calibration.js";
import type { MarketCandle } from "../src/market/model.js";
import type { Direction } from "../src/backtest/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA = resolve(__dirname, "candles-btc-1h-90d.json");

interface BinanceKline { [n: number]: string | number; }

function parse(raw: unknown): MarketCandle[] {
  const arr = raw as BinanceKline[];
  return arr.map((k) => ({
    provider: "binance" as const, symbol: "BTCUSDT", timeframe: "1h" as const,
    open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]),
    volume: Number(k[5]), timestamp: k[0] as number, receivedAt: k[0] as number,
    isClosed: true, source: "rest" as const, quality: "high" as const, estimatedDelayMs: 0,
  }));
}

async function main() {
  const raw = JSON.parse(readFileSync(DATA, "utf-8")) as BinanceKline[];
  const candles = parse(raw);
  console.error(`Candles: ${candles.length}`);

  const quant = new QuantEngine();
  const backtester = new Backtester();

  const margins = { "0.02": 0, "0.05": 0, "0.08": 0 };
  let totalDecisions = 0;
  let actionableOld5pct = 0;
  let actionableOldMinMargin = 0;
  let actionableNew = 0;

  // sample stride = 50 para acelerar (2160 candles → ~40 amostras)
  for (let i = 250; i < candles.length - 12; i += 50) {
    const features = candles.slice(0, i);
    let summary;
    try { summary = quant.analyze({ candles: features, symbol: "BTCUSDT", timeframe: "1h" }); } catch { continue; }
    const vol = summary.volatility.atrPct;
    const effMargin = effectiveMargin(vol);
    const marginLabel = effMargin === 0.02 ? "0.02" : effMargin === 0.05 ? "0.05" : "0.08";
    margins[marginLabel as "0.02" | "0.05" | "0.08"]++;

    for (const direction of ["up", "down"] as Direction[]) {
      totalDecisions++;
      let probability;
      try {
        probability = await backtester.probabilityForSetup({
          candles: features, queryIndex: features.length - 1,
          target: { direction, horizon: 12, minMovePct: 0.3 },
          criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 },
          oosRatio: 0.25,
        });
      } catch { continue; }
      if (!probability || probability.sampleSize < 30) continue;
      const ciLower = probability.confidenceInterval?.lower ?? 0;
      const base = probability.baseline ?? 0.5;
      const edge = probability.probability - base;

      // V1: margin fixo 0.05
      if (ciLower > base + 0.05) actionableOld5pct++;
      // V2: margin adaptativo
      if (isActionable({ probability: probability.probability, ciLower, baseline: base, volatility: vol, nRecentTrades: 0 })) {
        actionableNew++;
      }
      // V1 sem Wilson: prob > base+0.05 (modo fusion)
      if (edge > 0.05) actionableOldMinMargin++;
    }
  }
  console.error(`Total decisões (sample): ${totalDecisions}`);
  console.error(`Distribuição de volatilidade → margin adaptativa:`, margins);
  console.error(`V1 Wilson fixo 0.05: ${actionableOld5pct} actionable`);
  console.error(`V2 Wilson adaptativo: ${actionableNew} actionable`);
  console.error(`V1 sem Wilson (Fusion puro edge>0.05): ${actionableOldMinMargin} actionable`);
}
main().catch((e) => { console.error(e); process.exit(1); });
