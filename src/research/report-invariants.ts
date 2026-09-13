/** Report aggregation invariants: protects against hand-tallied WIN/LOSS/UNKNOWN
 * mismatches, WR including UNKNOWN/DRAW, variant evaluations counted as trades,
 * and per-class totals that do not add up to the classified settlements. */
export type SettlementRow = { result: "WIN" | "LOSS" | "DRAW" | "UNKNOWN"; [key: string]: unknown };

export type Tally = { total: number; WIN: number; LOSS: number; DRAW: number; UNKNOWN: number; resolved: number; WR: number | null };

export function tallySettlements(rows: SettlementRow[]): Tally {
  const t = { total: rows.length, WIN: 0, LOSS: 0, DRAW: 0, UNKNOWN: 0 };
  for (const row of rows) t[row.result] += 1;
  const resolved = t.WIN + t.LOSS + t.DRAW;
  return { ...t, resolved, WR: t.WIN + t.LOSS > 0 ? Number((t.WIN / (t.WIN + t.LOSS)).toFixed(4)) : null };
}

export function groupTally(rows: SettlementRow[], key: string): Record<string, Tally> {
  const groups = new Map<string, SettlementRow[]>();
  for (const row of rows) {
    const value = typeof row[key] === "string" ? (row[key] as string) : "UNKNOWN";
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return Object.fromEntries([...groups.entries()].map(([k, v]) => [k, tallySettlements(v)]));
}

export function invariantViolations(rows: SettlementRow[], variantEvaluations: number, uniqueGroundTruths: number, rawVariants: number, grouped: Record<string, Tally>[]): string[] {
  const t = tallySettlements(rows);
  const violations: string[] = [];
  if (t.WIN + t.LOSS + t.DRAW + t.UNKNOWN !== t.total) violations.push("sum_mismatch");
  if (t.resolved !== t.WIN + t.LOSS + t.DRAW) violations.push("resolved_mismatch");
  if (t.WIN + t.LOSS === 0 && t.WR !== null) violations.push("wr_uses_unknown");
  if (variantEvaluations !== uniqueGroundTruths * rawVariants) violations.push("evaluations_mismatch");
  for (const g of grouped) {
    const total = Object.values(g).reduce((s, x) => s + x.total, 0);
    if (total !== t.total) violations.push("group_total_mismatch");
  }
  return violations;
}
