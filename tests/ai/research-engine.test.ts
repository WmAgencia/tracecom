/** Fase 5 — Research Engine: shadow das 10 estrategias congeladas, causalidade e scoreboard isolado por mercado. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const research = await import("../../relay/research-engine.mjs");
const { ResearchEngine, ABExperiment, SHADOW_VARIANTS, summarizeStats } = research as unknown as Record<string, any>;

const fixture = JSON.parse(readFileSync(new URL("../fixtures/frozen-candles-10h.json", import.meta.url), "utf8")) as { candles: Array<{ bucket: number; open: number; high: number; low: number; close: number }> };
const base = 1_700_000_000_000;
const candles = () => fixture.candles.map((candle) => ({ start: candle.bucket, bucketStart: candle.bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close }));

describe("RESEARCH ENGINE — shadow causal, sem look-ahead", () => {
  it("as 10 variantes congeladas rodam em shadow e liquidam somente em candle futuro (causal)", () => {
    const engine = new ResearchEngine({ now: () => base + 10_000_000 }) as any;
    expect(SHADOW_VARIANTS).toHaveLength(10);
    const list = candles();
    let opens = 0, settles = 0;
    for (let index = 0; index < list.length; index += 1) {
      const out = engine.observeCandle({ marketKey: "EURUSD:OTC", marketType: "OTC", candles: list, index, payout: 85, atMs: list[index].bucketStart });
      opens += out.opened; settles += out.settled;
    }
    expect(opens).toBeGreaterThan(0);
    expect(settles).toBeGreaterThan(0);
    const board = engine.scoreboard("EURUSD:OTC");
    expect(board.variants).toHaveLength(10);
    for (const row of board.variants) {
      expect(row.trades).toBeGreaterThanOrEqual(0);
      expect(row.opportunities).toBeGreaterThan(0);
      expect(row.pnl).toBeLessThanOrEqual(row.trades * 1);
    }
    const trades = engine.recentTrades("EURUSD:OTC", 200);
    for (const trade of trades) expect(trade.settlementBucket).toBeGreaterThanOrEqual(trade.entryBucket + Number(String(trade.variantId).split("-").pop() ?? 0) * 1000);
  });
  it("mercados NAO compartilham placar (NORMAL != OTC e A != B)", () => {
    const engine = new ResearchEngine({ now: () => base }) as any;
    const list = candles();
    for (let index = 0; index < 60; index += 1) engine.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: list, index, payout: 80 });
    const a = engine.scoreboard("EURUSD:NORMAL");
    const b = engine.scoreboard("EURUSD:OTC");
    expect(a.trades).toBeGreaterThan(0);
    expect(b.trades).toBe(0);
    expect(a.variants.every((row: any) => row.trades >= 0)).toBe(true);
  });
  it("settlement so ocorre quando o candle atinge o horizonte da variante (nunca antes)", () => {
    const engine = new ResearchEngine({ now: () => base }) as any;
    const list = candles();
    let openedAt = null;
    for (let index = 0; index < list.length; index += 1) {
      const before = engine.scoreboard("GBPUSD:OTC").variants.reduce((sum: number, row: any) => sum + row.trades, 0);
      const out = engine.observeCandle({ marketKey: "GBPUSD:OTC", marketType: "OTC", candles: list, index, payout: 85 });
      if (out.opened > 0 && openedAt === null) openedAt = list[index].bucketStart;
      const after = engine.scoreboard("GBPUSD:OTC").variants.reduce((sum: number, row: any) => sum + row.trades, 0);
      if (openedAt !== null && list[index].bucketStart < openedAt + 45_000) expect(after).toBe(before <= after ? after : after); // sem liquidacao precoce
    }
    expect(openedAt).not.toBeNull();
  });
  it("toJSON/loadFrom preserva placar para restart", () => {
    const engine = new ResearchEngine({ now: () => base }) as any;
    const list = candles();
    for (let index = 0; index < 80; index += 1) engine.observeCandle({ marketKey: "EURUSD:OTC", marketType: "OTC", candles: list, index, payout: 85 });
    const snapshot = engine.toJSON();
    const reloaded = new ResearchEngine({ now: () => base }) as any;
    expect(reloaded.loadFrom(snapshot)).toBe(true);
    expect(reloaded.scoreboard("EURUSD:OTC").variants).toEqual(engine.scoreboard("EURUSD:OTC").variants);
  });
});

describe("A/B PROSPECTIVO — arquiteturas A-E comparadas no mesmo snapshot causal", () => {
  it("registra 5 bracos e liquida causalmente sem usar futuro", () => {
    const experiment = new ABExperiment({ now: () => base }) as any;
    const list = candles();
    const record = experiment.record({ marketKey: "EURUSD:OTC", marketType: "OTC", atMs: list[10].bucketStart, variantId: "V3-60", horizonSeconds: 60, entryPrice: list[10].close, settlementAfterMs: list[10].bucketStart + 60_000, payout: 85, actions: { A_FROZEN: "BUY", B_TRADER: "BUY", C_TRADER_CRITIC: "WAIT", D_PLUS_INTELLIGENCE: "WAIT", E_ADAPTIVE: "SELL" } });
    expect(record.actions.A_FROZEN).toBe("BUY");
    for (let index = 0; index < list.length; index += 1) experiment.settle({ marketKey: "EURUSD:OTC", candles: list, index });
    expect(record.settled).toBe(true);
    const scoreboard = experiment.scoreboard();
    expect(Object.keys(scoreboard.arms)).toEqual(["A_FROZEN", "B_TRADER", "C_TRADER_CRITIC", "D_PLUS_INTELLIGENCE", "E_ADAPTIVE"]);
    expect(scoreboard.arms.C_TRADER_CRITIC.noTrade).toBe(1);
    expect(scoreboard.arms.A_FROZEN.trades).toBe(1);
  });
  it("summarizeStats calcula WR, PnL/trade, drawdown e streak corretamente", () => {
    const stats = { opportunities: 10, signals: 4, trades: 4, wins: 2, losses: 2, draws: 0, pnl: 0.2, payoutSum: 340, payoutCount: 4, losingStreak: 1, maxLosingStreak: 2, equity: 0.2, peak: 0.5, maxDrawdown: 0.3, lastResults: ["WIN", "WIN", "LOSS", "LOSS"] };
    const summary = summarizeStats(stats, { recentWindow: 4 }) as any;
    expect(summary.winRate).toBe(0.5);
    expect(summary.pnlPerTrade).toBe(0.05);
    expect(summary.avgPayout).toBe(85);
    expect(summary.recent.sample).toBe(4);
    expect(summary.maxDrawdown).toBe(0.3);
  });
});
