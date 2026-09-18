/**
 * TRACE/COM — PIXEL OFFICE V3 · PIXEL ASSET PACK (runtime loader)
 *
 * Loads the original TraceCom pixel-art pack from `/assets/office` (manifests +
 * PNGs) and exposes sprites/agent sprites to the office-v3 renderer. Rendering
 * only: no trading logic, no orders, PRACTICE only, ZERO REAL.
 *
 * The loader is fully guarded. When `fetch`/`Image` are unavailable (Node tests,
 * jsdom) or any manifest/PNG fails, it resolves to `null` and every consumer
 * keeps its procedural fallback — the screen must never break.
 *
 * Public contract:
 *   loadPixelAssets(options) -> Promise<PixelAssetRegistry|null>
 *   pickTraderSpriteId(marketKey, marketType) -> string
 *   pickAgentSpriteId(role, marketKey, marketType) -> string
 *
 * Registry API (all guarded):
 *   ready, counts, list(category), has(id), manifest(id), image(id),
 *   sprite(id), agent(id), agentFor(key, id), agentsByRole(role),
 *   draw(ctx, id, {x,y,scale,flip,alpha}) -> boolean
 */

export const PIXEL_ASSETS_VERSION = "office-v3-pixel-assets.1.0.0";
export const DEFAULT_PIXEL_ASSET_BASE = "/assets/office";
export const PIXEL_ASSET_IDS = Object.freeze({
  desk: "desk_trading",
  chair: "chair_office",
  monitor: "prop_monitor",
  mug: "prop_mug",
  nameplate: "nameplate_wood",
  stationPlate: "station_plate",
});

const TRADER_SPRITES = ["agent_trader_blue", "agent_trader_amber", "agent_trader_teal"];
const CRITIC_SPRITE = "agent_critic";

