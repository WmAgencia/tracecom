/**
 * TRACE/COM — PIXEL OFFICE V3 · SINGLE DERIVED MARKET STATE
 *
 * ONE explicit derivation shared by ALL consumers (desk/overlay, MESAS popup,
 * right technical panel, agents/life presence and result badges). It traces
 * every source instead of hiding fields:
 *   broker availability (market.availability)
 *   market enabled      (market.enabled / market.paused)
 *   feed status         (featureState.fresh, lastTick.ageMs, candles5s,
 *                        connectionHealth.connected, office.connection,
 *                        market.agentState)
 *   agent status        (raw market.agentState — carried through, never used
 *                        alone to claim the desk is working)
 *   real settled events (settlementState.lastResult/lastProfit, lastTrade)
 *
 * Explicit states:
 *   WORKING                 broker OPEN + enabled + feed valid/fresh → agents
 *                           sit at the desk and analyze.
 *   OPEN_BUT_FEED_OFFLINE   broker OPEN but feed missing/stale/offline →
 *                           label exactly "MERCADO ABERTO · FEED OFFLINE" and
 *                           agents DO NOT work (no false "analyzing").
 *   CLOSED / SUSPENDED / DISABLED / NOT_OFFERED / UNKNOWN → desk empty,
 *                           agents social/idle.
 *
 * Broker OPEN alone NEVER means the agent is working.
 *
 * Frontend/rendering only. PRACTICE only. ZERO REAL. No orders.
 */

export const STATE_MODEL_VERSION = "office-v3-state-model.1.0.0";

export const MARKET_STATES = Object.freeze({
  WORKING: "WORKING",
  OPEN_BUT_FEED_OFFLINE: "OPEN_BUT_FEED_OFFLINE",
  CLOSED: "CLOSED",
  SUSPENDED: "SUSPENDED",
  DISABLED: "DISABLED",
  NOT_OFFERED: "NOT_OFFERED",
  UNKNOWN: "UNKNOWN",
});

export const FEED_STATUS = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  OFFLINE: "OFFLINE",
  MISSING: "MISSING",
  UNKNOWN: "UNKNOWN",
});

export const DESK_STATES = Object.freeze({ WORKING: "WORKING", EMPTY: "EMPTY" });

/** Same 15s window used by relay/market runtime for a valid 5s tick. */
export const FRESH_TICK_MAX_AGE_MS = 15_000;

const BADGE_COLORS = Object.freeze({
  POSITIVE: "#3fbf5f",
  NEGATIVE: "#e04b3a",
  ZERO: "#8d99b5",
});

const OPEN_TOKEN = "OPEN";
const CLOSED_TOKEN = "CLOSED";
const SUSPENDED_TOKENS = new Set(["SUSPENDED", "PAUSED"]);
const DISABLED_TOKENS = new Set(["DISABLED"]);
const NOT_OFFERED_TOKENS = new Set(["NOT_OFFERED", "NOT_FOUND", "UNAVAILABLE"]);
const REAL_EVENTS = new Set(["WIN", "LOSS", "DRAW"]);

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

/** Normalizes the broker availability token into the state-model vocabulary. */
export function normalizeAvailability(value) {
  const token = upper(value);
  if (!token) return null;
  if (token === OPEN_TOKEN) return OPEN_TOKEN;
  if (token === CLOSED_TOKEN) return CLOSED_TOKEN;
  if (SUSPENDED_TOKENS.has(token)) return "SUSPENDED";
  if (DISABLED_TOKENS.has(token)) return "DISABLED";
  if (NOT_OFFERED_TOKENS.has(token)) return "NOT_OFFERED";
  return "UNKNOWN";
}

function normalizeFeedStatus(value) {
  const token = upper(value);
  if (!token) return null;
  if (token === "FRESH" || token === "OK" || token === "ONLINE") return FEED_STATUS.FRESH;
  if (token === "STALE" || token === "LAGGING") return FEED_STATUS.STALE;
  if (token === "OFFLINE" || token === "DISCONNECTED") return FEED_STATUS.OFFLINE;
  if (token === "MISSING" || token === "NO_FEED" || token === "EMPTY") return FEED_STATUS.MISSING;
  if (token === "UNKNOWN") return FEED_STATUS.UNKNOWN;
  return null;
}

