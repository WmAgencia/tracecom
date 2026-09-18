/**
 * PIXEL OFFICE V3 — static screenshot renderer.
 *
 * Usage: node scripts/render-office-v3.mjs
 *
 * Produces (docs/office-v3/screenshots/):
 *   implementation-v3.png   — 1536x1024 hero viewport
 *   contact-sheet-v3.png    — 2x2 region review sheet
 *   overview-v3.png         — whole world fit (2560x2048 -> 1536x1024)
 *   zoom-desk-v3.png        — smooth zoomToDesk framing on one station
 *   scenario-55open.png     — all desks OPEN (110 working)
 *   scenario-37open.png     — 37 OPEN (74 working + 36 idle)
 *   scenario-10open.png     — 10 OPEN (20 working + 90 idle)
 *   scenario-0open.png      — 0 OPEN (55 empty desks + 110 idle)
 *   viewport-desktop.png    — 1536x1024 responsive mock
 *   viewport-laptop.png     — 1366x768  responsive mock
 *   viewport-tablet.png     — 1024x768  responsive mock
 *   viewport-mobile.png     — 390x844   responsive mock
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_WIDTH,
  BASE_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  CONTENT_X,
  CONTENT_Y,
  buildWorldState,
  drawWorld,
  collectDeskFronts,
  drawDeskFront,
} from "../src/http/public/office-v3/world.js";
import {
  createLifeSystem,
  updateLife,
  drawAgents,
  bindAssets,
  bindWorld,
} from "../src/http/public/office-v3/life.js";
import * as assetsModule from "../src/http/public/office-v3/assets.js";
import { createCamera, zoomToDesk, updateCamera } from "../src/http/public/office-v3/camera.js";

bindAssets(assetsModule);
bindWorld({ buildWorldState, drawWorld, collectDeskFronts, drawDeskFront });

const require = createRequire(import.meta.url);
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";
const { createCanvas } = require(CANVAS_PATH);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/office-v3/screenshots");
mkdirSync(outDir, { recursive: true });

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
    const closed = index % 9 === 4;
    const result = index % 5 === 0 ? "WIN" : index % 5 === 2 ? "LOSS" : "DRAW";
    const profit = result === "WIN" ? 4 + (index % 12) * 1.5 : result === "LOSS" ? -(3 + (index % 7)) : 0;
    return {
      marketKey: `${display.replace(/[^A-Z0-9]/g, "")}:${index % 4 === 3 ? "OTC" : "NORMAL"}`,
      canonical: display.replace(/[^A-Z0-9]/g, ""),
      symbol: display,
      display,
      activeId: closed ? null : `id-${index}`,
      availability: closed ? "CLOSED" : "OPEN",
      payout: closed ? null : 78 + (index % 15),
      enabled: !closed,
      settlementState: closed ? {} : { lastResult: result, lastProfit: Number(profit.toFixed(2)) },
    };
  });
}

function scenarioMarkets(openCount) {
  return fixtureMarkets().map((market, index) => {
    const open = index < openCount;
    return {
      ...market,
      activeId: open ? `id-${index}` : null,
      availability: open ? "OPEN" : "CLOSED",
      payout: open ? 78 + (index % 15) : null,
      enabled: open,
      settlementState: open ? market.settlementState : {},
    };
  });
}

function baseOffice(markets) {
  // Real aggregate of the fixture's own settled markets — never a hardcoded
  // P&L. weekly/monthly are intentionally absent (the live relay snapshot does
  // not provide them), so the board renders the explicit empty state.
  const settled = markets.reduce((acc, market) => {
    const result = String(market?.settlementState?.lastResult ?? "").toUpperCase();
    const profit = Number(market?.settlementState?.lastProfit);
    if (!Number.isFinite(profit)) return acc;
    if (result === "WIN") acc.wins += 1;
    else if (result === "LOSS") acc.losses += 1;
    else if (result === "DRAW") acc.draws += 1;
    else return acc;
    acc.pnl += profit;
    acc.trades += 1;
    return acc;
  }, { wins: 0, losses: 0, draws: 0, pnl: 0, trades: 0 });
  return {
    version: "iq-multi-runtime-v3",
    at: Date.now(),
    mode: "PRACTICE",
    connection: { connected: true },
    activeCount: markets.filter((market) => market.availability === "OPEN").length,
    activeLimit: 55,
    portfolio: {
      settled: { ...settled, pnl: Number(settled.pnl.toFixed(2)) },
      openPositions: [],
      equityCurve: [],
    },
    markets,
  };
}

function buildScenario(openCount) {
  const state = buildWorldState(baseOffice(scenarioMarkets(openCount)));
  const system = createLifeSystem(state, { seed: `render-${openCount}` });
  updateLife(system, 16);
  return { state, system };
}

function renderScene(state, system, camera, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#05090f";
  ctx.fillRect(0, 0, width, height);
  drawWorld(ctx, state, camera, { agents: !system });
  if (system) {
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    drawAgents(ctx, system, { ...camera, viewport: { width, height } });
    ctx.restore();
  }
  return canvas;
}

function writeCanvas(name, canvas) {
  const path = resolve(outDir, name);
  writeFileSync(path, canvas.toBuffer("image/png"));
  return path;
}

const OVERVIEW_ZOOM = Math.min(BASE_WIDTH / WORLD_WIDTH, BASE_HEIGHT / WORLD_HEIGHT);
const OVERVIEW_CAMERA = {
  x: (WORLD_WIDTH - BASE_WIDTH / OVERVIEW_ZOOM) / 2,
  y: (WORLD_HEIGHT - BASE_HEIGHT / OVERVIEW_ZOOM) / 2,
  zoom: OVERVIEW_ZOOM,
};
// The office content is laid out at reference scale inside a 1536x1024 window
// (CONTENT_X..CONTENT_X+1536). This hero camera frames it 1:1 like the blueprint.
const CONTENT_CAMERA = { x: CONTENT_X, y: CONTENT_Y, zoom: 1 };

const officeJson = baseOffice(fixtureMarkets());
const state = buildWorldState(officeJson);
const active = state.stations.filter((station) => station.active).length;
const lifeSystem = createLifeSystem(state, { seed: "render-office-v3" });
updateLife(lifeSystem, 16);

/* ---- implementation hero viewport (world larger than viewport on purpose) ---- */
const implementation = renderScene(state, lifeSystem, CONTENT_CAMERA, BASE_WIDTH, BASE_HEIGHT);
const implementationPath = writeCanvas("implementation-v3.png", implementation);

