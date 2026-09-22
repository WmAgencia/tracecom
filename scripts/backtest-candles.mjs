/**
 * BACKTEST SEM VIES — replay causal do grafo agentic sobre os candles arquivados (5s).
 *
 * Regras de honestidade (sem enviesar pelo resultado):
 *  - Em cada decisao usamos SOMENTE candles passados (snapshot causal do proprio runtime).
 *  - A entrada e no candle SEGUINTE ao sinal (preco de mercado), nunca no candle do sinal.
 *  - O resultado e o close no vencimento (60s = 12 candles depois) vs preco de entrada.
 *  - Nenhum parametro e ajustado olhando o resultado: a grade e fixa e pre-declarada.
 *
 * Uso: node scripts/backtest-candles.mjs <candles.csv.gz> [--max-markets 30] [--hours 6]
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { runConsensusAgent } from "../relay/agents/consensus.agent.mjs";
import { analyzeRsiAgent } from "../relay/agents/rsi.agent.mjs";
import { analyzeBollingerAgent } from "../relay/agents/bollinger.agent.mjs";
import { analyzeAdxAgent } from "../relay/agents/adx.agent.mjs";
import { analyzeAtrAgent } from "../relay/agents/atr.agent.mjs";
import { analyzeFibAgent } from "../relay/agents/fib.agent.mjs";

const file = process.argv[2];
if (!file) { console.error("uso: node scripts/backtest-candles.mjs <candles.csv.gz>"); process.exit(2); }
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const MAX_MARKETS = arg("--max-markets", 30);
const HOURS = arg("--hours", 24);

// ---------- carga ----------
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
const series = [...byMarket.entries()]
  .slice(0, MAX_MARKETS)
  .map(([market, map]) => ({ market, candles: [...map.values()].filter((c) => c.bucketEnd >= cutoff).sort((a, b) => a.bucketEnd - b.bucketEnd) }))
  .filter((s) => s.candles.length > 200);
console.log("MERCADOS=" + series.length + " candles=" + series.reduce((a, s) => a + s.candles.length, 0));

// ---------- RSI simples (Wilder 14) para pre-filtrar o gatilho ----------
const rsiAt = (closes, end, period = 14) => {
  if (end < period) return null;
  let gain = 0; let loss = 0;
  for (let i = end - period + 1; i <= end; i += 1) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  const avgGain = gain / period; const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

// ---------- grade fixa (pre-declarada) ----------
const LEVELS = [100, 90, 80, 70, 50];
const VARIANTS = ["", "F", "T", "FT", "S", "FTS"];
const TIMINGS = [0, 1, 2, 3, 6];          // candles de espera apos o sinal (0/5/10/15/30s)
const EXPIRY_CANDLES = 12;                 // 60s
const variantFilters = (v) => (v ? { confirmation: v.includes("F"), stochastic: v.includes("T"), noSqueeze: v.includes("S") } : null);
const strategies = [];
for (const level of LEVELS) for (const variant of VARIANTS) strategies.push({ label: String(level) + variant, level, variant, filters: variantFilters(variant) });

const stats = new Map(strategies.map((s) => [s.label, new Map(TIMINGS.map((t) => [t, { w: 0, l: 0, d: 0 }]))]));

// ---------- replay ----------
let triggers = 0;
for (const { market, candles } of series) {
  const closes = candles.map((c) => c.close);
  for (let i = 60; i < candles.length - EXPIRY_CANDLES - 10; i += 1) {
    const rsi = rsiAt(closes, i);
    if (rsi === null || (rsi < 70 && rsi > 30)) continue;      // so nos extremos (gatilho)
    triggers += 1;
    const past = candles.slice(Math.max(0, i - 120), i + 1);   // causal: ate o candle i
    const snapshot = buildMarketSnapshot({ marketKey: market, marketType: "OTC", candles: past, now: candles[i].bucketEnd, payout: 89, targetExpiryAt: candles[i].bucketEnd + 60_000 });
    if (!snapshot) continue;
    const opinions = {
      rsi: analyzeRsiAgent(snapshot), bollinger: analyzeBollingerAgent(snapshot), adx: analyzeAdxAgent(snapshot),
      atr: analyzeAtrAgent(snapshot), fib: analyzeFibAgent(snapshot),
    };
    for (const strategy of strategies) {
      const consensus = runConsensusAgent({ snapshot, opinions, safetyPct: strategy.level, filters: strategy.filters });
      if (consensus.decision !== "BUY" && consensus.decision !== "SELL") continue;
      for (const wait of TIMINGS) {
        const entryIndex = i + 1 + wait;                        // entrada no candle SEGUINTE (+ espera)
        const expiryIndex = entryIndex + EXPIRY_CANDLES;
        if (expiryIndex >= candles.length) continue;
        const entry = candles[entryIndex].close;
        const exit = candles[expiryIndex].close;
        const up = consensus.decision === "BUY";
        const outcome = exit === entry ? "d" : (up ? exit > entry : exit < entry) ? "w" : "l";
        stats.get(strategy.label).get(wait)[outcome] += 1;
      }
    }
  }
}

// ---------- relatorio ----------
console.log("GATILHOS=" + triggers);
console.log("\nESTRATEGIA | ESPERA | TRADES | WR | EDGE(89%)");
const rows = [];
for (const strategy of strategies) {
  for (const wait of TIMINGS) {
    const s = stats.get(strategy.label).get(wait);
    const n = s.w + s.l;
    if (n < 30) continue;
    const wr = (100 * s.w) / n;
    rows.push({ label: strategy.label, wait, n, wr, edge: wr - 52.9, d: s.d });
  }
}
rows.sort((a, b) => b.wr - a.wr);
for (const r of rows.slice(0, 40)) console.log(String(r.label).padStart(6) + " | " + String(r.wait * 5 + "s").padStart(5) + " | " + String(r.n).padStart(6) + " | " + r.wr.toFixed(1) + "% | " + (r.edge >= 0 ? "+" : "") + r.edge.toFixed(1) + "pp (d=" + r.d + ")");
console.log("\nMELHOR_WR=" + (rows[0] ? rows[0].label + " @" + rows[0].wait * 5 + "s = " + rows[0].wr.toFixed(1) + "% (n=" + rows[0].n + ")" : "-"));
