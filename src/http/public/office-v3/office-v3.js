/**
 * TRACE/COM — PIXEL OFFICE V3 · PAGE SHELL / INTEGRATION
 *
 * Binds the frozen V3 modules into one page:
 *   assets.js   → drawTile / drawSprite / drawCharacter / PALETTE_V3
 *   world.js    → buildWorldState / drawWorld / hitTestStation / STATION_LAYOUT
 *   life.js     → createLifeSystem + bindWorld/bindAssets / updateLife / drawAgents
 *   camera.js   → createCamera / pan / clamped zoom / smooth zoomToDesk / hit-test
 *   state-model.js → ONE derived market state shared by desk, MESAS popup,
 *                    right panel, agents and badges (broker × enabled × feed)
 *   topbar.js   → compact operational top bar (ARM, AUTO, stake — real endpoints)
 *   market-detail.js → right technical panel + per-market stake (PUT /api/iq/market)
 *
 * Data flow: polls `GET /api/iq/office` (the only network call in this module),
 * rebuilds the world state, syncs agent presence, redraws on one canvas with the
 * correct order (world → agents). The office occupies the whole viewport: no
 * duplicated left results board. Any module/network failure degrades to a
 * warning + error banner; the page never throws and never auto-FITs the camera.
 *
 * Navigation: SPACE + left drag pans (cursor grab/grabbing, selection disabled),
 * wheel/trackpad zooms smoothly centered on the cursor. MESAS is a collapsible,
 * searchable popup (↑↓ + Enter still select a desk).
 *
 * Rendering only. PRACTICE only. ZERO REAL. No orders, no execution; stake
 * changes only through the explicit config endpoints owned by topbar.js and
 * the per-market module.
 */

import { attachDerivedStates, deriveMarketState } from "./state-model.js";

const POLL_URL = "/api/iq/office";
const EVENTS_URL = "/api/iq/events";
const POLL_BASE_MS = 2000;
const POLL_MAX_MS = 30000;
const DRAG_CLICK_THRESHOLD = 4;
export const GLOBAL_LOG_LIMIT = 200;
export const MARKET_LOG_LIMIT = 12;

const doc = typeof document !== "undefined" && document ? document : null;
const $ = (id) => (doc && typeof doc.getElementById === "function" ? doc.getElementById(id) : null);

const canvas = $("office-canvas");
const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
if (ctx) ctx.imageSmoothingEnabled = false;

const statusEl = $("office-status");
const statusDetailEl = $("office-status-detail");
const cameraEl = $("hud-camera");
const detailEl = $("office-detail");
const detailTitleEl = $("detail-title");
const detailRowsEl = $("detail-rows");
const topbarEl = $("office-topbar");
const resultsEl = $("office-results");
const detailRootEl = $("office-detail-root");
const errorEl = $("office-error");
const tooltipEl = $("office-tooltip");
const stationListEl = $("office-station-list");
const mesasEl = $("office-mesas");
const mesasToggleEl = $("mesas-toggle");
const mesasPanelEl = $("mesas-panel");
const mesasSearchEl = $("mesas-search");
const logsToggleEl = $("logs-toggle");
const logsPanelEl = $("logs-panel");
    const logsListEl = $("logs-list");
    const logsMetaEl = $("logs-meta");
    const logsCloseEl = $("logs-close");
    const logsFiltersEl = $("logs-filters");
    const v4StatusEl = $("office-v4-status");

const modules = { assets: null, world: null, life: null, camera: null, dashboard: null, marketDetail: null, topbar: null, blueprintBase: null, overlay: null, baseMode: null, pixelAssets: null, resultsPanel: null, logsPanel: null };
let worldState = null;
let worldModule = null;
let lifeSystem = null;
let officeJson = null;
let camera = null;
let lifeSignature = "";
let blueprintBase = null;
let baseMode = "reference";
let viewport = { width: 0, height: 0 };
let lastFrame = 0;
let pollTimer = 0;
let pollBackoff = POLL_BASE_MS;
let disposed = false;
let hoveredStationId = null;
let reduceMotion = false;
let stationListSignature = "";
let selectedMarketKey = null;
let mesasController = null;
let panController = null;
let lastOverlayStats = null;
let didFitContent = false;
let eventsCursor = 0;
let eventsSeeded = false;
let globalLogs = [];
const marketLogs = new Map();
let logsController = null;
let lastResultsModel = null;

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
 * Derived state — ONE source for desk, MESAS popup, right panel, agents
 * ------------------------------------------------------------------ */

/** Derived state already attached to the station, or derived on the fly. */
function derivedForStation(station) {
  if (station && station.derived) return station.derived;
  if (!station) return null;
  try {
    return deriveMarketState(station.market ?? station, null, officeJson?.connection ?? null);
  } catch (error) {
    warnMissing("state-model.deriveMarketState", error);
    return null;
  }
}

/** Single option label for the MESAS popup (derived label, never raw OPEN). */
export function formatStationOption(station) {
  const label = station?.display ?? station?.symbol ?? station?.marketKey ?? "—";
  const derived = derivedForStation(station);
  const stateLabel = derived?.label ?? String(station?.availability ?? "—").toUpperCase();
  return `${label} · ${stateLabel}`;
}

/* ------------------------------------------------------------------ *
 * REAL EVENT STREAM — GET /api/iq/events (runtime/audit events)
 *
 * ONE poller feeds both the global LOGS box (T3) and the per-market
 * ATIVIDADE EM TEMPO REAL panel (T9). Only existing event types/fields are
 * rendered; nothing is synthesized. Both lists are bounded arrays, so the
 * canvas log and the DOM never grow without limit.
 * ------------------------------------------------------------------ */

const EVENT_TEXT = Object.freeze({
  "connection.ready": "WS CONECTADO",
  "connection.disconnected": "WS DESCONECTADO",
  "account.balances": "SALDOS ATUALIZADOS",
  "markets.default_selection": "SELEÇÃO PADRÃO DE MERCADOS",
  "markets.availability_refreshed": "DISPONIBILIDADE ATUALIZADA",
  "markets.resolved": "ATIVOS RESOLVIDOS",
  "market.reopened": "MERCADO REABERTO",
  "market.unavailable": "MERCADO INDISPONÍVEL",
  "market.config": "CONFIG DE MERCADO",
  "config.global_stake": "STAKE GLOBAL",
  "mode.changed": "MODO ALTERADO",
  kill_switch: "KILL SWITCH",
  "execution.armed": "EXECUÇÃO ARMADA",
  "execution.disarmed": "EXECUÇÃO DESARMADA",
  "market.feature": "FEATURE",
  "market.decision": "DECISÃO",
  "market.signal": "SINAL",
  "market.wait": "AGUARDAR",
  "agent.trader": "TRADER",
  "agent.critic": "CRITIC",
  "agent.consensus": "CONSENSO",
  "candidate.created": "CANDIDATO CRIADO",
  "candidate.updated": "CANDIDATO ATUALIZADO",
  "candidate.revalidated": "CANDIDATO REVALIDADO",
  "candidate.confirmed": "CANDIDATO CONFIRMADO",
  "candidate.cancelled": "CANDIDATO CANCELADO",
  "signal.disposition": "SINAL",
  "signal.disposition.final": "SINAL CONFIRMADO",
  "order.pending": "ORDEM PENDENTE",
  "order.ack": "ORDEM ACEITA",
  "order.rejected": "ORDEM REJEITADA",
  "position.open": "POSIÇÃO ABERTA",
  "position.settled": "RESULTADO",
  "supervisor.review": "SUPERVISOR",
  "professor.review": "REVISÃO",
  "apprentice.config": "APRENDIZ CONFIG",
  "apprentice.review": "APRENDIZ REVISÃO",
  "entry.config": "JIT CONFIG",
  "market.tradability_probe": "PROBE DE TRADABILIDADE",
});