/* ---- contact sheet: 4 review regions at 1:1 ---- */
const CELL_W = 768;
const CELL_H = 512;
const sheet = createCanvas(CELL_W * 2, CELL_H * 2);
const sheetCtx = sheet.getContext("2d");
sheetCtx.imageSmoothingEnabled = false;
sheetCtx.fillStyle = "#05090f";
sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
const regions = [
  { label: "BOARD + SOCIAL", x: CONTENT_X, y: CONTENT_Y },
  { label: "POOL / CAFE / MEETING", x: CONTENT_X + 248, y: CONTENT_Y + 150 },
  { label: "FOREX MAJORS", x: CONTENT_X, y: CONTENT_Y + 336 },
  { label: "TRADING FLOOR", x: CONTENT_X, y: CONTENT_Y + 560 },
];
regions.forEach((region, index) => {
  const cx = (index % 2) * CELL_W;
  const cy = Math.floor(index / 2) * CELL_H;
  const source = renderScene(state, lifeSystem, { x: region.x, y: region.y, zoom: 1 }, CELL_W, CELL_H);
  sheetCtx.drawImage(source, 0, 0, CELL_W, CELL_H, cx, cy, CELL_W, CELL_H);
  sheetCtx.fillStyle = "rgba(5,9,15,0.85)";
  sheetCtx.fillRect(cx + 6, cy + 6, region.label.length * 12 + 14, 22);
  sheetCtx.fillStyle = "#e8c877";
  sheetCtx.font = "16px monospace";
  sheetCtx.textBaseline = "top";
  sheetCtx.fillText(region.label, cx + 13, cy + 10);
  sheetCtx.strokeStyle = "#c9a24b";
  sheetCtx.lineWidth = 2;
  sheetCtx.strokeRect(cx + 1, cy + 1, CELL_W - 2, CELL_H - 2);
});
const sheetPath = writeCanvas("contact-sheet-v3.png", sheet);

