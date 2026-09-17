/**
 * RESEARCH ENGINE (Fase 5) — todas as 10 variantes congeladas rodam em SHADOW por mercado.
 *
 * Regras:
 *  - Nunca usa informacao futura: abertura em candles[index].close, liquidacao no candle cujo
 *    bucketStart >= entryBucket + horizonte (causalidade por timestamp do candle).
 *  - Uma posicao shadow por variante por mercado; resultados isolados por marketKey (NORMAL != OTC).
 *  - Nao altera a logica das estrategias congeladas: usa computeFrozenFeatures/evaluateFrozen/settleFrozen.
 *  - Placar prospectivo: oportunidades, sinais, trades, W/L/D, WR, PnL unitario, streak, drawdown,
 *    janelas recente/longa, amostras, payout medio, sessao (hora) e NORMAL/OTC.
 */
import { FROZEN_VARIANTS, computeFrozenFeatures, evaluateFrozen, settleFrozen } from "./frozen-strategies.mjs";

export const RESEARCH_VERSION = "research-engine-v1";
export const SHADOW_VARIANTS = FROZEN_VARIANTS.map((variant) => variant.variantId);

const emptyStats = () => ({ opportunities: 0, signals: 0, trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0, payoutSum: 0, payoutCount: 0, losingStreak: 0, maxLosingStreak: 0, equity: 0, peak: 0, maxDrawdown: 0, lastResults: [] });
const payoutFraction = (payout) => (Number.isFinite(Number(payout)) && Number(payout) > 0 ? (Number(payout) > 1 ? Number(payout) / 100 : Number(payout)) : null);

export function summarizeStats(stats, { recentWindow = 30 } = {}) {
  const decided = stats.wins + stats.losses + stats.draws;
  const recent = stats.lastResults.slice(-recentWindow);
  const recentWins = recent.filter((row) => row === "WIN").length;
  const recentLosses = recent.filter((row) => row === "LOSS").length;
  const recentDraws = recent.filter((row) => row === "DRAW").length;
  return {
    opportunities: stats.opportunities, signals: stats.signals, trades: stats.trades,
    wins: stats.wins, losses: stats.losses, draws: stats.draws,
    winRate: decided ? Number((stats.wins / decided).toFixed(4)) : null,
    pnl: Number(stats.pnl.toFixed(4)),
    pnlPerTrade: decided ? Number((stats.pnl / decided).toFixed(4)) : null,
    avgPayout: stats.payoutCount ? Number((stats.payoutSum / stats.payoutCount).toFixed(2)) : null,
    losingStreak: stats.losingStreak, maxLosingStreak: stats.maxLosingStreak,
    maxDrawdown: Number(stats.maxDrawdown.toFixed(4)),
    recent: { sample: recent.length, wins: recentWins, losses: recentLosses, draws: recentDraws, winRate: recent.length ? Number((recentWins / recent.length).toFixed(4)) : null, pnlPerTrade: recent.length ? Number((recent.reduce((sum, row) => sum + (row === "WIN" ? 1 : row === "LOSS" ? -1 : 0), 0) / recent.length).toFixed(4)) : null },
  };
}

export class ResearchEngine {
  constructor({ now = () => Date.now(), recentWindow = 30, onSettle = null } = {}) {
    this.now = now;
    this.recentWindow = recentWindow;
    this.onSettle = onSettle;
    this.markets = new Map(); // marketKey -> { stats: Map<variantId, stats>, open: Map<variantId, trade>, trades: [], version }
    this.sequence = 0;
  }

