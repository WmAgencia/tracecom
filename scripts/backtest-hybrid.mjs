/**
 * BACKTEST HIBRIDO POR CENARIO — 30s a 5min, varias familias, sem vies.
 *
 * 1. Em cada gatilho (RSI >=70/<=30) classificamos o CENARIO usando SOMENTE dados passados
 *    (regime do ADX x regime do Bollinger).
 * 2. Testamos familias pre-declaradas em TODOS os cenarios e expiracoes (30s..300s).
 * 3. Split 70% descoberta / 30% validacao: escolhemos a melhor familia de cada cenario
 *    APENAS na descoberta e medimos o HIBRIDO fora da amostra.
 *
 * Uso: node scripts/backtest-hybrid.mjs <candles.csv.gz> [--hours 24]
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { analyzeRsiAgent } from "../relay/agents/rsi.agent.mjs";
import { analyzeBollingerAgent } from "../relay/agents/bollinger.agent.mjs";
import { analyzeAdxAgent } from "../relay/agents/adx.agent.mjs";
import { analyzeAtrAgent } from "../relay/agents/atr.agent.mjs";
import { analyzeFibAgent } from "../relay/agents/fib.agent.mjs";

const file = process.argv[2];
if (!file) { console.error("uso: node scripts/backtest-hybrid.mjs <candles.csv.gz> [--hours 24]"); process.exit(2); }
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const HOURS = arg("--hours", 24);

const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
const byMarket = new Map();
for (const line of text.split("\n")) {
  if (!line || line.startsWith("market,")) continue;
  const [market, bucketEnd, open, high, low, close] = line.split(",");
  const t = Number(bucketEnd);
  if (!Number.isFinite(t)) continue;
  if (!byMarket.has(market)) byMarket.set(market, new Map());
  byMarket.get(market).set(t, { bucketStart: t - 5000, bucketEnd: t, open: Number(open), high: Number(high), low: Number(low), close: Number(close) });
}
const cutoff = Date.now() - HOURS * 3_600_000;
const series = [...byMarket.entries()].slice(0, 30)
  .map(([market, map]) => ({ market, candles: [...map.values()].filter((c) => c.bucketEnd >= cutoff).sort((a, b) => a.bucketEnd - b.bucketEnd) }))
  .filter((s) => s.candles.length > 200);

const rsiAt = (closes, end, period = 14) => {
  if (end < period) return null;
  let gain = 0; let loss = 0;
  for (let i = end - period + 1; i <= end; i += 1) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + (gain / period) / (loss / period));
};

const EXPIRIES = [6, 9, 12, 24, 36, 48, 60];      // 30s,45s,60s,120s,180s,240s,300s
const FAMILIES = ["REVERSAO", "CONTINUACAO", "BANDA", "ROMPIMENTO"];
const counts = new Map();                          // cenario|familia|exp|half -> {w,l,d}
const bump = (scenario, family, expiry, half, outcome) => {
  const k = scenario + "|" + family + "|" + expiry + "|" + half;
  const row = counts.get(k) ?? { w: 0, l: 0, d: 0 };
  row[outcome] += 1; counts.set(k, row);
};

let triggers = 0;
for (const { market, candles } of series) {
  const closes = candles.map((c) => c.close);
  for (let i = 60; i < candles.length - 60 - 10; i += 1) {
    const rsi = rsiAt(closes, i);
    if (rsi === null || (rsi < 70 && rsi > 30)) continue;
    triggers += 1;
    const past = candles.slice(Math.max(0, i - 120), i + 1);
    const snapshot = buildMarketSnapshot({ marketKey: market, marketType: "OTC", candles: past, now: candles[i].bucketEnd, payout: 89, targetExpiryAt: candles[i].bucketEnd + 60_000 });
    if (!snapshot) continue;
    const opinions = { rsi: analyzeRsiAgent(snapshot), bollinger: analyzeBollingerAgent(snapshot), adx: analyzeAdxAgent(snapshot), atr: analyzeAtrAgent(snapshot), fib: analyzeFibAgent(snapshot) };
    const side = opinions.rsi?.side;
    if (!side) continue;
    const buy = side === "BUY";
    const adxRegime = opinions.adx?.regime ?? "?";
    const bbRegime = opinions.bollinger?.regime ?? "?";
    const scenario = "ADX:" + adxRegime + "~BB:" + bbRegime;
    const win = candles.slice(Math.max(0, i - 20), i + 1);
    const hi = Math.max(...win.map((c) => c.high));
    const lo = Math.min(...win.map((c) => c.low));
    const signals = [
      ["REVERSAO", side],
      ["CONTINUACAO", buy ? "SELL" : "BUY"],
      ["BANDA", opinions.bollinger?.rejection === "LOWER" ? "BUY" : opinions.bollinger?.rejection === "UPPER" ? "SELL" : null],
      ["ROMPIMENTO", candles[i].close > hi - 1e-9 ? "BUY" : candles[i].close < lo + 1e-9 ? "SELL" : null],
    ];
    const half = i < candles.length * 0.7 ? "in" : "out";
    for (const [family, direction] of signals) {
      if (!direction) continue;
      for (const expiry of EXPIRIES) {
        const entryIndex = i + 1;
        const expiryIndex = entryIndex + expiry;
        if (expiryIndex >= candles.length) continue;
        const entry = candles[entryIndex].close;
        const exit = candles[expiryIndex].close;
        const up = direction === "BUY";
        const outcome = exit === entry ? "d" : (up ? exit > entry : exit < entry) ? "w" : "l";
        bump(scenario, family, expiry, half, outcome);
      }
    }
  }
}

// melhor familia por cenario/exp na descoberta; hibrido validado fora da amostra
const bestPerScenario = new Map();
for (const [key, row] of counts.entries()) {
  const [scenario, family, expiry, half] = key.split("|");
  if (half !== "in") continue;
  const n = row.w + row.l;
  if (n < 60) continue;
  const wr = (100 * row.w) / n;
  const cur = bestPerScenario.get(scenario);
  if (!cur || wr > cur.wr) bestPerScenario.set(scenario, { family, expiry: Number(expiry), wr, n });
}
console.log("GATILHOS=" + triggers + " | cenarios=" + bestPerScenario.size);
console.log("\nMELHOR FAMILIA POR CENARIO (descoberta, n>=60):");
for (const [scenario, b] of [...bestPerScenario.entries()].sort((a, b2) => b2[1].wr - a[1].wr)) {
  console.log("  " + scenario.padEnd(28) + " -> " + b.family.padEnd(12) + " exp=" + (b.expiry * 5 + "s").padStart(5) + " in " + b.wr.toFixed(1) + "% (n=" + b.n + ")");
}
let hw = 0; let hl = 0; let hd = 0;
for (const [scenario, b] of bestPerScenario.entries()) {
  const row = counts.get(scenario + "|" + b.family + "|" + b.expiry + "|out");
  if (!row) continue;
  hw += row.w; hl += row.l; hd += row.d;
}
const hn = hw + hl;
console.log("\nHIBRIDO FORA DA AMOSTRA: " + (hn ? (100 * hw / hn).toFixed(1) + "% (n=" + hn + ", d=" + hd + ")" : "-"));
console.log("\nTODAS AS FAMILIAS x EXP (out, n>=80):");
const outRows = [];
for (const [key, row] of counts.entries()) {
  const [scenario, family, expiry, half] = key.split("|");
  if (half !== "out") continue;
  const n = row.w + row.l;
  if (n < 80) continue;
  outRows.push({ scenario, family, expiry: Number(expiry), wr: (100 * row.w) / n, n });
}
outRows.sort((a, b) => b.wr - a.wr);
for (const r of outRows.slice(0, 12)) console.log("  " + String(r.wr.toFixed(1) + "%").padStart(6) + " n=" + String(r.n).padStart(4) + " exp=" + (r.expiry * 5 + "s").padStart(5) + "  " + r.scenario + " " + r.family);
