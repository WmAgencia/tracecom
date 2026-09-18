/**
 * OFFICE V3 — CLEAN PLATE builder (headless, reproducible).
 *
 * The frozen blueprint (`blueprint-reference.png`, 1536x1024) ships with PAINTED
 * P&L badges above every desk ("+R$ 8,50" / "-R$ 10,00"). Those badges are FALSE:
 * dynamic P&L belongs to `overlay.js`, drawn per real station state. This script
 * detects the painted badge pills (bright green/red text clusters in the gaps
 * above each desk band, aligned to the overlay's own ANCHOR_BANDS geometry) and
 * INPAINTS them with a per-row horizontal fill from the untouched floor/wall
 * pixels immediately left and right of each pill — no blur, no rectangle.
 *
 * Outputs:
 *   - src/http/public/office-v3/blueprint-clean.png   (new static base)
 *   - docs/office-v3/screenshots/clean-plate.png      (before/after crop strip)
 *
 * Verification (printed, never manipulated):
 *   (a) badge-colored pixels remaining inside the masks (strict + relaxed scan);
 *   (b) pixels changed OUTSIDE the masks (must be 0) + per-region table;
 *   (c) badge pixels removed count.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders, no stake.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ANCHOR_BANDS } from "../src/http/public/office-v3/overlay.js";

export const CLEAN_PLATE_WIDTH = 1536;
export const CLEAN_PLATE_HEIGHT = 1024;

export const NODE_CANVAS_CANDIDATES = Object.freeze([
  "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas",
  "@napi-rs/canvas",
]);

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
export const DEFAULT_OUTPUT = resolve(REPO_ROOT, "src/http/public/office-v3/blueprint-clean.png");
export const DEFAULT_STRIP = resolve(REPO_ROOT, "docs/office-v3/screenshots/clean-plate.png");
export const SOURCE_CANDIDATES = Object.freeze([
  "C:/Users/junin/AppData/Local/Temp/opencode/reference.png",
  resolve(REPO_ROOT, "src/http/public/office-v3/blueprint-reference.png"),
]);

/** Badge text color test (strict, detection + verification). */
export function badgeColorClass(r, g, b) {
  if (g >= 130 && g > r + 50 && g > b + 40) return "green";
  if (r >= 150 && r > g + 70 && r > b + 60) return "red";
  return null;
}

/** Relaxed fringe test (verification only, catches dim badge remnants). */
export function fringeColorClass(r, g, b) {
  if (g >= 115 && g > r + 45 && g > b + 30) return "green";
  if (r >= 140 && r > g + 55 && r > b + 40) return "red";
  return null;
}

const WINDOW_HALF_WIDTH = 34;
const WINDOW_ABOVE = 40;
const WINDOW_BELOW = 2;
const MIN_ROW_PIXELS = 6;
const MIN_RUN_ROWS = 5;
const MIN_RUN_PIXELS = 40;
const MAX_TEXT_WIDTH = 72;
const PAD_LEFT = 10;
const PAD_RIGHT = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 4;

/**
 * Expected badge windows derived from the overlay's own desk geometry: one per
 * painted (non-expanded) desk, centered on the desk column, searched in the gap
 * just above the band. The expanded OTC band (y=1072) is outside the 1024px
 * artboard, so it is reported as skipped, never invented.
 */
export function badgeWindows() {
  const windows = [];
  for (const band of ANCHOR_BANDS) {
    if (band.expanded) {
      windows.push(Object.freeze({ band: band.band, cx: null, bandY: band.y, expanded: true, skipped: true }));
      continue;
    }
    for (const sector of band.sectors) {
      for (let index = 0; index < sector.count; index += 1) {
        windows.push(Object.freeze({
          band: band.band,
          cx: Math.round(sector.x0 + index * sector.pitch),
          bandY: band.y,
          expanded: false,
          skipped: false,
        }));
      }
    }
  }
  return windows;
}

