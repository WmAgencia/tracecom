/**
 * TRACE/COM — PIXEL OFFICE V2 · STATIC BLUEPRINT RENDERER
 *
 * Dependency-free, DOM-guarded 2D-canvas renderer that reproduces the static
 * scene described by docs/office-v2/BLUEPRINT.md at 1536x1024 logical units.
 *
 * Region-fix pass (v2): text-only P&L badge, seated proportional agents, 3D
 * desks, label-fitted sector ribbons, ASCII-only render strings, expanded OTC
 * world band, desks drawn above the right wall stack, denser warm scene, cream
 * social band. Rendering only — no relay/trading logic, no office-v2.js change.
 */

export const BLUEPRINT_VERSION = "office-v2-blueprint.2.1.0";

/* ------------------------------------------------------------------ *
 * 1. CONSTANTS — artboard, world, macro bands
 * ------------------------------------------------------------------ */

export const BASE_WIDTH = 1536;
export const BASE_HEIGHT = 1024;
export const WORLD_WIDTH = 2560;
export const WORLD_HEIGHT = 1600;

/** Macro bands of the reference (y ranges inclusive-exclusive). */
export const BANDS = [
  { id: "TOP", name: "SUPERIOR", y1: 0, y2: 338 },
  { id: "BAND_FOREX_MAJORS", name: "FOREX MAJORS", y1: 338, y2: 452 },
  { id: "BAND_FOREX_CROSSES", name: "FOREX CRUZADOS", y1: 452, y2: 570 },
  { id: "BAND_OTC_CRYPTO", name: "OTC + CRIPTO", y1: 570, y2: 688 },
  { id: "BAND_INDICES_COMMODITIES", name: "ÍNDICES + COMMODITIES", y1: 688, y2: 804 },
  { id: "BAND_OTHER", name: "OUTROS ATIVOS", y1: 804, y2: 900 },
  { id: "BOTTOM", name: "INFERIOR", y1: 900, y2: 1024 },
];

export const BAND_BY_ID = Object.fromEntries(BANDS.map((band) => [band.id, band]));

/* ------------------------------------------------------------------ *
 * 2. PALETTE — exact colours from the blueprint
 * ------------------------------------------------------------------ */

export const PALETTE = {
  floor: "#0d1b2e",
  floorAlt: "#0f2033",
  floorWarm: "#1a2334",
  floorDeep: "#0a1524",
  tileLine: "#14263d",
  tileLineWarm: "#22334a",
  wall: "#101a2b",
  wallPanel: "#0c1524",
  border: "#c9a24b",
  gold: "#c9a24b",
  goldHi: "#e8c877",
  goldDark: "#8a6a24",

  woodFloor: "#4a3220",
  woodFloorHi: "#573c26",
  woodFloorMid: "#3c2818",
  woodFloorDark: "#2a1a0e",
  woodFloorSeam: "#170d05",
  wallWarm: "#2a1e14",
  wallWarmHi: "#3a2a1c",
  leather: "#6b4a2f",
  leatherHi: "#8a6038",
  leatherDark: "#432c1a",
  sofaLeather: "#3a2c22",
  sofaLeatherHi: "#5a4636",
  cream: "#d8c6a2",

  wood: "#b07a45",
  woodHi: "#c99a63",
  woodMid: "#8a5a34",
  woodDark: "#5c3a22",
  woodShadow: "#3d2413",

  bandBlue: "#2a4070",
  bandBlueHi: "#3d5a8e",
  panelHeader: "#16304f",
  bandGreen: "#256644",
  bandGreenHi: "#3d8f5f",

  green: "#3fbf5f",
  greenDark: "#237a3b",
  red: "#e04b3a",
  redDark: "#9c2c20",

  sofa: "#d9c7a3",
  sofaHi: "#efe3c6",
  sofaDark: "#b8a37c",
  felt: "#0a8048",
  feltDark: "#0a5a34",
  rugRed: "#642823",
  rugRedHi: "#83382f",
  rugBlue: "#22406b",
  rugBlueHi: "#315a91",
  rugCream: "#cbb894",
  rugCreamHi: "#e4d5b3",
  plant: "#3f8f4f",
  plantHi: "#5cb96a",
  plantDark: "#2b6638",
  pot: "#8a5a34",
  potDark: "#5c3a22",
  amber: "#f0b429",
  amberSoft: "#d99a2b",
  windowGlow: "#ffe0a8",

  screen: "#0b1220",
  screenBezel: "#1b2536",
  screenOn: "#5fd0ff",
  screenGreen: "#63d68a",
  screenWarn: "#ffd166",

  skin: "#e8b48a",
  skin2: "#c98d63",
  skin3: "#8a5a3c",
  traderNavy: "#1f3a6e",
  traderNavy2: "#152c58",
  criticPurple: "#6a3fb0",
  criticPurple2: "#4f2d8c",
  hair1: "#20180f",
  hair2: "#4a3320",
  hair3: "#b07a3a",
  hair4: "#8a3a20",
  pants: "#2c3345",
  tie: "#c9a24b",
  metal: "#8d99b5",
  metalDark: "#5a6478",
  white: "#ffffff",
  ink: "#e8d7b0",
  shadow: "rgba(0,0,0,0.35)",
};

/** Financial tone colours (badges, board). */
export const BADGE_COLORS = {
  WIN: PALETTE.green,
  LOSS: PALETTE.red,
  DRAW: PALETTE.metal,
};

/** The P&L badge is floating pixel text, never a filled button. */
export const PNL_BADGE_STYLE = "text";

/* ------------------------------------------------------------------ *
 * 3. SECTOR BANDS — the 7 ribbons, exact labels + geometry
 * ------------------------------------------------------------------ */

export const SECTOR_RIBBON_LABELS = [
  "FOREX MAJORS",
  "FOREX CRUZADOS",
  "OTC - 24H",
  "CRIPTOMOEDAS",
  "INDICES",
  "COMMODITIES",
  "OUTROS ATIVOS",
];

/**
 * Flat ribbon descriptors in reading order. `ribbon` is the exact bounding box
 * from the blueprint; the drawn banner width is derived from the label.
 */
export const SECTOR_BANDS = [
  {
    id: "BAND_FOREX_MAJORS",
    label: "FOREX MAJORS",
    macroBand: "BAND_FOREX_MAJORS",
    accent: "blue",
    ribbon: { x: 688, y: 340, w: 158, h: 26 },
    deskY: 368,
    deskH: 72,
    columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    symbols: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY"],
  },
  {
    id: "BAND_FOREX_CROSSES",
    label: "FOREX CRUZADOS",
    macroBand: "BAND_FOREX_CROSSES",
    accent: "blue",
    ribbon: { x: 688, y: 458, w: 158, h: 26 },
    deskY: 486,
    deskH: 70,
    columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    symbols: ["AUD/JPY", "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF"],
  },
  {
    id: "BAND_OTC",
    label: "OTC - 24H",
    banner: "OTC - 24H (5 PARES)",
    macroBand: "BAND_OTC_CRYPTO",
    accent: "blue",
    ribbon: { x: 368, y: 576, w: 188, h: 26 },
    deskY: 604,
    deskH: 70,
    columns: [0, 1, 2, 3, 4],
    symbols: ["EUR/USD OTC", "GBP/USD OTC", "USD/JPY OTC", "EUR/GBP OTC", "GBP/JPY OTC"],
  },
  {
    id: "BAND_CRYPTO",
    label: "CRIPTOMOEDAS",
    macroBand: "BAND_OTC_CRYPTO",
    accent: "green",
    ribbon: { x: 978, y: 576, w: 174, h: 26 },
    deskY: 604,
    deskH: 70,
    columns: [5, 6, 7, 8, 9],
    symbols: ["BTC/USD", "ETH/USD", "LTC/USD", "XRP/USD", "ADA/USD"],
  },
  {
    id: "BAND_INDICES",
    label: "INDICES",
    banner: "?NDICES",
    macroBand: "BAND_INDICES_COMMODITIES",
    accent: "blue",
    ribbon: { x: 400, y: 692, w: 100, h: 26 },
    deskY: 720,
    deskH: 72,
    columns: [0, 1, 2, 3, 4],
    symbols: ["S&P 500", "NASDAQ", "DOW JONES", "DAX", "FTSE 100"],
  },
  {
    id: "BAND_COMMODITIES",
    label: "COMMODITIES",
    macroBand: "BAND_INDICES_COMMODITIES",
    accent: "green",
    ribbon: { x: 998, y: 692, w: 154, h: 26 },
    deskY: 720,
    deskH: 72,
    columns: [5, 6, 7, 8, 9],
    symbols: ["GOLD", "SILVER", "WTI", "BRENT", "NATGAS"],
  },
  {
    id: "BAND_OTHER",
    label: "OUTROS ATIVOS",
    macroBand: "BAND_OTHER",
    accent: "blue",
    ribbon: { x: 688, y: 808, w: 158, h: 26 },
    deskY: 836,
    deskH: 62,
    columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    symbols: ["APPLE", "TESLA", "AMAZON", "GOOGLE", "META", "MICROSOFT", "NETFLIX", "B3", "IBOV", "PETR4"],
  },
];

/* ------------------------------------------------------------------ *
 * 4. STATION LAYOUT — 10 columns, 50 blueprint desks + 5 expanded OTC
 * ------------------------------------------------------------------ */

export const STATION_COLUMNS = [262, 386, 510, 634, 758, 882, 1006, 1130, 1254, 1378];
export const STATION_CELL_WIDTH = 124;
export const STATION_DESK_WIDTH = 118;
export const STATION_DESK_HEIGHT = 72;

/**
 * The six blueprint bands, each desk at full reference scale. The OTC band is a
 * single 5-desk row again (the crammed 42px second row was reverted).
 */
export const STATION_BANDS = [
  {
    id: "BAND_FOREX_MAJORS",
    label: "FOREX MAJORS",
    ribbonId: "BAND_FOREX_MAJORS",
    rows: [
      {
        y: 368,
        h: 72,
        columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        symbols: ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "USD/CHF", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY"],
      },
    ],
  },
  {
    id: "BAND_FOREX_CROSSES",
    label: "FOREX CRUZADOS",
    ribbonId: "BAND_FOREX_CROSSES",
    rows: [
      {
        y: 486,
        h: 70,
        columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        symbols: ["AUD/JPY", "AUD/CAD", "AUD/CHF", "CAD/JPY", "CHF/JPY", "EUR/CAD", "EUR/CHF", "EUR/AUD", "GBP/AUD", "GBP/CHF"],
      },
    ],
  },
  {
    id: "BAND_OTC_24H",
    label: "OTC - 24H",
    ribbonId: "BAND_OTC",
    rows: [
      {
        y: 604,
        h: 70,
        columns: [0, 1, 2, 3, 4],
        symbols: ["EUR/USD OTC", "GBP/USD OTC", "USD/JPY OTC", "EUR/GBP OTC", "GBP/JPY OTC"],
      },
    ],
  },
  {
    id: "BAND_CRYPTO",
    label: "CRIPTOMOEDAS",
    ribbonId: "BAND_CRYPTO",
    rows: [
      {
        y: 604,
        h: 70,
        columns: [5, 6, 7, 8, 9],
        symbols: ["BTC/USD", "ETH/USD", "LTC/USD", "XRP/USD", "ADA/USD"],
      },
    ],
  },
  {
    id: "BAND_INDICES_COMMODITIES",
    label: "ÍNDICES + COMMODITIES",
    ribbonId: "BAND_INDICES",
    rows: [
      {
        y: 720,
        h: 72,
        columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        symbols: ["S&P 500", "NASDAQ", "DOW JONES", "DAX", "FTSE 100", "GOLD", "SILVER", "WTI", "BRENT", "NATGAS"],
      },
    ],
  },
  {
    id: "BAND_OTHER",
    label: "OUTROS ATIVOS",
    ribbonId: "BAND_OTHER",
    rows: [
      {
        y: 836,
        h: 62,
        columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        symbols: ["APPLE", "TESLA", "AMAZON", "GOOGLE", "META", "MICROSOFT", "NETFLIX", "B3", "IBOV", "PETR4"],
      },
    ],
  },
];

/**
 * Expanded world region below the 1536x1024 viewport. The five real OTC markets
 * that do not fit the blueprint's 5-desk OTC row live here at the same desk
 * scale, reachable by panning (never by shrinking the desks).
 */
export const EXPANDED_WORLD_BANDS = [
  {
    id: "BAND_OTC_EXTRA",
    label: "OTC - 24H",
    ribbonId: "BAND_OTC_EXTRA",
    expanded: true,
    ribbon: { x: 368, y: 1044, w: 188, h: 18 },
    rows: [
      {
        y: 1072,
        h: 70,
        columns: [0, 1, 2, 3, 4],
        symbols: ["AUD/USD OTC", "USD/CAD OTC", "USD/CHF OTC", "EUR/JPY OTC", "AUD/JPY OTC"],
      },
    ],
  },
];

function pushBandSlots(slots, band) {
  for (const row of band.rows) {
    row.columns.forEach((column, index) => {
      const symbol = row.symbols[index];
      const center = STATION_COLUMNS[column];
      const w = STATION_DESK_WIDTH;
      const h = row.h ?? STATION_DESK_HEIGHT;
      slots.push({
        id: symbol,
        symbol,
        band: band.id,
        bandLabel: band.label,
        ribbonId: band.ribbonId,
        column,
        x: center - Math.round(w / 2),
        y: row.y,
        w,
        h,
        expanded: band.expanded === true,
      });
    });
  }
}

function buildSlots() {
  const slots = [];
  for (const band of STATION_BANDS) pushBandSlots(slots, band);
  for (const band of EXPANDED_WORLD_BANDS) pushBandSlots(slots, band);
  return slots;
}

export const STATION_LAYOUT = {
  columns: STATION_COLUMNS.slice(),
  cellWidth: STATION_CELL_WIDTH,
  deskWidth: STATION_DESK_WIDTH,
  deskHeight: STATION_DESK_HEIGHT,
  bands: STATION_BANDS,
  expandedBands: EXPANDED_WORLD_BANDS,
  ribbonBands: SECTOR_BANDS,
  slots: buildSlots(),
};

export const MASTER_STATION = {
  symbol: "EUR/USD",
  band: "BAND_FOREX_MAJORS",
  column: 0,
  x: STATION_COLUMNS[0] - Math.round(STATION_DESK_WIDTH / 2),
  y: 368,
  w: STATION_DESK_WIDTH,
  h: STATION_DESK_HEIGHT,
  result: "WIN",
  pnl: 8.5,
  active: true,
};

/* ------------------------------------------------------------------ *
 * 5. ASSET KIT names
 * ------------------------------------------------------------------ */

export const ASSET_KIT_NAMES = [
  "wood_desk",
  "chair",
  "trader",
  "critic",
  "sofa",
  "armchair",
  "coffee_table",
  "pool_table",
  "plant_small",
  "plant_large",
  "bookshelf",
  "lamp",
  "wall_sconce",
  "rug",
  "kitchen_counter",
  "fridge",
  "research_desk",
  "stairs",
  "world_map",
  "daily_board",
  "monitor",
  "plaque",
  "pnl_badge",
];

/* ------------------------------------------------------------------ *
 * 6. LOW-LEVEL PIXEL HELPERS
 * ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function pxRect(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function pxPoly(ctx, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.closePath();
  ctx.fill();
}

function pxLine(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
}

function lightPool(ctx, x, y, radius, color, alpha) {
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

function warmOverlay(ctx, x, y, w, h, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

export function hashString(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0);
}

/* ------------------------------------------------------------------ *
 * 7. INTERNAL 5x7 BITMAP FONT (own glyph table)
 * ------------------------------------------------------------------ */

