/**
 * RUNTIME HOOKS V4 — o runtime expoe o status SHADOW e continua fail-closed:
 * sem execucao V4, allowlist REAL intacto, evento de config observacional.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const accountContext = await import("../../relay/account-context.mjs");

describe("IqMultiRuntime x Agents V4 (SHADOW)", () => {
  it("expoe agentsV4Status com isolamento explicito e DataHub", () => {
    const runtime = new runtimeModule.IqMultiRuntime({ log: () => {} });
    const status = runtime.agentsV4Status();
    expect(status.enabled).toBe(true);
    expect(status.shadowOnly).toBe(true);
    expect(status.controlsExecution).toBe(false);
    expect(status.sendsOrders).toBe(false);
    expect(status.isolation).toMatchObject({
      g2Untouched: true, v3Untouched: true, lateWindowUntouched: true,
      qualityGateUntouched: true, executionGateUntouched: true, stakeUntouched: true, realAllowlistUntouched: true,
    });
    expect(status.realAllowlistUntouched).toBe(true);
    expect(status.dataHub).not.toBeNull();
    expect(status.dataHub.published).toBe(0);
    runtime.stop("TEST");
  });

  it("permite ligar/desligar APENAS a observacao V4", () => {
    const runtime = new runtimeModule.IqMultiRuntime({ log: () => {} });
    expect(runtime.setAgentsV4Enabled(false).enabled).toBe(false);
    expect(runtime.agentsV4Status().enabled).toBe(false);
    expect(runtime.setAgentsV4Enabled(true).enabled).toBe(true);
    expect(runtime.agentsV4Status().enabled).toBe(true);
    runtime.stop("TEST");
  });

  it("REAL allowlist congelado usa a versão operacional (nunca G2) e V4 segue SHADOW", () => {
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.allowed).toContain("PULLBACK_4060_300_AGENTIC_V2");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.allowed).not.toContain("PROFESSIONAL_BRAIN_G2");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.shadowOnly).toContain("AGENT_V4");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.shadowOnly).toContain("SCENARIO_ENGINE_V3_FROZEN");
    expect(accountContext.REAL_STRATEGY_ALLOWLIST.shadowOnly).toContain("LATE_WINDOW_V2");
  });
});
