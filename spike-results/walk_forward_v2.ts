// walk_forward_v2.ts — simulador walk-forward do motor TRACECON (v2, com FIXES).
//
// DIFERENÇAS vs V1 (walk_forward_sim.ts):
//   1. isActionable usa a NOVA assinatura (objeto com volatility + nRecentTrades).
//      A margem agora é ADAPTATIVA baseada em ATR% (0.02/0.05/0.08) OU libera
//      exceção histórica se >=30 trades recentes e edge>=3%.
//   2. Stop-loss (1.5% por candle) + cooldown (4h entre sinais mesmo symbol+direction)
//      aplicados via shadow.evaluateShadowTrade.
//   3. Cada returnPct tem ROUND_TRIP_COST_PP (0.3 PP) descontado via netReturnAfterCosts.
//
// Mesma causalidade: features = candles[0..i-1]; entrada no close de candles[i];
// saída percorre candles[i+1..i+12] aplicando stop-loss em qualquer candle da janela.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QuantEngine } from "../src/quant/engine.js";
import { Backtester, DEFAULT_CRITERIA } from "../src/backtest/backtest.js";
import { FusionEngine } from "../src/fusion/fusion.js";
import { assessRisk } from "../src/fusion/risk.js";
import { isActionable } from "../src/fusion/calibration.js";
import {
  openShadowTrade,
  evaluateShadowTrade,
  DEFAULT_STOP_LOSS_PCT,
  DEFAULT_COOLDOWN_MINUTES,
} from "../src/analytics/shadow.js";
import { netReturnAfterCosts } from "../src/risk/fees.js";
import type { MarketCandle } from "../src/market/model.js";
import type { Direction } from "../src/backtest/types.js";
import type { FusionInput } from "../src/fusion/types.js";

interface BinanceKline { [n: number]: string | number; }

function parseKlines(raw: unknown): MarketCandle[] {
  const arr = raw as BinanceKline[];
  return arr.map((k) => {
    const ts = k[0] as number;
    return {
      provider: "binance",
      symbol: "BTCUSDT",
      timeframe: "1h",
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      timestamp: ts,
      receivedAt: ts,
      isClosed: true,
      source: "rest",
      quality: "high",
      estimatedDelayMs: 0,
    };
  });
}

interface Trade {
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  direction: "up" | "down";
  decision: "BUY" | "SELL" | "WAIT";
  outcome: "hit" | "miss" | "flat" | "stopped" | "insufficient";
  /** Retorno bruto pré-custos (em pontos percentuais). */
  grossReturnPct: number;
  /** Retorno líquido após ROUND_TRIP_COST_PP (0.3 PP) — usa-se este no agregado. */
  returnPct: number;
  /** true se stop-loss foi disparado nesta operação. */
  stoppedBySL: boolean;
  /** true se cooldown bloqueou esta operação. */
  blockedByCooldown: boolean;
  technicalScore: number | null;
  probability: number;
  baseline: number;
  ciLower: number;
  edge: number;
  /** Margem adaptativa usada para aprovar este sinal (0.02/0.05/0.08). */
  effectiveMargin: number;
  /** ATR% da época (entrada para a margem adaptativa). */
  volatility: number;
  regime: string | null;
  rsi: number | null;
}

const HORIZON = 12;
const MIN_HISTORY = 250;
const FLAT_THRESHOLD_PCT = 0.3;
const SYMBOL = "BTCUSDT";

/** Janela futura de candles fornecida a evaluateShadowTrade (cobre exit + stop-loss). */
function futureCandleWindow(
  candles: readonly MarketCandle[],
  i: number,
): { timestamp: number; close: number }[] {
  const out: { timestamp: number; close: number }[] = [];
  // Avaliador percorre candles entre entryTime e exitTime (inclusive).
  // entryTime = candles[i].timestamp. exitTime = candles[i+HORIZON].timestamp.
  for (let j = i; j <= i + HORIZON && j < candles.length; j++) {
    out.push({ timestamp: candles[j]!.timestamp, close: candles[j]!.close });
  }
  return out;
}

