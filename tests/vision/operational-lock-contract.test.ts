import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operational signal lock contract", () => {
  it("keeps one immutable operational direction while research continues", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain("operationalMutation");
    expect(app).toContain("/api/operational/lock");
    expect(app).toContain("OPERATIONAL_DECISION_SUPPRESSED_ACTIVE_OPERATION");
    expect(app).toContain("restoreOperationalSnapshot");
    expect(app).toContain("signal.entryPrice !== null");
  });

  it("does not invalidate pre-entry merely because Fast reverses", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain("/api/operational/entry");
    expect(app).toContain("/api/operational/settle");
    expect(app).toContain("signal.settlementAt");
    expect(app).toContain("state.operationalSettling");
  });

  it("keeps shadow outputs separate from the operational card", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain("SHADOW_UPDATE");
    expect(app).toContain("researchDirection");
    expect(app).toContain("OPERATIONAL_DECISION_SUPPRESSED_ACTIVE_OPERATION");
  });

  it("suppresses new operational signals when MarketContext is not valid", () => {
    const app = readFileSync("src/http/public/app.js", "utf8");
    expect(app).toContain("MarketContext");
    expect(app).toContain("restoreOperationalSnapshot");
  });
});
