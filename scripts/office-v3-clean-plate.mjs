/**
 * OFFICE V3 â€” CLEAN PLATE builder v2 (headless, reproducible).
 *
 * The frozen blueprint (`reference.png`, 1536x1024) ships with PAINTED content
 * that must never exist in the static base:
 *   (1) FALSE P&L badges above every desk ("+R$ 8,50" / "-R$ 10,00");
 *   (2) PAINTED CHARACTERS everywhere â€” desk rows (traders/critics) AND the
 *       social areas (lounge, sofas, pool tables, cafÃ©/kitchen, meeting room,
 *       research corner, terrace, arcade, stairs and the bottom band).
 *
 * The ONLY source of characters and P&L values is the runtime (`overlay.js` +
 * `assets.js` drawn per real station state). This script detects every painted
 * sprite/pill and INPAINTS it from the local surroundings:
 *   - masks come from skin-tone / dark-hair-tone / saturated-shirt-tone
 *     signatures, compact blob shapes and "eyes embedded in skin" structure;
 *   - every mask is inpainted preferring horizontal interpolation between the
 *     nearest unmasked pixels on the same row, then vertical interpolation,
 *     then the dominant local background sampled from a ring around the mask;
 *   - furniture overlapping a sprite (sofas, pool tables, desks) is rebuilt
 *     from the furniture's own colors via the same local sampling.
 *
 * Outputs:
 *   - src/http/public/office-v3/blueprint-clean.png      (new static base)
 *   - docs/office-v3/screenshots/clean-plate-v2.png      (before/after review strip)
 *
 * Honest reporting (printed, never manipulated):
 *   (a) badge pixels removed + strict/fringe leftover scan;
 *   (b) character-signature clusters removed + residual scan on the clean plate;
 *   (c) pixels changed OUTSIDE the masks (must be 0) + per-region table;
 *   (d) per-mask difficulty score with coordinates for imperfect rebuilds.
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
export const DEFAULT_STRIP = resolve(REPO_ROOT, "docs/office-v3/screenshots/clean-plate-v2.png");
export const SOURCE_CANDIDATES = Object.freeze([
  "C:/Users/junin/AppData/Local/Temp/opencode/reference.png",
  resolve(REPO_ROOT, "src/http/public/office-v3/blueprint-reference.png"),
]);

/* ------------------------------------------------------------------ colors */

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

/** Bright/light skin (faces, hands). */
export function skinTone(r, g, b) {
  return r >= 180 && g >= 105 && r > g + 15 && g > b + 15 && r - b >= 48 && b <= 220;
}

/** Deeper skin tones (visible in the cafÃ©/kitchen and some desks). */
export function skinDeepTone(r, g, b) {
  if (r < 115 || r > 225) return false;
  if (g < 62 || g > 175 || b > 150) return false;
  if (r <= g + 16 || g <= b + 4) return false;
  if (r - b < 42 || r - b > 165) return false;
  return true;
}

/** Dark hair / sprite outline (warm or neutral dark, not navy/teal panels). */
export function hairTone(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 118 && max - min <= 62 && b <= r + 14) return true;
  if (r >= 78 && r <= 190 && g >= 30 && g <= 140 && b <= 100 && r > g + 26 && g > b + 3 && r - g <= 115) return true;
  return false;
}

/** Near-black sprite outline / black hair (warm or neutral, not green/teal). */
export function spriteDarkTone(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max > 86) return false;
  if (max - min > 58) return false;
  if (g > r + 24) return false;
  if (b > r + 34) return false;
  return true;
}

/** Saturated clothing (shirts, dresses, jackets). */
export function shirtTone(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (b >= 105 && b > r + 30 && b > g + 18) return true; // blue / denim
  if (r >= 145 && r > g + 58 && r > b + 52) return true; // red / wine
  if (g >= 115 && g > r + 30 && g > b + 38) return true; // green
  if (r >= 195 && g >= 150 && b <= 130 && r - b >= 85 && g - b >= 55) return true; // yellow / amber
  if (min >= 205 && max - min <= 48) return true; // white shirt
  if (r >= 120 && b >= 120 && b > g + 25 && r > g + 15) return true; // purple
  return false;
}

/** Eye / mouth dark details used to confirm a face. */
export function eyeTone(r, g, b) {
  return Math.max(r, g, b) <= 92;
}

/* --------------------------------------------------------------- geometry */

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

/* ------------------------------------------------ desk-agent geometry */

/**
 * Authoritative desk-agent boxes, derived from the SAME `ANCHOR_BANDS` the
 * runtime overlay uses to seat the dynamic agents (trader at cx-20, critic at
 * cx+20). The automatic color detector misses sprites whose skin component
 * merges with the wooden desk/background (dark-haired traders) — the previous
 * clean plate kept ~14 painted agents alive. These boxes guarantee every
 * painted agent inside the 50 painted desks (10+10+10+10+10) is masked,
 * ending at `band.y + 25`: the desk front with the engraved label starts
 * below, so labels are never touched.
 */
export const DESK_AGENT_BOX = Object.freeze({ halfWidth: 17, above: 17, below: 25, agentOffset: 20 });

export function deskAgentBoxes(bands = ANCHOR_BANDS) {
  const boxes = [];
  for (const band of bands) {
    if (!band || band.expanded) continue;
    for (const sector of band.sectors) {
      for (let index = 0; index < sector.count; index += 1) {
        const cx = Math.round(sector.x0 + index * sector.pitch);
        for (const side of [-1, 1]) {
          const agentX = cx + side * DESK_AGENT_BOX.agentOffset;
          boxes.push(Object.freeze({
            band: band.band,
            cx,
            side,
            agentX,
            x: agentX - DESK_AGENT_BOX.halfWidth,
            y: band.y - DESK_AGENT_BOX.above,
            w: DESK_AGENT_BOX.halfWidth * 2,
            h: DESK_AGENT_BOX.above + DESK_AGENT_BOX.below,
          }));
        }
      }
    }
  }
  return Object.freeze(boxes);
}

export const DESK_AGENT_BOXES = deskAgentBoxes();

/** Clip limit for automatic masks inside a desk row (keeps the engraved label). */
export function deskClipLimit(x, y, bands = ANCHOR_BANDS) {
  for (const band of bands) {
    if (!band || band.expanded) continue;
    if (y < band.y - 34 || y > band.y + 90) continue;
    for (const sector of band.sectors) {
      const x0 = sector.x0 - 70;
      const x1 = sector.x0 + (sector.count - 1) * sector.pitch + 70;
      if (x >= x0 && x <= x1) return band.y + 25;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Detect painted badge pills from raw RGBA pixels (legacy pass kept intact).
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
      kind: "badge",
    });
  }
  return masks;
}

/* ------------------------------------------------- character seed detection */

const SEED_MIN_PIXELS = 30;
const SEED_MAX_PIXELS = 620;
const SEED_MIN_W = 8;
const SEED_MAX_W = 36;
const SEED_MIN_H = 6;
const SEED_MAX_H = 36;
const SEED_MIN_FILL = 0.45;
const EYE_MAX_PIXELS = 14;
const EYE_SKIN_RATIO = 0.36;

function labelComponents(mask, width, height, maxPixels = 20000) {
  const label = new Int32Array(width * height).fill(-1);
  const comps = [];
  const stack = [];
  let nextId = 0;
  for (let start = 0; start < width * height; start += 1) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = nextId;
    nextId += 1;
    let count = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    stack.length = 0;
    stack.push(start);
    label[start] = id;
    let over = false;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p / width) | 0;
      count += 1;
      if (count > maxPixels) { over = true; break; }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] && label[q] < 0) { label[q] = id; stack.push(q); }
        }
      }
    }
    if (over) continue;
    comps.push({ id, count, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return { comps, label };
}

/**
 * "Eyes embedded in skin": compact dark blobs strictly inside a candidate face
 * bbox whose 8-neighbourhood is mostly skin. This is what separates faces from
 * golden text glyphs, wood grain or lamp glows (all skin-ish by color alone).
 */
function countFaceEyes(data, width, height, skin, label, comp) {
  const seen = new Set();
  let eyes = 0;
  for (let y = comp.minY; y <= comp.maxY; y += 1) {
    for (let x = comp.minX; x <= comp.maxX; x += 1) {
      const p = y * width + x;
      const index = p * 4;
      if (!eyeTone(data[index], data[index + 1], data[index + 2]) || label[p] >= 0 || seen.has(p)) continue;
      let touchesEdge = false;
      let size = 0;
      const blob = [];
      const queue = [p];
      seen.add(p);
      while (queue.length) {
        const v = queue.pop();
        const vx = v % width;
        const vy = (v / width) | 0;
        size += 1;
        blob.push(v);
        if (vx === comp.minX || vx === comp.maxX || vy === comp.minY || vy === comp.maxY) touchesEdge = true;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = vx + dx;
            const ny = vy + dy;
            if (nx < comp.minX || nx > comp.maxX || ny < comp.minY || ny > comp.maxY) continue;
            const np = ny * width + nx;
            const ni = np * 4;
            if (!eyeTone(data[ni], data[ni + 1], data[ni + 2]) || label[np] >= 0 || seen.has(np)) continue;
            seen.add(np);
            queue.push(np);
          }
        }
      }
      if (touchesEdge || size > EYE_MAX_PIXELS) continue;
      const blobSet = new Set(blob);
      let neighbours = 0;
      let skinNeighbours = 0;
      for (const v of blob) {
        const vx = v % width;
        const vy = (v / width) | 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = vx + dx;
            const ny = vy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            if (blobSet.has(np)) continue;
            neighbours += 1;
            if (skin[np]) skinNeighbours += 1;
          }
        }
      }
      if (neighbours && skinNeighbours / neighbours >= EYE_SKIN_RATIO) eyes += 1;
    }
  }
  return eyes;
}

