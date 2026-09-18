/* =====================================================================
 * TRACE/COM — OFFICE V3 · MARKET DETAIL
 *
 * Frontend/UX ONLY. Dependency-free, DOM-based. Advanced technical data lives
 * here exclusively — never over the desks. Every field is read from the real
 * office snapshot; absent fields render as "—" with an explicit
 * "não disponível" hint. Nothing is invented.
 *
 * Public API:
 *   mountMarketDetail(rootEl, officeJson, marketKey)
 *   closeMarketDetail()
 *   buildMarketDetailModel(market, office)
 * ===================================================================== */

import { formatBRL, formatNumber, formatPercent, formatList } from "./dashboard.js";
import { deriveMarketState } from "./state-model.js";
import { buildStakeConfigModel, mountStakeConfig } from "./stake-config.js";

export const MARKET_DETAIL_VERSION = "office-v3-market-detail.1.0.0";

const EMPTY = "—";
const NA_HINT = "não disponível";

let activeDetail = null;

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function timeText(value) {
  if (!isFiniteNumber(value)) return null;
  try {
    return new Date(Number(value)).toLocaleTimeString("pt-BR");
  } catch {
    return null;
  }
}

function row(key, label, value) {
  const available = value !== null && value !== undefined && value !== "" && value !== EMPTY;
  return { key, label, value: available ? String(value) : EMPTY, available };
}

function payoutText(value) {
  return isFiniteNumber(value) ? `${formatNumber(value, 0)}%` : null;
}

/* ------------------------------------------------------------------ *
 * model — one section per technical domain
 * ------------------------------------------------------------------ */

