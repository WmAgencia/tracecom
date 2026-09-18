/**
 * OFFICE V3 — CLEAN PLATE tests (headless).
 *
 * The default hybrid base is `blueprint-clean.png`: the frozen reference with
 * the painted FALSE P&L badges AND every painted character inpainted out
 * (scripts/office-v3-clean-plate.mjs). The raw reference stays reachable via
 * `?base=original`. Dynamic P&L and dynamic life belong exclusively to
 * overlay.js/life.js, per real station state.
 *
 * The full pixel pipeline is regenerated through a native Node child process
 * (same command operators run), so the suite checks the real CLI: exit code,
 * deterministic bytes and the honest residual report.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders, no stake.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
const {
  badgeWindows,
  detectBadgeMasks,
  scanMaskBadgePixels,
  outsideMaskDiff,
  fringeColorClass,
  detectCharacterMasks,
  scanCharacterClusters,
  scanDeskAgentResiduals,
  DESK_AGENT_BOXES,
  PRESERVE_REGIONS,
  MANUAL_ANCHORS,
} = cleanPlate;

const REFERENCE_PATH = fileURLToPath(new URL("../../src/http/public/office-v3/blueprint-reference.png", import.meta.url));
const CLEAN_PATH = fileURLToPath(new URL("../../src/http/public/office-v3/blueprint-clean.png", import.meta.url));
const STRIP_PATH = fileURLToPath(new URL("../../docs/office-v3/screenshots/clean-plate-v2.png", import.meta.url));
const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/office-v3-clean-plate.mjs", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

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

/** Declared mask rectangles exactly like buildCleanPlate reports them (bbox + 1px). */
function declaredMasks() {
  const characters = detectCharacterMasks(original, BASE_WIDTH, BASE_HEIGHT);
  const badges = detectBadgeMasks(original, BASE_WIDTH, BASE_HEIGHT, windows);
  return [...characters, ...badges].map((mask: any) => {
    const x = Math.max(0, mask.x - 1);
    const y = Math.max(0, mask.y - 1);
    return {
      x,
      y,
      w: Math.min(BASE_WIDTH, mask.x + mask.w + 1) - x,
      h: Math.min(BASE_HEIGHT, mask.y + mask.h + 1) - y,
      kind: mask.kind,
    };
  });
}

function changedPixelsInBox(box: { x: number; y: number; w: number; h: number }, data: Uint8ClampedArray | Uint8Array) {
  let changed = 0;
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const index = (y * BASE_WIDTH + x) * 4;
      if (original[index] !== data[index]
        || original[index + 1] !== data[index + 1]
        || original[index + 2] !== data[index + 2]) changed += 1;
    }
  }
  return changed;
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

  it("fora das máscaras declaradas nada mudou (paridade byte a byte)", () => {
    const parity = outsideMaskDiff(original, cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT, declaredMasks());
    expect(parity.changed).toBeGreaterThan(200000);
    expect(parity.outside).toBe(0);
    for (const region of parity.regions) expect(region.outside).toBe(0);
  });

  it("a paridade fora das máscaras é < 0,1% e a remoção fica abaixo de 20%", () => {
    const parity = outsideMaskDiff(original, cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT, declaredMasks());
    const total = BASE_WIDTH * BASE_HEIGHT;
    expect(parity.outside / total).toBeLessThan(0.001);
    expect(parity.changed / total).toBeGreaterThan(0.1);
    expect(parity.changed / total).toBeLessThan(0.2);
    void fringeColorClass;
  });
});

