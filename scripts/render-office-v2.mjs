/**
 * STATIC REBUILD — renders the authoritative office blueprint to PNG.
 *
 * Usage: node scripts/render-office-v2.mjs
 *
 * Produces:
 *   docs/office-v2/screenshots/implementation.png   (1536x1024 full scene)
 *   docs/office-v2/screenshots/master-station.png   (EUR/USD station, 4x zoom)
 *   docs/office-v2/screenshots/contact-sheet.png    (2x2 region review sheet)
 *   docs/office-v2/screenshots/expanded-world.png   (pan-reachable OTC band)
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
  MASTER_STATION,
  STATION_LAYOUT,
  drawBlueprint,
  drawMasterStation,
  drawExpandedWorld,
  drawFontSheet,
  buildStaticBlueprintState,
} from "../src/http/public/office-v2-blueprint.js";

const require = createRequire(import.meta.url);
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";
const { createCanvas } = require(CANVAS_PATH);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/office-v2/screenshots");
mkdirSync(outDir, { recursive: true });

const state = buildStaticBlueprintState();
const activeCount = state.stations.filter((station) => station.active).length;

const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
drawBlueprint(ctx, state);

const implementationPath = resolve(outDir, "implementation.png");
writeFileSync(implementationPath, canvas.toBuffer("image/png"));

const CROP = { x: 190, y: 344, w: 144, h: 110 };
const SCALE = 4;
const master = createCanvas(CROP.w * SCALE, CROP.h * SCALE);
const masterCtx = master.getContext("2d");
masterCtx.imageSmoothingEnabled = false;
masterCtx.fillStyle = "#0d1b2e";
masterCtx.fillRect(0, 0, master.width, master.height);
masterCtx.drawImage(canvas, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w * SCALE, CROP.h * SCALE);
const masterPath = resolve(outDir, "master-station.png");
writeFileSync(masterPath, master.toBuffer("image/png"));

const standalone = createCanvas(240, 200);
const standaloneCtx = standalone.getContext("2d");
standaloneCtx.imageSmoothingEnabled = false;
standaloneCtx.fillStyle = "#0d1b2e";
standaloneCtx.fillRect(0, 0, standalone.width, standalone.height);
standaloneCtx.translate(40, 40);
drawMasterStation(standaloneCtx, 0, 0, { scale: 1 });
writeFileSync(resolve(outDir, "master-station-isolated.png"), standalone.toBuffer("image/png"));

const CELL_W = 768;
const CELL_H = 512;
const sheet = createCanvas(CELL_W * 2, CELL_H * 2);
const sheetCtx = sheet.getContext("2d");
sheetCtx.imageSmoothingEnabled = false;
sheetCtx.fillStyle = "#05090f";
sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
const regions = [
  { label: "TOP-LEFT", x: 0, y: 0, w: CELL_W, h: CELL_H },
  { label: "DAILY BOARD", x: 440, y: 0, w: CELL_W, h: CELL_H },
  { label: "FOREX MAJORS", x: 190, y: 330, w: CELL_W, h: CELL_H },
  { label: "BOTTOM", x: 520, y: 512, w: CELL_W, h: CELL_H },
];
regions.forEach((region, index) => {
  const cx = (index % 2) * CELL_W;
  const cy = Math.floor(index / 2) * CELL_H;
  sheetCtx.drawImage(canvas, region.x, region.y, region.w, region.h, cx, cy, CELL_W, CELL_H);
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
const sheetPath = resolve(outDir, "contact-sheet.png");
writeFileSync(sheetPath, sheet.toBuffer("image/png"));

// pan-reachable expanded OTC region below the 1536x1024 viewport
const expandedWorld = createCanvas(WORLD_WIDTH, 300);
const expandedCtx = expandedWorld.getContext("2d");
expandedCtx.imageSmoothingEnabled = false;
expandedCtx.fillStyle = "#0d1b2e";
expandedCtx.fillRect(0, 0, expandedWorld.width, expandedWorld.height);
expandedCtx.save();
expandedCtx.translate(0, -1000);
drawExpandedWorld(expandedCtx, state);
expandedCtx.restore();
const expandedPath = resolve(outDir, "expanded-world.png");
writeFileSync(expandedPath, expandedWorld.toBuffer("image/png"));

// glyph diagnostic sheet: every A-Z / a-z / 0-9 / symbol at scale 4 with labels
const fontCanvas = createCanvas(900, 400);
const fontCtx = fontCanvas.getContext("2d");
fontCtx.imageSmoothingEnabled = false;
drawFontSheet(fontCtx, { width: 900, height: 400, scale: 4 });
const fontPath = resolve(outDir, "font-sheet.png");
writeFileSync(fontPath, fontCanvas.toBuffer("image/png"));

console.log(`[render] artboard ${BASE_WIDTH}x${BASE_HEIGHT}`);
console.log(`[render] stations=${STATION_LAYOUT.slots.length} active=${activeCount}`);
console.log(`[render] master symbol=${MASTER_STATION.symbol} at (${MASTER_STATION.x},${MASTER_STATION.y})`);
console.log(`[render] wrote ${implementationPath}`);
console.log(`[render] wrote ${masterPath}`);
console.log(`[render] wrote ${resolve(outDir, "master-station-isolated.png")}`);
console.log(`[render] wrote ${sheetPath}`);
console.log(`[render] wrote ${expandedPath}`);
console.log(`[render] wrote ${fontPath}`);
