/* =====================================================================
 * TRACE/COM — OFFICE V3 · PER-MARKET STAKE CONFIG
 *
 * Frontend/UX ONLY. Binds ONE marketKey to its own stake control. The
 * apply action performs exactly one real call:
 *
 *   PUT /api/iq/market   { marketKey, configuredStake }
 *
 * The relay persists `configuredStake` per market (server-side), and the
 * top bar's "apply to all" remains the only path that overwrites several
 * markets. Never sends another marketKey. Never sends an order.
 * PRACTICE only. ZERO REAL.
 * ===================================================================== */

import { formatBRL } from "./dashboard.js";

export const STAKE_CONFIG_VERSION = "office-v3-stake-config.1.0.0";
export const MARKET_STAKE_ENDPOINT = "/api/iq/market";

const EMPTY = "—";
const STAKE_MIN = 1;
const STAKE_MAX = 100;

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/* ------------------------------------------------------------------ *
 * model
 * ------------------------------------------------------------------ */

export function buildStakeConfigModel(market, office = null) {
  const m = market ?? {};
  const config = office?.config ?? {};
  const configuredStake = toNumber(m.configuredStake);
  const defaultStake = toNumber(config.defaultStake);
  const marketMaxStake = toNumber(m.maxStake);
  const hardCap = toNumber(config.hardCap);
  const globalMaxStake = toNumber(config.globalMaxStake);
  const maxStake = marketMaxStake ?? hardCap ?? globalMaxStake;
  const effectiveStake = configuredStake ?? defaultStake;

  return {
    version: STAKE_CONFIG_VERSION,
    marketKey: typeof m.marketKey === "string" ? m.marketKey : null,
    configuredStake,
    defaultStake,
    marketMaxStake,
    globalMaxStake,
    hardCap,
    maxStake,
    effectiveStake,
    configuredText: configuredStake === null ? EMPTY : formatBRL(configuredStake),
    effectiveText: effectiveStake === null ? EMPTY : formatBRL(effectiveStake),
    source: configuredStake !== null ? "MERCADO" : defaultStake !== null ? "GLOBAL" : EMPTY,
    enabled: m.enabled === true,
  };
}

/* ------------------------------------------------------------------ *
 * real action — PUT /api/iq/market with the single selected marketKey
 * ------------------------------------------------------------------ */

export async function applyMarketStake(marketKey, value, options = {}) {
  const key = typeof marketKey === "string" ? marketKey.trim() : "";
  const numeric = toNumber(value);
  if (!key) return { ok: false, error: "market_key_required" };
  if (numeric === null || numeric < STAKE_MIN || numeric > STAKE_MAX) return { ok: false, error: "invalid_stake" };
  if (toNumber(options.maxStake) !== null && numeric > Number(options.maxStake)) return { ok: false, error: "stake_above_market_max" };
  if (toNumber(options.hardCap) !== null && numeric > Number(options.hardCap)) return { ok: false, error: "stake_above_hard_cap" };

  const fetchImpl = (typeof options.fetchImpl === "function" && options.fetchImpl) || globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, error: "fetch_unavailable" };

  try {
    const response = await fetchImpl(MARKET_STAKE_ENDPOINT, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ marketKey: key, configuredStake: numeric }),
    });
    if (!response || response.ok !== true) return { ok: false, error: `HTTP ${response ? response.status : "?"}` };
    let json = null;
    if (typeof response.json === "function") {
      try {
        json = await response.json();
      } catch {
        json = null;
      }
    }
    return { ok: true, marketKey: key, configuredStake: numeric, response: json };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

/* ------------------------------------------------------------------ *
 * DOM — one block bound to exactly one marketKey
 * ------------------------------------------------------------------ */

export function mountStakeConfig(rootEl, market, office = null, options = {}) {
  if (!rootEl) throw new Error("TC_V3_STAKE_ROOT_REQUIRED");
  const doc = options.document ?? globalThis.document;
  if (!doc || typeof doc.createElement !== "function") throw new Error("TC_V3_DOCUMENT_REQUIRED");

  const model = buildStakeConfigModel(market, office);
  const section = el(doc, "section", "tc-stake-config");
  section.setAttribute("data-market-key", model.marketKey ?? "");
  section.setAttribute("data-tc-v3", "stake-config");

  const head = el(doc, "div", "tc-stake-config-head");
  head.append(
    el(doc, "h4", "tc-stake-config-title", "STAKE DESTE MERCADO"),
    el(doc, "span", "tc-stake-config-source", model.source),
  );

  const row = el(doc, "div", "tc-stake-config-row");
  const input = el(doc, "input", "tc-stake-config-input");
  input.setAttribute("type", "number");
  input.setAttribute("min", String(STAKE_MIN));
  input.setAttribute("max", String(STAKE_MAX));
  input.setAttribute("step", "1");
  input.setAttribute("aria-label", `Stake para ${model.marketKey ?? "mercado"}`);
  input.setAttribute("data-stake", "input");
  input.value = model.configuredStake === null ? "" : String(model.configuredStake);
  input.placeholder = model.effectiveStake === null ? "" : String(model.effectiveStake);
  const applyButton = el(doc, "button", "tc-stake-config-apply", "SALVAR");
  applyButton.setAttribute("type", "button");
  applyButton.setAttribute("data-stake", "apply");
  const status = el(doc, "span", "tc-stake-config-status", "", null);
  status.setAttribute("data-stake", "status");
  row.append(input, applyButton);

  const meta = el(doc, "p", "tc-stake-config-meta", `efetivo ${model.effectiveText} · teto ${model.maxStake === null ? EMPTY : formatBRL(model.maxStake)}`);
  section.append(head, row, meta, status);

  function setStatus(text, tone) {
    status.textContent = text ?? "";
    status.setAttribute("data-tone", tone ?? "");
  }

  applyButton.addEventListener("click", () => {
    const value = toNumber(input.value !== "" ? input.value : model.effectiveStake);
    if (value === null) {
      setStatus("valor inválido", "error");
      return;
    }
    setStatus("salvando…", "pending");
    Promise.resolve(applyMarketStake(model.marketKey, value, {
      fetchImpl: options.fetchImpl,
      maxStake: model.maxStake,
      hardCap: model.hardCap,
    })).then((result) => {
      if (!result.ok) {
        setStatus(`falha · ${result.error}`, "error");
        return;
      }
      setStatus(`salvo · ${formatBRL(result.configuredStake)}`, "ok");
      section.setAttribute("data-configured-stake", String(result.configuredStake));
      if (typeof options.onApplied === "function") options.onApplied(result);
    });
  });

  rootEl.appendChild(section);
  section.setAttribute("data-state", "ready");
  return { model, section, input, applyButton, status };
}