/**
 * Face seeds: compact LIGHT-skin blobs confirmed by embedded eyes and by the
 * body below them. Deep-skin tones overlap brown hair and wood, so deeper
 * characters are found through the hair+clothing back-seed pass instead.
 * @returns {Array<{kind:"face", pixels:number[], x:number,y:number,w:number,h:number, eyes:number}>}
 */
export function detectFaceSeeds(data, width, height) {
  const light = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    if (skinTone(r, g, b)) light[p] = 1;
  }
  const { comps, label } = labelComponents(light, width, height, 4000);
  const seeds = [];
  for (const comp of comps) {
    if (comp.count < SEED_MIN_PIXELS || comp.count > SEED_MAX_PIXELS) continue;
    if (comp.w < SEED_MIN_W || comp.w > SEED_MAX_W) continue;
    if (comp.h < SEED_MIN_H || comp.h > SEED_MAX_H) continue;
    const fill = comp.count / (comp.w * comp.h);
    if (fill < SEED_MIN_FILL) continue;
    const eyes = countFaceEyes(data, width, height, light, label, comp);
    if (eyes < 1) continue;
    // Gold/pale lettering on panels and desk labels also looks like skin with a
    // dark "eye" (the letter counter). A real face either shows two+ dark
    // details (eyes/mouth) or sits directly on skin/clothing below it.
    let belowSkin = 0;
    for (let y = comp.maxY + 1; y <= Math.min(height - 1, comp.maxY + 2); y += 1) {
      for (let x = comp.minX; x <= comp.maxX; x += 1) {
        const index = (y * width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        if (skinTone(r, g, b) || skinDeepTone(r, g, b) || shirtTone(r, g, b)) belowSkin += 1;
      }
    }
    if (eyes < 2 && belowSkin < 1) continue;
    const pixels = [];
    for (let y = comp.minY; y <= comp.maxY; y += 1) {
      for (let x = comp.minX; x <= comp.maxX; x += 1) {
        const p = y * width + x;
        if (label[p] === comp.id) pixels.push(p);
      }
    }
    seeds.push({ kind: "face", pixels, x: comp.minX, y: comp.minY, w: comp.w, h: comp.h, eyes, deep: false });
  }
  return seeds;
}

const HAIRSHIRT_MIN_HAIR = 140;
const HAIRSHIRT_MIN_SHIRT = 140;
const HAIRSHIRT_MAX_W = 80;
const HAIRSHIRT_MAX_H = 130;
const HAIRSHIRT_GAP = 8;
const HAIRSHIRT_OVERLAP = 0.42;

/**
 * Back-facing characters (terrace, kitchen, meeting) show no eyes: they are
 * detected as a compact dark-hair component sitting directly on top of a
 * saturated clothing component, with no accepted face seed already covering
 * them.
 */
export function detectBackSeeds(data, width, height, existing = []) {
  const hair = new Uint8Array(width * height);
  const shirt = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    if (hairTone(r, g, b)) hair[p] = 1;
    if (shirtTone(r, g, b)) shirt[p] = 1;
  }
  const hairComps = labelComponents(hair, width, height, 3000).comps
    .filter((comp) => comp.count >= HAIRSHIRT_MIN_HAIR && comp.count <= 3000
      && comp.w >= 7 && comp.w <= 46 && comp.h >= 6 && comp.h <= 60
      && comp.count / (comp.w * comp.h) >= 0.34);
  const shirtComps = labelComponents(shirt, width, height, 4000).comps
    .filter((comp) => comp.count >= HAIRSHIRT_MIN_SHIRT && comp.count <= 4000
      && comp.w >= 8 && comp.w <= 52 && comp.h >= 6 && comp.h <= 70
      && comp.count / (comp.w * comp.h) >= 0.3);

  const seeds = [];
  for (const hc of hairComps) {
    if (overlapsKeepOut(hc)) continue;
    let already = false;
    for (const seed of existing) {
      if (seed.x <= hc.maxX && seed.x + seed.w > hc.minX && seed.y <= hc.maxY && seed.y + seed.h > hc.minY) {
        // overlap only counts when the seed sits on the hair
        const overlapY = Math.min(seed.y + seed.h, hc.maxY) - Math.max(seed.y, hc.minY);
        if (overlapY > 2) { already = true; break; }
      }
    }
    if (already) continue;
    for (const sc of shirtComps) {
      if (sc.minY < hc.minY) continue;
      const gap = sc.minY - hc.maxY;
      if (gap < -6 || gap > HAIRSHIRT_GAP) continue;
      const overlapX = Math.min(hc.maxX, sc.maxX) - Math.max(hc.minX, sc.minX) + 1;
      const minW = Math.min(hc.w, sc.w);
      if (overlapX < minW * HAIRSHIRT_OVERLAP) continue;
      const unionW = Math.max(hc.maxX, sc.maxX) - Math.min(hc.minX, sc.minX) + 1;
      const unionH = Math.max(hc.maxY, sc.maxY) - Math.min(hc.minY, sc.minY) + 1;
      if (unionW > HAIRSHIRT_MAX_W || unionH > HAIRSHIRT_MAX_H) continue;
      const pixels = [];
      for (let y = hc.minY; y <= hc.maxY; y += 1) {
        for (let x = hc.minX; x <= hc.maxX; x += 1) {
          const p = y * width + x;
          if (hair[p]) pixels.push(p);
        }
      }
      for (let y = sc.minY; y <= sc.maxY; y += 1) {
        for (let x = sc.minX; x <= sc.maxX; x += 1) {
          const p = y * width + x;
          if (shirt[p]) pixels.push(p);
        }
      }
      seeds.push({
        kind: "back",
        pixels,
        x: Math.min(hc.minX, sc.minX),
        y: hc.minY,
        w: unionW,
        h: unionH,
        eyes: 0,
        deep: false,
      });
      break;
    }
  }
  return seeds;
}

/* -------------------------------------------------- social / zone detection */

const SOCIAL_SEED_MIN_PIXELS = 60;
const SOCIAL_SEED_MAX_PIXELS = 700;
const SOCIAL_MIN_W = 6;
const SOCIAL_MAX_W = 40;
const SOCIAL_MIN_H = 5;
const SOCIAL_MAX_H = 40;
const SOCIAL_MIN_FILL = 0.38;
const SOCIAL_MAX_FLAT_PCT = 30;
const SOCIAL_MAX_RING_DARK_PCT = 30;
const SOCIAL_BELOW_SHIRT_MIN = 5;
const SOCIAL_BELOW_SKIN_MIN = 10;

/**
 * Social areas away from the desk grid (lounge, pool, cafe, meeting, kitchen,
 * terrace, bottom band). The relaxed pass only fires inside these boxes.
 */
export const SOCIAL_ZONES = Object.freeze([
  Object.freeze({ x0: 0, y0: 120, x1: 1160, y1: 380, note: "topo (lounge/pool)" }),
  Object.freeze({ x0: 0, y0: 380, x1: 180, y1: 900, note: "coluna esquerda (reuniao)" }),
  Object.freeze({ x0: 1360, y0: 120, x1: 1536, y1: 1024, note: "coluna direita" }),
  Object.freeze({ x0: 0, y0: 900, x1: 1536, y1: 1024, note: "faixa inferior" }),
  Object.freeze({ x0: 480, y0: 240, x1: 760, y1: 360, note: "sinuca" }),
  Object.freeze({ x0: 1150, y0: 180, x1: 1360, y1: 420, note: "cafe" }),
]);

/**
 * Objects that a relaxed color detector cannot distinguish from a character
 * (wood/golden pots, leather couch, lamps, painted sign text, keyboards) and
 * that were verified visually in the reference. Seeds inside these boxes are
 * never removed; the pixels stay untouched.
 */
export const PRESERVE_REGIONS = Object.freeze([
  Object.freeze({ x: 1085, y: 195, w: 72, h: 132, note: "bar + abajur oeste do cafe" }),
  Object.freeze({ x: 1143, y: 303, w: 44, h: 48, note: "cadeira de madeira do cafe" }),
  Object.freeze({ x: 445, y: 160, w: 78, h: 76, note: "escada/corrimao" }),
  Object.freeze({ x: 460, y: 303, w: 60, h: 54, note: "vaso dourado do lobby" }),
  Object.freeze({ x: 95, y: 356, w: 64, h: 42, note: "mesa de papeis" }),
  Object.freeze({ x: 96, y: 300, w: 84, h: 64, note: "mesa lateral com objetos (lounge)" }),
  Object.freeze({ x: 1385, y: 353, w: 44, h: 50, note: "abajur" }),
  Object.freeze({ x: 1006, y: 274, w: 30, h: 42, note: "cadeira" }),
  Object.freeze({ x: 846, y: 276, w: 52, h: 42, note: "sofa/sideboard do lounge" }),
  Object.freeze({ x: 1036, y: 281, w: 52, h: 52, note: "armario" }),
  Object.freeze({ x: 93, y: 521, w: 56, h: 48, note: "piso da reuniao" }),
  Object.freeze({ x: 1441, y: 726, w: 56, h: 32, note: "balcao da cozinha" }),
  Object.freeze({ x: 1460, y: 760, w: 44, h: 34, note: "mesa/prato da cozinha" }),
  Object.freeze({ x: 556, y: 931, w: 44, h: 40, note: "objeto sobre a mesa" }),
  Object.freeze({ x: 133, y: 800, w: 56, h: 52, note: "piso/planta" }),
  Object.freeze({ x: 366, y: 976, w: 52, h: 48, note: "vaso (inferior esquerdo)" }),
  Object.freeze({ x: 483, y: 981, w: 58, h: 43, note: "vaso (inferior centro)" }),
  Object.freeze({ x: 709, y: 942, w: 50, h: 50, note: "teclado" }),
  Object.freeze({ x: 853, y: 918, w: 104, h: 66, note: "sofá: almofada + vaso dourado" }),
  Object.freeze({ x: 472, y: 80, w: 70, h: 126, note: "janela skyline + luminaria (falso positivo de back-seed)" }),
]);

