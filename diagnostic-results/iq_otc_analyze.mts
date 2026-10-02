/** Análise dos CSVs OTC reais coletados dos MCPs da IQ Option. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateOutcome, wilsonInterval } from "../src/backtest/probability";
import type { MarketCandle, Timeframe } from "../src/market/model";

const ROOT = process.env.IQ_ROOT ?? "diagnostic-results/data/iq-otc";

interface Row { from: string; to: string; open: number; high: number; low: number; close: number; }
function loadCsv(path: string): Row[] {
  const lines = readFileSync(path, "utf8").trim().split("\n").slice(1);
  return lines.map((l) => { const p = l.split(","); return { from: p[0]!, to: p[1]!, open: +p[2]!, high: +p[3]!, low: +p[4]!, close: +p[5]! }; });
}
function logR(rows: Row[]): number[] { const r: number[] = []; for (let i = 1; i < rows.length; i++) r.push(Math.log(rows[i]!.close / rows[i - 1]!.close)); return r; }
function acf(rets: number[], lag: number): number {
  const n = rets.length - lag; if (n < 10) return NaN;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  let num = 0, den = 0;
  for (const r of rets) den += (r - m) ** 2;
  for (let i = 0; i < n; i++) num += (rets[i]! - m) * (rets[i + lag]! - m);
  return num / den;
}
function vr(rets: number[], q: number): number {
  const agg: number[] = [];
  for (let i = q; i < rets.length; i += q) { let s = 0; for (let j = i - q + 1; j <= i; j++) s += rets[j]!; agg.push(s); }
  if (agg.length < 30) return NaN;
  const v = (xs: number[]) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1); };
  return v(agg) / (q * v(rets));
}
function sessVol(rows: Row[], stepMin: number): Record<string, { n: number; annPct: number }> {
  const rets = logR(rows);
  const b: Record<string, { s2: number; s: number; n: number }> = { asia: { s2: 0, s: 0, n: 0 }, london: { s2: 0, s: 0, n: 0 }, ny: { s2: 0, s: 0, n: 0 } };
  for (let i = 1; i < rows.length; i++) {
    const h = new Date(rows[i]!.to).getUTCHours();
    const k = h < 7 ? "asia" : h < 16 ? "london" : "ny";
    b[k]!.s2 += rets[i - 1]! ** 2; b[k]!.s += rets[i - 1]!; b[k]!.n++;
  }
  const ppy = (525600 / stepMin) * 5 / 7;
  const out: Record<string, { n: number; annPct: number }> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v.n < 50) continue;
    const varr = (v.s2 - v.s * v.s / v.n) / (v.n - 1);
    out[k] = { n: v.n, annPct: Math.round(Math.sqrt(varr * ppy) * 10000) / 100 };
  }
  return out;
}

const results: Array<Record<string, unknown>> = [];
const winRows: Array<Record<string, unknown>> = [];

for (const server of readdirSync(ROOT).filter((d) => !d.includes("."))) {
  const dir = join(ROOT, server);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".csv"))) {
    const rows = loadCsv(join(dir, f));
    if (rows.length < 300) continue;
    const asset = f.replace(/\.csv$/, "");
    const sizeS = f.includes("_60s") ? 60 : 300;
    const stepMin = sizeS / 60;
    const rets = logR(rows);
    const candles: MarketCandle[] = rows.map((r) => ({ provider: "iq-mcp", symbol: asset, timeframe: (stepMin === 1 ? "1m" : "5m") as Timeframe, open: r.open, high: r.high, low: r.low, close: r.close, volume: 0, timestamp: new Date(r.to).getTime(), receivedAt: new Date(r.to).getTime(), isClosed: true, source: "iq-mcp:" + server, quality: "high" as const }));
    const out: Record<string, unknown> = { server, asset, size: sizeS, rows: rows.length, spanH: Math.round((new Date(rows.at(-1)!.to).getTime() - new Date(rows[0]!.from).getTime()) / 360000) / 10, lag1: Math.round(acf(rets, 1) * 10000) / 10000, lag5: Math.round(acf(rets, 5) * 10000) / 10000, vr5: Math.round(vr(rets, 5) * 1000) / 1000, session: sessVol(rows, stepMin) };
    out.interpretation = (out.vr5 as number) < 0.95 ? "mean-reversion" : (out.vr5 as number) > 1.05 ? "trending" : "random-walk";
    results.push(out);

    // setups binários: fade1, fade3, rsi14, bb2
    const closes = rows.map((r) => r.close);
    const rsi14: number[] = new Array(closes.length).fill(NaN);
    { let g = 0, l = 0; for (let i = 1; i < closes.length; i++) { const d = closes[i]! - closes[i - 1]!; if (i <= 14) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === 14) { g /= 14; l /= 14; rsi14[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } continue; } g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; rsi14[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } }
    const sma20 = closes.map((_, i) => (i < 19 ? NaN : closes.slice(i - 19, i + 1).reduce((s, x) => s + x, 0) / 20));
    const sd20 = closes.map((_, i) => { if (i < 19) return NaN; const m = sma20[i]!; return Math.sqrt(closes.slice(i - 19, i + 1).reduce((s, x) => s + (x - m) ** 2, 0) / 20); });
    const setups: Array<[string, number, (i: number) => "up" | "down" | null]> = [
      ["fade1", 0, (i) => (rets[i - 1]! > 0 ? "down" : rets[i - 1]! < 0 ? "up" : null)],
      ["fade3", 0, (i) => (rets[i - 1]! > 0 && rets[i - 2]! > 0 && rets[i - 3]! > 0 ? "down" : rets[i - 1]! < 0 && rets[i - 2]! < 0 && rets[i - 3]! < 0 ? "up" : null)],
      ["rsi14", 0, (i) => (Number.isFinite(rsi14[i]) && rsi14[i]! < 30 ? "up" : Number.isFinite(rsi14[i]) && rsi14[i]! > 70 ? "down" : null)],
      ["bb2", 0, (i) => (Number.isFinite(sd20[i]) && sd20[i]! > 0 ? (closes[i]! > sma20[i]! + 2 * sd20[i]! ? "down" : closes[i]! < sma20[i]! - 2 * sd20[i]! ? "up" : null) : null)],
    ];
    for (const [name, , dir] of setups) {
      for (const h of [1, 5]) {
        let hit = 0, n = 0;
        for (let i = 25; i < rows.length - h; i++) {
          const d = dir(i);
          if (!d) continue;
          const o = evaluateOutcome(candles, i, { direction: d, horizon: h, minMovePct: 0 });
          if (o === "insufficient" || o === "flat") continue;
          n++; if (o === "hit") hit++;
        }
        if (n < 30) continue;
        const ci = wilsonInterval(hit, n);
        winRows.push({ server, asset, size: sizeS, setup: name, h, n, wr: Math.round(hit / n * 1000) / 1000, lo: Math.round(ci.lower * 1000) / 1000, hi: Math.round(ci.upper * 1000) / 1000 });
      }
    }
  }
}

writeFileSync(process.env.IQ_OUT ?? "diagnostic-results/iq-otc-analysis.json", JSON.stringify({ label: process.env.IQ_LABEL ?? "OTC REAL (MCP IQ Option) — subjacentes sintéticos da casa; leitura apenas", generatedAt: new Date().toISOString(), series: results, winRates: winRows }, null, 2));
// agregado por setup/size
const agg = new Map<string, { w: number; n: number }>();
for (const w of winRows) { const k = `${w.setup}|h${w.h}|${w.size}`; const c = agg.get(k) ?? { w: 0, n: 0 }; c.w += Number(w.n) * Number(w.wr); c.n += Number(w.n); agg.set(k, c); }
console.log(`séries: ${results.length} | winrate rows: ${winRows.length}`);
for (const [k, v] of [...agg.entries()].sort()) console.log(k, "n=" + v.n, "wr=" + (v.w / v.n).toFixed(3));
console.log("\ntop 12 séries por |lag1|:");
for (const r of [...results].sort((a, b) => Math.abs(Number(b.lag1)) - Math.abs(Number(a.lag1))).slice(0, 12)) console.log(`${r.server}/${r.asset} ${r.size}s lag1=${r.lag1} vr5=${r.vr5} -> ${r.interpretation} (${r.rows} rows, ${r.spanH}h)`);
