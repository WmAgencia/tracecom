/**
 * TRACE/COM - OFFICE V3 — LOGS PANEL (DOM normal, legivel)
 *
 * Overlay de logs aberto pelo botao LOGS (canto inferior direito). Consome a
 * lista global de eventos REAIS ja coletada por office-v3.js (GET /api/iq/events).
 * Nada e sintetizado: campo ausente vira "-". Sem pixel-art: tipografia normal
 * para timestamps, IDs, numeros e erros.
 *
 * Filtro por fonte: TODOS | V4 | G2 | MESAS. A V4 e o agente que controla
 * execucao (RSI_V4_ONLY); o filtro garante que os eventos dela nao fiquem
 * escondidos pelo volume dos eventos G2.
 *
 * Public API:
 *   createLogsPanel({ document, toggle, panel, list, meta, close, filters, limit })
 *   logRowModel(entry) / renderLogRows(doc, listEl, entries, limit, filter)
 */
export const LOGS_PANEL_VERSION = "office-v3-logs.1.1.0";
export const LOGS_PANEL_LIMIT = 200;
export const LOGS_FILTERS = Object.freeze(["ALL", "V4", "G2", "MESAS"]);

const EMPTY = "—";

function cell(value) {
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "number" && !Number.isFinite(value)) return EMPTY;
  return String(value);
}

function shortOrder(entry) {
  const execution = entry.executionId ? `exec ${String(entry.executionId).slice(0, 12)}` : null;
  const order = entry.orderId ? `ord ${String(entry.orderId)}` : null;
  return [order, execution].filter(Boolean).join(" · ") || EMPTY;
}

function outcome(entry) {
  const parts = [];
  if (entry.result) parts.push(String(entry.result));
  if (entry.error) parts.push(String(entry.error).slice(0, 80));
  if (typeof entry.profit === "number" && Number.isFinite(entry.profit)) parts.push(`${entry.profit >= 0 ? "+" : "-"}R$ ${Math.abs(entry.profit).toFixed(2).replace(".", ",")}`);
  return parts.join(" · ") || EMPTY;
}

function isV4Entry(item) {
  const values = [item.strategyId, item.strategy, item.decisionSource, item.source];
  return values.some((value) => String(value ?? "").includes("RSI_REVERSAL_V4")) || String(item.type ?? "").startsWith("rsi.v4.");
}

function isMesasEntry(item) {
  return String(item.type ?? "").startsWith("mesas.") || String(item.type ?? "").startsWith("rsi.v4.universe");
}

function isG2Entry(item) {
  const type = String(item.type ?? "");
  if (isV4Entry(item) || isMesasEntry(item)) return false;
  return item.decisionSource === "G2_AUTO" || type.startsWith("agent.") || type.startsWith("market.") || type.startsWith("candidate.") || type === "AUTO_DECISION";
}

/** Linha estruturada (todos os campos exigidos; ausente = "-"). */
export function logRowModel(entry) {
  const item = entry && typeof entry === "object" ? entry : {};
  const v4 = isV4Entry(item);
  return {
    time: cell(item.time),
    agent: cell(item.agent ?? item.agentId),
    market: cell(item.marketKey ?? item.asset),
    strategy: cell(item.strategy ?? item.strategyId ?? item.skill ?? item.source),
    source: cell(item.decisionSource ?? (v4 ? "AGENT_V4" : null)),
    event: cell(item.text ?? item.type),
    decision: cell(item.decision),
    reason: cell(typeof item.reason === "string" ? item.reason.slice(0, 90) : item.reason),
    order: shortOrder(item),
    outcome: outcome(item),
    controls: item.controlsExecution === true ? "true" : item.controlsExecution === false ? "false" : EMPTY,
    v4,
    mesas: isMesasEntry(item),
    tone: item.tone ?? null,
  };
}