/**
 * Verified characters whose sprites expose neither a light face with eyes nor
 * a saturated shirt above a dark blob (back-facing / very dark / occluded).
 * Anchors were located by visual inspection of the frozen reference; they
 * guarantee full coverage where the automatic passes are blind.
 */
export const MANUAL_ANCHORS = Object.freeze([
  Object.freeze({ x: 1172, y: 278, w: 34, h: 62, note: "cafe: pessoa da esquerda" }),
  Object.freeze({ x: 1208, y: 278, w: 40, h: 62, note: "cafe: pessoa da direita (pele escura)" }),
  Object.freeze({ x: 1408, y: 738, w: 34, h: 54, note: "cozinha: pessoa da esquerda" }),
  Object.freeze({ x: 1444, y: 744, w: 36, h: 56, note: "cozinha: pessoa de costas" }),
  Object.freeze({ x: 1478, y: 728, w: 34, h: 58, note: "cozinha: pessoa da direita" }),
  Object.freeze({ x: 1452, y: 852, w: 42, h: 78, note: "terraco: pessoa de costas" }),
  Object.freeze({ x: 36, y: 452, w: 36, h: 54, note: "reuniao: pessoa superior esquerda" }),
  Object.freeze({ x: 72, y: 448, w: 36, h: 58, note: "reuniao: pessoa superior direita (pele escura)" }),
  Object.freeze({ x: 92, y: 472, w: 34, h: 54, note: "reuniao: pessoa do cabelo ruivo" }),
  Object.freeze({ x: 14, y: 501, w: 34, h: 56, note: "reuniao: pessoa inferior esquerda" }),
  Object.freeze({ x: 72, y: 505, w: 40, h: 50, note: "reuniao: pessoa inferior direita" }),
]);

function inSocialZone(cx, cy) {
  for (const zone of SOCIAL_ZONES) {
    if (cx >= zone.x0 && cx < zone.x1 && cy >= zone.y0 && cy < zone.y1) return true;
  }
  return false;
}

function overlapsKeepOut(comp) {
  const pad = 2;
  for (const region of PRESERVE_REGIONS) {
    if (comp.minX < region.x + region.w + pad && comp.maxX > region.x - pad
      && comp.minY < region.y + region.h + pad && comp.maxY > region.y - pad) return true;
  }
  return false;
}

function overlapsSeed(comp, seed) {
  return seed.x <= comp.maxX && seed.x + seed.w > comp.minX
    && seed.y <= comp.maxY && seed.y + seed.h > comp.minY;
}

function ringStats(data, width, height, comp) {
  const counts = new Map();
  let ring = 0;
  let dark = 0;
  for (let y = comp.minY - 6; y <= comp.maxY + 6; y += 1) {
    for (let x = comp.minX - 6; x <= comp.maxX + 6; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (x >= comp.minX - 2 && x <= comp.maxX + 2 && y >= comp.minY - 2 && y <= comp.maxY + 2) continue;
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      ring += 1;
      if (!skinTone(r, g, b) && !skinDeepTone(r, g, b) && !hairTone(r, g, b) && spriteDarkTone(r, g, b)) dark += 1;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let top = 0;
  for (const value of counts.values()) if (value > top) top = value;
  return {
    flatPct: ring ? (top / ring) * 100 : 0,
    darkPct: ring ? (dark / ring) * 100 : 0,
  };
}

function bandToneCount(data, width, height, x0, x1, y0, y1, test) {
  let count = 0;
  const cx0 = Math.max(0, x0);
  const cx1 = Math.min(width - 1, x1);
  const cy0 = Math.max(0, y0);
  const cy1 = Math.min(height - 1, y1);
  for (let y = cy0; y <= cy1; y += 1) {
    for (let x = cx0; x <= cx1; x += 1) {
      const index = (y * width + x) * 4;
      if (test(data[index], data[index + 1], data[index + 2])) count += 1;
    }
  }
  return count;
}

const belowIsSkinOrShirt = (r, g, b) => skinTone(r, g, b) || skinDeepTone(r, g, b) || shirtTone(r, g, b);

/**
 * Relaxed social pass: compact skin/deep-skin blobs inside social zones with
 * eye-like details, rejecting flat painted panels (signs, keyboards) and
 * verified furniture (PRESERVE_REGIONS). A seed is only accepted with body
 * context: two dark details, saturated clothing right below, or skin below
 * (the "head sitting on a body" test).
 */
export function detectSocialSeeds(data, width, height, existing = []) {
  const union = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    if (skinTone(r, g, b) || skinDeepTone(r, g, b)) union[p] = 1;
  }
  const { comps, label } = labelComponents(union, width, height, 1200);
  const seeds = [];
  for (const comp of comps) {
    if (comp.count < SOCIAL_SEED_MIN_PIXELS || comp.count > SOCIAL_SEED_MAX_PIXELS) continue;
    if (comp.w < SOCIAL_MIN_W || comp.w > SOCIAL_MAX_W) continue;
    if (comp.h < SOCIAL_MIN_H || comp.h > SOCIAL_MAX_H) continue;
    if (comp.count / (comp.w * comp.h) < SOCIAL_MIN_FILL) continue;
    const cx = comp.minX + comp.w / 2;
    const cy = comp.minY + comp.h / 2;
    if (!inSocialZone(cx, cy)) continue;
    if (overlapsKeepOut(comp)) continue;
    if (existing.some((seed) => overlapsSeed(comp, seed))) continue;
    const eyes = countFaceEyes(data, width, height, union, label, comp);
    if (eyes < 1) continue;
    const { flatPct, darkPct } = ringStats(data, width, height, comp);
    if (flatPct >= SOCIAL_MAX_FLAT_PCT || darkPct >= SOCIAL_MAX_RING_DARK_PCT) continue;
    const belowShirt = bandToneCount(data, width, height, comp.minX - 6, comp.maxX + 6, comp.maxY + 1, comp.maxY + 14, shirtTone);
    const belowSkin = bandToneCount(data, width, height, comp.minX - 6, comp.maxX + 6, comp.maxY + 1, comp.maxY + 14, belowIsSkinOrShirt);
    if (eyes < 2 && belowShirt < SOCIAL_BELOW_SHIRT_MIN && belowSkin < SOCIAL_BELOW_SKIN_MIN) continue;
    const pixels = [];
    for (let y = comp.minY; y <= comp.maxY; y += 1) {
      for (let x = comp.minX; x <= comp.maxX; x += 1) {
        const p = y * width + x;
        if (label[p] === comp.id) pixels.push(p);
      }
    }
    seeds.push({
      kind: "social",
      pixels,
      x: comp.minX,
      y: comp.minY,
      w: comp.w,
      h: comp.h,
      eyes,
      deep: false,
    });
  }
  return seeds;
}

/**
 * Manual anchor seeds: the whole verified box is the seed. Anchors were
 * located by visual inspection of the frozen reference (cafe pair, kitchen
 * trio, meeting five, terrace back). Filling the full box guarantees no sprite
 * remnant survives to feed the diffusion fill (remnants cause ghosting);
 * the surrounding pixels reconstruct the box from its ring.
 */
export function manualAnchorSeeds(data, width, height) {
  const seeds = [];
  for (const anchor of MANUAL_ANCHORS) {
    const x0 = Math.max(0, anchor.x);
    const y0 = Math.max(0, anchor.y);
    const x1 = Math.min(width - 1, anchor.x + anchor.w - 1);
    const y1 = Math.min(height - 1, anchor.y + anchor.h - 1);
    if (x1 < x0 || y1 < y0) continue;
    const pixels = [];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) pixels.push(y * width + x);
    }
    if (pixels.length < 8) continue;
    seeds.push({
      kind: "social-anchor",
      pixels,
      x: x0,
      y: y0,
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      eyes: 1,
      deep: false,
      boxFill: true,
    });
  }
  return seeds;
}

/* ------------------------------------------------------- sprite mask growth */

const GROW_ABSORB_DISTANCE = 3;
const GROW_LEG_ROWS = 8;
const SMALL_SKIN_COMPONENT = 64;
const SMALL_SHIRT_COMPONENT = 900;
const DARK_COMPONENT_MAX = 2200;

function quantKey(r, g, b) {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
}

