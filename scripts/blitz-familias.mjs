/**
 * TODAS AS FAMILIAS NOS TRADES REAIS DO BLITZ — com controle aleatorio (sem vies).
 *
 * Para cada trade real do Blitz dentro da janela dos candles arquivados, reconstruimos o
 * snapshot causal e medimos o resultado de TODAS as familias de sinal em 30s/60s/300s.
 * Inclui ALEATORIO (controle): se o aleatorio tambem "acerta", o dado esta enviesado.
 *
 * Uso: node scripts/blitz-familias.mjs <candles.csv.gz>
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { analyzeRsiAgent } from "../relay/agents/rsi.agent.mjs";
import { analyzeBollingerAgent } from "../relay/agents/bollinger.agent.mjs";
import { analyzeAdxAgent } from "../relay/agents/adx.agent.mjs";
import { analyzeAtrAgent } from "../relay/agents/atr.agent.mjs";
import { analyzeFibAgent } from "../relay/agents/fib.agent.mjs";

const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
const file = process.argv[2];
if (!file) { console.error("uso: node scripts/blitz-familias.mjs <candles.csv.gz>"); process.exit(2); }

const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
const byMarket = new Map();
for (const line of text.split("\n")) {
  if (!line || line.startsWith("market,")) continue;
  const [market, bucketEnd, open, high, low, close] = line.split(",");
  const t = Number(bucketEnd);
  if (!Number.isFinite(t)) continue;
  if (!byMarket.has(market)) byMarket.set(market, []);
  byMarket.get(market).push({ bucketStart: t - 5000, bucketEnd: t, open: Number(open), high: Number(high), low: Number(low), close: Number(close) });
}
for (const list of byMarket.values()) list.sort((a, b) => a.bucketEnd - b.bucketEnd);

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify",
  max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000,
});
const trades = (await pool.query("SELECT strategy_trade_id, market_key, direction, entry_at FROM iq_lab_trades WHERE run_id='agentic-blitz-45s' AND entry_at IS NOT NULL ORDER BY entry_at")).rows;
await pool.end();
console.log("TRADES_BLITZ=" + trades.length);

const EXPIRIES = [6, 12, 60];  // 30s, 60s, 300s
const stats = new Map();       // familia|scenario|exp -> {w,l,d}
const bump = (family, scenario, expiry, outcome) => {
  const k = family + "~" + scenario + "~" + expiry;
  const row = stats.get(k) ?? { family, scenario, expiry, w: 0, l: 0, d: 0 };
  row[outcome] += 1; stats.set(k, row);
};
const hash01 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; };

let used = 0;
for (const trade of trades) {
  const list = byMarket.get(trade.market_key);
  if (!list || list.length < 130) continue;
  const entryMs = new Date(trade.entry_at).getTime();
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) { if (list[i].bucketEnd <= entryMs + 2_000) { idx = i; break; } }
  if (idx < 120 || idx > list.length - 65) continue;
  used += 1;
  const past = list.slice(idx - 120, idx + 1);
  const snapshot = buildMarketSnapshot({ marketKey: trade.market_key, marketType: "OTC", candles: past, now: list[idx].bucketEnd, payout: 89, targetExpiryAt: list[idx].bucketEnd + 60_000 });
  if (!snapshot) continue;
  const rsi = analyzeRsiAgent(snapshot); const bb = analyzeBollingerAgent(snapshot); const adx = analyzeAdxAgent(snapshot); const fib = analyzeFibAgent(snapshot);
  const scenario = "ADX:" + (adx?.regime ?? "?") + "~BB:" + (bb?.regime ?? "?");
  const tradeSide = String(trade.direction).toUpperCase() === "BUY" ? "BUY" : "SELL";
  const opposite = tradeSide === "BUY" ? "SELL" : "BUY";
  const closes = past.map((c) => c.close);
  const mom3 = closes[closes.length - 1] > closes[closes.length - 4] ? "BUY" : "SELL";
  const mom6 = closes[closes.length - 1] > closes[closes.length - 7] ? "BUY" : "SELL";
  const lastCandle = past[past.length - 1];
  const candleDir = lastCandle.close > lastCandle.open ? "BUY" : "SELL";
  const bandDir = bb?.rejection === "LOWER" ? "BUY" : bb?.rejection === "UPPER" ? "SELL" : null;
  const win = past.slice(-20);
  const hi = Math.max(...win.map((c) => c.high)); const lo = Math.min(...win.map((c) => c.low));
  const breakDir = lastCandle.close > hi - 1e-9 ? "BUY" : lastCandle.close < lo + 1e-9 ? "SELL" : null;
  const adxDomDir = Number(adx?.plusDI) > Number(adx?.minusDI) ? "BUY" : "SELL";
  const fibDir = fib?.direction === "BULLISH_LEG" ? "BUY" : fib?.direction === "BEARISH_LEG" ? "SELL" : null;
  const families = [
    ["REVERSAO", tradeSide], ["CONTINUACAO", opposite],
    ["MOMENTO_3", mom3], ["CONTRA_MOMENTO_3", mom3 === "BUY" ? "SELL" : "BUY"],
    ["MOMENTO_6", mom6], ["CONTRA_MOMENTO_6", mom6 === "BUY" ? "SELL" : "BUY"],
    ["CANDLE", candleDir], ["CONTRA_CANDLE", candleDir === "BUY" ? "SELL" : "BUY"],
    ["BANDA", bandDir], ["ROMPIMENTO", breakDir],
    ["ADX_DOMINANCIA", adxDomDir], ["CONTRA_ADX_DOMINANCIA", adxDomDir === "BUY" ? "SELL" : "BUY"],
    ["FIB_LEG", fibDir], ["CONTRA_FIB_LEG", fibDir ? (fibDir === "BUY" ? "SELL" : "BUY") : null],
    ["ALEATORIO", hash01(trade.strategy_trade_id) < 0.5 ? "BUY" : "SELL"],
  ];
  const entry = list[idx].close;
  for (const [family, direction] of families) {
    if (!direction) continue;
    for (const expiry of EXPIRIES) {
      const exitIdx = idx + expiry;
      if (exitIdx >= list.length) continue;
      const exit = list[exitIdx].close;
      const up = direction === "BUY";
      const outcome = exit === entry ? "d" : (up ? exit > entry : exit < entry) ? "w" : "l";
      bump(family, scenario, expiry, outcome);
      bump(family, "TODOS", expiry, outcome);
    }
  }
}

console.log("DENTRO_DA_JANELA=" + used);
const familyNames = [...new Set([...stats.values()].map((r) => r.family))];
console.log("\nFAMILIA (TODOS os cenarios) | 30s | 60s | 300s");
for (const family of familyNames) {
  const cells = EXPIRIES.map((expiry) => {
    const row = stats.get(family + "~TODOS~" + expiry);
    if (!row) return "-";
    const n = row.w + row.l;
    return n ? (100 * row.w / n).toFixed(1) + "% (n=" + n + ")" : "-";
  });
  console.log("  " + family.padEnd(24) + cells.join(" | "));
}
console.log("\nTOP FAMILIA x CENARIO (300s, n>=25):");
const rows = [...stats.values()].filter((r) => r.expiry === 60 && r.scenario !== "TODOS" && r.w + r.l >= 25)
  .map((r) => ({ ...r, wr: (100 * r.w) / (r.w + r.l) })).sort((a, b) => b.wr - a.wr);
for (const r of rows.slice(0, 15)) console.log("  " + r.wr.toFixed(1) + "% n=" + String(r.w + r.l).padStart(4) + "  " + r.family.padEnd(22) + " " + r.scenario);
