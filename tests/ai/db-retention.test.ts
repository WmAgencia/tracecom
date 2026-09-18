import { describe, expect, it } from "vitest";
import {
  cutoffMs,
  hoursToMs,
  isPartitionDroppable,
  parsePartitionBound,
  partitionBoundsForDay,
  partitionNameForDay,
  planAuditPartitions,
  utcDayStartMs,
} from "../../scripts/db-retention.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-18T14:30:00.000Z");

describe("db-retention windows", () => {
  it("converts hours to ms and derives the cutoff", () => {
    expect(hoursToMs(24)).toBe(DAY);
    expect(cutoffMs(NOW, 24)).toBe(NOW - DAY);
    expect(cutoffMs(NOW, 0)).toBe(NOW);
    expect(hoursToMs(-5)).toBe(0);
    expect(hoursToMs("48")).toBe(2 * DAY);
  });
});

describe("db-retention partition math", () => {
  it("resolves the UTC day start", () => {
    expect(new Date(utcDayStartMs(NOW)).toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(new Date(utcDayStartMs(Date.parse("2026-09-18T00:00:00.000Z"))).toISOString()).toBe("2026-09-18T00:00:00.000Z");
  });

  it("names daily audit partitions deterministically", () => {
    expect(partitionNameForDay(NOW)).toBe("iq_audit_trail_20260918");
    expect(partitionNameForDay(Date.parse("2026-10-01T23:59:59.999Z"))).toBe("iq_audit_trail_20261001");
  });

  it("computes [from, to) bounds for a day", () => {
    const b = partitionBoundsForDay(NOW);
    expect(b.fromIso).toBe("2026-09-18T00:00:00.000Z");
    expect(b.toIso).toBe("2026-09-19T00:00:00.000Z");
    expect(b.toMs - b.fromMs).toBe(DAY);
  });

  it("parses pg_get_expr partition bounds", () => {
    expect(parsePartitionBound("DEFAULT")).toEqual({ isDefault: true, fromMs: null, toMs: null });
    const parsed = parsePartitionBound("FOR VALUES FROM ('2026-09-17 00:00:00+00') TO ('2026-09-18 00:00:00+00')");
    expect(parsed).not.toBeNull();
    expect(new Date(parsed!.fromMs!).toISOString()).toBe("2026-09-17T00:00:00.000Z");
    expect(new Date(parsed!.toMs!).toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(parsePartitionBound("garbage")).toBeNull();
  });
});

describe("db-retention partition plan", () => {
  const boundsFor = (day: string) => {
    const p = parsePartitionBound(`FOR VALUES FROM ('${day} 00:00:00+00') TO ('${new Date(Date.parse(day + "T00:00:00.000Z") + DAY).toISOString().slice(0, 19).replace("T", " ").replace("Z", "")}+00')`);
    return p;
  };

  it("only drops partitions whose upper bound is at or before the cutoff", () => {
    const cutoff = Date.parse("2026-09-18T00:00:00.000Z");
    expect(isPartitionDroppable(parsePartitionBound("FOR VALUES FROM ('2026-09-17 00:00:00+00') TO ('2026-09-18 00:00:00+00')"), cutoff)).toBe(true);
    expect(isPartitionDroppable(parsePartitionBound("FOR VALUES FROM ('2026-09-18 00:00:00+00') TO ('2026-09-19 00:00:00+00')"), cutoff)).toBe(false);
    expect(isPartitionDroppable(parsePartitionBound("DEFAULT"), cutoff)).toBe(false);
    expect(isPartitionDroppable(null, cutoff)).toBe(false);
  });

  it("splits partitions into drop, trim and keep", () => {
    const cutoff = Date.parse("2026-09-18T06:00:00.000Z");
    const plan = planAuditPartitions(
      [
        { name: "iq_audit_trail_20260916", bound: boundsFor("2026-09-16") },
        { name: "iq_audit_trail_20260917", bound: boundsFor("2026-09-17") },
        { name: "iq_audit_trail_20260918", bound: boundsFor("2026-09-18") },
        { name: "iq_audit_trail_20260919", bound: boundsFor("2026-09-19") },
        { name: "iq_audit_trail_p_default", bound: { isDefault: true, fromMs: null, toMs: null } },
      ],
      cutoff,
    );
    expect(plan.drop.map((p) => p.name)).toEqual(["iq_audit_trail_20260916", "iq_audit_trail_20260917"]);
    expect(plan.trim.map((p) => p.name)).toEqual(["iq_audit_trail_20260918", "iq_audit_trail_p_default"]);
    expect(plan.keep.map((p) => p.name)).toEqual(["iq_audit_trail_20260919"]);
  });
});
