/**
 * OFFICE V3 — INTEGRATION SCENARIOS (headless).
 *
 * Binds the REAL `world.js` + `life.js` modules (no DOM) with a fixture office
 * snapshot and asserts the OPEN/CLOSED → agent-count contract, the reopen
 * behavior (agents walk back and arrive, no teleport), that every scenario
 * renders a non-blank canvas through `@napi-rs/canvas`, and that the page
 * module never issues an order (its single `fetch` is a GET to
 * `/api/iq/office`; there is no order/execute/stake endpoint).
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
  throw new Error("office-v3-scenarios.test: @napi-rs/canvas nao encontrado.");
}

const { createCanvas } = loadCanvas();

// @ts-expect-error - ESM visual module without declarations, importable without a DOM
const world = (await import("../../src/http/public/office-v3/world.js")) as Record<string, any>;
// @ts-expect-error - ESM visual module without declarations, importable without a DOM
const life = (await import("../../src/http/public/office-v3/life.js")) as Record<string, any>;
// @ts-expect-error - ESM visual module without declarations, importable without a DOM
const assets = (await import("../../src/http/public/office-v3/assets.js")) as Record<string, any>;

const { BASE_WIDTH, BASE_HEIGHT, buildWorldState, drawWorld } = world;
const { createLifeSystem, updateLife, getAgentStates, setPresence, drawAgents, bindAssets, bindWorld } = life;

bindAssets(assets);
bindWorld(world);

const PAGE_SOURCE_PATH = fileURLToPath(new URL("../../src/http/public/office-v3/office-v3.js", import.meta.url));
const PAGE_SOURCE = readFileSync(PAGE_SOURCE_PATH, "utf8");

const TOTAL_STATIONS = 55;
const AGENTS_PER_STATION = 2;
const TOTAL_AGENTS = TOTAL_STATIONS * AGENTS_PER_STATION;

function fixtureOffice(openCount: number, total = TOTAL_STATIONS) {
  const markets = Array.from({ length: total }, (_, index) => ({
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
  return { version: "office-v3-scenarios", at: 1_700_000_000_000, mode: "PRACTICE", markets };
}

function makeScenario(openCount: number, seed: string) {
  const state = buildWorldState(fixtureOffice(openCount));
  const system = createLifeSystem(state, { seed });
  updateLife(system, 16);
  return { state, system };
}

function countDistinctColors(ctx: any, width: number, height: number, step = 3) {
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

function renderScene(state: any, system: any) {
  const camera = { x: 0, y: 0, zoom: 1, viewport: { width: BASE_WIDTH, height: BASE_HEIGHT } };
  const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#05090f";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  drawWorld(ctx, state, camera, { agents: false });
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  const drawn = drawAgents(ctx, system, camera);
  ctx.restore();
  return { canvas, ctx, drawn };
}

function inAnyZone(worldState: any, x: number, y: number) {
  const zones = Array.isArray(worldState?.socialZones) ? worldState.socialZones : [];
  return zones.some((zone: any) => {
    const rect = zone?.rect ?? zone;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  });
}

describe("OFFICE V3 — cenários de presença (world.js + life.js)", () => {
  it("55 OPEN → 110 agentes trabalhando, 0 mesas vazias", () => {
    const { state, system } = makeScenario(55, "s55");
    expect(state.stations).toHaveLength(55);
    expect(system.stats.total).toBe(TOTAL_AGENTS);
    expect(system.stats.working).toBe(110);
    expect(system.stats.atDesk).toBe(110);
    expect(system.stats.desksEmpty).toBe(0);
    expect(system.stats.openStations).toBe(55);
  });

  it("37 OPEN → 74 trabalhando + 36 idle", () => {
    const { system } = makeScenario(37, "s37");
    expect(system.stats.working).toBe(74);
    expect(system.stats.idle).toBe(36);
    expect(system.stats.atDesk).toBe(74);
    expect(system.stats.desksEmpty).toBe(18);
    expect(system.stats.openStations).toBe(37);
    expect(system.stats.closedStations).toBe(18);
  });

  it("10 OPEN → 20 trabalhando + 90 idle", () => {
    const { system } = makeScenario(10, "s10");
    expect(system.stats.working).toBe(20);
    expect(system.stats.idle).toBe(90);
    expect(system.stats.atDesk).toBe(20);
    expect(system.stats.desksEmpty).toBe(45);
  });

  it("0 OPEN → 55 mesas vazias + 110 idle", () => {
    const { system } = makeScenario(0, "s0");
    expect(system.stats.working).toBe(0);
    expect(system.stats.atDesk).toBe(0);
    expect(system.stats.desksEmpty).toBe(55);
    expect(system.stats.idle).toBe(110);
    expect(system.stats.openStations).toBe(0);
  });

  it("0 OPEN → todos os 110 agentes ficam em áreas sociais", () => {
    const { system } = makeScenario(0, "s0-social");
    const states = getAgentStates(system);
    expect(states).toHaveLength(TOTAL_AGENTS);
    for (const state of states) {
      expect(state.working).toBe(false);
      expect(inAnyZone(system.world, state.x, state.y), `${state.id} fora de área social`).toBe(true);
    }
  });

  it("reabrir um posto faz os agentes voltarem andando e chegarem (sem teleporte)", () => {
    const { system } = makeScenario(0, "reopen");
    const station = system.world.stations[0];
    const find = () => getAgentStates(system).find((state: any) => state.stationId === station.id && state.role === "trader");
    const before = find();
    expect(before.atDesk).toBe(false);
    const startX = before.x;
    const startY = before.y;

    expect(setPresence(system, station.id, true)).toBe(true);
    updateLife(system, 16);
    const during = find();
    expect(during.traveling).toBe(true);
    expect(during.atDesk).toBe(false);
    expect(during.pathLength).toBeGreaterThan(1);
    expect(Math.hypot(during.x - startX, during.y - startY)).toBeLessThan(12);

    for (let index = 0; index < 8000; index += 1) updateLife(system, 16);
    const after = find();
    expect(after.atDesk).toBe(true);
    expect(after.working).toBe(true);
    expect(after.traveling).toBe(false);
    expect(Math.hypot(after.x - after.home.x, after.y - after.home.y)).toBeLessThan(1);
  });

  it("cada cenário renderiza um canvas não-vazio (mundo + agentes)", () => {
    for (const openCount of [55, 37, 10, 0]) {
      const { state, system } = makeScenario(openCount, `render-${openCount}`);
      const { ctx, drawn } = renderScene(state, system);
      expect(drawn, `agentes desenhados em ${openCount} OPEN`).toBeGreaterThan(0);
      expect(countDistinctColors(ctx, BASE_WIDTH, BASE_HEIGHT, 4), `${openCount} OPEN`).toBeGreaterThan(50);
    }
  });

  it("drawAgents devolve 110 agentes + 1 supervisor quando não há culling", () => {
    const { system } = makeScenario(55, "draw");
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    const all = drawAgents(ctx, system, null);
    expect(all).toBe(TOTAL_AGENTS + 1);
    const culled = drawAgents(ctx, system, { x: 0, y: 0, zoom: 1, viewport: { width: BASE_WIDTH, height: BASE_HEIGHT } });
    expect(culled).toBeGreaterThan(0);
    expect(culled).toBeLessThanOrEqual(TOTAL_AGENTS + 1);
  });
});

describe("OFFICE V3 — guarda de integração (somente leitura/render)", () => {
  it("o módulo da página faz exatamente um fetch, GET, para /api/iq/office", () => {
    const calls = [...PAGE_SOURCE.matchAll(/fetch\s*\(([^)]*)/g)].map((match) => match[1]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("POLL_URL");
    expect(PAGE_SOURCE).toContain('const POLL_URL = "/api/iq/office"');
    expect(PAGE_SOURCE).toContain('method: "GET"');
    expect(PAGE_SOURCE).not.toContain('method: "POST"');
  });

  it("não existe endpoint de ordem/execução/stake no módulo da página", () => {
    for (const forbidden of ["/api/iq/order", "/api/iq/execute", "/api/iq/stake", "/order", "/execute", "/stake", "placeOrder", "submitOrder", "sendOrder"]) {
      expect(PAGE_SOURCE.includes(forbidden), `endpoint proibido presente: ${forbidden}`).toBe(false);
    }
  });

  it("a página não importa nem referencia office-v2 (rollback intacto)", () => {
    expect(PAGE_SOURCE.includes("office-v2")).toBe(false);
  });

  it("a página importa todos os módulos V3 e usa buildWorldState + drawWorld", () => {
    for (const specifier of ["./assets.js", "./world.js", "./life.js", "./camera.js", "./dashboard.js", "./market-detail.js"]) {
      expect(PAGE_SOURCE.includes(specifier), `import ausente: ${specifier}`).toBe(true);
    }
    expect(PAGE_SOURCE.includes("buildWorldState")).toBe(true);
    expect(PAGE_SOURCE.includes("drawWorld")).toBe(true);
    expect(PAGE_SOURCE.includes("drawAgents")).toBe(true);
    expect(PAGE_SOURCE.includes("tracecom:market-select")).toBe(true);
  });
});
