export const ACCOUNT_PRACTICE = "PRACTICE";
export const ACCOUNT_REAL = "REAL";

const FINGERPRINT_FIELDS = ["marketKey", "side", "strategyId", "strategyVersion", "strategyHash", "snapshotId", "decidedAt"];

export function decisionFingerprint(decision) {
  if (!decision || typeof decision !== "object") return null;
  const source = decision.fingerprint && typeof decision.fingerprint === "object" ? decision.fingerprint : decision;
  return FINGERPRINT_FIELDS.map((field) => `${field}=${source[field] ?? ""}`).join("|");
}

export function assertParity(practice, real) {
  const a = decisionFingerprint(practice);
  const b = decisionFingerprint(real);
  if (a === null || b === null || a !== b) return { ok: false, code: "ACCOUNT_PARITY_VIOLATION", practice: a, real: b };
  return { ok: true, code: "PARITY_OK", fingerprint: a };
}

export class AccountRouter {
  constructor({ now = () => Date.now() } = {}) { this.now = now; }

  route({ decision = null, gateDecision = null, accountMode = ACCOUNT_PRACTICE, realArmed = false, accountContext = null } = {}) {
    const at = this.now();
    const refuse = (code) => ({ routed: false, code, account: null, venue: null, requiresConfirmation: false, fingerprint: null, at });
    if (!gateDecision || gateDecision.allowed !== true) return refuse("ROUTE_DENIED");
    if (gateDecision.accountMode !== accountMode) return refuse("ROUTE_MODE_MISMATCH");
    const fingerprint = decisionFingerprint(decision);
    if (fingerprint === null) return refuse("ROUTE_DECISION_INVALID");
    if (accountMode === ACCOUNT_REAL) {
      if (realArmed !== true) return refuse("REAL_FAIL_CLOSED");
      if (!accountContext || accountContext.mode !== ACCOUNT_REAL) return refuse("REAL_ACCOUNT_CONTEXT_REQUIRED");
      return { routed: true, code: "ROUTED_REAL", account: ACCOUNT_REAL, venue: "IQ_REAL", requiresConfirmation: true, fingerprint, at };
    }
    if (accountMode !== ACCOUNT_PRACTICE) return refuse("ROUTE_MODE_INVALID");
    if (accountContext && accountContext.mode === ACCOUNT_REAL) return refuse("ROUTE_CONTEXT_MISMATCH");
    return { routed: true, code: "ROUTED_PRACTICE", account: ACCOUNT_PRACTICE, venue: "IQ_PRACTICE", requiresConfirmation: false, fingerprint, at };
  }
}
