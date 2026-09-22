import { assertOperationalExpiry, OPERATIONAL_EXPIRY_SECONDS } from "./binary300.mjs";

export const STRATEGY_STATUS_ACTIVE = "ACTIVE";
export const ACCOUNT_MODE_PRACTICE = "PRACTICE";
export const ACCOUNT_MODE_REAL = "REAL";

export class ExecutionGateRefusal extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = "ExecutionGateRefusal";
    this.code = code;
    this.details = details;
  }
}

export class ExecutionGate {
  constructor({ now = () => Date.now() } = {}) { this.now = now; }

  decide({ strategy = null, researchOnly = false, instrumentType = "BINARY", expirySeconds = OPERATIONAL_EXPIRY_SECONDS, timing = null, accountMode = ACCOUNT_MODE_PRACTICE, realArmed = false, killSwitchEngaged = false, accountContext = null } = {}) {
    const refuse = (code, details = null) => ({ allowed: false, code, details, accountMode: null, at: this.now(), executionMode: "NONE" });
    const allow = (mode) => ({ allowed: true, code: "ALLOWED", details: null, accountMode: mode, at: this.now(), executionMode: mode === ACCOUNT_MODE_REAL ? "REAL_ORDER" : "PRACTICE_ORDER" });

    if (killSwitchEngaged === true) return refuse("KILL_SWITCH_ENGAGED");
    if (researchOnly === true) return refuse("RESEARCH_ONLY_DENY");
    if (!strategy || typeof strategy !== "object") return refuse("STRATEGY_MISSING");
    if (strategy.status !== STRATEGY_STATUS_ACTIVE) return refuse("STRATEGY_NOT_ACTIVE", { status: strategy.status ?? null });
    if (strategy.executable !== true) return refuse("STRATEGY_NOT_EXECUTABLE", { status: strategy.status ?? null });
    if (strategy.hashPresent === false || strategy.strategyHash === null || strategy.strategyHash === undefined) return refuse("STRATEGY_HASH_MISSING");
    if (instrumentType !== "BINARY") return refuse("BINARY_ONLY", { instrumentType });
    try { assertOperationalExpiry(expirySeconds); } catch (error) { return refuse(error?.code ?? "EXPIRY_POLICY_ERROR", { expirySeconds }); }
    if (timing && timing.ok !== true) return refuse(timing.reason ?? "ENTRY_WINDOW_CLOSED", { timing });
    if (accountMode === ACCOUNT_MODE_REAL) {
      if (realArmed !== true) return refuse("REAL_FAIL_CLOSED");
      if (!accountContext || accountContext.mode !== ACCOUNT_MODE_REAL) return refuse("REAL_ACCOUNT_CONTEXT_REQUIRED");
      return allow(ACCOUNT_MODE_REAL);
    }
    if (accountMode !== ACCOUNT_MODE_PRACTICE) return refuse("ACCOUNT_MODE_INVALID", { accountMode });
    if (accountContext && accountContext.mode === ACCOUNT_MODE_REAL) return refuse("ACCOUNT_CONTEXT_MISMATCH");
    return allow(ACCOUNT_MODE_PRACTICE);
  }
}
