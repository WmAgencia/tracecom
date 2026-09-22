/**
 * BACKTEST — janela de historico dos agentes (baseline vs estendida 15 min) sobre candles arquivados.
 *
 * Honestidade:
 *  - Causal: snapshot usa somente candles fechados ate i (bucketEnd <= candle[i].bucketEnd).
 *  - Entrada no candle SEGUINTE (i+1) pelo close; vencimento em i+13 (60s).
 *  - Nenhum parametro ajustado olhando resultado; variantes sao as do codigo (roda antes/depois).
 *
 * Uso: node scripts/backtest-agent-history.mjs <candles.csv.gz> [--safety 50] [--with-candle] [--out x.json]
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
if (!file) { console.error("uso: node scripts/backtest-agent-history.mjs <candles.csv.gz>"); process.exit(2); }
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const has = (name) => process.argv.includes(name);
const SAFETY = arg("--safety", 50);
const WITH_CANDLE = has("--with-candle");
const MAX_MARKETS = arg("--max-markets", 30);
const WARMUP = arg("--warmup", 200);
const OUT = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : null; })();

let analyzeCandleAgent = null;
if (WITH_CANDLE) {
  try { ({ analyzeCandleAgent } = await import("../relay/agents/candle.agent.mjs")); }
  catch (error) { console.error("FALHA ao importar candle.agent.mjs: " + error.message); process.exit(2); }
}

// ---------- carga (dedupe por bucketEnd: ultima linha vence) ----------
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
const series = [...byMarket.entries()].slice(0, MAX_MARKETS)
  .map(([market, map]) => ({ market, candles: [...map.values()].sort((a, b) => a.bucketEnd - b.bucketEnd) }))
  .filter((s) => s.candles.length > WARMUP + 40);
console.log(`MERCADOS=${series.length} candles=${series.reduce((a, s) => a + s.candles.length, 0)} safety=${SAFETY} withCandle=${WITH_CANDLE}`);

const EXPIRY = 12; // 60s
const rows = [];
const rand = (() => { let seed = 42; return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; })();

for (const { market, candles } of series) {
  for (let i = WARMUP; i < candles.length - EXPIRY - 1; i += 1) {
    const past = candles.slice(Math.max(0, i - 359), i + 1);
    const now = candles[i].bucketEnd;
    const snapshot = buildMarketSnapshot({ marketKey: market, marketType: "OTC", candles: past, now, payout: 82, targetExpiryAt: now + 60_000 });
    if (!snapshot) continue;
    const rsiValue = Number(snapshot.indicators?.rsi);
    if (!Number.isFinite(rsiValue) || (rsiValue < 70 && rsiValue > 30)) continue;

    const opinions = {
      rsi: analyzeRsiAgent(snapshot), bollinger: analyzeBollingerAgent(snapshot), adx: analyzeAdxAgent(snapshot),
      atr: analyzeAtrAgent(snapshot), fib: analyzeFibAgent(snapshot),
    };
    if (analyzeCandleAgent) opinions.candle = analyzeCandleAgent(snapshot);
    const consensus = runConsensusAgent({ snapshot, opinions, safetyPct: SAFETY, filters: null });

    const entry = Number(candles[i + 1]?.close);
    const exit = Number(candles[i + 1 + EXPIRY]?.close);
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) continue;
    const outcome = (side) => exit === entry ? "d" : (side === "BUY" ? exit > entry : exit < entry) ? "w" : "l";
    const triggerSide = opinions.rsi.side;
    const decisionSide = consensus.decision === "BUY" || consensus.decision === "SELL" ? consensus.decision : null;
    const randomSide = rand() < 0.5 ? "BUY" : "SELL";

    rows.push({
      market, at: new Date(now).toISOString(), rsi: Number(rsiValue.toFixed(2)),
      triggerSide, triggerOutcome: outcome(triggerSide),
      decision: consensus.decision, decisionSide, decisionOutcome: decisionSide ? outcome(decisionSide) : null,
      randomOutcome: outcome(randomSide),
      walk: opinions.bollinger?.walkSide ?? null, regime: opinions.adx?.regime ?? null,
      atrState: opinions.atr?.state ?? null, fibState: opinions.fib?.state ?? null,
      rsiState: opinions.rsi?.state ?? null,
      candleState: opinions.candle?.state ?? null, candleDir: opinions.candle?.direction ?? null,
      counter: (consensus.counterEvidence ?? []).map((r) => r.code),
      tolerated: (consensus.tolerance?.tolerated ?? []),
      support: (consensus.supportingEvidence ?? []).map((r) => r.code),
    });
  }
}

// ---------- agregacao ----------
const rate = (list) => { const w = list.filter((r) => r === "w").length; const l = list.filter((r) => r === "l").length; const n = w + l; return n ? { n, wr: 100 * w / n } : { n: 0, wr: null }; };
const fmt = (r) => r.n ? `n=${String(r.n).padStart(4)} WR=${r.wr.toFixed(1)}%` : "n=0";
const approved = rows.filter((r) => r.decisionSide);
console.log("\n== GERAL ==");
console.log("  gatilhos (RSI 70/30): " + rows.length);
console.log("  cru (trigger side):   " + fmt(rate(rows.map((r) => r.triggerOutcome))));
console.log("  aprovado consenso:    " + fmt(rate(approved.map((r) => r.decisionOutcome))));
console.log("  WAIT:                 " + rows.filter((r) => !r.decisionSide).length);
console.log("  aleatorio (controle): " + fmt(rate(rows.map((r) => r.randomOutcome))));
const bySide = (side) => fmt(rate(approved.filter((r) => r.decisionSide === side).map((r) => r.decisionOutcome)));
console.log("  aprovado BUY:  " + bySide("BUY"));
console.log("  aprovado SELL: " + bySide("SELL"));

const codeAgg = new Map();
for (const r of approved) for (const code of r.counter) { const row = codeAgg.get(code) ?? []; row.push(r.decisionOutcome); codeAgg.set(code, row); }
const codeRows = [...codeAgg.entries()].map(([code, list]) => ({ code, ...rate(list) })).filter((r) => r.n >= 5).sort((a, b) => a.wr - b.wr);
console.log("\n== APROVADOS por counter code (n>=5, pior primeiro) ==");
for (const r of codeRows.slice(0, 15)) console.log("  " + r.code.padEnd(32) + fmt({ n: r.n, wr: r.wr }));

const stateAgg = new Map();
for (const r of approved) { const key = `walk=${r.walk ?? "-"} regime=${r.regime ?? "-"} atr=${r.atrState ?? "-"} candle=${r.candleState ?? "-"}`; const row = stateAgg.get(key) ?? []; row.push(r.decisionOutcome); stateAgg.set(key, row); }
const stateRows = [...stateAgg.entries()].map(([key, list]) => ({ key, ...rate(list) })).filter((r) => r.n >= 5).sort((a, b) => b.wr - a.wr);
console.log("\n== APROVADOS por contexto (n>=5, melhor primeiro) ==");
for (const r of stateRows.slice(0, 15)) console.log("  " + r.key.padEnd(64) + fmt({ n: r.n, wr: r.wr }));

if (OUT) { fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), safety: SAFETY, withCandle: WITH_CANDLE, rows }, null, 0)); console.log("\nJSON salvo em " + OUT + " (" + rows.length + " linhas)"); }