/**
 * Detect painted badge pills from raw RGBA pixels. Returns one mask per painted
 * desk that actually carries a badge (empty when a desk has no painted badge).
 *
 * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
 * @param {number} width image width.
 * @param {number} height image height.
 * @param {ReadonlyArray<object>} [windows] badge windows (defaults to geometry).
 * @returns {Array<{x:number,y:number,w:number,h:number,cx:number,band:string,color:string,pixels:number}>}
 */
export function detectBadgeMasks(data, width, height, windows = badgeWindows()) {
  const masks = [];
  for (const window of windows) {
    if (!window || window.skipped || window.cx == null) continue;
    const cx = window.cx;
    const x0 = Math.max(0, cx - WINDOW_HALF_WIDTH);
    const x1 = Math.min(width - 1, cx + WINDOW_HALF_WIDTH);
    const y0 = Math.max(0, window.bandY - WINDOW_ABOVE);
    const y1 = Math.min(height - 1, window.bandY - WINDOW_BELOW);
    if (y1 <= y0 || x1 <= x0) continue;

    const rows = [];
    for (let y = y0; y <= y1; y += 1) {
      let count = 0;
      let minX = x1 + 1;
      let maxX = -1;
      for (let x = x0; x <= x1; x += 1) {
        const index = (y * width + x) * 4;
        if (!badgeColorClass(data[index], data[index + 1], data[index + 2])) continue;
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      rows.push({ y, count, minX, maxX });
    }

    const active = rows.map((row) => row.count >= MIN_ROW_PIXELS);
    let bestStart = -1;
    let bestEnd = -1;
    let bestPixels = 0;
    let runStart = -1;
    let runPixels = 0;
    for (let i = 0; i <= active.length; i += 1) {
      if (i < active.length && active[i]) {
        if (runStart < 0) runStart = i;
        runPixels += rows[i].count;
        continue;
      }
      if (runStart >= 0) {
        const runRows = i - runStart;
        if (runRows >= MIN_RUN_ROWS && runPixels > bestPixels) {
          bestPixels = runPixels;
          bestStart = runStart;
          bestEnd = i - 1;
        }
      }
      runStart = -1;
      runPixels = 0;
    }
    if (bestStart < 0 || bestPixels < MIN_RUN_PIXELS) continue;

    let textMinX = width;
    let textMaxX = -1;
    let color = "green";
    let colored = 0;
    for (let i = bestStart; i <= bestEnd; i += 1) {
      const row = rows[i];
      if (row.maxX < 0) continue;
      for (let x = x0; x <= x1; x += 1) {
        const index = (row.y * width + x) * 4;
        const kind = badgeColorClass(data[index], data[index + 1], data[index + 2]);
        if (!kind) continue;
        colored += 1;
        if (x < textMinX) textMinX = x;
        if (x > textMaxX) textMaxX = x;
        if (kind === "red") color = "red";
      }
    }
    if (textMaxX < 0 || colored < MIN_RUN_PIXELS) continue;
    const textWidth = textMaxX - textMinX + 1;
    if (textWidth > MAX_TEXT_WIDTH) continue;

    const maskX = Math.max(0, textMinX - PAD_LEFT);
    const maskY = Math.max(0, rows[bestStart].y - PAD_TOP);
    const maskX1 = Math.min(width, textMaxX + 1 + PAD_RIGHT);
    const maskY1 = Math.min(height, rows[bestEnd].y + 1 + PAD_BOTTOM);
    if (maskX1 - maskX < 24 || maskY1 - maskY < 12) continue;

    masks.push({
      x: maskX,
      y: maskY,
      w: maskX1 - maskX,
      h: maskY1 - maskY,
      cx,
      band: window.band,
      color,
      pixels: colored,
    });
  }
  return masks;
}

/**
 * Inpaint each mask with a per-row horizontal fill: every masked pixel becomes a
 * linear blend between the untouched pixels immediately left and right of the
 * mask on the same row. Rows keep the local floor/wall gradients; no blur, no
 * rectangle seam. Masks never overlap (desk pitch > pill width).
 */
export function inpaintMasks(data, width, height, masks) {
  for (const mask of masks) {
    const yStart = Math.max(0, mask.y);
    const yEnd = Math.min(height - 1, mask.y + mask.h - 1);
    for (let y = yStart; y <= yEnd; y += 1) {
      const leftX = mask.x - 1;
      const rightX = mask.x + mask.w;
      const leftIndex = ((y * width) + Math.max(0, Math.min(width - 1, leftX))) * 4;
      const rightIndex = ((y * width) + Math.max(0, Math.min(width - 1, rightX))) * 4;
      const span = Math.max(1, rightX - leftX);
      for (let x = Math.max(0, mask.x); x < Math.min(width, mask.x + mask.w); x += 1) {
        const t = (x - leftX) / span;
        const index = (y * width + x) * 4;
        data[index] = Math.round(data[leftIndex] * (1 - t) + data[rightIndex] * t);
        data[index + 1] = Math.round(data[leftIndex + 1] * (1 - t) + data[rightIndex + 1] * t);
        data[index + 2] = Math.round(data[leftIndex + 2] * (1 - t) + data[rightIndex + 2] * t);
        data[index + 3] = 255;
      }
    }
  }
}

function insideMask(masks, x, y) {
  for (const mask of masks) {
    if (x >= mask.x && x < mask.x + mask.w && y >= mask.y && y < mask.y + mask.h) return true;
  }
  return false;
}

/** Count badge-colored pixels inside masks (strict + relaxed). */
export function scanMaskBadgePixels(data, width, height, masks, classify = badgeColorClass) {
  const result = { strict: 0, relaxed: 0, fringe: 0 };
  for (const mask of masks) {
    for (let y = mask.y; y < Math.min(height, mask.y + mask.h); y += 1) {
      for (let x = mask.x; x < Math.min(width, mask.x + mask.w); x += 1) {
        const index = (y * width + x) * 4;
        if (classify(data[index], data[index + 1], data[index + 2])) result.strict += 1;
        if (fringeColorClass(data[index], data[index + 1], data[index + 2])) result.fringe += 1;
      }
    }
  }
  result.relaxed = result.fringe;
  return result;
}

/** Pixels changed outside masks + global/per-region counts (honest metric). */
export function outsideMaskDiff(original, cleaned, width, height, masks, columns = 4, rows = 2) {
  let changed = 0;
  let outside = 0;
  const regions = [];
  const cellW = Math.floor(width / columns);
  const cellH = Math.floor(height / rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      regions.push({ region: `R${row + 1}C${col + 1}`, changed: 0, outside: 0 });
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (original[index] === cleaned[index]
        && original[index + 1] === cleaned[index + 1]
        && original[index + 2] === cleaned[index + 2]) continue;
      changed += 1;
      const region = regions[Math.min(rows - 1, Math.floor(y / cellH)) * columns + Math.min(columns - 1, Math.floor(x / cellW))];
      region.changed += 1;
      if (!insideMask(masks, x, y)) {
        outside += 1;
        region.outside += 1;
      }
    }
  }
  return { changed, outside, regions };
}

