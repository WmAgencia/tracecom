/**
 * CRYPTO POSITION MANAGER + METRICS (isoladas da Binary).
 * Entry/stop(estrutural+ATR)/TP(R:R e estrutura)/trailing opcional/PnL/risco percentual.
 * Sem Martingale; nunca aumenta posicao apos LOSS.
 */
export const CRYPTO_POSITION_VERSION = "crypto-position-manager-v1";
export const CRYPTO_V1_EPOCH = "CRYPTO_V1_EPOCH";

export function positionSize({ paperBalance, riskPct, entry, stop }) {
  const balance = Number(paperBalance) || 0;
  const pct = Math.max(0.1, Math.min(10, Number(riskPct) || 1));
  const riskAmount = (balance * pct) / 100;
  const distance = Math.abs(Number(entry) - Number(stop));
  if (!(distance > 0) || !(entry > 0)) return { quantity: 0, riskAmount, reason: "BAD_LEVELS" };
  const quantity = riskAmount / distance;
  const notional = quantity * entry;
  return { quantity: Number(quantity.toFixed(8)), riskAmount: Number(riskAmount.toFixed(2)), notional: Number(notional.toFixed(2)) };
}

export class CryptoPosition {
  constructor({ symbol, side, entryPrice, quantity, notional, stopLoss, takeProfit, riskAmount, riskReward, entryTime, fees = 0 }) {
    this.positionId = `crypto-${symbol}-${entryTime}-${Math.random().toString(36).slice(2, 8)}`;
    this.symbol = symbol;
    this.side = side; // LONG | SHORT
    this.entryPrice = entryPrice;
    this.quantity = quantity;
    this.notional = notional;
    this.stopLoss = stopLoss;
    this.takeProfit = takeProfit;
    this.riskAmount = riskAmount;
    this.riskReward = riskReward;
    this.entryTime = entryTime;
    this.highestPrice = entryPrice;
    this.lowestPrice = entryPrice;
    this.status = "OPEN";
    this.closedAt = null;
    this.exitReason = null;
    this.exitPrice = null;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    this.fees = fees;
    this.pnlAtClose = 0;
  }

  update(price) {
    const p = Number(price);
    if (!(p > 0)) return { changed: false };
    if (p > this.highestPrice) this.highestPrice = p;
    if (p < this.lowestPrice) this.lowestPrice = p;
    const direction = this.side === "LONG" ? 1 : -1;
    this.unrealizedPnL = Number(((p - this.entryPrice) * direction * this.quantity - this.fees).toFixed(8));
    return { changed: true };
  }

  /** Verifica stop/TP com o preco atual. Retorna evento de fechamento se houver. */
  checkExit(price, { trailingEnabled = false, trailingAtr = null } = {}) {
    const p = Number(price);
    if (!(p > 0) || this.status !== "OPEN") return null;
    this.update(p);
    if (trailingEnabled === true && trailingAtr) {
      const dir = this.side === "LONG" ? 1 : -1;
      const dist = Math.abs(trailingAtr);
      const trailingStop = this.side === "LONG" ? this.highestPrice - dist : this.lowestPrice + dist;
      if (dir > 0 && trailingStop > this.stopLoss) this.stopLoss = trailingStop;
      if (dir < 0 && trailingStop < this.stopLoss) this.stopLoss = trailingStop;
    }
    if (this.side === "LONG" && p <= this.stopLoss) return this.close({ reason: "STOP_LOSS", price: this.stopLoss });
    if (this.side === "SHORT" && p >= this.stopLoss) return this.close({ reason: "STOP_LOSS", price: this.stopLoss });
    if (this.side === "LONG" && p >= this.takeProfit) return this.close({ reason: "TAKE_PROFIT", price: this.takeProfit });
    if (this.side === "SHORT" && p <= this.takeProfit) return this.close({ reason: "TAKE_PROFIT", price: this.takeProfit });
    return null;
  }

