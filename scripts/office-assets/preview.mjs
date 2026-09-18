#!/usr/bin/env node
/**
 * Ferramenta de inspeção visual: empacota os assets gerados em contact sheets
 * ampliadas (nearest-neighbor) para revisão de qualidade.
 *
 * Uso: node scripts/office-assets/preview.mjs [saida.png]
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { PixelCanvas, savePng } from "./lib/pixel.mjs";
import { AGENT_VARIANTS, buildAgentSheet, FRAME_W, FRAME_H } from "./lib/agents.mjs";
import { FURNITURE, PROPS, DECOR } from "./lib/furniture.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "tmp-office-preview.png");

const SCALE = 3;

function scale(src, factor) {
  const out = new PixelCanvas(src.width * factor, src.height * factor);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      if (!src.data[i + 3]) continue;
      out.rect(x * factor, y * factor, factor, factor, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
    }
  }
  return out;
}

/* ---- folha dos agentes: cada variante em uma linha, 12 frames front ---- */
const cellW = FRAME_W * SCALE, cellH = FRAME_H * SCALE;
const agentSheet = new PixelCanvas(12 * cellW + 16, AGENT_VARIANTS.length * cellH + 16, "#1a2030");
AGENT_VARIANTS.forEach((variant, row) => {
  const sheet = buildAgentSheet(variant);
  const frame = new PixelCanvas(FRAME_W, FRAME_H);
  for (let col = 0; col < 12; col++) {
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
      const i = (y * sheet.width + col * FRAME_W + x) * 4;
      const j = (y * FRAME_W + x) * 4;
      frame.data[j] = sheet.data[i]; frame.data[j + 1] = sheet.data[i + 1];
      frame.data[j + 2] = sheet.data[i + 2]; frame.data[j + 3] = sheet.data[i + 3];
    }
    const big = scale(frame, SCALE);
    agentSheet.replaceWith(big, 8 + col * cellW, 8 + row * cellH);
  }
});
savePng(join(ROOT, "tmp-preview-agents-front.png"), agentSheet);

/* ---- folha de poses: um agente com as 3 direções x 12 frames ---- */
const poseVariant = AGENT_VARIANTS.find((v) => v.id === "agent_trader_blue");
const poseSheetSrc = buildAgentSheet(poseVariant);
const poseSheet = new PixelCanvas(12 * cellW + 16, 3 * cellH + 16, "#1a2030");
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 12; col++) {
    const frame = new PixelCanvas(FRAME_W, FRAME_H);
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
      const i = ((row * FRAME_H + y) * poseSheetSrc.width + col * FRAME_W + x) * 4;
      const j = (y * FRAME_W + x) * 4;
      frame.data[j] = poseSheetSrc.data[i]; frame.data[j + 1] = poseSheetSrc.data[i + 1];
      frame.data[j + 2] = poseSheetSrc.data[i + 2]; frame.data[j + 3] = poseSheetSrc.data[i + 3];
    }
    poseSheet.replaceWith(scale(frame, SCALE), 8 + col * cellW, 8 + row * cellH);
  }
}
savePng(join(ROOT, "tmp-preview-agents-poses.png"), poseSheet);

/* ---- folha dos móveis: grade 5 colunas ---- */
const items = [...FURNITURE, ...DECOR, ...PROPS];
const cols = 5;
const maxW = 260, maxH = 150;
const grid = new PixelCanvas(cols * maxW, Math.ceil(items.length / cols) * maxH, "#1a2030");
items.forEach((item, index) => {
  const built = item.build();
  const big = scale(built.canvas, 2);
  const col = index % cols, row = Math.floor(index / cols);
  grid.replaceWith(big, col * maxW + 8, row * maxH + 8);
});
savePng(join(ROOT, "tmp-preview-furniture.png"), grid);

console.log(`preview -> ${OUT}`);
