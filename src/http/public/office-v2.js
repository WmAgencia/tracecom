/**
 * PIXEL OFFICE V2 — isometric pixel-art trading floor for TraceCom.
 *
 * Dependency-free ES module. Canvas 2D, procedural pixel art (no external assets).
 * All decision/backend logic lives in the relay runtime; this file only READS the
 * `/api/iq/office` JSON and turns it into an office scene.
 *
 * Pure logic (world/layout/pathfinding/occupancy/camera/plate/pnl) is importable
 * from Node without a DOM: every DOM usage is inside functions/constructors that
 * are only called in a browser.
 */

export const OFFICE_V2_VERSION = "office-v2.0.0";

/* ------------------------------------------------------------------ *
 * 1. GEOMETRY — 2:1 isometric, 16x8 px tiles (pixel-perfect at zoom 1)
 * ------------------------------------------------------------------ */

export const CELL = 16;
export const CELL_H = 8;
export const HALF_W = CELL / 2;
export const HALF_H = CELL_H / 2;

export const DESK_W = 4;
export const DESK_D = 2;
export const SLOT_W = 5;
export const SLOT_D = 4;
export const DESKS_PER_ROW = 10;
export const SECTOR_HEADER_ROWS = 3;

export const ZOOM_LEVELS = [0.5, 1, 2, 3, 4];

export function isoProject(gx, gy) {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}

export function isoUnproject(px, py) {
  const a = px / HALF_W;
  const b = py / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function rectCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value) {
  let h = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ *
 * 2. NUMBER FORMATTING — pt-BR, BRL
 * ------------------------------------------------------------------ */

export function formatBRL(value, options = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const epsilon = 0.0000001;
  const negative = numeric < -epsilon;
  const positive = numeric > epsilon;
  const abs = Math.abs(numeric).toFixed(2);
  const [integerPart, decimals] = abs.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = negative ? "-" : positive && options.signed === true ? "+" : "";
  return `${sign}R$ ${grouped},${decimals}`;
}

export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toFixed(digits).replace(".", ",");
}

