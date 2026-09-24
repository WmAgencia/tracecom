/**
 * V3 HEALTH — estados visuais do painel: READY / STANDBY / DEGRADED / OFFLINE, derivados de dados reais.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const healthModule = await import("../../relay/intelligence/v3-health.mjs");
const { computeV3Health } = healthModule as any;

const healthy = { v3Enabled: true, agentsAvailable: true, systemActive: true, recent429: 0, lastProviderError: null, feedReady: true, configuredMarkets: 30 };

describe("V3 health — estados", () => {
  it("A. desarmado (SYSTEM_INACTIVE) => STANDBY, nunca DEGRADED", () => {
    const health = computeV3Health({ ...healthy, systemActive: false });
    expect(health.state).toBe("STANDBY");
    expect(health.reason).toBe("SYSTEM_INACTIVE");
  });

  it("B. ativo + saudavel => READY", () => {
    expect(computeV3Health(healthy).state).toBe("READY");
  });

  it("C. HTTP 429 recente => DEGRADED + PROVIDER_RATE_LIMIT; provider indisponivel => OFFLINE", () => {
    expect(computeV3Health({ ...healthy, recent429: 4 }).state).toBe("DEGRADED");
    expect(computeV3Health({ ...healthy, recent429: 4 }).reason).toBe("PROVIDER_RATE_LIMIT");
    expect(computeV3Health({ ...healthy, providerUnavailable: true }).state).toBe("OFFLINE");
    expect(computeV3Health({ ...healthy, v3Enabled: false }).state).toBe("OFFLINE");
  });

  it("feed stale e schema/deadline failures => DEGRADED", () => {
    expect(computeV3Health({ ...healthy, feedReady: false }).state).toBe("DEGRADED");
    expect(computeV3Health({ ...healthy, feedReady: true, feedAgeMs: 20_000, feedMaxAgeMs: 15_000 }).state).toBe("DEGRADED");
    expect(computeV3Health({ ...healthy, recentSchemaErrors: 2 }).reason).toBe("SCHEMA_FAILURES");
    expect(computeV3Health({ ...healthy, recentDeadlineAborts: 1 }).reason).toBe("DEADLINE_FAILURES");
  });
});