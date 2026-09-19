/**
 * OFFICE V3 — VISUAL GAUNTLET REGRESSIONS.
 *
 * One regression per confirmed HIGH/CRITICAL finding fixed in
 * assets.js / world.js / life.js:
 *   - walk cycle actually animates (frame) and the character faces its heading;
 *   - seated "work" pose animates typing;
 *   - the supervisor has a distinct identity;
 *   - the daily board plots the real equity series or an explicit placeholder
 *     (never fabricated data labelled as realtime);
 *   - the desk plaque reaches AA contrast;
 *   - accented PT-BR labels are covered by the bitmap font.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
  throw new Error("office-v3-visual-gauntlet.test: @napi-rs/canvas nao encontrado.");
}

const { createCanvas } = loadCanvas();

// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const assets = (await import("../../src/http/public/office-v3/assets.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const world = (await import("../../src/http/public/office-v3/world.js")) as Record<string, any>;
// @ts-expect-error - office-v3 ESM sem tipagem, importavel sem DOM
const life = (await import("../../src/http/public/office-v3/life.js")) as Record<string, any>;

const { PALETTE_V3, drawCharacter, drawSprite, fontGlyphCoverage } = assets;

function renderCharacter(pose: string, options: Record<string, unknown>, width = 64, height = 64) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  drawCharacter(ctx, pose, Math.round(width / 2), height - 6, options);
  return ctx.getImageData(0, 0, width, height).data;
}

function countDiffering(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let differing = 0;
  for (let index = 0; index < a.length; index += 4) {
    if (a[index] !== b[index] || a[index + 1] !== b[index + 1] || a[index + 2] !== b[index + 2] || a[index + 3] !== b[index + 3]) {
      differing += 1;
    }
  }
  return differing;
}

function relativeLuminance(r: number, g: number, b: number) {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: [number, number, number], background: [number, number, number]) {
  const a = relativeLuminance(...foreground);
  const b = relativeLuminance(...background);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

describe("OFFICE V3 — visual gauntlet regressions", () => {
  it("walk cycle anima as pernas/braços por frame", () => {
    const frame0 = renderCharacter("walk", { seed: 11, role: "trader", frame: 0, facing: 1 });
    const frame2 = renderCharacter("walk", { seed: 11, role: "trader", frame: 2, facing: 1 });
    expect(countDiffering(frame0, frame2)).toBeGreaterThan(10);
  });

  it("facing espelha o personagem na horizontal", () => {
    const right = renderCharacter("walk", { seed: 7, role: "trader", frame: 0, facing: 1 });
    const left = renderCharacter("walk", { seed: 7, role: "trader", frame: 0, facing: -1 });
    expect(countDiffering(right, left)).toBeGreaterThan(10);
  });

  it("postura sentada de trabalho anima a digitacao", () => {
    const frame0 = renderCharacter("work", { seed: 5, role: "trader", frame: 0 });
    const frame1 = renderCharacter("work", { seed: 5, role: "trader", frame: 1 });
    expect(countDiffering(frame0, frame1)).toBeGreaterThan(4);
  });

  it("supervisor tem identidade visual distinta do trader", () => {
    const canvas = createCanvas(64, 64);
    const ctx = canvas.getContext("2d");
    const trader = drawCharacter(ctx, "idle", 16, 50, { seed: 3, role: "trader" });
    const supervisor = drawCharacter(ctx, "idle", 48, 50, { seed: 3, role: "supervisor" });
    expect(supervisor.shirt).toBe(PALETTE_V3.screenWarn);
    expect(supervisor.shirt).not.toBe(trader.shirt);
  });

  it("quadro do dia usa a série real de equity ou placeholder explícito", () => {
    const withSeries = world.dailyBoardModel({
      portfolio: { settled: { wins: 1, losses: 1, pnl: 5, trades: 2 }, equityCurve: [{ value: 1 }, { value: 3 }, { value: 2 }] },
    });
    expect(withSeries.equitySeries).toEqual([1, 3, 2]);
    expect(withSeries.equityPlaceholder).toBe(false);
    const numeric = world.dailyBoardModel({ portfolio: { equityCurve: [10, 12.5, 11] } });
    expect(numeric.equitySeries).toEqual([10, 12.5, 11]);
    const empty = world.dailyBoardModel({ portfolio: { equityCurve: [] } });
    expect(empty.equitySeries).toEqual([]);
    expect(empty.equityPlaceholder).toBe(true);
  });

  it("renderer não rotula dados fabricados como tempo real (canvas -> painel DOM legivel)", () => {
    const root = fileURLToPath(new URL("../../src/http/public/office-v3/", import.meta.url));
    const worldSource = readFileSync(`${root}world.js`, "utf8");
    const resultsSource = readFileSync(`${root}results-panel.js`, "utf8");
    expect(/TEMPO REAL/i.test(worldSource)).toBe(false);
    expect(/OPORTUNIDADES/i.test(worldSource)).toBe(false);
    // O canvas nao desenha mais logs nem os quadros financeiros (T3 movido para DOM).
    expect(worldSource.includes("drawLogsBox")).toBe(false);
    expect(worldSource.includes("drawDailyBoard")).toBe(false);
    expect(resultsSource.includes("RESULTADO DO DIA")).toBe(true);
    expect(resultsSource.includes("SEM SÉRIE DE RESULTADO")).toBe(true);
    expect(resultsSource.includes("SÉRIE REAL")).toBe(true);
  });

  it("placa da mesa atinge contraste AA", () => {
    const canvas = createCanvas(200, 160);
    const ctx = canvas.getContext("2d");
    const result = drawSprite(ctx, "wood_desk", 10, 10, { w: 156, h: 100, depth: 16, plaque: "EUR/USD" });
    const plaque = result?.plaqueRect;
    expect(plaque).toBeTruthy();
    const data = ctx.getImageData(0, 0, 200, 160).data;
    const index = ((plaque.y + 3) * 200 + (plaque.x + 2)) * 4;
    const plate: [number, number, number] = [data[index]!, data[index + 1]!, data[index + 2]!];
    const ink: [number, number, number] = [44, 24, 6];
    expect(contrast(plate, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("cada agente recebe identidade própria ao desenhar (sem clones)", () => {
    const markets = Array.from({ length: 55 }, (_, index) => ({
      marketKey: `MK${index}:NORMAL`,
      symbol: `MK${index}`,
      display: `MK${index}`,
      availability: "OPEN",
      enabled: true,
    }));
    const worldState = world.buildWorldState({ mode: "PRACTICE", markets });
    const system = life.createLifeSystem(worldState, { seed: "identities" });
    const seen: string[] = [];
    const fakeAssets = {
      drawCharacter: (_ctx: unknown, _pose: unknown, _x: unknown, _y: unknown, options: { id?: string }) => {
        seen.push(String(options.id));
        return {};
      },
    };
    life.bindAssets(fakeAssets);
    const canvas = createCanvas(240, 240);
    const drawn = life.drawAgents(canvas.getContext("2d"), system, null);
    life.bindAssets(assets);
    expect(drawn).toBe(110);
    expect(seen).toHaveLength(110);
    expect(new Set(seen).size).toBe(110);
  });

  it("rótulos PT-BR acentuados são cobertos pela fonte", () => {
    const missing = fontGlyphCoverage("OPERAÇÕES HOJE · GANHO LÍQUIDO · PERDA LÍQUIDA · SEM SÉRIE · ÍNDICES");
    expect(missing).toEqual([]);
  });
});