  close({ reason, price, fees = 0 }) {
    if (this.status !== "OPEN") return null;
    const p = Number(price);
    const direction = this.side === "LONG" ? 1 : -1;
    const pnl = Number(((p - this.entryPrice) * direction * this.quantity - this.fees - fees).toFixed(8));
    this.status = "CLOSED";
    this.closedAt = Date.now();
    this.exitReason = reason;
    this.exitPrice = p;
    this.realizedPnL = pnl;
    this.pnlAtClose = pnl;
    return { positionId: this.positionId, symbol: this.symbol, side: this.side, entry: this.entryPrice, exit: p, quantity: this.quantity, reason, pnl, riskAmount: this.riskAmount, riskReward: this.riskReward, closedAt: this.closedAt };
  }
}

export class CryptoPositionManager {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.positions = new Map();
    this.closed = [];
    this.sequence = 0;
  }

  open({ symbol, side, entryPrice, quantity, notional, stopLoss, takeProfit, riskAmount, riskReward, entryTime = this.now() }) {
    if (!symbol || !["LONG", "SHORT"].includes(side)) return { ok: false, reason: "INVALID_OPEN" };
    if (!(entryPrice > 0) || !(stopLoss > 0) || !(takeProfit > 0)) return { ok: false, reason: "BAD_LEVELS" };
    const existing = [...this.positions.values()].filter((p) => p.symbol === symbol && p.status === "OPEN");
    if (existing.length >= 1) return { ok: false, reason: "ONE_POSITION_PER_SYMBOL" };
    const position = new CryptoPosition({ symbol, side, entryPrice, quantity, notional, stopLoss, takeProfit, riskAmount, riskReward, entryTime });
    this.positions.set(position.positionId, position);
    return { ok: true, position };
  }

  tick(symbol, price, options = {}) {
    const out = [];
    for (const position of this.positions.values()) {
      if (position.symbol !== symbol || position.status !== "OPEN") continue;
      const event = position.checkExit(price, options);
      if (event) { this.positions.delete(position.positionId); this.closed.push(event); out.push(event); }
    }
    return out;
  }

  closeAll(symbol, reason = "ENGINE_STOP") {
    const out = [];
    for (const position of this.positions.values()) {
      if (position.symbol !== symbol && symbol !== null) continue;
      if (position.status !== "OPEN") continue;
      const event = position.close({ reason, price: position.entryPrice });
      if (event) { this.positions.delete(position.positionId); this.closed.push(event); out.push(event); }
    }
    return out;
  }

  stats() {
    const wins = this.closed.filter((t) => t.pnl > 0);
    const losses = this.closed.filter((t) => t.pnl <= 0);
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const netPnL = grossProfit - grossLoss;
    const trades = this.closed.length;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0);
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const expectancy = trades ? (grossProfit - grossLoss) / trades : 0;
    let peak = 0;
    let drawdown = 0;
    let running = 0;
    for (const t of this.closed) {
      running += t.pnl;
      if (running > peak) peak = running;
      drawdown = Math.max(drawdown, peak - running);
    }
    const bySymbol = {};
    const bySide = { LONG: { trades: 0, pnl: 0 }, SHORT: { trades: 0, pnl: 0 } };
    for (const t of this.closed) {
      bySymbol[t.symbol] = bySymbol[t.symbol] ?? { trades: 0, wins: 0, losses: 0, pnl: 0 };
      const row = bySymbol[t.symbol];
      row.trades += 1;
      row.pnl += t.pnl;
      if (t.pnl > 0) row.wins += 1; else row.losses += 1;
      bySide[t.side].trades += 1;
      bySide[t.side].pnl += t.pnl;
    }
    return {
      epoch: CRYPTO_V1_EPOCH,
      trades, wins: wins.length, losses: losses.length, winRate: trades ? Number(((100 * wins.length) / trades).toFixed(1)) : null,
      grossProfit: Number(grossProfit.toFixed(8)), grossLoss: Number(grossLoss.toFixed(8)), netPnL: Number(netPnL.toFixed(8)),
      profitFactor: profitFactor === null ? null : Number(profitFactor.toFixed(3)), expectancy: Number(expectancy.toFixed(8)),
      averageWin: Number(avgWin.toFixed(8)), averageLoss: Number(avgLoss.toFixed(8)),
      maxDrawdown: Number(drawdown.toFixed(8)), fees: this.closed.reduce((s, t) => s + (t.fees ?? 0), 0), slippage: 0,
      long: bySide.LONG, short: bySide.SHORT, bySymbol,
    };
  }
}