/* ---- overview (whole world) + zoom-to-desk ---- */
const overview = renderScene(state, lifeSystem, OVERVIEW_CAMERA, BASE_WIDTH, BASE_HEIGHT);
const overviewPath = writeCanvas("overview-v3.png", overview);

const deskCamera = createCamera({ width: BASE_WIDTH, height: BASE_HEIGHT, zoom: 1 });
const deskStation = state.stations[0];
zoomToDesk(deskCamera, {
  marketKey: deskStation.marketKey,
  id: deskStation.id,
  x: deskStation.desk.x,
  y: deskStation.desk.y,
  w: deskStation.desk.w,
  h: deskStation.desk.h,
  centerX: deskStation.cell.centerX,
  centerY: deskStation.desk.y + deskStation.desk.h / 2,
});
updateCamera(deskCamera, 500);
const zoomDesk = renderScene(state, lifeSystem, deskCamera, BASE_WIDTH, BASE_HEIGHT);
const zoomDeskPath = writeCanvas("zoom-desk-v3.png", zoomDesk);

/* ---- presence scenarios ---- */
const scenarioPaths = [];
for (const openCount of [55, 37, 10, 0]) {
  const scenario = buildScenario(openCount);
  const canvas = renderScene(scenario.state, scenario.system, CONTENT_CAMERA, BASE_WIDTH, BASE_HEIGHT);
  scenarioPaths.push(writeCanvas(`scenario-${openCount}open.png`, canvas));
}

/* ---- responsive mock frames ---- */
const viewports = [
  { name: "viewport-desktop.png", width: 1536, height: 1024 },
  { name: "viewport-laptop.png", width: 1366, height: 768 },
  { name: "viewport-tablet.png", width: 1024, height: 768 },
  { name: "viewport-mobile.png", width: 390, height: 844 },
];
const viewportPaths = [];
for (const viewport of viewports) {
  const camera = { x: CONTENT_X, y: CONTENT_Y, zoom: viewport.width < 500 ? 0.9 : 1 };
  const canvas = renderScene(state, lifeSystem, camera, viewport.width, viewport.height);
  const frameCtx = canvas.getContext("2d");
  frameCtx.strokeStyle = "#c9a24b";
  frameCtx.lineWidth = 2;
  frameCtx.strokeRect(1, 1, viewport.width - 2, viewport.height - 2);
  frameCtx.fillStyle = "rgba(5,9,15,0.82)";
  frameCtx.fillRect(6, 6, 220, 22);
  frameCtx.fillStyle = "#e8c877";
  frameCtx.font = "14px monospace";
  frameCtx.textBaseline = "top";
  frameCtx.fillText(`${viewport.width}x${viewport.height}`, 14, 11);
  viewportPaths.push(writeCanvas(viewport.name, canvas));
}

console.log(`[render-v3] artboard ${BASE_WIDTH}x${BASE_HEIGHT}`);
console.log(`[render-v3] world ${state.worldWidth}x${state.worldHeight} cells=${state.layout.cells.length}`);
console.log(`[render-v3] stations=${state.stations.length} active=${active} reserved=${state.reserved.length}`);
console.log(`[render-v3] wrote ${implementationPath}`);
console.log(`[render-v3] wrote ${sheetPath}`);
console.log(`[render-v3] wrote ${overviewPath}`);
console.log(`[render-v3] wrote ${zoomDeskPath}`);
for (const path of scenarioPaths) console.log(`[render-v3] wrote ${path}`);
for (const path of viewportPaths) console.log(`[render-v3] wrote ${path}`);
