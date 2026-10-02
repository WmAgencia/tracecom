/**
 * OTC_PROXY_PATTERN_ANALYSIS — carrega os 18 CSVs de diagnostic-results/data
 * (Yahoo Forex + Binance, proxies não-OTC) e mede, com a maquinaria do repo:
 *
 *   1) volatilidade realizada por sessão (Ásia / Londres / NY) por ativo/TF;
 *   2) autocorrelação lag-1..5 dos retornos de close-to-close em 1m e 5m;
 *   3) mean-reversion vs trending: Ljung-Box aproximado no conjunto de lags
 *      1..5 + variância-ratio VR(5)/VR(1) (Lo-MacKinlay simplificado);
 *   4) win rate (Wilson 95%) de setups binários estilo 1m/5m:
 *      - momentum: entra na direção do candle anterior (horizonte 1/5 candles);
 *      - reversão: entra contra 3 candles consecutivos na mesma direção;
 *      - RSI-14 extremo (<30 compra / >70 vende), horizonte 1/5.
 *      Cada célula = horizonte × direção × ativo agregado por grupo (FX/cripto).
 *   5) backtest de similaridade (DEFAULT_CRITERIA, OOS 25%) como no CLI,
 *      consumindo um CandleHistorySource mínimo sobre CSV — caminho que os
 *      CLIs exigem de provider ao vivo; aqui é offline.
 *
 * Tudo rotulado PROXY NÃO-OTC. Sem rede, sem ordens.
 *
 * Uso: npx tsx diagnostic-results/otc_proxy_pattern_analysis.mts
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateOutcome, wilsonInterval } from "../src/backtest/probability";
import { QuantFeatureExtractor, findSimilar } from "../src/backtest/similarity";
import { DEFAULT_CRITERIA } from "../src/backtest/backtest";
import type { MarketCandle, Timeframe } from "../src/market/model";

const DATA_DIR = "diagnostic-results/data";
const OUT_JSON = "diagnostic-results/otc-proxy-pattern-analysis.json";
const OUT_CSV = "diagnostic-results/otc-proxy-pattern-analysis.csv";
const PROXY_LABEL = "proxy-nao-otc (Yahoo Forex / Binance; nao e feed OTC da IQ)";

interface CsvRow {
  timestamp_ms: number; open: number; high: number; low: number; close: number;
  volume: number; symbol: string; timeframe: string; provider: string;
}
function loadCsv(path: string): CsvRow[] {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const head = lines[0]!.split(",");
  const idx = (k: string) => head.indexOf(k);
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i]!.split(",");
    out.push({
      timestamp_ms: Number(p[idx("timestamp_ms")]),
      open: Number(p[idx("open")]), high: Number(p[idx("high")]),
      low: Number(p[idx("low")]), close: Number(p[idx("close")]),
      volume: Number(p[idx("volume")]),
      symbol: p[idx("symbol")], timeframe: p[idx("timeframe")], provider: p[idx("provider")],
    });
  }
  return out;
}
function toCandles(rows: CsvRow[]): MarketCandle[] {
  return rows.map((r) => ({
    provider: r.provider, symbol: r.symbol, timeframe: r.timeframe as Timeframe,
    open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
    timestamp: r.timestamp_ms, receivedAt: r.timestamp_ms, isClosed: true,
    source: "csv:proxy", quality: "high" as const,
  }));
}

/** Reamostragem 1m → 5m (OHLC padrão; buckets alinhados a 5min UTC). */
function resample5m(rows: CsvRow[]): CsvRow[] {
  const buckets = new Map<number, CsvRow[]>();
  for (const r of rows) {
    const key = Math.floor(r.timestamp_ms / 300_000) * 300_000;
    const b = buckets.get(key);
    if (b) b.push(r); else buckets.set(key, [r]);
  }
  const out: CsvRow[] = [];
  for (const [ts, group] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length < 3) continue; // bucket incompleto (ex.: AUD/NZD 2min) sai
    out.push({
      timestamp_ms: ts,
      open: group[0]!.open, high: Math.max(...group.map((g) => g.high)),
      low: Math.min(...group.map((g) => g.low)), close: group.at(-1)!.close,
      volume: group.reduce((s, g) => s + g.volume, 0),
      symbol: group[0]!.symbol, timeframe: "5m", provider: group[0]!.provider,
    });
  }
  return out;
}

