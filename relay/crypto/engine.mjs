/**
 * CRYPTO ENGINE (CRYPTO_REGIME_TREND_V1) â€” motor separado da Binary V3.
 * Multi-timeframe: 15m (regime) -> 5m (estrutura/setup) -> 1m (timing).
 * PAPER ONLY (CRYPTO_PAPER_EXECUTION=true; CRYPTO_REAL_EXECUTION=false).
 * LLM unico (CRYPTO_CONSENSUS) via router/limiter existentes (nunca o prompt da Binary).
 */
import { CryptoMarketDataProvider, CRYPTO_SYMBOLS, CRYPTO_TIMEFRAMES } from "./market-data.mjs";
import { detectRegime } from "./regime.mjs";
import { detectSetup } from "./setup.mjs";
import { cryptoDeterministicEngines, cryptoConsensusPrompt, parseCryptoConsensus, CRYPTO_CONSENSUS_ROLE } from "./consensus.mjs";
import { CryptoPositionManager, positionSize } from "./position-manager.mjs";

export const CRYPTO_STRATEGY_ID = "CRYPTO_REGIME_TREND_V1";
export const CRYPTO_ENGINE_VERSION = "crypto-engine-v1";

export class CryptoEngine {
  constructor({ pool = null, now = Date.now, log = () => {}, env = process.env, router = null, limiter = null, provider = null, runProvider = null } = {}) {
    this.pool = pool;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.env = env;
    this.router = router;
    this.limiter = limiter;
    this.runProvider = runProvider;
    this.provider = provider ?? new CryptoMarketDataProvider({ provider: String(env.CRYPTO_MARKET_PROVIDER ?? "binance"), now });
    this.symbols = Array.isArray(env.CRYPTO_SYMBOLS) ? env.CRYPTO_SYMBOLS : CRYPTO_SYMBOLS;
    this.paperExecution = String(env.CRYPTO_PAPER_EXECUTION ?? "true") === "true";
    this.realExecutionAllowed = String(env.CRYPTO_REAL_EXECUTION ?? "false") === "true";
    this.paperBalance = Number(env.CRYPTO_PAPER_BALANCE) || 1000;
    this.riskPct = Number(env.CRYPTO_RISK_PERCENT) || 1;
    this.minRr = Number(env.CRYPTO_MIN_RR) || 1.5;
    this.trailingEnabled = String(env.CRYPTO_TRAILING_ENABLED ?? "false") === "true";
    this.atrFactor = Number(env.CRYPTO_STOP_ATR_FACTOR) || 1.5;
    this.cycleMs = Math.max(5_000, Number(env.CRYPTO_CYCLE_MS) || 15_000);
    this.positions = new CryptoPositionManager({ now });
    this.markets = new Map(this.symbols.map((symbol) => [symbol, this.#freshMarket(symbol)]));
    this.candles = new Map();
    this.tickers = new Map();
    this.cycleTimer = null;
    this.running = false;
    this.consensusHistory = [];
    this.lastCycleAt = 0;
    this.gate = { paperOnly: this.paperExecution === true && this.realExecutionAllowed !== true };
    this.settled = 0;
  }

  #freshMarket(symbol) {
    return { symbol, regime: null, regimeReason: null, trendDirection: null, setup: { candidate: null, reason: "INIT" }, engines: null, consensus: null, agents: { state: "BOOT", label: "Waiting Market Data" }, position: null, feed: { healthy: false, lastOkAt: 0, lastError: null }, lastAnalysisAt: 0, ticker: null };
  }

  /** REGIME: 15m (contexto) / SETUP: 5m + timing 1m. */
  async analyzeSymbol(symbol) {
    const market = this.markets.get(symbol);
    const [r15, r5, r1, ticker] = await Promise.all([
      this.provider.getCandles(symbol, CRYPTO_TIMEFRAMES.REGIME, 200),
      this.provider.getCandles(symbol, CRYPTO_TIMEFRAMES.SETUP, 200),
      this.provider.getCandles(symbol, CRYPTO_TIMEFRAMES.TIMING, 60),
      this.provider.getTicker(symbol),
    ]);
    if (r15.ok !== true || r5.ok !== true) {
      market.feed = { healthy: false, lastOkAt: market.feed.lastOkAt, lastError: `${r15.message ?? ""} ${r5.message ?? ""}`.trim() };
      market.agents = { state: "FEED_DOWN", label: "Market Data Unavailable" };
      return;
    }
    market.feed = { healthy: true, lastOkAt: this.now(), lastError: null };
    this.candles.set(`${symbol}:15m`, r15.candles);
    this.candles.set(`${symbol}:5m`, r5.candles);
    this.candles.set(`${symbol}:1m`, r1.ok === true ? r1.candles : r5.candles.slice(-30));
    if (ticker.ok === true) { market.ticker = ticker; this.tickers.set(symbol, ticker); }

    // REGIME (15m)
    const regimeResult = detectRegime(r15.candles);
    market.regime = regimeResult.regime;
    market.regimeReason = regimeResult.reason;
    market.regimeEvidence = regimeResult.evidence;

    // SETUP (5m + 1m), evidencias calculadas em codigo
    const { detectRegime: _d, computeAdxDmi, computeAtr, computeBollinger, computeEmaSlopes, computeStructure, computeRsi } = await import("./regime.mjs");
    const indicators = {
      adx: computeAdxDmi(r5.candles),
      atr: computeAtr(r5.candles),
      bollinger: computeBollinger(r5.candles),
      emas: computeEmaSlopes(r5.candles),
      structure: computeStructure(r5.candles),
      rsi: computeRsi(r5.candles),
    };
    market.structure = indicators.structure;
    market.indicators = indicators;
    market.trendDirection = market.regime === "TREND_UP" ? "TREND_UP" : market.regime === "TREND_DOWN" ? "TREND_DOWN" : null;
    const setup = detectSetup({ regime: market.regime, trendDirection: market.trendDirection, structure: indicators.structure, indicators, candles5m: r5.candles, candles1m: r1.ok === true ? r1.candles : null, minRr: this.minRr, atrFactor: this.atrFactor });
    market.setup = setup;

    // AGENTS deterministicos (6) + CONSENSUS LLM (1) somente com candidato.
    const engines = cryptoDeterministicEngines({ regime: market.regime, indicators, structure: indicators.structure, setup, symbol });
    market.engines = engines;
    market.agents = { state: "ANALYZING", label: `Regime ${market.regime}` };

    if (setup.candidate && this.gate.paperOnly) {
      const requestId = `crypto:${symbol}:${CRYPTO_TIMEFRAMES.TIMING}:${CRYPTO_CONSENSUS_ROLE}:${this.now()}`;
      const prompt = cryptoConsensusPrompt({ symbol, timeframe: CRYPTO_TIMEFRAMES.TIMING, regime: market.regime, trendDirection: market.trendDirection, structure: indicators.structure, indicators, setup, engines, paper: this.paperExecution });
      const call = await this.#runConsensus(requestId, prompt);
      const consensus = parseCryptoConsensus(call?.text ?? null);
      market.consensus = {
        at: this.now(), result: consensus.ok ? consensus.result : "NO_TRADE", confidence: consensus.confidence ?? null, thesis: consensus.thesis ?? null,
        counterCase: consensus.counterCase ?? null, invalidation: consensus.invalidation ?? null,
        provider: call?.provider ?? null, model: call?.model ?? null, latencyMs: call?.latencyMs ?? null, ok: consensus.ok,
      };
      market.agents = { state: "CONSENSUS", label: consensus.ok ? `Consensus ${consensus.result}` : "Consensus Error" };
      this.consensusHistory.push({ symbol, at: this.now(), ...market.consensus });
      if (this.consensusHistory.length > 200) this.consensusHistory.splice(0, this.consensusHistory.length - 200);
      if (consensus.ok && consensus.result !== "NO_TRADE") {
        if (consensus.result === setup.candidate.side) await this.#openPaperPosition(symbol, consensus.result, setup.candidate);
        else market.agents = { state: "DISCORDANCE", label: `Consensus ${consensus.result} x Candidate ${setup.candidate.side}` };
      }
    } else {
      market.consensus = { at: this.now(), result: "NO_TRADE", reason: setup.candidate ? "REAL_EXECUTION_NOT_ALLOWED" : setup.reason, ok: true };
    }
    market.lastAnalysisAt = this.now();
  }

  /** LLM unico (CRYPTO_CONSENSUS) via router/limiter da infra existente â€” prompt separado. */
  async #runConsensus(requestId, prompt) {
    if (!this.router || !this.limiter || !this.runProvider || !this.pool) return { status: "ERROR", reason: "LLM_NOT_CONFIGURED" };
    const chosen = this.router.choose(CRYPTO_CONSENSUS_ROLE);
    if (!chosen) return { status: "ERROR", reason: "NO_ROUTE" };
    const deadlineAt = this.now() + 10_000;
    const result = await this.limiter.run({
      priority: 2, deadlineAt, estimatedLatencyMs: 4_000, suppressProviderError: true,
      execute: () => this.runProvider(this.pool, { role: CRYPTO_CONSENSUS_ROLE, requestId, prompt, maxTokens: 700, timeoutMs: 10_000, provider: chosen.provider, model: chosen.model }),
    });
    this.router.report({ ...chosen, httpStatus: result?.httpStatus, status: result?.status, schemaValid: result?.status === "OK", latencyMs: result?.latencyMs });
    this.log("CRYPTO_CONSENSUS", JSON.stringify({ requestId, provider: chosen.provider, model: chosen.model, status: result?.status ?? "ERROR", latencyMs: result?.latencyMs ?? null }));
    return result;
  }

  /** PAPER position com sizing por risco percentual (nunca dinheiro real). */
  async #openPaperPosition(symbol, side, candidate) {
    if (this.gate.paperOnly !== true) { this.log("CRYPTO_REAL_EXECUTION_BLOCKED", JSON.stringify({ symbol, side })); return; }
    const existing = [...this.positions.positions.values()].find((p) => p.symbol === symbol && p.status === "OPEN");
    if (existing) return;
    const sized = positionSize({ paperBalance: this.paperBalance, riskPct: this.riskPct, entry: candidate.entry, stop: candidate.stop });
    if (!(sized.quantity > 0)) { this.log("CRYPTO_SIZING_FAIL", JSON.stringify({ symbol, sized })); return; }
    const opened = this.positions.open({ symbol, side, entryPrice: candidate.entry, quantity: sized.quantity, notional: sized.notional, stopLoss: candidate.stop, takeProfit: candidate.target, riskAmount: sized.riskAmount, riskReward: candidate.rr, entryTime: this.now() });
    if (opened.ok === true) {
      this.markets.get(symbol).position = opened.position;
      this.markets.get(symbol).agents = { state: "IN_POSITION", label: `${side} ${opened.position.entryPrice}` };
      this.log("CRYPTO_PAPER_OPEN", JSON.stringify({ symbol, side, entry: opened.position.entryPrice, stop: opened.position.stopLoss, target: opened.position.takeProfit, quantity: opened.position.quantity, notional: opened.position.notional, riskAmount: opened.position.riskAmount, rr: opened.position.riskReward }));
      if (this.pool?.query) void this.pool.query("INSERT INTO crypto_positions(position_id, symbol, side, entry_price, quantity, notional, stop_loss, take_profit, risk_amount, risk_reward, status, opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'OPEN',now()) ON CONFLICT(position_id) DO NOTHING", [opened.position.positionId, symbol, side, opened.position.entryPrice, opened.position.quantity, opened.position.notional, opened.position.stopLoss, opened.position.takeProfit, opened.position.riskAmount, opened.position.riskReward]).catch(() => undefined);
    }
  }

