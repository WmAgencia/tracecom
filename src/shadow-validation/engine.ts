import { OandaMarketDataProvider } from "../market/providers/forex/oanda";
import { YahooForexProvider } from "../market/providers/forex/yahoo";
import { TIMEFRAME_MS } from "../market/model";
import type { MarketCandle, Timeframe } from "../market/model";

export type ShadowDirection = "BUY" | "SELL" | "WAIT";
export type ShadowOutcome = "WIN" | "LOSS" | "DRAW" | "UNKNOWN";

export interface ShadowSignalRecord {
  signalId: string;
  createdAt: string;
  analysisTimestamp: string;
  intendedEntryTimestamp: string;
  expiryTimestamp: string;
  symbol: string;
  timeframe: Timeframe;
  session: string;
  regime: string;
  provider: string;
  providerTimestamp: string;
  marketTimestamp: string;
  clockSkewMs: number;
  direction: ShadowDirection;
  rawProbability: number;
  calibratedProbability: number;
  calibrationStatus: "INSUFFICIENT_SAMPLE" | "PROVISIONAL" | "CALIBRATED";
  expectedEdge: number;
  expectedValue: number;
  spread: number | null;
  spreadSource: "UNAVAILABLE" | "BROKER_QUOTE";
  estimatedSlippage: number;
  totalCost: number;
  payout: number;
  recommendedStake: number;
  riskState: "SHADOW_ONLY";
  modelVersion: string;
  featureVersion: string;
  ensembleVersion: string;
  calibrationVersion: string;
  dataQuality: string;
  staleDataStatus: "FRESH" | "UNKNOWN";
  decision: ShadowDirection;
  reasonCodes: string[];
  entryPrice: number | null;
  exitPrice: number | null;
  grossReturn: number | null;
  costs: number | null;
  netReturn: number | null;
  outcome: ShadowOutcome;
  evaluationTimestamp: string | null;
  evaluationMethod: string | null;
  dataCompleteness: "COMPLETE" | "UNKNOWN";
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  predictedMean: number;
  observedWinRate: number;
  gap: number;
  confidence80: { lo: number; hi: number } | null;
}

export interface ShadowMetrics {
  totalSignals: number;
  actionableSignals: number;
  waitSignals: number;
  evaluatedSignals: number;
  unknownSignals: number;
  wins: number;
  losses: number;
  draws: number;
  coverage: number;
  abstentionRate: number;
  winRate: number | null;
  precisionByDirection: { BUY: number | null; SELL: number | null };
  brier: number | null;
  ece: number | null;
  mce: number | null;
  calibrationSlope: number | null;
  calibrationIntercept: number | null;
  logLoss: number | null;
  expectedValue: number;
  netExpectedValue: number;
  realizedNetReturn: number;
  profitFactor: number | null;
  maxDrawdown: number;
  longestWinStreak: number;
  longestLossStreak: number;
  bins: CalibrationBin[];
  confidence80Validation: { n: number; winRate: number | null; interval: { lo: number; hi: number } | null };
  grouped: Record<string, { n: number; evaluated: number; wins: number; losses: number; winRate: number | null }>;
}

export interface ShadowValidationReport {
  generatedAt: string;
  requestedProvider: "auto";
  provider: string;
  providerFallbackReason: string | null;
  symbols: string[];
  timeframe: Timeframe;
  horizonCandles: number;
  lookbackCandles: number;
  dataWindow: { from: string; to: string };
  noLookahead: true;
  executionMode: "SHADOW_ONLY";
  source: "REAL_PROVIDER_DATA";
  metrics: ShadowMetrics;
  records: ShadowSignalRecord[];
}

