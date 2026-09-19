/* =====================================================================
 * TRACE/COM — OFFICE V3 · TOP BAR
 *
 * Frontend/UX ONLY. Compact operational strip: seletor PRACTICE ⇄ REAL,
 * conexão, ARM, AUTO, global stake + "apply to all", mercados e execution
 * gate. Every control calls a REAL endpoint:
 *
 *   SELETOR      POST /api/iq/account/select · GET /api/iq/account/context
 *   REAL ARM     POST /api/iq/real/arm (frase CONFIRMAR E ARMAR REAL)
 *   REAL DISARM  POST /api/iq/real/disarm
 *   REAL PREFLIGHT GET /api/iq/real/preflight
 *   ARM/DISARM   POST /api/iq/arm  · POST /api/iq/disarm
 *   AUTO         POST /api/iq/config/auto-execute
 *   GLOBAL STAKE POST /api/iq/config/global-stake
 *
 * REAL nasce LOCKED: a UI nunca envia ordem REAL; o ARM exige confirmação
 * explícita (saldo real, stake, exposição, posições, strategy, AUTO) e o
 * servidor aplica fail-closed. Nenhum segredo no DOM.
 *
 * Public API:
 *   buildTopBarModel(office)
 *   mountTopBar(rootEl, officeJson, options) → controller
 *   updateTopBar(rootEl, officeJson, options)
 * ===================================================================== */

export const TOPBAR_VERSION = "office-v3-topbar.1.1.0";

export const TOPBAR_ENDPOINTS = Object.freeze({
  arm: "/api/iq/arm",
  disarm: "/api/iq/disarm",
  auto: "/api/iq/config/auto-execute",
  globalStake: "/api/iq/config/global-stake",
});

/** Seleção de conta e REAL LOCKED/ARMED — endpoints server-side. */
export const ACCOUNT_ENDPOINTS = Object.freeze({
  context: "/api/iq/account/context",
  select: "/api/iq/account/select",
  realArm: "/api/iq/real/arm",
  realDisarm: "/api/iq/real/disarm",
  realPreflight: "/api/iq/real/preflight",
});

export const REAL_ARM_CONFIRMATION_PHRASE = "CONFIRMAR E ARMAR REAL";

/**
 * IQ OPTION modal endpoints — only EXISTING, public relay endpoints. The modal
 * never sends or stores email/password/token/ssid: credentials stay server-side
 * (iq-session-vault), and the UI only reads sanitized status snapshots.
 */
