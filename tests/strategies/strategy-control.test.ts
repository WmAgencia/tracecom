/** TESTES — controle operacional: gate de selecao (cenarios A/B/C), AUTO e promocao. */
import { describe, expect, it } from "vitest";
import { chooseAutoSelection, type VariantStats } from "../../src/strategies/auto.js";
import { evaluatePromotion } from "../../src/strategies/promotion.js";
import {
  DEFAULT_SELECTION,
  decideOperationalGate,
  horizonCompatibility,
  makeSelection,
  selectionAppliesFromNextSignal,
  type LatestOperationalSignal,
  type StrategySelection,
} from "../../src/strategies/selection.js";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");

function signal(family: "V1" | "V2" | "V3" | "V8", horizonSeconds: number, direction: "BUY" | "SELL"): LatestOperationalSignal {
  const hash = family === "V1" ? "70a7bfcb568bec8c" : family === "V2" ? "6f8b9001c63b7597" : family === "V3" ? "acf733a866146537" : "712373de3372e158";
  return { family, horizonSeconds, direction, signalBucket: T0, entryPrice: 1.1, strategyHash: hash, entryTimestamp: T0 };
}

const selectionV3 = makeSelection("V3", 60, "test") as StrategySelection;
const selectionV8 = makeSelection("V8", 45, "test") as StrategySelection;

