import { describe, expect, it } from "vitest";
import { canContinue, hasProhibitedAction, DEFAULT_SAFETY_LIMITS } from "../../src/agent/safety";

describe("safety", () => {
  it("detecta ações proibidas (a Tracecon não executa ordens)", () => {
    expect(hasProhibitedAction("place_order btc")).toBe(true);
    expect(hasProhibitedAction("buy 1 btc")).toBe(true);
    expect(hasProhibitedAction("analisar mercado")).toBe(false);
  });

  it("canContinue respeita os limites", () => {
    expect(canContinue({ rounds: 0, toolCalls: 0 })).toBe(true);
    expect(canContinue({ rounds: DEFAULT_SAFETY_LIMITS.maxAgentRounds, toolCalls: 0 })).toBe(false);
    expect(canContinue({ rounds: 0, toolCalls: DEFAULT_SAFETY_LIMITS.maxToolCalls })).toBe(false);
  });

  it("aceita limites customizados", () => {
    expect(canContinue({ rounds: 1, toolCalls: 1 }, { maxAgentRounds: 1, maxToolCalls: 2 })).toBe(false);
  });
});
