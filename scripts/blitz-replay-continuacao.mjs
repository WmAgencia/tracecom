/**
 * REPLAY DOS TRADES REAIS DO BLITZ contra o padrao de CONTINUACAO (sem vies).
 *
 * Para cada trade real do Blitz (reversao) que esteja dentro da janela dos candles arquivados:
 *  - reconstroi o snapshot causal (candles anteriores) e classifica o CENARIO (ADX x Bollinger);
 *  - se o cenario casa com o padrao (ADX TRANSITIONAL + BB WALK), mede o resultado da
 *    CONTINUACAO (lado OPOSTO ao trade) nas expiracoes 30s / 60s / 300s.
 *
 * Uso: node scripts/blitz-replay-continuacao.mjs <candles.csv.gz>
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { analyzeRsiAgent } from "../relay/agents/rsi.agent.mjs";
import { analyzeBollingerAgent } from "../relay/agents/bollinger.agent.mjs";
import { analyzeAdxAgent } from "../relay/agents/adx.agent.mjs";

const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");
const file = process.argv[2];
if (!file) { console.error("uso: node scripts/blitz-replay-continuacao.mjs <candles.csv.gz>"); process.exit(2); }

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
console.log("MERCADOS_NO_ARQUIVO=" + byMarket.size);

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL || "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify",
  max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000,
});
const trades = (await pool.query("SELECT market_key, direction, entry_at, result FROM iq_lab_trades WHERE run_id='agentic-blitz-45s' AND entry_at IS NOT NULL ORDER BY entry_at")).rows;
await pool.end();
console.log("TRADES_BLITZ=" + trades.length);

const EXPIRIES = [6, 12, 60];   // 30s, 60s, 300s
const stats = new Map(EXPIRIES.map((e) => [e, { w: 0, l: 0, d: 0, scenarios: {} }]));
let matched = 0; let analyzed = 0;
for (const trade of trades) {
  const list = byMarket.get(trade.market_key);
  if (!list || list.length < 130) continue;
  const entryMs = new Date(trade.entry_at).getTime();
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) { if (list[i].bucketEnd <= entryMs + 2_000) { idx = i; break; } }
  if (idx < 120 || idx > list.length - 65) continue;
  analyzed += 1;
  const past = list.slice(idx - 120, idx + 1);
  const snapshot = buildMarketSnapshot({ marketKey: trade.market_key, marketType: "OTC", candles: past, now: list[idx].bucketEnd, payout: 89, targetExpiryAt: list[idx].bucketEnd + 60_000 });
  if (!snapshot) continue;
  const rsi = analyzeRsiAgent(snapshot); const bb = analyzeBollingerAgent(snapshot); const adx = analyzeAdxAgent(snapshot);
  const scenario = "ADX:" + (adx?.regime ?? "?") + "~BB:" + (bb?.regime ?? "?");
  if (adx?.regime !== "TRANSITIONAL" || bb?.regime !== "WALK") continue;   // padrao encontrado no backtest
  matched += 1;
  const entry = list[idx].close;
  const up = String(trade.direction).toUpperCase() === "BUY";
  for (const expiry of EXPIRIES) {
    const exitIdx = idx + expiry;
    if (exitIdx >= list.length) continue;
    const exit = list[exitIdx].close;
    const contUp = !up;                                        // CONTINUACAO = lado oposto ao trade de reversao
    const outcome = exit === entry ? "d" : (contUp ? exit > entry : exit < entry) ? "w" : "l";
    const row = stats.get(expiry);
    row[outcome] += 1;
    row.scenarios[scenario] = (row.scenarios[scenario] ?? 0) + 1;
  }
}

console.log("DENTRO_DA_JANELA=" + analyzed + " | CENARIO_CASA (TRANSITIONAL+WALK)=" + matched);
for (const expiry of EXPIRIES) {
  const r = stats.get(expiry);
  const n = r.w + r.l;
  console.log("  CONTINUACAO " + String(expiry * 5 + "s").padStart(5) + ": " + (n ? (100 * r.w / n).toFixed(1) + "%" : "-") + " (n=" + n + ", w=" + r.w + ", l=" + r.l + ", d=" + r.d + ")");
}