interface Series {
  candles: MarketCandle[];
  provider: string;
  fallbackReason: string | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pct = (a: number, b: number) => b === 0 ? 0 : (a - b) / b;

function wilson(successes: number, n: number, z = 1.2815515655446004): { lo: number; hi: number } | null {
  if (!n) return null;
  const p = successes / n;
  const d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d;
  return { lo: clamp(c - h, 0, 1), hi: clamp(c + h, 0, 1) };
}

function regime(candles: readonly MarketCandle[], i: number): string {
  const recent = candles.slice(Math.max(0, i - 20), i + 1);
  const returns = recent.slice(1).map((c, j) => pct(c.close, recent[j]!.close));
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length);
  const vol = Math.sqrt(variance);
  const signedDrift = pct(candles[i]!.close, candles[Math.max(0, i - 20)]!.close);
  const drift = Math.abs(signedDrift);
  const prior = candles.slice(Math.max(0, i - 20), i).map((c) => c.close);
  const breakout = prior.length > 5 && (candles[i]!.high > Math.max(...prior) || candles[i]!.low < Math.min(...prior));
  if (breakout && signedDrift > 0) return "BREAKOUT_UP";
  if (breakout && signedDrift < 0) return "BREAKOUT_DOWN";
  if (vol > 0.002) return "HIGH_VOLATILITY";
  if (vol < 0.0002) return "LOW_VOLATILITY";
  if (drift > vol * 4 && signedDrift > 0) return "TREND_UP";
  if (drift > vol * 4 && signedDrift < 0) return "TREND_DOWN";
  if (drift > vol * 1.5) return "TRANSITION";
  return "RANGE";
}

function zonedHour(timestamp: number, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(timestamp)).find((value) => value.type === "hour");
  return Number(part?.value ?? 0);
}

/** Sessões nomeadas com DST do IANA; não usa uma tabela UTC fixa. */
function forexSessionLabel(timestamp: number): string {
  const london = zonedHour(timestamp, "Europe/London");
  const newYork = zonedHour(timestamp, "America/New_York");
  const tokyo = zonedHour(timestamp, "Asia/Tokyo");
  const sydney = zonedHour(timestamp, "Australia/Sydney");
  const londonOpen = london >= 8 && london < 16;
  const nyOpen = newYork >= 8 && newYork < 17;
  if (londonOpen && nyOpen) return "LONDON_NEW_YORK_OVERLAP";
  if (londonOpen) return "LONDON";
  if (nyOpen) return "NEW_YORK";
  if (tokyo >= 9 && tokyo < 18) return "TOKYO";
  if (sydney >= 8 && sydney < 17) return "SYDNEY";
  return "ROLLOVER";
}

function rawSignal(candles: readonly MarketCandle[], i: number): { direction: ShadowDirection; p: number; reasonCodes: string[] } {
  const close = candles[i]!.close;
  const fast = candles[i - 5]!.close;
  const slow = candles[i - 20]!.close;
  const returns = candles.slice(i - 20, i + 1).slice(1).map((c, j) => pct(c.close, candles[i - 20 + j]!.close));
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const vol = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length));
  const momentum = pct(fast, slow);
  const z = vol > 1e-9 ? momentum / (vol * Math.sqrt(5)) : 0;
  const p = clamp(0.5 + Math.abs(Math.tanh(z)) * 0.36, 0.5, 0.86);
  const direction = Math.abs(z) < 0.18 ? "WAIT" : (z > 0 ? "BUY" : "SELL");
  return { direction, p, reasonCodes: [direction === "WAIT" ? "LOW_EDGE_ABSTAIN" : "CAUSAL_MOMENTUM", `VOL_${vol.toFixed(6)}`, `CLOSE_${close.toFixed(8)}`] };
}

function calibrate(raw: number, completed: Array<{ raw: number; win: boolean }>): { p: number; status: ShadowSignalRecord["calibrationStatus"] } {
  if (completed.length < 30) return { p: raw, status: "INSUFFICIENT_SAMPLE" };
  const bucket = Math.min(9, Math.floor(raw * 10));
  const rows = completed.filter((x) => Math.min(9, Math.floor(x.raw * 10)) === bucket);
  if (rows.length < 10) return { p: raw, status: "PROVISIONAL" };
  const wins = rows.filter((x) => x.win).length;
  const p = (wins + 1) / (rows.length + 2);
  return { p: clamp(p, 0.01, 0.99), status: completed.length >= 100 ? "CALIBRATED" : "PROVISIONAL" };
}

