// calculate_metrics.ts — calcula métricas honestas a partir de trades.json.
// Lê o arquivo com 3 modos (wilson, fusion, score) e calcula baselines para cada.

import { readFileSync, writeFileSync } from "node:fs";

interface Trade {
  entryIndex: number; entryTime: number; entryPrice: number;
  exitIndex: number; exitTime: number; exitPrice: number;
  direction: "up" | "down";
  outcome: "hit" | "miss" | "flat";
  returnPct: number;
  technicalScore: number | null;
  probability: number; baseline: number; ciLower: number; edge: number;
  regime: string | null; rsi: number | null;
}

interface BinanceKline { [n: number]: string | number; }
function parseKlines(raw: BinanceKline[]): { timestamp: number; close: number }[] {
  return raw.map((k) => ({ timestamp: k[0] as number, close: Number(k[4]) }));
}

function mean(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr: readonly number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}
function maxDrawdown(returns: readonly number[]): number {
  let peak = 0, mdd = 0, cum = 0;
  for (const r of returns) { cum += r; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); }
  return mdd;
}

interface Metrics {
  totalTrades: number; hits: number; misses: number; flats: number;
  winRate: number | null;
  avgReturn: number; medianReturn: number; stdReturn: number;
  totalReturn: number; sharpeAnnualized: number | null;
  maxDrawdown: number; expectancy: number | null;
  profitFactor: number | null; bestTrade: number; worstTrade: number;
  avgWin: number | null; avgLoss: number | null;
}

function calcMetrics(trades: readonly Trade[]): Metrics {
  const dec = trades.filter((t) => t.outcome === "hit" || t.outcome === "miss");
  const hits = dec.filter((t) => t.outcome === "hit");
  const losses = dec.filter((t) => t.outcome === "miss");
  const flats = trades.filter((t) => t.outcome === "flat").length;
  const returns = dec.map((t) => t.returnPct);
  const winsR = hits.map((t) => t.returnPct);
  const lossesR = losses.map((t) => t.returnPct);
  const avg = mean(returns);
  const stdR = std(returns);
  const mdd = maxDrawdown(returns);
  const sorted = [...returns].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
  const grossWins = winsR.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(lossesR.reduce((a, b) => a + b, 0));
  const sharpe = stdR === 0 ? null : (avg / stdR) * Math.sqrt(252 * 24);
  const wr = dec.length === 0 ? null : hits.length / dec.length;
  const avgWin = winsR.length === 0 ? null : mean(winsR);
  const avgLoss = lossesR.length === 0 ? null : mean(lossesR);
  const expectancy = (wr !== null && avgWin !== null && avgLoss !== null)
    ? wr * avgWin + (1 - wr) * avgLoss
    : null;
  return {
    totalTrades: trades.length, hits: hits.length, misses: losses.length, flats,
    winRate: wr, avgReturn: avg, medianReturn: median, stdReturn: stdR,
    totalReturn: returns.reduce((a, b) => a + b, 0),
    sharpeAnnualized: sharpe, maxDrawdown: mdd, expectancy,
    profitFactor: grossLosses === 0 ? (grossWins > 0 ? Infinity : null) : grossWins / grossLosses,
    bestTrade: returns.length === 0 ? 0 : Math.max(...returns),
    worstTrade: returns.length === 0 ? 0 : Math.min(...returns),
    avgWin, avgLoss,
  };
}

function randomBaseline(trades: readonly Trade[]): Metrics {
  if (trades.length === 0) return emptyMetrics();
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const synth: Trade[] = trades.map((t) => {
    const direction: "up" | "down" = rand() < 0.5 ? "up" : "down";
    const movePct = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
    let outcome: "hit" | "miss" | "flat"; let returnPct: number;
    if (Math.abs(movePct) < 0.3) { outcome = "flat"; returnPct = 0; }
    else if (direction === "up") { outcome = movePct > 0 ? "hit" : "miss"; returnPct = movePct; }
    else { outcome = movePct < 0 ? "hit" : "miss"; returnPct = -movePct; }
    return { ...t, direction, outcome, returnPct };
  });
  return calcMetrics(synth);
}

