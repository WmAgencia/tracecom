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