  async tickPositions() {
    for (const symbol of this.symbols) {
      const ticker = this.tickers.get(symbol);
      if (!ticker) continue;
      const market = this.markets.get(symbol);
      const events = this.positions.tick(symbol, ticker.lastPrice, { trailingEnabled: this.trailingEnabled, trailingAtr: market?.indicators?.atr?.atr ?? null });
      for (const event of events) {
        this.settled += 1;
        if (this.pool?.query) void this.pool.query("UPDATE crypto_positions SET status='CLOSED', exit_reason=$2, exit_price=$3, realized_pnl=$4, closed_at=now() WHERE position_id=$1", [event.positionId, event.reason, event.exit, event.pnl]).catch(() => undefined);
        if (this.pool?.query) void this.pool.query("INSERT INTO crypto_executions(position_id, symbol, side, entry, exit, quantity, reason, pnl, closed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())", [event.positionId, event.symbol, event.side, event.entry, event.exit, event.quantity, event.reason, event.pnl]).catch(() => undefined);
        this.log("CRYPTO_PAPER_CLOSE", JSON.stringify({ positionId: event.positionId, symbol, side: event.side, reason: event.reason, pnl: event.pnl }));
        market.position = null;
        market.agents = { state: "IDLE", label: `Closed ${event.reason}` };
      }
      if (market.position && market.position.status === "OPEN") market.position.update(ticker.lastPrice);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (this.pool?.query) await this.pool.query(`CREATE TABLE IF NOT EXISTS crypto_positions(position_id text PRIMARY KEY, symbol text NOT NULL, side text NOT NULL, entry_price numeric, quantity numeric, notional numeric, stop_loss numeric, take_profit numeric, risk_amount numeric, risk_reward numeric, status text, opened_at timestamptz, exit_reason text, exit_price numeric, realized_pnl numeric, closed_at timestamptz)`).catch(() => undefined);
    if (this.pool?.query) await this.pool.query(`CREATE TABLE IF NOT EXISTS crypto_executions(position_id text, symbol text, side text, entry numeric, exit numeric, quantity numeric, reason text, pnl numeric, closed_at timestamptz)`).catch(() => undefined);
    if (this.pool?.query) await this.pool.query(`CREATE TABLE IF NOT EXISTS crypto_performance(epoch text PRIMARY KEY, trades int, wins int, losses int, win_rate numeric, gross_profit numeric, gross_loss numeric, net_pnl numeric, profit_factor numeric, max_drawdown numeric, updated_at timestamptz)`).catch(() => undefined);
    this.log("CRYPTO_ENGINE_START", JSON.stringify({ strategy: CRYPTO_STRATEGY_ID, symbols: this.symbols, paper: this.paperExecution, realAllowed: this.realExecutionAllowed, cycleMs: this.cycleMs }));
    const cycle = async () => {
      if (!this.running) return;
      try {
        await Promise.all(this.symbols.map((symbol) => this.analyzeSymbol(symbol).catch((error) => { this.log("CRYPTO_ANALYZE_FAIL", String(error?.message ?? error).slice(0, 140)); })));
        await this.tickPositions().catch((error) => { this.log("CRYPTO_TICK_FAIL", String(error?.message ?? error).slice(0, 140)); });
        this.lastCycleAt = this.now();
      } catch (error) { this.log("CRYPTO_CYCLE_FAIL", String(error?.message ?? error).slice(0, 140)); }
    };
    await cycle();
    this.cycleTimer = setInterval(() => { void cycle(); }, this.cycleMs);
    this.cycleTimer.unref?.();
  }

  stop() {
    this.running = false;
    if (this.cycleTimer) { clearInterval(this.cycleTimer); this.cycleTimer = null; }
  }

  status() {
    return {
      strategy: CRYPTO_STRATEGY_ID, version: CRYPTO_ENGINE_VERSION, epoch: "CRYPTO_V1_EPOCH",
      enabled: true, paperExecution: this.paperExecution, realExecution: false, realExecutionAllowed: this.realExecutionAllowed,
      paperBalance: this.paperBalance, riskPct: this.riskPct, minRr: this.minRr, trailingEnabled: this.trailingEnabled,
      marketData: this.provider.status(), symbols: this.symbols, markets: [...this.markets.values()].map((m) => ({
        symbol: m.symbol, price: m.ticker?.lastPrice ?? null, change24hPct: m.ticker?.change24hPct ?? null,
        regime: m.regime, regimeReason: m.regimeReason, trendDirection: m.trendDirection,
        setup: { candidate: m.setup?.candidate ? { side: m.setup.candidate.side, entry: m.setup.candidate.entry, stop: m.setup.candidate.stop, target: m.setup.candidate.target, rr: m.setup.candidate.rr } : null, reason: m.setup?.reason ?? null },
        agents: m.agents ?? null, consensus: m.consensus ?? null, feed: m.feed ?? null, lastAnalysisAt: m.lastAnalysisAt,
        position: m.position ? { positionId: m.position.positionId, side: m.position.side, entry: m.position.entryPrice, stop: m.position.stopLoss, target: m.position.takeProfit, unrealizedPnL: m.position.unrealizedPnL, status: m.position.status, highest: m.position.highestPrice, lowest: m.position.lowestPrice } : null,
      })),
      positions: { open: this.positions.stats().trades === 0 ? [...this.positions.positions.values()].map((p) => ({ positionId: p.positionId, symbol: p.symbol, side: p.side, entry: p.entryPrice, stop: p.stopLoss, target: p.takeProfit, unrealizedPnL: p.unrealizedPnL, status: p.status })) : [], stats: this.positions.stats() },
      consensusHistory: this.consensusHistory.slice(-20),
      lastCycleAt: this.lastCycleAt,
    };
  }
}
