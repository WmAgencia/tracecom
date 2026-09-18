/**
 * TRACE/COM — PIXEL OFFICE V3 · WORLD
 *
 * Rebuilds the trading office with the V3 asset library: larger scale,
 * identifiable desks, consistent isometric perspective, painter's-algorithm
 * depth (row + column), cast shadows, warm amber lighting and physically
 * recognizable social areas (lounge, pool, café, meeting, research, data).
 *
 * The 55 markets are generated dynamically from `officeJson.markets[]`
 * (marketKey, canonical, symbol, display, activeId, availability, payout,
 * enabled). Each station = ASSET DESK + TRADER + CRITIC with the asset name
 * physically integrated as an engraved plaque.
 *
 * Public contract (frozen — other agents build against this):
 *   BASE_WIDTH=1536, BASE_HEIGHT=1024, WORLD_WIDTH, WORLD_HEIGHT,
 *   STATION_LAYOUT, buildWorldState(officeJson), drawWorld(ctx,worldState,camera),
 *   hitTestStation(worldState, worldX, worldY).
 *
 * Rendering only. PRACTICE only. ZERO REAL.
 */

import {
  PALETTE_V3,
  drawSprite,
  drawTile,
  drawCharacter,
  drawPixelText,
  drawPixelParagraph,
  measurePixelText,
  formatBRL,
  signedBRL,
  hashString,
  createCacheCanvas,
} from "./assets.js";

/* ------------------------------------------------------------------ *
 * 1. CONSTANTS
 * ------------------------------------------------------------------ */

export const BASE_WIDTH = 1536;
export const BASE_HEIGHT = 1024;
export const WORLD_WIDTH = 2560;
export const WORLD_HEIGHT = 2048;

export const OFFICE_V3_VERSION = "office-v3-world.1.0.0";

const COLUMN_COUNT = 11;
// The office is laid out at reference scale inside a 1536x1024 "content" window
// (x 512..2048) so the hero viewport can frame the whole office like the frozen
// blueprint while the logical world stays 2560x2048 for pan/expansion.
export const CONTENT_X = 512;
export const CONTENT_Y = 0;
export const CONTENT_WIDTH = 1536;
export const CONTENT_HEIGHT = 1024;
const COLUMN_STEP = 124;
const COLUMN_MARGIN = (WORLD_WIDTH - COLUMN_STEP * (COLUMN_COUNT - 1)) / 2;
const COLUMNS = Array.from({ length: COLUMN_COUNT }, (_, index) => Math.round(COLUMN_MARGIN + index * COLUMN_STEP));

const DESK_WIDTH = 118;
const DESK_HEIGHT = 72;
const CELL_HEIGHT = 112;
const DESK_TOP_OFFSET = 32;
const BAND_PITCH = 112;
const BAND_START = 368;

export const BANDS = [
  { id: "TOP", label: "SUPERIOR", y1: 0, y2: 362 },
  { id: "BAND_FOREX_MAJORS", label: "FOREX MAJORS", y1: 362, y2: 474 },
  { id: "BAND_FOREX_CROSSES", label: "FOREX CRUZADOS", y1: 474, y2: 586 },
  { id: "BAND_OTC_CRYPTO", label: "OTC - 24H + CRIPTOMOEDAS", y1: 586, y2: 698 },
  { id: "BAND_INDICES_COMMODITIES", label: "ÍNDICES + COMMODITIES", y1: 698, y2: 810 },
  { id: "BAND_OTHER", label: "OUTROS ATIVOS", y1: 810, y2: 900 },
  { id: "BOTTOM", label: "INFERIOR", y1: 900, y2: WORLD_HEIGHT },
];

const BAND_ROWS = [
  { id: "BAND_FOREX_MAJORS", label: "FOREX MAJORS", accent: "blue", deskTop: BAND_START },
  { id: "BAND_FOREX_CROSSES", label: "FOREX CRUZADOS", accent: "blue", deskTop: BAND_START + BAND_PITCH },
  { id: "BAND_OTC_CRYPTO", label: "OTC - 24H + CRIPTOMOEDAS", accent: "split", deskTop: BAND_START + BAND_PITCH * 2 },
  { id: "BAND_INDICES_COMMODITIES", label: "ÍNDICES + COMMODITIES", accent: "split", deskTop: BAND_START + BAND_PITCH * 3 },
  { id: "BAND_OTHER", label: "OUTROS ATIVOS", accent: "blue", deskTop: BAND_START + BAND_PITCH * 4 },
];

const SUB_BAND_BY_ROW = {
  BAND_OTC_CRYPTO: ["OTC - 24H", "CRIPTOMOEDAS"],
  BAND_INDICES_COMMODITIES: ["ÍNDICES", "COMMODITIES"],
};

/* ------------------------------------------------------------------ *
 * 2. STATION LAYOUT — 5 bands x 11 columns = 55 cells
 * ------------------------------------------------------------------ */

function buildCells() {
  const cells = [];
  BAND_ROWS.forEach((row, rowIndex) => {
    for (let col = 0; col < COLUMN_COUNT; col += 1) {
      const centerX = COLUMNS[col];
      const x = Math.round(centerX - DESK_WIDTH / 2);
      const y = row.deskTop - DESK_TOP_OFFSET;
      const split = SUB_BAND_BY_ROW[row.id];
      cells.push({
        index: cells.length,
        band: row.id,
        bandLabel: row.label,
        subBand: split ? (col < 5 ? split[0] : split[1]) : row.label,
        accent: row.accent,
        row: rowIndex,
        col,
        centerX,
        x,
        y,
        w: DESK_WIDTH,
        h: CELL_HEIGHT,
        desk: { x, y: row.deskTop, w: DESK_WIDTH, h: DESK_HEIGHT },
      });
    }
  });
  return cells;
}

export const STATION_LAYOUT = {
  version: "office-v3-layout.1.0.0",
  baseWidth: BASE_WIDTH,
  baseHeight: BASE_HEIGHT,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
  columns: COLUMNS.slice(),
  columnStep: COLUMN_STEP,
  cellWidth: COLUMN_STEP,
  deskWidth: DESK_WIDTH,
  deskHeight: DESK_HEIGHT,
  cellHeight: CELL_HEIGHT,
  bands: BANDS,
  rows: BAND_ROWS,
  cells: buildCells(),
};