function feedResult(status, options = {}) {
  return {
    feedStatus: status,
    freshness: status,
    fresh: status === FEED_STATUS.FRESH,
    tickAgeMs: options.tickAgeMs ?? null,
    candles5s: options.candles5s ?? null,
    reason: options.reason ?? null,
    source: options.source ?? "MARKET",
  };
}

/**
 * Resolves the feed/freshness for one market. An explicit `feed` argument
 * wins over market fields; otherwise every real source is traced.
 *
 * @returns {{feedStatus:string,freshness:string,fresh:boolean,tickAgeMs:number|null,candles5s:number|null,reason:string|null,source:string}}
 */
export function resolveMarketFeed(market, feed = null, connection = null) {
  const m = market && typeof market === "object" ? market : {};

  if (feed && typeof feed === "object") {
    const status = normalizeFeedStatus(feed.feedStatus ?? feed.status ?? feed.freshness);
    const freshFlag = typeof feed.fresh === "boolean" ? feed.fresh : null;
    const ageMs = finiteNumber(feed.tickAgeMs ?? feed.ageMs);
    const candles = finiteNumber(feed.candles5s);
    let resolved = status;
    let reason = feed.reason ?? feed.freshnessReason ?? null;
    if (!resolved) {
      if (freshFlag === true) {
        resolved = FEED_STATUS.FRESH;
      } else if (freshFlag === false) {
        resolved = FEED_STATUS.STALE;
        reason = reason ?? "FEED_STALE";
      } else if (ageMs !== null) {
        resolved = ageMs <= FRESH_TICK_MAX_AGE_MS ? FEED_STATUS.FRESH : FEED_STATUS.STALE;
        reason = reason ?? (resolved === FEED_STATUS.STALE ? "TICK_STALE" : "TICK_FRESH");
      } else if (hasOwn(feed, "candles5s")) {
        resolved = candles !== null && candles > 0 ? FEED_STATUS.FRESH : FEED_STATUS.MISSING;
        reason = reason ?? "NO_CANDLES_5S";
      } else {
        resolved = FEED_STATUS.UNKNOWN;
        reason = reason ?? "NO_FEED_DATA";
      }
    }
    return feedResult(resolved, { tickAgeMs: ageMs, candles5s: candles, reason, source: "FEED" });
  }

  const feature = m.featureState && typeof m.featureState === "object" ? m.featureState : null;
  const health = m.connectionHealth && typeof m.connectionHealth === "object" ? m.connectionHealth : null;
  const tick = m.lastTick && typeof m.lastTick === "object" ? m.lastTick : null;
  const ageMs = finiteNumber(tick?.ageMs);
  const candles = finiteNumber(m.candles5s);
  const agentState = upper(m.agentState);
  const officeOffline = Boolean(connection) && connection.connected === false;
  const marketOffline = Boolean(health) && health.connected === false;

  if (marketOffline) {
    return feedResult(FEED_STATUS.OFFLINE, { tickAgeMs: ageMs, candles5s: candles, reason: "MARKET_CONNECTION_OFFLINE", source: "CONNECTION_HEALTH" });
  }
  if (officeOffline && health?.connected !== true) {
    return feedResult(FEED_STATUS.OFFLINE, { tickAgeMs: ageMs, candles5s: candles, reason: "OFFICE_CONNECTION_OFFLINE", source: "CONNECTION" });
  }
  if (agentState === "OFFLINE") {
    return feedResult(FEED_STATUS.OFFLINE, { tickAgeMs: ageMs, candles5s: candles, reason: "AGENT_OFFLINE", source: "AGENT_STATE" });
  }

  const freshFlag = typeof feature?.fresh === "boolean" ? feature.fresh : null;
  const ageOk = ageMs === null ? null : ageMs <= FRESH_TICK_MAX_AGE_MS;
  const candlesOk = candles === null ? null : candles > 0;
  const freshnessReason = feature?.freshnessReason ?? null;

  if (freshFlag === true && ageOk !== false && candlesOk !== false) {
    return feedResult(FEED_STATUS.FRESH, { tickAgeMs: ageMs, candles5s: candles, reason: freshnessReason ?? "OK", source: "FEATURE_STATE" });
  }
  if (freshFlag === false) {
    return feedResult(FEED_STATUS.STALE, { tickAgeMs: ageMs, candles5s: candles, reason: freshnessReason ?? "STALE_ANALYSIS", source: "FEATURE_STATE" });
  }
  if (ageOk === false) {
    return feedResult(FEED_STATUS.STALE, { tickAgeMs: ageMs, candles5s: candles, reason: "TICK_STALE", source: "LAST_TICK" });
  }
  if (candlesOk === false && !tick) {
    return feedResult(FEED_STATUS.MISSING, { tickAgeMs: ageMs, candles5s: candles, reason: "NO_TICK_NO_CANDLES", source: "LAST_TICK" });
  }
  if (ageOk === true) {
    return feedResult(FEED_STATUS.FRESH, { tickAgeMs: ageMs, candles5s: candles, reason: "TICK_FRESH", source: "LAST_TICK" });
  }
  if (candlesOk === true) {
    return feedResult(FEED_STATUS.FRESH, { tickAgeMs: ageMs, candles5s: candles, reason: "CANDLES_ACTIVE", source: "CANDLES_5S" });
  }
  if (candlesOk === false) {
    return feedResult(FEED_STATUS.MISSING, { tickAgeMs: ageMs, candles5s: candles, reason: "NO_CANDLES_5S", source: "CANDLES_5S" });
  }
  return feedResult(FEED_STATUS.MISSING, { tickAgeMs: ageMs, candles5s: candles, reason: "NO_FEED_DATA", source: "MARKET" });
}

