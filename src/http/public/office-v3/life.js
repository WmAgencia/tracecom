/**
 * OFFICE V3 — LIFE SYSTEM (frontend/rendering only).
 *
 * Pure ESM module, no DOM required. Given a `worldState` (from `world.js` when
 * present, otherwise the local fallback stub) it spawns two agents per station
 * (trader + critic) plus one supervisor, walks them on a tile grid with A*,
 * respects furniture collision + seat capacity and keeps a deterministic,
 * seed-driven state machine.
 *
 * Frozen contract consumed (never redefined here):
 *   world.js : BASE_WIDTH, BASE_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT,
 *              STATION_LAYOUT, buildWorldState, drawWorld, hitTestStation
 *   assets.js: PALETTE_V3, drawSprite, drawCharacter, drawTile
 *
 * AGENT REGISTRY (single source of truth, exported hook):
 *   `marketKey -> { traderAgentId, criticAgentId, currentLocation, state }`
 *   built deterministically (seed) by `createLifeSystem`/`updateLife`, read by
 *   other modules through `getAgentRegistry(life)` / `getAgentLocations(life)`.
 *   Invariants (1 market = 1 trader + 1 critic, one location per agent, every
 *   agent id rendered exactly once per frame) are validated each update; they
 *   throw in strict/test mode and degrade to a single `console.warn` in prod.
 */

export const LIFE_VERSION = "office-v3-life.1.1.0";
export const TILE = 16;
export const AGENT_SPEED = 84;
export const SUPERVISOR_SPEED = 58;
export const DESK_WIDTH = 118;
export const DESK_HEIGHT = 72;
export const DESK_SEAT_LINE = 25;
export const DEFAULT_WORLD_WIDTH = 2560;
export const DEFAULT_WORLD_HEIGHT = 1600;
export const DEFAULT_SEED = "tracecom-office-v3";
export const SUPERVISOR_OBSERVE_MS = 900;

export const AGENT_REGISTRY_VERSION = "office-v3-agent-registry.1.0.0";
export const LOCATION_DESK = "desk";
export const LOCATION_SOCIAL = "social";
export const LOCATION_WALKING = "walking";
export const LOCATION_UNKNOWN = "unknown";

export const AGENT_ROLES = ["trader", "critic"];

export const POSE_BY_ACTIVITY = {
  desk_trader: "work",
  desk_critic: "sit",
  walk: "walk",
  idle: "idle",
  coffee: "coffee",
  pool: "pool",
  observe: "observe",
  talk: "talk",
  sit: "sit",
};

export const STATE_BY_ACTIVITY = {
  coffee: "COFFEE",
  kitchen: "COFFEE",
  pool: "POOL",
  research: "OBSERVE",
  leisure: "SIT",
  social: "TALK",
  idle: "IDLE",
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function normRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const source = rect.rect && typeof rect.rect === "object" ? rect.rect : rect;
  const x = Number(source.x);
  const y = Number(source.y);
  const w = Number(source.w ?? source.width);
  const h = Number(source.h ?? source.height);
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return null;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function rectContainsPoint(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function snapTileX(x) {
  return Math.floor(x / TILE) * TILE + TILE / 2;
}

function snapTileY(y) {
  return Math.floor(y / TILE) * TILE + TILE / 2;
}

function tileOf(x, y) {
  return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
}

/* ------------------------------------------------------------------ *
 * Agent registry helpers — one market = one trader + one critic.
 * ------------------------------------------------------------------ */

function marketKeyOfStation(station) {
  if (!station || typeof station !== "object") return null;
  const raw = station.marketKey ?? station.id ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
}

export function zoneAt(world, x, y) {
  if (!world || !Array.isArray(world.socialZones)) return null;
  for (const zone of world.socialZones) {
    const rect = zone?.rect ?? zone;
    if (!rect) continue;
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return zone;
  }
  return null;
}

function strictInvariants(life) {
  if (life && life.strict === true) return true;
  if (life && life.strict === false) return false;
  if (typeof globalThis !== "undefined" && globalThis.__OFFICE_V3_STRICT__ === true) return true;
  if (typeof process !== "undefined" && process && process.env && process.env.NODE_ENV === "test") return true;
  return false;
}

function reportInvariant(life, code, details) {
  const message = `[life-invariant:${code}] ${details}`;
  if (strictInvariants(life)) throw new Error(message);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    const warned = life && life.invariantWarnings instanceof Set ? life.invariantWarnings : null;
    if (warned && warned.has(code)) return false;
    if (warned) warned.add(code);
    console.warn(message);
  }
  return false;
}

/**
 * Single location per agent, by construction:
 *   atDesk  -> "desk"
 *   moving  -> "walking"
 *   settled -> "social" (inside a social zone / at a social spot)
 */
export function classifyAgentLocation(life, agent) {
  if (!agent) return { kind: LOCATION_UNKNOWN, zoneId: null, zoneKind: null, spotId: null, x: 0, y: 0 };
  if (agent.atDesk === true) {
    return { kind: LOCATION_DESK, zoneId: null, zoneKind: null, spotId: null, x: agent.x, y: agent.y };
  }
  if (agent.traveling === true) {
    return { kind: LOCATION_WALKING, zoneId: null, zoneKind: null, spotId: agent.spotId ?? null, x: agent.x, y: agent.y };
  }
  const zone = zoneAt(life?.world, agent.x, agent.y);
  return {
    kind: LOCATION_SOCIAL,
    zoneId: zone?.id ?? null,
    zoneKind: zone?.kind ?? agent.activityKind ?? null,
    spotId: agent.spotId ?? null,
    x: agent.x,
    y: agent.y,
  };
}

function aggregateLocation(traderLocation, criticLocation) {
  if (!traderLocation || !criticLocation) return LOCATION_UNKNOWN;
  if (traderLocation === criticLocation) return traderLocation;
  return LOCATION_WALKING;
}

function fallbackIdleTile(grid, loiterTiles, width, height) {
  if (Array.isArray(loiterTiles) && loiterTiles.length > 0) {
    const tile = loiterTiles[0];
    return { x: tile.x, y: tile.y, zoneId: tile.zoneId ?? null, kind: tile.kind ?? "idle" };
  }
  const centerX = Math.floor(width / TILE / 2);
  for (let ty = Math.floor(height / TILE) - 2; ty >= 1; ty -= 1) {
    for (let dx = 0; dx < centerX; dx += 1) {
      for (const tx of [centerX - dx, centerX + dx]) {
        if (grid.isWalkable(tx, ty)) return { x: tx, y: ty, zoneId: null, kind: "idle" };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Occupancy — seats have a real capacity, never oversold.
 * ------------------------------------------------------------------ */

export class LifeOccupancy {
  constructor(spots = []) {
    this.spots = new Map();
    for (const spot of spots) {
      if (!spot || !spot.id) continue;
      this.spots.set(spot.id, {
        id: spot.id,
        kind: spot.kind ?? "generic",
        capacity: Math.max(1, Math.floor(Number(spot.capacity) || 1)),
        reservations: [],
      });
    }
  }

  list(kind = null) {
    const values = [...this.spots.values()];
    return kind ? values.filter((spot) => spot.kind === kind) : values;
  }

  capacity(spotId) {
    return this.spots.get(spotId)?.capacity ?? 0;
  }

  occupancy(spotId) {
    return this.spots.get(spotId)?.reservations.length ?? 0;
  }

  available(spotId) {
    const spot = this.spots.get(spotId);
    if (!spot) return 0;
    return Math.max(0, spot.capacity - spot.reservations.length);
  }

  totalOccupied() {
    let total = 0;
    for (const spot of this.spots.values()) total += spot.reservations.length;
    return total;
  }

  reserve(spotId, agentId) {
    const spot = this.spots.get(spotId);
    if (!spot) return { ok: false, reason: "UNKNOWN_SPOT" };
    if (spot.reservations.includes(agentId)) return { ok: false, reason: "ALREADY_RESERVED" };
    if (spot.reservations.length >= spot.capacity) return { ok: false, reason: "FULL" };
    spot.reservations.push(agentId);
    return { ok: true, spotId, slot: spot.reservations.length - 1 };
  }

  release(spotId, agentId) {
    const spot = this.spots.get(spotId);
    if (!spot) return false;
    const before = spot.reservations.length;
    spot.reservations = spot.reservations.filter((id) => id !== agentId);
    return spot.reservations.length < before;
  }

  releaseAll(agentId) {
    let released = 0;
    for (const spot of this.spots.values()) released += this.release(spot.id, agentId) ? 1 : 0;
    return released;
  }

  spotOf(agentId) {
    for (const spot of this.spots.values()) if (spot.reservations.includes(agentId)) return spot.id;
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Walkability grid + A*
 * ------------------------------------------------------------------ */

export class LifeGrid {
  constructor(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.cells = new Uint8Array(this.width * this.height).fill(1);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x, y) {
    return y * this.width + x;
  }

  isWalkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    return this.cells[this.index(x, y)] === 1;
  }

  setWalkable(x, y, value) {
    if (!this.inBounds(x, y)) return;
    this.cells[this.index(x, y)] = value ? 1 : 0;
  }

  blockBorder(thickness = 1) {
    const t = Math.max(1, Math.floor(thickness));
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (x < t || y < t || x >= this.width - t || y >= this.height - t) this.setWalkable(x, y, false);
      }
    }
  }

  blockRectWorld(x, y, w, h) {
    const x0 = Math.max(0, Math.floor(x / TILE));
    const y0 = Math.max(0, Math.floor(y / TILE));
    const x1 = Math.min(this.width, Math.ceil((x + w) / TILE));
    const y1 = Math.min(this.height, Math.ceil((y + h) / TILE));
    for (let cy = y0; cy < y1; cy += 1) {
      for (let cx = x0; cx < x1; cx += 1) this.setWalkable(cx, cy, false);
    }
  }

  walkableCount() {
    let count = 0;
    for (let index = 0; index < this.cells.length; index += 1) if (this.cells[index] === 1) count += 1;
    return count;
  }
}

class LifeHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  less(a, b) {
    return a.f < b.f || (a.f === b.f && a.index < b.index);
  }

  push(item) {
    const heap = this.items;
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(heap[index], heap[parent])) break;
      const swap = heap[index];
      heap[index] = heap[parent];
      heap[parent] = swap;
      index = parent;
    }
  }

  pop() {
    const heap = this.items;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && this.less(heap[left], heap[smallest])) smallest = left;
        if (right < heap.length && this.less(heap[right], heap[smallest])) smallest = right;
        if (smallest === index) break;
        const swap = heap[index];
        heap[index] = heap[smallest];
        heap[smallest] = swap;
        index = smallest;
      }
    }
    return top;
  }
}

