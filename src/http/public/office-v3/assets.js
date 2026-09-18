/**
 * TRACE/COM — PIXEL OFFICE V3 · ASSET LIBRARY
 *
 * Dependency-free, DOM-guarded 2D-canvas pixel-art primitives. Every sprite is
 * drawn with hard-edged rectangles/polygons: 1px highlights and shadows, no
 * smooth gradients except deliberate warm light pools emitted by lamps.
 *
 * Public contract (frozen — other agents build against this):
 *   PALETTE_V3, SPRITE_NAMES, drawSprite(ctx,name,x,y,opts),
 *   drawCharacter(ctx,pose,x,y,opts), drawTile(ctx,name,x,y,w,h,opts).
 *
 * Rendering only. PRACTICE only. ZERO REAL.
 */

/* ------------------------------------------------------------------ *
 * 1. PALETTE
 * ------------------------------------------------------------------ */

export const PALETTE_V3 = {
  // structure
  floor: "#0d1b2e",
  floorAlt: "#0f2033",
  floorWarm: "#1a2334",
  floorDeep: "#0a1524",
  tileLine: "#14263d",
  wall: "#101a2b",
  wallPanel: "#0c1524",
  wallBrick: "#3a2a22",
  wallBrickHi: "#4a362c",
  border: "#c9a24b",
  gold: "#c9a24b",
  goldHi: "#e8c877",
  goldDark: "#8a6a24",

  // wood
  wood: "#b07a45",
  woodHi: "#c99a63",
  woodMid: "#8a5a34",
  woodDark: "#5c3a22",
  woodShadow: "#3d2413",
  woodFloor: "#4a3220",
  woodFloorHi: "#573c26",
  woodFloorMid: "#3c2818",
  woodFloorDark: "#2a1a0e",
  woodFloorSeam: "#170d05",

  // soft goods
  sofa: "#d9c7a3",
  sofaHi: "#efe3c6",
  sofaDark: "#b8a37c",
  leather: "#6b4a2f",
  leatherHi: "#8a6038",
  leatherDark: "#432c1a",
  rugRed: "#642823",
  rugRedHi: "#83382f",
  rugBlue: "#22406b",
  rugBlueHi: "#315a91",
  rugCream: "#cbb894",
  rugCreamHi: "#e4d5b3",
  rugAmber: "#7a4a1e",
  rugAmberHi: "#9a622c",

  // accents
  bandBlue: "#2a4070",
  bandBlueHi: "#3d5a8e",
  bandGreen: "#256644",
  bandGreenHi: "#3d8f5f",
  panelHeader: "#16304f",
  green: "#3fbf5f",
  greenDark: "#237a3b",
  red: "#e04b3a",
  redDark: "#9c2c20",

  // nature
  plant: "#3f8f4f",
  plantHi: "#5cb96a",
  plantDark: "#2b6638",
  pot: "#8a5a34",
  potDark: "#5c3a22",

  // tech
  screen: "#0b1220",
  screenBezel: "#1b2536",
  screenOn: "#5fd0ff",
  screenGreen: "#63d68a",
  screenWarn: "#ffd166",
  metal: "#8d99b5",
  metalDark: "#5a6478",
  metalHi: "#c3ccdb",
  felt: "#0a8048",
  feltDark: "#0a5a34",

  // lighting
  amber: "#f0b429",
  amberSoft: "#d99a2b",
  windowGlow: "#ffe0a8",

  // agents
  skin: "#e8b48a",
  skin2: "#c98d63",
  skin3: "#8a5a3c",
  skin4: "#f2c9a4",
  traderNavy: "#1f3a6e",
  traderNavy2: "#152c58",
  criticPurple: "#6a3fb0",
  criticPurple2: "#4f2d8c",
  hair1: "#20180f",
  hair2: "#4a3320",
  hair3: "#b07a3a",
  hair4: "#8a3a20",
  hair5: "#d8d2c4",
  pants: "#2c3345",
  pants2: "#3a4256",
  shoe: "#1a1d26",
  tie: "#c9a24b",
  white: "#ffffff",
  ink: "#e8d7b0",
  shadow: "rgba(0,0,0,0.35)",
};

/* ------------------------------------------------------------------ *
 * 2. NAME REGISTRY
 * ------------------------------------------------------------------ */

export const TILE_NAMES = [
  "floor_tiles",
  "floor_wood",
  "floor_carpet",
  "wall_panel",
  "wall_brick",
  "rug_red",
  "rug_blue",
  "rug_cream",
  "rug_amber",
  "floor",
  "wall",
  "rug",
];

export const SPRITE_NAMES = [
  "wood_desk",
  "chair",
  "monitor",
  "computer_tower",
  "keyboard",
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
  "research_desk",
  ...TILE_NAMES,
];

export const CHARACTER_POSES = ["idle", "walk", "sit", "work", "talk", "coffee", "pool", "observe"];

/* ------------------------------------------------------------------ *
 * 3. LOW-LEVEL PIXEL HELPERS
 * ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function pxRect(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function pxPoly(ctx, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.closePath();
  ctx.fill();
}

function pxLine(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
}

/** Warm radial light pool — the only permitted smooth gradient. */
function lightPool(ctx, x, y, radius, color, alpha) {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(Math.round(x), Math.round(y), 1, Math.round(x), Math.round(y), Math.round(radius));
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.fillRect(Math.round(x - radius), Math.round(y - radius), Math.round(radius * 2), Math.round(radius * 2));
  ctx.restore();
}