const FONT_5X7 = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  3: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ",": [0, 0, 0, 0, 0b00110, 0b00110, 0b01100],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  ";": [0, 0b01100, 0b01100, 0, 0b00110, 0b00110, 0b01100],
  "-": [0, 0, 0, 0b11111, 0, 0, 0],
  "+": [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  "%": [0b11001, 0b11011, 0b00010, 0b00100, 0b01000, 0b11011, 0b10011],
  "(": [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ")": [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  "!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  "?": [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0, 0b00100],
  "=": [0, 0, 0b11111, 0, 0b11111, 0, 0],
  "·": [0, 0, 0, 0b00100, 0, 0, 0],
  "#": [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0],
  $: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  "&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  "'": [0b00100, 0b00100, 0, 0, 0, 0, 0],
  '"': [0b01010, 0b01010, 0, 0, 0, 0, 0],
  "<": [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
  ">": [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000],
  "*": [0, 0b00100, 0b10101, 0b01110, 0b10101, 0b00100, 0],
  _: [0, 0, 0, 0, 0, 0, 0b11111],
  "−": [0, 0, 0, 0b11111, 0, 0, 0],
  "°": [0b01100, 0b10010, 0b01100, 0, 0, 0, 0],
  a: [0, 0, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
  b: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
  c: [0, 0, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110],
  d: [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
  e: [0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
  f: [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000],
  g: [0, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  h: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  i: [0b00100, 0, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
  j: [0b00010, 0, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100],
  k: [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
  l: [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  m: [0, 0, 0b11010, 0b10101, 0b10101, 0b10101, 0b10101],
  n: [0, 0, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
  o: [0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
  p: [0, 0, 0b11110, 0b10001, 0b10001, 0b11110, 0b10000],
  q: [0, 0, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001],
  r: [0, 0, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
  s: [0, 0, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
  t: [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110],
  u: [0, 0, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
  v: [0, 0, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  w: [0, 0, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010],
  x: [0, 0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
  y: [0, 0, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
  z: [0, 0, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
};

const ACCENT_MAP = {
  Á: ["A", "acute"], À: ["A", "grave"], Â: ["A", "circumflex"], Ã: ["A", "tilde"], Ä: ["A", "diaeresis"],
  É: ["E", "acute"], È: ["E", "grave"], Ê: ["E", "circumflex"],
  Í: ["I", "acute"], Ì: ["I", "grave"], Î: ["I", "circumflex"],
  Ó: ["O", "acute"], Ò: ["O", "grave"], Ô: ["O", "circumflex"], Õ: ["O", "tilde"],
  Ú: ["U", "acute"], Ù: ["U", "grave"], Û: ["U", "circumflex"],
  Ç: ["C", "cedilla"], Ñ: ["N", "tilde"],
};

const ACCENT_MARKS = {
  acute: [[3, -1], [2, -2]],
  grave: [[1, -1], [2, -2]],
  circumflex: [[1, -1], [2, -2], [3, -1]],
  tilde: [[1, -1], [2, -1], [3, -2], [4, -2]],
  diaeresis: [[1, -2], [3, -2]],
  cedilla: [[2, 7], [3, 8]],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

/** Every character the bitmap font can render without falling back to `?`. */
export const SUPPORTED_GLYPHS = Object.freeze(Object.keys(FONT_5X7));

/** Return the list of characters in `text` with no dedicated glyph. */
export function fontGlyphCoverage(text) {
  const missing = [];
  for (const char of String(text ?? "").toUpperCase()) {
    const base = ACCENT_MAP[char] ? ACCENT_MAP[char][0] : char;
    if (!Object.prototype.hasOwnProperty.call(FONT_5X7, base)) missing.push(char);
  }
  return missing;
}

export function fontHasGlyph(char) {
  return fontGlyphCoverage(char).length === 0;
}

/**
 * Audit a string for the font: reports any missing glyphs, the pixel advance
 * width and a boolean `ok`. Used by the automated glyph test.
 */
export function auditPixelText(text, scale = 1, spacing = 1) {
  const value = String(text ?? "");
  const missing = fontGlyphCoverage(value);
  return {
    text: value,
    missing,
    width: measurePixelText(value, scale, spacing),
    chars: value.length,
    ok: missing.length === 0,
  };
}

export function measurePixelText(text, scale = 1, spacing = 1) {
  const value = String(text ?? "");
  if (value.length === 0) return 0;
  return (value.length * (GLYPH_WIDTH + spacing) - spacing) * scale;
}

function drawGlyph(ctx, char, x, y, scale, color) {
  let base = char;
  let mark = null;
  if (ACCENT_MAP[char]) {
    base = ACCENT_MAP[char][0];
    mark = ACCENT_MAP[char][1];
  }
  const rows = FONT_5X7[base] ?? FONT_5X7["?"];
  ctx.fillStyle = color;
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const bits = rows[row];
    if (!bits) continue;
    for (let column = 0; column < GLYPH_WIDTH; column += 1) {
      if (bits & (1 << (GLYPH_WIDTH - 1 - column))) {
        ctx.fillRect(x + column * scale, y + row * scale, scale, scale);
      }
    }
  }
  if (mark && ACCENT_MARKS[mark]) {
    for (const [column, row] of ACCENT_MARKS[mark]) {
      ctx.fillRect(x + column * scale, y + row * scale, scale, scale);
    }
  }
}

function drawGlyphRun(ctx, text, x, y, scale, spacing, color) {
  const value = String(text ?? "").toUpperCase();
  let cursor = x;
  for (const char of value) {
    drawGlyph(ctx, char, cursor, y, scale, color);
    cursor += (GLYPH_WIDTH + spacing) * scale;
  }
}

/**
 * Draw text with the internal bitmap font. `y` is the top of the glyph cell.
 * Accented characters draw a small mark above the base glyph, so callers should
 * leave ~2*scale px of headroom.
 */
export function drawPixelText(ctx, text, x, y, options = {}) {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const spacing = options.spacing ?? 1;
  const value = String(text ?? "").toUpperCase();
  const width = measurePixelText(value, scale, spacing);
  let cursor = Math.round(x);
  if (options.align === "center") cursor = Math.round(x - width / 2);
  else if (options.align === "right") cursor = Math.round(x - width);
  if (options.shadow) drawGlyphRun(ctx, value, cursor + scale, Math.round(y) + scale, scale, spacing, options.shadow);
  drawGlyphRun(ctx, value, cursor, Math.round(y), scale, spacing, options.color ?? PALETTE.white);
}

/** Word-wrap a string to `maxWidth` logical px for the bitmap font. */
export function wrapPixelText(text, maxWidth, scale = 1, spacing = 1) {
  const words = String(text ?? "").toUpperCase().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measurePixelText(candidate, scale, spacing) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function drawPixelParagraph(ctx, text, x, y, maxWidth, options = {}) {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const spacing = options.spacing ?? 1;
  const lineHeight = options.lineHeight ?? (GLYPH_HEIGHT + 3) * scale;
  const lines = wrapPixelText(text, maxWidth, scale, spacing);
  lines.forEach((line, index) => {
    drawPixelText(ctx, line, x, y + index * lineHeight, { ...options, scale, spacing });
  });
  return lines.length;
}

/**
 * Diagnostic glyph sheet: renders every supported glyph (A-Z, a-z, 0-9 and the
 * symbol set) large and labelled so a vision reviewer can verify each bitmap.
 * Returns the drawn size. Used to write docs/office-v2/screenshots/font-sheet.png.
 */
export function drawFontSheet(ctx, options = {}) {
  const width = options.width ?? 900;
  const height = options.height ?? 400;
  const scale = Math.max(2, Math.round(options.scale ?? 4));
  const glyphW = GLYPH_WIDTH * scale;
  const glyphH = GLYPH_HEIGHT * scale;
  const groups = [
    { title: "MAIUSCULAS A - Z", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") },
    { title: "MINUSCULAS a - z", chars: "abcdefghijklmnopqrstuvwxyz".split("") },
    { title: "DIGITOS + SIMBOLOS", chars: "0123456789+-.,/$%:·".split("") },
  ];

  pxRect(ctx, 0, 0, width, height, "#0d1b2e");
  pxRect(ctx, 0, 0, width, 2, PALETTE.border);
  pxRect(ctx, 0, height - 2, width, 2, PALETTE.border);
  pxRect(ctx, 0, 0, 2, height, PALETTE.border);
  pxRect(ctx, width - 2, 0, 2, height, PALETTE.border);
  drawPixelText(ctx, "TRACE/COM · FONT 5x7 · GLYPH SHEET", width / 2, 12, {
    scale: 2,
    align: "center",
    color: PALETTE.goldHi,
  });

  const drawRaw = (text, centerX, y, color) => {
    const runW = measurePixelText(text, 1, 1);
    let cursor = Math.round(centerX - runW / 2);
    for (const char of String(text)) {
      drawGlyph(ctx, char, cursor, y, 1, color);
      cursor += GLYPH_WIDTH + 1;
    }
  };

  let cursorY = 52;
  for (const group of groups) {
    drawPixelText(ctx, group.title, 20, cursorY, { scale: 1, color: PALETTE.screenOn });
    cursorY += 14;
    const padX = 18;
    const cellW = Math.floor((width - padX * 2) / group.chars.length);
    const cellH = glyphH + 16;
    group.chars.forEach((char, index) => {
      const cx = padX + index * cellW;
      const cy = cursorY;
      pxRect(ctx, cx + 1, cy + 1, cellW - 2, cellH - 2, "#101a2b");
      pxRect(ctx, cx + 1, cy + 1, cellW - 2, 1, "rgba(255,255,255,0.07)");
      pxRect(ctx, cx + 1, cy + cellH - 2, cellW - 2, 1, "rgba(0,0,0,0.4)");
      const gx = cx + Math.round((cellW - glyphW) / 2);
      const gy = cy + 3;
      pxRect(ctx, gx, gy + glyphH, glyphW, 1, "rgba(120,150,200,0.25)");
      drawGlyph(ctx, char, gx, gy, scale, PALETTE.white);
      drawRaw(char, cx + cellW / 2, cy + glyphH + 5, PALETTE.goldHi);
    });
    cursorY += cellH + 14;
  }
  drawPixelText(ctx, "ESCALA 4x · GLIFOS VERIFICAVEIS INDIVIDUALMENTE", width / 2, height - 18, {
    scale: 1,
    align: "center",
    color: PALETTE.metal,
  });
  return { width, height };
}

/**
 * Every title drawn in the scene. The glyph test asserts each one is fully
 * covered by the bitmap font (no `?` placeholder fallback).
 */
export const PANEL_TITLES = [
  "TRACE/COM",
  "DISCIPLINA · DADOS · RESULTADOS",
  "PIXEL OFFICE V2",
  "FOCO",
  "DISCIPLINA",
  "PROCESSO",
  "RESULTADO",
  "TRADER E UM JOGO DE LONGO PRAZO",
  "PROCESSO > SORTE",
  "PROFESSOR",
  "& PESQUISA",
  "DADOS",
  "TESTES",
  "APRENDIZADO",
  "EVOLUCAO",
  "SALA DE REUNIAO",
  "PLANEJAMENTO",
  "ESTRATEGIA",
  "PERFORMANCE",
  "PROXIMOS PASSOS",
  "DATA CENTER",
  "ESTABILIDADE",
  "CONEXAO",
  "EXECUCAO",
  "SEM INTERRUPCOES",
  "RESULTADO DO DIA",
  "GANHO LIQUIDO HOJE",
  "PERDA LIQUIDA HOJE",
  "OPERACOES HOJE",
  "WINS",
  "LOSSES",
  "WIN RATE",
  "MAIOR WIN",
  "MAIOR LOSS",
  "MERCADOS",
  "ABERTOS",
  "FECHADOS",
  "TOTAL",
  "MODO",
  "PRACTICE",
  "RISCO",
  "ZERO REAL",
  "LUCRO SEMANAL",
  "LUCRO MENSAL",
  "MAPA MUNDIAL",
  "24H · GLOBAL",
  "MERCADO GLOBAL 24H",
  "OPORTUNIDADES EM TEMPO REAL",
  "DISCIPLINA TRANSFORMA ESTRATEGIA EM LIBERDADE",
  "PAUSA TAMBEM E ESTRATEGIA",
  "FLIPERAMA · DESCANSO",
  "AREA DE LAZER",
  "RELAXAR VOLTAR MAIS FORTE",
  "COZINHA",
  "CAFE ENERGIA DISCIPLINA BOM HUMOR",
  "TERRACO",
  "RESPIRA ANALISA DECIDE MELHOR",
  "BOM TRADE TAMBEM SE CELEBRA!",
  "CAFE / IDEIAS / TRADES / RESULTADOS",
  "DISCIPLINA HOJE RESULTADOS SEMPRE",
  "PEQUENAS DECISOES GRANDES RESULTADOS",
  "VISION · SHADOW · RESULT",
  "EQUITY · TEMPO REAL",
  ...SECTOR_RIBBON_LABELS,
];

/* ------------------------------------------------------------------ *
 * 8. FORMATTING
 * ------------------------------------------------------------------ */

export function formatBRL(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0,00";
  const absolute = Math.abs(number);
  const fixed = absolute.toFixed(options.digits ?? 2);
  const [integerPart, decimalPart] = fixed.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimalPart ? `${grouped},${decimalPart}` : grouped;
}

export function signedBRL(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+R$ ${formatBRL(number)}`;
  if (number < 0) return `−R$ ${formatBRL(Math.abs(number))}`;
  return "R$ 0,00";
}

/* ------------------------------------------------------------------ *
 * 9. STATION MODELS
 * ------------------------------------------------------------------ */

export function stationBadgeModel(station = {}) {
  const active = station.active !== false;
  if (!active) return { visible: false, tone: "NONE", color: null, text: "", filled: false };
  const result = String(station.result ?? "DRAW").toUpperCase();
  if (result === "WIN") {
    const pnl = Number.isFinite(Number(station.pnl)) ? Math.abs(Number(station.pnl)) : 0;
    return { visible: true, tone: "POSITIVE", color: BADGE_COLORS.WIN, text: `+R$ ${formatBRL(pnl)}`, filled: false };
  }
  if (result === "LOSS") {
    const pnl = Number.isFinite(Number(station.pnl)) ? Math.abs(Number(station.pnl)) : 0;
    return { visible: true, tone: "NEGATIVE", color: BADGE_COLORS.LOSS, text: `−R$ ${formatBRL(pnl)}`, filled: false };
  }
  return { visible: true, tone: "ZERO", color: BADGE_COLORS.DRAW, text: "R$ 0,00", filled: false };
}

/* ------------------------------------------------------------------ *
 * 10. ASSET KIT — reusable pixel-art primitives
 * ------------------------------------------------------------------ */

export function wood_desk(ctx, x, y, w, h, options = {}) {
  const depth = options.depth ?? Math.max(8, Math.round(h * 0.3));
  const frontY = y + depth;
  const frontH = h - depth;
  const inset = options.inset ?? 6;

  // ground contact shadow
  pxRect(ctx, x + 3, y + h, w - 6, 2, "rgba(0,0,0,0.4)");
  pxRect(ctx, x + 12, y + h + 2, w - 24, 1, "rgba(0,0,0,0.22)");

  // dark side faces under the sloped top edges
  pxPoly(ctx, [{ x: x + inset, y }, { x, y: frontY }, { x: x + 3, y: frontY }, { x: x + inset + 3, y }], PALETTE.woodShadow);
  pxPoly(ctx, [{ x: x + w - inset, y }, { x: x + w, y: frontY }, { x: x + w - 3, y: frontY }, { x: x + w - inset - 3, y }], PALETTE.woodShadow);

  // thick front face
  pxRect(ctx, x, frontY, w, frontH, PALETTE.woodDark);
  pxRect(ctx, x, frontY, w, 2, PALETTE.woodMid);
  pxRect(ctx, x, frontY, 3, frontH, PALETTE.woodMid);
  pxRect(ctx, x + w - 3, frontY, 3, frontH, PALETTE.woodShadow);
  pxRect(ctx, x, y + h - 2, w, 2, "#2a1a0e");

  // drawer / panel detail
  const panelTop = frontY + 3;
  const panelH = Math.max(4, frontH - 6);
  for (let index = 1; index <= 3; index += 1) {
    const gy = panelTop + Math.round((panelH * index) / 4);
    pxRect(ctx, x + 8, gy, w - 16, 1, "rgba(0,0,0,0.32)");
    pxRect(ctx, x + 8, gy + 1, w - 16, 1, "rgba(255,220,170,0.06)");
  }
  pxRect(ctx, x + Math.round(w / 2), panelTop, 1, panelH, "rgba(0,0,0,0.28)");
  pxRect(ctx, x + Math.round(w * 0.28), panelTop + Math.round(panelH * 0.55), 6, 2, PALETTE.metalDark);
  pxRect(ctx, x + Math.round(w * 0.72) - 6, panelTop + Math.round(panelH * 0.55), 6, 2, PALETTE.metalDark);

  // isometric top surface
  pxPoly(ctx, [
    { x: x + inset, y },
    { x: x + w - inset, y },
    { x: x + w, y: frontY },
    { x, y: frontY },
  ], PALETTE.wood);
  for (let index = 0; index < 3; index += 1) {
    pxRect(ctx, x + inset + 6, y + 2 + index * 3, w - inset * 2 - 12, 1, "rgba(90,58,34,0.22)");
  }
  pxRect(ctx, x + inset + 1, y, w - inset * 2 - 2, 1, PALETTE.woodHi);
  pxRect(ctx, x + inset, y, 1, 1, PALETTE.woodHi);
  pxRect(ctx, x + w - inset - 1, y, 1, 1, PALETTE.woodHi);

  return { topH: depth, frontY, frontH };
}

export function chair(ctx, x, y, options = {}) {
  const w = options.w ?? 18;
  const h = options.h ?? 18;
  const wood = options.wood ?? PALETTE.woodMid;
  const dark = options.dark ?? PALETTE.woodShadow;
  pxRect(ctx, x + 1, y, w - 2, Math.round(h * 0.6), wood);
  pxRect(ctx, x + 1, y, w - 2, 1, PALETTE.woodHi);
  pxRect(ctx, x + 1, y, 1, Math.round(h * 0.6), PALETTE.wood);
  pxRect(ctx, x + w - 2, y, 1, Math.round(h * 0.6), dark);
  pxRect(ctx, x + 3, y + 3, w - 6, 1, dark);
  pxRect(ctx, x, y + Math.round(h * 0.6), w, 3, wood);
  pxRect(ctx, x, y + Math.round(h * 0.6), w, 1, PALETTE.woodHi);
  pxRect(ctx, x + 1, y + h - 4, 2, 4, dark);
  pxRect(ctx, x + w - 3, y + h - 4, 2, 4, dark);
}

/** Visible chair back placed behind a seated agent (dark navy office chair). */
function chairBack(ctx, x, y, options = {}) {
  const w = options.w ?? 30;
  const h = options.h ?? 34;
  const shell = options.shell ?? "#1b2743";
  const shellHi = options.shellHi ?? "#2c3d63";
  const rim = options.rim ?? "#0e1730";
  pxRect(ctx, x + 1, y + 2, w - 2, h - 2, rim);
  pxRect(ctx, x + 2, y + 3, w - 4, h - 4, shell);
  pxRect(ctx, x + 2, y + 3, w - 4, 2, shellHi);
  pxRect(ctx, x + 3, y + 10, w - 6, 1, "rgba(0,0,0,0.30)");
  pxRect(ctx, x + 3, y + 20, w - 6, 1, "rgba(0,0,0,0.30)");
  pxRect(ctx, x, y, 3, h, rim);
  pxRect(ctx, x + w - 3, y, 3, h, rim);
  pxRect(ctx, x, y, 3, 2, shellHi);
  pxRect(ctx, x + w - 3, y, 3, 2, shellHi);
}

/**
 * Seated, proportional agent at reference scale (~30px wide, head ~14px).
 * Drawn from the top-left of its bounding box; the desk top is drawn later and
 * occludes only the very bottom of the torso, so head + shoulders + arms read
 * clearly above the desk line as a seated person.
 */
function drawSeatedAgent(ctx, x, y, options = {}) {
  const skin = options.skin ?? PALETTE.skin;
  const skinShade = options.skinShade ?? PALETTE.skin2;
  const shirt = options.shirt ?? PALETTE.traderNavy;
  const shirt2 = options.shirt2 ?? PALETTE.traderNavy2;
  const hair = options.hair ?? PALETTE.hair1;
  const style = (((options.style ?? 0) % 4) + 4) % 4;
  const tie = options.tie ?? null;
  const glasses = options.glasses === true;
  const face = "#2b2118";

  // arms behind the torso, hands resting on the desk line
  pxRect(ctx, x + 1, y + 24, 5, 20, shirt2);
  pxRect(ctx, x + 24, y + 24, 5, 20, shirt2);
  pxRect(ctx, x + 1, y + 41, 5, 4, skin);
  pxRect(ctx, x + 24, y + 41, 5, 4, skin);

  // torso
  pxRect(ctx, x + 6, y + 22, 18, 26, shirt);
  pxRect(ctx, x + 6, y + 22, 18, 2, shirt2);
  pxRect(ctx, x + 5, y + 24, 2, 22, shirt2);
  pxRect(ctx, x + 23, y + 24, 2, 22, shirt2);
  pxRect(ctx, x + 6, y + 47, 18, 1, shirt2);
  // collar + placket
  pxRect(ctx, x + 11, y + 22, 8, 2, skin);
  pxRect(ctx, x + 12, y + 23, 6, 3, shirt2);
  if (tie) {
    pxRect(ctx, x + 13, y + 24, 4, 2, tie);
    pxRect(ctx, x + 14, y + 26, 2, 16, tie);
  }
  // neck + head
  pxRect(ctx, x + 12, y + 17, 6, 6, skinShade);
  pxRect(ctx, x + 8, y + 2, 14, 16, skin);
  pxRect(ctx, x + 7, y + 6, 1, 8, skin);
  pxRect(ctx, x + 22, y + 6, 1, 8, skin);
  // brows + eyes
  pxRect(ctx, x + 11, y + 6, 2, 1, hair);
  pxRect(ctx, x + 18, y + 6, 2, 1, hair);
  pxRect(ctx, x + 11, y + 8, 2, 3, face);
  pxRect(ctx, x + 18, y + 8, 2, 3, face);
  // nose + mouth
  pxRect(ctx, x + 15, y + 11, 1, 2, skinShade);
  pxRect(ctx, x + 13, y + 14, 5, 1, "#8a4a3a");
  // hair variants
  if (style === 0) {
    pxRect(ctx, x + 8, y + 1, 14, 2, hair);
    pxRect(ctx, x + 7, y + 2, 16, 4, hair);
    pxRect(ctx, x + 7, y + 2, 2, 8, hair);
    pxRect(ctx, x + 21, y + 2, 2, 8, hair);
  } else if (style === 1) {
    pxRect(ctx, x + 8, y, 14, 3, hair);
    pxRect(ctx, x + 7, y + 2, 16, 3, hair);
    pxRect(ctx, x + 7, y + 4, 3, 10, hair);
  } else if (style === 2) {
    pxRect(ctx, x + 8, y + 1, 14, 3, hair);
    pxRect(ctx, x + 7, y + 3, 16, 5, hair);
    pxRect(ctx, x + 7, y + 6, 2, 12, hair);
    pxRect(ctx, x + 21, y + 6, 2, 12, hair);
  } else {
    pxRect(ctx, x + 9, y + 2, 12, 2, hair);
    pxRect(ctx, x + 8, y + 3, 3, 3, hair);
    pxRect(ctx, x + 19, y + 3, 3, 3, hair);
    pxRect(ctx, x + 13, y + 1, 4, 2, hair);
  }
  if (glasses) {
    pxRect(ctx, x + 10, y + 7, 5, 1, PALETTE.metal);
    pxRect(ctx, x + 17, y + 7, 5, 1, PALETTE.metal);
    pxRect(ctx, x + 10, y + 7, 1, 4, PALETTE.metal);
    pxRect(ctx, x + 14, y + 7, 1, 4, PALETTE.metal);
    pxRect(ctx, x + 17, y + 7, 1, 4, PALETTE.metal);
    pxRect(ctx, x + 21, y + 7, 1, 4, PALETTE.metal);
    pxRect(ctx, x + 15, y + 8, 2, 1, PALETTE.metal);
  }
  return { width: 30, height: 48 };
}

export function trader(ctx, x, y, options = {}) {
  const seed = options.variant ?? 0;
  const skins = [PALETTE.skin, PALETTE.skin2, PALETTE.skin3];
  const hairs = [PALETTE.hair1, PALETTE.hair2, PALETTE.hair3, PALETTE.hair4];
  const ties = [PALETTE.tie, "#2f7d4f", "#c0392b", null];
  const tie = options.tie !== undefined ? options.tie : ties[seed % ties.length];
  return drawSeatedAgent(ctx, x, y, {
    skin: options.skin ?? skins[seed % skins.length],
    shirt: options.shirt ?? PALETTE.traderNavy,
    shirt2: options.shirt2 ?? PALETTE.traderNavy2,
    hair: options.hair ?? hairs[seed % hairs.length],
    style: seed % 4,
    tie,
    glasses: options.glasses ?? (seed % 5 === 0),
  });
}

export function critic(ctx, x, y, options = {}) {
  const seed = options.variant ?? 1;
  const skins = [PALETTE.skin2, PALETTE.skin, PALETTE.skin3];
  const hairs = [PALETTE.hair2, PALETTE.hair1, PALETTE.hair3, PALETTE.hair4];
  return drawSeatedAgent(ctx, x, y, {
    skin: options.skin ?? skins[seed % skins.length],
    shirt: options.shirt ?? PALETTE.criticPurple,
    shirt2: options.shirt2 ?? PALETTE.criticPurple2,
    hair: options.hair ?? hairs[seed % hairs.length],
    style: (seed + 2) % 4,
    tie: options.tie ?? (seed % 2 === 0 ? PALETTE.criticPurple2 : null),
    glasses: options.glasses ?? true,
  });
}

export function monitor(ctx, x, y, options = {}) {
  const w = options.w ?? 18;
  const h = options.h ?? 14;
  pxRect(ctx, x, y + h - 2, w, 2, PALETTE.woodShadow);
  pxRect(ctx, x + w / 2 - 1, y + h - 4, 2, 2, PALETTE.metalDark);
  pxRect(ctx, x, y, w, h - 3, PALETTE.screenBezel);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 5, options.color ?? PALETTE.screen);
  if (options.on !== false) {
    for (let row = 0; row < 3; row += 1) {
      const lineW = Math.max(2, (w - 6) - row * 3);
      pxRect(ctx, x + 3, y + 3 + row * 2, lineW, 1, row === 1 ? PALETTE.screenGreen : PALETTE.screenOn);
    }
  }
  pxRect(ctx, x, y, w, 1, PALETTE.metal);
}

export function plaque(ctx, x, y, w, h, text, options = {}) {
  pxRect(ctx, x, y, w, h, PALETTE.woodShadow);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 2, options.wood ?? PALETTE.woodDark);
  pxRect(ctx, x + 1, y + 1, w - 2, 1, PALETTE.woodHi);
  pxRect(ctx, x + 1, y + 1, 1, h - 2, PALETTE.wood);
  pxRect(ctx, x + w - 2, y + 1, 1, h - 2, PALETTE.woodShadow);
  pxRect(ctx, x + 1, y + h - 2, w - 2, 1, "#2a1a0e");
  pxRect(ctx, x + 3, y + 3, w - 6, 1, "rgba(0,0,0,0.3)");
  const innerW = w - 8;
  let scale = options.scale ?? 2;
  while (scale > 1 && measurePixelText(text, scale, 1) > innerW) scale -= 1;
  const lines = measurePixelText(text, scale, 1) > innerW ? wrapPixelText(text, innerW, scale, 1) : [String(text ?? "").toUpperCase()];
  const lineHeight = (GLYPH_HEIGHT + 2) * scale;
  const blockH = lines.length * lineHeight - 2 * scale;
  const startY = y + Math.round((h - blockH) / 2);
  lines.forEach((line, index) => {
    const ty = startY + index * lineHeight;
    drawPixelText(ctx, line, x + w / 2, ty + 1, { scale, align: "center", color: "rgba(255,220,170,0.32)" });
    drawPixelText(ctx, line, x + w / 2, ty, { scale, align: "center", color: options.ink ?? "#2c1806" });
  });
}

/**
 * Floating P&L pixel text. No filled box, no border, no pointer: only the
 * coloured glyphs with a soft dark outline and a 1px translucent backing.
 */
export function pnl_badge(ctx, centerX, y, text, tone, options = {}) {
  const color = options.color ?? (tone === "POSITIVE" ? BADGE_COLORS.WIN : tone === "NEGATIVE" ? BADGE_COLORS.LOSS : BADGE_COLORS.DRAW);
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const width = measurePixelText(text, scale, 1);
  const height = GLYPH_HEIGHT * scale;
  const x = Math.round(centerX - width / 2);
  const top = Math.round(y);
  const outline = options.outline ?? "rgba(2,6,14,0.92)";

  // optional 1px darker translucent backing behind the glyphs only (opt-in)
  if (options.backing === true) pxRect(ctx, x - 3, top - 2, width + 6, height + 4, "rgba(4,8,16,0.5)");
  // soft drop shadow
  drawPixelText(ctx, text, x + 1, top + 1, { scale, color: "rgba(0,0,0,0.45)" });
  // 1px dark outline (4-neighbour)
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    drawPixelText(ctx, text, x + dx, top + dy, { scale, color: outline });
  }
  // glyphs
  drawPixelText(ctx, text, x, top, { scale, color });
  return { x, y: top, width, height, filled: false };
}

/**
 * Cream pixel-art sofa: backrest, two armrests, seat cushions, base and a soft
 * ground shadow. Solid fills with #b9a882 outlines — no dotted/waffle pattern.
 */
export function sofa(ctx, x, y, w, options = {}) {
  const h = options.h ?? 30;
  const back = options.color ?? PALETTE.sofa;
  const outline = options.outline ?? PALETTE.sofaDark;
  const cushion = options.color3 ?? PALETTE.sofaHi;
  const seam = "#8f7c5a";
  const armW = Math.max(7, Math.round(w * 0.075));
  const backH = Math.round(h * 0.52);
  const seatY = y + backH;
  const seatH = Math.max(5, Math.round(h * 0.3));
  const baseY = seatY + seatH;
  const baseH = Math.max(2, y + h - baseY);

  pxRect(ctx, x + 3, y + h, w - 6, 2, "rgba(0,0,0,0.35)");
  pxRect(ctx, x + 10, y + h + 2, w - 20, 1, "rgba(0,0,0,0.2)");

  // backrest
  pxRect(ctx, x + armW - 2, y, w - (armW - 2) * 2, backH, back);
  pxRect(ctx, x + armW - 2, y, w - (armW - 2) * 2, 1, cushion);
  pxRect(ctx, x + armW - 2, y, 1, backH, outline);
  pxRect(ctx, x + w - armW + 1, y, 1, backH, outline);
  pxRect(ctx, x + Math.round(w / 2), y + 3, 1, backH - 5, outline);
  // button tufts on the backrest
  pxRect(ctx, x + Math.round(w * 0.32), y + 4, 1, 1, seam);
  pxRect(ctx, x + Math.round(w * 0.68), y + 4, 1, 1, seam);

  // armrests
  const armTop = y + Math.round(backH * 0.45);
  const armH = y + h - armTop - baseH;
  pxRect(ctx, x, armTop, armW, armH, back);
  pxRect(ctx, x, armTop, armW, 1, cushion);
  pxRect(ctx, x, armTop, 1, armH, outline);
  pxRect(ctx, x + armW - 1, armTop, 1, armH, outline);
  pxRect(ctx, x + w - armW, armTop, armW, armH, back);
  pxRect(ctx, x + w - armW, armTop, armW, 1, cushion);
  pxRect(ctx, x + w - 1, armTop, 1, armH, outline);
  pxRect(ctx, x + w - armW, armTop, 1, armH, outline);

  // seat cushions
  pxRect(ctx, x + armW, seatY, w - armW * 2, seatH, cushion);
  pxRect(ctx, x + armW, seatY, w - armW * 2, 1, back);
  pxRect(ctx, x + armW, seatY + seatH - 1, w - armW * 2, 1, outline);
  const cushions = Math.max(2, Math.floor(w / 30));
  for (let index = 1; index < cushions; index += 1) {
    const cx = x + armW + Math.round((w - armW * 2) * (index / cushions));
    pxRect(ctx, cx, seatY + 1, 1, seatH - 2, outline);
  }

  // base + feet
  pxRect(ctx, x + 2, baseY, w - 4, baseH, outline);
  pxRect(ctx, x + 2, baseY, w - 4, 1, seam);
  pxRect(ctx, x + 5, y + h - 1, 3, 1, PALETTE.woodShadow);
  pxRect(ctx, x + w - 8, y + h - 1, 3, 1, PALETTE.woodShadow);
}

/** Cream pixel-art armchair (single seat): backrest, arms, cushion, base. */
export function armchair(ctx, x, y, options = {}) {
  const w = options.w ?? 32;
  const h = options.h ?? 30;
  const back = options.color ?? PALETTE.sofa;
  const outline = options.outline ?? PALETTE.sofaDark;
  const cushion = options.color3 ?? PALETTE.sofaHi;
  const armW = 7;
  const backH = Math.round(h * 0.55);
  const seatY = y + backH;
  const seatH = Math.max(5, Math.round(h * 0.28));
  const baseY = seatY + seatH;
  const baseH = Math.max(2, y + h - baseY);

  pxRect(ctx, x + 2, y + h, w - 4, 2, "rgba(0,0,0,0.35)");
  // backrest
  pxRect(ctx, x + 3, y, w - 6, backH, back);
  pxRect(ctx, x + 3, y, w - 6, 1, cushion);
  pxRect(ctx, x + 3, y, 1, backH, outline);
  pxRect(ctx, x + w - 4, y, 1, backH, outline);
  // armrests
  const armTop = y + Math.round(backH * 0.5);
  const armH = y + h - armTop - baseH;
  pxRect(ctx, x, armTop, armW, armH, back);
  pxRect(ctx, x, armTop, armW, 1, cushion);
  pxRect(ctx, x, armTop, 1, armH, outline);
  pxRect(ctx, x + w - armW, armTop, armW, armH, back);
  pxRect(ctx, x + w - armW, armTop, armW, 1, cushion);
  pxRect(ctx, x + w - 1, armTop, 1, armH, outline);
  // seat cushion
  pxRect(ctx, x + armW, seatY, w - armW * 2, seatH, cushion);
  pxRect(ctx, x + armW, seatY, w - armW * 2, 1, back);
  pxRect(ctx, x + armW, seatY + seatH - 1, w - armW * 2, 1, outline);
  // base + feet
  pxRect(ctx, x + 2, baseY, w - 4, baseH, outline);
  pxRect(ctx, x + 2, baseY, w - 4, 1, "#8f7c5a");
  pxRect(ctx, x + 4, y + h - 1, 3, 1, PALETTE.woodShadow);
  pxRect(ctx, x + w - 7, y + h - 1, 3, 1, PALETTE.woodShadow);
}

export function coffee_table(ctx, x, y, w, options = {}) {
  const h = options.h ?? 14;
  pxRect(ctx, x, y, w, Math.round(h * 0.5), PALETTE.wood);
  pxRect(ctx, x, y, w, 1, PALETTE.woodHi);
  pxRect(ctx, x + 2, y + Math.round(h * 0.5), 2, Math.round(h * 0.5), PALETTE.woodDark);
  pxRect(ctx, x + w - 4, y + Math.round(h * 0.5), 2, Math.round(h * 0.5), PALETTE.woodDark);
  if (options.items !== false) {
    pxRect(ctx, x + 6, y - 4, 3, 4, PALETTE.white);
    pxRect(ctx, x + 7, y - 5, 1, 1, PALETTE.white);
    pxRect(ctx, x + w - 14, y - 3, 6, 3, PALETTE.metalDark);
  }
}

export function pool_table(ctx, x, y, w, h, options = {}) {
  const frame = options.frame ?? PALETTE.woodMid;
  const rail = options.rail ?? PALETTE.wood;
  pxRect(ctx, x + 3, y + h, w - 6, 2, PALETTE.shadow);
  pxRect(ctx, x, y, w, h, frame);
  pxRect(ctx, x + 2, y + 2, w - 4, h - 4, rail);
  pxRect(ctx, x + 6, y + 6, w - 12, h - 12, PALETTE.felt);
  pxRect(ctx, x + 6, y + 6, w - 12, 1, PALETTE.feltDark);
  const pockets = [[8, 8], [w / 2, 7], [w - 8, 8], [8, h - 8], [w / 2, h - 7], [w - 8, h - 8]];
  for (const [px, py] of pockets) pxRect(ctx, x + px - 2, y + py - 2, 4, 4, "#0c0c0c");
  const ballColors = ["#f4f4f4", "#e04b3a", "#f0b429", "#1f4f8f", "#2f7d4f", "#6a3fb0", "#e07a3a"];
  const spots = [[0.3, 0.4], [0.45, 0.5], [0.6, 0.4], [0.52, 0.62], [0.7, 0.55], [0.38, 0.6]];
  spots.forEach(([fx, fy], index) => {
    pxRect(ctx, x + 6 + (w - 12) * fx, y + 6 + (h - 12) * fy, 3, 3, ballColors[index % ballColors.length]);
  });
  pxRect(ctx, x + w - 20, y + h - 12, 16, 1, PALETTE.woodShadow);
  pxRect(ctx, x + w - 20, y + h - 11, 2, 1, PALETTE.white);
}

export function plant_small(ctx, x, y, options = {}) {
  const scale = options.scale ?? 1;
  const potW = 10 * scale;
  const potH = 8 * scale;
  pxRect(ctx, x, y, potW, potH, PALETTE.pot);
  pxRect(ctx, x, y, potW, 1, PALETTE.potDark);
  pxRect(ctx, x + potW - 1, y, 1, potH, PALETTE.potDark);
  const cx = x + potW / 2;
  const leaf = options.leaf ?? PALETTE.plant;
  const leaf2 = options.leaf2 ?? PALETTE.plantHi;
  pxRect(ctx, cx - 1, y - 10 * scale, 2, 10 * scale, PALETTE.plantDark);
  pxRect(ctx, cx - 6 * scale, y - 8 * scale, 5 * scale, 3 * scale, leaf);
  pxRect(ctx, cx + 1 * scale, y - 12 * scale, 5 * scale, 3 * scale, leaf2);
  pxRect(ctx, cx - 4 * scale, y - 14 * scale, 4 * scale, 3 * scale, leaf);
  pxRect(ctx, cx + 1 * scale, y - 6 * scale, 4 * scale, 2 * scale, leaf2);
}

export function plant_large(ctx, x, y, options = {}) {
  const scale = options.scale ?? 1;
  const potW = 14 * scale;
  const potH = 10 * scale;
  pxRect(ctx, x, y, potW, potH, PALETTE.pot);
  pxRect(ctx, x, y, potW, 2 * scale, PALETTE.potDark);
  pxRect(ctx, x + potW - 2 * scale, y, 2 * scale, potH, PALETTE.potDark);
  const cx = x + potW / 2;
  pxRect(ctx, cx - 1 * scale, y - 20 * scale, 2 * scale, 20 * scale, PALETTE.plantDark);
  const leaf = options.leaf ?? PALETTE.plant;
  const leaf2 = options.leaf2 ?? PALETTE.plantHi;
  const leaves = [
    [-10, -18, 7, 4, leaf], [2, -22, 8, 4, leaf2], [-8, -26, 6, 4, leaf2],
    [3, -14, 7, 4, leaf], [-11, -12, 6, 3, leaf2], [1, -8, 6, 3, leaf],
    [-6, -32, 5, 4, leaf2], [0, -34, 5, 3, leaf],
  ];
  for (const [dx, dy, lw, lh, color] of leaves) pxRect(ctx, cx + dx * scale, y + dy * scale, lw * scale, lh * scale, color);
}

export function bookshelf(ctx, x, y, w, h, options = {}) {
  pxRect(ctx, x, y, w, h, PALETTE.woodDark);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 2, PALETTE.woodMid);
  pxRect(ctx, x + 1, y + 1, w - 2, 1, PALETTE.wood);
  const shelves = options.shelves ?? 3;
  const shelfH = Math.floor((h - 4) / shelves);
  const bookColors = ["#c94b3a", "#3a6bc9", "#3fa85f", "#e0a03a", "#8a5ac9", "#3fb0b0", "#c9c0a0", "#d96a3a"];
  const seed = options.seed ?? 1;
  for (let shelf = 0; shelf < shelves; shelf += 1) {
    const sy = y + 2 + shelf * shelfH;
    pxRect(ctx, x + 2, sy + shelfH - 2, w - 4, 2, PALETTE.woodDark);
    let bx = x + 3;
    let index = 0;
    while (bx < x + w - 5) {
      const bw = 2 + ((seed + shelf * 7 + index * 3) % 3);
      const bh = shelfH - 5 - ((seed + index) % 3);
      pxRect(ctx, bx, sy + shelfH - 2 - bh, bw, bh, bookColors[(seed + shelf + index) % bookColors.length]);
      pxRect(ctx, bx, sy + shelfH - 2 - bh, bw, 1, "rgba(255,255,255,0.2)");
      bx += bw + 1;
      index += 1;
    }
  }
}

export function lamp(ctx, x, y, options = {}) {
  const height = options.height ?? 34;
  const color = options.color ?? PALETTE.amber;
  lightPool(ctx, x, y - height + 6, options.pool ?? 42, color, options.alpha ?? 0.16);
  pxRect(ctx, x - 1, y - 2, 3, 2, PALETTE.metalDark);
  pxRect(ctx, x, y - height, 1, height - 2, PALETTE.metalDark);
  pxRect(ctx, x - 6, y - height, 13, 6, color);
  pxRect(ctx, x - 6, y - height, 13, 1, PALETTE.goldHi);
  pxRect(ctx, x - 6, y - height + 5, 13, 1, PALETTE.amberSoft);
}

export function wall_sconce(ctx, x, y, options = {}) {
  const color = options.color ?? PALETTE.amber;
  lightPool(ctx, x, y + 8, options.pool ?? 34, color, options.alpha ?? 0.13);
  pxRect(ctx, x - 1, y - 2, 3, 4, PALETTE.goldDark);
  pxRect(ctx, x - 5, y + 2, 11, 3, color);
  pxRect(ctx, x - 5, y + 2, 11, 1, PALETTE.goldHi);
}

export function wall_lamp(ctx, x, y, w, h, options = {}) {
  const tube = options.tube ?? "#f0c88a";
  const core = options.core ?? "#fff0d0";
  lightPool(ctx, x + w / 2, y + h + 2, options.pool ?? Math.round(w * 0.85), PALETTE.amber, options.alpha ?? 0.14);
  pxRect(ctx, x - 3, y - 3, w + 6, h + 3, "#2e2116");
  pxRect(ctx, x - 3, y - 3, w + 6, 1, "#5a4028");
  pxRect(ctx, x - 3, y + h, w + 6, 1, "#140d06");
  pxRect(ctx, x, y, w, h, tube);
  pxRect(ctx, x, y, w, 1, core);
  pxRect(ctx, x + 2, y + 2, w - 4, Math.max(1, h - 5), core);
  pxRect(ctx, x, y + h - 2, w, 2, "#b8823f");
  warmOverlay(ctx, x - 8, y - 8, w + 16, h + 16, "#ffd8a0", 0.12);
}

export function rug(ctx, x, y, w, h, options = {}) {
  const base = options.color ?? PALETTE.rugRed;
  const trim = options.trim ?? PALETTE.gold;
  const inner = options.inner ?? PALETTE.rugRedHi;
  pxRect(ctx, x, y, w, h, base);
  pxRect(ctx, x, y, w, 1, trim);
  pxRect(ctx, x, y + h - 1, w, 1, trim);
  pxRect(ctx, x, y, 1, h, trim);
  pxRect(ctx, x + w - 1, y, 1, h, trim);
  pxRect(ctx, x + 3, y + 3, w - 6, h - 6, inner);
  pxRect(ctx, x + 6, y + 6, w - 12, h - 12, base);
  pxRect(ctx, x + 6, y + 6, w - 12, 1, trim);
  pxRect(ctx, x + 6, y + h - 7, w - 12, 1, trim);
}

/**
 * Lounge rug: solid field, double border and a slim diamond motif drawn with
 * lines only — no dotted / waffle grid.
 */
function patterned_rug(ctx, x, y, w, h, options = {}) {
  const base = options.color ?? PALETTE.rugCream;
  const border = options.border ?? (base === PALETTE.rugBlue ? PALETTE.gold : PALETTE.sofaDark);
  const accent = options.accent ?? PALETTE.rugRed;
  const inner = options.inner ?? base;
  pxRect(ctx, x + 3, y + 3, w, h, "rgba(0,0,0,0.28)");
  pxRect(ctx, x, y, w, h, base);
  // outer border
  pxRect(ctx, x, y, w, 2, border);
  pxRect(ctx, x, y + h - 2, w, 2, border);
  pxRect(ctx, x, y, 2, h, border);
  pxRect(ctx, x + w - 2, y, 2, h, border);
  // inner field + accent pinstripe
  pxRect(ctx, x + 4, y + 4, w - 8, h - 8, inner);
  pxRect(ctx, x + 6, y + 6, w - 12, 1, accent);
  pxRect(ctx, x + 6, y + h - 7, w - 12, 1, accent);
  pxRect(ctx, x + 6, y + 6, 1, h - 12, accent);
  pxRect(ctx, x + w - 7, y + 6, 1, h - 12, accent);
  // slim diamond motif (lines only)
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.max(6, Math.min(w * 0.3, 34));
  const ry = Math.max(5, Math.min(h * 0.32, 18));
  pxLine(ctx, cx, cy - ry, cx + rx, cy, accent, 1);
  pxLine(ctx, cx + rx, cy, cx, cy + ry, accent, 1);
  pxLine(ctx, cx, cy + ry, cx - rx, cy, accent, 1);
  pxLine(ctx, cx - rx, cy, cx, cy - ry, accent, 1);
  pxLine(ctx, cx, cy - Math.round(ry * 0.5), cx + Math.round(rx * 0.5), cy, accent, 1);
  pxLine(ctx, cx + Math.round(rx * 0.5), cy, cx, cy + Math.round(ry * 0.5), accent, 1);
  pxLine(ctx, cx, cy + Math.round(ry * 0.5), cx - Math.round(rx * 0.5), cy, accent, 1);
  pxLine(ctx, cx - Math.round(rx * 0.5), cy, cx, cy - Math.round(ry * 0.5), accent, 1);
  pxRect(ctx, cx - 1, cy - 1, 3, 3, accent);
}

export function kitchen_counter(ctx, x, y, w, h, options = {}) {
  pxRect(ctx, x, y, w, 4, PALETTE.metal);
  pxRect(ctx, x, y, w, 1, PALETTE.white);
  pxRect(ctx, x, y + 4, w, h - 4, PALETTE.metalDark);
  pxRect(ctx, x, y + 4, w, 1, PALETTE.metalDark);
  const cabinets = Math.max(2, Math.floor(w / 22));
  for (let index = 1; index < cabinets; index += 1) {
    const cx = x + Math.round((w * index) / cabinets);
    pxRect(ctx, cx, y + 4, 1, h - 4, PALETTE.metal);
  }
  for (let index = 0; index < cabinets; index += 1) {
    const cx = x + Math.round((w * index) / cabinets) + 6;
    pxRect(ctx, cx, y + 7, 6, 1, PALETTE.metal);
  }
  pxRect(ctx, x + 8, y - 5, 8, 5, PALETTE.metalDark);
  pxRect(ctx, x + 9, y - 4, 6, 2, PALETTE.metal);
  pxRect(ctx, x + 22, y - 3, 3, 3, PALETTE.red);
  pxRect(ctx, x + 26, y - 3, 3, 3, PALETTE.green);
}

export function fridge(ctx, x, y, w, h, options = {}) {
  pxRect(ctx, x, y, w, h, PALETTE.metal);
  pxRect(ctx, x, y, w, 1, PALETTE.white);
  pxRect(ctx, x, y + Math.round(h * 0.32), w, 2, PALETTE.metalDark);
  pxRect(ctx, x + w - 5, y + 4, 2, Math.round(h * 0.32) - 6, PALETTE.metalDark);
  pxRect(ctx, x + w - 5, y + Math.round(h * 0.32) + 4, 2, Math.round(h * 0.6), PALETTE.metalDark);
  pxRect(ctx, x, y + h - 1, w, 1, PALETTE.metalDark);
}

export function research_desk(ctx, x, y, w, h, options = {}) {
  wood_desk(ctx, x, y, w, h, { depth: 6, inset: 4 });
  pxRect(ctx, x + 4, y - 3, 12, 4, PALETTE.white);
  pxRect(ctx, x + 5, y - 2, 10, 1, PALETTE.metalDark);
  pxRect(ctx, x + 18, y - 2, 8, 3, PALETTE.ink);
  if (options.monitor !== false) monitor(ctx, x + w - 22, y - 14, { w: 16, h: 12 });
}

/**
 * Warm-wood staircase with visible treads + risers, a side stringer and a
 * railing (posts + handrail). `direction` is the ascending side.
 */
export function stairs(ctx, x, y, w, h, options = {}) {
  const direction = options.direction ?? "right";
  const steps = options.steps ?? 7;
  const wood = PALETTE.wood;
  const woodHi = PALETTE.woodHi;
  const woodMid = PALETTE.woodMid;
  const woodDark = PALETTE.woodDark;
  const shadow = PALETTE.woodShadow;
  const stepW = w / steps;
  const stepH = h / steps;
  const rising = direction === "right"; // steps get higher toward +x

  // floor shadow under the staircase
  pxRect(ctx, x + 2, y + h, w - 4, 2, "rgba(0,0,0,0.35)");

  // side stringer: solid triangle under the steps
  const apexX = rising ? x + w : x;
  const baseLeft = rising ? x : x + w;
  pxPoly(ctx, [{ x: baseLeft, y: y + h }, { x: apexX, y: y + h }, { x: apexX, y }], woodMid);

  for (let index = 0; index < steps; index += 1) {
    const level = rising ? index : steps - 1 - index;
    const sx = x + index * stepW;
    const sy = y + h - (level + 1) * stepH;
    // riser (front face of the step)
    pxRect(ctx, sx, sy, stepW, stepH, woodDark);
    // tread (top surface) with warm highlight
    pxRect(ctx, sx, sy, stepW, 2, woodHi);
    pxRect(ctx, sx, sy + 2, stepW, Math.max(1, stepH - 2), wood);
    // nosing shadow
    pxRect(ctx, sx, sy + stepH - 1, stepW, 1, shadow);
    // vertical edge between steps
    pxRect(ctx, rising ? sx + stepW - 1 : sx, sy, 1, stepH, shadow);
  }

  // stringer outline along the slope
  if (rising) {
    pxLine(ctx, x, y + h, x + w, y, shadow, 2);
    pxRect(ctx, x + w - 3, y, 3, h, woodDark);
  } else {
    pxLine(ctx, x, y, x + w, y + h, shadow, 2);
    pxRect(ctx, x, y, 3, h, woodDark);
  }

  // railing: posts at every other step + a handrail parallel to the slope
  const railH = Math.max(10, Math.round(h * 0.16));
  for (let index = 0; index < steps; index += 2) {
    const level = rising ? index : steps - 1 - index;
    const px = x + index * stepW + Math.round(stepW / 2);
    const py = y + h - (level + 1) * stepH;
    pxRect(ctx, px, py - railH, 2, railH, woodDark);
    pxRect(ctx, px, py - railH, 2, 1, woodHi);
  }
  if (rising) {
    pxLine(ctx, x + stepW / 2, y + h - railH - Math.round(stepH / 2), x + w - stepW / 2, y + stepH - railH, wood, 2);
  } else {
    pxLine(ctx, x + stepW / 2, y + stepH - railH, x + w - stepW / 2, y + h - railH - Math.round(stepH / 2), wood, 2);
  }
}

export function world_map(ctx, x, y, w, h, options = {}) {
  pxRect(ctx, x, y, w, h, "#08131f");
  pxRect(ctx, x, y, w, h, "rgba(24,66,110,0.30)");
  const land = options.land ?? "#1d5a9a";
  const landHi = options.landHi ?? "#2f78bc";
  const blob = (fx, fy, fw, fh) => {
    const bx = x + Math.round(w * fx);
    const by = y + Math.round(h * fy);
    const bw = Math.max(2, Math.round(w * fw));
    const bh = Math.max(2, Math.round(h * fh));
    pxRect(ctx, bx, by, bw, bh, land);
    if (bw > 2 && bh > 2) pxRect(ctx, bx + 1, by + 1, bw - 2, bh - 2, landHi);
  };
  // North America
  blob(0.10, 0.12, 0.17, 0.17);
  blob(0.05, 0.24, 0.12, 0.13);
  blob(0.16, 0.28, 0.11, 0.15);
  blob(0.21, 0.09, 0.11, 0.08);
  // Central America
  blob(0.20, 0.42, 0.07, 0.06);
  // South America
  blob(0.24, 0.50, 0.10, 0.15);
  blob(0.26, 0.63, 0.08, 0.16);
  blob(0.28, 0.78, 0.05, 0.10);
  // Europe
  blob(0.44, 0.12, 0.11, 0.10);
  blob(0.47, 0.21, 0.08, 0.08);
  // Africa
  blob(0.44, 0.34, 0.13, 0.15);
  blob(0.47, 0.47, 0.10, 0.17);
  blob(0.50, 0.63, 0.07, 0.12);
  // Asia
  blob(0.56, 0.10, 0.23, 0.16);
  blob(0.68, 0.24, 0.17, 0.12);
  blob(0.60, 0.30, 0.11, 0.09);
  blob(0.62, 0.39, 0.06, 0.08);
  blob(0.74, 0.36, 0.09, 0.06);
  // Australia
  blob(0.78, 0.62, 0.11, 0.11);
  blob(0.88, 0.70, 0.04, 0.05);
  // trade markers
  const dots = [[0.18, 0.30], [0.28, 0.60], [0.50, 0.30], [0.54, 0.55], [0.72, 0.30], [0.82, 0.66]];
  for (const [fx, fy] of dots) {
    pxRect(ctx, x + w * fx - 1, y + h * fy - 1, 3, 3, PALETTE.amber);
    pxRect(ctx, x + w * fx, y + h * fy, 1, 1, PALETTE.white);
  }
}

export function daily_board(ctx, x, y, w, h, daily = {}) {
  const pnl = Number(daily.pnl ?? 578.76);
  const positive = pnl >= 0;
  pxRect(ctx, x, y, w, h, PALETTE.woodDark);
  pxRect(ctx, x + 2, y + 2, w - 4, h - 4, PALETTE.border);
  pxRect(ctx, x + 4, y + 4, w - 8, h - 8, "#0b1728");
  pxRect(ctx, x + 4, y + 4, w - 8, 1, "rgba(255,255,255,0.06)");
  pxRect(ctx, x + 6, y + 6, w - 12, 22, "#122340");
  drawPixelText(ctx, "RESULTADO DO DIA", x + w / 2, y + 11, { scale: 2, align: "center", color: PALETTE.white });

  const bigScale = 5;
  drawPixelText(ctx, signedBRL(pnl), x + w / 2, y + 32, {
    scale: bigScale,
    align: "center",
    color: positive ? PALETTE.green : PALETTE.red,
    shadow: "rgba(0,0,0,0.6)",
  });
  drawPixelText(ctx, positive ? "GANHO LIQUIDO HOJE" : "PERDA LIQUIDA HOJE", x + w / 2, y + 70, {
    scale: 1,
    align: "center",
    color: PALETTE.metal,
  });

  const metrics = [
    ["OPERACOES HOJE", String(daily.ops ?? 21)],
    ["WINS", String(daily.wins ?? 16)],
    ["LOSSES", String(daily.losses ?? 5)],
    ["WIN RATE", `${Number(daily.winRate ?? 76.2).toFixed(1)}%`],
    ["MAIOR WIN", `+R$ ${formatBRL(daily.best ?? 24.5)}`],
    ["MAIOR LOSS", `−R$ ${formatBRL(Math.abs(daily.worst ?? 10))}`],
  ];
  const metricX = x + 14;
  const metricY = y + 96;
  metrics.forEach(([label, value], index) => {
    const rowY = metricY + index * 16;
    drawPixelText(ctx, label, metricX, rowY, { scale: 1, color: PALETTE.metal });
    drawPixelText(ctx, value, metricX + 100, rowY, {
      scale: 1,
      align: "right",
      color: label === "MAIOR WIN" ? PALETTE.green : label === "MAIOR LOSS" ? PALETTE.red : PALETTE.white,
    });
    if (index < metrics.length - 1) pxRect(ctx, metricX, rowY + 12, 104, 1, "rgba(120,150,200,0.14)");
  });

  const chartX = x + 136;
  const chartY = y + 96;
  const chartW = 148;
  const chartH = 86;
  pxRect(ctx, chartX, chartY, chartW, chartH, "#08121f");
  for (let gx = 0; gx <= 4; gx += 1) pxRect(ctx, chartX + (chartW / 4) * gx, chartY, 1, chartH, "rgba(90,130,190,0.16)");
  for (let gy = 0; gy <= 4; gy += 1) pxRect(ctx, chartX, chartY + (chartH / 4) * gy, chartW, 1, "rgba(90,130,190,0.16)");
  const points = [0.18, 0.32, 0.26, 0.44, 0.4, 0.58, 0.52, 0.7, 0.66, 0.84, 0.78, 0.92];
  let previous = null;
  points.forEach((value, index) => {
    const px = chartX + (chartW / (points.length - 1)) * index;
    const py = chartY + chartH - value * chartH;
    if (previous) pxLine(ctx, previous.x, previous.y, px, py, PALETTE.green, 2);
    previous = { x: px, y: py };
  });
  points.forEach((value, index) => {
    const px = chartX + (chartW / (points.length - 1)) * index;
    const py = chartY + chartH - value * chartH;
    pxRect(ctx, px - 1, py - 1, 3, 3, PALETTE.green);
  });
  const axis = ["09:00", "12:00", "15:00", "18:00"];
  axis.forEach((label, index) => {
    drawPixelText(ctx, label, chartX + (chartW / (axis.length - 1)) * index, chartY + chartH + 4, {
      scale: 1,
      align: index === 0 ? "left" : index === axis.length - 1 ? "right" : "center",
      color: PALETTE.metal,
    });
  });
  drawPixelText(ctx, "EQUITY · TEMPO REAL", chartX, chartY - 10, { scale: 1, color: PALETTE.goldHi });

  // right mini bar block keeps the board from feeling hollow
  const barsX = x + 296;
  const barsY = y + 100;
  pxRect(ctx, barsX, barsY, 78, 76, "#0a1526");
  pxRect(ctx, barsX, barsY, 78, 1, "rgba(255,255,255,0.06)");
  const bars = [0.4, 0.55, 0.48, 0.7, 0.62, 0.86];
  bars.forEach((value, index) => {
    const bx = barsX + 6 + index * 12;
    const bh = Math.round(value * 54);
    pxRect(ctx, bx, barsY + 64 - bh, 8, bh, index === bars.length - 1 ? PALETTE.green : PALETTE.bandBlue);
    pxRect(ctx, bx, barsY + 64 - bh, 8, 1, PALETTE.screenOn);
  });
  pxRect(ctx, barsX + 6, barsY + 66, 66, 1, "rgba(120,150,200,0.3)");
  drawPixelText(ctx, "SEMANA", barsX + 39, barsY + 70, { scale: 1, align: "center", color: PALETTE.goldHi });
}

/* ------------------------------------------------------------------ *
 * 11. STATION RENDERER
 * ------------------------------------------------------------------ */

export function drawStation(ctx, x, y, station = {}) {
  const w = station.w ?? STATION_DESK_WIDTH;
  const h = station.h ?? STATION_DESK_HEIGHT;
  const active = station.active !== false;
  const seed = hashString(station.symbol ?? "X");
  const badge = stationBadgeModel(station);

  // keep the desk low so head + shoulders + arms stay above the desk line
  const deskTop = y + Math.round(h * 0.64);
  const deskH = y + h - deskTop;
  const depth = Math.min(7, Math.max(5, Math.round(deskH * 0.22)));
  const agentY = y + 24;
  const agentLeft = x + Math.round(w / 2) - 33;
  const agentRight = x + Math.round(w / 2) + 3;

  // ground contact shadow
  pxRect(ctx, x + 3, y + h, w - 6, 2, "rgba(0,0,0,0.4)");
  pxRect(ctx, x + 12, y + h + 2, w - 24, 1, "rgba(0,0,0,0.22)");

  if (active) {
    chairBack(ctx, agentLeft - 1, y + 18, { w: 32, h: 36 });
    chairBack(ctx, agentRight - 1, y + 18, { w: 32, h: 36 });
    trader(ctx, agentLeft, agentY, { variant: seed % 6 });
    critic(ctx, agentRight, agentY, { variant: (seed >> 3) % 6 });
  }

  wood_desk(ctx, x, deskTop, w, deskH, { depth, inset: 6 });

  if (active) monitor(ctx, x + Math.round(w / 2) - 10, deskTop + 1, { w: 20, h: Math.max(8, depth - 2) });

  const frontY = deskTop + depth;
  const plaqueY = frontY + 2;
  const plaqueH = clamp(y + h - plaqueY - 2, 10, 22);
  plaque(ctx, x + 8, plaqueY, w - 16, plaqueH, station.symbol ?? "", { ink: "#2c1806" });

  if (badge.visible) pnl_badge(ctx, x + w / 2, y - 8, badge.text, badge.tone, { scale: 1 });
  return badge;
}

/** Draw only the master EUR/USD station for isolated review. */
export function drawMasterStation(ctx, x = 0, y = 0, options = {}) {
  const scale = options.scale ?? 1;
  const station = { ...MASTER_STATION, ...(options.station ?? {}) };
  if (scale === 1) return drawStation(ctx, x, y, station);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  const result = drawStation(ctx, 0, 0, station);
  ctx.restore();
  return result;
}

/* ------------------------------------------------------------------ *
 * 12. STATIC BLUEPRINT STATE
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DAILY_RESULT = {
  pnl: 578.76,
  ops: 21,
  wins: 16,
  losses: 5,
  winRate: 76.2,
  best: 24.5,
  worst: -10.0,
  weekly: 1842.3,
  monthly: 6721.55,
  open: 37,
  closed: 18,
  total: 55,
};

export function buildStaticBlueprintState(overrides = {}) {
  const random = mulberry32(0xc0ffee);
  const stations = STATION_LAYOUT.slots.map((slot) => {
    const active = random() > 0.14;
    let result = "DRAW";
    let pnl = 0;
    if (active) {
      const roll = random();
      if (roll < 0.56) {
        result = "WIN";
        pnl = Math.round((1.5 + random() * 22) * 100) / 100;
      } else if (roll < 0.82) {
        result = "LOSS";
        pnl = -Math.round((1 + random() * 9) * 100) / 100;
      } else {
        result = "DRAW";
        pnl = 0;
      }
    }
    return { ...slot, active, result, pnl };
  });
  const masterIndex = stations.findIndex((station) => station.symbol === MASTER_STATION.symbol);
  if (masterIndex >= 0) {
    stations[masterIndex] = { ...stations[masterIndex], active: true, result: "WIN", pnl: 8.5 };
  }
  return {
    daily: { ...DAILY_RESULT },
    stations,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * 13. SCENE REGIONS
 * ------------------------------------------------------------------ */

/**
 * Physical warm-wood plank floor. Horizontal boards with staggered vertical
 * seams, a lit top edge and a dark seam at the bottom of every board so the
 * surface reads as a real material rather than a flat colour field.
 */
function drawWoodFloor(ctx, x, y, w, h, options = {}) {
  if (w <= 0 || h <= 0) return;
  const plankH = options.plankH ?? 13;
  const plankW = options.plankW ?? 92;
  const tints = [PALETTE.woodFloor, PALETTE.woodFloorHi, PALETTE.woodFloorMid, PALETTE.woodFloor, PALETTE.woodFloorMid, PALETTE.woodFloorHi];
  let row = 0;
  for (let py = y; py < y + h; py += plankH, row += 1) {
    const ph = Math.min(plankH, y + h - py);
    if (ph <= 0) break;
    pxRect(ctx, x, py, w, ph, tints[row % tints.length]);
    pxRect(ctx, x, py, w, 1, "rgba(255,208,150,0.07)");
    pxRect(ctx, x, py + ph - 1, w, 1, PALETTE.woodFloorSeam);
    const offset = (row % 2) * Math.round(plankW / 2);
    for (let sx = x - offset + plankW; sx < x + w; sx += plankW) {
      pxRect(ctx, sx, py, 1, ph, PALETTE.woodFloorSeam);
    }
    for (let gx = x + 6; gx < x + w; gx += 26) {
      pxRect(ctx, gx, py + 3 + ((row * 5 + gx) % 6), 9, 1, "rgba(30,18,8,0.16)");
    }
  }
}

function drawFloor(ctx) {
  // base: cool dark trading-hall floor
  pxRect(ctx, 0, 0, BASE_WIDTH, BASE_HEIGHT, PALETTE.floor);
  // warm amber ambient wash over the whole hall
  const wash = ctx.createRadialGradient(BASE_WIDTH / 2, BASE_HEIGHT * 0.58, 80, BASE_WIDTH / 2, BASE_HEIGHT * 0.58, BASE_WIDTH * 0.78);
  wash.addColorStop(0, "rgba(240,180,96,0.13)");
  wash.addColorStop(0.55, "rgba(220,150,80,0.06)");
  wash.addColorStop(1, "rgba(240,180,96,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  // warm timber rooms: top-left lounge, top-right lounge, bottom terrace band
  drawWoodFloor(ctx, 0, 116, 524, 222);
  drawWoodFloor(ctx, 286, 0, 238, 338);
  drawWoodFloor(ctx, 908, 0, 628, 338);
  drawWoodFloor(ctx, 524, 224, 384, 114);
  drawWoodFloor(ctx, 0, 900, BASE_WIDTH, 124);
  warmOverlay(ctx, 0, 900, BASE_WIDTH, 124, "#c88a4a", 0.20);
  lightPool(ctx, 300, 1010, 420, PALETTE.amber, 0.16);
  lightPool(ctx, 768, 1016, 520, PALETTE.amber, 0.16);
    lightPool(ctx, 1230, 1010, 420, PALETTE.amber, 0.16);
  // dark ceiling beam across the top
  pxRect(ctx, 0, 0, BASE_WIDTH, 6, "#1a1208");
  pxRect(ctx, 0, 6, BASE_WIDTH, 2, "#3a2a1c");
  // warm glow pooling on the timber
  lightPool(ctx, 262, 250, 260, PALETTE.amber, 0.05);
  lightPool(ctx, 1220, 250, 240, PALETTE.amber, 0.05);
  lightPool(ctx, 768, 960, 340, PALETTE.amber, 0.06);

  // trading-hall tile grid, only over the middle bands
  const gridTop = 338;
  const gridBottom = 900;
  warmOverlay(ctx, 0, gridTop, BASE_WIDTH, gridBottom - gridTop, "#1c3c3a", 0.60);
  for (let x = 0; x < BASE_WIDTH; x += 32) pxRect(ctx, x, gridTop, 1, gridBottom - gridTop, PALETTE.tileLine);
  for (let y = gridTop; y < gridBottom; y += 32) pxRect(ctx, 0, y, BASE_WIDTH, 1, PALETTE.tileLine);
  for (let x = 16; x < BASE_WIDTH; x += 32) pxRect(ctx, x, gridTop, 1, gridBottom - gridTop, "rgba(240,190,110,0.03)");
  for (let y = gridTop + 16; y < gridBottom; y += 32) pxRect(ctx, 0, y, BASE_WIDTH, 1, "rgba(240,190,110,0.03)");
  for (let tx = 0; tx < BASE_WIDTH; tx += 32) {
    for (let ty = gridTop; ty < gridBottom; ty += 32) {
      if (((tx / 32) + (ty / 32)) % 2 === 0) warmOverlay(ctx, tx, ty, 32, 32, PALETTE.floorAlt, 0.4);
    }
  }

  // dark structural beam dividing the upper rooms from the trading hall
  pxRect(ctx, 0, 330, BASE_WIDTH, 8, "#160f0a");
  pxRect(ctx, 0, 330, BASE_WIDTH, 2, "#3a2a1c");
  pxRect(ctx, 0, 336, BASE_WIDTH, 2, "#080605");
  // baseboard between the trading hall and the bottom terrace
  pxRect(ctx, 0, 894, BASE_WIDTH, 8, "#160f0a");
  pxRect(ctx, 0, 894, BASE_WIDTH, 2, "#3a2a1c");
  pxRect(ctx, 0, 0, BASE_WIDTH, 4, "#0a1420");
  pxRect(ctx, 0, BASE_HEIGHT - 4, BASE_WIDTH, 4, "#0a1420");
}

function drawWallPanel(ctx, x, y, w, h, options = {}) {
  const border = options.border ?? PALETTE.border;
  const bg = options.bg ?? PALETTE.wall;
  pxRect(ctx, x, y, w, h, PALETTE.woodDark);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 2, border);
  pxRect(ctx, x + 3, y + 3, w - 6, h - 6, bg);
  pxRect(ctx, x + 3, y + 3, w - 6, 1, "rgba(255,255,255,0.06)");
  pxRect(ctx, x + 3, y + h - 4, w - 6, 1, "rgba(0,0,0,0.35)");
  return { innerX: x + 6, innerY: y + 6, innerW: w - 12, innerH: h - 12 };
}

function drawLogo(ctx) {
  const x = 14;
  const y = 14;
  const w = 232 - 14;
  const h = 92 - 14;
  pxRect(ctx, x, y, w, h, "#0a1526");
  pxRect(ctx, x, y, w, 2, PALETTE.border);
  pxRect(ctx, x, y + h - 2, w, 2, PALETTE.border);
  pxRect(ctx, x, y, 2, h, PALETTE.border);
  pxRect(ctx, x + w - 2, y, 2, h, PALETTE.border);
  pxRect(ctx, x + 8, y + 12, 34, 34, PALETTE.goldDark);
  pxRect(ctx, x + 10, y + 14, 30, 30, PALETTE.gold);
  pxRect(ctx, x + 14, y + 18, 22, 22, "#0a1526");
  pxRect(ctx, x + 18, y + 22, 14, 14, PALETTE.gold);
  pxRect(ctx, x + 22, y + 26, 6, 6, "#0a1526");
  drawPixelText(ctx, "TRACE/COM", x + 52, y + 16, { scale: 2, color: PALETTE.white });
  drawPixelText(ctx, "DISCIPLINA · DADOS · RESULTADOS", x + 52, y + 40, { scale: 1, color: PALETTE.goldHi });
  drawPixelText(ctx, "PIXEL OFFICE V2", x + 52, y + 52, { scale: 1, color: PALETTE.metal });
}

function drawQuadroLongTerm(ctx) {
  const { x, y, w, h } = { x: 14, y: 96, w: 176 - 14, h: 176 - 96 };
  drawWallPanel(ctx, x, y, w, h, { bg: "#1c1a16" });
  drawPixelParagraph(ctx, "TRADER E UM JOGO DE LONGO PRAZO", x + w / 2, y + 12, w - 16, {
    scale: 1,
    align: "center",
    color: "#d8c8a0",
    lineHeight: 11,
  });
  pxRect(ctx, x + 12, y + h - 26, w - 24, 14, "#0f0e0c");
  drawPixelText(ctx, "PROCESSO > SORTE", x + w / 2, y + h - 22, { scale: 1, align: "center", color: PALETTE.metal });
}

function drawQuadroFocus(ctx) {
  const x = 300;
  const y = 18;
  const w = 392 - 300;
  const h = 142 - 18;
  pxRect(ctx, x, y, w, h, PALETTE.woodDark);
  pxRect(ctx, x + 1, y + 1, w - 2, h - 2, PALETTE.goldDark);
  pxRect(ctx, x + 4, y + 4, w - 8, h - 8, "#3a2a1a");
  pxRect(ctx, x + 4, y + 4, w - 8, 1, "rgba(255,220,170,0.14)");
  const words = ["FOCO", "DISCIPLINA", "PROCESSO", "RESULTADO"];
  const colors = [PALETTE.goldHi, PALETTE.amberSoft, PALETTE.goldHi, PALETTE.amber];
  words.forEach((word, index) => {
    drawPixelText(ctx, word, x + w / 2, y + 12 + index * 26, { scale: 1, align: "center", color: colors[index] });
    if (index < words.length - 1) pxRect(ctx, x + 14, y + 22 + index * 26, w - 28, 1, "rgba(180,140,80,0.28)");
  });
}

function drawProfessorPanel(ctx) {
  const x = 12;
  const y = 184;
  const w = 132 - 12;
  const h = 392 - 184;
  // warm timber room shell
  pxRect(ctx, x, y, w, h, "#6a4a34");
  pxRect(ctx, x, y, w, 3, "#8a6446");
  for (let py = y + 4; py < y + h; py += 13) {
    pxRect(ctx, x, py, w, 1, "#543824");
    pxRect(ctx, x + ((py / 13) % 2) * 30 + 12, py, 1, 13, "#543824");
  }
  lightPool(ctx, x + w / 2, y + 70, 80, PALETTE.amber, 0.10);
  // navy header sign
  pxRect(ctx, x + 6, y + 8, w - 12, 32, "#0d1b30");
  pxRect(ctx, x + 6, y + 8, w - 12, 2, "#3a5a90");
  pxRect(ctx, x + 6, y + 8, 2, 32, PALETTE.goldDark);
  drawPixelText(ctx, "PROFESSOR", x + w / 2, y + 15, { scale: 1, align: "center", color: PALETTE.white });
  drawPixelText(ctx, "& PESQUISA", x + w / 2, y + 25, { scale: 1, align: "center", color: PALETTE.white });
  // tall bookcase with colourful spines
  bookshelf(ctx, x + 8, y + 48, 42, 74, { shelves: 3, seed: 3 });
  // desk with two researchers
  research_desk(ctx, x + 54, y + 96, 56, 26);
  pxRect(ctx, x + 62, y + 72, 13, 24, PALETTE.metalDark);
  pxRect(ctx, x + 64, y + 74, 9, 14, PALETTE.screenOn);
  pxRect(ctx, x + 64, y + 66, 8, 7, PALETTE.hair2);
  pxRect(ctx, x + 64, y + 71, 8, 7, PALETTE.skin);
  pxRect(ctx, x + 62, y + 78, 12, 18, "#4a5a86");
  pxRect(ctx, x + 88, y + 70, 12, 7, PALETTE.hair4);
  pxRect(ctx, x + 88, y + 75, 12, 7, PALETTE.skin2);
  pxRect(ctx, x + 87, y + 82, 14, 16, PALETTE.criticPurple);
  // side cabinet + plant
  pxRect(ctx, x + 58, y + 126, 22, 30, PALETTE.woodMid);
  pxRect(ctx, x + 58, y + 126, 22, 2, PALETTE.woodHi);
  pxRect(ctx, x + 60, y + 138, 18, 1, PALETTE.woodShadow);
  plant_small(ctx, x + 100, y + 132, {});
  // bottom navy sign
  pxRect(ctx, x + 4, y + h - 82, w - 8, 78, "#0d1b30");
  pxRect(ctx, x + 4, y + h - 82, w - 8, 2, "#3a5a90");
  const subs = ["DADOS", "TESTES", "APRENDIZADO", "EVOLUCAO"];
  subs.forEach((sub, index) => {
    drawPixelText(ctx, sub, x + w / 2, y + h - 74 + index * 17, { scale: 1, align: "center", color: PALETTE.goldHi });
  });
}

function drawMeetingRoomPanel(ctx) {
  const x = 12;
  const y = 398;
  const w = 132 - 12;
  const h = 562 - 398;
  // warm timber room shell
  pxRect(ctx, x, y, w, h, "#6a4a34");
  pxRect(ctx, x, y, w, 3, "#8a6446");
  for (let py = y + 4; py < y + h; py += 13) {
    pxRect(ctx, x, py, w, 1, "#543824");
    pxRect(ctx, x + ((py / 13) % 2) * 26 + 10, py, 1, 13, "#543824");
  }
  lightPool(ctx, x + 96, y + 30, 54, PALETTE.amber, 0.16);
  pxRect(ctx, x + 6, y + 8, w - 12, 22, "#0d1b30");
  pxRect(ctx, x + 6, y + 8, w - 12, 2, "#3a5a90");
  drawPixelText(ctx, "SALA DE REUNIAO", x + w / 2, y + 15, { scale: 1, align: "center", color: PALETTE.white });
  // two wooden meeting tables with six people
  const tables = [[y + 44, PALETTE.traderNavy], [y + 92, PALETTE.criticPurple]];
  tables.forEach(([ty], ti) => {
    pxRect(ctx, x + 14, ty, w - 28, 34, PALETTE.woodMid);
    pxRect(ctx, x + 14, ty, w - 28, 2, PALETTE.woodHi);
    pxRect(ctx, x + 14, ty + 32, w - 28, 2, PALETTE.woodShadow);
    pxRect(ctx, x + 18, ty + 34, 4, 10, PALETTE.woodShadow);
    pxRect(ctx, x + w - 22, ty + 34, 4, 10, PALETTE.woodShadow);
    for (let p = 0; p < 3; p += 1) {
      const ax = x + 20 + p * 30;
      const above = p % 2 === 0;
      const ay = above ? ty - 22 : ty + 36;
      pxRect(ctx, ax, ay, 14, 7, [PALETTE.hair1, PALETTE.hair2, PALETTE.hair3][(p + ti) % 3]);
      pxRect(ctx, ax + 1, ay + 5, 12, 8, [PALETTE.skin, PALETTE.skin2, PALETTE.skin3][(p + ti) % 3]);
      pxRect(ctx, ax, ay + 12, 14, 12, p % 2 === 0 ? PALETTE.traderNavy : "#3a4a7a");
    }
  });
  // floor lamp in the corner
  pxRect(ctx, x + 6, y + 140, 2, 26, PALETTE.metalDark);
  pxRect(ctx, x + 2, y + 134, 10, 6, PALETTE.amber);
  pxRect(ctx, x + 2, y + 134, 10, 1, PALETTE.goldHi);
  lightPool(ctx, x + 7, y + 137, 30, PALETTE.amber, 0.16);
  plant_small(ctx, x + 104, y + 146, {});
}

function drawPlanningPanel(ctx) {
  const x = 12;
  const y = 568;
  const w = 132 - 12;
  const h = 648 - 568;
  const panel = drawWallPanel(ctx, x, y, w, h, { bg: "#101a2b" });
  const lines = ["PLANEJAMENTO", "ESTRATEGIA", "PERFORMANCE", "PROXIMOS PASSOS"];
  const colors = [PALETTE.goldHi, PALETTE.screenOn, PALETTE.green, PALETTE.amber];
  lines.forEach((line, index) => {
    drawPixelText(ctx, line, x + w / 2, panel.innerY + 4 + index * 15, { scale: 1, align: "center", color: colors[index] });
  });
}

function drawDataCenterPanel(ctx) {
  const x = 12;
  const y = 654;
  const w = 132 - 12;
  const h = 772 - 654;
  const panel = drawWallPanel(ctx, x, y, w, h, { bg: "#0a1220" });
  pxRect(ctx, panel.innerX, panel.innerY, panel.innerW, 16, PALETTE.panelHeader);
  drawPixelText(ctx, "DATA CENTER", x + w / 2, panel.innerY + 5, { scale: 1, align: "center", color: PALETTE.white });
  for (let rack = 0; rack < 2; rack += 1) {
    const rx = panel.innerX + rack * 30;
    pxRect(ctx, rx, panel.innerY + 24, 26, 54, "#141c2e");
    pxRect(ctx, rx, panel.innerY + 24, 26, 1, PALETTE.metalDark);
    for (let unit = 0; unit < 5; unit += 1) {
      pxRect(ctx, rx + 3, panel.innerY + 28 + unit * 9, 20, 6, "#1f2941");
      pxRect(ctx, rx + 3, panel.innerY + 28 + unit * 9, 2, 2, unit % 2 === 0 ? PALETTE.green : PALETTE.amber);
    }
  }
  const subs = ["ESTABILIDADE", "CONEXAO", "EXECUCAO", "SEM INTERRUPCOES"];
  subs.forEach((sub, index) => {
    drawPixelText(ctx, sub, x + w / 2, panel.innerY + 84 + index * 8, { scale: 1, align: "center", color: index === 3 ? PALETTE.green : PALETTE.metal });
  });
}

function drawMarketsBoxes(ctx, daily) {
  const x = 906;
  const w = 150;
  const box = (by, bh, title, rows) => {
    const panel = drawWallPanel(ctx, x, by, w, bh, { bg: "#0b1728", border: "#2a4a80" });
    drawPixelText(ctx, title, x + w / 2, by + 10, { scale: 2, align: "center", color: "#7ab0e8" });
    rows.forEach(([label, value, color], index) => {
      const ry = panel.innerY + 26 + index * 16;
      drawPixelText(ctx, label, panel.innerX, ry, { scale: 1, color: "#9ab8dc" });
      drawPixelText(ctx, value, panel.innerX + panel.innerW, ry, { scale: 1, align: "right", color: color ?? PALETTE.white });
    });
  };
  box(6, 112, "MERCADOS", [
    ["ABERTOS", String(daily.open ?? 37), PALETTE.white],
    ["FECHADOS", String(daily.closed ?? 18), PALETTE.white],
    ["TOTAL", String(daily.total ?? 55), PALETTE.red],
    ["MODO", "PRACTICE", PALETTE.screenOn],
    ["RISCO", "ZERO REAL", PALETTE.green],
  ]);
  const valueBox = (by, bh, title, value) => {
    drawWallPanel(ctx, x, by, w, bh, { bg: "#0b1728", border: "#2a4a80" });
    drawPixelText(ctx, title, x + w / 2, by + 7, { scale: 2, align: "center", spacing: 0, color: "#7ab0e8" });
    drawPixelText(ctx, value, x + w / 2, by + 28, { scale: 2, align: "center", spacing: 0, color: PALETTE.green });
  };
  valueBox(118, 50, "LUCRO SEMANAL", `+R$ ${formatBRL(daily.weekly ?? 1842.3)}`);
  valueBox(174, 54, "LUCRO MENSAL", `+R$ ${formatBRL(daily.monthly ?? 6721.55)}`);
}

function drawWorldMapPanel(ctx) {
  const x = 1058;
  const y = 28;
  const w = 1268 - 1058;
  const h = 152 - 28;
  const panel = drawWallPanel(ctx, x, y, w, h, { bg: "#08131f", border: "#6a4a28" });
  world_map(ctx, panel.innerX, panel.innerY, panel.innerW, panel.innerH, {});
}

function drawGlobalMarketsPanel(ctx) {
  const x = 1274;
  const y = 52;
  const w = 1438 - 1274;
  const h = 142 - 52;
  const panel = drawWallPanel(ctx, x, y, w, h, { bg: "#101a2b" });
  drawPixelParagraph(ctx, "MERCADO GLOBAL 24H", panel.innerX + 2, panel.innerY + 2, w - 16, {
    scale: 2,
    align: "left",
    color: "#7ab0e8",
    lineHeight: 18,
  });
  drawPixelParagraph(ctx, "OPORTUNIDADES EM TEMPO REAL", panel.innerX + 2, panel.innerY + 46, w - 16, {
    scale: 1,
    align: "left",
    color: "#5a8ac0",
    lineHeight: 10,
  });
  pxRect(ctx, x + 8, y + h - 14, w - 16, 6, "#0a1526");
  for (let index = 0; index < 6; index += 1) {
    pxRect(ctx, x + 12 + index * 24, y + h - 12, 8, 2, index % 2 === 0 ? PALETTE.green : PALETTE.red);
  }
}

function drawRedDisciplinePanel(ctx) {
  const x = 1436;
  const y = 18;
  const w = 1530 - 1436;
  const h = 124 - 18;
  drawWallPanel(ctx, x, y, w, h, { bg: "#3a2a18", border: PALETTE.gold });
  drawPixelParagraph(ctx, "DISCIPLINA TRANSFORMA ESTRATEGIA EM LIBERDADE", x + w / 2, y + 10, w - 14, {
    scale: 1,
    align: "center",
    color: PALETTE.goldHi,
    lineHeight: 11,
  });
}

function drawBullStatue(ctx) {
  const x = 1442;
  const y = 126;
  const w = 1524 - 1442;
  const h = 196 - 126;
  const gold = PALETTE.gold;
  const goldHi = PALETTE.goldHi;
  lightPool(ctx, x + w / 2, y + h / 2, 48, PALETTE.amber, 0.16);
  pxRect(ctx, x + 4, y + h - 12, w - 8, 12, "#2c2114");
  pxRect(ctx, x + 4, y + h - 12, w - 8, 2, PALETTE.goldDark);
  pxRect(ctx, x + 8, y + h - 16, w - 16, 4, "#3a2a18");
  pxRect(ctx, x + 22, y + 22, 44, 22, gold);
  pxRect(ctx, x + 22, y + 22, 44, 3, goldHi);
  pxRect(ctx, x + 40, y + 14, 18, 10, gold);
  pxRect(ctx, x + 42, y + 14, 14, 2, goldHi);
  pxRect(ctx, x + 10, y + 30, 20, 18, gold);
  pxRect(ctx, x + 10, y + 30, 20, 2, goldHi);
  pxRect(ctx, x + 18, y + 34, 4, 3, "#2c2114");
  pxRect(ctx, x + 6, y + 22, 8, 3, goldHi);
  pxRect(ctx, x + 2, y + 18, 6, 3, gold);
  pxRect(ctx, x + 4, y + 16, 3, 6, gold);
  pxRect(ctx, x + 18, y + 20, 6, 3, goldHi);
  pxRect(ctx, x + 22, y + 16, 3, 6, gold);
  pxRect(ctx, x + 24, y + 16, 6, 3, goldHi);
  pxRect(ctx, x + 28, y + 44, 5, 14, gold);
  pxRect(ctx, x + 40, y + 44, 5, 14, gold);
  pxRect(ctx, x + 52, y + 44, 5, 14, gold);
  pxRect(ctx, x + 62, y + 44, 5, 14, gold);
  pxRect(ctx, x + 28, y + 56, 5, 2, PALETTE.goldDark);
  pxRect(ctx, x + 40, y + 56, 5, 2, PALETTE.goldDark);
  pxRect(ctx, x + 52, y + 56, 5, 2, PALETTE.goldDark);
  pxRect(ctx, x + 62, y + 56, 5, 2, PALETTE.goldDark);
  pxRect(ctx, x + 66, y + 20, 3, 14, gold);
  pxRect(ctx, x + 66, y + 32, 5, 3, goldHi);
}

function drawLeftLounge(ctx) {
  const x = 286;
  const y = 124;
  const w = 238;
  const h = 212;
  const dark = { color: PALETTE.sofaLeather, outline: "#241a13", color3: PALETTE.sofaLeatherHi };
  const tan = { color: "#8a6038", outline: "#5a3c22", color3: "#a87a48" };

  // big patterned rug under the seating group
  pxRect(ctx, x, y + 40, w, h - 40, "#5a3c28");
  pxRect(ctx, x, y + 40, w, 2, "#6d4a30");
  patterned_rug(ctx, x + 10, y + 60, w - 22, h - 78, { color: "#4a2018", inner: "#5e2a20", accent: "#7a5a3a", border: "#2a1a0e" });

  // upper group: two armchairs + coffee table
  armchair(ctx, x + 36, y + 2, { w: 36, h: 32, ...tan });
  trader(ctx, x + 46, y + 10, { variant: 2, shirt: "#b04030", tie: null });
  coffee_table(ctx, x + 96, y + 34, 62, { h: 16 });
  armchair(ctx, x + 168, y + 2, { w: 36, h: 32, ...tan });
  plant_small(ctx, x + 176, y - 6, {});
  lamp(ctx, x + 218, y + 6, { height: 36, pool: 46, alpha: 0.13 });

  // middle: dark leather three-seat sofa with three seated people
  sofa(ctx, x + 18, y + 66, 180, { h: 32, ...dark });
  trader(ctx, x + 44, y + 74, { variant: 0, shirt: PALETTE.traderNavy, tie: "#c9a24b" });
  critic(ctx, x + 84, y + 74, { variant: 2, shirt: "#2f7d4f", tie: null, glasses: false });
  trader(ctx, x + 124, y + 74, { variant: 4, shirt: PALETTE.traderNavy, tie: "#2f7d4f" });

  // lower: wooden coffee table + side table + rug + seated person
  coffee_table(ctx, x + 66, y + 140, 84, { h: 16 });
  pxRect(ctx, x + 92, y + 134, 14, 6, PALETTE.rugBlue);
  pxRect(ctx, x + 116, y + 136, 8, 4, PALETTE.white);
  pxRect(ctx, x + 174, y + 148, 30, 14, PALETTE.woodMid);
  pxRect(ctx, x + 174, y + 148, 30, 2, PALETTE.woodHi);
  pxRect(ctx, x + 176, y + 162, 3, 6, PALETTE.woodShadow);
  pxRect(ctx, x + 199, y + 162, 3, 6, PALETTE.woodShadow);
  trader(ctx, x + 8, y + 158, { variant: 3, shirt: "#6b4a2f", tie: null, glasses: false });

  // plants framing the room
  plant_large(ctx, x - 8, y + 168, {});
  plant_small(ctx, x + 2, y + 2, {});
  plant_small(ctx, x + 202, y + 108, {});
  plant_large(ctx, x + 206, y + 150, {});
  plant_small(ctx, x + 116, y + 196, {});
  plant_small(ctx, x + 40, y + 198, {});
  plant_small(ctx, x - 4, y + 96, {});

  // bookshelf + small work nook on the left edge of the room
  bookshelf(ctx, x - 22, y + 30, 22, 54, { shelves: 3, seed: 21 });
  bookshelf(ctx, x - 22, y + 96, 22, 44, { shelves: 2, seed: 23 });
  research_desk(ctx, x - 20, y + 152, 62, 22);
  trader(ctx, x - 4, y + 140, { variant: 5, shirt: "#3a4a7a", tie: null, glasses: true });
}

function drawPoolArea(ctx) {
  const x = 560;
  const y = 256;
  const w = 148;
  const h = 68;
  pxRect(ctx, x - 10, y - 8, w + 20, h + 18, "#5a3c28");
  pxRect(ctx, x - 10, y - 8, w + 20, 2, "#6d4a30");
  pxRect(ctx, x - 10, y + h + 8, w + 20, 2, "#3a2414");
  pool_table(ctx, x, y, w, h, { frame: "#3a2414", rail: "#5a3a22" });
  lamp(ctx, x + w / 2, y - 10, { height: 30, pool: 50, alpha: 0.16 });
  // players around the table
  trader(ctx, x - 24, y + 2, { variant: 3, shirt: "#3a4a7a", tie: null });
  critic(ctx, x + w + 2, y + 16, { variant: 1, glasses: false });
  trader(ctx, x + 22, y + h + 4, { variant: 5, shirt: "#3a4a7a", tie: null });
  critic(ctx, x + w - 46, y + h + 2, { variant: 4, glasses: false });

  const plaqueX = 738;
  const plaqueY = 232;
  const plaqueW = 826 - 738;
  const plaqueH = 288 - 232;
  drawWallPanel(ctx, plaqueX, plaqueY, plaqueW, plaqueH, { bg: "#12233f" });
  drawPixelParagraph(ctx, "BOM TRADE TAMBEM SE CELEBRA!", plaqueX + plaqueW / 2, plaqueY + 8, plaqueW - 12, {
    scale: 1,
    align: "center",
    color: PALETTE.goldHi,
    lineHeight: 10,
  });
  // small side table + plant filling the gap between pool and right lounge
  pxRect(ctx, plaqueX - 18, 296, 14, 12, PALETTE.woodDark);
  pxRect(ctx, plaqueX - 18, 296, 14, 2, PALETTE.wood);
  plant_small(ctx, plaqueX - 16, 320, { scale: 1 });
  plant_large(ctx, plaqueX + plaqueW + 2, 300, { scale: 1 });
  plant_large(ctx, 540, 300, { scale: 1 });
  plant_small(ctx, 530, 210, { scale: 1 });
}

function drawRightLounge(ctx) {
  const x = 840;
  const y = 240;
  const w = 200;
  const h = 96;
  const leather = { color: PALETTE.leather, outline: PALETTE.leatherDark, color3: PALETTE.leatherHi };
  pxRect(ctx, x, y, w, h, "#5a3c28");
  pxRect(ctx, x, y, w, 2, "#6d4a30");
  patterned_rug(ctx, x + 14, y + 44, w - 40, h - 48, { color: "#4a2018", inner: "#5e2a20", accent: "#7a5a3a", border: "#2a1a0e" });
  // back sofa (brown leather) with a seated trader
  sofa(ctx, x + 4, y + 2, 118, { h: 28, ...leather });
  trader(ctx, x + 38, y + 10, { variant: 5, shirt: "#3a4a7a", tie: null });
  // front armchairs + coffee table
  armchair(ctx, x + 2, y + 62, { w: 34, h: 30, ...leather });
  armchair(ctx, x + 96, y + 62, { w: 34, h: 30, ...leather });
  coffee_table(ctx, x + 52, y + 62, 52, { h: 14 });
  // wall TV showing a green equity chart
  pxRect(ctx, x + 128, y + 4, 70, 44, "#0a1526");
  pxRect(ctx, x + 130, y + 6, 66, 40, "#0b1a2c");
  pxRect(ctx, x + 134, y + 14, 40, 2, PALETTE.screenGreen);
  pxRect(ctx, x + 134, y + 22, 28, 2, PALETTE.screenGreen);
  pxRect(ctx, x + 134, y + 30, 34, 2, PALETTE.screenGreen);
  pxRect(ctx, x + 180, y + 12, 12, 10, PALETTE.screenOn);
  // plants + lamp
  plant_large(ctx, x + 116, y + 2, {});
  plant_small(ctx, x + 176, y + 78, {});
  lamp(ctx, x + 6, y + 2, { height: 30, pool: 40, alpha: 0.15 });
}

function drawCafeKitchen(ctx) {
  // back bar shelf with bottles
  bookshelf(ctx, 1150, 196, 100, 54, { shelves: 3, seed: 7 });
  for (let index = 0; index < 5; index += 1) {
    pxRect(ctx, 1156 + index * 18, 202, 8, 7, index % 2 === 0 ? PALETTE.white : PALETTE.amber);
  }
  // wooden bar counter with bottles
  const counterX = 1100;
  const counterY = 252;
  const counterW = 54;
  const counterH = 54;
  pxRect(ctx, counterX + 2, counterY + counterH, counterW - 4, 2, "rgba(0,0,0,0.35)");
  pxRect(ctx, counterX, counterY, counterW, counterH, PALETTE.woodDark);
  pxRect(ctx, counterX, counterY, counterW, 5, PALETTE.woodHi);
  pxRect(ctx, counterX, counterY, counterW, 1, "#e8c877");
  pxRect(ctx, counterX, counterY + 5, counterW, 1, PALETTE.woodShadow);
  for (let index = 1; index < 3; index += 1) pxRect(ctx, counterX + Math.round((counterW * index) / 3), counterY + 6, 1, counterH - 6, PALETTE.woodShadow);
  pxRect(ctx, counterX + 8, counterY + 16, 8, 2, PALETTE.metalDark);
  pxRect(ctx, counterX + 34, counterY + 16, 8, 2, PALETTE.metalDark);
  const bottleColors = [PALETTE.green, PALETTE.amber, PALETTE.rugRed, PALETTE.screenOn, PALETTE.criticPurple];
  for (let index = 0; index < 3; index += 1) {
    const bx = counterX + 8 + index * 15;
    pxRect(ctx, bx, counterY - 11, 5, 11, bottleColors[index % bottleColors.length]);
    pxRect(ctx, bx + 1, counterY - 14, 3, 3, PALETTE.metalDark);
  }
  // stools
  for (let index = 0; index < 2; index += 1) {
    const sx = counterX + 10 + index * 26;
    pxRect(ctx, sx, counterY + counterH, 8, 8, PALETTE.woodShadow);
    pxRect(ctx, sx - 1, counterY + counterH - 4, 10, 4, PALETTE.wood);
  }
  // white fridge
  pxRect(ctx, 1306, 252, 34, 60, "#b8c0c8");
  pxRect(ctx, 1306, 252, 34, 1, "#dde4ea");
  pxRect(ctx, 1306, 252 + 22, 34, 2, PALETTE.metalDark);
  pxRect(ctx, 1334, 258, 3, 14, PALETTE.metalDark);
  pxRect(ctx, 1334, 282, 3, 24, PALETTE.metalDark);
  pxRect(ctx, 1306, 311, 34, 1, PALETTE.metalDark);
  // chalkboard sign
  const signX = 1170;
  const signY = 220;
  const signW = 78;
  const signH = 68;
  pxRect(ctx, signX, signY, signW, signH, PALETTE.woodDark);
  pxRect(ctx, signX + 1, signY + 1, signW - 2, signH - 2, PALETTE.wood);
  pxRect(ctx, signX + 4, signY + 4, signW - 8, signH - 8, "#141816");
  drawPixelParagraph(ctx, "CAFE IDEIAS TRADES RESULTADOS", signX + signW / 2, signY + 10, signW - 14, {
    scale: 1,
    align: "center",
    color: "#d8d0b8",
    lineHeight: 11,
  });
  // small round table + two people
  const tableX = 1108;
  const tableY = 318;
  pxRect(ctx, tableX, tableY, 34, 4, PALETTE.wood);
  pxRect(ctx, tableX, tableY, 34, 1, PALETTE.woodHi);
  pxRect(ctx, tableX + 15, tableY + 4, 4, 14, PALETTE.woodDark);
  trader(ctx, tableX - 14, tableY - 22, { variant: 4, shirt: "#7a3a4a", tie: null, glasses: false });
  critic(ctx, tableX + 34, tableY - 22, { variant: 2, shirt: "#2f6a8a", tie: null, glasses: false });
  // plants + lamp
  plant_large(ctx, 1064, 300, {});
  plant_small(ctx, 1148, 320, {});
  plant_small(ctx, 1348, 316, {});
  lamp(ctx, 1260, 322, { height: 30, pool: 44, alpha: 0.16 });
  lamp(ctx, 1120, 216, { height: 28, pool: 40, alpha: 0.15 });
}

function drawMeetingTable(ctx) {
  const x = 1340;
  const y = 228;
  const w = 1502 - 1340;
  const h = 322 - 228;
  // warm dining nook on timber: table, two diners, lamp, plants, framed art
  const tableW = 104;
  const tableX = x + (w - tableW) / 2;
  const tableY = y + 4;
  pxRect(ctx, tableX, tableY, tableW, 36, PALETTE.woodDark);
  pxRect(ctx, tableX, tableY, tableW, 3, PALETTE.woodMid);
  pxRect(ctx, tableX, tableY + 36, tableW, 2, "#2a1a0e");
  pxRect(ctx, tableX + 4, tableY + 8, 22, 14, PALETTE.white);
  pxRect(ctx, tableX + tableW - 26, tableY + 10, 18, 12, PALETTE.rugRed);
  const seats = [[-16, 6], [tableW + 2, 6], [-16, 44], [tableW + 2, 44]];
  seats.forEach(([dx, dy], index) => {
    const ax = tableX + dx;
    const ay = tableY + dy;
    pxRect(ctx, ax, ay, 14, 7, [PALETTE.hair1, PALETTE.hair3, PALETTE.hair2, PALETTE.hair4][index % 4]);
    pxRect(ctx, ax, ay + 5, 14, 7, PALETTE.skin);
    pxRect(ctx, ax, ay + 12, 14, 12, index % 2 === 0 ? PALETTE.traderNavy : PALETTE.criticPurple);
  });
  lamp(ctx, x + 12, y + 74, { height: 32, pool: 46, alpha: 0.17 });
  plant_large(ctx, x + w - 18, y + 76, {});
  plant_small(ctx, x + 8, y + 6, {});
  pxRect(ctx, x + w - 40, y + 6, 30, 24, PALETTE.woodDark);
  pxRect(ctx, x + w - 38, y + 8, 26, 20, "#1b3a5e");
  pxRect(ctx, x + w - 30, y + 18, 10, 8, PALETTE.bandGreen);
}

function drawRightColumn(ctx) {
  const x = 1400;
  const w = 1532 - 1400;
  const panels = [
    { y: 330, h: 470 - 330, title: "PAUSA TAMBEM E ESTRATEGIA", sub: "FLIPERAMA · DESCANSO", accent: PALETTE.bandBlue },
    { y: 500, h: 660 - 500, title: "AREA DE LAZER", sub: "RELAXAR VOLTAR MAIS FORTE", accent: PALETTE.bandGreen },
    { y: 668, h: 790 - 668, title: "COZINHA", sub: "CAFE ENERGIA DISCIPLINA BOM HUMOR", accent: PALETTE.bandBlue },
    { y: 796, h: 1000 - 796, title: "TERRACO", sub: "RESPIRA ANALISA DECIDE MELHOR", accent: PALETTE.bandGreen },
  ];
  panels.forEach((entry, index) => {
    const panel = drawWallPanel(ctx, x, entry.y, w, entry.h, { bg: "#101010" });
    pxRect(ctx, x + 3, entry.y + 3, w - 6, 24, entry.accent);
    drawPixelParagraph(ctx, entry.title, x + w / 2, entry.y + 6, w - 12, {
      scale: 1,
      align: "center",
      color: PALETTE.white,
      lineHeight: 9,
    });
    drawPixelParagraph(ctx, entry.sub, x + w / 2, entry.y + 32, w - 14, {
      scale: 1,
      align: "center",
      color: PALETTE.goldHi,
      lineHeight: 10,
    });
    // every panel interior is a warm timber room
    pxRect(ctx, panel.innerX, panel.innerY + 24, panel.innerW, panel.innerH - 24, index === 2 ? "#8a6446" : PALETTE.woodFloorMid);
    if (index === 0) {
      lamp(ctx, panel.innerX + 6, entry.y + 58, { height: 26, pool: 32, alpha: 0.16 });
      pxRect(ctx, panel.innerX + 16, entry.y + 54, 14, 40, "#241a2e");
      pxRect(ctx, panel.innerX + 18, entry.y + 58, 10, 14, "#8a2f4a");
      pxRect(ctx, panel.innerX + 34, entry.y + 54, 14, 40, "#1e2438");
      pxRect(ctx, panel.innerX + 36, entry.y + 58, 10, 14, "#2f5f8a");
      pxRect(ctx, panel.innerX + 20, entry.y + 78, 6, 3, PALETTE.amber);
      pxRect(ctx, panel.innerX + 38, entry.y + 78, 6, 3, PALETTE.screenGreen);
      pool_table(ctx, panel.innerX + 6, entry.y + 96, panel.innerW - 12, 34, {});
    } else if (index === 1) {
      pool_table(ctx, panel.innerX + 8, entry.y + 58, panel.innerW - 16, 40, {});
      pxRect(ctx, panel.innerX + 4, entry.y + 110, 16, 12, PALETTE.woodDark);
      pxRect(ctx, panel.innerX + 5, entry.y + 111, 14, 10, "#1c3557");
      plant_small(ctx, panel.innerX + 6, entry.y + 44, {});
    } else if (index === 2) {
      pxRect(ctx, panel.innerX + 4, entry.y + 56, panel.innerW - 8, 22, "#12100c");
      drawPixelParagraph(ctx, "CAFE ENERGIA DISCIPLINA BOM HUMOR", x + w / 2, entry.y + 60, panel.innerW - 14, {
        scale: 1,
        align: "center",
        color: "#d8d0b8",
        lineHeight: 10,
      });
      pxRect(ctx, panel.innerX + 96, entry.y + 34, 2, 26, "#3a2a1c");
      pxRect(ctx, panel.innerX + 84, entry.y + 56, 26, 26, "#4a3218");
      pxRect(ctx, panel.innerX + 84, entry.y + 56, 26, 3, "#6a4a28");
      pxRect(ctx, panel.innerX + 86, entry.y + 59, 22, 20, "#ffd98a");
      pxRect(ctx, panel.innerX + 88, entry.y + 61, 18, 15, "#fff2c8");
      pxRect(ctx, panel.innerX + 84, entry.y + 79, 26, 3, "#b8823f");
      lightPool(ctx, panel.innerX + 97, entry.y + 72, 130, PALETTE.amber, 0.55);
      lightPool(ctx, panel.innerX + 50, entry.y + 72, 90, PALETTE.amber, 0.28);
      // wooden counter
      pxRect(ctx, panel.innerX + 2, entry.y + 88, panel.innerW - 4, 30, PALETTE.woodDark);
      pxRect(ctx, panel.innerX + 2, entry.y + 88, panel.innerW - 4, 4, PALETTE.woodHi);
      pxRect(ctx, panel.innerX + 2, entry.y + 88, panel.innerW - 4, 1, "#e8c877");
      pxRect(ctx, panel.innerX + 8, entry.y + 84, 8, 5, PALETTE.amber);
      pxRect(ctx, panel.innerX + 26, entry.y + 84, 8, 5, PALETTE.green);
      pxRect(ctx, panel.innerX + 50, entry.y + 76, 22, 42, "#b8c0c8");
      pxRect(ctx, panel.innerX + 50, entry.y + 76, 22, 1, "#dde4ea");
    } else {
      // terrace: night skyline through a window + a figure + plant
      pxRect(ctx, panel.innerX, entry.y + 52, panel.innerW, 40, "#0a1c30");
      for (let index2 = 0; index2 < 7; index2 += 1) {
        pxRect(ctx, panel.innerX + 4 + index2 * 16, entry.y + 56, 11, 32, index2 % 2 === 0 ? "#12283f" : "#0f2136");
      }
      for (let index2 = 0; index2 < 22; index2 += 1) {
        pxRect(ctx, panel.innerX + 5 + (index2 * 13) % (panel.innerW - 12), entry.y + 58 + (index2 * 7) % 26, 2, 2, PALETTE.amber);
      }
      pxRect(ctx, panel.innerX + 4, entry.y + 94, 12, 14, PALETTE.hair2);
      pxRect(ctx, panel.innerX + 4, entry.y + 99, 12, 8, PALETTE.skin);
      pxRect(ctx, panel.innerX + 4, entry.y + 106, 12, 16, "#5c6a86");
      pxRect(ctx, panel.innerX + 4, entry.y + 120, 12, 4, PALETTE.woodFloorMid);
      plant_large(ctx, panel.innerX + 20, entry.y + 116, {});
      drawPixelParagraph(ctx, "RESPIRA ANALISA VOLTA MELHOR", x + w / 2, entry.y + entry.h - 44, w - 14, {
        scale: 1,
        align: "center",
        color: PALETTE.goldHi,
        lineHeight: 11,
      });
    }
  });
}

/**
 * Geometry of the drawn sector banner. The banner is always placed at the top
 * of its blueprint gap and clamped so its bottom stays a clear margin above the
 * band's desk top (`deskY`) — never overlapping desk pixels.
 */
export function ribbonBannerRect(band) {
  const scale = 2;
  const textW = measurePixelText(band.banner ?? band.label, scale, 1);
  const w = textW + 20;
  const h = GLYPH_HEIGHT * scale + 4;
  const cx = band.ribbon.x + band.ribbon.w / 2;
  const maxY = Number.isFinite(band.deskY) ? band.deskY - h - 4 : Number.POSITIVE_INFINITY;
  const y = Math.min(band.ribbon.y, maxY);
  return { x: Math.round(cx - w / 2), y: Math.round(y), w, h, bottom: Math.round(y) + h };
}

/** Rounded pixel banner whose width is fitted to the label. */
function drawRibbon(ctx, band) {
  const rect = ribbonBannerRect(band);
  const { x, y, w, h } = rect;
  const scale = 2;
  const cx = x + w / 2;
  const blue = band.accent !== "green";
  const base = blue ? PALETTE.bandBlue : PALETTE.bandGreen;
  const hi = blue ? PALETTE.bandBlueHi : PALETTE.bandGreenHi;

  pxRect(ctx, x + 2, y + 3, w, h, "rgba(0,0,0,0.35)");
  pxRect(ctx, x + 1, y, w - 2, h, base);
  pxRect(ctx, x, y + 1, w, h - 2, base);
  pxRect(ctx, x + 1, y + 1, w - 2, 1, hi);
  pxRect(ctx, x + 1, y + h - 2, w - 2, 1, "rgba(0,0,0,0.4)");
  pxRect(ctx, x, y + 1, 1, h - 2, "rgba(0,0,0,0.25)");
  pxRect(ctx, x + w - 1, y + 1, 1, h - 2, "rgba(0,0,0,0.25)");
  drawPixelText(ctx, band.banner ?? band.label, cx, y + 2, {
    scale,
    align: "center",
    color: PALETTE.white,
    shadow: "rgba(0,0,0,0.5)",
  });
}

/**
 * Warm timber ledge/wall that runs along the top of every desk band. The
 * reference shows a lit wood counter behind each row, not a flat navy gap.
 */
function drawBandLedge(ctx, band) {
  const y = Math.round(band.ribbon.y - 10);
  const h = Math.max(16, Math.round(band.deskY - y - 12));
  const w = BASE_WIDTH;
  pxRect(ctx, 0, y, w, 4, "#16283a");
  pxRect(ctx, 0, y + 3, w, 1, "#0a1620");
  const ty = y + 4;
  const th = h - 4;
  pxRect(ctx, 0, ty, w, th, "#7a5a44");
  pxRect(ctx, 0, ty, w, 2, "#96704e");
  pxRect(ctx, 0, ty + 2, w, 1, "rgba(255,210,160,0.10)");
  pxRect(ctx, 0, ty + th - 2, w, 2, "#33210f");
  for (let sx = 6; sx < w; sx += 64) pxRect(ctx, sx, ty + 3, 1, th - 5, "#5e4130");
  const specks = ["#c9a24b", "#3f8f4f", "#c94b3a", "#3a7bd5", "#e0a03a"];
  let index = 0;
  for (let x = 8; x < w - 4; x += 29) {
    const sy = ty + 3 + ((x * 7 + index * 5) % Math.max(1, th - 6));
    pxRect(ctx, x, sy, 2, 2, specks[(index + (band.label.length % 5)) % specks.length]);
    index += 1;
  }
}

function drawTradingFloor(ctx, state) {
  const bySymbol = new Map((state.stations ?? []).map((station) => [station.symbol, station]));
  for (const band of SECTOR_BANDS) drawBandLedge(ctx, band);
  for (const band of SECTOR_BANDS) drawRibbon(ctx, band);
  for (const slot of STATION_LAYOUT.slots) {
    if (slot.y >= BASE_HEIGHT) continue;
    const runtime = bySymbol.get(slot.symbol) ?? { active: false };
    drawStation(ctx, slot.x, slot.y, {
      symbol: slot.symbol,
      w: slot.w,
      h: slot.h,
      active: runtime.active,
      result: runtime.result,
      pnl: runtime.pnl,
    });
  }
}

/** Render the pan-reachable expanded OTC region below the viewport. */
export function drawExpandedWorld(ctx, state) {
  const bySymbol = new Map((state?.stations ?? []).map((station) => [station.symbol, station]));
  for (const band of EXPANDED_WORLD_BANDS) {
    drawRibbon(ctx, { label: band.label, accent: "blue", ribbon: band.ribbon });
    for (const slot of STATION_LAYOUT.slots.filter((entry) => entry.band === band.id)) {
      const runtime = bySymbol.get(slot.symbol) ?? { active: false };
      drawStation(ctx, slot.x, slot.y, {
        symbol: slot.symbol,
        w: slot.w,
        h: slot.h,
        active: runtime.active,
        result: runtime.result,
        pnl: runtime.pnl,
      });
    }
  }
}

function drawBottomBand(ctx) {
  const sign = (x, y, w, h, text, color) => {
    drawWallPanel(ctx, x, y, w, h, { bg: "#0e1a2c" });
    drawPixelParagraph(ctx, text, x + w / 2, y + 10, w - 14, { scale: 1, align: "center", color, lineHeight: 12 });
  };
  sign(202, 926, 372 - 202, 992 - 926, "DISCIPLINA HOJE RESULTADOS SEMPRE", PALETTE.goldHi);
  sign(1160, 926, 1332 - 1160, 992 - 926, "PEQUENAS DECISOES GRANDES RESULTADOS", PALETTE.goldHi);
  stairs(ctx, 400, 890, 520 - 400, 1005 - 890, { direction: "right" });
  stairs(ctx, 1030, 890, 1150 - 1030, 1005 - 890, { direction: "left" });

  // centre lounge: big red patterned rug, brown leather sofas, plants
  patterned_rug(ctx, 528, 902, 496, 118, { color: PALETTE.rugRed, inner: PALETTE.rugRedHi, accent: PALETTE.rugCream, border: PALETTE.gold });
  const leather = { color: PALETTE.leather, outline: PALETTE.leatherDark, color3: PALETTE.leatherHi };
  sofa(ctx, 556, 908, 154, { h: 32, ...leather });
  sofa(ctx, 850, 908, 154, { h: 32, ...leather });
  armchair(ctx, 596, 966, { w: 34, h: 30, ...leather });
  armchair(ctx, 928, 966, { w: 34, h: 30, ...leather });
  coffee_table(ctx, 704, 958, 72, { h: 16 });
  trader(ctx, 588, 918, { variant: 1, shirt: "#3a4a7a", tie: null });
  critic(ctx, 880, 918, { variant: 3, glasses: false });
  // small dog on the right sofa
  pxRect(ctx, 944, 916, 16, 9, PALETTE.hair3);
  pxRect(ctx, 942, 912, 6, 6, PALETTE.hair3);
  pxRect(ctx, 956, 912, 4, 5, PALETTE.hair3);
  pxRect(ctx, 946, 918, 3, 2, "#2b2118");

  plant_large(ctx, 686, 1014, {});
  plant_large(ctx, 846, 1014, {});
  plant_small(ctx, 522, 1010, {});
  plant_small(ctx, 1012, 1010, {});
  lamp(ctx, 500, 972, { height: 30, pool: 40, alpha: 0.15 });
  lamp(ctx, 1044, 972, { height: 30, pool: 40, alpha: 0.15 });

  const bx = 680;
  const by = 942;
  const bw = 872 - 680;
  const bh = 1012 - 942;
  pxRect(ctx, bx - 3, by - 3, bw + 6, bh + 6, PALETTE.goldDark);
  pxRect(ctx, bx, by, bw, bh, "#0a1526");
  pxRect(ctx, bx + 2, by + 2, bw - 4, 2, PALETTE.border);
  pxRect(ctx, bx + 2, by + bh - 4, bw - 4, 2, PALETTE.border);
  drawPixelText(ctx, "TRACE/COM", bx + bw / 2, by + 8, { scale: 2, align: "center", color: PALETTE.white });
  drawPixelText(ctx, "VISION · SHADOW · RESULT", bx + bw / 2, by + 30, { scale: 1, align: "center", color: PALETTE.goldHi });
}

/** Dense warm set dressing so no large flat region is left empty. */
function drawDecorations(ctx) {
  const plants = [
    [168, 300, "large"], [168, 468, "small"], [168, 596, "small"], [168, 704, "large"],
    [168, 828, "small"], [168, 906, "small"],
    [1452, 300, "large"], [1452, 468, "small"], [1452, 596, "small"], [1452, 704, "large"],
    [1452, 828, "small"], [1452, 906, "small"],
    [36, 340, "large"], [36, 500, "small"], [36, 660, "large"], [36, 820, "small"],
    [1492, 350, "small"], [1492, 520, "small"], [1492, 690, "small"], [1492, 860, "small"],
    [186, 250, "large"], [186, 330, "small"], [540, 250, "small"], [540, 300, "large"],
    [1044, 220, "small"], [1044, 300, "large"], [1348, 360, "small"],
    [470, 1012, "small"], [600, 1012, "large"], [960, 1012, "large"], [1090, 1012, "small"],
    [188, 950, "small"], [1330, 960, "small"],
  ];
  plants.forEach(([x, y, kind]) => {
    if (kind === "large") plant_large(ctx, x, y, { scale: 1 });
    else plant_small(ctx, x, y, { scale: 1 });
  });

  // wall sconces casting warm amber pools
  const topLamps = [[110, 30], [214, 30], [323, 104], [487, 36], [1081, 42], [1183, 50], [1418, 42]];
  for (const [lx, lw] of topLamps) wall_lamp(ctx, lx, 6, lw, 16, { pool: Math.round(lw * 1.1), alpha: 0.16 });
  for (let sx = 260; sx <= 1420; sx += 160) wall_sconce(ctx, sx, 902, { pool: 30, alpha: 0.1 });

  // floor lamps at the trading-floor corners
  lamp(ctx, 205, 360, { height: 32, pool: 38, alpha: 0.13 });
  lamp(ctx, 1450, 360, { height: 32, pool: 38, alpha: 0.13 });
  lamp(ctx, 205, 900, { height: 32, pool: 38, alpha: 0.13 });
  lamp(ctx, 1450, 900, { height: 32, pool: 38, alpha: 0.13 });

  // side tables + bookshelves filling the vertical margins
  const sideTable = (x, y) => {
    pxRect(ctx, x, y, 26, 12, PALETTE.woodDark);
    pxRect(ctx, x, y, 26, 3, PALETTE.wood);
    pxRect(ctx, x + 2, y + 12, 3, 6, PALETTE.woodShadow);
    pxRect(ctx, x + 21, y + 12, 3, 6, PALETTE.woodShadow);
    pxRect(ctx, x + 6, y - 4, 6, 4, PALETTE.white);
  };
  sideTable(180, 420);
  sideTable(180, 540);
  sideTable(1440, 420);
  sideTable(1440, 540);
  sideTable(180, 760);
  sideTable(1440, 760);
  bookshelf(ctx, 178, 250, 20, 46, { shelves: 3, seed: 5 });
  bookshelf(ctx, 1446, 250, 20, 46, { shelves: 3, seed: 9 });

  // framed posters with real art (landscape or chart) — never empty boxes
  const poster = (x, y, w, h, accent, art) => {
    pxRect(ctx, x, y, w, h, PALETTE.woodDark);
    pxRect(ctx, x + 1, y + 1, w - 2, h - 2, PALETTE.gold);
    pxRect(ctx, x + 3, y + 3, w - 6, h - 6, "#f2e8d0");
    pxRect(ctx, x + 5, y + 5, w - 10, h - 10, "#0d1a2c");
    const ax = x + 5;
    const ay = y + 5;
    const aw = w - 10;
    const ah = h - 10;
    if (art === "chart") {
      pxRect(ctx, ax, ay + ah - 6, aw, 1, PALETTE.metal);
      const bars = [0.35, 0.5, 0.42, 0.68, 0.8];
      bars.forEach((value, index) => {
        const bw = Math.max(3, Math.floor((aw - 8) / bars.length) - 3);
        const bh = Math.round(value * (ah - 12));
        pxRect(ctx, ax + 4 + index * (bw + 3), ay + ah - 6 - bh, bw, bh, index === bars.length - 1 ? accent : PALETTE.bandBlue);
      });
    } else {
      // landscape: sun + hills
      pxRect(ctx, ax, ay, aw, Math.round(ah * 0.62), "#173a5e");
      pxRect(ctx, ax + aw - 12, ay + 4, 6, 6, PALETTE.amber);
      pxPoly(ctx, [{ x: ax, y: ay + ah }, { x: ax + aw * 0.4, y: ay + ah * 0.42 }, { x: ax + aw * 0.78, y: ay + ah }], "#2f7d4f");
      pxPoly(ctx, [{ x: ax + aw * 0.45, y: ay + ah }, { x: ax + aw * 0.72, y: ay + ah * 0.6 }, { x: ax + aw, y: ay + ah }], accent);
      pxRect(ctx, ax, ay + ah - 3, aw, 3, "#3f8f4f");
    }
  };
  poster(240, 18, 56, 62, PALETTE.rugRed, "chart");
  poster(186, 96, 96, 62, PALETTE.bandGreen, "landscape");
  poster(186, 184, 96, 62, PALETTE.rugRed, "chart");
  poster(420, 18, 92, 62, PALETTE.bandGreen, "landscape");
  poster(1044, 168, 92, 62, PALETTE.bandBlue, "chart");

  // right-side lounge: leather sofa + wall TV + plants filling the void
  sofa(ctx, 1044, 262, 54, { h: 26, color: PALETTE.sofaLeather, outline: "#241a13", color3: PALETTE.sofaLeatherHi });
  pxRect(ctx, 1036, 200, 66, 40, "#0a1526");
  pxRect(ctx, 1038, 202, 62, 36, "#0b1a2c");
  pxRect(ctx, 1042, 216, 40, 2, PALETTE.screenGreen);
  pxRect(ctx, 1042, 222, 28, 2, PALETTE.screenGreen);
  pxRect(ctx, 1042, 228, 34, 2, PALETTE.screenGreen);
  pxRect(ctx, 1080, 208, 14, 10, PALETTE.screenOn);
  // right-side infill between the panel stack and the trading floor
  plant_small(ctx, 1050, 300, {});
  plant_large(ctx, 1084, 300, {});
  lamp(ctx, 1268, 332, { height: 30, pool: 42, alpha: 0.14 });
  plant_small(ctx, 1394, 306, {});
  bookshelf(ctx, 1350, 300, 26, 34, { shelves: 2, seed: 17 });

  // bottom-left corner lounge nook
  pxRect(ctx, 0, 856, 170, 168, "#6a4a34");
  pxRect(ctx, 0, 856, 170, 2, "#8a6446");
  lightPool(ctx, 120, 900, 140, PALETTE.amber, 0.30);
  rug(ctx, 24, 914, 150, 86, { color: PALETTE.rugRed, inner: PALETTE.rugRedHi });
  bookshelf(ctx, 28, 906, 26, 58, { shelves: 3, seed: 11 });
  sideTable(96, 926);
  plant_large(ctx, 66, 962, {});
  plant_small(ctx, 150, 990, {});
  armchair(ctx, 96, 950, { w: 32, h: 28, color: PALETTE.sofaLeather, outline: "#241a13", color3: PALETTE.sofaLeatherHi });
  lamp(ctx, 40, 986, { height: 30, pool: 40, alpha: 0.16 });

  // bottom-right corner lounge nook
  pxRect(ctx, 1366, 856, 170, 168, "#6a4a34");
  pxRect(ctx, 1366, 856, 170, 2, "#8a6446");
  lightPool(ctx, 1440, 900, 130, PALETTE.amber, 0.26);
  rug(ctx, 1362, 914, 150, 86, { color: PALETTE.rugRed, inner: PALETTE.rugRedHi });
  plant_large(ctx, 1368, 962, {});
  bookshelf(ctx, 1470, 906, 26, 58, { shelves: 3, seed: 13 });
  sideTable(1430, 926);
  plant_small(ctx, 1500, 990, {});
  lamp(ctx, 1452, 1002, { height: 30, pool: 36, alpha: 0.13 });
}

/* ------------------------------------------------------------------ *
 * 14. ORCHESTRATOR
 * ------------------------------------------------------------------ */

/** Solid backdrops behind the left/right panel stacks so labels never float over the floor. */
function drawPanelBackdrops(ctx) {
  const rects = [
    [14, 14, 218, 78],
    [14, 96, 162, 80],
    [300, 18, 92, 124],
    [12, 184, 120, 208],
    [12, 398, 120, 164],
    [12, 568, 120, 80],
    [12, 654, 120, 118],
    [1400, 330, 132, 140],
    [1400, 500, 132, 160],
    [1400, 668, 132, 122],
    [1400, 796, 132, 204],
  ];
  for (const [x, y, w, h] of rects) {
    pxRect(ctx, x, y, w, h, PALETTE.wallPanel);
    pxRect(ctx, x, y, w, 3, PALETTE.wallWarmHi);
    ctx.strokeStyle = PALETTE.goldDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

/** Local light pools + subtle warm ambient + vignette (light comes from objects, not a global filter). */
function drawLighting(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(255,176,88,0.08)";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  ctx.restore();

  const pools = [
    [716, 96, 250, "rgba(120,200,255,0.16)"],
    [1163, 80, 140, "rgba(120,200,255,0.14)"],
    [120, 34, 130, "rgba(255,190,110,0.22)"],
    [248, 150, 130, "rgba(255,190,110,0.20)"],
    [60, 260, 120, "rgba(255,190,110,0.18)"],
    [410, 210, 180, "rgba(255,190,110,0.18)"],
    [640, 277, 160, "rgba(255,200,120,0.15)"],
    [920, 275, 160, "rgba(255,190,110,0.17)"],
    [1230, 250, 160, "rgba(255,200,120,0.20)"],
    [1420, 275, 160, "rgba(255,190,110,0.17)"],
    [1466, 400, 130, "rgba(255,190,110,0.15)"],
    [1466, 580, 130, "rgba(255,190,110,0.15)"],
    [1466, 730, 130, "rgba(255,190,110,0.15)"],
    [1466, 900, 130, "rgba(255,190,110,0.15)"],
    [776, 977, 190, "rgba(255,190,110,0.17)"],
  ];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, r, color] of pools) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();

  const v = ctx.createRadialGradient(768, 500, 250, 768, 500, 940);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.80)");
  ctx.save();
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  ctx.restore();
}

export function drawBlueprint(ctx, state) {
  const scene = state ?? buildStaticBlueprintState();
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawFloor(ctx);
  drawPanelBackdrops(ctx);
  // wall/panel stacks first so desks always render above them
  drawRightColumn(ctx);
  drawQuadroFocus(ctx);
  drawQuadroLongTerm(ctx);
  drawProfessorPanel(ctx);
  drawMeetingRoomPanel(ctx);
  drawPlanningPanel(ctx);
  drawDataCenterPanel(ctx);
  drawDailyBoardRegion(ctx, scene);
  drawWorldMapPanel(ctx);
  drawGlobalMarketsPanel(ctx);
  drawRedDisciplinePanel(ctx);
  drawBullStatue(ctx);
  drawLeftLounge(ctx);
  drawPoolArea(ctx);
  drawRightLounge(ctx);
  drawCafeKitchen(ctx);
  drawMeetingTable(ctx);
  drawDecorations(ctx);
  drawTradingFloor(ctx, scene);
  drawBottomBand(ctx);
  drawLogo(ctx);
  drawLighting(ctx);
  ctx.restore();
  return { width: BASE_WIDTH, height: BASE_HEIGHT };
}

function drawDailyBoardRegion(ctx, scene) {
  daily_board(ctx, 524, 6, 908 - 524, 218 - 6, scene.daily ?? DAILY_RESULT);
  drawMarketsBoxes(ctx, scene.daily ?? DAILY_RESULT);
}

/* ------------------------------------------------------------------ *
 * 15. ASSET KIT REGISTRY
 * ------------------------------------------------------------------ */

export const ASSET_KIT = {
  wood_desk,
  chair,
  trader,
  critic,
  sofa,
  armchair,
  coffee_table,
  pool_table,
  plant_small,
  plant_large,
  bookshelf,
  lamp,
  wall_sconce,
  rug,
  kitchen_counter,
  fridge,
  research_desk,
  stairs,
  world_map,
  daily_board,
  monitor,
  plaque,
  pnl_badge,
};

export default {
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
  PALETTE,
  BADGE_COLORS,
  PNL_BADGE_STYLE,
  PANEL_TITLES,
  SUPPORTED_GLYPHS,
  drawBlueprint,
  drawStation,
  drawMasterStation,
  drawExpandedWorld,
  stationBadgeModel,
  buildStaticBlueprintState,
  measurePixelText,
  wrapPixelText,
  drawPixelText,
  drawPixelParagraph,
  drawFontSheet,
  ribbonBannerRect,
  auditPixelText,
  fontGlyphCoverage,
  fontHasGlyph,
  formatBRL,
  signedBRL,
};






