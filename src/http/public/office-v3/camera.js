/**
 * OFFICE V3 — CAMERA (frontend/rendering only).
 *
 * Pan + clamped zoom + smooth zoom-to-desk (~400ms) + hover/click hit-testing.
 * Deliberately never auto-FITs the world to the viewport: the expanded world
 * (2560x1600) is bigger than the base viewport (1536x1024) and the user keeps
 * control. Pure ESM, no DOM dependency.
 */

export const CAMERA_VERSION = "office-v3-camera.1.1.0";
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.15;
export const WHEEL_LINE_HEIGHT = 16;
export const WHEEL_PAGE_HEIGHT = 400;
export const WHEEL_SENSITIVITY = 0.0016;
export const WHEEL_DELTA_LIMIT = 480;
export const ZOOM_TO_DESK_MS = 400;
export const OVERVIEW_WIDTH = 1536;
export const OVERVIEW_HEIGHT = 1024;
export const DESK_WIDTH = 118;
export const DESK_HEIGHT = 72;

function clampZoomValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Normalizes wheel/trackpad deltas (pixel, line or page mode) to pixels. */
export function normalizeWheelDelta(evt) {
  const raw = Number(evt?.deltaY) || 0;
  const mode = Number(evt?.deltaMode) || 0;
  if (mode === 1) return raw * WHEEL_LINE_HEIGHT;
  if (mode === 2) return raw * (Number(evt?.view) || 1) * WHEEL_PAGE_HEIGHT;
  return raw;
}

/** Continuous (smooth) zoom factor for a normalized wheel delta. */
export function zoomFactorForDelta(delta) {
  const clamp = clampNumber(Number(delta) || 0, -WHEEL_DELTA_LIMIT, WHEEL_DELTA_LIMIT);
  return Math.exp(-clamp * WHEEL_SENSITIVITY);
}

function easeInOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

let cachedWorld = null;

function guardedImport(specifier) {
  const path = "./" + specifier;
  return import(/* @vite-ignore */ path).catch(() => null);
}

export async function loadCameraModules() {
  if (!cachedWorld) cachedWorld = await guardedImport("world.js");
  return { world: cachedWorld };
}

export function bindWorld(world) {
  cachedWorld = world ?? null;
}

export function getBoundWorld() {
  return cachedWorld;
}

const autoLoad = guardedImport("world.js");
if (autoLoad && typeof autoLoad.then === "function") {
  autoLoad.then((module) => {
    if (module) cachedWorld = module;
  });
}

export function createCamera(options = {}) {
  const minZoom = Number.isFinite(Number(options.minZoom)) ? Number(options.minZoom) : ZOOM_MIN;
  const maxZoom = Number.isFinite(Number(options.maxZoom)) ? Number(options.maxZoom) : ZOOM_MAX;
  const camera = {
    version: CAMERA_VERSION,
    x: Number.isFinite(Number(options.x)) ? Number(options.x) : 0,
    y: Number.isFinite(Number(options.y)) ? Number(options.y) : 0,
    zoom: clampZoomValue(options.zoom ?? 1, minZoom, maxZoom),
    minZoom,
    maxZoom,
    viewport: {
      width: Math.max(1, Number(options.width) || OVERVIEW_WIDTH),
      height: Math.max(1, Number(options.height) || OVERVIEW_HEIGHT),
    },
    overview: {
      x: Number.isFinite(Number(options.overviewX)) ? Number(options.overviewX) : 0,
      y: Number.isFinite(Number(options.overviewY)) ? Number(options.overviewY) : 0,
      zoom: clampZoomValue(options.overviewZoom ?? 1, minZoom, maxZoom),
    },
    bounds: options.bounds ?? null,
    worldState: options.worldState ?? null,
    hitTestStation: options.hitTestStation ?? null,
    target: null,
    dragging: false,
    dragOrigin: null,
    lastPointer: null,
    hoverStationId: null,
    clickedStationId: null,
    autoFit: false,
  };
  if (options.worldState) refreshWorldBounds(camera, options.worldState);
  return camera;
}

function worldSpan(camera) {
  const zoom = Math.max(1e-6, Number(camera?.zoom) || 1);
  return {
    width: Math.max(1, Number(camera?.viewport?.width) || OVERVIEW_WIDTH) / zoom,
    height: Math.max(1, Number(camera?.viewport?.height) || OVERVIEW_HEIGHT) / zoom,
  };
}