/** Short real description of one event (never invents fields). */
export function describeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = String(event.type ?? "");
  const base = EVENT_TEXT[type] ?? type.toUpperCase();
  const detail = [];
  if (event.action) detail.push(String(event.action));
  if (event.verdict) detail.push(String(event.verdict));
  if (event.status) detail.push(String(event.status));
  if (event.reason) detail.push(String(event.reason).slice(0, 42));
  else if (event.waitReason) detail.push(String(event.waitReason).slice(0, 42));
  if (event.result) detail.push(String(event.result));
  if (Number.isFinite(Number(event.profit))) detail.push(`R$ ${Number(event.profit).toFixed(2)}`);
  if (Number.isFinite(Number(event.rsi14))) detail.push(`RSI ${Number(event.rsi14).toFixed(1)}`);
  return detail.length ? `${base} · ${detail.join(" · ")}` : base;
}

export function eventTone(event) {
  const result = String(event?.result ?? event?.brokerResult ?? "").toUpperCase();
  if (result === "WIN") return "POSITIVE";
  if (result === "LOSS") return "NEGATIVE";
  return null;
}

export function timeTextOf(at) {
  const numeric = Number(at);
  if (!Number.isFinite(numeric)) return "--:--:--";
  try {
    return new Date(numeric).toLocaleTimeString("pt-BR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "--:--:--";
  }
}

function assetLabelFor(marketKey) {
  if (!marketKey) return "SISTEMA";
  if (worldState && Array.isArray(worldState.stations)) {
    const station = worldState.stations.find((candidate) => candidate.marketKey === marketKey);
    if (station) return station.display ?? station.symbol ?? marketKey;
  }
  return String(marketKey).split(":")[0] || "SISTEMA";
}

/** Raw event -> bounded log entry { time, asset, text, tone, marketKey, ... } (campos extras para o painel de LOGS). */
export function formatEventEntry(event) {
  const text = describeEvent(event);
  if (!text) return null;
  const source = typeof event.source === "string" ? event.source : null;
  const agentStrategy = source && source.startsWith("agent:") ? source.split(":")[1] ?? null : null;
  const agentSkill = source && source.startsWith("agent:") ? source.split(":")[2] ?? null : null;
  const profit = Number.isFinite(Number(event.profit)) ? Number(event.profit) : null;
  return {
    time: timeTextOf(event.at),
    at: Number(event.at) || null,
    marketKey: event.marketKey ?? null,
    asset: assetLabelFor(event.marketKey),
    text,
    tone: eventTone(event),
    seq: Number(event.seq) || null,
    type: event.type ?? null,
    agent: event.agentId ?? event.agent ?? null,
    strategy: event.strategyId ?? event.strategy ?? agentStrategy ?? (source && !source.startsWith("agent:") ? source : null),
    skill: event.skill ?? agentSkill ?? null,
    decisionSource: event.decisionSource ?? null,
    controlsExecution: event.controlsExecution === true ? true : event.controlsExecution === false ? false : null,
    executionPolicy: event.executionPolicy ?? null,
    decision: event.action ?? event.direction ?? event.decision ?? null,
    reason: event.reason ?? event.waitReason ?? null,
    orderId: event.brokerOrderId ?? event.orderId ?? null,
    executionId: event.executionId ?? null,
    result: event.result ?? event.brokerResult ?? event.causalResult ?? null,
    error: event.error ?? null,
    profit,
  };
}

export function appendBoundedLog(list, entry, limit) {
  if (!entry) return list;
  list.push(entry);
  if (list.length > limit) list.splice(0, list.length - limit);
  return list;
}

export function getGlobalLogs() {
  return globalLogs.slice();
}

export function getMarketLogs(marketKey) {
  if (!marketKey || !marketLogs.has(marketKey)) return [];
  return marketLogs.get(marketKey).slice();
}

function recordEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  for (const event of events) {
    const entry = formatEventEntry(event);
    if (!entry) continue;
    appendBoundedLog(globalLogs, entry, GLOBAL_LOG_LIMIT);
    if (entry.marketKey) {
      if (!marketLogs.has(entry.marketKey)) marketLogs.set(entry.marketKey, []);
      appendBoundedLog(marketLogs.get(entry.marketKey), entry, MARKET_LOG_LIMIT);
    }
  }
  if (logsController && logsController.isOpen()) {
    try {
      logsController.render(globalLogs);
    } catch (error) {
      warnMissing("logsPanel.render", error);
    }
  }
}