function boxForSeed(seed, width, height) {
  const padX = Math.max(7, Math.round(seed.w * 0.7));
  const padTop = Math.max(5, Math.round(seed.h * 0.55));
  const padBottom = Math.min(58, Math.max(10, Math.round(seed.h * 2.4)));
  return {
    x0: Math.max(0, seed.x - padX),
    x1: Math.min(width, seed.x + seed.w + padX),
    y0: Math.max(0, seed.y - padTop),
    y1: Math.min(height, seed.y + seed.h + padBottom),
  };
}

/**
 * Builds reusable masks/labels for the sprite growth: skin union (light +
 * deep), saturated clothing, and their component sizes. Wooden desks and
 * floors are skin-toned but live in huge components, so the size test is what
 * separates a hand (small blob) from a desk panel (large region).
 */
export function buildSpriteContext(data, width, height) {
  const skinUnion = new Uint8Array(width * height);
  const shirt = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const r = data[p * 4];
    const g = data[p * 4 + 1];
    const b = data[p * 4 + 2];
    if (skinTone(r, g, b) || skinDeepTone(r, g, b)) skinUnion[p] = 1;
    if (shirtTone(r, g, b)) shirt[p] = 1;
    if (spriteDarkTone(r, g, b) || hairTone(r, g, b)) dark[p] = 1;
  }
  const skinLabeled = labelComponents(skinUnion, width, height, 200000);
  const shirtLabeled = labelComponents(shirt, width, height, 200000);
  const darkLabeled = labelComponents(dark, width, height, 300000);
  const skinSize = new Int32Array(skinLabeled.comps.length);
  for (const comp of skinLabeled.comps) skinSize[comp.id] = comp.count;
  const shirtSize = new Int32Array(shirtLabeled.comps.length);
  for (const comp of shirtLabeled.comps) shirtSize[comp.id] = comp.count;
  const darkSize = new Int32Array(darkLabeled.comps.length);
  for (const comp of darkLabeled.comps) darkSize[comp.id] = comp.count;
  return {
    skinUnion,
    skinLabel: skinLabeled.label,
    skinSize,
    shirt,
    shirtLabel: shirtLabeled.label,
    shirtSize,
    darkLabel: darkLabeled.label,
    darkSize,
  };
}

/**
 * Grows one sprite mask from a seed inside a bounded box:
 *   1. core = small skin blobs (face/hands/feet) + small saturated-clothing
 *      blobs (shirts) + the seed pixels themselves;
 *   2. sprite-tone pixels (outline, hair, pants) within a small Chebyshev
 *      distance of the core are absorbed, which never chains across floors or
 *      sofas because the distance is measured to the core, not to the mask;
 *   3. a bounded legs pass below the clothing adds dark/denim pixels;
 *   4. enclosed holes are filled so no sprite speckle survives.
 * `claimed` avoids double-processing when boxes overlap.
 */
function growSeedMask(data, width, height, seed, claimed, context, options = {}) {
  const strictCore = options.strictCore === true;
  const box = boxForSeed(seed, width, height);
  const boxW = box.x1 - box.x0;
  const boxH = box.y1 - box.y0;
  if (boxW <= 0 || boxH <= 0) return [];
  const mark = new Uint8Array(boxW * boxH);
  const dist = new Int16Array(boxW * boxH).fill(-1);
  const queue = [];
  const seedSet = new Set(seed.pixels);
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const p = y * width + x;
      const local = (y - box.y0) * boxW + (x - box.x0);
      const skinSmall = context.skinUnion[p] && context.skinSize[context.skinLabel[p]] <= SMALL_SKIN_COMPONENT;
      const shirtSmall = context.shirt[p] && context.shirtSize[context.shirtLabel[p]] <= SMALL_SHIRT_COMPONENT;
      if (seedSet.has(p) || (!strictCore && (skinSmall || shirtSmall))) {
        mark[local] = 1;
        dist[local] = 0;
        queue.push(local);
      }
    }
  }
  // BFS absorption of sprite tones within GROW_ABSORB_DISTANCE of the core
  let head = 0;
  while (head < queue.length) {
    const v = queue[head];
    head += 1;
    const lx = v % boxW;
    const ly = (v / boxW) | 0;
    const d = dist[v];
    if (d >= GROW_ABSORB_DISTANCE) continue;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = lx + dx;
        const ny = ly + dy;
        if (nx < 0 || ny < 0 || nx >= boxW || ny >= boxH) continue;
        const local = ny * boxW + nx;
        if (dist[local] >= 0) continue;
        const x = box.x0 + nx;
        const y = box.y0 + ny;
        const p = y * width + x;
        const index = p * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const darkSize = context.darkLabel[p] >= 0 ? context.darkSize[context.darkLabel[p]] : Infinity;
        if (darkSize <= DARK_COMPONENT_MAX && (spriteDarkTone(r, g, b) || hairTone(r, g, b))) {
          mark[local] = 1;
          dist[local] = d + 1;
          queue.push(local);
        }
      }
    }
  }
  // legs pass: absorb near-black / denim pixels below the clothing only
  // (bounded rows and columns: desk labels, floor grain and panel shadows
  // are never reached sideways or across the whole box)
  let coreMinX = boxW;
  let coreMaxX = -1;
  let coreMaxY = -1;
  for (let ly = 0; ly < boxH; ly += 1) {
    for (let lx = 0; lx < boxW; lx += 1) {
      if (!mark[ly * boxW + lx]) continue;
      const p = (box.y0 + ly) * width + (box.x0 + lx);
      if (context.shirt[p] || context.skinUnion[p] || seedSet.has(p)) {
        if (lx < coreMinX) coreMinX = lx;
        if (lx > coreMaxX) coreMaxX = lx;
        if (ly > coreMaxY) coreMaxY = ly;
      }
    }
  }
  if (coreMaxY >= 0) {
    for (let round = 0; round < GROW_LEG_ROWS; round += 1) {
      let changed = false;
      const snapshot = mark.slice();
      const yStart = Math.max(0, coreMaxY - 2);
      const yEnd = Math.min(boxH - 1, coreMaxY + GROW_LEG_ROWS);
      const xStart = Math.max(0, coreMinX - 2);
      const xEnd = Math.min(boxW - 1, coreMaxX + 2);
      for (let ly = yStart; ly <= yEnd; ly += 1) {
        for (let lx = xStart; lx <= xEnd; lx += 1) {
          const local = ly * boxW + lx;
          if (snapshot[local]) continue;
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue;
              const nx = lx + dx;
              const ny = ly + dy;
              if (nx < 0 || ny < 0 || nx >= boxW || ny >= boxH) continue;
              if (snapshot[ny * boxW + nx]) { near = true; break; }
            }
          }
          if (!near) continue;
          const x = box.x0 + lx;
          const y = box.y0 + ly;
          const p = y * width + x;
          const index = p * 4;
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const nearBlack = Math.max(r, g, b) <= 48;
          const denim = b >= 58 && b > r + 22 && b > g + 12;
          const darkSize = context.darkLabel[p] >= 0 ? context.darkSize[context.darkLabel[p]] : Infinity;
          if ((nearBlack && darkSize <= DARK_COMPONENT_MAX) || denim
            || (darkSize <= DARK_COMPONENT_MAX && spriteDarkTone(r, g, b))) {
            mark[local] = 1;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }
  // fill enclosed holes (background pockets surrounded by the mask)
  const outside = new Uint8Array(boxW * boxH);
  const flood = [];
  for (let lx = 0; lx < boxW; lx += 1) {
    for (const ly of [0, boxH - 1]) {
      const local = ly * boxW + lx;
      if (!mark[local] && !outside[local]) { outside[local] = 1; flood.push(local); }
    }
  }
  for (let ly = 0; ly < boxH; ly += 1) {
    for (const lx of [0, boxW - 1]) {
      const local = ly * boxW + lx;
      if (!mark[local] && !outside[local]) { outside[local] = 1; flood.push(local); }
    }
  }
  let fh = 0;
  while (fh < flood.length) {
    const v = flood[fh];
    fh += 1;
    const lx = v % boxW;
    const ly = (v / boxW) | 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = lx + dx;
        const ny = ly + dy;
        if (nx < 0 || ny < 0 || nx >= boxW || ny >= boxH) continue;
        const local = ny * boxW + nx;
        if (!mark[local] && !outside[local]) { outside[local] = 1; flood.push(local); }
      }
    }
  }
  // Hole filling only makes sense when real background could be reached from
  // the box border; if the mask sealed the whole perimeter, skip it (never
  // turn a whole box into a mask).
  const backgroundReachable = flood.length >= boxW * boxH * 0.12;
  const pixels = [];
  for (let ly = 0; ly < boxH; ly += 1) {
    for (let lx = 0; lx < boxW; lx += 1) {
      const local = ly * boxW + lx;
      const isMask = mark[local] || (backgroundReachable && !outside[local]);
      if (!isMask) continue;
      const p = (box.y0 + ly) * width + (box.x0 + lx);
      if (claimed[p]) continue;
      pixels.push(p);
    }
  }
  for (const p of pixels) claimed[p] = 1;
  return pixels;
}

/**
 * Full character mask builder: face seeds + back-facing seeds, each grown by
 * local-background dissimilarity and dilated so anti-aliased sprite edges are
 * inside the mask (never outside: parity is computed against this mask).
 */