/** Live viewport refresh (resize) — the clamp always reads it at call time. */
export function updateViewport(camera, width, height) {
  if (!camera) return camera;
  if (Number.isFinite(Number(width)) && Number(width) > 0) camera.viewport.width = Number(width);
  if (Number.isFinite(Number(height)) && Number(height) > 0) camera.viewport.height = Number(height);
  return camera;
}

/**
 * Recomputes the navigable bounds from the CURRENT world state. Never keeps
 * stale Office dimensions: the page calls this on every snapshot before
 * clamping. When the world exposes real `contentBounds` (the office itself),
 * THOSE are the navigable bounds: the content is centered/kept reachable on
 * every axis instead of being pinned to the top-left of a larger empty world.
 * Without contentBounds (bare worldWidth/Height callers) the world rectangle is
 * used, preserving the previous contract.
 */
export function refreshWorldBounds(camera, worldState) {
  if (!camera || !worldState) return camera;
  const content = contentBoundsOf(worldState);
  if (content) {
    camera.bounds = { ...content };
    return camera;
  }
  const width = Number(worldState.worldWidth ?? worldState.width);
  const height = Number(worldState.worldHeight ?? worldState.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return camera;
  camera.bounds = {
    minX: Number.isFinite(Number(worldState.minX)) ? Number(worldState.minX) : 0,
    minY: Number.isFinite(Number(worldState.minY)) ? Number(worldState.minY) : 0,
    maxX: Number.isFinite(Number(worldState.maxX)) ? Number(worldState.maxX) : width,
    maxY: Number.isFinite(Number(worldState.maxY)) ? Number(worldState.maxY) : height,
  };
  return camera;
}

/**
 * Clamp formula (world bounds × current zoom × viewport):
 *   spanX = viewport.width / zoom       spanY = viewport.height / zoom
 *   x ∈ [minX, maxX − spanX]            y ∈ [minY, maxY − spanY]
 * When the world is smaller than the visible span the axis is centered, so all
 * four edges remain reachable/visible at any zoom (including min zoom).
 */
export function getClampRange(camera) {
  if (!camera || !camera.bounds) return null;
  const span = worldSpan(camera);
  const bounds = camera.bounds;
  const minX = Number(bounds.minX) || 0;
  const minY = Number(bounds.minY) || 0;
  const maxX = Number.isFinite(Number(bounds.maxX)) ? Number(bounds.maxX) : minX + span.width;
  const maxY = Number.isFinite(Number(bounds.maxY)) ? Number(bounds.maxY) : minY + span.height;
  const rangeX = maxX - minX <= span.width
    ? { min: minX + (maxX - minX - span.width) / 2, max: minX + (maxX - minX - span.width) / 2, centered: true }
    : { min: minX, max: maxX - span.width, centered: false };
  const rangeY = maxY - minY <= span.height
    ? { min: minY + (maxY - minY - span.height) / 2, max: minY + (maxY - minY - span.height) / 2, centered: true }
    : { min: minY, max: maxY - span.height, centered: false };
  return { minX: rangeX.min, maxX: rangeX.max, minY: rangeY.min, maxY: rangeY.max, spanX: span.width, spanY: span.height, centeredX: rangeX.centered, centeredY: rangeY.centered, bounds };
}

export function screenToWorld(camera, sx, sy) {
  const zoom = Math.max(1e-6, Number(camera?.zoom) || 1);
  return {
    x: (Number(sx) || 0) / zoom + (Number(camera?.x) || 0),
    y: (Number(sy) || 0) / zoom + (Number(camera?.y) || 0),
  };
}

export function worldToScreen(camera, wx, wy) {
  const zoom = Number(camera?.zoom) || 1;
  return {
    x: ((Number(wx) || 0) - (Number(camera?.x) || 0)) * zoom,
    y: ((Number(wy) || 0) - (Number(camera?.y) || 0)) * zoom,
  };
}

export function applyCamera(ctx, camera) {
  if (!ctx || !camera) return camera;
  const zoom = Number(camera.zoom) || 1;
  const x = Number(camera.x) || 0;
  const y = Number(camera.y) || 0;
  if (typeof ctx.setTransform === "function") {
    ctx.setTransform(zoom, 0, 0, zoom, -x * zoom, -y * zoom);
  } else {
    if (typeof ctx.scale === "function") ctx.scale(zoom, zoom);
    if (typeof ctx.translate === "function") ctx.translate(-x, -y);
  }
  return camera;
}

export function updateCamera(camera, dtMs) {
  if (!camera) return camera;
  const dt = Math.max(0, Number(dtMs) || 0);
  const target = camera.target;
  if (target && target.active) {
    target.elapsed += dt;
    const duration = Math.max(1, target.duration || ZOOM_TO_DESK_MS);
    const progress = clampNumber(target.elapsed / duration, 0, 1);
    const eased = easeInOutCubic(progress);
    const width = Math.max(1, camera.viewport.width);
    const height = Math.max(1, camera.viewport.height);
    const fromCenter = target.from.center;
    const centerX = fromCenter.x + (target.focus.x - fromCenter.x) * eased;
    const centerY = fromCenter.y + (target.focus.y - fromCenter.y) * eased;
    const zoom = clampZoomValue(target.from.zoom + (target.zoom - target.from.zoom) * eased, camera.minZoom, camera.maxZoom);
    camera.zoom = zoom;
    camera.x = centerX - width / (2 * zoom);
    camera.y = centerY - height / (2 * zoom);
    if (progress >= 1) {
      camera.x = target.focus.x - width / (2 * target.zoom);
      camera.y = target.focus.y - height / (2 * target.zoom);
      camera.zoom = target.zoom;
      target.active = false;
      camera.target = null;
    }
  }
  return camera;
}

export function centerOf(camera) {
  const zoom = Math.max(1e-6, Number(camera?.zoom) || 1);
  return {
    x: (Number(camera?.x) || 0) + camera.viewport.width / (2 * zoom),
    y: (Number(camera?.y) || 0) + camera.viewport.height / (2 * zoom),
  };
}

export function zoomToDesk(camera, station) {
  if (!camera || !station) return camera;
  const width = Math.max(1, camera.viewport.width);
  const height = Math.max(1, camera.viewport.height);
  const deskWidth = Number(station.w) || DESK_WIDTH;
  const deskHeight = Number(station.h) || DESK_HEIGHT;
  const focusX = Number.isFinite(Number(station.centerX)) ? Number(station.centerX) : Number(station.x) + deskWidth / 2;
  const focusY = Number.isFinite(Number(station.centerY)) ? Number(station.centerY) : Number(station.y) + deskHeight / 2;
  const requested = Math.min(width / (deskWidth * 2.6), height / (deskHeight * 2.6));
  const zoom = clampZoomValue(requested, camera.minZoom, camera.maxZoom);
  camera.target = {
    active: true,
    elapsed: 0,
    duration: ZOOM_TO_DESK_MS,
    focus: { x: focusX, y: focusY },
    zoom,
    from: {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
      center: centerOf(camera),
    },
  };
  camera.focusStationId = station.marketKey ?? station.id ?? null;
  return camera;
}

export function resetCamera(camera) {
  if (!camera) return camera;
  camera.target = null;
  camera.zoom = clampZoomValue(camera.overview.zoom, camera.minZoom, camera.maxZoom);
  camera.x = camera.overview.x;
  camera.y = camera.overview.y;
  camera.dragging = false;
  camera.lastPointer = null;
  camera.hoverStationId = null;
  camera.clickedStationId = null;
  camera.focusStationId = null;
  return camera;
}

export function clampToBounds(camera) {
  if (!camera || !camera.bounds) return camera;
  const range = getClampRange(camera);
  if (!range) return camera;
  camera.x = clampNumber(camera.x, range.minX, range.maxX);
  camera.y = clampNumber(camera.y, range.minY, range.maxY);
  return camera;
}

/**
 * Cursor-centered zoom: the world point under (sx, sy) stays fixed on screen
 * (approx. exactly, before the bounds clamp). Canonical entry point for wheel.
 */
export function zoomAt(camera, sx, sy, requestedZoom, options = {}) {
  if (!camera) return camera;
  const before = screenToWorld(camera, sx, sy);
  camera.zoom = clampZoomValue(requestedZoom, camera.minZoom, camera.maxZoom);
  const after = screenToWorld(camera, sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  camera.target = null;
  if (options.clamp !== false) clampToBounds(camera);
  return camera;
}

export const zoomAtScreen = zoomAt;

/**
 * Pan by a screen-space delta (pointer movement). Content follows the pointer:
 * dragging right (+dx) moves the camera left, so the same world point keeps
 * moving with the cursor. Base, overlay and hitboxes share this single camera.
 */
export function panBy(camera, dxScreen, dyScreen, options = {}) {
  if (!camera) return camera;
  const zoom = Math.max(1e-6, Number(camera.zoom) || 1);
  camera.x -= (Number(dxScreen) || 0) / zoom;
  camera.y -= (Number(dyScreen) || 0) / zoom;
  camera.target = null;
  if (options.clamp !== false) clampToBounds(camera);
  return camera;
}

function pointerX(evt, camera) {
  const candidates = [evt?.offsetX, evt?.x, evt?.clientX, evt?.screenX];
  for (const candidate of candidates) if (Number.isFinite(Number(candidate))) return Number(candidate);
  return camera ? camera.viewport.width / 2 : 0;
}

function pointerY(evt, camera) {
  const candidates = [evt?.offsetY, evt?.y, evt?.clientY, evt?.screenY];
  for (const candidate of candidates) if (Number.isFinite(Number(candidate))) return Number(candidate);
  return camera ? camera.viewport.height / 2 : 0;
}

/**
 * Drag pointers must always use viewport/client coordinates: offsetX changes
 * with the event target and would drift the pan when the pointer leaves the
 * canvas. Client coordinates keep base image, overlays and hitboxes aligned.
 */
function dragPointerX(evt, fallback) {
  const candidates = [evt?.clientX, evt?.x, evt?.offsetX, evt?.screenX];
  for (const candidate of candidates) if (Number.isFinite(Number(candidate))) return Number(candidate);
  return fallback;
}

function dragPointerY(evt, fallback) {
  const candidates = [evt?.clientY, evt?.y, evt?.offsetY, evt?.screenY];
  for (const candidate of candidates) if (Number.isFinite(Number(candidate))) return Number(candidate);
  return fallback;
}

export function handleWheel(camera, evt) {
  if (!camera || !evt) return camera;
  const delta = normalizeWheelDelta(evt);
  if (delta === 0) return camera;
  if (typeof evt.preventDefault === "function") evt.preventDefault();
  const factor = zoomFactorForDelta(delta);
  const sx = pointerX(evt, camera);
  const sy = pointerY(evt, camera);
  return zoomAtScreen(camera, sx, sy, camera.zoom * factor);
}

/**
 * Plain wheel = vertical scroll (pan). Shift+wheel = horizontal scroll. It never
 * changes the zoom: Ctrl/Meta + wheel is the only zoom gesture (see handleWheel).
 * Wheel-down (deltaY > 0) reveals content below, i.e. moves the camera down.
 */
export function handleScrollPan(camera, evt, options = {}) {
  if (!camera || !evt) return camera;
  const shift = evt.shiftKey === true;
  const rawY = normalizeWheelDelta(evt);
  const rawX = normalizeWheelDelta({ deltaY: evt.deltaX, deltaMode: evt.deltaMode, view: evt.view });
  const dx = shift ? (rawX !== 0 ? rawX : rawY) : rawX;
  const dy = shift ? 0 : rawY;
  if (dx === 0 && dy === 0) return camera;
  if (typeof evt.preventDefault === "function") evt.preventDefault();
  return panBy(camera, -dx, -dy, options);
}

/** Real content bounds exposed by world.js, or null when absent. */
export function contentBoundsOf(worldState) {
  const cb = worldState?.contentBounds;
  if (!cb) return null;
  const minX = Number(cb.minX);
  const minY = Number(cb.minY);
  const maxX = Number(cb.maxX);
  const maxY = Number(cb.maxY);
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Frames the office content inside the viewport with an even margin on all four
 * sides and centers it. Zoom never exceeds 1 (the office is never over-magnified
 * on a small viewport) and never goes below the camera min zoom. `minFitZoom`
 * evita que o escritorio nasca minusculo em viewports reduzidos: o conteudo
 * fica maior que o viewport e continua navegavel por pan (sem auto-FIT depois).
 */
export function fitContent(camera, worldState, options = {}) {
  if (!camera || !worldState) return camera;
  const bounds = contentBoundsOf(worldState);
  if (!bounds) return camera;
  const padding = Number.isFinite(Number(options.padding)) ? Number(options.padding) : 48;
  const vw = Math.max(1, Number(camera.viewport.width) || OVERVIEW_WIDTH);
  const vh = Math.max(1, Number(camera.viewport.height) || OVERVIEW_HEIGHT);
  const cw = Math.max(1, bounds.maxX - bounds.minX);
  const ch = Math.max(1, bounds.maxY - bounds.minY);
  const fitZoom = Math.min((vw - padding * 2) / cw, (vh - padding * 2) / ch);
  const minFitZoom = Number.isFinite(Number(options.minFitZoom)) ? Number(options.minFitZoom) : 0;
  const effectiveFit = Math.max(fitZoom, Math.max(camera.minZoom, Math.min(minFitZoom, 1)));
  camera.zoom = clampZoomValue(effectiveFit, camera.minZoom, Math.min(camera.maxZoom, 1));
  camera.x = (bounds.minX + bounds.maxX) / 2 - vw / (2 * camera.zoom);
  camera.y = (bounds.minY + bounds.maxY) / 2 - vh / (2 * camera.zoom);
  camera.target = null;
  if (camera.overview) {
    camera.overview.x = camera.x;
    camera.overview.y = camera.y;
    camera.overview.zoom = camera.zoom;
  }
  if (options.clamp !== false) clampToBounds(camera);
  return camera;
}

export function handleDragStart(camera, evt) {
  if (!camera) return camera;
  camera.dragging = true;
  camera.target = null;
  camera.dragOrigin = { x: camera.x, y: camera.y };
  camera.lastPointer = {
    x: dragPointerX(evt, camera.viewport.width / 2),
    y: dragPointerY(evt, camera.viewport.height / 2),
  };
  return camera;
}

export function handleDragMove(camera, evt) {
  if (!camera || !camera.dragging || !camera.lastPointer) return camera;
  const px = dragPointerX(evt, camera.lastPointer.x);
  const py = dragPointerY(evt, camera.lastPointer.y);
  const dx = px - camera.lastPointer.x;
  const dy = py - camera.lastPointer.y;
  camera.lastPointer = { x: px, y: py };
  return panBy(camera, dx, dy);
}

export function handleDragEnd(camera, evt) {
  if (!camera) return camera;
  camera.dragging = false;
  camera.lastPointer = null;
  camera.dragOrigin = null;
  if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
  return camera;
}

export function setWorldState(camera, worldState) {
  if (camera) camera.worldState = worldState ?? null;
  return camera;
}

export function fallbackHitTestStation(worldState, x, y) {
  const stations = Array.isArray(worldState?.stations) ? worldState.stations : [];
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const station of stations) {
    const w = Number(station.w) || DESK_WIDTH;
    const h = Number(station.h) || DESK_HEIGHT;
    const sx = Number(station.x);
    const sy = Number(station.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
    const rect = station.desk && typeof station.desk === "object" ? station.desk : { x: sx, y: sy, w, h };
    if (nx >= rect.x && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h) return station;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const distance = Math.hypot(nx - cx, ny - cy);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = station;
    }
  }
  if (nearest && nearestDistance <= 48) return nearest;
  return null;
}

function resolveHitTest(camera, worldState, x, y) {
  if (typeof camera?.hitTestStation === "function") return camera.hitTestStation(worldState, x, y) ?? null;
  if (cachedWorld && typeof cachedWorld.hitTestStation === "function") {
    const hit = cachedWorld.hitTestStation(worldState, x, y);
    if (hit) return hit;
  }
  return fallbackHitTestStation(worldState, x, y);
}

export function handleClick(camera, evt) {
  if (!camera) return null;
  const sx = pointerX(evt, camera);
  const sy = pointerY(evt, camera);
  const world = screenToWorld(camera, sx, sy);
  const station = resolveHitTest(camera, camera.worldState, world.x, world.y);
  camera.clickedStationId = station ? station.marketKey ?? station.id ?? null : null;
  camera.hoverStationId = camera.clickedStationId;
  camera.lastClickWorld = world;
  return station;
}

export function handleHover(camera, evt) {
  if (!camera) return null;
  const sx = pointerX(evt, camera);
  const sy = pointerY(evt, camera);
  const world = screenToWorld(camera, sx, sy);
  const station = resolveHitTest(camera, camera.worldState, world.x, world.y);
  camera.hoverStationId = station ? station.marketKey ?? station.id ?? null : null;
  camera.lastHoverWorld = world;
  return station;
}

export default {
  CAMERA_VERSION,
  createCamera,
  applyCamera,
  updateCamera,
  zoomToDesk,
  resetCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomAtScreen,
  panBy,
  refreshWorldBounds,
  updateViewport,
  getClampRange,
  normalizeWheelDelta,
  zoomFactorForDelta,
  handleWheel,
  handleScrollPan,
  contentBoundsOf,
  fitContent,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleClick,
  handleHover,
  setWorldState,
  fallbackHitTestStation,
};