async function pollEventsOnce() {
  try {
    const limit = eventsSeeded ? 100 : 1;
    const response = await fetch(`${EVENTS_URL}?after=${eventsCursor}&limit=${limit}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response || !response.ok) return;
    const json = await response.json();
    if (!json || !Array.isArray(json.events)) return;
    if (!eventsSeeded) {
      // Seed on the live cursor: never replay the whole historical buffer.
      eventsSeeded = true;
      eventsCursor = Number(json.cursor) || 0;
      return;
    }
    recordEvents(json.events);
    if (Number.isFinite(Number(json.cursor))) eventsCursor = Number(json.cursor);
  } catch (error) {
    console.warn(`[office-v3] GET ${EVENTS_URL} falhou`, error);
  }
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
    loadModule("topbar", "./topbar.js"),
    loadModule("blueprintBase", "./blueprint-base.js"),
    loadModule("overlay", "./overlay.js"),
    loadModule("baseMode", "./base-mode.js"),
    loadModule("pixelAssets", "./pixel-assets.js"),
    loadModule("resultsPanel", "./results-panel.js"),
    loadModule("logsPanel", "./logs-panel.js"),
  ]);
  worldModule = modules.world;
}

/* ------------------------------------------------------------------ *
 * Pixel-art pack (assets/office) — loaded in background; procedural
 * fallback stays active until (and if) the pack is ready. `?assets=off`
 * forces the procedural renderer (before/after evidence + fallback proof).
 * ------------------------------------------------------------------ */

let pixelAssetRegistry = null;
let pixelAssetsBooted = false;

function pixelAssetsEnabled() {
  try {
    const win = typeof window !== "undefined" ? window : null;
    const search = win?.location?.search ?? "";
    return !/[?&]assets=off\b/.test(search);
  } catch {
    return true;
  }
}

async function bootPixelAssets() {
  if (pixelAssetsBooted) return pixelAssetRegistry;
  pixelAssetsBooted = true;
  if (!pixelAssetsEnabled()) return null;
  if (!modules.pixelAssets || typeof modules.pixelAssets.loadPixelAssets !== "function") return null;
  try {
    const registry = await modules.pixelAssets.loadPixelAssets({ base: "/assets/office" });
    if (!registry || registry.ready !== true) return null;
    pixelAssetRegistry = registry;
    if (modules.world && typeof modules.world.bindPixelAssets === "function") modules.world.bindPixelAssets(registry);
    if (modules.life && typeof modules.life.bindPixelAssets === "function") {
      modules.life.bindPixelAssets(registry);
      if (lifeSystem) lifeSystem.pixelAssets = registry;
    }
    return registry;
  } catch (error) {
    console.warn("[office-v3] pack pixel-art indisponível — fallback procedural", error);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Hybrid base mode (frozen reference as static layer)
 * ------------------------------------------------------------------ */

function resolveBaseMode() {
  try {
    if (modules.baseMode && typeof modules.baseMode.resolveBaseMode === "function") {
      const search = typeof window !== "undefined" && window.location ? window.location.search : "";
      return modules.baseMode.resolveBaseMode(search, {});
    }
  } catch (error) {
    warnMissing("baseMode.resolveBaseMode", error);
  }
  return "reference";
}

function shouldDrawBase() {
  if (modules.baseMode && typeof modules.baseMode.shouldDrawBlueprintBase === "function") {
    return modules.baseMode.shouldDrawBlueprintBase(baseMode);
  }
  return baseMode === "reference" || baseMode === "original";
}

async function loadHybridBase() {
  if (!modules.blueprintBase || typeof modules.blueprintBase.loadBlueprintBase !== "function") return null;
  try {
    const asset = typeof modules.blueprintBase.assetForBaseMode === "function"
      ? modules.blueprintBase.assetForBaseMode(baseMode)
      : undefined;
    return await modules.blueprintBase.loadBlueprintBase(asset);
  } catch (error) {
    warnMissing("blueprintBase.loadBlueprintBase", error);
    return null;
  }
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
    "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF", "EUR/USD",
    "GBP/USD", "USD/JPY", "EUR/GBP", "GBP/JPY", "AUD/USD OTC", "USD/CAD OTC", "USD/CHF", "EUR/JPY OTC",
    "AUD/JPY OTC", "BTC/USD", "ETH/USD OTC", "LTC/USD OTC", "XRP/USD OTC", "ADA/USD OTC", "US30", "US100", "US500",
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
  if (modules.camera && typeof modules.camera.refreshWorldBounds === "function") {
    try {
      modules.camera.refreshWorldBounds(camera, worldState);
    } catch (error) {
      warnMissing("camera.refreshWorldBounds", error);
    }
  }
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
  // Born centered: frame the real office content once with a small even margin on
  // all four sides (padding 20 usa melhor o espaco sem cortar o mapa). Depois o
  // usuario controla (nunca re-FITa em snapshots/resizes).
  if (!didFitContent && modules.camera && typeof modules.camera.fitContent === "function" && worldState.contentBounds) {
    try {
      modules.camera.fitContent(camera, worldState, { padding: 20 });
      didFitContent = true;
    } catch (error) {
      warnMissing("camera.fitContent", error);
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

function isHybrid() {
  return shouldDrawBase() && !!blueprintBase && !!modules.overlay;
}

let stationResolver = null;
let stationResolverWorld = null;

/**
 * THE single anchor source for the CURRENT world. On the default (procedural)
 * path it is `world.createAnchorResolver` (desk geometry in world space); the
 * hybrid debug path keeps the blueprint resolver. Hit test, zoom/focus, MESAS
 * popup and the right panel all go through this one resolver, so a station can
 * never resolve to another market's desk.
 */
function anchorResolver() {
  if (!worldState) return null;
  if (stationResolver && stationResolverWorld === worldState) return stationResolver;
  try {
    if (isHybrid() && modules.overlay && typeof modules.overlay.createAnchorResolver === "function") {
      stationResolver = modules.overlay.createAnchorResolver(worldState.stations);
    } else if (worldModule && typeof worldModule.createAnchorResolver === "function") {
      stationResolver = worldModule.createAnchorResolver(worldState.stations);
    } else {
      stationResolver = null;
    }
  } catch (error) {
    warnMissing("createAnchorResolver", error);
    stationResolver = null;
  }
  stationResolverWorld = worldState;
  return stationResolver;
}

function anchorFor(station, index) {
  if (!station) return null;
  const resolver = anchorResolver();
  return resolver ? resolver.anchorFor(station, index) : null;
}

function deskFocus(station, index) {
  const anchor = anchorFor(station, index);
  if (anchor) {
    return {
      marketKey: station.marketKey ?? null,
      id: station.id ?? null,
      x: anchor.desk.x,
      y: anchor.desk.y,
      w: anchor.desk.w,
      h: anchor.desk.h,
      centerX: anchor.x,
      centerY: anchor.desk.y + anchor.desk.h / 2,
    };
  }
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

function zoomToStation(station, index) {
  if (!camera || !station) return;
  if (modules.camera && typeof modules.camera.zoomToDesk === "function") {
    try {
      modules.camera.zoomToDesk(camera, deskFocus(station, index));
      if (reduceMotion && camera.target) modules.camera.updateCamera(camera, camera.target.duration);
      return;
    } catch (error) {
      warnMissing("camera.zoomToDesk", error);
    }
  }
  const focus = deskFocus(station, index);
  camera.zoom = Math.min(camera.maxZoom ?? 4, Math.max(camera.minZoom ?? 0.25, 1.6));
  camera.x = focus.centerX - viewport.width / (2 * camera.zoom);
  camera.y = focus.centerY - viewport.height / (2 * camera.zoom);
}

/* ------------------------------------------------------------------ *
 * Market detail (desk click + MESAS selection) — one marketKey at a time
 * ------------------------------------------------------------------ */

function showDetailFallback(station) {
  if (!detailEl || !doc) return;
  detailTitleEl.textContent = station.display ?? station.symbol ?? station.marketKey ?? "—";
  detailRowsEl.innerHTML = "";
  const derived = derivedForStation(station);
  const rows = [
    { label: "Mercado", value: station.marketKey ?? "—" },
    { label: "Disponibilidade broker", value: station.availability ?? "—" },
    { label: "Feed status", value: derived ? `${derived.feedStatus}${derived.feedReason ? ` · ${derived.feedReason}` : ""}` : "—" },
    { label: "Payout", value: station.payout == null ? "—" : `${station.payout}%` },
    { label: "Estado derivado", value: derived?.label ?? "—" },
    { label: "Agentes", value: derived ? (derived.agentsWorking ? "TRABALHANDO" : "SEM AGENTES (ATIVO FECHADO)") : "—" },
  ];
  for (const row of rows) {
    const div = doc.createElement("div");
    div.className = "row";
    const label = doc.createElement("span");
    label.textContent = row.label;
    const value = doc.createElement("span");
    value.textContent = row.value ?? "—";
    div.append(label, value);
    detailRowsEl.append(div);
  }
  detailEl.style.display = "block";
}

function closeDetail() {
  selectedMarketKey = null;
  if (modules.marketDetail && typeof modules.marketDetail.closeMarketDetail === "function") {
    try {
      modules.marketDetail.closeMarketDetail();
    } catch (error) {
      warnMissing("marketDetail.closeMarketDetail", error);
    }
  }
  if (detailRootEl && typeof detailRootEl.replaceChildren === "function") {
    try {
      detailRootEl.replaceChildren();
    } catch {
      /* fail-soft */
    }
  }
  if (detailEl) detailEl.style.display = "none";
}

function openDetail(station, marketKey, options = {}) {
  const key = marketKey ?? station?.marketKey ?? null;
  if (!key) return;
  selectedMarketKey = key;
  if (modules.marketDetail && typeof modules.marketDetail.mountMarketDetail === "function" && detailRootEl) {
    try {
      modules.marketDetail.mountMarketDetail(detailRootEl, officeJson ?? {}, key, {
        onStakeApplied: requestRefresh,
        initialTab: options.initialTab ?? activeDetailTab(),
        eventLog: getMarketLogs(key),
        onClose: (closedKey) => {
          if (selectedMarketKey === closedKey) selectedMarketKey = null;
        },
      });
      if (detailRootEl.setAttribute) detailRootEl.setAttribute("data-market-key", key);
      return;
    } catch (error) {
      warnMissing("marketDetail.mountMarketDetail", error);
    }
  }
  if (station) showDetailFallback(station);
}

function activeDetailTab() {
  if (!detailRootEl || typeof detailRootEl.querySelector !== "function") return null;
  const tab = detailRootEl.querySelector('[role="tab"][aria-selected="true"]');
  return tab && tab.dataset ? tab.dataset.tab ?? null : null;
}

function isDetailEditing() {
  if (!doc || !detailRootEl) return false;
  const active = doc.activeElement;
  if (!active) return false;
  if (active === detailRootEl) return true;
  if (detailRootEl.contains && typeof detailRootEl.contains === "function") return detailRootEl.contains(active);
  return false;
}

function syncDetailWithSnapshot() {
  if (!selectedMarketKey) return;
  const market = Array.isArray(officeJson?.markets)
    ? officeJson.markets.find((candidate) => candidate && candidate.marketKey === selectedMarketKey)
    : null;
  if (!market) {
    closeDetail();
    return;
  }
  if (isDetailEditing()) return;
  openDetail(findStation(selectedMarketKey), selectedMarketKey);
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
 * Top bar (ARM, AUTO, stake — real endpoints owned by topbar.js)
 * ------------------------------------------------------------------ */

function mountTopbar() {
  if (!topbarEl || !modules.topbar || typeof modules.topbar.mountTopBar !== "function") return;
  try {
    modules.topbar.mountTopBar(topbarEl, officeJson ?? {}, { onRefresh: requestRefresh });
  } catch (error) {
    warnMissing("topbar.mountTopBar", error);
    modules.topbar = null;
  }
}

function requestRefresh() {
  if (disposed) return;
  if (pollTimer) window.clearTimeout(pollTimer);
  void pollOnce();
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
    if (pixelAssetRegistry) {
      life.pixelAssets = pixelAssetRegistry;
      if (typeof modules.life.bindPixelAssets === "function") modules.life.bindPixelAssets(pixelAssetRegistry);
    }
    return life;
  } catch (error) {
    warnMissing("life.createLifeSystem", error);
    modules.life = null;
    return null;
  }
}

/** Working flag consumed by the agents: shared derived state only. */
export function stationWorkingPresence(station) {
  const derived = station?.derived ?? null;
  return derived ? derived.agentsWorking === true : station?.active === true;
}

/** Agents work ONLY through the shared derived state (feed-aware). */
function syncPresence() {
  if (!lifeSystem || !modules.life || typeof modules.life.setPresence !== "function") return;
  try {
    for (const station of worldState.stations) {
      modules.life.setPresence(lifeSystem, station.id, stationWorkingPresence(station));
    }
  } catch (error) {
    warnMissing("life.setPresence", error);
  }
}

function stationSignature(state) {
  return state.stations.map((station) => station.marketKey ?? station.id ?? "?").join("|");
}

/** Signature that also reacts to derived state changes (feed fresh→stale). */
function stationStateSignature(state) {
  return state.stations.map((station) => `${station.marketKey ?? station.id ?? "?"}:${station.derived?.state ?? "?"}`).join("|");
}

function mountResults(json) {
  if (!resultsEl || !modules.resultsPanel || typeof modules.resultsPanel.mountResultsPanel !== "function") return;
  try {
    lastResultsModel = modules.resultsPanel.mountResultsPanel(resultsEl, json);
  } catch (error) {
    warnMissing("resultsPanel.mountResultsPanel", error);
  }
}

function renderV4Status(json) {
  if (!v4StatusEl) return;
  const v4 = json?.aux?.rsiAgentsV4 ?? null;
  if (!v4) { v4StatusEl.hidden = true; return; }
  const universe = v4.universe ?? {};
  const enabled = Number(universe.enabled) || 0;
  const total = Number(universe.total) || 0;
  const routing = json?.aux?.executionRouting ?? {};
  const v4Source = (routing.sources ?? []).find((row) => String(row.source ?? "").startsWith("agent-v4")) ?? null;
  const controls = v4Source?.controlsExecution === true;
  const blocked = enabled === 0 && total > 0;
  v4StatusEl.hidden = false;
  v4StatusEl.dataset.v4Enabled = String(enabled);
  v4StatusEl.dataset.v4Total = String(total);
  v4StatusEl.dataset.v4Controls = controls ? "true" : "false";
  v4StatusEl.classList.toggle("is-blocked", blocked);
  v4StatusEl.textContent = blocked
    ? `RSI V4 BLOQUEADA · 0/${total} instrumentos ligados em MESAS · o agente que controla execução (${controls ? "EXEC=true" : "EXEC=false"}) não avalia nada até religar os instrumentos em MESAS`
    : `RSI V4 · ${enabled}/${total} instrumentos MESAS · ${v4.strategy ?? "RSI_REVERSAL_V4"} · EXEC=${controls ? "true" : "false"} · stake R$ ${Number(v4.stakeBrl ?? 0).toFixed(2)}`;
}

function applyOfficeJson(json) {
  if (!worldModule || typeof worldModule.buildWorldState !== "function") return;
  officeJson = json;
  try {
    renderV4Status(json);
  } catch (error) {
    warnMissing("renderV4Status", error);
  }
  worldState = worldModule.buildWorldState(json);
  try {
    attachDerivedStates(worldState, json);
  } catch (error) {
    warnMissing("state-model.attachDerivedStates", error);
  }
  mountResults(json);
  attachWorldToCamera();

  const signature = stationSignature(worldState);
  if (!lifeSystem || signature !== lifeSignature) {
    lifeSystem = createLife();
    lifeSignature = signature;
  }
  syncPresence();

  mountTopbar();
  syncDetailWithSnapshot();
  refreshStationList();
}

/* ------------------------------------------------------------------ *
 * Rendering — one canvas, world first, agents on top
 * ------------------------------------------------------------------ */

function renderFrame(now) {
  if (disposed) return;
  const win = typeof window !== "undefined" && window ? window : null;
  if (win && typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(renderFrame);
  else if (typeof requestAnimationFrame === "function") requestAnimationFrame(renderFrame);
  else return;
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

  const hybrid = shouldDrawBase() && blueprintBase && modules.overlay && typeof modules.overlay.drawDynamicOverlay === "function";
  if (hybrid) {
    try {
      ctx.save();
      if (modules.camera && typeof modules.camera.applyCamera === "function") {
        modules.camera.applyCamera(ctx, camera);
      } else {
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);
      }
      if (modules.blueprintBase && typeof modules.blueprintBase.drawBlueprintBase === "function") {
        modules.blueprintBase.drawBlueprintBase(ctx, blueprintBase);
      }
      lastOverlayStats = modules.overlay.drawDynamicOverlay(ctx, worldState, lifeSystem, camera, {
        drawCharacter: modules.assets && modules.assets.drawCharacter,
        hoverMarketKey: hoveredStationId,
      });
      ctx.restore();
    } catch (error) {
      console.warn("[office-v3] render híbrido falhou — fallback procedural", error);
      blueprintBase = null;
    }
  } else {
    lastOverlayStats = null;
    try {
      worldModule.drawWorld(ctx, worldState, camera, { agents: !lifeSystem, timeMs: lifeSystem ? lifeSystem.time : now });
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
  }

  if (cameraEl) cameraEl.textContent = `zoom ${Math.round((camera?.zoom ?? 1) * 100)}%`;
}

/* ------------------------------------------------------------------ *
 * Input — pan / zoom / zoom-to-desk / detail
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Pan navigation — SPACE + left drag (design-tool style)
 * ------------------------------------------------------------------ */

export function bindPanNavigation(elements = {}) {
  const canvasEl = elements.canvas;
  const bodyEl = elements.body ?? null;
  const target = elements.target ?? canvasEl;
  const getCamera = typeof elements.getCamera === "function" ? elements.getCamera : () => null;
  const getCameraModule = typeof elements.getCameraModule === "function" ? elements.getCameraModule : () => null;
  if (!canvasEl || typeof canvasEl.addEventListener !== "function") throw new Error("TC_V3_PAN_CANVAS_REQUIRED");
  if (!target || typeof target.addEventListener !== "function") throw new Error("TC_V3_PAN_TARGET_REQUIRED");

  const SPACE_CLASS = "pan-ready";
  const SPACE_BODY_CLASS = "tc-v3-select-off";
  const PAN_BODY_CLASS = "tc-v3-panning";
  let spaceDown = false;
  let panning = false;
  let moved = false;
  let suppressClick = false;
  let activePointerId = null;
  let downX = 0;
  let downY = 0;

  function isEditable(node) {
    const tag = node && node.tagName ? String(node.tagName).toUpperCase() : "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node?.isContentEditable === true;
  }

  function setSpaceDown(value) {
    spaceDown = value === true;
    if (canvasEl.classList?.toggle) canvasEl.classList.toggle(SPACE_CLASS, spaceDown);
    if (bodyEl?.classList?.toggle) bodyEl.classList.toggle(SPACE_BODY_CLASS, spaceDown);
    if (!spaceDown && !panning && canvasEl.classList?.remove) canvasEl.classList.remove("dragging");
    // Inline cursor from hover ("pointer"/"grab") would override the
    // .pan-ready/.dragging CSS cursors; clear it so the Space cursor wins.
    if (canvasEl.style) canvasEl.style.cursor = "";
  }

  function beginPan(event) {
    moved = false;
    panning = true;
    activePointerId = Number.isFinite(Number(event?.pointerId)) ? Number(event.pointerId) : null;
    downX = Number(event?.clientX) || 0;
    downY = Number(event?.clientY) || 0;
    if (canvasEl.classList?.add) canvasEl.classList.add("dragging");
    if (bodyEl?.classList?.add) bodyEl.classList.add(PAN_BODY_CLASS);
    if (typeof event?.preventDefault === "function") event.preventDefault();
    if (activePointerId !== null && typeof canvasEl.setPointerCapture === "function") {
      try {
        canvasEl.setPointerCapture(activePointerId);
      } catch {
        /* pointer capture is best-effort */
      }
    }
    const cameraModule = getCameraModule();
    if (cameraModule && typeof cameraModule.handleDragStart === "function") cameraModule.handleDragStart(getCamera(), event);
    return true;
  }

  function movePan(event) {
    if (!panning) return;
    if (activePointerId !== null && event?.pointerId !== undefined && Number(event.pointerId) !== activePointerId) return;
    if (typeof event?.preventDefault === "function") event.preventDefault();
    if (Math.hypot((Number(event?.clientX) || 0) - downX, (Number(event?.clientY) || 0) - downY) > DRAG_CLICK_THRESHOLD) moved = true;
    const cameraModule = getCameraModule();
    if (cameraModule && typeof cameraModule.handleDragMove === "function") cameraModule.handleDragMove(getCamera(), event);
  }

  function endPan(event) {
    if (!panning) return false;
    panning = false;
    if (moved) suppressClick = true;
    // `moved` is only true for the gesture that just ended. Leaving it true
    // would make wasMoved() sticky and suppress every later plain desk click
    // until the next Space drag (real-browser regression: click after pan
    // never opened the panel). One-shot suppression is what guards the click.
    moved = false;
    const pointerId = activePointerId;
    activePointerId = null;
    if (pointerId !== null && typeof canvasEl.releasePointerCapture === "function") {
      try {
        canvasEl.releasePointerCapture(pointerId);
      } catch {
        /* capture may already be gone */
      }
    }
    if (canvasEl.classList?.remove) canvasEl.classList.remove("dragging");
    if (bodyEl?.classList?.remove) bodyEl.classList.remove(PAN_BODY_CLASS);
    const cameraModule = getCameraModule();
    if (cameraModule && typeof cameraModule.handleDragEnd === "function") cameraModule.handleDragEnd(getCamera(), event ?? {});
    return true;
  }

  /** blur/pointercancel always releases BOTH the Space mode and the drag. */
  function cancelPan(event) {
    if (panning) endPan(event);
    setSpaceDown(false);
  }

  function onKeyDown(event) {
    if (event.key !== " " && event.code !== "Space") return;
    if (isEditable(event.target)) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    setSpaceDown(true);
  }

  function onKeyUp(event) {
    if (event.key !== " " && event.code !== "Space") return;
    setSpaceDown(false);
  }

  function onPointerDown(event) {
    if (!spaceDown || panning) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.isPrimary === false) return;
    beginPan(event);
  }

  function onMouseDown(event) {
    if (!spaceDown || panning) return;
    if (event.button !== undefined && event.button !== 0) return;
    beginPan(event);
  }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", () => cancelPan({}));
  target.addEventListener("pointercancel", (event) => cancelPan(event));
  canvasEl.addEventListener("pointerdown", onPointerDown);
  canvasEl.addEventListener("mousedown", onMouseDown);
  target.addEventListener("pointermove", movePan);
  target.addEventListener("mousemove", movePan);
  target.addEventListener("pointerup", (event) => endPan(event));
  target.addEventListener("mouseup", (event) => endPan(event));

  return {
    isSpaceDown: () => spaceDown,
    isSpaceReady: () => spaceDown,
    isPanning: () => panning,
    wasMoved: () => moved,
    shouldSuppressClick: () => suppressClick,
    consumeClickSuppression: () => {
      const value = suppressClick;
      suppressClick = false;
      return value;
    },
    activePointerId: () => activePointerId,
    cancelPan,
    endPan,
    setSpaceDown,
  };
}

/* ------------------------------------------------------------------ *
 * MESAS — collapsible, searchable market popup (↑↓ + Enter)
 * ------------------------------------------------------------------ */

export function filterStationOptions(stations, query) {
  const list = Array.isArray(stations) ? stations.filter((station) => station && typeof station === "object") : [];
  const text = String(query ?? "").trim().toLowerCase();
  if (!text) return list;
  const tokens = text.split(/\s+/).filter(Boolean);
  return list.filter((station) => {
    const derived = station.derived ?? null;
    const haystack = [station.display, station.symbol, station.marketKey, station.canonical, station.availability, derived?.label, derived?.shortLabel, derived?.state]
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function createMesasController(options = {}) {
  const controllerDoc = options.document ?? (typeof globalThis.document !== "undefined" ? globalThis.document : null);
  const toggle = options.toggle ?? null;
  const panel = options.panel ?? null;
  const search = options.search ?? null;
  const list = options.list ?? null;
  const onSelect = typeof options.onSelect === "function" ? options.onSelect : () => {};
  let stations = [];
  let visible = [];
  let activeIndex = 0;
  let query = "";

  function setOpen(open) {
    const next = open === true;
    if (panel) panel.hidden = !next;
    if (toggle && typeof toggle.setAttribute === "function") toggle.setAttribute("aria-expanded", next ? "true" : "false");
    if (toggle?.classList?.toggle) toggle.classList.toggle("is-open", next);
    if (next && search && typeof search.focus === "function") search.focus();
    return next;
  }

  function optionsInList() {
    if (!list || typeof list.querySelectorAll !== "function") return [];
    return [...list.querySelectorAll(".station-option")];
  }

  function paintActive() {
    for (const [index, option] of optionsInList().entries()) {
      const active = index === activeIndex;
      if (option.classList?.toggle) option.classList.toggle("active", active);
      if (typeof option.setAttribute === "function") option.setAttribute("aria-selected", active ? "true" : "false");
      option.tabIndex = active ? 0 : -1;
    }
  }

  function focusActive() {
    const option = optionsInList()[activeIndex];
    if (option && typeof option.focus === "function") option.focus();
  }

  function selectIndex(index) {
    const station = visible[index];
    if (!station) return null;
    activeIndex = index;
    paintActive();
    const key = station.marketKey ?? station.id ?? null;
    if (key) onSelect(key);
    setOpen(false);
    return key;
  }

  function render() {
    visible = filterStationOptions(stations, query);
    activeIndex = Math.min(activeIndex, Math.max(0, visible.length - 1));
    if (list && controllerDoc) {
      list.textContent = "";
      visible.forEach((station, index) => {
        const option = controllerDoc.createElement("div");
        option.className = "station-option";
        if (typeof option.setAttribute === "function") {
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
        }
        if (station.marketKey) option.dataset.marketKey = station.marketKey;
        option.dataset.index = String(index);
        const derived = station.derived ?? null;
        if (derived?.state) option.dataset.state = derived.state;
        option.textContent = formatStationOption(station);
        if (option.classList?.toggle) option.classList.toggle("active", index === activeIndex);
        option.addEventListener("click", () => selectIndex(index));
        list.appendChild(option);
      });
      if (!visible.length) {
        const empty = controllerDoc.createElement("div");
        empty.className = "station-empty";
        empty.textContent = "NENHUM MERCADO";
        list.appendChild(empty);
      }
    }
    return visible;
  }

  function handleKeydown(event) {
    if (!visible.length) return;
    const key = event.key;
    const fromSearch = event.target === search;
    if (key === "ArrowDown" || key === "ArrowRight") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      activeIndex = (activeIndex + 1) % visible.length;
      paintActive();
      if (!fromSearch) focusActive();
    } else if (key === "ArrowUp" || key === "ArrowLeft") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      activeIndex = (activeIndex - 1 + visible.length) % visible.length;
      paintActive();
      if (!fromSearch) focusActive();
    } else if (key === "Home") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      activeIndex = 0;
      paintActive();
      if (!fromSearch) focusActive();
    } else if (key === "End") {
      if (typeof event.preventDefault === "function") event.preventDefault();
      activeIndex = visible.length - 1;
      paintActive();
      if (!fromSearch) focusActive();
    } else if (key === "Enter" || (key === " " && !fromSearch)) {
      if (typeof event.preventDefault === "function") event.preventDefault();
      selectIndex(activeIndex);
    }
  }

  if (toggle && typeof toggle.addEventListener === "function") {
    toggle.addEventListener("click", () => setOpen(panel ? panel.hidden : true));
  }
  if (search && typeof search.addEventListener === "function") {
    search.addEventListener("input", (event) => {
      query = String(event?.target?.value ?? "").toLowerCase();
      activeIndex = 0;
      render();
    });
    search.addEventListener("keydown", handleKeydown);
  }
  if (list && typeof list.addEventListener === "function") list.addEventListener("keydown", handleKeydown);

  setOpen(false);
  render();

  return {
    setStations(next) {
      stations = Array.isArray(next) ? next : [];
      activeIndex = Math.min(activeIndex, Math.max(0, stations.length - 1));
      return render();
    },
    setQuery(next) {
      query = String(next ?? "").toLowerCase();
      activeIndex = 0;
      return render();
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(panel ? panel.hidden : true),
    isOpen: () => Boolean(panel && panel.hidden === false),
    getVisible: () => visible.slice(),
    getVisibleKeys: () => visible.map((station) => station.marketKey ?? station.id ?? null),
    getActiveIndex: () => activeIndex,
    selectIndex,
    handleKeydown,
    render,
  };
}

/* ------------------------------------------------------------------ *
 * Input — pan / zoom / zoom-to-desk / detail
 * ------------------------------------------------------------------ */

function bindInput() {
  if (!canvas) return;
  let downX = 0;
  let downY = 0;
  let moved = false;
  const eventTarget = typeof window !== "undefined" && window ? window : canvas;

  panController = bindPanNavigation({
    canvas,
    body: doc ? doc.body : null,
    target: eventTarget,
    getCamera: () => camera,
    getCameraModule: () => modules.camera,
  });

  const markDown = (event) => {
    moved = false;
    downX = event.clientX ?? 0;
    downY = event.clientY ?? 0;
  };
  const markMove = (event) => {
    if (Math.hypot((event.clientX ?? 0) - downX, (event.clientY ?? 0) - downY) > DRAG_CLICK_THRESHOLD) moved = true;
  };
  canvas.addEventListener("mousedown", markDown);
  canvas.addEventListener("pointerdown", markDown);
  eventTarget.addEventListener("mousemove", markMove);
  eventTarget.addEventListener("pointermove", markMove);

  // Normal wheel = scroll/pan (vertical, horizontal with Shift). Ctrl/Meta+wheel
  // = smooth zoom centered on the cursor. Wheel NEVER zooms on its own.
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!camera) return;
      if (event.ctrlKey === true || event.metaKey === true) {
        event.preventDefault();
        if (modules.camera && typeof modules.camera.handleWheel === "function") modules.camera.handleWheel(camera, event);
        return;
      }
      event.preventDefault();
      if (modules.camera && typeof modules.camera.handleScrollPan === "function") {
        modules.camera.handleScrollPan(camera, event);
      } else {
        const zoom = camera.zoom || 1;
        camera.y += (event.deltaY || 0) / zoom;
        camera.x += (event.shiftKey ? event.deltaY || 0 : event.deltaX || 0) / zoom;
        clampCamera();
      }
    },
    { passive: false },
  );

  canvas.addEventListener("click", (event) => {
    const panned = Boolean(panController && panController.wasMoved());
    const suppressed = Boolean(panController && panController.consumeClickSuppression());
    if (moved || panned || suppressed || !worldState) return;
    const station = resolveClickedStation(event);
    if (!station) {
      closeDetail();
      return;
    }
    zoomToStation(station);
    openDetail(station);
  });

  canvas.addEventListener("mousemove", (event) => {
    if (moved || (panController && (panController.isPanning() || panController.isSpaceReady()))) return;
    updateHover(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (moved || (panController && (panController.isPanning() || panController.isSpaceReady()))) return;
    updateHover(event);
  });
  canvas.addEventListener("mouseleave", clearHover);

  const closeButton = $("detail-close");
  if (closeButton) closeButton.addEventListener("click", closeDetail);
  if (eventTarget.addEventListener) {
    eventTarget.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (logsController && logsController.isOpen()) {
        logsController.close();
        return;
      }
      closeDetail();
    });
    eventTarget.addEventListener("resize", resize);
  }

  const media = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  if (media) {
    reduceMotion = media.matches === true;
    const onChange = (event) => { reduceMotion = event.matches === true; };
    if (typeof media.addEventListener === "function") media.addEventListener("change", onChange);
    else if (typeof media.addListener === "function") media.addListener(onChange);
  }

  mesasController = createMesasController({
    document: doc,
    toggle: mesasToggleEl,
    panel: mesasPanelEl,
    search: mesasSearchEl,
    list: stationListEl,
    getStations: () => (worldState ? worldState.stations : []),
    onSelect: (marketKey) => selectMarket(marketKey),
  });

  if (detailRootEl && typeof detailRootEl.addEventListener === "function") {
    detailRootEl.addEventListener("tracecom:market-select", onMarketSelect);
  }
  globalThis.__tracecomSelectMarket = (marketKey) => {
    if (typeof marketKey === "string" && marketKey) selectMarket(marketKey);
  };
}

/* ------------------------------------------------------------------ *
 * LOGS overlay — created AFTER modules load (logs-panel.js dynamic import)
 * ------------------------------------------------------------------ */

function bindLogsPanel() {
  if (logsController || !modules.logsPanel || typeof modules.logsPanel.createLogsPanel !== "function") return;
  try {
    logsController = modules.logsPanel.createLogsPanel({
      document: doc,
      toggle: logsToggleEl,
      panel: logsPanelEl,
      list: logsListEl,
      meta: logsMetaEl,
          close: logsCloseEl,
          filters: logsFiltersEl,
          limit: GLOBAL_LOG_LIMIT,
    });
    if (logsController) logsController.render(globalLogs);
  } catch (error) {
    warnMissing("logsPanel.createLogsPanel", error);
    logsController = null;
  }
}

/* ------------------------------------------------------------------ *
 * Debug/automation hook (read-only + select) — used by
 * scripts/office-v3-browser-check.mjs. Never issues orders/stakes.
 * ------------------------------------------------------------------ */

function installDebugHooks() {
  if (typeof globalThis === "undefined" || !globalThis) return;
  globalThis.__tracecomOffice = {
    version: "office-v3-debug.1.2.0",
    camera: () => camera,
    cameraModule: () => modules.camera,
    worldState: () => worldState,
    worldModule: () => worldModule,
    life: () => lifeSystem,
    lifeModule: () => modules.life,
    officeJson: () => officeJson,
    baseMode: () => baseMode,
    blueprintBase: () => blueprintBase,
    anchorResolver: () => anchorResolver(),
    overlay: () => modules.overlay,
    overlayStats: () => lastOverlayStats,
    pan: () => panController,
    mesas: () => mesasController,
    logsController: () => logsController,
    resultsModel: () => lastResultsModel,
    selectedMarketKey: () => selectedMarketKey,
    derivedFor: (marketKey) => {
      if (!worldState || !marketKey) return null;
      const pools = [worldState.stations, worldState.allStations];
      for (const pool of pools) {
        if (!Array.isArray(pool)) continue;
        const station = pool.find((candidate) => candidate && (candidate.marketKey === marketKey || candidate.id === marketKey));
        if (station) return derivedForStation(station);
      }
      return null;
    },
    selectMarket: (marketKey) => selectMarket(marketKey),
    closeDetail: () => closeDetail(),
    logs: () => getGlobalLogs(),
    marketLogs: (marketKey) => getMarketLogs(marketKey),
    eventsCursor: () => eventsCursor,
    pixelAssets: () => pixelAssetRegistry,
    pixelAssetsActive: () => Boolean(modules.world && typeof modules.world.pixelAssetsActive === "function" && modules.world.pixelAssetsActive()),
    lastDrawStats: () => (lifeSystem && lifeSystem.lastDrawStats) || null,
    /**
     * Reconciliation of the four agent numbers (audit, read-only):
     * registered = life registry pairs; possible = 2 x markets;
     * working = 2 x WORKING markets; rendered = last frame drawAgents count.
     */
    agentAudit: () => {
      const stations = worldState && Array.isArray(worldState.stations) ? worldState.stations : [];
      const life = lifeSystem;
      const stats = (life && life.lastDrawStats) || null;
      const workingMarkets = stations.filter((station) => stationWorkingPresence(station)).length;
      const renderedByMarket = {};
      for (const entry of stats?.agents ?? []) {
        const key = entry?.marketKey ?? "?";
        if (!renderedByMarket[key]) renderedByMarket[key] = { trader: 0, critic: 0, total: 0 };
        if (entry?.role === "trader") renderedByMarket[key].trader += 1;
        else if (entry?.role === "critic") renderedByMarket[key].critic += 1;
        renderedByMarket[key].total += 1;
      }
      return {
        registered: Array.isArray(life?.agents) ? life.agents.length : 0,
        possible: stations.length * 2,
        markets: stations.length,
        workingMarkets,
        working: workingMarkets * 2,
        rendered: stats?.drawn ?? 0,
        renderedUnique: stats?.unique ?? 0,
        duplicates: stats?.duplicates ?? 0,
        hidden: Array.isArray(life?.agents) ? life.agents.filter((agent) => agent?.hidden === true).length : 0,
        renderedByMarket,
        pixelAssets: pixelAssetRegistry ? { ready: true, count: pixelAssetRegistry.counts } : null,
      };
    },
  };
}

function canvasPointFromEvent(event) {
  const rect = canvas && typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
  const scaleX = rect && rect.width ? canvas.width / rect.width : 1;
  const scaleY = rect && rect.height ? canvas.height / rect.height : 1;
  const left = rect ? rect.left : 0;
  const top = rect ? rect.top : 0;
  return { x: (event.clientX - left) * scaleX, y: (event.clientY - top) * scaleY };
}

function screenToWorldFromClient(clientX, clientY) {
  const point = canvasPointFromEvent({ clientX, clientY });
  return screenToWorld(point.x, point.y);
}

/** screenToWorld + station hit test (overlay anchors in hybrid mode). */
function stationAtScreen(clientX, clientY) {
  if (!worldState) return null;
  const point = screenToWorldFromClient(clientX, clientY);
  if (isHybrid() && modules.overlay && typeof modules.overlay.hitTestAnchor === "function") {
    try {
      const hit = modules.overlay.hitTestAnchor(worldState, point.x, point.y);
      if (hit) return hit;
    } catch (error) {
      warnMissing("overlay.hitTestAnchor", error);
    }
  }
  if (worldModule && typeof worldModule.hitTestStation === "function") {
    return worldModule.hitTestStation(worldState, point.x, point.y);
  }
  return null;
}

function resolveClickedStation(event) {
  return stationAtScreen(event.clientX, event.clientY);
}

function updateHover(event) {
  if (panController && (panController.isSpaceReady() || panController.isPanning())) {
    hideTooltip();
    if (canvas) canvas.style.cursor = "";
    return;
  }
  const station = stationAtScreen(event.clientX, event.clientY);
  hoveredStationId = station ? station.marketKey ?? station.id ?? null : null;
  if (camera) camera.hoverStationId = hoveredStationId;
  if (canvas) canvas.style.cursor = station ? "pointer" : "grab";
  if (station) showTooltip(station, event.clientX, event.clientY);
  else hideTooltip();
}

function clearHover() {
  hoveredStationId = null;
  if (camera) camera.hoverStationId = null;
  if (canvas) canvas.style.cursor = "";
  hideTooltip();
}

function showTooltip(station, clientX, clientY) {
  if (!tooltipEl) return;
  const label = station.display ?? station.symbol ?? station.marketKey ?? "—";
  const derived = derivedForStation(station);
  const stateLabel = derived?.label ?? String(station.availability ?? "—").toUpperCase();
  const payout = station.payout == null ? "—" : `${station.payout}%`;
  tooltipEl.textContent = `${label} · ${stateLabel} · ${payout}`;
  tooltipEl.hidden = false;
  tooltipEl.style.left = `${Math.round(clientX + 14)}px`;
  tooltipEl.style.top = `${Math.round(clientY + 14)}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.hidden = true;
}

/* ------------------------------------------------------------------ *
 * MESAS list refresh (collapsible popup controller)
 * ------------------------------------------------------------------ */

function refreshStationList() {
  if (!mesasController || !worldState) return;
  const signature = stationStateSignature(worldState);
  if (signature === stationListSignature) return;
  stationListSignature = signature;
  mesasController.setStations(worldState.stations);
}

/* ------------------------------------------------------------------ *
 * Resize / poll / boot
 * ------------------------------------------------------------------ */

function resize() {
  const win = typeof window !== "undefined" && window ? window : null;
  viewport.width = Math.max(320, win ? win.innerWidth : (canvas ? canvas.width : 1536));
  viewport.height = Math.max(240, win ? win.innerHeight : (canvas ? canvas.height : 1024));
  if (canvas) {
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    if (ctx) ctx.imageSmoothingEnabled = false;
  }
  if (camera && camera.viewport) {
    camera.viewport.width = viewport.width;
    camera.viewport.height = viewport.height;
  }
  if (camera && modules.camera && typeof modules.camera.updateViewport === "function") {
    try {
      modules.camera.updateViewport(camera, viewport.width, viewport.height);
    } catch (error) {
      warnMissing("camera.updateViewport", error);
    }
  }
  if (camera && worldState) attachWorldToCamera();
  clampCamera();
}

function schedulePoll() {
  if (disposed) return;
  const win = typeof window !== "undefined" && window ? window : null;
  if (!win) return;
  pollTimer = win.setTimeout(pollOnce, pollBackoff);
}

async function pollOnce() {
  if (disposed) return;
  const [json] = await Promise.all([fetchOfficeJson(), pollEventsOnce()]);
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
  installDebugHooks();
  resize();
  setStatus("Carregando PIXEL OFFICE V3…", "importando módulos");
  await loadModules();
  if (!worldModule || typeof worldModule.buildWorldState !== "function") {
    setStatus("PIXEL OFFICE V3 indisponível", "world.js não pôde ser carregado");
    return;
  }
  bindLogsPanel();
  void bootPixelAssets();

  camera = createCameraState();
  resize();

  baseMode = resolveBaseMode();
  if (shouldDrawBase()) blueprintBase = await loadHybridBase();

  const json = await fetchOfficeJson();
  if (json) {
    clearError();
    applyOfficeJson(json);
  } else {
    applyOfficeJson(demoOffice());
    showError("Sem conexão com GET /api/iq/office — exibindo snapshot de demonstração (PRACTICE).");
  }

  hideStatus();
  const win = typeof window !== "undefined" && window ? window : null;
  if (win && typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(renderFrame);
  else if (typeof requestAnimationFrame === "function") requestAnimationFrame(renderFrame);
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

if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    disposed = true;
    if (pollTimer) window.clearTimeout(pollTimer);
  });
}
