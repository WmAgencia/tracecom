/**
 * OFFICE V3 — LIFE SYSTEM + CAMERA (headless, sem canvas).
 *
 * Valida presença OPEN/CLOSED, occupancy com capacidade real, pathfinding A*
 * (passos adjacentes + colisão), determinismo por seed, retorno aos desks sem
 * teleporte, câmera (pan/zoom/zoom-to-desk suave/hit-test) e ausência de
 * auto-FIT destrutivo.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - office-v3 life ESM sem tipagem, importável sem DOM
const lifeModule = await import("../../src/http/public/office-v3/life.js");
// @ts-expect-error - office-v3 camera ESM sem tipagem, importável sem DOM
const cameraModule = await import("../../src/http/public/office-v3/camera.js");

const life = lifeModule as unknown as Record<string, any>;
const camera = cameraModule as unknown as Record<string, any>;

const TILE = life.TILE;

function makeWorld(openCount: number, total = 55) {
  const markets = Array.from({ length: total }, (_, index) => ({
    marketKey: `ASSET${index}:NORMAL`,
    symbol: `ASSET${index}`,
    display: `ASSET ${index}`,
    availability: index < openCount ? "OPEN" : "CLOSED",
    enabled: true,
  }));
  return life.buildFallbackWorldState({ markets });
}

function inAnyZone(world: any, x: number, y: number) {
  return world.socialZones.some(
    (zone: any) => x >= zone.rect.x && x <= zone.rect.x + zone.rect.w && y >= zone.rect.y && y <= zone.rect.y + zone.rect.h,
  );
}

describe("OFFICE V3 — life: presença e occupancy", () => {
  it("55 OPEN → 110 agentes trabalhando nos desks", () => {
    const sys = life.createLifeSystem(makeWorld(55), { seed: "t55" });
    life.updateLife(sys, 16);
    expect(sys.stats.total).toBe(110);
    expect(sys.stats.working).toBe(110);
    expect(sys.stats.atDesk).toBe(110);
    expect(sys.stats.desksEmpty).toBe(0);
    const states = life.getAgentStates(sys);
    expect(states).toHaveLength(110);
    expect(states.every((state: any) => state.atDesk && state.working)).toBe(true);
    expect(new Set(states.map((state: any) => state.role))).toEqual(new Set(["trader", "critic"]));
  });

  it("37 OPEN → 74 trabalhando + 36 idle", () => {
    const sys = life.createLifeSystem(makeWorld(37), { seed: "t37" });
    life.updateLife(sys, 16);
    expect(sys.stats.working).toBe(74);
    expect(sys.stats.idle).toBe(36);
    expect(sys.stats.atDesk).toBe(74);
    expect(sys.stats.desksEmpty).toBe(18);
  });

  it("10 OPEN → 20 trabalhando + 90 idle", () => {
    const sys = life.createLifeSystem(makeWorld(10), { seed: "t10" });
    life.updateLife(sys, 16);
    expect(sys.stats.working).toBe(20);
    expect(sys.stats.idle).toBe(90);
    expect(sys.stats.atDesk).toBe(20);
    expect(sys.stats.desksEmpty).toBe(45);
  });

  it("0 OPEN → 0 trabalhando, 55 desks vazios e nenhum agente visível (oculto)", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "t0" });
    life.updateLife(sys, 16);
    expect(sys.stats.working).toBe(0);
    expect(sys.stats.atDesk).toBe(0);
    expect(sys.stats.desksEmpty).toBe(55);
    expect(sys.stats.idle).toBe(110);
    const states = life.getAgentStates(sys);
    for (const state of states) {
      expect(state.hidden).toBe(true);
      expect(state.location).toBe("hidden");
      expect(state.atDesk).toBe(false);
    }
  });

  it("setPresence reabre o posto e os agentes reaparecem no desk (sem social)", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "reopen" });
    life.updateLife(sys, 16);
    const station = sys.world.stations[0];
    const stationId = station.id;
    const find = () => life.getAgentStates(sys).find((state: any) => state.stationId === stationId && state.role === "trader");
    const before = find();
    expect(before.hidden).toBe(true);
    expect(life.setPresence(sys, stationId, true)).toBe(true);
    life.updateLife(sys, 16);
    const after = find();
    expect(after.atDesk).toBe(true);
    expect(after.working).toBe(true);
    expect(after.hidden).toBe(false);
    expect(after.traveling).toBe(false);
    expect(Math.hypot(after.x - after.home.x, after.y - after.home.y)).toBeLessThan(1);
  });

  it("sem áreas sociais não existem spots de occupancy", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "occ" });
    expect(sys.world.spots).toHaveLength(0);
    const occupancy = new life.LifeOccupancy(sys.world.spots);
    expect(occupancy.spots.size).toBe(0);
    expect(occupancy.reserve("spot:missing", "ghost")).toEqual({ ok: false, reason: "UNKNOWN_SPOT" });
    expect(sys.agents.every((agent: any) => agent.spotId === null)).toBe(true);
  });
});

describe("OFFICE V3 — life: pathfinding e determinismo", () => {
  it("findTilePath produz passos adjacentes (grade 4-direções)", () => {
    const sys = life.createLifeSystem(makeWorld(55), { seed: "path" });
    const grid = sys.world.grid;
    let start: any = null;
    let goal: any = null;
    for (let ty = 1; ty < grid.height - 1 && !goal; ty += 1) {
      for (let tx = 1; tx < grid.width - 1; tx += 1) {
        if (!grid.isWalkable(tx, ty)) continue;
        if (!start) { start = { x: tx, y: ty }; continue; }
        if (Math.abs(tx - start.x) + Math.abs(ty - start.y) > 6) { goal = { x: tx, y: ty }; break; }
      }
    }
    expect(Boolean(start && goal)).toBe(true);
    const path = life.findTilePath(grid, start, goal);
    expect(Array.isArray(path)).toBe(true);
    expect(path.length).toBeGreaterThan(1);
    for (let index = 1; index < path.length; index += 1) {
      const dx = Math.abs(path[index].x - path[index - 1].x);
      const dy = Math.abs(path[index].y - path[index - 1].y);
      expect(dx + dy).toBe(1);
    }
  });

  it("agente nunca termina dentro de um collider de mobília", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "collide" });
    life.updateLife(sys, 16);
    for (const station of sys.world.stations) life.setPresence(sys, station.id, true);
    let inside = 0;
    for (let frame = 0; frame < 800; frame += 1) {
      life.updateLife(sys, 16);
      for (const agent of sys.agents) {
        for (const collider of sys.world.colliders) {
          if (agent.x > collider.x && agent.x < collider.x + collider.w && agent.y > collider.y && agent.y < collider.y + collider.h) inside += 1;
        }
      }
    }
    expect(inside).toBe(0);
    for (const agent of sys.agents) {
      expect(sys.grid.isWalkable(Math.floor(agent.x / TILE), Math.floor(agent.y / TILE))).toBe(true);
    }
  });

  it("determinismo: mesma seed → mesmos estados após N updates", () => {
    const a = life.createLifeSystem(makeWorld(37), { seed: "det" });
    const b = life.createLifeSystem(makeWorld(37), { seed: "det" });
    for (let index = 0; index < 120; index += 1) {
      life.updateLife(a, 25);
      life.updateLife(b, 25);
    }
    expect(JSON.stringify(life.getAgentStates(a))).toBe(JSON.stringify(life.getAgentStates(b)));
  });

  it("getAgentStates e setPresence expõem o mapeamento de presença", () => {
    const sys = life.createLifeSystem(makeWorld(55), { seed: "map" });
    const states = life.getAgentStates(sys);
    expect(states.every((state: any) => state.state === "WORK" || state.state === "SIT")).toBe(true);
    const station = sys.world.stations[3];
    expect(life.setPresence(sys, station.id, false)).toBe(true);
    life.updateLife(sys, 16);
    const closed = life.getAgentStates(sys).filter((state: any) => state.stationId === station.id);
    expect(closed.every((state: any) => !state.working)).toBe(true);
    expect(life.setPresence(sys, "missing-station", true)).toBe(false);
  });

  it("supervisor patrulha, observa e continua sem teleporte", () => {
    const sys = life.createLifeSystem(makeWorld(10), { seed: "sup" });
    const start = life.getSupervisorState(sys);
    expect(start).toBeTruthy();
    let moved = false;
    let observed = false;
    for (let index = 0; index < 900; index += 1) {
      life.updateLife(sys, 16);
      const state = life.getSupervisorState(sys);
      if (Math.hypot(state.x - start.x, state.y - start.y) > 4) moved = true;
      if (state.stage === "OBSERVE") observed = true;
    }
    expect(moved).toBe(true);
    expect(observed).toBe(true);
  });
});

describe("OFFICE V3 — camera", () => {
  it("zoom é limitado entre min e max", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    for (let index = 0; index < 100; index += 1) camera.handleWheel(cam, { deltaY: -100, offsetX: 400, offsetY: 300 });
    expect(cam.zoom).toBeLessThanOrEqual(cam.maxZoom);
    for (let index = 0; index < 200; index += 1) camera.handleWheel(cam, { deltaY: 100, offsetX: 400, offsetY: 300 });
    expect(cam.zoom).toBeGreaterThanOrEqual(cam.minZoom);
    expect(cam.zoom).toBe(cam.minZoom);
  });

  it("screenToWorld/worldToScreen fazem round-trip com zoom e pan", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    camera.handleWheel(cam, { deltaY: -100, offsetX: 200, offsetY: 150 });
    camera.handleDragStart(cam, { clientX: 100, clientY: 100 });
    camera.handleDragMove(cam, { clientX: 140, clientY: 80 });
    camera.handleDragEnd(cam, {});
    for (const point of [{ x: 321, y: 654 }, { x: 0, y: 0 }, { x: 2000, y: 1500 }]) {
      const screen = camera.worldToScreen(cam, point.x, point.y);
      const world = camera.screenToWorld(cam, screen.x, screen.y);
      expect(world.x).toBeCloseTo(point.x, 6);
      expect(world.y).toBeCloseTo(point.y, 6);
    }
  });

  it("zoomToDesk anima suavemente (~400ms) e converge no desk", () => {
    const world = makeWorld(55);
    const cam = camera.createCamera({ width: 800, height: 600, worldState: world });
    const station = world.stations[0];
    const startZoom = cam.zoom;
    camera.zoomToDesk(cam, station);
    const targetZoom = cam.target.zoom;
    expect(cam.zoom).toBe(startZoom);
    camera.updateCamera(cam, 0);
    expect(cam.zoom).toBe(startZoom);
    camera.updateCamera(cam, 200);
    expect(cam.zoom).toBeGreaterThan(startZoom);
    expect(Math.abs(cam.zoom - targetZoom)).toBeGreaterThan(0.01);
    camera.updateCamera(cam, 200);
    expect(cam.target).toBeNull();
    expect(cam.zoom).toBeCloseTo(targetZoom, 6);
    const center = camera.screenToWorld(cam, 400, 300);
    expect(center.x).toBeCloseTo(station.x + station.w / 2, 4);
    expect(center.y).toBeCloseTo(station.y + station.h / 2, 4);
  });

  it("pan (drag) muda a origem e para ao soltar", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    const x0 = cam.x;
    const y0 = cam.y;
    camera.handleDragStart(cam, { clientX: 100, clientY: 100 });
    camera.handleDragMove(cam, { clientX: 60, clientY: 40 });
    expect(cam.x).not.toBe(x0);
    expect(cam.y).not.toBe(y0);
    camera.handleDragEnd(cam, {});
    expect(cam.dragging).toBe(false);
    const x1 = cam.x;
    camera.handleDragMove(cam, { clientX: 0, clientY: 0 });
    expect(cam.x).toBe(x1);
  });

  it("createCamera/resetCamera não fazem auto-FIT destrutivo", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.autoFit).toBe(false);
    camera.setWorldState(cam, makeWorld(55));
    expect(cam.zoom).toBe(1);
    cam.zoom = 2;
    cam.x = 100;
    cam.y = 50;
    camera.resetCamera(cam);
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it("handleClick/handleHover usam hitTestStation", () => {
    const world = makeWorld(55);
    const cam = camera.createCamera({ width: 800, height: 600, worldState: world });
    const station = world.stations[5];
    const screenX = station.x + station.w / 2;
    const screenY = station.y + station.h / 2;
    const clicked = camera.handleClick(cam, { clientX: screenX, clientY: screenY });
    expect(clicked).toBeTruthy();
    expect(clicked.marketKey).toBe(station.marketKey);
    expect(cam.clickedStationId).toBe(station.marketKey);
    const hovered = camera.handleHover(cam, { clientX: screenX, clientY: screenY });
    expect(hovered.marketKey).toBe(station.marketKey);
    expect(cam.hoverStationId).toBe(station.marketKey);
    const miss = camera.handleClick(cam, { clientX: 5, clientY: 5 });
    expect(miss).toBeNull();
  });

  it("applyCamera aplica a transformação de mundo para tela", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    cam.zoom = 2;
    cam.x = 30;
    cam.y = 40;
    const calls: any[] = [];
    const ctx = { setTransform: (...args: any[]) => calls.push(args) };
    camera.applyCamera(ctx, cam);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([2, 0, 0, 2, -60, -80]);
  });
});
