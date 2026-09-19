/**
 * MESAS — gerenciador de instrumentos (self-contained; sem dependencia do office-v3.js).
 * Anexa-se ao painel MESAS existente (#mesas-panel) e usa os endpoints do relay:
 *   GET  /api/iq/mesas          -> registry + disponibilidade viva
 *   PUT  /api/iq/mesas          -> toggle individual (persistido no banco)
 *   POST /api/iq/mesas/bulk     -> selecionar/desligar em massa por filtro
 * Nunca mostra credenciais. PRACTICE only.
 */
const MESAS_ENDPOINTS = Object.freeze({
  list: "/api/iq/mesas",
  toggle: "/api/iq/mesas",
  bulk: "/api/iq/mesas/bulk",
});

const FILTERS = Object.freeze([
  { id: "ALL", label: "TODOS" },
  { id: "BINARY", label: "BINARY" },
  { id: "BLITZ", label: "BLITZ" },
  { id: "CRYPTO", label: "CRYPTO" },
  { id: "NORMAL", label: "NORMAL" },
  { id: "OTC", label: "OTC" },
]);

export function filterInstruments(rows = [], filter = "ALL") {
  if (filter === "ALL") return rows;
  if (filter === "BINARY" || filter === "BLITZ") return rows.filter((row) => row.category === filter);
  if (filter === "CRYPTO") return rows.filter((row) => row.assetClass === "CRYPTO");
  if (filter === "NORMAL" || filter === "OTC") return rows.filter((row) => row.marketType === filter);
  return rows;
}

export function bulkFilterFor(filter = "ALL") {
  if (filter === "BINARY" || filter === "BLITZ" || filter === "CRYPTO") return { category: filter };
  if (filter === "NORMAL" || filter === "OTC") return { marketType: filter };
  return {};
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

export function createMesasInstruments({ document: doc = document, fetchImpl = fetch } = {}) {
  let state = { filter: "ALL", rows: [], totals: null, error: null, loading: false };
  const root = doc.createElement("div");
  root.id = "mesas-instruments";
  root.className = "mesas-instruments";
  root.innerHTML = `
    <div class="mesas-instruments-head">
      <strong>INSTRUMENTOS</strong>
      <span class="mesas-instruments-count" data-count>—</span>
    </div>
    <div class="mesas-instruments-filters" data-filters></div>
    <div class="mesas-instruments-bulk">
      <button type="button" data-bulk-on>SELECIONAR TODOS</button>
      <button type="button" data-bulk-off>DESLIGAR TODOS</button>
    </div>
    <div class="mesas-instruments-list" data-list></div>
  `;
  const filtersEl = root.querySelector("[data-filters]");
  const listEl = root.querySelector("[data-list]");
  const countEl = root.querySelector("[data-count]");

  const render = () => {
    if (state.error) { listEl.textContent = `erro: ${state.error}`; return; }
    const rows = filterInstruments(state.rows, state.filter);
    countEl.textContent = `${state.totals?.enabled ?? 0}/${state.totals?.total ?? rows.length} ligados`;
    filtersEl.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.filter === state.filter));
    listEl.replaceChildren(...rows.map((row) => {
      const item = doc.createElement("label");
      item.className = "mesas-instrument";
      item.dataset.marketKey = row.marketKey;
      item.dataset.instrumentType = row.instrumentType;
      const toggle = doc.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = row.enabled === true;
      toggle.dataset.toggle = "1";
      toggle.addEventListener("change", async () => {
        toggle.disabled = true;
        try {
          await fetchJson(MESAS_ENDPOINTS.toggle, { method: "PUT", body: JSON.stringify({ marketKey: row.marketKey, instrumentType: row.instrumentType, durationSeconds: row.durationSeconds, enabled: toggle.checked }) });
          await refresh();
        } catch (error) { state.error = String(error?.message ?? error).slice(0, 80); render(); }
      });
      const text = doc.createElement("span");
      text.textContent = `${row.marketKey} · ${row.category} · ${row.marketType} · payout ${row.payout ?? "-"} · ${row.durationSeconds}s · ${row.status} · ${row.enabled ? "ON" : "OFF"}`;
      item.append(toggle, text);
      return item;
    }));
  };

  const refresh = async () => {
    state.loading = true;
    try {
      const payload = await fetchJson(MESAS_ENDPOINTS.list);
      state.rows = Array.isArray(payload.rows) ? payload.rows : [];
      state.totals = payload.totals ?? null;
      state.error = null;
    } catch (error) { state.error = String(error?.message ?? error).slice(0, 80); }
    state.loading = false;
    render();
  };

  for (const entry of FILTERS) {
    const button = doc.createElement("button");
    button.type = "button";
    button.dataset.filter = entry.id;
    button.textContent = entry.label;
    button.addEventListener("click", () => { state.filter = entry.id; render(); });
    filtersEl.append(button);
  }
  root.querySelector("[data-bulk-on]").addEventListener("click", async () => {
    await fetchJson(MESAS_ENDPOINTS.bulk, { method: "POST", body: JSON.stringify({ filter: bulkFilterFor(state.filter), enabled: true }) });
    await refresh();
  });
  root.querySelector("[data-bulk-off]").addEventListener("click", async () => {
    await fetchJson(MESAS_ENDPOINTS.bulk, { method: "POST", body: JSON.stringify({ filter: bulkFilterFor(state.filter), enabled: false }) });
    await refresh();
  });

  return { root, refresh, filterInstruments, getState: () => ({ ...state }), endpoints: MESAS_ENDPOINTS };
}

export function mountMesasInstruments({ document: doc = document } = {}) {
  const panel = doc.querySelector("#mesas-panel");
  if (!panel || panel.querySelector("#mesas-instruments")) return null;
  const ui = createMesasInstruments({ document: doc });
  panel.append(ui.root);
  void ui.refresh();
  return ui;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const start = () => { try { mountMesasInstruments({ document }); } catch { /* fail-soft */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