function warmOverlay(ctx, x, y, w, h, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 3b. OFFSCREEN RASTER CACHE
 *
 * Static sprites, tiles and character poses are rasterized once to an
 * offscreen canvas and blitted afterwards. This keeps the per-frame cost
 * to a drawImage instead of hundreds of fillRect calls, without changing a
 * single pixel. Browsers auto-detect OffscreenCanvas; headless tools inject
 * a factory through configureSpriteCache(). When no factory is available the
 * renderer transparently falls back to immediate drawing.
 * ------------------------------------------------------------------ */

let cacheCanvasFactory = null;
const spriteCache = new Map();
const spriteCacheStats = { hits: 0, misses: 0, created: 0 };

export function configureSpriteCache(factory) {
  cacheCanvasFactory = typeof factory === "function" ? factory : null;
  spriteCache.clear();
  spriteCacheStats.hits = 0;
  spriteCacheStats.misses = 0;
  spriteCacheStats.created = 0;
}

export function getSpriteCacheStats() {
  return { hits: spriteCacheStats.hits, misses: spriteCacheStats.misses, created: spriteCacheStats.created, size: spriteCache.size };
}

function resolveCanvasFactory() {
  if (cacheCanvasFactory) return cacheCanvasFactory;
  if (typeof globalThis !== "undefined" && typeof globalThis.OffscreenCanvas === "function") {
    return (width, height) => new globalThis.OffscreenCanvas(width, height);
  }
  return null;
}

export function createCacheCanvas(width, height) {
  const factory = resolveCanvasFactory();
  if (!factory) return null;
  try {
    const canvas = factory(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    if (!canvas || typeof canvas.getContext !== "function") return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = false;
    return { canvas, context };
  } catch {
    return null;
  }
}

function hasCacheFactory() {
  return resolveCanvasFactory() !== null;
}

function stableOptionsKey(options) {
  if (!options) return "";
  const keys = Object.keys(options).sort();
  const parts = [];
  for (const key of keys) {
    const value = options[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "function") continue;
    parts.push(`${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  return parts.join(",");
}

/** Rasterize a sprite at the origin and return its canvas, or null when uncacheable. */
function cachedSpriteCanvas(name, options) {
  const boundsFn = SPRITE_BOUNDS[name];
  if (!boundsFn) return null;
  const bounds = boundsFn(options);
  const key = `sprite|${name}|${stableOptionsKey(options)}|${bounds.left}|${bounds.top}|${bounds.right}|${bounds.bottom}`;
  const existing = spriteCache.get(key);
  if (existing !== undefined) return { canvas: existing, bounds };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const created = createCacheCanvas(width, height);
  if (!created) {
    spriteCacheStats.misses += 1;
    return null;
  }
  created.context.translate(-Math.round(bounds.left), -Math.round(bounds.top));
  SPRITE_DISPATCH[name](created.context, 0, 0, options);
  spriteCache.set(key, created.canvas);
  spriteCacheStats.created += 1;
  return { canvas: created.canvas, bounds };
}

function tryDrawCachedSprite(ctx, name, x, y, options) {
  if (!hasCacheFactory()) return null;
  const hit = cachedSpriteCanvas(name, options);
  if (!hit) return null;
  spriteCacheStats.hits += 1;
  ctx.drawImage(hit.canvas, Math.round(x + hit.bounds.left), Math.round(y + hit.bounds.top));
  return undefined;
}

function cachedTileCanvas(name, w, h, options) {
  const key = `tile|${name}|${w}|${h}|${stableOptionsKey(options)}`;
  const existing = spriteCache.get(key);
  if (existing !== undefined) return existing;
  const created = createCacheCanvas(w + 4, h + 4);
  if (!created) {
    spriteCacheStats.misses += 1;
    return null;
  }
  drawTileImmediate(created.context, name, 0, 0, w, h, options);
  spriteCache.set(key, created.canvas);
  spriteCacheStats.created += 1;
  return created.canvas;
}

function tryDrawCachedTile(ctx, name, x, y, w, h, options) {
  if (!hasCacheFactory()) return null;
  if (w * h > 120000) return null;
  const canvas = cachedTileCanvas(name, w, h, options);
  if (!canvas) return null;
  spriteCacheStats.hits += 1;
  ctx.drawImage(canvas, Math.round(x), Math.round(y));
  return undefined;
}

/* Bounding boxes (relative to the sprite origin) for the cache raster. */
const SPRITE_BOUNDS = {
  wood_desk: (o) => ({ left: 0, top: 0, right: o.w ?? 150, bottom: (o.h ?? 92) + 8 }),
  research_desk: (o) => ({ left: 0, top: -26, right: o.w ?? 150, bottom: (o.h ?? 92) + 8 }),
  chair: (o) => ({ left: 0, top: 0, right: o.w ?? 26, bottom: (o.h ?? 30) + 2 }),
  monitor: (o) => ({ left: 0, top: 0, right: o.w ?? 30, bottom: o.h ?? 22 }),
  computer_tower: (o) => ({ left: 0, top: 0, right: o.w ?? 22, bottom: o.h ?? 42 }),
  keyboard: (o) => ({ left: 0, top: 0, right: o.w ?? 34, bottom: o.h ?? 10 }),
  plant_small: (o) => { const s = o.scale ?? 1; return { left: -9 * s, top: -22 * s, right: 16 * s, bottom: 12 * s }; },
  plant_large: (o) => { const s = o.scale ?? 1; return { left: -17 * s, top: -52 * s, right: 22 * s, bottom: 16 * s }; },
  lamp: (o) => { const h = o.height ?? 46; const p = o.pool ?? 56; return { left: -p, top: -(h - 8) - p, right: p, bottom: Math.max(4, p - h + 8) }; },
  wall_sconce: (o) => { const p = o.pool ?? 44; return { left: -p, top: 10 - p, right: p, bottom: 10 + p }; },
  ceiling_lamp: (o) => { const w = o.w ?? 60; const p = o.pool ?? Math.round(w * 1.2); return { left: Math.min(-p, -3), top: 6 - p, right: Math.max(p, w + 3), bottom: 6 + p }; },
  sofa: (o) => ({ left: 0, top: 0, right: o.w ?? 160, bottom: (o.h ?? 44) + 4 }),
  armchair: (o) => ({ left: 0, top: 0, right: o.w ?? 44, bottom: (o.h ?? 42) + 4 }),
  coffee_table: (o) => ({ left: 0, top: -6, right: o.w ?? 90, bottom: (o.h ?? 22) + 4 }),
  pool_table: (o) => ({ left: 0, top: 0, right: o.w ?? 160, bottom: (o.h ?? 78) + 4 }),
  kitchen_counter: (o) => ({ left: 0, top: -7, right: o.w ?? 120, bottom: (o.h ?? 48) + 3 }),
  fridge: (o) => ({ left: 0, top: 0, right: o.w ?? 40, bottom: o.h ?? 72 }),
  bookshelf: (o) => ({ left: 0, top: 0, right: o.w ?? 60, bottom: o.h ?? 90 }),
  whiteboard: (o) => ({ left: 0, top: 0, right: o.w ?? 110, bottom: o.h ?? 64 }),
  poster: (o) => ({ left: 0, top: 0, right: o.w ?? 44, bottom: o.h ?? 56 }),
  stairs: (o) => ({ left: 0, top: 0, right: o.w ?? 120, bottom: (o.h ?? 110) + 4 }),
  divider: (o) => ({ left: -2, top: 0, right: (o.w ?? 16) + 2, bottom: (o.h ?? 90) + 4 }),
  water_cooler: (o) => ({ left: 0, top: 0, right: o.w ?? 24, bottom: (o.h ?? 50) + 3 }),
  server_rack: (o) => ({ left: 0, top: 0, right: o.w ?? 34, bottom: o.h ?? 70 }),
  window: (o) => {
    const w = o.w ?? 80;
    const h = o.h ?? 70;
    const p = o.pool ?? 90;
    return { left: Math.min(0, w / 2 - p), top: Math.min(0, h / 2 - p), right: Math.max(w, w / 2 + p), bottom: Math.max(h, h / 2 + p) };
  },
};

const CHARACTER_BOUNDS = { left: -12, top: -40, right: 12, bottom: 6 };

/* ------------------------------------------------------------------ *
 * 4. INTERNAL 5x7 BITMAP FONT (self-contained)
 * ------------------------------------------------------------------ */

const FONT_5X7 = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  3: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ",": [0, 0, 0, 0, 0b00110, 0b00110, 0b01100],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  "+": [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  "%": [0b11001, 0b11011, 0b00010, 0b00100, 0b01000, 0b11011, 0b10011],
  "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  "?": [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0, 0b00100],
  "=": [0, 0, 0b11111, 0, 0b11111, 0, 0],
  "·": [0, 0, 0, 0b00100, 0, 0, 0],
  "#": [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0],
  $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  "&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  "<": [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
  ">": [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000],
  "*": [0, 0b00100, 0b10101, 0b01110, 0b10101, 0b00100, 0],
  _: [0, 0, 0, 0, 0, 0, 0b11111],
  "−": [0, 0, 0, 0b11111, 0, 0, 0],
  "°": [0b01100, 0b10010, 0b01100, 0, 0, 0, 0],
};

const ACCENT_MAP = {
  Á: "A", À: "A", Â: "A", Ã: "A", Ä: "A",
  É: "E", È: "E", Ê: "E",
  Í: "I", Ì: "I", Î: "I",
  Ó: "O", Ò: "O", Ô: "O", Õ: "O",
  Ú: "U", Ù: "U", Û: "U",
  Ç: "C", Ñ: "N",
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

export const SUPPORTED_GLYPHS = Object.freeze(Object.keys(FONT_5X7));

export function fontGlyphCoverage(text) {
  const missing = [];
  for (const char of String(text ?? "").toUpperCase()) {
    const base = ACCENT_MAP[char] ?? char;
    if (!Object.prototype.hasOwnProperty.call(FONT_5X7, base)) missing.push(char);
  }
  return missing;
}

export function measurePixelText(text, scale = 1, spacing = 1) {
  const value = String(text ?? "");
  if (value.length === 0) return 0;
  return (value.length * (GLYPH_WIDTH + spacing) - spacing) * scale;
}

function drawGlyph(ctx, char, x, y, scale, color) {
  const base = ACCENT_MAP[char] ?? char;
  const rows = FONT_5X7[base] ?? FONT_5X7["?"];
  ctx.fillStyle = color;
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const bits = rows[row];
    if (!bits) continue;
    for (let column = 0; column < GLYPH_WIDTH; column += 1) {
      if (bits & (1 << (GLYPH_WIDTH - 1 - column))) ctx.fillRect(x + column * scale, y + row * scale, scale, scale);
    }
  }
}

export function drawPixelText(ctx, text, x, y, options = {}) {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const spacing = options.spacing ?? 1;
  const value = String(text ?? "").toUpperCase();
  const width = measurePixelText(value, scale, spacing);
  let cursor = Math.round(x);
  if (options.align === "center") cursor = Math.round(x - width / 2);
  else if (options.align === "right") cursor = Math.round(x - width);
  const paint = (px, py, color) => {
    let c = px;
    for (const char of value) {
      drawGlyph(ctx, char, c, py, scale, color);
      c += (GLYPH_WIDTH + spacing) * scale;
    }
  };
  if (options.shadow) paint(cursor + scale, Math.round(y) + scale, options.shadow);
  paint(cursor, Math.round(y), options.color ?? PALETTE_V3.white);
}

export function wrapPixelText(text, maxWidth, scale = 1, spacing = 1) {
  const words = String(text ?? "").toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measurePixelText(candidate, scale, spacing) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function drawPixelParagraph(ctx, text, x, y, maxWidth, options = {}) {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const spacing = options.spacing ?? 1;
  const lineHeight = options.lineHeight ?? (GLYPH_HEIGHT + 3) * scale;
  const lines = wrapPixelText(text, maxWidth, scale, spacing);
  lines.forEach((line, index) => drawPixelText(ctx, line, x, y + index * lineHeight, { ...options, scale, spacing }));
  return lines.length;
}

export function formatBRL(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0,00";
  const fixed = Math.abs(number).toFixed(digits);
  const [integerPart, decimalPart] = fixed.split(".");
  const grouped = (integerPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimalPart ? `${grouped},${decimalPart}` : grouped;
}

export function signedBRL(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+R$ ${formatBRL(number)}`;
  if (number < 0) return `−R$ ${formatBRL(Math.abs(number))}`;
  return "R$ 0,00";
}

/* ------------------------------------------------------------------ *
 * 5. TILES — floors, walls, rugs
 * ------------------------------------------------------------------ */

function tileFloorTiles(ctx, x, y, w, h, options = {}) {
  const size = options.size ?? 32;
  pxRect(ctx, x, y, w, h, options.base ?? PALETTE_V3.floor);
  for (let ty = 0; ty < h; ty += size) {
    for (let tx = 0; tx < w; tx += size) {
      const even = ((tx / size) + (ty / size)) % 2 === 0;
      pxRect(ctx, x + tx, y + ty, size, size, even ? PALETTE_V3.floorAlt : PALETTE_V3.floorWarm);
      pxRect(ctx, x + tx, y + ty, size, 1, "rgba(240,190,110,0.05)");
      pxRect(ctx, x + tx, y + ty, 1, size, PALETTE_V3.tileLine);
      pxRect(ctx, x + tx, y + ty + size - 1, size, 1, PALETTE_V3.tileLine);
    }
  }
}

function tileFloorWood(ctx, x, y, w, h, options = {}) {
  const plankH = options.plankH ?? 14;
  const plankW = options.plankW ?? 96;
  const tints = [PALETTE_V3.woodFloor, PALETTE_V3.woodFloorHi, PALETTE_V3.woodFloorMid];
  let row = 0;
  for (let py = y; py < y + h; py += plankH, row += 1) {
    const ph = Math.min(plankH, y + h - py);
    if (ph <= 0) break;
    pxRect(ctx, x, py, w, ph, tints[row % tints.length]);
    pxRect(ctx, x, py, w, 1, "rgba(255,208,150,0.08)");
    pxRect(ctx, x, py + ph - 1, w, 1, PALETTE_V3.woodFloorSeam);
    const offset = (row % 2) * Math.round(plankW / 2);
    for (let sx = x - offset + plankW; sx < x + w; sx += plankW) pxRect(ctx, sx, py, 1, ph, PALETTE_V3.woodFloorSeam);
    for (let gx = x + 8; gx < x + w; gx += 30) pxRect(ctx, gx, py + 3 + ((row * 5 + gx) % 6), 10, 1, "rgba(30,18,8,0.16)");
  }
}

function tileFloorCarpet(ctx, x, y, w, h, options = {}) {
  const base = options.color ?? PALETTE_V3.rugBlue;
  pxRect(ctx, x, y, w, h, base);
  for (let gy = y; gy < y + h; gy += 4) pxRect(ctx, x, gy, w, 1, "rgba(255,255,255,0.03)");
  for (let gx = x; gx < x + w; gx += 4) pxRect(ctx, gx, y, 1, h, "rgba(0,0,0,0.06)");
}

function tileWallPanel(ctx, x, y, w, h, options = {}) {
  pxRect(ctx, x, y, w, h, options.bg ?? PALETTE_V3.wall);
  const panelW = options.panelW ?? 48;
  for (let px = x; px < x + w; px += panelW) {
    pxRect(ctx, px, y, 1, h, "rgba(0,0,0,0.4)");
    pxRect(ctx, px + 1, y, 1, h, "rgba(255,255,255,0.05)");
  }
  pxRect(ctx, x, y, w, 2, "rgba(255,220,170,0.08)");
  pxRect(ctx, x, y + h - 2, w, 2, "rgba(0,0,0,0.45)");
}

function tileWallBrick(ctx, x, y, w, h, options = {}) {
  const brickW = options.brickW ?? 30;
  const brickH = options.brickH ?? 12;
  pxRect(ctx, x, y, w, h, PALETTE_V3.wallBrick);
  let row = 0;
  for (let by = y; by < y + h; by += brickH, row += 1) {
    const offset = (row % 2) * Math.round(brickW / 2);
    for (let bx = x - offset; bx < x + w; bx += brickW) {
      pxRect(ctx, bx, by, brickW - 1, brickH - 1, row % 2 === 0 ? PALETTE_V3.wallBrick : PALETTE_V3.wallBrickHi);
      pxRect(ctx, bx, by, brickW - 1, 1, "rgba(255,220,180,0.08)");
    }
  }
}

function tileRug(ctx, x, y, w, h, options = {}) {
  const base = options.color ?? PALETTE_V3.rugRed;
  const inner = options.inner ?? PALETTE_V3.rugRedHi;
  const trim = options.trim ?? PALETTE_V3.gold;
  pxRect(ctx, x + 3, y + 3, w, h, "rgba(0,0,0,0.25)");
  pxRect(ctx, x, y, w, h, base);
  pxRect(ctx, x, y, w, 2, trim);
  pxRect(ctx, x, y + h - 2, w, 2, trim);
  pxRect(ctx, x, y, 2, h, trim);
  pxRect(ctx, x + w - 2, y, 2, h, trim);
  pxRect(ctx, x + 5, y + 5, w - 10, h - 10, inner);
  pxRect(ctx, x + 5, y + 5, w - 10, 1, "rgba(255,255,255,0.08)");
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.max(6, Math.min(w * 0.28, 40));
  const ry = Math.max(5, Math.min(h * 0.3, 20));
  pxLine(ctx, cx, cy - ry, cx + rx, cy, trim, 1);
  pxLine(ctx, cx + rx, cy, cx, cy + ry, trim, 1);
  pxLine(ctx, cx, cy + ry, cx - rx, cy, trim, 1);
  pxLine(ctx, cx - rx, cy, cx, cy - ry, trim, 1);
}

export function drawTile(ctx, name, x, y, w, h, options = {}) {
  const cached = tryDrawCachedTile(ctx, name, x, y, w, h, options);
  if (cached !== null) return cached;
  return drawTileImmediate(ctx, name, x, y, w, h, options);
}

function drawTileImmediate(ctx, name, x, y, w, h, options = {}) {
  switch (name) {
    case "floor":
    case "floor_tiles":
      return tileFloorTiles(ctx, x, y, w, h, options);
    case "floor_wood":
      return tileFloorWood(ctx, x, y, w, h, options);
    case "floor_carpet":
      return tileFloorCarpet(ctx, x, y, w, h, options);
    case "wall":
    case "wall_panel":
      return tileWallPanel(ctx, x, y, w, h, options);
    case "wall_brick":
      return tileWallBrick(ctx, x, y, w, h, options);
    case "rug":
    case "rug_red":
      return tileRug(ctx, x, y, w, h, { ...options, color: options.color ?? PALETTE_V3.rugRed, inner: options.inner ?? PALETTE_V3.rugRedHi });
    case "rug_blue":
      return tileRug(ctx, x, y, w, h, { ...options, color: options.color ?? PALETTE_V3.rugBlue, inner: options.inner ?? PALETTE_V3.rugBlueHi });
    case "rug_cream":
      return tileRug(ctx, x, y, w, h, { ...options, color: options.color ?? PALETTE_V3.rugCream, inner: options.inner ?? PALETTE_V3.rugCreamHi, trim: options.trim ?? PALETTE_V3.sofaDark });
    case "rug_amber":
      return tileRug(ctx, x, y, w, h, { ...options, color: options.color ?? PALETTE_V3.rugAmber, inner: options.inner ?? PALETTE_V3.rugAmberHi });
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * 6. FURNITURE SPRITES
 * ------------------------------------------------------------------ */

function spriteWoodDesk(ctx, x, y, options = {}) {
  const w = options.w ?? 150;
  const h = options.h ?? 92;
  const depth = options.depth ?? Math.max(12, Math.round(h * 0.22));
  const frontY = y + depth;
  const frontH = h - depth;
  const inset = options.inset ?? 8;

  pxRect(ctx, x + 4, y + h, w - 8, 3, "rgba(0,0,0,0.42)");
  pxRect(ctx, x + 16, y + h + 3, w - 32, 2, "rgba(0,0,0,0.22)");

  // feet
  pxRect(ctx, x + 8, y + h - 2, 8, 6, PALETTE_V3.woodShadow);
  pxRect(ctx, x + w - 16, y + h - 2, 8, 6, PALETTE_V3.woodShadow);

  // side faces
  pxPoly(ctx, [{ x: x + inset, y }, { x, y: frontY }, { x: x + 4, y: frontY }, { x: x + inset + 4, y }], PALETTE_V3.woodShadow);
  pxPoly(ctx, [{ x: x + w - inset, y }, { x: x + w, y: frontY }, { x: x + w - 4, y: frontY }, { x: x + w - inset - 4, y }], PALETTE_V3.woodShadow);

  // thick front face
  pxRect(ctx, x, frontY, w, frontH, PALETTE_V3.woodDark);
  pxRect(ctx, x, frontY, w, 2, PALETTE_V3.woodMid);
  pxRect(ctx, x, frontY, 4, frontH, PALETTE_V3.woodMid);
  pxRect(ctx, x + w - 4, frontY, 4, frontH, PALETTE_V3.woodShadow);
  pxRect(ctx, x, y + h - 2, w, 2, "#2a1a0e");

  // drawer seams + handles
  const panelTop = frontY + 4;
  const panelH = Math.max(4, frontH - 8);
  for (let index = 1; index <= 3; index += 1) {
    const gy = panelTop + Math.round((panelH * index) / 4);
    pxRect(ctx, x + 10, gy, w - 20, 1, "rgba(0,0,0,0.32)");
    pxRect(ctx, x + 10, gy + 1, w - 20, 1, "rgba(255,220,170,0.06)");
  }
  pxRect(ctx, x + Math.round(w / 2), panelTop, 1, panelH, "rgba(0,0,0,0.28)");
  pxRect(ctx, x + Math.round(w * 0.28), panelTop + Math.round(panelH * 0.55), 8, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + Math.round(w * 0.72) - 8, panelTop + Math.round(panelH * 0.55), 8, 2, PALETTE_V3.metalDark);

  // isometric top
  pxPoly(ctx, [{ x: x + inset, y }, { x: x + w - inset, y }, { x: x + w, y: frontY }, { x, y: frontY }], PALETTE_V3.wood);
  for (let index = 0; index < 3; index += 1) pxRect(ctx, x + inset + 8, y + 3 + index * 4, w - inset * 2 - 16, 1, "rgba(90,58,34,0.22)");
  pxRect(ctx, x + inset + 1, y, w - inset * 2 - 2, 1, PALETTE_V3.woodHi);
  pxRect(ctx, x + inset, y, 1, 1, PALETTE_V3.woodHi);
  pxRect(ctx, x + w - inset - 1, y, 1, 1, PALETTE_V3.woodHi);

  const plaqueText = options.plaque ?? options.label ?? null;
  let plaqueRect = null;
  if (plaqueText) {
    const pw = Math.min(w - 24, Math.max(56, Math.round(String(plaqueText).length * 7 + 14)));
    const ph = Math.max(14, Math.min(22, frontH - 8));
    const pxx = x + Math.round((w - pw) / 2);
    const pyy = frontY + Math.max(2, Math.round((frontH - ph) / 2));
    pxRect(ctx, pxx, pyy, pw, ph, PALETTE_V3.woodShadow);
    pxRect(ctx, pxx + 1, pyy + 1, pw - 2, ph - 2, "#c99a63");
    pxRect(ctx, pxx + 1, pyy + 1, pw - 2, 1, "#e0bd8a");
    pxRect(ctx, pxx + 1, pyy + ph - 2, pw - 2, 1, "#2a1a0e");
    let scale = 2;
    while (scale > 1 && measurePixelText(String(plaqueText), scale, 1) > pw - 8) scale -= 1;
    const text = String(plaqueText).toUpperCase();
    drawPixelText(ctx, text, pxx + pw / 2, pyy + Math.round((ph - GLYPH_HEIGHT * scale) / 2), {
      scale,
      align: "center",
      color: "#2c1806",
      shadow: "rgba(255,220,170,0.28)",
    });
    plaqueRect = { x: pxx, y: pyy, w: pw, h: ph, text };
  }

  return { topH: depth, frontY, frontH, plaqueRect };
}

function spriteChair(ctx, x, y, options = {}) {
  const w = options.w ?? 26;
  const h = options.h ?? 30;
  const shell = options.shell ?? "#1b2743";
  const shellHi = options.shellHi ?? "#2c3d63";
  const rim = options.rim ?? "#0e1730";
  const cx = x + Math.round(w / 2);
  // backrest
  pxRect(ctx, x + 2, y + 1, w - 4, Math.round(h * 0.55), rim);
  pxRect(ctx, x + 3, y + 2, w - 6, Math.round(h * 0.55) - 2, shell);
  pxRect(ctx, x + 3, y + 2, w - 6, 2, shellHi);
  pxRect(ctx, x + 3, y + 10, w - 6, 1, "rgba(0,0,0,0.3)");
  // seat
  const seatY = y + Math.round(h * 0.5);
  pxRect(ctx, x + 1, seatY, w - 2, 5, shell);
  pxRect(ctx, x + 1, seatY, w - 2, 1, shellHi);
  pxRect(ctx, x + 1, seatY + 4, w - 2, 1, rim);
  // post + base + casters
  pxRect(ctx, cx - 1, seatY + 5, 3, 6, PALETTE_V3.metalDark);
  pxRect(ctx, x + 2, seatY + 11, w - 4, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + 3, seatY + 13, 3, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + w - 6, seatY + 13, 3, 2, PALETTE_V3.metalDark);
}

function spriteMonitor(ctx, x, y, options = {}) {
  const w = options.w ?? 30;
  const h = options.h ?? 22;
  pxRect(ctx, x, y + h - 3, w, 3, PALETTE_V3.woodShadow);
  pxRect(ctx, x + Math.round(w / 2) - 2, y + h - 6, 4, 3, PALETTE_V3.metalDark);
  pxRect(ctx, x, y, w, h - 4, PALETTE_V3.screenBezel);
  pxRect(ctx, x + 2, y + 2, w - 4, h - 8, options.color ?? PALETTE_V3.screen);
  pxRect(ctx, x, y, w, 1, PALETTE_V3.metal);
  if (options.on !== false) {
    for (let row = 0; row < 4; row += 1) {
      const lineW = Math.max(3, (w - 8) - row * 4);
      pxRect(ctx, x + 4, y + 4 + row * 3, lineW, 1, row === 1 ? PALETTE_V3.screenGreen : PALETTE_V3.screenOn);
    }
  }
}

function spriteComputerTower(ctx, x, y, options = {}) {
  const w = options.w ?? 22;
  const h = options.h ?? 42;
  pxRect(ctx, x, y, w, h, "#20283a");
  pxRect(ctx, x, y, w, 1, PALETTE_V3.metalDark);
  pxRect(ctx, x + w - 1, y, 1, h, "#141a28");
  pxRect(ctx, x + 3, y + 4, w - 6, 6, "#161d2c");
  pxRect(ctx, x + 3, y + 4, w - 6, 1, "rgba(255,255,255,0.06)");
  for (let index = 0; index < 4; index += 1) pxRect(ctx, x + 4, y + 14 + index * 6, w - 8, 3, "#141a28");
  pxRect(ctx, x + 4, y + h - 8, 4, 3, options.led ?? PALETTE_V3.screenGreen);
  pxRect(ctx, x + 10, y + h - 8, 4, 3, PALETTE_V3.amber);
}

function spriteKeyboard(ctx, x, y, options = {}) {
  const w = options.w ?? 34;
  const h = options.h ?? 10;
  pxRect(ctx, x, y, w, h, "#2a3140");
  pxRect(ctx, x, y, w, 1, PALETTE_V3.metalDark);
  pxRect(ctx, x, y + h - 1, w, 1, "#12161f");
  const cols = Math.max(4, Math.floor(w / 5));
  const rows = Math.max(2, Math.floor(h / 4));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      pxRect(ctx, x + 2 + col * ((w - 4) / cols), y + 2 + row * ((h - 4) / rows), Math.max(2, (w - 4) / cols - 1), Math.max(1, (h - 4) / rows - 1), "#3a4356");
    }
  }
}

function spritePlantSmall(ctx, x, y, options = {}) {
  const scale = options.scale ?? 1;
  const potW = 14 * scale;
  const potH = 10 * scale;
  pxRect(ctx, x, y, potW, potH, PALETTE_V3.pot);
  pxRect(ctx, x, y, potW, 2 * scale, PALETTE_V3.potDark);
  pxRect(ctx, x + potW - 2 * scale, y, 2 * scale, potH, PALETTE_V3.potDark);
  const cx = x + potW / 2;
  const leaf = options.leaf ?? PALETTE_V3.plant;
  const leaf2 = options.leaf2 ?? PALETTE_V3.plantHi;
  pxRect(ctx, cx - 1 * scale, y - 12 * scale, 2 * scale, 12 * scale, PALETTE_V3.plantDark);
  const leaves = [
    [-8, -12, 6, 3, leaf], [2, -16, 7, 3, leaf2], [-6, -20, 6, 3, leaf],
    [2, -10, 6, 3, leaf2], [-8, -8, 5, 2, leaf2],
  ];
  for (const [dx, dy, lw, lh, color] of leaves) pxRect(ctx, cx + dx * scale, y + dy * scale, lw * scale, lh * scale, color);
}

function spritePlantLarge(ctx, x, y, options = {}) {
  const scale = options.scale ?? 1;
  const potW = 20 * scale;
  const potH = 14 * scale;
  pxRect(ctx, x, y, potW, potH, PALETTE_V3.pot);
  pxRect(ctx, x, y, potW, 3 * scale, PALETTE_V3.potDark);
  pxRect(ctx, x + potW - 3 * scale, y, 3 * scale, potH, PALETTE_V3.potDark);
  const cx = x + potW / 2;
  pxRect(ctx, cx - 2 * scale, y - 30 * scale, 4 * scale, 30 * scale, PALETTE_V3.plantDark);
  const leaf = options.leaf ?? PALETTE_V3.plant;
  const leaf2 = options.leaf2 ?? PALETTE_V3.plantHi;
  const leaves = [
    [-14, -26, 10, 5, leaf], [3, -32, 11, 5, leaf2], [-12, -38, 9, 5, leaf2],
    [4, -20, 10, 5, leaf], [-16, -16, 9, 4, leaf2], [2, -12, 9, 4, leaf],
    [-9, -46, 8, 5, leaf2], [0, -50, 8, 4, leaf],
  ];
  for (const [dx, dy, lw, lh, color] of leaves) pxRect(ctx, cx + dx * scale, y + dy * scale, lw * scale, lh * scale, color);
}

function spriteLamp(ctx, x, y, options = {}) {
  const height = options.height ?? 46;
  const color = options.color ?? PALETTE_V3.amber;
  lightPool(ctx, x, y - height + 8, options.pool ?? 56, color, options.alpha ?? 0.16);
  pxRect(ctx, x - 2, y - 3, 5, 3, PALETTE_V3.metalDark);
  pxRect(ctx, x - 1, y - height, 2, height - 3, PALETTE_V3.metalDark);
  pxRect(ctx, x - 8, y - height, 17, 8, color);
  pxRect(ctx, x - 8, y - height, 17, 1, PALETTE_V3.goldHi);
  pxRect(ctx, x - 8, y - height + 7, 17, 1, PALETTE_V3.amberSoft);
}

function spriteWallSconce(ctx, x, y, options = {}) {
  const color = options.color ?? PALETTE_V3.amber;
  lightPool(ctx, x, y + 10, options.pool ?? 44, color, options.alpha ?? 0.13);
  pxRect(ctx, x - 2, y - 3, 4, 5, PALETTE_V3.goldDark);
  pxRect(ctx, x - 7, y + 3, 15, 4, color);
  pxRect(ctx, x - 7, y + 3, 15, 1, PALETTE_V3.goldHi);
}

function spriteCeilingLamp(ctx, x, y, options = {}) {
  const w = options.w ?? 60;
  const color = options.color ?? "#fff0d0";
  lightPool(ctx, x, y + 6, options.pool ?? Math.round(w * 1.2), PALETTE_V3.amber, options.alpha ?? 0.15);
  pxRect(ctx, x - 3, y - 8, w + 6, 4, "#2e2116");
  pxRect(ctx, x - 3, y - 8, w + 6, 1, "#5a4028");
  pxRect(ctx, x, y - 4, w, 7, color);
  pxRect(ctx, x, y - 4, w, 1, "#fffaf0");
  pxRect(ctx, x + 2, y - 1, w - 4, 3, "#fff8e6");
  pxRect(ctx, x, y + 2, w, 1, "#b8823f");
}

function spriteSofa(ctx, x, y, options = {}) {
  const w = options.w ?? 160;
  const h = options.h ?? 44;
  const back = options.color ?? PALETTE_V3.sofa;
  const outline = options.outline ?? PALETTE_V3.sofaDark;
  const cushion = options.color3 ?? PALETTE_V3.sofaHi;
  const armW = Math.max(10, Math.round(w * 0.08));
  const backH = Math.round(h * 0.5);
  const seatY = y + backH;
  const seatH = Math.max(6, Math.round(h * 0.3));
  const baseY = seatY + seatH;
  const baseH = Math.max(2, y + h - baseY);
  pxRect(ctx, x + 4, y + h, w - 8, 3, "rgba(0,0,0,0.35)");
  pxRect(ctx, x + armW - 2, y, w - (armW - 2) * 2, backH, back);
  pxRect(ctx, x + armW - 2, y, w - (armW - 2) * 2, 1, cushion);
  pxRect(ctx, x + armW - 2, y, 1, backH, outline);
  pxRect(ctx, x + w - armW + 1, y, 1, backH, outline);
  pxRect(ctx, x + Math.round(w / 2), y + 3, 1, backH - 5, outline);
  const armTop = y + Math.round(backH * 0.45);
  const armH = y + h - armTop - baseH;
  pxRect(ctx, x, armTop, armW, armH, back);
  pxRect(ctx, x, armTop, armW, 1, cushion);
  pxRect(ctx, x, armTop, 1, armH, outline);
  pxRect(ctx, x + w - armW, armTop, armW, armH, back);
  pxRect(ctx, x + w - armW, armTop, armW, 1, cushion);
  pxRect(ctx, x + w - 1, armTop, 1, armH, outline);
  pxRect(ctx, x + armW, seatY, w - armW * 2, seatH, cushion);
  pxRect(ctx, x + armW, seatY, w - armW * 2, 1, back);
  pxRect(ctx, x + armW, seatY + seatH - 1, w - armW * 2, 1, outline);
  const cushions = Math.max(2, Math.floor(w / 40));
  for (let index = 1; index < cushions; index += 1) {
    const cx = x + armW + Math.round((w - armW * 2) * (index / cushions));
    pxRect(ctx, cx, seatY + 1, 1, seatH - 2, outline);
  }
  pxRect(ctx, x + 3, baseY, w - 6, baseH, outline);
  pxRect(ctx, x + 3, baseY, w - 6, 1, "#8f7c5a");
}

function spriteArmchair(ctx, x, y, options = {}) {
  const w = options.w ?? 44;
  const h = options.h ?? 42;
  const back = options.color ?? PALETTE_V3.sofa;
  const outline = options.outline ?? PALETTE_V3.sofaDark;
  const cushion = options.color3 ?? PALETTE_V3.sofaHi;
  const armW = 9;
  const backH = Math.round(h * 0.55);
  const seatY = y + backH;
  const seatH = Math.max(6, Math.round(h * 0.28));
  const baseY = seatY + seatH;
  const baseH = Math.max(2, y + h - baseY);
  pxRect(ctx, x + 3, y + h, w - 6, 3, "rgba(0,0,0,0.35)");
  pxRect(ctx, x + 3, y, w - 6, backH, back);
  pxRect(ctx, x + 3, y, w - 6, 1, cushion);
  pxRect(ctx, x + 3, y, 1, backH, outline);
  pxRect(ctx, x + w - 4, y, 1, backH, outline);
  const armTop = y + Math.round(backH * 0.5);
  const armH = y + h - armTop - baseH;
  pxRect(ctx, x, armTop, armW, armH, back);
  pxRect(ctx, x, armTop, armW, 1, cushion);
  pxRect(ctx, x, armTop, 1, armH, outline);
  pxRect(ctx, x + w - armW, armTop, armW, armH, back);
  pxRect(ctx, x + w - armW, armTop, armW, 1, cushion);
  pxRect(ctx, x + w - 1, armTop, 1, armH, outline);
  pxRect(ctx, x + armW, seatY, w - armW * 2, seatH, cushion);
  pxRect(ctx, x + armW, seatY, w - armW * 2, 1, back);
  pxRect(ctx, x + armW, seatY + seatH - 1, w - armW * 2, 1, outline);
  pxRect(ctx, x + 3, baseY, w - 6, baseH, outline);
  pxRect(ctx, x + 5, y + h - 1, 3, 1, PALETTE_V3.woodShadow);
  pxRect(ctx, x + w - 8, y + h - 1, 3, 1, PALETTE_V3.woodShadow);
}

function spriteCoffeeTable(ctx, x, y, options = {}) {
  const w = options.w ?? 90;
  const h = options.h ?? 22;
  pxRect(ctx, x + 2, y + h, w - 4, 3, "rgba(0,0,0,0.3)");
  pxRect(ctx, x, y, w, Math.round(h * 0.5), PALETTE_V3.wood);
  pxRect(ctx, x, y, w, 1, PALETTE_V3.woodHi);
  pxRect(ctx, x + 3, y + Math.round(h * 0.5), 3, Math.round(h * 0.5), PALETTE_V3.woodDark);
  pxRect(ctx, x + w - 6, y + Math.round(h * 0.5), 3, Math.round(h * 0.5), PALETTE_V3.woodDark);
  if (options.items !== false) {
    pxRect(ctx, x + 10, y - 5, 4, 5, PALETTE_V3.white);
    pxRect(ctx, x + w - 20, y - 4, 8, 4, PALETTE_V3.metalDark);
  }
}

function spritePoolTable(ctx, x, y, options = {}) {
  const w = options.w ?? 160;
  const h = options.h ?? 78;
  const frame = options.frame ?? PALETTE_V3.woodMid;
  const rail = options.rail ?? PALETTE_V3.wood;
  pxRect(ctx, x + 4, y + h, w - 8, 3, PALETTE_V3.shadow);
  pxRect(ctx, x, y, w, h, frame);
  pxRect(ctx, x + 3, y + 3, w - 6, h - 6, rail);
  pxRect(ctx, x + 8, y + 8, w - 16, h - 16, PALETTE_V3.felt);
  pxRect(ctx, x + 8, y + 8, w - 16, 1, PALETTE_V3.feltDark);
  const pockets = [[11, 11], [w / 2, 10], [w - 11, 11], [11, h - 11], [w / 2, h - 10], [w - 11, h - 11]];
  for (const [px, py] of pockets) pxRect(ctx, x + px - 3, y + py - 3, 6, 6, "#0c0c0c");
  const ballColors = ["#f4f4f4", "#e04b3a", "#f0b429", "#1f4f8f", "#2f7d4f", "#6a3fb0", "#e07a3a"];
  const spots = [[0.3, 0.4], [0.45, 0.5], [0.6, 0.4], [0.52, 0.62], [0.7, 0.55], [0.38, 0.6]];
  spots.forEach(([fx, fy], index) => pxRect(ctx, x + 8 + (w - 16) * fx, y + 8 + (h - 16) * fy, 4, 4, ballColors[index % ballColors.length]));
  pxRect(ctx, x + w - 26, y + h - 14, 20, 1, PALETTE_V3.woodShadow);
}

function spriteKitchenCounter(ctx, x, y, options = {}) {
  const w = options.w ?? 120;
  const h = options.h ?? 48;
  pxRect(ctx, x + 2, y + h, w - 4, 2, "rgba(0,0,0,0.35)");
  pxRect(ctx, x, y, w, 6, PALETTE_V3.metal);
  pxRect(ctx, x, y, w, 1, PALETTE_V3.metalHi);
  pxRect(ctx, x, y + 6, w, h - 6, PALETTE_V3.metalDark);
  const cabinets = Math.max(2, Math.floor(w / 26));
  for (let index = 1; index < cabinets; index += 1) pxRect(ctx, x + Math.round((w * index) / cabinets), y + 6, 1, h - 6, PALETTE_V3.metal);
  for (let index = 0; index < cabinets; index += 1) pxRect(ctx, x + Math.round((w * index) / cabinets) + 8, y + 12, 8, 1, PALETTE_V3.metal);
  pxRect(ctx, x + 10, y - 6, 10, 6, PALETTE_V3.metalDark);
  pxRect(ctx, x + 11, y - 5, 8, 2, PALETTE_V3.metal);
}

function spriteFridge(ctx, x, y, options = {}) {
  const w = options.w ?? 40;
  const h = options.h ?? 72;
  pxRect(ctx, x, y, w, h, "#b8c0c8");
  pxRect(ctx, x, y, w, 1, "#dde4ea");
  pxRect(ctx, x, y + Math.round(h * 0.32), w, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + w - 6, y + 4, 3, Math.round(h * 0.32) - 6, PALETTE_V3.metalDark);
  pxRect(ctx, x + w - 6, y + Math.round(h * 0.32) + 4, 3, Math.round(h * 0.6), PALETTE_V3.metalDark);
  pxRect(ctx, x, y + h - 1, w, 1, PALETTE_V3.metalDark);
}

function spriteBookshelf(ctx, x, y, options = {}) {
  const w = options.w ?? 60;
  const h = options.h ?? 90;
  pxRect(ctx, x, y, w, h, PALETTE_V3.woodDark);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 2, PALETTE_V3.woodMid);
  pxRect(ctx, x + 1, y + 1, w - 2, 1, PALETTE_V3.wood);
  const shelves = options.shelves ?? 3;
  const shelfH = Math.floor((h - 4) / shelves);
  const bookColors = ["#c94b3a", "#3a6bc9", "#3fa85f", "#e0a03a", "#8a5ac9", "#3fb0b0", "#c9c0a0", "#d96a3a"];
  const seed = options.seed ?? 1;
  for (let shelf = 0; shelf < shelves; shelf += 1) {
    const sy = y + 2 + shelf * shelfH;
    pxRect(ctx, x + 2, sy + shelfH - 2, w - 4, 2, PALETTE_V3.woodDark);
    let bx = x + 3;
    let index = 0;
    while (bx < x + w - 5) {
      const bw = 3 + ((seed + shelf * 7 + index * 3) % 4);
      const bh = shelfH - 6 - ((seed + index) % 3);
      pxRect(ctx, bx, sy + shelfH - 2 - bh, bw, bh, bookColors[(seed + shelf + index) % bookColors.length]);
      pxRect(ctx, bx, sy + shelfH - 2 - bh, bw, 1, "rgba(255,255,255,0.2)");
      bx += bw + 1;
      index += 1;
    }
  }
}

function spriteWhiteboard(ctx, x, y, options = {}) {
  const w = options.w ?? 110;
  const h = options.h ?? 64;
  pxRect(ctx, x, y, w, h, PALETTE_V3.metalDark);
  pxRect(ctx, x + 2, y + 2, w - 4, h - 4, "#e8ecef");
  pxRect(ctx, x + 2, y + 2, w - 4, 1, PALETTE_V3.white);
  pxRect(ctx, x + 8, y + 10, 34, 3, PALETTE_V3.bandBlue);
  pxRect(ctx, x + 8, y + 20, 58, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + 8, y + 28, 44, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + 8, y + 36, 50, 2, PALETTE_V3.metalDark);
  pxRect(ctx, x + w - 30, y + 12, 18, 14, PALETTE_V3.green);
  pxRect(ctx, x + w - 30, y + 12, 18, 1, PALETTE_V3.plantHi);
  pxRect(ctx, x + 6, y + h - 8, 14, 3, PALETTE_V3.red);
  pxRect(ctx, x + 24, y + h - 8, 14, 3, PALETTE_V3.screenOn);
}

function spritePoster(ctx, x, y, options = {}) {
  const w = options.w ?? 44;
  const h = options.h ?? 56;
  pxRect(ctx, x, y, w, h, PALETTE_V3.woodDark);
  pxRect(ctx, x + 2, y + 2, w - 4, h - 4, options.bg ?? "#12233f");
  pxRect(ctx, x + 2, y + 2, w - 4, 1, "rgba(255,255,255,0.1)");
  const seed = options.seed ?? 0;
  const accents = [PALETTE_V3.goldHi, PALETTE_V3.screenOn, PALETTE_V3.green, PALETTE_V3.red];
  pxRect(ctx, x + 6, y + 8, w - 12, 4, accents[seed % accents.length]);
  pxRect(ctx, x + 6, y + 18, w - 16, 2, PALETTE_V3.metal);
  pxRect(ctx, x + 6, y + 24, w - 20, 2, PALETTE_V3.metal);
  pxRect(ctx, x + 6, y + 30, w - 14, 2, PALETTE_V3.metal);
  pxRect(ctx, x + 6, y + h - 14, w - 12, 8, accents[(seed + 2) % accents.length]);
}

function spriteStairs(ctx, x, y, options = {}) {
  const w = options.w ?? 120;
  const h = options.h ?? 110;
  const direction = options.direction ?? "right";
  const steps = options.steps ?? 8;
  const stepW = w / steps;
  const stepH = h / steps;
  const rising = direction === "right";
  pxRect(ctx, x + 3, y + h, w - 6, 3, "rgba(0,0,0,0.35)");
  const apexX = rising ? x + w : x;
  const baseLeft = rising ? x : x + w;
  pxPoly(ctx, [{ x: baseLeft, y: y + h }, { x: apexX, y: y + h }, { x: apexX, y }], PALETTE_V3.woodMid);
  for (let index = 0; index < steps; index += 1) {
    const level = rising ? index : steps - 1 - index;
    const sx = x + index * stepW;
    const sy = y + h - (level + 1) * stepH;
    pxRect(ctx, sx, sy, stepW, stepH, PALETTE_V3.woodDark);
    pxRect(ctx, sx, sy, stepW, 2, PALETTE_V3.woodHi);
    pxRect(ctx, sx, sy + 2, stepW, Math.max(1, stepH - 2), PALETTE_V3.wood);
    pxRect(ctx, sx, sy + stepH - 1, stepW, 1, PALETTE_V3.woodShadow);
  }
  if (rising) pxLine(ctx, x, y + h, x + w, y, PALETTE_V3.woodShadow, 2);
  else pxLine(ctx, x, y, x + w, y + h, PALETTE_V3.woodShadow, 2);
}

function spriteDivider(ctx, x, y, options = {}) {
  const w = options.w ?? 16;
  const h = options.h ?? 90;
  pxRect(ctx, x, y, w, h, PALETTE_V3.woodDark);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 2, "#2a3a52");
  pxRect(ctx, x + 1, y + 1, w - 2, 1, "rgba(255,255,255,0.08)");
  for (let py = y + 6; py < y + h - 4; py += 14) pxRect(ctx, x + 2, py, w - 4, 1, "rgba(0,0,0,0.3)");
  pxRect(ctx, x - 2, y + h, w + 4, 3, "rgba(0,0,0,0.3)");
}

function spriteWaterCooler(ctx, x, y, options = {}) {
  const w = options.w ?? 24;
  const h = options.h ?? 50;
  pxRect(ctx, x + 2, y + h, w - 4, 2, "rgba(0,0,0,0.3)");
  pxRect(ctx, x, y + 16, w, h - 16, "#c8d0d8");
  pxRect(ctx, x, y + 16, w, 1, PALETTE_V3.white);
  pxRect(ctx, x + 2, y + 4, w - 4, 14, "#8fd0e8");
  pxRect(ctx, x + 3, y + 5, w - 6, 11, "#b8e8f8");
  pxRect(ctx, x + 3, y + 5, 3, 11, "rgba(255,255,255,0.5)");
  pxRect(ctx, x + 4, y + 20, 5, 4, PALETTE_V3.bandBlue);
  pxRect(ctx, x + w - 9, y + 20, 5, 4, PALETTE_V3.red);
}

function spriteServerRack(ctx, x, y, options = {}) {
  const w = options.w ?? 34;
  const h = options.h ?? 70;
  pxRect(ctx, x, y, w, h, "#141c2e");
  pxRect(ctx, x, y, w, 1, PALETTE_V3.metalDark);
  pxRect(ctx, x + w - 1, y, 1, h, "#0a0f1a");
  for (let unit = 0; unit < 6; unit += 1) {
    const uy = y + 4 + unit * 11;
    pxRect(ctx, x + 3, uy, w - 6, 8, "#1f2941");
    pxRect(ctx, x + 3, uy, w - 6, 1, "rgba(255,255,255,0.05)");
    pxRect(ctx, x + 5, uy + 3, 3, 3, unit % 2 === 0 ? PALETTE_V3.screenGreen : PALETTE_V3.amber);
    pxRect(ctx, x + w - 8, uy + 3, 3, 3, PALETTE_V3.screenOn);
  }
}

function spriteWindow(ctx, x, y, options = {}) {
  const w = options.w ?? 80;
  const h = options.h ?? 70;
  lightPool(ctx, x + w / 2, y + h / 2, options.pool ?? 90, PALETTE_V3.windowGlow, options.alpha ?? 0.12);
  pxRect(ctx, x, y, w, h, PALETTE_V3.woodDark);
  pxRect(ctx, x + 3, y + 3, w - 6, h - 6, "#0a1c30");
  // night skyline
  for (let index = 0; index < Math.floor(w / 12); index += 1) {
    const bh = 14 + ((index * 7) % Math.max(10, h - 18));
    pxRect(ctx, x + 4 + index * 12, y + h - 4 - bh, 10, bh, index % 2 === 0 ? "#12283f" : "#0f2136");
  }
  for (let index = 0; index < Math.floor(w / 7); index += 1) {
    pxRect(ctx, x + 6 + (index * 11) % (w - 12), y + 8 + (index * 9) % (h - 20), 2, 2, PALETTE_V3.amber);
  }
  // frame cross
  pxRect(ctx, x + Math.round(w / 2) - 1, y + 3, 3, h - 6, PALETTE_V3.woodDark);
  pxRect(ctx, x + 3, y + Math.round(h / 2) - 1, w - 6, 3, PALETTE_V3.woodDark);
}

function spriteResearchDesk(ctx, x, y, options = {}) {
  spriteWoodDesk(ctx, x, y, { ...options, plaque: options.plaque ?? null });
  pxRect(ctx, x + 6, y - 5, 16, 5, PALETTE_V3.white);
  pxRect(ctx, x + 7, y - 4, 14, 1, PALETTE_V3.metalDark);
  pxRect(ctx, x + 26, y - 3, 10, 4, PALETTE_V3.ink);
  if (options.monitor !== false) spriteMonitor(ctx, x + (options.w ?? 150) - 34, y - 22, { w: 24, h: 18 });
}

/* ------------------------------------------------------------------ *
 * 7. SPRITE DISPATCH
 * ------------------------------------------------------------------ */

const SPRITE_DISPATCH = {
  wood_desk: spriteWoodDesk,
  research_desk: spriteResearchDesk,
  chair: spriteChair,
  monitor: spriteMonitor,
  computer_tower: spriteComputerTower,
  keyboard: spriteKeyboard,
  plant_small: spritePlantSmall,
  plant_large: spritePlantLarge,
  lamp: spriteLamp,
  wall_sconce: spriteWallSconce,
  ceiling_lamp: spriteCeilingLamp,
  sofa: spriteSofa,
  armchair: spriteArmchair,
  coffee_table: spriteCoffeeTable,
  pool_table: spritePoolTable,
  kitchen_counter: spriteKitchenCounter,
  fridge: spriteFridge,
  bookshelf: spriteBookshelf,
  whiteboard: spriteWhiteboard,
  poster: spritePoster,
  stairs: spriteStairs,
  divider: spriteDivider,
  water_cooler: spriteWaterCooler,
  server_rack: spriteServerRack,
  window: spriteWindow,
};

export function drawSprite(ctx, name, x, y, options = {}) {
  if (Object.prototype.hasOwnProperty.call(SPRITE_DISPATCH, name)) {
    const cached = tryDrawCachedSprite(ctx, name, x, y, options);
    if (cached !== null) return cached;
    return SPRITE_DISPATCH[name](ctx, x, y, options);
  }
  if (TILE_NAMES.includes(name)) return drawTile(ctx, name, x, y, options.w ?? 32, options.h ?? 32, options);
  return undefined;
}

/* ------------------------------------------------------------------ *
 * 8. CHARACTERS — 8 poses, deterministic variation
 * ------------------------------------------------------------------ */

function characterSpec(options = {}) {
  const seed = typeof options.seed === "number" ? options.seed : hashString(options.id ?? options.name ?? "agent");
  const random = mulberry32(seed);
  const skins = [PALETTE_V3.skin, PALETTE_V3.skin2, PALETTE_V3.skin3, PALETTE_V3.skin4];
  const hairs = [PALETTE_V3.hair1, PALETTE_V3.hair2, PALETTE_V3.hair3, PALETTE_V3.hair4, PALETTE_V3.hair5];
  const role = options.role ?? (options.shirt === PALETTE_V3.criticPurple ? "critic" : "trader");
  const isCritic = role === "critic";
  const isSupervisor = role === "supervisor";
  const shirt = options.shirt ?? (isSupervisor ? PALETTE_V3.screenWarn : isCritic ? PALETTE_V3.criticPurple : PALETTE_V3.traderNavy);
  const shirt2 = options.shirt2 ?? (isSupervisor ? PALETTE_V3.goldDark : isCritic ? PALETTE_V3.criticPurple2 : PALETTE_V3.traderNavy2);
  const hair = options.hair ?? hairs[Math.floor(random() * hairs.length) % hairs.length];
  return {
    seed,
    role,
    skin: options.skin ?? skins[Math.floor(random() * skins.length) % skins.length],
    hair,
    hairStyle: options.hairStyle ?? Math.floor(random() * 6) % 6,
    shirt,
    shirt2,
    pants: options.pants ?? (random() > 0.5 ? PALETTE_V3.pants : PALETTE_V3.pants2),
    shoe: options.shoe ?? PALETTE_V3.shoe,
    glasses: options.glasses ?? random() > 0.62,
    facialHair: options.facialHair ?? random() > 0.7,
    tie: options.tie !== undefined ? options.tie : isSupervisor ? PALETTE_V3.woodShadow : random() > 0.45 ? (isCritic ? PALETTE_V3.criticPurple2 : PALETTE_V3.tie) : null,
    height: options.height ?? (isCritic ? 34 : 35),
  };
}

function drawHair(ctx, spec, cx, top, width) {
  const hair = spec.hair;
  const half = Math.floor(width / 2);
  switch (spec.hairStyle) {
    case 0:
      pxRect(ctx, cx - half, top, width, 3, hair);
      pxRect(ctx, cx - half, top + 2, 2, 5, hair);
      pxRect(ctx, cx + half - 2, top + 2, 2, 5, hair);
      break;
    case 1:
      pxRect(ctx, cx - half, top - 1, width, 4, hair);
      pxRect(ctx, cx - half - 1, top + 1, 3, 7, hair);
      break;
    case 2:
      pxRect(ctx, cx - half, top, width, 4, hair);
      pxRect(ctx, cx - half - 1, top + 2, 2, 9, hair);
      pxRect(ctx, cx + half - 1, top + 2, 2, 9, hair);
      break;
    case 3:
      pxRect(ctx, cx - half + 1, top - 1, width - 2, 3, hair);
      pxRect(ctx, cx - half, top + 1, 3, 3, hair);
      pxRect(ctx, cx + half - 3, top + 1, 3, 3, hair);
      pxRect(ctx, cx - 2, top - 2, 4, 2, hair);
      break;
    case 4:
      pxRect(ctx, cx - half, top, width, 3, hair);
      pxRect(ctx, cx - half, top + 2, width, 2, hair);
      break;
    default:
      pxRect(ctx, cx - half, top - 1, width, 3, hair);
      pxRect(ctx, cx - half - 1, top + 2, 2, 4, hair);
      pxRect(ctx, cx + half - 1, top + 2, 2, 4, hair);
      break;
  }
}

function drawHead(ctx, spec, cx, top) {
  const skin = spec.skin;
  const face = "#2b2118";
  pxRect(ctx, cx - 5, top, 10, 11, skin);
  pxRect(ctx, cx - 6, top + 3, 1, 6, skin);
  pxRect(ctx, cx + 5, top + 3, 1, 6, skin);
  drawHair(ctx, spec, cx, top, 10);
  // brows + eyes
  pxRect(ctx, cx - 3, top + 4, 2, 1, spec.hair);
  pxRect(ctx, cx + 1, top + 4, 2, 1, spec.hair);
  pxRect(ctx, cx - 3, top + 5, 2, 2, face);
  pxRect(ctx, cx + 1, top + 5, 2, 2, face);
  pxRect(ctx, cx - 1, top + 7, 1, 2, "#b07a5a");
  pxRect(ctx, cx - 2, top + 9, 4, 1, "#8a4a3a");
  if (spec.facialHair) pxRect(ctx, cx - 3, top + 9, 6, 1, spec.hair);
  if (spec.glasses) {
    pxRect(ctx, cx - 5, top + 4, 4, 1, PALETTE_V3.metal);
    pxRect(ctx, cx + 1, top + 4, 4, 1, PALETTE_V3.metal);
    pxRect(ctx, cx - 5, top + 4, 1, 3, PALETTE_V3.metal);
    pxRect(ctx, cx - 2, top + 4, 1, 3, PALETTE_V3.metal);
    pxRect(ctx, cx + 1, top + 4, 1, 3, PALETTE_V3.metal);
    pxRect(ctx, cx + 4, top + 4, 1, 3, PALETTE_V3.metal);
    pxRect(ctx, cx - 1, top + 5, 2, 1, PALETTE_V3.metal);
  }
}

function drawLegs(ctx, spec, cx, base, mode, frame = 0) {
  const legTop = base - 13;
  if (mode === "walk") {
    const step = frame === 0 ? 3 : frame === 2 ? -3 : 0;
    const lift = frame === 1 ? 2 : frame === 3 ? 1 : 0;
    pxRect(ctx, cx - 4, legTop - (step > 0 ? lift : 0), 3, 11, spec.pants);
    pxRect(ctx, cx - 5 + step, base - 2, 4, 2, spec.shoe);
    pxRect(ctx, cx + 1, legTop - (step < 0 ? lift : 0), 3, 9 + (step === 0 ? 2 : 0), spec.pants);
    pxRect(ctx, cx + 2 - step, base - 3, 4, 2, spec.shoe);
  } else {
    pxRect(ctx, cx - 4, legTop, 3, 13, spec.pants);
    pxRect(ctx, cx + 1, legTop, 3, 13, spec.pants);
    pxRect(ctx, cx - 5, base - 2, 4, 2, spec.shoe);
    pxRect(ctx, cx + 1, base - 2, 4, 2, spec.shoe);
  }
}

function drawTorso(ctx, spec, cx, top, height) {
  const width = 12;
  pxRect(ctx, cx - width / 2, top, width, height, spec.shirt);
  pxRect(ctx, cx - width / 2, top, width, 2, spec.shirt2);
  pxRect(ctx, cx - width / 2 - 1, top + 2, 1, height - 2, spec.shirt2);
  pxRect(ctx, cx + width / 2, top + 2, 1, height - 2, spec.shirt2);
  pxRect(ctx, cx - 2, top, 4, 2, spec.skin);
  if (spec.tie) {
    pxRect(ctx, cx - 1, top + 2, 2, 2, spec.tie);
    pxRect(ctx, cx - 1, top + 4, 2, height - 6, spec.tie);
  }
}

function drawArms(ctx, spec, cx, top, height, mode, frame = 0) {
  const shoulder = top + 2;
  const armH = height - 3;
  const left = cx - 8;
  const right = cx + 6;
  if (mode === "talk") {
    pxRect(ctx, left, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, left, shoulder + armH, 3, 3, spec.skin);
    pxRect(ctx, right, shoulder - 6, 3, armH + 4, spec.shirt2);
    pxRect(ctx, right, shoulder - 8, 3, 3, spec.skin);
  } else if (mode === "coffee") {
    pxRect(ctx, left, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, left, shoulder + armH, 3, 3, spec.skin);
    pxRect(ctx, right, shoulder, 3, 5, spec.shirt2);
    pxRect(ctx, right - 3, shoulder + 5, 6, 3, spec.shirt2);
    pxRect(ctx, right - 3, shoulder + 8, 3, 3, spec.skin);
    pxRect(ctx, right - 4, shoulder + 7, 4, 3, PALETTE_V3.white);
  } else if (mode === "forward") {
    pxRect(ctx, left, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, left, shoulder + armH, 3, 3, spec.skin);
    pxRect(ctx, right, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, right, shoulder + armH, 3, 3, spec.skin);
  } else if (mode === "crossed") {
    pxRect(ctx, left, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, right, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, cx - 6, shoulder + 5, 12, 3, spec.shirt2);
    pxRect(ctx, cx - 2, shoulder + 5, 3, 3, spec.skin);
  } else if (mode === "pool") {
    pxRect(ctx, left, shoulder, 3, armH + 2, spec.shirt2);
    pxRect(ctx, right, shoulder, 3, armH + 2, spec.shirt2);
    pxRect(ctx, left, shoulder + armH + 2, 3, 3, spec.skin);
    pxRect(ctx, right, shoulder + armH + 2, 3, 3, spec.skin);
  } else if (mode === "walk") {
    const swing = frame === 0 ? 1 : frame === 2 ? -1 : 0;
    pxRect(ctx, left, shoulder + (swing > 0 ? 1 : 0), 3, armH, spec.shirt2);
    pxRect(ctx, left, shoulder + armH + (swing > 0 ? 1 : 0), 3, 3, spec.skin);
    pxRect(ctx, right, shoulder + (swing < 0 ? 1 : 0), 3, armH, spec.shirt2);
    pxRect(ctx, right, shoulder + armH + (swing < 0 ? 1 : 0), 3, 3, spec.skin);
  } else if (mode === "type") {
    const bob = frame % 2 === 0 ? 0 : 1;
    pxRect(ctx, left, shoulder + bob, 3, armH, spec.shirt2);
    pxRect(ctx, left + 1, shoulder + armH + bob, 2, 3, spec.skin);
    pxRect(ctx, right, shoulder + (bob === 0 ? 1 : 0), 3, armH, spec.shirt2);
    pxRect(ctx, right, shoulder + armH + (bob === 0 ? 1 : 0), 2, 3, spec.skin);
  } else {
    pxRect(ctx, left, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, left, shoulder + armH, 3, 3, spec.skin);
    pxRect(ctx, right, shoulder, 3, armH, spec.shirt2);
    pxRect(ctx, right, shoulder + armH, 3, 3, spec.skin);
  }
}

function drawStanding(ctx, spec, pose, options = {}) {
  const height = spec.height;
  const base = 0;
  const torsoTop = -height + 11;
  const torsoHeight = 12;
  const frame = ((Math.round(Number(options.frame) || 0) % 4) + 4) % 4;
  drawLegs(ctx, spec, 0, base, pose === "walk" ? "walk" : "stand", frame);
  drawTorso(ctx, spec, 0, torsoTop, torsoHeight);
  drawHead(ctx, spec, 0, -height);
  const armMode = pose === "walk" ? "walk" : pose === "talk" ? "talk" : pose === "coffee" ? "coffee" : pose === "observe" ? "crossed" : pose === "pool" ? "pool" : pose === "work" ? "forward" : "down";
  drawArms(ctx, spec, 0, torsoTop, torsoHeight, armMode, frame);
}

function drawSeated(ctx, spec, pose, options = {}) {
  // baseline (y=0) is the seat / desk line
  const torsoHeight = 17;
  const torsoTop = -torsoHeight - 1;
  const frame = ((Math.round(Number(options.frame) || 0) % 4) + 4) % 4;
  pxRect(ctx, -4, -7, 3, 7, spec.pants);
  pxRect(ctx, 1, -7, 3, 7, spec.pants);
  drawTorso(ctx, spec, 0, torsoTop, torsoHeight);
  drawHead(ctx, spec, 0, torsoTop - 11);
  drawArms(ctx, spec, 0, torsoTop, torsoHeight, pose === "work" ? "type" : "down", frame);
}

function drawGroundShadow(ctx, spec, pose) {
  if (pose === "sit" || pose === "work") {
    pxRect(ctx, -8, -1, 16, 2, "rgba(0,0,0,0.28)");
  } else {
    pxRect(ctx, -7, -2, 14, 2, "rgba(0,0,0,0.3)");
    pxRect(ctx, -4, 0, 8, 1, "rgba(0,0,0,0.18)");
  }
}

function characterCacheKey(normalized, spec, options) {
  return [
    "char",
    normalized,
    spec.seed,
    spec.skin,
    spec.hair,
    spec.hairStyle,
    spec.shirt,
    spec.shirt2,
    spec.pants,
    spec.shoe,
    spec.glasses ? 1 : 0,
    spec.facialHair ? 1 : 0,
    spec.tie ?? "",
    spec.height,
    spec.role,
    Math.round(Number(options.frame) || 0),
    Number(options.facing) < 0 ? -1 : 1,
  ].join("|");
}

function renderCharacterBody(ctx, normalized, spec, options) {
  const scale = options.scale ?? 1;
  const facing = Number(options.facing) < 0 ? -1 : 1;
  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);
  if (facing < 0) ctx.scale(-1, 1);
  drawGroundShadow(ctx, spec, normalized);
  if (normalized === "sit" || normalized === "work") drawSeated(ctx, spec, normalized, options);
  else drawStanding(ctx, spec, normalized, options);
  ctx.restore();
}

function tryDrawCachedCharacter(ctx, normalized, spec, x, y, options) {
  if (!hasCacheFactory()) return false;
  if ((options.scale ?? 1) !== 1) return false;
  const key = characterCacheKey(normalized, spec, options);
  let canvas = spriteCache.get(key);
  if (canvas === undefined) {
    const created = createCacheCanvas(CHARACTER_BOUNDS.right - CHARACTER_BOUNDS.left, CHARACTER_BOUNDS.bottom - CHARACTER_BOUNDS.top);
    if (!created) {
      spriteCacheStats.misses += 1;
      return false;
    }
    created.context.translate(-CHARACTER_BOUNDS.left, -CHARACTER_BOUNDS.top);
    renderCharacterBody(created.context, normalized, spec, { ...options, scale: 1 });
    canvas = created.canvas;
    spriteCache.set(key, canvas);
    spriteCacheStats.created += 1;
  }
  spriteCacheStats.hits += 1;
  ctx.drawImage(canvas, Math.round(x) + CHARACTER_BOUNDS.left, Math.round(y) + CHARACTER_BOUNDS.top);
  return true;
}

export function drawCharacter(ctx, pose, x, y, options = {}) {
  const normalized = CHARACTER_POSES.includes(pose) ? pose : "idle";
  const spec = characterSpec(options);
  if (tryDrawCachedCharacter(ctx, normalized, spec, x, y, options)) {
    return { pose: normalized, seed: spec.seed, role: spec.role, skin: spec.skin, hair: spec.hair, shirt: spec.shirt };
  }
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  renderCharacterBody(ctx, normalized, spec, options);
  ctx.restore();
  return { pose: normalized, seed: spec.seed, role: spec.role, skin: spec.skin, hair: spec.hair, shirt: spec.shirt };
}
