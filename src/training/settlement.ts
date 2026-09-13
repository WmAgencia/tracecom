/** Canonical, direction-only paper settlement.
 *
 * This module deliberately has no strategy or provider knowledge.  The caller
 * supplies the first causal quote observed at/after the due timestamp; it must
 * never use a quote observed before that boundary or a different instrument.
 */
export type SettlementDirection = "BUY" | "SELL";
export type SettlementOutcome = "WIN" | "LOSS" | "DRAW" | "UNKNOWN";

export interface SettlementInput {
  direction: SettlementDirection;
  entryPrice: number | null | undefined;
  exitPrice: number | null | undefined;
  entryTimestamp: number;
  exitTimestamp: number | null | undefined;
  dueTimestamp: number;
  entrySymbol?: string | null;
  exitSymbol?: string | null;
}

export interface SettlementResult {
  outcome: SettlementOutcome;
  reason: "MISSING_PRICE" | "INVALID_TIMESTAMP" | "EARLY_EXIT" | "SYMBOL_MISMATCH" | "EQUAL_PRICE" | "DIRECTIONAL_MOVE";
}

export function settleTrade(input: SettlementInput): SettlementResult {
  const entry = Number(input.entryPrice);
  const exit = Number(input.exitPrice);
  if (input.entryPrice == null || input.exitPrice == null || !Number.isFinite(entry) || !Number.isFinite(exit)) return { outcome: "UNKNOWN", reason: "MISSING_PRICE" };
  if (!Number.isFinite(input.entryTimestamp) || !Number.isFinite(input.dueTimestamp) || !Number.isFinite(input.exitTimestamp ?? NaN)) {
    return { outcome: "UNKNOWN", reason: "INVALID_TIMESTAMP" };
  }
  if ((input.exitTimestamp as number) < input.dueTimestamp) return { outcome: "UNKNOWN", reason: "EARLY_EXIT" };
  if (input.entrySymbol && input.exitSymbol && input.entrySymbol !== input.exitSymbol) {
    return { outcome: "UNKNOWN", reason: "SYMBOL_MISMATCH" };
  }
  if (exit === entry) return { outcome: "DRAW", reason: "EQUAL_PRICE" };
  const rose = exit > entry;
  return { outcome: (input.direction === "BUY") === rose ? "WIN" : "LOSS", reason: "DIRECTIONAL_MOVE" };
}
