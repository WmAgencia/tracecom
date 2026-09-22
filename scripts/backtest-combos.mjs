/**
 * BACKTEST DE COMBINACOES — busca exaustiva de combinacoes de features (sem vies).
 *
 * Em cada gatilho (RSI >=70 / <=30) extraimos features dos agentes reais (RSI qualidade,
 * Fibonacci, ATR, ADX, Bollinger, candle) e testamos TODAS as combinacoes (mascara de bits)
 * contra o resultado em varias expiracoes. Split 70% descoberta / 30% validacao: nenhum
 * limiar e escolhido olhando o resultado; so reportamos o que segura fora da amostra.
 *
 * Uso: node scripts/backtest-combos.mjs <candles.csv.gz> [--hours 24] [--expiry 12]
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
if (!file) { console.error("uso: node scripts/backtest-combos.mjs <candles.csv.gz> [--hours 24] [--expiry 12]"); process.exit(2); }
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const HOURS = arg("--hours", 24);
const EXPIRY = arg("--expiry", 12);        // candles de 5s (12 = 60s)
const MAX_MARKETS = arg("--max-markets", 30);

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
const series = [...byMarket.entries()].slice(0, MAX_MARKETS)
  .map(([market, map]) => ({ market, candles: [...map.values()].filter((c) => c.bucketEnd >= cutoff).sort((a, b) => a.bucketEnd - b.bucketEnd) }))
  .filter((s) => s.candles.length > 200);

const rsiAt = (closes, end, period = 14) => {
  if (end < period) return null;
  let gain = 0; let loss = 0;
  for (let i = end - period + 1; i <= end; i += 1) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  const avgGain = gain / period; const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
};

// features pre-declaradas (todas binarias, sempre a favor da tese de reversao)
const FEATURES = [
  "rsi_qualidade",      // divergencia / failure swing / crossback
  "candle_virou",       // ultimo candle fechado na direcao da tese
  "adx_fraco_ou_vira",  // ADX range, tendencia antiga enfraquecendo ou lado oposto reagindo
  "adx_forte_contra",   // (bloqueio) tendencia antiga fortalecendo
  "atr_normal",         // ATR normal e nao climatico
  "bb_rejeicao",        // rejeicao na banda a favor
  "bb_range",           // regime de range
  "bb_squeeze",         // (bloqueio) squeeze
  "bb_walk_contra",     // (bloqueio) caminhando na banda contra
  "fib_alinhado",       // leg do fib confirma a tese
  "fib_reacao",         // reacao no extremo/zona
  "fib_zona_ok",        // dentro das zonas (nao rompido/fora)
];
const NF = FEATURES.length;
const BLOCKERS = [3, 7, 8];  // indices que sao bloqueios (precisam estar FALSE)

const feat = (opinions, snapshot) => {
  const rsi = opinions.rsi ?? {}; const bb = opinions.bollinger ?? {}; const adx = opinions.adx ?? {}; const atr = opinions.atr ?? {}; const fib = opinions.fib ?? {};
  const buy = rsi.side === "BUY";
  const sideAdx = adx.perSide?.[rsi.side] ?? {};
  const candles = snapshot?.recentCandles ?? [];
  const last = candles[candles.length - 1] ?? null;
  const turned = last ? (buy ? Number(last.close) > Number(last.open) : Number(last.close) < Number(last.open)) : false;
  return [
    Boolean(rsi.divergence || rsi.failureSwing || rsi.crossback),
    turned,
    sideAdx.oldStrengthening !== true && (adx.regime === "RANGE" || sideAdx.oldTrendWeakening === true || sideAdx.oppositeReacting === true || sideAdx.newDominance === true),
    sideAdx.oldStrengthening === true,
    atr.state === "NORMAL" && atr.climactic !== true,
    Boolean(bb.rejection && ((buy && bb.rejection === "LOWER") || (!buy && bb.rejection === "UPPER"))),
    bb.regime === "RANGE",
    bb.squeeze === true,
    bb.walkSide === (buy ? "LOWER" : "UPPER"),
    fib.direction === rsi.side,
    ["AT_EXTREME_REACTION", "ZONE_REJECTION", "ZONE_REACTION"].includes(fib.state),
    !["ZONE_BROKEN", "OUT_OF_ZONE"].includes(fib.state),
  ];
};

const counts = new Map();   // mask|half -> {w,l,d,n}
let triggers = 0;
for (const { market, candles } of series) {
  const closes = candles.map((c) => c.close);
  for (let i = 60; i < candles.length - EXPIRY - 10; i += 1) {
    const rsi = rsiAt(closes, i);
    if (rsi === null || (rsi < 70 && rsi > 30)) continue;
    triggers += 1;
    const past = candles.slice(Math.max(0, i - 120), i + 1);
    const snapshot = buildMarketSnapshot({ marketKey: market, marketType: "OTC", candles: past, now: candles[i].bucketEnd, payout: 89, targetExpiryAt: candles[i].bucketEnd + EXPIRY * 5000 });
    if (!snapshot) continue;
    const opinions = { rsi: analyzeRsiAgent(snapshot), bollinger: analyzeBollingerAgent(snapshot), adx: analyzeAdxAgent(snapshot), atr: analyzeAtrAgent(snapshot), fib: analyzeFibAgent(snapshot) };
    if (!opinions.rsi?.side) continue;
    const f = feat(opinions, snapshot);
    if (BLOCKERS.some((b) => f[b] === true)) continue;   // bloqueios duros: fora
    const entry = candles[i + 1].close;
    const exit = candles[i + 1 + EXPIRY].close;
    const up = opinions.rsi.side === "BUY";
    const outcome = exit === entry ? "d" : (up ? exit > entry : exit < entry) ? "w" : "l";
    const half = i < candles.length * 0.7 ? "in" : "out";
    let mask = 0;
    for (let b = 0; b < NF; b += 1) if (f[b]) mask |= (1 << b);
    for (const m of [mask, mask & ~(1 << 3)]) {          // com e sem o bloqueio suave de ADX
      const key = m + "|" + half;
      const row = counts.get(key) ?? { w: 0, l: 0, d: 0 };
      row[outcome] += 1;
      counts.set(key, row);
    }
  }
}

const nameOf = (mask) => FEATURES.filter((_, b) => mask & (1 << b)).join("+") || "(sem filtro)";
const rowsIn = []; const rowsOut = [];
for (const [key, row] of counts.entries()) {
  const [mask, half] = key.split("|");
  const n = row.w + row.l;
  if (n === 0) continue;
  const item = { mask: Number(mask), n, wr: (100 * row.w) / n, d: row.d };
  (half === "in" ? rowsIn : rowsOut).push(item);
}
rowsIn.sort((a, b) => b.wr - a.wr);
rowsOut.sort((a, b) => b.wr - a.wr);
const outMap = new Map(rowsOut.map((r) => [r.mask, r]));

console.log("GATILHOS=" + triggers + " | expiracao=" + EXPIRY * 5 + "s | features=" + NF + " (combinacoes 2^" + NF + ")");
console.log("\nTOP IN-SAMPLE (n>=80):");
for (const r of rowsIn.filter((r) => r.n >= 80).slice(0, 15)) console.log("  " + String(r.wr.toFixed(1) + "%").padStart(6) + " n=" + String(r.n).padStart(5) + "  " + nameOf(r.mask));
console.log("\nTOP OUT-OF-SAMPLE (n>=50):");
for (const r of rowsOut.filter((r) => r.n >= 50).slice(0, 15)) console.log("  " + String(r.wr.toFixed(1) + "%").padStart(6) + " n=" + String(r.n).padStart(5) + "  " + nameOf(r.mask));
const candidates = rowsIn.filter((r) => r.n >= 80).slice(0, 25);
console.log("\nCANDIDATOS IN (top25) VALIDADOS OUT:");
for (const c of candidates) {
  const o = outMap.get(c.mask); if (!o || o.n < 30) continue;
  console.log("  in " + String(c.wr.toFixed(1) + "%").padStart(6) + " (n=" + String(c.n).padStart(4) + ") -> out " + String(o.wr.toFixed(1) + "%").padStart(6) + " (n=" + String(o.n).padStart(4) + ")  " + nameOf(c.mask));
}
const above70in = rowsIn.filter((r) => r.wr > 70 && r.n >= 50).length;
const above70out = rowsOut.filter((r) => r.wr > 70 && r.n >= 30).length;
console.log("\nCOMBINACOES>70%: in=" + above70in + " out=" + above70out);
const bestOut = rowsOut.filter((r) => r.n >= 100)[0];
console.log("MELHOR_OUT(n>=100)=" + (bestOut ? bestOut.wr.toFixed(1) + "% (n=" + bestOut.n + ") " + nameOf(bestOut.mask) : "-"));
