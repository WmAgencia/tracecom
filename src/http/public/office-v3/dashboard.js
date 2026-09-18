/* =====================================================================
 * TRACE/COM — OFFICE V3 · DASHBOARD
 *
 * Frontend/UX ONLY. Dependency-free, DOM-based. Consumes exclusively the
 * real `GET /api/iq/office` snapshot (or the office JSON passed in). It never
 * invents numbers: absent fields render as "—".
 *
 * Public API:
 *   mountDashboard(rootEl, officeJson)
 *   buildDashboardModel(office)
 *   formatBRL / formatNumber / formatPercent / formatList
 * ===================================================================== */

import { deriveOfficeStates } from "./state-model.js";

export const DASHBOARD_VERSION = "office-v3-dashboard.1.1.0";

const EMPTY = "—";

/* ------------------------------------------------------------------ *
 * formatting helpers — identical semantics to the rest of the office UI
 * ------------------------------------------------------------------ */

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function toNumber(value) {
  return isFiniteNumber(value) ? Number(value) : null;
}

function firstFinite(values) {
  for (const value of values) if (isFiniteNumber(value)) return Number(value);
  return null;
}

export function formatBRL(value, options = {}) {
  if (value === null || value === undefined || value === "") return EMPTY;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return EMPTY;
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
  if (!isFiniteNumber(value)) return EMPTY;
  return Number(value).toFixed(digits).replace(".", ",");
}

