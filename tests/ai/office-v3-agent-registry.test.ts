/**
 * OFFICE V3 — AGENT REGISTRY (headless).
 *
 * Mandatory invariant: 1 market = 1 Trader + 1 Critic, single location per
 * agent, every agentId rendered exactly once per frame. The registry
 * `marketKey -> { traderAgentId, criticAgentId, currentLocation, state }` is
 * owned by `life.js` and exposed through `getAgentRegistry(life)`,
 * `setMarketPresence(life, marketKey, open)` and `getAgentLocations(life)`.
 *
 * Frontend/rendering only. PRACTICE only. ZERO orders.
 */
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - office-v3 life ESM sem tipagem, importável sem DOM
const lifeModule = await import("../../src/http/public/office-v3/life.js");
// @ts-expect-error - office-v3 world ESM sem tipagem, importável sem DOM
const worldModule = await import("../../src/http/public/office-v3/world.js");

const life = lifeModule as unknown as Record<string, any>;
const world = worldModule as unknown as Record<string, any>;

const TOTAL = 55;

function makeMarkets(openCount: number, total = TOTAL) {
  return Array.from({ length: total }, (_, index) => ({
    marketKey: `ASSET${index}:NORMAL`,
    canonical: `ASSET${index}`,
    symbol: `ASSET${index}`,
    display: `ASSET ${index}`,
    marketType: "NORMAL",
    activeId: `id-${index}`,
    availability: index < openCount ? "OPEN" : "CLOSED",
    enabled: true,
    payout: index < openCount ? 80 : null,
  }));
}

function makeFallback(openCount: number, total = TOTAL) {
  return life.buildFallbackWorldState({ markets: makeMarkets(openCount, total) });
}

function makeRealWorld(openCount: number, total = TOTAL) {
  return world.buildWorldState({ at: 1_700_000_000_000, mode: "PRACTICE", markets: makeMarkets(openCount, total) });
}

function agentById(system: any, id: string) {
  return system.agents.find((agent: any) => agent.id === id) ?? null;
}

function pairAgents(system: any, entry: any) {
  return [agentById(system, entry.traderAgentId), agentById(system, entry.criticAgentId)];
}

function zoneContains(worldState: any, x: number, y: number) {
  return (worldState.socialZones ?? []).some((zone: any) => {
    const rect = zone.rect ?? zone;
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  });
}

describe("OFFICE V3 — agent registry: exatamente 2 por mercado", () => {
  it("registry cobre todos os mercados com trader + critic distintos (55)", () => {
    const system = life.createLifeSystem(makeFallback(55), { seed: "r55", strict: true });
    const registry = life.getAgentRegistry(system);
    expect(Object.keys(registry)).toHaveLength(TOTAL);
    const allIds = new Set<string>();
    for (const entry of Object.values<any>(registry)) {
      expect(typeof entry.traderAgentId).toBe("string");
      expect(typeof entry.criticAgentId).toBe("string");
      expect(entry.traderAgentId).not.toBe(entry.criticAgentId);
      expect(entry.traderAgentId.startsWith("trader:")).toBe(true);
      expect(entry.criticAgentId.startsWith("critic:")).toBe(true);
      expect(["OPEN", "CLOSED"]).toContain(entry.state);
      expect(["desk", "social", "walking"]).toContain(entry.currentLocation);
      allIds.add(entry.traderAgentId);
      allIds.add(entry.criticAgentId);
    }
    expect(allIds.size).toBe(TOTAL * 2);
    const locations = life.getAgentLocations(system);
    expect(Object.keys(locations)).toHaveLength(TOTAL * 2);
    for (const id of allIds) expect(locations[id]).toBeTruthy();
  });

  it("vale para qualquer N (12 mercados → 12 pares, 24 agentes)", () => {
    const system = life.createLifeSystem(makeFallback(6, 12), { seed: "r12", strict: true });
    const registry = life.getAgentRegistry(system);
    expect(Object.keys(registry)).toHaveLength(12);
    expect(system.agents).toHaveLength(24);
    for (const entry of Object.values<any>(registry)) {
      expect(entry.traderAgentId).toBeTruthy();
      expect(entry.criticAgentId).toBeTruthy();
    }
  });

  it("registry real (world.js, 55 estações) usa marketKey como chave", () => {
    const state = makeRealWorld(55);
    const system = life.createLifeSystem(state, { seed: "real", strict: true });
    const registry = life.getAgentRegistry(system);
    const stationKeys = state.stations.map((station: any) => station.marketKey);
    expect(Object.keys(registry).sort()).toEqual([...stationKeys].sort());
    expect(system.agents).toHaveLength(TOTAL * 2);
    for (const key of stationKeys) {
      expect(registry[key].traderAgentId).toBe(`trader:${key}`);
      expect(registry[key].criticAgentId).toBe(`critic:${key}`);
    }
  });

  it("trader e critic de um mercado sentam em assentos diferentes (sem clone visual)", () => {
    const system = life.createLifeSystem(makeFallback(55), { seed: "seats", strict: true });
    const registry = life.getAgentRegistry(system);
    for (const entry of Object.values<any>(registry)) {
      const [trader, critic] = pairAgents(system, entry);
      expect(trader).toBeTruthy();
      expect(critic).toBeTruthy();
      expect(`${trader.home.x},${trader.home.y}`).not.toBe(`${critic.home.x},${critic.home.y}`);
    }
  });

  it("entrada de mercado duplicado é rejeitada em strict (nunca 2 agentes clonados)", () => {
    const markets = makeMarkets(2);
    markets[1]!.marketKey = markets[0]!.marketKey;
    const state = life.buildFallbackWorldState({ markets });
    expect(() => life.createLifeSystem(state, { seed: "dup", strict: true })).toThrow(/life-invariant/);
  });
});

