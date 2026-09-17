/**
 * SETUP RESEARCH ENGINE (Fase 6) — shadow de SETUPS do Professional Brain (sem variantes V1/V2/V3/V8).
 *
 * - Cada setup disparado pelo brain roda em shadow com liquidacao causal (candle do horizonte).
 * - Placar por marketKey x setup x regime; WAITs contabilizados separadamente.
 * - A/B prospectivo: A_TRADER, B_TRADER_CRITIC, C_PLUS_INTELLIGENCE, D_APPRENTICE.
 * - Nenhuma referencia a estrategias antigas; nada de look-ahead.
 */
export const SETUP_RESEARCH_VERSION = "setup-research-engine-v2";
export const BRAIN_HORIZON_SECONDS = 60;
export const SETUP_KEYS = ["TREND_PULLBACK", "BREAKOUT_CONTINUATION", "BREAKOUT_RETEST", "FAILED_BREAKOUT", "RANGE_REVERSAL", "MOMENTUM_CONTINUATION", "REJECTION", "COMPRESSION_EXPANSION", "REVERSAL_ATTEMPT", "NO_VALID_SETUP"];

const emptyStats = () => ({ opportunities: 0, trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0, payoutSum: 0, payoutCount: 0, losingStreak: 0, maxLosingStreak: 0, equity: 0, peak: 0, maxDrawdown: 0, lastResults: [], waits: 0, blocked: 0 });
const payoutFraction = (payout) => (Number.isFinite(Number(payout)) && Number(payout) > 0 ? (Number(payout) > 1 ? Number(payout) / 100 : Number(payout)) : 0.85);

export function summarizeSetupStats(stats, { recentWindow = 30 } = {}) {
  const decided = stats.wins + stats.losses + stats.draws;
  const recent = stats.lastResults.slice(-recentWindow);
  const recentWins = recent.filter((row) => row === "WIN").length;
  const recentLosses = recent.filter((row) => row === "LOSS").length;
  return {
    opportunities: stats.opportunities, trades: stats.trades, wins: stats.wins, losses: stats.losses, draws: stats.draws,
    winRate: decided ? Number((stats.wins / decided).toFixed(4)) : null,
    pnl: Number(stats.pnl.toFixed(4)), pnlPerTrade: decided ? Number((stats.pnl / decided).toFixed(4)) : null,
    avgPayout: stats.payoutCount ? Number((stats.payoutSum / stats.payoutCount).toFixed(2)) : null,
    losingStreak: stats.losingStreak, maxLosingStreak: stats.maxLosingStreak, maxDrawdown: Number(stats.maxDrawdown.toFixed(4)),
    waits: stats.waits, blocked: stats.blocked,
    recent: { sample: recent.length, wins: recentWins, losses: recentLosses, winRate: recent.length ? Number((recentWins / recent.length).toFixed(4)) : null },
  };
}

export class SetupResearchEngine {
  constructor({ now = () => Date.now(), recentWindow = 30 } = {}) {
    this.now = now;
    this.recentWindow = recentWindow;
    this.markets = new Map(); // marketKey -> { stats: Map<setup, stats>, regimes: Map<regime, {trades,wins,losses}>, open: Map<setup, trade>, trades: [], waits: number, version }
    this.sequence = 0;
  }