export function matchesLogFilter(entry, filter = "ALL") {
  const kind = String(filter ?? "ALL").toUpperCase();
  if (kind === "ALL") return true;
  const item = entry && typeof entry === "object" ? entry : {};
  if (kind === "V4") return isV4Entry(item);
  if (kind === "MESAS") return isMesasEntry(item);
  if (kind === "G2") return isG2Entry(item);
  return true;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Renderiza (mais recente primeiro). Retorna a quantidade de linhas. */
export function renderLogRows(doc, listEl, entries, limit = LOGS_PANEL_LIMIT, filter = "ALL") {
  if (!listEl) return 0;
  const filtered = Array.isArray(entries) ? entries.filter((entry) => matchesLogFilter(entry, filter)) : [];
  const rows = filtered.slice(-Math.max(1, limit)).reverse();
  if (typeof listEl.replaceChildren === "function") listEl.replaceChildren();
  else listEl.innerHTML = "";
  if (!rows.length) {
    const label = String(filter ?? "ALL").toUpperCase() === "ALL" ? "SEM EVENTOS AINDA - o stream real começa no próximo evento" : `SEM EVENTOS ${String(filter).toUpperCase()} NO BUFFER ATUAL`;
    listEl.append(el(doc, "p", "tc-logs-empty", label));
    return 0;
  }
  for (const entry of rows) {
    const model = logRowModel(entry);
    const row = el(doc, "article", "tc-logs-row");
    if (model.tone === "POSITIVE") row.classList.add("is-positive");
    if (model.tone === "NEGATIVE") row.classList.add("is-negative");
    if (model.v4) row.classList.add("is-v4");
    if (model.mesas) row.classList.add("is-mesas");
    row.append(
      el(doc, "span", "tc-logs-cell tc-logs-time", model.time),
      el(doc, "span", "tc-logs-cell", model.agent),
      el(doc, "span", "tc-logs-cell tc-logs-market", model.market),
      el(doc, "span", "tc-logs-cell tc-logs-strategy", model.strategy),
      el(doc, "span", "tc-logs-cell tc-logs-source", model.source),
      el(doc, "span", "tc-logs-cell tc-logs-event", model.event),
      el(doc, "span", "tc-logs-cell", model.decision),
      el(doc, "span", "tc-logs-cell", model.reason),
      el(doc, "span", "tc-logs-cell tc-logs-order", model.order),
      el(doc, "span", "tc-logs-cell", model.outcome),
      el(doc, "span", `tc-logs-cell tc-logs-exec ${model.controls === "true" ? "is-on" : model.controls === "false" ? "is-off" : ""}`, model.controls)
    );
    listEl.append(row);
  }
  return rows.length;
}

export function createLogsPanel({ document: doc = globalThis.document, toggle = null, panel = null, list = null, meta = null, close = null, filters = null, limit = LOGS_PANEL_LIMIT } = {}) {
  if (!doc) throw new Error("TC_LOGS_DOCUMENT_REQUIRED");
  let renderedCount = 0;
  let activeFilter = "ALL";
  let lastEntries = [];

  function setOpen(open) {
    const next = open === true;
    if (panel) panel.hidden = !next;
    if (toggle && typeof toggle.setAttribute === "function") toggle.setAttribute("aria-expanded", next ? "true" : "false");
    if (toggle?.classList?.toggle) toggle.classList.toggle("is-open", next);
    if (next && list && typeof list.focus === "function") list.focus();
    return next;
  }

  function isOpen() {
    return Boolean(panel && panel.hidden === false);
  }

  function setMeta(text) {
    if (meta) meta.textContent = text;
  }

  function paintFilters() {
    if (!filters) return;
    for (const button of filters.querySelectorAll("[data-logs-filter]")) {
      const kind = String(button.dataset.logsFilter ?? "ALL").toUpperCase();
      button.classList.toggle("is-active", kind === activeFilter);
      button.setAttribute("aria-pressed", kind === activeFilter ? "true" : "false");
    }
  }

  function render(entries) {
    lastEntries = Array.isArray(entries) ? entries : [];
    const count = renderLogRows(doc, list, lastEntries, limit, activeFilter);
    renderedCount = count;
    const total = lastEntries.length;
    if (count > 0) {
      const filtered = activeFilter === "ALL" ? lastEntries : lastEntries.filter((entry) => matchesLogFilter(entry, activeFilter));
      const last = filtered.length ? filtered[filtered.length - 1] : null;
      const scope = activeFilter === "ALL" ? `${total} evento(s)` : `${count} de ${total} (filtro ${activeFilter})`;
      setMeta(`${scope} · último ${last?.time ?? EMPTY} · atualiza a cada poll`);
    } else {
      setMeta(activeFilter === "ALL" ? "aguardando eventos…" : `sem eventos ${activeFilter} no buffer atual`);
    }
    paintFilters();
    return count;
  }

  function setFilter(kind) {
    activeFilter = LOGS_FILTERS.includes(String(kind).toUpperCase()) ? String(kind).toUpperCase() : "ALL";
    render(lastEntries);
    return activeFilter;
  }

  if (filters && typeof filters.addEventListener === "function") {
    filters.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-logs-filter]");
      if (button) setFilter(button.dataset.logsFilter);
    });
    paintFilters();
  }
  if (toggle && typeof toggle.addEventListener === "function") {
    toggle.addEventListener("click", () => setOpen(!isOpen()));
  }
  if (close && typeof close.addEventListener === "function") {
    close.addEventListener("click", () => setOpen(false));
  }

  return {
    version: LOGS_PANEL_VERSION,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    isOpen,
    setMeta,
    render,
    setFilter,
    getFilter: () => activeFilter,
    getRenderedCount: () => renderedCount,
    getLimit: () => limit,
  };
}
