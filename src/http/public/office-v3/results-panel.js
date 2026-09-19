/**
 * TRACE/COM — OFFICE V3 · RESULTS PANEL (frontend/UX only)
 *
 * Painel de resultados legivel (tipografia normal) que substitui os quadros
 * desenhados no canvas do escritorio. Consome EXCLUSIVAMENTE o snapshot real
 * `GET /api/iq/office` (portfolio.settled / portfolio.weekly / portfolio.monthly /
 * portfolio.equityCurve / markets[].payout). Nunca inventa numero: ausente = "N/A".
 *
 * Public API:
 *   buildResultsModel(office) / mountResultsPanel(rootEl, office) / resultsSignature(model)
 */

export const RESULTS_PANEL_VERSION = "office-v3-results.1.0.0";

const NA = "N/A";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstFinite(values) {
  for (const value of values) {
    const numeric = toNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function isFiniteNumber(value) {
  return toNumber(value) !== null;
}

/** +R$ 1.234,56 / -R$ 9,99 / N/A (nunca "—" cru: o painel usa N/A explicito). */
export function moneyText(value, { signed = true } = {}) {
  const numeric = toNumber(value);
  if (numeric === null) return NA;
  const epsilon = 0.0000001;
  const negative = numeric < -epsilon;
  const positive = numeric > epsilon;
  const [integerPart, decimals] = Math.abs(numeric).toFixed(2).split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = negative ? "-" : positive && signed ? "+" : "";
  return `${sign}R$ ${grouped},${decimals}`;
}

export function intText(value) {
  const numeric = toNumber(value);
  return numeric === null ? NA : String(Math.round(numeric));
}

export function percentText(value, digits = 1) {
  const numeric = toNumber(value);
  return numeric === null ? NA : `${(numeric * 100).toFixed(digits).replace(".", ",")}%`;
}

function toneOf(pnl) {
  if (pnl === null) return "empty";
  const epsilon = 0.0000001;
  if (pnl > epsilon) return "positive";
  if (pnl < -epsilon) return "negative";
  return "zero";
}

function normalizeEquity(equity) {
  const points = [];
  for (const entry of Array.isArray(equity) ? equity : []) {
    const value = isFiniteNumber(entry)
      ? Number(entry)
      : firstFinite([entry?.cumulative, entry?.pnl, entry?.value, entry?.equity, entry?.balance]);
    if (value !== null) points.push(value);
  }
  return points;
}

/** Modelo puro e testavel — apenas dados reais do snapshot. */
export function buildResultsModel(office = {}) {
  const source = office ?? {};
  const settled = source?.portfolio?.settled ?? {};
  const wins = toNumber(settled.wins);
  const losses = toNumber(settled.losses);
  const draws = toNumber(settled.draws);
  const trades = toNumber(settled.trades) ?? (wins !== null || losses !== null || draws !== null ? (wins ?? 0) + (losses ?? 0) + (draws ?? 0) : null);
  const decided = (wins ?? 0) + (losses ?? 0);
  const winRate = wins !== null && losses !== null && decided > 0 ? wins / decided : null;
  const pnl = toNumber(settled.pnl);
  const weekly = firstFinite([source?.portfolio?.weekly?.pnl, source?.portfolio?.weeklyPnl]);
  const monthly = firstFinite([source?.portfolio?.monthly?.pnl, source?.portfolio?.monthlyPnl]);
  const weeklyTrades = toNumber(source?.portfolio?.weekly?.trades);
  const monthlyTrades = toNumber(source?.portfolio?.monthly?.trades);

  const markets = Array.isArray(source?.markets) ? source.markets.filter((market) => market && typeof market === "object") : [];
  const payouts = markets
    .filter((market) => market.enabled !== false && String(market.availability ?? "").toUpperCase() === "OPEN")
    .map((market) => toNumber(market.payout))
    .filter((payout) => payout !== null && payout > 0);
  const payoutAvg = payouts.length ? payouts.reduce((sum, payout) => sum + payout, 0) / payouts.length : null;
  const openMarkets = markets.filter((market) => market.enabled !== false && String(market.availability ?? "").toUpperCase() === "OPEN").length;
  const equitySeries = normalizeEquity(source?.portfolio?.equityCurve);

  const day = {
    key: "hoje", label: "HOJE", pnl, tone: toneOf(pnl), pnlText: moneyText(pnl),
    wins, losses, draws, trades, winRate, winRateText: percentText(winRate, 1),
    subText: trades === null ? NA : `${intText(trades)} operações · ${intText(wins)}W / ${intText(losses)}L / ${intText(draws)}D`,
  };
  const week = { key: "semana", label: "SEMANA", pnl: weekly, tone: toneOf(weekly), pnlText: moneyText(weekly), trades: weeklyTrades, subText: weeklyTrades === null ? NA : `${intText(weeklyTrades)} trades liquidados` };
  const month = { key: "mes", label: "MÊS", pnl: monthly, tone: toneOf(monthly), pnlText: moneyText(monthly), trades: monthlyTrades, subText: monthlyTrades === null ? NA : `${intText(monthlyTrades)} trades liquidados` };

  return {
    version: RESULTS_PANEL_VERSION,
    at: toNumber(source.at),
    mode: source.mode ?? null,
    day, week, month,
    wins, losses, draws, trades,
    winRate, winRateText: percentText(winRate, 1),
    payoutAvg, payoutText: payoutAvg === null ? NA : `${payoutAvg.toFixed(1).replace(".", ",")}%`, payoutSamples: payouts.length,
    openMarkets, totalMarkets: markets.length,
    equitySeries, equityPlaceholder: equitySeries.length < 2,
    hasAnyData: markets.length > 0 || pnl !== null || weekly !== null || monthly !== null,
  };
}

/** Assinatura para evitar redraw/flicker quando nada mudou. */
export function resultsSignature(model) {
  if (!model) return "";
  const bucket = (entry) => `${entry.pnlText}|${entry.trades ?? "x"}`;
  return [
    bucket(model.day), bucket(model.week), bucket(model.month),
    model.winRateText, model.payoutText, model.payoutSamples, model.openMarkets, model.totalMarkets,
    model.equitySeries.length, model.equitySeries[model.equitySeries.length - 1] ?? "x", model.mode,
  ].join("~");
}

const TONE_CLASS = { positive: "tc-results-pos", negative: "tc-results-neg", zero: "tc-results-zero", empty: "tc-results-empty" };

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function periodCard(doc, entry) {
  const card = el(doc, "article", "tc-results-period");
  card.dataset.metric = entry.key ?? String(entry.label ?? "").toLowerCase();
  card.append(el(doc, "span", "tc-results-period-label", entry.label));
  const value = el(doc, "strong", `tc-results-period-value ${TONE_CLASS[entry.tone]}`, entry.pnlText);
  value.setAttribute("title", `PnL liquidado (${entry.label.toLowerCase()}) — dado real de iq_executions`);
  card.append(value, el(doc, "small", "tc-results-period-sub", entry.subText));
  return card;
}

function stat(doc, label, value, tone) {
  const cell = el(doc, "div", "tc-results-stat");
  cell.append(el(doc, "span", "tc-results-stat-label", label));
  const strong = el(doc, "b", `tc-results-stat-value ${tone ? TONE_CLASS[tone] : ""}`, value);
  cell.append(strong);
  return cell;
}

function renderSparkline(doc, model) {
  const wrap = el(doc, "div", "tc-results-chartwrap");
  wrap.append(el(doc, "span", "tc-results-chart-label", model.equityPlaceholder ? "EQUITY · SEM DADOS" : "EQUITY · SÉRIE REAL"));
  if (model.equityPlaceholder) {
    wrap.append(el(doc, "p", "tc-results-chart-empty", "SEM SÉRIE DE RESULTADO"));
    return wrap;
  }
  const width = 190;
  const height = 54;
  const pad = 4;
  const values = model.equitySeries;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => `${(pad + index * step).toFixed(1)},${(height - pad - ((value - min) / span) * (height - pad * 2)).toFixed(1)}`).join(" ");
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Série real de resultado acumulado do dia");
  const line = doc.createElementNS(ns, "polyline");
  line.setAttribute("class", "tc-results-chart-line");
  line.setAttribute("fill", "none");
  line.setAttribute("points", points);
  svg.appendChild(line);
  wrap.append(svg);
  return wrap;
}

/** Monta/atualiza o painel. Retorna o modelo usado. */
export function mountResultsPanel(rootEl, officeJson) {
  if (!rootEl) throw new Error("TC_RESULTS_ROOT_REQUIRED");
  const doc = globalThis.document;
  if (!doc) throw new Error("TC_RESULTS_DOCUMENT_REQUIRED");
  const model = buildResultsModel(officeJson ?? {});
  const signature = resultsSignature(model);
  if (rootEl.dataset.signature === signature && rootEl.dataset.state === "ready") return model;

  rootEl.dataset.signature = signature;
  rootEl.dataset.state = "ready";
  rootEl.classList.add("tc-results");
  rootEl.setAttribute("data-tc-v3", "results");
  if (typeof rootEl.replaceChildren === "function") rootEl.replaceChildren();
  else rootEl.innerHTML = "";

  const hero = el(doc, "section", "tc-results-hero");
  hero.dataset.metric = "daily-result";
  hero.append(el(doc, "span", "tc-results-hero-label", "RESULTADO DO DIA"));
  const heroValue = el(doc, "strong", `tc-results-hero-value ${TONE_CLASS[model.day.tone]}`, model.day.pnlText);
  heroValue.setAttribute("title", "Resultado liquidado do dia (portfolio.settled.pnl) — dado real");
  hero.append(heroValue, el(doc, "span", "tc-results-hero-sub", model.day.subText));
  hero.append(el(doc, "span", "tc-results-hero-sub", `WR observado ${model.day.winRateText} · payout médio ${model.payoutText} (${model.payoutSamples} mercados abertos)`));

  const periods = el(doc, "div", "tc-results-periods");
  periods.append(periodCard(doc, model.day), periodCard(doc, model.week), periodCard(doc, model.month));

  const stats = el(doc, "div", "tc-results-stats");
  stats.append(
    stat(doc, "OPERAÇÕES", intText(model.trades)),
    stat(doc, "WINS", intText(model.wins), model.wins !== null ? "positive" : null),
    stat(doc, "LOSSES", intText(model.losses), model.losses !== null ? "negative" : null),
    stat(doc, "DRAWS", intText(model.draws)),
    stat(doc, "WR OBSERVADO", model.winRateText),
    stat(doc, "PAYOUT MÉDIO", model.payoutText),
    stat(doc, "MERCADOS ABERTOS", `${intText(model.openMarkets)}/${intText(model.totalMarkets)}`),
  );

  const right = el(doc, "div", "tc-results-side");
  const modePill = el(doc, "span", `tc-results-pill ${model.mode === "PRACTICE" ? "is-ok" : "is-bad"}`, model.mode ?? NA);
  modePill.setAttribute("title", "Modo da conta (REAL permanece LOCKED)");
  right.append(modePill, renderSparkline(doc, model));

  const board = el(doc, "div", "tc-results-board");
  board.append(hero, periods, stats, right);
  rootEl.append(board);
  rootEl.hidden = false;
  return model;
}
