/**
 * OPS UI — funcoes puras da UI operacional do TraceCom.
 * Sem dependencia de DOM: roda no browser (globalThis) e em Node (testes).
 * Nao contem logica estrategica nem agregacao cumulativa (a observabilidade
 * cumulativa e responsabilidade do backend: GET /api/iq/strategy/observability).
 */
(function (root) {
  "use strict";

  const DEFAULT_RESULT_DISPLAY_MS = 15_000;
  const OPEN_STATES = ["REQUESTED", "ACKNOWLEDGED", "SUBMITTED", "PENDING_ACK", "PENDING", "UNKNOWN", "OPEN"];

  const upper = (value) => String(value ?? "").toUpperCase();

  /** Operacao estrategica da V2: strategyVersion exata, nunca testOnly/excluded. */
  const isV2Operational = (row, strategyVersion) => Boolean(row)
    && typeof strategyVersion === "string" && strategyVersion.length > 0
    && row.strategyVersion === strategyVersion
    && row.testOnly !== true
    && row.excludedFromStats !== true;

  const isOpen = (row) => OPEN_STATES.includes(upper(row?.state));

  const settledTimestamp = (row) => {
    const raw = row?.settledAt ?? row?.expirationAt ?? null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
  };

  const formatSigned = (value) => (Number(value) >= 0 ? "+" : "-") + Math.abs(Number(value)).toFixed(2).replace(".", ",");

  /**
   * Texto acima do card: vazio por padrao; "EM OPERACAO" aberta; PnL apenas por uma janela curta apos o settlement.
   * Nunca mostra PATH_TEST, excludedFromStats, legado, outra strategyVersion ou resultado antigo.
   */
  const cardResultFor = (row, now, { strategyVersion, displayMs = DEFAULT_RESULT_DISPLAY_MS } = {}) => {
    if (!isV2Operational(row, strategyVersion)) return { text: "", cls: "" };
    if (isOpen(row)) return { text: "EM OPERAÇÃO", cls: "op" };
    if (upper(row.state) !== "SETTLED") return { text: "", cls: "" };
    const at = settledTimestamp(row);
    if (at === null || now - at > displayMs || now < at) return { text: "", cls: "" };
    if (upper(row.brokerResult) === "DRAW") return { text: "R$ 0,00", cls: "draw" };
    return { text: formatSigned(row.profit ?? 0), cls: Number(row.profit ?? 0) >= 0 ? "win" : "loss" };
  };

  /** Botao unico: estado derivado da conta selecionada + armed real do backend. */
  const executionButtonState = ({ mode, practiceArmed, realArmed }) => {
    const selected = upper(mode) === "REAL" ? "REAL" : "PRACTICE";
    const active = selected === "REAL" ? realArmed === true : practiceArmed === true;
    return { mode: selected, active, label: active ? "DESATIVAR" : "ATIVAR" };
  };

  /** Troca de conta: desarma a conta anterior; NUNCA arma a nova automaticamente. */
  const switchDisarmPlan = ({ to, practiceArmed, realArmed }) => {
    const disarm = [];
    if (upper(to) === "REAL" && practiceArmed === true) disarm.push("PRACTICE");
    if (upper(to) === "PRACTICE" && realArmed === true) disarm.push("REAL");
    return { disarm, autoArm: false };
  };

  root.OpsUI = {
    DEFAULT_RESULT_DISPLAY_MS,
    OPEN_STATES,
    isV2Operational,
    isOpen,
    cardResultFor,
    executionButtonState,
    switchDisarmPlan,
    formatSigned,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