// ---------- 1) volatilidade por sessão ----------
type Ret = number;
function logReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i]! / closes[i - 1]!));
  return r;
}
const SESSIONS = { asia: [0, 8], london: [7, 16], ny: [12, 21] } as const; // horas UTC [inicio,fim)
function sessionOf(hourUtc: number): keyof typeof SESSIONS | null {
  if (hourUtc >= 0 && hourUtc < 8) return "asia";
  if (hourUtc >= 7 && hourUtc < 16) return "london"; // 7-16 sobrepõe NY 12-16; usamos precedência Londres
  if (hourUtc >= 12 && hourUtc < 21) return "ny";
  return null;
}
function sessionVolProfile(rows: CsvRow[]): Record<string, { n: number; annVolPct: number }> {
  const closes = rows.map((r) => r.close);
  const rets = logReturns(closes);
  const bucket: Record<string, { sumSq: number; n: number; sum: number }> = { asia: { sumSq: 0, n: 0, sum: 0 }, london: { sumSq: 0, n: 0, sum: 0 }, ny: { sumSq: 0, n: 0, sum: 0 } };
  // rets[i] corresponde ao candle rows[i+1]
  for (let i = 1; i < rows.length; i++) {
    const s = sessionOf(new Date(rows[i]!.timestamp_ms).getUTCHours());
    if (!s) continue;
    bucket[s]!.sumSq += rets[i - 1]! * rets[i - 1]!;
    bucket[s]!.sum += rets[i - 1]!;
    bucket[s]!.n++;
  }
  const out: Record<string, { n: number; annVolPct: number }> = {};
  const periodsPerYear: Record<string, number> = { "1m": 525600 * 5 / 7, "5m": 105120 * 5 / 7, "1h": 8760 * 5 / 7 };
  const tf = rows[0]?.timeframe ?? "1h";
  for (const k of Object.keys(bucket)) {
    const b = bucket[k]!;
    if (b.n < 50) continue;
    const varSample = (b.sumSq - b.sum * b.sum / b.n) / (b.n - 1);
    const ann = Math.sqrt(varSample * (periodsPerYear[tf] ?? 8760 * 5 / 7)) * 100;
    out[k] = { n: b.n, annVolPct: Math.round(ann * 100) / 100 };
  }
  return out;
}

