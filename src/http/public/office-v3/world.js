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
  BAND_OTC_CRYPTO: ["OTC 24H", "CRIPTOMOEDAS"],
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

export const SETTLEMENT_BADGE_WINDOW_MS = 12_000;

/** True only while a REAL settlement badge is inside its ~12s window (T7). */
export function settlementBadgeVisible(station, nowMs = Date.now()) {
  const badge = station?.badge;
  if (!badge || badge.visible !== true) return false;
  const settledAt = Number(badge.settledAt);
  if (!Number.isFinite(settledAt) || settledAt <= 0) return false;
  const ageMs = Number(nowMs) - settledAt;
  return ageMs >= 0 && ageMs <= SETTLEMENT_BADGE_WINDOW_MS;
}

function marketBadge(market, active) {
  if (!active) return { visible: false, tone: "NONE", color: null, text: "", settledAt: null };
  const settlement = market?.settlementState && typeof market.settlementState === "object" ? market.settlementState : {};
  const result = String(settlement.lastResult ?? "").toUpperCase();
  const rawProfit = settlement.lastProfit;
  const rawAt = settlement.lastAt;
  const profit = rawProfit === null || rawProfit === undefined || rawProfit === "" ? Number.NaN : Number(rawProfit);
  const settledAt = rawAt === null || rawAt === undefined || rawAt === "" ? Number.NaN : Number(rawAt);
  // Real settlement only: brokerage result + real profit + real settlement
  // timestamp. The badge is drawn for ~12s over the station after the REAL
  // settlement and then the desk returns to the subtle animation (T7).
  if (!["WIN", "LOSS", "DRAW"].includes(result) || !Number.isFinite(profit) || !Number.isFinite(settledAt) || settledAt <= 0) {
    return { visible: false, tone: "NONE", color: null, text: "", settledAt: null };
  }
  if (result === "WIN") return { visible: true, tone: "POSITIVE", color: PALETTE_V3.green, text: `+R$ ${formatBRL(Math.abs(profit))}`, settledAt };
  if (result === "LOSS") return { visible: true, tone: "NEGATIVE", color: PALETTE_V3.red, text: `−R$ ${formatBRL(Math.abs(profit))}`, settledAt };
  return { visible: true, tone: "ZERO", color: PALETTE_V3.metal, text: "R$ 0,00", settledAt };
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
    minX: CONTENT_X,
    minY: CONTENT_Y,
    maxX: CONTENT_X + CONTENT_WIDTH,
    maxY: CONTENT_Y + CONTENT_HEIGHT,
    contentBounds: {
      minX: CONTENT_X,
      minY: CONTENT_Y,
      maxX: CONTENT_X + CONTENT_WIDTH,
      maxY: CONTENT_Y + CONTENT_HEIGHT,
    },
    layout: STATION_LAYOUT,
    cells,
    stations,
    reserved,
    allStations: stations.concat(reserved),
    board: dailyBoardModel(officeJson),
    // Real TraceCom event log (runtime/audit stream) rendered in the top panel.
    // Bounded by the page; the renderer only reads the last entries (T3/T9).
    logs: Array.isArray(officeJson.logs) ? officeJson.logs.slice(-40) : [],
    amenities: buildAmenities(),
    lighting: buildLighting(),
  };
}

/** Bounded global log list for the top LOGS box (last N, never grows). */
export const WORLD_LOG_LIMIT = 12;

export function setWorldLogs(worldState, logs) {
  if (!worldState) return worldState;
  worldState.logs = Array.isArray(logs) ? logs.slice(-WORLD_LOG_LIMIT) : [];
  return worldState;
}

export function stationPlaque(station) {
  return station?.plaque?.text ?? "";
}

/* ------------------------------------------------------------------ *
 * 6. SOCIAL AREAS — amenities
 * ------------------------------------------------------------------ */

