/**
 * OFFICE V3 — HYBRID SCREENSHOTS (frozen reference base + dynamic overlay).
 *
 * Renders the calibrated hybrid at several framings into
 * `docs/office-v3/screenshots/`:
 *   overview-v3.png     — full 1536x1024 office (base + overlay, 1:1)
 *   zoom-desk-v3.png    — camera zoomToDesk on one station (hybrid)
 *   hover-v3.png        — same framing with the hover highlight active
 *   viewport-*.png      — desktop / laptop / tablet / mobile frames
 *
 * `hybrid-base.png` itself is produced by `scripts/office-v3-base-diff.mjs`.
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
import { createCamera, zoomToDesk, updateCamera } from "../src/http/public/office-v3/camera.js";

const require = createRequire(import.meta.url);
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";
const { createCanvas } = require(CANVAS_PATH);

life.bindAssets(assets);
life.bindWorld(world);

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

function officeJson() {
  const markets = fixtureMarkets();
  return {
    version: "iq-multi-runtime-v3",
    at: Date.now(),
    mode: "PRACTICE",
    connection: { connected: true },
    activeCount: markets.filter((market) => market.availability === "OPEN").length,
    activeLimit: 55,
    portfolio: {
      settled: { wins: 16, losses: 5, draws: 1, pnl: 578.76, trades: 22 },
      weekly: { pnl: 1842.3 },
      monthly: { pnl: 6721.55 },
      openPositions: [],
      equityCurve: [],
    },
    markets,
  };
}

function applyCamera(ctx, camera) {
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);
}

function renderHybrid(base, state, system, camera, width, height, options = {}) {
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
  return canvas;
}

function writeCanvas(name, canvas) {
  const path = resolve(outDir, name);
  writeFileSync(path, canvas.toBuffer("image/png"));
  return path;
}

const base = await loadBlueprintBase();
const state = world.buildWorldState(officeJson());
const system = life.createLifeSystem(state, { seed: "hybrid-shots" });
life.updateLife(system, 16);

const paths = [];
const IDENTITY = { x: 0, y: 0, zoom: 1 };

/* overview: full calibrated office at 1:1 */
paths.push(writeCanvas("overview-v3.png", renderHybrid(base, state, system, IDENTITY, BASE_WIDTH, BASE_HEIGHT)));

/* hover frame: highlight an OPEN station */
const hoverStation = state.stations.find((station) => station.active === true) ?? state.stations[0];
paths.push(writeCanvas("hover-v3.png", renderHybrid(base, state, system, IDENTITY, BASE_WIDTH, BASE_HEIGHT, {
  hoverMarketKey: hoverStation.marketKey,
})));

/* zoom-to-desk: snap the smooth camera to the station's calibrated anchor */
const anchor = anchorForStation(hoverStation, 0);
const deskCamera = createCamera({ width: BASE_WIDTH, height: BASE_HEIGHT, zoom: 1 });
zoomToDesk(deskCamera, {
  marketKey: hoverStation.marketKey,
  id: hoverStation.id,
  x: anchor.desk.x,
  y: anchor.desk.y,
  w: anchor.desk.w,
  h: anchor.desk.h,
  centerX: anchor.x,
  centerY: anchor.desk.y + anchor.desk.h / 2,
});
updateCamera(deskCamera, deskCamera.target ? deskCamera.target.duration : 0);
paths.push(writeCanvas("zoom-desk-v3.png", renderHybrid(base, state, system, deskCamera, BASE_WIDTH, BASE_HEIGHT)));

/* responsive mock frames (hybrid base at 1:1, framed) */
const viewports = [
  { name: "viewport-desktop.png", width: 1536, height: 1024 },
  { name: "viewport-laptop.png", width: 1366, height: 768 },
  { name: "viewport-tablet.png", width: 1024, height: 768 },
  { name: "viewport-mobile.png", width: 390, height: 844 },
];
for (const viewport of viewports) {
  const camera = { x: 0, y: 0, zoom: viewport.width < 500 ? 0.9 : 1 };
  const canvas = renderHybrid(base, state, system, camera, viewport.width, viewport.height);
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
  paths.push(writeCanvas(viewport.name, canvas));
}

console.log(`[hybrid-shots] hover=${hoverStation.marketKey} anchor=(${anchor.x},${anchor.y})`);
for (const path of paths) console.log(`[hybrid-shots] wrote ${path}`);