export function buildMarketDetailModel(market, office = null) {
  const m = market ?? {};
  const derived = deriveMarketState(m, null, office?.connection ?? null);
  const feature = m.featureState ?? null;
  const decision = m.decisionState ?? null;
  const position = m.positionState ?? null;
  const settlement = m.settlementState ?? null;
  const trader = m.agents?.trader ?? null;
  const critic = m.agents?.critic ?? null;
  const entry = m.entryTiming ?? null;
  const daily = settlement?.daily ?? null;

  const structure = m.structure ?? decision?.structure ?? feature?.structure ?? null;
  const feedFreshness = feature
    ? feature.fresh === true
      ? "FRESH"
      : `STALE · ${feature.freshnessReason ?? "?"}`
    : null;
  const lastTick = isFiniteNumber(m.lastTick?.ageMs) ? `${formatNumber(m.lastTick.ageMs, 0)} ms` : null;

  const lastExecution = m.lastTrade
    ? `${m.lastTrade.direction ?? EMPTY} · ${m.lastTrade.result ?? "ABERTA"} · ${formatBRL(m.lastTrade.profit, { signed: true })}`
    : null;

  const finalRevalidation = entry
    ? entry.revalidatedAt
      ? `REVALIDADO${timeText(entry.revalidatedAt) ? ` ${timeText(entry.revalidatedAt)}` : ""}`
      : typeof entry.candidateChangedBeforeEntry === "boolean"
        ? entry.candidateChangedBeforeEntry
          ? "CANDIDATO ALTERADO"
          : "SEM ALTERAÇÃO"
        : null
    : null;

  const journalSummary = Array.isArray(m.journal) && m.journal.length
    ? `${m.journal.length} entradas recentes`
    : office?.journal
      ? `${office.journal.trades ?? EMPTY} trades · ${office.journal.decisions ?? EMPTY} decisões`
      : null;

  const sections = [
    {
      id: "identity",
      label: "IDENTIDADE",
      rows: [
        row("state", "Estado", derived.label),
        row("stateReason", "Por que", derived.explanation),
        row("asset", "Ativo", m.display ?? m.symbol ?? null),
        row("symbol", "Símbolo", m.symbol ?? null),
        row("canonical", "Canônico", m.canonical ?? null),
        row("marketKey", "Market key", m.marketKey ?? null),
        row("marketType", "Tipo", m.marketType ?? null),
        row("product", "Produto", Array.isArray(m.instrumentTypes) && m.instrumentTypes.length ? m.instrumentTypes.join(", ") : null),
        row("activeId", "Active ID", isFiniteNumber(m.activeId) ? String(m.activeId) : null),
        row("agentState", "Status", derived.agentsWorking ? "TRABALHANDO" : "OCIOSO (SOCIAL/IDLE)"),
        row("agentStateRaw", "Agente (relay)", m.agentState ?? null),
        row("availability", "Disponibilidade", m.availability ?? null),
        row("payout", "Payout", payoutText(m.payout)),
        row("enabled", "Habilitado", m.enabled === true ? "SIM" : m.enabled === false ? "NÃO" : null),
      ],
    },
    {
      id: "feed",
      label: "FEED",
      rows: [
        row("feedStatus", "Feed status", `${derived.feedStatus}${derived.feedReason ? ` · ${derived.feedReason}` : ""}`),
        row("freshness", "Feed freshness", feedFreshness),
        row("candles5s", "Candles 5s", isFiniteNumber(m.candles5s) ? String(m.candles5s) : null),
        row("lastTick", "Último tick", lastTick),
      ],
    },
    {
      id: "agents",
      label: "AGENTES",
      rows: [
        row("traderAction", "Trader ação", trader?.action ?? null),
        row("traderConfidence", "Trader confiança", isFiniteNumber(trader?.confidence) ? formatPercent(trader.confidence, 0) : null),
        row("traderRegime", "Trader regime", trader?.regime ?? null),
        row("criticVerdict", "Critic veredito", critic?.verdict ?? null),
        row("criticRecommendation", "Critic recomendação", critic?.finalRecommendation ?? null),
        row("criticContradictions", "Contradições", Array.isArray(critic?.contradictions) ? formatList(critic.contradictions) : null),
        row("criticRiskFlags", "Risk flags", Array.isArray(critic?.riskFlags) ? formatList(critic.riskFlags) : null),
      ],
    },
    {
      id: "decision",
      label: "DECISÃO",
      rows: [
        row("regime", "Regime", decision?.regime ?? m.regime ?? null),
        row("structure", "Estrutura", structure),
        row("setup", "Setup", decision?.setup ?? m.setup ?? null),
        row("trigger", "Gatilho", decision?.trigger ?? null),
        row("qualityScore", "Quality Score", isFiniteNumber(decision?.qualityScore) ? formatNumber(decision.qualityScore, 2) : null),
        row("failedChecks", "Failed checks", Array.isArray(decision?.failedChecks) ? formatList(decision.failedChecks) : null),
      ],
    },
    {
      id: "technical",
      label: "TÉCNICO",
      rows: [
        row("rsi", "RSI", isFiniteNumber(feature?.rsi14) ? formatNumber(feature.rsi14, 2) : null),
        row("adx", "ADX", isFiniteNumber(feature?.adx14) ? formatNumber(feature.adx14, 2) : null),
        row("plusDi", "+DI", isFiniteNumber(feature?.plusDi14 ?? feature?.plusDi) ? formatNumber(feature.plusDi14 ?? feature.plusDi, 2) : null),
        row("minusDi", "-DI", isFiniteNumber(feature?.minusDi14 ?? feature?.minusDi) ? formatNumber(feature.minusDi14 ?? feature.minusDi, 2) : null),
        row("atr", "ATR", isFiniteNumber(feature?.atr14) ? formatNumber(feature.atr14, 5) : null),
        row("donchian", "Donchian", isFiniteNumber(feature?.donchianPosition) ? formatNumber(feature.donchianPosition, 3) : null),
      ],
    },
    {
      id: "jit",
      label: "JIT / ENTRADA",
      rows: [
        row("jitStage", "JIT estágio", entry?.stage ?? null),
        row("jitRevalidation", "JIT revalidação", isFiniteNumber(entry?.secondsToRevalidation) ? `${entry.secondsToRevalidation}s` : null),
        row("jitEntry", "JIT entrada", isFiniteNumber(entry?.secondsToEntry) ? `${entry.secondsToEntry}s` : null),
        row("finalRevalidation", "Final Revalidation", finalRevalidation),
        row("jitDrift", "Drift na janela", typeof entry?.candidateChangedBeforeEntry === "boolean" ? (entry.candidateChangedBeforeEntry ? "SIM" : "NÃO") : null),
      ],
    },
    {
      id: "execution",
      label: "EXECUÇÃO / RESULTADO",
      rows: [
        row("position", "Posição", position?.status ?? null),
        row("direction", "Direção", position?.direction ?? null),
        row("stake", "Stake", isFiniteNumber(position?.stake) ? formatBRL(position.stake) : null),
        row("lastExecution", "Última execução", lastExecution),
        row("settlement", "Settlement", settlement?.lastResult ?? null),
        row("pnl", "P&L", isFiniteNumber(daily?.settledPnl ?? settlement?.lastProfit) ? formatBRL(daily?.settledPnl ?? settlement?.lastProfit, { signed: true }) : null),
      ],
    },
    {
      id: "journal",
      label: "JOURNAL",
      rows: [row("journal", "Journal", journalSummary)],
    },
  ];

  return { version: MARKET_DETAIL_VERSION, marketKey: m.marketKey ?? null, state: derived, sections };
}