// ---------- 2/3) autocorrelação + variance ratio ----------
function acfAt(rets: number[], lag: number): number {
  const n = rets.length - lag;
  if (n < 10) return NaN;
  let m = 0; for (const r of rets) m += r; m /= rets.length;
  let num = 0, den = 0;
  for (let i = 0; i < rets.length; i++) den += (rets[i]! - m) ** 2;
  for (let i = 0; i < n; i++) num += (rets[i]! - m) * (rets[i + lag]! - m);
  return num / den;
}
function ljungBox(rets: number[], maxLag = 5): { Q: number; pAprox: number } {
  const n = rets.length;
  let Q = 0;
  for (let k = 1; k <= maxLag; k++) {
    const r = acfAt(rets, k);
    if (Number.isFinite(r)) Q += (r * r) / (n - k);
  }
  Q *= n * (n + 2);
  // p-valor aproximado chi2(maxLag): upper tail via Wilson-Hilferty
  const df = maxLag;
  const z = (Math.cbrt(Q / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  const p = 1 - 0.5 * (1 + erf(z / Math.SQRT2));
  return { Q: Math.round(Q * 10) / 10, pAprox: Math.max(0, Math.min(1, p)) };
}
function erf(x: number): number {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}
function varianceRatio(rets: number[], q: number): number {
  // VR(q) = Var(q-step returns) / (q * Var(1-step)), em amostras não sobrepostas
  const n = rets.length;
  const agg: number[] = [];
  for (let i = q; i < n; i += q) {
    let s = 0; for (let j = i - q + 1; j <= i; j++) s += rets[j]!;
    agg.push(s);
  }
  if (agg.length < 30) return NaN;
  const v = (xs: number[]) => { let m = 0; for (const x of xs) m += x; m /= xs.length; let s = 0; for (const x of xs) s += (x - m) ** 2; return s / (xs.length - 1); };
  return v(agg) / (q * v(rets));
}

// ---------- 4) win rates de setups binários ----------
interface WinRow { group: string; symbol: string; tf: string; setup: string; horizon: number; n: number; win: number; wr: number; ciLo: number; ciHi: number; }
function binaryWins(rows: CsvRow[]): WinRow[] {
  const candles = toCandles(rows);
  const closes = candles.map((c) => c.close);
  const rets = logReturns(closes);
  const out: WinRow[] = [];
  const add = (group: string, symbol: string, tf: string, setup: string, horizon: number, hit: number, n: number) => {
    if (n < 30) return;
    const ci = wilsonInterval(hit, n);
    out.push({ group, symbol, tf, setup, horizon, n, win: hit, wr: Math.round((hit / n) * 1000) / 1000, ciLo: Math.round(ci.lower * 1000) / 1000, ciHi: Math.round(ci.upper * 1000) / 1000 });
  };
  const count = (c: CsvRow[], pred: (i: number) => boolean, dir: "up" | "down", h: number): { hit: number; n: number } => {
    let hit = 0, n = 0;
    for (let i = 10; i < c.length - h; i++) {
      if (!pred(i)) continue;
      const o = evaluateOutcome(candles, i, { direction: dir, horizon: h, minMovePct: 0 });
      if (o === "insufficient" || o === "flat") continue;
      n++; if (o === "hit") hit++;
    }
    return { hit, n };
  };
  const group = rows[0]!.provider.startsWith("yahoo") ? "forex" : "cripto";
  const setups: Array<[string, (i: number) => boolean, "up" | "down"]> = [
    ["momentum", (i) => rets[i - 1]! > 0, "up"],
    ["momentum", (i) => rets[i - 1]! < 0, "down"],
    ["reversal3", (i) => rets[i - 1]! > 0 && rets[i - 2]! > 0 && rets[i - 3]! > 0, "down"],
    ["reversal3", (i) => rets[i - 1]! < 0 && rets[i - 2]! < 0 && rets[i - 3]! < 0, "up"],
  ];
  // RSI-14 (Wilder simplificado) por close
  const rsi14 = (() => {
    const out: number[] = new Array(closes.length).fill(NaN);
    let g = 0, l = 0;
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i]! - closes[i - 1]!;
      if (i <= 14) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === 14) { g /= 14; l /= 14; out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } continue; }
      g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14;
      out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
    }
    return out;
  })();
  const rsiSetups: Array<[string, (i: number) => boolean, "up" | "down"]> = [
    ["rsi30", (i) => Number.isFinite(rsi14[i]) && rsi14[i]! < 30, "up"],
    ["rsi70", (i) => Number.isFinite(rsi14[i]) && rsi14[i]! > 70, "down"],
  ];
  for (const [tfIter, hArr] of [["1m", [1, 5]], ["5m", [1, 5]], ["1h", [1, 5]]] as const) {
    if (rows[0]!.timeframe !== tfIter) continue;
    for (const [name, pred, dir] of [...setups, ...rsiSetups]) {
      for (const h of hArr) {
        const { hit, n } = count(rows, pred, dir, h);
        add(group, rows[0]!.symbol, tfIter, name, h, hit, n);
      }
    }
  }
  return out;
}

// ---------- 5) backtest de similaridade (como no CLI, fonte CSV) ----------
async function similarityBacktest(symbol: string, tf: Timeframe, candles: MarketCandle[]) {
  const extractor = new QuantFeatureExtractor();
  const queryIdx = Math.min(candles.length - 2, 400);
  if (queryIdx < 250) return null;
  const query = { timestamp: candles[queryIdx]!.timestamp, features: extractor.extract(candles, queryIdx) };
  const { matches } = findSimilar(query, candles, extractor, { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 }, { includeAfterQuery: true, searchEndIndex: candles.length - 2 });
  const target = { direction: "up" as const, horizon: 12, minMovePct: 0.05 };
  let hit = 0, n = 0;
  for (const m of matches) {
    const idx = candles.findIndex((c) => c.timestamp === m.timestamp);
    if (idx < 0) continue;
    const o = evaluateOutcome(candles, idx, target);
    if (o === "insufficient" || o === "flat") continue;
    n++; if (o === "hit") hit++;
  }
  const ci = wilsonInterval(hit, n);
  return { symbol, tf, threshold: 0.85, matches: matches.length, evaluated: n, hit, wr: n ? Math.round((hit / n) * 1000) / 1000 : null, ciLo: n ? Math.round(ci.lower * 1000) / 1000 : null, ciHi: n ? Math.round(ci.upper * 1000) / 1000 : null };
}