function loadCanvas() {
  const require = createRequire(import.meta.url);
  for (const candidate of NODE_CANVAS_CANDIDATES) {
    try {
      const module = require(candidate);
      if (module && typeof module.createCanvas === "function") return module;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("office-v3-clean-plate: @napi-rs/canvas nao encontrado.");
}

export function resolveSource() {
  for (const candidate of SOURCE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`office-v3-clean-plate: fonte nao encontrada (${SOURCE_CANDIDATES.join(", ")}).`);
}

/** Builds the before/after crop strip for visual review. */
function buildStrip(module, originalCanvas, cleanedCanvas, masks) {
  const bands = ANCHOR_BANDS.filter((band) => !band.expanded);
  const cropX = 180;
  const cropRight = 1360;
  const cropTop = 46;
  const cropBottom = 6;
  const width = cropRight - cropX;
  const cellH = cropTop + cropBottom;
  const labelW = 96;
  const rowGap = 4;
  const bandGap = 10;
  const height = bands.length * (cellH * 2 + rowGap) + (bands.length - 1) * bandGap;
  const strip = module.createCanvas(width + labelW, height);
  const ctx = strip.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(0, 0, strip.width, strip.height);
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "middle";
  let y = 0;
  for (const band of bands) {
    const cy = band.y;
    const sy = Math.max(0, cy - cropTop);
    for (const [label, source] of [["ANTES", originalCanvas], ["DEPOIS", cleanedCanvas]]) {
      ctx.drawImage(source, cropX, sy, width, cellH, labelW, y, width, cellH);
      ctx.fillStyle = label === "ANTES" ? "#f0b429" : "#3ddc84";
      ctx.fillText(label, 10, y + cellH / 2);
      y += cellH + rowGap;
    }
    ctx.fillStyle = "#1b2432";
    ctx.fillRect(0, y - rowGap - 2, strip.width, 2);
    y += bandGap - rowGap;
  }
  return strip;
}

export async function main(options = {}) {
  const module = options.module ?? loadCanvas();
  const source = options.source ?? resolveSource();
  const output = options.output ?? DEFAULT_OUTPUT;
  const stripPath = options.strip ?? DEFAULT_STRIP;

  const image = await module.loadImage(source);
  const canvas = module.createCanvas(CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  const original = ctx.getImageData(0, 0, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  const cleaned = ctx.createImageData(CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  cleaned.data.set(original.data);

  const windows = badgeWindows();
  const masks = detectBadgeMasks(original.data, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, windows);
  const skipped = windows.filter((window) => window.skipped).map((window) => `${window.band}@y=${window.bandY}`);
  const before = scanMaskBadgePixels(original.data, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, masks);
  inpaintMasks(cleaned.data, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, masks);
  const after = scanMaskBadgePixels(cleaned.data, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, masks);
  const parity = outsideMaskDiff(original.data, cleaned.data, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, masks);

  const cleanCanvas = module.createCanvas(CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  cleanCanvas.getContext("2d").putImageData(cleaned, 0, 0);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, cleanCanvas.toBuffer("image/png"));

  const strip = buildStrip(module, canvas, cleanCanvas, masks);
  mkdirSync(dirname(stripPath), { recursive: true });
  writeFileSync(stripPath, strip.toBuffer("image/png"));

  const badgePixelsRemoved = before.strict;
  const totalPixels = CLEAN_PLATE_WIDTH * CLEAN_PLATE_HEIGHT;
  const summary = {
    source,
    output,
    strip: stripPath,
    masks: masks.length,
    badgePixelsRemoved,
    remainingStrict: after.strict,
    remainingFringe: after.fringe,
    outsideMaskChanged: parity.outside,
    changedPixels: parity.changed,
    changedPct: Number(((parity.changed / totalPixels) * 100).toFixed(4)),
    skipped,
    regions: parity.regions.map((region) => ({ ...region, outsidePct: Number(((region.outside / totalPixels) * 100).toFixed(4)) })),
  };
  console.log(`[clean-plate] fonte ${source}`);
  console.log(`[clean-plate] ${masks.length} badges detectados; ${badgePixelsRemoved} pixels de badge removidos`);
  console.log(`[clean-plate] restantes strict=${after.strict} fringe=${after.fringe}; fora das mascaras alterados=${parity.outside}`);
  console.log(`[clean-plate] alterados=${parity.changed} (${summary.changedPct}% da imagem)`);
  for (const region of summary.regions) {
    console.log(`  ${region.region} changed=${region.changed} outside=${region.outside}`);
  }
  console.log(`[clean-plate] wrote ${output}`);
  console.log(`[clean-plate] wrote ${stripPath}`);
  if (skipped.length) console.log(`[clean-plate] bandas expandidas fora do artboard: ${skipped.join(", ")}`);
  return summary;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const summary = await main();
  if (summary.outsideMaskChanged !== 0) process.exitCode = 1;
  if (summary.remainingStrict !== 0) process.exitCode = 1;
}

export default { main, detectBadgeMasks, inpaintMasks, badgeWindows, badgeColorClass };