  #market(marketKey) {
    if (!this.markets.has(marketKey)) this.markets.set(marketKey, { stats: new Map(SETUP_KEYS.map((setup) => [setup, emptyStats()])), regimes: new Map(), open: new Map(), trades: [], waits: 0, version: 0 });
    return this.markets.get(marketKey);
  }
  #stats(marketKey, setup) { const market = this.#market(marketKey); if (!market.stats.has(setup)) market.stats.set(setup, emptyStats()); return market.stats.get(setup); }

  /** Chamado a cada candle com o resultado do brain (setup/regime/acao). */
  observeCandle({ marketKey, marketType, candles, index, brain, payout = null, atMs = null }) {
    if (!Array.isArray(candles) || index < 0 || index >= candles.length) return { opened: 0, settled: 0 };
    const candle = candles[index];
    const market = this.#market(marketKey);
    let opened = 0, settled = 0;
    for (const [setup, trade] of [...market.open.entries()]) {
      if (candle.bucketStart < trade.settlementAfterMs) continue;
      const result = trade.direction === "BUY" ? (candle.close > trade.entryPrice ? "WIN" : candle.close < trade.entryPrice ? "LOSS" : "DRAW") : (candle.close < trade.entryPrice ? "WIN" : candle.close > trade.entryPrice ? "LOSS" : "DRAW");
      const stats = this.#stats(marketKey, setup);
      const fraction = payoutFraction(trade.payout);
      const pnl = result === "WIN" ? fraction : result === "LOSS" ? -1 : 0;
      stats.trades += 1; stats.pnl = Number((stats.pnl + pnl).toFixed(4));
      stats.equity += pnl; stats.peak = Math.max(stats.peak, stats.equity); stats.maxDrawdown = Math.max(stats.maxDrawdown, stats.peak - stats.equity);
      if (result === "WIN") { stats.wins += 1; stats.losingStreak = 0; } else if (result === "LOSS") { stats.losses += 1; stats.losingStreak += 1; stats.maxLosingStreak = Math.max(stats.maxLosingStreak, stats.losingStreak); } else stats.draws += 1;
      stats.lastResults.push(result); if (stats.lastResults.length > 400) stats.lastResults.splice(0, stats.lastResults.length - 400);
      const regimeBucket = market.regimes.get(trade.regime) ?? { trades: 0, wins: 0, losses: 0 };
      regimeBucket.trades += 1; if (result === "WIN") regimeBucket.wins += 1; if (result === "LOSS") regimeBucket.losses += 1;
      market.regimes.set(trade.regime, regimeBucket);
      market.trades.push({ id: ++this.sequence, marketKey, marketType, setup, regime: trade.regime, direction: trade.direction, entryPrice: trade.entryPrice, entryBucket: trade.entryBucket, settlementBucket: candle.bucketStart, result, pnl: Number(pnl.toFixed(4)), payout: trade.payout ?? null, at: trade.atMs ?? this.now(), trigger: trade.trigger ?? null });
      if (market.trades.length > 2000) market.trades.splice(0, market.trades.length - 2000);
      market.open.delete(setup);
      settled += 1;
    }
    if (!brain) return { opened: 0, settled };
    const setup = brain.setup ?? "NO_VALID_SETUP";
    const stats = this.#stats(marketKey, setup);
    stats.opportunities += 1;
    if (brain.action === "WAIT") { stats.waits += 1; market.waits += 1; return { opened: 0, settled }; }
    if (market.open.has(setup)) return { opened: 0, settled };
    market.open.set(setup, { direction: brain.action, entryPrice: candle.close, entryBucket: candle.bucketStart, settlementAfterMs: candle.bucketStart + BRAIN_HORIZON_SECONDS * 1000, payout, regime: brain.regime, trigger: brain.trigger, atMs: atMs ?? this.now() });
    opened += 1;
    market.version += 1;
    return { opened, settled };
  }

  scoreboard(marketKey) {
    const market = this.#market(marketKey);
    return {
      marketKey, version: market.version, waits: market.waits,
      setups: [...market.stats.entries()].map(([setup, stats]) => ({ setup, ...summarizeSetupStats(stats, { recentWindow: this.recentWindow }) })),
      regimes: [...market.regimes.entries()].map(([regime, bucket]) => ({ regime, ...bucket, winRate: bucket.trades ? Number((bucket.wins / bucket.trades).toFixed(4)) : null })),
      openShadow: market.open.size, trades: market.trades.length,
    };
  }
  scoreboardAll() { return { version: SETUP_RESEARCH_VERSION, markets: [...this.markets.keys()].map((marketKey) => this.scoreboard(marketKey)), note: "Placar por setup/regime; nenhuma variante V1/V2/V3/V8 e monitorada." }; }
  bestSetupFor(marketKey) {
    const board = this.scoreboard(marketKey);
    return board.setups.filter((row) => row.trades >= 10).sort((a, b) => (b.recent.winRate ?? -1) - (a.recent.winRate ?? -1))[0] ?? null;
  }
  recentTrades(marketKey, limit = 50) { const market = this.#market(marketKey); return [...market.trades].sort((a, b) => b.settlementBucket - a.settlementBucket).slice(0, Math.max(1, Math.min(200, limit))); }
  toJSON() {
    return { version: SETUP_RESEARCH_VERSION, markets: [...this.markets.entries()].map(([marketKey, market]) => ({ marketKey, stats: [...market.stats.entries()], regimes: [...market.regimes.entries()], trades: market.trades.slice(-120), waits: market.waits, version: market.version })) };
  }
  loadFrom(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.markets)) return false;
    for (const row of snapshot.markets) {
      const market = this.#market(row.marketKey);
      for (const [setup, stats] of row.stats ?? []) market.stats.set(setup, { ...emptyStats(), ...stats });
      for (const [regime, bucket] of row.regimes ?? []) market.regimes.set(regime, bucket);
      market.trades = Array.isArray(row.trades) ? row.trades : [];
      market.waits = Number(row.waits) || 0;
      market.version = Number(row.version) || 0;
    }
    return true;
  }
}

/** A/B prospectivo v2 (mesmo snapshot causal). D usa a acao do aprendiz quando informada. */
export class ABExperiment {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.arms = ["A_TRADER", "B_TRADER_CRITIC", "C_PLUS_INTELLIGENCE", "D_APPRENTICE"]; this.records = []; this.sequence = 0; }
  record({ marketKey, marketType, atMs, setup, horizonSeconds = BRAIN_HORIZON_SECONDS, entryPrice, settlementAfterMs, actions, payout }) {
    const record = { id: ++this.sequence, marketKey, marketType, atMs, setup, horizonSeconds, entryPrice, settlementAfterMs, payout, actions: { A_TRADER: actions.A_TRADER ?? "WAIT", B_TRADER_CRITIC: actions.B_TRADER_CRITIC ?? "WAIT", C_PLUS_INTELLIGENCE: actions.C_PLUS_INTELLIGENCE ?? "WAIT", D_APPRENTICE: actions.D_APPRENTICE ?? "WAIT" }, settled: false, results: null };
    this.records.push(record);
    if (this.records.length > 4000) this.records.splice(0, this.records.length - 4000);
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
        if (action !== "BUY" && action !== "SELL") { results[arm] = { action, result: "NO_TRADE", pnl: 0 }; continue; }
        const result = action === "BUY" ? (candle.close > record.entryPrice ? "WIN" : candle.close < record.entryPrice ? "LOSS" : "DRAW") : (candle.close < record.entryPrice ? "WIN" : candle.close > record.entryPrice ? "LOSS" : "DRAW");
        const fraction = payoutFraction(record.payout);
        results[arm] = { action, result, pnl: Number((result === "WIN" ? fraction : result === "LOSS" ? -1 : 0).toFixed(4)) };
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
      out[arm] = { trades, wins, losses, draws, noTrade, winRate: wins + losses + draws ? Number((wins / (wins + losses + draws)).toFixed(4)) : null, pnl: Number(pnl.toFixed(4)), pnlPerTrade: trades ? Number((pnl / trades).toFixed(4)) : null };
    }
    return { version: "ab-experiment-v2", arms: out, totalRecords: this.records.length };
  }
}