const ORTHO_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function findTilePath(grid, start, goal) {
  if (!grid || !start || !goal) return null;
  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);
  if (!grid.isWalkable(sx, sy) || !grid.isWalkable(gx, gy)) return null;
  if (sx === gx && sy === gy) return [{ x: sx, y: sy }];
  const width = grid.width;
  const total = width * grid.height;
  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new LifeHeap();
  const startIndex = grid.index(sx, sy);
  const goalIndex = grid.index(gx, gy);
  const heuristic = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  gScore[startIndex] = 0;
  open.push({ index: startIndex, f: heuristic(sx, sy) });
  while (open.size > 0) {
    const current = open.pop();
    const currentIndex = current.index;
    if (currentIndex === goalIndex) {
      const path = [];
      let cursor = currentIndex;
      while (cursor !== -1) {
        const cx = cursor % width;
        const cy = (cursor - cx) / width;
        path.push({ x: cx, y: cy });
        cursor = cameFrom[cursor];
      }
      path.reverse();
      return path;
    }
    if (closed[currentIndex]) continue;
    closed[currentIndex] = 1;
    const cx = currentIndex % width;
    const cy = (currentIndex - cx) / width;
    for (const [dx, dy] of ORTHO_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.isWalkable(nx, ny)) continue;
      const neighborIndex = grid.index(nx, ny);
      if (closed[neighborIndex]) continue;
      const tentative = gScore[currentIndex] + 1;
      if (tentative < gScore[neighborIndex] - 1e-9) {
        cameFrom[neighborIndex] = currentIndex;
        gScore[neighborIndex] = tentative;
        open.push({ index: neighborIndex, f: tentative + heuristic(nx, ny) });
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Fallback world stub (used when world.js is not available yet)
 * ------------------------------------------------------------------ */

function defaultMarkets(count = 55) {
  const list = [];
  for (let index = 0; index < count; index += 1) {
    const symbol = `ASSET${String(index + 1).padStart(2, "0")}`;
    list.push({
      marketKey: `${symbol}:NORMAL`,
      symbol,
      display: symbol,
      canonical: symbol,
      marketType: "NORMAL",
      activeId: `id:${symbol}`,
      availability: "OPEN",
      enabled: true,
      payout: 0.85,
    });
  }
  return list;
}

function deskRectOf(station) {
  const w = Number(station?.w) || DESK_WIDTH;
  const h = Number(station?.h) || DESK_HEIGHT;
  if (station?.desk) {
    const rect = normRect(station.desk);
    if (rect) return rect;
  }
  if (Number.isFinite(Number(station?.x)) && Number.isFinite(Number(station?.y))) {
    return { x: Number(station.x), y: Number(station.y), w, h };
  }
  return null;
}

function defaultSocialZones(width, height) {
  const bandTop = Math.round(height * 0.66);
  const bandHeight = Math.round(height * 0.24);
  const zoneWidth = Math.round(width / 5);
  const kinds = ["leisure", "pool", "kitchen", "social", "research"];
  const labels = ["ÁREA DE LAZER", "SINUCA", "CAFÉ", "SALA DE REUNIÃO", "PESQUISA"];
  return kinds.map((kind, index) => ({
    id: `zone:${kind}`,
    kind,
    label: labels[index],
    rect: { x: index * zoneWidth + 40, y: bandTop, w: zoneWidth - 80, h: bandHeight },
  }));
}

function defaultSpots(zones) {
  const spots = [];
  for (const zone of zones) {
    const capacity = zone.kind === "pool" ? 2 : zone.kind === "research" ? 1 : 3;
    const count = zone.kind === "pool" ? 2 : 3;
    for (let index = 0; index < count; index += 1) {
      spots.push({
        id: `spot:${zone.id}:${index + 1}`,
        kind: zone.kind,
        capacity,
        x: zone.rect.x + Math.round((zone.rect.w * (index + 1)) / (count + 1)),
        y: zone.rect.y + Math.round(zone.rect.h * 0.5),
        label: zone.label,
      });
    }
  }
  return spots;
}

export function buildFallbackWorldState(officeJson = null, options = {}) {
  const markets = Array.isArray(officeJson?.markets) && officeJson.markets.length
    ? officeJson.markets
    : defaultMarkets(Number(options.marketCount) || 55);
  const width = Number(options.worldWidth) || DEFAULT_WORLD_WIDTH;
  const height = Number(options.worldHeight) || DEFAULT_WORLD_HEIGHT;

  const columns = 10;
  const gapX = 128;
  const gapY = 100;
  const originX = 140;
  const originY = 320;
  const stations = markets.map((market, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = originX + column * gapX;
    const y = originY + row * gapY;
    const open = market?.enabled === false ? false : String(market?.availability ?? "OPEN").toUpperCase() === "OPEN";
    return {
      id: `station:${market?.marketKey ?? index}`,
      marketKey: market?.marketKey ?? `ASSET${index}:NORMAL`,
      symbol: market?.symbol ?? market?.display ?? `ASSET${index}`,
      activeId: market?.activeId ?? null,
      availability: market?.availability ?? "OPEN",
      payout: Number(market?.payout) || 0,
      enabled: market?.enabled !== false,
      isOpen: open,
      x,
      y,
      w: DESK_WIDTH,
      h: DESK_HEIGHT,
      desk: { x, y, w: DESK_WIDTH, h: DESK_HEIGHT },
      seats: [
        { x: snapTileX(x + DESK_WIDTH * 0.34), y: snapTileY(y + DESK_HEIGHT + TILE) },
        { x: snapTileX(x + DESK_WIDTH * 0.66), y: snapTileY(y + DESK_HEIGHT + TILE) },
      ],
    };
  });

  const colliders = stations.map((station) => ({ kind: "desk", rect: { ...station.desk }, stationId: station.id }));

  const socialZones = [
    { id: "zone:lounge", kind: "leisure", label: "ÁREA DE LAZER", rect: { x: 80, y: 1040, w: 560, h: 360 } },
    { id: "zone:pool", kind: "pool", label: "SINUCA", rect: { x: 680, y: 1040, w: 400, h: 360 } },
    { id: "zone:cafe", kind: "kitchen", label: "CAFÉ", rect: { x: 1120, y: 1040, w: 440, h: 360 } },
    { id: "zone:meeting", kind: "social", label: "SALA DE REUNIÃO", rect: { x: 1600, y: 1040, w: 420, h: 360 } },
    { id: "zone:research", kind: "research", label: "PESQUISA", rect: { x: 80, y: 1440, w: 900, h: 120 } },
  ];

  const furniture = [
    { kind: "sofa", rect: { x: 140, y: 1072, w: 96, h: 24 }, zoneId: "zone:lounge" },
    { kind: "sofa", rect: { x: 300, y: 1072, w: 96, h: 24 }, zoneId: "zone:lounge" },
    { kind: "sofa", rect: { x: 460, y: 1072, w: 96, h: 24 }, zoneId: "zone:lounge" },
    { kind: "coffeeTable", rect: { x: 240, y: 1160, w: 120, h: 40 }, zoneId: "zone:lounge" },
    { kind: "poolTable", rect: { x: 760, y: 1120, w: 180, h: 90 }, zoneId: "zone:pool" },
    { kind: "counter", rect: { x: 1160, y: 1080, w: 240, h: 24 }, zoneId: "zone:cafe" },
    { kind: "table", rect: { x: 1700, y: 1120, w: 220, h: 60 }, zoneId: "zone:meeting" },
    { kind: "table", rect: { x: 160, y: 1480, w: 160, h: 32 }, zoneId: "zone:research" },
    { kind: "table", rect: { x: 400, y: 1480, w: 160, h: 32 }, zoneId: "zone:research" },
    { kind: "table", rect: { x: 640, y: 1480, w: 160, h: 32 }, zoneId: "zone:research" },
  ];
  for (const item of furniture) colliders.push({ kind: item.kind, rect: item.rect, zoneId: item.zoneId });

  const spots = [
    { id: "spot:lounge:1", kind: "leisure", capacity: 3, x: 188, y: 1140, label: "Sofá" },
    { id: "spot:lounge:2", kind: "leisure", capacity: 3, x: 348, y: 1140, label: "Sofá" },
    { id: "spot:lounge:3", kind: "leisure", capacity: 3, x: 508, y: 1140, label: "Sofá" },
    { id: "spot:pool:1", kind: "pool", capacity: 2, x: 800, y: 1280, label: "Sinuca" },
    { id: "spot:pool:2", kind: "pool", capacity: 2, x: 920, y: 1280, label: "Sinuca" },
    { id: "spot:cafe:1", kind: "coffee", capacity: 1, x: 1200, y: 1160, label: "Café" },
    { id: "spot:cafe:2", kind: "coffee", capacity: 1, x: 1290, y: 1160, label: "Café" },
    { id: "spot:cafe:3", kind: "coffee", capacity: 1, x: 1380, y: 1160, label: "Café" },
    { id: "spot:meeting:1", kind: "social", capacity: 1, x: 1740, y: 1240, label: "Mesa" },
    { id: "spot:meeting:2", kind: "social", capacity: 1, x: 1820, y: 1240, label: "Mesa" },
    { id: "spot:meeting:3", kind: "social", capacity: 1, x: 1900, y: 1240, label: "Mesa" },
    { id: "spot:meeting:4", kind: "social", capacity: 1, x: 1980, y: 1240, label: "Mesa" },
    { id: "spot:research:1", kind: "research", capacity: 1, x: 240, y: 1540, label: "Estudo" },
    { id: "spot:research:2", kind: "research", capacity: 1, x: 480, y: 1540, label: "Estudo" },
    { id: "spot:research:3", kind: "research", capacity: 1, x: 720, y: 1540, label: "Estudo" },
  ];

  const patrol = [];
  const rows = Math.ceil(stations.length / columns);
  for (let row = 0; row < rows; row += 1) {
    patrol.push({ x: snapTileX(originX + gapX * 3), y: snapTileY(originY + row * gapY + DESK_HEIGHT + TILE) });
    patrol.push({ x: snapTileX(originX + gapX * 7), y: snapTileY(originY + row * gapY + DESK_HEIGHT + TILE) });
  }

  return {
    version: LIFE_VERSION,
    worldWidth: width,
    worldHeight: height,
    stations,
    colliders,
    socialZones,
    spots,
    patrol,
    markets,
  };
}

/* ------------------------------------------------------------------ *
 * World normalization
 * ------------------------------------------------------------------ */

function nearestWalkableTile(grid, tx, ty) {
  if (grid.isWalkable(tx, ty)) return { x: tx, y: ty };
  for (let radius = 1; radius <= 8; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (grid.isWalkable(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

function normalizeWorldState(worldState, options) {
  const fallback = worldState && typeof worldState === "object" ? worldState : buildFallbackWorldState(options?.office ?? null, options);
  const width = Number(fallback.worldWidth ?? fallback.width) || DEFAULT_WORLD_WIDTH;
  const height = Number(fallback.worldHeight ?? fallback.height) || DEFAULT_WORLD_HEIGHT;
  const stations = Array.isArray(fallback.stations) ? fallback.stations.slice() : [];

  const colliders = [];
  const seen = new Set();
  const pushCollider = (rect, kind, extra = {}) => {
    const normalized = normRect(rect);
    if (!normalized) return;
    const key = `${normalized.x}|${normalized.y}|${normalized.w}|${normalized.h}|${kind ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    colliders.push({ ...normalized, kind: kind ?? "furniture", ...extra });
  };
  if (Array.isArray(fallback.colliders)) for (const item of fallback.colliders) pushCollider(item?.rect ?? item, item?.kind);
  if (Array.isArray(fallback.obstacles)) for (const item of fallback.obstacles) pushCollider(item?.rect ?? item, item?.kind);
  for (const station of stations) {
    const desk = deskRectOf(station);
    if (desk) pushCollider(desk, "desk", { stationId: station.id });
  }

  const grid = new LifeGrid(Math.ceil(width / TILE), Math.ceil(height / TILE));
  grid.blockBorder(1);
  for (const collider of colliders) grid.blockRectWorld(collider.x, collider.y, collider.w, collider.h);

  const zones = Array.isArray(fallback.socialZones) && fallback.socialZones.length
    ? fallback.socialZones
    : defaultSocialZones(width, height);
  const socialZones = zones
    .map((zone) => {
      const rect = normRect(zone?.rect ?? zone);
      if (!rect) return null;
      return { id: zone?.id ?? `zone:${zone?.kind ?? "social"}`, kind: zone?.kind ?? "social", label: zone?.label ?? "Social", rect };
    })
    .filter(Boolean);

  const rawSpots = Array.isArray(fallback.spots) && fallback.spots.length ? fallback.spots : defaultSpots(socialZones);
  const spots = [];
  for (const spot of rawSpots) {
    if (!spot || !spot.id) continue;
    const x = Number(spot.x);
    const y = Number(spot.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const tile = nearestWalkableTile(grid, Math.floor(x / TILE), Math.floor(y / TILE));
    if (!tile) continue;
    spots.push({
      id: String(spot.id),
      kind: String(spot.kind ?? "social"),
      capacity: Math.max(1, Math.floor(Number(spot.capacity) || 1)),
      label: String(spot.label ?? spot.kind ?? spot.id),
      x: tile.x * TILE + TILE / 2,
      y: tile.y * TILE + TILE / 2,
      tx: tile.x,
      ty: tile.y,
    });
  }

  const loiterTiles = [];
  for (const zone of socialZones) {
    const x0 = Math.max(0, Math.floor(zone.rect.x / TILE));
    const y0 = Math.max(0, Math.floor(zone.rect.y / TILE));
    const x1 = Math.min(grid.width - 1, Math.floor((zone.rect.x + zone.rect.w) / TILE));
    const y1 = Math.min(grid.height - 1, Math.floor((zone.rect.y + zone.rect.h) / TILE));
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        if (!grid.isWalkable(tx, ty)) continue;
        const centerX = tx * TILE + TILE / 2;
        const centerY = ty * TILE + TILE / 2;
        if (centerX < zone.rect.x || centerX > zone.rect.x + zone.rect.w) continue;
        if (centerY < zone.rect.y || centerY > zone.rect.y + zone.rect.h) continue;
        loiterTiles.push({ x: tx, y: ty, zoneId: zone.id, kind: zone.kind });
      }
    }
  }

  const patrol = (Array.isArray(fallback.patrol) && fallback.patrol.length ? fallback.patrol : [])
    .map((point) => {
      const tile = nearestWalkableTile(grid, Math.floor(Number(point.x) / TILE), Math.floor(Number(point.y) / TILE));
      return tile ? { x: tile.x, y: tile.y } : null;
    })
    .filter(Boolean);

  const idleFallback = fallbackIdleTile(grid, loiterTiles, width, height);

  return { width, height, grid, stations, colliders, socialZones, spots, loiterTiles, patrol, idleFallback, raw: fallback };
}

/* ------------------------------------------------------------------ *
 * Agents
 * ------------------------------------------------------------------ */

function isStationOpen(station) {
  if (!station || typeof station !== "object") return false;
  if (typeof station.isOpen === "boolean") return station.isOpen;
  if (station.enabled === false) return false;
  const availability = String(station.availability ?? "").toUpperCase();
  if (availability === "OPEN") return true;
  if (availability) return false;
  return station.enabled !== false;
}

function stationKey(station) {
  return station?.id ?? station?.marketKey ?? null;
}

function seatFor(station, seatIndex, grid) {
  const explicit = Array.isArray(station?.seats) ? station.seats[seatIndex] : null;
  let x;
  let y;
  if (explicit && Number.isFinite(Number(explicit.x)) && Number.isFinite(Number(explicit.y))) {
    x = Number(explicit.x);
    y = Number(explicit.y);
  } else {
    const desk = deskRectOf(station) ?? { x: 0, y: 0, w: DESK_WIDTH, h: DESK_HEIGHT };
    x = desk.x + desk.w * (seatIndex === 0 ? 0.34 : 0.66);
    y = desk.y + desk.h + TILE;
  }
  const tile = nearestWalkableTile(grid, Math.floor(x / TILE), Math.floor(y / TILE)) ?? tileOf(x, y);
  return { x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2 };
}

function poseForActivity(activity, role) {
  if (activity === "desk") return role === "trader" ? "work" : "sit";
  if (activity === "coffee" || activity === "kitchen") return "coffee";
  if (activity === "pool") return "pool";
  if (activity === "research") return "observe";
  if (activity === "leisure") return "sit";
  if (activity === "social") return "talk";
  return "idle";
}

function stateForActivity(activity) {
  return STATE_BY_ACTIVITY[activity] ?? "IDLE";
}

function createAgent(role, station, seatIndex, index, seed) {
  const marketKey = marketKeyOfStation(station) ?? stationKey(station) ?? `station:${index}`;
  return {
    id: `${role}:${marketKey}`,
    role,
    index,
    stationId: stationKey(station),
    marketKey,
    seatIndex,
    home: { x: 0, y: 0 },
    x: 0,
    y: 0,
    state: "IDLE",
    pose: "idle",
    assignment: "SOCIAL",
    destination: null,
    spotId: null,
    activityKind: null,
    path: [],
    pathIndex: 0,
    speed: AGENT_SPEED,
    atDesk: false,
    working: false,
    traveling: false,
    retryAt: 0,
    frame: 0,
    facing: 1,
    spotCursor: hashString(`${seed}:${role}:${marketKey}`),
    loiterSeed: hashString(`${seed}:loiter:${role}:${marketKey}`),
    loiterStep: 0,
  };
}

function buildAgents(world, seed) {
  const agents = [];
  let index = 0;
  for (const station of world.stations) {
    for (const role of AGENT_ROLES) {
      const agent = createAgent(role, station, role === "trader" ? 0 : 1, index, seed);
      agent.home = seatFor(station, agent.seatIndex, world.grid);
      agent.x = agent.home.x;
      agent.y = agent.home.y;
      agents.push(agent);
      index += 1;
    }
  }
  return agents;
}

function placeAtDesk(agent, now) {
  agent.x = agent.home.x;
  agent.y = agent.home.y;
  agent.path = [];
  agent.pathIndex = 0;
  agent.traveling = false;
  agent.atDesk = true;
  agent.working = true;
  agent.destination = { kind: "desk", x: agent.home.x, y: agent.home.y };
  agent.assignment = "DESK";
  agent.spotId = null;
  agent.activityKind = "desk";
  agent.state = agent.role === "trader" ? "WORK" : "SIT";
  agent.pose = poseForActivity("desk", agent.role);
  agent.stateSince = now;
}

function chooseSocialDestination(life, agent) {
  const spots = life.world.spots;
  if (spots.length > 0) {
    const start = agent.spotCursor % spots.length;
    for (let offset = 0; offset < spots.length; offset += 1) {
      const spot = spots[(start + offset) % spots.length];
      if (life.occupancy.reserve(spot.id, agent.id).ok) {
        agent.spotId = spot.id;
        agent.activityKind = spot.kind;
        return { kind: "spot", spotId: spot.id, activity: spot.kind, x: spot.x, y: spot.y };
      }
    }
  }
  const tiles = life.world.loiterTiles;
  if (tiles.length > 0) {
    const position = (agent.loiterSeed + agent.loiterStep) % tiles.length;
    agent.loiterStep += 1;
    const tile = tiles[position];
    return { kind: "loiter", spotId: null, activity: tile.kind === "pool" ? "social" : tile.kind, x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2 };
  }
  const idle = life.world.idleFallback;
  if (idle) {
    return {
      kind: "loiter",
      spotId: null,
      activity: idle.kind === "pool" ? "social" : idle.kind ?? "idle",
      x: idle.x * TILE + TILE / 2,
      y: idle.y * TILE + TILE / 2,
    };
  }
  return { kind: "loiter", spotId: null, activity: "idle", x: agent.x, y: agent.y };
}

function settleAtDestination(life, agent, destination, now) {
  agent.x = destination.x;
  agent.y = destination.y;
  agent.path = [];
  agent.pathIndex = 0;
  agent.traveling = false;
  if (destination.kind === "desk") {
    agent.atDesk = true;
    agent.working = true;
    agent.activityKind = "desk";
    agent.state = agent.role === "trader" ? "WORK" : "SIT";
    agent.pose = poseForActivity("desk", agent.role);
  } else {
    agent.atDesk = false;
    agent.working = false;
    agent.state = stateForActivity(destination.activity);
    agent.pose = poseForActivity(destination.activity, agent.role);
  }
  agent.stateSince = now;
}

function walkTo(life, agent, destination) {
  const start = tileOf(agent.x, agent.y);
  const goal = { x: Math.floor(destination.x / TILE), y: Math.floor(destination.y / TILE) };
  const path = findTilePath(life.world.grid, start, goal);
  if (!path || path.length === 0) {
    if (destination.kind === "desk") {
      // Never teleport back to a desk: keep the agent where it is and retry
      // deterministically after a short cooldown (reopen must be a walk).
      agent.path = [];
      agent.pathIndex = 0;
      agent.traveling = false;
      agent.retryAt = life.time + 400;
      return false;
    }
    settleAtDestination(life, agent, destination, life.time);
    return false;
  }
  agent.path = path.map((point) => ({ x: point.x * TILE + TILE / 2, y: point.y * TILE + TILE / 2 }));
  agent.pathIndex = 0;
  agent.traveling = true;
  agent.state = "WALK";
  agent.pose = "walk";
  return true;
}

function planDesk(life, agent, now) {
  if (agent.spotId) {
    life.occupancy.release(agent.spotId, agent.id);
    agent.spotId = null;
  }
  agent.assignment = "DESK";
  agent.activityKind = "desk";
  agent.atDesk = false;
  agent.working = false;
  const destination = { kind: "desk", x: agent.home.x, y: agent.home.y };
  agent.destination = destination;
  if (Math.hypot(agent.x - agent.home.x, agent.y - agent.home.y) <= TILE / 2) {
    settleAtDestination(life, agent, destination, now);
    return;
  }
  walkTo(life, agent, destination);
}

function planSocial(life, agent, now) {
  agent.assignment = "SOCIAL";
  agent.atDesk = false;
  agent.working = false;
  if (agent.spotId) {
    life.occupancy.release(agent.spotId, agent.id);
    agent.spotId = null;
  }
  const destination = chooseSocialDestination(life, agent);
  agent.destination = destination;
  if (Math.hypot(agent.x - destination.x, agent.y - destination.y) <= TILE / 2) {
    settleAtDestination(life, agent, destination, now);
    return;
  }
  walkTo(life, agent, destination);
}

function advanceAgent(life, agent, dtMs, now) {
  agent.frame = Math.floor(now / 280) % 4;
  if (agent.state !== "WALK" || agent.path.length === 0) return;
  let remaining = agent.speed * (dtMs / 1000);
  while (remaining > 0 && agent.pathIndex < agent.path.length) {
    const target = agent.path[agent.pathIndex];
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= remaining) {
      agent.x = target.x;
      agent.y = target.y;
      agent.pathIndex += 1;
      remaining -= distance;
    } else {
      agent.x += (dx / distance) * remaining;
      agent.y += (dy / distance) * remaining;
      if (Math.abs(dx) >= Math.abs(dy)) agent.facing = dx >= 0 ? 1 : -1;
      remaining = 0;
    }
  }
  if (agent.pathIndex >= agent.path.length) {
    settleAtDestination(life, agent, agent.destination ?? { kind: "desk", x: agent.home.x, y: agent.home.y }, now);
  }
}

function spawnAgent(life, agent, station, now) {
  if (isStationOpen(station)) {
    placeAtDesk(agent, now);
    return;
  }
  agent.assignment = "SOCIAL";
  const destination = chooseSocialDestination(life, agent);
  agent.destination = destination;
  settleAtDestination(life, agent, destination, now);
}

/* ------------------------------------------------------------------ *
 * Supervisor
 * ------------------------------------------------------------------ */

function createSupervisor(world, seed) {
  const waypoints = world.patrol.length > 0 ? world.patrol : [{ x: 1, y: 1 }];
  const start = waypoints[0];
  return {
    id: "supervisor",
    role: "supervisor",
    index: -1,
    x: start.x * TILE + TILE / 2,
    y: start.y * TILE + TILE / 2,
    state: "WALK",
    pose: "walk",
    stage: "WALK",
    stageTimer: 0,
    waypoints,
    waypointIndex: 0,
    path: [],
    pathIndex: 0,
    speed: SUPERVISOR_SPEED,
    frame: 0,
    seed: hashString(`${seed}:supervisor`),
  };
}

function supervisorWalkTo(life, supervisor) {
  const waypoint = supervisor.waypoints[supervisor.waypointIndex] ?? supervisor.waypoints[0];
  const start = tileOf(supervisor.x, supervisor.y);
  const path = findTilePath(life.world.grid, start, { x: waypoint.x, y: waypoint.y });
  if (!path || path.length <= 1) {
    supervisor.path = [];
    supervisor.pathIndex = 0;
    return false;
  }
  supervisor.path = path.map((point) => ({ x: point.x * TILE + TILE / 2, y: point.y * TILE + TILE / 2 }));
  supervisor.pathIndex = 0;
  return true;
}

function updateSupervisor(life, dtMs, now) {
  const supervisor = life.supervisor;
  if (!supervisor) return;
  supervisor.frame = Math.floor(now / 280) % 4;
  if (supervisor.stage === "WALK") {
    if (supervisor.path.length === 0 || supervisor.pathIndex >= supervisor.path.length) {
      if (!supervisorWalkTo(life, supervisor)) {
        supervisor.waypointIndex = (supervisor.waypointIndex + 1) % supervisor.waypoints.length;
        supervisorWalkTo(life, supervisor);
      }
    }
    let remaining = supervisor.speed * (dtMs / 1000);
    while (remaining > 0 && supervisor.pathIndex < supervisor.path.length) {
      const target = supervisor.path[supervisor.pathIndex];
      const dx = target.x - supervisor.x;
      const dy = target.y - supervisor.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= remaining) {
        supervisor.x = target.x;
        supervisor.y = target.y;
        supervisor.pathIndex += 1;
        remaining -= distance;
      } else {
        supervisor.x += (dx / distance) * remaining;
        supervisor.y += (dy / distance) * remaining;
        remaining = 0;
      }
    }
    if (supervisor.pathIndex >= supervisor.path.length) {
      supervisor.stage = "OBSERVE";
      supervisor.stageTimer = 0;
      supervisor.state = "OBSERVE";
      supervisor.pose = "observe";
    }
    return;
  }
  supervisor.stageTimer += dtMs;
  if (supervisor.stageTimer >= SUPERVISOR_OBSERVE_MS) {
    supervisor.stageTimer = 0;
    supervisor.waypointIndex = (supervisor.waypointIndex + 1) % supervisor.waypoints.length;
    supervisor.stage = "WALK";
    supervisor.state = "WALK";
    supervisor.pose = "walk";
    supervisor.path = [];
    supervisor.pathIndex = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Stats + public API
 * ------------------------------------------------------------------ */

function computeStats(life) {
  let working = 0;
  let atDesk = 0;
  let traveling = 0;
  let social = 0;
  const deskOccupancy = new Map();
  for (const agent of life.agents) {
    if (agent.working) working += 1;
    if (agent.atDesk) {
      atDesk += 1;
      deskOccupancy.set(agent.stationId, (deskOccupancy.get(agent.stationId) ?? 0) + 1);
    }
    if (agent.traveling) traveling += 1;
    if (agent.assignment === "SOCIAL" && !agent.atDesk) social += 1;
  }
  let openStations = 0;
  for (const station of life.world.stations) if (life.resolveOpen(station)) openStations += 1;
  return {
    total: life.agents.length,
    working,
    idle: life.agents.length - working,
    atDesk,
    desksEmpty: life.world.stations.length - deskOccupancy.size,
    openStations,
    closedStations: life.world.stations.length - openStations,
    social,
    traveling,
  };
}

function enforceLifeInvariants(life, report) {
  if (!report || report.ok) return report;
  for (const violation of report.violations) reportInvariant(life, violation.code, JSON.stringify(violation));
  return report;
}

/**
 * Invariant checks (strict/test mode throws through `refreshAgentRegistry`):
 *  - every market has exactly one trader + one critic, ids unique;
 *  - every agent has exactly one location (never desk + spot);
 *  - a working/seated agent is never inside a social zone;
 *  - a closed market has no seated/working agent;
 *  - occupancy reservations match the agent's `spotId`.
 */
export function validateLifeInvariants(life) {
  const violations = [];
  const push = (code, details) => violations.push({ code, ...details });
  if (!life || !Array.isArray(life.agents) || !life.world) return { ok: true, violations };
  const stationKeys = new Set();
  for (const station of life.world.stations ?? []) {
    const key = marketKeyOfStation(station);
    if (key) stationKeys.add(key);
  }
  const seen = new Set();
  for (const agent of life.agents) {
    if (!agent || !agent.id) {
      push("AGENT_WITHOUT_ID", { agentId: String(agent?.id ?? "") });
      continue;
    }
    if (seen.has(agent.id)) push("DUPLICATE_AGENT_ID", { agentId: agent.id });
    seen.add(agent.id);
    const atDesk = agent.atDesk === true;
    const working = agent.working === true;
    const traveling = agent.traveling === true;
    const marketKey = agent.marketKey ?? null;
    if (marketKey && !stationKeys.has(marketKey)) push("AGENT_MARKET_WITHOUT_STATION", { agentId: agent.id, marketKey });
    if (atDesk && agent.spotId) push("DUAL_LOCATION_DESK_SPOT", { agentId: agent.id, spotId: agent.spotId });
    if (atDesk && traveling) push("DUAL_LOCATION_DESK_WALK", { agentId: agent.id });
    if (working && !atDesk) push("WORKING_WITHOUT_DESK", { agentId: agent.id });
    const zone = zoneAt(life.world, agent.x, agent.y);
    if (working && zone) push("WORKING_IN_SOCIAL_ZONE", { agentId: agent.id, zoneId: zone.id ?? null });
    if (life.occupancy) {
      const reserved = life.occupancy.spotOf(agent.id);
      if (agent.spotId && reserved !== agent.spotId) push("SPOT_RESERVATION_MISMATCH", { agentId: agent.id, spotId: agent.spotId, reserved });
      if (!agent.spotId && reserved) push("ORPHAN_SPOT_RESERVATION", { agentId: agent.id, spotId: reserved });
    }
  }
  const byMarket = new Map();
  for (const agent of life.agents) {
    const key = agent?.marketKey ?? null;
    if (!key) continue;
    if (!byMarket.has(key)) byMarket.set(key, []);
    byMarket.get(key).push(agent);
  }
  const pending = life.pendingPresence === true;
  for (const station of life.world.stations ?? []) {
    const key = marketKeyOfStation(station);
    if (!key) continue;
    const pair = byMarket.get(key) ?? [];
    if (pair.length !== 2) push("MARKET_PAIR_SIZE", { marketKey: key, count: pair.length });
    const traders = pair.filter((agent) => agent.role === "trader").length;
    const critics = pair.filter((agent) => agent.role === "critic").length;
    if (pair.length === 2 && (traders !== 1 || critics !== 1)) push("MARKET_PAIR_ROLES", { marketKey: key, traders, critics });
    const open = life.resolveOpen ? life.resolveOpen(station) === true : isStationOpen(station);
    for (const agent of pair) {
      const desired = open ? "DESK" : "SOCIAL";
      if (!pending && agent.assignment !== desired) {
        push("ASSIGNMENT_MISMATCH", { marketKey: key, agentId: agent.id, assignment: agent.assignment, desired });
      }
      if (!open && (agent.atDesk || agent.working)) push("CLOSED_MARKET_AT_DESK", { marketKey: key, agentId: agent.id });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Rebuilds `life.registry` (marketKey -> pair) and `life.agentLocations`
 * (agentId -> single location) from the live agents, then enforces invariants.
 */
export function refreshAgentRegistry(life, options = {}) {
  if (!life) return { ok: true, violations: [] };
  const locations = new Map();
  for (const agent of life.agents ?? []) {
    if (!agent || !agent.id) continue;
    const location = classifyAgentLocation(life, agent);
    locations.set(agent.id, {
      agentId: agent.id,
      role: agent.role ?? null,
      marketKey: agent.marketKey ?? null,
      stationId: agent.stationId ?? null,
      location: location.kind,
      zoneId: location.zoneId ?? null,
      zoneKind: location.zoneKind ?? null,
      spotId: agent.spotId ?? null,
      atDesk: agent.atDesk === true,
      working: agent.working === true,
      traveling: agent.traveling === true,
      x: agent.x,
      y: agent.y,
    });
  }
  const markets = new Map();
  for (const station of life.world?.stations ?? []) {
    const key = marketKeyOfStation(station);
    if (!key) continue;
    const pair = life.marketPairs?.get(key) ?? null;
    const traderAgentId = pair?.traderAgentId ?? null;
    const criticAgentId = pair?.criticAgentId ?? null;
    const traderLocation = traderAgentId ? locations.get(traderAgentId)?.location ?? null : null;
    const criticLocation = criticAgentId ? locations.get(criticAgentId)?.location ?? null : null;
    const open = life.resolveOpen ? life.resolveOpen(station) === true : isStationOpen(station);
    markets.set(key, {
      marketKey: key,
      traderAgentId,
      criticAgentId,
      currentLocation: aggregateLocation(traderLocation, criticLocation),
      state: open ? "OPEN" : "CLOSED",
      traderLocation,
      criticLocation,
      stationId: station.id ?? key,
    });
  }
  life.registry = markets;
  life.agentLocations = locations;
  const report = validateLifeInvariants(life);
  if (options.enforce !== false) enforceLifeInvariants(life, report);
  return report;
}

/**
 * THE hook other modules should read: `marketKey -> { traderAgentId,
 * criticAgentId, currentLocation, state }` (plus `traderLocation`,
 * `criticLocation`, `stationId`). Deterministic for a given seed + update count.
 */
export function getAgentRegistry(life) {
  if (!life) return {};
  refreshAgentRegistry(life);
  const output = {};
  for (const [key, entry] of life.registry) output[key] = { ...entry };
  return output;
}

/** `agentId -> { agentId, role, marketKey, location, zoneId, spotId, ... }` (one location each). */
export function getAgentLocations(life) {
  if (!life) return {};
  refreshAgentRegistry(life);
  const output = {};
  for (const [agentId, entry] of life.agentLocations) output[agentId] = { ...entry };
  return output;
}

export function createLifeSystem(worldState, options = {}) {
  const seed = String(options.seed ?? DEFAULT_SEED);
  const world = normalizeWorldState(worldState, options);
  const occupancy = new LifeOccupancy(world.spots);
  const agents = buildAgents(world, seed);
  const stationById = new Map();
  const stationByKey = new Map();
  for (const station of world.stations) {
    if (station.id) stationById.set(station.id, station);
    if (station.marketKey) stationByKey.set(station.marketKey, station);
  }
  const marketPairs = new Map();
  const agentById = new Map();
  for (const agent of agents) {
    if (!agentById.has(agent.id)) agentById.set(agent.id, agent);
    const key = agent.marketKey ?? agent.stationId ?? null;
    if (!key) continue;
    let pair = marketPairs.get(key);
    if (!pair) {
      pair = { marketKey: key, traderAgentId: null, criticAgentId: null, stationId: agent.stationId ?? null };
      marketPairs.set(key, pair);
    }
    if (agent.role === "trader") pair.traderAgentId = agent.id;
    else if (agent.role === "critic") pair.criticAgentId = agent.id;
  }
  const life = {
    version: LIFE_VERSION,
    registryVersion: AGENT_REGISTRY_VERSION,
    seed,
    rng: mulberry32(hashString(seed)),
    world,
    grid: world.grid,
    occupancy,
    agents,
    stationById,
    stationByKey,
    marketPairs,
    agentById,
    registry: new Map(),
    agentLocations: new Map(),
    presence: new Map(),
    pendingPresence: false,
    strict: options.strict === true ? true : options.strict === false ? false : undefined,
    invariantWarnings: new Set(),
    supervisor: createSupervisor(world, seed),
    time: 0,
    disposed: false,
    stats: null,
  };
  life.resolveOpen = (station) => {
    const key = stationKey(station);
    if (key && life.presence.has(key)) return life.presence.get(key);
    return isStationOpen(station);
  };
  for (const agent of agents) {
    const station = stationById.get(agent.stationId) ?? stationByKey.get(agent.marketKey);
    spawnAgent(life, agent, station, 0);
  }
  life.stats = computeStats(life);
  refreshAgentRegistry(life);
  return life;
}

export function setPresence(life, stationId, active) {
  if (!life) return false;
  const station = life.stationById.get(stationId) ?? life.stationByKey.get(stationId) ?? null;
  if (!station) return false;
  const key = stationKey(station);
  const next = active === true;
  if (life.presence.get(key) !== next) life.pendingPresence = true;
  life.presence.set(key, next);
  return true;
}

/** Same effect as `setPresence`, but resolved by `marketKey` first (registry key). */
export function setMarketPresence(life, marketKey, open) {
  if (!life || marketKey === null || marketKey === undefined) return false;
  const key = String(marketKey);
  const station = life.stationByKey.get(key) ?? life.stationById.get(key) ?? null;
  if (!station) return false;
  return setPresence(life, stationKey(station), open);
}

export function updateLife(life, dtMs) {
  if (!life || life.disposed) return life;
  const dt = Math.max(0, Number(dtMs) || 0);
  life.time += dt;
  const now = life.time;
  for (const station of life.world.stations) {
    const open = life.resolveOpen(station);
    station.isOpen = open;
  }
  for (const agent of life.agents) {
    const station = life.stationById.get(agent.stationId) ?? life.stationByKey.get(agent.marketKey) ?? null;
    const desired = life.resolveOpen(station) ? "DESK" : "SOCIAL";
    // A stalled desk return (no path this frame) retries after a cooldown,
    // instead of teleporting the agent onto the chair.
    const deskStalled =
      desired === "DESK" && agent.assignment === "DESK" && !agent.atDesk && !agent.traveling && now >= (agent.retryAt ?? 0);
    if (desired !== agent.assignment || deskStalled) {
      if (desired === "DESK") planDesk(life, agent, now);
      else planSocial(life, agent, now);
    }
    advanceAgent(life, agent, dt, now);
  }
  updateSupervisor(life, dt, now);
  life.pendingPresence = false;
  life.stats = computeStats(life);
  refreshAgentRegistry(life);
  return life;
}

export function getAgentStates(life) {
  if (!life) return [];
  return life.agents.map((agent) => {
    const location = classifyAgentLocation(life, agent);
    return {
      id: agent.id,
      role: agent.role,
      stationId: agent.stationId,
      marketKey: agent.marketKey,
      state: agent.state,
      pose: agent.pose,
      x: agent.x,
      y: agent.y,
      home: { x: agent.home.x, y: agent.home.y },
      assignment: agent.assignment,
      spotId: agent.spotId,
      activityKind: agent.activityKind,
      atDesk: agent.atDesk,
      working: agent.working,
      traveling: agent.traveling,
      idle: !agent.working,
      pathLength: agent.path.length,
      location: location.kind,
      zoneId: location.zoneId,
    };
  });
}

export function getSupervisorState(life) {
  if (!life || !life.supervisor) return null;
  const supervisor = life.supervisor;
  return {
    id: supervisor.id,
    role: supervisor.role,
    state: supervisor.state,
    pose: supervisor.pose,
    stage: supervisor.stage,
    x: supervisor.x,
    y: supervisor.y,
    waypointIndex: supervisor.waypointIndex,
    traveling: supervisor.stage === "WALK",
  };
}

/* ------------------------------------------------------------------ *
 * Drawing (world coordinates; ctx is expected pre-transformed)
 * ------------------------------------------------------------------ */

let cachedAssets = null;
let cachedWorld = null;

function guardedImport(specifier) {
  const path = "./" + specifier;
  return import(/* @vite-ignore */ path).catch(() => null);
}

export async function loadLifeModules() {
  if (!cachedAssets) cachedAssets = await guardedImport("assets.js");
  if (!cachedWorld) cachedWorld = await guardedImport("world.js");
  return { assets: cachedAssets, world: cachedWorld };
}

export function bindAssets(assets) {
  cachedAssets = assets ?? null;
}

export function bindWorld(world) {
  cachedWorld = world ?? null;
}

export function getBoundAssets() {
  return cachedAssets;
}

export function getBoundWorld() {
  return cachedWorld;
}

function fallbackCharacter(ctx, pose, x, y, options) {
  if (!ctx || typeof ctx.fillRect !== "function") return;
  const role = options?.role ?? "trader";
  const colors = { trader: "#ff9f6b", critic: "#7fd4ff", supervisor: "#ffd166" };
  const base = colors[role] ?? "#ff9f6b";
  const width = 8;
  const height = pose === "sit" || pose === "work" ? 12 : 16;
  ctx.fillStyle = base;
  ctx.fillRect(x - width / 2, y - height, width, height);
  ctx.fillStyle = "#2b2b3a";
  ctx.fillRect(x - width / 2, y - 3, width, 3);
}

function isAgentVisible(camera, x, y) {
  if (!camera || !camera.viewport) return true;
  const width = Number(camera.viewport.width) || 0;
  const height = Number(camera.viewport.height) || 0;
  if (width <= 0 || height <= 0) return true;
  const zoom = Number(camera.zoom) || 1;
  const screenX = (x - camera.x) * zoom;
  const screenY = (y - camera.y) * zoom;
  const margin = 96;
  return screenX >= -margin && screenY >= -margin && screenX <= width + margin && screenY <= height + margin;
}

export function drawAgents(ctx, life, camera = null) {
  if (!ctx || !life) return 0;
  const assets = life.assets ?? cachedAssets;
  const world = cachedWorld;
  const worldState = life.world?.raw ?? null;

  // One depth-sorted pass: agents + desk fronts. Seated agents are lifted to the
  // desk's back edge; the desk front is drawn later (higher sortY) and occludes
  // their lower body, matching the reference two-layer desk.
  const items = [];
  for (const agent of life.agents) {
    const station = life.stationById?.get(agent.stationId);
    const desk = station?.desk;
    const seated = agent.atDesk === true && desk;
    const renderY = seated ? desk.y + DESK_SEAT_LINE : agent.y;
    items.push({ sortY: renderY, sortX: agent.x, entity: agent, renderY, front: null });
  }
  if (life.supervisor) {
    items.push({ sortY: life.supervisor.y, sortX: life.supervisor.x, entity: life.supervisor, renderY: life.supervisor.y, front: null });
  }
  if (world && typeof world.collectDeskFronts === "function" && worldState) {
    for (const front of world.collectDeskFronts(worldState, camera)) {
      items.push({ sortY: front.sortY, sortX: front.x, entity: null, renderY: 0, front });
    }
  }
  items.sort((a, b) => a.sortY - b.sortY || (a.sortX ?? 0) - (b.sortX ?? 0));

  let drawn = 0;
  let duplicates = 0;
  // Every agentId is rendered at most once per frame; a visual clone is an
  // invariant violation (throws in strict/test mode, warns in production).
  const drawnIds = new Set();
  const drawOne = (entity, renderY) => {
    if (!isAgentVisible(camera, entity.x, renderY)) return;
    const entityId = entity?.id ?? null;
    if (entityId !== null) {
      if (drawnIds.has(entityId)) {
        duplicates += 1;
        reportInvariant(life, "DUPLICATE_AGENT_DRAW", `agent ${entityId} drawn twice in one frame`);
        return;
      }
      drawnIds.add(entityId);
    }
    const options = { role: entity.role, frame: entity.frame, facing: entity.facing, scale: 1, id: entity.id, seed: entity.seed };
    if (assets && typeof assets.drawCharacter === "function") {
      assets.drawCharacter(ctx, entity.pose, entity.x, renderY, options);
    } else {
      fallbackCharacter(ctx, entity.pose, entity.x, renderY, options);
    }
    drawn += 1;
  };
  for (const item of items) {
    if (item.front) {
      if (world && typeof world.drawDeskFront === "function") world.drawDeskFront(ctx, item.front);
    } else {
      drawOne(item.entity, item.renderY);
    }
  }
  life.lastDrawStats = { drawn, unique: drawnIds.size, duplicates };
  return drawn;
}

const autoLoad = guardedImport("assets.js");
if (autoLoad && typeof autoLoad.then === "function") {
  autoLoad.then((module) => {
    if (module) cachedAssets = module;
  });
}

export default {
  LIFE_VERSION,
  AGENT_REGISTRY_VERSION,
  TILE,
  createLifeSystem,
  updateLife,
  drawAgents,
  getAgentStates,
  setPresence,
  setMarketPresence,
  getAgentRegistry,
  getAgentLocations,
  validateLifeInvariants,
  refreshAgentRegistry,
  classifyAgentLocation,
  zoneAt,
  getSupervisorState,
  buildFallbackWorldState,
  findTilePath,
  LifeGrid,
  LifeOccupancy,
};
