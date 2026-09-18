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
const COLUMN_MARGIN = 180;
const COLUMN_STEP = (WORLD_WIDTH - COLUMN_MARGIN * 2) / (COLUMN_COUNT - 1);
const COLUMNS = Array.from({ length: COLUMN_COUNT }, (_, index) => Math.round(COLUMN_MARGIN + index * COLUMN_STEP));

const DESK_WIDTH = 156;
const DESK_HEIGHT = 100;
const CELL_HEIGHT = 150;
const DESK_TOP_OFFSET = 50;
const BAND_PITCH = 250;
const BAND_START = 540;

export const BANDS = [
  { id: "TOP", label: "SUPERIOR", y1: 0, y2: 490 },
  { id: "BAND_FOREX_MAJORS", label: "FOREX MAJORS", y1: 490, y2: 740 },
  { id: "BAND_FOREX_CROSSES", label: "FOREX CRUZADOS", y1: 740, y2: 990 },
  { id: "BAND_OTC_CRYPTO", label: "OTC - 24H + CRIPTOMOEDAS", y1: 990, y2: 1240 },
  { id: "BAND_INDICES_COMMODITIES", label: "ÍNDICES + COMMODITIES", y1: 1240, y2: 1490 },
  { id: "BAND_OTHER", label: "OUTROS ATIVOS", y1: 1490, y2: 1660 },
  { id: "BOTTOM", label: "INFERIOR", y1: 1660, y2: WORLD_HEIGHT },
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

  // ---- TOP BAND : lounge ----
  tile("rug_cream", 110, 300, 430, 150, {});
  sprite("sofa", 150, 316, { w: 180, h: 46, color: PALETTE_V3.leather, outline: PALETTE_V3.leatherDark, color3: PALETTE_V3.leatherHi });
  sprite("armchair", 360, 330, { w: 48, h: 44, color: PALETTE_V3.sofa, outline: PALETTE_V3.sofaDark, color3: PALETTE_V3.sofaHi });
  sprite("coffee_table", 210, 392, { w: 110, h: 24 });
  sprite("plant_large", 116, 300, {});
  sprite("plant_small", 470, 316, {});
  sprite("lamp", 500, 410, { height: 52, pool: 70, alpha: 0.18 });
  actor("talk", 190, 360, { seed: hashString("lounge-1"), shirt: "#7a3a4a", role: "trader" });
  actor("coffee", 300, 366, { seed: hashString("lounge-2"), role: "critic" });
  actor("idle", 392, 372, { seed: hashString("lounge-3"), shirt: "#2f6a8a", role: "trader" });

  // ---- TOP BAND : pool ----
  tile("rug_red", 560, 300, 350, 150, {});
  sprite("pool_table", 620, 330, { w: 200, h: 92, frame: "#3a2414", rail: "#5a3a22" });
  sprite("lamp", 720, 322, { height: 46, pool: 80, alpha: 0.2 });
  sprite("plant_small", 560, 306, {});
  actor("pool", 596, 356, { seed: hashString("pool-1"), shirt: "#3a4a7a", role: "trader" });
  actor("pool", 860, 372, { seed: hashString("pool-2"), role: "critic" });
  actor("idle", 660, 452, { seed: hashString("pool-3"), shirt: "#3a4a7a", role: "trader" });
  actor("talk", 800, 452, { seed: hashString("pool-4"), role: "critic" });

  // ---- TOP BAND : café / kitchen ----
  tile("floor_wood", 930, 292, 400, 162, { plankH: 16 });
  sprite("kitchen_counter", 960, 348, { w: 150, h: 54 });
  sprite("fridge", 1130, 330, { w: 44, h: 76 });
  sprite("water_cooler", 1190, 350, { w: 26, h: 56 });
  sprite("bookshelf", 960, 296, { w: 120, h: 44, shelves: 2, seed: 7 });
  sprite("poster", 1240, 300, { w: 56, h: 70, seed: 3 });
  sprite("plant_small", 1300, 316, {});
  actor("coffee", 1010, 430, { seed: hashString("cafe-1"), shirt: "#7a4a2a", role: "trader" });
  actor("talk", 1090, 430, { seed: hashString("cafe-2"), role: "critic" });
  actor("coffee", 1180, 436, { seed: hashString("cafe-3"), shirt: "#2f7d4f", role: "trader" });

  // ---- TOP BAND : meeting ----
  tile("rug_blue", 1360, 300, 400, 152, {});
  sprite("coffee_table", 1460, 350, { w: 200, h: 34 });
  sprite("armchair", 1400, 306, { w: 48, h: 44 });
  sprite("armchair", 1660, 306, { w: 48, h: 44 });
  sprite("armchair", 1400, 396, { w: 48, h: 44 });
  sprite("armchair", 1660, 396, { w: 48, h: 44 });
  sprite("whiteboard", 1560, 296, { w: 120, h: 46 });
  actor("sit", 1444, 344, { seed: hashString("meet-1"), role: "trader" });
  actor("sit", 1656, 344, { seed: hashString("meet-2"), role: "critic" });
  actor("talk", 1520, 452, { seed: hashString("meet-3"), shirt: "#3a4a7a", role: "trader" });
  actor("talk", 1600, 452, { seed: hashString("meet-4"), role: "critic" });

  // ---- TOP BAND : research ----
  tile("floor_carpet", 1800, 292, 400, 162, { color: "#1c2c44" });
  sprite("bookshelf", 1820, 300, { w: 150, h: 110, shelves: 4, seed: 21 });
  sprite("whiteboard", 2010, 306, { w: 150, h: 74 });
  sprite("research_desk", 1900, 386, { w: 150, h: 60, plaque: "PESQUISA" });
  sprite("monitor", 1990, 360, { w: 34, h: 24 });
  actor("work", 1900, 396, { seed: hashString("res-1"), shirt: "#4a5a86", role: "trader" });
  actor("observe", 2030, 452, { seed: hashString("res-2"), role: "critic" });
  actor("coffee", 1840, 452, { seed: hashString("res-3"), role: "trader" });

  // ---- TOP BAND : data center ----
  tile("floor_tiles", 2220, 292, 300, 162, { size: 28 });
  sprite("server_rack", 2260, 300, { w: 42, h: 90 });
  sprite("server_rack", 2320, 300, { w: 42, h: 90 });
  sprite("server_rack", 2380, 300, { w: 42, h: 90 });
  sprite("lamp", 2250, 452, { height: 46, pool: 60, alpha: 0.14 });
  actor("observe", 2360, 456, { seed: hashString("data-1"), role: "critic" });

  // ---- corridor greening between bands ----
  for (let col = 0; col < COLUMN_COUNT; col += 2) {
    const x = COLUMNS[col];
    sprite("plant_small", x - 6, 660, {}, 704);
    sprite("plant_small", x - 6, 910, {}, 954);
    sprite("plant_small", x - 6, 1160, {}, 1204);
    sprite("plant_small", x - 6, 1410, {}, 1454);
  }
  sprite("divider", 24, 510, { w: 18, h: 150 }, 670);
  sprite("divider", WORLD_WIDTH - 42, 510, { w: 18, h: 150 }, 670);

  // ---- BOTTOM BAND : terrace lounge ----
  tile("floor_wood", 0, 1660, WORLD_WIDTH, 388, { plankH: 18 });
  tile("rug_amber", 780, 1700, 1000, 250, {});
  sprite("sofa", 860, 1720, { w: 200, h: 50, color: PALETTE_V3.leather, outline: PALETTE_V3.leatherDark, color3: PALETTE_V3.leatherHi });
  sprite("sofa", 1420, 1720, { w: 200, h: 50, color: PALETTE_V3.sofa, outline: PALETTE_V3.sofaDark, color3: PALETTE_V3.sofaHi });
  sprite("armchair", 1120, 1750, { w: 52, h: 48 });
  sprite("armchair", 1320, 1750, { w: 52, h: 48 });
  sprite("coffee_table", 1180, 1810, { w: 180, h: 30 });
  sprite("pool_table", 900, 1840, { w: 180, h: 84 });
  sprite("plant_large", 700, 1710, {});
  sprite("plant_large", 1880, 1710, {});
  sprite("plant_large", 1000, 1900, {});
  sprite("plant_large", 1520, 1900, {});
  sprite("lamp", 820, 1900, { height: 56, pool: 90, alpha: 0.18 });
  sprite("lamp", 1760, 1900, { height: 56, pool: 90, alpha: 0.18 });
  sprite("window", 300, 1660, { w: 130, h: 100 });
  sprite("window", 2140, 1660, { w: 130, h: 100 });
  sprite("stairs", 120, 1780, { w: 150, h: 170, direction: "right" });
  sprite("stairs", 2290, 1780, { w: 150, h: 170, direction: "left" });
  actor("talk", 1120, 1790, { seed: hashString("ter-1"), shirt: "#3a4a7a", role: "trader" });
  actor("coffee", 1260, 1790, { seed: hashString("ter-2"), role: "critic" });
  actor("pool", 860, 1880, { seed: hashString("ter-3"), shirt: "#7a3a4a", role: "trader" });
  actor("idle", 990, 1900, { seed: hashString("ter-4"), role: "critic" });
  actor("walk", 1600, 1860, { seed: hashString("ter-5"), shirt: "#2f6a8a", role: "trader" });
  actor("talk", 1680, 1860, { seed: hashString("ter-6"), role: "critic" });

  return items;
}

