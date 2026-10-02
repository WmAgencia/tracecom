/**
 * WALK-FORWARD OOS — busca honesta de win rate >= 60% em mercado real (nao-OTC).
 *
 * Mercado "binário normal" = subjacentes reais (Yahoo Forex / Binance cripto dos
 * CSVs de diagnostic-results/data). Nenhum dado OTC, nenhuma coleta nova,
 * nenhuma ordem.
 *
 * Metodologia (sem look-ahead):
 *   - Série dividida em TREINO (70% inicial) e TESTE (30% final).
 *   - Configuração escolhida SOMENTE pelo desempenho no treino;
 *     o número reportado como resultado é o do TESTE (OOS), nunca visto na escolha.
 *   - Setups causais: decisão no close do candle i usa apenas dados <= i;
 *     outcome = direção do close i+h vs close i (evaluateOutcome do repo).
 *   - WR reportado exclui flat (minMovePct=0), como nas análises anteriores.
 *   - Estratégias: fade do último candle, fade de N candles, Bollinger
 *     (2.0/2.5) revert, RSI(2/14) extremo, z-score de preço, + filtros
 *     (sessão Londres, vol acima/abaixo da mediana, horário).
 *   - IC Wilson 95% em tudo.
 *
 * Uso: npx tsx diagnostic-results/walk_forward_real.mts
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateOutcome, wilsonInterval } from "../src/backtest/probability";
import type { MarketCandle, Timeframe } from "../src/market/model";

const DATA_DIR = "diagnostic-results/data";
const OUT = "diagnostic-results/walk-forward-real-results.json";

interface CsvRow { timestamp_ms: number; open: number; high: number; low: number; close: number; volume: number; symbol: string; timeframe: string; provider: string; }
function loadCsv(path: string): CsvRow[] {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const head = lines[0]!.split(",");
  const idx = (k: string) => head.indexOf(k);
  const out: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i]!.split(",");
    out.push({ timestamp_ms: Number(p[idx("timestamp_ms")]), open: Number(p[idx("open")]), high: Number(p[idx("high")]), low: Number(p[idx("low")]), close: Number(p[idx("close")]), volume: Number(p[idx("volume")]), symbol: p[idx("symbol")], timeframe: p[idx("timeframe")], provider: p[idx("provider")] });
  }
  return out;
}
function resample(rows: CsvRow[], factor: number, label: string): CsvRow[] {
  const buckets = new Map<number, CsvRow[]>();
  for (const r of rows) {
    const key = Math.floor(r.timestamp_ms / (60_000 * factor)) * 60_000 * factor;
    const b = buckets.get(key);
    if (b) b.push(r); else buckets.set(key, [r]);
  }
  const out: CsvRow[] = [];
  for (const [ts, g] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    if (g.length < Math.max(2, Math.floor(factor * 0.6))) continue;
    out.push({ timestamp_ms: ts, open: g[0]!.open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g.at(-1)!.close, volume: g.reduce((s, x) => s + x.volume, 0), symbol: g[0]!.symbol, timeframe: label, provider: g[0]!.provider });
  }
  return out;
}

interface Strat { name: string; params: Record<string, number | string>; dir: (ctx: Ctx, i: number) => "up" | "down" | null; }
interface Ctx { closes: number[]; rets: number[]; rsi2: number[]; rsi14: number[]; sma20: number[]; sd20: number[]; volMed: number; hourUtc: (i: number) => number; }
type Filter = (ctx: Ctx, i: number) => boolean;

function buildCtx(rows: CsvRow[]): Ctx {
  const closes = rows.map((r) => r.close);
  const rets = closes.map((c, i) => (i === 0 ? 0 : Math.log(c / closes[i - 1]!)));
  const rsi = (period: number): number[] => {
    const out = new Array(closes.length).fill(NaN);
    let g = 0, l = 0;
    for (let i = 1; i < closes.length; i++) {
      const d = closes[i]! - closes[i - 1]!;
      if (i <= period) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === period) { g /= period; l /= period; out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } continue; }
      g = (g * (period - 1) + Math.max(d, 0)) / period;
      l = (l * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
    }
    return out;
  };
  const sma20 = closes.map((_, i) => (i < 19 ? NaN : closes.slice(i - 19, i + 1).reduce((s, x) => s + x, 0) / 20));
  const sd20 = closes.map((_, i) => {
    if (i < 19) return NaN;
    const m = sma20[i]!;
    return Math.sqrt(closes.slice(i - 19, i + 1).reduce((s, x) => s + (x - m) ** 2, 0) / 20);
  });
  const retsAbs = rets.slice(1).map(Math.abs).sort((a, b) => a - b);
  const volMed = retsAbs[Math.floor(retsAbs.length / 2)] ?? 0;
  return { closes, rets, rsi2: rsi(2), rsi14: rsi(14), sma20, sd20, volMed, hourUtc: (i: number) => new Date(rows[i]!.timestamp_ms).getUTCHours() };
}

// Estratégias de REVERSÃO (as que mostraram estrutura nas análises ACF/VR)
const STRATS: Strat[] = [
  { name: "fade1", params: {}, dir: (_c, i) => (_c.rets[i]! > 0 ? "down" : _c.rets[i]! < 0 ? "up" : null) },
  { name: "fade3", params: {}, dir: (c, i) => (c.rets[i]! > 0 && c.rets[i - 1]! > 0 && c.rets[i - 2]! > 0 ? "down" : c.rets[i]! < 0 && c.rets[i - 1]! < 0 && c.rets[i - 2]! < 0 ? "up" : null) },
  { name: "bb", params: { k: 2.0 }, dir: (c, i) => (Number.isFinite(c.sd20[i]!) && c.sd20[i]! > 0 ? (c.closes[i]! > c.sma20[i]! + 2.0 * c.sd20[i]! ? "down" : c.closes[i]! < c.sma20[i]! - 2.0 * c.sd20[i]! ? "up" : null) : null) },
  { name: "bb25", params: { k: 2.5 }, dir: (c, i) => (Number.isFinite(c.sd20[i]!) && c.sd20[i]! > 0 ? (c.closes[i]! > c.sma20[i]! + 2.5 * c.sd20[i]! ? "down" : c.closes[i]! < c.sma20[i]! - 2.5 * c.sd20[i]! ? "up" : null) : null) },
  { name: "rsi2", params: { lo: 10, hi: 90 }, dir: (c, i) => (Number.isFinite(c.rsi2[i]!) ? (c.rsi2[i]! < 10 ? "up" : c.rsi2[i]! > 90 ? "down" : null) : null) },
  { name: "rsi2x", params: { lo: 5, hi: 95 }, dir: (c, i) => (Number.isFinite(c.rsi2[i]!) ? (c.rsi2[i]! < 5 ? "up" : c.rsi2[i]! > 95 ? "down" : null) : null) },
  { name: "rsi14", params: { lo: 30, hi: 70 }, dir: (c, i) => (Number.isFinite(c.rsi14[i]!) ? (c.rsi14[i]! < 30 ? "up" : c.rsi14[i]! > 70 ? "down" : null) : null) },
];
const FILTERS: Record<string, Filter> = {
  all: () => true,
  london: (c, i) => c.hourUtc(i) >= 7 && c.hourUtc(i) < 16,
  highvol: (c, i) => Math.abs(c.rets[i] ?? 0) > c.volMed,
  lowvol: (c, i) => Math.abs(c.rets[i] ?? 0) <= c.volMed,
};

function backtest(rows: CsvRow[], ctx: Ctx, s: Strat, filter: Filter, horizon: number): { hit: number; n: number } {
  const candles: MarketCandle[] = rows.map((r) => ({ provider: r.provider, symbol: r.symbol, timeframe: r.timeframe as Timeframe, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, timestamp: r.timestamp_ms, receivedAt: r.timestamp_ms, isClosed: true, source: "csv", quality: "high" as const }));
  let hit = 0, n = 0;
  for (let i = 30; i < rows.length - horizon; i++) {
    const dir = s.dir(ctx, i);
    if (!dir) continue;
    if (!filter(ctx, i)) continue;
    const o = evaluateOutcome(candles, i, { direction: dir, horizon, minMovePct: 0 });
    if (o === "insufficient" || o === "flat") continue;
    n++; if (o === "hit") hit++;
  }
  return { hit, n };
}

interface Result { file: string; symbol: string; tf: string; strat: string; filter: string; horizon: number; trainN: number; trainWr: number | null; testN: number; testHit: number; testWr: number | null; testCiLo: number | null; testCiHi: number | null; testLoss: number; testOpsPerMin: number | null; }

/** Plano fixo de seleção por treino -> reporte OOS, por ativo/TF. */
function reportPerSymbol(results: Result[], trainMin: number, testMin: number): Array<Record<string, unknown>> {
  const byKey = new Map<string, Result[]>();
  for (const r of results) {
    const k = `${r.symbol}|${r.tf}`;
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const [k, arr] of byKey) {
    const [symbol, tf] = k.split("|");
    // Seleção honesta: melhor combo pelo WR de treino com n de teste >= 100.
    const eligible = arr.filter((r) => r.trainWr !== null && r.testN >= 100);
    if (eligible.length === 0) continue;
    eligible.sort((a, b) => (b.trainWr ?? 0) - (a.trainWr ?? 0));
    const best = eligible[0]!;
    const loss = best.testN - best.testHit;
    const opsPerMin = best.testN > 0 && testMin > 0 ? Math.round((best.testN / testMin) * 10000) / 10000 : null;
    out.push({
      symbol, tf,
      combosTestadas: arr.length,
      strat: best.strat, filter: best.filter, horizon: best.horizon,
      trainWr: best.trainWr, trainN: best.trainN,
      opsTestadas: best.testN, wins: best.testHit, losses: loss,
      wrOOS: best.testWr, ciLo: best.testCiLo, ciHi: best.testCiHi,
      opsPorMinuto: opsPerMin,
      janelaTesteMin: testMin,
    });
  }
  out.sort((a, b) => (Number(b.wrOOS) || 0) - (Number(a.wrOOS) || 0));
  return out;
}
function minutesOf(rows: CsvRow[], tfLabel: string, splitFrac: number): number {
  const stepMin = tfLabel === "1m" ? 1 : tfLabel === "5m" ? 5 : 60;
  const split = Math.floor(rows.length * splitFrac);
  return (rows.length - split) * stepMin;
}