function hashString(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic trader art per market (stable across reloads). */
export function pickTraderSpriteId(marketKey, marketType = null) {
  const token = String(marketType ?? "").toUpperCase();
  const key = String(marketKey ?? "");
  const isOtc = token === "OTC" || /:OTC$/i.test(key) || /OTC/i.test(key);
  const seed = hashString(key);
  if (isOtc) return seed % 2 === 0 ? "agent_trader_amber" : "agent_trader_blue";
  return TRADER_SPRITES[seed % TRADER_SPRITES.length] ?? "agent_trader_blue";
}

export function pickAgentSpriteId(role, marketKey, marketType = null) {
  if (String(role) === "critic") return CRITIC_SPRITE;
  return pickTraderSpriteId(marketKey, marketType);
}

/* ------------------------------------------------------------------ *
 * Low-level draw helpers (pixel-perfect, no smoothing)
 * ------------------------------------------------------------------ */

function drawSnapped(ctx, img, manifest, { x, y, scale, flip, alpha }) {
  if (!ctx || !img || !manifest) return false;
  const width = Math.max(1, Math.round((manifest.width ?? img.width) * scale));
  const height = Math.max(1, Math.round((manifest.height ?? img.height) * scale));
  const anchorX = Number.isFinite(Number(manifest.anchor?.x)) ? Number(manifest.anchor.x) : width / 2;
  const anchorY = Number.isFinite(Number(manifest.anchor?.y)) ? Number(manifest.anchor.y) : height;
  const dx = Math.round(x - anchorX * scale);
  const dy = Math.round(y - anchorY * scale);
  ctx.save();
  if (typeof alpha === "number" && alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
  ctx.imageSmoothingEnabled = false;
  try {
    if (flip) {
      ctx.translate(dx + width, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, width, height);
    } else {
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, width, height);
    }
  } finally {
    ctx.restore();
  }
  return true;
}

const DIR_ROWS = Object.freeze({ front: 0, side: 1, back: 2 });

export class PixelSprite {
  constructor(registry, manifest) {
    this.registry = registry;
    this.manifest = manifest;
    this.id = manifest.id;
  }

  get image() {
    return this.registry.image(this.id);
  }

  draw(ctx, { x, y, scale = 1, flip = false, alpha = 1 } = {}) {
    const img = this.image;
    if (!img || !this.manifest) return false;
    return drawSnapped(ctx, img, this.manifest, { x, y, scale, flip, alpha });
  }
}

export class PixelAgentSprite extends PixelSprite {
  constructor(registry, manifest) {
    super(registry, manifest);
    this.state = "idle";
    this.dir = "front";
    this.startedAt = 0;
  }

  setState(state, dir = null) {
    const animations = this.manifest?.animations ?? {};
    const nextState = animations[state] ? state : this.state in animations ? this.state : "idle";
    const nextDir = dir && DIR_ROWS[dir] !== undefined ? dir : this.dir;
    if (this.state === nextState && this.dir === nextDir) return;
    this.state = nextState;
    this.dir = nextDir;
    this.startedAt = this.lastNow ?? 0;
  }

  frame(now = 0) {
    const animations = this.manifest?.animations ?? {};
    const anim = animations[this.state] ?? animations.idle;
    if (!anim) return { col: 0, row: DIR_ROWS[this.dir] ?? 0 };
    const frames = Math.max(1, Number(anim.frames) || 1);
    const fps = Math.max(0.001, Number(anim.fps) || 1);
    const elapsed = Math.max(0, Number(now) - (Number(this.startedAt) || 0));
    const raw = Math.floor((elapsed / 1000) * fps);
    const index = anim.loop === false ? Math.min(frames - 1, raw) : raw % frames;
    return { col: (Number(anim.start) || 0) + index + (Number(anim.col) || 0), row: DIR_ROWS[this.dir] ?? 0 };
  }

  draw(ctx, { x, y, scale = 1, state = null, dir = null, now = 0, flip = null, alpha = 1 } = {}) {
    if (!ctx || !this.manifest) return false;
    const animations = this.manifest.animations ?? {};
    if (state) this.setState(state, dir);
    else if (dir) this.setState(this.state, dir);
    this.lastNow = Number(now) || 0;
    const img = this.image;
    if (!img) return false;
    const { col, row } = this.frame(now);
    const frameWidth = Number(this.manifest.frameWidth) || 32;
    const frameHeight = Number(this.manifest.frameHeight) || 48;
    const mirrored = flip === true;
    const width = Math.max(1, Math.round(frameWidth * scale));
    const height = Math.max(1, Math.round(frameHeight * scale));
    const anchorX = Number.isFinite(Number(this.manifest.anchor?.x)) ? Number(this.manifest.anchor.x) : frameWidth / 2;
    const anchorY = Number.isFinite(Number(this.manifest.anchor?.y)) ? Number(this.manifest.anchor.y) : frameHeight;
    const dx = Math.round(x - anchorX * scale);
    const dy = Math.round(y - anchorY * scale);
    ctx.save();
    if (typeof alpha === "number" && alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
    ctx.imageSmoothingEnabled = false;
    try {
      if (mirrored) {
        ctx.translate(dx + width, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(img, col * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, width, height);
      } else {
        ctx.drawImage(img, col * frameWidth, row * frameHeight, frameWidth, frameHeight, dx, dy, width, height);
      }
    } finally {
      ctx.restore();
    }
    return true;
  }
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export class PixelAssetRegistry {
  constructor({ base, index, manifests, images }) {
    this.version = PIXEL_ASSETS_VERSION;
    this.base = base;
    this.index = index;
    this.ready = true;
    this.byId = new Map();
    this.images = images instanceof Map ? images : new Map();
    for (const manifest of Array.isArray(manifests) ? manifests : []) {
      if (manifest && manifest.id) this.byId.set(manifest.id, manifest);
    }
    this.spriteCache = new Map();
    this.agentVariantCache = new Map();
    this.counts = Object.freeze(
      [...(Array.isArray(manifests) ? manifests : [])].reduce((accumulator, manifest) => {
        const category = manifest?.category ?? "unknown";
        accumulator[category] = (accumulator[category] ?? 0) + 1;
        return accumulator;
      }, {}),
    );
    this.agentVariants = this.list("agents");
  }

  list(category = null) {
    const all = [...this.byId.values()];
    return category ? all.filter((manifest) => manifest.category === category) : all;
  }

  has(id) {
    return this.byId.has(id);
  }

  manifest(id) {
    return this.byId.get(id) ?? null;
  }

  image(id) {
    return this.images.get(id) ?? null;
  }

  sprite(id) {
    if (!this.has(id)) return null;
    if (!this.spriteCache.has(id)) this.spriteCache.set(id, new PixelSprite(this, this.manifest(id)));
    return this.spriteCache.get(id);
  }

  agent(id) {
    if (!this.has(id)) return null;
    if (!this.agentVariantCache.has(id)) this.agentVariantCache.set(id, new PixelAgentSprite(this, this.manifest(id)));
    return this.agentVariantCache.get(id);
  }

  /** Cached agent sprite per consumer key (one animation clock per rendered agent). */
  agentFor(key, id) {
    const cacheKey = `${key}|${id}`;
    if (!this.agentVariantCache.has(cacheKey)) {
      const sprite = this.agent(id);
      if (!sprite) return null;
      this.agentVariantCache.set(cacheKey, sprite);
    }
    return this.agentVariantCache.get(cacheKey);
  }

  agentsByRole(role) {
    return this.agentVariants.filter((manifest) => manifest.role === role);
  }

  /** Deterministic sprite id for a station role/market. */
  agentIdFor(role, marketKey, marketType = null) {
    return pickAgentSpriteId(role, marketKey, marketType);
  }

  /** Cached agent sprite for one station pair (stable animation clock). */
  agentForRole(role, marketKey, marketType, cacheKey = null) {
    const id = this.agentIdFor(role, marketKey, marketType);
    const key = cacheKey ?? `${marketKey}|${role}`;
    return this.agentFor(key, id);
  }

  draw(ctx, id, options = {}) {
    const sprite = this.sprite(id);
    if (!sprite) return false;
    return sprite.draw(ctx, options);
  }
}

/* ------------------------------------------------------------------ *
 * Loader
 * ------------------------------------------------------------------ */

function resolveFetch(options) {
  if (typeof options.fetchImpl === "function") return options.fetchImpl;
  if (typeof fetch === "function") return fetch.bind(globalThis);
  return null;
}

function resolveImageFactory(options) {
  if (typeof options.imageFactory === "function") return options.imageFactory;
  if (typeof Image === "function") {
    return (url) =>
      new Promise((resolve) => {
        const image = new Image();
        if ("decoding" in image) image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
      });
  }
  return null;
}

function loadImage(url, options, fetchImpl, imageFactory) {
  if (imageFactory) {
    try {
      return Promise.resolve(imageFactory(url));
    } catch {
      return Promise.resolve(null);
    }
  }
  if (!fetchImpl || typeof createImageBitmap !== "function") return Promise.resolve(null);
  return fetchImpl(url)
    .then((response) => (response && response.ok ? response.blob() : null))
    .then((blob) => (blob ? createImageBitmap(blob) : null))
    .catch(() => null);
}

/**
 * Load the whole pack. Never throws; resolves `null` when unavailable.
 *
 * @param {object} [options]
 * @param {string} [options.base="/assets/office"]
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.imageFactory] async (url) => imageLike|null
 * @param {boolean} [options.enabled=true]
 * @returns {Promise<PixelAssetRegistry|null>}
 */
export async function loadPixelAssets(options = {}) {
  if (options.enabled === false) return null;
  const base = String(options.base ?? DEFAULT_PIXEL_ASSET_BASE).replace(/\/+$/, "");
  const fetchImpl = resolveFetch(options);
  if (!fetchImpl) return null;
  const imageFactory = resolveImageFactory(options);
  try {
    const indexResponse = await fetchImpl(`${base}/manifests/office-assets.json`, { headers: { accept: "application/json" } });
    if (!indexResponse || !indexResponse.ok) return null;
    const index = await indexResponse.json();
    const paths = [];
    for (const list of Object.values(index?.categories ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const path of list) paths.push(String(path));
    }
    if (!paths.length) return null;
    const manifests = [];
    const loaded = await Promise.all(
      paths.map(async (path) => {
        try {
          const response = await fetchImpl(path.replace(/^\/assets\/office/, base), { headers: { accept: "application/json" } });
          if (response && response.ok) return await response.json();
        } catch {
          // one bad manifest never breaks the pack
        }
        return null;
      }),
    );
    for (const manifest of loaded) if (manifest && manifest.id) manifests.push(manifest);
    if (!manifests.length) return null;
    const images = new Map();
    await Promise.all(
      manifests.map(async (manifest) => {
        if (!manifest?.file) return;
        const url = `${base}/${manifest.category}/${manifest.id}/${manifest.file}`;
        const image = await loadImage(url, options, fetchImpl, imageFactory);
        if (image) images.set(manifest.id, image);
      }),
    );
    if (!images.size) return null;
    return new PixelAssetRegistry({ base, index, manifests, images });
  } catch {
    return null;
  }
}

export default {
  PIXEL_ASSETS_VERSION,
  DEFAULT_PIXEL_ASSET_BASE,
  PIXEL_ASSET_IDS,
  loadPixelAssets,
  pickTraderSpriteId,
  pickAgentSpriteId,
  PixelSprite,
  PixelAgentSprite,
  PixelAssetRegistry,
};