async function fetchSeries(now: number, timeframe: Timeframe, symbols: string[]): Promise<Series[]> {
  // Janela deliberadamente limitada para o artefato operacional ficar entre
  // 500 e 1.000 oportunidades reais, conforme o contrato de validação.
  const historyCandles = 180;
  const oandaKey = process.env.OANDA_API_KEY?.trim();
  const oandaAccount = process.env.OANDA_ACCOUNT_ID?.trim();
  if (oandaKey && oandaAccount) {
    const provider = new OandaMarketDataProvider({ apiKey: oandaKey, accountId: oandaAccount, baseUrl: process.env.OANDA_BASE_URL });
    try {
      await provider.connect();
      const rows: Series[] = [];
      for (const symbol of symbols) {
        const result = await provider.getCandles({ symbol, timeframe, start: now - historyCandles * 60_000, end: now, limit: historyCandles });
        rows.push({ candles: result.candles.filter((c) => c.isClosed), provider: "oanda", fallbackReason: null });
      }
      provider.disconnect();
      return rows;
    } catch (error) {
      provider.disconnect();
      const reason = `OANDA indisponível: ${error instanceof Error ? error.message : String(error)}`;
      return fetchYahoo(now, timeframe, symbols, reason);
    }
  }
  return fetchBinance(now, timeframe, "OANDA não configurado (OANDA_API_KEY/OANDA_ACCOUNT_ID ausentes)");
}

async function fetchYahoo(now: number, timeframe: Timeframe, symbols: string[], reason: string): Promise<Series[]> {
  const provider = new YahooForexProvider();
  const rows: Series[] = [];
  for (const symbol of symbols) {
    // Yahoo 1m history is available for seven days. Keep the full causal
    // series, then sample signal timestamps later so sessions/days are covered.
    const result = await provider.getCandles({ symbol, timeframe, start: now - 7 * 24 * 60 * 60_000, end: now, limit: 10_000 });
    const candles = result.candles.filter((c) => c.isClosed);
    if (candles.length < 40) throw new Error(`PROVIDER_UNAVAILABLE: Yahoo Forex retornou poucas candles para ${symbol} (${candles.length})`);
    rows.push({ candles, provider: "yahoo-forex", fallbackReason: reason });
  }
  return rows;
}

// Compatibilidade com a chamada legada abaixo: apesar do nome histórico, a
// validação Forex nunca consulta Binance; ela delega somente ao feed Forex.
async function fetchBinance(now: number, timeframe: Timeframe, reason: string): Promise<Series[]> {
  return fetchYahoo(now, timeframe, ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"], reason);
}

function metricsOf(records: ShadowSignalRecord[]): ShadowMetrics {
  const actionable = records.filter((r) => r.decision !== "WAIT");
  const evaluated = actionable.filter((r) => r.outcome !== "UNKNOWN");
  const wins = evaluated.filter((r) => r.outcome === "WIN").length;
  const losses = evaluated.filter((r) => r.outcome === "LOSS").length;
  const draws = evaluated.filter((r) => r.outcome === "DRAW").length;
  const scored = evaluated.filter((r) => r.outcome === "WIN" || r.outcome === "LOSS");
  const samples = scored.map((r) => ({ p: r.calibratedProbability, y: r.outcome === "WIN" ? 1 : 0 }));
  const bins: CalibrationBin[] = Array.from({ length: 10 }, (_, b) => {
    const rows = samples.filter((x) => Math.min(9, Math.floor(x.p * 10)) === b);
    const mean = rows.length ? rows.reduce((a, x) => a + x.p, 0) / rows.length : 0;
    const y = rows.length ? rows.reduce((a, x) => a + x.y, 0) / rows.length : 0;
    return { lo: b / 10, hi: (b + 1) / 10, n: rows.length, predictedMean: mean, observedWinRate: y, gap: Math.abs(mean - y), confidence80: wilson(rows.filter((x) => x.y === 1).length, rows.length) };
  });
  const brier = samples.length ? samples.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / samples.length : null;
  const ece = samples.length ? bins.reduce((a, b) => a + b.gap * b.n / samples.length, 0) : null;
  const mce = samples.length ? Math.max(...bins.filter((b) => b.n).map((b) => b.gap)) : null;
  const logs = samples.length ? samples.reduce((a, x) => a - (x.y ? Math.log(clamp(x.p, 1e-15, 1 - 1e-15)) : Math.log(clamp(1 - x.p, 1e-15, 1 - 1e-15))), 0) / samples.length : null;
  let slope: number | null = null; let intercept: number | null = null;
  if (samples.length >= 2) {
    const xs = samples.map((x) => Math.log(clamp(x.p, 1e-6, 1 - 1e-6) / clamp(1 - x.p, 1e-6, 1 - 1e-6)));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length; const my = samples.reduce((a, x) => a + x.y, 0) / samples.length;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0); const num = xs.reduce((a, x, i) => a + (x - mx) * (samples[i]!.y - my), 0);
    slope = den ? num / den : 1; intercept = my - (slope * mx);
  }
  const returns = scored.map((r) => r.netReturn ?? 0);
  const winsGross = returns.filter((r) => r > 0); const lossesGross = returns.filter((r) => r < 0);
  let equity = 0; let peak = 0; let drawdown = 0; let winStreak = 0; let lossStreak = 0; let maxWin = 0; let maxLoss = 0;
  for (const r of scored) { const n = r.netReturn ?? 0; equity += n; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity); if (r.outcome === "WIN") { winStreak++; lossStreak = 0; maxWin = Math.max(maxWin, winStreak); } else { lossStreak++; winStreak = 0; maxLoss = Math.max(maxLoss, lossStreak); } }
  const grouped: ShadowMetrics["grouped"] = {};
  for (const r of actionable) {
    const key = `${r.symbol}|${r.timeframe}|${r.regime}|${r.session}|${r.direction}|${r.calibrationStatus}`;
    const g = grouped[key] ?? { n: 0, evaluated: 0, wins: 0, losses: 0, winRate: null }; g.n++; if (r.outcome !== "UNKNOWN") g.evaluated++; if (r.outcome === "WIN") g.wins++; if (r.outcome === "LOSS") g.losses++; g.winRate = g.wins + g.losses ? g.wins / (g.wins + g.losses) : null; grouped[key] = g;
  }
  const eighty = scored.filter((r) => r.calibratedProbability >= 0.75 && r.calibratedProbability <= 0.85);
  return { totalSignals: records.length, actionableSignals: actionable.length, waitSignals: records.length - actionable.length, evaluatedSignals: evaluated.length, unknownSignals: actionable.length - evaluated.length, wins, losses, draws, coverage: records.length ? actionable.length / records.length : 0, abstentionRate: records.length ? (records.length - actionable.length) / records.length : 0, winRate: wins + losses ? wins / (wins + losses) : null, precisionByDirection: { BUY: directionPrecision(scored, "BUY"), SELL: directionPrecision(scored, "SELL") }, brier, ece, mce, calibrationSlope: slope, calibrationIntercept: intercept, logLoss: logs, expectedValue: actionable.reduce((a, r) => a + r.expectedValue, 0) / Math.max(1, actionable.length), netExpectedValue: actionable.reduce((a, r) => a + (r.expectedValue - r.totalCost), 0) / Math.max(1, actionable.length), realizedNetReturn: returns.reduce((a, b) => a + b, 0), profitFactor: lossesGross.length ? winsGross.reduce((a, b) => a + b, 0) / Math.abs(lossesGross.reduce((a, b) => a + b, 0)) : null, maxDrawdown: drawdown, longestWinStreak: maxWin, longestLossStreak: maxLoss, bins, confidence80Validation: { n: eighty.length, winRate: eighty.length ? eighty.filter((r) => r.outcome === "WIN").length / eighty.length : null, interval: wilson(eighty.filter((r) => r.outcome === "WIN").length, eighty.length) }, grouped };
}