/** effectiveMargin para um ATR% específico — espelha src/fusion/calibration.ts. */
function computeEffectiveMargin(volatility: number, nRecentTrades: number): number {
  // thresholds do calibration.ts
  const VOL_CALM = 0.02;
  const VOL_NORMAL = 0.05;
  const FALLBACK = 0.05;
  if (volatility < VOL_CALM) return 0.02;
  if (volatility < VOL_NORMAL) return FALLBACK;
  return 0.08;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = resolve(__dirname, "candles-btc-1h-90d.json");
const OUT_TRADES = resolve(__dirname, "trades_v2.json");
const OUT_METRICS = resolve(__dirname, "metrics_v2.json");

async function main() {
  console.error("[v2] Carregando candles...");
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as BinanceKline[];
  const candles: MarketCandle[] = parseKlines(raw);
  console.error(`[v2] Total candles: ${candles.length}`);

  const quant = new QuantEngine();
  const backtester = new Backtester();
  const fusion = new FusionEngine();

  const tradesEngine: Trade[] = [];
  const tradesRandom: Trade[] = [];

  // Cooldown por symbol+direction (4h default = 240 min).
  // Regra: entre 2 sinais aceitos do mesmo symbol+direction, >= COOLDOWN_MS.
  const COOLDOWN_MS = DEFAULT_COOLDOWN_MINUTES * 60_000;
  const lastApprovedMs: Map<string, number> = new Map();

  // Histórico de edge recente (rolling) — alimenta nRecentTrades para exceção histórica.
  // Critério: edge = probability - baseline (do signal APROVADO, em escala 0..1).
  const recentEdges: { ts: number; edge: number }[] = [];
  const RECENT_WINDOW_MS = 24 * 60 * 60_000; // 24h

  let decisionsEvaluated = 0;
  let nFusionBuySell = 0;
  let nActionableEngine = 0;
  let nBlockedByCooldown = 0;
  let nStoppedBySL = 0;
  let nScoreStrong = 0;
  const start = Date.now();

  for (let i = MIN_HISTORY; i < candles.length - HORIZON; i++) {
    const features = candles.slice(0, i); // causal
    const entryCandle = candles[i]!;
    const entryTime = entryCandle.timestamp;

    let summary;
    try {
      summary = quant.analyze({ candles: features, symbol: SYMBOL, timeframe: "1h" });
    } catch {
      continue;
    }

    const volatility = summary.volatility.atrPct;
    const regime = summary.regime.regime;
    const lastRsi = lastNonNull(summary.indicators.rsi);

    // nRecentTrades = sinais aprovados nas últimas 24h (janela rolante).
    // Espelha o gating de exceção histórica do calibration.ts.
    while (
      recentEdges.length > 0 &&
      recentEdges[0]!.ts < entryTime - RECENT_WINDOW_MS
    ) {
      recentEdges.shift();
    }
    const nRecentTrades = recentEdges.length;

    const directions: Direction[] = ["up", "down"];

    for (const direction of directions) {
      decisionsEvaluated++;

      let probability;
      try {
        probability = await backtester.probabilityForSetup({
          candles: features,
          queryIndex: features.length - 1,
          target: { direction, horizon: HORIZON, minMovePct: FLAT_THRESHOLD_PCT },
          criteria: { ...DEFAULT_CRITERIA, similarityThreshold: 0.85 },
          oosRatio: 0.25,
        });
      } catch {
        continue;
      }
      if (!probability || probability.sampleSize < 30) continue;

      const ciLower =
        probability.confidenceInterval?.lower ??
        // fallback Wilson inline (mesma fórmula do calibration.ts)
        wilsonLowerBoundInline(probability.favorable, probability.sampleSize);
      const base = probability.baseline ?? 0.5;
      const edge = probability.probability - base;

      const risk = assessRisk({
        regime,
        annualizedVolatility: summary.volatility.annualized * 100,
        atrPct: volatility,
        windowVolatility: summary.volatility.windowVolatility,
        dataQuality: "high",
        eventRisk: false,
        hasHistoricalSupport: probability.sampleSize >= 30,
      });

      const input: FusionInput = {
        symbol: SYMBOL,
        timeframe: "1h",
        direction,
        horizon: `${HORIZON} candles`,
        technical: {
          score: summary.technicalScore,
          regime,
          structureTrend: summary.structure.trend,
          rsi: lastRsi,
          supports: summary.levels.supports.map((l) => l.price),
          resistances: summary.levels.resistances.map((l) => l.price),
        },
        probability,
        risk,
        context: { newsBias: null, macroBias: null, eventRisk: false },
        dataQuality: "high",
      };

      const result = fusion.fuse(input);
      if (result.decision !== "WAIT") nFusionBuySell++;

      // === FIX #1 — ISACTIONABLE ADAPTATIVO ===
      const effMargin = computeEffectiveMargin(volatility, nRecentTrades);
      const actionableEngine = isActionable({
        probability: probability.probability,
        ciLower,
        baseline: base,
        volatility,
        nRecentTrades,
      });
      if (actionableEngine) nActionableEngine++;

      // Modo "engine" só dispara se Fusion != WAIT E isActionable aprovou.
      const mode1Pass = result.decision !== "WAIT" && actionableEngine;

      // Modo 3 = só score técnico (baseline de comparação).
      const score = summary.technicalScore;
      const aligned = (score > 0 && direction === "up") || (score < 0 && direction === "down");
      if (Math.abs(score) > 0.18 && aligned) nScoreStrong++;

      // Outcome "real" usando o pipeline shadow (stop-loss per candle + custos).
      // Compondo o shadow trade:
      const futureC = futureCandleWindow(candles, i);
      const decision: "BUY" | "SELL" | "WAIT" =
        direction === "up" ? "BUY" : "SELL";

      // Avalia o trade hipotético (com stop-loss + custos).
      const baseTrade = openShadowTrade({
        symbol: SYMBOL,
        timeframe: "1h",
        direction,
        decision,
        entryTime,
        entryPrice: entryCandle.close,
        confidence: result.confidence,
        probability: probability.probability,
        stopLossPct: DEFAULT_STOP_LOSS_PCT, // 1.5%
        cooldownMinutes: DEFAULT_COOLDOWN_MINUTES, // 240 min
      });
      const evaluated = evaluateShadowTrade(
        baseTrade,
        futureC,
        HORIZON,
        FLAT_THRESHOLD_PCT,
      );

      // === FIX #3 — custos descontados via netReturnAfterCosts ===
      // O evaluateShadowTrade já chama netReturnAfterCosts internamente
      // (returnPct é líquido). Mas como o sinal aqui é construído manualmente
      // (não passa pelo DB), recalculamos a partir do bruto para auditoria.
      const exitPrice =
        evaluated.exitPrice ?? candles[i + HORIZON]!.close;
      const movePct = ((exitPrice - entryCandle.close) / entryCandle.close) * 100;
      const grossReturnPct =
        direction === "up" ? movePct : -movePct;
      // liquid = bruto - 0.3 PP
      const liquidReturnPct = netReturnAfterCosts(grossReturnPct);

      const stoppedBySL = evaluated.outcome === "stopped";
      if (stoppedBySL) nStoppedBySL++;

      // === FIX #2 — COOLDOWN 4h entre sinais mesmo symbol+direction ===
      const cooldownKey = `${SYMBOL}|${direction}`;
      const lastMs = lastApprovedMs.get(cooldownKey) ?? 0;
      const withinCooldown = entryTime - lastMs < COOLDOWN_MS;

      // Aprovação com FIXES: engine + cooldown + outcome suficiente
      const approvedEngine =
        mode1Pass &&
        !withinCooldown &&
        evaluated.outcome !== "insufficient";

      if (withinCooldown && mode1Pass) nBlockedByCooldown++;

      const baseTradeFields: Omit<Trade, "direction" | "decision" | "stoppedBySL" | "blockedByCooldown"> = {
        entryIndex: i,
        entryTime,
        entryPrice: entryCandle.close,
        exitIndex: i + HORIZON,
        exitTime: evaluated.exitTime ?? candles[i + HORIZON]!.timestamp,
        exitPrice,
        outcome: evaluated.outcome,
        grossReturnPct,
        returnPct: liquidReturnPct,
        technicalScore: summary.technicalScore,
        probability: probability.probability,
        baseline: base,
        ciLower,
        edge,
        effectiveMargin: effMargin,
        volatility,
        regime,
        rsi: lastRsi,
      };

      if (approvedEngine) {
        tradesEngine.push({
          ...baseTradeFields,
          direction,
          decision,
          stoppedBySL,
          blockedByCooldown: false,
        });
        lastApprovedMs.set(cooldownKey, entryTime);
        recentEdges.push({ ts: entryTime, edge });
      }

      // === RANDOM BASELINE (50/50 buy/sell, cooldown 4h, custos, stop-loss) ===
      // 50% de chance, aleatório determinístico por (i, direction).
      const rand = pseudoRandom(i * 31 + (direction === "up" ? 7 : 13));
      const randomPass = rand < 0.5 && evaluated.outcome !== "insufficient";
      const randomApproved = randomPass && !withinCooldown;
      if (randomApproved) {
        tradesRandom.push({
          ...baseTradeFields,
          direction,
          decision,
          stoppedBySL,
          blockedByCooldown: false,
        });
      }
    }

    if ((i - MIN_HISTORY) % 200 === 0) {
      const elapsed = (Date.now() - start) / 1000;
      console.error(
        `[${i}/${candles.length}] engine=${tradesEngine.length} random=${tradesRandom.length} (${elapsed.toFixed(1)}s)`,
      );
    }
  }

  const elapsed = (Date.now() - start) / 1000;
  console.error(`\n[v2] FINAL em ${elapsed.toFixed(1)}s`);
  console.error(`engine (com fixes): ${tradesEngine.length} trades`);
  console.error(`random: ${tradesRandom.length} trades`);
  console.error(`decisões avaliadas: ${decisionsEvaluated}, fusion BUY/SELL: ${nFusionBuySell}, actionable: ${nActionableEngine}, score>0.18 alinhados: ${nScoreStrong}`);
  console.error(`blockedByCooldown: ${nBlockedByCooldown}, stoppedBySL: ${nStoppedBySL}`);

  // Métricas
  const engineMetrics = computeMetrics(tradesEngine, candles[0]!.close, candles.at(-1)!.close);
  const randomMetrics = computeMetrics(tradesRandom, candles[0]!.close, candles.at(-1)!.close);
  const bhMetrics = buyAndHoldMetrics(candles);

  console.error("\n=== MÉTRICAS (líquido após custos) ===");
  console.error("engine:");
  console.error(JSON.stringify(engineMetrics, null, 2));
  console.error("random:");
  console.error(JSON.stringify(randomMetrics, null, 2));
  console.error("buy&hold:");
  console.error(JSON.stringify(bhMetrics, null, 2));

  writeFileSync(
    OUT_TRADES,
    JSON.stringify(
      {
        version: "v2_with_fixes",
        engine: tradesEngine,
        random: tradesRandom,
        totalCandles: candles.length,
        generatedAt: Date.now(),
        meta: {
          nDecisionsEvaluated: decisionsEvaluated,
          nFusionBuySell,
          nActionableEngine,
          nScoreStrong,
          nBlockedByCooldown,
          nStoppedBySL,
        },
      },
      null,
      2,
    ),
  );
  console.error("Salvo em trades_v2.json");

  // Salva métricas para o report
  writeFileSync(
    OUT_METRICS,
    JSON.stringify(
      {
        version: "v2_with_fixes",
        engine: engineMetrics,
        random: randomMetrics,
        buyAndHold: bhMetrics,
        generatedAt: Date.now(),
      },
      null,
      2,
    ),
  );
  console.error("Salvo em metrics_v2.json");
}

// === Métricas ===
interface Metrics {
  totalTrades: number;
  hits: number;
  misses: number;
  flats: number;
  stopped: number;
  insufficient: number;
  winRate: number; // excluindo flat/stopped
  winRateWithStopped: number;
  avgReturnPerTrade: number; // líquido
  avgGrossReturnPerTrade: number;
  medianReturn: number;
  avgWin: number;
  avgLoss: number;
  sharpeAnnualized: number;
  maxDrawdown: number; // %
  expectancy: number; // líquido
  profitFactor: number;
  totalReturnLiquid: number; // soma dos líquidos (%)
  totalReturnGross: number;
  bestTrade: number;
  worstTrade: number;
}

function computeMetrics(trades: readonly Trade[], _firstClose: number, _lastClose: number): Metrics {
  const n = trades.length;
  if (n === 0) {
    return {
      totalTrades: 0,
      hits: 0,
      misses: 0,
      flats: 0,
      stopped: 0,
      insufficient: 0,
      winRate: 0,
      winRateWithStopped: 0,
      avgReturnPerTrade: 0,
      avgGrossReturnPerTrade: 0,
      medianReturn: 0,
      avgWin: 0,
      avgLoss: 0,
      sharpeAnnualized: 0,
      maxDrawdown: 0,
      expectancy: 0,
      profitFactor: 0,
      totalReturnLiquid: 0,
      totalReturnGross: 0,
      bestTrade: 0,
      worstTrade: 0,
    };
  }

  let hits = 0, misses = 0, flats = 0, stopped = 0, insufficient = 0;
  let sumLiquid = 0, sumGross = 0;
  let sumWin = 0, sumLoss = 0;
  const wins: number[] = [], losses: number[] = [];
  const rets: number[] = [];
  let best = -Infinity, worst = Infinity;

  for (const t of trades) {
    rets.push(t.returnPct);
    sumLiquid += t.returnPct;
    sumGross += t.grossReturnPct;
    if (t.returnPct > best) best = t.returnPct;
    if (t.returnPct < worst) worst = t.returnPct;
    switch (t.outcome) {
      case "hit":
        hits++;
        sumWin += t.returnPct;
        wins.push(t.returnPct);
        break;
      case "miss":
        misses++;
        sumLoss += t.returnPct;
        losses.push(t.returnPct);
        break;
      case "flat":
        flats++;
        break;
      case "stopped":
        stopped++;
        // Stop-loss = sempre perda
        sumLoss += t.returnPct;
        losses.push(t.returnPct);
        break;
      case "insufficient":
        insufficient++;
        break;
    }
  }

  const resolved = hits + misses + stopped;
  const winRate = resolved === 0 ? 0 : hits / resolved;
  const winRateWithStopped = n === 0 ? 0 : (hits + stopped > 0 ? hits / (hits + stopped + misses) : 0);
  // avg per trade sobre TODOS os trades (incluindo flats/stopped)
  const avgReturnPerTrade = sumLiquid / n;
  const avgGrossReturnPerTrade = sumGross / n;
  const avgWin = wins.length > 0 ? sumWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? sumLoss / losses.length : 0;
  const medianReturn = median(rets);

  // Sharpe anualizado — usa sqrt(252 * 24) para candles 1h
  const mean = avgReturnPerTrade;
  const variance = rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252 * 24) : 0;

  // Max drawdown (% sobre equity teórico, soma cumulativa simples)
  let equity = 0, peak = 0, dd = 0;
  for (const r of rets) {
    equity += r;
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > dd) dd = drawdown;
  }

  const expectancy = avgReturnPerTrade;
  const profitFactor = sumLoss < 0 ? sumWin / Math.abs(sumLoss) : (sumWin > 0 ? Infinity : 0);

  return {
    totalTrades: n,
    hits,
    misses,
    flats,
    stopped,
    insufficient,
    winRate,
    winRateWithStopped,
    avgReturnPerTrade,
    avgGrossReturnPerTrade,
    medianReturn,
    avgWin,
    avgLoss,
    sharpeAnnualized: sharpe,
    maxDrawdown: dd,
    expectancy,
    profitFactor,
    totalReturnLiquid: sumLiquid,
    totalReturnGross: sumGross,
    bestTrade: best === -Infinity ? 0 : best,
    worstTrade: worst === Infinity ? 0 : worst,
  };
}

