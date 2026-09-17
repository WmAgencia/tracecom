/**
 * PIXEL OFFICE V2 — BLUEPRINT (static rebuild) tests.
 *
 * Imports the dependency-free ESM module `src/http/public/office-v2-blueprint.js`
 * and renders it with the real @napi-rs/canvas prebuilt package. The module
 * itself never touches the DOM, so it is importable in plain Node.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

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
  throw new Error(
    "office-v2-blueprint.test: @napi-rs/canvas nao encontrado. Instale com `npm i -D @napi-rs/canvas`.",
  );
}

const { createCanvas } = loadCanvas();
// @ts-expect-error - ESM visual module without declarations, importable without a DOM
const blueprint = await import("../../src/http/public/office-v2-blueprint.js");

const {
  BASE_WIDTH,
  BASE_HEIGHT,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  BANDS,
  SECTOR_BANDS,
  SECTOR_RIBBON_LABELS,
  STATION_LAYOUT,
  MASTER_STATION,
  ASSET_KIT,
  ASSET_KIT_NAMES,
  BADGE_COLORS,
  PNL_BADGE_STYLE,
  PANEL_TITLES,
  SUPPORTED_GLYPHS,
  EXPANDED_WORLD_BANDS,
  drawBlueprint,
  drawStation,
  drawMasterStation,
  drawExpandedWorld,
  stationBadgeModel,
  buildStaticBlueprintState,
  measurePixelText,
  drawPixelText,
  drawFontSheet,
  ribbonBannerRect,
  auditPixelText,
  fontGlyphCoverage,
  fontHasGlyph,
  formatBRL,
  signedBRL,
} = blueprint as unknown as Record<string, any>;

function countDistinctColors(ctx: any, width: number, height: number, step = 2) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const seen = new Set<string>();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      seen.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    }
  }
  return seen.size;
}

function countColor(ctx: any, width: number, height: number, hex: string) {
  const target = hex.replace("#", "");
  const tr = parseInt(target.slice(0, 2), 16);
  const tg = parseInt(target.slice(2, 4), 16);
  const tb = parseInt(target.slice(4, 6), 16);
  const data = ctx.getImageData(0, 0, width, height).data;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] === tr && data[index + 1] === tg && data[index + 2] === tb) count += 1;
  }
  return count;
}

describe("BLUEPRINT — constantes do artboard", () => {
  it("expõe o artboard lógico 1536x1024 e o mundo expandido", () => {
    expect(BASE_WIDTH).toBe(1536);
    expect(BASE_HEIGHT).toBe(1024);
    expect(WORLD_WIDTH).toBe(2560);
    expect(WORLD_HEIGHT).toBe(1600);
    expect(WORLD_HEIGHT).toBeGreaterThan(BASE_HEIGHT);
  });

  it("define as 7 bandas macro com os intervalos y exatos do blueprint", () => {
    const ranges = BANDS.map((band: any) => [band.name, band.y1, band.y2]);
    expect(ranges).toEqual([
      ["SUPERIOR", 0, 338],
      ["FOREX MAJORS", 338, 452],
      ["FOREX CRUZADOS", 452, 570],
      ["OTC + CRIPTO", 570, 688],
      ["ÍNDICES + COMMODITIES", 688, 804],
      ["OUTROS ATIVOS", 804, 900],
      ["INFERIOR", 900, 1024],
    ]);
  });
});

describe("BLUEPRINT — fitas de setor", () => {
  it("os 7 rótulos das fitas batem exatamente com o blueprint", () => {
    expect(SECTOR_RIBBON_LABELS).toEqual([
      "FOREX MAJORS",
      "FOREX CRUZADOS",
      "OTC - 24H",
      "CRIPTOMOEDAS",
      "INDICES",
      "COMMODITIES",
      "OUTROS ATIVOS",
    ]);
    expect(new Set(SECTOR_RIBBON_LABELS).size).toBe(7);
    for (const label of SECTOR_RIBBON_LABELS) expect(fontGlyphCoverage(label)).toEqual([]);
  });

  it("mantém as caixas das fitas e acentos (azul/verde) do blueprint", () => {
    const byLabel = Object.fromEntries(SECTOR_BANDS.map((band: any) => [band.label, band]));
    expect(byLabel["FOREX MAJORS"].ribbon).toEqual({ x: 688, y: 340, w: 158, h: 26 });
    expect(byLabel["FOREX CRUZADOS"].ribbon).toEqual({ x: 688, y: 458, w: 158, h: 26 });
    expect(byLabel["OTC - 24H"].ribbon).toEqual({ x: 368, y: 576, w: 188, h: 26 });
    expect(byLabel["CRIPTOMOEDAS"].ribbon).toEqual({ x: 978, y: 576, w: 174, h: 26 });
    expect(byLabel["CRIPTOMOEDAS"].accent).toBe("green");
    expect(byLabel["COMMODITIES"].accent).toBe("green");
    expect(byLabel["OUTROS ATIVOS"].ribbon).toEqual({ x: 688, y: 808, w: 158, h: 26 });
  });
});

describe("BLUEPRINT — layout de estações", () => {
  it("usa as 10 colunas exatas (passo 124, mesa 118)", () => {
    expect(STATION_LAYOUT.columns).toEqual([262, 386, 510, 634, 758, 882, 1006, 1130, 1254, 1378]);
    expect(STATION_LAYOUT.cellWidth).toBe(124);
    expect(STATION_LAYOUT.deskWidth).toBe(118);
  });

  it("gera 55 slots: 50 nas 6 bandas do blueprint + 5 no mundo expandido", () => {
    expect(STATION_LAYOUT.bands).toHaveLength(6);
    expect(STATION_LAYOUT.expandedBands).toHaveLength(1);
    expect(STATION_LAYOUT.slots).toHaveLength(55);
    const perBand = STATION_LAYOUT.slots.reduce((acc: Record<string, number>, slot: any) => {
      acc[slot.band] = (acc[slot.band] ?? 0) + 1;
      return acc;
    }, {});
    expect(perBand).toEqual({
      BAND_FOREX_MAJORS: 10,
      BAND_FOREX_CROSSES: 10,
      BAND_OTC_24H: 5,
      BAND_CRYPTO: 5,
      BAND_INDICES_COMMODITIES: 10,
      BAND_OTHER: 10,
      BAND_OTC_EXTRA: 5,
    });
    const inViewport = STATION_LAYOUT.slots.filter((slot: any) => slot.y < BASE_HEIGHT);
    const expanded = STATION_LAYOUT.slots.filter((slot: any) => slot.y >= BASE_HEIGHT);
    expect(inViewport).toHaveLength(50);
    expect(expanded).toHaveLength(5);
    expect(expanded.every((slot: any) => slot.band === "BAND_OTC_EXTRA")).toBe(true);
    // no desk is ever shrunk to fit: every row keeps the full blueprint scale
    for (const slot of STATION_LAYOUT.slots) expect(slot.h).toBeGreaterThanOrEqual(62);
  });

  it("traz os ativos documentados em cada banda", () => {
    const symbols = STATION_LAYOUT.slots.map((slot: any) => slot.symbol);
    for (const expected of [
      "EUR/USD", "GBP/USD", "USD/JPY", "NZD/USD", "GBP/JPY",
      "AUD/JPY", "CAD/JPY", "EUR/CHF", "GBP/CHF",
      "EUR/USD OTC", "GBP/JPY OTC", "BTC/USD", "ETH/USD", "ADA/USD",
      "S&P 500", "NASDAQ", "DOW JONES", "DAX", "FTSE 100",
      "GOLD", "SILVER", "WTI", "BRENT", "NATGAS",
      "APPLE", "TESLA", "MICROSOFT", "NETFLIX", "PETR4",
    ]) {
      expect(symbols, `ativo ausente: ${expected}`).toContain(expected);
    }
    expect(new Set(symbols).size).toBe(55);
  });

  it("posiciona as mesas exatamente nos centros de coluna", () => {
    const majors = STATION_LAYOUT.slots.filter((slot: any) => slot.band === "BAND_FOREX_MAJORS");
    expect(majors.map((slot: any) => slot.x + slot.w / 2)).toEqual(STATION_LAYOUT.columns);
    for (const slot of STATION_LAYOUT.slots) expect(slot.x + slot.w / 2).toBeLessThanOrEqual(1437);
  });

  it("exporta a estação-mestre EUR/USD na coluna 0", () => {
    expect(MASTER_STATION.symbol).toBe("EUR/USD");
    expect(MASTER_STATION.band).toBe("BAND_FOREX_MAJORS");
    expect(MASTER_STATION.column).toBe(0);
    expect(MASTER_STATION.x + MASTER_STATION.w / 2).toBe(262);
    expect(MASTER_STATION.result).toBe("WIN");
    expect(MASTER_STATION.active).toBe(true);
  });
});

describe("BLUEPRINT — asset kit e modelos de badge", () => {
  it("expõe as 23 funções do asset kit nomeadas no blueprint", () => {
    expect(Object.keys(ASSET_KIT).sort()).toEqual([...ASSET_KIT_NAMES].sort());
    expect(ASSET_KIT_NAMES).toHaveLength(23);
    for (const name of ASSET_KIT_NAMES) expect(typeof ASSET_KIT[name]).toBe("function");
  });

  it("mesa inativa não produz badge (nem no modelo nem no desenho)", () => {
    const inactive = stationBadgeModel({ active: false, result: "WIN", pnl: 12 });
    expect(inactive.visible).toBe(false);
    expect(inactive.tone).toBe("NONE");
    expect(inactive.text).toBe("");
    expect(inactive.color).toBeNull();
  });

  it("mapeia as cores do badge por resultado liquidado", () => {
    expect(stationBadgeModel({ active: true, result: "WIN", pnl: 8.5 }).color).toBe(BADGE_COLORS.WIN);
    expect(stationBadgeModel({ active: true, result: "LOSS", pnl: -10 }).color).toBe(BADGE_COLORS.LOSS);
    expect(stationBadgeModel({ active: true, result: "DRAW", pnl: 0 }).color).toBe(BADGE_COLORS.DRAW);
    expect(BADGE_COLORS.WIN).toBe("#3fbf5f");
    expect(BADGE_COLORS.LOSS).toBe("#e04b3a");
  });

  it("formata o texto do badge (+R$ / −R$ / R$ 0,00)", () => {
    expect(stationBadgeModel({ active: true, result: "WIN", pnl: 8.5 }).text).toBe("+R$ 8,50");
    expect(stationBadgeModel({ active: true, result: "LOSS", pnl: -10 }).text).toBe("−R$ 10,00");
    expect(stationBadgeModel({ active: true, result: "DRAW", pnl: 0 }).text).toBe("R$ 0,00");
    expect(formatBRL(1842.3)).toBe("1.842,30");
    expect(signedBRL(578.76)).toBe("+R$ 578,76");
    expect(signedBRL(-10)).toBe("−R$ 10,00");
  });

  it("o estado estático bate com o quadro do dia do blueprint", () => {
    const state = buildStaticBlueprintState();
    expect(state.daily.pnl).toBe(578.76);
    expect(state.daily.ops).toBe(21);
    expect(state.daily.wins).toBe(16);
    expect(state.daily.losses).toBe(5);
    expect(state.daily.winRate).toBe(76.2);
    expect(state.daily.best).toBe(24.5);
    expect(state.daily.worst).toBe(-10);
    expect(state.daily.weekly).toBe(1842.3);
    expect(state.daily.monthly).toBe(6721.55);
    expect(state.daily.open).toBe(37);
    expect(state.daily.closed).toBe(18);
    expect(state.daily.total).toBe(55);
    expect(state.stations).toHaveLength(55);
    expect(state.stations[0].symbol).toBe("EUR/USD");
  });
});

describe("BLUEPRINT — fonte bitmap interna", () => {
  it("mede o texto de forma monotônica e desenha sem lançar", () => {
    expect(measurePixelText("A", 1)).toBe(5);
    expect(measurePixelText("AB", 1)).toBe(11);
    expect(measurePixelText("AB", 2)).toBe(22);
    expect(measurePixelText("", 1)).toBe(0);
    const canvas = createCanvas(200, 40);
    const ctx = canvas.getContext("2d");
    expect(() => drawPixelText(ctx, "FOREX MAJORS", 2, 2, { scale: 2, color: "#fff" })).not.toThrow();
    expect(() => drawPixelText(ctx, "ÍNDICES · TERRAÇO · ÁREA", 2, 20, { scale: 1, color: "#fff" })).not.toThrow();
    const painted = countColor(ctx, 200, 40, "#ffffff");
    expect(painted).toBeGreaterThan(50);
  });
});

describe("BLUEPRINT — auditoria de glifos e badge de texto", () => {
  it("cobre todos os rótulos de fita e títulos de painel sem fallback", () => {
    for (const label of SECTOR_RIBBON_LABELS) {
      const audit = auditPixelText(label, 2, 1);
      expect(audit.missing, label).toEqual([]);
      expect(audit.ok, label).toBe(true);
      expect(audit.width).toBeGreaterThan(0);
      expect(audit.width).toBe(measurePixelText(label, 2, 1));
    }
    expect(PANEL_TITLES.length).toBeGreaterThan(40);
    for (const title of PANEL_TITLES) {
      expect(fontGlyphCoverage(title), title).toEqual([]);
      expect(auditPixelText(title, 1, 1).width).toBe(measurePixelText(title, 1, 1));
    }
    expect(SUPPORTED_GLYPHS).toContain("$");
    expect(SUPPORTED_GLYPHS).toContain("·");
    expect(fontHasGlyph("A")).toBe(true);
    expect(fontHasGlyph("Í")).toBe(true);
    expect(fontHasGlyph("☃")).toBe(false);
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(SUPPORTED_GLYPHS).toContain(char);
    for (const char of "abcdefghijklmnopqrstuvwxyz") expect(SUPPORTED_GLYPHS).toContain(char);
    for (const char of "0123456789+-.,/$%:·") expect(SUPPORTED_GLYPHS).toContain(char);
  });

  it("cada fita fica no vão acima das mesas (ribbon bottom < desk top)", () => {
    for (const band of SECTOR_BANDS) {
      const rect = ribbonBannerRect(band);
      expect(Number.isFinite(band.deskY), band.label).toBe(true);
      expect(rect.bottom, band.label).toBeLessThan(band.deskY);
      expect(band.deskY - rect.bottom, band.label).toBeGreaterThanOrEqual(4);
      expect(rect.y, band.label).toBeGreaterThanOrEqual(band.ribbon.y);
    }
  });

  it("renderiza a folha de glifos de diagnóstico sem lançar", () => {
    const canvas = createCanvas(900, 400);
    const ctx = canvas.getContext("2d");
    expect(() => drawFontSheet(ctx, { width: 900, height: 400, scale: 4 })).not.toThrow();
    expect(countColor(ctx, 900, 400, "#ffffff")).toBeGreaterThan(500);
    expect(countDistinctColors(ctx, 900, 400, 2)).toBeGreaterThan(4);
  });

  it("o badge de P&L é texto flutuante, nunca uma caixa preenchida", () => {
    expect(PNL_BADGE_STYLE).toBe("text");
    const win = stationBadgeModel({ active: true, result: "WIN", pnl: 8.5 });
    expect(win.filled).toBe(false);
    expect(stationBadgeModel({ active: true, result: "LOSS", pnl: -10 }).filled).toBe(false);
    expect(stationBadgeModel({ active: false, result: "WIN", pnl: 8.5 }).filled).toBe(false);

    const canvas = createCanvas(160, 40);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0d1b2e";
    ctx.fillRect(0, 0, 160, 40);
    const model = blueprint.pnl_badge(ctx, 80, 10, win.text, win.tone, { scale: 2 });
    expect(model.filled).toBe(false);
    expect(countColor(ctx, 160, 40, "#3fbf5f")).toBeGreaterThan(30);
  });

  it("renderiza o mundo expandido com os 5 OTC extras abaixo do viewport", () => {
    expect(EXPANDED_WORLD_BANDS).toHaveLength(1);
    expect(EXPANDED_WORLD_BANDS[0].rows[0].symbols).toEqual([
      "AUD/USD OTC", "USD/CAD OTC", "USD/CHF OTC", "EUR/JPY OTC", "AUD/JPY OTC",
    ]);
    const canvas = createCanvas(900, 200);
    const ctx = canvas.getContext("2d");
    const state = buildStaticBlueprintState();
    expect(() => drawExpandedWorld(ctx, state)).not.toThrow();
  });
});

describe("BLUEPRINT — renderização com canvas real", () => {
  it("drawBlueprint roda sem lançar e produz um canvas não-vazio", () => {
    const canvas = createCanvas(BASE_WIDTH, BASE_HEIGHT);
    const ctx = canvas.getContext("2d");
    expect(() => drawBlueprint(ctx, buildStaticBlueprintState())).not.toThrow();
    const colors = countDistinctColors(ctx, BASE_WIDTH, BASE_HEIGHT, 2);
    expect(colors).toBeGreaterThan(50);
  });

  it("desenha o badge verde apenas na estação ativa", () => {
    const active = createCanvas(140, 100);
    const activeCtx = active.getContext("2d");
    activeCtx.fillStyle = "#0d1b2e";
    activeCtx.fillRect(0, 0, 140, 100);
    drawStation(activeCtx, 6, 22, { symbol: "EUR/USD", result: "WIN", pnl: 8.5, active: true, w: 118, h: 72 });

    const inactive = createCanvas(140, 100);
    const inactiveCtx = inactive.getContext("2d");
    inactiveCtx.fillStyle = "#0d1b2e";
    inactiveCtx.fillRect(0, 0, 140, 100);
    drawStation(inactiveCtx, 6, 22, { symbol: "EUR/USD", result: "WIN", pnl: 8.5, active: false, w: 118, h: 72 });

    expect(countColor(activeCtx, 140, 100, "#3fbf5f")).toBeGreaterThan(30);
    expect(countColor(inactiveCtx, 140, 100, "#3fbf5f")).toBe(0);
  });

  it("renderiza a estação-mestre isolada em 4x sem lançar", () => {
    const canvas = createCanvas(240, 200);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0d1b2e";
    ctx.fillRect(0, 0, 240, 200);
    expect(() => drawMasterStation(ctx, 40, 60, { scale: 1 })).not.toThrow();
    expect(countColor(ctx, 240, 200, "#b07a45")).toBeGreaterThan(200);
  });
});