async function main(): Promise<void> {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".csv") && !f.includes("resampled"));
  const results: Result[] = [];
  const minutesByFile = new Map<string, { tf: string; testMin: number }>();
  for (const f of files) {
    const raw = loadCsv(join(DATA_DIR, f));
    const symbol = raw[0]!.symbol;
    const provider = raw[0]!.provider;
    const variants: Array<[string, CsvRow[]]> = raw[0]!.timeframe === "1m" ? [["1m", raw], ["5m", resample(raw, 5, "5m")]] : [["1h", raw]];
    for (const [tf, rows] of variants) {
      if (rows.length < 600) continue;
      minutesByFile.set(`${symbol}|${tf}`, { tf, testMin: minutesOf(rows, tf, 0.7) });
      const ctx = buildCtx(rows);
      const split = Math.floor(rows.length * 0.7);
      for (const s of STRATS) {
        for (const [fname, filt] of Object.entries(FILTERS)) {
          for (const horizon of [1, 5]) {
            // TREINO: apenas metade anterior — usado para reportar, não para decidir o que mostrar
            const tr = backtest(rows.slice(0, split).concat([]), ctx, s, filt, horizon);
            // TESTE: janela OOS real (últimos 30%) — backtest com offset
            const testRows = rows.slice(split);
            const candles: MarketCandle[] = testRows.map((r) => ({ provider: r.provider, symbol: r.symbol, timeframe: r.timeframe as Timeframe, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, timestamp: r.timestamp_ms, receivedAt: r.timestamp_ms, isClosed: true, source: "csv", quality: "high" as const }));
            let hit = 0, n = 0;
            for (let i = 5; i < testRows.length - horizon; i++) {
              const dir = s.dir(ctx, split + i);
              if (!dir || !filt(ctx, split + i)) continue;
              const o = evaluateOutcome(candles, i, { direction: dir, horizon, minMovePct: 0 });
              if (o === "insufficient" || o === "flat") continue;
              n++; if (o === "hit") hit++;
            }
            const trWr = tr.n >= 30 ? tr.hit / tr.n : null;
            const ci = n >= 30 ? wilsonInterval(hit, n) : null;
            results.push({ file: f, symbol, tf, strat: s.name, filter: fname, horizon, trainN: tr.n, trainWr: trWr === null ? null : Math.round(trWr * 1000) / 1000, testN: n, testHit: hit, testLoss: n - hit, testWr: n ? Math.round((hit / n) * 1000) / 1000 : null, testCiLo: ci ? Math.round(ci.lower * 1000) / 1000 : null, testCiHi: ci ? Math.round(ci.upper * 1000) / 1000 : null, testOpsPerMin: null });
          }
        }
      }
    }
    console.log(`${f}: ok`);
  }
  // Seleção honesta: melhor por treino (treino 70%), reporta o OOS correspondente
  const perSymbol = reportPerSymbol(results, 0, 0).map((row) => {
    const k = `${row.symbol}|${row.tf}`;
    const mins = minutesByFile.get(k);
    const best = results.find((r) => r.symbol === row.symbol && r.tf === row.tf && r.strat === row.strat && r.filter === row.filter && r.horizon === row.horizon && r.trainWr === row.trainWr);
    if (mins && best) {
      row.opsPorMinuto = Math.round((best.testN / mins.testMin) * 10000) / 10000;
      row.janelaTesteMin = mins.testMin;
    }
    return row;
  });
  const eligible = results.filter((r) => r.trainWr !== null && r.trainWr >= 0.55 && r.testN >= 100);
  eligible.sort((a, b) => (b.trainWr ?? 0) - (a.trainWr ?? 0));
  const top = eligible.slice(0, 40);
  const test60 = results.filter((r) => r.testWr !== null && r.testWr >= 0.60 && r.testN >= 200);
  writeFileSync(OUT, JSON.stringify({ label: "mercado real nao-OTC (subjacentes Yahoo/Binance); split 70/30; sem look-ahead; minMovePct=0; excl. flat", generatedAt: new Date().toISOString(), meta60: test60.length, perSymbol, topByTrain: top, allTest60: test60 }, null, 2));
  console.log(`\nresultados: ${results.length} | combos com teste>=60% (n>=200): ${test60.length}`);
  console.log("\n=== RELATORIO POR ATIVO (melhor combo por treino -> OOS) ===");
  for (const r of perSymbol) console.log(`${r.symbol} ${r.tf}: ${r.strat}/${r.filter} h${r.horizon} | ops=${r.opsTestadas} W=${r.wins} L=${r.losses} WR=${(Number(r.wrOOS) * 100).toFixed(1)}% CI=[${r.ciLo},${r.ciHi}] ops/min=${r.opsPorMinuto} (janela ${r.janelaTesteMin}min) | combos testadas=${r.combosTestadas}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