function buyAndHoldMetrics(candles: readonly MarketCandle[]): Metrics {
  if (candles.length < 2) {
    return computeMetrics([], 0, 0);
  }
  const firstClose = candles[0]!.close;
  const lastClose = candles.at(-1)!.close;
  const ret = ((lastClose - firstClose) / firstClose) * 100;
  return {
    totalTrades: 1,
    hits: 1,
    misses: 0,
    flats: 0,
    stopped: 0,
    insufficient: 0,
    winRate: 1,
    winRateWithStopped: 1,
    avgReturnPerTrade: ret,
    avgGrossReturnPerTrade: ret,
    medianReturn: ret,
    avgWin: ret,
    avgLoss: 0,
    sharpeAnnualized: 0,
    maxDrawdown: 0,
    expectancy: ret,
    profitFactor: Infinity,
    totalReturnLiquid: ret,
    totalReturnGross: ret,
    bestTrade: ret,
    worstTrade: ret,
  };
}

function median(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function lastNonNull(series: readonly (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null) return v;
  }
  return null;
}

function pseudoRandom(seed: number): number {
  // LCG determinístico para reprodutibilidade.
  const x = Math.sin(seed * 12345.6789) * 43758.5453;
  return x - Math.floor(x);
}

function wilsonLowerBoundInline(successes: number, total: number): number {
  if (total <= 0) return 0;
  const s = Math.max(0, Math.min(successes, total));
  const n = total;
  const p = s / n;
  const z = 1.96;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lower = (centre - margin) / denom;
  return Math.max(0, Math.min(1, lower));
}

main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });