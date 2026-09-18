/**
 * OFFICE V3 — PROCEDURAL CORE (default path) regressions.
 *
 * The hybrid image base + overlay/inpaint is REJECTED. The default renderer is
 * the procedural world (`world.js`): real snapshot → code-drawn top results
 * panel, desks, plaques and agents. These tests lock:
 *   - the default base mode is `procedural` (no image base, no blur);
 *   - `world.createAnchorResolver` is the single desk↔market source and agrees
 *     with `hitTestStation`;
 *   - the top panel model uses ONLY real settled data ("—" when absent) and
 *     never fabricates weekly/monthly/equity.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error - office-v3 ESM sem tipagem, importável sem DOM
const baseMode = (await import("../../src/http/public/office-v3/base-mode.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importável sem DOM
const world = (await import("../../src/http/public/office-v3/world.js")) as Record<string, any>;
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const universeModule = (await import("../../relay/market-universe.mjs")) as Record<string, any>;

const { resolveBaseMode, shouldDrawBlueprintBase } = baseMode;
const { buildWorldState, createAnchorResolver, anchorForStation, hitTestStation, dailyBoardModel, hitTestAnchor } = world;
const { UNIVERSE, marketKey } = universeModule;

function productionOffice() {
  const markets = UNIVERSE.map((entry: any, index: number) => ({
    marketKey: marketKey(entry.canonical, entry.marketType),
    canonical: entry.canonical,
    symbol: entry.symbol,
    display: entry.display,
    marketType: entry.marketType,
    availability: "OPEN",
    enabled: true,
    activeId: `id-${index}`,
    payout: 80,
    settlementState: {},
  }));
  return { version: "test", at: 1_700_000_000_000, mode: "PRACTICE", connection: { connected: true }, markets };
}

describe("OFFICE V3 — default renderer é procedural", () => {
  it("resolveBaseMode sem query/env é procedural e não desenha base", () => {
    expect(resolveBaseMode("", {})).toBe("procedural");
    expect(shouldDrawBlueprintBase(undefined)).toBe(false);
    expect(shouldDrawBlueprintBase("procedural")).toBe(false);
    // debug only
    expect(shouldDrawBlueprintBase("reference")).toBe(true);
    expect(shouldDrawBlueprintBase("original")).toBe(true);
  });
});

describe("OFFICE V3 — anchor resolver procedural (mesa ↔ marketKey)", () => {
  it("atribui uma âncora única por marketKey do universo reconciliado", () => {
    const state = buildWorldState(productionOffice());
    const resolver = createAnchorResolver(state.stations);
    const keys = state.stations.map((station: any, index: number) => resolver.anchorFor(station, index)?.marketKey ?? null);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(state.stations.length);
  });

  it("hit test e foco concordam com a âncora da mesma mesa", () => {
    const state = buildWorldState(productionOffice());
    const resolver = createAnchorResolver(state.stations);
    for (const station of state.stations) {
      const anchor = resolver.anchorFor(station, station.index);
      expect(anchor, `sem âncora: ${station.marketKey}`).toBeTruthy();
      const hit = hitTestStation(state, anchor.desk.x + anchor.desk.w / 2, anchor.desk.y + 4);
      expect(hit, `hit test errado para ${station.marketKey}`).toBe(station);
      expect(hitTestAnchor(state, anchor.desk.x + anchor.desk.w / 2, anchor.desk.y + 4)).toBe(station);
    }
  });

  it("anchorForStation resolve uma estação isolada", () => {
    const state = buildWorldState(productionOffice());
    const station = state.stations[3];
    const anchor = anchorForStation(station, station.index);
    expect(anchor.marketKey).toBe(station.marketKey);
    expect(anchor.desk.w).toBe(station.desk.w);
  });
});

describe("OFFICE V3 — painel superior (resultado do dia) é real", () => {
  it("usa apenas o P&L liquidado real e mostra — quando ausente", () => {
    const real = dailyBoardModel({
      portfolio: { settled: { wins: 10, losses: 4, draws: 1, pnl: 42.5, trades: 15 } },
    });
    expect(real.pnlText).toBe("+R$ 42,50");
    expect(real.wins).toBe(10);
    expect(real.losses).toBe(4);
    expect(real.winRateText).toBe("71.4%");
    // weekly/monthly do snapshot real do relay não existem → vazio explícito.
    expect(real.weeklyText).toBe("—");
    expect(real.monthlyText).toBe("—");

    const empty = dailyBoardModel({});
    expect(empty.pnlText).toBe("—");
    expect(empty.winRateText).toBe("—");
    expect(empty.weeklyText).toBe("—");
    expect(empty.monthlyText).toBe("—");
    expect(empty.equityPlaceholder).toBe(true);
  });

  it("nunca fabrica série de equity: usa a série real quando existe", () => {
    const withSeries = dailyBoardModel({
      portfolio: { settled: { wins: 1, losses: 1, pnl: 5, trades: 2 }, equityCurve: [{ value: 1 }, { value: 3 }, { value: 2 }] },
    });
    expect(withSeries.equitySeries).toEqual([1, 3, 2]);
    expect(withSeries.equityPlaceholder).toBe(false);
  });
});
