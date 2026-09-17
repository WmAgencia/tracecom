/** Fase 5 — Strategy Manager: gatilho de 10 settlements, criterios conservadores, hysteresis e modos (PRACTICE/REAL). */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const managerModule = await import("../../relay/strategy-manager.mjs");
const { StrategyManager, MANAGER_DEFAULTS, wilsonLower } = managerModule as unknown as Record<string, any>;

function variantRow(overrides: Record<string, unknown> = {}) {
  const trades = Number(overrides.trades ?? 200);
  const wins = Number(overrides.wins ?? 120);
  const losses = Number(overrides.losses ?? 80);
  const pnl = Number(overrides.pnl ?? 20);
  const recentSample = Number(overrides.recentSample ?? 60);
  const recentPnlPerTrade = Number(overrides.recentPnlPerTrade ?? 0.12);
  return {
    variantId: overrides.variantId ?? "V3-60", trades, wins, losses, draws: 0,
    winRate: wins / Math.max(1, wins + losses), pnl, pnlPerTrade: Number((pnl / Math.max(1, trades)).toFixed(4)),
    avgPayout: Number(overrides.avgPayout ?? 85), maxDrawdown: Number(overrides.maxDrawdown ?? 2),
    losingStreak: 1, maxLosingStreak: 2,
    recent: { sample: recentSample, wins: 30, losses: 30, draws: 0, winRate: 0.5, pnlPerTrade: recentPnlPerTrade },
    opportunities: trades, signals: trades,
  };
}
const board = (champion: any, challengers: any[]) => ({ marketKey: "EURUSD:OTC", version: 7, variants: [champion, ...challengers], openShadow: 0, trades: 100 });

