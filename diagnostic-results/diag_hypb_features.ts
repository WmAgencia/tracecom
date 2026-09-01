/**
 * DIAG_HYPB: hipótese B — poder discriminante das features técnicas
 *
 * Mede correlação de cada feature técnica (rsi, pctFromSma, slope, atrPct,
 * volatility, macdHistNorm) com o outcome real (hit=1, miss=0, flat=excluído)
 * em BTC 1h / horizonte 12h.
 *
 * Também mede win rate por quintil de cada feature (top quintil vs bottom
 * quintil) — se |correlação| < 0.05 E win rate por quintil é ~igual, a
 * feature não tem poder discriminante.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QuantFeatureExtractor } from "../src/backtest/similarity";
import { evaluateOutcome } from "../src/backtest/probability";
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

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0 || n !== ys.length) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

function pointBiserial(xs: number[], ys: number[]): number {
  // mesma fórmula que Pearson, ys binário 0/1
  return pearson(xs, ys);
}

function quintileWR(values: number[], outcomes: number[]): { q1: number; q5: number; lift: number } {
  const sorted = values
    .map((v, i) => ({ v, o: outcomes[i]! }))
    .sort((a, b) => a.v - b.v);
  const n = sorted.length;
  const q1 = sorted.slice(0, Math.floor(n / 5));
  const q5 = sorted.slice(Math.floor((n * 4) / 5));
  const wr = (arr: { o: number }[]) => {
    const wins = arr.filter((x) => x.o === 1).length;
    return arr.length ? wins / arr.length : 0;
  };
  const q1wr = wr(q1);
  const q5wr = wr(q5);
  return { q1: q1wr, q5: q5wr, lift: q5wr - q1wr };
}

async function main() {
  console.log("[DIAG_HYPB] carregando candles...");
  const candles = loadCandles("spike-results/candles-btc-1h-90d.json");
  console.log(`[DIAG_HYPB] ${candles.length} candles`);

  const extractor = new QuantFeatureExtractor();
  const vectors = extractor.extractAll(candles);
  const keys = extractor.keys;

  // para cada candle i >= 250, computa outcome em i+12 e features em i
  const startI = 250;
  const endI = candles.length - 12;
  console.log(`[DIAG_HYPB] computando outcomes para i=${startI}..${endI - 1}`);

  const records: { features: Record<string, number>; outcome: number }[] = [];
  for (let i = startI; i < endI; i++) {
    const o = evaluateOutcome(candles, i, {
      direction: "up",
      horizon: 12,
      minMovePct: 0.3,
    });
    if (o === "hit") records.push({ features: vectors[i]!, outcome: 1 });
    else if (o === "miss") records.push({ features: vectors[i]!, outcome: 0 });
    // exclui 'flat' e 'insufficient'
  }
  console.log(`[DIAG_HYPB] ${records.length} amostras hit/miss válidas (excluindo flat)`);

  const hitRate = records.filter((r) => r.outcome === 1).length / records.length;
  console.log(`[DIAG_HYPB] hit rate base (sem filtro): ${hitRate.toFixed(3)}`);

  console.log("\n=== CORRELAÇÃO FEATURE → OUTCOME (hit=1, miss=0) ===");
  console.log("feature | n | pearson_r | |r| | q1_WR | q5_WR | lift (q5-q1)");
  console.log("-".repeat(80));
  const results: Record<string, unknown>[] = [];
  for (const k of keys) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of records) {
      xs.push(r.features[k] ?? 0);
      ys.push(r.outcome);
    }
    const r = pointBiserial(xs, ys);
    const wr = quintileWR(xs, ys);
    console.log(
      [
        k.padEnd(12),
        String(xs.length).padStart(5),
        r.toFixed(4).padStart(10),
        Math.abs(r).toFixed(4).padStart(6),
        wr.q1.toFixed(3).padStart(7),
        wr.q5.toFixed(3).padStart(7),
        wr.lift.toFixed(3).padStart(12),
      ].join(" | "),
    );
    results.push({
      feature: k,
      n: xs.length,
      pearson_r: r,
      abs_r: Math.abs(r),
      q1_wr: wr.q1,
      q5_wr: wr.q5,
      lift: wr.lift,
    });
  }

  // bônus: testa direção "down" também para ver se features discriminam
  console.log("\n=== BÔNUS: HIPÓTESE B COM DIREÇÃO DOWN (bearish) ===");
  const recordsDown: { features: Record<string, number>; outcome: number }[] = [];
  for (let i = startI; i < endI; i++) {
    const o = evaluateOutcome(candles, i, {
      direction: "down",
      horizon: 12,
      minMovePct: 0.3,
    });
    if (o === "hit") recordsDown.push({ features: vectors[i]!, outcome: 1 });
    else if (o === "miss") recordsDown.push({ features: vectors[i]!, outcome: 0 });
  }
  console.log(`[DIAG_HYPB] down: ${recordsDown.length} amostras`);
  for (const k of keys) {
    const xs = recordsDown.map((r) => r.features[k] ?? 0);
    const ys = recordsDown.map((r) => r.outcome);
    const r = pointBiserial(xs, ys);
    console.log(`${k.padEnd(12)} | r=${r.toFixed(4)} | |r|=${Math.abs(r).toFixed(4)}`);
  }

  writeFileSync(
    "diagnostic-results/hypb_results.json",
    JSON.stringify({ hitRate, samples: records.length, features: results }, null, 2),
  );
  console.log("\n[DIAG_HYPB] resultados salvos em diagnostic-results/hypb_results.json");
}

main().catch((e) => {
  console.error("[DIAG_HYPB] ERRO:", e);
  process.exit(1);
});