describe("gate operacional — MANUAL realmente controla o agente (cenarios A/B/C)", () => {
  it("CENARIO A: V3-60 selecionada + V3=BUY/V8=WAIT → lock BUY aceito; apos trocar para V8-45 (V8=WAIT) → lock BUY REJEITADO", () => {
    const v3Signal = signal("V3", 60, "BUY");
    const before = decideOperationalGate({ direction: "BUY", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: v3Signal, nowMs: T0 + 1000 });
    expect(before.allowed).toBe(true);
    // troca para V8-45; sem sinal fresco da V8 (WAIT) → bloqueado
    const after = decideOperationalGate({ direction: "BUY", horizonMs: 45_000 }, { selection: selectionV8, latestSignal: null, nowMs: T0 + 1000 });
    expect(after.allowed).toBe(false);
    if (!after.allowed) expect(after.reason).toBe("NO_FRESH_SIGNAL");
  });

  it("CENARIO B: V3=WAIT/V8=SELL → com V3 selecionada WAIT; trocar para V8-45 → SELL aceito", () => {
    const v3Attempt = decideOperationalGate({ direction: "SELL", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: null, nowMs: T0 + 1000 });
    expect(v3Attempt.allowed).toBe(false);
    const v8Signal = signal("V8", 45, "SELL");
    const after = decideOperationalGate({ direction: "SELL", horizonMs: 45_000 }, { selection: selectionV8, latestSignal: v8Signal, nowMs: T0 + 1000 });
    expect(after.allowed).toBe(true);
  });

  it("CENARIO C: V3=BUY vs V8=SELL discordam → selecao decide qual direcao vira operacao", () => {
    const v3Signal = signal("V3", 60, "BUY");
    const v8Signal = signal("V8", 45, "SELL");
    const withV3 = decideOperationalGate({ direction: "BUY", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: v3Signal, nowMs: T0 + 1000 });
    expect(withV3.allowed).toBe(true);
    if (withV3.allowed) expect(withV3.variantId).toBe("V3-60");
    const wrongDirection = decideOperationalGate({ direction: "SELL", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: v3Signal, nowMs: T0 + 1000 });
    expect(wrongDirection.allowed).toBe(false);
    if (!wrongDirection.allowed) expect(wrongDirection.reason).toBe("DIRECTION_MISMATCH");
    const withV8 = decideOperationalGate({ direction: "SELL", horizonMs: 45_000 }, { selection: selectionV8, latestSignal: v8Signal, nowMs: T0 + 1000 });
    expect(withV8.allowed).toBe(true);
  });

  it("bloqueia sinal velho, hash divergente e horizonte de request errado", () => {
    const v3Signal = signal("V3", 60, "BUY");
    const stale = decideOperationalGate({ direction: "BUY", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: v3Signal, nowMs: T0 + 21_000 });
    expect(stale.allowed).toBe(false);
    if (!stale.allowed) expect(stale.reason).toBe("NO_FRESH_SIGNAL");
    const badHash = decideOperationalGate({ direction: "BUY", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: { ...v3Signal, strategyHash: "deadbeefdeadbeef" }, nowMs: T0 + 1000 });
    expect(badHash.allowed).toBe(false);
    if (!badHash.allowed) expect(badHash.reason).toBe("HASH_MISMATCH");
    const wrongHorizon = decideOperationalGate({ direction: "BUY", horizonMs: 300_000 }, { selection: selectionV3, latestSignal: v3Signal, nowMs: T0 + 1000 });
    expect(wrongHorizon.allowed).toBe(false);
    if (!wrongHorizon.allowed) expect(wrongHorizon.reason).toBe("HORIZON_MISMATCH");
  });

  it("incompatibilidade com horizonte do broker bloqueia (60s selecionado vs 45s no broker)", () => {
    expect(horizonCompatibility(selectionV3, 45).compatible).toBe(false);
    expect(horizonCompatibility(selectionV3, 60).compatible).toBe(true);
    expect(horizonCompatibility(selectionV3, null).compatible).toBe(true);
    const result = decideOperationalGate({ direction: "BUY", horizonMs: 60_000 }, { selection: selectionV3, latestSignal: signal("V3", 60, "BUY"), brokerHorizonSeconds: 45, nowMs: T0 + 1000 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("HORIZON_INCOMPATIBLE");
  });

  it("sem selecao → bloqueado; operacao ativa → aviso 'a partir do proximo sinal'", () => {
    const none = decideOperationalGate({ direction: "BUY", horizonMs: 60_000 }, { selection: null, latestSignal: null, nowMs: T0 });
    expect(none.allowed).toBe(false);
    if (!none.allowed) expect(none.reason).toBe("NO_SELECTION");
    expect(selectionAppliesFromNextSignal(true).appliesFromNextSignal).toBe(true);
    expect(selectionAppliesFromNextSignal(false).appliesFromNextSignal).toBe(false);
  });
});

function stats(family: "V1" | "V2" | "V3" | "V8", horizonSeconds: number, wins: number, losses: number, independentN?: number): VariantStats {
  const decided = wins + losses;
  return { family, horizonSeconds, wins, losses, draws: 0, independentN: independentN ?? decided, independentWins: Math.round((independentN ?? decided) * (wins / decided)), independentLosses: (independentN ?? decided) - Math.round((independentN ?? decided) * (wins / decided)) };
}

describe("AUTO — politica deterministica conservadora", () => {
  it("escolhe a variante de maior Wilson lower entre elegiveis (nao WR bruto)", () => {
    const statsList = [
      stats("V3", 60, 60, 40, 40), // 60% com n=40
      stats("V8", 45, 70, 30, 100), // 70% com n=100 (mais estavel)
      stats("V2", 120, 20, 10, 30), // 66.7% n=30
    ];
    const result = chooseAutoSelection(statsList, DEFAULT_SELECTION, "2026-09-16T12:00:00.000Z");
    expect(result.changed).toBe(true);
    expect(result.selection.variantId).toBe("V8-45");
    expect(result.selection.mode).toBe("AUTO");
  });

  it("sem elegiveis (N baixo ou WR abaixo do breakeven+edge) mantem a selecao atual", () => {
    const statsList = [stats("V3", 60, 10, 10, 20), stats("V8", 45, 5, 5, 10)];
    const result = chooseAutoSelection(statsList, DEFAULT_SELECTION, "2026-09-16T12:00:00.000Z");
    expect(result.changed).toBe(false);
    expect(result.selection.variantId).toBe(DEFAULT_SELECTION.variantId);
    expect(result.reason).toBe("AUTO_KEEP_NO_ELIGIBLE");
  });

  it("nao churna: mesma variante lider continua selecionada (changed=false)", () => {
    const statsList = [stats("V3", 60, 80, 20, 200), stats("V8", 45, 55, 45, 150)];
    const current = { ...DEFAULT_SELECTION };
    const result = chooseAutoSelection(statsList, current, "2026-09-16T12:00:00.000Z");
    expect(result.selection.variantId).toBe("V3-60");
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("AUTO_KEEP");
  });
});

describe("promocao Champion/Candidate — gate 5000 trades OOS", () => {
  const base = {
    candidateVersion: "cand-1",
    championVersion: "champ-1",
    trainingN: 8000,
    validationN: 4999,
    candidateWins: 3300,
    candidateLosses: 1699,
    championWins: 3000,
    championLosses: 1999,
    baselineWr: 50,
    firstHalfWr: 67,
    secondHalfWr: 65,
  };

  it("INSUFFICIENT_EVIDENCE com menos de 5000 trades novos", () => {
    expect(evaluatePromotion(base).decision).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("PROMOTE quando candidato supera champion com significancia em 5000 OOS", () => {
    const result = evaluatePromotion({ ...base, validationN: 5000 });
    expect(result.decision).toBe("PROMOTE");
  });

  it("REJECT quando candidato nao supera o champion", () => {
    const result = evaluatePromotion({ ...base, validationN: 5000, candidateWins: 2900, candidateLosses: 2100 });
    expect(result.decision).toBe("REJECT");
  });

  it("REJECT por regressao critica / instabilidade / falta de edge sobre baseline", () => {
    expect(evaluatePromotion({ ...base, validationN: 5200, candidateWins: 2600, candidateLosses: 2600, firstHalfWr: 60, secondHalfWr: 45 }).decision).toBe("REJECT");
    expect(evaluatePromotion({ ...base, validationN: 5200, firstHalfWr: 70, secondHalfWr: 50 }).decision).toBe("REJECT");
    expect(evaluatePromotion({ ...base, validationN: 5200, baselineWr: 65 }).decision).toBe("REJECT");
  });
});
