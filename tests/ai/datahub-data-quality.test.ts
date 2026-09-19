/**
 * DATA QUALITY AGENT — HEALTHY/DEGRADED/UNSAFE e NO_TRADE do V4 quando UNSAFE.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const hub = await import("../../relay/datahub/index.mjs");
// @ts-expect-error - relay ESM sem tipagem
const v4 = await import("../../relay/agents-v4/index.mjs");
import { buildEnrichedT0, dataQualityInput, healthyDataQuality, rangeCandles, zigzagCandles } from "./fixtures/agents-v4-fixtures";

const baseT0 = () => buildEnrichedT0({ candles: zigzagCandles({ dir: "UP" }) }).t0;

describe("Data Quality Agent", () => {
  it("classifica dados consistentes como HEALTHY", () => {
    const t0 = baseT0();
    const result = hub.assessDataQuality(dataQualityInput(t0));
    expect(result.state).toBe("HEALTHY");
    expect(result.noTrade).toBe(false);
  });

  it("marca UNSAFE para feed desconectado, stale, clock invalido, mapping ausente e feature velha", () => {
    const t0 = baseT0();
    const cases: any[] = [
      dataQualityInput(t0, { feed: { connected: false, tickAgeMs: 100 } }),
      dataQualityInput(t0, { feed: { connected: true, tickAgeMs: 60_000 } }),
      dataQualityInput(t0, { clock: { timeValid: false, skewMs: 10 } }),
      dataQualityInput(t0, { clock: { timeValid: true, skewMs: 45_000 } }),
      dataQualityInput(t0, { marketMapping: { activeId: null, resolved: false } }),
      dataQualityInput(t0, { feature: { fresh: false, ageMs: 120_000 } }),
      dataQualityInput(t0, { broker: { evaluated: true, connected: true, accountType: "REAL" } }),
    ];
    for (const input of cases) {
      const result = hub.assessDataQuality(input);
      expect(result.state, JSON.stringify(input.feed ?? input.clock ?? input.marketMapping ?? input.feature ?? input.broker)).toBe("UNSAFE");
      expect(result.noTrade).toBe(true);
      expect(result.unsafeReasons.length).toBeGreaterThan(0);
    }
  });

  it("classifica DEGRADED para duplicatas/gaps/clock leve e nunca como UNSAFE", () => {
    const t0 = baseT0();
    const result = hub.assessDataQuality(dataQualityInput(t0, { candles: { count: 80, duplicates: 2, reorder: 1, missingBuckets: 1 } }));
    expect(result.state).toBe("DEGRADED");
    expect(result.noTrade).toBe(false);
  });

  it("isola NORMAL/OTC: sufixo do marketKey divergente do marketType e UNSAFE", () => {
    const t0 = baseT0();
    const result = hub.assessDataQuality(dataQualityInput(t0, { marketType: "NORMAL" }));
    expect(result.state).toBe("UNSAFE");
    expect(result.unsafeReasons).toContain("NORMAL_OTC_CONSISTENT");
  });

  it("classe de conta divergente do accountContext e UNSAFE (PRACTICE nunca vira REAL silenciosamente)", () => {
    const t0 = baseT0();
    const result = hub.assessDataQuality({ ...dataQualityInput(t0), accountContext: "PRACTICE", broker: { evaluated: true, connected: true, accountType: "REAL" } });
    expect(result.state).toBe("UNSAFE");
    expect(result.unsafeReasons).toContain("ACCOUNT_CONTEXT_CONSISTENT");
  });

  it("V4 responde NO_TRADE quando DATA_QUALITY e UNSAFE", () => {
    const t0 = baseT0();
    const dq = hub.assessDataQuality(dataQualityInput(t0, { feed: { connected: false, tickAgeMs: null } }));
    const engine = new v4.AgentsV4Engine();
    const result = engine.analyze({ t0, dataQualityAssessment: dq });
    expect(result.finalAction).toBe("NO_TRADE");
    expect(result.direction).toBeNull();
    expect(result.dataQuality.state).toBe("UNSAFE");
    expect(result.synthesis.triggerState).toBe("DATA_UNSAFE");
  });

  it("sem avaliacao de dados o especialista e conservador (UNSAFE)", () => {
    const t0 = baseT0();
    const output = v4.analyzeDataQuality({ features: v4.buildAgentFeatures(t0), assessment: null });
    expect(output.state).toBe("UNSAFE");
    expect(output.detail.noTrade).toBe(true);
  });

  it("dataset de range saudavel permanece analisavel (nao vira UNSAFE por design)", () => {
    const t0 = buildEnrichedT0({ candles: rangeCandles() }).t0;
    const result = healthyDataQuality(t0);
    expect(result.state).toBe("HEALTHY");
    expect(result.checks.filter((row: any) => !row.ok)).toHaveLength(0);
  });
});
