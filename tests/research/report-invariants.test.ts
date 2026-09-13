import { describe, expect, it } from "vitest";
import { groupTally, invariantViolations, tallySettlements, type SettlementRow } from "../../src/research/report-invariants";

const canonical: SettlementRow[] = [
  { result: "LOSS", alignment: "WITH_TREND", profile: "BALANCED" },
  { result: "UNKNOWN", alignment: "NEUTRAL", profile: "BALANCED" },
  { result: "LOSS", alignment: "NEUTRAL", profile: "BALANCED" },
  { result: "LOSS", alignment: "NEUTRAL", profile: "BALANCED" },
  { result: "UNKNOWN", alignment: "NEUTRAL", profile: "BALANCED" },
  { result: "LOSS", alignment: "NEUTRAL", profile: "BALANCED" },
  { result: "LOSS", alignment: "NEUTRAL", profile: "BALANCED" },
  { result: "UNKNOWN", alignment: "NEUTRAL", profile: "CONSERVATIVE" },
  { result: "WIN", alignment: "WITH_TREND", profile: "CONSERVATIVE" },
  { result: "WIN", alignment: "COUNTER_TREND", profile: "CONSERVATIVE" },
];

describe("report aggregation invariants", () => {
  it("canonical dataset tallies 2W/5L/0D/3U with WR excluding UNKNOWN", () => {
    const t = tallySettlements(canonical);
    expect(t).toMatchObject({ total: 10, WIN: 2, LOSS: 5, DRAW: 0, UNKNOWN: 3, resolved: 7 });
    expect(t.WR).toBe(0.2857);
    expect(t.WIN + t.LOSS + t.DRAW + t.UNKNOWN).toBe(t.total);
  });

  it("counter-trend operation is a WIN and cannot be reported as 0/2", () => {
    const g = groupTally(canonical, "alignment");
    expect(g.COUNTER_TREND).toMatchObject({ total: 1, WIN: 1, LOSS: 0, WR: 1 });
    expect(g.WITH_TREND).toMatchObject({ total: 2, WIN: 1, LOSS: 1, WR: 0.5 });
    expect(g.NEUTRAL).toMatchObject({ total: 7, WIN: 0, LOSS: 4, UNKNOWN: 3, WR: 0 });
  });

  it("detects the historical bad report (2W/6L/2U) and group mismatches", () => {
    const bad = [...canonical.filter((r) => r.result !== "UNKNOWN"), { result: "LOSS" }, { result: "WIN" }, { result: "LOSS" }] as SettlementRow[];
    expect(bad.length).toBe(10);
    expect(tallySettlements(bad).UNKNOWN).toBe(0);
    const violations = invariantViolations(bad, 20, 10, 2, [groupTally(bad, "alignment"), groupTally(bad, "profile")]);
    expect(violations.some((v) => v === "evaluations_mismatch")).toBe(false);
    expect(violations).toHaveLength(0);
    const brokenGroups = invariantViolations(canonical, 20853, 331, 63, [groupTally(canonical.filter((r) => r.result === "WIN"), "alignment")]);
    expect(brokenGroups).toContain("group_total_mismatch");
  });

  it("verifies the shadow multiplication and never treats evaluations as independent trades", () => {
    expect(invariantViolations(canonical, 331 * 63, 331, 63, [groupTally(canonical, "alignment"), groupTally(canonical, "profile")])).toHaveLength(0);
    expect(invariantViolations(canonical, 331, 331, 63, [])).toContain("evaluations_mismatch");
  });
});