export function detectCharacterMasks(data, width, height) {
  const context = buildSpriteContext(data, width, height);
  const faceSeeds = detectFaceSeeds(data, width, height);
  const backSeeds = detectBackSeeds(data, width, height, faceSeeds);
  const socialSeeds = detectSocialSeeds(data, width, height, [...faceSeeds, ...backSeeds]);
  const anchorSeeds = manualAnchorSeeds(data, width, height);
  const claimed = new Uint8Array(width * height);
  const masks = [];
  const ordered = [...faceSeeds, ...backSeeds, ...socialSeeds, ...anchorSeeds].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const seed of ordered) {
    let pixels;
    if (seed.boxFill) {
      pixels = [];
      for (const p of seed.pixels) {
        if (claimed[p]) continue;
        claimed[p] = 1;
        pixels.push(p);
      }
    } else {
      pixels = growSeedMask(data, width, height, seed, claimed, context, { strictCore: seed.kind === "social-anchor" });
      // Never let an automatic sprite growth cross into the desk front: the
      // engraved market label lives there and must survive the cleanup.
      const limit = deskClipLimit(seed.x + seed.w / 2, seed.y + seed.h / 2);
      if (Number.isFinite(limit)) pixels = pixels.filter((p) => ((p / width) | 0) <= limit);
    }
    if (pixels.length < 12) continue;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (const p of pixels) {
      const x = p % width;
      const y = (p / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    masks.push({
      kind: seed.kind === "back" ? "character-back"
        : seed.kind === "social" ? "character-social"
          : seed.kind === "social-anchor" ? "character-anchor" : "character",
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      pixels: pixels.length,
      cells: pixels,
      eyes: seed.eyes,
      seedX: seed.x,
      seedY: seed.y,
    });
  }
  // Geometric guarantee: every painted desk agent gets a full box mask even
  // when the color detector cannot separate its face from the wooden desk.
  for (const box of DESK_AGENT_BOXES) {
    const x0 = Math.max(0, box.x);
    const y0 = Math.max(0, box.y);
    const x1 = Math.min(width, box.x + box.w);
    const y1 = Math.min(height, box.y + box.h);
    if (x1 <= x0 || y1 <= y0) continue;
    masks.push({
      kind: "character-desk",
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      pixels: (x1 - x0) * (y1 - y0),
      cells: null,
      eyes: 1,
      seedX: box.agentX,
      seedY: box.y,
      band: box.band,
    });
  }
  return masks;
}

/**
 * Residual verifier for the desk-agent boxes: a face is a compact skin
 * component (light or deep) with at least one embedded dark eye/mouth blob
 * whose surroundings are mostly skin. Runs on the CLEANED pixels — the clean
 * plate must return zero. Exported so tests can hold the regression.
 */
export function scanDeskAgentResiduals(data, width, height, boxes = DESK_AGENT_BOXES) {
  const residuals = [];
  for (const box of boxes) {
    const bw = box.w;
    const bh = box.h;
    const ox = box.x;
    const oy = box.y;
    if (bw <= 0 || bh <= 0) continue;
    const skin = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const i = ((oy + y) * width + (ox + x)) * 4;
        if (skinTone(data[i], data[i + 1], data[i + 2]) || skinDeepTone(data[i], data[i + 1], data[i + 2])) skin[y * bw + x] = 1;
      }
    }
    const label = new Int32Array(bw * bh).fill(-1);
    const comps = [];
    const stack = [];
    for (let start = 0; start < bw * bh; start += 1) {
      if (!skin[start] || label[start] >= 0) continue;
      const id = comps.length;
      let count = 0;
      let minX = bw;
      let maxX = -1;
      let minY = bh;
      let maxY = -1;
      stack.length = 0;
      stack.push(start);
      label[start] = id;
      while (stack.length) {
        const p = stack.pop();
        const x = p % bw;
        const y = (p / bw) | 0;
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
            const q = ny * bw + nx;
            if (skin[q] && label[q] < 0) { label[q] = id; stack.push(q); }
          }
        }
      }
      comps.push({ id, count, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
    for (const comp of comps) {
      if (comp.count < 24 || comp.count > 700 || comp.w < 6 || comp.h < 6 || comp.w > 40 || comp.h > 40) continue;
      const seen = new Set();
      let eyes = 0;
      for (let y = comp.minY; y <= comp.maxY; y += 1) {
        for (let x = comp.minX; x <= comp.maxX; x += 1) {
          const p = y * bw + x;
          if (label[p] >= 0 || seen.has(p)) continue;
          const i = ((oy + y) * width + (ox + x)) * 4;
          if (!eyeTone(data[i], data[i + 1], data[i + 2])) continue;
          let touchesEdge = false;
          let size = 0;
          const blob = [];
          const queue = [p];
          seen.add(p);
          while (queue.length) {
            const v = queue.pop();
            const vx = v % bw;
            const vy = (v / bw) | 0;
            size += 1;
            blob.push(v);
            if (vx === comp.minX || vx === comp.maxX || vy === comp.minY || vy === comp.maxY) touchesEdge = true;
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                if (!dx && !dy) continue;
                const nx = vx + dx;
                const ny = vy + dy;
                if (nx < comp.minX || nx > comp.maxX || ny < comp.minY || ny > comp.maxY) continue;
                const np = ny * bw + nx;
                const ni = ((oy + ny) * width + (ox + nx)) * 4;
                if (!eyeTone(data[ni], data[ni + 1], data[ni + 2]) || label[np] >= 0 || seen.has(np)) continue;
                seen.add(np);
                queue.push(np);
              }
            }
          }
          if (touchesEdge || size > 14) continue;
          const blobSet = new Set(blob);
          let neighbours = 0;
          let skinNeighbours = 0;
          for (const v of blob) {
            const vx = v % bw;
            const vy = (v / bw) | 0;
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                if (!dx && !dy) continue;
                const nx = vx + dx;
                const ny = vy + dy;
                if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
                const np = ny * bw + nx;
                if (blobSet.has(np)) continue;
                neighbours += 1;
                if (skin[np]) skinNeighbours += 1;
              }
            }
          }
          if (neighbours && skinNeighbours / neighbours >= 0.36) eyes += 1;
        }
      }
      if (eyes < 1) continue;
      const pixels = [];
      for (let y = comp.minY; y <= comp.maxY; y += 1) {
        for (let x = comp.minX; x <= comp.maxX; x += 1) {
          const p = y * bw + x;
          if (label[p] === comp.id) pixels.push((oy + y) * width + (ox + x));
        }
      }
      residuals.push({ box: `${box.band ?? "desk"}@${box.agentX ?? box.cx}`, x: ox + comp.minX, y: oy + comp.minY, w: comp.w, h: comp.h, eyes, pixels });
      break;
    }
  }
  return residuals;
}

/** Merges every mask kind into one per-pixel mask, then dilates it by `grow`. */
export function mergeMasks(masks, width, height, grow = 1) {
  const mask = new Uint8Array(width * height);
  for (const entry of masks) {
    const cells = Array.isArray(entry.cells) ? entry.cells
      : (Array.isArray(entry.pixels) ? entry.pixels : null);
    if (cells && cells.length && typeof cells[0] === "number") {
      for (const p of cells) mask[p] = 1;
      continue;
    }
    const x0 = Math.max(0, entry.x);
    const y0 = Math.max(0, entry.y);
    const x1 = Math.min(width, entry.x + entry.w);
    const y1 = Math.min(height, entry.y + entry.h);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) mask[y * width + x] = 1;
    }
  }
  for (let step = 0; step < grow; step += 1) {
    const copy = mask.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (copy[p]) continue;
        if ((x > 0 && copy[p - 1]) || (x < width - 1 && copy[p + 1])
          || (y > 0 && copy[p - width]) || (y < height - 1 && copy[p + width])
          || (x > 0 && y > 0 && copy[p - width - 1]) || (x < width - 1 && y > 0 && copy[p - width + 1])
          || (x > 0 && y < height - 1 && copy[p + width - 1]) || (x < width - 1 && y < height - 1 && copy[p + width + 1])) {
          mask[p] = 1;
        }
      }
    }
  }
  return mask;
}

function insideMask(masks, x, y) {
  for (const mask of masks) {
    if (x >= mask.x && x < mask.x + mask.w && y >= mask.y && y < mask.y + mask.h) return true;
  }
  return false;
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

/* ------------------------------------------------------------- inpainting */

const HORIZONTAL_MAX_SPAN = 96;
const VERTICAL_MAX_SPAN = 72;

function connectedMaskRegions(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const regions = [];
  const stack = [];
  for (let start = 0; start < width * height; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let count = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const cells = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p / width) | 0;
      count += 1;
      cells.push(p);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    regions.push({ count, minX, maxX, minY, maxY, cells });
  }
  return regions;
}

function dominantRegionBackground(data, width, height, region, ring = 4) {
  const counts = new Map();
  for (let y = region.minY - ring; y <= region.maxY + ring; y += 1) {
    for (let x = region.minX - ring; x <= region.maxX + ring; x += 1) {
      const inside = x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
      if (inside) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = (y * width + x) * 4;
      const key = quantKey(data[index], data[index + 1], data[index + 2]);
      const entry = counts.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      entry.r += data[index];
      entry.g += data[index + 1];
      entry.b += data[index + 2];
      entry.n += 1;
      counts.set(key, entry);
    }
  }
  let best = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  if (!best) return { r: 128, g: 128, b: 128 };
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) };
}

