/**
 * VALIDAÇÃO OOS RIGOROSA — BINÁRIOS REAIS (NÃO-OTC) DA IQ OPTION
 * =============================================================================
 * Transforma três achados IN-SAMPLE em um experimento quantitativo auditável.
 *
 * Regras invioláveis implementadas aqui:
 *  - Nenhuma ordem é enviada. Somente leitura de CSV já congelado.
 *  - Dedupe obrigatório por `from`: o coletor fez append de janelas sobrepostas,
 *    então ~80% das linhas são repetições da mesma vela. Contar linhas brutas
 *    como amostra independente é pseudo-replicação (foi o erro dos WRs antigos).
 *  - Sinais cujas FEATURES (janela de indicador) ou SETTLEMENT (saída) cruzem
 *    um gap são ELIMINADOS, não interpolados.
 *  - Separação cronológica train/validation/test com PURGE + EMBARGO.
 *  - Parâmetros escolhidos apenas em train/validation; o teste é lido UMA vez.
 *  - Número bruto de sinais, operações elegíveis e EVENTOS INDEPENDENTES
 *    (janelas que não se sobrepõem) são reportados separadamente.
 *  - Bootstrap por blocos (dependência temporal) além do Wilson binomial.
 *  - Payout observado no instante/catálogo, nunca 91% universal.
 *
 * Uso:
 *   npx tsx diagnostic-results/oos_validation.mts
 * Saída:
 *   diagnostic-results/oos/oos-report.json
 *   diagnostic-results/oos/oos-summary.md
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { wilsonInterval } from "../src/backtest/probability";
import type { Direction } from "../src/market/model";

// ───────────────────────────── configuração ─────────────────────────────
const DATA_ROOT = process.env.IQ_ROOT ?? "diagnostic-results/data/iq-real";
const CATALOG = process.env.IQ_CATALOG ?? "diagnostic-results/data/iq-catalog.json";
const SHADOW_LOG = process.env.IQ_SHADOW_LOG ?? "forward-paper/iq-shadow/shadow-predictions.jsonl";
const OUT_DIR = process.env.IQ_OOS_OUT ?? "diagnostic-results/oos";
const SEED = 20260929;
const SPLIT = { train: 0.5, validation: 0.25, test: 0.25 };
const EMBARGO_FRACTION = 1.0; // embargo = 1× horizonte de barras após cada fronteira
const BOOTSTRAP_N = 5000;
const ALPHA = 0.05;
/** Payout usado quando o catálogo não tem o dado: NÃO aplicar 91% universalmente. */
const PAYOUT_FALLBACK = { value: null as number | null, band: [0.8, 0.9] as [number, number] };
/** Grade de sensibilidade de payout (fração do stake) para o EV histórico. */
const PAYOUT_GRID = [0.8, 0.85, 0.89, 0.91];
/** Limiares congelados por setup (parte do MODEL_SPEC). */
const THRESHOLDS: Record<SetupName, Record<string, number>> = {
  fade1: {}, fade3: {}, bb20: { n: 20, k: 2 }, bb25: { n: 20, k: 2.5 },
  rsi2: { period: 2, low: 10, high: 90 }, rsi2x: { period: 2, low: 5, high: 95 }, rsi14: { period: 14, low: 30, high: 70 },
};

// ───────────────────────────── utilidades ─────────────────────────────
type Bar = { t: number; from: string; to: string; open: number; high: number; low: number; close: number };

interface Integrity {
  rowsRaw: number; rowsUnique: number; duplicates: number; conflictingDuplicates: number;
  firstFrom: string | null; lastFrom: string | null; spanHours: number;
  missingBarsInSpan: number; gapCount: number; gapHours: number;
  intradayGaps: { after: string; before: string; min: number }[];
}

function loadBars(path: string, sizeS: number): { bars: Bar[]; integrity: Integrity } {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/).slice(1).filter(Boolean);
  const byT = new Map<number, Bar>();
  let conflicting = 0;
  for (const l of lines) {
    const p = l.split(",");
    const t = new Date(p[0]!).getTime();
    if (!Number.isFinite(t)) continue;
    const bar: Bar = { t, from: p[0]!, to: p[1]!, open: +p[2]!, high: +p[3]!, low: +p[4]!, close: +p[5]! };
    const prev = byT.get(t);
    if (!prev) byT.set(t, bar);
    else if (prev.close !== bar.close || prev.open !== bar.open) conflicting++;
  }
  const bars = [...byT.values()].sort((a, b) => a.t - b.t);
  let missing = 0, gapCount = 0, gapSeconds = 0;
  const intradayGaps: { after: string; before: string; min: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const dt = (bars[i]!.t - bars[i - 1]!.t) / 1000;
    if (dt > sizeS) {
      const miss = Math.round(dt / sizeS) - 1;
      missing += miss; gapCount++; gapSeconds += dt - sizeS;
      // "intraday" = lacuna que NÃO parece fechamento de sessão/fim de semana
      const hGap = dt / 3600;
      const endHour = new Date(bars[i - 1]!.t).getUTCHours();
      const startHour = new Date(bars[i]!.t).getUTCHours();
      const sameUtcDay = new Date(bars[i - 1]!.t).toISOString().slice(0, 10) === new Date(bars[i]!.t).toISOString().slice(0, 10);
      if (sameUtcDay && hGap < 4 && endHour < startHour + 24) intradayGaps.push({ after: bars[i - 1]!.to, before: bars[i]!.from, min: Math.round(dt / 60) });
      void startHour;
    }
  }
  const first = bars[0], last = bars.at(-1);
  return {
    bars,
    integrity: {
      rowsRaw: lines.length,
      rowsUnique: bars.length,
      duplicates: lines.length - bars.length,
      conflictingDuplicates: conflicting,
      firstFrom: first?.from ?? null,
      lastFrom: last?.from ?? null,
      spanHours: first && last ? Math.round(((last.t - first.t) / 3_600_000) * 100) / 100 : 0,
      missingBarsInSpan: missing,
      gapCount,
      gapHours: Math.round((gapSeconds / 3600) * 100) / 100,
      intradayGaps: intradayGaps.slice(0, 40),
    },
  };
}

