/**
 * PRACTICE_FOUR_WAY_3X_TEST_V1 â€” testes adversariais do harness (DRY_RUN default; zero ordem).
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const mod = await import("../../relay/four-way-experiment.mjs");

const goodContext = { accountContext: "PRACTICE", brokerAccountType: "PRACTICE", realState: "LOCKED", realTradingEnabled: false, killSwitchEngaged: false, brokerConnected: true, dataQuality: "HEALTHY", marketValid: true };

function makeHarness({ runtime = null }: any = {}) {
  return new mod.FourWayExperiment({ runtime: runtime ?? { experimentRequestOrder: async () => ({ state: "ACKNOWLEDGED", executionId: "exec1", brokerOrderId: "order1" }) }, minStakeBrl: 1 });
}
function decision(overrides: any = {}) {
  return { strategyId: "PROFESSIONAL_BRAIN_G2", opportunityId: "cand_1", decisionId: "cand_1", marketKey: "EURUSD:OTC", marketType: "OTC", direction: "BUY", payout: 0.87, context: goodContext, ...overrides };
}
function armMemory(harness: any) { harness.memory.state = "ARMED_PRACTICE"; }

describe("harness 4x3 â€” estados e DRY_RUN", () => {
  it("default e DRY_RUN e NUNCA chama requestOrder", async () => {
    let called = 0;
    const harness = makeHarness({ runtime: { experimentRequestOrder: async () => { called += 1; return { state: "ACKNOWLEDGED" }; } } });
    const result = await harness.tryForward(decision());
    expect(result.dryRun).toBe(true);
    expect(result.wouldExecute).toBe(true);
    expect(called).toBe(0);
  });
  it("WAIT nunca executa nem gera WOULD_EXECUTE", async () => {
    const harness = makeHarness();
    const result = await harness.observeDecision({ strategyId: "PROFESSIONAL_BRAIN_G2", opportunityId: "cand_2", direction: "WAIT" });
    expect(result.wouldExecute).toBe(false);
    expect(result.reason).toBe("WAIT_NEVER_EXECUTES");
  });
  it("arm exige frase exata; frase errada bloqueia", async () => {
    const harness = makeHarness();
    await harness.ensureCreated();
    expect((await harness.arm({ phrase: "frase errada", preflight: { ...goodContext, minStakeBrl: 1, totalCount: 0 } })).ok).toBe(false);
    expect((await harness.arm({ phrase: mod.ARM_PHRASE, preflight: { ...goodContext, minStakeBrl: 1, totalCount: 0 } })).ok).toBe(true);
  });
  it("prepare exige preflight limpo", async () => {
    const harness = makeHarness();
    expect((await harness.prepare({ preflight: { ...goodContext, realState: "ARMED", minStakeBrl: 1, totalCount: 0 } })).ok).toBe(false);
    const ok = await harness.prepare({ preflight: { ...goodContext, minStakeBrl: 1, totalCount: 0 } });
    expect(ok.ok).toBe(true);
    expect(ok.state).toBe("READY_TO_ARM");
  });
});

describe("harness 4x3 â€” guards PRACTICE-only", () => {
  it("REAL sempre bloqueado (account context, broker account, realState, realTradingEnabled)", async () => {
    const harness = makeHarness(); armMemory(harness);
    for (const context of [
      { ...goodContext, accountContext: "REAL" },
      { ...goodContext, brokerAccountType: "REAL" },
      { ...goodContext, realState: "ARMED" },
      { ...goodContext, realTradingEnabled: true },
    ]) {
      const result = await harness.tryForward(decision({ context, opportunityId: `cand_${Math.random()}` }));
      expect(result.executed).toBe(false);
      expect(result.blocked).toBe(true);
    }
  });
  it("not armed bloqueia; kill switch bloqueia; broker offline bloqueia; DQ unsafe bloqueia; stake invalida bloqueia; mercado invalido bloqueia", async () => {
    const cases = [
      { state: "DRY_RUN", context: goodContext, mutate: null },
      { state: "ARMED_PRACTICE", context: { ...goodContext, killSwitchEngaged: true } },
      { state: "ARMED_PRACTICE", context: { ...goodContext, brokerConnected: false } },
      { state: "ARMED_PRACTICE", context: { ...goodContext, dataQuality: "UNSAFE" } },
      { state: "ARMED_PRACTICE", context: { ...goodContext, marketValid: false } },
    ];
    for (const testCase of cases) {
      const harness = makeHarness();
      harness.memory.state = testCase.state;
      const result = await harness.tryForward(decision({ context: testCase.context, marketKey: testCase.context.marketValid === false ? null : "EURUSD:OTC", opportunityId: `cand_${Math.random()}` }));
      expect(result.executed).toBe(false);
    }
  });
});

describe("harness 4x3 â€” caps, atomicidade e idempotencia", () => {
  it("G2 para em 3 e 4a tentativa recebe EXPERIMENT_STRATEGY_CAP_REACHED", async () => {
    const harness = makeHarness(); armMemory(harness);
    for (let index = 0; index < 3; index += 1) {
      const result = await harness.tryForward(decision({ opportunityId: `cand_g2_${index}` }));
      expect(result.executed).toBe(true);
    }
    const fourth = await harness.tryForward(decision({ opportunityId: "cand_g2_4" }));
    expect(fourth.executed).toBe(false);
    expect(fourth.errors).toContain("EXPERIMENT_STRATEGY_CAP_REACHED");
  });
  it("slot #3 e atomico sob concorrencia (count=2: apenas UM consome)", async () => {
    const harness = makeHarness(); armMemory(harness);
    await harness.tryForward(decision({ opportunityId: "c1" }));
    await harness.tryForward(decision({ opportunityId: "c2" }));
    const [a, b] = await Promise.all([
      harness.tryForward(decision({ opportunityId: "c3a" })),
      harness.tryForward(decision({ opportunityId: "c3b" })),
    ]);
    const executed = [a, b].filter((result) => result.executed).length;
    const blocked = [a, b].filter((result) => result.errors?.includes("EXPERIMENT_STRATEGY_CAP_REACHED")).length;
    expect(executed).toBe(1);
    expect(blocked).toBe(1);
  });
  it("idempotencia impede duplicate e retry nao duplica", async () => {
    const harness = makeHarness(); armMemory(harness);
    const first = await harness.tryForward(decision({ opportunityId: "idem1" }));
    expect(first.executed).toBe(true);
    const retry = await harness.tryForward(decision({ opportunityId: "idem1" }));
    expect(retry.duplicate).toBe(true);
    expect(retry.executed).toBe(false);
    const counters = await harness.status();
    expect(counters.progress.PROFESSIONAL_BRAIN_G2.executed).toBe(1);
  });
  it("restart preserva contador (estado persistido em memoria do harness e reusado)", async () => {
    const harness = makeHarness(); armMemory(harness);
    await harness.tryForward(decision({ opportunityId: "r1" }));
    const status = await harness.status();
    expect(status.progress.PROFESSIONAL_BRAIN_G2.executed).toBe(1);
    // simula "restart" reaproveitando o mesmo estado persistido
    const resumed = makeHarness(); resumed.memory = harness.memory;
    const status2 = await resumed.status();
    expect(status2.progress.PROFESSIONAL_BRAIN_G2.executed).toBe(1);
  });
  it("total para em 12 e COMPLETE nao reabre sozinho", async () => {
    const harness = makeHarness(); armMemory(harness);
    const strategies = ["PROFESSIONAL_BRAIN_G2", "PROFESSIONAL_AGENT_SYSTEM_V4", "DUAL_REASONING_V1", "SOLO_REASONING_V1", "INDICATOR_5M_V1"];
    for (const strategyId of strategies) for (let index = 0; index < 3; index += 1) await harness.tryForward(decision({ strategyId, opportunityId: `t_${strategyId}_${index}` }));
    const status = await harness.status();
    expect(status.totalExecuted).toBe(15);
    expect(status.state).toBe("COMPLETE");
    const extra = await harness.tryForward(decision({ strategyId: "PROFESSIONAL_BRAIN_G2", opportunityId: "x1" }));
    expect(extra.executed).toBe(false);
  });
  it("cada estrategia tem slot independente (mesma oportunidade, direcoes diferentes)", async () => {
    const harness = makeHarness(); armMemory(harness);
    const results = await Promise.all([
      harness.tryForward(decision({ strategyId: "PROFESSIONAL_BRAIN_G2", opportunityId: "same1", direction: "BUY" })),
      harness.tryForward(decision({ strategyId: "PROFESSIONAL_AGENT_SYSTEM_V4", opportunityId: "same1", direction: "BUY" })),
      harness.tryForward(decision({ strategyId: "SOLO_REASONING_V1", opportunityId: "same1", direction: "SELL" })),
    ]);
    expect(results.every((result) => result.executed)).toBe(true);
  });
  it("SELL pode executar e stop bloqueia novas ordens", async () => {
    const harness = makeHarness(); armMemory(harness);
    const sell = await harness.tryForward(decision({ strategyId: "DUAL_REASONING_V1", opportunityId: "sell1", direction: "SELL" }));
    expect(sell.executed).toBe(true);
    await harness.stop("TEST_STOP");
    const blocked = await harness.tryForward(decision({ strategyId: "DUAL_REASONING_V1", opportunityId: "sell2", direction: "SELL" }));
    expect(blocked.executed).toBe(false);
  });
  it("guards de validateExperimentGuards cobrem a matriz completa", () => {
    const base = { state: "ARMED_PRACTICE", accountContext: "PRACTICE", brokerAccountType: "PRACTICE", realState: "LOCKED", killSwitchEngaged: false, brokerConnected: true, dataQuality: "HEALTHY", marketValid: true, stake: 1, strategyCount: 0, totalCount: 0 };
    expect(mod.validateExperimentGuards(base).ok).toBe(true);
    expect(mod.validateExperimentGuards({ ...base, state: "DRY_RUN" }).errors).toContain("NOT_ARMED:DRY_RUN");
    expect(mod.validateExperimentGuards({ ...base, strategyCount: 3 }).errors).toContain("EXPERIMENT_STRATEGY_CAP_REACHED");
    expect(mod.validateExperimentGuards({ ...base, totalCount: 15 }).errors).toContain("EXPERIMENT_TOTAL_CAP_REACHED");
    expect(mod.PRACTICE_ONLY).toBe(true);
    expect(mod.ARM_PHRASE).toContain("5X3");
  });
  it("freeze declara caminho unico de broker e caps", () => {
    const manifest = mod.fourWayFreezeManifest();
    expect(manifest.singleBrokerPath).toBe("runtime.requestOrder");
    expect(manifest.maxPerStrategy).toBe(3);
    expect(manifest.maxTotal).toBe(15);
    expect(manifest.practiceOnly).toBe(true);
  });
});


