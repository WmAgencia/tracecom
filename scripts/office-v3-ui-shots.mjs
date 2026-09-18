/**
 * OFFICE V3 — UI SHOTS (hybrid art + real UI chrome).
 *
 * Renders the approved hybrid base/overlay at several framings and composes
 * the top bar and the right market panel from the REAL models
 * (topbar.buildTopBarModel / market-detail.buildMarketDetailModel /
 * stake-config.buildStakeConfigModel) — no invented values.
 *
 * Produces in docs/office-v3/screenshots/:
 *   overview-v3.png    — full office, no chrome
 *   hover-v3.png       — hover highlight on one OPEN desk
 *   zoom-desk-v3.png   — zoomToDesk framing
 *   topbar-v3.png      — overview + compact operational top bar
 *   panel-open-v3.png  — zoom-to-desk + correlated right market panel
 *
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
      marketType: index % 4 === 3 ? "OTC" : "NORMAL",
      activeId: closed ? null : `id-${index}`,
      availability: closed ? "CLOSED" : "OPEN",
      payout: closed ? null : 78 + (index % 15),
      enabled: !closed,
      configuredStake: index === 0 ? 10 : null,
      maxStake: 100,
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
const system = life.createLifeSystem(state, { seed: "ui-shots" });
life.updateLife(system, 16);
const base = await loadBlueprintBase();

function applyCamera(ctx, camera) {
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, -camera.x * camera.zoom, -camera.y * camera.zoom);
}

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
  return canvas;
}

function writeCanvas(name, canvas) {
  const path = resolve(outDir, name);
  writeFileSync(path, canvas.toBuffer("image/png"));
  return path;
}

/* ------------------------------------------------------------------ *
 * top bar chrome — values from buildTopBarModel
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

function drawButton(ctx, x, y, label, on, disabled = false) {
  const width = ctx.measureText(label).width + 20;
  ctx.fillStyle = disabled ? "#0d1526" : "#16213f";
  ctx.strokeStyle = disabled ? "#24304e" : on ? "#4fbf6a" : "#35456f";
  ctx.fillRect(x, y, width, 32);
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 31);
  ctx.fillStyle = disabled ? "#6c7ca3" : on ? "#4fbf6a" : "#e7edfb";
  ctx.font = `bold 11px ${MONO}`;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 10, y + 17);
  ctx.textBaseline = "alphabetic";
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
  x = drawButton(ctx, x, y, model.armed ? "DESARMAR" : "ARM", model.armed);
  x = drawButton(ctx, x, y, model.auto ? "AUTO ON" : "AUTO OFF", model.auto);
  ctx.font = `bold 11px ${MONO}`;
  ctx.fillStyle = "#93a2c6";
  ctx.fillText("STAKE R$", x + 6, y + 20);
  x += 66;
  ctx.fillStyle = "#0a1122";
  ctx.strokeStyle = "#35456f";
  ctx.fillRect(x, y, 58, 32);
  ctx.strokeRect(x + 0.5, y + 0.5, 57, 31);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 12px ${MONO}`;
  ctx.fillText(String(model.stakeValue ?? ""), x + 8, y + 21);
  x += 64;
  x = drawButton(ctx, x, y, "APLICAR A TODOS", false);
  x = drawChip(ctx, x, y, "MERCADOS", `${model.openMarkets}/${model.totalMarkets}`, "#ffc857");
  x = drawChip(ctx, x, y, "ATIVOS", `${model.activeCount}/${model.activeLimit}`, "#e7edfb");
  x = drawChip(ctx, x, y, "EXECUÇÃO", model.executionGate?.state ?? "—", "#e7edfb");
  drawButton(ctx, x, y, "REAL OFF", false, true);
}

/* ------------------------------------------------------------------ *
 * right market panel chrome — rows from buildMarketDetailModel
 * ------------------------------------------------------------------ */

function drawPanel(ctx, canvasWidth, market, officeData) {
  const panelWidth = 380;
  const x = canvasWidth - panelWidth - 10;
  const y = 52;
  const height = 620;
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
  ctx.fillStyle = "#e6c26a";
  ctx.fillRect(x + 112, cursor, 72, 28);
  ctx.fillStyle = "#0b1226";
  ctx.fillText("SALVAR", x + 126, cursor + 19);
  cursor += 42;

  for (const sectionId of ["identity", "technical", "execution"]) {
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
    for (const row of section.rows.slice(0, sectionId === "identity" ? 7 : 5)) {
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
}

/* ------------------------------------------------------------------ *
 * render + write
 * ------------------------------------------------------------------ */

const IDENTITY = { x: 0, y: 0, zoom: 1 };
const hoverStation = state.stations.find((station) => station.active === true) ?? state.stations[0];

const overview = renderHybrid(IDENTITY, BASE_WIDTH, BASE_HEIGHT);
writeCanvas("overview-v3.png", overview);

const hover = renderHybrid(IDENTITY, BASE_WIDTH, BASE_HEIGHT, { hoverMarketKey: hoverStation.marketKey });
writeCanvas("hover-v3.png", hover);

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
writeCanvas("zoom-desk-v3.png", renderHybrid(deskCamera, BASE_WIDTH, BASE_HEIGHT));

const topbarCanvas = renderHybrid(IDENTITY, BASE_WIDTH, BASE_HEIGHT);
drawTopBar(topbarCanvas.getContext("2d"), BASE_WIDTH);
writeCanvas("topbar-v3.png", topbarCanvas);

const market = office.markets.find((candidate) => candidate.marketKey === hoverStation.marketKey) ?? office.markets[0];
const panelCanvas = renderHybrid(deskCamera, BASE_WIDTH, BASE_HEIGHT);
drawTopBar(panelCanvas.getContext("2d"), BASE_WIDTH);
drawPanel(panelCanvas.getContext("2d"), BASE_WIDTH, market, office);
writeCanvas("panel-open-v3.png", panelCanvas);

console.log(`[ui-shots] hover=${hoverStation.marketKey} panel=${market.marketKey}`);
for (const name of ["overview-v3.png", "hover-v3.png", "zoom-desk-v3.png", "topbar-v3.png", "panel-open-v3.png"]) {
  console.log(`[ui-shots] wrote ${resolve(outDir, name)}`);
}
