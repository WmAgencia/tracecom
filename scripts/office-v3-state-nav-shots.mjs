/**
 * OFFICE V3 — STATE LABEL + PAN/ZOOM SCREENSHOTS (hotfix 3+4+5).
 *
 * Produces in `docs/office-v3/screenshots/`:
 *   state-label-v3.png   — OPEN_BUT_FEED_OFFLINE desk (FEED OFFLINE tag) with
 *                          the correlated right panel showing the derived state
 *   zoom-cursor-v3.png   — cursor-centered zoom (gold crosshair marks the world
 *                          point that stays fixed on screen)
 *   pan-zoom-v3.png      — 2-cell sheet: zoom-at-cursor → pan, same crosshair
 *   clamp-edge-v3.png    — min zoom showing the whole world (all four edges)
 *
 * Values come from the real models (state-model / market-detail / topbar).
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadBlueprintBase, drawBlueprintBase, BASE_WIDTH, BASE_HEIGHT } from "../src/http/public/office-v3/blueprint-base.js";
import { drawDynamicOverlay, anchorForStation } from "../src/http/public/office-v3/overlay.js";
import * as world from "../src/http/public/office-v3/world.js";
import * as life from "../src/http/public/office-v3/life.js";
import * as assets from "../src/http/public/office-v3/assets.js";
import {
  createCamera,
  applyCamera,
  zoomAt,
  panBy,
  zoomToDesk,
  updateCamera,
  screenToWorld,
  clampToBounds,
  getClampRange,
} from "../src/http/public/office-v3/camera.js";
import { attachDerivedStates } from "../src/http/public/office-v3/state-model.js";
import { buildTopBarModel } from "../src/http/public/office-v3/topbar.js";
import { buildMarketDetailModel } from "../src/http/public/office-v3/market-detail.js";
import { buildStakeConfigModel } from "../src/http/public/office-v3/stake-config.js";

const require = createRequire(import.meta.url);
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";
const { createCanvas } = require(CANVAS_PATH);

life.bindAssets(assets);
life.bindWorld(world);

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(resolve(here, ".."), "docs/office-v3/screenshots");
mkdirSync(outDir, { recursive: true });

const MONO = "Consolas, monospace";
const FEED_OFFLINE_KEY = "EURUSD:NORMAL";

function fixtureMarkets() {
  const universe = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY",
    "AUD/JPY", "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF",
    "EUR/USD OTC", "GBP/USD OTC", "USD/JPY OTC", "EUR/GBP OTC", "GBP/JPY OTC", "AUD/USD OTC", "USD/CAD OTC", "USD/CHF OTC", "EUR/JPY OTC", "AUD/JPY OTC",
    "BTC/USD OTC", "ETH/USD OTC", "LTC/USD OTC", "XRP/USD OTC", "ADA/USD OTC",
    "US30", "US100", "US500", "US2000", "GER30", "UK100", "JP225", "AUS200", "EU50", "HK33",
    "GOLD", "SILVER", "WTI", "BRENT", "NATGAS", "APPLE", "TESLA", "AMAZON", "GOOGLE", "META",
  ];
  return universe.map((display, index) => {
    const marketKey = `${display.replace(/[^A-Z0-9]/g, "")}:${index % 4 === 3 ? "OTC" : "NORMAL"}`;
    const closed = index % 9 === 4;
    const result = index % 5 === 0 ? "WIN" : index % 5 === 2 ? "LOSS" : "DRAW";
    const profit = result === "WIN" ? 4 + (index % 12) * 1.5 : result === "LOSS" ? -(3 + (index % 7)) : 0;
    const base = {
      marketKey,
      canonical: display.replace(/[^A-Z0-9]/g, ""),
      symbol: display,
      display,
      marketType: index % 4 === 3 ? "OTC" : "NORMAL",
      activeId: closed ? null : `id-${index}`,
      availability: closed ? "CLOSED" : "OPEN",
      payout: closed ? null : 78 + (index % 15),
      enabled: !closed,
      configuredStake: index === 0 ? 10 : null,
      maxStake: 100,
      settlementState: closed ? {} : { lastResult: result, lastProfit: Number(profit.toFixed(2)) },
    };
    if (marketKey === FEED_OFFLINE_KEY) {
      return { ...base, availability: "OPEN", enabled: true, activeId: null, agentState: "OFFLINE", candles5s: 0, lastTick: null, featureState: null };
    }
    if (index === 1) {
      return { ...base, enabled: false, availability: "OPEN", agentState: "WAIT", candles5s: 42, lastTick: { ageMs: 400 }, featureState: { fresh: true, freshnessReason: "OK" } };
    }
    if (!closed) {
      return { ...base, agentState: "WAIT", candles5s: 120, lastTick: { ageMs: 220 }, featureState: { fresh: true, freshnessReason: "OK" } };
    }
    return { ...base, agentState: "OFFLINE", candles5s: 0, lastTick: null, featureState: null };
  });
}

function officeJson() {
  const markets = fixtureMarkets();
  return {
    version: "iq-multi-runtime-v3",
    at: Date.now(),
    mode: "PRACTICE",
    connection: { connected: true, healthy: true },
    config: { defaultStake: 10, globalMaxStake: 100, hardCap: 100, autoExecute: false },
    activeCount: markets.filter((market) => market.availability === "OPEN").length,
    activeLimit: 55,
    aux: {
      compliance: { armState: { state: "DISARMED", armed: false }, killSwitch: { executionEnabled: true } },
      executionGate: { state: "DISARMED", armed: false },
    },
    portfolio: { settled: { wins: 16, losses: 5, draws: 1, pnl: 578.76, trades: 22 }, equityCurve: [] },
    markets,
  };
}

const office = officeJson();
const state = world.buildWorldState(office);
attachDerivedStates(state, office);
const system = life.createLifeSystem(state, { seed: "state-nav-shots" });
for (const station of state.stations) {
  life.setPresence(system, station.id, station.derived ? station.derived.agentsWorking : station.active === true);
}
for (let frame = 0; frame < 2400; frame += 1) life.updateLife(system, 16);
const base = await loadBlueprintBase();

const feedOfflineStation = state.stations.find((station) => station.marketKey === FEED_OFFLINE_KEY);
const feedOfflineMarket = office.markets.find((market) => market.marketKey === FEED_OFFLINE_KEY);

function renderHybrid(camera, width, height, options = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#05090f";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  applyCamera(ctx, camera);
  drawBlueprintBase(ctx, base);
  drawDynamicOverlay(ctx, state, system, camera, {
    drawCharacter: assets.drawCharacter,
    hoverMarketKey: options.hoverMarketKey ?? null,
  });
  ctx.restore();
  if (options.crosshair) drawCrosshair(ctx, options.crosshair.x, options.crosshair.y);
  return canvas;
}

function drawCrosshair(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 14, y);
  ctx.lineTo(x + 14, y);
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x, y + 14);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,209,102,0.55)";
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function writeCanvas(name, canvas) {
  const path = resolve(outDir, name);
  writeFileSync(path, canvas.toBuffer("image/png"));
  console.log(`[state-nav-shots] wrote ${path}`);
  return path;
}

/* ------------------------------------------------------------------ *
 * chrome (top bar + right panel) from the REAL models
 * ------------------------------------------------------------------ */

