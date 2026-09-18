/**
 * TRACE/COM — PIXEL OFFICE V3 · PAGE SHELL / INTEGRATION
 *
 * Binds the frozen V3 modules into one page:
 *   assets.js   → drawTile / drawSprite / drawCharacter / PALETTE_V3
 *   world.js    → buildWorldState / drawWorld / hitTestStation / STATION_LAYOUT
 *   life.js     → createLifeSystem + bindWorld/bindAssets / updateLife / drawAgents
 *   camera.js   → createCamera / pan / clamped zoom / smooth zoomToDesk / hit-test
 *   dashboard.js→ mountDashboard (side panel) + `tracecom:market-select`
 *   market-detail.js → mountMarketDetail (desk click + list selection)
 *
 * Data flow: polls `GET /api/iq/office` (the only network call in this module),
 * rebuilds the world state, syncs agent presence, redraws on one canvas with the
 * correct order (world → agents). Any module/network failure degrades to a
 * warning + error banner; the page never throws and never auto-FITs the camera.
 *
 * Rendering only. PRACTICE only. ZERO REAL. No orders, no execution, no stake.
 */

const POLL_URL = "/api/iq/office";
const POLL_BASE_MS = 2000;
const POLL_MAX_MS = 30000;
const DRAG_CLICK_THRESHOLD = 4;

const canvas = document.getElementById("office-canvas");
const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
if (ctx) ctx.imageSmoothingEnabled = false;

const statusEl = document.getElementById("office-status");
const statusDetailEl = document.getElementById("office-status-detail");
const modeEl = document.getElementById("hud-mode");
const cameraEl = document.getElementById("hud-camera");
const detailEl = document.getElementById("office-detail");
const detailTitleEl = document.getElementById("detail-title");
const detailRowsEl = document.getElementById("detail-rows");
const dashboardEl = document.getElementById("office-dashboard");
const detailRootEl = document.getElementById("office-detail-root");
const errorEl = document.getElementById("office-error");

const modules = { assets: null, world: null, life: null, camera: null, dashboard: null, marketDetail: null };
let worldState = null;
let worldModule = null;
let lifeSystem = null;
let officeJson = null;
let camera = null;
let lifeSignature = "";
let viewport = { width: 0, height: 0 };
let lastFrame = 0;
let pollTimer = 0;
let pollBackoff = POLL_BASE_MS;
let disposed = false;

/* ------------------------------------------------------------------ *
 * Status / error surfaces (fail-soft)
 * ------------------------------------------------------------------ */

function setStatus(text, detail) {
  if (statusEl) statusEl.classList.remove("hidden");
  if (text && statusEl && statusEl.firstElementChild) statusEl.firstElementChild.textContent = text;
  if (detail && statusDetailEl) statusDetailEl.textContent = detail;
}

function hideStatus() {
  if (statusEl) statusEl.classList.add("hidden");
}