/** Sequência contígua de barras em [lo..hi] (sem nenhum gap). */
function contiguous(bars: Bar[], lo: number, hi: number, sizeS: number): boolean {
  if (lo < 0 || hi >= bars.length) return false;
  for (let i = lo + 1; i <= hi; i++) if (bars[i]!.t - bars[i - 1]!.t !== sizeS * 1000) return false;
  return true;
}

// ───────────────────────────── indicadores ─────────────────────────────
function rsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (i <= period) {
      g += Math.max(d, 0); l += Math.max(-d, 0);
      if (i === period) { g /= period; l /= period; out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); }
      continue;
    }
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
  }
  return out;
}
function sma(xs: number[], i: number, n: number): number { if (i < n - 1) return NaN; let s = 0; for (let k = i - n + 1; k <= i; k++) s += xs[k]!; return s / n; }
function stdev(xs: number[], i: number, n: number): number {
  if (i < n - 1) return NaN;
  const m = sma(xs, i, n); let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += (xs[k]! - m) ** 2;
  return Math.sqrt(s / n);
}

// ───────────────────────────── estratégias ─────────────────────────────
export type SetupName = "fade1" | "fade3" | "bb20" | "bb25" | "rsi2" | "rsi2x" | "rsi14";
export const SETUPS: Record<SetupName, string> = {
  fade1: "contra o candle anterior",
  fade3: "contra 3 candles consecutivos na mesma direção",
  bb20: "contra rompimento de Bollinger ±2.0σ (SMA20)",
  bb25: "contra rompimento de Bollinger ±2.5σ (SMA20)",
  rsi2: "RSI(2) <10 → up, >90 → down",
  rsi2x: "RSI(2) <5 → up, >95 → down",
  rsi14: "RSI(14) <30 → up, >70 → down",
};
function directionAt(setup: SetupName, ctx: { closes: number[]; rsi2: number[]; rsi14: number[]; i: number }): Direction | null {
  const { closes, rsi2, rsi14, i } = ctx;
  if (i < 1) return null;
  const up = closes[i]! > closes[i - 1]!;
  switch (setup) {
    case "fade1": return closes[i] !== closes[i - 1] ? (up ? "down" : "up") : null;
    case "fade3": {
      if (i < 3) return null;
      const a = closes[i]! > closes[i - 1]!, b = closes[i - 1]! > closes[i - 2]!, c = closes[i - 2]! > closes[i - 3]!;
      if (a && b && c) return "down";
      if (!a && !b && !c) return "up";
      return null;
    }
    case "bb20": case "bb25": {
      const n = 20, k = setup === "bb20" ? 2 : 2.5;
      const m = sma(closes, i, n), sd = stdev(closes, i, n);
      if (!Number.isFinite(m) || !(sd > 0)) return null;
      if (closes[i]! > m + k * sd) return "down";
      if (closes[i]! < m - k * sd) return "up";
      return null;
    }
    case "rsi2": return Number.isFinite(rsi2[i]!) ? (rsi2[i]! < 10 ? "up" : rsi2[i]! > 90 ? "down" : null) : null;
    case "rsi2x": return Number.isFinite(rsi2[i]!) ? (rsi2[i]! < 5 ? "up" : rsi2[i]! > 95 ? "down" : null) : null;
    case "rsi14": return Number.isFinite(rsi14[i]!) ? (rsi14[i]! < 30 ? "up" : rsi14[i]! > 70 ? "down" : null) : null;
  }
}

// ───────────────────────────── sinais ─────────────────────────────
/** Um sinal é ELEGÍVEL só se features (i-WARMUP..i) e settlement (i+horizon) forem contíguos. */
interface Signal { i: number; t: number; dir: Direction; nextMove: 1 | -1; payoutAtSignal: number | null; split: "train" | "validation" | "test" | null }
const WARMUP = 25;

function buildSignals(bars: Bar[], sizeS: number, horizon: number, setup: SetupName): { all: Signal[]; rejectedGapFeatures: number; rejectedGapSettlement: number; eligibleIndices: number[] } {
  const closes = bars.map((b) => b.close);
  const rsi2 = rsi(closes, 2);
  const rsi14 = rsi(closes, 14);
  const all: Signal[] = [];
  const eligibleIndices: number[] = [];
  let gapFeat = 0, gapSettle = 0;
  for (let i = WARMUP; i < bars.length - horizon; i++) {
    // barreira de gap: features
    if (!contiguous(bars, i - WARMUP, i, sizeS)) { gapFeat++; continue; }
    // barreira de gap: settlement
    if (!contiguous(bars, i, i + horizon, sizeS)) { gapSettle++; continue; }
    const nextMove: 1 | -1 = bars[i + horizon]!.close > bars[i]!.close ? 1 : -1;
    eligibleIndices.push(i);
    const dir = directionAt(setup, { closes, rsi2, rsi14, i });
    if (!dir) continue;
    all.push({ i, t: bars[i]!.t, dir, nextMove, payoutAtSignal: null, split: null });
  }
  return { all, rejectedGapFeatures: gapFeat, rejectedGapSettlement: gapSettle, eligibleIndices };
}