/** Real settled event only — never synthesized from the working state. */
export function realSettlementEvent(market) {
  const m = market && typeof market === "object" ? market : {};
  const settlement = m.settlementState && typeof m.settlementState === "object" ? m.settlementState : {};
  const trade = m.lastTrade && typeof m.lastTrade === "object" ? m.lastTrade : {};
  const result = upper(settlement.lastResult ?? trade.result);
  const profit = finiteNumber(settlement.lastProfit ?? trade.profit);
  if (!REAL_EVENTS.has(result) || profit === null) return null;
  return { result, profit };
}

function buildBadge(event) {
  if (!event) return { visible: false, tone: "NONE", color: null, text: "" };
  if (event.result === "WIN") return { visible: true, tone: "POSITIVE", color: BADGE_COLORS.POSITIVE, text: `+R$ ${Math.abs(event.profit).toFixed(2).replace(".", ",")}` };
  if (event.result === "LOSS") return { visible: true, tone: "NEGATIVE", color: BADGE_COLORS.NEGATIVE, text: `−R$ ${Math.abs(event.profit).toFixed(2).replace(".", ",")}` };
  return { visible: true, tone: "ZERO", color: BADGE_COLORS.ZERO, text: "R$ 0,00" };
}

const STATE_META = Object.freeze({
  [MARKET_STATES.WORKING]: {
    label: "MERCADO ABERTO · OPERANDO",
    shortLabel: "OPERANDO",
  },
  [MARKET_STATES.OPEN_BUT_FEED_OFFLINE]: {
    label: "MERCADO ABERTO · FEED OFFLINE",
    shortLabel: "FEED OFFLINE",
  },
  [MARKET_STATES.CLOSED]: { label: "MERCADO FECHADO", shortLabel: "FECHADO" },
  [MARKET_STATES.SUSPENDED]: { label: "MERCADO SUSPENSO", shortLabel: "SUSPENSO" },
  [MARKET_STATES.DISABLED]: { label: "MERCADO DESABILITADO", shortLabel: "DESABILITADO" },
  [MARKET_STATES.NOT_OFFERED]: { label: "MERCADO NÃO OFERTADO", shortLabel: "NÃO OFERTADO" },
  [MARKET_STATES.UNKNOWN]: { label: "ESTADO DESCONHECIDO", shortLabel: "INDISPONÍVEL" },
});

const FEED_REASON_TEXT = Object.freeze({
  FRESH: "feed fresco",
  STALE: "feed atrasado (stale)",
  OFFLINE: "feed offline",
  MISSING: "feed ausente (sem tick/candles)",
  UNKNOWN: "feed sem dados",
});

