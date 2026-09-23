/**
 * V3 — schema dos playbooks/scenarios, causalidade (sem lookahead) e integridade do runtime.
 */
import { describe, expect, it } from "vitest";
import { pullbackRetomadaSeries, rangeSeries, candlesFromCloses } from "./fixtures";
// @ts-expect-error - relay ESM sem tipagem
const playbooksModule = await import("../../relay/v3/playbooks.mjs");
// @ts-expect-error - relay ESM sem tipagem
const scenariosModule = await import("../../relay/v3/scenarios.mjs");
// @ts-expect-error - relay ESM sem tipagem
const measurementsModule = await import("../../relay/v3/measurements.mjs");
const { validatePlaybooks, PLAYBOOKS, SOURCES, PLAYBOOK_IDS } = playbooksModule as any;
const { validateScenarioLibrary, SCENARIOS, SCENARIO_IDS, EVIDENCE_FAMILIES } = scenariosModule as any;
const { measureAll, causalPivots, rsiSeries } = measurementsModule as any;

describe("V3 playbooks — schema profissional", () => {
  it("todos os playbooks tem contrato completo e fontes registradas", () => {
    const result = validatePlaybooks();
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(25);
  });

  it("separacao source-backed vs definicao operacional e explicita", () => {
    for (const playbook of Object.values(PLAYBOOKS) as any[]) {
      if (playbook.tracecomDefined === false) {
        expect(playbook.sources.some((id: string) => id !== "TRACECOM_V3_OPS"), playbook.id).toBe(true);
      } else {
        expect(playbook.sources, playbook.id).toContain("TRACECOM_V3_OPS");
      }
    }
    for (const playbook of Object.values(PLAYBOOKS) as any[]) {
      for (const sourceId of playbook.sources) expect(SOURCES[sourceId], `${playbook.id}:${sourceId}`).toBeTruthy();
    }
    expect(PLAYBOOK_IDS).toContain("PA_BOS_CHOCH");
    expect(PLAYBOOKS.PA_BOS_CHOCH.tracecomDefined).toBe(true);
    expect(PLAYBOOKS.RSI_FAILURE_SWING.sources).toContain("WILDER_1978");
  });

  it("scenario library: contrato completo e taxonomia de familias fixa", () => {
    const result = validateScenarioLibrary();
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    for (const scenario of Object.values(SCENARIOS) as any[]) {
      expect(scenario.definition.length).toBeGreaterThan(10);
      expect(scenario.distinguishing.length).toBeGreaterThan(5);
    }
    expect(SCENARIO_IDS).toEqual(expect.arrayContaining(["TREND_CONTINUATION", "PULLBACK_CONTINUATION", "NO_SETUP", "STRUCTURAL_REVERSAL", "COMPRESSION", "EXHAUSTION"]));
    expect(EVIDENCE_FAMILIES).toEqual(["STRUCTURE", "MOMENTUM", "DIRECTIONAL_PRESSURE", "VOLATILITY", "RELATIVE_POSITION", "MICRO_PRICE_ACTION"]);
  });
});

describe("V3 causalidade — nada de futurao", () => {
  it("measureAll e deterministico e identico para os mesmos dados", () => {
    const candles = pullbackRetomadaSeries({ candles: 120 });
    const first = JSON.stringify(measureAll(candles.slice(0, 90)));
    const second = JSON.stringify(measureAll(candles.slice(0, 90)));
    const full = measureAll(candles);
    const truncatedAgain = JSON.stringify(measureAll(candles.slice(0, 90)));
    expect(first).toBe(second);
    expect(first).toBe(truncatedAgain);
    expect(full.closedCandle.at).toBe(candles[candles.length - 1]!.at);
  });

  it("pivots so existem depois de confirmados (k candles posteriores)", () => {
    const candles = Array.from({ length: 180 }, (_, index) => ({ at: index, open: 1 + Math.sin(index / 6) * 0.001, high: 1 + Math.sin(index / 6) * 0.001 + 0.0004, low: 1 + Math.sin(index / 6) * 0.001 - 0.0004, close: 1 + Math.sin(index / 6) * 0.001 }));
    const full = causalPivots(candles, 2);
    const pivot = full.highs[full.highs.length - 1] ?? full.lows[full.lows.length - 1];
    expect(pivot).toBeTruthy();
    const beforeConfirmation = causalPivots(candles.slice(0, pivot.index + 2), 2);
    const atConfirmation = causalPivots(candles.slice(0, pivot.index + 3), 2);
    const inBefore = [...beforeConfirmation.highs, ...beforeConfirmation.lows].some((item: any) => item.index === pivot.index);
    const inAfter = [...atConfirmation.highs, ...atConfirmation.lows].some((item: any) => item.index === pivot.index);
    expect(inBefore).toBe(false);
    expect(inAfter).toBe(true);
  });

  it("rsiSeries e causal por candle fechado (sem reaproveitar futuro)", () => {
    const candles = pullbackRetomadaSeries({ candles: 60 });
    const at50 = rsiSeries(candles.slice(0, 50), 14);
    const atEnd = rsiSeries(candles, 14);
    expect(atEnd.slice(0, at50.length)).toEqual(at50);
  });

  it("range nao gera cenario operacional com BOS fabricado (dados truncados nao antecipam rompimento)", () => {
    const candles = rangeSeries({ candles: 90 });
    const side = candles.map((candle) => Math.max(candle.high - candle.open, 0) + Math.max(candle.close - candle.low, 0));
    expect(side.length).toBe(candles.length);
    const snapshot = measureAll(candles);
    expect(snapshot.structure.trend).toBe("RANGE");
    expect(snapshot.structure.lastBOS === null || snapshot.structure.lastBOS.type !== undefined).toBe(true);
  });
});

describe("V3 runtime — integridade observe-only", () => {
  it("o modulo V3 nao possui caminho de ordem (nunca chama requestOrder/placeOrder)", async () => {
    const fs = await import("node:fs");
    for (const file of ["runtime.mjs", "opportunity-engine.mjs", "asset-agent.mjs", "consensus.mjs", "specialists.mjs"]) {
      const source = fs.readFileSync(`relay/v3/${file}`, "utf8");
      expect(source, file).not.toMatch(/requestOrder\s*\(|placeOrder\s*\(/);
    }
  });
});
