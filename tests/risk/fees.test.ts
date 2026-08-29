/**
 * Testes do módulo de custos de execução (Binance spot).
 *
 * Cobre: constantes, roundTripCost (breakdown), netReturnAfterCosts
 * e isEdgeViable (gate pré-trade).
 *
 * Convenções:
 *  - `BINANCE_FEE_PCT` e `SLIPPAGE_PCT` são fracionais (0.001 = 0.1%).
 *  - `ROUND_TRIP_COST_PCT` é fracional (0.003 = 0.3%).
 *  - `ROUND_TRIP_COST_PP` é em pontos percentuais (0.3).
 *  - `netReturnAfterCosts` opera em PP (recebe/entrega PP).
 */
import { describe, expect, it } from "vitest";
import {
  BINANCE_FEE_PCT,
  SLIPPAGE_PCT,
  ROUND_TRIP_COST_PCT,
  ROUND_TRIP_COST_PP,
  netReturnAfterCosts,
  isEdgeViable,
  roundTripCost,
} from "../../src/risk/fees";

describe("constantes de custo", () => {
  it("Binance fee padrão é 0.1% (0.001 fracional)", () => {
    expect(BINANCE_FEE_PCT).toBe(0.001);
  });
  it("slippage padrão é 0.05% (0.0005 fracional)", () => {
    expect(SLIPPAGE_PCT).toBe(0.0005);
  });
  it("ROUND_TRIP_COST_PCT = 0.003 (0.3%)", () => {
    expect(ROUND_TRIP_COST_PCT).toBe(0.003);
  });
  it("ROUND_TRIP_COST_PP = 0.3 (PP)", () => {
    expect(ROUND_TRIP_COST_PP).toBe(0.3);
  });
});

describe("roundTripCost(notionalUsd)", () => {
  it("retorna breakdown consistente para notional $1000", () => {
    const cb = roundTripCost(1000);
    // Fee e slippage por perna.
    expect(cb.fee).toBeCloseTo(0.1, 6);
    expect(cb.slippage).toBeCloseTo(0.05, 6);
    // perTrade = ROUND_TRIP_COST_PP declarado (0.3 PP).
    expect(cb.perTrade).toBeCloseTo(0.3, 6);
    // totalRoundTrip é o custo derivado (com buffer 1.5x) — 0.45 PP.
    expect(cb.totalRoundTrip).toBeCloseTo(0.45, 6);
  });
});

describe("netReturnAfterCosts(gross)", () => {
  it("netReturnAfterCosts(2.5) → 2.2 (desconta 0.3 PP)", () => {
    expect(netReturnAfterCosts(2.5)).toBeCloseTo(2.2, 6);
  });
  it("netReturnAfterCosts(-1.0) → -1.3", () => {
    expect(netReturnAfterCosts(-1.0)).toBeCloseTo(-1.3, 6);
  });
  it("retorno zero vira negativo após custos", () => {
    expect(netReturnAfterCosts(0)).toBeCloseTo(-0.3, 6);
  });
  it("é linear: gross - 0.3", () => {
    expect(netReturnAfterCosts(5.0)).toBeCloseTo(4.7, 6);
    expect(netReturnAfterCosts(10.0)).toBeCloseTo(9.7, 6);
  });
});

describe("isEdgeViable(winPct, winRate, baseline)", () => {
  it("edge alto → viável (true)", () => {
    // grossWinPct=2.5, winRate=0.55, baseline=|lossPct|=2.0 (perda menor que ganho).
    // edgePp = 0.55*2.5 - 0.45*2.0 = 1.375 - 0.9 = 0.475 PP > 0.3 → true.
    expect(isEdgeViable(2.5, 0.55, 2.0)).toBe(true);
  });

  it("edge marginal com baseline simétrico → false", () => {
    // grossWinPct=2.5, winRate=0.55, baseline=2.5 (perda = ganho).
    // edgePp = 0.55*2.5 - 0.45*2.5 = 0.25 PP < 0.3 → false.
    expect(isEdgeViable(2.5, 0.55, 2.5)).toBe(false);
  });

  it("edge pequeno → não viável (false)", () => {
    // grossWinPct=1.0, winRate=0.52, baseline=1.0.
    // edgePp = 0.52*1.0 - 0.48*1.0 = 0.04 PP < 0.3 → false.
    expect(isEdgeViable(1.0, 0.52, 1.0)).toBe(false);
  });

  it("edge alto com winRate alto → viável (true)", () => {
    // grossWinPct=3.0, winRate=0.70, baseline=1.0.
    // edgePp = 0.70*3.0 - 0.30*1.0 = 2.1 - 0.3 = 1.8 PP > 0.3 → true.
    expect(isEdgeViable(3.0, 0.70, 1.0)).toBe(true);
  });

  it("winRate baixo → não viável", () => {
    // grossWinPct=2.0, winRate=0.40, baseline=1.0.
    // edgePp = 0.40*2.0 - 0.60*1.0 = 0.8 - 0.6 = 0.2 PP < 0.3 → false.
    expect(isEdgeViable(2.0, 0.40, 1.0)).toBe(false);
  });

  it("retorna false para NaN/Infinity", () => {
    expect(isEdgeViable(NaN, 0.5, 0.5)).toBe(false);
    expect(isEdgeViable(2.5, Infinity, 0.5)).toBe(false);
    expect(isEdgeViable(2.5, 0.5, -Infinity)).toBe(false);
  });

  it("retorna false para winRate fora de [0,1] ou baseline negativo", () => {
    expect(isEdgeViable(2.0, -0.1, 1.0)).toBe(false);
    expect(isEdgeViable(2.0, 1.5, 1.0)).toBe(false);
    expect(isEdgeViable(2.0, 0.5, -1.0)).toBe(false);
  });
});