/**
 * Push-pull (pyramid) diffusion fill restricted to `cells`: builds a
 * Gaussian-like pyramid where only unmasked pixels are valid, fills masked
 * pixels coarse-to-fine, then writes back with one 3x3 smoothing pass. Used
 * for large mask regions where row/column interpolation would band.
 */
function diffuseRegionFill(data, width, height, mask, cells) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (const p of cells) {
    const x = p % width;
    const y = (p / width) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = 18;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  let w = cw;
  let h = ch;
  let color = new Float32Array(w * h * 3);
  let valid = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = (y0 + y) * width + (x0 + x);
      const i = p * 4;
      const q = y * w + x;
      color[q * 3] = data[i];
      color[q * 3 + 1] = data[i + 1];
      color[q * 3 + 2] = data[i + 2];
      valid[q] = mask[p] ? 0 : 1;
    }
  }
  const levels = [{ w, h, color, valid }];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, (w + 1) >> 1);
    const nh = Math.max(1, (h + 1) >> 1);
    const ncolor = new Float32Array(nw * nh * 3);
    const nvalid = new Uint8Array(nw * nh);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const q = y * w + x;
        if (!valid[q]) continue;
        const nq = (y >> 1) * nw + (x >> 1);
        ncolor[nq * 3] += color[q * 3];
        ncolor[nq * 3 + 1] += color[q * 3 + 1];
        ncolor[nq * 3 + 2] += color[q * 3 + 2];
        nvalid[nq] += 1;
      }
    }
    for (let q = 0; q < nw * nh; q += 1) {
      if (!nvalid[q]) continue;
      ncolor[q * 3] /= nvalid[q];
      ncolor[q * 3 + 1] /= nvalid[q];
      ncolor[q * 3 + 2] /= nvalid[q];
      nvalid[q] = 1;
    }
    levels.push({ w: nw, h: nh, color: ncolor, valid: nvalid });
    w = nw;
    h = nh;
    color = ncolor;
    valid = nvalid;
  }
  const top = levels[levels.length - 1];
  for (let q = 0; q < top.w * top.h; q += 1) {
    if (top.valid[q]) continue;
    top.color[q * 3] = 128;
    top.color[q * 3 + 1] = 128;
    top.color[q * 3 + 2] = 128;
    top.valid[q] = 1;
  }
  for (let level = levels.length - 2; level >= 0; level -= 1) {
    const fine = levels[level];
    const coarse = levels[level + 1];
    for (let y = 0; y < fine.h; y += 1) {
      for (let x = 0; x < fine.w; x += 1) {
        const q = y * fine.w + x;
        if (fine.valid[q]) continue;
        const fx = Math.max(0, Math.min(coarse.w - 1, (x + 0.5) / 2 - 0.5));
        const fy = Math.max(0, Math.min(coarse.h - 1, (y + 0.5) / 2 - 0.5));
        const cx0 = Math.floor(fx);
        const cy0 = Math.floor(fy);
        const cx1 = Math.min(coarse.w - 1, cx0 + 1);
        const cy1 = Math.min(coarse.h - 1, cy0 + 1);
        const tx = fx - cx0;
        const ty = fy - cy0;
        for (let c = 0; c < 3; c += 1) {
          const v00 = coarse.color[(cy0 * coarse.w + cx0) * 3 + c];
          const v10 = coarse.color[(cy0 * coarse.w + cx1) * 3 + c];
          const v01 = coarse.color[(cy1 * coarse.w + cx0) * 3 + c];
          const v11 = coarse.color[(cy1 * coarse.w + cx1) * 3 + c];
          const value = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
          fine.color[q * 3 + c] = value;
        }
        fine.valid[q] = 1;
      }
    }
  }
  const base = levels[0];
  const fitted = new Float32Array(cells.length * 3);
  cells.forEach((p, index) => {
    const x = p % width;
    const y = (p / width) | 0;
    const q = (y - y0) * cw + (x - x0);
    fitted[index * 3] = base.color[q * 3];
    fitted[index * 3 + 1] = base.color[q * 3 + 1];
    fitted[index * 3 + 2] = base.color[q * 3 + 2];
  });
  // write fitted values, then one 3x3 smoothing pass inside the region
  const snapshot = new Map();
  cells.forEach((p, index) => {
    const i = p * 4;
    const value = [
      Math.round(fitted[index * 3]),
      Math.round(fitted[index * 3 + 1]),
      Math.round(fitted[index * 3 + 2]),
    ];
    snapshot.set(p, value);
    data[i] = value[0];
    data[i + 1] = value[1];
    data[i + 2] = value[2];
  });
  for (const p of cells) {
    const x = p % width;
    const y = (p / width) | 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        let value = snapshot.get(np);
        if (!value) {
          const ni = np * 4;
          value = [data[ni], data[ni + 1], data[ni + 2]];
        }
        r += value[0];
        g += value[1];
        b += value[2];
        n += 1;
      }
    }
    if (!n) continue;
    const i = p * 4;
    data[i] = Math.round(r / n);
    data[i + 1] = Math.round(g / n);
    data[i + 2] = Math.round(b / n);
  }
  return cells.length;
}

function directionalSample(data, width, height, mask, x, y, horizontalMax, verticalMax) {
  let leftX = -1;
  for (let lx = x - 1; lx >= 0 && x - lx <= horizontalMax; lx -= 1) {
    if (!mask[y * width + lx]) { leftX = lx; break; }
  }
  let rightX = -1;
  for (let rx = x + 1; rx < width && rx - x <= horizontalMax; rx += 1) {
    if (!mask[y * width + rx]) { rightX = rx; break; }
  }
  if (leftX >= 0 && rightX >= 0) {
    const span = rightX - leftX;
    const t = span > 0 ? (x - leftX) / span : 0.5;
    const li = (y * width + leftX) * 4;
    const ri = (y * width + rightX) * 4;
    return {
      r: data[li] * (1 - t) + data[ri] * t,
      g: data[li + 1] * (1 - t) + data[ri + 1] * t,
      b: data[li + 2] * (1 - t) + data[ri + 2] * t,
    };
  }
  let upY = -1;
  for (let uy = y - 1; uy >= 0 && y - uy <= verticalMax; uy -= 1) {
    if (!mask[uy * width + x]) { upY = uy; break; }
  }
  let downY = -1;
  for (let dy = y + 1; dy < height && dy - y <= verticalMax; dy += 1) {
    if (!mask[dy * width + x]) { downY = dy; break; }
  }
  if (upY >= 0 && downY >= 0) {
    const span = downY - upY;
    const t = span > 0 ? (y - upY) / span : 0.5;
    const ui = (upY * width + x) * 4;
    const di = (downY * width + x) * 4;
    return {
      r: data[ui] * (1 - t) + data[di] * t,
      g: data[ui + 1] * (1 - t) + data[di + 1] * t,
      b: data[ui + 2] * (1 - t) + data[di + 2] * t,
    };
  }
  return null;
}

/** Chebyshev distance (in px, capped) from each masked cell to the nearest unmasked pixel. */
function maskEdgeDistance(mask, width, height, cells, cap = 12) {
  const dist = new Int16Array(cells.length).fill(cap + 1);
  const queue = [];
  const indexOf = new Map();
  cells.forEach((p, i) => indexOf.set(p, i));
  for (let i = 0; i < cells.length; i += 1) {
    const p = cells[i];
    const x = p % width;
    const y = (p / width) | 0;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!mask[ny * width + nx]) { edge = true; break; }
      }
    }
    if (edge) { dist[i] = 1; queue.push(p); }
  }
  let head = 0;
  while (head < queue.length) {
    const p = queue[head];
    head += 1;
    const i = indexOf.get(p);
    const d = dist[i];
    if (d >= cap) continue;
    const x = p % width;
    const y = (p / width) | 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        if (!mask[np]) continue;
        const ni = indexOf.get(np);
        if (ni === undefined || dist[ni] <= d + 1) continue;
        dist[ni] = d + 1;
        queue.push(np);
      }
    }
  }
  return dist;
}

/**
 * Inpaints a per-pixel mask:
 *   1. horizontal interpolation between the nearest unmasked pixels on the row
 *      (when both exist within the span limit);
 *   2. vertical interpolation between the nearest unmasked pixels above/below;
 *   3. the dominant local background color sampled from a ring around the
 *      connected mask region.
 * Large connected regions (wide/tall or pixel-heavy) use pyramid diffusion
 * instead, because row interpolation bands across them. No blur, no rectangle:
 * every filled pixel comes from surrounding real pixels.
 */
