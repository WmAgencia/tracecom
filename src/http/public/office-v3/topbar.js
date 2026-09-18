/* =====================================================================
 * TRACE/COM — OFFICE V3 · TOP BAR
 *
 * Frontend/UX ONLY. Compact operational strip: PRACTICE mode, connection,
 * ARM, AUTO, global stake + "apply to all", open/total markets and the
 * execution gate state. Every control calls a REAL endpoint:
 *
 *   ARM/DISARM   POST /api/iq/arm  · POST /api/iq/disarm
 *   AUTO         POST /api/iq/config/auto-execute
 *   GLOBAL STAKE POST /api/iq/config/global-stake
 *
 * REAL mode is NEVER offered: the REAL control is permanently disabled.
 * No orders, no technical indicators. PRACTICE only. ZERO REAL.
 *
 * Public API:
 *   buildTopBarModel(office)
 *   mountTopBar(rootEl, officeJson, options) → controller
 *   updateTopBar(rootEl, officeJson, options)
 * ===================================================================== */

export const TOPBAR_VERSION = "office-v3-topbar.1.0.0";

export const TOPBAR_ENDPOINTS = Object.freeze({
  arm: "/api/iq/arm",
  disarm: "/api/iq/disarm",
  auto: "/api/iq/config/auto-execute",
  globalStake: "/api/iq/config/global-stake",
});

const EMPTY = "—";
const STAKE_MIN = 1;
const STAKE_MAX = 100;

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampStake(value, fallback) {
  const numeric = toNumber(value);
  const base = numeric !== null ? numeric : toNumber(fallback);
  if (base === null || base <= 0) return null;
  return Math.min(STAKE_MAX, Math.max(STAKE_MIN, Math.round(base * 100) / 100));
}

/* ------------------------------------------------------------------ *
 * model — derived only from the real office snapshot
 * ------------------------------------------------------------------ */

export function buildTopBarModel(office) {
  const source = office ?? {};
  const config = source.config ?? {};
  const markets = Array.isArray(source.markets) ? source.markets.filter((market) => market && typeof market === "object") : [];
  const openMarkets = markets.filter((market) => market.enabled === true && market.availability === "OPEN").length;
  const enabledMarkets = markets.filter((market) => market.enabled === true).length;
  const armState = source?.aux?.compliance?.armState ?? null;
  const executionGate = source?.aux?.executionGate ?? null;
  const armed = executionGate?.armed === true || armState?.armed === true;
  const mode = typeof source.mode === "string" ? source.mode : null;

  return {
    version: TOPBAR_VERSION,
    mode,
    practice: mode !== "REAL",
    connected: source?.connection?.connected === true,
    healthy: source?.connection?.healthy === true,
    armed,
    auto: config.autoExecute === true,
    defaultStake: toNumber(config.defaultStake),
    globalMaxStake: toNumber(config.globalMaxStake),
    hardCap: toNumber(config.hardCap),
    stakeValue: toNumber(config.defaultStake) ?? toNumber(config.globalMaxStake),
    openMarkets,
    enabledMarkets,
    totalMarkets: markets.length,
    activeCount: toNumber(source.activeCount),
    activeLimit: toNumber(source.activeLimit),
    killSwitch: source?.aux?.compliance?.killSwitch ?? null,
    executionGate,
    hasOffice: markets.length > 0 || source.mode !== undefined,
  };
}

function connectionText(model) {
  if (!model.hasOffice) return EMPTY;
  if (model.connected && model.healthy) return "ONLINE";
  if (model.connected) return "DEGRADADA";
  return "OFFLINE";
}

function gateText(model) {
  const state = typeof model.executionGate?.state === "string" ? model.executionGate.state : null;
  if (state) return state;
  if (model.killSwitch && model.killSwitch.executionEnabled === false) return "BLOCKED";
  return model.armed ? "ARMED" : "DISARMED";
}

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function bit(doc, rootEl, tag, className, text, key) {
  const node = el(doc, tag, className, text);
  if (key) node.setAttribute("data-tb", key);
  rootEl.appendChild(node);
  return node;
}

