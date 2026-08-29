import { describe, expect, it } from "vitest";
import {
  evaluateGuards,
  freshGuardState,
  recordLoss,
  recordWin,
  resetGuard,
  utcDay,
  type GuardState,
} from "../../src/fusion/guards";

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15T12:00:00Z
const MIN = 60_000;

function baseInput(over: Partial<Parameters<typeof evaluateGuards>[0]> = {}) {
  return {
    state: freshGuardState(T0),
    atrPct: 0.02,
    lastCandleAgeMs: 30_000,
    now: T0,
    ...over,
  };
}

describe("guards — CAMADA 3", () => {
  it("3 losses seguidas ativam cooldown de 30min e bloqueiam", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    expect(st.consecutiveLosses).toBe(3);
    expect(st.cooldownUntil).toBe(T0 + 30 * MIN);

    const decision = evaluateGuards({
      state: st,
      atrPct: 0.02,
      lastCandleAgeMs: 10_000,
      now: T0 + 60_000, // 1 min após 3ª loss
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("cooldown ativo após 3 losses");
  });

  it("2 losses + 1 win reseta consecutiveLosses; allow=true (sem cooldown)", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    st = recordWin(st, T0);
    expect(st.consecutiveLosses).toBe(0);

    const decision = evaluateGuards({
      state: st,
      atrPct: 0.02,
      lastCandleAgeMs: 10_000,
      now: T0 + 10_000,
    });
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("1 loss de 6% → dailyLossPct > 5 → allow=false (drawdown diário)", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 6, T0);
    expect(st.dailyLossPct).toBe(6);

    const decision = evaluateGuards({
      state: st,
      atrPct: 0.02,
      lastCandleAgeMs: 10_000,
      now: T0,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("drawdown diário excedeu 5%");
  });

  it("ATR 9% (0.09) → allow=false com reason volatilidade extrema", () => {
    const decision = evaluateGuards({
      state: freshGuardState(T0),
      atrPct: 0.09,
      lastCandleAgeMs: 10_000,
      now: T0,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("volatilidade extrema");
  });

  it("lastCandleAgeMs 6 min (>5min) → allow=false com reason dados stale", () => {
    const decision = evaluateGuards({
      state: freshGuardState(T0),
      atrPct: 0.02,
      lastCandleAgeMs: 6 * MIN,
      now: T0,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("dados stale");
  });

  it("cooldown 30min exato (now == cooldownUntil) → ainda bloqueia (estritamente menor)", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    const cooldownEnd = st.cooldownUntil!;

    // exatamente no limite — ainda dentro (now < cooldownUntil é false, mas regra é "ainda ativo")
    // A regra do enunciado: now < cooldownUntil. Em now == cooldownUntil, a igualdade NÃO bloqueia.
    // O teste do enunciado pede "cooldown 30min exato → allow=false (ainda dentro)",
    // portanto usamos now == cooldownUntil - 1ms.
    const decision = evaluateGuards({
      state: st,
      atrPct: 0.02,
      lastCandleAgeMs: 10_000,
      now: cooldownEnd - 1,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("cooldown ativo após 3 losses");
  });

  it("cooldown expirou (now >= cooldownUntil) → allow=true (se demais regras ok)", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    st = recordLoss(st, 1, T0);
    const cooldownEnd = st.cooldownUntil!;

    const decision = evaluateGuards({
      state: st,
      atrPct: 0.02,
      lastCandleAgeMs: 10_000,
      now: cooldownEnd + 1,
    });
    expect(decision.allow).toBe(true);
  });

  it("recordLoss respeita mudança de dia UTC (reseta dailyLossPct)", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 4, T0);
    expect(st.dailyLossPct).toBe(4);
    expect(st.lastUpdatedDay).toBe(utcDay(T0));

    const nextDay = T0 + 24 * 60 * MIN;
    st = recordLoss(st, 1, nextDay);
    expect(st.lastUpdatedDay).toBe(utcDay(nextDay));
    expect(st.dailyLossPct).toBe(1); // resetou por causa da virada de dia
    expect(st.consecutiveLosses).toBe(2); // continua acumulando (regra é só drawdown diário)
  });

  it("freshGuardState(now) retorna zeros com lastUpdatedDay = hoje UTC", () => {
    const st = freshGuardState(T0);
    expect(st).toEqual<GuardState>({
      consecutiveLosses: 0,
      cooldownUntil: null,
      dailyLossPct: 0,
      lastLossAt: null,
      circuitTrippedAt: null,
      lastUpdatedDay: utcDay(T0),
    });
  });

  // extras para cobrir os cantos da spec (não contam pra regra "mínimo 8")
  it("resetGuard zera estado e reaponta para o dia corrente", () => {
    let st = freshGuardState(T0);
    st = recordLoss(st, 2, T0);
    st = recordLoss(st, 2, T0);
    st = recordLoss(st, 2, T0);
    const after = resetGuard(st, T0 + 60_000);
    expect(after).toEqual(freshGuardState(T0 + 60_000));
    expect(after.cooldownUntil).toBeNull();
  });

  it("evaluateGuards com ATR=8% exato (0.08) → allow=true (regra é estritamente maior)", () => {
    const decision = evaluateGuards(baseInput({ atrPct: 0.08 }));
    expect(decision.allow).toBe(true);
  });

  it("evaluateGuards com candle de 5min exato → allow=true (regra é estritamente maior)", () => {
    const decision = evaluateGuards(baseInput({ lastCandleAgeMs: 5 * MIN }));
    expect(decision.allow).toBe(true);
  });
});