function buildAmenities() {
  return [];
}
function buildLighting() {
  const pools = [];
  const cx = CONTENT_X + CONTENT_WIDTH / 2;
  for (let row = 0; row < 5; row += 1) {
    pools.push({ x: cx, y: BAND_START + row * BAND_PITCH + 34, radius: 430, color: PALETTE_V3.amber, alpha: 0.06 });
  }
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

/**
 * THE single anchor source for the procedural world. Maps every station of a
 * built world state to its desk geometry, so the hit test, the MESAS popup, the
 * zoom/focus and the right panel all resolve the same desk for the same
 * `marketKey`. This replaces the hybrid blueprint anchors on the default path.
 */
export function createAnchorResolver(stations) {
  const list = Array.isArray(stations) ? stations.filter((station) => station && typeof station === "object") : [];
  const byKey = new Map();
  const anchors = list.map((station, index) => {
    const cell = station.cell && typeof station.cell === "object" ? station.cell : {};
    const desk = station.desk && typeof station.desk === "object"
      ? station.desk
      : { x: Number(station.x) || 0, y: Number(station.y) || 0, w: DESK_WIDTH, h: DESK_HEIGHT };
    const marketKey = station.marketKey ?? station.id ?? null;
    const centerX = Number.isFinite(Number(cell.centerX)) ? Number(cell.centerX) : desk.x + desk.w / 2;
    const anchor = {
      marketKey,
      id: station.id ?? null,
      index,
      x: centerX,
      y: desk.y,
      w: desk.w,
      h: desk.h,
      desk: { x: desk.x, y: desk.y, w: desk.w, h: desk.h },
      centerX,
      centerY: desk.y + desk.h / 2,
    };
    if (marketKey) byKey.set(marketKey, anchor);
    return anchor;
  });
  return {
    anchors,
    byKey,
    anchorFor(station, index) {
      if (!station) return null;
      const key = station.marketKey ?? station.id ?? null;
      if (key && byKey.has(key)) return byKey.get(key);
      const position = Number.isInteger(index) ? index : list.indexOf(station);
      return anchors[position] ?? null;
    },
  };
}

/** Convenience for a single station (isolated callers/tests). */
export function anchorForStation(station, index = 0) {
  return createAnchorResolver([station]).anchorFor(station, index);
}

/** Hit test against the same procedural anchors used to draw and focus. */
export function hitTestAnchor(worldState, worldX, worldY) {
  return hitTestStation(worldState, worldX, worldY);
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
  // T1: the floor exists only inside the real CONTENT window; everything else
  // is the neutral void fill drawn by drawWorld, so the content is visually
  // centered in the navigable area instead of pinned inside a larger gray slab.
  drawTile(ctx, "floor_tiles", CONTENT_X, CONTENT_Y, CONTENT_WIDTH, CONTENT_HEIGHT, { size: 28 });
  // warm wood across the top social band and the bottom band, navy on the floor
  drawTile(ctx, "floor_wood", CONTENT_X, CONTENT_Y, CONTENT_WIDTH, 362, { plankH: 18 });
  drawTile(ctx, "floor_wood", CONTENT_X, CONTENT_Y + 900, CONTENT_WIDTH, 124, { plankH: 18 });
  warmOverlayLocal(ctx, CONTENT_X, CONTENT_Y, CONTENT_WIDTH, CONTENT_HEIGHT, "#f0b429", 0.05);
  warmOverlayLocal(ctx, CONTENT_X, CONTENT_Y + 362, CONTENT_WIDTH, 900 - 362, "#0e2740", 0.24);
  warmOverlayLocal(ctx, CONTENT_X, CONTENT_Y, CONTENT_WIDTH, 362, "#7a4a1e", 0.12);
  warmOverlayLocal(ctx, CONTENT_X, CONTENT_Y + 900, CONTENT_WIDTH, CONTENT_HEIGHT - 900, "#7a4a1e", 0.16);
}

function warmOverlayLocal(ctx, x, y, w, h, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

function drawWalls(ctx) {
  drawTile(ctx, "wall_panel", CONTENT_X, CONTENT_Y, CONTENT_WIDTH, 44, { panelW: 56 });
  drawTile(ctx, "wall_brick", CONTENT_X, CONTENT_Y + 900, CONTENT_WIDTH, 16, {});
  for (let x = CONTENT_X + 40; x < CONTENT_X + CONTENT_WIDTH - 30; x += 280) {
    drawSprite(ctx, "wall_sconce", x, CONTENT_Y + 34, { pool: 40, alpha: 0.12 });
  }
}

/**
 * Sector ribbon (T4). Drawn in the DYNAMIC pass AFTER the desks so the label is
 * always in front of the office surface (never buried under a desk front), with
 * a solid opaque panel, brighter text and a clip/scale guard so long labels do
 * not overflow the band. Lifted above the desk row so it never covers monitors.
 */
function drawRibbon(ctx, row) {
  const y = row.deskTop - 60;
  if (row.accent === "split") {
    const parts = SUB_BAND_BY_ROW[row.id] ?? [row.label];
    const leftCenter = (COLUMNS[0] + COLUMNS[4]) / 2;
    const rightCenter = (COLUMNS[5] + COLUMNS[COLUMN_COUNT - 1]) / 2;
    const half = 5 * COLUMN_STEP - 16;
    drawRibbonAt(ctx, parts[0], leftCenter, y, PALETTE_V3.bandBlue, PALETTE_V3.bandBlueHi, half);
    drawRibbonAt(ctx, parts[1] ?? parts[0], rightCenter, y, PALETTE_V3.bandGreen, PALETTE_V3.bandGreenHi, half);
    return;
  }
  drawRibbonAt(ctx, row.label, Math.round(WORLD_WIDTH / 2), y, PALETTE_V3.bandBlue, PALETTE_V3.bandBlueHi, 0);
}

function drawRibbonAt(ctx, label, centerX, y, accent, accentHi, maxWidth = 0) {
  let scale = 2;
  let textW = measurePixelText(label, scale, 1);
  while (scale > 1 && (maxWidth > 0 ? textW + 30 > maxWidth : textW > WORLD_WIDTH - 80)) {
    scale -= 1;
    textW = measurePixelText(label, scale, 1);
  }
  const w = Math.max(120, textW + 30);
  const x = Math.round(centerX - w / 2);
  pxRectLocal(ctx, x + 4, y + 5, w, 26, "rgba(0,0,0,0.45)");
  pxRectLocal(ctx, x, y, w, 26, accent);
  pxRectLocal(ctx, x, y, w, 2, accentHi);
  pxRectLocal(ctx, x, y + 24, w, 2, "rgba(0,0,0,0.4)");
  pxRectLocal(ctx, x, y, 2, 26, "rgba(255,255,255,0.16)");
  drawPixelText(ctx, label, x + w / 2, y + Math.round((26 - 7 * scale) / 2), { scale, align: "center", color: PALETTE_V3.white, shadow: "rgba(0,0,0,0.65)" });
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
    const safe = value === "—" ? "SEM DADOS" : value;
    drawPixelText(ctx, label, metricX, rowY, { scale: 1, color: PALETTE_V3.metal });
    drawPixelText(ctx, safe, metricX + 130, rowY, {
      scale: 1,
      align: "right",
      color: label === "MAIOR WIN" ? PALETTE_V3.green : label === "MAIOR LOSS" ? PALETTE_V3.red : PALETTE_V3.white,
    });
    if (index < metrics.length - 1) pxRectLocal(ctx, metricX, rowY + 11, 130, 1, "rgba(120,150,200,0.14)");
  });

  // equity chart — real settled series only, explicit placeholder when absent.
  // Padding keeps the line and the min/max labels fully inside the frame.
  const chartX = x + 180;
  const chartY = y + 128;
  const chartW = 384;
  const chartH = 76;
  const padX = 7;
  const padY = 9;
  const innerW = chartW - padX * 2;
  const innerH = chartH - padY * 2;
  pxRectLocal(ctx, chartX, chartY, chartW, chartH, "#08121f");
  pxRectLocal(ctx, chartX, chartY, chartW, 1, "rgba(120,150,200,0.35)");
  pxRectLocal(ctx, chartX, chartY + chartH - 1, chartW, 1, "rgba(120,150,200,0.35)");
  pxRectLocal(ctx, chartX, chartY, 1, chartH, "rgba(120,150,200,0.35)");
  pxRectLocal(ctx, chartX + chartW - 1, chartY, 1, chartH, "rgba(120,150,200,0.35)");
  for (let gx = 1; gx < 4; gx += 1) pxRectLocal(ctx, chartX + (chartW / 4) * gx, chartY + 1, 1, chartH - 2, "rgba(90,130,190,0.14)");
  for (let gy = 1; gy < 4; gy += 1) pxRectLocal(ctx, chartX + 1, chartY + (chartH / 4) * gy, chartW - 2, 1, "rgba(90,130,190,0.14)");
  if (board.equityPlaceholder) {
    pxRectLocal(ctx, chartX + 1, chartY + Math.round(chartH / 2), chartW - 2, 1, "rgba(120,150,200,0.3)");
    drawPixelText(ctx, "SEM SÉRIE DE RESULTADO", chartX + chartW / 2, chartY + Math.round(chartH / 2) - 4, { scale: 1, align: "center", color: PALETTE_V3.metal });
    drawPixelText(ctx, "EQUITY · SEM DADOS", chartX, chartY - 10, { scale: 1, color: PALETTE_V3.metal });
  } else {
    const series = board.equitySeries;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;
    const lineColor = negative ? PALETTE_V3.red : PALETTE_V3.green;
    const xAt = (index) => chartX + padX + (series.length === 1 ? innerW / 2 : (innerW / (series.length - 1)) * index);
    const yAt = (value) => chartY + padY + innerH - ((value - min) / span) * innerH;
    // zero baseline only when the real range crosses zero (never invented)
    if (min <= 0 && max >= 0) {
      pxRectLocal(ctx, chartX + 1, Math.round(yAt(0)), chartW - 2, 1, "rgba(120,150,200,0.35)");
    }
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    series.forEach((value, index) => {
      const px = xAt(index);
      const py = yAt(value);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
    const lastValue = series[series.length - 1];
    pxRectLocal(ctx, Math.round(xAt(series.length - 1)) - 2, Math.round(yAt(lastValue)) - 2, 4, 4, lineColor);
    // Header: real series label + real last value, read from the settled series.
    drawPixelText(ctx, "EQUITY · SÉRIE REAL", chartX, chartY - 10, { scale: 1, color: PALETTE_V3.goldHi });
    drawPixelText(ctx, signedBRL(lastValue), chartX + chartW, chartY - 10, { scale: 1, align: "right", color: lineColor });
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
  const empty = value === "—";
  const safe = empty ? "SEM DADOS" : value;
  drawPixelText(ctx, safe, x + w / 2, empty ? y + 30 : y + 26, { scale: empty ? 1 : 2, align: "center", color: empty ? PALETTE_V3.metal : value.startsWith("−") || value.startsWith("-") ? PALETTE_V3.red : PALETTE_V3.green });
}

/**
 * GLOBAL LOGS box (T3) — real TraceCom runtime/event stream only. Sits to the
 * right of MERCADOS / LUCRO SEMANAL / LUCRO MENSAL, same top panel, and is
 * redrawn every frame from the bounded `worldState.logs` list (the DOM never
 * grows: the page keeps a fixed-size array). Format: HH:MM:SS ATIVO — evento.
 */
export function drawLogsBox(ctx, worldState) {
  if (!ctx || !worldState) return;
  const x = CONTENT_X + 840 + 170 + 10;
  const y = 6;
  const w = CONTENT_X + CONTENT_WIDTH - x - 8;
  const h = 236;
  drawPanel(ctx, x, y, w, h, "#0a1424", "#2a4a80");
  pxRectLocal(ctx, x + 6, y + 6, w - 12, 22, PALETTE_V3.panelHeader);
  drawPixelText(ctx, "LOGS", x + w / 2, y + 11, { scale: 2, align: "center", color: PALETTE_V3.white });
  const logs = Array.isArray(worldState.logs) ? worldState.logs : [];
  const maxLines = 11;
  const visible = logs.slice(-maxLines);
  const lineHeight = 19;
  const startY = y + 36;
  if (!visible.length) {
    drawPixelText(ctx, "AGUARDANDO EVENTOS REAIS", x + w / 2, startY + 60, { scale: 1, align: "center", color: PALETTE_V3.metal });
    return;
  }
  visible.forEach((entry, index) => {
    const rowY = startY + index * lineHeight;
    const time = String(entry?.time ?? entry?.at ?? "").slice(0, 8) || "--:--:--";
    const asset = String(entry?.asset ?? entry?.marketKey ?? "SISTEMA").slice(0, 14);
    const eventText = String(entry?.text ?? "");
    drawPixelText(ctx, time, x + 10, rowY, { scale: 1, color: PALETTE_V3.metal });
    drawPixelText(ctx, asset, x + 62, rowY, { scale: 1, color: PALETTE_V3.goldHi });
    const prefixWidth = 62 + measurePixelText(asset, 1, 1) + 10;
    drawPixelText(ctx, `— ${eventText}`, x + prefixWidth, rowY, { scale: 1, color: entry?.tone === "POSITIVE" ? PALETTE_V3.green : entry?.tone === "NEGATIVE" ? PALETTE_V3.red : PALETTE_V3.white });
    if (index < visible.length - 1) pxRectLocal(ctx, x + 8, rowY + 13, w - 16, 1, "rgba(120,150,200,0.10)");
  });
}

export const DESK_TOP_DEPTH = 18;
export const DESK_SEAT_LINE = DESK_TOP_DEPTH + 7;

/** Very subtle terminal activity: 2-3 pixels + a soft breathing glow (T6). */
function drawTerminalActivity(ctx, station, timeMs) {
  const cell = station.cell;
  const desk = station.desk;
  const cx = cell.centerX;
  const phase = Number(timeMs) || 0;
  const seed = Number(station.index) || 0;
  const glow = 0.07 + 0.035 * (0.5 + 0.5 * Math.sin(phase / 620 + seed));
  lightPoolLocal(ctx, cx, desk.y + 10, 54, PALETTE_V3.screenOn, glow);
  const step = Math.floor(phase / 380);
  for (let pixel = 0; pixel < 3; pixel += 1) {
    const value = (step * 2654435761 + seed * 40503 + pixel * 97) >>> 0;
    const px = cx - 15 + (value % 26);
    const py = desk.y + 4 + ((value >>> 8) % 12);
    const brightness = 0.35 + ((value >>> 16) % 4) * 0.12;
    ctx.save();
    ctx.globalAlpha = brightness;
    pxRectLocal(ctx, px, py, 2, 2, (value >>> 20) % 3 === 0 ? PALETTE_V3.screenGreen : PALETTE_V3.screenOn);
    ctx.restore();
  }
}

function drawStation(ctx, station, showAgents = true, options = {}) {
  const cell = station.cell;
  const desk = station.desk;
  const cx = cell.centerX;
  const seatLine = desk.y + DESK_SEAT_LINE;
  const active = station.active === true;
  const timeMs = Number(options.timeMs) || 0;

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
    drawTerminalActivity(ctx, station, timeMs);
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

  // Real settlement badge (T7): WIN/LOSS/DRAW over the station for ~12s after
  // the brokerage settlement timestamp, then back to the subtle animation.
  const badge = station.badge;
  if (badge?.visible && settlementBadgeVisible(station, Date.now())) {
    const color = badge.color ?? PALETTE_V3.metal;
    const bob = Math.round(Math.sin(timeMs / 500) * 1);
    drawPixelText(ctx, badge.text, cx, desk.y - 22 + bob, { scale: 2, align: "center", color, shadow: "rgba(0,0,0,0.7)" });
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
  const timeMs = Number(options.timeMs) || 0;
  const zoom = Math.min(4, Math.max(0.2, Number(camera?.zoom) || 1));
  const camX = Number(camera?.x) || 0;
  const camY = Number(camera?.y) || 0;
  const view = viewRect(camera);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(zoom, zoom);
  ctx.translate(-Math.round(camX), -Math.round(camY));

  // T1: when the viewport is centered on the real content and part of it falls
  // outside the logical world, fill that area with the floor base color so the
  // office is framed by a coherent surface instead of a black band.
  pxRectLocal(ctx, view.x - 8, view.y - 8, view.w + 16, view.h + 16, PALETTE_V3.floor);

  const ground = ensureGroundLayer(worldState);
  if (ground) {
    blitGround(ctx, ground, view);
  } else {
    drawFloor(ctx);
    drawWalls(ctx);
    drawBackWallItems(ctx, worldState);
    const tiles = worldState.amenities.filter((item) => item.kind === "tile");
    for (const item of tiles) {
      renderStats.tilesDrawn += 1;
      drawAmenity(ctx, item);
    }
  }

  // GLOBAL LOGS box (T3) — real events, always in front, redrawn each frame.
  drawLogsBox(ctx, worldState);

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
    if (entry.type === "station") drawStation(ctx, entry.item, showAgents, { timeMs });
    else drawAmenity(ctx, entry.item);
  }

  // T4: sector labels AFTER the desks — always in front of the surface.
  for (const row of BAND_ROWS) drawRibbon(ctx, row);

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