function explain(state, feedInfo, options = {}) {
  if (state === MARKET_STATES.WORKING) return "Broker OPEN, habilitado e feed fresco — agentes no desk.";
  if (state === MARKET_STATES.OPEN_BUT_FEED_OFFLINE) {
    return `Broker OPEN, mas ${FEED_REASON_TEXT[feedInfo.feedStatus] ?? "feed inválido"} (${feedInfo.reason ?? "?"}) — agentes não trabalham.`;
  }
  if (state === MARKET_STATES.CLOSED) return "Broker CLOSED — mesa vazia, agentes social/idle.";
  if (state === MARKET_STATES.SUSPENDED) {
    return options.paused ? "Mercado pausado (paused=true) — mesa vazia." : "Broker SUSPENDED — mesa vazia.";
  }
  if (state === MARKET_STATES.DISABLED) {
    return options.enabledFalse
      ? "Broker OPEN, mas Habilitado=NÃO no snapshot — mesa vazia."
      : "Broker DISABLED — mesa vazia.";
  }
  if (state === MARKET_STATES.NOT_OFFERED) return "Mercado não ofertado pela corretora — mesa vazia.";
  return "Estado do broker desconhecido — mesa vazia.";
}

/**
 * ONE derivation for one market. Pure: same inputs → same output.
 *
 * @param {object|null} market  raw market from GET /api/iq/office
 * @param {object|null} feed    optional explicit feed override
 * @param {object|null} connection office-level connection ({connected,healthy})
 */
export function deriveMarketState(market, feed = null, connection = null) {
  const m = market && typeof market === "object" ? market : null;
  const brokerRaw = m?.availability ?? null;
  const brokerAvailability = normalizeAvailability(brokerRaw);
  const enabled = m ? m.enabled !== false : false;
  const paused = m?.paused === true;
  const feedInfo = resolveMarketFeed(m, feed, connection);
  const badge = buildBadge(realSettlementEvent(m));

  let state = MARKET_STATES.UNKNOWN;
  let reason = "NO_MARKET";
  let enabledFalse = false;

  if (!m) {
    state = MARKET_STATES.UNKNOWN;
    reason = "NO_MARKET";
  } else if (brokerAvailability === CLOSED_TOKEN) {
    state = MARKET_STATES.CLOSED;
    reason = "BROKER_CLOSED";
  } else if (brokerAvailability === "SUSPENDED" || paused) {
    state = MARKET_STATES.SUSPENDED;
    reason = paused && brokerAvailability !== "SUSPENDED" ? "PAUSED" : "BROKER_SUSPENDED";
  } else if (brokerAvailability === "DISABLED") {
    state = MARKET_STATES.DISABLED;
    reason = "BROKER_DISABLED";
  } else if (brokerAvailability === "NOT_OFFERED") {
    state = MARKET_STATES.NOT_OFFERED;
    reason = "NOT_OFFERED";
  } else if (brokerAvailability !== OPEN_TOKEN) {
    state = MARKET_STATES.UNKNOWN;
    reason = brokerAvailability ? `BROKER_${brokerAvailability}` : "MISSING_AVAILABILITY";
  } else if (!enabled) {
    state = MARKET_STATES.DISABLED;
    reason = "ENABLED_FALSE";
    enabledFalse = true;
  } else if (!feedInfo.fresh) {
    state = MARKET_STATES.OPEN_BUT_FEED_OFFLINE;
    reason = feedInfo.feedStatus;
  } else {
    state = MARKET_STATES.WORKING;
    reason = "OK";
  }

  const meta = STATE_META[state];
  const agentsWorking = state === MARKET_STATES.WORKING;
  const label = enabledFalse ? "MERCADO ABERTO · DESABILITADO" : meta.label;

  return {
    version: STATE_MODEL_VERSION,
    marketKey: m?.marketKey ?? m?.id ?? null,
    state,
    reason,
    brokerAvailability,
    brokerRaw,
    enabled,
    paused,
    feedStatus: feedInfo.feedStatus,
    freshness: feedInfo.freshness,
    fresh: feedInfo.fresh,
    tickAgeMs: feedInfo.tickAgeMs,
    candles5s: feedInfo.candles5s,
    feedReason: feedInfo.reason,
    feedSource: feedInfo.source,
    deskState: agentsWorking ? DESK_STATES.WORKING : DESK_STATES.EMPTY,
    label,
    shortLabel: meta.shortLabel,
    explanation: explain(state, feedInfo, { paused, enabledFalse }),
    agentsWorking,
    socialEligible: !agentsWorking,
    badge,
    agentState: upper(m?.agentState) || null,
    sources: {
      availability: brokerRaw,
      enabled: m?.enabled ?? null,
      paused: m?.paused ?? null,
      feed: feedInfo.source,
      agentState: m?.agentState ?? null,
      connection: connection?.connected ?? null,
    },
  };
}

