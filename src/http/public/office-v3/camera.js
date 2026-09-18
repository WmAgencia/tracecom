/**
 * OFFICE V3 — CAMERA (frontend/rendering only).
 *
 * Pan + clamped zoom + smooth zoom-to-desk (~400ms) + hover/click hit-testing.
 * Deliberately never auto-FITs the world to the viewport: the expanded world
 * (2560x1600) is bigger than the base viewport (1536x1024) and the user keeps
 * control. Pure ESM, no DOM dependency.
 */

export const CAMERA_VERSION = "office-v3-camera.1.0.0";
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.15;
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
  return {
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
  const bounds = camera.bounds;
  const width = Math.max(1, camera.viewport.width) / camera.zoom;
  const height = Math.max(1, camera.viewport.height) / camera.zoom;
  const minX = Number(bounds.minX) || 0;
  const minY = Number(bounds.minY) || 0;
  const maxX = Number.isFinite(Number(bounds.maxX)) ? Number(bounds.maxX) : minX + width;
  const maxY = Number.isFinite(Number(bounds.maxY)) ? Number(bounds.maxY) : minY + height;
  if (maxX - minX <= width) camera.x = minX + (maxX - minX - width) / 2;
  else camera.x = clampNumber(camera.x, minX, maxX - width);
  if (maxY - minY <= height) camera.y = minY + (maxY - minY - height) / 2;
  else camera.y = clampNumber(camera.y, minY, maxY - height);
  return camera;
}

export function zoomAtScreen(camera, sx, sy, requestedZoom) {
  if (!camera) return camera;
  const before = screenToWorld(camera, sx, sy);
  camera.zoom = clampZoomValue(requestedZoom, camera.minZoom, camera.maxZoom);
  const after = screenToWorld(camera, sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  camera.target = null;
  clampToBounds(camera);
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

export function handleWheel(camera, evt) {
  if (!camera || !evt) return camera;
  const delta = Number(evt.deltaY) || 0;
  if (delta === 0) return camera;
  if (typeof evt.preventDefault === "function") evt.preventDefault();
  const factor = delta < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const sx = pointerX(evt, camera);
  const sy = pointerY(evt, camera);
  return zoomAtScreen(camera, sx, sy, camera.zoom * factor);
}

export function handleDragStart(camera, evt) {
  if (!camera) return camera;
  camera.dragging = true;
  camera.target = null;
  camera.dragOrigin = { x: camera.x, y: camera.y };
  camera.lastPointer = { x: pointerX(evt, camera), y: pointerY(evt, camera) };
  return camera;
}

export function handleDragMove(camera, evt) {
  if (!camera || !camera.dragging || !camera.lastPointer) return camera;
  const px = pointerX(evt, camera);
  const py = pointerY(evt, camera);
  const dx = px - camera.lastPointer.x;
  const dy = py - camera.lastPointer.y;
  const zoom = Math.max(1e-6, Number(camera.zoom) || 1);
  camera.x -= dx / zoom;
  camera.y -= dy / zoom;
  camera.lastPointer = { x: px, y: py };
  clampToBounds(camera);
  return camera;
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
  handleWheel,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleClick,
  handleHover,
  setWorldState,
  fallbackHitTestStation,
};