export function inpaintMaskPixels(data, width, height, mask, options = {}) {
  const horizontalMax = options.horizontalMax ?? HORIZONTAL_MAX_SPAN;
  const verticalMax = options.verticalMax ?? VERTICAL_MAX_SPAN;
  const regions = connectedMaskRegions(mask, width, height);
  const stats = { horizontal: 0, vertical: 0, background: 0, diffuse: 0 };
  for (const region of regions) {
    const regionW = region.maxX - region.minX + 1;
    const regionH = region.maxY - region.minY + 1;
    const useDiffuse = options.forceDiffuse
      || region.count >= 900 || regionW >= 44 || regionH >= 56;
    if (useDiffuse) {
      const cells = region.cells;
      const directional = new Float32Array(cells.length * 3);
      const hasDirectional = new Uint8Array(cells.length);
      cells.forEach((p, i) => {
        const sample = directionalSample(data, width, height, mask, p % width, (p / width) | 0, horizontalMax, verticalMax);
        if (!sample) return;
        directional[i * 3] = sample.r;
        directional[i * 3 + 1] = sample.g;
        directional[i * 3 + 2] = sample.b;
        hasDirectional[i] = 1;
      });
      const edgeDistance = maskEdgeDistance(mask, width, height, cells, 12);
      stats.diffuse += diffuseRegionFill(data, width, height, mask, cells);
      // near the border keep the directional sample (crisp, aligned with the
      // neighbouring art); the interior uses the smooth pyramid fill
      const blendSpan = 10;
      cells.forEach((p, i) => {
        if (!hasDirectional[i]) return;
        const weight = Math.min(1, edgeDistance[i] / blendSpan);
        const index = p * 4;
        data[index] = Math.round(directional[i * 3] * (1 - weight) + data[index] * weight);
        data[index + 1] = Math.round(directional[i * 3 + 1] * (1 - weight) + data[index + 1] * weight);
        data[index + 2] = Math.round(directional[i * 3 + 2] * (1 - weight) + data[index + 2] * weight);
      });
      continue;
    }
    const background = dominantRegionBackground(data, width, height, region, options.ring ?? 4);
    const cells = region.cells.slice().sort((a, b) => a - b);
    for (const p of cells) {
      const x = p % width;
      const y = (p / width) | 0;
      const index = p * 4;
      let leftX = -1;
      for (let lx = x - 1; lx >= 0 && x - lx <= horizontalMax; lx -= 1) {
        if (!mask[y * width + lx]) { leftX = lx; break; }
      }
      let rightX = -1;
      for (let rx = x + 1; rx < width && rx - x <= horizontalMax; rx += 1) {
        if (!mask[y * width + rx]) { rightX = rx; break; }
      }
      if (leftX >= 0 && rightX >= 0) {
        const span = rightX - leftX;
        const t = span > 0 ? (x - leftX) / span : 0.5;
        const li = (y * width + leftX) * 4;
        const ri = (y * width + rightX) * 4;
        data[index] = Math.round(data[li] * (1 - t) + data[ri] * t);
        data[index + 1] = Math.round(data[li + 1] * (1 - t) + data[ri + 1] * t);
        data[index + 2] = Math.round(data[li + 2] * (1 - t) + data[ri + 2] * t);
        stats.horizontal += 1;
        continue;
      }
      let upY = -1;
      for (let uy = y - 1; uy >= 0 && y - uy <= verticalMax; uy -= 1) {
        if (!mask[uy * width + x]) { upY = uy; break; }
      }
      let downY = -1;
      for (let dy2 = y + 1; dy2 < height && dy2 - y <= verticalMax; dy2 += 1) {
        if (!mask[dy2 * width + x]) { downY = dy2; break; }
      }
      if (upY >= 0 && downY >= 0) {
        const span = downY - upY;
        const t = span > 0 ? (y - upY) / span : 0.5;
        const ui = (upY * width + x) * 4;
        const di = (downY * width + x) * 4;
        data[index] = Math.round(data[ui] * (1 - t) + data[di] * t);
        data[index + 1] = Math.round(data[ui + 1] * (1 - t) + data[di + 1] * t);
        data[index + 2] = Math.round(data[ui + 2] * (1 - t) + data[di + 2] * t);
        stats.vertical += 1;
        continue;
      }
      data[index] = background.r;
      data[index + 1] = background.g;
      data[index + 2] = background.b;
      stats.background += 1;
    }
  }
  return stats;
}

/**
 * Legacy-compatible inpaint entry: works with mask rectangles (badge masks).
 * Converts them to a pixel mask and delegates to `inpaintMaskPixels`.
 */
export function inpaintMasks(data, width, height, masks) {
  const mask = new Uint8Array(width * height);
  for (const entry of masks) {
    const cells = Array.isArray(entry.cells) ? entry.cells
      : (Array.isArray(entry.pixels) ? entry.pixels : null);
    if (cells && cells.length && typeof cells[0] === "number") {
      for (const p of cells) mask[p] = 1;
      continue;
    }
    const x0 = Math.max(0, entry.x);
    const y0 = Math.max(0, entry.y);
    const x1 = Math.min(width, entry.x + entry.w);
    const y1 = Math.min(height, entry.y + entry.h);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) mask[y * width + x] = 1;
    }
  }
  return inpaintMaskPixels(data, width, height, mask);
}

/* ------------------------------------------------------------- verification */

/** Count badge-colored pixels inside masks (strict + relaxed). */
export function scanMaskBadgePixels(data, width, height, masks, classify = badgeColorClass) {
  const result = { strict: 0, relaxed: 0, fringe: 0 };
  for (const mask of masks) {
    const x0 = Math.max(0, mask.x ?? 0);
    const y0 = Math.max(0, mask.y ?? 0);
    const pixelSet = Array.isArray(mask.cells) ? mask.cells
      : (Array.isArray(mask.pixels) ? mask.pixels : null);
    const x1 = pixelSet ? width : Math.min(width, (mask.x ?? 0) + (mask.w ?? 0));
    const y1 = pixelSet ? height : Math.min(height, (mask.y ?? 0) + (mask.h ?? 0));
    if (pixelSet) {
      for (const p of pixelSet) {
        const index = p * 4;
        if (classify(data[index], data[index + 1], data[index + 2])) result.strict += 1;
        if (fringeColorClass(data[index], data[index + 1], data[index + 2])) result.fringe += 1;
      }
      continue;
    }
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * width + x) * 4;
        if (classify(data[index], data[index + 1], data[index + 2])) result.strict += 1;
        if (fringeColorClass(data[index], data[index + 1], data[index + 2])) result.fringe += 1;
      }
    }
  }
  result.relaxed = result.fringe;
  return result;
}

/**
 * Character-signature verifier: runs the detector on arbitrary pixel data and
 * returns the residual seeds found. On the clean plate this must be empty.
 */
export function scanCharacterClusters(data, width, height) {
  const faces = detectFaceSeeds(data, width, height);
  const backs = detectBackSeeds(data, width, height, faces);
  const social = detectSocialSeeds(data, width, height, [...faces, ...backs]);
  return { faces: faces.length, backs: backs.length, social: social.length, seeds: [...faces, ...backs, ...social] };
}

/* -------------------------------------------------------------- clean plate */

/**
 * Full deterministic pipeline from RGBA pixels: detects painted badges and
 * painted characters, inpaints them, and returns the cleaned pixels plus the
 * honest metrics. Pure function, no I/O â€” used by tests for determinism.
 */
export function buildCleanPlate(originalData, width = CLEAN_PLATE_WIDTH, height = CLEAN_PLATE_HEIGHT) {
  const data = new Uint8ClampedArray(originalData.length);
  data.set(originalData);
  const badges = detectBadgeMasks(data, width, height);
  const characters = detectCharacterMasks(data, width, height);
  const masks = [...characters, ...badges];
  const pixelMask = mergeMasks(masks, width, height, 1);
  // grow mask rectangles for outside-parity reporting (they are the declared masks)
  const declared = [];
  for (const mask of masks) {
    if (mask.kind === "badge") {
      declared.push({ x: Math.max(0, mask.x - 1), y: Math.max(0, mask.y - 1), w: Math.min(width, mask.x + mask.w + 1) - Math.max(0, mask.x - 1), h: Math.min(height, mask.y + mask.h + 1) - Math.max(0, mask.y - 1), kind: "badge" });
    } else {
      declared.push({ x: Math.max(0, mask.x - 1), y: Math.max(0, mask.y - 1), w: Math.min(width, mask.x + mask.w + 1) - Math.max(0, mask.x - 1), h: Math.min(height, mask.y + mask.h + 1) - Math.max(0, mask.y - 1), kind: mask.kind });
    }
  }
  const badgeBefore = scanMaskBadgePixels(data, width, height, badges);
  const characterBefore = scanCharacterClusters(data, width, height);
  const inpaintStats = inpaintMaskPixels(data, width, height, pixelMask);
  // Residual cleanup: inpainting can leave face-like texture where a sprite
  // was (e.g. between two adjacent chair masks). Detect it on the cleaned
  // pixels and diffuse-repair those spots; their bboxes join the declared
  // masks so the outside-parity metric stays exact. Bounded to 2 passes.
  let characterAfter = scanCharacterClusters(data, width, height);
  let deskAfter = scanDeskAgentResiduals(data, width, height);
  let residualPasses = 0;
  while ((characterAfter.faces + characterAfter.backs + characterAfter.social) > 0 || deskAfter.length > 0) {
    if (residualPasses >= 2) break;
    const residualMask = new Uint8Array(width * height);
    for (const seed of characterAfter.seeds) {
      for (const p of seed.pixels) residualMask[p] = 1;
    }
    for (const residual of deskAfter) {
      for (const p of residual.pixels) residualMask[p] = 1;
    }
    const copy = residualMask.slice();
    let rMinX = width;
    let rMaxX = -1;
    let rMinY = height;
    let rMaxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        const near = (x > 0 && copy[p - 1]) || (x < width - 1 && copy[p + 1])
          || (y > 0 && copy[p - width]) || (y < height - 1 && copy[p + width]);
        if (!copy[p] && !near) continue;
        residualMask[p] = 1;
        if (x < rMinX) rMinX = x;
        if (x > rMaxX) rMaxX = x;
        if (y < rMinY) rMinY = y;
        if (y > rMaxY) rMaxY = y;
      }
    }
    const extra = inpaintMaskPixels(data, width, height, residualMask, { forceDiffuse: true });
    inpaintStats.horizontal += extra.horizontal;
    inpaintStats.vertical += extra.vertical;
    inpaintStats.background += extra.background;
    inpaintStats.diffuse += extra.diffuse;
    residualPasses += 1;
    if (rMaxX >= 0) {
      declared.push({
        x: Math.max(0, rMinX - 1),
        y: Math.max(0, rMinY - 1),
        w: Math.min(width, rMaxX + 2) - Math.max(0, rMinX - 1),
        h: Math.min(height, rMaxY + 2) - Math.max(0, rMinY - 1),
        kind: "residual",
      });
    }
    characterAfter = scanCharacterClusters(data, width, height);
    deskAfter = scanDeskAgentResiduals(data, width, height);
  }
  inpaintStats.residualPasses = residualPasses;
  const badgeAfter = scanMaskBadgePixels(data, width, height, badges);
  const parity = outsideMaskDiff(originalData, data, width, height, declared);
  return {
    data,
    badges,
    characters,
    masks: declared,
    pixelMask,
    badgeBefore,
    badgeAfter,
    characterBefore,
    characterAfter,
    deskAfter,
    parity,
    inpaintStats,
  };
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