  #market(marketKey) {
    if (!this.markets.has(marketKey)) this.markets.set(marketKey, { stats: new Map(SHADOW_VARIANTS.map((variantId) => [variantId, emptyStats()])), open: new Map(), trades: [], version: 0 });
    return this.markets.get(marketKey);
  }

  /** Chamado deterministicamente a cada candle processado (com features ja calculadas no ultimo indice). */
  observeCandle({ marketKey, marketType, candles, index, payout = null, atMs = null }) {
    if (!Array.isArray(candles) || index < 0 || index >= candles.length) return { opportunities: 0, opened: 0, settled: 0 };
    const state = this.#market(marketKey);
    const candle = candles[index];
    const features = computeFrozenFeatures(candles, index);
    let opened = 0, settled = 0, signals = 0;
    // liquidacao causal primeiro (nunca liquida com candle futuro ao momento da abertura)
    for (const [variantId, trade] of [...state.open.entries()]) {
      if (candle.bucketStart >= trade.settlementAfterMs) {
        const result = settleFrozen(trade.direction, trade.entryPrice, candle.close);
        const stats = state.stats.get(variantId);
        stats.trades += 1;
        const fraction = payoutFraction(trade.payout) ?? 0.85;
        const pnl = result === "WIN" ? fraction : result === "LOSS" ? -1 : 0;
        stats.pnl += pnl; stats.equity += pnl; stats.peak = Math.max(stats.peak, stats.equity); stats.maxDrawdown = Math.max(stats.maxDrawdown, stats.peak - stats.equity);
        if (result === "WIN") { stats.wins += 1; stats.losingStreak = 0; } else if (result === "LOSS") { stats.losses += 1; stats.losingStreak += 1; stats.maxLosingStreak = Math.max(stats.maxLosingStreak, stats.losingStreak); } else stats.draws += 1;
        stats.lastResults.push(result); if (stats.lastResults.length > 500) stats.lastResults.splice(0, stats.lastResults.length - 500);
        state.trades.push({ id: ++this.sequence, marketKey, marketType, variantId, direction: trade.direction, entryPrice: trade.entryPrice, entryBucket: trade.entryBucket, settlementBucket: candle.bucketStart, settlementPrice: candle.close, result, pnl: Number(pnl.toFixed(4)), payout: trade.payout ?? null, openedAt: trade.openedAt, settledAt: candle.bucketStart, sessionHour: new Date(trade.entryBucket).getUTCHours() });
        if (state.trades.length > 2000) state.trades.splice(0, state.trades.length - 2000);
        state.open.delete(variantId);
        settled += 1;
        if (typeof this.onSettle === "function") { try { this.onSettle({ marketKey, marketType, variantId, result, pnl, at: candle.bucketStart }); } catch { /* callback nunca derruba o pipeline */ } }
      }
    }
    if (!features) return { opportunities: 0, opened, settled };
    const variantByFamily = new Map();
    for (const variant of FROZEN_VARIANTS) { if (!variantByFamily.has(variant.family)) variantByFamily.set(variant.family, []); }
    for (const variant of FROZEN_VARIANTS) {
      const stats = state.stats.get(variant.variantId);
      stats.opportunities += 1;
      stats.payoutCount += payoutFraction(payout) === null ? 0 : 1; if (payoutFraction(payout) !== null) stats.payoutSum += Number(payout);
      if (state.open.has(variant.variantId)) continue;
      const signal = evaluateFrozen(variant.family, features);
      if (!signal) continue;
      signals += 1; stats.signals += 1;
      const trade = { direction: signal, entryPrice: candle.close, entryBucket: candle.bucketStart, settlementAfterMs: candle.bucketStart + variant.horizonSeconds * 1000, payout, openedAt: atMs ?? this.now() };
      state.open.set(variant.variantId, trade);
      opened += 1;
    }
    state.version += 1;
    return { opportunities: FROZEN_VARIANTS.length, opened, settled, signals, version: state.version };
  }

  /** Placar por mercado (nunca mistura mercados). */
  scoreboard(marketKey, { variantIds = SHADOW_VARIANTS } = {}) {
    const state = this.#market(marketKey);
    const rows = variantIds.map((variantId) => ({ variantId, ...summarizeStats(state.stats.get(variantId) ?? emptyStats(), { recentWindow: this.recentWindow }) }));
    return { marketKey, version: state.version, variants: rows, openShadow: state.open.size, trades: state.trades.length };
  }

  scoreboardAll() {
    return { version: RESEARCH_VERSION, markets: [...this.markets.keys()].map((marketKey) => this.scoreboard(marketKey)) };
  }

  /** Ranking conservador para o Strategy Manager (mesmo mercado, apenas). */
  challengerFor(marketKey, championVariantId) {
    const board = this.scoreboard(marketKey);
    const challengers = board.variants.filter((row) => row.variantId !== championVariantId).sort((a, b) => (b.recent.pnlPerTrade ?? -Infinity) - (a.recent.pnlPerTrade ?? -Infinity));
    return { board, strongest: challengers[0] ?? null, challengers };
  }

  recentTrades(marketKey, limit = 50) {
    const state = this.#market(marketKey);
    return [...state.trades].sort((a, b) => b.settledAt - a.settledAt).slice(0, Math.max(1, Math.min(200, limit)));
  }

  toJSON() {
    return {
      version: RESEARCH_VERSION,
      markets: [...this.markets.entries()].map(([marketKey, state]) => ({
        marketKey,
        stats: [...state.stats.entries()].map(([variantId, stats]) => [variantId, stats]),
        trades: state.trades.slice(-120),
        version: state.version,
      })),
    };
  }

  loadFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.markets)) return false;
    for (const row of snapshot.markets) {
      if (!row?.marketKey || !Array.isArray(row.stats)) continue;
      const state = this.#market(row.marketKey);
      for (const [variantId, stats] of row.stats) state.stats.set(variantId, { ...emptyStats(), ...stats });
      state.trades = Array.isArray(row.trades) ? row.trades.slice(-500) : [];
      state.version = Number(row.version) || 0;
    }
    return true;
  }
}