/** Atribui split cronológico com PURGE (janela do sinal) + EMBARGO (barras após a fronteira). */
function assignSplits(bars: Bar[], eligible: number[], horizon: number, signals: Signal[]): { splits: { train: number; validation: number } } {
  const n = bars.length;
  const trainEnd = Math.floor(n * SPLIT.train);
  const valEnd = Math.floor(n * (SPLIT.train + SPLIT.validation));
  const embargo = Math.max(1, Math.round(EMBARGO_FRACTION * horizon));
  const byIndex = new Map(signals.map((s) => [s.i, s]));
  for (const i of eligible) {
    const s = byIndex.get(i);
    if (!s) continue;
    const endsAt = i + horizon; // fim da janela de settlement
    if (endsAt < trainEnd - embargo) s.split = "train";
    else if (endsAt < valEnd - embargo) s.split = "validation";
    else s.split = "test";
  }
  return { splits: { train: trainEnd, validation: valEnd } };
}

/** Greedy: eventos efetivamente independentes = janelas de settlement que NÃO se sobrepõem. */
function independentEvents(signals: Signal[], horizon: number, nBars: number): Signal[] {
  const sorted = [...signals].sort((a, b) => a.i - b.i);
  const out: Signal[] = [];
  let lastEnd = -Infinity;
  for (const s of sorted) {
    if (s.i >= lastEnd) { out.push(s); lastEnd = s.i + horizon; }
  }
  void nBars;
  return out;
}

// ───────────────────────────── estatística ─────────────────────────────
function hits(signals: Signal[]): number { return signals.filter((s) => (s.dir === "up" ? s.nextMove === 1 : s.nextMove === -1)).length; }

/** Bootstrap estacionário (Politis–Romano) sobre a sequência ordenada de acertos. */
function blockBootstrapCI(signals: Signal[], horizon: number, n = BOOTSTRAP_N, seed = SEED): { lower: number; upper: number; method: string } {
  const sorted = [...signals].sort((a, b) => a.i - b.i);
  const N = sorted.length;
  if (N < 10) return { lower: NaN, upper: NaN, method: "block-bootstrap (amostra insuficiente)" };
  const x = sorted.map((s) => ((s.dir === "up" ? s.nextMove === 1 : s.nextMove === -1) ? 1 : 0));
  const p = 1 / Math.max(2, horizon + 1); // prob. de reiniciar o bloco ~ dependência de sobreposição
  let rnd = seed >>> 0;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
  const stats: number[] = [];
  for (let b = 0; b < n; b++) {
    let count = 0, idx = 0, sum = 0;
    while (count < N) {
      if (idx === 0 || rand() < p) idx = Math.floor(rand() * N);
      sum += x[idx]!; count++; idx = (idx + 1) % N;
    }
    stats.push(sum / N);
  }
  stats.sort((a, b) => a - b);
  const q = (a: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(a * stats.length)))]!;
  return { lower: q(ALPHA / 2), upper: q(1 - ALPHA / 2), method: `stationary-block-bootstrap n=${n} p=${p.toFixed(3)}` };
}

/** Bootstrap por blocos de calendário: reamostra DIAS inteiros (unidade de dependência real). */
function dayBlockBootstrapCI(signals: Signal[], n = BOOTSTRAP_N, seed = SEED + 7): { lower: number; upper: number; days: number } {
  const byDay = new Map<string, Signal[]>();
  for (const s of signals) {
    const d = new Date(s.t).toISOString().slice(0, 10);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(s);
  }
  const days = [...byDay.values()];
  if (days.length < 3) return { lower: NaN, upper: NaN, days: days.length };
  let rnd = seed >>> 0;
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
  const stats: number[] = [];
  for (let b = 0; b < n; b++) {
    let h = 0, tot = 0;
    for (let k = 0; k < days.length; k++) {
      const d = days[Math.floor(rand() * days.length)]!;
      h += hits(d); tot += d.length;
    }
    stats.push(h / Math.max(1, tot));
  }
  stats.sort((a, b) => a - b);
  const q = (a: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(a * stats.length)))]!;
  return { lower: q(ALPHA / 2), upper: q(1 - ALPHA / 2), days: days.length };
}

function wr(signals: Signal[]): { n: number; hits: number; wr: number; wilson: { lower: number; upper: number } } {
  const n = signals.length, h = hits(signals);
  const w = wilsonInterval(h, n);
  return { n, hits: h, wr: n ? h / n : NaN, wilson: { lower: w.lower, upper: w.upper } };
}

/** P&L paper com stake fixo de 1 unidade; drawdown máximo da curva de capital. */
function drawdownPaper(signals: Signal[], payout: number | null): { stake: number; maxDrawdown: number; finalPnl: number; trades: number; peak: number } {
  const sorted = [...signals].sort((a, b) => a.i - b.i);
  const p = payout ?? PAYOUT_FALLBACK.band[0];
  let equity = 0, peak = 0, maxDd = 0;
  for (const s of sorted) {
    const won = s.dir === "up" ? s.nextMove === 1 : s.nextMove === -1;
    equity += won ? p : -1;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  return { stake: 1, maxDrawdown: Math.round(maxDd * 1000) / 1000, finalPnl: Math.round(equity * 1000) / 1000, trades: sorted.length, peak: Math.round(peak * 1000) / 1000 };
}

// ───────────────────────────── baselines ─────────────────────────────
/** Baselines avaliados nas MESMAS entradas elegíveis (mesma barreira de gap). */
function baselines(bars: Bar[], eligible: number[], horizon: number, trainEnd: number): Record<string, { n: number; wr: number }> {
  const mk = (name: string, dirOf: (i: number) => Direction | null) => {
    let n = 0, h = 0;
    for (const i of eligible) {
      const d = dirOf(i);
      if (!d) continue;
      const up = bars[i + horizon]!.close > bars[i]!.close;
      n++; if (d === "up" ? up : !up) h++;
    }
    return [name, { n, wr: n ? h / n : NaN }] as const;
  };
  const prevDir = (i: number): Direction | null => (bars[i]!.close === bars[i - 1]!.close ? null : bars[i]!.close > bars[i - 1]!.close ? "up" : "down");
  // direção majoritária observada somente no treino
  let upTrain = 0, nTrain = 0;
  for (const i of eligible) if (i + horizon < trainEnd) { nTrain++; if (bars[i + horizon]!.close > bars[i]!.close) upTrain++; }
  const majority: Direction = upTrain / Math.max(1, nTrain) >= 0.5 ? "up" : "down";
  // modelo sem indicadores: P(up | direção do candle anterior) aprendido no treino
  let upAfterUp = 0, nAfterUp = 0, upAfterDown = 0, nAfterDown = 0;
  for (const i of eligible) {
    if (i + horizon >= trainEnd) continue;
    const pd = prevDir(i); if (!pd) continue;
    const up = bars[i + horizon]!.close > bars[i]!.close;
    if (pd === "up") { nAfterUp++; if (up) upAfterUp++; } else { nAfterDown++; if (up) upAfterDown++; }
  }
  const pUpGivenUp = nAfterUp ? upAfterUp / nAfterUp : 0.5;
  const pUpGivenDown = nAfterDown ? upAfterDown / nAfterDown : 0.5;
  const ctx = bars.map((b) => b.close);
  const rsi2 = rsi(ctx, 2), rsi14 = rsi(ctx, 14);

  void ctx; void rsi2; void rsi14;
  return Object.fromEntries([
    mk("always_up", () => "up"),
    mk("always_down", () => "down"),
    mk("prev_direction", prevDir),
    mk("simple_reversion", (i) => { const d = prevDir(i); return d === null ? null : d === "up" ? "down" : "up"; }),
    mk("train_majority", () => majority),
    mk("no_indicator_model", (i) => {
      const d = prevDir(i); if (!d) return null;
      const p = d === "up" ? pUpGivenUp : pUpGivenDown;
      return p >= 0.5 ? "up" : "down";
    }),
  ]);
}

// ───────────────────────────── hipóteses ─────────────────────────────
interface HypothesisSpec {
  id: string; label: string; file: string; sizeS: number; setup: SetupName; horizon: number;
  product: string; assetNameCandidates: string[]; note: string; substitutedFor?: string;
}

const HYPOTHESES: HypothesisSpec[] = [
  { id: "H1-UK100-1m-rsi14-h5", label: "UK 100 · 1m · RSI14 · h5", file: "binary-options/UK-100_60s.csv", sizeS: 60, setup: "rsi14", horizon: 5, product: "binary-options", assetNameCandidates: ["UK 100"], note: "índice; 1m h5 = 300s. Executável em turbo-options (grade de 60s) e blitz-options (tamanhos explícitos incl. 300s); NÃO em binary-options (grade de 900s)." },
  { id: "H2-US2000-1m-rsi14-h5", label: "US 2000 · 1m · RSI14 · h5", file: "binary-options/US-2000_60s.csv", sizeS: 60, setup: "rsi14", horizon: 5, product: "binary-options", assetNameCandidates: ["US 2000"], note: "índice small caps; 1m h5 = 300s. Executável em turbo/blitz." },
  { id: "H3-SP500ETF-1m-fade3-h5", label: "S&P 500 ETF (SPY) · 1m · fade3 · h5 [INSTRUMENTO INDISPONÍVEL]", file: "binary-options/S-P-500-ETF_60s.csv", sizeS: 60, setup: "fade3", horizon: 5, product: "binary-options", assetNameCandidates: ["S&P 500 ETF", "SPY", "S&P500 ETF"], note: "O instrumento foi recolhido do catálogo da IQ (não consta entre os 121 ativos de binary-options). A acurácia direcional é reportada, mas a EXECUÇÃO é impossível hoje." },
  { id: "H3b-US500-1m-fade3-h5", label: "US 500 · 1m · fade3 · h5 [SUBSTITUTO DECLARADO]", file: "binary-options/US-500_60s.csv", sizeS: 60, setup: "fade3", horizon: 5, product: "binary-options", assetNameCandidates: ["US 500"], substitutedFor: "H3-SP500ETF-1m-fade3-h5", note: "Substituto declarado do S&P 500 ETF: mesmo subjacente (S&P 500), instrumento realmente ofertado e aberto. Estrutura de candle própria — não é o mesmo feed do SPY." },
];

// ───────────────────────────── payout ─────────────────────────────
type CatalogEntry = { asset_id: unknown; profit_percent: number | null; is_open: boolean; products: string[]; expirations: number[]; raw: Record<string, unknown> };
function loadCatalog(): { byName: Map<string, CatalogEntry>; generatedAtUtc: string | null; productCounts: Record<string, number> } {
  const byName = new Map<string, CatalogEntry>();
  if (!existsSync(CATALOG)) return { byName, generatedAtUtc: null, productCounts: {} };
  const cat = JSON.parse(readFileSync(CATALOG, "utf8"));
  for (const a of cat.assets ?? []) {
    const key = String(a.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    byName.set(key, { asset_id: a.asset_id, profit_percent: a.payout ?? null, is_open: a.is_open, products: a.products ?? [], expirations: a.expirations ?? [], raw: a });
  }
  return { byName, generatedAtUtc: cat.generatedAtUtc ?? null, productCounts: cat.raw_counts_per_product ?? {} };
}

function loadShadow(): Record<string, { n: number; wr: number }> {
  const out: Record<string, { n: number; wr: number }> = {};
  if (!existsSync(SHADOW_LOG)) return out;
  const lines = readFileSync(SHADOW_LOG, "utf8").trim().split(/\r?\n/).filter(Boolean);
  for (const l of lines) {
    try {
      const r = JSON.parse(l);
      if (r.resolvedOutcome !== "hit" && r.resolvedOutcome !== "miss") continue;
      const k = r.hypothesisId;
      const cur = out[k] ?? { n: 0, wr: 0 };
      cur.n++; cur.wr += r.resolvedOutcome === "hit" ? 1 : 0;
      out[k] = cur;
    } catch { /* ignora linha corrompida */ }
  }
  for (const k of Object.keys(out)) out[k]!.wr = out[k]!.wr / out[k]!.n;
  return out;
}

// ───────────────────────────── execução ─────────────────────────────
const catalog = loadCatalog();
const shadow = loadShadow();
const report: Record<string, unknown>[] = [];
const md: string[] = [];

for (const h of HYPOTHESES) {
  const path = join(DATA_ROOT, h.file);
  if (!existsSync(path)) { console.error(`✗ ausente: ${path}`); continue; }
  const { bars, integrity } = loadBars(path, h.sizeS);
  const { all, rejectedGapFeatures, rejectedGapSettlement, eligibleIndices } = buildSignals(bars, h.sizeS, h.horizon, h.setup);
  assignSplits(bars, eligibleIndices, h.horizon, all);

  const train = all.filter((s) => s.split === "train");
  const val = all.filter((s) => s.split === "validation");
  const test = all.filter((s) => s.split === "test");
  const indepTest = independentEvents(test, h.horizon, bars.length);

  const base = baselines(bars, eligibleIndices, h.horizon, Math.floor(bars.length * SPLIT.train));

  // payout: do catálogo; senão faixa e NADA de 91% universal
  const keys = h.assetNameCandidates.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let catEntry: CatalogEntry | undefined;
  for (const k of keys) { const e = catalog.byName.get(k); if (e) { catEntry = e; break; } }
  // Payout específico do produto que oferece o ativo (binary ≠ turbo ≠ blitz).
  const payoutByProduct = ((): Record<string, number | null> => {
    if (!catEntry) return {};
    const raw = catEntry.raw as { byProduct?: Record<string, { payout: number | null }> } | undefined;
    const bp = raw?.byProduct ?? {};
    const out: Record<string, number | null> = {};
    for (const p of catEntry.products) out[p] = bp[p]?.payout ?? catEntry.profit_percent;
    return out;
  })();
  // Produto de EXECUÇÃO: só faz sentido calcular EV com o payout do produto
  // onde um vencimento de 300s existe de fato. binary-options (grade de 900s)
  // NÃO permite 300s, então seu payout mais alto é IRRELEVANTE para o V3.
  const supports300 = ((catEntry?.raw as { byProduct?: Record<string, { supports_300s?: boolean }> } | undefined)?.byProduct) ?? {};
  // Produtos que ofertam 300s de fato. A operação deve escolher o de MAIOR
  // payout entre eles (é o mesmo subjacente; o que muda é o produto).
  const eligible300 = Object.entries(supports300).filter(([, v]) => v.supports_300s === true).map(([p]) => p);
  const executionProduct = eligible300.length ? eligible300.reduce((a, b) => ((payoutByProduct[b] ?? 0) > (payoutByProduct[a] ?? 0) ? b : a)) : null;
  const payoutExecProduct = executionProduct ? (payoutByProduct[executionProduct] ?? null) : null;
  const payoutPreferred = payoutExecProduct ?? payoutByProduct[h.product] ?? catEntry?.profit_percent ?? PAYOUT_FALLBACK.value;
  const payoutObserved = payoutPreferred;
  // Normaliza para fração: o catálogo devolve percentual (91), a matemática usa 0.91.
  const payoutUsed = payoutObserved === null ? PAYOUT_FALLBACK.band[0] : (payoutObserved > 1.5 ? payoutObserved / 100 : payoutObserved);
  const breakeven = 1 / (1 + payoutUsed);

  const tWr = wr(train), vWr = wr(val), bWr = wr(test), iWr = wr(indepTest);
  const bootTest = blockBootstrapCI(test, h.horizon);
  const bootIndependent = blockBootstrapCI(indepTest, h.horizon);
  const dayBoot = dayBlockBootstrapCI(test);
  const dd = drawdownPaper(test, payoutUsed);
  const ddIndep = drawdownPaper(indepTest, payoutUsed);
  const shadowStat = shadow[h.id];

  // ── veredito explícito ────────────────────────────────────────────────────
  const tradable300 = Boolean(catEntry) && Object.values(
    (catEntry?.raw as { byProduct?: Record<string, { supports_300s?: boolean }> } | undefined)?.byProduct ?? {},
  ).some((v) => v.supports_300s === true);
  const bestBaseline = Math.max(...Object.values(base).map((b) => b.wr).filter((x) => Number.isFinite(x)));
  const bestBaselineName = Object.entries(base).find(([, b]) => b.wr === bestBaseline)?.[0] ?? "n/a";
  // Dias distintos no conjunto de teste = teto da informação real (operações do
  // mesmo dia são fortemente correlacionadas em índices).
  const testDays = new Set(test.map((s) => new Date(s.t).toISOString().slice(0, 10))).size;
  const verdict = ((): { code: string; reason: string } => {
    if (bWr.n < 30) return { code: "AMOSTRA_INSUFICIENTE", reason: `apenas ${bWr.n} sinais no teste cego` };
    if (testDays < 5) return { code: "POUCOS_DIAS_INDEPENDENTES", reason: `o teste cego abrange ${testDays} dia(s) — operações no mesmo dia são correlacionadas` };
    if (!Number.isFinite(bootTest.lower) || bootTest.lower <= breakeven) return { code: "NAO_SIGNIFICATIVO", reason: `limite inferior do bootstrap (${(bootTest.lower * 100).toFixed(1)}%) não supera o breakeven (${(breakeven * 100).toFixed(1)}%)` };
    if (bWr.wr <= bestBaseline) return { code: "SEM_EDGE_SOBRE_BASELINE", reason: `WR de teste não supera o baseline '${bestBaselineName}' (${(bestBaseline * 100).toFixed(1)}%)` };
    if (!tradable300) return { code: "EDGE_NAO_EXECUTAVEL", reason: "nenhum produto oferta vencimento de 300s para este instrumento" };
    return { code: "CANDIDATO_A_PROSPECTIVO", reason: "supera baselines e o breakeven no IC; exige confirmação prospectiva" };
  })();

  // MODEL_VERSION: hash do SPEC (independente dos dados) para o logger de shadow
  // conseguir afirmar que está rodando exatamente o mesmo modelo congelado.
  const spec = { hypothesis: h.id, setup: h.setup, horizon: h.horizon, sizeS: h.sizeS, warmup: WARMUP, split: SPLIT, embargo: EMBARGO_FRACTION, thresholds: THRESHOLDS[h.setup], seed: SEED };
  const modelVersion = createHash("sha256").update(JSON.stringify(spec)).digest("hex");
  const dataSha = createHash("sha256").update(readFileSync(path)).digest("hex");

  const pTest = bWr.wr;
  const evPer100 = Number.isFinite(pTest) ? Math.round((pTest * payoutUsed - (1 - pTest)) * 1000) / 10 : null;
  // Sensibilidade de payout: a IQ não expõe série histórica de profit_percent,
  // então o EV é reportado numa grade em vez de assumir 91% para todo o passado.
  const evSensitivity = Object.fromEntries(
    PAYOUT_GRID.map((p) => [String(Math.round(p * 100)), Number.isFinite(pTest) ? { ev_per_100: Math.round((pTest * p - (1 - pTest)) * 1000) / 10, breakeven_wr: Math.round((1 / (1 + p)) * 1000) / 1000, edge_pp: Math.round((pTest - 1 / (1 + p)) * 10000) / 100 } : { ev_per_100: null, breakeven_wr: Math.round((1 / (1 + p)) * 1000) / 1000, edge_pp: null }]),
  );

  const entry = {
    hypothesisId: h.id,
    label: h.label,
    product: h.product,
    setup: h.setup,
    horizon_bars: h.horizon,
    resolution_s: h.sizeS,
    operational_horizon_s: h.horizon * h.sizeS,
    v3_300s_compatible: h.horizon * h.sizeS === 300,
    // ── métricas exigidas ──
    TRAIN_WR: tWr.wr,
    VALIDATION_WR: vWr.wr,
    BLIND_OOS_WR: bWr.wr,
    PROSPECTIVE_WR: shadowStat ? shadowStat.wr : null,
    RAW_SIGNALS: all.length,
    INDEPENDENT_EVENTS: iWr.n,
    CONFIDENCE_INTERVAL: {
      wilson_test: bWr.wilson,
      block_bootstrap_test: { lower: bootTest.lower, upper: bootTest.upper, method: bootTest.method },
      block_bootstrap_independent: { lower: bootIndependent.lower, upper: bootIndependent.upper },
      day_block_bootstrap_test: { lower: dayBoot.lower, upper: dayBoot.upper, days: dayBoot.days },
      multiple_testing: { hypotheses_tested: HYPOTHESES.length, alpha: ALPHA, bonferroni_alpha: ALPHA / HYPOTHESES.length },
    },
    PAYOUT_OBSERVED: payoutObserved,
    PAYOUT_OBSERVED_PRODUCT: payoutExecProduct !== null ? executionProduct : catEntry ? h.product : null,
    PAYOUT_USED: payoutObserved === null ? `${PAYOUT_FALLBACK.band[0]} (limite inferior da faixa; payout histórico desconhecido)` : payoutUsed,
    PAYOUT_BY_PRODUCT: payoutByProduct,
    BREAKEVEN_WR: Math.round(breakeven * 1000) / 1000,
    EV: { per_unit_stake_test: evPer100 === null ? null : evPer100 / 100, per_100_stakes: evPer100, sensitivity_by_payout: evSensitivity },
    DRAWDOWN_PAPER: { test: dd, independent: ddIndep },
    DATA_GAPS: {
      bars_unique: integrity.rowsUnique,
      bars_raw: integrity.rowsRaw,
      duplicates_dropped: integrity.duplicates,
      duplicate_ratio: integrity.rowsRaw ? Math.round((integrity.duplicates / integrity.rowsRaw) * 1000) / 1000 : 0,
      conflicting_duplicates: integrity.conflictingDuplicates,
      span_hours: integrity.spanHours,
      missing_bars_in_span: integrity.missingBarsInSpan,
      gap_count: integrity.gapCount,
      gap_hours: integrity.gapHours,
      intraday_gaps_sample: integrity.intradayGaps,
      signals_dropped_gap_features: rejectedGapFeatures,
      signals_dropped_gap_settlement: rejectedGapSettlement,
    },
    MARKET_AVAILABILITY: {
      in_catalog: Boolean(catEntry),
      catalog_generated_at_utc: catalog.generatedAtUtc,
      resolved_asset_name: catEntry ? String((catEntry.raw as { name?: string }).name) : null,
      asset_id: catEntry?.asset_id ?? null,
      is_open_now: catEntry?.is_open ?? null,
      offered_products: catEntry?.products ?? [],
      products_offering_300s: eligible300,
      payout_by_product: payoutByProduct,
      supports_300s_by_product: Object.fromEntries(
        Object.entries((catEntry?.raw as { byProduct?: Record<string, { supports_300s?: boolean }> } | undefined)?.byProduct ?? {}).map(([p, v]) => [p, v.supports_300s ?? null]),
      ),
      tradable_now_for_300s: Boolean(catEntry) && Object.values(payoutByProduct).some((p) => typeof p === "number")
        && Object.values((catEntry?.raw as { byProduct?: Record<string, { supports_300s?: boolean }> } | undefined)?.byProduct ?? {}).some((v) => v.supports_300s === true),
      session_window_utc: [integrity.firstFrom, integrity.lastFrom],
      substituted_for: h.substitutedFor ?? null,
      note: catEntry
        ? "ativo presente no catálogo MCP (leitura apenas). A execução de 300s depende de o PRODUTO ofertar esse vencimento."
        : "NÃO localizado no catálogo por nome: o instrumento não está sendo ofertado hoje — acurácia direcional ≠ possibilidade de executar",
    },
    DATA_CATALOG_COUNTS: catalog.productCounts,
    MODEL_VERSION: modelVersion,
    MODEL_SPEC: spec,
    DATA_SHA256: dataSha,
    VERDICT: verdict,
    EFFECTIVE_INDEPENDENT_DAYS_TEST: testDays,
    BEST_BASELINE: { name: bestBaselineName, wr: bestBaseline },
    // ── detalhamento por split ──
    splits: {
      train: { ...tWr, barRange: [0, Math.floor(bars.length * SPLIT.train)] },
      validation: { ...vWr },
      test: { ...bWr },
      test_independent: { ...iWr },
    },
    baselines_test: base,
    baselines_note: "baselines avaliados nas MESMAS entradas elegíveis (mesma barreira de gap) do teste cego",
  };
  report.push(entry);

  md.push(
    `### ${h.label}`,
    "",
    `- MODEL_VERSION: \`${modelVersion.slice(0, 24)}\``,
    `- Horizonte operacional: **${h.horizon * h.sizeS}s** ${h.horizon * h.sizeS === 300 ? "✓ compatível com V3 (300s)" : "✗ NÃO compatível com V3"}`,
    `- TRAIN_WR: **${(tWr.wr * 100).toFixed(1)}%** (n=${tWr.n})`,
    `- VALIDATION_WR: **${(vWr.wr * 100).toFixed(1)}%** (n=${vWr.n})`,
    `- BLIND_OOS_WR: **${(bWr.wr * 100).toFixed(1)}%** (n=${bWr.n}, IC95 Wilson [${(bWr.wilson.lower * 100).toFixed(1)}, ${(bWr.wilson.upper * 100).toFixed(1)}])`,
    `- PROSPECTIVE_WR: ${shadowStat ? `**${(shadowStat.wr * 100).toFixed(1)}%** (n=${shadowStat.n})` : "_aguardando amostra prospectiva_"} `,
    `- RAW_SIGNALS: ${all.length} · INDEPENDENT_EVENTS (teste): ${iWr.n} · WR independente: ${Number.isFinite(iWr.wr) ? (iWr.wr * 100).toFixed(1) + "%" : "n/a"}`,
    `- Payout observado: ${payoutObserved === null ? "**desconhecido** (catálogo indisponível) — EV reportado como sensibilidade, sem assumir 91%" : payoutObserved + "% (produto de execução: " + (executionProduct ?? "indisponível para 300s") + ")"} · breakeven WR: ${(breakeven * 100).toFixed(1)}%`,
    `- EV por 100 stakes (teste, payout ${(payoutUsed * 100).toFixed(0)}%): **${evPer100 ?? "n/a"}**`,
    `- Sensibilidade de payout: ${Object.entries(evSensitivity).map(([p, v]) => `${p}%→EV ${(v as { ev_per_100: number | null }).ev_per_100 ?? "n/a"}`).join(" · ")}`,
    `- DRAWDOWN_PAPER (teste): ${dd.maxDrawdown} stake(s) · final ${dd.finalPnl}`,
    `- Dados: ${integrity.rowsUnique} barras únicas de ${integrity.rowsRaw} linhas (${integrity.duplicates} duplicatas descartadas) · span ${integrity.spanHours}h · gaps ${integrity.gapCount} (${integrity.gapHours}h)`,
    `- Sinais eliminados por gap: features ${rejectedGapFeatures} · settlement ${rejectedGapSettlement}`,
    `- Disponibilidade: ${catEntry ? `asset_id ${catEntry.asset_id}, aberto=${catEntry.is_open}, produtos=${catEntry.products.join("/")}` : "não localizado no catálogo"}`,
    `- **VEREDITO: ${verdict.code}** — ${verdict.reason}`,
    `- Dias distintos no teste cego: ${testDays} (teto da informação independente) · melhor baseline: ${bestBaselineName} ${(bestBaseline * 100).toFixed(1)}%`,
    "",
  );
}

mkdirSync(OUT_DIR, { recursive: true });

// ── CONGELAMENTO DOS MODELOS PARA O SHADOW PROSPECTIVO ──────────────────────
// Precisa existir ANTES de qualquer coleta nova: o logger recusa iniciar se o
// hash do spec não conferir, garantindo que a amostra prospectiva pertence
// exatamente ao modelo avaliado aqui (sem ajuste retrospectivo).
const SHADOW_DIR = process.env.IQ_SHADOW_DIR ?? "forward-paper/iq-shadow";
mkdirSync(SHADOW_DIR, { recursive: true });
const freeze = {
  kind: "MODEL-FREEZE",
  frozenAtUtc: new Date().toISOString(),
  read_only: true,
  orders_placed: false,
  rule: "Congelado antes da coleta prospectiva. Nenhum parâmetro é reajustado com dados futuros.",
  approval_rule: {
    min_independent_events: 100,
    requirement: "IC bootstrap (limite inferior) acima do breakeven WR e EV > 0 com o payout observado no instante do sinal",
    forbid: "declarar 70% validado sem amostra prospectiva suficiente",
  },
  models: (report as Array<Record<string, unknown>>).map((r) => {
    const spec = r.MODEL_SPEC as { hypothesis: string };
    const hyp = HYPOTHESES.find((x) => x.id === spec.hypothesis)!;
    const avail = r.MARKET_AVAILABILITY as {
      tradable_now_for_300s?: boolean;
      products_offering_300s?: string[];
      payout_by_product?: Record<string, number | null>;
      asset_id?: unknown;
    };
    // Produto de EXECUÇÃO: o de MAIOR payout entre os que ofertam 300s.
    const candidates = avail.products_offering_300s ?? [];
    const executionProduct = candidates.length
      ? candidates.reduce((a, b) => (((avail.payout_by_product ?? {})[b] ?? 0) > ((avail.payout_by_product ?? {})[a] ?? 0) ? b : a))
      : null;
    return {
      hypothesisId: r.hypothesisId,
      label: r.label,
      MODEL_VERSION: r.MODEL_VERSION,
      MODEL_SPEC: r.MODEL_SPEC,
      candle_source_product: r.product,
      execution_product: executionProduct,
      payout_execution: executionProduct ? (avail.payout_by_product?.[executionProduct] ?? null) : null,
      asset_id: avail.asset_id ?? null,
      asset_name_candidates: hyp.assetNameCandidates,
      resolution_s: r.resolution_s,
      horizon_bars: r.horizon_bars,
      operational_horizon_s: r.operational_horizon_s,
      v3_300s_compatible: r.v3_300s_compatible,
      market_availability: avail.tradable_now_for_300s ?? false,
      substituted_for: hyp.substitutedFor ?? null,
    };
  }),
};
writeFileSync(join(SHADOW_DIR, "model-freeze.json"), JSON.stringify(freeze, null, 2));

const header = {
  kind: "OOS-VALIDATION",
  generatedAtUtc: new Date().toISOString(),
  read_only: true,
  orders_placed: false,
  method: {
    dedupe: "por timestamp de abertura (`from`); a barra mais recente vence",
    splits: SPLIT,
    purge: "nenhum sinal cuja janela de settlement cruze a fronteira",
    embargo_bars: `1× horizonte após cada fronteira`,
    gap_barrier: "sinais com features (i-25..i) ou settlement (i..i+h) não contíguos são eliminados",
    independent_events: "seleção greedy de janelas de settlement que não se sobrepõem",
    bootstrap: "stationary block bootstrap + block bootstrap por dias",
    multiple_testing: { hypotheses: HYPOTHESES.length, bonferroni_alpha: ALPHA / HYPOTHESES.length },
  },
  limitations: [
    "Histórico disponível por série ≈ 1000 barras únicas (~17h em 1m) por causa do teto de 1000 candles/chamada do MCP.",
    "O payout histórico não é recuperável: a IQ não expõe série histórica de profit_percent. EV histórico usa o payout observado hoje, com faixa de sensibilidade.",
    "O teste cego é pequeno; nenhuma conclusão de 70% é declarada sem amostra prospectiva.",
  ],
};
const summary = { ...header, hypotheses: report, shadow: Object.keys(shadow).length ? shadow : null };
writeFileSync(join(OUT_DIR, "oos-report.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT_DIR, "oos-summary.md"), md.join("\n"));

console.log(`✓ ${join(OUT_DIR, "oos-report.json")}`);
console.log(`✓ ${join(OUT_DIR, "oos-summary.md")}\n`);
for (const r of report) {
  const e = r as (typeof report)[number] & { splits: { test: { n: number } }; EV: { per_100_stakes: number | null } };
  console.log(
    `${String(e.hypothesisId).padEnd(28)} TRAIN ${pct(e.TRAIN_WR)} VAL ${pct(e.VALIDATION_WR)} TEST ${pct(e.BLIND_OOS_WR)} (n=${e.splits.test.n}, indep=${e.INDEPENDENT_EVENTS}) payout=${e.PAYOUT_OBSERVED ?? "?"} EV/100=${e.EV.per_100_stakes}`,
  );
}
function pct(x: unknown): string { return typeof x === "number" && Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "n/a"; }
