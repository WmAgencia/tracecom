/**
 * TRACE/COM — PIXEL OFFICE V3 · DYNAMIC OVERLAY (hybrid)
 *
 * Draws ONLY the dynamic layers on top of the frozen blueprint base:
 *   - seated Trader + Critic agents for WORKING stations (broker OPEN +
 *     enabled + feed fresh), aligned to each station's blueprint position;
 *   - floating P&L badges (text only, green/red/neutral) only when the shared
 *     derived state carries a real settled event;
 *   - a treatment for every non-WORKING station (translucent scrim + the
 *     derived short label: FECHADO / SUSPENSO / DESABILITADO / FEED OFFLINE)
 *     because the base image always shows agents;
 *   - hover highlight;
 *   - the supervisor.
 *
 * The desk state comes from `station.derived` (state-model.js) whenever
 * attached; `station.active` is only a legacy fallback for isolated renders.
 *
 * It MUST NOT redraw the static scene (floor, walls, desks, panels, base
 * agents). The base image owns the static pixels.
 *
 * COORDINATE NOTE: STATION_ANCHORS are MEASURED from the frozen reference
 * itself (`docs/office-v2/screenshots/reference.png`, 1536×1024) with a small
 * headless scan (`docs/office-v3/blueprint-base.md` has the raw numbers). The
 * painted desks do NOT follow the old blueprint estimate (124px pitch ending at
 * x≈1378): the real 10-column bands use x0≈261 / pitch≈113, and the split bands
 * (OTC|CRIPTO, ÍNDICES|COMMODITIES) are two 5-desk sectors with their own
 * origins. Anchors land on the reference's OWN desks, independent of world.js's
 * CONTENT_X layout. No resize/crop/blur of the reference is involved.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders, no stake.
 */

export const OVERLAY_VERSION = "office-v3-overlay.2.0.0";

/* ------------------------------------------------------------------ *
 * 1. BLUEPRINT GEOMETRY (calibrated to the reference image)
 * ------------------------------------------------------------------ */

/**
 * Per-band desk geometry, data-driven as `{ y, sectors: [{ x0, pitch, count }] }`.
 * `y` = top of the desk cell (badge baseline sits at y-14, seat line at y+25).
 * Measured desk front: ~82–85px wide, ~26px tall; the anchor rect uses 100×52
 * to cover the painted desk + top surface. The expanded OTC band (5 markets that
 * do not fit the 50 painted desks) stays at y=1072 from the v2 expanded world.
 */
export const ANCHOR_BANDS = Object.freeze([
  { band: "FOREX MAJORS", y: 392, h: 52, accent: "blue", expanded: false,
    sectors: Object.freeze([{ x0: 261, pitch: 113, count: 10 }]) },
  { band: "FOREX CRUZADOS", y: 502, h: 52, accent: "blue", expanded: false,
    sectors: Object.freeze([{ x0: 261, pitch: 113, count: 10 }]) },
  { band: "OTC + CRIPTO", y: 616, h: 52, accent: "split", expanded: false,
    sectors: Object.freeze([{ x0: 258, pitch: 114, count: 5 }, { x0: 847, pitch: 110, count: 5 }]) },
  { band: "ÍNDICES + COMMODITIES", y: 731, h: 52, accent: "split", expanded: false,
    sectors: Object.freeze([{ x0: 249, pitch: 114, count: 5 }, { x0: 846, pitch: 113, count: 5 }]) },
  { band: "OUTROS ATIVOS", y: 839, h: 52, accent: "blue", expanded: false,
    sectors: Object.freeze([{ x0: 254, pitch: 114, count: 10 }]) },
  { band: "OTC EXTRA", y: 1072, h: 52, accent: "blue", expanded: true,
    sectors: Object.freeze([{ x0: 261, pitch: 113, count: 5 }]) },
]);

/** 10 column centers of the first full-width band (x0=261, pitch=113). */
export const ANCHOR_COLUMNS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => Math.round(ANCHOR_BANDS[0].sectors[0].x0 + index * ANCHOR_BANDS[0].sectors[0].pitch)),
);

/** Band descriptors (compat view of ANCHOR_BANDS). */
export const ANCHOR_ROWS = Object.freeze(
  ANCHOR_BANDS.map((band) => Object.freeze({ y: band.y, h: band.h, band: band.band, accent: band.accent, expanded: band.expanded })),
);

const DESK_WIDTH = 100;
const SEAT_LINE = 30;
const AGENT_SPLIT = 20;