export function formatPercent(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${(numeric * 100).toFixed(digits)}%`;
}

export function formatList(value) {
  if (Array.isArray(value)) return value.length ? value.map((item) => String(item)).join(", ") : "—";
  if (typeof value === "string" && value.trim()) return value;
  return "—";
}

/* ------------------------------------------------------------------ *
 * 3. SECTORS — reference headers on the floor
 * ------------------------------------------------------------------ */

export const DEFAULT_SECTORS = [
  { id: "FOREX_MAJORS", label: "FOREX MAJORS", floor: "#2b3653", accent: "#7fb2ff", sign: "FOREX MAJORS" },
  { id: "FOREX_CROSSES", label: "FOREX CRUZADOS", floor: "#2e3a58", accent: "#8fd0ff", sign: "FOREX CRUZADOS" },
  { id: "OTC_24H", label: "OTC - 24H", floor: "#313a58", accent: "#c9a6ff", sign: "OTC - 24H" },
  { id: "CRYPTO", label: "CRIPTOMOEDAS", floor: "#39344f", accent: "#ffcf6b", sign: "CRIPTOMOEDAS" },
  { id: "INDICES", label: "ÍNDICES", floor: "#2a3a51", accent: "#6be0c0", sign: "ÍNDICES" },
  { id: "COMMODITIES", label: "COMMODITIES", floor: "#3a3529", accent: "#ffb85c", sign: "COMMODITIES" },
  { id: "OTHER", label: "OUTROS ATIVOS", floor: "#332f45", accent: "#d0d0d0", sign: "OUTROS ATIVOS" },
];

export const SECTOR_ORDER = DEFAULT_SECTORS.map((sector) => sector.id);

const FX_MAJORS = new Set(["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"]);
const FX_CROSSES = new Set([
  "EURJPY", "EURGBP", "EURCHF", "EURAUD", "EURCAD", "EURNZD",
  "GBPJPY", "GBPCHF", "GBPAUD", "GBPCAD", "GBPNZD",
  "AUDJPY", "AUDCAD", "AUDCHF", "AUDNZD", "CADJPY", "CADCHF", "NZDJPY", "NZDCHF", "NZDCAD",
  "USDMXN", "USDBRL", "USDTRY", "USDZAR",
]);
const INDICES = new Set([
  "US30", "US100", "US500", "US2000", "GER30", "UK100", "JP225", "AUS200", "EU50", "HK33", "FR40", "SP35",
  "DE40", "DJ30", "NAS100", "SPX500", "JPN225", "AUS200", "UK100",
]);
const COMMODITIES = new Set(["XAUUSD", "XAGUSD", "GOLD", "SILVER", "OIL", "WTI", "BRENT", "XPTUSD", "XPDUSD"]);
const CRYPTO = new Set(["BTCUSD", "ETHUSD", "LTCUSD", "XRPUSD", "BCHUSD", "ADAUSD", "SOLUSD", "DOGUSD", "BNBUSD"]);

export function canonicalOf(market) {
  const raw = market?.canonical ?? market?.symbol ?? String(market?.marketKey ?? "").split(":")[0] ?? "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sectorForMarket(market) {
  const canonical = canonicalOf(market);
  const marketType = String(market?.marketType ?? String(market?.marketKey ?? "").split(":")[1] ?? "").toUpperCase();
  if (CRYPTO.has(canonical) || canonical.startsWith("BTC") || canonical.startsWith("ETH")) return "CRYPTO";
  if (COMMODITIES.has(canonical) || canonical.startsWith("XAU") || canonical.startsWith("XAG")) return "COMMODITIES";
  if (INDICES.has(canonical)) return "INDICES";
  if (marketType === "OTC") return "OTC_24H";
  if (FX_MAJORS.has(canonical)) return "FOREX_MAJORS";
  if (FX_CROSSES.has(canonical)) return "FOREX_CROSSES";
  return "OTHER";
}

export function sectorDefinition(sectorId) {
  return DEFAULT_SECTORS.find((sector) => sector.id === sectorId) ?? DEFAULT_SECTORS[DEFAULT_SECTORS.length - 1];
}

/**
 * Reference ribbon bands. The authoritative image has, on two of its rows, TWO
 * ribbons sharing one band: OTC - 24H (left) + CRIPTOMOEDAS (right) and
 * ÍNDICES (left) + COMMODITIES (right). Membership is by family, never by a
 * hardcoded asset name, so the live 55-market universe maps itself in.
 */
export const SECTOR_BANDS = [
  { id: "BAND_FOREX_MAJORS", label: "FOREX MAJORS", members: [{ sectorId: "FOREX_MAJORS", side: "full" }] },
  { id: "BAND_FOREX_CROSSES", label: "FOREX CRUZADOS", members: [{ sectorId: "FOREX_CROSSES", side: "full" }] },
  {
    id: "BAND_OTC_CRYPTO",
    label: "OTC - 24H",
    members: [
      { sectorId: "OTC_24H", side: "left" },
      { sectorId: "CRYPTO", side: "right" },
    ],
  },
  {
    id: "BAND_INDICES_COMMODITIES",
    label: "ÍNDICES",
    members: [
      { sectorId: "INDICES", side: "left" },
      { sectorId: "COMMODITIES", side: "right" },
    ],
  },
  { id: "BAND_OTHER", label: "OUTROS ATIVOS", members: [{ sectorId: "OTHER", side: "full" }] },
];

export const SECTOR_BAND_ORDER = SECTOR_BANDS.map((band) => band.id);

/** Reference ribbon labels in reading order (exactly the names on the image). */
export const SECTOR_RIBBON_LABELS = SECTOR_BANDS.flatMap((band) => band.members.map((member) => sectorDefinition(member.sectorId).label));

/**
 * Reference side-panel stacks (wall signage). Purely decorative captions; the
 * simulation never reads them. Kept as data so the renderer stays procedural.
 */
export const SIDE_PANELS = {
  left: [
    { id: "brand", title: "TRACE/COM", subtitle: "DISCIPLINA · DADOS · RESULTADOS", tone: "gold" },
    { id: "focus", title: "FOCO DISCIPLINA PROCESSO RESULTADO", subtitle: "", tone: "dark" },
    { id: "longterm", title: "TRADER É UM JOGO DE LONGO PRAZO", subtitle: "", tone: "dark" },
    { id: "research", title: "PROFESSOR & PESQUISA", subtitle: "DADOS TESTES APRENDIZADO EVOLUÇÃO", tone: "gold" },
    { id: "meeting", title: "SALA DE REUNIÃO", subtitle: "", tone: "dark" },
    { id: "planning", title: "PLANEJAMENTO ESTRATÉGIA PERFORMANCE PRÓXIMOS PASSOS", subtitle: "", tone: "dark" },
    { id: "datacenter", title: "DATA CENTER", subtitle: "ESTABILIDADE CONEXÃO EXECUÇÃO SEM INTERRUPÇÕES", tone: "dark" },
  ],
  right: [
    { id: "discipline", title: "DISCIPLINA TRANSFORMA ESTRATÉGIA EM LIBERDADE", subtitle: "", tone: "red" },
    { id: "global", title: "MERCADO GLOBAL 24H OPORTUNIDADES EM TEMPO REAL", subtitle: "", tone: "map" },
    { id: "bull", title: "", subtitle: "", tone: "bull" },
    { id: "pause", title: "PAUSA TAMBÉM É ESTRATÉGIA", subtitle: "", tone: "dark" },
    { id: "leisure", title: "ÁREA DE LAZER", subtitle: "sinuca videogame conversa — RELAXAR VOLTAR MAIS FORTE", tone: "dark" },
    { id: "kitchen", title: "COZINHA", subtitle: "café energia disciplina bom humor", tone: "dark" },
    { id: "terrace", title: "TERRAÇO", subtitle: "RESPIRA ANALISA DECIDE MELHOR", tone: "dark" },
  ],
};

/** Grid anchors for the side-panel stacks (kept off the desk hall + board). */
export const SIDE_PANEL_ANCHORS = {
  left: [
    { x: 4, y: 34 }, { x: 4, y: 41 }, { x: 4, y: 48 }, { x: 4, y: 55 },
    { x: 4, y: 62 }, { x: 4, y: 69 }, { x: 4, y: 76 },
  ],
  right: [
    { x: 105, y: 4 }, { x: 105, y: 11 }, { x: 105, y: 18 }, { x: 105, y: 25 },
    { x: 105, y: 32 }, { x: 105, y: 42 }, { x: 105, y: 52 },
  ],
};

export function sectorBand(sectorId) {
  for (const band of SECTOR_BANDS) {
    const member = band.members.find((entry) => entry.sectorId === sectorId);
    if (member) return { bandId: band.id, side: member.side, label: sectorDefinition(sectorId).label };
  }
  return { bandId: null, side: "full", label: sectorDefinition(sectorId).label };
}

/**
 * Pure ribbon model: groups planned sectors into the reference bands and
 * resolves the screen-space rect + left/right halves the renderer paints.
 */
export function sectorRibbonBands(sectors) {
  const list = Array.isArray(sectors) ? sectors : [];
  const byId = new Map(list.map((sector) => [sector.id, sector]));
  const bands = [];
  for (const definition of SECTOR_BANDS) {
    const members = [];
    for (const entry of definition.members) {
      const sector = byId.get(entry.sectorId);
      if (sector) members.push({ sector, side: entry.side });
    }
    if (members.length === 0) continue;
    const left = Math.min(...members.map((member) => member.sector.header.x));
    const right = Math.max(...members.map((member) => member.sector.header.x + member.sector.header.w));
    const top = Math.min(...members.map((member) => member.sector.header.y));
    const bottom = Math.max(...members.map((member) => member.sector.floor.y + member.sector.floor.h));
    const center = (left + right) / 2;
    bands.push({
      id: definition.id,
      label: definition.label,
      split: members.length > 1,
      members: members.map((member) => ({ sectorId: member.sector.id, label: member.sector.label, side: member.side, accent: member.sector.accent })),
      rect: { x: left, y: top, w: right - left, h: Math.max(1, bottom - top) },
      ribbon: { x: left, y: top, w: right - left, h: 1 },
      leftHalf: { x: left, y: top, w: center - left, h: 1 },
      rightHalf: { x: center, y: top, w: right - center, h: 1 },
      rows: members.flatMap((member) => member.sector.rows.map((row) => ({ y: row.y, sectorId: member.sector.id, side: member.side }))).sort((a, b) => a.y - b.y),
    });
  }
  return bands;
}

/* ------------------------------------------------------------------ *
 * 4. WORLD LAYOUT — central hall + side rooms (reference blueprint)
 * ------------------------------------------------------------------ */

export const WORLD_LAYOUT = {
  gridWidth: 106,
  gridHeight: 76,
  hallX: 22,
  hallY: 16,
  board: { x: 30, y: 3, w: 30, h: 4 },
  socialBand: { x: 24, y: 8, w: 58, h: 7 },
  mapPanel: { x: 80, y: 2, w: 24, h: 8 },
  research: { x: 80, y: 12, w: 24, h: 20 },
  meeting: { x: 80, y: 36, w: 24, h: 14 },
  leisure: { x: 80, y: 54, w: 24, h: 20 },
  kitchen: { x: 2, y: 12, w: 16, h: 18 },
  dataCenter: { x: 2, y: 36, w: 16, h: 16 },
};

export function planStationLayout(markets, options = {}) {
  const desksPerRow = options.desksPerRow ?? DESKS_PER_ROW;
  const hallX = options.hallX ?? WORLD_LAYOUT.hallX;
  const hallY = options.hallY ?? WORLD_LAYOUT.hallY;
  const list = (Array.isArray(markets) ? markets : []).filter((market) => market && typeof market.marketKey === "string" && market.marketKey.length > 0);
  const bySector = new Map();
  for (const market of list) {
    const sectorId = sectorForMarket(market);
    if (!bySector.has(sectorId)) bySector.set(sectorId, []);
    bySector.get(sectorId).push(market);
  }
  const stations = [];
  const sectors = [];
  let cursorY = hallY;
  let maxRight = hallX;
  for (const definition of DEFAULT_SECTORS) {
    const items = bySector.get(definition.id);
    if (!items || items.length === 0) continue;
    const headerY = cursorY;
    let rowY = cursorY + SECTOR_HEADER_ROWS;
    const rows = [];
    const sectorStationIds = [];
    for (let offset = 0; offset < items.length; offset += desksPerRow) {
      const chunk = items.slice(offset, offset + desksPerRow);
      const stationIds = [];
      chunk.forEach((market, col) => {
        const x = hallX + col * SLOT_W;
        const station = {
          id: `station:${market.marketKey}`,
          marketKey: market.marketKey,
          market,
          sectorId: definition.id,
          row: rows.length,
          col,
          slot: { x, y: rowY, w: SLOT_W, h: SLOT_D },
          desk: { x, y: rowY + 1, w: DESK_W, h: DESK_D },
          seat: [{ x: x + 1, y: rowY }, { x: x + 3, y: rowY }],
          plate: { x: x + DESK_W / 2, y: rowY + 1 + DESK_D },
        };
        station.platePx = isoProject(station.plate.x, station.plate.y);
        stations.push(station);
        stationIds.push(station.id);
        sectorStationIds.push(station.id);
        maxRight = Math.max(maxRight, x + SLOT_W);
      });
      rows.push({ y: rowY, stationIds });
      rowY += SLOT_D;
    }
    cursorY = rowY;
    const maxCols = Math.min(desksPerRow, items.length);
    const band = sectorBand(definition.id);
    sectors.push({
      id: definition.id,
      label: definition.label,
      accent: definition.accent,
      floorColor: definition.floor,
      sign: definition.sign,
      bandId: band.bandId,
      bandSide: band.side,
      header: { x: hallX - 1, y: headerY - 1, w: maxCols * SLOT_W + 2, h: 1 },
      labelPos: { x: hallX, y: headerY + 1 },
      floor: { x: hallX - 2, y: headerY - 2, w: maxCols * SLOT_W + 4, h: cursorY - headerY + 4 },
      rows,
      stationIds: sectorStationIds,
      count: items.length,
    });
  }
  const hall = { x: hallX - 2, y: hallY - 2, w: maxRight - hallX + 4, h: cursorY - hallY + 4 };
  const corridors = [];
  for (const station of stations) {
    const y = station.slot.y + SLOT_D - 1;
    if (!corridors.some((corridor) => corridor.y === y)) {
      corridors.push({ x: hallX - 2, y, w: maxRight - hallX + 4, h: 1 });
    }
  }
  return { stations, sectors, hall, corridors, desksPerRow };
}

/* ------------------------------------------------------------------ *
 * 5. AREAS — research, meeting, leisure, kitchen, data center, map
 * ------------------------------------------------------------------ */

export class ResearchArea {
  constructor(rect) {
    this.id = "research";
    this.label = "PROFESSOR & PESQUISA";
    this.rect = rect;
    this.floorColor = "#2c3550";
    this.furniture = [
      { kind: "shelf", rect: { x: 81, y: 13, w: 6, h: 2 }, blocksWalk: true },
      { kind: "shelf", rect: { x: 88, y: 13, w: 6, h: 2 }, blocksWalk: true },
      { kind: "shelf", rect: { x: 95, y: 13, w: 6, h: 2 }, blocksWalk: true },
      { kind: "shelf", rect: { x: 101, y: 18, w: 2, h: 8 }, blocksWalk: true },
      { kind: "profDesk", rect: { x: 86, y: 22, w: 5, h: 2 }, blocksWalk: true },
      { kind: "table", rect: { x: 94, y: 27, w: 4, h: 2 }, blocksWalk: true },
      { kind: "easel", rect: { x: 98, y: 28, w: 1, h: 1 }, blocksWalk: true },
    ];
    this.billboards = [
      { kind: "whiteboard", anchor: { x: 91, y: 16 } },
      { kind: "chartPin", anchor: { x: 83, y: 20 } },
    ];
    this.spots = [
      { id: "spot:research:1", kind: "research", x: 84, y: 27, capacity: 1, label: "Mesa de estudo" },
      { id: "spot:research:2", kind: "research", x: 87, y: 27, capacity: 1, label: "Mesa de estudo" },
      { id: "spot:research:3", kind: "research", x: 90, y: 27, capacity: 1, label: "Mesa de estudo" },
    ];
    this.plants = [{ x: 82, y: 29 }, { x: 102, y: 12 }];
    this.signAnchor = { x: 82, y: 14 };
  }
}

export class MeetingRoomArea {
  constructor(rect) {
    this.id = "meeting";
    this.label = "SALA DE REUNIÃO";
    this.rect = rect;
    this.floorColor = "#2f3149";
    this.furniture = [
      { kind: "table", rect: { x: 87, y: 39, w: 8, h: 3 }, blocksWalk: true },
      { kind: "chair", rect: { x: 88, y: 38, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 90, y: 38, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 92, y: 38, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 88, y: 43, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 90, y: 43, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 92, y: 43, w: 1, h: 1 }, blocksWalk: true },
    ];
    this.billboards = [{ kind: "screen", anchor: { x: 94, y: 38 } }];
    this.spots = [
      { id: "spot:social:1", kind: "social", x: 84, y: 40, capacity: 1, label: "Sala de reunião" },
      { id: "spot:social:2", kind: "social", x: 84, y: 42, capacity: 1, label: "Sala de reunião" },
      { id: "spot:social:3", kind: "social", x: 96, y: 40, capacity: 1, label: "Sala de reunião" },
      { id: "spot:social:4", kind: "social", x: 96, y: 42, capacity: 1, label: "Sala de reunião" },
    ];
    this.plants = [{ x: 102, y: 48 }];
    this.signAnchor = { x: 82, y: 38 };
  }
}

export class LeisureArea {
  constructor(rect) {
    this.id = "leisure";
    this.label = "ÁREA DE LAZER";
    this.rect = rect;
    this.floorColor = "#2d3a4b";
    this.furniture = [
      { kind: "rug", rect: { x: 82, y: 56, w: 8, h: 6 }, blocksWalk: false },
      { kind: "rug", rect: { x: 90, y: 64, w: 10, h: 8 }, blocksWalk: false },
      { kind: "poolTable", rect: { x: 92, y: 56, w: 4, h: 3 }, blocksWalk: true },
      { kind: "sofa", rect: { x: 82, y: 64, w: 3, h: 1 }, blocksWalk: true },
      { kind: "sofa", rect: { x: 87, y: 64, w: 3, h: 1 }, blocksWalk: true },
      { kind: "sofa", rect: { x: 96, y: 69, w: 3, h: 1 }, blocksWalk: true },
      { kind: "coffeeTable", rect: { x: 83, y: 61, w: 2, h: 1 }, blocksWalk: true },
    ];
    this.billboards = [];
    this.spots = [
      { id: "spot:pool:1", kind: "pool", x: 91, y: 57, capacity: 1, label: "Sinuca" },
      { id: "spot:pool:2", kind: "pool", x: 96, y: 57, capacity: 1, label: "Sinuca" },
      { id: "spot:leisure:1", kind: "leisure", x: 83, y: 65, capacity: 1, label: "Sofá" },
      { id: "spot:leisure:2", kind: "leisure", x: 88, y: 65, capacity: 1, label: "Sofá" },
      { id: "spot:leisure:3", kind: "leisure", x: 97, y: 70, capacity: 1, label: "Sofá" },
    ];
    this.plants = [{ x: 81, y: 55 }, { x: 102, y: 55 }, { x: 101, y: 74 }];
    this.signAnchor = { x: 82, y: 55 };
  }
}

export class KitchenArea {
  constructor(rect) {
    this.id = "kitchen";
    this.label = "COZINHA";
    this.rect = rect;
    this.floorColor = "#33384d";
    this.furniture = [
      { kind: "counter", rect: { x: 3, y: 13, w: 8, h: 1 }, blocksWalk: true },
      { kind: "coffeeMachine", rect: { x: 11, y: 13, w: 3, h: 1 }, blocksWalk: true },
      { kind: "fridge", rect: { x: 3, y: 17, w: 1, h: 2 }, blocksWalk: true },
      { kind: "counter", rect: { x: 15, y: 13, w: 1, h: 6 }, blocksWalk: true },
      { kind: "island", rect: { x: 6, y: 20, w: 4, h: 2 }, blocksWalk: true },
      { kind: "stool", rect: { x: 6, y: 19, w: 1, h: 1 }, blocksWalk: false },
      { kind: "stool", rect: { x: 9, y: 19, w: 1, h: 1 }, blocksWalk: false },
    ];
    this.billboards = [];
    this.spots = [
      { id: "spot:coffee:1", kind: "coffee", x: 11, y: 15, capacity: 1, label: "Café" },
      { id: "spot:coffee:2", kind: "coffee", x: 12, y: 15, capacity: 1, label: "Café" },
      { id: "spot:kitchen:1", kind: "kitchen", x: 6, y: 19, capacity: 1, label: "Banquinho" },
      { id: "spot:kitchen:2", kind: "kitchen", x: 9, y: 19, capacity: 1, label: "Banquinho" },
    ];
    this.plants = [{ x: 3, y: 28 }];
    this.signAnchor = { x: 3, y: 14 };
  }
}

export class DataCenterArea {
  constructor(rect) {
    this.id = "dataCenter";
    this.label = "DATA CENTER";
    this.rect = rect;
    this.floorColor = "#262c40";
    this.furniture = [
      { kind: "rack", rect: { x: 3, y: 38, w: 2, h: 6 }, blocksWalk: true },
      { kind: "rack", rect: { x: 7, y: 38, w: 2, h: 6 }, blocksWalk: true },
      { kind: "rack", rect: { x: 11, y: 38, w: 2, h: 6 }, blocksWalk: true },
      { kind: "rack", rect: { x: 3, y: 46, w: 2, h: 4 }, blocksWalk: true },
      { kind: "rack", rect: { x: 11, y: 46, w: 2, h: 4 }, blocksWalk: true },
    ];
    this.billboards = [];
    this.spots = [];
    this.plants = [{ x: 3, y: 51 }];
    this.signAnchor = { x: 3, y: 39 };
  }
}

export class SocialBandArea {
  constructor(rect) {
    this.id = "socialBand";
    this.label = "BOM TRADE TAMBÉM SE CELEBRA!";
    this.rect = rect;
    this.floorColor = "#142642";
    this.furniture = [
      { kind: "rug", rect: { x: 26, y: 9, w: 9, h: 5 }, blocksWalk: false },
      { kind: "sofa", rect: { x: 27, y: 9, w: 3, h: 1 }, blocksWalk: true },
      { kind: "sofa", rect: { x: 31.5, y: 9, w: 3, h: 1 }, blocksWalk: true },
      { kind: "coffeeTable", rect: { x: 29, y: 11, w: 2, h: 1 }, blocksWalk: true },
      { kind: "poolTable", rect: { x: 38, y: 9, w: 4, h: 3 }, blocksWalk: true },
      { kind: "rug", rect: { x: 49, y: 10, w: 9, h: 5 }, blocksWalk: false },
      { kind: "sofa", rect: { x: 50, y: 10, w: 3, h: 1 }, blocksWalk: true },
      { kind: "sofa", rect: { x: 54.5, y: 10, w: 3, h: 1 }, blocksWalk: true },
      { kind: "coffeeTable", rect: { x: 52, y: 12, w: 2, h: 1 }, blocksWalk: true },
      { kind: "counter", rect: { x: 61, y: 9, w: 8, h: 1 }, blocksWalk: true },
      { kind: "stool", rect: { x: 62, y: 11, w: 1, h: 1 }, blocksWalk: false },
      { kind: "stool", rect: { x: 65, y: 11, w: 1, h: 1 }, blocksWalk: false },
      { kind: "stool", rect: { x: 68, y: 11, w: 1, h: 1 }, blocksWalk: false },
      { kind: "table", rect: { x: 72, y: 10, w: 6, h: 2 }, blocksWalk: true },
      { kind: "chair", rect: { x: 73, y: 9, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 75, y: 9, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 73, y: 12.5, w: 1, h: 1 }, blocksWalk: true },
      { kind: "chair", rect: { x: 75, y: 12.5, w: 1, h: 1 }, blocksWalk: true },
    ];
    this.billboards = [
      { kind: "hangingSign", anchor: { x: 34, y: 8.2 }, label: "BOM TRADE TAMBÉM SE CELEBRA!" },
      { kind: "hangingSign", anchor: { x: 65, y: 8.2 }, label: "CAFÉ IDEIAS TRADES RESULTADOS" },
    ];
    this.spots = [
      { id: "spot:band:social:1", kind: "social", x: 28, y: 10, capacity: 1, label: "Sofá social" },
      { id: "spot:band:social:2", kind: "social", x: 32.5, y: 10, capacity: 1, label: "Sofá social" },
      { id: "spot:band:pool:1", kind: "pool", x: 39, y: 10, capacity: 1, label: "Sinuca" },
      { id: "spot:band:pool:2", kind: "pool", x: 41, y: 10, capacity: 1, label: "Sinuca" },
      { id: "spot:band:social:3", kind: "social", x: 51, y: 11, capacity: 1, label: "Sofá social" },
      { id: "spot:band:social:4", kind: "social", x: 55.5, y: 11, capacity: 1, label: "Sofá social" },
      { id: "spot:band:coffee:1", kind: "coffee", x: 62, y: 11, capacity: 1, label: "Café" },
      { id: "spot:band:coffee:2", kind: "coffee", x: 65, y: 11, capacity: 1, label: "Café" },
      { id: "spot:band:meeting:1", kind: "social", x: 73, y: 10, capacity: 1, label: "Mesa social" },
      { id: "spot:band:meeting:2", kind: "social", x: 75, y: 10, capacity: 1, label: "Mesa social" },
      { id: "spot:band:meeting:3", kind: "social", x: 73, y: 13, capacity: 1, label: "Mesa social" },
      { id: "spot:band:meeting:4", kind: "social", x: 75, y: 13, capacity: 1, label: "Mesa social" },
    ];
    this.plants = [{ x: 25, y: 13 }, { x: 36, y: 13 }, { x: 47, y: 13 }, { x: 59, y: 13 }, { x: 70, y: 13 }, { x: 79, y: 13 }];
    this.signAnchor = { x: 25, y: 8 };
  }
}

export class WorldMapPanel {
  constructor(rect) {
    this.id = "worldMap";
    this.label = "MAPA MUNDI";
    this.rect = rect;
    this.floorColor = "#2a3247";
    this.furniture = [{ kind: "mapFloor", rect, blocksWalk: true }];
    this.billboards = [{ kind: "worldMap", anchor: { x: rect.x + rect.w / 2, y: rect.y + rect.h - 1 } }];
    this.spots = [];
    this.plants = [];
    this.signAnchor = { x: rect.x + 2, y: rect.y + rect.h - 1 };
  }
}

export function buildAreas(layout = WORLD_LAYOUT) {
  return [
    new SocialBandArea(layout.socialBand ?? WORLD_LAYOUT.socialBand),
    new ResearchArea(layout.research),
    new MeetingRoomArea(layout.meeting),
    new LeisureArea(layout.leisure),
    new KitchenArea(layout.kitchen),
    new DataCenterArea(layout.dataCenter),
    new WorldMapPanel(layout.mapPanel),
  ];
}

/* ------------------------------------------------------------------ *
 * 6. WALKABILITY GRID + A* PATHFINDING
 * ------------------------------------------------------------------ */

export class OfficeGrid {
  constructor(width, height, options = {}) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.walkable = options.walkable === false ? 0 : 1;
    this.cells = new Uint8Array(this.width * this.height).fill(this.walkable);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x, y) {
    return y * this.width + x;
  }

  isWalkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    return this.cells[this.index(x, y)] === 1;
  }

  setWalkable(x, y, value) {
    if (!this.inBounds(x, y)) return;
    this.cells[this.index(x, y)] = value ? 1 : 0;
  }

  blockRect(x, y, w, h) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let cy = y0; cy < y1; cy += 1) {
      for (let cx = x0; cx < x1; cx += 1) this.cells[this.index(cx, cy)] = 0;
    }
  }

  blockBorder(thickness = 1) {
    const t = Math.max(1, Math.floor(thickness));
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (x < t || y < t || x >= this.width - t || y >= this.height - t) this.cells[this.index(x, y)] = 0;
      }
    }
  }

  walkableCount() {
    let count = 0;
    for (let index = 0; index < this.cells.length; index += 1) if (this.cells[index] === 1) count += 1;
    return count;
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  less(a, b) {
    return a.f < b.f || (a.f === b.f && a.index < b.index);
  }

  push(item) {
    const heap = this.items;
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(heap[index], heap[parent])) break;
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
  }

  pop() {
    const heap = this.items;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && this.less(heap[left], heap[smallest])) smallest = left;
        if (right < heap.length && this.less(heap[right], heap[smallest])) smallest = right;
        if (smallest === index) break;
        [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
        index = smallest;
      }
    }
    return top;
  }
}

const ORTHO_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const DIAG_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export class PathfindingSystem {
  constructor(grid, options = {}) {
    this.grid = grid;
    this.allowDiagonal = options.allowDiagonal === true;
    this.maxExpansions = Math.max(64, Number(options.maxExpansions) || 50000);
  }

  findPath(start, goal) {
    const grid = this.grid;
    if (!grid || !start || !goal) return null;
    const sx = Math.round(start.x);
    const sy = Math.round(start.y);
    const gx = Math.round(goal.x);
    const gy = Math.round(goal.y);
    if (!grid.isWalkable(sx, sy) || !grid.isWalkable(gx, gy)) return null;
    if (sx === gx && sy === gy) return [{ x: sx, y: sy }];
    const width = grid.width;
    const total = width * grid.height;
    const gScore = new Float64Array(total).fill(Infinity);
    const fScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = new MinHeap();
    const startIndex = grid.index(sx, sy);
    const goalIndex = grid.index(gx, gy);
    const heuristic = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
    gScore[startIndex] = 0;
    fScore[startIndex] = heuristic(sx, sy);
    open.push({ index: startIndex, f: fScore[startIndex] });
    const directions = this.allowDiagonal ? DIAG_DIRS : ORTHO_DIRS;
    let expansions = 0;
    while (open.size > 0) {
      const current = open.pop();
      const currentIndex = current.index;
      if (currentIndex === goalIndex) {
        const path = [];
        let cursor = currentIndex;
        while (cursor !== -1) {
          const cx = cursor % width;
          const cy = (cursor - cx) / width;
          path.push({ x: cx, y: cy });
          cursor = cameFrom[cursor];
        }
        path.reverse();
        return path;
      }
      if (closed[currentIndex]) continue;
      closed[currentIndex] = 1;
      expansions += 1;
      if (expansions > this.maxExpansions) return null;
      const cx = currentIndex % width;
      const cy = (currentIndex - cx) / width;
      for (const [dx, dy] of directions) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!grid.isWalkable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!grid.isWalkable(cx + dx, cy) || !grid.isWalkable(cx, cy + dy))) continue;
        const neighborIndex = grid.index(nx, ny);
        if (closed[neighborIndex]) continue;
        const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
        const tentative = gScore[currentIndex] + step;
        if (tentative < gScore[neighborIndex] - 1e-9) {
          cameFrom[neighborIndex] = currentIndex;
          gScore[neighborIndex] = tentative;
          fScore[neighborIndex] = tentative + heuristic(nx, ny);
          open.push({ index: neighborIndex, f: fScore[neighborIndex] });
        }
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 7. OCCUPANCY — reservations for sofas/pool/coffee/kitchen/social
 * ------------------------------------------------------------------ */

export class OccupancySystem {
  constructor(spots = []) {
    this.spots = new Map();
    for (const spot of spots) {
      if (!spot || !spot.id) continue;
      this.spots.set(spot.id, {
        id: spot.id,
        kind: spot.kind ?? "generic",
        x: Number(spot.x) || 0,
        y: Number(spot.y) || 0,
        capacity: Math.max(1, Math.floor(Number(spot.capacity) || 1)),
        label: spot.label ?? spot.kind ?? spot.id,
        reservations: [],
      });
    }
  }

  list(kind = null) {
    const values = [...this.spots.values()];
    return kind ? values.filter((spot) => spot.kind === kind) : values;
  }

  capacity(spotId) {
    return this.spots.get(spotId)?.capacity ?? 0;
  }

  occupancy(spotId) {
    return this.spots.get(spotId)?.reservations.length ?? 0;
  }

  available(spotId) {
    const spot = this.spots.get(spotId);
    if (!spot) return 0;
    return Math.max(0, spot.capacity - spot.reservations.length);
  }

  totalOccupied() {
    let total = 0;
    for (const spot of this.spots.values()) total += spot.reservations.length;
    return total;
  }

  reserve(spotId, agentId, at = 0) {
    const spot = this.spots.get(spotId);
    if (!spot) return { ok: false, reason: "UNKNOWN_SPOT" };
    if (spot.reservations.some((reservation) => reservation.agentId === agentId)) return { ok: false, reason: "ALREADY_RESERVED" };
    if (spot.reservations.length >= spot.capacity) return { ok: false, reason: "FULL" };
    spot.reservations.push({ agentId, at });
    return { ok: true, spotId, kind: spot.kind, slot: spot.reservations.length - 1, x: spot.x, y: spot.y };
  }

  reserveFirst(agentId, kinds, at = 0) {
    for (const kind of kinds) {
      for (const spot of this.list(kind)) {
        const result = this.reserve(spot.id, agentId, at);
        if (result.ok) return { ...result, spot };
      }
    }
    return { ok: false, reason: "NO_SPOT" };
  }

  release(spotId, agentId) {
    const spot = this.spots.get(spotId);
    if (!spot) return false;
    const before = spot.reservations.length;
    spot.reservations = spot.reservations.filter((reservation) => reservation.agentId !== agentId);
    return spot.reservations.length < before;
  }

  releaseAll(agentId) {
    let released = 0;
    for (const spot of this.spots.values()) released += this.release(spot.id, agentId) ? 1 : 0;
    return released;
  }

  spotOf(agentId) {
    for (const spot of this.spots.values()) if (spot.reservations.some((reservation) => reservation.agentId === agentId)) return spot;
    return null;
  }

  tick(now, ttlMs = 240000) {
    let released = 0;
    for (const spot of this.spots.values()) {
      const before = spot.reservations.length;
      spot.reservations = spot.reservations.filter((reservation) => now - reservation.at <= ttlMs);
      released += before - spot.reservations.length;
    }
    return released;
  }
}

/* ------------------------------------------------------------------ *
 * 8. AGENT STATE MACHINE + SUPERVISOR PATROL (no teleport)
 * ------------------------------------------------------------------ */

export const SUPERVISOR_PATROL_LOOP = ["WALK", "STOP", "OBSERVE", "WAIT"];
export const SUPERVISOR_STAGE_MS = { STOP: 600, OBSERVE: 1400, WAIT: 900 };

export const AGENT_TRANSITIONS = {
  OFFLINE: ["IDLE", "WALK"],
  IDLE: ["WALK", "SEAT", "WORK", "OFFLINE"],
  WALK: ["SEAT", "IDLE", "WORK", "STOP"],
  SEAT: ["WORK", "WALK", "IDLE", "OFFLINE"],
  WORK: ["SEAT", "WALK", "SIGNAL", "CELEBRATE", "DEJECTED", "OBSERVE"],
  SIGNAL: ["WORK", "CELEBRATE", "DEJECTED"],
  CELEBRATE: ["WORK", "SEAT", "IDLE"],
  DEJECTED: ["WORK", "SEAT", "IDLE"],
  SOCIAL: ["WALK", "SEAT"],
  COFFEE: ["WALK", "SEAT"],
  RESEARCH: ["WALK", "SEAT"],
  LEISURE: ["WALK", "SEAT"],
  KITCHEN: ["WALK", "SEAT"],
  STOP: ["OBSERVE", "WALK"],
  OBSERVE: ["WAIT", "WALK"],
  WAIT: ["WALK", "STOP"],
};

export class AgentStateMachine {
  constructor(initial = "IDLE", transitions = AGENT_TRANSITIONS) {
    this.transitions = transitions;
    this.state = this.transitions[initial] ? initial : "IDLE";
    this.stateSince = 0;
    this.history = [this.state];
  }

  can(next) {
    return (this.transitions[this.state] ?? []).includes(next);
  }

  transition(next, at = 0) {
    if (!this.can(next)) return false;
    this.state = next;
    this.stateSince = at;
    this.history.push(next);
    return true;
  }
}

export class SupervisorPatrol {
  constructor(options = {}) {
    this.waypoints = (options.waypoints ?? []).map((point) => ({ x: point.x, y: point.y }));
    this.speed = Math.max(0.1, Number(options.speed) || 1.1);
    this.index = 0;
    this.path = [];
    this.cursor = 0;
    this.stage = "WALK";
    this.stageTimer = 0;
    const start = this.waypoints[0] ?? { x: 0, y: 0 };
    this.pos = { x: start.x, y: start.y };
  }

  get waypoint() {
    return this.waypoints[this.index] ?? null;
  }

  needsPath() {
    return this.stage === "WALK" && (this.path.length === 0 || this.cursor >= this.path.length - 1);
  }

  advanceWaypoint() {
    if (this.waypoints.length === 0) return null;
    this.index = (this.index + 1) % this.waypoints.length;
    return this.waypoint;
  }

  setPath(path) {
    if (!Array.isArray(path) || path.length === 0) return false;
    this.path = path.map((point) => ({ x: point.x, y: point.y }));
    this.cursor = 0;
    this.stage = "WALK";
    this.stageTimer = 0;
    return true;
  }

  update(deltaMs, now = 0) {
    const delta = Math.max(0, Number(deltaMs) || 0) / 1000;
    if (this.stage === "WALK") {
      let remaining = this.speed * delta;
      while (remaining > 0 && this.cursor < this.path.length - 1) {
        const next = this.path[this.cursor + 1];
        const dx = next.x - this.pos.x;
        const dy = next.y - this.pos.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= remaining) {
          this.pos = { x: next.x, y: next.y };
          this.cursor += 1;
          remaining -= distance;
        } else {
          this.pos = { x: this.pos.x + (dx / distance) * remaining, y: this.pos.y + (dy / distance) * remaining };
          remaining = 0;
        }
      }
      if (this.path.length > 0 && this.cursor >= this.path.length - 1) {
        this.stage = "STOP";
        this.stageTimer = 0;
      }
      return { stage: this.stage, pos: this.pos, arrived: false };
    }
    this.stageTimer += deltaMs;
    const duration = SUPERVISOR_STAGE_MS[this.stage] ?? 0;
    if (this.stageTimer >= duration) {
      this.stageTimer = 0;
      if (this.stage === "STOP") this.stage = "OBSERVE";
      else if (this.stage === "OBSERVE") this.stage = "WAIT";
      else if (this.stage === "WAIT") {
        this.stage = "WALK";
        this.path = [];
        this.cursor = 0;
        this.advanceWaypoint();
      }
    }
    return { stage: this.stage, pos: this.pos, arrived: this.stage === "WAIT" };
  }
}

/* ------------------------------------------------------------------ *
 * 9. PNL — settled results only, never indicative
 * ------------------------------------------------------------------ */

export function firstFinite(candidates) {
  for (const candidate of candidates ?? []) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

const INACTIVE_STATES = new Set(["CLOSED", "UNAVAILABLE", "NOT_FOUND", "SUSPENDED", "NOT_OFFERED", "UNKNOWN", "DISABLED", "OFFLINE"]);

/**
 * A desk only "exists" for agents + P&L badge when the market is really open.
 * DISABLED / SUSPENDED / NOT_OFFERED / UNKNOWN / CLOSED desks are empty.
 */
export function isDeskActive(market) {
  if (!market || typeof market !== "object") return false;
  if (market.enabled === false) return false;
  const availability = String(market.availability ?? "").toUpperCase();
  if (availability === "OPEN") return true;
  if (INACTIVE_STATES.has(availability)) return false;
  const status = String(market.status ?? market.tradingStatus ?? "").toUpperCase();
  if (INACTIVE_STATES.has(status)) return false;
  return market.enabled === true;
}

export function pnlIndicatorModel(input) {
  const office = input ?? {};
  const settled = office?.portfolio?.settled ?? office?.settled ?? null;
  const hasData = Boolean(settled) && Number.isFinite(Number(settled?.pnl));
  const pnl = hasData ? Number(settled.pnl) : null;
  const epsilon = 0.0000001;
  const tone = pnl === null ? "EMPTY" : pnl > epsilon ? "POSITIVE" : pnl < -epsilon ? "NEGATIVE" : "ZERO";
  const wins = Number(settled?.wins) || 0;
  const losses = Number(settled?.losses) || 0;
  const draws = Number(settled?.draws) || 0;
  const trades = Number(settled?.trades) || wins + losses + draws;
  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : null;
  const markets = Array.isArray(office?.markets) ? office.markets : [];
  const openMarkets = markets.filter((market) => market?.enabled === true && market?.availability === "OPEN").length;
  const totalMarkets = markets.length;
  const closedMarkets = Math.max(0, totalMarkets - openMarkets);
  let bestWin = null;
  let bestLoss = null;
  for (const market of markets) {
    const state = market?.settlementState ?? {};
    const result = state.lastResult ?? market?.lastTrade?.result ?? null;
    const raw = Number(state.lastProfit ?? market?.lastTrade?.profit);
    if (!Number.isFinite(raw)) continue;
    if (result === "WIN") bestWin = bestWin === null ? Math.abs(raw) : Math.max(bestWin, Math.abs(raw));
    if (result === "LOSS") bestLoss = bestLoss === null ? -Math.abs(raw) : Math.min(bestLoss, -Math.abs(raw));
  }
  const weeklyPnl = firstFinite([
    office?.portfolio?.weekly?.pnl,
    office?.portfolio?.weeklyPnl,
    office?.portfolio?.settled?.weeklyPnl,
    office?.weeklyPnl,
    office?.stats?.weeklyPnl,
  ]);
  const monthlyPnl = firstFinite([
    office?.portfolio?.monthly?.pnl,
    office?.portfolio?.monthlyPnl,
    office?.portfolio?.settled?.monthlyPnl,
    office?.monthlyPnl,
    office?.stats?.monthlyPnl,
  ]);
  const compliance = office?.aux?.compliance ?? {};
  const armState = compliance?.armState?.state ?? (compliance?.armState?.armed === true ? "ARMED" : "DISARMED");
  return {
    hasData,
    pnl,
    tone,
    text: formatBRL(pnl, { signed: true }),
    wins,
    losses,
    draws,
    trades,
    winRate,
    winRateText: winRate === null ? "—" : formatPercent(winRate, 1),
    bestWin,
    bestWinText: formatBRL(bestWin, { signed: true }),
    bestLoss,
    bestLossText: formatBRL(bestLoss, { signed: true }),
    openMarkets,
    closedMarkets,
    totalMarkets,
    weeklyPnl,
    weeklyText: formatBRL(weeklyPnl, { signed: true }),
    monthlyPnl,
    monthlyText: formatBRL(monthlyPnl, { signed: true }),
    activeCount: Number(office?.activeCount) || 0,
    activeLimit: Number(office?.activeLimit) || 0,
    armState: String(armState ?? "—"),
    mode: office?.mode ?? "—",
    practice: office?.mode !== "REAL",
    equity: Array.isArray(office?.portfolio?.equityCurve) ? office.portfolio.equityCurve.slice(-64) : [],
  };
}

export function deskPnlIndicator(market) {
  const state = market?.settlementState ?? {};
  const result = state.lastResult ?? market?.lastTrade?.result ?? null;
  if (result !== "WIN" && result !== "LOSS" && result !== "DRAW") {
    return { result: null, pnl: null, text: "—", tone: "NONE" };
  }
  const raw = state.lastProfit ?? market?.lastTrade?.profit ?? 0;
  const magnitude = Number.isFinite(Number(raw)) ? Math.abs(Number(raw)) : 0;
  const pnl = result === "WIN" ? magnitude : result === "LOSS" ? -magnitude : 0;
  const tone = result === "WIN" ? "POSITIVE" : result === "LOSS" ? (pnl < 0 ? "NEGATIVE" : "ZERO") : "ZERO";
  return { result, pnl, text: formatBRL(pnl, { signed: true }), tone };
}

/**
 * Floating P&L badge above a desk pair. Settled results ONLY, and only while
 * the desk is actually open — empty desks (disabled/suspended/…) never show a
 * badge even if they carry a stale settlement.
 */
export function deskBadgeModel(market) {
  const active = isDeskActive(market);
  const indicator = deskPnlIndicator(market);
  const visible = active && indicator.tone !== "NONE";
  return { active, visible, ...indicator, color: visible ? toneColor(indicator.tone) : null };
}

export function toneColor(tone) {
  if (tone === "POSITIVE") return PALETTE.positive;
  if (tone === "NEGATIVE") return PALETTE.negative;
  if (tone === "ZERO") return PALETTE.neutral;
  return "#8b93a8";
}

export class PnLIndicator {
  static forOffice(office) {
    return pnlIndicatorModel(office);
  }

  static forMarket(market) {
    return deskPnlIndicator(market);
  }

  static color(tone) {
    return toneColor(tone);
  }
}

/* ------------------------------------------------------------------ *
 * 10. CAMERA — integer pixel-perfect zoom ladder, DPR aware renderer
 * ------------------------------------------------------------------ */

function nearestZoomLevel(value, levels = ZOOM_LEVELS) {
  let best = levels[0];
  let bestDistance = Infinity;
  for (const level of levels) {
    const distance = Math.abs(level - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level;
    }
  }
  return best;
}

export class OfficeCamera {
  constructor(options = {}) {
    this.zoomLevels = options.zoomLevels ?? ZOOM_LEVELS;
    this.minZoom = Math.min(...this.zoomLevels);
    this.maxZoom = Math.max(...this.zoomLevels);
    this.zoom = nearestZoomLevel(options.zoom ?? 1, this.zoomLevels);
    this.x = 0;
    this.y = 0;
    this.viewport = { width: 0, height: 0 };
  }

  setViewport(width, height) {
    this.viewport = { width: Math.max(1, Number(width) || 1), height: Math.max(1, Number(height) || 1) };
    return this;
  }

  fit(bounds, viewport = this.viewport) {
    const width = Math.max(1, Number(bounds?.width) || 1);
    const height = Math.max(1, Number(bounds?.height) || 1);
    const viewWidth = Math.max(1, Number(viewport.width) || 1);
    const viewHeight = Math.max(1, Number(viewport.height) || 1);
    const raw = Math.min(viewWidth / width, viewHeight / height);
    let level = this.minZoom;
    for (const candidate of this.zoomLevels) if (candidate <= raw && candidate > level) level = candidate;
    if (raw < this.minZoom) level = this.minZoom;
    this.zoom = level;
    const centerX = bounds.minX + width / 2;
    const centerY = bounds.minY + height / 2;
    this.x = centerX - viewWidth / (2 * this.zoom);
    this.y = centerY - viewHeight / (2 * this.zoom);
    return this;
  }

  centerOn(point) {
    this.x = point.x - this.viewport.width / (2 * this.zoom);
    this.y = point.y - this.viewport.height / (2 * this.zoom);
    return this;
  }

  worldToScreen(point) {
    return { x: (point.x - this.x) * this.zoom, y: (point.y - this.y) * this.zoom };
  }

  screenToWorld(point) {
    return { x: point.x / this.zoom + this.x, y: point.y / this.zoom + this.y };
  }

  panBy(deltaX, deltaY) {
    this.x -= deltaX / this.zoom;
    this.y -= deltaY / this.zoom;
    return this;
  }

  zoomAt(screenPoint, requestedZoom, bounds = null) {
    const level = clamp(nearestZoomLevel(requestedZoom, this.zoomLevels), this.minZoom, this.maxZoom);
    const before = this.screenToWorld(screenPoint);
    this.zoom = level;
    const after = this.screenToWorld(screenPoint);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    if (bounds) this.clampTo(bounds);
    return this;
  }

  clampTo(bounds) {
    if (!bounds) return this;
    const viewWidth = this.viewport.width / this.zoom;
    const viewHeight = this.viewport.height / this.zoom;
    if (bounds.width <= viewWidth) this.x = bounds.minX + bounds.width / 2 - viewWidth / 2;
    else this.x = clamp(this.x, bounds.minX, bounds.minX + bounds.width - viewWidth);
    if (bounds.height <= viewHeight) this.y = bounds.minY + bounds.height / 2 - viewHeight / 2;
    else this.y = clamp(this.y, bounds.minY, bounds.minY + bounds.height - viewHeight);
    return this;
  }
}

/* ------------------------------------------------------------------ *
 * 11. CARVED WOOD PLATE LAYOUT (pure) + plate asset
 * ------------------------------------------------------------------ */

export function computePlateLayout(text, options = {}) {
  const width = Math.max(8, Number(options.width) || 56);
  const height = Math.max(8, Number(options.height) || 14);
  const paddingX = Math.max(1, Number(options.paddingX) || 3);
  const paddingY = Math.max(1, Number(options.paddingY) || 2);
  const fontSize = Math.max(4, Math.min(Number(options.fontSize) || 7, height - paddingY * 2));
  const charWidth = fontSize * 0.62;
  const maxTextWidth = Math.max(1, width - paddingX * 2);
  const maxChars = Math.max(3, Math.floor(maxTextWidth / charWidth));
  const raw = String(text ?? "").trim() || "—";
  const lines = wrapPlateText(raw, maxChars);
  const lineHeight = fontSize + 1;
  const blockHeight = lines.length * lineHeight;
  const blockTop = (height - blockHeight) / 2;
  return {
    width,
    height,
    fontSize,
    lineHeight,
    charWidth,
    maxChars,
    paddingX,
    paddingY,
    raw,
    lines: lines.map((line, index) => ({ text: line, y: blockTop + lineHeight * (index + 0.5) })),
    textX: width / 2,
    blockTop,
    blockHeight,
  };
}

export function wrapPlateText(text, maxChars) {
  const source = String(text ?? "").trim();
  if (!source) return ["—"];
  const truncate = (value) => (value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1))}…`);
  if (source.length <= maxChars) return [source];
  const preferred = source.split(" ");
  if (preferred.length > 1) {
    const lines = [];
    let current = "";
    for (const word of preferred) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= 2 && lines.every((line) => line.length <= maxChars)) return lines;
  }
  const slash = source.split("/");
  if (slash.length === 2 && slash.every((part) => part.length <= maxChars)) return slash;
  return [truncate(source)];
}

