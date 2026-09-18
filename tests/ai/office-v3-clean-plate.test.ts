/**
 * OFFICE V3 — CLEAN PLATE tests (headless).
 *
 * The default hybrid base is `blueprint-clean.png`: the frozen reference with
 * the painted FALSE P&L badges inpainted out (scripts/office-v3-clean-plate.mjs).
 * The raw reference stays reachable via `?base=original`. Dynamic P&L belongs
 * exclusively to overlay.js, per real station state.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders, no stake.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function loadCanvas() {
  const candidates = [
    "C:/Users/junin/AppData/Local/Temp/opencode/render-kit/node_modules/@napi-rs/canvas",
    "@napi-rs/canvas",
  ];
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("office-v3-clean-plate.test: @napi-rs/canvas nao encontrado.");
}

const { createCanvas, loadImage } = loadCanvas();

// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const baseModule = (await import("../../src/http/public/office-v3/blueprint-base.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const baseModeModule = (await import("../../src/http/public/office-v3/base-mode.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const overlayModule = (await import("../../src/http/public/office-v3/overlay.js")) as Record<string, any>;
// @ts-expect-error - script ESM sem tipagem, importavel sem DOM
const cleanPlate = (await import("../../scripts/office-v3-clean-plate.mjs")) as Record<string, any>;

const {
  BASE_WIDTH,
  BASE_HEIGHT,
  BASE_ASSET,
  ORIGINAL_ASSET,
  assetForBaseMode,
  loadBlueprintBase,
  drawBlueprintBase,
} = baseModule;
const { resolveBaseMode, shouldDrawBlueprintBase } = baseModeModule;
const { ANCHOR_BANDS } = overlayModule;
const { badgeWindows, detectBadgeMasks, inpaintMasks, scanMaskBadgePixels, outsideMaskDiff, fringeColorClass } = cleanPlate;

const REFERENCE_PATH = fileURLToPath(new URL("../../src/http/public/office-v3/blueprint-reference.png", import.meta.url));
const CLEAN_PATH = fileURLToPath(new URL("../../src/http/public/office-v3/blueprint-clean.png", import.meta.url));

async function loadPixels(path: string) {
  const image = await loadImage(path);
  const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
}

function meanAbsDiff(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array) {
  let sum = 0;
  let count = 0;
  for (let index = 0; index < a.length; index += 4) {
    sum += Math.abs(a[index]! - b[index]!) + Math.abs(a[index + 1]! - b[index + 1]!) + Math.abs(a[index + 2]! - b[index + 2]!);
    count += 3;
  }
  return count ? sum / count : 0;
}

const original = await loadPixels(REFERENCE_PATH);
const cleanPlatePixels = await loadPixels(CLEAN_PATH);
const windows = badgeWindows();
const masks = detectBadgeMasks(original, BASE_WIDTH, BASE_HEIGHT, windows);

describe("OFFICE V3 — clean plate asset", () => {
  it("carrega o blueprint-clean.png em 1536x1024", async () => {
    const image = await loadImage(CLEAN_PATH);
    expect(image.width).toBe(BASE_WIDTH);
    expect(image.height).toBe(BASE_HEIGHT);
    expect(BASE_WIDTH).toBe(1536);
    expect(BASE_HEIGHT).toBe(1024);
  });

  it("detecta os 50 badges pintados e ignora a banda expandida fora do artboard", () => {
    expect(masks).toHaveLength(50);
    const expanded = windows.filter((window: any) => window.expanded);
    expect(expanded).toHaveLength(1);
    for (const window of expanded) {
      expect(window.band).toBe("OTC EXTRA");
      expect(window.skipped).toBe(true);
      expect(window.bandY).toBeGreaterThanOrEqual(BASE_HEIGHT);
    }
    const byBand = new Map<string, number>();
    for (const mask of masks) byBand.set(mask.band, (byBand.get(mask.band) ?? 0) + 1);
    expect([...byBand.values()].sort((a, b) => b - a)).toEqual([10, 10, 10, 10, 10]);
  });

  it("as máscaras cobrem só o vão acima de cada mesa, centradas na coluna", () => {
    for (const mask of masks) {
      expect(mask.w).toBeGreaterThanOrEqual(24);
      expect(mask.w).toBeLessThanOrEqual(96);
      expect(mask.h).toBeGreaterThanOrEqual(12);
      expect(mask.h).toBeLessThanOrEqual(32);
      expect(mask.x).toBeGreaterThanOrEqual(0);
      expect(mask.y).toBeGreaterThanOrEqual(0);
      expect(mask.x + mask.w).toBeLessThanOrEqual(BASE_WIDTH);
      expect(mask.y + mask.h).toBeLessThanOrEqual(BASE_HEIGHT);
      const center = mask.x + mask.w / 2;
      expect(Math.abs(center - mask.cx)).toBeLessThanOrEqual(6);
      expect(["green", "red"]).toContain(mask.color);
      const band = ANCHOR_BANDS.find((entry: any) => entry.band === mask.band);
      expect(band).toBeTruthy();
      expect(mask.y).toBeGreaterThan(band.y - 40);
      expect(mask.y + mask.h).toBeLessThanOrEqual(band.y + 2);
    }
  });

  it("a referência bruta ainda contém os badges; o clean plate não contém nenhum", () => {
    const before = scanMaskBadgePixels(original, BASE_WIDTH, BASE_HEIGHT, masks);
    const after = scanMaskBadgePixels(cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT, masks);
    expect(before.strict).toBeGreaterThan(5000);
    expect(after.strict).toBe(0);
    expect(after.fringe).toBe(0);
  });

  it("fora das máscaras nada mudou (paridade byte a byte)", () => {
    const parity = outsideMaskDiff(original, cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT, masks);
    expect(parity.changed).toBeGreaterThan(0);
    expect(parity.outside).toBe(0);
    for (const region of parity.regions) expect(region.outside).toBe(0);
  });

  it("a paridade fora das máscaras é < 1% dos pixels", () => {
    const parity = outsideMaskDiff(original, cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT, masks);
    const total = BASE_WIDTH * BASE_HEIGHT;
    expect(parity.outside / total).toBeLessThan(0.01);
    expect(parity.changed / total).toBeLessThan(0.06);
    void fringeColorClass;
  });

  it("o script reproduz o blueprint-clean.png fielmente (mesmos pixels)", () => {
    const regenerated = new Uint8ClampedArray(original);
    const detected = detectBadgeMasks(regenerated, BASE_WIDTH, BASE_HEIGHT, windows);
    expect(detected).toHaveLength(masks.length);
    inpaintMasks(regenerated, BASE_WIDTH, BASE_HEIGHT, detected);
    let differing = 0;
    for (let index = 0; index < regenerated.length; index += 1) {
      if (regenerated[index] !== cleanPlatePixels[index]) differing += 1;
    }
    expect(differing).toBe(0);
  });
});

describe("OFFICE V3 — base padrão é o clean plate", () => {
  it("loadBlueprintBase() resolve para o clean plate por padrão", async () => {
    expect(BASE_ASSET).toBe("./blueprint-clean.png");
    expect(assetForBaseMode("reference")).toBe(BASE_ASSET);
    const base = await loadBlueprintBase();
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    expect(drawBlueprintBase(ctx, base)).toBe(true);
    const rendered = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
    expect(meanAbsDiff(rendered, cleanPlatePixels)).toBeLessThan(0.5);
    expect(meanAbsDiff(rendered, original)).toBeGreaterThan(0.5);
  });

  it("?base=original resolve e ainda entrega a referência bruta congelada", async () => {
    expect(resolveBaseMode("?base=original", { OFFICE_V3_BASE: "reference" })).toBe("original");
    expect(resolveBaseMode("", { OFFICE_V3_BASE: "original" })).toBe("original");
    expect(shouldDrawBlueprintBase("original")).toBe(true);
    expect(assetForBaseMode("original")).toBe(ORIGINAL_ASSET);
    const base = await loadBlueprintBase(assetForBaseMode("original"));
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    drawBlueprintBase(ctx, base);
    const rendered = ctx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT).data;
    expect(meanAbsDiff(rendered, original)).toBeLessThan(0.5);
  });

  it("?base=procedural segue sem base e o padrão continua 'reference'", () => {
    expect(resolveBaseMode("?base=procedural", {})).toBe("procedural");
    expect(shouldDrawBlueprintBase("procedural")).toBe(false);
    expect(resolveBaseMode("", {})).toBe("reference");
    expect(shouldDrawBlueprintBase(undefined)).toBe(true);
    expect(assetForBaseMode("procedural")).toBe(BASE_ASSET);
  });
});
