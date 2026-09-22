export const DECISION_SIDES = Object.freeze(["BUY", "SELL"]);

export class Revalidation {
  constructor({ gate = null, stalenessMs = 5_000, now = () => Date.now() } = {}) {
    this.gate = gate;
    this.stalenessMs = Number.isFinite(Number(stalenessMs)) && Number(stalenessMs) >= 0 ? Number(stalenessMs) : 5_000;
    this.now = now;
  }

  evaluate({ decision = null, timing = null, gateInput = {} } = {}) {
    const at = this.now();
    const refuse = (code, gate = null) => ({ allowed: false, code, at, gate });
    if (!decision || typeof decision !== "object") return refuse("DECISION_MISSING");
    if (!DECISION_SIDES.includes(decision.side)) return refuse("DECISION_SIDE_INVALID");
    const decidedAt = Number(decision.decidedAt);
    if (!Number.isFinite(decidedAt)) return refuse("DECISION_TIMESTAMP_MISSING");
    if (at - decidedAt > this.stalenessMs) return refuse("DECISION_STALE");
    if (timing && timing.ok !== true) return refuse(timing.reason ?? "ENTRY_WINDOW_CLOSED");
    if (!this.gate || typeof this.gate.decide !== "function") return refuse("GATE_MISSING");
    const gate = this.gate.decide({ ...gateInput, timing: timing ?? gateInput?.timing ?? null });
    if (gate.allowed !== true) return refuse(gate.code, gate);
    return { allowed: true, code: "REVALIDATED", at, gate };
  }
}
