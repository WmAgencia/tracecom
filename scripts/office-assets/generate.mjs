#!/usr/bin/env node
/**
 * Gera todos os assets do escritório TraceCom (pixel art original).
 *
 * Uso: node scripts/office-assets/generate.mjs [--out <dir>]
 * Saída padrão: src/http/public/assets/office
 *
 * Nada aqui toca a lógica de trading: são apenas arquivos PNG + JSON.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { savePng } from "./lib/pixel.mjs";
import { buildFontAtlas } from "./lib/font.mjs";
import { AGENT_VARIANTS, buildAgentSheet, agentManifest } from "./lib/agents.mjs";
import { FURNITURE, PROPS, FLOORS, WALLS, DECOR, UI } from "./lib/furniture.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : join(ROOT, "src", "http", "public", "assets", "office");

const counts = { agents: 0, furniture: 0, props: 0, floors: 0, walls: 0, decor: 0, ui: 0 };

function resetDir(path) {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function writeManifest(dir, manifest) {
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function normalize({ id, category, name, source = "tracecom-original", license = "MIT", tags = [], states = ["default"], animations = [], notes = "", role, extra = {} }, built) {
  return {
    id,
    category,
    name,
    source,
    license,
    type: "asset",
    file: `${id}.png`,
    width: built.width,
    height: built.height,
    anchor: built.anchor,
    depthOffset: 0,
    states,
    animations,
    tags,
    ...(role ? { role } : {}),
    ...(built.footprint ? { footprint: built.footprint } : {}),
    ...(built.heightZ !== undefined ? { heightZ: built.heightZ } : {}),
    ...extra,
    notes,
  };
}

function emitGroup(items, category, subdirKey) {
  const paths = [];
  for (const item of items) {
    const built = item.build();
    const dir = join(OUT, subdirKey, item.id);
    mkdirSync(dir, { recursive: true });
    const png = savePng(join(dir, `${item.id}.png`), built.canvas);
    const manifest = normalize({ ...item, category }, built);
    writeManifest(dir, manifest);
    paths.push(`/assets/office/${subdirKey}/${item.id}/manifest.json`);
    counts[category] += 1;
    console.log(`  ${category.padEnd(9)} ${item.id.padEnd(22)} ${String(built.width).padStart(4)}x${String(built.height).padEnd(4)} ${String(png.bytes).padStart(6)} B`);
  }
  return paths;
}

console.log(`TraceCom office assets -> ${OUT}`);
for (const key of Object.keys(counts)) resetDir(join(OUT, key));
mkdirSync(join(OUT, "manifests"), { recursive: true });

/* -------------------------------- agentes -------------------------------- */
console.log("agents:");
const agentPaths = [];
for (const variant of AGENT_VARIANTS) {
  const sheet = buildAgentSheet(variant);
  const dir = join(OUT, "agents", variant.id);
  mkdirSync(dir, { recursive: true });
  const png = savePng(join(dir, "spritesheet.png"), sheet);
  const manifest = { ...agentManifest(variant), type: "spritesheet", file: "spritesheet.png", width: sheet.width, height: sheet.height, tags: ["agent", variant.role], depthOffset: 0, notes: `${variant.name} — arte original TraceCom gerada por scripts/office-assets.` };
  writeManifest(dir, manifest);
  agentPaths.push(`/assets/office/agents/${variant.id}/manifest.json`);
  counts.agents += 1;
  console.log(`  agent     ${variant.id.padEnd(22)} ${String(sheet.width).padStart(4)}x${String(sheet.height).padEnd(4)} ${String(png.bytes).padStart(6)} B`);
}

/* ------------------------------ móveis etc ------------------------------- */
console.log("furniture:");
const furniturePaths = emitGroup(FURNITURE, "furniture", "furniture");
console.log("props:");
const propPaths = emitGroup(PROPS, "props", "props");
console.log("floors:");
const floorPaths = emitGroup(FLOORS, "floors", "floors");
console.log("walls:");
const wallPaths = emitGroup(WALLS, "walls", "walls");
console.log("decor:");
const decorPaths = emitGroup(DECOR, "decor", "decor");
console.log("ui:");
const uiPaths = emitGroup(UI, "ui", "ui");

/* --------------------------------- fonte --------------------------------- */
const font = buildFontAtlas((await import("./lib/pixel.mjs")).PixelCanvas);
const fontDir = join(OUT, "ui", "pixel_font");
mkdirSync(fontDir, { recursive: true });
savePng(join(fontDir, "pixel_font.png"), font.canvas);
writeFileSync(join(fontDir, "manifest.json"), `${JSON.stringify({
  id: "pixel_font",
  category: "ui",
  name: "Fonte Pixel 5x7",
  source: "tracecom-original",
  license: "MIT",
  type: "bitmapfont",
  file: "pixel_font.png",
  width: font.canvas.width,
  height: font.canvas.height,
  cell: { w: font.cellW, h: font.cellH },
  glyphWidth: 5,
  glyphHeight: 7,
  lineHeight: font.lineHeight,
  glyphs: font.glyphs,
  notes: "Fonte desenhada para o escritório. Texto sempre nítido (sem webfont).",
}, null, 2)}\n`, "utf8");
counts.ui += 1;
console.log(`  ui        pixel_font             ${font.canvas.width}x${font.canvas.height}`);

/* --------------------------------- índice -------------------------------- */
const index = {
  version: 1,
  generatedBy: "scripts/office-assets/generate.mjs",
  base: "/assets/office",
  categories: {
    agents: agentPaths,
    furniture: furniturePaths,
    props: propPaths,
    floors: floorPaths,
    walls: wallPaths,
    decor: decorPaths,
    ui: uiPaths,
  },
  font: "/assets/office/ui/pixel_font/manifest.json",
  counts,
};
writeFileSync(join(OUT, "manifests", "office-assets.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
writeFileSync(join(OUT, "manifests", "CREDITS.md"), `# Créditos e Licenças — Assets do Escritório

Todos os sprites desta pasta são **arte original do TraceCom**, gerada de forma
reprodutível por \`scripts/office-assets/generate.mjs\` (MIT, mesma licença do projeto).

Referências visuais/arquiteturais (nenhum arquivo importado):
- [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) — MIT. Referência de
  proporção de personagens, pipeline de manifests e organização de assets.
- [JIK-A-4 · MetroCity (CC0 1.0)](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) — referência
  de linguagem visual "chibi top-down" usada pelo Pixel Agents. Como é CC0, poderia ser importado, mas
  optamos por arte própria isométrica para manter estilo 100% consistente e editável.
- [donarg · Office Interior Tileset](https://donarg.itch.io/officetileset) — citado na documentação do Pixel
  Agents como referência de tileset; não utilizado.

## Como substituir/expandir
1. Coloque um PNG + manifest.json em \`assets/office/<categoria>/<id>/\`.
2. Registre o caminho no índice \`manifests/office-assets.json\` **ou** rode o gerador.
3. O renderer carrega tudo pelo manifest — não é preciso tocar no código de desenho.
`, "utf8");

console.log(`\nOK · ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")} · índice em manifests/office-assets.json`);
