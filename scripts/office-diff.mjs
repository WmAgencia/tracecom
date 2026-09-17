/**
 * STATIC REBUILD — reference comparison for the office blueprint.
 *
 * If C:/Users/junin/AppData/Local/Temp/opencode/reference.png exists, loads it
 * together with the freshly rendered implementation.png and writes:
 *   docs/office-v2/screenshots/reference.png   (copy of the source reference)
 *   docs/office-v2/screenshots/overlay.png     (50/50 blend)
 *   docs/office-v2/screenshots/difference.png  (amplified per-pixel abs diff)
 *
 * It then prints a global similarity score plus an 8-region mean-diff table.
 * If the reference is missing it prints a clear message and exits 0.
 *
 * Usage: node scripts/office-diff.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const CANVAS_PATH = "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas";
const { createCanvas, loadImage } = require(CANVAS_PATH);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = resolve(repoRoot, "docs/office-v2/screenshots");
mkdirSync(outDir, { recursive: true });

const WIDTH = 1536;
const HEIGHT = 1024;
const REFERENCE = "C:/Users/junin/AppData/Local/Temp/opencode/reference.png";
const IMPLEMENTATION = resolve(outDir, "implementation.png");

const REGIONS = [
  { id: "TOP-LEFT", x: 0, y: 0, w: 524, h: 338 },
  { id: "DAILY-BOARD", x: 524, y: 0, w: 384, h: 240 },
  { id: "TOP-RIGHT", x: 908, y: 0, w: 628, h: 338 },
  { id: "FOREX-MAJORS", x: 0, y: 338, w: 1536, h: 114 },
  { id: "FOREX-CRUZADOS", x: 0, y: 452, w: 1536, h: 118 },
  { id: "OTC+CRYPTO", x: 0, y: 570, w: 1536, h: 118 },
  { id: "INDICES+COMMODITIES", x: 0, y: 688, w: 1536, h: 116 },
  { id: "BOTTOM", x: 0, y: 804, w: 1536, h: 220 },
];

function toCanvas(image) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
  return ctx;
}

if (!existsSync(REFERENCE)) {
  console.log("[diff] reference.png NAO encontrada em:");
  console.log(`[diff]   ${REFERENCE}`);
  console.log("[diff] nada a comparar — implementation.png permanece como unico artefato visual.");
  process.exit(0);
}

if (!existsSync(IMPLEMENTATION)) {
  console.error(`[diff] implementation.png ausente em ${IMPLEMENTATION}. Rode scripts/render-office-v2.mjs antes.`);
  process.exit(1);
}

const referenceImage = await loadImage(REFERENCE);
const implementationImage = await loadImage(IMPLEMENTATION);
const referenceCtx = toCanvas(referenceImage);
const implementationCtx = toCanvas(implementationImage);
const referenceData = referenceCtx.getImageData(0, 0, WIDTH, HEIGHT).data;
const implementationData = implementationCtx.getImageData(0, 0, WIDTH, HEIGHT).data;

copyFileSync(REFERENCE, resolve(outDir, "reference.png"));

const overlay = createCanvas(WIDTH, HEIGHT);
const overlayCtx = overlay.getContext("2d");
overlayCtx.drawImage(referenceImage, 0, 0, WIDTH, HEIGHT);
overlayCtx.globalAlpha = 0.5;
overlayCtx.drawImage(implementationImage, 0, 0, WIDTH, HEIGHT);
overlayCtx.globalAlpha = 1;
writeFileSync(resolve(outDir, "overlay.png"), overlay.toBuffer("image/png"));

const difference = createCanvas(WIDTH, HEIGHT);
const differenceCtx = difference.getContext("2d");
const differenceImage = differenceCtx.createImageData(WIDTH, HEIGHT);
const AMPLIFY = 4;
let totalDiff = 0;
let totalSamples = 0;
const regionStats = new Map(REGIONS.map((region) => [region.id, { sum: 0, count: 0 }]));

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const index = (y * WIDTH + x) * 4;
    const dr = Math.abs(referenceData[index] - implementationData[index]);
    const dg = Math.abs(referenceData[index + 1] - implementationData[index + 1]);
    const db = Math.abs(referenceData[index + 2] - implementationData[index + 2]);
    const diff = (dr + dg + db) / 3;
    totalDiff += diff;
    totalSamples += 1;
    differenceImage.data[index] = Math.min(255, dr * AMPLIFY);
    differenceImage.data[index + 1] = Math.min(255, dg * AMPLIFY);
    differenceImage.data[index + 2] = Math.min(255, db * AMPLIFY);
    differenceImage.data[index + 3] = 255;
    for (const region of REGIONS) {
      if (x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h) {
        const stats = regionStats.get(region.id);
        stats.sum += diff;
        stats.count += 1;
      }
    }
  }
}
differenceCtx.putImageData(differenceImage, 0, 0);
writeFileSync(resolve(outDir, "difference.png"), difference.toBuffer("image/png"));

const meanDiff = totalDiff / totalSamples;
const similarity = Math.max(0, 1 - meanDiff / 255) * 100;

console.log("[diff] reference.png encontrada e copiada.");
console.log(`[diff] similaridade global: ${similarity.toFixed(2)}% (mean abs diff ${meanDiff.toFixed(2)}/255)`);
console.log("[diff] diferenca media por regiao (0 = identico, 255 = oposto):");
const rows = [...regionStats.entries()].map(([id, stats]) => ({
  id,
  mean: stats.count ? stats.sum / stats.count : 0,
}));
const width = Math.max(...rows.map((row) => row.id.length));
console.log(`  ${"REGIAO".padEnd(width)} | MEAN-DIFF | SIMILARIDADE`);
for (const row of rows) {
  const sim = Math.max(0, 1 - row.mean / 255) * 100;
  console.log(`  ${row.id.padEnd(width)} | ${row.mean.toFixed(2).padStart(9)} | ${sim.toFixed(1).padStart(10)}%`);
}
console.log("[diff] wrote reference.png, overlay.png, difference.png");