describe("STRATEGY MANAGER — revisao sem troca automatica por padrao", () => {
  it("10 settlements disparam REVIEW; isso NAO e promocao", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.ensureMarket("EURUSD:OTC", "V3-60");
    let trigger = false;
    for (let index = 0; index < 10; index += 1) trigger = manager.onSettlement("EURUSD:OTC", { result: index % 3 === 0 ? "LOSS" : "WIN", pnl: index % 3 === 0 ? -1 : 0.85 }).trigger;
    expect(trigger).toBe(true);
    expect(manager.status().markets.find((row: any) => row.marketKey === "EURUSD:OTC").championVariantId).toBe("V3-60");
  });
  it("amostra insuficiente -> KEEP (nunca troca por 10 trades)", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.ensureMarket("EURUSD:OTC", "V3-60");
    const outcome = manager.evaluate({ marketKey: "EURUSD:OTC", marketType: "OTC", board: board(variantRow({ variantId: "V3-60" }), [variantRow({ variantId: "V8-60", trades: 12, recentSample: 10, recentPnlPerTrade: 0.5 })]), challenger: variantRow({ variantId: "V8-60", trades: 12, recentSample: 10, recentPnlPerTrade: 0.5 }), mode: "AUTO_STRATEGY_SWITCH", practiceOnly: true });
    expect(outcome.review.decision).toBe("KEEP");
    expect(outcome.review.reason).toBe("AMOSTRA_INSUFICIENTE");
    expect(outcome.applied).toBe(false);
  });
  it("vantagem instavel -> KEEP (stability)", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.ensureMarket("EURUSD:OTC", "V3-60");
    const challenger = variantRow({ variantId: "V8-60", trades: 200, recentSample: 60, recentPnlPerTrade: 0.4, pnl: 4 });
    const outcome = manager.evaluate({ marketKey: "EURUSD:OTC", marketType: "OTC", board: board(variantRow({ variantId: "V3-60" }), [challenger]), challenger, mode: "AUTO_STRATEGY_SWITCH", practiceOnly: true });
    expect(outcome.review.decision).toBe("KEEP");
    expect(outcome.review.reason).toContain("CRITERIO_FALHOU");
  });
  it("vantagem consistente: SHADOW apenas recomenda (nao altera)", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.ensureMarket("EURUSD:OTC", "V3-60");
    const challenger = variantRow({ variantId: "V8-60", trades: 220, recentSample: 60, recentPnlPerTrade: 0.30, pnl: 53 });
    const outcome = manager.evaluate({ marketKey: "EURUSD:OTC", marketType: "OTC", board: board(variantRow({ variantId: "V3-60" }), [challenger]), challenger, mode: "SHADOW_RECOMMENDATION", practiceOnly: true });
    expect(outcome.review.decision).toBe("RECOMMEND_SWITCH");
    expect(outcome.applied).toBe(false);
    expect(manager.status().markets.find((row: any) => row.marketKey === "EURUSD:OTC").championVariantId).toBe("V3-60");
  });
  it("AUTO + PRACTICE troca uma vez e respeita cooldown (anti-flapping)", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.setConfig({ mode: "AUTO_STRATEGY_SWITCH", autoSwitchEnabled: true });
    manager.ensureMarket("EURUSD:OTC", "V3-60");
    const strong = variantRow({ variantId: "V8-60", trades: 220, recentSample: 60, recentPnlPerTrade: 0.30, pnl: 53 });
    const first = manager.evaluate({ marketKey: "EURUSD:OTC", marketType: "OTC", board: board(variantRow({ variantId: "V3-60" }), [strong]), challenger: strong, mode: "AUTO_STRATEGY_SWITCH", practiceOnly: true });
    expect(first.applied).toBe(true);
    expect(first.champion).toBe("V8-60");
    const second = manager.evaluate({ marketKey: "EURUSD:OTC", marketType: "OTC", board: board(variantRow({ variantId: "V8-60" }), [variantRow({ variantId: "V3-60", recentPnlPerTrade: 0.30, trades: 220, recentSample: 60, pnl: 53 })]), challenger: variantRow({ variantId: "V3-60", recentPnlPerTrade: 0.30, trades: 220, recentSample: 60, pnl: 53 }), mode: "AUTO_STRATEGY_SWITCH", practiceOnly: true });
    expect(second.review.decision).toBe("KEEP");
    expect(second.review.reason).toBe("CRITERIO_FALHOU:cooldown_settlements");
    expect(second.applied).toBe(false);
  });
  it("REAL/practiceOnly=false bloqueia troca mesmo em AUTO", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.setConfig({ mode: "AUTO_STRATEGY_SWITCH", autoSwitchEnabled: true });
    manager.ensureMarket("EURUSD:OTC", "V3-60");
    const strong = variantRow({ variantId: "V8-60", trades: 220, recentSample: 60, recentPnlPerTrade: 0.30, pnl: 53 });
    const outcome = manager.evaluate({ marketKey: "EURUSD:OTC", marketType: "OTC", board: board(variantRow({ variantId: "V3-60" }), [strong]), challenger: strong, mode: "AUTO_STRATEGY_SWITCH", practiceOnly: false });
    expect(outcome.applied).toBe(false);
    expect(outcome.review.decision).toBe("RECOMMEND_SWITCH");
  });
  it("configuracoes expostas e nao escondidas; defaults conservadores", () => {
    expect(MANAGER_DEFAULTS.mode).toBe("SHADOW_RECOMMENDATION");
    expect(MANAGER_DEFAULTS.autoSwitchEnabled).toBe(false);
    expect(MANAGER_DEFAULTS.reviewEverySettlements).toBe(10);
    expect(MANAGER_DEFAULTS.minTotalSamples).toBeGreaterThanOrEqual(60);
    expect(wilsonLower(6, 10)).toBeLessThan(0.6);
  });
  it("restart preserva champion e reviews (toJSON/loadFrom)", () => {
    const manager = new StrategyManager({ now: () => 1_000_000 }) as any;
    manager.ensureMarket("EURUSD:OTC", "V8-60");
    manager.onSettlement("EURUSD:OTC", { result: "WIN", pnl: 0.85 });
    const reloaded = new StrategyManager({ now: () => 1_000_000 }) as any;
    expect(reloaded.loadFrom(manager.toJSON())).toBe(true);
    expect(reloaded.status().markets.find((row: any) => row.marketKey === "EURUSD:OTC").championVariantId).toBe("V8-60");
    expect(reloaded.status().markets.find((row: any) => row.marketKey === "EURUSD:OTC").settlementsSinceReview).toBe(1);
  });
});