/**
 * A/B prospectivo (arquiteturas A-E) — cada oportunidade gera uma linha comparavel.
 * A: FrozenStrategyOnly (champion bruto) | B: TraderOnly | C: Trader+Critic | D: +Intelligence | E: AdaptiveManager
 * O resultado e liquidado causalmente pelo mesmo candle de referencia das variantes.
 */
export class ABExperiment {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.arms = ["A_FROZEN", "B_TRADER", "C_TRADER_CRITIC", "D_PLUS_INTELLIGENCE", "E_ADAPTIVE"]; this.records = []; this.sequence = 0; }

  record({ marketKey, marketType, atMs, variantId, horizonSeconds, entryPrice, settlementAfterMs, actions, payout }) {
    const record = {
      id: ++this.sequence, marketKey, marketType, atMs, variantId, horizonSeconds, entryPrice, settlementAfterMs, payout,
      actions: {
        A_FROZEN: actions.A_FROZEN ?? "WAIT", B_TRADER: actions.B_TRADER ?? "WAIT", C_TRADER_CRITIC: actions.C_TRADER_CRITIC ?? "WAIT",
        D_PLUS_INTELLIGENCE: actions.D_PLUS_INTELLIGENCE ?? "WAIT", E_ADAPTIVE: actions.E_ADAPTIVE ?? "WAIT",
      },
      settled: false, results: null,
    };
    this.records.push(record);
    if (this.records.length > 3000) this.records.splice(0, this.records.length - 3000);
    return record;
  }

  settle({ marketKey, candles, index }) {
    if (!Array.isArray(candles) || index < 0) return 0;
    const candle = candles[index];
    let settled = 0;
    for (const record of this.records) {
      if (record.settled || record.marketKey !== marketKey) continue;
      if (candle.bucketStart < record.settlementAfterMs) continue;
      const results = {};
      for (const arm of this.arms) {
        const action = record.actions[arm];
        const result = action === "BUY" || action === "SELL" ? settleFrozen(action, record.entryPrice, candle.close) : "NO_TRADE";
        const fraction = payoutFraction(record.payout) ?? 0.85;
        const pnl = result === "WIN" ? fraction : result === "LOSS" ? -1 : 0;
        results[arm] = { action, result, pnl: Number(pnl.toFixed(4)) };
      }
      record.results = results; record.settled = true; record.settlementBucket = candle.bucketStart;
      settled += 1;
    }
    return settled;
  }

  scoreboard() {
    const out = {};
    for (const arm of this.arms) {
      let trades = 0, wins = 0, losses = 0, draws = 0, pnl = 0, noTrade = 0;
      for (const record of this.records) {
        const entry = record.results?.[arm]; if (!entry) continue;
        if (entry.result === "NO_TRADE") { noTrade += 1; continue; }
        trades += 1; if (entry.result === "WIN") wins += 1; else if (entry.result === "LOSS") losses += 1; else draws += 1; pnl += entry.pnl;
      }
      out[arm] = { trades, wins, losses, draws, noTrade, winRate: wins + losses + draws > 0 ? Number((wins / (wins + losses + draws)).toFixed(4)) : null, pnl: Number(pnl.toFixed(4)), pnlPerTrade: trades ? Number((pnl / trades).toFixed(4)) : null };
    }
    return { version: "ab-experiment-v1", arms: out, totalRecords: this.records.length };
  }
}