export class AssetWoodPlate {
  constructor(options = {}) {
    this.width = Number(options.width) || 58;
    this.height = Number(options.height) || 14;
    this.cache = new Map();
  }

  layoutFor(text) {
    if (!this.cache.has(text)) this.cache.set(text, computePlateLayout(text, { width: this.width, height: this.height }));
    return this.cache.get(text);
  }

  draw(ctx, centerX, centerY, text, options = {}) {
    const layout = this.layoutFor(text);
    const x = Math.round(centerX - layout.width / 2);
    const y = Math.round(centerY - layout.height / 2);
    drawPlatePixels(ctx, x, y, layout, options);
  }
}

/* ------------------------------------------------------------------ *
 * 12. PALETTE + PIXEL PRIMITIVES (nearest-neighbor, integer pixels)
 * ------------------------------------------------------------------ */

export const PALETTE = {
  void: "#0a0e1c",
  navy: "#0e1b2e",
  floorA: "#0e1b2e",
  floorB: "#0c1728",
  tileLine: "#17283f",
  corridor: "#16273f",
  hall: "#101f33",
  wall: "#3a2a20",
  wallTop: "#4d3a2c",
  wallTrim: "#6d4c33",
  wood: "#8a5a34",
  woodDark: "#6b4326",
  woodMid: "#7a4d2c",
  woodLight: "#a9743f",
  plateWood: "#7a4d2c",
  plateDark: "#3f2410",
  plateLight: "#d9a441",
  metal: "#8d99b5",
  metalDark: "#5a6478",
  screenOn: "#6fd3ff",
  screenOk: "#7ef0a0",
  screenWarn: "#ffd166",
  screenOff: "#38455f",
  skin: "#e8b48a",
  skin2: "#c98d63",
  skin3: "#8a5a3c",
  traderShirt: "#2f4f8a",
  traderShirt2: "#24406f",
  criticShirt: "#7c4fd0",
  criticShirt2: "#6337ad",
  hair: "#2f2418",
  hair2: "#4a3320",
  hair3: "#6b4a2a",
  pants: "#3a4356",
  pants2: "#2c3345",
  suit: "#2b3448",
  suit2: "#1f2736",
  tie: "#d9a441",
  plant: "#3f9b58",
  plant2: "#2f7a44",
  plant3: "#57bd72",
  pot: "#a45a3a",
  pot2: "#7d4229",
  sofa: "#e8d9b5",
  sofa2: "#c9b48c",
  sofa3: "#f2e8cf",
  rug1: "#7d2b2b",
  rug2: "#26466b",
  rugTrim: "#d9a441",
  pool: "#2e8b57",
  poolRail: "#6b4326",
  kitchen: "#c8ccd8",
  kitchenDark: "#9aa0b2",
  server: "#22283a",
  server2: "#2d3550",
  green: "#4fbf6a",
  red: "#d9534f",
  neutral: "#cfd6e4",
  amber: "#d9a441",
  gold: "#d9a441",
  positive: "#4fbf6a",
  negative: "#d9534f",
  boardBg: "#0b1728",
  boardFrame: "#6b4326",
  boardFrame2: "#8a5a34",
  ink: "#e8d7b0",
};

function pxRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function pxPath(ctx, points, fillStyle, strokeStyle = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(Math.round(points[index].x), Math.round(points[index].y));
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function isoRectPoints(rect) {
  return [
    isoProject(rect.x, rect.y),
    isoProject(rect.x + rect.w, rect.y),
    isoProject(rect.x + rect.w, rect.y + rect.h),
    isoProject(rect.x, rect.y + rect.h),
  ];
}

function fillIsoRect(ctx, rect, fillStyle, strokeStyle = null) {
  pxPath(ctx, isoRectPoints(rect), fillStyle, strokeStyle);
}

function drawIsoBox(ctx, rect, height, colors) {
  const north = isoProject(rect.x, rect.y);
  const east = isoProject(rect.x + rect.w, rect.y);
  const south = isoProject(rect.x + rect.w, rect.y + rect.h);
  const west = isoProject(rect.x, rect.y + rect.h);
  pxPath(ctx, [east, south, { x: south.x, y: south.y + height }, { x: east.x, y: east.y + height }], colors.side ?? colors.dark);
  pxPath(ctx, [west, south, { x: south.x, y: south.y + height }, { x: west.x, y: west.y + height }], colors.front ?? colors.dark);
  pxPath(ctx, [north, east, south, west], colors.top ?? colors.light, colors.outline ?? null);
  return { north, east, south, west };
}

function drawIsoShadow(ctx, rect, offsetX = 3, offsetY = 2) {
  const points = isoRectPoints(rect).map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
  ctx.globalAlpha = 0.22;
  pxPath(ctx, points, "#000000");
  ctx.globalAlpha = 1;
}

function drawIsoWoodTop(ctx, rect, base, plank) {
  fillIsoRect(ctx, rect, base);
  ctx.strokeStyle = plank;
  ctx.lineWidth = 1;
  for (let index = 1; index < rect.w; index += 1) {
    const from = isoProject(rect.x + index, rect.y);
    const to = isoProject(rect.x + index, rect.y + rect.h);
    ctx.beginPath();
    ctx.moveTo(Math.round(from.x), Math.round(from.y) + 1);
    ctx.lineTo(Math.round(to.x), Math.round(to.y));
    ctx.stroke();
  }
}

function drawPlatePixels(ctx, x, y, layout, options = {}) {
  const width = layout.width;
  const height = layout.height;
  pxRect(ctx, x, y, width, height, PALETTE.plateDark);
  pxRect(ctx, x + 1, y + 1, width - 2, height - 2, PALETTE.plateWood);
  pxRect(ctx, x + 1, y + 1, width - 2, 1, PALETTE.plateLight);
  pxRect(ctx, x + 1, y + height - 2, width - 2, 1, PALETTE.plateDark);
  pxRect(ctx, x + 1, y + 1, 1, height - 2, PALETTE.plateLight);
  pxRect(ctx, x + width - 2, y + 1, 1, height - 2, PALETTE.plateDark);
  pxRect(ctx, x + 2, y + 2, width - 4, 1, "rgba(0,0,0,0.25)");
  const tone = options.muted === true;
  for (const line of layout.lines) {
    ctx.font = `bold ${layout.fontSize}px "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255, 226, 178, 0.35)";
    ctx.fillText(line.text, x + layout.textX, y + line.y + 1);
    ctx.fillStyle = tone ? "#6b4a2a" : "#2c1806";
    ctx.fillText(line.text, x + layout.textX, y + line.y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/* ------------------------------------------------------------------ *
 * 13. CHARACTER SPRITES (procedural pixels, scale coherent with desk)
 * ------------------------------------------------------------------ */

export const ROLE_PALETTES = {
  trader: { shirt: PALETTE.traderShirt, shirt2: PALETTE.traderShirt2, hair: PALETTE.hair, skin: PALETTE.skin },
  critic: { shirt: PALETTE.criticShirt, shirt2: PALETTE.criticShirt2, hair: PALETTE.hair2, skin: PALETTE.skin2 },
  supervisor: { shirt: PALETTE.suit, shirt2: PALETTE.suit2, hair: "#3a3f4d", skin: PALETTE.skin },
  idle: { shirt: "#5c6a86", shirt2: "#48546c", hair: PALETTE.hair3, skin: PALETTE.skin3 },
};

export function drawActorPixels(ctx, actor, options = {}) {
  const palette = options.palette ?? ROLE_PALETTES[actor?.role] ?? ROLE_PALETTES.idle;
  const point = options.point ?? isoProject(actor?.x ?? 0, actor?.y ?? 0);
  const state = actor?.state ?? "SEAT";
  const seated = state === "SEAT" || state === "WORK" || state === "SIGNAL" || state === "CELEBRATE" || state === "DEJECTED";
  const frame = options.frame ?? Math.floor((options.time ?? 0) / 320) % 2;
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  const dim = state === "OFFLINE";
  const shirt = dim ? "#4b5468" : palette.shirt;
  const shirt2 = dim ? "#3c4457" : palette.shirt2;
  const skin = dim ? "#9a8f84" : palette.skin;
  const hair = dim ? "#4a4a4a" : palette.hair;
  if (seated) {
    const bob = state === "DEJECTED" ? 2 : state === "WORK" && frame === 1 ? -1 : 0;
    const base = y + 3 + bob;
    pxRect(ctx, x - 4, base - 18, 8, 6, skin);
    pxRect(ctx, x - 4, base - 20, 8, 3, hair);
    pxRect(ctx, x - 4, base - 18, 8, 1, hair);
    pxRect(ctx, x - 2, base - 16, 1, 1, "#2b2118");
    pxRect(ctx, x + 1, base - 16, 1, 1, "#2b2118");
    pxRect(ctx, x - 4, base - 12, 8, 7, shirt);
    pxRect(ctx, x - 4, base - 12, 8, 1, shirt2);
    pxRect(ctx, x - 6, base - 11, 2, 5, shirt2);
    pxRect(ctx, x + 4, base - 11, 2, 5, shirt2);
    if (state === "CELEBRATE") {
      pxRect(ctx, x - 6, base - 10, 2, 3, skin);
      pxRect(ctx, x + 4, base - 16, 2, 4, skin);
      pxRect(ctx, x + 1, base - 24, 1, 3, PALETTE.green);
      pxRect(ctx, x - 2, base - 25, 1, 3, PALETTE.green);
    } else {
      pxRect(ctx, x - 6, base - 8, 2, 2, skin);
      pxRect(ctx, x + 4, base - 8, 2, 2, skin);
    }
    pxRect(ctx, x - 4, base - 5, 8, 3, PALETTE.pants);
    if (state === "SIGNAL") {
      pxRect(ctx, x + 5, base - 26, 3, 6, PALETTE.amber);
      pxRect(ctx, x + 6, base - 19, 1, 2, PALETTE.amber);
    }
    if (actor?.role === "trader") pxRect(ctx, x - 5, base - 19, 4, 1, "#2b3448");
    if (actor?.role === "critic") pxRect(ctx, x - 2, base - 17, 5, 1, "#1c2333");
    return;
  }
  const walk = state === "WALK" || state === "IDLE";
  const step = walk && frame === 1 ? 2 : 0;
  const base = y + (options.standingOffset ?? 4);
  pxRect(ctx, x - 4, base - 26, 8, 6, skin);
  pxRect(ctx, x - 4, base - 28, 8, 3, hair);
  pxRect(ctx, x - 2, base - 24, 1, 1, "#2b2118");
  pxRect(ctx, x + 1, base - 24, 1, 1, "#2b2118");
  pxRect(ctx, x - 3, base - 20, 7, 9, shirt);
  pxRect(ctx, x - 3, base - 20, 7, 1, shirt2);
  pxRect(ctx, x - 5, base - 19, 2, 6, shirt2);
  pxRect(ctx, x + 4, base - 19, 2, 6, shirt2);
  pxRect(ctx, x - 5, base - 13, 2, 2, skin);
  pxRect(ctx, x + 4, base - 13, 2, 2, skin);
  pxRect(ctx, x - 3, base - 11, 2, 8 + (step ? -2 : 0), PALETTE.pants);
  pxRect(ctx, x + 1, base - 11, 2, 8 + (step ? 0 : -2), PALETTE.pants);
  pxRect(ctx, x - 4, base - 3, 3, 2, "#1c2333");
  pxRect(ctx, x + 1, base - 3, 3, 2, "#1c2333");
  if (actor?.role === "supervisor") {
    pxRect(ctx, x - 1, base - 19, 2, 6, PALETTE.tie);
    pxRect(ctx, x + 4, base - 16, 3, 4, "#d8d2c0");
    if (frame === 1) pxRect(ctx, x + 5, base - 24, 1, 1, PALETTE.amber);
  }
}

export class TraderSprite {
  constructor(actor) {
    this.actor = actor;
    this.palette = ROLE_PALETTES.trader;
  }

  draw(ctx, time, point) {
    drawActorPixels(ctx, this.actor, { palette: this.palette, time, point });
  }
}

export class CriticSprite extends TraderSprite {
  constructor(actor) {
    super(actor);
    this.palette = ROLE_PALETTES.critic;
  }
}

/* ------------------------------------------------------------------ *
 * 14. FURNITURE + DESK + BOARD PIXEL ART
 * ------------------------------------------------------------------ */

function drawPlant(ctx, cell, time) {
  const point = isoProject(cell.x + 0.5, cell.y + 0.5);
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 4, y - 3, 8, 5, PALETTE.pot2);
  pxRect(ctx, x - 4, y - 4, 8, 2, PALETTE.pot);
  const sway = Math.floor((time ?? 0) / 700) % 2 === 0 ? 0 : 1;
  pxRect(ctx, x - 1, y - 12, 2, 8, PALETTE.plant2);
  pxRect(ctx, x - 5, y - 14, 4, 3, PALETTE.plant);
  pxRect(ctx, x + 1, y - 15, 5, 3, PALETTE.plant3);
  pxRect(ctx, x - 3 + sway, y - 18, 6, 4, PALETTE.plant);
  pxRect(ctx, x - 1, y - 20, 3, 2, PALETTE.plant3);
}

function drawSofa(ctx, rect, time) {
  drawIsoBox(ctx, rect, 8, { top: PALETTE.sofa3, front: PALETTE.sofa2, side: PALETTE.sofa2, dark: PALETTE.sofa2 });
  const back = { x: rect.x, y: rect.y - 0.6, w: rect.w, h: 0.6 };
  drawIsoBox(ctx, back, 16, { top: PALETTE.sofa, front: PALETTE.sofa2, side: "#4d2d43", dark: PALETTE.sofa2 });
  const cushions = Math.max(1, Math.floor(rect.w / 1.5));
  for (let index = 0; index < cushions; index += 1) {
    const cell = { x: rect.x + 0.4 + index * 1.4, y: rect.y + 0.3, w: 1, h: 0.4 };
    fillIsoRect(ctx, cell, index % 2 === 0 ? PALETTE.sofa3 : PALETTE.sofa);
  }
  if (Math.floor((time ?? 0) / 900) % 2 === 0) pxRect(ctx, isoProject(rect.x + 0.7, rect.y + 0.2).x, isoProject(rect.x + 0.7, rect.y + 0.2).y - 12, 2, 2, PALETTE.amber);
}

function drawPoolTable(ctx, rect, time) {
  drawIsoShadow(ctx, rect, 4, 3);
  drawIsoBox(ctx, rect, 12, { top: PALETTE.pool, front: PALETTE.poolRail, side: "#5e3016", dark: "#5e3016" });
  const railColor = "#8a5a2c";
  for (const corner of [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h], [rect.x + rect.w / 2, rect.y], [rect.x + rect.w / 2, rect.y + rect.h]]) {
    const point = isoProject(corner[0], corner[1]);
    pxRect(ctx, point.x - 2, point.y - 2, 4, 3, railColor);
  }
  const ballColors = ["#e8e8e8", "#ffd166", "#ff5a5a", "#3f6fd8", "#2b2b2b", "#46d17a"];
  ballColors.forEach((color, index) => {
    const point = isoProject(rect.x + 0.8 + (index % 3) * 1.1, rect.y + 0.7 + Math.floor(index / 3) * 0.8);
    pxRect(ctx, point.x - 1, point.y - 2, 2, 2, color);
  });
  const cue = isoProject(rect.x - 1.2, rect.y + 0.6 + Math.floor((time ?? 0) / 900) % 2 * 0.1);
  pxRect(ctx, cue.x - 6, cue.y - 2, 12, 1, "#c9a44f");
}

function drawCoffeeTable(ctx, rect) {
  drawIsoBox(ctx, rect, 6, { top: PALETTE.woodMid, front: PALETTE.woodDark, side: PALETTE.woodDark, dark: PALETTE.woodDark });
}

function drawRug(ctx, rect, variant) {
  const colors = variant % 2 === 0 ? [PALETTE.rug1, "#5e2b36"] : [PALETTE.rug2, "#2b3560"];
  fillIsoRect(ctx, rect, colors[0]);
  const inner = { x: rect.x + 0.6, y: rect.y + 0.6, w: rect.w - 1.2, h: rect.h - 1.2 };
  fillIsoRect(ctx, inner, colors[1]);
  const middle = { x: rect.x + 1.2, y: rect.y + 1.2, w: rect.w - 2.4, h: rect.h - 2.4 };
  fillIsoRect(ctx, middle, colors[0]);
  ctx.globalAlpha = 0.5;
  fillIsoRect(ctx, { x: rect.x + 0.2, y: rect.y + 0.2, w: 0.6, h: 0.6 }, PALETTE.rugTrim);
  fillIsoRect(ctx, { x: rect.x + rect.w - 0.8, y: rect.y + rect.h - 0.8, w: 0.6, h: 0.6 }, PALETTE.rugTrim);
  ctx.globalAlpha = 1;
}

function drawShelf(ctx, rect) {
  drawIsoShadow(ctx, rect, 2, 2);
  drawIsoBox(ctx, rect, 22, { top: PALETTE.woodLight, front: PALETTE.woodDark, side: PALETTE.woodMid, dark: PALETTE.woodDark });
  const bookColors = ["#c94f4f", "#4f7fc9", "#c9a44f", "#54a06a", "#8b5cf6", "#d97a3f"];
  const spineWidth = 0.22;
  for (let index = 0; index < Math.floor(rect.w / spineWidth) - 2; index += 1) {
    const cell = { x: rect.x + 0.3 + index * spineWidth, y: rect.y + 0.4, w: spineWidth * 0.7, h: rect.h - 0.8 };
    const point = isoProject(cell.x, cell.y);
    pxRect(ctx, point.x, point.y - 20, Math.max(1, Math.round(spineWidth * 10)), 16, bookColors[index % bookColors.length]);
  }
  pxRect(ctx, isoProject(rect.x, rect.y + rect.h).x - 2, isoProject(rect.x, rect.y + rect.h).y - 22, 3, 22, PALETTE.woodDark);
}

function drawCounter(ctx, rect) {
  drawIsoShadow(ctx, rect, 2, 2);
  drawIsoBox(ctx, rect, 12, { top: PALETTE.kitchen, front: PALETTE.kitchenDark, side: "#7d8496", dark: "#7d8496" });
}

function drawFridge(ctx, rect) {
  drawIsoShadow(ctx, rect, 2, 2);
  drawIsoBox(ctx, rect, 28, { top: "#e2e6ee", front: "#aab2c2", side: "#8f97a8", dark: "#8f97a8" });
  const point = isoProject(rect.x + rect.w, rect.y + rect.h / 2);
  pxRect(ctx, point.x - 2, point.y - 20, 2, 5, "#5a6478");
}

function drawCoffeeMachine(ctx, rect, time) {
  drawIsoBox(ctx, rect, 14, { top: "#d8dce6", front: "#5a6478", side: "#3c4458", dark: "#3c4458" });
  const point = isoProject(rect.x + 0.5, rect.y + rect.h);
  pxRect(ctx, point.x - 1, point.y - 8, 4, 3, "#2b3448");
  pxRect(ctx, point.x, point.y - 7, 2, 2, PALETTE.red);
  if (Math.floor((time ?? 0) / 600) % 2 === 0) {
    const steam = isoProject(rect.x + 1.2, rect.y + 0.2);
    pxRect(ctx, steam.x, steam.y - 20, 1, 3, "rgba(220,230,255,0.6)");
    pxRect(ctx, steam.x + 2, steam.y - 24, 1, 3, "rgba(220,230,255,0.4)");
  }
}

function drawIsland(ctx, rect) {
  drawIsoBox(ctx, rect, 12, { top: PALETTE.kitchen, front: PALETTE.kitchenDark, side: "#7d8496", dark: "#7d8496" });
  const point = isoProject(rect.x + rect.w / 2, rect.y + rect.h / 2);
  pxRect(ctx, point.x - 3, point.y - 14, 6, 2, "#c9a44f");
}

function drawStool(ctx, rect) {
  const point = isoProject(rect.x + 0.5, rect.y + 0.5);
  pxRect(ctx, point.x - 3, point.y - 10, 6, 3, PALETTE.woodMid);
  pxRect(ctx, point.x - 2, point.y - 7, 1, 6, PALETTE.woodDark);
  pxRect(ctx, point.x + 1, point.y - 7, 1, 6, PALETTE.woodDark);
}

function drawRack(ctx, rect, time) {
  drawIsoShadow(ctx, rect, 2, 2);
  drawIsoBox(ctx, rect, 30, { top: "#333c58", front: PALETTE.server, side: "#1a2032", dark: PALETTE.server });
  const frame = Math.floor((time ?? 0) / 500);
  const eastPoint = isoProject(rect.x + rect.w, rect.y + rect.h / 2);
  for (let row = 0; row < 8; row += 1) {
    const lit = (frame + row * 3 + rect.x) % 4 !== 0;
    pxRect(ctx, eastPoint.x + 1, eastPoint.y - 26 + row * 3, 1, 1, lit ? PALETTE.green : PALETTE.amber);
  }
  const westPoint = isoProject(rect.x, rect.y + rect.h / 2);
  for (let row = 0; row < 8; row += 1) {
    const lit = (frame + row * 2 + rect.y) % 3 === 0;
    pxRect(ctx, westPoint.x - 2, westPoint.y - 26 + row * 3, 1, 1, lit ? "#4fd1ff" : "#2a3550");
  }
}

function drawTable(ctx, rect, height = 10) {
  drawIsoShadow(ctx, rect, 3, 2);
  drawIsoBox(ctx, rect, height, { top: PALETTE.woodLight, front: PALETTE.woodDark, side: PALETTE.woodMid, dark: PALETTE.woodDark });
}

function drawChair(ctx, rect) {
  const point = isoProject(rect.x + 0.5, rect.y + 0.5);
  pxRect(ctx, point.x - 3, point.y - 8, 6, 3, PALETTE.pants2);
  pxRect(ctx, point.x - 3, point.y - 12, 6, 4, PALETTE.pants);
  pxRect(ctx, point.x - 2, point.y - 5, 1, 4, PALETTE.metalDark);
  pxRect(ctx, point.x + 1, point.y - 5, 1, 4, PALETTE.metalDark);
}

export class AssetDesk {
  constructor(station) {
    this.station = station;
    this.plate = new AssetWoodPlate({ width: 58, height: 14 });
  }

  get market() {
    return this.station.market ?? null;
  }

  draw(ctx, time) {
    const desk = this.station.desk;
    const monitorState = this.#monitorState(time);
    drawIsoShadow(ctx, { x: desk.x, y: desk.y, w: desk.w, h: desk.h }, 5, 3);
    const faces = drawIsoBox(ctx, desk, 12, { top: PALETTE.wood, front: PALETTE.woodDark, side: PALETTE.woodMid, dark: PALETTE.woodDark });
    drawIsoWoodTop(ctx, desk, PALETTE.wood, "rgba(80, 44, 12, 0.35)");
    ctx.strokeStyle = "rgba(50, 26, 6, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(faces.west.x), Math.round(faces.west.y));
    ctx.lineTo(Math.round(faces.south.x), Math.round(faces.south.y));
    ctx.stroke();
    this.#drawWorkstation(ctx, { x: desk.x + 0.55, y: desk.y + 0.35, w: 1, h: 0.5 }, monitorState, "trader");
    this.#drawWorkstation(ctx, { x: desk.x + 2.45, y: desk.y + 0.35, w: 1, h: 0.5 }, monitorState, "critic");
    this.#drawProps(ctx, desk);
    const platePoint = isoProject(this.station.plate.x, this.station.plate.y);
    const plateText = this.market?.display ?? this.market?.symbol ?? this.station.marketKey;
    this.plate.draw(ctx, platePoint.x, platePoint.y - 4, plateText, { muted: this.market?.enabled === false });
  }

  #monitorState(time) {
    const market = this.market;
    if (!market || market.enabled === false || market.availability !== "OPEN") return { color: PALETTE.screenOff, glow: false };
    if (market.positionState?.status === "OPEN") return { color: market.positionState.direction === "PUT" ? "#ff9d5a" : PALETTE.screenOk, glow: true };
    if (market.agentState === "SIGNAL" || market.agentState === "ORDERING") return { color: PALETTE.screenWarn, glow: true };
    if (market.featureState?.fresh === true) return { color: PALETTE.screenOn, glow: Math.floor((time ?? 0) / 500) % 2 === 0 };
    return { color: "#4a5a78", glow: false };
  }

  #drawWorkstation(ctx, rect, state, side) {
    const point = isoProject(rect.x + rect.w / 2, rect.y + rect.h / 2);
    const screenWidth = 12;
    const screenHeight = 8;
    const top = point.y - 18;
    pxRect(ctx, point.x - 1, top + screenHeight, 2, 4, PALETTE.metalDark);
    pxRect(ctx, point.x - 4, top + screenHeight + 3, 8, 1, PALETTE.metalDark);
    pxRect(ctx, point.x - screenWidth / 2 - 1, top - 1, screenWidth + 2, screenHeight + 2, "#20283c");
    pxRect(ctx, point.x - screenWidth / 2, top, screenWidth, screenHeight, state.color);
    if (state.glow) {
      ctx.globalAlpha = 0.22;
      pxRect(ctx, point.x - screenWidth / 2 - 2, top - 2, screenWidth + 4, screenHeight + 4, state.color);
      ctx.globalAlpha = 1;
    }
    pxRect(ctx, point.x - 3, top + 2, 5, 1, "rgba(10, 20, 40, 0.5)");
    pxRect(ctx, point.x - 3, top + 4, 3, 1, "rgba(10, 20, 40, 0.4)");
    pxRect(ctx, point.x - 5, top + screenHeight + 5, 10, 2, "#c8ccd8");
    if (side === "critic") pxRect(ctx, point.x + 6, top + screenHeight + 4, 4, 3, "#e8e2d0");
  }

  #drawProps(ctx, desk) {
    const mug = isoProject(desk.x + desk.w - 0.4, desk.y + 0.3);
    pxRect(ctx, mug.x - 1, mug.y - 7, 3, 3, "#d8d2c0");
    pxRect(ctx, mug.x + 2, mug.y - 6, 1, 1, "#d8d2c0");
    const paper = isoProject(desk.x + 0.4, desk.y + desk.h - 0.4);
    pxRect(ctx, paper.x - 3, paper.y - 4, 6, 4, "#e8e2d0");
    pxRect(ctx, paper.x - 2, paper.y - 3, 4, 1, "#8a93a8");
  }
}

/* ------------------------------------------------------------------ *
 * 15. WORLD ASSEMBLY (pure — Node importable, no DOM)
 * ------------------------------------------------------------------ */

export function computeWorldBounds(gridWidth, gridHeight, options = {}) {
  const wallHeight = Number(options.wallHeight) || 185;
  const pad = Number(options.pad) || 48;
  const minX = -gridHeight * HALF_W - pad;
  const maxX = gridWidth * HALF_W + pad;
  const minY = -wallHeight - pad;
  const maxY = (gridWidth + gridHeight) * HALF_H + pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export class OfficeSector {
  constructor(data) {
    Object.assign(this, data);
  }

  contains(station) {
    const slot = station?.slot ?? station;
    if (!slot) return false;
    return slot.x >= this.floor.x && slot.y >= this.floor.y && slot.x + slot.w <= this.floor.x + this.floor.w && slot.y + slot.h <= this.floor.y + this.floor.h;
  }

  drawLabel(ctx) {
    drawFloorLabel(ctx, this);
  }
}

export function buildWalkability(layout, areas, options = {}) {
  const gridWidth = options.gridWidth ?? WORLD_LAYOUT.gridWidth;
  const gridHeight = options.gridHeight ?? WORLD_LAYOUT.gridHeight;
  const grid = new OfficeGrid(gridWidth, gridHeight);
  grid.blockBorder(1);
  grid.blockRect(0, 0, gridWidth, 2);
  const board = layout.board ?? WORLD_LAYOUT.board;
  grid.blockRect(board.x, board.y, board.w, board.h);
  for (const station of layout.stations) grid.blockRect(station.desk.x, station.desk.y, station.desk.w, station.desk.h);
  for (const area of areas) {
    for (const item of area.furniture) {
      if (item.blocksWalk === false) continue;
      grid.blockRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
    }
  }
  for (const plant of layout.plants ?? []) grid.blockRect(plant.x, plant.y, 1, 1);
  return grid;
}

export function buildOfficeWorld(office, options = {}) {
  const layoutOptions = options.layout ?? {};
  const planned = planStationLayout(office?.markets, layoutOptions);
  const layout = options.layoutData ?? WORLD_LAYOUT;
  const areas = buildAreas(layout);
  const board = layout.board ?? WORLD_LAYOUT.board;
  const plants = [];
  for (const area of areas) for (const plant of area.plants) plants.push({ x: plant.x, y: plant.y, areaId: area.id });
  for (const sector of planned.sectors) {
    for (const row of sector.rows) {
      plants.push({ x: layout.hallX - 2, y: row.y + 1, areaId: "hall" });
      plants.push({ x: layout.hallX + sector.floor.w - 3, y: row.y + 1, areaId: "hall" });
    }
  }
  const obstacles = [];
  for (const area of areas) {
    for (const item of area.furniture) {
      if (item.blocksWalk === false) continue;
      obstacles.push({ kind: item.kind, rect: item.rect, areaId: area.id });
    }
  }
  for (const station of planned.stations) obstacles.push({ kind: "desk", rect: station.desk, areaId: station.sectorId });
  for (const plant of plants) obstacles.push({ kind: "plant", rect: { x: plant.x, y: plant.y, w: 1, h: 1 }, areaId: plant.areaId });
  const base = {
    ...planned,
    version: OFFICE_V2_VERSION,
    builtAt: Date.now(),
    areas,
    board: {
      rect: board,
      anchor: (() => {
        const heading = planned.hall;
        const centerX = heading.x + heading.w / 2;
        const centerY = heading.y + heading.h / 2;
        const screenCenterX = isoProject(centerX, centerY).x;
        const boardY = board.y + board.h + 1;
        return isoProject(screenCenterX / HALF_W + boardY, boardY);
      })(),
    },
    obstacles,
    plants,
    spots: areas.flatMap((area) => area.spots),
    patrol: [
      { x: planned.hall.x + 1, y: planned.hall.y + 1 },
      { x: planned.hall.x + planned.hall.w - 2, y: planned.hall.y + 1 },
      { x: planned.hall.x + planned.hall.w - 2, y: planned.hall.y + planned.hall.h - 2 },
      { x: planned.hall.x + 1, y: planned.hall.y + planned.hall.h - 2 },
      { x: Math.round((planned.hall.x + planned.hall.w) / 2) - 1, y: Math.max(3, board.y + board.h + 1) },
    ],
    gridWidth: layout.gridWidth ?? WORLD_LAYOUT.gridWidth,
    gridHeight: layout.gridHeight ?? WORLD_LAYOUT.gridHeight,
  };
  const grid = buildWalkability({ ...base, board }, areas, { gridWidth: base.gridWidth, gridHeight: base.gridHeight });
  return {
    ...base,
    sectors: base.sectors.map((sectorData) => new OfficeSector(sectorData)),
    grid,
    bounds: computeWorldBounds(base.gridWidth, base.gridHeight),
    office: office ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * 16. BOARD + AREA DECOR DRAWING
 * ------------------------------------------------------------------ */

export class BigDailyResultBoard {
  constructor(options = {}) {
    this.width = Number(options.width) || 540;
    this.height = Number(options.height) || 248;
  }

  draw(ctx, anchor, model, time) {
    const width = this.width;
    const height = this.height;
    const x = Math.round(anchor.x - width / 2);
    const y = Math.round(anchor.y - height - 16);
    pxRect(ctx, x - 8, y - 8, width + 16, height + 16, PALETTE.boardFrame);
    pxRect(ctx, x - 4, y - 4, width + 8, height + 8, PALETTE.boardFrame2);
    pxRect(ctx, x, y, width, height, PALETTE.boardBg);
    pxRect(ctx, x, y, width, 2, "#24395e");
    pxRect(ctx, x, y + height - 2, width, 2, "#050b16");

    // Title
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 16px \"Courier New\", monospace";
    ctx.fillStyle = "#9fb6e8";
    ctx.fillText("RESULTADO DO DIA", x + 18, y + 27);
    pxRect(ctx, x + 18, y + 34, width - 36, 1, "#24395e");

    // Huge settled number — the largest text in the office
    ctx.textAlign = "center";
    ctx.font = "bold 46px \"Courier New\", monospace";
    ctx.fillStyle = toneColor(model.tone);
    ctx.fillText(model.text, x + width * 0.34, y + 84);
    const blink = Math.floor((time ?? 0) / 700) % 2 === 0;
    if (model.tone !== "ZERO" && model.tone !== "EMPTY" && blink) {
      ctx.globalAlpha = 0.22;
      ctx.fillText(model.text, x + width * 0.34, y + 84);
      ctx.globalAlpha = 1;
    }

    // Left column — daily metrics
    const leftX = x + 18;
    const stats = [
      ["Operações Hoje", String(model.trades), PALETTE.ink],
      ["Wins", String(model.wins), PALETTE.positive],
      ["Losses", String(model.losses), PALETTE.negative],
      ["Win Rate", model.winRateText, PALETTE.ink],
      ["Maior Win", model.bestWinText, PALETTE.positive],
      ["Maior Loss", model.bestLossText, PALETTE.negative],
    ];
    stats.forEach(([label, value, color], index) => {
      const rowY = y + 112 + index * 18;
      ctx.textAlign = "left";
      ctx.font = "bold 9px \"Courier New\", monospace";
      ctx.fillStyle = "#6f7fa8";
      ctx.fillText(label.toUpperCase(), leftX, rowY);
      ctx.textAlign = "right";
      ctx.font = "bold 11px \"Courier New\", monospace";
      ctx.fillStyle = color;
      ctx.fillText(value, leftX + 138, rowY);
    });

    // Center equity chart
    const chartX = x + 176;
    const chartY = y + 104;
    const chartW = width - 176 - 150;
    const chartH = 92;
    this.#drawEquityChart(ctx, chartX, chartY, chartW, chartH, model.equity);

    // Right — MERCADOS box + weekly/monthly
    const boxX = x + width - 140;
    const boxY = y + 104;
    const boxW = 122;
    const boxH = 58;
    pxRect(ctx, boxX, boxY, boxW, boxH, "#0a1424");
    pxRect(ctx, boxX, boxY, boxW, 14, "#1d3459");
    ctx.textAlign = "center";
    ctx.font = "bold 9px \"Courier New\", monospace";
    ctx.fillStyle = "#9fb6e8";
    ctx.fillText("MERCADOS", boxX + boxW / 2, boxY + 10);
    const marketRows = [
      ["Abertos", String(model.openMarkets), PALETTE.positive],
      ["Fechados", String(model.closedMarkets), PALETTE.neutral],
      ["Total", String(model.totalMarkets), PALETTE.ink],
    ];
    marketRows.forEach(([label, value, color], index) => {
      const rowY = boxY + 25 + index * 11;
      ctx.textAlign = "left";
      ctx.font = "bold 8px \"Courier New\", monospace";
      ctx.fillStyle = "#6f7fa8";
      ctx.fillText(label, boxX + 8, rowY);
      ctx.textAlign = "right";
      ctx.font = "bold 9px \"Courier New\", monospace";
      ctx.fillStyle = color;
      ctx.fillText(value, boxX + boxW - 8, rowY);
    });
    ctx.textAlign = "left";
    ctx.font = "bold 8px \"Courier New\", monospace";
    ctx.fillStyle = "#6f7fa8";
    ctx.fillText("LUCRO SEMANAL", boxX, boxY + 78);
    ctx.font = "bold 11px \"Courier New\", monospace";
    ctx.fillStyle = model.weeklyPnl === null ? "#6f7fa8" : model.weeklyPnl >= 0 ? PALETTE.positive : PALETTE.negative;
    ctx.fillText(model.weeklyText, boxX + 92, boxY + 78);
    ctx.font = "bold 8px \"Courier New\", monospace";
    ctx.fillStyle = "#6f7fa8";
    ctx.fillText("LUCRO MENSAL", boxX, boxY + 94);
    ctx.font = "bold 11px \"Courier New\", monospace";
    ctx.fillStyle = model.monthlyPnl === null ? "#6f7fa8" : model.monthlyPnl >= 0 ? PALETTE.positive : PALETTE.negative;
    ctx.fillText(model.monthlyText, boxX + 92, boxY + 94);

    // Footer status
    ctx.textAlign = "left";
    ctx.font = "bold 8px \"Courier New\", monospace";
    ctx.fillStyle = model.practice ? PALETTE.amber : PALETTE.red;
    ctx.fillText(model.practice ? "PRACTICE" : "REAL", x + 18, y + height - 10);
    ctx.fillStyle = "#6f7fa8";
    ctx.fillText(`ARM ${model.armState}`, x + 92, y + height - 10);
    ctx.fillText(`AGENTES ${model.activeCount}/${model.activeLimit}`, x + 214, y + height - 10);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  #drawEquityChart(ctx, x, y, width, height, equity) {
    pxRect(ctx, x, y, width, height, "#081120");
    pxRect(ctx, x, y, width, 1, "#1d3459");
    const values = Array.isArray(equity) ? equity.map((point) => Number(point?.cumulative)).filter((value) => Number.isFinite(value)) : [];
    const axis = ["09:00", "12:00", "15:00", "18:00"];
    if (values.length >= 2) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      ctx.strokeStyle = "rgba(90, 120, 170, 0.18)";
      ctx.lineWidth = 1;
      for (let row = 1; row < 4; row += 1) {
        const gy = Math.round(y + (row / 4) * (height - 14));
        ctx.beginPath();
        ctx.moveTo(x + 1, gy);
        ctx.lineTo(x + width - 1, gy);
        ctx.stroke();
      }
      const up = values[values.length - 1] >= values[0];
      ctx.strokeStyle = up ? PALETTE.positive : PALETTE.negative;
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((value, index) => {
        const px = x + (index / (values.length - 1)) * (width - 4) + 2;
        const py = y + height - 16 - ((value - min) / span) * (height - 22);
        if (index === 0) ctx.moveTo(Math.round(px), Math.round(py));
        else ctx.lineTo(Math.round(px), Math.round(py));
      });
      ctx.stroke();
    } else {
      ctx.textAlign = "left";
      ctx.font = "8px \"Courier New\", monospace";
      ctx.fillStyle = "#42507a";
      ctx.fillText("EQUITY —", x + 6, y + 14);
    }
    ctx.textAlign = "left";
    ctx.font = "7px \"Courier New\", monospace";
    ctx.fillStyle = "#5f6f98";
    axis.forEach((label, index) => {
      ctx.fillText(label, x + 2 + index * ((width - 20) / (axis.length - 1)), y + height - 4);
    });
  }
}

function drawWhiteboard(ctx, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 34, y - 62, 68, 46, "#e8ecf4");
  pxRect(ctx, x - 34, y - 62, 68, 2, "#ffffff");
  pxRect(ctx, x - 34, y - 18, 68, 2, "#9aa0b2");
  ctx.strokeStyle = "#3f6fd8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let index = 0; index < 24; index += 1) {
    const px = x - 28 + index * 2.4;
    const py = y - 34 + Math.sin(index / 3) * 8 + Math.cos(index / 5) * 4;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  pxRect(ctx, x - 26, y - 52, 18, 1, "#c94f4f");
  pxRect(ctx, x - 26, y - 48, 24, 1, "#54a06a");
  pxRect(ctx, x + 8, y - 52, 20, 1, "#3a4356");
  pxRect(ctx, x + 8, y - 48, 14, 1, "#3a4356");
  pxRect(ctx, x - 36, y - 18, 3, 12, PALETTE.woodDark);
  pxRect(ctx, x + 33, y - 18, 3, 12, PALETTE.woodDark);
}

function drawChartPin(ctx, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 15, y - 44, 30, 26, "#e8e2d0");
  pxRect(ctx, x - 15, y - 44, 30, 2, "#c9a44f");
  ctx.strokeStyle = "#c94f4f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 11, y - 24);
  ctx.lineTo(x - 4, y - 32);
  ctx.lineTo(x + 2, y - 27);
  ctx.lineTo(x + 11, y - 38);
  ctx.stroke();
  pxRect(ctx, x - 16, y - 18, 2, 14, PALETTE.woodDark);
  pxRect(ctx, x + 14, y - 18, 2, 14, PALETTE.woodDark);
}

function drawMeetingScreen(ctx, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 26, y - 64, 52, 36, "#141c30");
  pxRect(ctx, x - 24, y - 62, 48, 32, "#20304e");
  ctx.fillStyle = "#7fb2ff";
  ctx.font = "bold 8px \"Courier New\", monospace";
  ctx.fillText("REUNIÃO", x - 18, y - 48);
  ctx.fillStyle = "#9fb6e8";
  ctx.font = "7px \"Courier New\", monospace";
  ctx.fillText("• revisão de setups", x - 18, y - 40);
  ctx.fillText("• riscos do dia", x - 18, y - 33);
  pxRect(ctx, x - 27, y - 28, 54, 3, PALETTE.metalDark);
}

function drawWorldMap(ctx, point, time) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 44, y - 96, 88, 62, PALETTE.woodDark);
  pxRect(ctx, x - 41, y - 93, 82, 56, "#1b2c4a");
  const continent = (cx, cy, w, h, color) => pxRect(ctx, x + cx, y + cy, w, h, color);
  continent(-30, -84, 18, 10, "#3d6b4d");
  continent(-14, -74, 8, 12, "#3d6b4d");
  continent(2, -88, 16, 8, "#3d6b4d");
  continent(4, -78, 10, 14, "#3d6b4d");
  continent(26, -76, 12, 10, "#3d6b4d");
  continent(-24, -58, 10, 8, "#3d6b4d");
  continent(24, -58, 8, 6, "#3d6b4d");
  ctx.strokeStyle = "rgba(120, 160, 220, 0.25)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    ctx.beginPath();
    ctx.moveTo(x - 41, y - 88 + index * 12);
    ctx.lineTo(x + 41, y - 88 + index * 12);
    ctx.stroke();
  }
  const pins = [[-18, -80], [8, -70], [30, -64], [-6, -58]];
  pins.forEach((pin, index) => {
    const lit = Math.floor((time ?? 0) / 600 + index) % 2 === 0;
    pxRect(ctx, x + pin[0], y + pin[1], 2, 2, lit ? PALETTE.amber : "#7a5a20");
  });
  ctx.fillStyle = "#9fb6e8";
  ctx.font = "bold 8px \"Courier New\", monospace";
  ctx.fillText("MAPA MUNDI", x - 28, y - 40);
}

function drawSignpost(ctx, point, label) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 1, y - 20, 3, 20, PALETTE.woodDark);
  const width = Math.max(48, label.length * 6 + 12);
  pxRect(ctx, x - width / 2, y - 34, width, 15, PALETTE.woodMid);
  pxRect(ctx, x - width / 2 + 1, y - 33, width - 2, 1, PALETTE.woodLight);
  ctx.fillStyle = "#2c1806";
  ctx.font = "bold 8px \"Courier New\", monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - 24);
  ctx.textAlign = "left";
}

function wrapTextByChars(text, maxChars) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];
  const words = source.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawHangingSign(ctx, point, label) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  const width = Math.max(96, label.length * 5 + 20);
  pxRect(ctx, x - width / 2 + 6, y - 26, 1, 12, PALETTE.metalDark);
  pxRect(ctx, x + width / 2 - 7, y - 26, 1, 12, PALETTE.metalDark);
  pxRect(ctx, x - width / 2, y - 16, width, 16, "#3a2a20");
  pxRect(ctx, x - width / 2 + 2, y - 14, width - 4, 12, PALETTE.woodMid);
  pxRect(ctx, x - width / 2 + 2, y - 14, width - 4, 1, PALETTE.gold);
  ctx.font = "bold 8px \"Courier New\", monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2c1806";
  ctx.fillText(label, x, y - 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawBullStatue(ctx, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 10, y - 4, 20, 4, "#3a2a20");
  const gold = PALETTE.gold;
  const goldDark = "#a8792a";
  pxRect(ctx, x - 8, y - 16, 14, 10, gold);
  pxRect(ctx, x - 8, y - 16, 14, 2, "#f0c869");
  pxRect(ctx, x - 6, y - 7, 2, 4, goldDark);
  pxRect(ctx, x + 4, y - 7, 2, 4, goldDark);
  pxRect(ctx, x + 5, y - 22, 7, 7, gold);
  pxRect(ctx, x + 6, y - 21, 2, 2, "#2c1806");
  pxRect(ctx, x + 4, y - 25, 3, 2, "#f0c869");
  pxRect(ctx, x + 11, y - 25, 3, 2, "#f0c869");
  pxRect(ctx, x - 10, y - 18, 2, 6, goldDark);
}

function drawArcadeCabinet(ctx, point, time) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  pxRect(ctx, x - 8, y - 30, 16, 30, "#3a2a45");
  pxRect(ctx, x - 6, y - 28, 12, 12, "#101a2c");
  const frame = Math.floor((time ?? 0) / 400) % 3;
  const colors = ["#d9534f", "#4fbf6a", "#6fd3ff"];
  pxRect(ctx, x - 5, y - 26, 10, 8, colors[frame]);
  pxRect(ctx, x - 5, y - 14, 10, 3, "#22283a");
  pxRect(ctx, x - 3, y - 11, 2, 2, PALETTE.red);
  pxRect(ctx, x + 1, y - 11, 2, 2, PALETTE.amber);
}

function drawSidePanel(ctx, point, panel) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (panel.tone === "bull") {
    drawBullStatue(ctx, { x, y: y - 12 });
    return;
  }
  const width = 122;
  const titleLines = wrapTextByChars(panel.title, 20);
  const subtitleLines = wrapTextByChars(panel.subtitle, 24);
  const height = 20 + titleLines.length * 11 + subtitleLines.length * 9;
  const tone = panel.tone;
  const bg = tone === "red" ? "#7d2b2b" : tone === "map" ? "#16305a" : tone === "gold" ? "#241a10" : "#101a2c";
  const accent = tone === "red" ? "#f0a0a0" : tone === "map" ? "#7fb2ff" : PALETTE.gold;
  pxRect(ctx, x - width / 2, y - height, width, height, "#0a1220");
  pxRect(ctx, x - width / 2 + 2, y - height + 2, width - 4, height - 4, bg);
  pxRect(ctx, x - width / 2 + 2, y - height + 2, width - 4, 2, accent);
  pxRect(ctx, x - width / 2 + 2, y - 2, width - 4, 2, accent);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let cursor = y - height + 15;
  if (panel.id === "brand") {
    ctx.font = "bold 14px \"Courier New\", monospace";
    ctx.fillStyle = "#f0e6cc";
    ctx.fillText("TRACE", x - 12, cursor);
    ctx.fillStyle = accent;
    ctx.fillText("/", x + 1, cursor);
    ctx.fillStyle = "#f0e6cc";
    ctx.fillText("COM", x + 22, cursor);
    cursor += 12;
  } else {
    ctx.font = "bold 9px \"Courier New\", monospace";
    ctx.fillStyle = "#e8d7b0";
    for (const line of titleLines) {
      ctx.fillText(line, x, cursor);
      cursor += 11;
    }
  }
  ctx.font = "7px \"Courier New\", monospace";
  ctx.fillStyle = "#9fb0d0";
  for (const line of subtitleLines) {
    ctx.fillText(line, x, cursor);
    cursor += 9;
  }
  if (panel.id === "pause") drawArcadeCabinet(ctx, { x: x + width / 2 + 10, y: y + 6 }, 0);
  ctx.textAlign = "left";
}

function drawSectorRibbon(ctx, band) {
  fillIsoRect(ctx, band.ribbon, "#12233f", "#2f5a9e");
  pxPath(ctx, [
    isoProject(band.ribbon.x, band.ribbon.y + 1),
    isoProject(band.ribbon.x + band.ribbon.w, band.ribbon.y + 1),
    isoProject(band.ribbon.x + band.ribbon.w, band.ribbon.y + 1.2),
    isoProject(band.ribbon.x, band.ribbon.y + 1.2),
  ], PALETTE.gold);
  for (const member of band.members) {
    const half = member.side === "right" ? band.rightHalf : member.side === "left" ? band.leftHalf : band.ribbon;
    const center = isoProject(half.x + half.w / 2, half.y + 0.5);
    ctx.font = "bold 11px \"Courier New\", monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillText(member.label, Math.round(center.x) + 1, Math.round(center.y) + 1);
    ctx.fillStyle = member.accent;
    ctx.fillText(member.label, Math.round(center.x), Math.round(center.y));
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawBottomBand(ctx, layout) {
  const hall = layout.hall;
  const bottom = hall.y + hall.h;
  const centerX = hall.x + hall.w / 2;
  const carpet = { x: centerX - 11, y: bottom + 1, w: 22, h: 3 };
  fillIsoRect(ctx, carpet, "#3a1f24");
  fillIsoRect(ctx, { x: carpet.x + 1, y: carpet.y + 0.6, w: carpet.w - 2, h: carpet.h - 1.2 }, "#5e2b32");
  fillIsoRect(ctx, { x: carpet.x + 2, y: carpet.y + 1, w: carpet.w - 4, h: carpet.h - 2 }, "#3a1f24");
  const label = isoProject(centerX, carpet.y + 1.5);
  ctx.save();
  ctx.translate(Math.round(label.x), Math.round(label.y));
  ctx.rotate(Math.atan2(HALF_H, HALF_W));
  ctx.textAlign = "center";
  ctx.font = "bold 12px \"Courier New\", monospace";
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillText("TRACE/COM", 1, 1);
  ctx.fillStyle = PALETTE.gold;
  ctx.fillText("TRACE/COM", 0, 0);
  ctx.font = "bold 7px \"Courier New\", monospace";
  ctx.fillStyle = "#c9b48c";
  ctx.fillText("VISION · SHADOW · RESULT", 0, 10);
  ctx.restore();
  ctx.textAlign = "left";
}

function drawFloorLabel(ctx, sector) {
  const point = isoProject(sector.labelPos.x, sector.labelPos.y);
  ctx.save();
  ctx.translate(Math.round(point.x), Math.round(point.y));
  ctx.rotate(Math.atan2(HALF_H, HALF_W));
  ctx.font = "bold 10px \"Courier New\", monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillText(sector.label, 2, 1);
  ctx.fillStyle = sector.accent;
  ctx.fillText(sector.label, 1, 0);
  ctx.restore();
  ctx.textAlign = "left";
}

export function drawAreaFurniture(ctx, item, time) {
  const rect = item.rect;
  switch (item.kind) {
    case "shelf": drawShelf(ctx, rect); break;
    case "profDesk": {
      drawIsoShadow(ctx, rect, 3, 2);
      drawIsoBox(ctx, rect, 12, { top: PALETTE.woodLight, front: PALETTE.woodDark, side: PALETTE.woodMid, dark: PALETTE.woodDark });
      const point = isoProject(rect.x + 1, rect.y + 0.6);
      pxRect(ctx, point.x - 4, point.y - 22, 9, 7, "#20283c");
      pxRect(ctx, point.x - 3, point.y - 21, 7, 5, PALETTE.screenOn);
      pxRect(ctx, point.x - 2, point.y - 12, 4, 2, PALETTE.metalDark);
      const lamp = isoProject(rect.x + rect.w - 0.6, rect.y + 0.4);
      pxRect(ctx, lamp.x - 1, lamp.y - 14, 3, 3, PALETTE.amber);
      pxRect(ctx, lamp.x, lamp.y - 11, 1, 5, PALETTE.metalDark);
      break;
    }
    case "table": drawTable(ctx, rect, item.height ?? 10); break;
    case "woodTable": drawTable(ctx, rect, 11); break;
    case "island": drawIsland(ctx, rect); break;
    case "counter": drawCounter(ctx, rect); break;
    case "coffeeMachine": drawCoffeeMachine(ctx, rect, time); break;
    case "fridge": drawFridge(ctx, rect); break;
    case "stool": drawStool(ctx, rect); break;
    case "chair": drawChair(ctx, rect); break;
    case "poolTable": drawPoolTable(ctx, rect, time); break;
    case "sofa": drawSofa(ctx, rect, time); break;
    case "coffeeTable": drawCoffeeTable(ctx, rect); break;
    case "rug": drawRug(ctx, rect, rect.x + rect.y); break;
    case "rack": drawRack(ctx, rect, time); break;
    case "mapFloor": break;
    default: drawIsoBox(ctx, rect, 8, { top: PALETTE.woodMid, front: PALETTE.woodDark, side: PALETTE.woodDark, dark: PALETTE.woodDark });
  }
}

function drawBillboard(ctx, item, time) {
  const point = isoProject(item.anchor.x, item.anchor.y);
  switch (item.kind) {
    case "whiteboard": drawWhiteboard(ctx, point); break;
    case "chartPin": drawChartPin(ctx, point); break;
    case "screen": drawMeetingScreen(ctx, point); break;
    case "worldMap": drawWorldMap(ctx, point, time); break;
    case "hangingSign": drawHangingSign(ctx, point, item.label ?? ""); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ *
 * 17. ACTORS + STATIONS + SCENE
 * ------------------------------------------------------------------ */

export function deriveActorState(market, role, now = Date.now()) {
  if (!market) return "OFFLINE";
  if (!isDeskActive(market)) return "OFFLINE";
  if (market.agentState === "OFFLINE" || market.agentState === "UNAVAILABLE") return "OFFLINE";
  const state = market.settlementState ?? {};
  const settledAt = Number(state.lastAt) || 0;
  const fresh = settledAt > 0 && now - settledAt < 8000;
  if (fresh && state.lastResult === "WIN") return "CELEBRATE";
  if (fresh && state.lastResult === "LOSS") return "DEJECTED";
  if (market.positionState?.status === "OPEN" || market.agentState === "IN_POSITION") return role === "trader" ? "WORK" : "OBSERVE";
  if (market.agentState === "SIGNAL" || market.agentState === "ORDERING") return role === "trader" ? "SIGNAL" : "WORK";
  if (market.agentState === "ERROR") return "DEJECTED";
  return "WORK";
}

export class AgentActor {
  constructor(options = {}) {
    this.id = options.id;
    this.role = options.role ?? "trader";
    this.station = options.station ?? null;
    this.home = options.home ? { x: options.home.x + 0.5, y: options.home.y + 0.5 } : { x: 0, y: 0 };
    this.x = this.home.x;
    this.y = this.home.y;
    this.state = options.state ?? "SEAT";
    this.stateSince = 0;
    this.path = null;
    this.pathCursor = 0;
    this.speed = Number(options.speed) || 1.7;
    this.spotId = null;
    this.activityKind = null;
    this.activityUntil = 0;
    this.frame = 0;
    this.machine = new AgentStateMachine(this.state);
  }

  get seated() {
    return this.state === "SEAT" || this.state === "WORK" || this.state === "SIGNAL" || this.state === "CELEBRATE" || this.state === "DEJECTED";
  }

  setState(state, at = 0) {
    if (state === this.state) return;
    if (this.machine.state !== state) {
      if (this.machine.can(state)) this.machine.transition(state, at);
      else {
        this.machine.state = state;
        this.machine.history.push(state);
      }
    }
    this.state = state;
    this.stateSince = at;
  }

  goTo(path) {
    if (!Array.isArray(path) || path.length === 0) return false;
    this.path = path.map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 }));
    this.pathCursor = 0;
    this.setState("WALK");
    return true;
  }

  update(deltaMs, now) {
    this.frame = Math.floor(now / 320) % 2;
    if (this.state !== "WALK" || !this.path) return;
    let remaining = this.speed * (deltaMs / 1000);
    while (remaining > 0 && this.pathCursor < this.path.length) {
      const target = this.path[this.pathCursor];
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= remaining) {
        this.x = target.x;
        this.y = target.y;
        this.pathCursor += 1;
        remaining -= distance;
      } else {
        this.x += (dx / distance) * remaining;
        this.y += (dy / distance) * remaining;
        remaining = 0;
      }
    }
    if (this.pathCursor >= this.path.length) {
      this.path = null;
      this.setState(this.activityKind ?? "SEAT", now);
    }
  }
}

export class AssetStation {
  constructor(data) {
    this.data = data;
    this.marketKey = data.marketKey;
    this.sectorId = data.sectorId;
    this.market = data.market ?? null;
    this.displayText = this.market?.display ?? this.market?.symbol ?? data.marketKey;
    this.trader = new AgentActor({ id: `trader:${data.marketKey}`, role: "trader", station: this, home: data.seat[0] });
    this.critic = new AgentActor({ id: `critic:${data.marketKey}`, role: "critic", station: this, home: data.seat[1] });
    this.desk = new AssetDesk(data);
    this.applyMarket(this.market);
  }

  get actors() {
    return [this.trader, this.critic];
  }

  applyMarket(market) {
    this.market = market ?? null;
    this.data.market = this.market;
    this.displayText = market?.display ?? market?.symbol ?? this.marketKey;
    const now = Date.now();
    this.trader.setState(deriveActorState(market, "trader", now), now);
    this.critic.setState(deriveActorState(market, "critic", now), now);
  }
}

export class SupervisorSprite {
  constructor(options = {}) {
    this.patrol = new SupervisorPatrol({ waypoints: options.waypoints ?? [], speed: options.speed ?? 1.05 });
    this.pathfinding = options.pathfinding ?? null;
    this.spotId = null;
    this.pendingPath = false;
    this.frame = 0;
    this.palette = ROLE_PALETTES.supervisor;
    this.actor = new AgentActor({ id: "supervisor", role: "supervisor", state: "WALK", speed: 1.05 });
  }

  get stage() {
    return this.patrol.stage;
  }

  update(deltaMs, now) {
    this.frame = Math.floor(now / 320) % 2;
    if (this.patrol.needsPath() && this.pathfinding && !this.pendingPath) {
      const waypoint = this.patrol.waypoint;
      if (waypoint) {
        const sameCell = Math.round(waypoint.x) === Math.round(this.patrol.pos.x) && Math.round(waypoint.y) === Math.round(this.patrol.pos.y);
        if (sameCell) {
          this.patrol.advanceWaypoint();
        } else {
          const path = this.pathfinding.findPath(this.patrol.pos, waypoint);
          if (path && path.length > 1) this.patrol.setPath(path);
          else this.patrol.advanceWaypoint();
        }
      }
      this.pendingPath = false;
    }
    this.patrol.update(deltaMs, now);
    this.actor.x = this.patrol.pos.x;
    this.actor.y = this.patrol.pos.y;
    this.actor.state = this.patrol.stage === "WALK" ? "WALK" : this.patrol.stage === "OBSERVE" ? "OBSERVE" : this.patrol.stage === "STOP" ? "STOP" : "IDLE";
  }

  draw(ctx, time) {
    const point = { x: this.actor.x, y: this.actor.y };
    drawActorPixels(ctx, this.actor, { palette: this.palette, time, point, standingOffset: 4 });
    if (this.patrol.stage === "OBSERVE") {
      const projected = isoProject(point.x, point.y);
      ctx.globalAlpha = 0.3;
      pxRect(ctx, projected.x - 12, projected.y - 34, 24, 1, PALETTE.amber);
      ctx.globalAlpha = 1;
    }
  }
}

export class IdleActivitySystem {
  constructor(options = {}) {
    this.occupancy = options.occupancy ?? new OccupancySystem([]);
    this.pathfinding = options.pathfinding ?? null;
    this.maxConcurrent = options.maxConcurrent ?? 6;
    this.cooldowns = new Map();
  }

  #rng(actor) {
    return mulberry32(hashString(`${actor.id}:${Math.floor((this.cooldowns.get(actor.id) ?? 0) / 45000)}`));
  }

  kindsFor(role) {
    if (role === "critic") return ["research", "coffee", "leisure", "social"];
    return ["coffee", "leisure", "social", "kitchen", "pool"];
  }

  plan(actor, officeMarket, now) {
    if (!actor || actor.state === "WALK" || !actor.station) return null;
    if (this.occupancy.totalOccupied() >= this.maxConcurrent) return null;
    const last = this.cooldowns.get(actor.id) ?? 0;
    if (now - last < 30000) return null;
    const idle = !officeMarket || officeMarket.enabled === false || officeMarket.agentState === "WAIT" || officeMarket.agentState === "ANALYZING";
    if (!idle) return null;
    const rng = this.#rng(actor);
    if (rng() > 0.35) return null;
    const kinds = this.kindsFor(actor.role);
    const reservation = this.occupancy.reserveFirst(actor.id, kinds, now);
    if (!reservation.ok) return null;
    const start = { x: Math.floor(actor.x), y: Math.floor(actor.y) };
    const target = { x: reservation.x, y: reservation.y };
    const path = this.pathfinding ? this.pathfinding.findPath(start, target) : null;
    if (!path) {
      this.occupancy.release(reservation.spotId, actor.id);
      return null;
    }
    this.cooldowns.set(actor.id, now);
    actor.spotId = reservation.spotId;
    actor.activityKind = reservation.kind === "research" ? "RESEARCH" : reservation.kind === "coffee" ? "COFFEE" : reservation.kind === "kitchen" ? "KITCHEN" : reservation.kind === "social" ? "SOCIAL" : "LEISURE";
    actor.goTo(path);
    return reservation;
  }

  returnHome(actor, now) {
    if (!actor || actor.state === "WALK" || actor.seated) return false;
    const path = this.pathfinding ? this.pathfinding.findPath({ x: Math.floor(actor.x), y: Math.floor(actor.y) }, { x: Math.floor(actor.home.x), y: Math.floor(actor.home.y) }) : null;
    if (!path) return false;
    if (actor.spotId) this.occupancy.release(actor.spotId, actor.id);
    actor.spotId = null;
    actor.activityKind = null;
    actor.goTo(path);
    return true;
  }
}

export class OfficeWorld {
  constructor(office = null, options = {}) {
    this.options = options;
    this.office = office;
    this.build(office);
  }

  build(office) {
    this.office = office ?? null;
    this.layout = buildOfficeWorld(office ?? null, this.options);
    this.grid = this.layout.grid;
    this.pathfinding = new PathfindingSystem(this.grid);
    this.occupancy = new OccupancySystem(this.layout.spots);
    this.stations = this.layout.stations.map((data) => new AssetStation(data));
    this.stationByKey = new Map(this.stations.map((station) => [station.marketKey, station]));
    this.marketByKey = new Map((office?.markets ?? []).map((market) => [market.marketKey, market]));
    for (const station of this.stations) station.applyMarket(this.marketByKey.get(station.marketKey) ?? station.market);
    this.supervisor = new SupervisorSprite({ waypoints: this.layout.patrol, pathfinding: this.pathfinding, speed: 1.05 });
    this.idle = new IdleActivitySystem({ occupancy: this.occupancy, pathfinding: this.pathfinding });
    this.board = new BigDailyResultBoard();
    this.actors = this.stations.flatMap((station) => station.actors);
    this.marketSignature = (office?.markets ?? []).map((market) => market.marketKey).join("|");
  }

  sync(office) {
    const signature = (office?.markets ?? []).map((market) => market.marketKey).join("|");
    if (signature !== this.marketSignature) {
      this.build(office);
      return true;
    }
    this.office = office ?? null;
    this.marketByKey = new Map((office?.markets ?? []).map((market) => [market.marketKey, market]));
    for (const station of this.stations) station.applyMarket(this.marketByKey.get(station.marketKey) ?? station.market);
    return false;
  }

  update(deltaMs, now) {
    for (const actor of this.actors) {
      actor.update(deltaMs, now);
      const market = this.marketByKey.get(actor.station?.marketKey);
      const idle = !market || market.enabled === false || market.agentState === "WAIT";
      if (idle && !actor.seated && actor.state !== "WALK") {
        if (now - actor.stateSince > 6000) this.idle.returnHome(actor, now);
      } else if ((market?.enabled === false || market?.agentState === "WAIT") && actor.seated) {
        this.idle.plan(actor, market, now);
      }
    }
    this.occupancy.tick(now, 240000);
    this.supervisor.update(deltaMs, now);
  }
}

export class MarketOfficeBridge {
  constructor() {
    this.office = null;
    this.world = null;
  }

  apply(office) {
    this.office = office ?? null;
    if (!this.world) this.world = new OfficeWorld(office);
    else this.world.sync(office);
    return this.world;
  }
}

/* ------------------------------------------------------------------ *
 * 18. RENDERER — canvas 2D, nearest-neighbor, depth-sorted
 * ------------------------------------------------------------------ */

export class OfficeRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.camera = new OfficeCamera({ zoom: options.zoom ?? 1 });
    this.dpr = Math.max(1, Math.min(3, Number(options.pixelRatio) || (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1));
    this.maxFps = Math.max(10, Number(options.maxFps) || 30);
    this.world = null;
    this.floorLayer = null;
    this.floorOrigin = { x: 0, y: 0 };
    this.running = false;
    this.lastFrameAt = 0;
    this.lastTime = 0;
    this.time = 0;
    this.hoverMarketKey = null;
    this.selectedMarketKey = null;
    this.viewport = { width: 1, height: 1 };
    this.sprites = new Map();
    this.frameHandle = null;
  }

  attach(world) {
    this.world = world;
    this.sprites.clear();
    this.buildFloorLayer();
    this.resize();
    if (world?.layout) this.camera.fit(world.layout.bounds);
    return this;
  }

  spriteFor(actor) {
    if (!this.sprites.has(actor.id)) {
      const SpriteClass = actor.role === "critic" ? CriticSprite : TraderSprite;
      this.sprites.set(actor.id, new SpriteClass(actor));
    }
    return this.sprites.get(actor.id);
  }

  resize() {
    if (typeof document === "undefined" || !this.canvas) return;
    const parent = this.canvas.parentElement;
    const rect = parent?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const width = Math.max(320, Math.floor(rect.width || (typeof window !== "undefined" ? window.innerWidth : 960)));
    const height = Math.max(240, Math.floor(rect.height || (typeof window !== "undefined" ? window.innerHeight - 90 : 540)));
    this.viewport = { width, height };
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.camera.setViewport(width, height);
    return this;
  }

  buildFloorLayer() {
    if (typeof document === "undefined") return null;
    const layout = this.world?.layout;
    if (!layout) {
      this.floorLayer = null;
      return null;
    }
    const bounds = layout.bounds;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(bounds.width);
    canvas.height = Math.ceil(bounds.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.translate(-bounds.minX, -bounds.minY);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
    const tiles = [];
    for (let gy = 0; gy < layout.gridHeight; gy += 1) {
      for (let gx = 0; gx < layout.gridWidth; gx += 1) {
        tiles.push({ gx, gy, shade: (gx + gy) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB });
      }
    }
    for (const tile of tiles) fillIsoRect(ctx, { x: tile.gx, y: tile.gy, w: 1, h: 1 }, tile.shade);
    fillIsoRect(ctx, layout.hall, PALETTE.hall);
    fillIsoRect(ctx, { x: layout.hall.x, y: layout.hall.y, w: layout.hall.w, h: 1 }, PALETTE.corridor);
    for (const sector of layout.sectors) {
      ctx.globalAlpha = 0.85;
      fillIsoRect(ctx, sector.floor, sector.floorColor);
      ctx.globalAlpha = 1;
    }
    for (const band of sectorRibbonBands(layout.sectors)) drawSectorRibbon(ctx, band);
    for (const area of layout.areas) fillIsoRect(ctx, area.rect, area.floorColor);
    ctx.strokeStyle = "rgba(48, 82, 128, 0.16)";
    ctx.lineWidth = 1;
    for (let gy = 0; gy <= layout.gridHeight; gy += 1) {
      const a = isoProject(0, gy);
      const b = isoProject(layout.gridWidth, gy);
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x), Math.round(a.y));
      ctx.lineTo(Math.round(b.x), Math.round(b.y));
      ctx.stroke();
    }
    for (let gx = 0; gx <= layout.gridWidth; gx += 1) {
      const a = isoProject(gx, 0);
      const b = isoProject(gx, layout.gridHeight);
      ctx.beginPath();
      ctx.moveTo(Math.round(a.x), Math.round(a.y));
      ctx.lineTo(Math.round(b.x), Math.round(b.y));
      ctx.stroke();
    }
    for (const area of layout.areas) {
      for (const item of area.furniture) if (item.kind === "rug") drawRug(ctx, item.rect, item.rect.x + item.rect.y);
    }
    const entrance = { x: layout.hall.x + layout.hall.w / 2 - 4, y: layout.hall.y + layout.hall.h, w: 8, h: 2 };
    fillIsoRect(ctx, entrance, "#3a2f3f");
    drawBottomBand(ctx, layout);
    ctx.fillStyle = "#8a7a5a";
    ctx.font = "bold 9px \"Courier New\", monospace";
    this.#drawWall(ctx, layout);
    this.#drawLightPools(ctx, layout);
    this.floorLayer = canvas;
    this.floorOrigin = { x: bounds.minX, y: bounds.minY };
    return canvas;
  }

  #drawWall(ctx, layout) {
    const y = 2;
    const wallHeight = 130;
    const left = isoProject(0, y);
    const right = isoProject(layout.gridWidth, y);
    pxPath(ctx, [
      { x: left.x - 10, y: left.y },
      { x: right.x, y: right.y },
      { x: right.x, y: right.y - wallHeight },
      { x: left.x - 10, y: left.y - wallHeight },
    ], PALETTE.wall);
    pxPath(ctx, [
      { x: left.x - 10, y: left.y - wallHeight },
      { x: right.x, y: right.y - wallHeight },
      { x: right.x, y: right.y - wallHeight - 6 },
      { x: left.x - 10, y: left.y - wallHeight - 6 },
    ], PALETTE.wallTop);
    const windows = 9;
    for (let index = 0; index < windows; index += 1) {
      const t0 = index / windows + 0.02;
      const t1 = (index + 1) / windows - 0.02;
      const wx0 = Math.round(right.x * t0 + left.x * (1 - t0)) - (index === 0 ? 6 : 0);
      const wx1 = Math.round(right.x * t1 + left.x * (1 - t1));
      const wy0 = Math.round(right.y * t0 + left.y * (1 - t0) - 92);
      const wy1 = Math.round(right.y * t1 + left.y * (1 - t1) - 30);
      pxPath(ctx, [
        { x: wx0, y: wy0 },
        { x: wx1, y: wy1 },
        { x: wx1, y: wy1 + 52 },
        { x: wx0, y: wy0 + 52 },
      ], index % 2 === 0 ? "#ffe0a8" : "#ffd28a");
      pxPath(ctx, [
        { x: wx0, y: wy0 + 52 },
        { x: wx1, y: wy1 + 52 },
        { x: wx1, y: wy1 + 56 },
        { x: wx0, y: wy0 + 56 },
      ], PALETTE.wallTrim);
    }
    pxPath(ctx, [
      { x: left.x - 10, y: left.y },
      { x: right.x, y: right.y },
      { x: right.x, y: right.y + 4 },
      { x: left.x - 10, y: left.y + 4 },
    ], PALETTE.wallTrim);
    for (let index = 0; index <= 8; index += 1) {
      const t = index / 8;
      const sx = Math.round(right.x * t + left.x * (1 - t));
      const sy = Math.round(right.y * t + left.y * (1 - t));
      pxRect(ctx, sx - 2, sy - 74, 4, 8, PALETTE.woodMid);
      pxRect(ctx, sx - 1, sy - 77, 2, 3, PALETTE.gold);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = PALETTE.amber;
      ctx.beginPath();
      ctx.arc(sx, sy - 68, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  #drawLightPools(ctx, layout) {
    const hall = layout.hall;
    const center = isoProject(hall.x + hall.w / 2, hall.y + hall.h / 2);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const offset of [[-260, -40], [220, 30], [0, 120]]) {
      const gradient = ctx.createRadialGradient(center.x + offset[0], center.y + offset[1], 20, center.x + offset[0], center.y + offset[1], 300);
      gradient.addColorStop(0, "rgba(255, 186, 102, 0.10)");
      gradient.addColorStop(1, "rgba(255, 186, 102, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(center.x + offset[0] - 300, center.y + offset[1] - 300, 600, 600);
    }
    ctx.restore();
  }

  markDirty() {
    this.buildFloorLayer();
  }

  start() {
    if (this.running || typeof window === "undefined") return this;
    this.running = true;
    const loop = (timestamp) => {
      if (!this.running) return;
      this.frameHandle = window.requestAnimationFrame(loop);
      if (timestamp - this.lastFrameAt < 1000 / this.maxFps) return;
      const delta = Math.min(120, timestamp - (this.lastFrameAt || timestamp));
      this.lastFrameAt = timestamp;
      this.time = timestamp;
      this.world?.update(delta, Date.now());
      this.render(timestamp);
    };
    this.frameHandle = window.requestAnimationFrame(loop);
    return this;
  }

  stop() {
    this.running = false;
    if (this.frameHandle && typeof window !== "undefined") window.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  buildDrawList(time) {
    const world = this.world;
    const list = [];
    if (!world?.layout) return list;
    for (const area of world.layout.areas) {
      for (const item of area.furniture) {
        if (item.kind === "rug" || item.kind === "mapFloor") continue;
        list.push({
          depth: item.rect.x + item.rect.w / 2 + item.rect.y + item.rect.h / 2,
          draw: (ctx) => drawAreaFurniture(ctx, item, time),
        });
      }
      for (const item of area.billboards) {
        list.push({ depth: item.anchor.x + item.anchor.y - 0.4, draw: (ctx) => drawBillboard(ctx, item, time) });
      }
      list.push({
        depth: area.signAnchor.x + area.signAnchor.y - 0.5,
        draw: (ctx) => drawSignpost(ctx, isoProject(area.signAnchor.x, area.signAnchor.y), area.label),
      });
    }
    for (const plant of world.layout.plants) {
      list.push({ depth: plant.x + 0.5 + plant.y + 0.5, draw: (ctx) => drawPlant(ctx, plant, time) });
    }
    for (const station of world.stations) {
      const desk = station.data.desk;
      const depth = desk.x + desk.w / 2 + desk.y + desk.h / 2;
      list.push({ depth, draw: (ctx) => station.desk.draw(ctx, time) });
      for (const actor of station.actors) {
        if (actor.state === "OFFLINE" && !actor.seated) continue;
        if (actor.state === "OFFLINE") continue;
        list.push({
          depth: actor.x + actor.y,
          draw: (ctx) => this.spriteFor(actor).draw(ctx, time, isoProject(actor.x, actor.y)),
        });
      }
    }
    list.push({
      depth: world.supervisor.actor.x + world.supervisor.actor.y,
      draw: (ctx) => world.supervisor.draw(ctx, time),
    });
    list.push({
      depth: world.layout.board.rect.x + world.layout.board.rect.y - 6,
      draw: (ctx) => world.board.draw(ctx, world.layout.board.anchor, pnlIndicatorModel(world.office), time),
    });
    for (const side of ["left", "right"]) {
      const panels = SIDE_PANELS[side] ?? [];
      const anchors = SIDE_PANEL_ANCHORS[side] ?? [];
      panels.forEach((panel, index) => {
        const anchor = anchors[index] ?? anchors[anchors.length - 1] ?? { x: 0, y: 0 };
        list.push({
          depth: anchor.x + anchor.y - 0.3,
          draw: (ctx) => drawSidePanel(ctx, isoProject(anchor.x, anchor.y), panel),
        });
      });
    }
    const hallBottom = world.layout.hall.y + world.layout.hall.h;
    const hallLeft = world.layout.hall.x + 3;
    const hallRight = world.layout.hall.x + world.layout.hall.w - 3;
    list.push({
      depth: hallLeft + hallBottom + 1,
      draw: (ctx) => drawSignpost(ctx, isoProject(hallLeft, hallBottom + 1), "DISCIPLINA HOJE RESULTADOS SEMPRE"),
    });
    list.push({
      depth: hallRight + hallBottom + 1,
      draw: (ctx) => drawSignpost(ctx, isoProject(hallRight, hallBottom + 1), "PEQUENAS DECISÕES GRANDES RESULTADOS"),
    });
    return list;
  }

  render(timestamp) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const viewport = this.viewport;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    const world = this.world;
    if (!world?.layout || !this.floorLayer) {
      this.#drawEmptyState(ctx);
      return;
    }
    const zoom = this.camera.zoom;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, Math.round(-this.camera.x * zoom * dpr), Math.round(-this.camera.y * zoom * dpr));
    ctx.drawImage(this.floorLayer, this.floorOrigin.x, this.floorOrigin.y);
    const list = this.buildDrawList(timestamp);
    list.sort((a, b) => a.depth - b.depth);
    for (const item of list) item.draw(ctx, timestamp);
    this.#drawPnlChips(ctx, timestamp);
    this.#drawSelection(ctx);
    this.#drawWarmOverlay(ctx, zoom);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#drawVignette(ctx);
  }

  #drawVignette(ctx) {
    const viewport = this.viewport;
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const inner = Math.min(viewport.width, viewport.height) * 0.35;
    const outer = Math.max(viewport.width, viewport.height) * 0.78;
    const gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }

  #drawPnlChips(ctx, time) {
    const world = this.world;
    if (!world) return;
    for (const station of world.stations) {
      const model = deskBadgeModel(station.market);
      if (!model.visible) continue;
      const desk = station.data.desk;
      const point = isoProject(desk.x + desk.w / 2, desk.y - 0.6);
      const x = Math.round(point.x);
      const y = Math.round(point.y);
      const width = Math.max(46, model.text.length * 7 + 14);
      const height = 15;
      const top = y - height - 20;
      pxRect(ctx, x - width / 2 + 2, top + 2, width, height, "rgba(0, 0, 0, 0.35)");
      pxRect(ctx, x - width / 2, top, width, height, "#0b1424");
      pxRect(ctx, x - width / 2, top, width, 2, model.color);
      pxRect(ctx, x - width / 2, top + height - 1, width, 1, "rgba(0, 0, 0, 0.5)");
      pxRect(ctx, x - 2, top + height, 4, 3, "#0b1424");
      ctx.font = "bold 9px \"Courier New\", monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = model.color;
      ctx.fillText(model.text, x, top + height / 2 + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
  }

  #drawSelection(ctx) {
    const world = this.world;
    if (!world) return;
    const drawOutline = (marketKey, color) => {
      const station = world.stationByKey.get(marketKey);
      if (!station) return;
      const rect = station.data.desk;
      pxPath(ctx, isoRectPoints(rect), null, color, 2);
    };
    if (this.hoverMarketKey) drawOutline(this.hoverMarketKey, "rgba(255, 255, 255, 0.35)");
    if (this.selectedMarketKey) drawOutline(this.selectedMarketKey, PALETTE.amber);
  }

  #drawWarmOverlay(ctx, zoom) {
    const world = this.world;
    if (!world?.layout) return;
    const hall = world.layout.hall;
    const center = isoProject(hall.x + hall.w / 2, hall.y + hall.h / 2);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gradient = ctx.createRadialGradient(center.x, center.y, 30, center.x, center.y, 420);
    gradient.addColorStop(0, "rgba(255, 176, 96, 0.05)");
    gradient.addColorStop(1, "rgba(255, 176, 96, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(center.x - 420, center.y - 420, 840, 840);
    ctx.restore();
  }

  #drawEmptyState(ctx) {
    const viewport = this.viewport;
    ctx.fillStyle = "#1a2136";
    ctx.font = "bold 16px \"Courier New\", monospace";
    ctx.textAlign = "center";
    ctx.fillText("PIXEL OFFICE V2 — AGUARDANDO DADOS DO RELAY", viewport.width / 2, viewport.height / 2 - 8);
    ctx.font = "11px \"Courier New\", monospace";
    ctx.fillStyle = "#6f7fa8";
    ctx.fillText("GET /api/iq/office · nenhum posto gerado ainda", viewport.width / 2, viewport.height / 2 + 14);
    ctx.textAlign = "left";
  }

  screenToGrid(screenX, screenY) {
    const world = this.camera.screenToWorld({ x: screenX, y: screenY });
    return isoUnproject(world.x, world.y);
  }

  pickStation(screenX, screenY) {
    const world = this.world;
    if (!world?.layout) return null;
    const grid = this.screenToGrid(screenX, screenY);
    let best = null;
    let bestDistance = Infinity;
    for (const station of world.stations) {
      const slot = station.data.slot;
      const inflated = { x: slot.x - 1, y: slot.y - 1, w: slot.w + 2, h: slot.h + 2 };
      if (grid.x >= inflated.x && grid.x <= inflated.x + inflated.w && grid.y >= inflated.y && grid.y <= inflated.y + inflated.h) {
        const center = rectCenter(station.data.desk);
        const distance = Math.hypot(grid.x - center.x, grid.y - center.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = station;
        }
      }
    }
    return best;
  }
}

/* ------------------------------------------------------------------ *
 * 19. ASSET DETAIL PANEL — read only what the market exposes, "—" else
 * ------------------------------------------------------------------ */

export function marketDetailRows(market, office = null) {
  const m = market ?? {};
  const feature = m.featureState ?? null;
  const decision = m.decisionState ?? null;
  const position = m.positionState ?? null;
  const settlement = m.settlementState ?? null;
  const trader = m.agents?.trader ?? null;
  const critic = m.agents?.critic ?? null;
  const consensus = m.agents?.consensus ?? null;
  const jit = m.entryTiming ?? null;
  const daily = settlement?.daily ?? null;
  const quality = decision?.quality ?? null;
  const failedChecks = decision?.failedChecks ?? quality?.failedChecks;
  const microVeto = decision?.microVeto ?? (Array.isArray(critic?.riskFlags) && critic.riskFlags.some((flag) => /MICRO/i.test(String(flag))) ? "SIM (risk flag)" : null);
  const externalName = m.iqName ?? m.iqDisplayName ?? m.brokerName ?? m.iqDisplay ?? null;
  return [
    { section: "IDENTIFICAÇÃO" },
    { label: "Ativo", value: m.display ?? m.symbol ?? "—" },
    { label: "Market key", value: m.marketKey ?? "—" },
    { label: "Nome IQ", value: externalName ?? "—" },
    { label: "Tipo", value: m.marketType ?? "—" },
    { label: "Produto", value: Array.isArray(m.instrumentTypes) && m.instrumentTypes.length ? m.instrumentTypes.join(", ") : "—" },
    { label: "Active ID", value: m.activeId ?? "—" },
    { label: "Disponibilidade", value: m.availability ?? "—" },
    { label: "Payout", value: Number.isFinite(Number(m.payout)) ? `${formatNumber(m.payout, 0)}%` : "—" },
    { label: "Habilitado", value: m.enabled === true ? "SIM" : m.enabled === false ? "NÃO" : "—" },
    { section: "FEED" },
    { label: "Freshness", value: feature ? (feature.fresh === true ? "FRESH" : `STALE · ${feature.freshnessReason ?? "?"}`) : "—" },
    { label: "Candles 5s", value: Number.isFinite(Number(m.candles5s)) ? String(m.candles5s) : "—" },
    { label: "Último tick", value: Number.isFinite(Number(m.lastTick?.ageMs)) ? `${formatNumber(m.lastTick.ageMs, 0)} ms` : "—" },
    { section: "AGENTES" },
    { label: "Trader ação", value: trader?.action ?? "—" },
    { label: "Trader confiança", value: formatPercent(trader?.confidence, 0) },
    { label: "Trader regime", value: trader?.regime ?? "—" },
    { label: "Viés estrutural", value: trader?.bias ? formatList([trader.bias.channelBias, trader.bias.streakBias, trader.bias.position].filter((item) => item !== undefined && item !== null)) : "—" },
    { label: "Risco primário", value: trader?.primaryRisk ?? "—" },
    { label: "Evidência a favor", value: formatList(trader?.supporting) },
    { label: "Evidência contra", value: formatList(trader?.contradicting) },
    { label: "Critic veredito", value: critic?.verdict ?? "—" },
    { label: "Critic recomendação", value: critic?.finalRecommendation ?? "—" },
    { label: "Contradições", value: formatList(critic?.contradictions) },
    { label: "Risk flags", value: formatList(critic?.riskFlags) },
    { label: "Consenso", value: consensus ? `${consensus.action ?? "—"} · ${consensus.status ?? "—"}` : "—" },
    { label: "Consenso razão", value: consensus?.reason ?? "—" },
    { section: "DECISÃO" },
    { label: "Setup", value: decision?.setup ?? m.setup ?? "—" },
    { label: "Regime", value: decision?.regime ?? m.regime ?? "—" },
    { label: "Gatilho", value: decision?.trigger ?? "—" },
    { label: "Entry location", value: decision?.entryLocation ?? decision?.location ?? m.lastDecision?.entryLocation ?? "—" },
    { label: "Micro veto", value: microVeto ?? "—" },
    { label: "Quality score", value: formatNumber(decision?.qualityScore ?? quality?.score, 2) },
    { label: "Failed checks", value: formatList(failedChecks) },
    { section: "INDICADORES" },
    { label: "RSI14", value: formatNumber(feature?.rsi14, 2) },
    { label: "ADX14", value: formatNumber(feature?.adx14, 2) },
    { label: "+DI", value: formatNumber(feature?.plusDi14 ?? feature?.plusDi, 2) },
    { label: "-DI", value: formatNumber(feature?.minusDi14 ?? feature?.minusDi, 2) },
    { label: "ATR14", value: formatNumber(feature?.atr14, 5) },
    { label: "Donchian", value: formatNumber(feature?.donchianPosition, 3) },
    { label: "Micro streak", value: Number.isFinite(Number(feature?.microstructureStreak)) ? String(feature.microstructureStreak) : "—" },
    { section: "JIT / ENTRADA" },
    { label: "Estágio", value: jit?.stage ?? "—" },
    { label: "Revalidação", value: Number.isFinite(Number(jit?.secondsToRevalidation)) ? `${jit.secondsToRevalidation}s` : "—" },
    { label: "Entrada em", value: Number.isFinite(Number(jit?.secondsToEntry)) ? `${jit.secondsToEntry}s` : "—" },
    { label: "Drift na janela", value: typeof jit?.candidateChangedBeforeEntry === "boolean" ? (jit.candidateChangedBeforeEntry ? "SIM" : "NÃO") : "—" },
    { section: "EXECUÇÃO / RESULTADO" },
    { label: "Posição", value: position?.status ?? "—" },
    { label: "Direção", value: position?.direction ?? "—" },
    { label: "Stake", value: formatBRL(position?.stake) },
    { label: "Última execução", value: m.lastTrade ? `${m.lastTrade.direction ?? "—"} · ${m.lastTrade.result ?? "ABERTA"} · ${formatBRL(m.lastTrade.profit)}` : "—" },
    { label: "Último resultado", value: settlement?.lastResult ?? "—" },
    { label: "P&L do dia", value: formatBRL(settlement?.daily?.settledPnl ?? settlement?.lastProfit) },
    { label: "Sinais (stats)", value: m.stats ? `${m.stats.messages ?? 0} msgs · ${m.stats.candlesProcessed ?? 0} candles` : "—" },
    { label: "Journal do dia", value: daily ? `${daily.trades ?? 0} trades · ${daily.wins ?? 0}W/${daily.losses ?? 0}L/${daily.draws ?? 0}D` : (office?.journal ? `${office.journal.trades ?? 0} trades / ${office.journal.decisions ?? 0} decisões` : "—") },
  ];
}

export class AssetDetailPanel {
  constructor(root = null) {
    this.el = null;
    if (typeof document === "undefined") return;
    this.el = typeof root === "string" ? document.querySelector(root) : root;
    if (!this.el) {
      this.el = document.createElement("aside");
      this.el.className = "office-v2-panel";
      this.el.id = "officeV2Panel";
      document.body.appendChild(this.el);
    }
    this.el.hidden = true;
    this.el.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-office-v2-close]")) this.hide();
    });
  }

  show(market, office) {
    if (!this.el) return;
    if (!market) {
      this.hide();
      return;
    }
    const rows = marketDetailRows(market, office);
    const parts = [
      `<header><div><span class="v2-panel-kicker">DETALHE DO POSTO</span><h2>${escapeHtml(market.display ?? market.symbol ?? market.marketKey ?? "—")}</h2><small>${escapeHtml(market.marketKey ?? "—")}</small></div><button type="button" data-office-v2-close>FECHAR</button></header>`,
      "<div class=\"v2-panel-body\">",
    ];
    for (const row of rows) {
      if (row.section) parts.push(`<h3>${escapeHtml(row.section)}</h3>`);
      else parts.push(`<div class="v2-row"><span>${escapeHtml(row.label)}</span><b>${escapeHtml(row.value)}</b></div>`);
    }
    parts.push("</div>");
    this.el.innerHTML = parts.join("");
    this.el.hidden = false;
  }

  hide() {
    if (!this.el) return;
    this.el.hidden = true;
  }
}

function escapeHtml(value) {
  return String(value ?? "—").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

/* ------------------------------------------------------------------ *
 * 20. BOOT — wiring, polling, camera controls, fixture support
 * ------------------------------------------------------------------ */

export function bootOfficeV2(options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const canvas = typeof options.canvas === "string" ? document.querySelector(options.canvas) : options.canvas;
  if (!canvas) throw new Error("OFFICE_V2_CANVAS_NOT_FOUND");
  const world = new OfficeWorld(null);
  const bridge = new MarketOfficeBridge();
  bridge.world = world;
  const renderer = new OfficeRenderer(canvas, options);
  renderer.attach(world);
  const panel = new AssetDetailPanel(options.panel ?? "#officeV2Panel");
  const statusEl = typeof options.status === "string" ? document.querySelector(options.status) : options.status ?? document.querySelector("#officeV2Status");
  const chipsEl = typeof options.chips === "string" ? document.querySelector(options.chips) : options.chips ?? document.querySelector("#v2Chips");
  let selectedKey = null;
  let dragState = null;
  let lastOffice = null;

  const setStatus = (text, tone = "info") => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  };

  const renderChips = (office) => {
    if (!chipsEl) return;
    const model = pnlIndicatorModel(office);
    const connection = office?.connection ?? {};
    const chips = [
      ["MODO", model.mode, model.practice ? "ok" : "bad"],
      ["CONEXÃO", connection.connected === true ? "ONLINE" : "OFFLINE", connection.connected === true ? "ok" : "bad"],
      ["ABERTOS", `${model.openMarkets}/${office?.markets?.length ?? 0}`, "info"],
      ["RESULTADO DO DIA", model.text, model.tone === "POSITIVE" ? "ok" : model.tone === "NEGATIVE" ? "bad" : "info"],
    ];
    chipsEl.innerHTML = chips.map(([label, value, tone]) => `<span class="v2-chip ${tone}"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("");
  };

  const applyOffice = (office) => {
    if (!office || typeof office !== "object") {
      setStatus("SEM DADOS DO ESCRITÓRIO — exibindo sala vazia", "warn");
      return;
    }
    lastOffice = office;
    bridge.apply(office);
    renderer.markDirty();
    renderChips(office);
    setStatus(`ATUALIZADO ${new Date(office.at ?? Date.now()).toLocaleTimeString("pt-BR")} · ${office.markets?.length ?? 0} mercados`, "ok");
    if (selectedKey) {
      const market = world.marketByKey.get(selectedKey) ?? world.stationByKey.get(selectedKey)?.market ?? null;
      panel.show(market, office);
    }
  };

  const focusStation = (station, { openPanel = true } = {}) => {
    if (!station) return;
    selectedKey = station.marketKey;
    renderer.selectedMarketKey = station.marketKey;
    const center = rectCenter(station.data.desk);
    const point = isoProject(center.x, center.y);
    renderer.camera.zoomAt({ x: renderer.viewport.width / 2, y: renderer.viewport.height / 2 }, Math.max(renderer.camera.zoom, 2));
    renderer.camera.centerOn(point);
    if (openPanel) panel.show(station.market, lastOffice);
  };

  const fit = () => {
    if (world.layout) renderer.camera.fit(world.layout.bounds);
  };

  const center = () => {
    if (!world.layout) return;
    const hall = world.layout.hall;
    renderer.camera.centerOn(isoProject(hall.x + hall.w / 2, hall.y + hall.h / 2));
  };

  const zoomBy = (factor) => {
    renderer.camera.zoomAt({ x: renderer.viewport.width / 2, y: renderer.viewport.height / 2 }, renderer.camera.zoom * factor, world.layout?.bounds ?? null);
  };

  const bindButton = (selector, handler) => {
    const element = document.querySelector(selector);
    if (element) element.addEventListener("click", handler);
  };
  bindButton("#v2Fit", fit);
  bindButton("#v2Center", center);
  bindButton("#v2Focus", () => focusStation(world.stationByKey.get(selectedKey)));
  bindButton("#v2ZoomIn", () => zoomBy(2));
  bindButton("#v2ZoomOut", () => zoomBy(0.5));

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    dragState = { x: event.clientX, y: event.clientY, moved: false };
  });
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    if (dragState) {
      const dx = event.clientX - dragState.x;
      const dy = event.clientY - dragState.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
      renderer.camera.panBy(dx, dy).clampTo(world.layout?.bounds ?? null);
      dragState.x = event.clientX;
      dragState.y = event.clientY;
    } else {
      const station = renderer.pickStation(event.clientX - rect.left, event.clientY - rect.top);
      renderer.hoverMarketKey = station?.marketKey ?? null;
      canvas.style.cursor = station ? "pointer" : "grab";
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    const wasDrag = dragState?.moved === true;
    dragState = null;
    if (wasDrag) return;
    const rect = canvas.getBoundingClientRect();
    const station = renderer.pickStation(event.clientX - rect.left, event.clientY - rect.top);
    if (station) focusStation(station);
    else {
      selectedKey = null;
      renderer.selectedMarketKey = null;
      panel.hide();
    }
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = event.deltaY < 0 ? 2 : 0.5;
    renderer.camera.zoomAt(anchor, renderer.camera.zoom * factor, world.layout?.bounds ?? null);
  }, { passive: false });

  window.addEventListener("resize", () => {
    renderer.resize();
    renderer.camera.clampTo(world.layout?.bounds ?? null);
  });
  window.addEventListener("office-v2:update", (event) => applyOffice(event.detail));

  const fixture = options.fixture === true || (typeof globalThis !== "undefined" && globalThis.__OFFICE_V2_FIXTURE__)
    ? globalThis.__OFFICE_V2_FIXTURE__
    : null;
  if (fixture && fixture.office) {
    applyOffice(fixture.office);
    setStatus("FIXTURE ATIVO — nenhum backend tocado", "warn");
  } else if (options.noPoll !== true) {
    const pollUrl = options.pollUrl ?? "/api/iq/office";
    const intervalMs = Math.max(2000, Number(options.pollIntervalMs) || 9000);
    let failures = 0;
    const poll = async () => {
      try {
        const response = await fetch(pollUrl, { headers: { accept: "application/json" }, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const office = await response.json();
        failures = 0;
        applyOffice(office);
      } catch (error) {
        failures += 1;
        setStatus(`SEM DADOS DO RELAY (${failures}) — ${String(error?.message ?? error)}`, "bad");
      }
      if (options.noPoll !== true) window.setTimeout(poll, intervalMs);
    };
    void poll();
  }

  renderer.start();

  const instance = {
    world,
    bridge,
    renderer,
    camera: renderer.camera,
    panel,
    applyOffice,
    focusStation,
    fit,
    center,
    zoomBy,
    downloadPng(filename = "office-v2.png") {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = filename;
        link.click();
        return dataUrl;
      } catch (error) {
        setStatus(`FALHA AO EXPORTAR PNG — ${String(error?.message ?? error)}`, "bad");
        return null;
      }
    },
    destroy() {
      renderer.stop();
    },
  };
  window.__OFFICE_V2_APP__ = instance;
  return instance;
}

