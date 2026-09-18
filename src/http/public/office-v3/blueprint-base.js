/**
 * TRACE/COM — PIXEL OFFICE V3 · BLUEPRINT BASE (hybrid static layer)
 *
 * The frozen reference artboard (1536x1024) is treated as the PRE-RENDERED
 * STATIC BASE layer. TraceCom draws only the DYNAMIC layers on top (see
 * `overlay.js`), aligned to the blueprint coordinates. This is the only
 * technique that can approach 100% visual identity for the static scene.
 *
 * Honest trade-off: the base image always shows painted agents. A CLOSED desk
 * cannot remove them, so the overlay scrims/tags the desk instead (see
 * docs/office-v3/blueprint-base.md). The dynamic art is ours.
 *
 * Dependency-free and DOM-guarded: browser uses `new Image()`, Node uses
 * `@napi-rs/canvas` `loadImage` (via createRequire) so headless tests/render
 * work without a DOM.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders, no stake.
 */

export const BASE_WIDTH = 1536;
export const BASE_HEIGHT = 1024;
export const BASE_MODES = Object.freeze(["reference", "procedural"]);
export const DEFAULT_BASE_MODE = "reference";
export const BASE_ASSET = "./blueprint-reference.png";
export const NODE_CANVAS_CANDIDATES = Object.freeze([
  "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas",
  "@napi-rs/canvas",
]);

/**
 * Authoritative config for the hybrid base layer. Overridable by env
 * `OFFICE_V3_BASE` and by URL query `?base=procedural` (see base-mode.js).
 */
export const OFFICE_V3_BASE = Object.freeze({
  mode: DEFAULT_BASE_MODE,
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  asset: BASE_ASSET,
  envKey: "OFFICE_V3_BASE",
  queryKey: "base",
  modes: BASE_MODES,
});

function hasDom() {
  return typeof document !== "undefined" && typeof Image !== "undefined";
}

function isNodeRuntime() {
  return typeof process !== "undefined" && !!(process.versions && process.versions.node);
}

async function resolveDefaultSource() {
  if (hasDom()) return BASE_ASSET;
  const { fileURLToPath } = await import("node:url");
  return fileURLToPath(new URL(BASE_ASSET, import.meta.url));
}

async function loadNodeImage(source) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  let canvasModule = null;
  for (const candidate of NODE_CANVAS_CANDIDATES) {
    try {
      canvasModule = require(candidate);
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (!canvasModule || typeof canvasModule.loadImage !== "function") {
    throw new Error("loadBlueprintBase: @napi-rs/canvas nao encontrado.");
  }
  return canvasModule.loadImage(source);
}

function loadDomImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`loadBlueprintBase: falha ao carregar ${source}`));
    image.src = source;
    if (image.complete && Number(image.naturalWidth) > 0) resolve(image);
  });
}

/**
 * Loads the frozen reference image handle.
 *
 * @param {string} [src] explicit path/URL; defaults to the served
 *   `blueprint-reference.png` (browser) or the same file on disk (Node).
 * @returns {Promise<any>} an image handle usable with `drawImage`.
 */
export async function loadBlueprintBase(src) {
  const source = src || (await resolveDefaultSource());
  if (hasDom()) return loadDomImage(source);
  if (isNodeRuntime()) return loadNodeImage(source);
  throw new Error("loadBlueprintBase: ambiente sem DOM e sem Node canvas.");
}

/**
 * Draws the reference at exactly 1536x1024 — no scaling, no blur, no crop.
 * Returns false when ctx/base are missing so callers can fall back safely.
 */
export function drawBlueprintBase(ctx, base) {
  if (!ctx || !base || typeof ctx.drawImage !== "function") return false;
  const naturalWidth = Number(base.naturalWidth || base.width) || 0;
  const naturalHeight = Number(base.naturalHeight || base.height) || 0;
  if (typeof ctx.imageSmoothingEnabled !== "undefined") ctx.imageSmoothingEnabled = false;
  if (naturalWidth === BASE_WIDTH && naturalHeight === BASE_HEIGHT) {
    ctx.drawImage(base, 0, 0);
  } else {
    ctx.drawImage(base, 0, 0, BASE_WIDTH, BASE_HEIGHT);
  }
  return true;
}

export default {
  BASE_WIDTH,
  BASE_HEIGHT,
  BASE_MODES,
  DEFAULT_BASE_MODE,
  BASE_ASSET,
  OFFICE_V3_BASE,
  loadBlueprintBase,
  drawBlueprintBase,
};
