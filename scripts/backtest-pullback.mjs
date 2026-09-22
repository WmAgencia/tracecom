/**
 * BACKTEST — PULLBACK (RSI contra a tendencia na estrutura de 30 min) sobre os candles arquivados.
 *
 * Honestidade:
 *  - Causal: snapshot usa somente candles fechados ate i; entrada no candle SEGUINTE (close).
 *  - Series quebradas em segmentos contiguos (janelas de arquivo com buracos nao se misturam).
 *  - Split 70/30 in/out por segmento; controle aleatorio; expiracoes 120s/180s/300s.
 *
 * Uso: node scripts/backtest-pullback.mjs <arq1.csv.gz> [arq2 ...] [--warmup 200] [--cooldown 60] [--out x.json]
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { analyzeRsiAgent } from "../relay/agents/rsi.agent.mjs";
import { analyzeBollingerAgent } from "../relay/agents/bollinger.agent.mjs";
import { analyzeAdxAgent } from "../relay/agents/adx.agent.mjs";
import { analyzeAtrAgent } from "../relay/agents/atr.agent.mjs";
import { analyzeFibAgent } from "../relay/agents/fib.agent.mjs";
import { analyzeCandleAgent } from "../relay/agents/candle.agent.mjs";
import { evaluateCustomStrategies } from "../relay/agents/custom-strategies.mjs";

const files = process.argv.slice(2).filter((a) => a.endsWith(".gz"));
if (!files.length) { console.error("uso: node scripts/backtest-pullback.mjs <candles.csv.gz> [...]"); process.exit(2); }
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const WARMUP = arg("--warmup", 200);
const COOLDOWN_MS = arg("--cooldown", 60) * 1000;
const OUT = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : null; })();

const byMarket = new Map();
for (const file of files) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("market,")) continue;
    const [market, bucketEnd, open, high, low, close] = line.split(",");
    const t = Number(bucketEnd);
    if (!Number.isFinite(t)) continue;
    if (!byMarket.has(market)) byMarket.set(market, new Map());
    byMarket.get(market).set(t, { bucketStart: t - 5000, bucketEnd: t, open: Number(open), high: Number(high), low: Number(low), close: Number(close) });
  }
}
const series = [];
for (const [market, map] of byMarket.entries()) {
  const list = [...map.values()].sort((a, b) => a.bucketEnd - b.bucketEnd);
  let seg = [list[0]];
  for (let i = 1; i < list.length; i += 1) {
    if (list[i].bucketEnd - list[i - 1].bucketEnd > 30_000) { series.push({ market, candles: seg }); seg = [list[i]]; }
    else seg.push(list[i]);
  }
  series.push({ market, candles: seg });
}
const usable = series.filter((s) => s.candles.length > WARMUP + 80);
console.log(`ARQUIVOS=${files.length} MERCADOS=${byMarket.size} SEGMENTOS=${series.length} USABLES=${usable.length} CANDLES=${usable.reduce((a, s) => a + s.candles.length, 0)}`);

const EXPIRIES = [24, 36, 60];
const rows = [];
const rand = (() => { let seed = 12345; return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; })();

for (const { market, candles } of usable) {
  const lastSignalAt = new Map();
  for (let i = WARMUP; i < candles.length - 61; i += 1) {
    const past = candles.slice(Math.max(0, i - 420), i + 1);
    const now = candles[i].bucketEnd;
    const snapshot = buildMarketSnapshot({ marketKey: market, marketType: "OTC", candles: past, now, payout: 82, targetExpiryAt: now + 60_000 });
    if (!snapshot) continue;
    const opinions = {
      rsi: analyzeRsiAgent(snapshot), bollinger: analyzeBollingerAgent(snapshot), adx: analyzeAdxAgent(snapshot),
      atr: analyzeAtrAgent(snapshot), fib: analyzeFibAgent(snapshot), candle: analyzeCandleAgent(snapshot),
    };
    const decisions = evaluateCustomStrategies({ snapshot, opinions });
    for (const d of decisions) {
      if (!d.side) continue;
      const lastAt = lastSignalAt.get(d.id) ?? 0;
      if (now - lastAt < COOLDOWN_MS) continue;
      lastSignalAt.set(d.id, now);
      const entry = Number(candles[i + 1]?.close);
      if (!Number.isFinite(entry)) continue;
      const half = i < candles.length * 0.7 ? "in" : "out";
      const outcomes = {};
      for (const expiry of EXPIRIES) {
        const exit = Number(candles[i + 1 + expiry]?.close);
        outcomes[expiry] = !Number.isFinite(exit) ? null : exit === entry ? "d" : (d.side === "BUY" ? exit > entry : exit < entry) ? "w" : "l";
      }
      const randSide = rand() < 0.5 ? "BUY" : "SELL";
      const randOutcomes = {};
      for (const expiry of EXPIRIES) {
        const exit = Number(candles[i + 1 + expiry]?.close);
        randOutcomes[expiry] = !Number.isFinite(exit) ? null : exit === entry ? "d" : (randSide === "BUY" ? exit > entry : exit < entry) ? "w" : "l";
      }
      rows.push({ market, at: new Date(now).toISOString(), variant: d.id, side: d.side, half, outcomes, randOutcomes });
    }
  }
}

const rate = (list) => { const w = list.filter((r) => r === "w").length; const l = list.filter((r) => r === "l").length; const n = w + l; return { n, wr: n ? 100 * w / n : null }; };
const fmt = (r) => r.n ? `n=${String(r.n).padStart(4)} WR=${r.wr.toFixed(1)}%` : "n=0";
console.log("\n== SINAIS POR VARIANTE x EXPIRACAO (in/out) ==");
for (const variant of ["PULLBACK_150", "PULLBACK_300", "PULLBACK_X300", "CONT_300"]) {
  const base = rows.filter((r) => r.variant === variant);
  if (!base.length) { console.log(`  ${variant}: sem sinais`); continue; }
  for (const half of ["in", "out"]) {
    const sub = base.filter((r) => r.half === half);
    const parts = EXPIRIES.map((e) => `${e * 5}s ${fmt(rate(sub.map((r) => r.outcomes[e])))}`);
    console.log(`  ${variant.padEnd(13)} ${half.padEnd(3)} ${parts.join(" | ")}`);
  }
  const all = EXPIRIES.map((e) => `rand ${fmt(rate(base.map((r) => r.randOutcomes[e])))}`).join(" | ");
  console.log(`  ${variant.padEnd(13)} controle: ${all}`);
}
console.log("\nBREAK-EVEN (payout 82%) = 54.9%");
if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), warmup: WARMUP, rows }, null, 0)); console.log("JSON salvo em " + OUT + " (" + rows.length + " sinais)"); }
