/**
 * OFFICE V3 — ANCHOR RESOLVER regressions (GHOST/DUPLICATE_AGENT +
 * WRONG_MARKET_PANEL + BASE_OVERLAY_DESYNC).
 *
 * `anchorForMarket` is a preference lookup. Before the resolver, unknown
 * marketKeys (offline demo fixture, future universe entries) fell back to an
 * index anchor and could collide with another station: two desks drew the same
 * agents and the hitbox opened another market's panel. These tests hold the
 * deterministic, collision-free assignment used by the overlay, the hitbox and
 * the page's zoom-to-desk.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error - office-v3 ESM sem tipagem, importável sem DOM
const overlay = (await import("../../src/http/public/office-v3/overlay.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importável sem DOM
const world = (await import("../../src/http/public/office-v3/world.js")) as Record<string, any>;
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const universeModule = (await import("../../relay/market-universe.mjs")) as Record<string, any>;

const { ANCHOR_MARKETS, STATION_ANCHORS, createAnchorResolver, anchorForMarket, hitTestAnchor, drawDynamicOverlay } = overlay;
const { UNIVERSE } = universeModule;

/** The reconciled production universe order (all keys are calibrated). */
function productionStations() {
  return UNIVERSE.map((entry: any, index: number) => ({
    index,
    marketKey: `${entry.canonical}:${entry.marketType}`,
    display: entry.display,
    symbol: entry.display,
    availability: "OPEN",
    enabled: true,
  }));
}

/** Legacy/offline demo list: several keys are absent from `ANCHOR_MARKETS`. */
function legacyDemoStations() {
  const symbols = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY", "AUD/JPY"];
  return symbols.map((display, index) => ({
    index,
    marketKey: `${display.replace(/[^A-Z0-9]/g, "")}:NORMAL`,
    display,
    symbol: display,
    availability: "OPEN",
    enabled: true,
  }));
}

describe("OFFICE V3 — anchor resolver", () => {
  it("não deixa duas estações usarem a mesma âncora (demo legado)", () => {
    const stations = legacyDemoStations();
    const resolver = createAnchorResolver(stations);
    const assigned = stations.map((station: any, index: number) => resolver.anchorFor(station, index));
    expect(assigned.every(Boolean)).toBe(true);
    const keys = assigned.map((anchor: any) => anchor.marketKey);
    expect(new Set(keys).size).toBe(stations.length);
    // The preferred anchor is kept whenever free (EUR/USD keeps its own desk).
    expect(assigned[0]).toBe(STATION_ANCHORS["EURUSD:NORMAL"]);
  });

  it("universo reconciliado continua 100% nas âncoras calibradas", () => {
    const stations = productionStations();
    const resolver = createAnchorResolver(stations);
    for (const station of stations) {
      expect(resolver.anchorFor(station, station.index)).toBe(STATION_ANCHORS[station.marketKey]);
      expect(anchorForMarket(station, station.index)).toBe(STATION_ANCHORS[station.marketKey]);
    }
    expect(stations).toHaveLength(54);
  });

  it("hitbox e desenho concordam após uma colisão de fallback", () => {
    const stations = legacyDemoStations();
    const worldState = { stations };
    const resolver = createAnchorResolver(stations);
    for (const station of stations) {
      const anchor = resolver.anchorFor(station, station.index);
      const centerX = anchor.desk.x + anchor.desk.w / 2;
      const centerY = anchor.desk.y + anchor.desk.h / 2;
      const hit = hitTestAnchor(worldState, centerX, centerY);
      expect(hit, `hitbox errada para ${station.marketKey}`).toBe(station);
    }
  });

  it("drawDynamicOverlay desenha cada estação na sua âncora atribuída (sem clone)", () => {
    const stations = legacyDemoStations();
    stations.forEach((station: any, index: number) => {
      station.derived = { agentsWorking: true, badge: { visible: false }, shortLabel: "OPERANDO", state: "WORKING" };
    });
    const worldState = { stations };
    const ctx = {
      save() {}, restore() {}, fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {},
      set font(_value: string) {}, set fillStyle(_value: string) {}, set strokeStyle(_value: string) {},
      set textAlign(_value: string) {}, set textBaseline(_value: string) {}, set lineWidth(_value: number) {},
    };
    const seen: string[] = [];
    const stats = drawDynamicOverlay(ctx, worldState, null, null, {
      drawSupervisor: false,
      drawCharacter: (_ctx: any, _pose: any, _x: any, _y: any, options: any) => { seen.push(String(options.id)); },
    });
    const resolver = createAnchorResolver(stations);
    expect(stats.agents).toBe(stations.length * 2);
    expect(seen).toHaveLength(stations.length * 2);
    expect(new Set(seen).size).toBe(stations.length * 2);
    for (const station of stations) {
      expect(seen).toContain(`${station.marketKey}:trader`);
      expect(seen).toContain(`${station.marketKey}:critic`);
      expect(resolver.anchorFor(station, station.index)).toBeTruthy();
    }
  });

  it("mundo procedural (world.js) também resolve âncoras únicas no demo legado", () => {
    const state = world.buildWorldState({ mode: "PRACTICE", markets: legacyDemoStations() });
    const resolver = createAnchorResolver(state.stations);
    const keys = state.stations.map((station: any, index: number) => resolver.anchorFor(station, index)?.marketKey ?? null);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(state.stations.length);
    // The two stations that used to collide must now sit on different desks.
    const nzd = state.stations.find((station: any) => station.marketKey === "NZDUSD:NORMAL");
    const eurjpy = state.stations.find((station: any) => station.marketKey === "EURJPY:NORMAL");
    const nzdAnchor = resolver.anchorFor(nzd, nzd.index);
    const eurjpyAnchor = resolver.anchorFor(eurjpy, eurjpy.index);
    expect(nzdAnchor.marketKey).not.toBe(eurjpyAnchor.marketKey);
  });

  it("ANCHOR_MARKETS não contém chaves duplicadas", () => {
    const keys = ANCHOR_MARKETS.map(([key]: [string, string]) => key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