function drawChip(ctx, x, y, label, value, color = "#e7edfb") {
  ctx.font = `bold 12px ${MONO}`;
  const width = Math.max(64, ctx.measureText(value).width + 22);
  ctx.fillStyle = "#101a33";
  ctx.strokeStyle = "#24304e";
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, width, 32);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 31);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = "#93a2c6";
  ctx.fillText(label, x + 8, y + 12);
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x + 8, y + 26);
  return x + width + 6;
}

function drawTopBar(ctx, width) {
  const model = buildTopBarModel(office);
  const height = 46;
  ctx.fillStyle = "rgba(9,16,29,0.97)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#24304e";
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = "#e6c26a";
  ctx.fillText("TRACE/COM", 12, 22);
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = "#93a2c6";
  ctx.fillText("PIXEL OFFICE V3", 12, 36);
  let x = 150;
  const y = 7;
  x = drawChip(ctx, x, y, "MODO", `${model.mode} · ZERO REAL`, "#4fbf6a");
  x = drawChip(ctx, x, y, "CONEXÃO", model.connected && model.healthy ? "ONLINE" : "OFFLINE", "#4fbf6a");
  x = drawChip(ctx, x, y, "MERCADOS", `${model.openMarkets}/${model.totalMarkets}`, "#ffc857");
  drawChip(ctx, x, y, "GATE", model.executionGate?.state ?? "—", "#e7edfb");
}