/* ------------------------------------------------------------------ *
 * 3. MARKET ACTIVITY
 * ------------------------------------------------------------------ */

export const INACTIVE_AVAILABILITIES = new Set([
  "CLOSED",
  "DISABLED",
  "SUSPENDED",
  "NOT_OFFERED",
  "UNKNOWN",
  "NOT_FOUND",
  "UNAVAILABLE",
  "PAUSED",
]);

export function isMarketActive(market) {
  if (!market || typeof market !== "object") return false;
  if (market.enabled === false) return false;
  if (market.paused === true) return false;
  const availability = String(market.availability ?? "").toUpperCase();
  if (INACTIVE_AVAILABILITIES.has(availability)) return false;
  return availability === "OPEN" || market.enabled === true;
}

function marketBadge(market, active) {
  if (!active) return { visible: false, tone: "NONE", color: null, text: "" };
  const result = String(market?.settlementState?.lastResult ?? "").toUpperCase();
  const profit = Number(market?.settlementState?.lastProfit);
  if (!Number.isFinite(profit)) return { visible: false, tone: "NONE", color: null, text: "" };
  if (result === "WIN") return { visible: true, tone: "POSITIVE", color: PALETTE_V3.green, text: `+R$ ${formatBRL(Math.abs(profit))}` };
  if (result === "LOSS") return { visible: true, tone: "NEGATIVE", color: PALETTE_V3.red, text: `−R$ ${formatBRL(Math.abs(profit))}` };
  if (result === "DRAW") return { visible: true, tone: "ZERO", color: PALETTE_V3.metal, text: "R$ 0,00" };
  return { visible: false, tone: "NONE", color: null, text: "" };
}

/* ------------------------------------------------------------------ *
 * 4. DAILY BOARD MODEL — real data only, "—" when absent
 * ------------------------------------------------------------------ */

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function dailyBoardModel(officeJson = {}) {
  const portfolio = officeJson.portfolio ?? {};
  const settled = portfolio.settled ?? {};
  const wins = Number(settled.wins) || 0;
  const losses = Number(settled.losses) || 0;
  const draws = Number(settled.draws) || 0;
  const trades = Number(settled.trades) || 0;
  const pnl = finiteOrNull(settled.pnl);
  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : null;
  const weekly = finiteOrNull(portfolio.weekly?.pnl);
  const monthly = finiteOrNull(portfolio.monthly?.pnl);
  const equitySeries = (Array.isArray(portfolio.equityCurve) ? portfolio.equityCurve : [])
    .map((point) => {
      if (point && typeof point === "object") return finiteOrNull(point.value ?? point.pnl ?? point.equity ?? point.y);
      return finiteOrNull(point);
    })
    .filter((value) => value !== null);
  const markets = Array.isArray(officeJson.markets) ? officeJson.markets : [];
  const total = markets.length || STATION_LAYOUT.cells.length;
  let open = 0;
  let bestWin = null;
  let bestLoss = null;
  for (const market of markets) {
    if (isMarketActive(market)) open += 1;
    const result = String(market?.settlementState?.lastResult ?? "").toUpperCase();
    const profit = finiteOrNull(market?.settlementState?.lastProfit);
    if (profit === null) continue;
    if (result === "WIN") bestWin = bestWin === null ? profit : Math.max(bestWin, profit);
    if (result === "LOSS") bestLoss = bestLoss === null ? profit : Math.min(bestLoss, profit);
  }
  return {
    pnl,
    wins,
    losses,
    draws,
    trades,
    winRate,
    weekly,
    monthly,
    open,
    closed: Math.max(0, total - open),
    total,
    bestWin,
    bestLoss,
    pnlText: pnl === null ? "—" : signedBRL(pnl),
    winRateText: winRate === null ? "—" : `${(winRate * 100).toFixed(1)}%`,
    weeklyText: weekly === null ? "—" : signedBRL(weekly),
    monthlyText: monthly === null ? "—" : signedBRL(monthly),
    bestWinText: bestWin === null ? "—" : signedBRL(bestWin),
    bestLossText: bestLoss === null ? "—" : signedBRL(bestLoss),
    equitySeries,
    equityPlaceholder: equitySeries.length < 2,
    tone: pnl === null ? "EMPTY" : pnl > 0 ? "POSITIVE" : pnl < 0 ? "NEGATIVE" : "ZERO",
  };
}

/* ------------------------------------------------------------------ *
 * 5. WORLD STATE
 * ------------------------------------------------------------------ */

function marketSymbol(market, index) {
  return String(market?.display || market?.symbol || market?.canonical || market?.marketKey || `RESERVED ${index + 1}`);
}

export function buildWorldState(officeJson = {}) {
  const markets = Array.isArray(officeJson.markets) ? officeJson.markets : [];
  const cells = STATION_LAYOUT.cells;
  const mapped = Math.min(markets.length, cells.length);
  const stations = [];
  for (let index = 0; index < mapped; index += 1) {
    const market = markets[index] ?? {};
    const cell = cells[index];
    const symbol = marketSymbol(market, index);
    const active = isMarketActive(market);
    const trader = { role: "trader", pose: "work", seed: hashString(`${symbol}:trader:${index}`) };
    const critic = { role: "critic", pose: "work", seed: hashString(`${symbol}:critic:${index}`) };
    stations.push({
      index,
      id: symbol,
      marketKey: market.marketKey ?? `${market.canonical ?? "?"}:${market.marketType ?? "NORMAL"}`,
      canonical: market.canonical ?? null,
      symbol: market.symbol ?? symbol,
      display: market.display ?? symbol,
      activeId: market.activeId ?? null,
      availability: market.availability ?? null,
      payout: market.payout ?? null,
      enabled: market.enabled !== false,
      market,
      active,
      cell,
      desk: { ...cell.desk },
      plaque: { text: symbol, engraved: true, model: "engraved" },
      trader: active ? trader : null,
      critic: active ? critic : null,
      agents: active ? [trader, critic] : [],
      badge: marketBadge(market, active),
    });
  }
  const reserved = [];
  for (let index = mapped; index < cells.length; index += 1) {
    const cell = cells[index];
    reserved.push({
      index,
      id: `RESERVED ${index + 1}`,
      marketKey: null,
      active: false,
      reserved: true,
      cell,
      desk: { ...cell.desk },
      plaque: { text: "", engraved: false, model: "none" },
      agents: [],
      badge: { visible: false, tone: "NONE", color: null, text: "" },
    });
  }
  return {
    version: OFFICE_V3_VERSION,
    at: finiteOrNull(officeJson.at) ?? Date.now(),
    mode: officeJson.mode ?? "PRACTICE",
    baseWidth: BASE_WIDTH,
    baseHeight: BASE_HEIGHT,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    layout: STATION_LAYOUT,
    cells,
    stations,
    reserved,
    allStations: stations.concat(reserved),
    board: dailyBoardModel(officeJson),
    amenities: buildAmenities(),
    lighting: buildLighting(),
  };
}

