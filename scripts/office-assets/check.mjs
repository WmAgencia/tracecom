#!/usr/bin/env node
/**
 * Valida o pacote de assets do escritório: manifests, campos obrigatórios,
 * arquivos PNG, dimensões reais x manifest, anchors e animações.
 *
 * Uso: node scripts/office-assets/check.mjs
 * Também é usado pelo teste tests/office-assets.test.ts.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = ["id", "category", "name", "source", "license", "file", "width", "height", "anchor"];

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function validateOfficeAssets(root) {
  const errors = [];
  const warnings = [];
  const manifests = [];
  const index = JSON.parse(readFileSync(join(root, "manifests", "office-assets.json"), "utf8"));
  if (!index.categories || typeof index.categories !== "object") errors.push("índice sem categorias");
  for (const [category, paths] of Object.entries(index.categories ?? {})) {
    if (!Array.isArray(paths) || paths.length === 0) errors.push(`categoria vazia: ${category}`);
    for (const path of paths) {
      const file = join(root, path.replace(/^\/assets\/office\//, ""));
      if (!existsSync(file)) { errors.push(`manifest ausente: ${path}`); continue; }
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      manifests.push(manifest);
      for (const field of REQUIRED) if (manifest[field] === undefined || manifest[field] === null) errors.push(`${manifest.id ?? path}: campo obrigatório ausente "${field}"`);
      if (manifest.category !== category) errors.push(`${manifest.id}: categoria "${manifest.category}" difere do índice "${category}"`);

      const dir = join(root, category, manifest.id);
      const pngPath = join(dir, manifest.file);
      if (!existsSync(pngPath)) { errors.push(`${manifest.id}: PNG ausente ${manifest.file}`); continue; }
      const size = pngSize(readFileSync(pngPath));
      if (!size) { errors.push(`${manifest.id}: PNG inválido`); continue; }
      if (size.width !== manifest.width || size.height !== manifest.height) {
        errors.push(`${manifest.id}: dimensões do PNG ${size.width}x${size.height} != manifest ${manifest.width}x${manifest.height}`);
      }
      const anchor = manifest.anchor ?? {};
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) errors.push(`${manifest.id}: anchor inválido`);
      else if (anchor.x < 0 || anchor.y < 0 || anchor.x > manifest.width || anchor.y > manifest.height) errors.push(`${manifest.id}: anchor fora do PNG`);

      if (Array.isArray(manifest.animations) && manifest.animations.length > 0) errors.push(`${manifest.id}: animations deve ser objeto em spritesheets`);
      if (manifest.type === "spritesheet") {
        const { frameWidth, frameHeight, animations, directions, anchor: a } = manifest;
        if (!frameWidth || !frameHeight) errors.push(`${manifest.id}: spritesheet sem frameWidth/frameHeight`);
        if (a.x < 0 || a.x > frameWidth || a.y < 0 || a.y > frameHeight) errors.push(`${manifest.id}: anchor fora do frame`);
        if (!Array.isArray(directions) || directions.length !== manifest.rows) errors.push(`${manifest.id}: directions != rows`);
        for (const [name, anim] of Object.entries(animations ?? {})) {
          if (!Number.isInteger(anim.start) || !Number.isInteger(anim.frames) || anim.start + anim.frames > manifest.columns) {
            errors.push(`${manifest.id}: animação ${name} fora da folha`);
          }
          if (!Number.isFinite(anim.fps) || anim.fps <= 0) warnings.push(`${manifest.id}: animação ${name} sem fps`);
          if (!anim.rows || Object.values(anim.rows).some((row) => row < 0 || row >= manifest.rows)) errors.push(`${manifest.id}: animação ${name} com linhas inválidas`);
        }
      }
      if (manifest.footprint) {
        const { w, d } = manifest.footprint;
        if (!Number.isFinite(w) || !Number.isFinite(d) || w < 0 || d < 0) errors.push(`${manifest.id}: footprint inválido`);
      }
    }
  }
  const ids = manifests.map((manifest) => manifest.id);
  const duplicates = ids.filter((id, index_) => ids.indexOf(id) !== index_);
  if (duplicates.length) errors.push(`ids duplicados: ${[...new Set(duplicates)].join(", ")}`);

  // fonte
  const font = index.font ? JSON.parse(readFileSync(join(root, index.font.replace(/^\/assets\/office\//, "")), "utf8")) : null;
  if (font) {
    const fontPng = join(root, "ui", "pixel_font", font.file);
    if (!existsSync(fontPng)) errors.push("fonte: PNG ausente");
    else {
      const size = pngSize(readFileSync(fontPng));
      if (!size || size.width !== font.width || size.height !== font.height) errors.push("fonte: dimensões divergentes");
    }
    for (const [char, glyph] of Object.entries(font.glyphs ?? {})) {
      if (glyph.x + glyph.w > font.width || glyph.y + glyph.h > font.height) errors.push(`fonte: glifo "${char}" fora do atlas`);
    }
    if (!font.glyphs?.A || !font.glyphs?.["0"]) errors.push("fonte: glifos essenciais ausentes");
  } else warnings.push("índice sem fonte");

  return { errors, warnings, count: manifests.length + (font ? 1 : 0), categories: Object.keys(index.categories ?? {}) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const root = resolve(__dirname, "..", "..", "src", "http", "public", "assets", "office");
  if (!existsSync(root)) {
    console.error(`assets não encontrados em ${root}. Rode: node scripts/office-assets/generate.mjs`);
    process.exit(1);
  }
  const { errors, warnings, count, categories } = validateOfficeAssets(root);
  for (const warning of warnings) console.warn(`aviso: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`erro: ${error}`);
    console.error(`\nFALHOU · ${errors.length} erro(s) em ${count} assets`);
    process.exit(1);
  }
  console.log(`OK · ${count} assets válidos em ${categories.join(", ")}`);
}