// ---------- main ----------
const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv"));
const sessionsBySymbol: Record<string, unknown> = {};
const acfRows: Array<Record<string, unknown>> = [];
const winRows: WinRow[] = [];
const simRows: Array<Record<string, unknown>> = [];

async function analyzeSeries(f: string, rows: CsvRow[]): Promise<void> {
  if (rows.length < 300) { console.log(`${f} [${rows[0]?.timeframe}]: pulado (${rows.length} linhas)`); return; }
  const symbol = rows[0]!.symbol;
  const tf = rows[0]!.timeframe;
  sessionsBySymbol[`${symbol} ${tf}`] = sessionVolProfile(rows);
  const rets = logReturns(rows.map((r) => r.close));
  const acf: Record<string, number> = {};
  for (let k = 1; k <= 5; k++) acf[`lag${k}`] = Math.round(acfAt(rets, k) * 10000) / 10000;
  const lb = ljungBox(rets);
  const vr5 = varianceRatio(rets, 5);
  acfRows.push({ file: f, symbol, tf, proxy: PROXY_LABEL, ...acf, ljungBoxQ: lb.Q, ljungBoxPAprox: Math.round(lb.pAprox * 10000) / 10000, vr5: Number.isFinite(vr5) ? Math.round(vr5 * 1000) / 1000 : null, interpretation: vr5 < 0.95 ? "mean-reversion" : vr5 > 1.05 ? "trending" : "random-walk" });
  winRows.push(...binaryWins(rows));
  const sim = await similarityBacktest(symbol, tf as Timeframe, toCandles(rows));
  if (sim) simRows.push(sim);
  console.log(`${f} [${tf}]: ok (${rows.length} linhas)`);
}

for (const f of files) {
  const rows = loadCsv(join(DATA_DIR, f));
  await analyzeSeries(f, rows);
  // Deriva 5m por reamostragem APENAS dos CSVs 1m (nenhuma coleta nova).
  if (rows[0]?.timeframe === "1m") {
    const r5 = resample5m(rows);
    await analyzeSeries(f.replace("_1m", "_5m(resampled)"), r5);
  }
}

// Agregados por grupo (forex/cripto × setup × horizonte) a partir das linhas por ativo
const agg = new Map<string, { win: number; n: number }>();
for (const w of winRows) {
  const key = `${w.group}|${w.tf}|${w.setup}|h${w.horizon}`;
  const cur = agg.get(key) ?? { win: 0, n: 0 };
  cur.win += w.win; cur.n += w.n;
  agg.set(key, cur);
}
const aggRows = [...agg.entries()].map(([k, v]) => {
  const [group, tf, setup, h] = k.split("|");
  const ci = wilsonInterval(v.win, v.n);
  return { group, tf, setup, horizon: Number(h!.slice(1)), n: v.n, wr: Math.round((v.win / v.n) * 1000) / 1000, ciLo: Math.round(ci.lower * 1000) / 1000, ciHi: Math.round(ci.upper * 1000) / 1000 };
});

const result = {
  label: PROXY_LABEL,
  generatedAt: new Date().toISOString(),
  note: "PROXY NÃO-OTC: subjacentes reais (Yahoo Forex / Binance). NÃO representa o feed OTC da IQ Option. Sem ordens; somente leitura.",
  filesAnalyzed: files.length,
  sessionVolatility: sessionsBySymbol,
  autocorrelation: acfRows,
  binaryWinRates: winRows,
  binaryWinRatesAggregated: aggRows,
  similarityBacktests: simRows,
};
writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
const csvHead = "group,tf,setup,horizon,n,wr,ciLo,ciHi";
const csvBody = aggRows.map((r) => [r.group, r.tf, r.setup, r.horizon, r.n, r.wr, r.ciLo, r.ciHi].join(",")).join("\n");
writeFileSync(OUT_CSV, csvHead + "\n" + csvBody + "\n");
console.log(`\nOK: ${OUT_JSON}`);
console.log(`OK: ${OUT_CSV}`);