function showError(message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  if (!errorEl) return;
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function warnMissing(name, error) {
  console.warn(`[office-v3] módulo/rotina indisponível: ${name} — seguindo com fallback`, error);
}

/* ------------------------------------------------------------------ *
 * Module loading
 * ------------------------------------------------------------------ */

async function loadModule(name, path) {
  try {
    const loaded = await import(path);
    modules[name] = loaded;
    return loaded;
  } catch (error) {
    warnMissing(name, error);
    modules[name] = null;
    return null;
  }
}

async function loadModules() {
  await Promise.all([
    loadModule("assets", "./assets.js"),
    loadModule("world", "./world.js"),
    loadModule("life", "./life.js"),
    loadModule("camera", "./camera.js"),
    loadModule("dashboard", "./dashboard.js"),
    loadModule("marketDetail", "./market-detail.js"),
  ]);
  worldModule = modules.world;
}

/* ------------------------------------------------------------------ *
 * Office snapshot — the ONLY network call in this module
 * ------------------------------------------------------------------ */

async function fetchOfficeJson() {
  try {
    const response = await fetch(POLL_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : "sem resposta"}`);
    const json = await response.json();
    if (!json || !Array.isArray(json.markets)) throw new Error("snapshot sem lista de mercados");
    return json;
  } catch (error) {
    console.warn(`[office-v3] GET ${POLL_URL} falhou`, error);
    return null;
  }
}

function demoMarkets() {
  const symbols = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY", "AUD/JPY",
    "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF", "EUR/USD OTC",
    "GBP/USD OTC", "USD/JPY OTC", "EUR/GBP OTC", "GBP/JPY OTC", "AUD/USD OTC", "USD/CAD OTC", "USD/CHF OTC", "EUR/JPY OTC",
    "AUD/JPY OTC", "BTC/USD OTC", "ETH/USD OTC", "LTC/USD OTC", "XRP/USD OTC", "ADA/USD OTC", "US30", "US100", "US500",
    "US2000", "GER30", "UK100", "JP225", "AUS200", "EU50", "HK33", "GOLD", "SILVER", "WTI", "BRENT", "NATGAS", "APPLE",
    "TESLA", "AMAZON", "GOOGLE", "META",
  ];
  return symbols.map((display, index) => ({
    marketKey: `${display.replace(/[^A-Z0-9]/g, "")}:NORMAL`,
    canonical: display.replace(/[^A-Z0-9]/g, ""),
    symbol: display,
    display,
    availability: index % 8 === 3 ? "CLOSED" : "OPEN",
    enabled: index % 8 !== 3,
    payout: index % 8 === 3 ? null : 80,
    settlementState: {},
  }));
}

function demoOffice() {
  return {
    version: "office-v3-demo",
    at: Date.now(),
    mode: "PRACTICE",
    connection: { connected: false },
    portfolio: { settled: { wins: 0, losses: 0, draws: 0, pnl: null, trades: 0 } },
    markets: demoMarkets(),
  };
}

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

function createCameraState() {
  if (modules.camera && typeof modules.camera.createCamera === "function") {
    try {
      return modules.camera.createCamera({ width: viewport.width, height: viewport.height, zoom: 1 });
    } catch (error) {
      warnMissing("camera.createCamera", error);
    }
  }
  return {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.25,
    maxZoom: 4,
    viewport: { width: viewport.width, height: viewport.height },
    bounds: null,
    autoFit: false,
  };
}

function attachWorldToCamera() {
  if (!camera || !worldState) return;
  if (!camera.bounds) {
    camera.bounds = { minX: 0, minY: 0, maxX: worldState.worldWidth, maxY: worldState.worldHeight };
  }
  if (!camera.overview) camera.overview = { x: 0, y: 0, zoom: 1 };
  if (modules.camera && typeof modules.camera.setWorldState === "function") {
    try {
      modules.camera.setWorldState(camera, worldState);
    } catch (error) {
      warnMissing("camera.setWorldState", error);
    }
  } else {
    camera.worldState = worldState;
  }
  if (worldModule && typeof worldModule.hitTestStation === "function") {
    camera.hitTestStation = worldModule.hitTestStation;
  }
  if (modules.camera && typeof modules.camera.bindWorld === "function") {
    try {
      modules.camera.bindWorld(worldModule);
    } catch (error) {
      warnMissing("camera.bindWorld", error);
    }
  }
}

function clampCamera() {
  if (!camera) return;
  if (modules.camera && typeof modules.camera.clampToBounds === "function") {
    try {
      modules.camera.clampToBounds(camera);
      return;
    } catch (error) {
      warnMissing("camera.clampToBounds", error);
    }
  }
  if (camera.bounds) {
    const width = viewport.width / camera.zoom;
    const height = viewport.height / camera.zoom;
    camera.x = Math.min(Math.max(camera.x, camera.bounds.minX), Math.max(camera.bounds.minX, camera.bounds.maxX - width));
    camera.y = Math.min(Math.max(camera.y, camera.bounds.minY), Math.max(camera.bounds.minY, camera.bounds.maxY - height));
  }
}

function screenToWorld(screenX, screenY) {
  if (modules.camera && typeof modules.camera.screenToWorld === "function") {
    try {
      return modules.camera.screenToWorld(camera, screenX, screenY);
    } catch (error) {
      warnMissing("camera.screenToWorld", error);
    }
  }
  return { x: camera.x + screenX / camera.zoom, y: camera.y + screenY / camera.zoom };
}

function deskFocus(station) {
  const desk = station.desk ?? { x: station.x ?? 0, y: station.y ?? 0, w: station.w ?? 118, h: station.h ?? 72 };
  const cell = station.cell ?? {};
  return {
    marketKey: station.marketKey ?? null,
    id: station.id ?? null,
    x: desk.x,
    y: desk.y,
    w: desk.w,
    h: desk.h,
    centerX: Number.isFinite(Number(cell.centerX)) ? Number(cell.centerX) : desk.x + desk.w / 2,
    centerY: desk.y + desk.h / 2,
  };
}

function zoomToStation(station) {
  if (!camera || !station) return;
  if (modules.camera && typeof modules.camera.zoomToDesk === "function") {
    try {
      modules.camera.zoomToDesk(camera, deskFocus(station));
      return;
    } catch (error) {
      warnMissing("camera.zoomToDesk", error);
    }
  }
  const focus = deskFocus(station);
  camera.zoom = Math.min(camera.maxZoom ?? 4, Math.max(camera.minZoom ?? 0.25, 1.6));
  camera.x = focus.centerX - viewport.width / (2 * camera.zoom);
  camera.y = focus.centerY - viewport.height / (2 * camera.zoom);
}

/* ------------------------------------------------------------------ *
 * Market detail (desk click + dashboard list selection)
 * ------------------------------------------------------------------ */

function showDetailFallback(station) {
  if (!detailEl) return;
  detailTitleEl.textContent = station.display ?? station.symbol ?? station.marketKey ?? "—";
  detailRowsEl.innerHTML = "";
  const rows = [
    { label: "Mercado", value: station.marketKey ?? "—" },
    { label: "Disponibilidade", value: station.availability ?? "—" },
    { label: "Payout", value: station.payout == null ? "—" : `${station.payout}%` },
    { label: "Estado", value: station.active ? "OPERANDO" : "SEM AGENTES" },
  ];
  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "row";
    const label = document.createElement("span");
    label.textContent = row.label;
    const value = document.createElement("span");
    value.textContent = row.value ?? "—";
    div.append(label, value);
    detailRowsEl.append(div);
  }
  detailEl.style.display = "block";
}

function closeDetail() {
  if (modules.marketDetail && typeof modules.marketDetail.closeMarketDetail === "function") {
    try {
      modules.marketDetail.closeMarketDetail();
    } catch (error) {
      warnMissing("marketDetail.closeMarketDetail", error);
    }
  }
  if (detailEl) detailEl.style.display = "none";
}

function openDetail(station, marketKey) {
  const key = marketKey ?? station?.marketKey ?? null;
  if (!key) return;
  if (modules.marketDetail && typeof modules.marketDetail.mountMarketDetail === "function" && detailRootEl) {
    try {
      modules.marketDetail.mountMarketDetail(detailRootEl, officeJson ?? {}, key);
      return;
    } catch (error) {
      warnMissing("marketDetail.mountMarketDetail", error);
    }
  }
  if (station) showDetailFallback(station);
}

function findStation(marketKey) {
  if (!worldState || !marketKey) return null;
  const pools = [worldState.stations, worldState.allStations];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const hit = pool.find((station) => station.marketKey === marketKey || station.id === marketKey);
    if (hit) return hit;
  }
  return null;
}

function selectMarket(marketKey) {
  const station = findStation(marketKey);
  if (station) zoomToStation(station);
  openDetail(station, marketKey);
}

function onMarketSelect(event) {
  const key = event && event.detail ? event.detail.marketKey : null;
  if (key) selectMarket(key);
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

function mountDashboard() {
  if (!dashboardEl || !modules.dashboard || typeof modules.dashboard.mountDashboard !== "function") return;
  try {
    modules.dashboard.mountDashboard(dashboardEl, officeJson);
  } catch (error) {
    warnMissing("dashboard.mountDashboard", error);
    modules.dashboard = null;
  }
}

/* ------------------------------------------------------------------ *
 * World + life wiring
 * ------------------------------------------------------------------ */

function createLife() {
  if (!modules.life || typeof modules.life.createLifeSystem !== "function") return null;
  try {
    const life = modules.life.createLifeSystem(worldState, {});
    if (typeof modules.life.bindWorld === "function") modules.life.bindWorld(worldModule);
    if (typeof modules.life.bindAssets === "function") modules.life.bindAssets(modules.assets);
    return life;
  } catch (error) {
    warnMissing("life.createLifeSystem", error);
    modules.life = null;
    return null;
  }
}

function syncPresence() {
  if (!lifeSystem || !modules.life || typeof modules.life.setPresence !== "function") return;
  try {
    for (const station of worldState.stations) {
      modules.life.setPresence(lifeSystem, station.id, station.active === true);
    }
  } catch (error) {
    warnMissing("life.setPresence", error);
  }
}

function stationSignature(state) {
  return state.stations.map((station) => station.marketKey ?? station.id ?? "?").join("|");
}

function applyOfficeJson(json) {
  if (!worldModule || typeof worldModule.buildWorldState !== "function") return;
  officeJson = json;
  worldState = worldModule.buildWorldState(json);
  attachWorldToCamera();

  const signature = stationSignature(worldState);
  if (!lifeSystem || signature !== lifeSignature) {
    lifeSystem = createLife();
    lifeSignature = signature;
  } else {
    syncPresence();
  }

  if (modeEl) {
    const mode = String(json.mode ?? worldState.mode ?? "PRACTICE").toUpperCase();
    modeEl.textContent = `${mode} · ZERO REAL`;
  }
  mountDashboard();
}

/* ------------------------------------------------------------------ *
 * Rendering — one canvas, world first, agents on top
 * ------------------------------------------------------------------ */

function renderFrame(now) {
  if (disposed) return;
  requestAnimationFrame(renderFrame);
  if (!ctx || !worldState || !worldModule) return;

  const dt = lastFrame ? Math.min(120, now - lastFrame) : 16;
  lastFrame = now;

  if (lifeSystem && modules.life && typeof modules.life.updateLife === "function") {
    try {
      modules.life.updateLife(lifeSystem, dt);
    } catch (error) {
      warnMissing("life.updateLife", error);
      lifeSystem = null;
    }
  }
  if (camera && modules.camera && typeof modules.camera.updateCamera === "function") {
    try {
      modules.camera.updateCamera(camera, dt);
    } catch (error) {
      warnMissing("camera.updateCamera", error);
    }
  }
  clampCamera();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#05090f";
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  try {
    worldModule.drawWorld(ctx, worldState, camera, { agents: !lifeSystem });
  } catch (error) {
    console.warn("[office-v3] drawWorld falhou", error);
  }

  if (lifeSystem && modules.life && typeof modules.life.drawAgents === "function") {
    try {
      ctx.save();
      if (modules.camera && typeof modules.camera.applyCamera === "function") {
        modules.camera.applyCamera(ctx, camera);
      } else {
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);
      }
      modules.life.drawAgents(ctx, lifeSystem, camera);
      ctx.restore();
    } catch (error) {
      warnMissing("life.drawAgents", error);
      lifeSystem = null;
    }
  }

  if (cameraEl) cameraEl.textContent = `zoom ${Math.round((camera?.zoom ?? 1) * 100)}%`;
}

/* ------------------------------------------------------------------ *
 * Input — pan / zoom / zoom-to-desk / detail
 * ------------------------------------------------------------------ */

function bindInput() {
  if (!canvas) return;
  let downX = 0;
  let downY = 0;
  let moved = false;

  canvas.addEventListener("mousedown", (event) => {
    moved = false;
    downX = event.clientX;
    downY = event.clientY;
    canvas.classList.add("dragging");
    if (camera && modules.camera && typeof modules.camera.handleDragStart === "function") {
      modules.camera.handleDragStart(camera, event);
    }
  });
  window.addEventListener("mousemove", (event) => {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > DRAG_CLICK_THRESHOLD) moved = true;
    if (camera && modules.camera && typeof modules.camera.handleDragMove === "function") {
      modules.camera.handleDragMove(camera, event);
    }
  });
  window.addEventListener("mouseup", (event) => {
    canvas.classList.remove("dragging");
    if (camera && modules.camera && typeof modules.camera.handleDragEnd === "function") {
      modules.camera.handleDragEnd(camera, event);
    }
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (camera && modules.camera && typeof modules.camera.handleWheel === "function") {
        modules.camera.handleWheel(camera, event);
      } else if (camera) {
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        camera.zoom = Math.min(Math.max(camera.zoom * factor, camera.minZoom ?? 0.25), camera.maxZoom ?? 4);
      }
    },
    { passive: false },
  );

  canvas.addEventListener("click", (event) => {
    if (moved || !worldState) return;
    const station = resolveClickedStation(event);
    if (!station) {
      closeDetail();
      return;
    }
    zoomToStation(station);
    openDetail(station);
  });

  canvas.addEventListener("mousemove", (event) => {
    if (!camera || moved || !modules.camera || typeof modules.camera.handleHover !== "function") return;
    try {
      modules.camera.handleHover(camera, event);
    } catch (error) {
      warnMissing("camera.handleHover", error);
    }
  });

  const closeButton = document.getElementById("detail-close");
  if (closeButton) closeButton.addEventListener("click", closeDetail);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });
  window.addEventListener("resize", resize);

  if (dashboardEl) dashboardEl.addEventListener("tracecom:market-select", onMarketSelect);
  globalThis.__tracecomSelectMarket = (marketKey) => {
    if (typeof marketKey === "string" && marketKey) selectMarket(marketKey);
  };
}

function resolveClickedStation(event) {
  if (!worldState) return null;
  if (modules.camera && typeof modules.camera.handleClick === "function") {
    try {
      const hit = modules.camera.handleClick(camera, event);
      if (hit) return hit;
    } catch (error) {
      warnMissing("camera.handleClick", error);
    }
  }
  const point = screenToWorld(event.clientX, event.clientY);
  if (worldModule && typeof worldModule.hitTestStation === "function") {
    return worldModule.hitTestStation(worldState, point.x, point.y);
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Resize / poll / boot
 * ------------------------------------------------------------------ */

function resize() {
  viewport.width = Math.max(320, window.innerWidth);
  viewport.height = Math.max(240, window.innerHeight);
  if (canvas) {
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    if (ctx) ctx.imageSmoothingEnabled = false;
  }
  if (camera && camera.viewport) {
    camera.viewport.width = viewport.width;
    camera.viewport.height = viewport.height;
  }
}

function schedulePoll() {
  if (disposed) return;
  pollTimer = window.setTimeout(pollOnce, pollBackoff);
}

async function pollOnce() {
  if (disposed) return;
  const json = await fetchOfficeJson();
  if (disposed) return;
  if (json) {
    pollBackoff = POLL_BASE_MS;
    clearError();
    try {
      applyOfficeJson(json);
    } catch (error) {
      console.warn("[office-v3] falha ao aplicar snapshot", error);
    }
  } else {
    pollBackoff = Math.min(pollBackoff * 2, POLL_MAX_MS);
    showError("Falha ao atualizar GET /api/iq/office — nova tentativa em instantes…");
  }
  schedulePoll();
}

async function init() {
  bindInput();
  resize();
  setStatus("Carregando PIXEL OFFICE V3…", "importando módulos");
  await loadModules();
  if (!worldModule || typeof worldModule.buildWorldState !== "function") {
    setStatus("PIXEL OFFICE V3 indisponível", "world.js não pôde ser carregado");
    return;
  }

  camera = createCameraState();
  resize();

  const json = await fetchOfficeJson();
  if (json) {
    clearError();
    applyOfficeJson(json);
  } else {
    applyOfficeJson(demoOffice());
    showError("Sem conexão com GET /api/iq/office — exibindo snapshot de demonstração (PRACTICE).");
  }

  hideStatus();
  requestAnimationFrame(renderFrame);
  schedulePoll();
}

if (canvas && ctx) {
  init().catch((error) => {
    console.error("[office-v3] falha na inicialização", error);
    setStatus("PIXEL OFFICE V3 falhou", String(error && error.message ? error.message : error));
  });
} else {
  setStatus("PIXEL OFFICE V3 indisponível", "canvas 2d não encontrado");
}

window.addEventListener("beforeunload", () => {
  disposed = true;
  if (pollTimer) window.clearTimeout(pollTimer);
});