describe("OFFICE V3 — agent registry: OPEN / CLOSED / reopen", () => {
  it("OPEN: os DOIS no desk, 0 em social, currentLocation desk", () => {
    const system = life.createLifeSystem(makeFallback(55), { seed: "open", strict: true });
    life.updateLife(system, 16);
    const registry = life.getAgentRegistry(system);
    const locations = life.getAgentLocations(system);
    for (const entry of Object.values<any>(registry)) {
      expect(entry.state).toBe("OPEN");
      expect(entry.currentLocation).toBe("desk");
      expect(entry.traderLocation).toBe("desk");
      expect(entry.criticLocation).toBe("desk");
      for (const agent of pairAgents(system, entry)) {
        expect(agent.atDesk).toBe(true);
        expect(agent.working).toBe(true);
        expect(agent.spotId).toBeNull();
        expect(locations[agent.id].location).toBe("desk");
        expect(locations[agent.id].working).toBe(true);
        expect(locations[agent.id].spotId).toBeNull();
      }
    }
  });

  it("CLOSED: 0 no desk e exatamente 2 em social por mercado", () => {
    const system = life.createLifeSystem(makeFallback(0), { seed: "closed", strict: true });
    life.updateLife(system, 16);
    const registry = life.getAgentRegistry(system);
    const locations = life.getAgentLocations(system);
    let social = 0;
    for (const entry of Object.values<any>(registry)) {
      expect(entry.state).toBe("CLOSED");
      expect(entry.currentLocation).toBe("social");
      const pair = pairAgents(system, entry);
      for (const agent of pair) {
        expect(agent.atDesk).toBe(false);
        expect(agent.working).toBe(false);
        expect(locations[agent.id].location).toBe("social");
        expect(locations[agent.id].zoneId).toBeTruthy();
        expect(zoneContains(system.world, agent.x, agent.y)).toBe(true);
        social += 1;
      }
    }
    expect(social).toBe(TOTAL * 2);
  });

  it("misto 37 OPEN / 18 CLOSED mantém a consistência por mercado", () => {
    const system = life.createLifeSystem(makeFallback(37), { seed: "mixed", strict: true });
    life.updateLife(system, 16);
    const registry = life.getAgentRegistry(system);
    let open = 0;
    let closed = 0;
    for (const entry of Object.values<any>(registry)) {
      const pair = pairAgents(system, entry);
      if (entry.state === "OPEN") {
        open += 1;
        expect(entry.currentLocation).toBe("desk");
        expect(pair.every((agent: any) => agent.atDesk && agent.working)).toBe(true);
      } else {
        closed += 1;
        expect(entry.currentLocation).toBe("social");
        expect(pair.every((agent: any) => !agent.atDesk && !agent.working)).toBe(true);
      }
    }
    expect(open).toBe(37);
    expect(closed).toBe(18);
  });

  it("reabrir faz os DOIS voltarem andando (sem teleporte) e chegarem ao desk", () => {
    const system = life.createLifeSystem(makeFallback(0), { seed: "reopen", strict: true });
    life.updateLife(system, 16);
    const key = "ASSET0:NORMAL";
    const before = pairAgents(system, life.getAgentRegistry(system)[key]);
    const start = before.map((agent: any) => ({ x: agent.x, y: agent.y }));
    expect(before.every((agent: any) => !agent.atDesk)).toBe(true);

    expect(life.setMarketPresence(system, key, true)).toBe(true);
    life.updateLife(system, 16);
    const during = pairAgents(system, life.getAgentRegistry(system)[key]);
    for (let index = 0; index < during.length; index += 1) {
      const agent = during[index];
      expect(agent.traveling).toBe(true);
      expect(agent.atDesk).toBe(false);
      expect(agent.path.length).toBeGreaterThan(1);
      const moved = Math.hypot(agent.x - start[index]!.x, agent.y - start[index]!.y);
      expect(moved).toBeLessThan(2);
    }

    for (let index = 0; index < 8000; index += 1) life.updateLife(system, 16);
    const after = pairAgents(system, life.getAgentRegistry(system)[key]);
    for (const agent of after) {
      expect(agent.atDesk).toBe(true);
      expect(agent.working).toBe(true);
      expect(agent.traveling).toBe(false);
      expect(Math.hypot(agent.x - agent.home.x, agent.y - agent.home.y)).toBeLessThan(1);
    }
  });

  it("fechar o mercado tira os DOIS do desk e os leva para social", () => {
    const system = life.createLifeSystem(makeFallback(55), { seed: "close", strict: true });
    life.updateLife(system, 16);
    const key = "ASSET7:NORMAL";
    const before = pairAgents(system, life.getAgentRegistry(system)[key]);
    expect(before.every((agent: any) => agent.atDesk && agent.working)).toBe(true);

    expect(life.setMarketPresence(system, key, false)).toBe(true);
    life.updateLife(system, 16);
    const during = pairAgents(system, life.getAgentRegistry(system)[key]);
    for (const agent of during) {
      expect(agent.atDesk).toBe(false);
      expect(agent.working).toBe(false);
      expect(agent.assignment).toBe("SOCIAL");
    }

    for (let index = 0; index < 6000; index += 1) life.updateLife(system, 16);
    const after = pairAgents(system, life.getAgentRegistry(system)[key]);
    for (const agent of after) {
      expect(agent.atDesk).toBe(false);
      expect(zoneContains(system.world, agent.x, agent.y)).toBe(true);
    }
  });

  it("setMarketPresence rejeita chave desconhecida e setPresence aceita marketKey", () => {
    const system = life.createLifeSystem(makeFallback(55), { seed: "presence", strict: true });
    expect(life.setMarketPresence(system, "NOPE:NORMAL", true)).toBe(false);
    expect(life.setMarketPresence(system, null, true)).toBe(false);
    const station = system.world.stations[2];
    expect(life.setPresence(system, station.marketKey, false)).toBe(true);
    life.updateLife(system, 16);
    expect(life.getAgentRegistry(system)[station.marketKey].state).toBe("CLOSED");
  });
});