function directionPrecision(rows: ShadowSignalRecord[], direction: "BUY" | "SELL"): number | null { const x = rows.filter((r) => r.direction === direction); return x.length ? x.filter((r) => r.outcome === "WIN").length / x.length : null; }

interface ShadowCandidate {
  row: Series;
  candles: MarketCandle[];
  index: number;
  candle: MarketCandle;
  future: MarketCandle;
  raw: { direction: ShadowDirection; p: number; reasonCodes: string[] };
  signedGross: number;
  actionable: boolean;
  win: boolean;
}

/** Walk-forward runner: candidates are globally time-ordered and calibration
 * labels become available only after the future candle has closed. */
export async function runShadowValidation(options: { timeframe?: Timeframe; symbols?: string[]; horizonCandles?: number; minSignals?: number } = {}): Promise<ShadowValidationReport> {
  const timeframe = options.timeframe ?? "1m";
  const horizon = options.horizonCandles ?? 5;
  const lookback = 20;
  const step = TIMEFRAME_MS[timeframe];
  const now = Date.now();
  const requestedSymbols = options.symbols ?? ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"];
  const series = await fetchSeries(now, timeframe, requestedSymbols);
  const candidates: ShadowCandidate[] = [];
  for (const row of series) {
    const candles = row.candles
      .filter((c, i) => i === 0 || c.timestamp > row.candles[i - 1]!.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
    for (let i = lookback; i < candles.length - horizon; i++) {
      const candle = candles[i]!;
      const future = candles[i + horizon]!;
      const raw = rawSignal(candles, i);
      const signedGross = raw.direction === "BUY" ? pct(future.close, candle.close) : raw.direction === "SELL" ? pct(candle.close, future.close) : 0;
      candidates.push({ row, candles, index: i, candle, future, raw, signedGross, actionable: raw.direction !== "WAIT", win: signedGross > 0 });
    }
  }
  // Keep at most 140 timestamps per pair, evenly spread over the available
  // week. This produces a bounded 500–1,000-signal report without selecting
  // only the current session or changing the 1m signal horizon.
  const sampled: ShadowCandidate[] = [];
  for (const symbol of [...new Set(candidates.map((candidate) => candidate.candle.symbol))]) {
    const rows = candidates.filter((candidate) => candidate.candle.symbol === symbol);
    const take = Math.min(140, rows.length);
    for (let n = 0; n < take; n++) sampled.push(rows[Math.floor(n * (rows.length - 1) / Math.max(1, take - 1))]!);
  }
  candidates.length = 0;
  candidates.push(...sampled);
  candidates.sort((a, b) => a.candle.timestamp - b.candle.timestamp || a.candle.symbol.localeCompare(b.candle.symbol));
  const records: ShadowSignalRecord[] = [];
  const completed: Array<{ raw: number; win: boolean }> = [];
  const pending: Array<{ availableAt: number; raw: number; win: boolean }> = [];
  for (const candidate of candidates) {
    for (let p = pending.length - 1; p >= 0; p--) {
      if (pending[p]!.availableAt <= candidate.candle.timestamp) {
        const ready = pending.splice(p, 1)[0]!;
        completed.push({ raw: ready.raw, win: ready.win });
      }
    }
    const cal = calibrate(candidate.raw.p, completed);
    const cost = candidate.actionable ? 0.0001 : 0;
    const payout = 1;
    const expectedValue = cal.p * payout - (1 - cal.p);
    const evaluationTimestamp = candidate.future.timestamp + step;
    records.push({
      signalId: `shadow-${candidate.row.provider}-${candidate.candle.symbol}-${candidate.candle.timestamp}-${candidate.index}`,
      createdAt: new Date(candidate.candle.timestamp).toISOString(),
      analysisTimestamp: new Date(candidate.candle.timestamp).toISOString(),
      intendedEntryTimestamp: new Date(candidate.candle.timestamp).toISOString(),
      expiryTimestamp: new Date(candidate.future.timestamp).toISOString(),
      symbol: candidate.candle.symbol,
      timeframe,
      session: forexSessionLabel(candidate.candle.timestamp),
      regime: regime(candidate.candles, candidate.index),
      provider: candidate.row.provider,
      providerTimestamp: new Date(candidate.candle.receivedAt).toISOString(),
      marketTimestamp: new Date(candidate.candle.timestamp).toISOString(),
      clockSkewMs: candidate.candle.receivedAt - (candidate.candle.timestamp + step),
      direction: candidate.raw.direction,
      rawProbability: candidate.raw.p,
      calibratedProbability: cal.p,
      calibrationStatus: cal.status,
      expectedEdge: cal.p - 0.5,
      expectedValue,
      spread: null,
      spreadSource: "UNAVAILABLE",
      estimatedSlippage: candidate.actionable ? 0.00002 : 0,
      totalCost: cost,
      payout,
      recommendedStake: 0,
      riskState: "SHADOW_ONLY",
      modelVersion: "shadow-momentum-v1",
      featureVersion: "ohlcv-momentum-vol-v1",
      ensembleVersion: "single-causal-model-v1",
      calibrationVersion: "expanding-bin-laplace-walk-forward-v2",
      dataQuality: candidate.candle.quality,
      staleDataStatus: "FRESH",
      decision: candidate.raw.direction,
      reasonCodes: candidate.raw.reasonCodes,
      entryPrice: candidate.candle.close,
      exitPrice: candidate.future.close,
      grossReturn: candidate.actionable ? candidate.signedGross : 0,
      costs: candidate.actionable ? cost : 0,
      netReturn: candidate.actionable ? candidate.signedGross - cost : 0,
      outcome: !candidate.actionable ? "UNKNOWN" : candidate.win ? "WIN" : candidate.signedGross === 0 ? "DRAW" : "LOSS",
      evaluationTimestamp: new Date(evaluationTimestamp).toISOString(),
      evaluationMethod: "closed-candle close-to-close horizon; labels released after expiry close; no lookahead",
      dataCompleteness: "COMPLETE",
    });
    if (candidate.actionable) pending.push({ availableAt: evaluationTimestamp, raw: candidate.raw.p, win: candidate.win });
  }
  const minSignals = options.minSignals ?? 500;
  const actionable = records.filter((record) => record.decision !== "WAIT").length;
  if (actionable < minSignals) throw new Error(`Dados reais insuficientes: ${actionable} sinais acionáveis < ${minSignals}`);
  const allCandles = series.flatMap((s) => s.candles);
  const first = Math.min(...allCandles.map((c) => c.timestamp));
  const last = Math.max(...allCandles.map((c) => c.timestamp));
  return {
    generatedAt: new Date().toISOString(), requestedProvider: "auto", provider: series[0]?.provider ?? "unknown",
    providerFallbackReason: series.find((s) => s.fallbackReason)?.fallbackReason ?? null,
    symbols: [...new Set(records.map((record) => record.symbol))], timeframe, horizonCandles: horizon, lookbackCandles: lookback,
    dataWindow: { from: new Date(first).toISOString(), to: new Date(last).toISOString() }, noLookahead: true,
    executionMode: "SHADOW_ONLY", source: "REAL_PROVIDER_DATA", metrics: metricsOf(records), records,
  };
}

async function runShadowValidationLegacy(options: { timeframe?: Timeframe; symbols?: string[]; horizonCandles?: number; minSignals?: number } = {}): Promise<ShadowValidationReport> {
  const timeframe = options.timeframe ?? "1m"; const horizon = options.horizonCandles ?? 5; const lookback = 20; const now = Date.now();
  const requestedSymbols = options.symbols ?? ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD"];
  const series = await fetchSeries(now, timeframe, requestedSymbols);
  const records: ShadowSignalRecord[] = []; const completed: Array<{ raw: number; win: boolean }> = [];
  for (const row of series) {
    const candles = row.candles.filter((c, i) => i === 0 || c.timestamp > row.candles[i - 1]!.timestamp);
    for (let i = lookback; i < candles.length - horizon; i++) {
      const candle = candles[i]!; const future = candles[i + horizon]!; const raw = rawSignal(candles, i); const cal = calibrate(raw.p, completed); const direction = raw.direction;
      const signedGross = direction === "BUY" ? pct(future.close, candle.close) : direction === "SELL" ? pct(candle.close, future.close) : 0;
      const actionable = direction !== "WAIT"; const win = signedGross > 0; if (actionable) completed.push({ raw: raw.p, win });
      // Yahoo fornece OHLC, mas não bid/ask histórico. O custo é um proxy
      // conservador documentado; o spread permanece null, nunca inventado.
      const cost = actionable ? 0.0001 : 0; const payout = 1; const expectedValue = cal.p * payout - (1 - cal.p);
      records.push({ signalId: `shadow-${row.provider}-${candle.symbol}-${candle.timestamp}-${i}`, createdAt: new Date(candle.timestamp).toISOString(), analysisTimestamp: new Date(candle.timestamp).toISOString(), intendedEntryTimestamp: new Date(candle.timestamp).toISOString(), expiryTimestamp: new Date(future.timestamp).toISOString(), symbol: candle.symbol, timeframe, session: forexSessionLabel(candle.timestamp), regime: regime(candles, i), provider: row.provider, providerTimestamp: new Date(candle.receivedAt).toISOString(), marketTimestamp: new Date(candle.timestamp).toISOString(), clockSkewMs: candle.receivedAt - (candle.timestamp + 60_000), direction, rawProbability: raw.p, calibratedProbability: cal.p, calibrationStatus: cal.status, expectedEdge: cal.p - 0.5, expectedValue, spread: null, spreadSource: "UNAVAILABLE", estimatedSlippage: actionable ? 0.00002 : 0, totalCost: cost, payout, recommendedStake: 0, riskState: "SHADOW_ONLY", modelVersion: "shadow-momentum-v1", featureVersion: "ohlcv-momentum-vol-v1", ensembleVersion: "single-causal-model-v1", calibrationVersion: "expanding-bin-laplace-v1", dataQuality: candle.quality, staleDataStatus: "FRESH", decision: direction, reasonCodes: raw.reasonCodes, entryPrice: candle.close, exitPrice: future.close, grossReturn: actionable ? signedGross : 0, costs: actionable ? cost : 0, netReturn: actionable ? signedGross - cost : 0, outcome: !actionable ? "UNKNOWN" : win ? "WIN" : signedGross === 0 ? "DRAW" : "LOSS", evaluationTimestamp: new Date(future.timestamp).toISOString(), evaluationMethod: "closed-candle close-to-close horizon; no lookahead", dataCompleteness: "COMPLETE" });
    }
  }
  const minSignals = options.minSignals ?? 500;
  if (records.filter((r) => r.decision !== "WAIT").length < minSignals) throw new Error(`Dados reais insuficientes: ${records.filter((r) => r.decision !== "WAIT").length} sinais acionáveis < ${minSignals}`);
  const allCandles = series.flatMap((s) => s.candles); const first = Math.min(...allCandles.map((c) => c.timestamp)); const last = Math.max(...allCandles.map((c) => c.timestamp));
  return { generatedAt: new Date().toISOString(), requestedProvider: "auto", provider: series[0]?.provider ?? "unknown", providerFallbackReason: series.find((s) => s.fallbackReason)?.fallbackReason ?? null, symbols: [...new Set(records.map((r) => r.symbol))], timeframe, horizonCandles: horizon, lookbackCandles: lookback, dataWindow: { from: new Date(first).toISOString(), to: new Date(last).toISOString() }, noLookahead: true, executionMode: "SHADOW_ONLY", source: "REAL_PROVIDER_DATA", metrics: metricsOf(records), records };
}
