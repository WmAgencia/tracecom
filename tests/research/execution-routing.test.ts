/**
 * EXECUTION ROUTING (fail-closed) — prova de que, com a politica RSI_V2_ONLY,
 * SOMENTE agent-v2:RSI_REVERSAL_STRICT_V2 / agent-v2:RSI_EXTREME_PULLBACK_V2
 * chegam ao requestOrder. Brain G2 (AUTO_DECISION/DIAGNOSTIC_SIGNAL), manual,
 * infra probe e experimentos ficam com controlsExecution=false.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem
const agentsV2 = await import("../../relay/rsi-agents-v2.mjs");
// @ts-expect-error - relay ESM sem tipagem
const agentsV3 = await import("../../relay/rsi-agents-v3.mjs");

const { IqMultiRuntime } = runtimeModule;
const { RSI_V2_EXECUTION_ALLOWLIST } = agentsV2;
const { RSI_V3_EXECUTION_ALLOWLIST } = agentsV3;

const build = (options: any = {}) => new IqMultiRuntime({ executionAllowlist: RSI_V2_EXECUTION_ALLOWLIST, ...options });

const codeOf = async (promise: Promise<any>) => {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error: any) {
    return String(error?.code ?? error?.message ?? error);
  }
};

describe("EXECUTION ROUTING — apenas V2 pode executar", () => {
  it("AUTO_DECISION (brain G2) e bloqueado fail-closed com EXECUTION_SOURCE_BLOCKED", async () => {
    const runtime = build();
    const code = await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", source: "AUTO_DECISION" }));
    expect(code).toBe("EXECUTION_SOURCE_BLOCKED");
  });

  it("DIAGNOSTIC_SIGNAL, MANUAL, INFRA_PROBE e experimentos tambem ficam bloqueados", async () => {
    const runtime = build();
    for (const source of ["DIAGNOSTIC_SIGNAL", "MANUAL", "INFRA_PROBE", "experiment:RSI_REVERSAL_CONFLUENCE_V1"]) {
      const code = await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", source }));
      expect(code, source).toBe("EXECUTION_SOURCE_BLOCKED");
    }
  });

  it("as duas skills V2 passam pelo roteamento (nao sao bloqueadas pela politica)", async () => {
    const runtime = build();
    for (const source of [
      "agent-v2:RSI_REVERSAL_STRICT_V2:RSI_REVERSAL_STRICT_V2",
      "agent-v2:RSI_EXTREME_PULLBACK_V2:RSI_EXTREME_PULLBACK_V2",
    ]) {
      const code = await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", source }));
      expect(code, source).not.toBe("EXECUTION_SOURCE_BLOCKED");
    }
  });

  it("status de roteamento: somente V2 com controlsExecution=true e canReachRequestOrder", () => {
    const status = build().executionRoutingStatus();
    expect(status.policy).toBe("RSI_V2_ONLY");
    expect(status.enabled).toBe(true);
    expect(status.allowlist).toEqual(["agent-v2:RSI_REVERSAL_STRICT_V2", "agent-v2:RSI_EXTREME_PULLBACK_V2"]);
    const allowed = status.sources.filter((row: any) => row.controlsExecution === true && row.canReachRequestOrder === true);
    expect(allowed.map((row: any) => row.strategyId).sort()).toEqual(["RSI_EXTREME_PULLBACK_V2", "RSI_REVERSAL_STRICT_V2"]);
    const g2 = status.sources.find((row: any) => row.source === "AUTO_DECISION");
    expect(g2.controlsExecution).toBe(false);
    expect(g2.canReachRequestOrder).toBe(false);
    expect(g2.strategyId).toBe("PROFESSIONAL_BRAIN_G2");
    expect(g2.reason).toBe("EXECUTION_SOURCE_BLOCKED");
  });

  it("sem allowlist (dev/testes) o roteamento e permissivo (nao bloqueia por fonte)", async () => {
    const runtime = new IqMultiRuntime({});
    const code = await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", source: "AUTO_DECISION" }));
    expect(code).not.toBe("EXECUTION_SOURCE_BLOCKED");
    expect(runtime.executionRoutingStatus().policy).toBe("PERMISSIVE");
  });

  it("evento de bloqueio e emitido com as 4 colunas de auditoria", async () => {
    const runtime = build();
    await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "SELL", source: "AUTO_DECISION" }));
    const events = runtime.eventsAfter(0, 50).events.filter((event: any) => event.type === "execution.source_blocked");
    expect(events.length).toBeGreaterThan(0);
    const event = events[events.length - 1];
    expect(event.marketKey).toBe("EURUSD:OTC");
    expect(event.source).toBe("AUTO_DECISION");
    expect(event.strategyId).toBe("PROFESSIONAL_BRAIN_G2");
    expect(event.decisionSource).toBe("G2_AUTO");
    expect(event.controlsExecution).toBe(false);
  });
});

describe("EXECUTION ROUTING — politica RSI_V3_ONLY", () => {
  const buildV3 = () => new IqMultiRuntime({ executionAllowlist: RSI_V3_EXECUTION_ALLOWLIST, executionPolicyName: "RSI_V3_ONLY" });

  it("somente RSI_REVERSAL_PULLBACK_V3 (agent-v3) pode executar; V2 e G2 bloqueados", async () => {
    const runtime = buildV3();
    const v3Source = "agent-v3:RSI_REVERSAL_PULLBACK_V3:RSI_REVERSAL_PULLBACK_V3";
    expect(await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", source: v3Source }))).not.toBe("EXECUTION_SOURCE_BLOCKED");
    for (const source of [
      "agent-v2:RSI_REVERSAL_STRICT_V2:RSI_REVERSAL_STRICT_V2",
      "agent-v2:RSI_EXTREME_PULLBACK_V2:RSI_EXTREME_PULLBACK_V2",
      "AUTO_DECISION",
      "MANUAL",
    ]) {
      expect(await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "BUY", source })), source).toBe("EXECUTION_SOURCE_BLOCKED");
    }
  });

  it("status RSI_V3_ONLY: apenas V3 com controlsExecution=true", () => {
    const status = buildV3().executionRoutingStatus();
    expect(status.policy).toBe("RSI_V3_ONLY");
    expect(status.allowlist).toEqual([`agent-v3:RSI_REVERSAL_PULLBACK_V3`]);
    const allowed = status.sources.filter((row: any) => row.controlsExecution === true && row.canReachRequestOrder === true);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].strategyId).toBe("RSI_REVERSAL_PULLBACK_V3");
    expect(allowed[0].decisionSource).toBe("AGENT_V3");
    const blocked = status.sources.filter((row: any) => row.controlsExecution === false);
    expect(blocked.some((row: any) => row.strategyId === "RSI_REVERSAL_STRICT_V2")).toBe(true);
    expect(blocked.some((row: any) => row.strategyId === "RSI_EXTREME_PULLBACK_V2")).toBe(true);
    expect(blocked.some((row: any) => row.source === "AUTO_DECISION")).toBe(true);
  });

  it("V1 (agent:RSI*) tambem fica bloqueada na politica V3", async () => {
    const runtime = buildV3();
    expect(await codeOf(runtime.requestOrder({ marketKey: "EURUSD:OTC", direction: "SELL", source: "agent:RSI_REVERSAL_STRICT:RSI_REVERSAL_STRICT_V1" }))).toBe("EXECUTION_SOURCE_BLOCKED");
  });
});