describe("OFFICE V3 — agent registry: localização única e determinismo", () => {
  it("um agente nunca aparece em duas localizações no mesmo frame", () => {
    const system = life.createLifeSystem(makeFallback(25), { seed: "one", strict: true });
    let checkedFrames = 0;
    for (let frame = 0; frame < 400; frame += 1) {
      life.updateLife(system, 16);
      if (frame % 40 !== 0) continue;
      checkedFrames += 1;
      const owners = new Map<string, string>();
      for (const spot of system.occupancy.spots.values()) {
        for (const id of spot.reservations) {
          expect(owners.has(id), `${id} reservado em dois spots`).toBe(false);
          owners.set(id, spot.id);
        }
      }
      for (const [id, entry] of system.agentLocations as Map<string, any>) {
        if (entry.spotId) expect(owners.get(id)).toBe(entry.spotId);
        else expect(owners.has(id)).toBe(false);
        const exclusive = [entry.atDesk, entry.traveling, entry.location === "social"].filter(Boolean).length;
        expect(exclusive, `${id} em múltiplas localizações`).toBeLessThanOrEqual(1);
        if (entry.working) {
          expect(entry.location).toBe("desk");
          expect(entry.zoneId).toBeNull();
          expect(entry.spotId).toBeNull();
        }
      }
    }
    expect(checkedFrames).toBeGreaterThanOrEqual(10);
  });

  it("agente trabalhando nunca está em área social (desk/spot/walk exclusivos)", () => {
    const system = life.createLifeSystem(makeFallback(25), { seed: "work-social", strict: true });
    for (let frame = 0; frame < 300; frame += 1) {
      life.updateLife(system, 16);
      for (const entry of system.agentLocations.values() as Iterable<any>) {
        if (!entry.working) continue;
        expect(entry.location).toBe("desk");
        expect(entry.atDesk).toBe(true);
        expect(entry.traveling).toBe(false);
        expect(entry.spotId).toBeNull();
        expect(zoneContains(system.world, entry.x, entry.y)).toBe(false);
      }
    }
  });

  it("determinismo: mesma seed → registry e locations idênticos após N updates", () => {
    const a = life.createLifeSystem(makeFallback(37), { seed: "det-reg", strict: true });
    const b = life.createLifeSystem(makeFallback(37), { seed: "det-reg", strict: true });
    for (let index = 0; index < 240; index += 1) {
      life.updateLife(a, 16);
      life.updateLife(b, 16);
    }
    expect(JSON.stringify(life.getAgentRegistry(a))).toBe(JSON.stringify(life.getAgentRegistry(b)));
    expect(JSON.stringify(life.getAgentLocations(a))).toBe(JSON.stringify(life.getAgentLocations(b)));
  });

  it("validateLifeInvariants lança em strict e degrada com warn em produção", () => {
    const strictSystem = life.createLifeSystem(makeFallback(0), { seed: "inv-strict", strict: true });
    life.updateLife(strictSystem, 16);
    expect(life.validateLifeInvariants(strictSystem).ok).toBe(true);
    strictSystem.agents[0].atDesk = true;
    strictSystem.agents[0].working = true;
    expect(() => life.getAgentRegistry(strictSystem)).toThrow(/life-invariant/);

    const softSystem = life.createLifeSystem(makeFallback(0), { seed: "inv-soft", strict: false });
    life.updateLife(softSystem, 16);
    softSystem.agents[0].atDesk = true;
    softSystem.agents[0].working = true;
    const report = life.validateLifeInvariants(softSystem);
    expect(report.ok).toBe(false);
    expect(report.violations.some((violation: any) => violation.code === "DUAL_LOCATION_DESK_SPOT")).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => life.getAgentRegistry(softSystem)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("cada agentId é desenhado exatamente uma vez por frame (110 + supervisor)", () => {
    const system = life.createLifeSystem(makeFallback(55), { seed: "draw", strict: true });
    life.updateLife(system, 16);
    const drawnIds: string[] = [];
    life.bindAssets({
      drawCharacter: (_ctx: any, _pose: any, _x: any, _y: any, options: any) => {
        drawnIds.push(options?.id);
      },
    });
    try {
      const total = life.drawAgents({} as any, system, null);
      expect(total).toBe(TOTAL * 2 + 1);
      expect(system.lastDrawStats.duplicates).toBe(0);
      expect(system.lastDrawStats.unique).toBe(TOTAL * 2 + 1);
      expect(new Set(drawnIds).size).toBe(drawnIds.length);
      for (const agent of system.agents) {
        expect(drawnIds.filter((id) => id === agent.id)).toHaveLength(1);
      }
      expect(drawnIds.filter((id) => id === "supervisor")).toHaveLength(1);
    } finally {
      life.bindAssets(null);
    }
  });

  it("drawAgents lança em strict quando um agentId seria desenhado duas vezes", () => {
    const system = life.createLifeSystem(makeFallback(0), { seed: "clone", strict: true });
    life.updateLife(system, 16);
    life.bindAssets({ drawCharacter: () => {} });
    try {
      system.agents.push(system.agents[0]);
      expect(() => life.drawAgents({} as any, system, null)).toThrow(/DUPLICATE_AGENT_DRAW/);
    } finally {
      system.agents.pop();
      life.bindAssets(null);
    }
  });
});