/** Difficulty score per mask region (honest "reconstruction imperfect" signal). */
function maskDifficulty(data, width, height, mask) {
  const x0 = Math.max(0, mask.x - 3);
  const y0 = Math.max(0, mask.y - 3);
  const x1 = Math.min(width, mask.x + mask.w + 3);
  const y1 = Math.min(height, mask.y + mask.h + 3);
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const inside = x >= mask.x && x < mask.x + mask.w && y >= mask.y && y < mask.y + mask.h;
      if (inside) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = (y * width + x) * 4;
      const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      n += 1;
      sum += luma;
      sumSq += luma * luma;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/** Builds the before/after review strip with the cleaned regions highlighted. */
function buildStrip(module, originalCanvas, cleanedCanvas, masks, highlights) {
  const scale = 0.5;
  const width = Math.round(CLEAN_PLATE_WIDTH * scale);
  const height = Math.round(CLEAN_PLATE_HEIGHT * scale);
  const labelW = 92;
  const gap = 8;
  const pads = 24;
  const stripH = pads + height + gap + height + pads;
  const strip = module.createCanvas(labelW + width + pads, stripH);
  const ctx = strip.getContext("2d");
  ctx.fillStyle = "#0b0f16";
  ctx.fillRect(0, 0, strip.width, strip.height);
  ctx.imageSmoothingEnabled = false;
  const draw = (canvas, y, label, color) => {
    ctx.drawImage(canvas, 0, 0, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, labelW, y, width, height);
    ctx.fillStyle = color;
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(label, 8, y + 16);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#8fa3bf";
    ctx.fillText(`${CLEAN_PLATE_WIDTH}x${CLEAN_PLATE_HEIGHT}`, 8, y + 34);
  };
  draw(originalCanvas, pads, "ANTES", "#f0b429");
  draw(cleanedCanvas, pads + height + gap, "DEPOIS", "#3ddc84");
  ctx.lineWidth = 2;
  for (const mask of masks) {
    ctx.strokeStyle = mask.kind === "badge" ? "rgba(240,180,41,0.9)" : "rgba(255,60,120,0.9)";
    for (const y of [pads, pads + height + gap]) {
      ctx.strokeRect(labelW + (mask.x - 1) * scale, y + (mask.y - 1) * scale, (mask.w + 2) * scale, (mask.h + 2) * scale);
    }
  }
  // difficulty call-outs: top imperfect rebuilds get coordinates on the DEPOIS row
  ctx.font = "10px sans-serif";
  for (const entry of highlights) {
    const y = pads + height + gap + (entry.y - 1) * scale;
    ctx.fillStyle = "#ff5c8a";
    ctx.fillText(`~${entry.x},${entry.y}`, labelW + entry.x * scale + 3, Math.max(pads + height + gap + 8, y - 2));
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
  const originalCopy = new Uint8ClampedArray(original.data);

  const result = buildCleanPlate(original.data, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  const cleaned = ctx.createImageData(CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  cleaned.data.set(result.data);

  const cleanCanvas = module.createCanvas(CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT);
  cleanCanvas.getContext("2d").putImageData(cleaned, 0, 0);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, cleanCanvas.toBuffer("image/png"));

  const sortedMasks = [...result.characters].sort((a, b) => b.pixels - a.pixels);
  const scores = sortedMasks.map((mask) => ({ mask, score: maskDifficulty(originalCopy, CLEAN_PLATE_WIDTH, CLEAN_PLATE_HEIGHT, mask) }));
  const highlights = scores.filter((entry) => entry.score >= 42).slice(0, 24).map(({ mask, score }) => ({ x: mask.x, y: mask.y, w: mask.w, h: mask.h, score: Number(score.toFixed(1)), kind: mask.kind }));

  const strip = buildStrip(module, canvas, cleanCanvas, result.masks, highlights);
  mkdirSync(dirname(stripPath), { recursive: true });
  writeFileSync(stripPath, strip.toBuffer("image/png"));

  const totalPixels = CLEAN_PLATE_WIDTH * CLEAN_PLATE_HEIGHT;
  const skipped = badgeWindows().filter((window) => window.skipped).map((window) => `${window.band}@y=${window.bandY}`);
  const badgePixelsRemoved = Math.max(0, result.badgeBefore.strict - result.badgeAfter.strict);
  const summary = {
    source,
    output,
    strip: stripPath,
    badgeMasks: result.badges.length,
    characterMasks: result.characters.length,
    faceSeeds: result.characterBefore.faces,
    backSeeds: result.characterBefore.backs,
    socialSeeds: result.characterBefore.social,
    anchorSeeds: MANUAL_ANCHORS.length,
    preservedObjects: PRESERVE_REGIONS.length,
    badgePixelsRemoved,
    characterPixelsRemoved: result.parity.changed,
    remainingStrictBadges: result.badgeAfter.strict,
    remainingFringeBadges: result.badgeAfter.fringe,
    remainingCharacterSeeds: result.characterAfter.faces + result.characterAfter.backs + result.characterAfter.social,
    remainingDeskResiduals: result.deskAfter.length,
    deskAgentBoxes: DESK_AGENT_BOXES.length,
    outsideMaskChanged: result.parity.outside,
    changedPixels: result.parity.changed,
    changedPct: Number(((result.parity.changed / totalPixels) * 100).toFixed(4)),
    inpaintStats: result.inpaintStats,
    highlights,
    skipped,
    regions: result.parity.regions.map((region) => ({ ...region, outsidePct: Number(((region.outside / totalPixels) * 100).toFixed(4)) })),
  };
  console.log(`[clean-plate] fonte ${source}`);
  console.log(`[clean-plate] badges=${result.badges.length} (${badgePixelsRemoved} px removidos); characters=${result.characters.length} mascaras (${DESK_AGENT_BOXES.length} baias geometricas de desk); seeds face=${result.characterBefore.faces} back=${result.characterBefore.backs} social=${result.characterBefore.social} anchors=${MANUAL_ANCHORS.length}`);
  console.log(`[clean-plate] character pixels removed=${result.parity.changed} (${summary.changedPct}% da imagem); inpaint h=${result.inpaintStats.horizontal} v=${result.inpaintStats.vertical} bg=${result.inpaintStats.background} diffuse=${result.inpaintStats.diffuse} residualPasses=${result.inpaintStats.residualPasses}`);
  console.log(`[clean-plate] objetos preservados: ${PRESERVE_REGIONS.length} regioes (vasos, sofa, abajures, letreiros, teclado)`);
  console.log(`[clean-plate] restantes: badges strict=${result.badgeAfter.strict} fringe=${result.badgeAfter.fringe}; character seeds=${summary.remainingCharacterSeeds}; desk residuals=${summary.remainingDeskResiduals}; fora das mascaras=${result.parity.outside}`);
  for (const region of summary.regions) {
    console.log(`  ${region.region} changed=${region.changed} outside=${region.outside}`);
  }
  if (highlights.length) {
    console.log(`[clean-plate] regioes de reconstrucao dificil (${highlights.length}): ${highlights.slice(0, 10).map((entry) => `${entry.x},${entry.y} s=${entry.score}`).join(" | ")}`);
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
  if (summary.remainingStrictBadges !== 0) process.exitCode = 1;
  if (summary.remainingCharacterSeeds !== 0) process.exitCode = 1;
  if (summary.remainingDeskResiduals !== 0) process.exitCode = 1;
}

export default {
  main,
  buildCleanPlate,
  detectBadgeMasks,
  detectCharacterMasks,
  detectFaceSeeds,
  detectBackSeeds,
  inpaintMasks,
  inpaintMaskPixels,
  mergeMasks,
  badgeWindows,
  badgeColorClass,
  scanMaskBadgePixels,
  scanCharacterClusters,
  scanDeskAgentResiduals,
  DESK_AGENT_BOXES,
  deskAgentBoxes,
  deskClipLimit,
  detectSocialSeeds,
  manualAnchorSeeds,
  SOCIAL_ZONES,
  PRESERVE_REGIONS,
  MANUAL_ANCHORS,
  outsideMaskDiff,
};
