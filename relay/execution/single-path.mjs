import { Binary300Timing, OPERATIONAL_EXPIRY_SECONDS } from "./binary300.mjs";
import { ExecutionGate } from "./execution-gate.mjs";
import { Revalidation } from "./revalidation.mjs";
import { AccountRouter, ACCOUNT_PRACTICE } from "./account-router.mjs";

export class SinglePath {
  constructor({ timing = null, gate = null, revalidation = null, router = null, now = () => Date.now() } = {}) {
    this.now = now;
    this.timing = timing ?? new Binary300Timing({ now });
    this.gate = gate ?? new ExecutionGate({ now });
    this.router = router ?? new AccountRouter({ now });
    this.revalidation = revalidation ?? new Revalidation({ gate: this.gate, now });
  }

  evaluate({ decision = null, strategy = null, researchOnly = false, instrumentType = "BINARY", expirySeconds = OPERATIONAL_EXPIRY_SECONDS, accountMode = ACCOUNT_PRACTICE, realArmed = false, killSwitchEngaged = false, accountContext = null, serverTimeMs = null } = {}) {
    const timing = this.timing.canSubmit({ expirySeconds, serverTimeMs });
    const gateInput = { strategy, researchOnly, instrumentType, expirySeconds, timing, accountMode, realArmed, killSwitchEngaged, accountContext };
    const gate = this.gate.decide(gateInput);
    if (gate.allowed !== true) return { entry: { allowed: false, code: gate.code }, timing, gate, revalidation: null, route: null };
    const revalidation = this.revalidation.evaluate({ decision, timing, gateInput });
    if (revalidation.allowed !== true) return { entry: { allowed: false, code: revalidation.code }, timing, gate, revalidation, route: null };
    const route = this.router.route({ decision, gateDecision: gate, accountMode: gate.accountMode, realArmed, accountContext });
    if (route.routed !== true) return { entry: { allowed: false, code: route.code }, timing, gate, revalidation, route };
    return {
      entry: { allowed: true, code: "SINGLE_PATH_ALLOWED", expiryAt: timing.expiryAt, deadlineAt: timing.deadlineAt, placedAt: timing.placedAt, account: route.account, fingerprint: route.fingerprint },
      timing,
      gate,
      revalidation,
      route,
    };
  }
}