function buildLighting() {
  const pools = [];
  for (let col = 0; col < COLUMN_COUNT; col += 1) {
    pools.push({ x: COLUMNS[col], y: BAND_START - 40, radius: 150, color: PALETTE_V3.amber, alpha: 0.07 });
    pools.push({ x: COLUMNS[col], y: BAND_START + BAND_PITCH * 2 - 40, radius: 150, color: PALETTE_V3.amber, alpha: 0.07 });
    pools.push({ x: COLUMNS[col], y: BAND_START + BAND_PITCH * 4 - 40, radius: 150, color: PALETTE_V3.amber, alpha: 0.07 });
  }
  pools.push({ x: 780, y: 150, radius: 420, color: PALETTE_V3.amber, alpha: 0.09 });
  pools.push({ x: 1280, y: 1830, radius: 520, color: PALETTE_V3.amber, alpha: 0.1 });
  pools.push({ x: 720, y: 400, radius: 300, color: PALETTE_V3.amber, alpha: 0.08 });
  pools.push({ x: 1540, y: 380, radius: 320, color: PALETTE_V3.amber, alpha: 0.08 });
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
  drawTile(ctx, "floor_tiles", 0, 0, WORLD_WIDTH, WORLD_HEIGHT, { size: 34 });
  warmOverlayLocal(ctx, 0, 0, WORLD_WIDTH, WORLD_HEIGHT, "#f0b429", 0.05);
  warmOverlayLocal(ctx, 0, 490, WORLD_WIDTH, 1170, "#1c3c3a", 0.28);
  warmOverlayLocal(ctx, 0, 0, WORLD_WIDTH, 490, "#7a4a1e", 0.12);
  warmOverlayLocal(ctx, 0, 1660, WORLD_WIDTH, WORLD_HEIGHT - 1660, "#7a4a1e", 0.16);
}