/**
 * Canonical 55-desk order aligned to the PAINTED blueprint labels (see
 * docs/office-v3/blueprint-base.md). Position = index → row/column on the
 * grid; every market of the reconciled relay universe is placed on the desk
 * whose painted label matches its instrument whenever one exists:
 *   band 1 majors, band 2 crosses, band 3 OTC-24H + BTC, band 4 indices +
 *   commodities, band 5 leftovers, band 6 expanded (off-artboard).
 * `USDCHF:NORMAL` (removed from the live universe) keeps the last expanded
 * slot as a reserve; unknown keys are assigned by `createAnchorResolver`.
 */
export const ANCHOR_MARKETS = Object.freeze([
  ["EURUSD:NORMAL", "EUR/USD"], ["GBPUSD:NORMAL", "GBP/USD"], ["USDJPY:NORMAL", "USD/JPY"],
  ["AUDUSD:NORMAL", "AUD/USD"], ["USDCAD:NORMAL", "USD/CAD"], ["USDCHF:OTC", "USD/CHF OTC"],
  ["NZDCAD:OTC", "NZD/CAD OTC"], ["EURGBP:NORMAL", "EUR/GBP"], ["EURJPY:NORMAL", "EUR/JPY"],
  ["GBPJPY:NORMAL", "GBP/JPY"],
  ["AUDJPY:NORMAL", "AUD/JPY"], ["AUDCAD:OTC", "AUD/CAD OTC"], ["AUDCHF:OTC", "AUD/CHF OTC"],
  ["CADJPY:OTC", "CAD/JPY OTC"], ["CADCHF:OTC", "CAD/CHF OTC"], ["EURCAD:OTC", "EUR/CAD OTC"],
  ["EURCHF:OTC", "EUR/CHF OTC"], ["EURAUD:OTC", "EUR/AUD OTC"], ["GBPAUD:OTC", "GBP/AUD OTC"],
  ["GBPCHF:OTC", "GBP/CHF OTC"],
  ["EURUSD:OTC", "EUR/USD OTC"], ["GBPUSD:OTC", "GBP/USD OTC"], ["USDJPY:OTC", "USD/JPY OTC"],
  ["EURGBP:OTC", "EUR/GBP OTC"], ["GBPJPY:OTC", "GBP/JPY OTC"], ["BTCUSD:OTC", "BTC/USD OTC"],
  ["AUDUSD:OTC", "AUD/USD OTC"], ["USDCAD:OTC", "USD/CAD OTC"], ["EURJPY:OTC", "EUR/JPY OTC"],
  ["AUDJPY:OTC", "AUD/JPY OTC"],
  ["US500:NORMAL", "US500"], ["US100:NORMAL", "US100"], ["US30:NORMAL", "US30"],
  ["GER30:NORMAL", "GER30"], ["UK100:NORMAL", "UK100"],
  ["XAUUSD:NORMAL", "GOLD"], ["XAGUSD:NORMAL", "SILVER"], ["US2000:NORMAL", "US2000"],
  ["JP225:NORMAL", "JP225"], ["AUS200:NORMAL", "AUS200"],
  ["EU50:NORMAL", "EU50"], ["HK33:NORMAL", "HK33"], ["FR40:NORMAL", "FR40"],
  ["SP35:NORMAL", "SP35"], ["EURNZD:OTC", "EUR/NZD OTC"], ["AUDNZD:OTC", "AUD/NZD OTC"],
  ["GBPCAD:OTC", "GBP/CAD OTC"], ["GBPNZD:OTC", "GBP/NZD OTC"], ["NZDJPY:OTC", "NZD/JPY OTC"],
  ["NZDCHF:OTC", "NZD/CHF OTC"], ["USDMXN:OTC", "USD/MXN OTC"], ["USDBRL:OTC", "USD/BRL OTC"],
  ["USDTRY:OTC", "USD/TRY OTC"], ["USDZAR:OTC", "USD/ZAR OTC"], ["USDCHF:NORMAL", "USD/CHF"],
]);

/**
 * Flattens the per-band sectors into 55 desk slots (10+10+5+5+5+5+10+5). The
 * split bands contribute two 5-desk sectors with independent origins.
 */
export function buildDeskSlots() {
  const slots = [];
  ANCHOR_BANDS.forEach((band, row) => {
    let col = 0;
    for (const sector of band.sectors) {
      for (let index = 0; index < sector.count; index += 1) {
        slots.push(Object.freeze({
          x: Math.round(sector.x0 + index * sector.pitch),
          y: band.y,
          w: DESK_WIDTH,
          h: band.h,
          col,
          row,
          band: band.band,
          accent: band.accent,
          expanded: band.expanded === true,
        }));
        col += 1;
      }
    }
  });
  return slots;
}

