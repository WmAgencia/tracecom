/**
 * REGRESSÃO — classificação de SUSPENDED com evidência independente (lição do incidente 2026-09-18).
 *
 * Cobertura:
 *  1. snapshot completo + suspenso => SUSPENDED (resolver)
 *  2. snapshot incompleto => UNKNOWN (nunca SUSPENDED)
 *  3. ativo ausente em snapshot incompleto => UNKNOWN
 *  4. snapshot persistido stale => UNKNOWN
 *  5. reconexão/snapshot fresco => recuperação
 *  6. conflito MCP (MCP OPEN x WS SUSPENDED) => CONFLICT, sem override silencioso
 *  7. política por produto (turbo/binary/digital), NORMAL ≠ OTC, expiração/sem MCP
 *
 * Nenhuma ordem; nenhum Brain/Feature Engine/Critic/Consensus/Quality Gate/JIT/
 * Entry Location/MicroVeto/Portfolio/Execution Gate é tocado.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const resolverModule = await import("../../relay/asset-resolver.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const classifierModule = await import("../../relay/market-state-classifier.mjs");
const { RuntimeAssetResolver } = resolverModule as unknown as Record<string, any>;
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;
const { classifyMarketState, MARKET_STATE, MARKET_STATE_CLASSIFIER_VERSION } = classifierModule as unknown as Record<string, any>;

const initData = (binary: Record<string, any>, turbo: Record<string, any> = {}) => ({ binary: { actives: binary }, turbo: { actives: turbo } });

function runtimeFixture() {
  const runtime = new IqMultiRuntime({ pool: null, getSsid: () => null, now: () => Date.now(), log: () => {}, ackTimeoutMs: 80 }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: "conn-suspended-28", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true, connectedAt: Date.now() };
  runtime.connection = { connectionId: "conn-suspended-28", host: "ws.iqoption.com", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 1000, currency: "USD" }, real: { available: false, balanceId: null, balance: null, currency: null }, hasReal: false, checkedAt: Date.now(), type: "PRACTICE" };
  runtime.client = { serverNow: () => Date.now(), placeOrder: () => "req", getOptions: async () => ({ response: { msg: {} } }) };
  return runtime;
}

const wsEvidence = (overrides: Record<string, any> = {}) => ({
  fresh: true,
  complete: true,
  staleSnapshot: false,
  availability: "SUSPENDED",
  activeId: 76,
  candidates: [{ section: "turbo", activeId: 76, enabled: true, suspended: true }, { section: "binary", activeId: 76, enabled: true, suspended: true }],
  ...overrides,
});

describe("RESOLVER — SUSPENDED só com snapshot completo; ausência/parcialidade NUNCA vira SUSPENDED", () => {
  it("snapshot completo e estável com is_suspended=true => SUSPENDED (suspensão real do broker)", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData(
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false }, "81": { name: "front.GBPUSD-OTC", enabled: true, is_suspended: false } },
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false } },
    ));
    expect(resolver.get("EURUSD:OTC").availability).toBe("OPEN");
    // snapshot COMPLETO (mesmo universo resolvido): a suspensão passa a ser verdade do broker
    resolver.ingestInitializationData(initData(
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true }, "81": { name: "front.GBPUSD-OTC", enabled: true, is_suspended: true } },
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } },
    ));
    expect(resolver.lastSnapshotIncomplete).toBe(false);
    expect(resolver.get("EURUSD:OTC")).toMatchObject({ availability: "SUSPENDED", activeId: 76, staleSnapshot: false });
    expect(resolver.get("GBPUSD:OTC")).toMatchObject({ availability: "SUSPENDED", activeId: 81 });
  });

  it("snapshot INCOMPLETO => UNKNOWN (nunca SUSPENDED/NOT_OFFERED) e volátil até o broker reconfirmar", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData(
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false }, "81": { name: "front.GBPUSD-OTC", enabled: true, is_suspended: false } },
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false } },
    ));
    // feed degradado: ativos confirmados somem e os restantes chegam suspensos (cenário do incidente)
    resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } }));
    expect(resolver.lastSnapshotIncomplete).toBe(true);
    expect(resolver.get("EURUSD:OTC").availability).toBe("UNKNOWN");
    expect(resolver.get("GBPUSD:OTC").availability).toBe("UNKNOWN");
    expect(resolver.get("EURUSD:OTC").staleSnapshot).toBe(true);
  });

  it("ativo AUSENTE de um snapshot incompleto => UNKNOWN (não NOT_OFFERED)", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData(
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false }, "2122": { name: "front.EURNZD-OTC", enabled: true, is_suspended: false } },
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false } },
    ));
    expect(resolver.get("EURNZD:OTC").availability).toBe("OPEN");
    // EURNZD some por completo (ausente => availability NOT_OFFERED no merge) e o snapshot encolhe
    resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false } }));
    expect(resolver.lastSnapshotIncomplete).toBe(true);
    expect(resolver.get("EURNZD:OTC").availability).toBe("UNKNOWN");
    expect(resolver.get("EURNZD:OTC").offered).toBe(false);
  });

  it("snapshot persistido (loadFrom) com status negativo => UNKNOWN até confirmação ao vivo", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.loadFrom({ lastResolvedAt: Date.now() - 60_000, markets: [
      { marketKey: "EURUSD:OTC", availability: "SUSPENDED", activeId: 76, candidates: [] },
      { marketKey: "USDCAD:OTC", availability: "NOT_OFFERED", activeId: null, candidates: [] },
    ] });
    expect(resolver.get("EURUSD:OTC").availability).toBe("UNKNOWN");
    expect(resolver.get("USDCAD:OTC").availability).toBe("UNKNOWN");
  });

  it("fresh reconnect: snapshot completo novo recupera OPEN sem restart e sem mascarar SUSPENDED real", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } }));
    expect(resolver.get("EURUSD:OTC").availability).toBe("SUSPENDED");
    // reconexão: snapshot completo com o ativo aberto
    resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false } }));
    expect(resolver.lastSnapshotIncomplete).toBe(false);
    expect(resolver.get("EURUSD:OTC")).toMatchObject({ availability: "OPEN", activeId: 76, suspended: false });
    // e uma suspensão real subsequente (snapshot completo) continua SUSPENDED
    resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } }));
    expect(resolver.get("EURUSD:OTC").availability).toBe("SUSPENDED");
  });

  it("runtime: transição UNKNOWN (snapshot incompleto) -> SUSPENDED só após feed estável, agente dorme e acorda", () => {
    const runtime = runtimeFixture();
    runtime.markets.get("EURUSD:OTC").enabled = true;
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false }, "81": { name: "front.GBPUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    expect(runtime.markets.get("EURUSD:OTC").availability).toBe("OPEN");
    // snapshot incompleto (GBPUSD some) derruba para UNKNOWN: não é fechamento confirmado
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } }));
    runtime.ingestAuxiliary({});
    expect(runtime.markets.get("EURUSD:OTC").availability).toBe("UNKNOWN");
    // feed completo confirma a suspensão real
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true }, "81": { name: "front.GBPUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    expect(runtime.markets.get("EURUSD:OTC").availability).toBe("SUSPENDED");
    expect(runtime.markets.get("EURUSD:OTC").agentState).toBe("UNAVAILABLE");
    // broker reabre: snapshot completo OPEN
    runtime.resolver.ingestInitializationData(initData({ "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: false }, "81": { name: "front.GBPUSD-OTC", enabled: true, is_suspended: false } }));
    runtime.ingestAuxiliary({});
    expect(runtime.markets.get("EURUSD:OTC").availability).toBe("OPEN");
    expect(runtime.markets.get("EURUSD:OTC").agentState).toBe("WAIT");
  });

  it("NORMAL e OTC permanecem isolados mesmo quando um está suspenso", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData(initData(
      { "1861": { name: "front.EURUSD-op", enabled: true, is_suspended: false }, "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } },
      { "76": { name: "front.EURUSD-OTC", enabled: true, is_suspended: true } },
    ));
    expect(resolver.get("EURUSD:NORMAL")).toMatchObject({ activeId: 1861, availability: "OPEN" });
    expect(resolver.get("EURUSD:OTC")).toMatchObject({ activeId: 76, availability: "SUSPENDED" });
  });
});

describe("CLASSIFICADOR DE EVIDÊNCIA — WS fresco + MCP do MESMO produto", () => {
  it("existe versão explícita do classificador (artefato auditável)", () => {
    expect(MARKET_STATE_CLASSIFIER_VERSION).toBe("market-state-classifier-v1");
  });

  it("WS fresco completo+SUPERPENDED com MCP turbo/binary is_open=false => BROKER_CONFIRMED_SUSPENDED", () => {
    const out = classifyMarketState({
      ws: wsEvidence(),
      mcp: { turbo: { present: true, isOpen: false, assetId: 76 }, binary: { present: true, isOpen: false, assetId: 76 } },
    });
    expect(out.classification).toBe(MARKET_STATE.BROKER_CONFIRMED_SUSPENDED);
  });

  it("MCP diz OPEN e WS fresco diz SUSPENDED => CONFLICT (nunca override silencioso)", () => {
    const out = classifyMarketState({
      ws: wsEvidence(),
      mcp: { turbo: { present: true, isOpen: true, assetId: 76 }, binary: { present: true, isOpen: false, assetId: 76 } },
    });
    expect(out.classification).toBe(MARKET_STATE.CONFLICT);
    expect(out.openClaims).toContain("turbo");
    // o conflito por produto vence mesmo que o outro produto concorde com o WS
  });

  it("WS fresco diz OPEN mas MCP do produto diz is_open=false => CONFLICT", () => {
    const out = classifyMarketState({
      ws: wsEvidence({ availability: "OPEN", activeId: 1861, candidates: [{ section: "turbo", activeId: 1861, enabled: true, suspended: false }] }),
      mcp: { turbo: { present: true, isOpen: false, assetId: 1861 } },
    });
    expect(out.classification).toBe(MARKET_STATE.CONFLICT);
  });

  it("WS fresco OPEN e MCP OPEN => BROKER_CONFIRMED_OPEN", () => {
    const out = classifyMarketState({
      ws: wsEvidence({ availability: "OPEN", activeId: 1861, candidates: [{ section: "turbo", activeId: 1861, enabled: true, suspended: false }] }),
      mcp: { turbo: { present: true, isOpen: true, assetId: 1861 } },
    });
    expect(out.classification).toBe(MARKET_STATE.BROKER_CONFIRMED_OPEN);
  });

  it("WS fresco SUSPENDED sem NENHUMA contraparte MCP => NOT_OFFERED_FOR_PRODUCT", () => {
    const out = classifyMarketState({ ws: wsEvidence({ activeId: 1480 }), mcp: { turbo: { present: false }, binary: { present: false } } });
    expect(out.classification).toBe(MARKET_STATE.NOT_OFFERED_FOR_PRODUCT);
  });

  it("WS fresco SUSPENDED sem dados MCP (ausência de evidência) => UNKNOWN, nunca SUSPENDED", () => {
    const out = classifyMarketState({ ws: wsEvidence(), mcp: null });
    expect(out.classification).toBe(MARKET_STATE.UNKNOWN);
  });

  it("WS stale ou incompleto => SESSION_DATA_STALE mesmo com MCP is_open=false", () => {
    for (const override of [{ staleSnapshot: true }, { complete: false }, { fresh: false }]) {
      const out = classifyMarketState({ ws: wsEvidence(override), mcp: { turbo: { present: true, isOpen: false, assetId: 76 } } });
      expect(out.classification).toBe(MARKET_STATE.SESSION_DATA_STALE);
    }
  });

  it("produto ausente no MCP + outro produto is_open=false => SUSPENDED com nota de ausência", () => {
    const out = classifyMarketState({
      ws: wsEvidence({ candidates: [{ section: "turbo", activeId: 85, enabled: true, suspended: true }, { section: "binary", activeId: 85, enabled: true, suspended: true }] }),
      mcp: { turbo: { present: false }, binary: { present: true, isOpen: false, assetId: 85 } },
    });
    expect(out.classification).toBe(MARKET_STATE.BROKER_CONFIRMED_SUSPENDED);
    expect(out.reason).toContain("turbo");
  });

  it("NORMAL ≠ OTC no casamento: MCP só do MESMO tipo; produto diferente não 'abre' o OTC", () => {
    const otc = classifyMarketState({
      ws: wsEvidence({ candidates: [{ section: "binary", activeId: 85, enabled: true, suspended: true }] }),
      mcp: { binary: { present: true, isOpen: false, assetId: 85 } },
    });
    expect(otc.classification).toBe(MARKET_STATE.BROKER_CONFIRMED_SUSPENDED);
    // o mesmo canonical NORMAL aberto (turbo) é outro mercado e não muda o OTC suspenso
    const normal = classifyMarketState({
      ws: wsEvidence({ availability: "OPEN", activeId: 1865, candidates: [{ section: "turbo", activeId: 1865, enabled: true, suspended: false }] }),
      mcp: { turbo: { present: true, isOpen: true, assetId: 1865 }, binary: { present: false } },
    });
    expect(normal.classification).toBe(MARKET_STATE.BROKER_CONFIRMED_OPEN);
    // conflito real: o MESMO produto do candidato diz OPEN para o ativo suspenso
    const conflict = classifyMarketState({
      ws: wsEvidence({ candidates: [{ section: "binary", activeId: 85, enabled: true, suspended: true }] }),
      mcp: { binary: { present: true, isOpen: true, assetId: 85 } },
    });
    expect(conflict.classification).toBe(MARKET_STATE.CONFLICT);
  });
});
