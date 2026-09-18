/** FASE 6.5 — status de mercado vindo do broker (NOT_OFFERED/SUSPENDED/OPEN) + ARM estruturado.
 * Nao altera Brain/curriculo/score/JIT: cobre resolucao de disponibilidade e recusa/aceitacao de ARM. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const resolverModule = await import("../../relay/asset-resolver.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { RuntimeAssetResolver } = resolverModule as unknown as Record<string, any>;
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const initData = (actives: Record<string, any>, turbo: Record<string, any> = {}) => ({ binary: { actives }, turbo: { actives: turbo } });

function fixture() {
  const runtime = new IqMultiRuntime({ pool: null, getSsid: () => null, now: () => Date.now(), log: () => {}, ackTimeoutMs: 80 }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-status", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true, connectedAt: Date.now() };
  runtime.connection = { connectionId: "conn-status", host: "ws.iqoption.com", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 1000, currency: "USD" }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: Date.now(), type: "PRACTICE" };
  runtime.client = { serverNow: () => Date.now(), placeOrder: () => "req", getOptions: async () => ({ response: { msg: {} } }) };
  return runtime;
}

describe("MARKET STATUS — fonte de verdade e o broker (nunca horario teorico)", () => {
  it("instrumento ausente em todas as secoes vira NOT_OFFERED (nao 'fechado')", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } }));
    expect(resolver.get("EURUSD:OTC").availability).toBe("OPEN");
    expect(resolver.get("USDCHF:NORMAL").availability).toBe("NOT_OFFERED");
    expect(resolver.get("USDCHF:NORMAL").offered).toBe(false);
    expect(resolver.get("USDCHF:NORMAL").activeId).toBeNull();
  });

  it("suspensao e reopen do broker alteram a disponibilidade sem restart e acordam/dormem o agente", () => {
    const runtime = fixture();
    runtime.markets.get("EURUSD:OTC").enabled = true; // simula mercado habilitado persistido antes da manutencao
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    const ctx = runtime.markets.get("EURUSD:OTC");
    expect(ctx.availability).toBe("SUSPENDED");
    expect(ctx.agentState).toBe("UNAVAILABLE");
    // broker reabre: nova mensagem de initialization-data (refresh em tempo real)
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    expect(ctx.availability).toBe("OPEN");
    expect(ctx.agentState).toBe("WAIT");
    expect(ctx.activeId).toBe(76);
    const reopened = runtime.eventsAfter(0, 200).events.filter((event: any) => event.type === "market.reopened" && event.marketKey === "EURUSD:OTC");
    expect(reopened.length).toBeGreaterThanOrEqual(1);
    // fecha de novo: agente dorme
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    expect(ctx.agentState).toBe("UNAVAILABLE");
  });

  it("snapshot persistido com status negativo vira UNKNOWN ate o broker confirmar", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.loadFrom({ lastResolvedAt: Date.now() - 1000, markets: [{ marketKey: "EURUSD:OTC", availability: "SUSPENDED", activeId: 76, candidates: [] }, { marketKey: "USDJPY:OTC", availability: "NOT_OFFERED", activeId: null, candidates: [] }] });
    expect(resolver.get("EURUSD:OTC").availability).toBe("UNKNOWN");
    expect(resolver.get("USDJPY:OTC").availability).toBe("UNKNOWN");
    resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } }));
    expect(resolver.get("EURUSD:OTC").availability).toBe("OPEN");
    expect(resolver.get("EURUSD:OTC").staleSnapshot).toBe(false);
  });

  it("snapshot INCOMPLETO do broker (feed stale/ausente/reconectando) vira UNKNOWN, nunca SUSPENDED/NOT_OFFERED", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData({
      "1861": { name: "front.EURUSD-op", enabled: true, is_suspended: false },
      "1865": { name: "front.USDJPY-op", enabled: true, is_suspended: false },
    }));
    expect(resolver.get("EURUSD:NORMAL").availability).toBe("OPEN");
    expect(resolver.get("USDJPY:NORMAL").availability).toBe("OPEN");
    // mesmo cenario do incidente: ativos confirmados somem e os restantes chegam suspensos
    resolver.ingestInitializationData(initData({ "1861": { name: "front.EURUSD-op", enabled: true, is_suspended: true } }));
    expect(resolver.lastSnapshotIncomplete).toBe(true);
    expect(resolver.get("EURUSD:NORMAL").availability).toBe("UNKNOWN");
    expect(resolver.get("USDJPY:NORMAL").availability).toBe("UNKNOWN");
    expect(resolver.get("EURUSD:NORMAL").staleSnapshot).toBe(true);
    // snapshot completo volta a ser a verdade do broker
    resolver.ingestInitializationData(initData({
      "1861": { name: "front.EURUSD-op", enabled: true, is_suspended: false },
      "1865": { name: "front.USDJPY-op", enabled: true, is_suspended: false },
    }));
    expect(resolver.lastSnapshotIncomplete).toBe(false);
    expect(resolver.get("EURUSD:NORMAL").availability).toBe("OPEN");
    expect(resolver.get("USDJPY:NORMAL").availability).toBe("OPEN");
  });

  it("suspensao REAL do broker com snapshot completo continua SUSPENDED", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData({
      "1861": { name: "front.EURUSD-op", enabled: true, is_suspended: false },
      "1865": { name: "front.USDJPY-op", enabled: true, is_suspended: false },
    }));
    resolver.ingestInitializationData(initData({
      "1861": { name: "front.EURUSD-op", enabled: true, is_suspended: true },
      "1865": { name: "front.USDJPY-op", enabled: true, is_suspended: false },
    }));
    expect(resolver.lastSnapshotIncomplete).toBe(false);
    expect(resolver.get("EURUSD:NORMAL").availability).toBe("SUSPENDED");
    expect(resolver.get("USDJPY:NORMAL").availability).toBe("OPEN");
  });

  it("NORMAL e OTC nunca se misturam (activeIds e status independentes)", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData({ "1": { name: "EURUSD", enabled: true, is_suspended: true }, "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } }));
    expect(resolver.get("EURUSD:NORMAL")).toMatchObject({ activeId: 1, availability: "SUSPENDED" });
    expect(resolver.get("EURUSD:OTC")).toMatchObject({ activeId: 76, availability: "OPEN" });
  });
});

describe("ARM — recusa estruturada e aceitacao mesmo em manutencao do broker", () => {
  it("ARM com mercado SUSPENSO e aceito com aviso NO_OPEN_MARKET_NOW (execucao continua bloqueada pelo gate)", () => {
    const runtime = fixture();
    runtime.markets.get("EURUSD:OTC").enabled = true;
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    const arm = runtime.arm(10, { confirmation: true });
    expect(arm.armed).toBe(true);
    expect(arm.warning).toBe("NO_OPEN_MARKET_NOW");
    expect(arm.openMarkets).toBe(0);
    expect(arm.marketsEnabled).toBe(1);
    expect(arm.markets[0]).toMatchObject({ marketKey: "EURUSD:OTC", availability: "SUSPENDED" });
  });

  it("ARM com mercado OPEN nao emite aviso e reporta openMarkets", () => {
    const runtime = fixture();
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    runtime.setMarket("EURUSD:OTC", { enabled: true }, { persist: false });
    const arm = runtime.arm(10, { confirmation: true });
    expect(arm.armed).toBe(true);
    expect(arm.warning).toBeNull();
    expect(arm.openMarkets).toBe(1);
  });

  it("ARM sem mercado habilitado falha com NO_ACTIVE_MARKET; sem confirmacao falha com EXPLICIT_CONFIRMATION_REQUIRED", () => {
    const runtime = fixture();
    expect(() => runtime.arm(10, { confirmation: true })).toThrowError(/NO_ACTIVE_MARKET/);
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    runtime.setMarket("EURUSD:OTC", { enabled: true }, { persist: false });
    expect(() => runtime.arm(10, { confirmation: false })).toThrowError(/EXPLICIT_CONFIRMATION_REQUIRED/);
    expect(() => runtime.arm(10, { confirmation: true })).not.toThrow();
  });

  it("re-ARM idempotente: segundo ARM com confirmacao nao falha e atualiza limite", () => {
    const runtime = fixture();
    runtime.markets.get("EURUSD:OTC").enabled = true;
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    const first = runtime.arm(10, { confirmation: true });
    expect(first.armed).toBe(true);
    const second = runtime.arm(25, { confirmation: true });
    expect(second.armed).toBe(true);
    expect(second.userLimitBrl).toBe(25);
    expect(() => runtime.arm(25, { confirmation: false })).toThrowError(/EXPLICIT_CONFIRMATION_REQUIRED/);
  });

  it("tradabilityCheck NUNCA cria ordem; probe de ordem exige createPosition explicito", async () => {
    const runtime = fixture();
    runtime.markets.get("EURUSD:OTC").enabled = true;
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    runtime.arm(10, { confirmation: true });
    const check = await runtime.tradabilityCheck("EURUSD:OTC");
    expect(check.ordering).toBe(false);
    expect(check.tradable).toBe(false);
    expect(check.evidence.brokerSuspended).toBe(true);
    const probeDefault = await runtime.probeTradability("EURUSD:OTC");
    expect(probeDefault.ordering).toBe(false);
    expect(runtime.pendingOrders.size).toBe(0);
    expect(runtime.openPositions.size).toBe(0);
  });

  it("trade de infraestrutura (infraProbe) NAO entra em journal, qualidade, WR ou PnL", async () => {
    const runtime = fixture();
    const position = { marketKey: "EURUSD:OTC", mode: "PRACTICE", direction: "CALL", stake: 10, entryPrice: 1.1, brokerOrderId: "PROBE-1", expirationSec: Math.floor(Date.now() / 1000) + 60, openedAt: Date.now(), executionId: "exec_probe_1", source: "AUDIT_PROBE", connectionId: "conn-status", correlationId: "corr_probe_1", infraProbe: true, decisionSnapshot: { source: "T0_DECISION_SNAPSHOT" } };
    runtime.openPositions.set("EURUSD:OTC", position);
    runtime.orderIndex.set("PROBE-1", "EURUSD:OTC");
    runtime.ingestEvent("socket-option-closed", { connectionId: "conn-status", receivedAt: Date.now(), msg: { id: "PROBE-1", win: "win", sum: 10, win_amount: 18.5 } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(runtime.journal.trades).toHaveLength(0);
    expect(runtime.qualityStatus().trades).toBe(0);
    expect(runtime.jit.counters.candidates).toBe(0);
    const audit = runtime.auditTrail({ limit: 10 }).audit.filter((row: any) => row.stage === "INFRA_PROBE_SETTLED" || row.stage === "PROFESSOR_REVIEW");
    expect(audit.some((row: any) => row.stage === "INFRA_PROBE_SETTLED")).toBe(true);
    expect(audit.some((row: any) => row.stage === "PROFESSOR_REVIEW")).toBe(false);
  });

  it("transicao para OPEN registra REOPEN_VALIDATION com broker/resolver/agente/feed/ARM", () => {
    const runtime = fixture();
    runtime.markets.get("EURUSD:OTC").enabled = true;
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    const reopened = runtime.eventsAfter(0, 300).events.find((event: any) => event.type === "market.reopened" && event.marketKey === "EURUSD:OTC");
    expect(reopened).toBeTruthy();
    expect(reopened.validation).toMatchObject({ brokerOpen: true, resolverOpen: true, agentAwake: true, reason: "SUSPENDED->OPEN" });
    expect(reopened.validation.serverNow).toBeGreaterThan(0);
    expect(reopened.validation.evidence.activeId).toBe(76);
  });

  it("UI mostra a razao real da recusa e o aviso de broker fechado (sem mascarar)", async () => {
    const fs = await import("node:fs");
    const office = fs.readFileSync("src/http/public/office.js", "utf8");
    expect(office).toContain("ARM recusado");
    expect(office).toContain("NO_OPEN_MARKET_NOW");
    expect(office).toContain("availabilityLabel");
    expect(office).toContain("SUSPENSO PELA IQ");
    expect(office).toContain("NAO OFERECIDO PELA IQ");
    expect(office).not.toContain("Não foi possível iniciar o sistema");
  });
});