function buyAndHoldBaseline(candles: readonly { timestamp: number; close: number }[]): Metrics {
  if (candles.length < 251) return emptyMetrics();
  const entry = candles[250]!;
  const exit = candles[candles.length - 1]!;
  const returnPct = ((exit.close - entry.close) / entry.close) * 100;
  const synth: Trade[] = [{
    entryIndex: 250, entryTime: entry.timestamp, entryPrice: entry.close,
    exitIndex: candles.length - 1, exitTime: exit.timestamp, exitPrice: exit.close,
    direction: "up", outcome: returnPct > 0 ? "hit" : "miss",
    returnPct, technicalScore: null, probability: 0, baseline: 0, ciLower: 0, edge: 0,
    regime: null, rsi: null,
  }];
  return calcMetrics(synth);
}

function emptyMetrics(): Metrics {
  return {
    totalTrades: 0, hits: 0, misses: 0, flats: 0, winRate: null,
    avgReturn: 0, medianReturn: 0, stdReturn: 0, totalReturn: 0,
    sharpeAnnualized: null, maxDrawdown: 0, expectancy: null,
    profitFactor: null, bestTrade: 0, worstTrade: 0,
    avgWin: null, avgLoss: null,
  };
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return "n/a";
  if (Number.isNaN(n) || !Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}
function fmtPct(n: number | null | undefined, d = 1): string {
  if (n === null || n === undefined) return "n/a";
  return (n * 100).toFixed(d) + "%";
}

function report(label: string, m: Metrics, opts: { baseline?: Metrics; bnh?: Metrics } = {}) {
  console.log(`\n[${label}]`);
  console.log(`  n=${m.totalTrades} | hit=${m.hits} miss=${m.misses} flat=${m.flats}`);
  console.log(`  win rate (excl flat):  ${fmtPct(m.winRate)}`);
  console.log(`  avg return:            ${fmt(m.avgReturn, 4)}%`);
  console.log(`  median return:         ${fmt(m.medianReturn, 4)}%`);
  console.log(`  std return:            ${fmt(m.stdReturn, 4)}%`);
  console.log(`  total return (sum):    ${fmt(m.totalReturn, 4)}%`);
  console.log(`  avg win:               ${fmt(m.avgWin, 4)}%`);
  console.log(`  avg loss:              ${fmt(m.avgLoss, 4)}%`);
  console.log(`  sharpe anualizado:     ${fmt(m.sharpeAnnualized, 3)}`);
  console.log(`  max drawdown:          ${fmt(m.maxDrawdown, 4)}%`);
  console.log(`  expectancy:            ${fmt(m.expectancy, 4)}%`);
  console.log(`  profit factor:         ${fmt(m.profitFactor, 3)}`);
  console.log(`  best/worst trade:      ${fmt(m.bestTrade, 2)}% / ${fmt(m.worstTrade, 2)}%`);
  if (opts.baseline) {
    const bm = opts.baseline;
    console.log(`    vs random:           wr ${fmtPct(m.winRate! - bm.winRate!)} | exp ${fmt((m.expectancy ?? 0) - (bm.expectancy ?? 0), 4)}%`);
  }
  if (opts.bnh) {
    console.log(`    buy-and-hold retorno: ${fmt(opts.bnh.avgReturn, 4)}% (1 trade)`);
  }
}

function showTopBottom(label: string, trades: readonly Trade[]) {
  if (trades.length === 0) return;
  const sorted = [...trades].sort((a, b) => b.returnPct - a.returnPct);
  console.log(`\n[${label}] TOP 5 MELHORES:`);
  for (const t of sorted.slice(0, 5)) {
    const et = new Date(t.entryTime).toISOString().replace("T", " ").slice(0, 19);
    const xt = new Date(t.exitTime).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  ${t.direction.toUpperCase().padEnd(4)} | ${et} → ${xt} | ret ${t.returnPct.toFixed(3)}% | ${t.outcome} | score ${t.technicalScore?.toFixed(2)} edge ${t.edge.toFixed(3)}`);
  }
  console.log(`[${label}] TOP 5 PIORES:`);
  for (const t of sorted.slice(-5).reverse()) {
    const et = new Date(t.entryTime).toISOString().replace("T", " ").slice(0, 19);
    const xt = new Date(t.exitTime).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  ${t.direction.toUpperCase().padEnd(4)} | ${et} → ${xt} | ret ${t.returnPct.toFixed(3)}% | ${t.outcome} | score ${t.technicalScore?.toFixed(2)} edge ${t.edge.toFixed(3)}`);
  }
}

