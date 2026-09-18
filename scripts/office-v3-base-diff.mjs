/**
 * OFFICE V3 — HYBRID BASE DIFF.
 *
 * Renders the hybrid (frozen reference as STATIC BASE + dynamic overlay) at
 * 1536x1024 to `docs/office-v3/screenshots/hybrid-base.png` and reports the
 * pixel similarity vs the frozen reference: global mean-absolute-difference and
 * an 8-region (4x2) table. Also reports the base-only similarity (the static
 * layer, which should be ~100%).
 *
 * The metric is computed, never manipulated.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadBlueprintBase,
  drawBlueprintBase,
  BASE_WIDTH,
  BASE_HEIGHT,
} from "../src/http/public/office-v3/blueprint-base.js";
import { drawDynamicOverlay } from "../src/http/public/office-v3/overlay.js";
import * as world from "../src/http/public/office-v3/world.js";
import * as life from "../src/http/public/office-v3/life.js";
import * as assets from "../src/http/public/office-v3/assets.js";

const require = createRequire(import.meta.url);
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";
const { createCanvas, loadImage } = require(CANVAS_PATH);

life.bindAssets(assets);
life.bindWorld(world);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/office-v3/screenshots");
mkdirSync(outDir, { recursive: true });

const REFERENCE_PATH = resolve(repoRoot, "docs/office-v2/screenshots/reference.png");

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

function meanAbsDiff(a, b) {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < a.length; index += 4) {
    sum += Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
    count += 3;
  }
  return count ? sum / count : 0;
}

function similarity(meanDiff) {
  return 100 * (1 - meanDiff / 255);
}

function regionTable(rendered, reference, columns = 4, rows = 2) {
  const cellW = Math.floor(BASE_WIDTH / columns);
  const cellH = Math.floor(BASE_HEIGHT / rows);
  const table = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x0 = col * cellW;
      const y0 = row * cellH;
      const x1 = col === columns - 1 ? BASE_WIDTH : x0 + cellW;
      const y1 = row === rows - 1 ? BASE_HEIGHT : y0 + cellH;
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (y * BASE_WIDTH + x) * 4;
          sum += Math.abs(rendered[index] - reference[index])
            + Math.abs(rendered[index + 1] - reference[index + 1])
            + Math.abs(rendered[index + 2] - reference[index + 2]);
          count += 3;
        }
      }
      const diff = count ? sum / count : 0;
      table.push({ region: `R${row + 1}C${col + 1}`, x: x0, y: y0, w: x1 - x0, h: y1 - y0, meanAbsDiff: diff, similarity: similarity(diff) });
    }
  }
  return table;
}

const referenceImage = await loadImage(REFERENCE_PATH);
const referenceCanvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
const referenceCtx = referenceCanvas.getContext("2d");
referenceCtx.drawImage(referenceImage, 0, 0);
const referenceData = referenceCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;

/* ---- base-only (static layer) ---- */
const base = await loadBlueprintBase();
const baseCanvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
const baseCtx = baseCanvas.getContext("2d");
drawBlueprintBase(baseCtx, base);
const baseData = baseCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
const baseDiff = meanAbsDiff(baseData, referenceData);

/* ---- hybrid (base + dynamic overlay) ---- */
const state = world.buildWorldState(officeJson());
const system = life.createLifeSystem(state, { seed: "hybrid-base-diff" });
life.updateLife(system, 16);
const hybridCanvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
const hybridCtx = hybridCanvas.getContext("2d");
hybridCtx.imageSmoothingEnabled = false;
drawBlueprintBase(hybridCtx, base);
const stats = drawDynamicOverlay(hybridCtx, state, system, { x: 0, y: 0, zoom: 1 }, {
  drawCharacter: assets.drawCharacter,
});
const hybridData = hybridCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
const hybridDiff = meanAbsDiff(hybridData, referenceData);

const outPath = resolve(outDir, "hybrid-base.png");
writeFileSync(outPath, hybridCanvas.toBuffer("image/png"));

const table = regionTable(hybridData, referenceData);
console.log(`[hybrid-base] reference ${BASE_WIDTH}x${BASE_HEIGHT}`);
console.log(`[hybrid-base] wrote ${outPath}`);
console.log(`[hybrid-base] stations=${stats.stations} open=${stats.open} closed=${stats.closed} agents=${stats.agents} badges=${stats.badges}`);
console.log(`[hybrid-base] base-only  meanAbsDiff=${baseDiff.toFixed(4)} similarity=${similarity(baseDiff).toFixed(3)}%`);
console.log(`[hybrid-base] hybrid     meanAbsDiff=${hybridDiff.toFixed(4)} similarity=${similarity(hybridDiff).toFixed(3)}%`);
console.log("[hybrid-base] 8-region similarity:");
for (const row of table) {
  console.log(`  ${row.region} (${row.x},${row.y} ${row.w}x${row.h}) similarity=${row.similarity.toFixed(3)}% meanAbsDiff=${row.meanAbsDiff.toFixed(4)}`);
}