function createTopBar(doc, rootEl, options) {
  rootEl.classList?.add?.("tc-topbar");
  rootEl.setAttribute("data-tc-v3", "topbar");
  rootEl.setAttribute("role", "toolbar");
  rootEl.setAttribute("aria-label", "Controles operacionais PRACTICE");

  const brand = bit(doc, rootEl, "div", "tc-topbar-brand", null, "brand");
  brand.append(el(doc, "b", null, "TRACE"), el(doc, "em", null, "/"), el(doc, "b", null, "COM"));
  brand.appendChild(el(doc, "small", null, "PIXEL OFFICE V3"));

  const mode = bit(doc, rootEl, "div", "tc-topbar-chip", null, "mode");
  mode.append(el(doc, "small", null, "MODO"), el(doc, "b", null, EMPTY));

  const connection = bit(doc, rootEl, "div", "tc-topbar-chip", null, "connection");
  connection.append(el(doc, "small", null, "CONEXÃO"), el(doc, "b", null, EMPTY));

  const arm = bit(doc, rootEl, "button", "tc-topbar-btn", "ARM", "arm");
  arm.setAttribute("type", "button");

  const auto = bit(doc, rootEl, "button", "tc-topbar-btn", "AUTO OFF", "auto");
  auto.setAttribute("type", "button");

  const stakeWrap = bit(doc, rootEl, "label", "tc-topbar-stake", null, "stake");
  stakeWrap.appendChild(el(doc, "small", null, "STAKE R$"));
  const stakeInput = el(doc, "input", "tc-topbar-input");
  stakeInput.setAttribute("data-tb", "stake-input");
  stakeInput.setAttribute("type", "number");
  stakeInput.setAttribute("min", String(STAKE_MIN));
  stakeInput.setAttribute("max", String(STAKE_MAX));
  stakeInput.setAttribute("step", "1");
  stakeInput.setAttribute("aria-label", "Stake global em reais");
  stakeWrap.appendChild(stakeInput);
  const stakeApply = el(doc, "button", "tc-topbar-btn", "APLICAR A TODOS");
  stakeApply.setAttribute("data-tb", "stake-apply");
  stakeApply.setAttribute("type", "button");
  stakeWrap.appendChild(stakeApply);

  const markets = bit(doc, rootEl, "div", "tc-topbar-chip", null, "markets");
  markets.append(el(doc, "small", null, "MERCADOS"), el(doc, "b", null, EMPTY));

  const active = bit(doc, rootEl, "div", "tc-topbar-chip", null, "active");
  active.append(el(doc, "small", null, "ATIVOS"), el(doc, "b", null, EMPTY));

  const gate = bit(doc, rootEl, "div", "tc-topbar-chip", null, "gate");
  gate.append(el(doc, "small", null, "EXECUÇÃO"), el(doc, "b", null, EMPTY));

  const real = bit(doc, rootEl, "button", "tc-topbar-btn is-disabled", "REAL OFF", "real");
  real.setAttribute("type", "button");
  real.disabled = true;
  real.setAttribute("aria-disabled", "true");
  real.setAttribute("title", "ZERO REAL — indisponível nesta build PRACTICE");

  const status = bit(doc, rootEl, "div", "tc-topbar-status", "", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const state = {
    model: buildTopBarModel(null),
    busy: false,
  };

  const nodes = { mode, connection, arm, auto, stakeWrap, stakeInput, stakeApply, markets, active, gate, real, status };

  function setStatus(text) {
    status.textContent = text ?? "";
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const control of [nodes.arm, nodes.auto, nodes.stakeApply]) {
      control.disabled = busy;
      control.classList?.toggle?.("is-busy", busy);
    }
  }

  function currentStake() {
    const typed = nodes.stakeInput.value;
    return clampStake(typed !== "" && typed !== undefined ? typed : state.model.stakeValue, state.model.stakeValue);
  }

  function send(endpoint, payload, method = "POST") {
    const fetchImpl = (typeof options.fetchImpl === "function" && options.fetchImpl) || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      setStatus("fetch indisponível");
      return Promise.resolve(null);
    }
    setBusy(true);
    return Promise.resolve(fetchImpl(endpoint, {
      method,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }))
      .then((response) => {
        if (!response || response.ok !== true) throw new Error(`HTTP ${response ? response.status : "?"}`);
        return typeof response.json === "function" ? response.json().catch(() => null) : null;
      })
      .then((json) => {
        setStatus(`ok · ${endpoint}`);
        if (typeof options.onRefresh === "function") options.onRefresh();
        return json;
      })
      .catch((error) => {
        setStatus(`falha · ${endpoint} · ${String(error && error.message ? error.message : error)}`);
        return null;
      })
      .finally(() => setBusy(false));
  }

  arm.addEventListener("click", () => {
    if (state.busy) return;
    if (state.model.armed) {
      void send(TOPBAR_ENDPOINTS.disarm, {});
      return;
    }
    const limitBrl = currentStake();
    if (limitBrl === null) {
      setStatus("stake inválido para ARM");
      return;
    }
    void send(TOPBAR_ENDPOINTS.arm, { limitBrl, confirmation: "ARM_PRACTICE" });
  });

  auto.addEventListener("click", () => {
    if (state.busy) return;
    void send(TOPBAR_ENDPOINTS.auto, { enabled: state.model.auto !== true });
  });

  stakeApply.addEventListener("click", () => {
    if (state.busy) return;
    const value = currentStake();
    if (value === null) {
      setStatus("stake inválido");
      return;
    }
    void send(TOPBAR_ENDPOINTS.globalStake, { value });
  });

  function update(officeJson) {
    const model = buildTopBarModel(officeJson);
    state.model = model;

    const modeText = model.mode ?? EMPTY;
    nodes.mode.lastElementChild.textContent = model.practice ? `${modeText} · ZERO REAL` : "REAL BLOQUEADO";
    nodes.mode.classList?.toggle?.("is-ok", model.practice);
    nodes.mode.classList?.toggle?.("is-bad", !model.practice);
    nodes.mode.setAttribute("data-mode", modeText);

    nodes.connection.lastElementChild.textContent = connectionText(model);
    nodes.connection.classList?.toggle?.("is-ok", model.connected && model.healthy);
    nodes.connection.classList?.toggle?.("is-bad", !model.connected && model.hasOffice);

    nodes.arm.textContent = model.armed ? "DESARMAR" : "ARM";
    nodes.arm.setAttribute("data-armed", model.armed ? "true" : "false");
    nodes.arm.classList?.toggle?.("is-on", model.armed);

    nodes.auto.textContent = model.auto ? "AUTO ON" : "AUTO OFF";
    nodes.auto.setAttribute("data-auto", model.auto ? "true" : "false");
    nodes.auto.classList?.toggle?.("is-on", model.auto);

    const focused = doc.activeElement === nodes.stakeInput;
    if (!focused) nodes.stakeInput.value = model.stakeValue === null ? "" : String(model.stakeValue);
    const stakeLabel = model.defaultStake === null ? EMPTY : `R$ ${model.defaultStake.toFixed(2)}`;
    nodes.stakeWrap.setAttribute("title", `Stake por operação: ${stakeLabel} · teto global: ${model.globalMaxStake ?? EMPTY}`);

    nodes.markets.lastElementChild.textContent = `${model.openMarkets}/${model.totalMarkets}`;
    nodes.markets.setAttribute("data-open", String(model.openMarkets));
    nodes.markets.setAttribute("data-total", String(model.totalMarkets));
    nodes.markets.setAttribute("title", `${model.enabledMarkets} mercados habilitados de ${model.totalMarkets}`);

    nodes.active.lastElementChild.textContent = model.activeCount === null ? EMPTY : `${model.activeCount}/${model.activeLimit ?? EMPTY}`;
    nodes.gate.lastElementChild.textContent = gateText(model);
    return model;
  }

  rootEl.__tcTopBar = { update, state, nodes, endpoints: TOPBAR_ENDPOINTS };
  return rootEl.__tcTopBar;
}

export function mountTopBar(rootEl, officeJson, options = {}) {
  if (!rootEl) throw new Error("TC_V3_TOPBAR_ROOT_REQUIRED");
  const doc = options.document ?? globalThis.document;
  if (!doc || typeof doc.createElement !== "function") throw new Error("TC_V3_DOCUMENT_REQUIRED");
  let controller = rootEl.__tcTopBar;
  if (!controller) controller = createTopBar(doc, rootEl, options);
  controller.update(officeJson);
  return controller;
}

export function updateTopBar(rootEl, officeJson, options = {}) {
  return mountTopBar(rootEl, officeJson, options);
}
