/**
 * TRACE/COM — OFFICE V3 · LOGS PANEL (DOM normal, legivel)
 *
 * Overlay de logs aberto pelo botao LOGS (canto inferior direito). Consome a
 * lista global de eventos REAIS ja coletada por office-v3.js (GET /api/iq/events).
 * Nada e sintetizado: campo ausente vira "—". Sem pixel-art: tipografia normal
 * para timestamps, IDs, numeros e erros.
 *
 * Public API:
 *   createLogsPanel({ document, toggle, panel, list, meta, close, limit })
 *   logRowModel(entry) / renderLogRows(doc, listEl, entries, limit)
 */

export const LOGS_PANEL_VERSION = "office-v3-logs.1.0.0";
export const LOGS_PANEL_LIMIT = 200;

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
  if (typeof entry.profit === "number" && Number.isFinite(entry.profit)) parts.push(`${entry.profit >= 0 ? "+" : ""}R$ ${entry.profit.toFixed(2).replace(".", ",")}`);
  return parts.join(" · ") || EMPTY;
}

/** Linha estruturada (todos os campos exigidos; ausente = "—"). */
export function logRowModel(entry) {
  const item = entry && typeof entry === "object" ? entry : {};
  return {
    time: cell(item.time),
    agent: cell(item.agent ?? item.agentId),
    market: cell(item.marketKey ?? item.asset),
    strategy: cell(item.strategy ?? item.skill ?? item.source),
    event: cell(item.text ?? item.type),
    decision: cell(item.decision),
    reason: cell(typeof item.reason === "string" ? item.reason.slice(0, 90) : item.reason),
    order: shortOrder(item),
    outcome: outcome(item),
    tone: item.tone ?? null,
  };
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Renderiza (mais recente primeiro). Retorna a quantidade de linhas. */
export function renderLogRows(doc, listEl, entries, limit = LOGS_PANEL_LIMIT) {
  if (!listEl) return 0;
  const rows = (Array.isArray(entries) ? entries.slice(-Math.max(1, limit)) : []).reverse();
  if (typeof listEl.replaceChildren === "function") listEl.replaceChildren();
  else listEl.innerHTML = "";
  if (!rows.length) {
    listEl.append(el(doc, "p", "tc-logs-empty", "SEM EVENTOS AINDA — o stream real começa no próximo evento do runtime."));
    return 0;
  }
  for (const entry of rows) {
    const model = logRowModel(entry);
    const row = el(doc, "article", "tc-logs-row");
    if (model.tone === "POSITIVE") row.classList.add("is-positive");
    if (model.tone === "NEGATIVE") row.classList.add("is-negative");
    row.append(
      el(doc, "span", "tc-logs-cell tc-logs-time", model.time),
      el(doc, "span", "tc-logs-cell", model.agent),
      el(doc, "span", "tc-logs-cell tc-logs-market", model.market),
      el(doc, "span", "tc-logs-cell", model.strategy),
      el(doc, "span", "tc-logs-cell tc-logs-event", model.event),
      el(doc, "span", "tc-logs-cell", model.decision),
      el(doc, "span", "tc-logs-cell", model.reason),
      el(doc, "span", "tc-logs-cell tc-logs-order", model.order),
      el(doc, "span", "tc-logs-cell", model.outcome),
    );
    listEl.append(row);
  }
  return rows.length;
}

export function createLogsPanel({ document: doc = globalThis.document, toggle = null, panel = null, list = null, meta = null, close = null, limit = LOGS_PANEL_LIMIT } = {}) {
  if (!doc) throw new Error("TC_LOGS_DOCUMENT_REQUIRED");
  let renderedCount = 0;

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

  function render(entries) {
    const count = renderLogRows(doc, list, entries, limit);
    renderedCount = count;
    if (count > 0) {
      const last = Array.isArray(entries) && entries.length ? entries[entries.length - 1] : null;
      setMeta(`${count} evento(s) · último ${last?.time ?? EMPTY} · atualiza a cada poll`);
    } else {
      setMeta("aguardando eventos…");
    }
    return count;
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
    getRenderedCount: () => renderedCount,
    getLimit: () => limit,
  };
}