function drawPanel(ctx, canvasWidth, market, officeData) {
  const panelWidth = 380;
  const x = canvasWidth - panelWidth - 10;
  const y = 52;
  const height = 680;
  const detailModel = buildMarketDetailModel(market, officeData);
  const stakeModel = buildStakeConfigModel(market, officeData);

  ctx.fillStyle = "rgba(16,26,51,0.97)";
  ctx.strokeStyle = "#24304e";
  ctx.fillRect(x, y, panelWidth, height);
  ctx.strokeRect(x + 0.5, y + 0.5, panelWidth - 1, height - 1);

  ctx.font = `bold 16px ${MONO}`;
  ctx.fillStyle = "#e7edfb";
  ctx.fillText(market.display ?? market.marketKey, x + 14, y + 26);
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = "#93a2c6";
  ctx.fillText(`${market.marketKey} · ${market.marketType ?? "—"}`, x + 14, y + 42);

  let cursor = y + 62;
  ctx.font = `bold 10px ${MONO}`;
  ctx.fillStyle = "#e6c26a";
  ctx.fillText("STAKE DESTE MERCADO · " + stakeModel.source, x + 14, cursor);
  cursor += 8;
  ctx.fillStyle = "#16213f";
  ctx.strokeStyle = "#35456f";
  ctx.fillRect(x + 14, cursor, 90, 28);
  ctx.strokeRect(x + 14.5, cursor + 0.5, 89, 27);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 13px ${MONO}`;
  ctx.fillText(String(stakeModel.effectiveStake ?? ""), x + 24, cursor + 19);
  cursor += 42;

  for (const sectionId of ["identity", "feed", "agents"]) {
    const section = detailModel.sections.find((candidate) => candidate.id === sectionId);
    if (!section) continue;
    ctx.font = `bold 10px ${MONO}`;
    ctx.fillStyle = "#e6c26a";
    ctx.fillText(section.label, x + 14, cursor);
    cursor += 8;
    ctx.strokeStyle = "#24304e";
    ctx.beginPath();
    ctx.moveTo(x + 14, cursor + 0.5);
    ctx.lineTo(x + panelWidth - 14, cursor + 0.5);
    ctx.stroke();
    cursor += 14;
    const limit = sectionId === "identity" ? 8 : 5;
    for (const row of section.rows.slice(0, limit)) {
      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = "#93a2c6";
      ctx.fillText(row.label, x + 14, cursor);
      ctx.fillStyle = row.available ? "#ffffff" : "#6c7ca3";
      const valueText = String(row.value);
      const valueWidth = ctx.measureText(valueText).width;
      ctx.fillText(valueText, x + panelWidth - 14 - valueWidth, cursor);
      cursor += 18;
    }
    cursor += 6;
  }
  return detailModel;
}

/* ------------------------------------------------------------------ *
 * 1. state label — feed-offline desk + panel
 * ------------------------------------------------------------------ */

const offlineAnchor = anchorForStation(feedOfflineStation, feedOfflineStation.index);
const stateCamera = createCamera({ width: BASE_WIDTH, height: BASE_HEIGHT, zoom: 1 });
zoomToDesk(stateCamera, {
  marketKey: feedOfflineStation.marketKey,
  id: feedOfflineStation.id,
  x: offlineAnchor.desk.x,
  y: offlineAnchor.desk.y,
  w: offlineAnchor.desk.w,
  h: offlineAnchor.desk.h,
  centerX: offlineAnchor.x,
  centerY: offlineAnchor.desk.y + offlineAnchor.desk.h / 2,
});
updateCamera(stateCamera, stateCamera.target ? stateCamera.target.duration : 0);
const stateCanvas = renderHybrid(stateCamera, BASE_WIDTH, BASE_HEIGHT);
const stateCtx = stateCanvas.getContext("2d");
drawTopBar(stateCtx, BASE_WIDTH);
const stateModel = drawPanel(stateCtx, BASE_WIDTH, feedOfflineMarket, office);
stateCtx.fillStyle = "rgba(5,9,15,0.88)";
stateCtx.fillRect(12, 52, 430, 26);
stateCtx.fillStyle = "#ffc857";
stateCtx.font = `bold 13px ${MONO}`;
stateCtx.fillText(`ESTADO DERIVADO · ${stateModel.state.label} · agentes=${stateModel.state.agentsWorking ? "ON" : "SOCIAL"}`, 20, 70);
writeCanvas("state-label-v3.png", stateCanvas);

/* ------------------------------------------------------------------ *
 * 2. cursor-centered zoom (world point stays fixed on screen)
 * ------------------------------------------------------------------ */

const CURSOR = { x: 380, y: 300 };
const zoomCamera = createCamera({ width: BASE_WIDTH, height: BASE_HEIGHT, x: world.CONTENT_X, y: world.CONTENT_Y, zoom: 1 });
zoomCamera.bounds = { minX: 0, minY: 0, maxX: state.worldWidth, maxY: state.worldHeight };
const beforeWorld = screenToWorld(zoomCamera, CURSOR.x, CURSOR.y);
zoomAt(zoomCamera, CURSOR.x, CURSOR.y, 1.9);
const afterWorld = screenToWorld(zoomCamera, CURSOR.x, CURSOR.y);
if (Math.abs(beforeWorld.x - afterWorld.x) > 1e-6 || Math.abs(beforeWorld.y - afterWorld.y) > 1e-6) {
  throw new Error(`cursor zoom drift: ${JSON.stringify({ beforeWorld, afterWorld })}`);
}
const zoomCanvas = renderHybrid(zoomCamera, BASE_WIDTH, BASE_HEIGHT, { crosshair: CURSOR });
const zoomCtx = zoomCanvas.getContext("2d");
drawTopBar(zoomCtx, BASE_WIDTH);
zoomCtx.fillStyle = "rgba(5,9,15,0.88)";
zoomCtx.fillRect(12, 52, 430, 26);
zoomCtx.fillStyle = "#ffd166";
zoomCtx.font = `bold 13px ${MONO}`;
zoomCtx.fillText(`zoomAt(${CURSOR.x},${CURSOR.y}) · ponto do mundo fixo sob a mira`, 20, 70);
writeCanvas("zoom-cursor-v3.png", zoomCanvas);

/* ------------------------------------------------------------------ *
 * 3. pan-zoom 2-cell sheet (same crosshair, world moves with the drag)
 * ------------------------------------------------------------------ */

const CELL_W = BASE_WIDTH;
const CELL_H = BASE_HEIGHT;
const sheet = createCanvas(CELL_W * 2, CELL_H);
const sheetCtx = sheet.getContext("2d");
sheetCtx.imageSmoothingEnabled = false;
sheetCtx.fillStyle = "#05090f";
sheetCtx.fillRect(0, 0, sheet.width, sheet.height);

const panCamera = createCamera({ width: BASE_WIDTH, height: BASE_HEIGHT, x: zoomCamera.x, y: zoomCamera.y, zoom: zoomCamera.zoom });
panCamera.bounds = { minX: 0, minY: 0, maxX: state.worldWidth, maxY: state.worldHeight };
panBy(panCamera, 180, 120);

const cells = [
  { label: "zoom no cursor", camera: zoomCamera },
  { label: "SPACE + arraste (pan)", camera: panCamera },
];
cells.forEach((cell, index) => {
  const ox = index * CELL_W;
  const canvas = renderHybrid(cell.camera, CELL_W, CELL_H, { crosshair: CURSOR });
  sheetCtx.drawImage(canvas, 0, 0, CELL_W, CELL_H, ox, 0, CELL_W, CELL_H);
  sheetCtx.fillStyle = "rgba(5,9,15,0.88)";
  sheetCtx.fillRect(ox + 12, 12, 360, 26);
  sheetCtx.fillStyle = "#e6c26a";
  sheetCtx.font = `bold 13px ${MONO}`;
  sheetCtx.fillText(cell.label, ox + 20, 30);
  sheetCtx.strokeStyle = "#c9a24b";
  sheetCtx.lineWidth = 2;
  sheetCtx.strokeRect(ox + 1, 1, CELL_W - 2, CELL_H - 2);
});
console.log(`[state-nav-shots] zoom anchor screen=${CURSOR.x},${CURSOR.y} world≈${beforeWorld.x.toFixed(1)},${beforeWorld.y.toFixed(1)}`);
writeCanvas("pan-zoom-v3.png", sheet);

/* ------------------------------------------------------------------ *
 * 4. clamp edge at min zoom — whole world, four edges reachable
 * ------------------------------------------------------------------ */

const minZoomCamera = createCamera({ width: BASE_WIDTH, height: BASE_HEIGHT, worldState: state });
minZoomCamera.zoom = minZoomCamera.minZoom;
minZoomCamera.x = -99999;
minZoomCamera.y = -99999;
clampToBounds(minZoomCamera);
const edgeCanvas = renderHybrid(minZoomCamera, BASE_WIDTH, BASE_HEIGHT);
const edgeCtx = edgeCanvas.getContext("2d");
drawTopBar(edgeCtx, BASE_WIDTH);
edgeCtx.fillStyle = "rgba(5,9,15,0.88)";
edgeCtx.fillRect(12, 52, 520, 26);
edgeCtx.fillStyle = "#e7edfb";
edgeCtx.font = `bold 13px ${MONO}`;
const range = getClampRange(minZoomCamera);
edgeCtx.fillText(`zoom mínimo ${minZoomCamera.zoom} · mundo ${state.worldWidth}x${state.worldHeight} · span ${range.spanX.toFixed(0)}x${range.spanY.toFixed(0)}`, 20, 70);
writeCanvas("clamp-edge-v3.png", edgeCanvas);

console.log(`[state-nav-shots] state=${stateModel.state.state} label="${stateModel.state.label}" agentsWorking=${stateModel.state.agentsWorking}`);