export function formatPercent(value, digits = 0) {
  if (!isFiniteNumber(value)) return EMPTY;
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatList(value) {
  if (Array.isArray(value)) return value.length ? value.map((item) => String(item)).join(", ") : EMPTY;
  if (typeof value === "string" && value.trim()) return value;
  return EMPTY;
}

function toneOf(pnl) {
  if (pnl === null) return "empty";
  const epsilon = 0.0000001;
  if (pnl > epsilon) return "positive";
  if (pnl < -epsilon) return "negative";
  return "zero";
}

function toneClass(tone) {
  if (tone === "positive") return "tc-v3-pos";
  if (tone === "negative") return "tc-v3-neg";
  if (tone === "zero") return "tc-v3-zero";
  return "tc-v3-empty";
}

/* ------------------------------------------------------------------ *
 * model — pure, testable, derived only from the snapshot
 * ------------------------------------------------------------------ */

export function buildDashboardModel(office) {
  const source = office ?? {};
  const settled = source?.portfolio?.settled ?? null;
  const pnl = toNumber(settled?.pnl);
  const wins = toNumber(settled?.wins);
  const losses = toNumber(settled?.losses);
  const draws = toNumber(settled?.draws);
  const trades = toNumber(settled?.trades) ?? (wins !== null || losses !== null || draws !== null ? (wins ?? 0) + (losses ?? 0) + (draws ?? 0) : null);
  const decided = (wins ?? 0) + (losses ?? 0);
  const winRate = wins !== null && losses !== null && decided > 0 ? wins / decided : null;

  const markets = Array.isArray(source?.markets) ? source.markets.filter((market) => market && typeof market === "object") : [];
  const derivedStates = deriveOfficeStates(source);
  const openMarkets = derivedStates.counts.working;
  const feedOfflineMarkets = derivedStates.counts.openButFeedOffline;
  const totalMarkets = markets.length;
  const closedMarkets = Math.max(0, totalMarkets - openMarkets - feedOfflineMarkets);

  const connection = source?.connection ?? null;
  const mode = source?.mode ?? null;
  const brokerAutomation = source?.brokerAutomation ?? source?.aux?.brokerAutomation ?? source?.legacy?.brokerAutomation ?? null;
  const stake = firstFinite([source?.config?.defaultStake, source?.config?.globalMaxStake]);

  const equity = Array.isArray(source?.portfolio?.equityCurve) ? source.portfolio.equityCurve : [];

  const weeklyPnl = firstFinite([
    source?.portfolio?.weekly?.pnl,
    source?.portfolio?.weeklyPnl,
    source?.portfolio?.settled?.weeklyPnl,
    source?.weeklyPnl,
  ]);
  const monthlyPnl = firstFinite([
    source?.portfolio?.monthly?.pnl,
    source?.portfolio?.monthlyPnl,
    source?.portfolio?.settled?.monthlyPnl,
    source?.monthlyPnl,
  ]);

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

  const activeCount = toNumber(source?.activeCount);
  const activeLimit = toNumber(source?.activeLimit);
  const tone = toneOf(pnl);

  return {
    version: DASHBOARD_VERSION,
    pnl,
    tone,
    pnlText: formatBRL(pnl, { signed: true }),
    wins,
    losses,
    draws,
    trades,
    winRate,
    winRateText: winRate === null ? EMPTY : formatPercent(winRate, 1),
    openMarkets,
    feedOfflineMarkets,
    closedMarkets,
    totalMarkets,
    stateByKey: derivedStates.byKey,
    mode,
    practice: mode !== "REAL",
    brokerAutomation,
    connected: connection?.connected === true,
    healthy: connection?.healthy === true,
    hasConnection: Boolean(connection),
    stake,
    stakeText: formatBRL(stake),
    equity,
    weeklyText: formatBRL(weeklyPnl, { signed: true }),
    monthlyText: formatBRL(monthlyPnl, { signed: true }),
    bestWinText: formatBRL(bestWin, { signed: true }),
    bestLossText: formatBRL(bestLoss, { signed: true }),
    activeCount,
    activeLimit,
    hasAnyData: markets.length > 0 || settled !== null || activeCount !== null,
  };
}

function integerText(value) {
  return value === null || value === undefined ? EMPTY : String(value);
}

/* ------------------------------------------------------------------ *
 * DOM helpers (dependency-free, fake-DOM friendly)
 * ------------------------------------------------------------------ */

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function setData(node, key, value) {
  if (value === null || value === undefined) return;
  node.dataset[key] = String(value);
}

function clearRoot(rootEl) {
  if (typeof rootEl.replaceChildren === "function") rootEl.replaceChildren();
  else rootEl.innerHTML = "";
}

function dispatchMarketSelect(rootEl, marketKey) {
  const detail = { marketKey };
  let event;
  const Ctor = globalThis.CustomEvent;
  if (typeof Ctor === "function") event = new Ctor("tracecom:market-select", { detail });
  else event = { type: "tracecom:market-select", detail };
  if (typeof rootEl.dispatchEvent === "function") rootEl.dispatchEvent(event);
  if (typeof globalThis.__tracecomSelectMarket === "function") globalThis.__tracecomSelectMarket(marketKey);
}

function toggleDisclosure(button, panel) {
  const expanded = button.getAttribute("aria-expanded") === "true";
  const willExpand = !expanded;
  button.setAttribute("aria-expanded", willExpand ? "true" : "false");
  panel.hidden = !willExpand;
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function renderStatePanel(doc, rootEl, state, title, message) {
  const panel = el(doc, "section", `tc-v3-state tc-v3-state--${state}`);
  panel.setAttribute("data-state", state);
  panel.append(
    el(doc, "h2", "tc-v3-state-title", title),
    el(doc, "p", "tc-v3-state-msg", message),
  );
  rootEl.appendChild(panel);
}

function renderHeader(doc, model) {
  const header = el(doc, "header", "tc-v3-header");
  const brandWrap = el(doc, "div", "tc-v3-brand-wrap");
  const brand = el(doc, "div", "tc-v3-brand");
  brand.append(el(doc, "span", "tc-v3-brand-name", "TRACE"));
  brand.append(el(doc, "em", null, "/"));
  brand.append(el(doc, "span", "tc-v3-brand-name", "COM"));
  brandWrap.append(brand, el(doc, "span", "tc-v3-header-sub", "PAINEL DE RESULTADOS · OFFICE V3"));
  header.appendChild(brandWrap);

  const pills = el(doc, "div", "tc-v3-pills");
  const modePill = el(doc, "span", `tc-v3-pill ${model.practice ? "is-ok" : "is-bad"}`);
  modePill.append(el(doc, "span", null, "MODO"), el(doc, "b", null, model.mode ?? EMPTY));
  const connPill = el(doc, "span", `tc-v3-pill ${model.connected ? "is-ok" : "is-bad"}`);
  connPill.append(el(doc, "span", null, "CONEXÃO"), el(doc, "b", null, model.hasConnection ? (model.connected ? "ONLINE" : "OFFLINE") : EMPTY));
  const openPill = el(doc, "span", "tc-v3-pill is-warn");
  openPill.append(el(doc, "span", null, "ABERTOS"), el(doc, "b", null, `${model.openMarkets}/${model.totalMarkets}`));
  pills.append(modePill, connPill, openPill);
  header.appendChild(pills);
  return header;
}

function renderHero(doc, model) {
  const hero = el(doc, "section", "tc-v3-hero");
  hero.setAttribute("data-metric", "daily-result");
  const value = el(doc, "strong", "tc-v3-hero-value", model.pnlText);
  value.classList.add(toneClass(model.tone));
  value.setAttribute("title", "Resultado liquidado do dia (portfolio.settled.pnl)");
  const sub = model.pnl === null
    ? "sem resultado liquidado"
    : `${integerText(model.trades)} operações encerradas · ${model.wins ?? EMPTY}W / ${model.losses ?? EMPTY}L / ${model.draws ?? EMPTY}D`;
  hero.append(
    el(doc, "span", "tc-v3-hero-label", "RESULTADO DO DIA"),
    value,
    el(doc, "span", "tc-v3-hero-sub", sub),
  );
  return hero;
}

function buildCard(doc, descriptor) {
  const card = el(doc, "article", "tc-v3-card");
  card.setAttribute("data-metric", descriptor.metric);
  if (descriptor.title) card.setAttribute("title", descriptor.title);
  const value = el(doc, "strong", "tc-v3-card-value", descriptor.value);
  if (descriptor.tone) value.classList.add(toneClass(descriptor.tone));
  card.append(el(doc, "span", "tc-v3-card-label", descriptor.label), value);
  if (descriptor.sub) card.appendChild(el(doc, "span", "tc-v3-card-sub", descriptor.sub));
  if (Array.isArray(descriptor.kvs) && descriptor.kvs.length) {
    const list = el(doc, "div", "tc-v3-kv-list");
    for (const kv of descriptor.kvs) {
      const row = el(doc, "div", "tc-v3-kv");
      row.append(el(doc, "span", "tc-v3-kv-label", kv.label), el(doc, "b", "tc-v3-kv-value", kv.value));
      list.appendChild(row);
    }
    card.appendChild(list);
  }
  if (descriptor.data) for (const [key, value] of Object.entries(descriptor.data)) setData(card, key, value);
  return card;
}

function renderCards(doc, model) {
  const grid = el(doc, "div", "tc-v3-grid");
  const cards = [
    { metric: "win", label: "WIN", value: integerText(model.wins), tone: model.wins === null ? "empty" : "positive", title: "Resultados liquidados com WIN (portfolio.settled.wins)" },
    { metric: "loss", label: "LOSS", value: integerText(model.losses), tone: model.losses === null ? "empty" : "negative", title: "Resultados liquidados com LOSS (portfolio.settled.losses)" },
    { metric: "draw", label: "DRAW", value: integerText(model.draws), tone: "zero", title: "Resultados liquidados com DRAW (portfolio.settled.draws)" },
    { metric: "winrate", label: "WR", value: model.winRateText, sub: "W / (W + L)", title: "Taxa de acerto sobre operações decididas" },
    { metric: "operations", label: "OPERAÇÕES", value: integerText(model.trades), title: "Operações liquidadas no dia" },
    { metric: "markets", label: "MERCADOS", value: `${model.openMarkets}/${model.totalMarkets}`, sub: `${model.closedMarkets} fechados · ${model.feedOfflineMarkets} feed offline · ${model.totalMarkets} total`, data: { open: model.openMarkets, closed: model.closedMarkets, feedOffline: model.feedOfflineMarkets, total: model.totalMarkets }, title: "Mercados operando (estado derivado), fechados, feed offline e total do universo" },
    {
      metric: "system",
      label: "ESTADO DO SISTEMA",
      value: model.mode ?? EMPTY,
      sub: model.mode ? (model.practice ? "PRACTICE ONLY · ZERO REAL" : "MODO REAL") : null,
      data: { mode: model.mode ?? "", broker: model.brokerAutomation ?? "" },
      kvs: [
        { label: "Automação", value: model.brokerAutomation ?? EMPTY },
        { label: "Conexão", value: model.hasConnection ? (model.connected ? "ONLINE" : "OFFLINE") : EMPTY },
        { label: "Saúde", value: model.hasConnection ? (model.healthy ? "OK" : "DEGRADADA") : EMPTY },
        { label: "Stake", value: model.stakeText },
      ],
      title: "Modo, automação de corretora, conexão e stake configurada",
    },
  ];
  for (const descriptor of cards) grid.appendChild(buildCard(doc, descriptor));
  return grid;
}

function normalizeEquity(equity) {
  const points = [];
  for (const entry of Array.isArray(equity) ? equity : []) {
    const value = isFiniteNumber(entry)
      ? Number(entry)
      : firstFinite([entry?.cumulative, entry?.pnl, entry?.value, entry?.equity, entry?.balance]);
    if (value !== null) points.push({ value });
  }
  return points;
}

function renderChart(doc, model) {
  const section = el(doc, "section", "tc-v3-section tc-v3-chart-card");
  section.append(el(doc, "h3", "tc-v3-section-title", "RESULTADO ACUMULADO"));
  const wrap = el(doc, "div", "tc-v3-chart");
  const points = normalizeEquity(model.equity);
  if (points.length < 2) {
    wrap.appendChild(el(doc, "p", "tc-v3-chart-empty", "Sem série de resultado disponível no snapshot."));
    section.appendChild(wrap);
    return section;
  }
  const width = 640;
  const height = 180;
  const pad = 16;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const coords = points.map((point, index) => [
    pad + index * step,
    height - pad - ((point.value - min) / span) * (height - pad * 2),
  ]);
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("class", "tc-v3-chart-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Série de resultado acumulado");
  const line = doc.createElementNS(ns, "polyline");
  line.setAttribute("class", "tc-v3-chart-line");
  line.setAttribute("fill", "none");
  line.setAttribute("points", coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
  svg.appendChild(line);
  wrap.appendChild(svg);
  section.appendChild(wrap);
  return section;
}

function kvLine(doc, label, value) {
  const row = el(doc, "div", "tc-v3-kv");
  row.append(el(doc, "span", "tc-v3-kv-label", label), el(doc, "b", "tc-v3-kv-value", value));
  return row;
}

function renderDisclosure(doc, model) {
  const section = el(doc, "section", "tc-v3-section");
  const head = el(doc, "div", "tc-v3-section-head");
  const button = el(doc, "button", "tc-v3-disclosure-toggle", "Detalhes do dia");
  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", "false");
  head.append(el(doc, "h3", "tc-v3-section-title", "PROGRESSIVO"), button);
  const panel = el(doc, "div", "tc-v3-disclosure");
  panel.hidden = true;
  panel.append(
    kvLine(doc, "Resultado semanal", model.weeklyText),
    kvLine(doc, "Resultado mensal", model.monthlyText),
    kvLine(doc, "Maior WIN", model.bestWinText),
    kvLine(doc, "Maior LOSS", model.bestLossText),
    kvLine(doc, "Mercados ativos", model.activeCount === null ? EMPTY : `${model.activeCount}/${model.activeLimit ?? EMPTY}`),
  );
  button.addEventListener("click", () => toggleDisclosure(button, panel));
  section.append(head, panel);
  return section;
}

function renderMarketList(doc, rootEl, office, model) {
  const section = el(doc, "section", "tc-v3-section tc-v3-markets");
  const head = el(doc, "div", "tc-v3-section-head");
  const button = el(doc, "button", "tc-v3-disclosure-toggle tc-v3-markets-toggle", `Mercados (${model.totalMarkets})`);
  button.setAttribute("type", "button");
  button.setAttribute("aria-expanded", "false");
  head.append(el(doc, "h3", "tc-v3-section-title", "MESAS"), button);
  const list = el(doc, "div", "tc-v3-market-list");
  list.hidden = true;
  const markets = Array.isArray(office?.markets) ? office.markets.filter((market) => market && typeof market === "object") : [];
  const states = deriveOfficeStates(office);
  for (const market of markets) {
    const derived = market.marketKey && states.byKey[market.marketKey] ? states.byKey[market.marketKey] : null;
    const row = el(doc, "button", "tc-v3-market-row");
    row.setAttribute("type", "button");
    setData(row, "marketKey", market.marketKey);
    setData(row, "availability", market.availability);
    setData(row, "enabled", market.enabled === true ? "1" : "0");
    setData(row, "state", derived?.state);
    const payout = isFiniteNumber(market.payout) ? ` · ${formatNumber(market.payout, 0)}%` : "";
    row.append(
      el(doc, "span", "tc-v3-market-name", market.display ?? market.symbol ?? market.marketKey ?? EMPTY),
      el(doc, "span", "tc-v3-market-key", market.marketKey ?? EMPTY),
      el(doc, "span", "tc-v3-market-meta", `${market.marketType ?? EMPTY} · ${derived ? derived.label : market.availability ?? EMPTY}${payout}`),
    );
    row.addEventListener("click", () => dispatchMarketSelect(rootEl, market.marketKey));
    list.appendChild(row);
  }
  button.addEventListener("click", () => toggleDisclosure(button, list));
  section.append(head, list);
  return section;
}

function renderDashboard(doc, rootEl, office, model) {
  rootEl.appendChild(renderHeader(doc, model));
  rootEl.appendChild(renderHero(doc, model));
  rootEl.appendChild(renderCards(doc, model));
  rootEl.appendChild(renderChart(doc, model));
  rootEl.appendChild(renderDisclosure(doc, model));
  rootEl.appendChild(renderMarketList(doc, rootEl, office, model));
}

/* ------------------------------------------------------------------ *
 * public mount API
 * ------------------------------------------------------------------ */

export function mountDashboard(rootEl, officeJson) {
  if (!rootEl) throw new Error("TC_V3_ROOT_REQUIRED");
  const doc = globalThis.document;
  if (!doc) throw new Error("TC_V3_DOCUMENT_REQUIRED");
  clearRoot(rootEl);
  rootEl.classList?.add?.("tc-v3-dashboard");
  rootEl.setAttribute("data-tc-v3", "dashboard");

  if (officeJson === null || officeJson === undefined) {
    rootEl.setAttribute("data-state", "loading");
    renderStatePanel(doc, rootEl, "loading", "Carregando snapshot", "Aguardando GET /api/iq/office…");
    return { state: "loading" };
  }
  if (typeof officeJson === "object" && officeJson.error) {
    rootEl.setAttribute("data-state", "error");
    renderStatePanel(doc, rootEl, "error", "Falha ao carregar", String(officeJson.error));
    return { state: "error" };
  }

  const model = buildDashboardModel(officeJson);
  if (!model.hasAnyData) {
    rootEl.setAttribute("data-state", "empty");
    renderStatePanel(doc, rootEl, "empty", "Sem dados do escritório", "O snapshot não trouxe mercados nem resultado liquidado.");
    return { state: "empty" };
  }

  rootEl.setAttribute("data-state", "ready");
  renderDashboard(doc, rootEl, officeJson, model);
  return model;
}
