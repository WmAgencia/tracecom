import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operational signal lock contract", () => {
  it("keeps one immutable operational direction while research continues", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain('const OP_LOCKED_STATES = ["SIGNAL_LOCKED", "ENTRY_COUNTDOWN", "WAITING_ENTRY_CONFIRMATION", "POSITION_CONFIRMED", "POSITION_DETECTION_UNCERTAIN", "IN_POSITION", "WAITING_SETTLEMENT", "SETTLED"]');
    expect(app).toContain("const locked = state.channel.signal && OP_LOCKED_STATES.includes(state.channel.state)");
    expect(app).toContain("const operationalDecision = locked ? state.channel.signal.direction : decision");
    expect(app).toContain("análise interna não operacional");
  });

  it("does not invalidate pre-entry merely because Fast reverses", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain('reason: "market_context_invalid"');
    expect(app).not.toContain('reason: "opposite_confident_reversal"');
    expect(app).toContain("channel.countdownEndsAt = now + OP_ENTRY_MS");
    expect(app).toContain("channel.settlementAt = now + OP_HORIZON_MS");
  });

  it("keeps shadow outputs separate from the operational card", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain("SHADOW_UPDATE");
    expect(app).toContain("não operacional");
    expect(app).toContain("operationalDecision");
  });

  it("suppresses new operational signals when MarketContext is not valid", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain("OPERATIONAL_DECISION_SUPPRESSED_CONTEXT_INVALID");
    expect(app).toContain("state.marketContext.validationStatus !== \"VALID\"");
  });
});
