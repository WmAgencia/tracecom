/** FASE 6 — Setup Research Engine v2 + A/B prospectivo v2.
 * Shadow por SETUP do Professional Brain; liquidacao causal; nenhuma variante V1/V2/V3/V8. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const engineModule = await import("../../relay/research-engine.mjs");
const { SetupResearchEngine, ABExperiment, BRAIN_HORIZON_SECONDS, SETUP_KEYS, summarizeSetupStats, SETUP_RESEARCH_VERSION } = engineModule as unknown as Record<string, any>;

const candle = (bucketStart: number, close: number) => ({ bucketStart, start: bucketStart, open: close, high: close + 0.001, low: close - 0.001, close });

describe("SETUP RESEARCH ENGINE v2 — shadow causal por setup", () => {
  it("abre apenas com brain acionavel e liquida somente no candle do horizonte (nunca antes)", () => {
    const engine = new SetupResearchEngine({ now: () => 0 }) as any;
    const candles = [candle(0, 1.1)];
    const brain = { setup: "TREND_PULLBACK", action: "BUY", regime: "TREND_UP", trigger: "pullback concluido" };
    const opened = engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles, index: 0, brain, payout: 85, atMs: 0 });
    expect(opened).toMatchObject({ opened: 1, settled: 0 });
    const boardOpen = engine.scoreboard("EURUSD:NORMAL");
    expect(boardOpen.openShadow).toBe(1);
    expect(boardOpen.setups.find((row: any) => row.setup === "TREND_PULLBACK").opportunities).toBe(1);
    // candle antes do horizonte NAO liquida
    const early = engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [candle(30_000, 1.2)], index: 0, brain: null, atMs: 30_000 });
    expect(early.settled).toBe(0);
    expect(engine.scoreboard("EURUSD:NORMAL").openShadow).toBe(1);
    // candle no horizonte liquida causalmente (BUY + close maior = WIN)
    const settled = engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [candle(BRAIN_HORIZON_SECONDS * 1000, 1.2)], index: 0, brain: null, atMs: 61_000 });
    expect(settled.settled).toBe(1);
    const stats = engine.scoreboard("EURUSD:NORMAL").setups.find((row: any) => row.setup === "TREND_PULLBACK");
    expect(stats).toMatchObject({ trades: 1, wins: 1, losses: 0 });
    expect(stats.pnl).toBeGreaterThan(0);
    expect(engine.scoreboard("EURUSD:NORMAL").openShadow).toBe(0);
  });

  it("WAIT nao abre trade e e contabilizado como espera; NO_VALID_SETUP tambem e rastreado", () => {
    const engine = new SetupResearchEngine({ now: () => 0 }) as any;
    const candles = [candle(0, 1.1)];
    engine.observeCandle({ marketKey: "EURUSD:OTC", marketType: "OTC", candles, index: 0, brain: { setup: "RANGE_REVERSAL", action: "WAIT", regime: "RANGE", trigger: null }, payout: 80, atMs: 0 });
    engine.observeCandle({ marketKey: "EURUSD:OTC", marketType: "OTC", candles, index: 0, brain: { setup: "NO_VALID_SETUP", action: "WAIT", regime: "UNCLEAR", trigger: null }, payout: 80, atMs: 0 });
    const board = engine.scoreboard("EURUSD:OTC");
    expect(board.openShadow).toBe(0);
    expect(board.waits).toBe(2);
    expect(board.setups.find((row: any) => row.setup === "NO_VALID_SETUP").waits).toBe(1);
  });

  it("mercados NAO compartilham placar (NORMAL != OTC e A != B)", () => {
    const engine = new SetupResearchEngine({ now: () => 0 }) as any;
    engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [candle(0, 1.1)], index: 0, brain: { setup: "BREAKOUT_CONTINUATION", action: "BUY", regime: "EXPANSION", trigger: "rompimento" }, payout: 85, atMs: 0 });
    expect(engine.scoreboard("EURUSD:NORMAL").openShadow).toBe(1);
    expect(engine.scoreboard("EURUSD:OTC").openShadow).toBe(0);
    expect(engine.scoreboard("GBPUSD:NORMAL").openShadow).toBe(0);
    expect(SETUP_KEYS).not.toContain("V1-60");
    expect(SETUP_RESEARCH_VERSION).toBe("setup-research-engine-v2");
  });

  it("toJSON/loadFrom preserva placar e trades para restart", () => {
    const engine = new SetupResearchEngine({ now: () => 0 }) as any;
    engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [candle(0, 1.1)], index: 0, brain: { setup: "TREND_PULLBACK", action: "SELL", regime: "TREND_DOWN", trigger: "x" }, payout: 85, atMs: 0 });
    engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [candle(60_000, 1.0)], index: 0, brain: null, atMs: 61_000 });
    const snapshot = engine.toJSON();
    const reloaded = new SetupResearchEngine({ now: () => 0 }) as any;
    expect(reloaded.loadFrom(snapshot)).toBe(true);
    expect(reloaded.loadFrom(null)).toBe(false);
    const stats = reloaded.scoreboard("EURUSD:NORMAL").setups.find((row: any) => row.setup === "TREND_PULLBACK");
    expect(stats).toMatchObject({ trades: 1, wins: 1 });
    expect(reloaded.recentTrades("EURUSD:NORMAL", 10)).toHaveLength(1);
  });

  it("summarizeSetupStats calcula WR, PnL/trade, drawdown e streak", () => {
    const summary = summarizeSetupStats({ opportunities: 10, trades: 6, wins: 2, losses: 4, draws: 0, pnl: -2.2, payoutSum: 170 * 3, payoutCount: 3, losingStreak: 3, maxLosingStreak: 3, equity: -2.2, peak: 0.85, maxDrawdown: 3.05, lastResults: ["WIN", "LOSS", "LOSS", "LOSS", "WIN", "LOSS"], waits: 4, blocked: 1 }, { recentWindow: 4 });
    expect(summary.winRate).toBeCloseTo(0.3333, 3);
    expect(summary.pnlPerTrade).toBeCloseTo(-0.3667, 3);
    expect(summary.avgPayout).toBeCloseTo(170, 1);
    expect(summary.maxDrawdown).toBeCloseTo(3.05, 2);
    expect(summary.maxLosingStreak).toBe(3);
    expect(summary.recent).toMatchObject({ sample: 4, wins: 1, losses: 3 });
    expect(summary.waits).toBe(4);
  });
});

describe("A/B PROSPECTIVO v2 — arquiteturas A-D comparadas no mesmo snapshot causal", () => {
  it("registra 4 bracos (A_TRADER/B_TRADER_CRITIC/C_PLUS_INTELLIGENCE/D_APPRENTICE) e liquida causalmente", () => {
    const ab = new ABExperiment({ now: () => 0 }) as any;
    const record = ab.record({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", atMs: 0, setup: "TREND_PULLBACK", entryPrice: 1.1, settlementAfterMs: 60_000, payout: 85, actions: { A_TRADER: "BUY", B_TRADER_CRITIC: "SELL", C_PLUS_INTELLIGENCE: "WAIT", D_APPRENTICE: "BUY" } });
    expect(record.actions).toMatchObject({ A_TRADER: "BUY", B_TRADER_CRITIC: "SELL", C_PLUS_INTELLIGENCE: "WAIT", D_APPRENTICE: "BUY" });
    expect(ab.settle({ marketKey: "EURUSD:NORMAL", candles: [candle(30_000, 1.2)], index: 0 })).toBe(0);
    expect(ab.settle({ marketKey: "GBPUSD:NORMAL", candles: [candle(60_000, 1.2)], index: 0 })).toBe(0);
    expect(ab.settle({ marketKey: "EURUSD:NORMAL", candles: [candle(60_000, 1.2)], index: 0 })).toBe(1);
    const board = ab.scoreboard();
    expect(board.version).toBe("ab-experiment-v2");
    expect(board.arms.A_TRADER).toMatchObject({ trades: 1, wins: 1, noTrade: 0 });
    expect(board.arms.B_TRADER_CRITIC).toMatchObject({ trades: 1, losses: 1 });
    expect(board.arms.C_PLUS_INTELLIGENCE).toMatchObject({ trades: 0, noTrade: 1 });
    expect(board.arms.D_APPRENTICE).toMatchObject({ trades: 1, wins: 1 });
    // nao liquida duas vezes
    expect(ab.settle({ marketKey: "EURUSD:NORMAL", candles: [candle(120_000, 1.4)], index: 0 })).toBe(0);
    expect(board.totalRecords).toBe(1);
  });
});