export function stationPlaque(station) {
  return station?.plaque?.text ?? "";
}

/* ------------------------------------------------------------------ *
 * 6. SOCIAL AREAS — amenities
 * ------------------------------------------------------------------ */

function buildAmenities() {
  const items = [];
  const tile = (name, x, y, w, h, opts = {}) => items.push({ kind: "tile", name, x, y, w, h, opts, sortY: y });
  const sprite = (name, x, y, opts = {}, sortY = null) =>
    items.push({ kind: "sprite", name, x, y, opts, sortY: sortY ?? y + (opts.h ?? 40) });
  const actor = (pose, x, y, opts = {}, sortY = null) =>
    items.push({ kind: "character", pose, x, y, opts, sortY: sortY ?? y });

  const X0 = CONTENT_X;
  const X1 = CONTENT_X + CONTENT_WIDTH;

  /* ================= TOP BAND (y 0..362) ================= */
  // warm wood floor is painted by drawFloor() behind the panels and the board
  // the left panel stack (logo/posters/professor) is drawn on the ground layer
  // lounge
  tile("rug_blue", X0 + 248, 224, 240, 116, {});
  sprite("sofa", X0 + 258, 236, { w: 150, h: 42, color: PALETTE_V3.leather, outline: PALETTE_V3.leatherDark, color3: PALETTE_V3.leatherHi });
  sprite("armchair", X0 + 420, 244, { w: 42, h: 40, color: PALETTE_V3.sofa, outline: PALETTE_V3.sofaDark, color3: PALETTE_V3.sofaHi });
  sprite("coffee_table", X0 + 300, 288, { w: 96, h: 22 });
  sprite("plant_large", X0 + 246, 224, {});
  sprite("lamp", X0 + 470, 338, { height: 46, pool: 60, alpha: 0.2 });
  actor("talk", X0 + 292, 264, { seed: hashString("lounge-1"), shirt: "#7a3a4a", role: "trader" });
  actor("coffee", X0 + 386, 270, { seed: hashString("lounge-2"), role: "critic" });

  // pool table
  tile("rug_red", X0 + 498, 224, 214, 116, {});
  sprite("pool_table", X0 + 512, 240, { w: 170, h: 74, frame: "#3a2414", rail: "#5a3a22" });
  sprite("lamp", X0 + 600, 232, { height: 42, pool: 70, alpha: 0.22 });
  sprite("plant_small", X0 + 498, 228, {});
  actor("pool", X0 + 534, 258, { seed: hashString("pool-1"), shirt: "#3a4a7a", role: "trader" });
  actor("pool", X0 + 670, 268, { seed: hashString("pool-2"), role: "critic" });

  // cafe / kitchen
  tile("floor_wood", X0 + 720, 222, 232, 118, { plankH: 16 });
  sprite("kitchen_counter", X0 + 730, 252, { w: 140, h: 46 });
  sprite("fridge", X0 + 882, 232, { w: 38, h: 64 });
  sprite("bookshelf", X0 + 730, 222, { w: 120, h: 36, shelves: 2, seed: 7 });
  actor("coffee", X0 + 770, 302, { seed: hashString("cafe-1"), shirt: "#7a4a2a", role: "trader" });
  actor("talk", X0 + 850, 302, { seed: hashString("cafe-2"), role: "critic" });

  // meeting
  tile("rug_blue", X0 + 964, 252, 228, 88, {});
  sprite("coffee_table", X0 + 1002, 278, { w: 150, h: 26 });
  sprite("armchair", X0 + 972, 256, { w: 40, h: 38 });
  sprite("armchair", X0 + 1140, 256, { w: 40, h: 38 });
  actor("sit", X0 + 1002, 272, { seed: hashString("meet-1"), role: "trader" });
  actor("sit", X0 + 1136, 272, { seed: hashString("meet-2"), role: "critic" });

  // research
  tile("floor_carpet", X0 + 1204, 224, 220, 116, { color: "#1c2c44" });
  sprite("bookshelf", X0 + 1214, 228, { w: 112, h: 92, shelves: 4, seed: 21 });
  sprite("whiteboard", X0 + 1336, 230, { w: 80, h: 50 });
  sprite("research_desk", X0 + 1254, 300, { w: 140, h: 46, plaque: "PESQUISA" });
  sprite("monitor", X0 + 1318, 278, { w: 30, h: 20 });
  actor("work", X0 + 1254, 304, { seed: hashString("res-1"), shirt: "#4a5a86", role: "trader" });
  actor("observe", X0 + 1378, 338, { seed: hashString("res-2"), role: "critic" });

  // data center
  tile("floor_tiles", X0 + 1434, 224, 100, 116, { size: 24 });
  sprite("server_rack", X0 + 1442, 232, { w: 36, h: 80 });
  sprite("server_rack", X0 + 1484, 232, { w: 36, h: 80 });
  actor("observe", X0 + 1500, 338, { seed: hashString("data-1"), role: "critic" });

  /* ================= CORRIDOR DENSITY (gaps between bands) ================= */
  for (let col = 0; col < COLUMN_COUNT; col += 1) {
    const cx = COLUMNS[col];
    for (let row = 0; row < 4; row += 1) {
      const gapY = BAND_START + row * BAND_PITCH - 30;
      if (col % 2 === 0) sprite("plant_small", cx - 24, gapY + 6, {}, gapY + 28);
      else sprite("plant_small", cx + 18, gapY + 6, {}, gapY + 28);
    }
  }
  // side rails of plants + warm lamps so the floor has no empty navy regions
  for (let row = 0; row < 5; row += 1) {
    const y = BAND_START + row * BAND_PITCH;
    sprite("plant_large", X0 + 4, y + 24, {}, y + 84);
    sprite("plant_large", X1 - 22, y + 24, {}, y + 84);
    sprite("lamp", X0 + 28, y + 74, { height: 46, pool: 60, alpha: 0.14 });
    sprite("lamp", X1 - 42, y + 74, { height: 46, pool: 60, alpha: 0.14 });
    sprite("bookshelf", X0 + 4, y + 34, { w: 30, h: 54, shelves: 2, seed: row + 3 }, y + 92);
  }

  /* ================= BOTTOM BAND (y 900..1024) ================= */
  // wood floor is painted by drawFloor(); add the rug + furnishings here
  tile("rug_amber", X0 + 372, 924, 792, 100, {});
  // seating flanking the central TRACE/COM branding (drawn on the ground layer)
  sprite("sofa", X0 + 380, 930, { w: 170, h: 44, color: PALETTE_V3.leather, outline: PALETTE_V3.leatherDark, color3: PALETTE_V3.leatherHi });
  sprite("sofa", X0 + 970, 930, { w: 170, h: 44, color: PALETTE_V3.sofa, outline: PALETTE_V3.sofaDark, color3: PALETTE_V3.sofaHi });
  sprite("coffee_table", X0 + 400, 992, { w: 110, h: 24 });
  sprite("coffee_table", X0 + 1010, 992, { w: 110, h: 24 });
  sprite("armchair", X0 + 300, 966, { w: 44, h: 40 });
  sprite("armchair", X0 + 1150, 966, { w: 44, h: 40 });
  sprite("pool_table", X0 + 270, 936, { w: 150, h: 72 });
  sprite("stairs", X0 + 10, 940, { w: 130, h: 150, direction: "right" }, 1090);
  sprite("stairs", X0 + 1390, 940, { w: 130, h: 150, direction: "left" }, 1090);
  sprite("window", X0 + 150, 910, { w: 110, h: 84 });
  sprite("window", X0 + 1230, 910, { w: 110, h: 84 });
  sprite("plant_large", X0 + 30, 916, {});
  sprite("plant_large", X0 + 1310, 916, {});
  sprite("plant_large", X0 + 240, 1000, {});
  sprite("plant_large", X0 + 1090, 1000, {});
  sprite("lamp", X0 + 290, 1014, { height: 50, pool: 80, alpha: 0.18 });
  sprite("lamp", X0 + 1060, 1014, { height: 50, pool: 80, alpha: 0.18 });
  sprite("poster", X0 + 60, 916, { w: 40, h: 56, seed: 5 });
  sprite("poster", X0 + 1240, 916, { w: 40, h: 56, seed: 9 });
  actor("talk", X0 + 470, 974, { seed: hashString("ter-1"), shirt: "#3a4a7a", role: "trader" });
  actor("coffee", X0 + 1010, 974, { seed: hashString("ter-2"), role: "critic" });
  actor("pool", X0 + 300, 984, { seed: hashString("ter-3"), shirt: "#7a3a4a", role: "trader" });
  actor("idle", X0 + 1080, 988, { seed: hashString("ter-4"), role: "critic" });

  return items;
}