export const IQ_OPTION_ENDPOINTS = Object.freeze({
  status: "/api/iq/status",
  disconnect: "/api/iq/disconnect",
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
  const accountContext = source.accountContext && typeof source.accountContext === "object" ? source.accountContext : null;
  const context = accountContext?.context === "REAL" ? "REAL" : "PRACTICE";
  const accountState = typeof accountContext?.state === "string" ? accountContext.state : context;
  const realState = accountContext ? (accountContext.armed === true ? "REAL · ARMED" : "REAL · LOCKED") : "PRACTICE";
  const realAccount = accountContext?.realAccount && typeof accountContext.realAccount === "object" ? accountContext.realAccount : null;

  return {
    version: TOPBAR_VERSION,
    mode,
    practice: context !== "REAL",
    accountContext: context,
    accountState,
    realState,
    realArmed: accountContext ? accountContext.armed === true && accountContext.realExecutionEnabled === true : false,
    realLocked: context === "REAL" && !(accountContext ? accountContext.armed === true : false),
    realTradingEnabled: accountContext?.realTradingEnabled === true,
    realExecutionForbidden: !(accountContext ? accountContext.realExecutionEnabled === true : false),
    realAccountAvailable: realAccount?.available === true,
    realBalance: toNumber(realAccount?.balance),
    realCurrency: typeof realAccount?.currency === "string" ? realAccount.currency : null,
    lockedReason: accountContext?.lockedReason ?? null,
    maxExposure: toNumber(accountContext?.maxExposure),
    maxPositions: toNumber(accountContext?.maxPositions),
    strategy: typeof accountContext?.strategy === "string" ? accountContext.strategy : null,
    allowlist: accountContext?.allowlist ?? null,
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

/**
 * IQ OPTION modal model — derived from the real office snapshot plus the
 * sanitized relay status response (GET /api/iq/status). No credential field is
 * ever present. MCP is shown only when the runtime actually reports it; when
 * absent the modal says so explicitly instead of inventing a state.
 */
export function buildIqOptionModel(office, status = null) {
  const source = office ?? {};
  const statusData = status && typeof status === "object" ? status : null;
  const statusLegacy = statusData && (statusData.marketData || statusData.account) ? statusData : null;
  const connection = statusLegacy
    ? { connected: statusLegacy.marketData?.connected === true, healthy: statusLegacy.marketData?.healthy === true, host: statusLegacy.marketData?.host ?? null }
    : { connected: source.connection?.connected === true, healthy: source.connection?.healthy === true, host: source.connection?.host ?? null };
  const authState = statusData?.state ?? null;
  const statusDisconnected = authState === "DISCONNECTED" || authState === "ERROR";
  const connected = statusDisconnected ? false : connection.connected === true || authState === "CONNECTED_READ_ONLY";
  const healthy = statusDisconnected ? false : connection.healthy;
  const mode = statusData?.mode ?? source.mode ?? null;
  const account = statusLegacy?.account ?? source.legacy?.account ?? source.account ?? null;
  const balance = toNumber(account?.balance);
  const currency = typeof account?.currency === "string" ? account.currency : null;
  const mcp = source.mcp ?? source.aux?.mcp ?? source.runtime?.mcp ?? null;
  const accountContext = source.accountContext && typeof source.accountContext === "object" ? source.accountContext : null;

  return {
    version: "office-v3-iq-option.1.1.0",
    connected,
    authState,
    mode,
    practice: (accountContext?.context ?? mode) !== "REAL",
    host: connection.host,
    healthy,
    reconnects: toNumber(source.connection?.reconnects ?? statusLegacy?.marketData?.reconnects),
    accountType: account?.type ?? null,
    accountIdMasked: typeof account?.id === "string" && account.id.length > 4 ? `***${account.id.slice(-4)}` : null,
    currency,
    balance,
    balanceText: balance === null ? EMPTY : `${currency ? `${currency} ` : ""}${balance.toFixed(2)}`,
    verified: account?.verified === true,
    hasReal: account?.hasReal === true,
    wsText: connected ? (healthy ? "ONLINE" : "CONECTADO · DEGRADADO") : authState === "TWO_FACTOR_REQUIRED" ? "AGUARDANDO 2FA" : "DESCONECTADO",
    mcpStatus: mcp ? (mcp.status ?? (mcp.connected === true ? "CONECTADO" : "SEM SESSÃO")) : "SEM STATUS NO SNAPSHOT",
    mcpKnown: Boolean(mcp),
    realBlocked: accountContext ? accountContext.realExecutionEnabled !== true : true,
    accountSwitchSupported: true,
    accountContext: accountContext?.context === "REAL" ? "REAL" : "PRACTICE",
    realState: accountContext ? (accountContext.armed === true ? "REAL · ARMED" : "REAL · LOCKED") : "PRACTICE",
    globalStake: toNumber(source.config?.globalMaxStake),
    defaultStake: toNumber(source.config?.defaultStake),
    hardCap: toNumber(source.config?.hardCap),
    autoExecute: source.config?.autoExecute === true,
    brainGeneration: source.config?.brainGeneration ?? source.brain?.generation ?? null,
    jitEnabled: source.config?.jitEnabled === true,
  };
}

function gateText(model) {
  const state = typeof model.executionGate?.state === "string" ? model.executionGate.state : null;
  if (state) return state;
  if (model.killSwitch && model.killSwitch.executionEnabled === false) return "BLOCKED";
  return model.armed ? "ARMED" : "DISARMED";
}

/**
 * Model do modal CONTA REAL — somente leitura. Deriva do snapshot do Office e do
 * status server-side (GET /api/iq/account/context / GET /api/iq/real/preflight).
 * Nunca contém segredo e nunca simula saldo: indisponível => available:false.
 */
export function buildRealAccountModel(office = null, accountStatus = null) {
  const base = buildTopBarModel(office);
  const statusData = accountStatus && typeof accountStatus === "object" ? accountStatus : null;
  const context = statusData?.context === "REAL" ? "REAL" : base.accountContext;
  const armed = statusData ? statusData.armed === true : base.realArmed;
  const realAccount = statusData?.realAccount && typeof statusData.realAccount === "object"
    ? statusData.realAccount
    : { available: base.realAccountAvailable, balance: base.realBalance, currency: base.realCurrency, error: null };
  const balance = toNumber(realAccount.balance);
  const currency = typeof realAccount.currency === "string" ? realAccount.currency : null;
  const preflight = statusData?.lastPreflight && typeof statusData.lastPreflight === "object" ? statusData.lastPreflight : null;
  const blockedBy = Array.isArray(preflight?.blockedBy) ? preflight.blockedBy : [];
  return {
    version: "office-v3-real-account.1.0.0",
    context,
    state: armed ? "REAL · ARMED" : context === "REAL" ? "REAL · LOCKED" : "PRACTICE",
    armed,
    realAvailable: realAccount.available === true,
    accessError: typeof realAccount.error === "string" ? realAccount.error : null,
    balance,
    currency,
    balanceText: balance === null ? EMPTY : `${currency ? `${currency} ` : ""}${balance.toFixed(2)}`,
    maxStake: toNumber(statusData?.maxRealStake) ?? base.stakeValue,
    hardCap: toNumber(statusData?.hardCap) ?? base.hardCap,
    maxExposure: toNumber(statusData?.maxExposure) ?? base.maxExposure,
    maxPositions: toNumber(statusData?.maxPositions) ?? base.maxPositions,
    strategy: typeof statusData?.strategy === "string" ? statusData.strategy : base.strategy,
    realTradingEnabled: statusData ? statusData.realTradingEnabled === true : base.realTradingEnabled,
    auto: base.auto,
    preflightOk: preflight ? preflight.ok === true : false,
    preflightText: preflight ? (preflight.ok === true ? "PASS" : `BLOCK: ${blockedBy.join(", ")}`) : "NÃO VERIFICADO",
    shadowOnly: statusData?.shadowOnly ?? base.allowlist?.shadowOnly ?? [],
    phrase: REAL_ARM_CONFIRMATION_PHRASE,
  };
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

  const real = bit(doc, rootEl, "button", "tc-topbar-btn", "PRACTICE ⇄ REAL", "real");
  real.setAttribute("type", "button");
  real.setAttribute("aria-haspopup", "dialog");
  real.setAttribute("title", "Selecionar conta PRACTICE ⇄ REAL (REAL inicia LOCKED)");

  /* ---- IQ OPTION modal (T2) — status/config, never credentials ---- */
  const iq = bit(doc, rootEl, "button", "tc-topbar-btn", "IQ OPTION", "iq");
  iq.setAttribute("type", "button");
  iq.setAttribute("aria-haspopup", "dialog");

  const iqModal = el(doc, "div", "tc-iq-modal");
  iqModal.hidden = true;
  iqModal.setAttribute("data-tc-v3", "iq-option");
  iqModal.setAttribute("role", "dialog");
  iqModal.setAttribute("aria-label", "Conexão e configuração IQ Option (PRACTICE)");
  const iqHead = el(doc, "div", "tc-iq-head");
  iqHead.append(el(doc, "h3", "tc-iq-title", "IQ OPTION"), el(doc, "span", "tc-iq-sub", "PRACTICE · ZERO REAL"));
  const iqClose = el(doc, "button", "tc-iq-close", "×");
  iqClose.setAttribute("type", "button");
  iqClose.setAttribute("aria-label", "Fechar");
  iqHead.appendChild(iqClose);
  const iqBody = el(doc, "div", "tc-iq-body");
  const iqActions = el(doc, "div", "tc-iq-actions");
  const iqRefresh = el(doc, "button", "tc-topbar-btn", "ATUALIZAR");
  iqRefresh.setAttribute("type", "button");
  iqRefresh.setAttribute("data-iq", "refresh");
  const iqDisconnect = el(doc, "button", "tc-topbar-btn", "DESCONECTAR");
  iqDisconnect.setAttribute("type", "button");
  iqDisconnect.setAttribute("data-iq", "disconnect");
  const iqReconnect = el(doc, "button", "tc-topbar-btn is-disabled", "RECONECTAR");
  iqReconnect.setAttribute("type", "button");
  iqReconnect.setAttribute("data-iq", "reconnect");
  iqReconnect.disabled = true;
  iqReconnect.setAttribute("aria-disabled", "true");
  iqReconnect.setAttribute("title", "Reconexão com credenciais é server-side (vault do relay); esta UI nunca manipula senha/token/SSID.");
  iqActions.append(iqRefresh, iqDisconnect, iqReconnect);
  const iqNote = el(doc, "p", "tc-iq-note", "Nenhuma senha, token, cookie ou SSID é digitado, exibido ou armazenado aqui — apenas status sanitizado do servidor.");
  iqModal.append(iqHead, iqBody, iqActions, iqNote);
  rootEl.appendChild(iqModal);

  const status = bit(doc, rootEl, "div", "tc-topbar-status", "", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  /* ---- REAL account modal (LOCKED/ARMED; confirmação explícita, sem segredos) ---- */
  const realModal = el(doc, "div", "tc-iq-modal");
  realModal.hidden = true;
  realModal.setAttribute("data-tc-v3", "real-account");
  realModal.setAttribute("role", "dialog");
  realModal.setAttribute("aria-label", "Conta REAL — LOCKED/ARMED");
  const realHead = el(doc, "div", "tc-iq-head");
  realHead.append(el(doc, "h3", "tc-iq-title", "CONTA REAL"), el(doc, "span", "tc-iq-sub", "LOCKED / ARMED"));
  const realClose = el(doc, "button", "tc-iq-close", "×");
  realClose.setAttribute("type", "button");
  realClose.setAttribute("aria-label", "Fechar");
  realHead.appendChild(realClose);
  const realBody = el(doc, "div", "tc-iq-body");
  const realAckWrap = el(doc, "label", "tc-iq-row");
  realAckWrap.setAttribute("data-real-row", "ack");
  const realAck = el(doc, "input");
  realAck.setAttribute("type", "checkbox");
  realAck.setAttribute("data-tb", "real-ack");
  realAck.setAttribute("aria-label", "Confirmo operar na conta real");
  realAckWrap.append(el(doc, "span", "tc-iq-label", "RISCO ACEITO"), realAck);
  const realActions = el(doc, "div", "tc-iq-actions");
  const realSelectPractice = el(doc, "button", "tc-topbar-btn", "IR PARA PRACTICE");
  realSelectPractice.setAttribute("type", "button");
  realSelectPractice.setAttribute("data-tb", "real-select-practice");
  const realSelectReal = el(doc, "button", "tc-topbar-btn", "SELECIONAR REAL");
  realSelectReal.setAttribute("type", "button");
  realSelectReal.setAttribute("data-tb", "real-select-real");
  const realArmButton = el(doc, "button", "tc-topbar-btn", "CONFIRMAR E ARMAR REAL");
  realArmButton.setAttribute("type", "button");
  realArmButton.setAttribute("data-tb", "real-arm");
  realArmButton.setAttribute("data-real-arm", "true");
  const realDisarmButton = el(doc, "button", "tc-topbar-btn", "DESARMAR REAL");
  realDisarmButton.setAttribute("type", "button");
  realDisarmButton.setAttribute("data-tb", "real-disarm");
  const realRefresh = el(doc, "button", "tc-topbar-btn", "ATUALIZAR");
  realRefresh.setAttribute("type", "button");
  realRefresh.setAttribute("data-tb", "real-refresh");
  realActions.append(realSelectPractice, realSelectReal, realArmButton, realDisarmButton, realRefresh);
  const realNote = el(doc, "p", "tc-iq-note", "REAL nasce LOCKED. Nenhuma ordem é enviada pela UI; o servidor decide com fail-closed (REAL_TRADING_ENABLED, ARM, kill switch, risk gate, data quality, allowlist, hard cap, mercado e idempotência). Estratégias experimentais permanecem SHADOW.");
  realModal.append(realHead, realBody, realAckWrap, realActions, realNote);
  rootEl.appendChild(realModal);

  const state = {
    model: buildTopBarModel(null),
    office: null,
    iqStatus: null,
    accountStatus: null,
    busy: false,
  };

  const nodes = { mode, connection, arm, auto, stakeWrap, stakeInput, stakeApply, markets, active, gate, real, iq, iqModal, iqBody, status, realModal, realBody, realSelectPractice, realSelectReal, realArmButton, realDisarmButton, realAck };

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

  /* ---- IQ OPTION modal behavior (status only, never credentials) ---- */

  function iqRow(key, label, value, tone) {
    const row = el(doc, "div", "tc-iq-row");
    row.setAttribute("data-iq-row", key);
    const valueNode = el(doc, "b", "tc-iq-value", value ?? EMPTY);
    if (tone) valueNode.setAttribute("data-tone", tone);
    row.append(el(doc, "span", "tc-iq-label", label), valueNode);
    return row;
  }

  function renderIqModal() {
    const model = buildIqOptionModel(state.office, state.iqStatus);
    iqBody.textContent = "";
    iqBody.append(
      iqRow("connection", "CONEXÃO", model.connected ? "CONECTADO" : "DESCONECTADO", model.connected ? "ok" : "bad"),
      iqRow("ws", "WS", model.wsText, model.healthy ? "ok" : model.connected ? "warn" : "bad"),
      iqRow("mode", "MODO", model.practice ? `${model.mode ?? "PRACTICE"} · ZERO REAL` : "REAL", model.practice ? "ok" : "bad"),
      iqRow("account", "CONTA", model.accountType ?? EMPTY, null),
      iqRow("balance", "SALDO", model.balanceText, model.balance === null ? "muted" : "ok"),
      iqRow("mcp", "MCP", model.mcpStatus, model.mcpKnown ? null : "muted"),
      iqRow("stake", "STAKE GLOBAL", model.defaultStake === null ? EMPTY : `R$ ${model.defaultStake.toFixed(2)} · teto ${model.hardCap === null ? EMPTY : `R$ ${model.hardCap.toFixed(2)}`}`, null),
      iqRow("auto", "AUTO", model.autoExecute ? "ON" : "OFF", null),
      iqRow("jit", "JIT/QUALITY", model.jitEnabled ? "ATIVO" : "OFF", null),
      iqRow("real", "REAL", "BLOQUEADO · ZERO REAL", "bad"),
      iqRow("switch", "TROCA DE CONTA", "NÃO SUPORTADA (PRACTICE ÚNICA)", "muted"),
    );
    nodes.iq.classList?.toggle?.("is-on", model.connected);
    nodes.iq.setAttribute("data-connected", model.connected ? "true" : "false");
    nodes.iqModal.setAttribute("data-connected", model.connected ? "true" : "false");
    return model;
  }

  function iqRequest(endpoint, method = "GET") {
    const fetchImpl = (typeof options.fetchImpl === "function" && options.fetchImpl) || globalThis.fetch;
    if (typeof fetchImpl !== "function") return Promise.resolve(null);
    return Promise.resolve(fetchImpl(endpoint, { method, headers: { accept: "application/json" } }))
      .then((response) => {
        if (!response || response.ok !== true) throw new Error(`HTTP ${response ? response.status : "?"}`);
        return typeof response.json === "function" ? response.json().catch(() => null) : null;
      })
      .catch((error) => {
        setStatus(`falha · ${endpoint} · ${String(error && error.message ? error.message : error)}`);
        return null;
      });
  }

  function refreshIqModal() {
    setStatus("atualizando status IQ…");
    return iqRequest(IQ_OPTION_ENDPOINTS.status).then((json) => {
      if (json) state.iqStatus = json;
      renderIqModal();
      setStatus("ok · status IQ atualizado");
      return json;
    });
  }

  function openIqModal() {
    iqModal.hidden = false;
    renderIqModal();
    void refreshIqModal();
  }

  function closeIqModal() {
    iqModal.hidden = true;
  }

  iq.addEventListener("click", () => (iqModal.hidden ? openIqModal() : closeIqModal()));
  iqClose.addEventListener("click", closeIqModal);
  iqRefresh.addEventListener("click", () => void refreshIqModal());
  iqDisconnect.addEventListener("click", () => {
    setStatus("desconectando IQ…");
    void iqRequest(IQ_OPTION_ENDPOINTS.disconnect, "POST").then((json) => {
      if (json) state.iqStatus = { ...(state.iqStatus ?? {}), ...json, state: json.state ?? "DISCONNECTED" };
      renderIqModal();
      setStatus("ok · desconectado");
      if (typeof options.onRefresh === "function") options.onRefresh();
    });
  });

  /* ---- REAL account modal: seleção PRACTICE ⇄ REAL + LOCKED/ARMED (server-side) ---- */

  function renderRealModal() {
    const model = buildRealAccountModel(state.office, state.accountStatus);
    realBody.textContent = "";
    realBody.append(
      iqRow("context", "CONTEXTO", model.context, model.context === "REAL" ? "warn" : "ok"),
      iqRow("state", "ESTADO", model.state, model.armed ? "ok" : "muted"),
      iqRow("balance", "SALDO REAL", model.balanceText, model.realAvailable ? "ok" : "bad"),
      iqRow("access", "ACESSO", model.realAvailable ? "SOMENTE LEITURA · OK" : `INDISPONÍVEL (${model.accessError ?? "ERRO"})`, model.realAvailable ? "ok" : "bad"),
      iqRow("stake", "STAKE MÁX", model.maxStake === null ? EMPTY : `R$ ${model.maxStake.toFixed(2)} · teto ${model.hardCap === null ? EMPTY : `R$ ${model.hardCap.toFixed(2)}`}`, null),
      iqRow("exposure", "EXPOSIÇÃO MÁX", model.maxExposure === null ? EMPTY : `R$ ${model.maxExposure.toFixed(2)}`, null),
      iqRow("positions", "POSIÇÕES MÁX", model.maxPositions === null ? EMPTY : String(model.maxPositions), null),
      iqRow("strategy", "STRATEGY", model.strategy ?? "PROFESSIONAL_BRAIN_G2 (somente quando armado)", null),
      iqRow("auto", "AUTO", model.auto ? "ON" : "OFF", null),
      iqRow("trading", "REAL_TRADING_ENABLED", model.realTradingEnabled ? "true" : "false", model.realTradingEnabled ? "warn" : "muted"),
      iqRow("preflight", "PREFLIGHT", model.preflightText, model.preflightOk ? "ok" : "warn"),
      iqRow("shadow", "SHADOW (sempre)", Array.isArray(model.shadowOnly) ? model.shadowOnly.join(", ") : EMPTY, "muted"),
    );
    realArmButton.disabled = !(model.realAvailable && model.context === "REAL") || model.armed;
    realDisarmButton.disabled = !model.armed;
    realSelectReal.disabled = model.context === "REAL";
    realSelectPractice.disabled = model.context === "PRACTICE";
    realModal.setAttribute("data-context", model.context);
    realModal.setAttribute("data-state", model.armed ? "ARMED" : model.context === "REAL" ? "LOCKED" : "PRACTICE");
    return model;
  }

  function refreshAccountStatus() {
    setStatus("atualizando conta…");
    return iqRequest(ACCOUNT_ENDPOINTS.context).then((json) => {
      if (json) state.accountStatus = json;
      if (json && json.context === "REAL") {
        return iqRequest(ACCOUNT_ENDPOINTS.realPreflight).then((preflight) => {
          if (preflight) state.accountStatus = { ...state.accountStatus, lastPreflight: preflight };
          renderRealModal();
          setStatus("ok · conta atualizada");
          return state.accountStatus;
        });
      }
      renderRealModal();
      setStatus("ok · conta atualizada");
      return state.accountStatus;
    });
  }

  function openRealModal() {
    realModal.hidden = false;
    renderRealModal();
    void refreshAccountStatus();
  }

  function closeRealModal() {
    realModal.hidden = true;
  }

  real.addEventListener("click", () => (realModal.hidden ? openRealModal() : closeRealModal()));
  realClose.addEventListener("click", closeRealModal);
  realRefresh.addEventListener("click", () => void refreshAccountStatus());
  realSelectPractice.addEventListener("click", () => {
    if (state.busy) return;
    void send(ACCOUNT_ENDPOINTS.select, { context: "PRACTICE" }).then(() => refreshAccountStatus());
  });
  realSelectReal.addEventListener("click", () => {
    if (state.busy) return;
    void send(ACCOUNT_ENDPOINTS.select, { context: "REAL" }).then(() => refreshAccountStatus());
  });
  realArmButton.addEventListener("click", () => {
    if (state.busy) return;
    if (realAck.checked !== true) { setStatus("marque RISCO ACEITO para armar REAL"); return; }
    const stake = currentStake();
    void send(ACCOUNT_ENDPOINTS.realArm, { phrase: REAL_ARM_CONFIRMATION_PHRASE, acknowledgeRisk: true, maxStake: stake }).then((json) => {
      if (json && typeof json === "object") state.accountStatus = { ...(state.accountStatus ?? {}), ...json };
      return refreshAccountStatus();
    });
  });
  realDisarmButton.addEventListener("click", () => {
    if (state.busy) return;
    void send(ACCOUNT_ENDPOINTS.realDisarm, {}).then(() => refreshAccountStatus());
  });

  function update(officeJson) {
    const model = buildTopBarModel(officeJson);
    state.model = model;
    state.office = officeJson ?? null;

    const modeText = model.mode ?? EMPTY;
    nodes.mode.lastElementChild.textContent = model.accountContext === "REAL" ? model.realState : `${modeText} · ZERO REAL`;
    nodes.mode.classList?.toggle?.("is-ok", model.accountContext !== "REAL");
    nodes.mode.classList?.toggle?.("is-bad", model.accountContext === "REAL" && !model.realArmed);
    nodes.mode.setAttribute("data-mode", modeText);
    nodes.mode.setAttribute("data-account-context", model.accountContext);

    nodes.real.textContent = model.accountContext === "REAL" ? model.realState : "PRACTICE ⇄ REAL";
    nodes.real.setAttribute("data-context", model.accountContext);
    nodes.real.setAttribute("data-real", model.realArmed ? "ARMED" : model.accountContext === "REAL" ? "LOCKED" : "OFF");
    nodes.real.disabled = false;
    nodes.real.classList?.toggle?.("is-on", model.realArmed);
    nodes.real.classList?.toggle?.("is-bad", model.accountContext === "REAL" && !model.realArmed);

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
    if (realModal.hidden === false) renderRealModal();
    if (iqModal.hidden === false) renderIqModal();
    else nodes.iq.setAttribute("data-connected", buildIqOptionModel(officeJson, state.iqStatus).connected ? "true" : "false");
    return model;
  }

  rootEl.__tcTopBar = {
    update,
    state,
    nodes,
    endpoints: TOPBAR_ENDPOINTS,
    accountEndpoints: ACCOUNT_ENDPOINTS,
    iq: {
      model: () => buildIqOptionModel(state.office, state.iqStatus),
      open: openIqModal,
      close: closeIqModal,
      refresh: refreshIqModal,
      isOpen: () => iqModal.hidden === false,
    },
    real: {
      model: () => buildRealAccountModel(state.office, state.accountStatus),
      open: openRealModal,
      close: closeRealModal,
      refresh: refreshAccountStatus,
      isOpen: () => realModal.hidden === false,
      phrase: REAL_ARM_CONFIRMATION_PHRASE,
    },
  };
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