function main() {
  const data = JSON.parse(readFileSync("trades.json", "utf-8")) as {
    mode: string;
    wilson: Trade[]; fusion: Trade[]; score: Trade[];
    totalCandles: number; generatedAt: number;
  };
  const candlesRaw = JSON.parse(readFileSync("candles-btc-1h-90d.json", "utf-8")) as BinanceKline[];
  const candles = parseKlines(candlesRaw);

  console.log("=".repeat(80));
  console.log("MÉTRICAS DO BACKTEST WALK-FORWARD (BTCUSDT 1h, 90d)");
  console.log("=".repeat(80));
  console.log(`Total candles: ${data.totalCandles} | período: ${new Date(candles[0]!.timestamp).toISOString().slice(0,10)} → ${new Date(candles[candles.length - 1]!.timestamp).toISOString().slice(0,10)}`);
  console.log(`Horizão: 12 candles | flat threshold: 0.3% | min history: 250`);

  const bnh = buyAndHoldBaseline(candles);

  // Modo 1: WILSON (motor completo)
  const mWilson = calcMetrics(data.wilson);
  const rWilson = randomBaseline(data.wilson);
  report("MODO 1: MOTOR COMPLETO (Wilson + Fusion)", mWilson, { baseline: rWilson, bnh });
  showTopBottom("MODO 1", data.wilson);

  // Modo 2: FUSION (sem Wilson)
  const mFusion = calcMetrics(data.fusion);
  const rFusion = randomBaseline(data.fusion);
  report("MODO 2: FUSION CLÁSSICO (sem Wilson)", mFusion, { baseline: rFusion, bnh });
  showTopBottom("MODO 2", data.fusion);

  // Modo 3: SCORE
  const mScore = calcMetrics(data.score);
  const rScore = randomBaseline(data.score);
  report("MODO 3: SCORE TÉCNICO (|score|>0.18)", mScore, { baseline: rScore, bnh });
  showTopBottom("MODO 3", data.score);

  // Distribuição de outcomes
  for (const [name, t] of [["wilson", data.wilson], ["fusion", data.fusion], ["score", data.score]] as const) {
    if (t.length === 0) continue;
    const h = t.filter((x) => x.outcome === "hit").length;
    const m = t.filter((x) => x.outcome === "miss").length;
    const f = t.filter((x) => x.outcome === "flat").length;
    const tot = t.length;
    console.log(`\n[dist ${name}] hit ${h} (${(h/tot*100).toFixed(1)}%) | miss ${m} (${(m/tot*100).toFixed(1)}%) | flat ${f} (${(f/tot*100).toFixed(1)}%)`);
  }

  // Salvar
  const out = {
    periodStart: candles[0]!.timestamp,
    periodEnd: candles[candles.length - 1]!.timestamp,
    totalCandles: data.totalCandles,
    buyAndHold: bnh,
    wilson: mWilson, wilson_random: rWilson,
    fusion: mFusion, fusion_random: rFusion,
    score: mScore, score_random: rScore,
    nTrades: { wilson: data.wilson.length, fusion: data.fusion.length, score: data.score.length },
    generatedAt: Date.now(),
  };
  writeFileSync("metrics.json", JSON.stringify(out, null, 2));
  console.log("\nMétricas salvas em metrics.json");
}

main();
