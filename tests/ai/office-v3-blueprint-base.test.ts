/**
 * OFFICE V3 — HYBRID BLUEPRINT BASE tests (headless).
 *
 * Validates the hybrid renderer: the frozen reference is the pre-rendered
 * static base layer and TraceCom draws only the dynamic overlay on top,
 * aligned to the blueprint anchors.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders, no stake.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function loadCanvas() {
  const candidates = [
    "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas",
    "@napi-rs/canvas",
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("office-v3-blueprint-base.test: @napi-rs/canvas nao encontrado.");
}

const { createCanvas } = loadCanvas();

// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const baseModule = (await import("../../src/http/public/office-v3/blueprint-base.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const baseModeModule = (await import("../../src/http/public/office-v3/base-mode.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const overlayModule = (await import("../../src/http/public/office-v3/overlay.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const world = (await import("../../src/http/public/office-v3/world.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const life = (await import("../../src/http/public/office-v3/life.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const assets = (await import("../../src/http/public/office-v3/assets.js")) as Record<string, any>;
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const universeModule = (await import("../../relay/market-universe.mjs")) as Record<string, any>;

life.bindAssets(assets);
life.bindWorld(world);

const { BASE_WIDTH, BASE_HEIGHT, loadBlueprintBase, drawBlueprintBase } = baseModule;
const { resolveBaseMode, shouldDrawBlueprintBase } = baseModeModule;
const { STATION_ANCHORS, ANCHOR_COLUMNS, anchorForMarket, drawDynamicOverlay, drawClosedTreatment, drawHoverHighlight, closedLabel } = overlayModule;
const { buildWorldState } = world;
const { createLifeSystem, updateLife } = life;
const { UNIVERSE, marketKey } = universeModule;

const REFERENCE_PATH = fileURLToPath(new URL("../../docs/office-v2/screenshots/reference.png", import.meta.url));

function meanAbsDiff(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array) {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < a.length; index += 4) {
    sum += Math.abs(a[index]! - b[index]!) + Math.abs(a[index + 1]! - b[index + 1]!) + Math.abs(a[index + 2]! - b[index + 2]!);
    count += 3;
  }
  return count ? sum / count : 0;
}

function fixtureMarkets(openCount: number) {
  return Array.from({ length: 55 }, (_, index) => ({
    marketKey: `MK${index}:NORMAL`,
    canonical: `MK${index}`,
    symbol: `SYM/${index}`,
    display: `SYM/${index}`,
    marketType: "NORMAL",
    availability: index < openCount ? "OPEN" : "CLOSED",
    enabled: index < openCount,
    activeId: index < openCount ? `id-${index}` : null,
    payout: index < openCount ? 80 + (index % 10) : null,
    settlementState: index < openCount && index % 3 === 0 ? { lastResult: "WIN", lastProfit: 4 + index } : {},
  }));
}

function makeState(openCount: number) {
  const state = buildWorldState({ version: "test", at: 1_700_000_000_000, mode: "PRACTICE", markets: fixtureMarkets(openCount) });
  const system = createLifeSystem(state, { seed: `base-${openCount}` });
  updateLife(system, 16);
  return { state, system };
}

const loadedBase = await loadBlueprintBase();
const referenceImage = await loadBlueprintBase(REFERENCE_PATH);

describe("OFFICE V3 — resolveBaseMode", () => {
  it("usa 'reference' por padrão quando não há query nem env", () => {
    expect(resolveBaseMode("", {})).toBe("reference");
    expect(resolveBaseMode(undefined, undefined)).toBe("reference");
    expect(resolveBaseMode("?", {})).toBe("reference");
  });

  it("respeita o override por env OFFICE_V3_BASE", () => {
    expect(resolveBaseMode("", { OFFICE_V3_BASE: "procedural" })).toBe("procedural");
    expect(resolveBaseMode("", { OFFICE_V3_BASE: "REFERENCE" })).toBe("reference");
  });

  it("a query ?base= vence o env", () => {
    expect(resolveBaseMode("?base=procedural", { OFFICE_V3_BASE: "reference" })).toBe("procedural");
    expect(resolveBaseMode("?base=reference", { OFFICE_V3_BASE: "procedural" })).toBe("reference");
  });

  it("ignora valores inválidos e cai no padrão", () => {
    expect(resolveBaseMode("?base=banana", { OFFICE_V3_BASE: "nope" })).toBe("reference");
    expect(resolveBaseMode({ base: "xyz" }, {})).toBe("reference");
  });

  it("aceita URLSearchParams e objeto simples", () => {
    expect(resolveBaseMode(new URLSearchParams("base=procedural"), {})).toBe("procedural");
    expect(resolveBaseMode({ base: "procedural" }, {})).toBe("procedural");
  });

  it("shouldDrawBlueprintBase reflete o modo", () => {
    expect(shouldDrawBlueprintBase("reference")).toBe(true);
    expect(shouldDrawBlueprintBase(undefined)).toBe(true);
    expect(shouldDrawBlueprintBase("procedural")).toBe(false);
  });
});

describe("OFFICE V3 — blueprint base", () => {
  it("carrega o arquivo real em 1536x1024", () => {
    expect(loadedBase.width).toBe(BASE_WIDTH);
    expect(loadedBase.height).toBe(BASE_HEIGHT);
    expect(BASE_WIDTH).toBe(1536);
    expect(BASE_HEIGHT).toBe(1024);
  });

  it("drawBlueprintBase desenha os pixels da referência (mean abs diff < 5)", () => {
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    expect(drawBlueprintBase(ctx, loadedBase)).toBe(true);
    const rendered = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;

    const refCanvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const refCtx = refCanvas.getContext("2d");
    refCtx.drawImage(referenceImage, 0, 0);
    const reference = refCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;

    expect(meanAbsDiff(rendered, reference)).toBeLessThan(5);
  });

  it("drawBlueprintBase é tolerante a ctx/base ausente", () => {
    const canvas = createCanvas(8, 8);
    expect(drawBlueprintBase(null, loadedBase)).toBe(false);
    expect(drawBlueprintBase(canvas.getContext("2d"), null)).toBe(false);
  });
});

describe("OFFICE V3 — STATION_ANCHORS (blueprint)", () => {
  it("expõe 55 âncoras com geometria finita", () => {
    const anchors = Object.values(STATION_ANCHORS) as any[];
    expect(anchors).toHaveLength(55);
    for (const anchor of anchors) {
      expect(Number.isFinite(anchor.x)).toBe(true);
      expect(Number.isFinite(anchor.y)).toBe(true);
      expect(Number.isFinite(anchor.seatY)).toBe(true);
      expect(anchor.desk.w).toBe(100);
    }
    expect(ANCHOR_COLUMNS).toEqual([261, 374, 487, 600, 713, 826, 939, 1052, 1165, 1278]);
    expect(new Set(anchors.map((a) => a.y)).size).toBeGreaterThanOrEqual(5);
  });

  it("calibra as bandas divididas com dois setores independentes", () => {
    const { ANCHOR_BANDS } = overlayModule as any;
    expect(ANCHOR_BANDS.map((band: any) => band.y)).toEqual([392, 502, 616, 731, 839, 1072]);
    expect(ANCHOR_BANDS[2].sectors).toHaveLength(2);
    expect(ANCHOR_BANDS[3].sectors).toHaveLength(2);
    expect(STATION_ANCHORS["BTCUSD:OTC"].expanded).toBe(true);
    expect(STATION_ANCHORS["BTCUSD:OTC"].y).toBe(1072);
    expect(STATION_ANCHORS["EURUSD:NORMAL"].desk).toEqual({ x: 211, y: 392, w: 100, h: 52 });
  });

  it("existe âncora para todos os mercados do universo reconciliado", () => {
    for (const entry of UNIVERSE) {
      const key = marketKey(entry.canonical, entry.marketType);
      expect(STATION_ANCHORS[key], `sem âncora: ${key}`).toBeTruthy();
      expect(anchorForMarket({ marketKey: key })).toBe(STATION_ANCHORS[key]);
    }
  });

  it("resolve âncoras por display quando a marketKey difere", () => {
    expect(anchorForMarket({ display: "GOLD" })).toBe(STATION_ANCHORS["XAUUSD:NORMAL"]);
    expect(anchorForMarket({ display: "BTC/USD OTC" })).toBe(STATION_ANCHORS["BTCUSD:OTC"]);
    expect(anchorForMarket({ symbol: "EUR/USD" })).toBe(STATION_ANCHORS["EURUSD:NORMAL"]);
  });
});

describe("OFFICE V3 — drawDynamicOverlay", () => {
  it("desenha agentes somente para postos OPEN", () => {
    const { state, system } = makeState(10);
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    const calls: any[] = [];
    const stats = drawDynamicOverlay(ctx, state, null, null, {
      drawCharacter: (_ctx: any, _pose: any, _x: any, _y: any, options: any) => calls.push(options),
      drawSupervisor: false,
    });
    expect(stats.stations).toBe(55);
    expect(stats.open).toBe(10);
    expect(stats.closed).toBe(45);
    expect(stats.agents).toBe(20);
    expect(calls).toHaveLength(20);
    for (const options of calls) {
      const index = Number(String(options.id).replace("SYM/", "").replace(/:.*$/, ""));
      expect(index).toBeLessThan(10);
      expect(["trader", "critic"]).toContain(options.role);
    }
    void system;
  });

  it("postos fechados recebem tratamento (scrim + tag) sem agentes", () => {
    const { state } = makeState(0);
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#05090f";
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    const before = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data.slice();
    const stats = drawDynamicOverlay(ctx, state, null, null, { drawCharacter: () => {}, drawSupervisor: false });
    expect(stats.open).toBe(0);
    expect(stats.closed).toBe(55);
    expect(stats.agents).toBe(0);
    const after = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
    expect(meanAbsDiff(before, after)).toBeGreaterThan(0);
  });

  it("mapeia o rótulo do estado fechado", () => {
    expect(closedLabel("CLOSED")).toBe("FECHADO");
    expect(closedLabel("SUSPENDED")).toBe("SUSPENSO");
    expect(closedLabel("PAUSED")).toBe("SUSPENSO");
    expect(closedLabel("DISABLED")).toBe("INDISPONÍVEL");
    expect(closedLabel("NOT_FOUND")).toBe("INDISPONÍVEL");
    expect(closedLabel(null)).toBe("FECHADO");
  });

  it("drawClosedTreatment e drawHoverHighlight pintam a mesa", () => {
    const station = { id: "X", marketKey: "EURUSD:NORMAL", display: "EUR/USD", index: 0, availability: "CLOSED", active: false };
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#05090f";
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    const before = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data.slice();
    const treatment = drawClosedTreatment(ctx, station);
    expect(treatment?.label).toBe("FECHADO");
    const rect = drawHoverHighlight(ctx, station);
    expect(rect).toBeTruthy();
    const after = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
    expect(meanAbsDiff(before, after)).toBeGreaterThan(0);
  });

  it("hover é aplicado ao posto correspondente", () => {
    const { state } = makeState(0);
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    const stats = drawDynamicOverlay(ctx, state, null, null, {
      drawCharacter: () => {},
      drawSupervisor: false,
      hoverMarketKey: state.stations[0].marketKey,
    });
    expect(stats.hover).toBe(true);
  });
});

describe("OFFICE V3 — modo procedural ignora a base", () => {
  it("procedural não desenha a imagem base; reference desenha", () => {
    const emptyState = { stations: [] };

    const render = (mode: string) => {
      const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#05090f";
      ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
      if (shouldDrawBlueprintBase(mode)) drawBlueprintBase(ctx, loadedBase);
      drawDynamicOverlay(ctx, emptyState, null, null, { drawCharacter: () => {}, drawSupervisor: false });
      return ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
    };

    const refCanvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const refCtx = refCanvas.getContext("2d");
    refCtx.drawImage(referenceImage, 0, 0);
    const reference = refCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;

    const referenceDiff = meanAbsDiff(render("reference"), reference);
    const proceduralDiff = meanAbsDiff(render("procedural"), reference);
    expect(referenceDiff).toBeLessThan(5);
    expect(proceduralDiff).toBeGreaterThan(30);
  });
});