/* ------------------------------------------------------------------ *
 * DOM helpers
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

function activateTab(tabs, bodies, id) {
  for (const tab of tabs) {
    const on = tab.dataset.tab === id;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    if (typeof tab.classList?.toggle === "function") tab.classList.toggle("is-active", on);
  }
  for (const body of bodies) body.hidden = body.dataset.tab !== id;
}

function renderRow(doc, item) {
  const wrapper = el(doc, "div", "tc-v3-row");
  setData(wrapper, "field", item.key);
  const value = el(doc, "span", "tc-v3-row-value");
  const strong = el(doc, "b", item.available ? null : "tc-v3-row-na", item.value);
  if (!item.available) strong.setAttribute("title", NA_HINT);
  value.appendChild(strong);
  if (!item.available) value.appendChild(el(doc, "i", "tc-v3-na", NA_HINT));
  wrapper.append(el(doc, "span", "tc-v3-row-label", item.label), value);
  return wrapper;
}

function renderSection(doc, section, index, active) {
  const body = el(doc, "section", "tc-v3-detail-section");
  setData(body, "tab", section.id);
  body.hidden = !active;
  body.appendChild(el(doc, "h4", "tc-v3-detail-section-title", section.label));
  const rows = el(doc, "div", "tc-v3-rows");
  for (const item of section.rows) rows.appendChild(renderRow(doc, item));
  body.appendChild(rows);
  return body;
}

function renderDetail(doc, panel, market, model, office, options) {
  const header = el(doc, "header", "tc-v3-detail-head");
  const titleWrap = el(doc, "div", "tc-v3-detail-titles");
  titleWrap.append(
    el(doc, "h2", "tc-v3-detail-title", market.display ?? market.symbol ?? market.marketKey ?? EMPTY),
    el(doc, "p", "tc-v3-detail-sub", `${market.marketKey ?? EMPTY} · ${market.marketType ?? EMPTY}`),
  );
  const closeButton = el(doc, "button", "tc-v3-detail-close", "FECHAR");
  closeButton.setAttribute("type", "button");
  closeButton.addEventListener("click", () => closeMarketDetail());
  header.append(titleWrap, closeButton);

  panel.appendChild(header);

  mountStakeConfig(panel, market, office, {
    document: doc,
    fetchImpl: options?.fetchImpl,
    onApplied: options?.onStakeApplied,
  });

  const nav = el(doc, "nav", "tc-v3-tabs");
  nav.setAttribute("role", "tablist");
  const bodies = el(doc, "div", "tc-v3-detail-bodies");
  const tabs = [];
  const bodyEls = [];
  const requestedTab = typeof options?.initialTab === "string" ? options.initialTab : null;
  const hasRequested = model.sections.some((section) => section.id === requestedTab);
  model.sections.forEach((section, index) => {
    const active = hasRequested ? section.id === requestedTab : index === 0;
    const tab = el(doc, "button", `tc-v3-tab${active ? " is-active" : ""}`, section.label);
    tab.setAttribute("type", "button");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", active ? "true" : "false");
    setData(tab, "tab", section.id);
    tab.addEventListener("click", () => activateTab(tabs, bodyEls, section.id));
    tabs.push(tab);
    nav.appendChild(tab);

    const body = renderSection(doc, section, index, active);
    bodyEls.push(body);
    bodies.appendChild(body);
  });

  panel.append(nav, bodies);
}

/* ------------------------------------------------------------------ *
 * public API
 * ------------------------------------------------------------------ */

export function closeMarketDetail() {
  if (!activeDetail) return false;
  const { root, panel } = activeDetail;
  if (panel && typeof panel.remove === "function") panel.remove();
  else if (root && panel && Array.isArray(root.childNodes)) root.childNodes = root.childNodes.filter((node) => node !== panel);
  activeDetail = null;
  return true;
}

export function mountMarketDetail(rootEl, officeJson, marketKey, options = {}) {
  if (!rootEl) throw new Error("TC_V3_ROOT_REQUIRED");
  const doc = globalThis.document;
  if (!doc) throw new Error("TC_V3_DOCUMENT_REQUIRED");

  closeMarketDetail();

  const office = officeJson ?? {};
  const markets = Array.isArray(office?.markets) ? office.markets : [];
  const market = markets.find((candidate) => candidate && candidate.marketKey === marketKey) ?? null;

  const panel = el(doc, "section", "tc-v3-detail");
  setData(panel, "marketKey", marketKey);

  if (!market) {
    panel.setAttribute("data-state", "error");
    const header = el(doc, "header", "tc-v3-detail-head");
    const titleWrap = el(doc, "div", "tc-v3-detail-titles");
    titleWrap.append(
      el(doc, "h2", "tc-v3-detail-title", "Mercado não encontrado"),
      el(doc, "p", "tc-v3-detail-sub", marketKey ?? EMPTY),
    );
    const closeButton = el(doc, "button", "tc-v3-detail-close", "FECHAR");
    closeButton.setAttribute("type", "button");
    closeButton.addEventListener("click", () => closeMarketDetail());
    header.append(titleWrap, closeButton);
    panel.append(header, el(doc, "p", "tc-v3-detail-empty", "O marketKey informado não existe no snapshot atual."));
    rootEl.appendChild(panel);
    activeDetail = { root: rootEl, panel };
    return { state: "error", marketKey: marketKey ?? null };
  }

  panel.setAttribute("data-state", "ready");
  const model = buildMarketDetailModel(market, office);
  model.stake = buildStakeConfigModel(market, office);
  renderDetail(doc, panel, market, model, office, options);
  rootEl.appendChild(panel);
  activeDetail = { root: rootEl, panel };
  return model;
}