describe("OFFICE V3 — remoção total dos personagens", () => {
  it("detecta os personagens pintados na referência (faces + sociais + âncoras)", () => {
    const clusters = scanCharacterClusters(original, BASE_WIDTH, BASE_HEIGHT);
    expect(clusters.faces).toBeGreaterThanOrEqual(95);
    expect(clusters.social).toBeGreaterThanOrEqual(15);
    const characterMasks = detectCharacterMasks(original, BASE_WIDTH, BASE_HEIGHT);
    expect(characterMasks.length).toBeGreaterThanOrEqual(120);
    const kinds = new Set(characterMasks.map((mask: any) => mask.kind));
    expect(kinds.has("character")).toBe(true);
    expect(kinds.has("character-social")).toBe(true);
    expect(kinds.has("character-anchor")).toBe(true);
  });

  it("não sobrou nenhum cluster de personagem na base limpa", () => {
    const before = scanCharacterClusters(original, BASE_WIDTH, BASE_HEIGHT);
    const after = scanCharacterClusters(cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT);
    expect(before.faces + before.backs + before.social).toBeGreaterThan(100);
    expect(after.faces).toBe(0);
    expect(after.backs).toBe(0);
    expect(after.social).toBe(0);
  });

  it("nenhum resíduo de agente pintado nas 100 baias dos desks (regressão GHOST_AGENT)", () => {
    expect(DESK_AGENT_BOXES).toHaveLength(100);
    const before = scanDeskAgentResiduals(original, BASE_WIDTH, BASE_HEIGHT);
    const after = scanDeskAgentResiduals(cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT);
    expect(before.length).toBeGreaterThanOrEqual(30);
    expect(after).toEqual([]);
  });

  it("cada baixa de agente é 100% reconstruída e o rótulo da mesa abaixo fica intacto", () => {
    for (const box of DESK_AGENT_BOXES) {
      expect(changedPixelsInBox(box, cleanPlatePixels)).toBeGreaterThanOrEqual(box.w * box.h - 4);
      const labelStrip = { x: box.x, y: box.y + box.h + 3, w: box.w, h: 10 };
      expect(changedPixelsInBox(labelStrip, cleanPlatePixels), `rótulo mexido em ${box.band}@${box.agentX}`).toBe(0);
    }
  });

  it("as âncoras verificadas (café, cozinha, reunião, terraço) foram 100% reconstruídas", () => {
    expect(MANUAL_ANCHORS.length).toBeGreaterThanOrEqual(11);
    for (const anchor of MANUAL_ANCHORS) {
      const changed = changedPixelsInBox(anchor, cleanPlatePixels);
      expect(changed).toBe(anchor.w * anchor.h);
    }
  });

  it("os objetos verificados (sofá, vasos, abajures, janela, teclado) ficaram intactos", () => {
    const intact = [
      [1085, 195], [445, 160], [95, 356], [96, 300], [1385, 353], [1036, 281],
      [556, 931], [133, 800], [366, 976], [483, 981], [709, 942], [853, 918], [472, 80],
    ];
    for (const [x, y] of intact) {
      const region = PRESERVE_REGIONS.find((entry: any) => entry.x === x && entry.y === y);
      expect(region).toBeTruthy();
      expect(changedPixelsInBox(region, cleanPlatePixels)).toBe(0);
    }
  });

  it("o badge continua removido no pipeline completo", () => {
    const check = scanMaskBadgePixels(cleanPlatePixels, BASE_WIDTH, BASE_HEIGHT, masks);
    expect(check.strict).toBe(0);
    expect(check.fringe).toBe(0);
  });

  it("o CLI regenera a base de forma determinística (bytes idênticos, exit 0)", () => {
    const before = readFileSync(CLEAN_PATH);
    const run = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: "utf8", timeout: 240000 });
    expect(run.status).toBe(0);
    const after = readFileSync(CLEAN_PATH);
    expect(after.equals(before)).toBe(true);
  });

  it("o relatório do CLI confirma zero resíduos e uso de difusão", () => {
    const run = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: "utf8", timeout: 240000 });
    expect(run.status).toBe(0);
    const output = `${run.stdout}\n${run.stderr}`;
    const seeds = output.match(/seeds face=(\d+) back=(\d+) social=(\d+) anchors=(\d+)/);
    expect(seeds).toBeTruthy();
    expect(Number(seeds![1])).toBeGreaterThanOrEqual(95);
    expect(Number(seeds![3])).toBeGreaterThanOrEqual(15);
    expect(Number(seeds![4])).toBeGreaterThanOrEqual(11);
    const residual = output.match(/character seeds=(\d+); desk residuals=(\d+); fora das mascaras=(\d+)/);
    expect(residual).toBeTruthy();
    expect(Number(residual![1])).toBe(0);
    expect(Number(residual![2])).toBe(0);
    expect(Number(residual![3])).toBe(0);
    expect(output).toMatch(/badges strict=0 fringe=0/);
    expect(output).toMatch(/\(100 baias geometricas de desk\)/);
    expect(output).toMatch(/diffuse=[1-9]\d{4,}/);
  });

  it("o strip de revisão clean-plate-v2.png existe com as dimensões publicadas", async () => {
    expect(existsSync(STRIP_PATH)).toBe(true);
    const strip = await loadImage(STRIP_PATH);
    expect(strip.width).toBe(884);
    expect(strip.height).toBe(1080);
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