function warmOverlayLocal(ctx, x, y, w, h, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

function drawWalls(ctx) {
  drawTile(ctx, "wall_panel", 0, 0, WORLD_WIDTH, 64, { panelW: 56 });
  drawTile(ctx, "wall_brick", 0, 1660, WORLD_WIDTH, 18, {});
  for (let x = 80; x < WORLD_WIDTH; x += 300) {
    drawSprite(ctx, "window", x, 8, { w: 100, h: 48 });
    drawSprite(ctx, "wall_sconce", x + 200, 40, { pool: 46, alpha: 0.12 });
  }
}

function drawRibbon(ctx, row) {
  const y = row.deskTop - 92;
  const label = row.label;
  const w = Math.max(150, measurePixelText(label, 2, 1) + 34);
  const x = Math.round(WORLD_WIDTH / 2 - w / 2);
  const accent = row.accent === "split" ? PALETTE_V3.bandGreen : PALETTE_V3.bandBlue;
  const accentHi = row.accent === "split" ? PALETTE_V3.bandGreenHi : PALETTE_V3.bandBlueHi;
  pxRectLocal(ctx, x + 4, y + 4, w, 30, "rgba(0,0,0,0.35)");
  pxRectLocal(ctx, x, y, w, 30, accent);
  pxRectLocal(ctx, x, y, w, 2, accentHi);
  pxRectLocal(ctx, x, y + 28, w, 2, "rgba(0,0,0,0.35)");
  drawPixelText(ctx, label, x + w / 2, y + 10, { scale: 2, align: "center", color: PALETTE_V3.white, shadow: "rgba(0,0,0,0.5)" });
  if (row.accent === "split") {
    pxRectLocal(ctx, Math.round(WORLD_WIDTH / 2) - 1, y, 2, 30, "rgba(255,255,255,0.35)");
  }
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
  drawMarketsBox(ctx, 1210, 30, board);
  drawValueBox(ctx, 1460, 30, 210, 70, "LUCRO SEMANAL", board.weeklyText);
  drawValueBox(ctx, 1460, 112, 210, 70, "LUCRO MENSAL", board.monthlyText);
  drawGlobalPanel(ctx, 1700, 30, 380, 220, worldState);
  drawDisciplinePoster(ctx, 2110, 30, 180, 150);
  drawLogo(ctx, 60, 30);
}

function drawLogo(ctx, x, y) {
  const w = 300;
  const h = 92;
  drawPanel(ctx, x, y, w, h, "#0a1526", PALETTE_V3.border);
  pxRectLocal(ctx, x + 12, y + 16, 40, 40, PALETTE_V3.goldDark);
  pxRectLocal(ctx, x + 15, y + 19, 34, 34, PALETTE_V3.gold);
  pxRectLocal(ctx, x + 20, y + 24, 24, 24, "#0a1526");
  pxRectLocal(ctx, x + 25, y + 29, 14, 14, PALETTE_V3.gold);
  drawPixelText(ctx, "TRACE/COM", x + 66, y + 20, { scale: 2, color: PALETTE_V3.white });
  drawPixelText(ctx, "DISCIPLINA · DADOS · RESULTADOS", x + 66, y + 46, { scale: 1, color: PALETTE_V3.goldHi });
  drawPixelText(ctx, "PIXEL OFFICE V3", x + 66, y + 60, { scale: 1, color: PALETTE_V3.metal });
}

function drawDailyBoard(ctx, board) {
  const x = 400;
  const y = 20;
  const w = 760;
  const h = 250;
  drawPanel(ctx, x, y, w, h, "#0b1728", PALETTE_V3.border);
  pxRectLocal(ctx, x + 6, y + 6, w - 12, 30, PALETTE_V3.panelHeader);
  drawPixelText(ctx, "RESULTADO DO DIA", x + w / 2, y + 14, { scale: 3, align: "center", color: PALETTE_V3.white });

  const positive = board.tone === "POSITIVE";
  const negative = board.tone === "NEGATIVE";
  const color = positive ? PALETTE_V3.green : negative ? PALETTE_V3.red : PALETTE_V3.metal;
  drawPixelText(ctx, board.pnlText, x + w / 2, y + 48, { scale: 8, align: "center", color, shadow: "rgba(0,0,0,0.6)" });
  drawPixelText(ctx, positive ? "GANHO LÍQUIDO HOJE" : negative ? "PERDA LÍQUIDA HOJE" : "SEM RESULTADO LIQUIDADO", x + w / 2, y + 118, {
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
  const metricX = x + 30;
  const metricY = y + 148;
  metrics.forEach(([label, value], index) => {
    const rowY = metricY + index * 16;
    drawPixelText(ctx, label, metricX, rowY, { scale: 1, color: PALETTE_V3.metal });
    drawPixelText(ctx, value, metricX + 150, rowY, {
      scale: 1,
      align: "right",
      color: label === "MAIOR WIN" ? PALETTE_V3.green : label === "MAIOR LOSS" ? PALETTE_V3.red : PALETTE_V3.white,
    });
    if (index < metrics.length - 1) pxRectLocal(ctx, metricX, rowY + 12, 150, 1, "rgba(120,150,200,0.14)");
  });

  // equity chart — real settled series only, explicit placeholder when absent
  const chartX = x + 230;
  const chartY = y + 148;
  const chartW = 500;
  const chartH = 84;
  pxRectLocal(ctx, chartX, chartY, chartW, chartH, "#08121f");
  for (let gx = 0; gx <= 4; gx += 1) pxRectLocal(ctx, chartX + (chartW / 4) * gx, chartY, 1, chartH, "rgba(90,130,190,0.16)");
  for (let gy = 0; gy <= 4; gy += 1) pxRectLocal(ctx, chartX, chartY + (chartH / 4) * gy, chartW, 1, "rgba(90,130,190,0.16)");
  if (board.equityPlaceholder) {
    pxRectLocal(ctx, chartX, chartY + Math.round(chartH / 2), chartW, 1, "rgba(120,150,200,0.3)");
    drawPixelText(ctx, "SEM SÉRIE DE RESULTADO", chartX + chartW / 2, chartY + Math.round(chartH / 2) - 4, { scale: 1, align: "center", color: PALETTE_V3.metal });
    drawPixelText(ctx, "EQUITY · SEM DADOS", chartX, chartY - 12, { scale: 1, color: PALETTE_V3.metal });
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
    drawPixelText(ctx, "EQUITY · SÉRIE REAL", chartX, chartY - 12, { scale: 1, color: PALETTE_V3.goldHi });
  }
}

function drawMarketsBox(ctx, x, y, board) {
  const w = 220;
  const h = 152;
  drawPanel(ctx, x, y, w, h, "#0b1728", "#2a4a80");
  drawPixelText(ctx, "MERCADOS", x + w / 2, y + 10, { scale: 2, align: "center", color: "#7ab0e8" });
  const rows = [
    ["ABERTOS", String(board.open), PALETTE_V3.white],
    ["FECHADOS", String(board.closed), PALETTE_V3.white],
    ["TOTAL", String(board.total), PALETTE_V3.metalHi],
    ["MODO", "PRACTICE", PALETTE_V3.screenOn],
    ["RISCO", "ZERO REAL", PALETTE_V3.green],
  ];
  rows.forEach(([label, value, color], index) => {
    const rowY = y + 38 + index * 21;
    drawPixelText(ctx, label, x + 16, rowY, { scale: 1, color: "#9ab8dc" });
    drawPixelText(ctx, value, x + w - 16, rowY, { scale: 1, align: "right", color });
    if (index < rows.length - 1) pxRectLocal(ctx, x + 14, rowY + 15, w - 28, 1, "rgba(120,150,200,0.14)");
  });
}

function drawValueBox(ctx, x, y, w, h, title, value) {
  drawPanel(ctx, x, y, w, h, "#0b1728", "#2a4a80");
  drawPixelText(ctx, title, x + w / 2, y + 10, { scale: 2, align: "center", color: "#7ab0e8" });
  drawPixelText(ctx, value, x + w / 2, y + 38, { scale: 2, align: "center", color: value.startsWith("−") ? PALETTE_V3.red : value === "—" ? PALETTE_V3.metal : PALETTE_V3.green });
}

function drawGlobalPanel(ctx, x, y, w, h, worldState) {
  drawPanel(ctx, x, y, w, h, "#101a2b", PALETTE_V3.border);
  drawPixelParagraph(ctx, "MERCADO GLOBAL 24H", x + 14, y + 12, w - 28, { scale: 2, color: "#7ab0e8", lineHeight: 20 });
  drawPixelParagraph(ctx, "MAPA AGREGADO · DADOS REAIS", x + 14, y + 48, w - 28, { scale: 1, color: "#8fb4e0", lineHeight: 12 });
  // simple world map blobs
  const mx = x + 20;
  const my = y + 74;
  const mw = w - 40;
  const mh = 100;
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
  drawPixelText(ctx, `${worldState.stations.length} ATIVOS MONITORADOS`, x + w / 2, y + h - 18, { scale: 1, align: "center", color: PALETTE_V3.goldHi });
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

function drawStation(ctx, station, showAgents = true) {
  const cell = station.cell;
  const desk = station.desk;
  const cx = cell.centerX;
  const agentBase = desk.y + 6;
  const active = station.active === true;

  drawCastShadow(ctx, desk.x, desk.y, desk.w, desk.h);

  // chairs behind the duo
  if (active) {
    drawSprite(ctx, "chair", cx - 46, agentBase - 34, { w: 30, h: 34 });
    drawSprite(ctx, "chair", cx + 16, agentBase - 34, { w: 30, h: 34 });
    if (showAgents) {
      drawCharacter(ctx, "work", cx - 30, agentBase, { role: "trader", seed: station.trader?.seed, id: `${station.id}:trader` });
      drawCharacter(ctx, "work", cx + 30, agentBase, { role: "critic", seed: station.critic?.seed, id: `${station.id}:critic` });
    }
  } else {
    drawSprite(ctx, "chair", cx - 16, agentBase - 24, { w: 30, h: 34 });
  }

  // desk (agents drawn first, desk occludes lower torso)
  drawSprite(ctx, "wood_desk", desk.x, desk.y, {
    w: desk.w,
    h: desk.h,
    depth: 16,
    plaque: active || station.plaque.text ? station.plaque.text : null,
  });

  if (active) {
    drawSprite(ctx, "monitor", cx - 17, desk.y + 2, { w: 34, h: 22 });
    drawSprite(ctx, "computer_tower", desk.x + 8, desk.y - 30, { w: 20, h: 34 });
    drawSprite(ctx, "keyboard", cx - 19, desk.y + 20, { w: 38, h: 10 });
    // screen glow pool
    lightPoolLocal(ctx, cx, desk.y + 10, 54, PALETTE_V3.screenOn, 0.1);
  } else if (station.reserved) {
    drawSprite(ctx, "keyboard", cx - 19, desk.y + 20, { w: 38, h: 10 });
  }

  if (station.badge?.visible) {
    const color = station.badge.color ?? PALETTE_V3.metal;
    drawPixelText(ctx, station.badge.text, cx, agentBase - 52, { scale: 2, align: "center", color, shadow: "rgba(0,0,0,0.7)" });
  }
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
    for (const row of BAND_ROWS) drawRibbon(ctx, row);
    const tiles = worldState.amenities.filter((item) => item.kind === "tile");
    for (const item of tiles) {
      renderStats.tilesDrawn += 1;
      drawAmenity(ctx, item);
    }
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
  for (const row of BAND_ROWS) drawRibbon(context, row);
  for (const item of worldState.amenities) if (item.kind === "tile") drawAmenity(context, item);
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
