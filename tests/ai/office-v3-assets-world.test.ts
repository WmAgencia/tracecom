/**
 * PIXEL OFFICE V3 — ASSETS + WORLD contract tests.
 *
 * Imports the dependency-free ESM modules `src/http/public/office-v3/assets.js`
 * and `src/http/public/office-v3/world.js` and renders them with the real
 * @napi-rs/canvas prebuilt package. The modules never touch a DOM, so they are
 * importable in plain Node.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
  throw new Error("office-v3-assets-world.test: @napi-rs/canvas nao encontrado.");
}

const { createCanvas } = loadCanvas();

// @ts-expect-error - ESM visual module without declarations, importable without a DOM
const assets = (await import("../../src/http/public/office-v3/assets.js")) as Record<string, any>;
// @ts-expect-error - ESM visual module without declarations, importable without a DOM
const world = (await import("../../src/http/public/office-v3/world.js")) as Record<string, any>;

const {
  PALETTE_V3,
  SPRITE_NAMES,
  TILE_NAMES,
  CHARACTER_POSES,
  drawSprite,
  drawCharacter,
  drawTile,
} = assets;

const {
  BASE_WIDTH,
  BASE_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  STATION_LAYOUT,
  buildWorldState,
  drawWorld,
  hitTestStation,
  stationPlaque,
  dailyBoardModel,
  isMarketActive,
} = world;

const REQUIRED_SPRITES = [
  "wood_desk",
  "chair",
  "monitor",
  "computer_tower",
  "keyboard",
  "rug",
  "wall",
  "floor",
  "plant_small",
  "plant_large",
  "lamp",
  "wall_sconce",
  "ceiling_lamp",
  "sofa",
  "armchair",
  "coffee_table",
  "pool_table",
  "kitchen_counter",
  "fridge",
  "bookshelf",
  "whiteboard",
  "poster",
  "stairs",
  "divider",
  "water_cooler",
  "server_rack",
  "window",
];

const REQUIRED_POSES = ["idle", "walk", "sit", "work", "talk", "coffee", "pool", "observe"];

function fixtureMarkets(count = 55): any[] {
  return Array.from({ length: count }, (_, index) => ({
    marketKey: `MK${index}:NORMAL`,
    canonical: `MK${index}`,
    symbol: `SYM/${index}`,
    display: `SYM/${index}`,
    marketType: "NORMAL",
    availability: "OPEN",
    enabled: true,
    activeId: `id-${index}`,
    payout: 80 + (index % 10),
    positionState: { status: "IDLE" },
    settlementState: index % 3 === 0 ? { lastResult: "WIN", lastProfit: 5.5 + index } : {},
  }));
}

function fixtureOffice(overrides: Record<string, unknown> = {}): any {
  return {
    version: "iq-multi-runtime-v3",
    at: 1_700_000_000_000,
    connection: { connected: true },
    mode: "PRACTICE",
    activeCount: 10,
    activeLimit: 10,
    portfolio: {
      settled: { wins: 10, losses: 4, draws: 1, pnl: 42.5, trades: 15 },
      weekly: { pnl: 1842.3 },
      monthly: { pnl: 6721.55 },
      openPositions: [],
      equityCurve: [],
    },
    markets: fixtureMarkets(),
    ...overrides,
  };
}

function countDistinctColors(ctx: any, width: number, height: number, step = 2) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const seen = new Set<string>();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      seen.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    }
  }
  return seen.size;
}

describe("OFFICE V3 — contrato de assets", () => {
  it("expõe PALETTE_V3, SPRITE_NAMES, drawSprite, drawCharacter e drawTile", () => {
    expect(PALETTE_V3).toBeTypeOf("object");
    expect(Array.isArray(SPRITE_NAMES)).toBe(true);
    expect(SPRITE_NAMES.length).toBeGreaterThan(25);
    expect(drawSprite).toBeTypeOf("function");
    expect(drawCharacter).toBeTypeOf("function");
    expect(drawTile).toBeTypeOf("function");
    expect(PALETTE_V3.traderNavy).toBe("#1f3a6e");
    expect(PALETTE_V3.criticPurple).toBe("#6a3fb0");
  });

  it("inclui todos os sprites/tiles exigidos pelo contrato", () => {
    for (const name of REQUIRED_SPRITES) expect(SPRITE_NAMES, `sprite ausente: ${name}`).toContain(name);
    for (const name of ["floor_tiles", "floor_wood", "floor_carpet", "wall_panel", "wall_brick", "rug_red", "rug_blue", "rug_cream"]) {
      expect(TILE_NAMES, `tile ausente: ${name}`).toContain(name);
    }
  });

  it("desenha todos os sprites e tiles sem lançar num canvas real", () => {
    const canvas = createCanvas(320, 240);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (const name of SPRITE_NAMES) {
      expect(() => drawSprite(ctx, name, 8, 120, { w: 64, h: 44, seed: 2 }), name).not.toThrow();
    }
    for (const name of TILE_NAMES) {
      expect(() => drawTile(ctx, name, 0, 0, 48, 48, {}), name).not.toThrow();
    }
  });

  it("desenha as 8 poses com variação determinística", () => {
    const canvas = createCanvas(240, 160);
    const ctx = canvas.getContext("2d");
    expect(CHARACTER_POSES).toEqual(REQUIRED_POSES);
    for (const pose of REQUIRED_POSES) {
      expect(() => drawCharacter(ctx, pose, 80, 140, { seed: 7, role: "trader" }), pose).not.toThrow();
    }
    const a = drawCharacter(ctx, "idle", 40, 140, { seed: 42, role: "trader" });
    const b = drawCharacter(ctx, "idle", 80, 140, { seed: 42, role: "trader" });
    expect(b).toEqual(a);
    const specs = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const spec = drawCharacter(ctx, "idle", 40, 140, { seed, role: "trader" });
      specs.add(`${spec.skin}|${spec.hair}|${spec.shirt}`);
    }
    expect(specs.size).toBeGreaterThan(3);
  });

  it("trader veste azul-marinho e critic veste roxo", () => {
    const canvas = createCanvas(120, 120);
    const ctx = canvas.getContext("2d");
    const trader = drawCharacter(ctx, "work", 40, 100, { seed: 3, role: "trader" });
    const critic = drawCharacter(ctx, "work", 80, 100, { seed: 3, role: "critic" });
    expect(trader.shirt).toBe(PALETTE_V3.traderNavy);
    expect(critic.shirt).toBe(PALETTE_V3.criticPurple);
  });
});

describe("OFFICE V3 — layout e mundo", () => {
  it("expõe o artboard 1536x1024 e um mundo maior que o viewport", () => {
    expect(BASE_WIDTH).toBe(1536);
    expect(BASE_HEIGHT).toBe(1024);
    expect(WORLD_WIDTH).toBeGreaterThan(BASE_WIDTH);
    expect(WORLD_HEIGHT).toBeGreaterThan(BASE_HEIGHT);
    expect(WORLD_WIDTH).toBe(2560);
    expect(WORLD_HEIGHT).toBe(2048);
  });

  it("define 55 células e TODA célula tem uma mesa válida e sem sobreposição", () => {
    expect(STATION_LAYOUT.cells).toHaveLength(55);
    for (const cell of STATION_LAYOUT.cells) {
      expect(cell.desk, `célula ${cell.index}`).toBeTruthy();
      expect(cell.desk.w).toBeGreaterThan(0);
      expect(cell.desk.h).toBeGreaterThan(0);
      expect(cell.desk.x).toBe(cell.x);
    }
    const desks = STATION_LAYOUT.cells.map((cell: any) => cell.desk);
    for (let i = 0; i < desks.length; i += 1) {
      for (let j = i + 1; j < desks.length; j += 1) {
        const a = desks[i];
        const b = desks[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `mesas ${i} x ${j}`).toBe(false);
      }
    }
  });

  it("mantém as bandas macro de referência", () => {
    const ids = STATION_LAYOUT.bands.map((band: any) => band.id);
    expect(ids).toEqual([
      "TOP",
      "BAND_FOREX_MAJORS",
      "BAND_FOREX_CROSSES",
      "BAND_OTC_CRYPTO",
      "BAND_INDICES_COMMODITIES",
      "BAND_OTHER",
      "BOTTOM",
    ]);
    expect(STATION_LAYOUT.rows).toHaveLength(5);
    expect(STATION_LAYOUT.columns).toHaveLength(11);
  });

  it("gera 55 estações únicas a partir do office JSON de fixture", () => {
    const state = buildWorldState(fixtureOffice());
    expect(state.stations).toHaveLength(55);
    expect(new Set(state.stations.map((station: any) => station.marketKey)).size).toBe(55);
    expect(state.stations[0].marketKey).toBe("MK0:NORMAL");
    expect(state.stations[0].cell).toBe(STATION_LAYOUT.cells[0]);
  });

  it("preenche as células restantes como mesas reservadas (sem vazios)", () => {
    const state = buildWorldState({ markets: fixtureMarkets(15) });
    expect(state.stations).toHaveLength(15);
    expect(state.reserved).toHaveLength(40);
    expect(state.allStations).toHaveLength(55);
    expect(state.reserved.every((station: any) => station.active === false && station.agents.length === 0)).toBe(true);
  });

  it("mercado inativo (CLOSED/DISABLED/SUSPENDED/NOT_OFFERED/UNKNOWN) não tem agentes", () => {
    for (const availability of ["CLOSED", "DISABLED", "SUSPENDED", "NOT_OFFERED", "UNKNOWN", "NOT_FOUND"]) {
      expect(isMarketActive({ enabled: true, availability })).toBe(false);
      const markets = fixtureMarkets(55);
      markets[0] = { ...markets[0], availability, enabled: true };
      const state = buildWorldState({ markets });
      expect(state.stations[0].active, availability).toBe(false);
      expect(state.stations[0].agents).toHaveLength(0);
      expect(state.stations[0].trader).toBeNull();
      expect(state.stations[0].critic).toBeNull();
      expect(state.stations[0].badge.visible).toBe(false);
    }
    expect(isMarketActive({ enabled: true, availability: "OPEN" })).toBe(true);
    expect(isMarketActive({ enabled: false, availability: "OPEN" })).toBe(false);
  });

  it("grava o nome do ativo na placa entalhada (plaque model devolve o símbolo)", () => {
    const state = buildWorldState(fixtureOffice());
    const station = state.stations[0];
    expect(station.plaque.engraved).toBe(true);
    expect(station.plaque.text).toBe(station.display);
    expect(stationPlaque(station)).toBe(station.symbol);
    expect(stationPlaque({ plaque: { text: "EUR/USD" } })).toBe("EUR/USD");
  });

  it("hitTestStation encontra a mesa sob o ponto e devolve null fora do mundo", () => {
    const state = buildWorldState(fixtureOffice());
    const station = state.stations[0];
    const inside = hitTestStation(state, station.cell.centerX, station.cell.desk.y + 10);
    expect(inside).toBe(station);
    expect(hitTestStation(state, -500, -500)).toBeNull();
    expect(hitTestStation(state, WORLD_WIDTH + 100, WORLD_HEIGHT + 100)).toBeNull();
  });

  it("quadro do dia usa apenas dados liquidados reais e — quando ausente", () => {
    const model = dailyBoardModel(fixtureOffice());
    expect(model.pnlText).toBe("+R$ 42,50");
    expect(model.winRateText).toBe("71.4%");
    expect(model.weeklyText).toBe("+R$ 1.842,30");
    expect(model.monthlyText).toBe("+R$ 6.721,55");
    expect(model.total).toBe(55);
    expect(model.bestWinText.startsWith("+R$")).toBe(true);
    const empty = dailyBoardModel({});
    expect(empty.pnlText).toBe("—");
    expect(empty.winRateText).toBe("—");
    expect(empty.weeklyText).toBe("—");
    expect(empty.monthlyText).toBe("—");
    expect(empty.tone).toBe("EMPTY");
  });
});

describe("OFFICE V3 — render e guarda de DOM", () => {
  it("drawWorld roda headless e produz um canvas não-vazio (>50 cores)", () => {
    const state = buildWorldState(fixtureOffice());
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    expect(() => drawWorld(ctx, state, { x: 0, y: 0, zoom: 1 })).not.toThrow();
    expect(countDistinctColors(ctx, BASE_WIDTH, BASE_HEIGHT, 2)).toBeGreaterThan(50);
  });

  it("desenha mesas inativas sem agente e ativas com o duo", () => {
    const markets = fixtureMarkets(55);
    markets[0] = { ...markets[0], availability: "CLOSED", enabled: false };
    const state = buildWorldState({ markets });
    expect(state.stations[0].agents).toHaveLength(0);
    expect(state.stations[1].agents).toHaveLength(2);
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    expect(() => drawWorld(ctx, state, { x: 0, y: 0, zoom: 0.75 })).not.toThrow();
    expect(countDistinctColors(ctx, BASE_WIDTH, BASE_HEIGHT, 3)).toBeGreaterThan(50);
  });

  it("não referencia globais de DOM no momento do import", () => {
    expect(typeof (globalThis as any).document).toBe("undefined");
    expect(typeof (globalThis as any).window).toBe("undefined");
    const root = fileURLToPath(new URL("../../src/http/public/office-v3/", import.meta.url));
    for (const file of ["assets.js", "world.js"]) {
      const source = readFileSync(`${root}${file}`, "utf8");
      expect(/\b(document|window)\s*[.\[]/.test(source), `${file} referencia DOM`).toBe(false);
    }
  });
});
