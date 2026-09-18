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

  it("0 OPEN → 0 trabalhando, 55 desks vazios e todos idle em áreas sociais", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "t0" });
    life.updateLife(sys, 16);
    expect(sys.stats.working).toBe(0);
    expect(sys.stats.atDesk).toBe(0);
    expect(sys.stats.desksEmpty).toBe(55);
    expect(sys.stats.idle).toBe(110);
    const states = life.getAgentStates(sys);
    for (const state of states) {
      expect(inAnyZone(sys.world, state.x, state.y), `${state.id} fora de área social`).toBe(true);
    }
  });

  it("setPresence reabre o posto e os agentes caminham de volta (sem teleporte)", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "reopen" });
    life.updateLife(sys, 16);
    const station = sys.world.stations[0];
    const stationId = station.id;
    const find = () => life.getAgentStates(sys).find((state: any) => state.stationId === stationId && state.role === "trader");
    const before = find();
    expect(before.atDesk).toBe(false);
    const startX = before.x;
    const startY = before.y;
    expect(life.setPresence(sys, stationId, true)).toBe(true);
    life.updateLife(sys, 16);
    const during = find();
    expect(during.traveling).toBe(true);
    expect(during.atDesk).toBe(false);
    expect(during.pathLength).toBeGreaterThan(1);
    expect(Math.hypot(during.x - startX, during.y - startY)).toBeLessThan(10);
    for (let index = 0; index < 6000; index += 1) life.updateLife(sys, 16);
    const after = find();
    expect(after.atDesk).toBe(true);
    expect(after.working).toBe(true);
    expect(after.traveling).toBe(false);
    expect(Math.hypot(after.x - after.home.x, after.y - after.home.y)).toBeLessThan(1);
  });

  it("occupancy nunca excede a capacidade real de sofá/sinuca", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "occ" });
    const spots = sys.world.spots;
    const occupancy = new life.LifeOccupancy(spots);
    for (const spot of spots) {
      for (let index = 0; index < 20; index += 1) occupancy.reserve(spot.id, `ghost-${spot.id}-${index}`);
    }
    for (const spot of spots) {
      expect(occupancy.occupancy(spot.id)).toBeLessThanOrEqual(spot.capacity);
    }
    const sofa = spots.find((spot: any) => spot.kind === "leisure");
    expect(occupancy.capacity(sofa.id)).toBe(3);
    expect(occupancy.occupancy(sofa.id)).toBe(3);
    expect(occupancy.reserve(sofa.id, "overflow")).toEqual({ ok: false, reason: "FULL" });
    expect(occupancy.release(sofa.id, `ghost-${sofa.id}-0`)).toBe(true);
    expect(occupancy.reserve(sofa.id, "late").ok).toBe(true);
    expect(occupancy.occupancy(sofa.id)).toBe(3);
    for (let index = 0; index < 200; index += 1) life.updateLife(sys, 16);
    for (const spot of spots) {
      const reserved = sys.agents.filter((agent: any) => agent.spotId === spot.id).length;
      expect(reserved).toBeLessThanOrEqual(spot.capacity);
    }
  });
});

describe("OFFICE V3 — life: pathfinding e determinismo", () => {
  it("cada passo do caminho é adjacente (grade 4-direções)", () => {
    const sys = life.createLifeSystem(makeWorld(0), { seed: "path" });
    life.updateLife(sys, 16);
    for (const station of sys.world.stations) life.setPresence(sys, station.id, true);
    let adjacentAll = true;
    let checked = 0;
    outer: for (let frame = 0; frame < 600; frame += 1) {
      life.updateLife(sys, 16);
      for (const agent of sys.agents) {
        if (agent.path.length < 2) continue;
        for (let index = 1; index < agent.path.length; index += 1) {
          const dx = Math.abs(agent.path[index].x - agent.path[index - 1].x);
          const dy = Math.abs(agent.path[index].y - agent.path[index - 1].y);
          const adjacent = (Math.abs(dx - TILE) < 1e-6 && dy < 1e-6) || (Math.abs(dy - TILE) < 1e-6 && dx < 1e-6);
          if (!adjacent) adjacentAll = false;
          checked += 1;
        }
        if (checked >= 5000) break outer;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(adjacentAll).toBe(true);
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