/**
 * Derives every market of an office snapshot with the same function used by
 * the popup, the panel and the overlay.
 */
export function deriveOfficeStates(officeJson, options = {}) {
  const office = officeJson && typeof officeJson === "object" ? officeJson : {};
  const connection = office.connection ?? options.connection ?? null;
  const feedByKey = options.feedByKey ?? office.feeds ?? null;
  const markets = Array.isArray(office.markets) ? office.markets.filter((market) => market && typeof market === "object") : [];
  const list = markets.map((market) => {
    const key = market.marketKey ?? market.id ?? null;
    const feed = feedByKey && key && typeof feedByKey === "object" ? feedByKey[key] ?? null : null;
    return deriveMarketState(market, feed, connection);
  });
  const byKey = Object.create(null);
  for (const state of list) if (state.marketKey) byKey[state.marketKey] = state;

  const counts = {
    working: 0,
    openButFeedOffline: 0,
    closed: 0,
    suspended: 0,
    disabled: 0,
    notOffered: 0,
    unknown: 0,
    total: list.length,
  };
  for (const state of list) {
    if (state.state === MARKET_STATES.WORKING) counts.working += 1;
    else if (state.state === MARKET_STATES.OPEN_BUT_FEED_OFFLINE) counts.openButFeedOffline += 1;
    else if (state.state === MARKET_STATES.CLOSED) counts.closed += 1;
    else if (state.state === MARKET_STATES.SUSPENDED) counts.suspended += 1;
    else if (state.state === MARKET_STATES.DISABLED) counts.disabled += 1;
    else if (state.state === MARKET_STATES.NOT_OFFERED) counts.notOffered += 1;
    else counts.unknown += 1;
  }

  return {
    version: STATE_MODEL_VERSION,
    at: finiteNumber(office.at) ?? null,
    connection,
    list,
    byKey,
    counts,
  };
}

/**
 * Attaches the derived state to every station of a built world state. This is
 * the ONLY bridge between the snapshot and the desk/overlay/agents.
 */
export function attachDerivedStates(worldState, officeJson, options = {}) {
  const states = deriveOfficeStates(officeJson, options);
  if (!worldState) return states;
  const pools = [worldState.stations, worldState.allStations];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const station of pool) {
      if (!station || typeof station !== "object") continue;
      const key = station.marketKey ?? station.id ?? null;
      const derived = key && states.byKey[key] ? states.byKey[key] : deriveMarketState(station.market ?? station, null, states.connection);
      station.derived = derived;
      station.agentsWorking = derived.agentsWorking;
    }
  }
  return states;
}

/** Derived state already attached to a station, or null. */
export function stationDerivedState(station) {
  return station && typeof station === "object" && station.derived ? station.derived : null;
}

/** Working flag: derived state is the only source when attached. */
export function stationAgentsWorking(station) {
  const derived = stationDerivedState(station);
  if (derived) return derived.agentsWorking === true;
  return station?.active === true;
}

export default {
  STATE_MODEL_VERSION,
  MARKET_STATES,
  FEED_STATUS,
  DESK_STATES,
  FRESH_TICK_MAX_AGE_MS,
  normalizeAvailability,
  resolveMarketFeed,
  realSettlementEvent,
  deriveMarketState,
  deriveOfficeStates,
  attachDerivedStates,
  stationDerivedState,
  stationAgentsWorking,
};