function buildLighting() {
  const pools = [];
  const cx = CONTENT_X + CONTENT_WIDTH / 2;
  for (let row = 0; row < 5; row += 1) {
    pools.push({ x: cx, y: BAND_START + row * BAND_PITCH + 34, radius: 430, color: PALETTE_V3.amber, alpha: 0.06 });
  }
  pools.push({ x: CONTENT_X + 220, y: 200, radius: 300, color: PALETTE_V3.amber, alpha: 0.09 });
  pools.push({ x: CONTENT_X + 900, y: 230, radius: 320, color: PALETTE_V3.amber, alpha: 0.08 });
  pools.push({ x: CONTENT_X + 1300, y: 200, radius: 300, color: PALETTE_V3.amber, alpha: 0.08 });
  pools.push({ x: cx, y: 980, radius: 460, color: PALETTE_V3.amber, alpha: 0.1 });
  return pools;
}

/* ------------------------------------------------------------------ *
 * 7. HIT TESTING
 * ------------------------------------------------------------------ */

export function hitTestStation(worldState, worldX, worldY) {
  const stations = worldState?.stations ?? [];
  for (const station of stations) {
    const cell = station.cell;
    if (!cell) continue;
    if (worldX >= cell.x && worldX < cell.x + cell.w && worldY >= cell.y && worldY < cell.y + cell.h) return station;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 8. RENDERING
 * ------------------------------------------------------------------ */

function drawCastShadow(ctx, x, y, w, h) {
  pxRectLocal(ctx, x + 6, y + h - 2, w, 4, "rgba(0,0,0,0.34)");
  pxRectLocal(ctx, x + 16, y + h + 2, Math.max(1, w - 32), 2, "rgba(0,0,0,0.18)");
}

function pxRectLocal(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function drawFloor(ctx) {
  drawTile(ctx, "floor_tiles", 0, 0, WORLD_WIDTH, WORLD_HEIGHT, { size: 28 });
  // warm wood across the top social band and the bottom band, navy on the floor
  drawTile(ctx, "floor_wood", CONTENT_X, 0, CONTENT_WIDTH, 362, { plankH: 18 });
  drawTile(ctx, "floor_wood", CONTENT_X, 900, CONTENT_WIDTH, 124, { plankH: 18 });
  warmOverlayLocal(ctx, 0, 0, WORLD_WIDTH, WORLD_HEIGHT, "#f0b429", 0.05);
  warmOverlayLocal(ctx, 0, 362, WORLD_WIDTH, 900 - 362, "#0e2740", 0.24);
  warmOverlayLocal(ctx, 0, 0, WORLD_WIDTH, 362, "#7a4a1e", 0.12);
  warmOverlayLocal(ctx, 0, 900, WORLD_WIDTH, WORLD_HEIGHT - 900, "#7a4a1e", 0.16);
}

function warmOverlayLocal(ctx, x, y, w, h, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

function drawWalls(ctx) {
  drawTile(ctx, "wall_panel", 0, 0, WORLD_WIDTH, 44, { panelW: 56 });
  drawTile(ctx, "wall_brick", 0, 900, WORLD_WIDTH, 16, {});
  for (let x = CONTENT_X + 40; x < CONTENT_X + CONTENT_WIDTH - 30; x += 280) {
    drawSprite(ctx, "wall_sconce", x, 34, { pool: 40, alpha: 0.12 });
  }
}

function drawRibbon(ctx, row) {
  const y = row.deskTop - 42;
  if (row.accent === "split") {
    const parts = SUB_BAND_BY_ROW[row.id] ?? [row.label];
    const leftCenter = (COLUMNS[0] + COLUMNS[4]) / 2;
    const rightCenter = (COLUMNS[5] + COLUMNS[COLUMN_COUNT - 1]) / 2;
    drawRibbonAt(ctx, parts[0], leftCenter, y, PALETTE_V3.bandBlue, PALETTE_V3.bandBlueHi);
    drawRibbonAt(ctx, parts[1] ?? parts[0], rightCenter, y, PALETTE_V3.bandGreen, PALETTE_V3.bandGreenHi);
    return;
  }
  drawRibbonAt(ctx, row.label, Math.round(WORLD_WIDTH / 2), y, PALETTE_V3.bandBlue, PALETTE_V3.bandBlueHi);
}

function drawRibbonAt(ctx, label, centerX, y, accent, accentHi) {
  const w = Math.max(120, measurePixelText(label, 2, 1) + 30);
  const x = Math.round(centerX - w / 2);
  pxRectLocal(ctx, x + 4, y + 4, w, 24, "rgba(0,0,0,0.35)");
  pxRectLocal(ctx, x, y, w, 24, accent);
  pxRectLocal(ctx, x, y, w, 2, accentHi);
  pxRectLocal(ctx, x, y + 22, w, 2, "rgba(0,0,0,0.35)");
  drawPixelText(ctx, label, x + w / 2, y + 6, { scale: 2, align: "center", color: PALETTE_V3.white, shadow: "rgba(0,0,0,0.5)" });
}

function drawLeftPanels(ctx) {
  const x = CONTENT_X + 8;
  const w = 224;
  // "TRADER É UM JOGO DE LONGO PRAZO" poster
  drawPanel(ctx, x, 104, w, 62, "#12233f", PALETTE_V3.gold);
  drawPixelParagraph(ctx, "TRADER É UM JOGO DE LONGO PRAZO", x + w / 2, 114, w - 16, { scale: 1, align: "center", color: PALETTE_V3.goldHi, lineHeight: 11 });
  // "FOCO DISCIPLINA PROCESSO RESULTADO" poster
  drawPanel(ctx, x, 172, w, 62, "#2a1a10", PALETTE_V3.gold);
  drawPixelParagraph(ctx, "FOCO DISCIPLINA PROCESSO RESULTADO", x + w / 2, 182, w - 16, { scale: 1, align: "center", color: "#e8c877", lineHeight: 11 });
  // PROFESSOR & PESQUISA panel
  drawPanel(ctx, x, 240, w, 118, "#0d1b2e", "#2a4a80");
  drawPixelText(ctx, "PROFESSOR", x + 12, 250, { scale: 2, color: "#7ab0e8" });
  drawPixelText(ctx, "& PESQUISA", x + 12, 270, { scale: 1, color: PALETTE_V3.white });
  const labels = ["DADOS", "TESTES", "APRENDIZADO", "EVOLUÇÃO"];
  labels.forEach((label, index) => {
    drawPixelText(ctx, label, x + 12, 292 + index * 14, { scale: 1, color: "#9ab8dc" });
    if (index < labels.length - 1) pxRectLocal(ctx, x + 12, 302 + index * 14, w - 30, 1, "rgba(120,150,200,0.14)");
  });
}

function drawBottomBranding(ctx) {
  const cx = WORLD_WIDTH / 2;
  const w = 360;
  const h = 74;
  const x = Math.round(cx - w / 2);
  const y = 948;
  pxRectLocal(ctx, x - 5, y - 5, w + 10, h + 10, "rgba(0,0,0,0.4)");
  pxRectLocal(ctx, x, y, w, h, "#0d1b2e");
  pxRectLocal(ctx, x, y, w, 3, PALETTE_V3.border);
  pxRectLocal(ctx, x, y + h - 3, w, 3, PALETTE_V3.border);
  pxRectLocal(ctx, x + 3, y + 3, w - 6, 1, "rgba(255,255,255,0.08)");
  drawPixelText(ctx, "TRACE/COM", cx, y + 14, { scale: 4, align: "center", color: PALETTE_V3.white });
  drawPixelText(ctx, "VISION · SHADOW · RESULT", cx, y + 52, { scale: 2, align: "center", color: PALETTE_V3.goldHi });
}

function drawPanel(ctx, x, y, w, h, bg, border) {
  pxRectLocal(ctx, x, y, w, h, PALETTE_V3.woodDark);
  pxRectLocal(ctx, x + 1, y + 1, w - 2, h - 2, border ?? PALETTE_V3.border);
  pxRectLocal(ctx, x + 3, y + 3, w - 6, h - 6, bg);
  pxRectLocal(ctx, x + 3, y + 3, w - 6, 1, "rgba(255,255,255,0.07)");
  pxRectLocal(ctx, x + 3, y + h - 4, w - 6, 1, "rgba(0,0,0,0.4)");
}

function drawBackWallItems(ctx, worldState) {
  const board = worldState.board;
  drawDailyBoard(ctx, board);
  drawMarketsBox(ctx, CONTENT_X + 840, 6, board);
  drawValueBox(ctx, CONTENT_X + 840, 132, 170, 52, "LUCRO SEMANAL", board.weeklyText);
  drawValueBox(ctx, CONTENT_X + 840, 190, 170, 52, "LUCRO MENSAL", board.monthlyText);
  drawGlobalPanel(ctx, CONTENT_X + 1022, 6, 260, 160, worldState);
  drawDisciplinePoster(ctx, CONTENT_X + 1294, 6, 224, 140);
  drawLogo(ctx, CONTENT_X + 10, 12);
}

function drawLogo(ctx, x, y) {
  const w = 234;
  const h = 86;
  drawPanel(ctx, x, y, w, h, "#0a1526", PALETTE_V3.border);
  pxRectLocal(ctx, x + 10, y + 14, 34, 34, PALETTE_V3.goldDark);
  pxRectLocal(ctx, x + 13, y + 17, 28, 28, PALETTE_V3.gold);
  pxRectLocal(ctx, x + 17, y + 21, 20, 20, "#0a1526");
  pxRectLocal(ctx, x + 21, y + 25, 12, 12, PALETTE_V3.gold);
  drawPixelText(ctx, "TRACE/COM", x + 54, y + 14, { scale: 2, color: PALETTE_V3.white });
  drawPixelText(ctx, "DISCIPLINA · DADOS · RESULTADOS", x + 54, y + 38, { scale: 1, color: PALETTE_V3.goldHi });
  drawPixelText(ctx, "PIXEL OFFICE V3", x + 54, y + 52, { scale: 1, color: PALETTE_V3.metal });
}

function drawDailyBoard(ctx, board) {
  const x = CONTENT_X + 248;
  const y = 6;
  const w = 580;
  const h = 214;
  drawPanel(ctx, x, y, w, h, "#0b1728", PALETTE_V3.border);
  pxRectLocal(ctx, x + 6, y + 6, w - 12, 26, PALETTE_V3.panelHeader);
  drawPixelText(ctx, "RESULTADO DO DIA", x + w / 2, y + 10, { scale: 3, align: "center", color: PALETTE_V3.white });

  const positive = board.tone === "POSITIVE";
  const negative = board.tone === "NEGATIVE";
  const color = positive ? PALETTE_V3.green : negative ? PALETTE_V3.red : PALETTE_V3.metal;
  drawPixelText(ctx, board.pnlText, x + w / 2, y + 28, { scale: 8, align: "center", color, shadow: "rgba(0,0,0,0.6)" });
  drawPixelText(ctx, positive ? "GANHO LÍQUIDO HOJE" : negative ? "PERDA LÍQUIDA HOJE" : "SEM RESULTADO LIQUIDADO", x + w / 2, y + 100, {
    scale: 2,
    align: "center",
    color: PALETTE_V3.metal,
  });

  const metrics = [
    ["OPERAÇÕES HOJE", String(board.trades)],
    ["WINS", String(board.wins)],
    ["LOSSES", String(board.losses)],
    ["WIN RATE", board.winRateText],
    ["MAIOR WIN", board.bestWinText],
    ["MAIOR LOSS", board.bestLossText],
  ];
  const metricX = x + 16;
  const metricY = y + 120;
  metrics.forEach(([label, value], index) => {
    const rowY = metricY + index * 14;
    drawPixelText(ctx, label, metricX, rowY, { scale: 1, color: PALETTE_V3.metal });
    drawPixelText(ctx, value, metricX + 130, rowY, {
      scale: 1,
      align: "right",
      color: label === "MAIOR WIN" ? PALETTE_V3.green : label === "MAIOR LOSS" ? PALETTE_V3.red : PALETTE_V3.white,
    });
    if (index < metrics.length - 1) pxRectLocal(ctx, metricX, rowY + 11, 130, 1, "rgba(120,150,200,0.14)");
  });

  // equity chart — real settled series only, explicit placeholder when absent
  const chartX = x + 180;
  const chartY = y + 120;
  const chartW = 384;
  const chartH = 84;
  pxRectLocal(ctx, chartX, chartY, chartW, chartH, "#08121f");
  for (let gx = 0; gx <= 4; gx += 1) pxRectLocal(ctx, chartX + (chartW / 4) * gx, chartY, 1, chartH, "rgba(90,130,190,0.16)");
  for (let gy = 0; gy <= 4; gy += 1) pxRectLocal(ctx, chartX, chartY + (chartH / 4) * gy, chartW, 1, "rgba(90,130,190,0.16)");
  if (board.equityPlaceholder) {
    pxRectLocal(ctx, chartX, chartY + Math.round(chartH / 2), chartW, 1, "rgba(120,150,200,0.3)");
    drawPixelText(ctx, "SEM SÉRIE DE RESULTADO", chartX + chartW / 2, chartY + Math.round(chartH / 2) - 4, { scale: 1, align: "center", color: PALETTE_V3.metal });
    drawPixelText(ctx, "EQUITY · SEM DADOS", chartX, chartY - 10, { scale: 1, color: PALETTE_V3.metal });
  } else {
    const series = board.equitySeries;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const lineColor = negative ? PALETTE_V3.red : PALETTE_V3.green;
    let previous = null;
    series.forEach((value, index) => {
      const px = chartX + (chartW / (series.length - 1)) * index;
      const py = chartY + chartH - ((value - min) / span) * (chartH - 6) - 3;
      if (previous) {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
      previous = { x: px, y: py };
    });
    drawPixelText(ctx, "EQUITY · SÉRIE REAL", chartX, chartY - 10, { scale: 1, color: PALETTE_V3.goldHi });
  }
}

function drawMarketsBox(ctx, x, y, board) {
  const w = 170;
  const h = 120;
  drawPanel(ctx, x, y, w, h, "#0b1728", "#2a4a80");
  drawPixelText(ctx, "MERCADOS", x + w / 2, y + 7, { scale: 2, align: "center", color: "#7ab0e8" });
  const rows = [
    ["ABERTOS", String(board.open), PALETTE_V3.white],
    ["FECHADOS", String(board.closed), PALETTE_V3.white],
    ["TOTAL", String(board.total), PALETTE_V3.metalHi],
    ["MODO", "PRACTICE", PALETTE_V3.screenOn],
    ["RISCO", "ZERO REAL", PALETTE_V3.green],
  ];
  rows.forEach(([label, value, color], index) => {
    const rowY = y + 28 + index * 17;
    drawPixelText(ctx, label, x + 12, rowY, { scale: 1, color: "#9ab8dc" });
    drawPixelText(ctx, value, x + w - 12, rowY, { scale: 1, align: "right", color });
    if (index < rows.length - 1) pxRectLocal(ctx, x + 10, rowY + 12, w - 20, 1, "rgba(120,150,200,0.14)");
  });
}

function drawValueBox(ctx, x, y, w, h, title, value) {
  drawPanel(ctx, x, y, w, h, "#0b1728", "#2a4a80");
  drawPixelText(ctx, title, x + w / 2, y + 5, { scale: 2, align: "center", color: "#7ab0e8" });
  drawPixelText(ctx, value, x + w / 2, y + 26, { scale: 2, align: "center", color: value.startsWith("−") ? PALETTE_V3.red : value === "—" ? PALETTE_V3.metal : PALETTE_V3.green });
}

function drawGlobalPanel(ctx, x, y, w, h, worldState) {
  drawPanel(ctx, x, y, w, h, "#101a2b", PALETTE_V3.border);
  drawPixelParagraph(ctx, "MERCADO GLOBAL 24H", x + 12, y + 10, w - 24, { scale: 2, color: "#7ab0e8", lineHeight: 18 });
  drawPixelParagraph(ctx, "MAPA AGREGADO · DADOS REAIS", x + 12, y + 40, w - 24, { scale: 1, color: "#8fb4e0", lineHeight: 11 });
  // simple world map blobs
  const mx = x + 16;
  const my = y + 58;
  const mw = w - 32;
  const mh = h - 78;
  pxRectLocal(ctx, mx, my, mw, mh, "#08131f");
  const blob = (fx, fy, fw, fh) => {
    pxRectLocal(ctx, mx + mw * fx, my + mh * fy, Math.max(3, mw * fw), Math.max(3, mh * fh), "#1d5a9a");
    pxRectLocal(ctx, mx + mw * fx + 1, my + mh * fy + 1, Math.max(2, mw * fw - 2), Math.max(2, mh * fh - 2), "#2f78bc");
  };
  blob(0.08, 0.14, 0.2, 0.28);
  blob(0.24, 0.5, 0.12, 0.34);
  blob(0.44, 0.14, 0.12, 0.18);
  blob(0.46, 0.4, 0.14, 0.4);
  blob(0.6, 0.16, 0.24, 0.26);
  blob(0.78, 0.62, 0.13, 0.16);
  for (const [fx, fy] of [[0.18, 0.3], [0.3, 0.6], [0.5, 0.3], [0.53, 0.55], [0.72, 0.3], [0.84, 0.66]]) {
    pxRectLocal(ctx, mx + mw * fx, my + mh * fy, 3, 3, PALETTE_V3.amber);
  }
  drawPixelText(ctx, `${worldState.stations.length} ATIVOS MONITORADOS`, x + w / 2, y + h - 14, { scale: 1, align: "center", color: PALETTE_V3.goldHi });
}

function drawDisciplinePoster(ctx, x, y, w, h) {
  drawPanel(ctx, x, y, w, h, "#3a2a18", PALETTE_V3.gold);
  drawPixelParagraph(ctx, "DISCIPLINA TRANSFORMA ESTRATEGIA EM LIBERDADE", x + w / 2, y + 16, w - 20, {
    scale: 1,
    align: "center",
    color: PALETTE_V3.goldHi,
    lineHeight: 12,
  });
}

export const DESK_TOP_DEPTH = 18;
export const DESK_SEAT_LINE = DESK_TOP_DEPTH + 7;

function drawStation(ctx, station, showAgents = true) {
  const cell = station.cell;
  const desk = station.desk;
  const cx = cell.centerX;
  const seatLine = desk.y + DESK_SEAT_LINE;
  const active = station.active === true;

  drawCastShadow(ctx, desk.x, desk.y, desk.w, desk.h);

  // desk TOP / back surface first
  drawSprite(ctx, "desk_top", desk.x, desk.y, { w: desk.w, h: desk.h, depth: DESK_TOP_DEPTH });

  // chairs drawn over the top surface so the backrest is visible behind each agent
  if (active) {
    drawSprite(ctx, "chair", cx - 46, seatLine - 30, { w: 30, h: 34 });
    drawSprite(ctx, "chair", cx + 16, seatLine - 30, { w: 30, h: 34 });
  } else {
    drawSprite(ctx, "chair", cx - 16, seatLine - 22, { w: 30, h: 34 });
  }

  // seated agents sit BEHIND the desk, drawn over the top surface
  if (showAgents && active) {
    drawCharacter(ctx, "work", cx - 30, seatLine, { role: "trader", seed: station.trader?.seed, id: `${station.id}:trader` });
    drawCharacter(ctx, "work", cx + 30, seatLine, { role: "critic", seed: station.critic?.seed, id: `${station.id}:critic` });
  }

  // props on the desk top
  if (active) {
    drawSprite(ctx, "monitor", cx - 17, desk.y + 2, { w: 34, h: 22 });
    drawSprite(ctx, "computer_tower", desk.x + 8, desk.y - 30, { w: 20, h: 34 });
    drawSprite(ctx, "keyboard", cx - 19, desk.y + 20, { w: 38, h: 10 });
    lightPoolLocal(ctx, cx, desk.y + 10, 54, PALETTE_V3.screenOn, 0.1);
  } else if (station.reserved) {
    drawSprite(ctx, "keyboard", cx - 19, desk.y + 20, { w: 38, h: 10 });
  }

  // desk FRONT + plaque + legs + shadow occludes the seated agents' lower body
  drawSprite(ctx, "desk_front", desk.x, desk.y, {
    w: desk.w,
    h: desk.h,
    depth: DESK_TOP_DEPTH,
    plaque: active || station.plaque.text ? station.plaque.text : null,
  });

  if (station.badge?.visible) {
    const color = station.badge.color ?? PALETTE_V3.metal;
    drawPixelText(ctx, station.badge.text, cx, desk.y - 20, { scale: 2, align: "center", color, shadow: "rgba(0,0,0,0.7)" });
  }
}

/**
 * Desk fronts to be re-drawn AFTER the dynamic agents (life.js) so the front
 * face, plaque, legs and contact shadow occlude the seated agents' lower body.
 * Returns world-space entries with a painter sort key.
 */
export function collectDeskFronts(worldState, camera = null) {
  const fronts = [];
  const stations = worldState?.allStations ?? [];
  const view = camera ? viewRect(camera) : null;
  for (const station of stations) {
    const desk = station?.desk;
    if (!desk) continue;
    if (view && !intersectsView(view, desk.x - 40, desk.y - 40, desk.w + 80, desk.h + 100, 60)) continue;
    fronts.push({
      x: desk.x,
      y: desk.y,
      w: desk.w,
      h: desk.h,
      depth: DESK_TOP_DEPTH,
      plaque: station.active === true || station.plaque?.text ? station.plaque?.text ?? null : null,
      sortY: desk.y + desk.h,
    });
  }
  return fronts;
}

export function drawDeskFront(ctx, front) {
  if (!front) return;
  drawSprite(ctx, "desk_front", front.x, front.y, { w: front.w, h: front.h, depth: front.depth, plaque: front.plaque });
}


function lightPoolLocal(ctx, x, y, radius, color, alpha) {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(Math.round(x), Math.round(y), 1, Math.round(x), Math.round(y), Math.round(radius));
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.fillRect(Math.round(x - radius), Math.round(y - radius), Math.round(radius * 2), Math.round(radius * 2));
  ctx.restore();
}

function drawAmenity(ctx, item) {
  if (item.kind === "tile") return drawTile(ctx, item.name, item.x, item.y, item.w, item.h, item.opts);
  if (item.kind === "sprite") {
    drawCastShadow(ctx, item.x, item.y, item.opts.w ?? 60, item.opts.h ?? 40);
    return drawSprite(ctx, item.name, item.x, item.y, item.opts);
  }
  if (item.kind === "character") return drawCharacter(ctx, item.pose, item.x, item.y, item.opts);
  return undefined;
}

export function drawWorld(ctx, worldState, camera = {}, options = {}) {
  if (!worldState) return;
  const showAgents = options.agents !== false;
  const zoom = Math.min(4, Math.max(0.2, Number(camera?.zoom) || 1));
  const camX = Number(camera?.x) || 0;
  const camY = Number(camera?.y) || 0;
  const view = viewRect(camera);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(zoom, zoom);
  ctx.translate(-Math.round(camX), -Math.round(camY));

  const ground = ensureGroundLayer(worldState);
  if (ground) {
    blitGround(ctx, ground, view);
  } else {
    drawFloor(ctx);
    drawWalls(ctx);
    drawBackWallItems(ctx, worldState);
    drawLeftPanels(ctx);
    for (const row of BAND_ROWS) drawRibbon(ctx, row);
    const tiles = worldState.amenities.filter((item) => item.kind === "tile");
    for (const item of tiles) {
      renderStats.tilesDrawn += 1;
      drawAmenity(ctx, item);
    }
    drawBottomBranding(ctx);
  }

  // objects sorted with the painter's algorithm (bottom edge, then x)
  const drawables = [];
  let pooled = 0;
  for (const item of worldState.amenities) {
    if (item.kind === "tile") continue;
    if (!amenityVisible(view, item)) {
      renderStats.amenitiesCulled += 1;
      continue;
    }
    renderStats.amenitiesDrawn += 1;
    drawables.push(pooledDrawable(pooled++, item.sortY, item.x, item, "amenity"));
  }
  for (const station of worldState.allStations) {
    const desk = station.desk;
    if (!intersectsView(view, desk.x, desk.y - 90, desk.w, desk.h + 120, 40)) {
      renderStats.stationsCulled += 1;
      continue;
    }
    renderStats.stationsDrawn += 1;
    drawables.push(pooledDrawable(pooled++, desk.y + desk.h, station.cell.x, station, "station"));
  }
  drawables.sort((a, b) => a.sortY - b.sortY || a.sortX - b.sortX);
  for (const entry of drawables) {
    if (entry.type === "station") drawStation(ctx, entry.item, showAgents);
    else drawAmenity(ctx, entry.item);
  }

  for (const pool of worldState.lighting) {
    if (!intersectsView(view, pool.x - pool.radius, pool.y - pool.radius, pool.radius * 2, pool.radius * 2, 0)) continue;
    lightPoolLocal(ctx, pool.x, pool.y, pool.radius, pool.color, pool.alpha);
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * 9. RENDER CACHE + VIEWPORT CULLING
 * ------------------------------------------------------------------ */

const renderStats = {
  stationsDrawn: 0,
  stationsCulled: 0,
  amenitiesDrawn: 0,
  amenitiesCulled: 0,
  tilesDrawn: 0,
  tilesCulled: 0,
  groundBlits: 0,
};

export function getWorldRenderStats() {
  return { ...renderStats };
}

export function resetWorldRenderStats() {
  for (const key of Object.keys(renderStats)) renderStats[key] = 0;
}

let groundLayer = null;
let groundLayerState = null;

export function configureWorldCache() {
  groundLayer = null;
  groundLayerState = null;
}

function buildGroundLayer(worldState) {
  const created = createCacheCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  if (!created) return null;
  const { canvas, context } = created;
  context.imageSmoothingEnabled = false;
  drawFloor(context);
  drawWalls(context);
  drawBackWallItems(context, worldState);
  drawLeftPanels(context);
  for (const row of BAND_ROWS) drawRibbon(context, row);
  for (const item of worldState.amenities) if (item.kind === "tile") drawAmenity(context, item);
  drawBottomBranding(context);
  return canvas;
}

function ensureGroundLayer(worldState) {
  if (groundLayer && groundLayerState === worldState) return groundLayer;
  groundLayer = buildGroundLayer(worldState);
  groundLayerState = worldState;
  return groundLayer;
}

function blitGround(ctx, ground, view) {
  const sx = Math.max(0, Math.floor(view.x));
  const sy = Math.max(0, Math.floor(view.y));
  const ex = Math.min(WORLD_WIDTH, Math.ceil(view.x + view.w));
  const ey = Math.min(WORLD_HEIGHT, Math.ceil(view.y + view.h));
  if (ex <= sx || ey <= sy) return;
  ctx.drawImage(ground, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
  renderStats.groundBlits += 1;
}

function viewRect(camera) {
  const zoom = Math.min(4, Math.max(0.2, Number(camera?.zoom) || 1));
  const width = Number(camera?.viewport?.width) || BASE_WIDTH;
  const height = Number(camera?.viewport?.height) || BASE_HEIGHT;
  return {
    x: Number(camera?.x) || 0,
    y: Number(camera?.y) || 0,
    w: width / zoom,
    h: height / zoom,
  };
}

function intersectsView(view, x, y, w, h, margin) {
  return x < view.x + view.w + margin && x + w > view.x - margin && y < view.y + view.h + margin && y + h > view.y - margin;
}

function amenityVisible(view, item) {
  const w = item.opts?.w ?? 200;
  return intersectsView(view, item.x - 120, item.y - 200, w + 240, 340, 0);
}

const drawablePool = [];

function pooledDrawable(index, sortY, sortX, item, type) {
  let entry = drawablePool[index];
  if (!entry) {
    entry = { sortY: 0, sortX: 0, item: null, type: "" };
    drawablePool[index] = entry;
  }
  entry.sortY = sortY;
  entry.sortX = sortX;
  entry.item = item;
  entry.type = type;
  return entry;
}