const DESK_SLOTS = buildDeskSlots();

function buildAnchors() {
  const anchors = {};
  ANCHOR_MARKETS.forEach(([marketKey, display], index) => {
    const slot = DESK_SLOTS[index];
    if (!slot) return;
    const { x, y, w, h } = slot;
    anchors[marketKey] = Object.freeze({
      marketKey,
      display,
      x,
      y,
      w,
      h,
      col: slot.col,
      row: slot.row,
      band: slot.band,
      accent: slot.accent,
      expanded: slot.expanded,
      desk: Object.freeze({ x: x - Math.round(w / 2), y, w, h }),
      seatY: y + SEAT_LINE,
      traderX: x - AGENT_SPLIT,
      criticX: x + AGENT_SPLIT,
      badgeY: y - 14,
    });
  });
  return Object.freeze(anchors);
}

/**
 * Per-marketKey blueprint {x,y} anchor. Calibrated to the blueprint so the
 * overlays land on the reference's own desks.
 */
export const STATION_ANCHORS = buildAnchors();

export function normalizeMarketToken(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const ANCHORS_BY_DISPLAY = Object.freeze(
  Object.fromEntries(Object.values(STATION_ANCHORS).map((anchor) => [anchor.display, anchor])),
);
const ANCHORS_BY_NORMALIZED = Object.freeze(
  Object.fromEntries(Object.values(STATION_ANCHORS).map((anchor) => [normalizeMarketToken(anchor.display), anchor])),
);

/**
 * Resolve the blueprint anchor for a market/station. Tries marketKey, then
 * display/symbol (exact + normalized), then a deterministic index fallback.
 */
export function anchorForMarket(market, index) {
  const key = typeof market === "string" ? market : market?.marketKey;
  if (key && STATION_ANCHORS[key]) return STATION_ANCHORS[key];
  const display = typeof market === "string"
    ? market
    : (market?.display ?? market?.symbol ?? market?.canonical);
  if (display) {
    if (ANCHORS_BY_DISPLAY[display]) return ANCHORS_BY_DISPLAY[display];
    const normalized = ANCHORS_BY_NORMALIZED[normalizeMarketToken(display)];
    if (normalized) return normalized;
  }
  if (Number.isInteger(index)) {
    const values = Object.values(STATION_ANCHORS);
    return values[index % values.length] ?? null;
  }
  return null;
}

export function anchorForStation(station, index) {
  return anchorForMarket(station, index);
}

/**
 * Deterministic, collision-free anchor assignment for a concrete station list.
 *
 * `anchorForMarket` is a PREFERENCE resolution (marketKey → display → index
 * fallback). When a snapshot carries a market the calibrated table does not
 * know (offline demo fixture, future universe entry), the index fallback can
 * land on an anchor already used by another station: two desks would draw the
 * same agents and the click hitbox would open the wrong market. The resolver
 * keeps the preferred anchor when free and otherwise hands out the first free
 * slot in a stable order, so base, overlay and hitboxes always agree.
 */
export function createAnchorResolver(stations) {
  const list = Array.isArray(stations) ? stations.filter((station) => station && typeof station === "object") : [];
  const allAnchors = Object.values(STATION_ANCHORS);
  const claimed = new Set();
  const byStation = new Map();
  const byKey = new Map();
  for (let index = 0; index < list.length; index += 1) {
    const station = list[index];
    const preferred = anchorForMarket(station, index);
    let anchor = preferred && !claimed.has(preferred.marketKey)
      ? preferred
      : allAnchors.find((candidate) => !claimed.has(candidate.marketKey)) ?? null;
    if (anchor) claimed.add(anchor.marketKey);
    byStation.set(station, anchor);
    const key = station.marketKey ?? station.id ?? null;
    if (key) byKey.set(key, anchor);
  }
  return {
    /** Anchor assigned to this exact station object/key (falls back to preference). */
    anchorFor(station, index) {
      if (byStation.has(station)) return byStation.get(station);
      const key = station?.marketKey ?? station?.id ?? null;
      if (key && byKey.has(key)) return byKey.get(key);
      return anchorForMarket(station, index);
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. CLOSED / HOVER TREATMENTS
 * ------------------------------------------------------------------ */

const CLOSED_LABELS = Object.freeze({
  CLOSED: "FECHADO",
  SUSPENDED: "SUSPENSO",
  PAUSED: "SUSPENSO",
  DISABLED: "INDISPONÍVEL",
  NOT_OFFERED: "INDISPONÍVEL",
  NOT_FOUND: "INDISPONÍVEL",
  UNAVAILABLE: "INDISPONÍVEL",
  UNKNOWN: "INDISPONÍVEL",
});

export function closedLabel(availability) {
  const token = String(availability ?? "").toUpperCase();
  return CLOSED_LABELS[token] ?? "FECHADO";
}

/**
 * Scrim + tag over a non-OPEN desk. The base image cannot remove its painted
 * agents, so we dim the desk and label its real state instead.
 */
export function drawClosedTreatment(ctx, station, options = {}) {
  const anchor = options.anchor ?? anchorForStation(station, station?.index);
  if (!ctx || !anchor) return null;
  const label = options.label ?? closedLabel(station?.availability);
  const rect = anchor.desk;
  const pad = 6;

  ctx.save();
  ctx.fillStyle = options.scrim ?? "rgba(5,9,15,0.58)";
  ctx.fillRect(rect.x, rect.y - pad, rect.w, rect.h + pad);
  ctx.strokeStyle = "rgba(224,75,58,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y - pad + 0.5, rect.w - 1, rect.h + pad - 1);

  const tagW = Math.max(58, label.length * 7 + 10);
  const tagH = 15;
  const tagX = anchor.x - tagW / 2;
  const tagY = anchor.y + rect.h / 2 - tagH / 2;
  ctx.fillStyle = "rgba(5,9,15,0.86)";
  ctx.fillRect(tagX, tagY, tagW, tagH);
  ctx.strokeStyle = "rgba(224,75,58,0.95)";
  ctx.strokeRect(tagX + 0.5, tagY + 0.5, tagW - 1, tagH - 1);
  if (typeof ctx.fillText === "function") {
    ctx.fillStyle = "#ffd9d4";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, anchor.x, tagY + tagH / 2 + 0.5);
  }
  ctx.restore();
  return { anchor, rect, label, availability: station?.availability ?? null };
}

/** Gold outline around a hovered desk. */
export function drawHoverHighlight(ctx, station, options = {}) {
  const anchor = options.anchor ?? anchorForStation(station, station?.index);
  if (!ctx || !anchor) return null;
  const rect = anchor.desk;
  const pad = 3;
  ctx.save();
  ctx.fillStyle = options.fill ?? "rgba(201,162,75,0.12)";
  ctx.fillRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);
  ctx.strokeStyle = options.stroke ?? "#e8c877";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x - pad + 0.5, rect.y - pad + 0.5, rect.w + pad * 2 - 1, rect.h + pad * 2 - 1);
  ctx.restore();
  return rect;
}

/* ------------------------------------------------------------------ *
 * 3. DYNAMIC OVERLAY
 * ------------------------------------------------------------------ */

export const SUPERVISOR_ANCHOR = Object.freeze({ x: 882, y: 560 });

function fallbackSeated(ctx, role, x, y) {
  if (!ctx || typeof ctx.fillRect !== "function") return;
  const colors = { trader: "#ff9f6b", critic: "#7fd4ff", supervisor: "#ffd166" };
  ctx.fillStyle = colors[role] ?? "#ff9f6b";
  ctx.fillRect(x - 4, y - 12, 8, 12);
  ctx.fillStyle = "#2b2b3a";
  ctx.fillRect(x - 4, y - 3, 8, 3);
}

function drawSeatedPair(ctx, station, anchor, options) {
  const drawCharacter = options.drawCharacter;
  const entities = [
    { role: "trader", entity: station.trader ?? { role: "trader", seed: station.index }, x: anchor.traderX },
    { role: "critic", entity: station.critic ?? { role: "critic", seed: station.index }, x: anchor.criticX },
  ];
  for (const item of entities) {
    const pose = item.entity.pose ?? "work";
    const characterOptions = {
      role: item.role,
      frame: Number(options.frame) || 0,
      facing: 1,
      seed: item.entity.seed ?? station.index ?? 0,
      id: `${station.id ?? station.marketKey ?? station.index}:${item.role}`,
      scale: Number(options.scale) || 1,
    };
    if (typeof drawCharacter === "function") drawCharacter(ctx, pose, item.x, anchor.seatY, characterOptions);
    else fallbackSeated(ctx, item.role, item.x, anchor.seatY);
  }
}

function drawPnlBadge(ctx, station, anchor, options) {
  const badge = options.badge !== undefined ? options.badge : station?.badge;
  if (!ctx || !badge || !badge.visible) return false;
  ctx.save();
  if (typeof ctx.fillText === "function") {
    ctx.font = `${Number(options.badgeFontSize) || 11}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(5,9,15,0.9)";
    ctx.strokeText(badge.text, anchor.x, anchor.badgeY);
    ctx.fillStyle = badge.color ?? "#ffffff";
    ctx.fillText(badge.text, anchor.x, anchor.badgeY);
  }
  ctx.restore();
  return true;
}

function drawSupervisor(ctx, life, options) {
  const anchor = options.supervisorAnchor ?? SUPERVISOR_ANCHOR;
  const supervisor = life?.supervisor ?? null;
  const phase = supervisor ? Math.sin((Number(life.time) || 0) / 900) * 60 : 0;
  const x = anchor.x + phase;
  const y = anchor.y;
  const drawCharacter = options.drawCharacter;
  if (typeof drawCharacter === "function") {
    drawCharacter(ctx, supervisor?.pose ?? "walk", x, y, {
      role: "supervisor",
      frame: supervisor?.frame ?? 0,
      facing: phase >= 0 ? 1 : -1,
      seed: 99,
      id: "supervisor",
      scale: Number(options.scale) || 1,
    });
  } else {
    fallbackSeated(ctx, "supervisor", x, y);
  }
  return { x, y };
}

function matchesHover(station, key) {
  if (!station || key == null) return false;
  return station.marketKey === key || station.id === key;
}

/**
 * Blueprint-space hit test over the calibrated anchors. Returns the station
 * whose painted desk rect contains `(x, y)`, or null. Used by the page for
 * hover/click in hybrid mode (the procedural `world.hitTestStation` works in
 * world space, not blueprint space).
 */
export function hitTestAnchor(worldState, x, y) {
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const stations = Array.isArray(worldState?.stations) ? worldState.stations : [];
  const resolver = createAnchorResolver(stations);
  for (let index = 0; index < stations.length; index += 1) {
    const anchor = resolver.anchorFor(stations[index], index);
    if (!anchor) continue;
    const rect = anchor.desk;
    if (nx >= rect.x && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h) return stations[index];
  }
  return null;
}

/**
 * Draws the dynamic layers only. `life` may be null (only the supervisor is
 * skipped/degraded); `camera` is accepted for API compatibility but the base is
 * fixed at 1:1, so the overlay draws in blueprint space.
 *
 * @returns {{stations:number,open:number,closed:number,agents:number,badges:number,supervisor:number,hover:boolean}}
 */
export function drawDynamicOverlay(ctx, worldState, life = null, camera = null, options = {}) {
  const stats = { stations: 0, open: 0, closed: 0, agents: 0, badges: 0, supervisor: 0, hover: false, feedOffline: 0 };
  if (!ctx || !worldState) return stats;

  const stations = Array.isArray(worldState.stations) ? worldState.stations : [];
  stats.stations = stations.length;
  const resolveAnchor = typeof options.anchorFor === "function"
    ? options.anchorFor
    : createAnchorResolver(stations).anchorFor;
  const hoverKey = options.hoverMarketKey ?? options.hoverStationId ?? null;

  stations.forEach((station, index) => {
    const anchor = resolveAnchor(station, index);
    if (!anchor) return;
    const hovered = matchesHover(station, hoverKey);
    const derived = station.derived ?? null;
    const working = derived ? derived.agentsWorking === true : station.active === true;
    if (working) {
      stats.open += 1;
      drawSeatedPair(ctx, station, anchor, options);
      stats.agents += 2;
      if (drawPnlBadge(ctx, station, anchor, derived ? { ...options, badge: derived.badge } : options)) stats.badges += 1;
    } else {
      stats.closed += 1;
      if (derived && derived.state === "OPEN_BUT_FEED_OFFLINE") stats.feedOffline += 1;
      drawClosedTreatment(ctx, station, {
        anchor,
        label: derived?.shortLabel,
        title: derived?.label,
      });
    }
    if (hovered) {
      drawHoverHighlight(ctx, station, { anchor });
      stats.hover = true;
    }
  });

  if (options.drawSupervisor !== false && life) {
    drawSupervisor(ctx, life, options);
    stats.supervisor = 1;
  }
  return stats;
}

export default {
  OVERLAY_VERSION,
  STATION_ANCHORS,
  ANCHOR_BANDS,
  ANCHOR_COLUMNS,
  ANCHOR_ROWS,
  ANCHOR_MARKETS,
  SUPERVISOR_ANCHOR,
  buildDeskSlots,
  anchorForMarket,
  anchorForStation,
  createAnchorResolver,
  hitTestAnchor,
  closedLabel,
  drawClosedTreatment,
  drawHoverHighlight,
  drawDynamicOverlay,
};
