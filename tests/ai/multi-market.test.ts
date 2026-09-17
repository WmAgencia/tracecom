/** FASE 4 — multiativo: isolamento NORMAL/OTC, limite de 10, simultaneidade, stake, REAL gate,
 * restart safety, idempotencia e ausencia de segredo. */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const universeModule = await import("../../relay/market-universe.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const resolverModule = await import("../../relay/asset-resolver.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const gateModule = await import("../../relay/portfolio-gate.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const realModule = await import("../../relay/real-mode.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-multi-runtime.mjs");
const { UNIVERSE, marketKey, MAX_ACTIVE_MARKETS, canActivateMore, concentrationExposure, entryForKey } = universeModule as unknown as Record<string, any>;
const { RuntimeAssetResolver } = resolverModule as unknown as Record<string, any>;
const { PortfolioExecutionGate, resolveFinalStake } = gateModule as unknown as Record<string, any>;
const { RealModeController, REAL_CONFIRMATION_PHRASE } = realModule as unknown as Record<string, any>;
const { IqMultiRuntime } = runtimeModule as unknown as Record<string, any>;

const CONNECTION_ID = "conn-multi-1";
const FAKE_SSID = "FAKE_SSID_NEVER_LEAK_1234567890";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function seedMarket(runtime: any, key: string, { activeId, close = 1.1, payout = 85, candles = 5, enabled = true }: { activeId: number; close?: number; payout?: number; candles?: number; enabled?: boolean }) {
  const ctx = runtime.markets.get(key);
  ctx.availability = "OPEN"; ctx.activeId = activeId; ctx.payout = payout; ctx.payoutSource = "test"; ctx.enabled = enabled; ctx.maxStake = 2;
  const base = Math.floor(Date.now() / 5_000) * 5_000;
  for (let index = 1; index <= candles; index += 1) {
    const fromSec = Math.floor((base - (candles - index) * 5_000) / 1000);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { active_id: activeId, size: 5, from: fromSec, to: fromSec + 5, open: close, high: close + 0.0001, low: close - 0.0001, close: Number((close + index * 0.00001).toFixed(6)) } });
  }
  return ctx;
}

function multiFixture(overrides: Record<string, unknown> = {}) {
  const runtime = new IqMultiRuntime({ pool: null, getSsid: () => FAKE_SSID, now: () => Date.now(), log: () => {}, ackTimeoutMs: 80, ...overrides }) as any;
  runtime.session = { connected: true, host: "ws.iqoption.com", connectionId: CONNECTION_ID, serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true, connectedAt: Date.now() };
  runtime.connection = { connectionId: CONNECTION_ID, host: "ws.iqoption.com", serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true };
  runtime.account = { practice: { verified: true, balanceId: 555, balance: 10_000, currency: "USD" }, real: { available: true, balanceId: 777, balance: 500, currency: "USD" }, hasReal: true, checkedAt: Date.now(), type: "PRACTICE" };
  runtime.config.autoExecute = false; runtime.config.globalMaxStake = 2; runtime.config.calculatedBankrollStake = 1;
  runtime.__sent = [];
  runtime.client = { serverNow: () => Date.now(), placeOrder: (options: Record<string, unknown>) => { runtime.__sent.push(options); return options.requestId; }, getOptions: async () => ({ response: { msg: { closed_options: [] } } }) };
  return runtime;
}

async function ack(runtime: any, key: string, orderId: string) {
  const pending = runtime.pendingOrders.get(key);
  runtime.ingestEvent("socket-option-opened", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { id: orderId, active_id: pending.activeId, price: pending.stake, expired: pending.expirationSec } });
  await sleep(15);
  return pending;
}

describe("MARKET UNIVERSE — chaves explicitas e limite global", () => {
  it("15 mercados, NORMAL ≠ OTC com chaves distintas e 11o bloqueado", () => {
    expect(UNIVERSE).toHaveLength(15);
    expect(marketKey("EURUSD", "NORMAL")).toBe("EURUSD:NORMAL");
    expect(marketKey("EURUSD", "OTC")).toBe("EURUSD:OTC");
    expect(entryForKey("EURUSD:NORMAL").marketType).toBe("NORMAL");
    expect(entryForKey("EURUSD:OTC").marketType).toBe("OTC");
    expect(MAX_ACTIVE_MARKETS).toBe(10);
    const ten = UNIVERSE.slice(0, 10).map((entry: any) => marketKey(entry.canonical, entry.marketType));
    expect(canActivateMore(ten).allowed).toBe(false);
    expect(canActivateMore(ten.slice(0, 9)).allowed).toBe(true);
  });
  it("monitor de concentracao detecta exposicao duplicada em USD", () => {
    const exposure = concentrationExposure([
      { marketKey: "EURUSD:NORMAL", direction: "CALL", stake: 2 },
      { marketKey: "GBPUSD:NORMAL", direction: "CALL", stake: 2 },
      { marketKey: "AUDUSD:NORMAL", direction: "CALL", stake: 2 },
    ]);
    const usd = exposure.exposures.find((row: any) => row.currency === "USD");
    expect(usd.net).toBe(-6);
    expect(exposure.warnings.some((warning: any) => warning.currency === "USD" && warning.code === "CONCENTRATION_HIGH")).toBe(true);
  });
});

describe("RUNTIME ASSET RESOLVER — sem fallback silencioso NORMAL->OTC", () => {
  it("resolver separa EURUSD NORMAL (1) de EURUSD OTC (76) e nao cria fallback", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData({ binary: { actives: { "1": { name: "EURUSD", enabled: true, is_suspended: false, payout: 82 }, "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false, payout: 88 } } }, turbo: { actives: { "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } } } });
    const normal = resolver.get("EURUSD:NORMAL");
    const otc = resolver.get("EURUSD:OTC");
    expect(normal).toMatchObject({ activeId: 1, availability: "OPEN", marketType: "NORMAL" });
    expect(otc).toMatchObject({ activeId: 76, availability: "OPEN", marketType: "OTC" });
    expect(normal.activeId).not.toBe(otc.activeId);
    resolver.ingestInitializationData({ binary: { actives: { "76": { name: "EURUSD-OTC", enabled: true } } }, turbo: { actives: {} } });
    expect(resolver.get("EURUSD:NORMAL")).toMatchObject({ activeId: null, availability: "NOT_FOUND" });
    expect(resolver.get("EURUSD:OTC").activeId).toBe(76);
  });
  it("suspenso/dedicado: NORMAL suspenso fica SUSPENDED (nunca vira OTC)", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData({ binary: { actives: { "1": { name: "EURUSD", enabled: true, is_suspended: true }, "76": { name: "EURUSD-OTC", enabled: true } } }, turbo: { actives: {} } });
    expect(resolver.get("EURUSD:NORMAL")).toMatchObject({ activeId: 1, availability: "SUSPENDED" });
  });
});

describe("PORTFOLIO GATE — stake/caps", () => {
  it("finalStake = min(bankroll, market, global, hardCap)", () => {
    expect(resolveFinalStake({ calculatedBankrollStake: 10, marketMaxStake: 2, globalMaxStake: 5, hardCap: 100 }).finalStake).toBe(2);
    expect(resolveFinalStake({ calculatedBankrollStake: 1.4, marketMaxStake: 2, globalMaxStake: 5, hardCap: 100 }).finalStake).toBe(1.4);
    expect(resolveFinalStake({ calculatedBankrollStake: 500, marketMaxStake: 500, globalMaxStake: 500, hardCap: 100 }).finalStake).toBe(100);
  });
  it("bloqueia 11o ativo, REAL sem autorizacao e stake acima do cap", () => {
    const gate = new PortfolioExecutionGate() as any;
    const base = {
      market: { marketKey: "EURUSD:NORMAL", marketType: "NORMAL", enabled: true, availability: "OPEN", activeId: 1, maxStake: 2, payout: 85 },
      marketKey: "EURUSD:NORMAL", requestedMode: "PRACTICE", realAuthorized: false,
      connection: { connected: true, timeValid: true }, serverTime: { ms: Date.now(), skewMs: 0 }, freshness: { fresh: true, tickAgeMs: 100 },
      decision: { action: "BUY", ageMs: 0 }, strategy: { valid: true, variantId: "TREND_PULLBACK" }, price: 1.1, stake: 2, globalMaxStake: 2, horizonSeconds: 60,
      openPositions: [], pendingOrderKeys: [], usedIdempotencyKeys: [], activeMarketKeys: ["EURUSD:NORMAL"], killSwitch: { executionEnabled: true }, idempotencyKey: "k1",
    };
    expect(gate.evaluate(base).allowed).toBe(true);
    expect(gate.evaluate({ ...base, requestedMode: "REAL" }).allowed).toBe(false);
    expect(gate.evaluate({ ...base, decision: { action: "WAIT", ageMs: 0 } }).allowed).toBe(false);
    expect(gate.evaluate({ ...base, market: { ...base.market, paused: true } }).reasons).toContain("market_not_paused");
    const eleven = Array.from({ length: 11 }, (_, index) => `M${index}:NORMAL`);
    expect(gate.evaluate({ ...base, activeMarketKeys: eleven }).reasons).toContain("active_markets_respected");
    expect(gate.evaluate({ ...base, stake: 150, globalMaxStake: 200, market: { ...base.market, maxStake: 200 } }).reasons).toContain("hard_cap_respected");
  });
});

describe("REAL MODE — confirmacao explicita server-side", () => {
  it("frase/checkbox/saldo/cap obrigatorios; sessao revogavel e expiravel", () => {
    const controller = new RealModeController({ now: () => 1_000_000 }) as any;
    expect(() => controller.requestConfirmation({ phrase: "errado", acknowledgeRisk: true, realBalance: 100, realBalanceId: 7, maxStake: 2 })).toThrowError(/REAL_PHRASE_MISMATCH/);
    expect(() => controller.requestConfirmation({ phrase: REAL_CONFIRMATION_PHRASE, acknowledgeRisk: false, realBalance: 100, realBalanceId: 7, maxStake: 2 })).toThrowError(/REAL_RISK_ACK_REQUIRED/);
    expect(() => controller.requestConfirmation({ phrase: REAL_CONFIRMATION_PHRASE, acknowledgeRisk: true, realBalance: 0, realBalanceId: 7, maxStake: 2 })).toThrowError(/REAL_BALANCE_UNAVAILABLE/);
    expect(() => controller.requestConfirmation({ phrase: REAL_CONFIRMATION_PHRASE, acknowledgeRisk: true, realBalance: 100, realBalanceId: 7, maxStake: 500 })).toThrowError(/REAL_MAX_STAKE_ABOVE_HARD_CAP/);
    const status = controller.requestConfirmation({ phrase: REAL_CONFIRMATION_PHRASE, acknowledgeRisk: true, realBalance: 100, realBalanceId: 7, maxStake: 2 });
    expect(status).toMatchObject({ realModeEnabled: true, maxStake: 2, realBalanceSeen: 100 });
    expect(controller.authorizeOrder({ stake: 2, marketKey: "EURUSD:NORMAL" }).stake).toBe(2);
    expect(() => controller.authorizeOrder({ stake: 3 })).toThrowError(/REAL_SESSION_STAKE_EXCEEDED/);
    controller.revoke("TEST");
    expect(controller.status().realModeEnabled).toBe(false);
    expect(() => controller.authorizeOrder({ stake: 1 })).toThrowError(/REAL_MODE_NOT_CONFIRMED/);
  });
});

describe("MULTI RUNTIME — isolamento, simultaneidade, stake e restart", () => {
  it("candles de EUR/USD nunca vao para USD/JPY e NORMAL/OTC nao compartilham buffer", () => {
    const runtime = multiFixture();
    const eurusdNormal = seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    const usdjpyNormal = seedMarket(runtime, "USDJPY:NORMAL", { activeId: 201 });
    const eurusdOtc = seedMarket(runtime, "EURUSD:OTC", { activeId: 301 });
    const before = { usdjpy: usdjpyNormal.candles.size, otc: eurusdOtc.candles.size };
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { active_id: 101, size: 5, from: Math.floor((Date.now() - 5_000) / 1000), open: 1.2, high: 1.21, low: 1.19, close: 1.205 } });
    expect(usdjpyNormal.candles.size).toBe(before.usdjpy);
    expect(eurusdOtc.candles.size).toBe(before.otc);
    expect(eurusdNormal.lastCandle.close).toBe(1.205);
    expect(eurusdNormal.lastCandle.segmentId.startsWith("EURUSD:NORMAL:")).toBe(true);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { active_id: 301, size: 5, from: Math.floor((Date.now() - 5_000) / 1000), open: 1.3, high: 1.31, low: 1.29, close: 1.305 } });
    expect(eurusdOtc.lastCandle.close).toBe(1.305);
    expect(eurusdNormal.lastCandle.close).toBe(1.205);
  });
  it("11o ativo e bloqueado e ha exatamente 10 mesas ativas", () => {
    const runtime = multiFixture();
    const keys = [...runtime.markets.keys()];
    keys.slice(0, 10).forEach((key: string, index: number) => seedMarket(runtime, key, { activeId: 400 + index }));
    for (const key of keys.slice(0, 10)) runtime.setMarket(key, { enabled: true }, { persist: false });
    expect(runtime.activeMarketKeys()).toHaveLength(10);
    seedMarket(runtime, keys[10], { activeId: 999, enabled: false });
    expect(() => runtime.setMarket(keys[10], { enabled: true }, { persist: false })).toThrowError(/MAX_ACTIVE_MARKETS_REACHED/);
  });
  it("ordens simultaneas em mercados diferentes; duplicata no mesmo mercado bloqueada", async () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    seedMarket(runtime, "USDJPY:NORMAL", { activeId: 201 });
    runtime.arm(2, { confirmation: true });
    const first = runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "k-eurusd" });
    const second = runtime.requestOrder({ marketKey: "USDJPY:NORMAL", direction: "SELL", stake: 1, horizonSeconds: 60, idempotencyKey: "k-usdjpy" });
    await sleep(15);
    expect(runtime.__sent).toHaveLength(2);
    await expect(runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "k-again" })).rejects.toThrowError(/ORDER_IN_FLIGHT/);
    await ack(runtime, "EURUSD:NORMAL", "ORD-A");
    await ack(runtime, "USDJPY:NORMAL", "ORD-B");
    expect((await first).state).toBe("ACKNOWLEDGED");
    expect((await second).state).toBe("ACKNOWLEDGED");
    expect(runtime.openPositions.size).toBe(2);
    await expect(runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "SELL", stake: 1, horizonSeconds: 60, idempotencyKey: "k-third" })).rejects.toThrowError(/POSITION_ALREADY_OPEN/);
  });
  it("idempotencia: mesma decisionId nao envia duas vezes; settlement duplo e ignorado", async () => {
    const runtime = multiFixture();
    const ctx = seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    runtime.arm(2, { confirmation: true });
    const first = runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "k-same" });
    await sleep(10);
    await ack(runtime, "EURUSD:NORMAL", "ORD-C");
    await first;
    runtime.ingestEvent("socket-option-closed", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { id: "ORD-C", win: "win", sum: 1, win_amount: 1.85 } });
    await sleep(15);
    expect(ctx.settlementState.daily.wins).toBe(1);
    const duplicate = await runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "k-same" });
    expect(duplicate).toMatchObject({ duplicate: true, brokerOrderId: "ORD-C" });
    expect(runtime.__sent).toHaveLength(1);
    runtime.ingestEvent("socket-option-closed", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { id: "ORD-C", win: "win", sum: 1, win_amount: 1.85 } });
    await sleep(10);
    expect(ctx.settlementState.daily.wins).toBe(1);
  });
  it("VALOR POR OPERACAO: configuredStake e usado como valor pedido (nao apenas teto) e APPLY ALL sobrescreve individual", async () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    seedMarket(runtime, "USDJPY:NORMAL", { activeId: 201 });
    runtime.arm(100, { confirmation: true });
    runtime.applyGlobalMaxStake(3);
    expect(runtime.markets.get("EURUSD:NORMAL").configuredStake).toBe(3);
    const first = runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", horizonSeconds: 60, idempotencyKey: "k-cfg-1" });
    await sleep(10);
    expect(runtime.__sent[0].price).toBe(3);
    await ack(runtime, "EURUSD:NORMAL", "ORD-CFG-1");
    await first;
    runtime.ingestEvent("socket-option-closed", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { id: "ORD-CFG-1", win: "win", sum: 3, win_amount: 5.5 } });
    await sleep(15);
    runtime.setMarket("EURUSD:NORMAL", { configuredStake: 5 }, { persist: false });
    runtime.setMarket("USDJPY:NORMAL", { configuredStake: 5 }, { persist: false });
    runtime.applyGlobalMaxStake(10);
    expect(runtime.markets.get("EURUSD:NORMAL").configuredStake).toBe(10);
    expect(runtime.markets.get("USDJPY:NORMAL").configuredStake).toBe(10);
    runtime.setMarket("EURUSD:NORMAL", { configuredStake: 2 }, { persist: false });
    const individual = runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", horizonSeconds: 60, idempotencyKey: "k-cfg-2" });
    const other = runtime.requestOrder({ marketKey: "USDJPY:NORMAL", direction: "BUY", horizonSeconds: 60, idempotencyKey: "k-cfg-3" });
    await sleep(10);
    const sent = Object.fromEntries(runtime.__sent.slice(1).map((row: any) => [row.activeId, row.price]));
    expect(sent[101]).toBe(2);
    expect(sent[201]).toBe(10);
    await ack(runtime, "EURUSD:NORMAL", "ORD-CFG-2");
    await ack(runtime, "USDJPY:NORMAL", "ORD-CFG-3");
    await individual; await other;
  });
  it("HARD CAP: nenhuma combinacao de configuracao envia acima de 100 + ajuste observavel (nunca silencioso)", async () => {
    const runtime = multiFixture();
    const ctx = seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    runtime.arm(100, { confirmation: true }); runtime.config.autoExecute = true;
    runtime.config.globalMaxStake = 500; runtime.config.defaultStake = 500; ctx.configuredStake = 500; ctx.maxStake = 500;
    const record = await runtime.simulateSignal("EURUSD:NORMAL", "BUY");
    await sleep(10);
    expect(runtime.__sent[0].price).toBe(100);
    expect(record).toMatchObject({ stakeRequested: 500, stakeFinal: 100 });
    expect(record.stakeAdjustment).toMatchObject({ applied: true, reason: "HARD_CAP", to: 100 });
  });
  it("reconciliacao de orfaos no restart nao reenvia ordem", async () => {
    const queries: string[] = [];
    const pool = { query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions" }] };
      if (sql.includes("SELECT execution_id")) return { rows: [{ execution_id: "exec_orphan", market_key: "USDJPY:NORMAL", broker_order_id: null, direction: "CALL", symbol: "USD/JPY", active_id: 201, stake: 1, expiration_at: null, entry_price: 1.1, mode: "PRACTICE" }] };
      return { rows: [], rowCount: 1 };
    } };
    const runtime = multiFixture({ pool });
    seedMarket(runtime, "USDJPY:NORMAL", { activeId: 201 });
    const result = await runtime.reconcileOrphans();
    expect(result).toMatchObject({ checked: 1, unknown: 1, settled: 0 });
    expect(runtime.__sent).toHaveLength(0);
    expect(queries.some((sql) => sql.startsWith("UPDATE iq_executions"))).toBe(true);
  });
  it("PRACTICE -> REAL causa DISARM; REAL exige confirmacao e usa saldo REAL", async () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    runtime.arm(2, { confirmation: true });
    expect(runtime.armState.armed).toBe(true);
    expect(() => runtime.setMode("REAL")).toThrowError(/REAL_MODE_NOT_CONFIRMED/);
    runtime.realMode.requestConfirmation({ phrase: REAL_CONFIRMATION_PHRASE, acknowledgeRisk: true, realBalance: 500, realBalanceId: 777, maxStake: 2 });
    runtime.setMode("REAL");
    expect(runtime.config.mode).toBe("REAL");
    expect(runtime.armState.armed).toBe(false);
    runtime.arm(2, { confirmation: true });
    const order = runtime.requestOrder({ marketKey: "EURUSD:NORMAL", direction: "BUY", stake: 2, horizonSeconds: 60, idempotencyKey: "k-real" });
    await sleep(10);
    expect(runtime.__sent[0]).toMatchObject({ balanceId: 777, price: 2 });
    await ack(runtime, "EURUSD:NORMAL", "ORD-REAL");
    await order;
    runtime.setMode("PRACTICE");
    expect(runtime.realMode.authorized()).toBe(false);
    expect(runtime.config.mode).toBe("PRACTICE");
  });
  it("status/office nunca expoem SSID", () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    expect(JSON.stringify(runtime.office()).includes(FAKE_SSID)).toBe(false);
    expect(JSON.stringify(runtime.status()).includes(FAKE_SSID)).toBe(false);
  });
  it("payout: resolver le option.profit.commission e commission-changed (runtime)", () => {
    const resolver = new RuntimeAssetResolver() as any;
    resolver.ingestInitializationData({ binary: { actives: { "81": { name: "GBPUSD-OTC", enabled: true, option: { profit: { commission: 13 } } } } }, turbo: { actives: {} } });
    expect(resolver.get("GBPUSD:OTC").payout).toBe(87);
    expect(resolver.get("GBPUSD:OTC").payoutSource).toBe("initialization-data.option.profit.commission");
    resolver.ingestAuxiliary({ active_id: 81, instrument_type: "binary", commission: { value: 8 } });
    expect(resolver.get("GBPUSD:OTC").payout).toBe(92);
    expect(resolver.get("GBPUSD:OTC").payoutSource).toBe("commission-changed");
  });
  it("mercado sem turbo bloqueia ordem de horizonte curto (fail-closed, sem trocar instrumento)", async () => {
    const runtime = multiFixture();
    const ctx = seedMarket(runtime, "USDJPY:NORMAL", { activeId: 201 });
    ctx.instrumentTypes = ["binary"];
    runtime.arm(2, { confirmation: true });
    await expect(runtime.requestOrder({ marketKey: "USDJPY:NORMAL", direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "k-no-turbo" })).rejects.toThrowError(/INSTRUMENT_NOT_AVAILABLE_FOR_HORIZON/);
    expect(runtime.__sent).toHaveLength(0);
  });
  it("SIGNAL -> disposicao: AUTO desligado registra BLOCKED sem enviar ordem", async () => {
    const runtime = multiFixture();
    seedMarket(runtime, "GBPJPY:NORMAL", { activeId: 301 });
    const record = await runtime.simulateSignal("GBPJPY:NORMAL", "BUY");
    expect(record).toMatchObject({ disposition: "BLOCKED", reason: "AUTO_DESLIGADO", auto: false, action: "BUY", marketType: "NORMAL", stakeCalculated: 1, stakeFinal: 1 });
    expect(runtime.__sent).toHaveLength(0);
    expect(Array.isArray(record.gate.checks ?? record.gate.failed)).toBe(true);
    const listed = runtime.signals(10).signals.find((row: any) => row.id === record.id);
    expect(listed?.reason).toBe("AUTO_DESLIGADO");
  });
  it("SIGNAL -> disposicao: AUTO ligado sem ARM registra SISTEMA_DESARMADO", async () => {
    const runtime = multiFixture();
    seedMarket(runtime, "GBPJPY:NORMAL", { activeId: 301 });
    runtime.config.autoExecute = true;
    const record = await runtime.simulateSignal("GBPJPY:NORMAL", "BUY");
    expect(record).toMatchObject({ disposition: "BLOCKED", reason: "SISTEMA_DESARMADO" });
    expect(runtime.__sent).toHaveLength(0);
  });
  it("SIGNAL -> disposicao: EXECUTED com brokerOrderId e settlement; bucket repetido vira DUPLICATE", async () => {
    const runtime = multiFixture();
    const ctx = seedMarket(runtime, "GBPJPY:NORMAL", { activeId: 301 });
    runtime.config.autoExecute = true;
    runtime.arm(2, { confirmation: true });
    const promise = runtime.simulateSignal("GBPJPY:NORMAL", "BUY");
    await sleep(10);
    expect(runtime.__sent).toHaveLength(1);
    await ack(runtime, "GBPJPY:NORMAL", "ORD-SIG-1");
    const record = await promise;
    expect(record).toMatchObject({ disposition: "EXECUTED", brokerOrderId: "ORD-SIG-1" });
    runtime.ingestEvent("socket-option-closed", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: { id: "ORD-SIG-1", win: "win", sum: 1, win_amount: 1.85 } });
    await sleep(15);
    expect(runtime.signals(5).signals.find((row: any) => row.id === record.id)?.result).toBe("WIN");
    const duplicate = await runtime.simulateSignal("GBPJPY:NORMAL", "BUY");
    expect(duplicate).toMatchObject({ disposition: "EXECUTED", brokerOrderId: "ORD-SIG-1" });
    expect(runtime.__sent).toHaveLength(1);
    expect(runtime.signals(5).stats["GBPJPY:NORMAL"]?.duplicate).toBe(1);
    expect(ctx.settlementState.daily.wins).toBe(1);
  });
  it("SIGNAL -> disposicao: posicao aberta bloqueia novo sinal; bloqueado antigo EXPIRA", async () => {
    const runtime = multiFixture();
    const ctx = seedMarket(runtime, "GBPJPY:NORMAL", { activeId: 301 });
    runtime.config.autoExecute = true;
    runtime.arm(2, { confirmation: true });
    const first = runtime.simulateSignal("GBPJPY:NORMAL", "BUY");
    await sleep(10);
    await ack(runtime, "GBPJPY:NORMAL", "ORD-SIG-2");
    await first;
    ctx.lastCandle = { ...ctx.lastCandle, bucketStart: Number(ctx.lastCandle.bucketStart) + 5_000 };
    const second = await runtime.simulateSignal("GBPJPY:NORMAL", "SELL");
    expect(second).toMatchObject({ disposition: "BLOCKED", reason: "POSICAO_JA_ABERTA" });
    const target = runtime.signalLog.find((row: any) => row.id === second.id);
    target.at = Date.now() - 120_000;
    runtime.expireSignals();
    expect(target.disposition).toBe("EXPIRED");
    expect(String(target.reason)).toContain("EXPIRADO");
  });
  it("FASE 6: estrategias antigas removidas do runtime (LEGACY_STRATEGY_REMOVED) e brain generation 2 exposto", async () => {
    const runtime = multiFixture();
    const ctx = seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    runtime.config.autoExecute = true; runtime.arm(2, { confirmation: true });
    expect(() => runtime.setMarket("EURUSD:NORMAL", { strategyVariantId: "V8-60" }, { persist: false })).toThrowError(/LEGACY_STRATEGY_REMOVED/);
    expect(() => runtime.setMarket("EURUSD:NORMAL", { strategy: "V3" }, { persist: false })).toThrowError(/LEGACY_STRATEGY_REMOVED/);
    expect(ctx.strategyVariantId).toBeNull();
    const office = runtime.office();
    expect(office.brain).toMatchObject({ generation: 2, version: "professional-brain-v2" });
    expect(office.brain.setups).toBeGreaterThanOrEqual(9);
    expect(office.brain.principles).toBeGreaterThanOrEqual(5);
    const record = await runtime.simulateSignal("EURUSD:NORMAL", "BUY");
    expect(record.strategyVariantId).toBeNull();
    expect(record.strategySource).toBe("PROFESSIONAL_BRAIN_G2");
    expect(record.setup).toBeTruthy();
  });
  it("PERSISTENCIA: reload restaura configuredStake/defaultStake/revision e ignora strategy_variant_id legado", async () => {
    const stored = {
      config: { mode: "PRACTICE", global_max_stake: 100, default_stake: 7, calculated_bankroll_stake: 1, auto_execute: false, selection_json: { legacy: "LEGACY_STRATEGY_AUDIT", brainGeneration: 2 }, resolver_json: null, revision: 42 },
      markets: [{ market_key: "EURUSD:NORMAL", enabled: true, paused: false, max_stake: 100, configured_stake: 7, strategy_variant_id: "V8-60", strategy: "V8", revision: 12, active_id: 101, instrument_types: ["binary"], availability: "OPEN", payout: 85 }],
    };
    const pool = { query: async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ table_name: "iq_executions" }] };
      if (sql.includes("iq_runtime_config")) return { rows: [stored.config] };
      if (sql.includes("iq_markets")) return { rows: stored.markets };
      return { rows: [], rowCount: 1 };
    } };
    const runtime = new IqMultiRuntime({ pool, getSsid: () => null, now: () => Date.now(), log: () => {} }) as any;
    await runtime.reloadConfiguration();
    expect(runtime.config.defaultStake).toBe(7);
    expect(runtime.config.revision).toBe(42);
    const ctx = runtime.markets.get("EURUSD:NORMAL");
    expect(ctx).toMatchObject({ configuredStake: 7, revision: 12, maxStake: 100 });
    expect(ctx.strategyVariantId).toBeNull();
    expect(ctx.strategy).toBeNull();
    const reread = runtime.office().markets.find((market: any) => market.marketKey === "EURUSD:NORMAL");
    expect(reread).toMatchObject({ configuredStake: 7, brainGeneration: 2 });
  });
  it("MERCADO FECHADO nao opera e continua existindo no escritorio (15 estacoes, max 10 ativos)", async () => {
    const runtime = multiFixture();
    const closed = seedMarket(runtime, "AUDUSD:NORMAL", { activeId: 401, enabled: false });
    closed.availability = "NOT_FOUND"; closed.enabled = true;
    const open = seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101 });
    open.configuredStake = 2;
    runtime.arm(2, { confirmation: true }); runtime.config.autoExecute = true;
    closed.lastCandle = open.lastCandle; closed.featureState = open.featureState; closed.lastTickAt = Date.now();
    await expect(runtime.requestOrder({ marketKey: "AUDUSD:NORMAL", direction: "BUY", horizonSeconds: 60, idempotencyKey: "k-closed" })).rejects.toThrowError(/PORTFOLIO_GATE_MARKET_AVAILABLE/);
    closed.availability = "OPEN"; closed.enabled = false;
    await expect(runtime.requestOrder({ marketKey: "AUDUSD:NORMAL", direction: "BUY", horizonSeconds: 60, idempotencyKey: "k-disabled" })).rejects.toThrowError(/PORTFOLIO_GATE_MARKET_ENABLED/);
    expect(runtime.__sent).toHaveLength(0);
    const office = runtime.office();
    expect(office.markets).toHaveLength(15);
    expect(office.markets.filter((market: any) => market.enabled).length).toBeLessThanOrEqual(10);
    expect(office.markets.find((market: any) => market.marketKey === "AUDUSD:NORMAL")).toMatchObject({ availability: "OPEN", enabled: false });
  });
  it("FASE 5: pares de agentes + consensus deterministico alimentam a decisao (nunca probabilidade inventada)", () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101, candles: 60, close: 1.2 });
    const market = runtime.office().markets.find((row: any) => row.marketKey === "EURUSD:NORMAL");
    expect(market.agents).toBeTruthy();
    expect(market.agents.consensus.estimatedWinProbability).toBeNull();
    expect(["BUY", "SELL", "WAIT"]).toContain(market.agents.consensus.action);
    expect(["CONFIRMED", "NO_CONSENSUS", "VETOED", "WAIT", "STALE"]).toContain(market.agents.consensus.status);
    expect(market.decisionState.consensus).toMatchObject({ status: market.agents.consensus.status, traderAction: market.agents.trader.action });
    const intelligence = runtime.office().intelligence;
    expect(intelligence.MACRO.status).toBe("NO_FEED");
    expect(intelligence.NEWS.status).toBe("NO_FEED");
    expect(["OK", "STALE"]).toContain(intelligence.SECURITY.status);
    expect(runtime.office().research.agentLatency.count).toBeGreaterThan(0);
    expect(runtime.office().supervisor.version).toBe("performance-supervisor-v1");
  });
  it("FASE 6: research shadow roda por mercado com placar por setup isolado e A/B v2 registrado", () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101, candles: 80, close: 1.2 });
    const scoreboard = runtime.researchScoreboard({ marketKey: "EURUSD:NORMAL" });
    expect(scoreboard.board.marketKey).toBe("EURUSD:NORMAL");
    expect(Array.isArray(scoreboard.board.setups)).toBe(true);
    expect(scoreboard.board.setups.some((row: any) => row.setup === "TREND_PULLBACK")).toBe(true);
    const other = runtime.researchScoreboard({ marketKey: "USDJPY:NORMAL" });
    expect(other.board.trades).toBe(0);
    const all = runtime.researchScoreboard();
    expect(all.ab.arms.A_TRADER).toBeTruthy();
    expect(all.ab.arms.D_APPRENTICE).toBeTruthy();
    expect(String(all.note)).toContain("nenhuma variante V1/V2/V3/V8");
  });
  it("FASE 6: REAL nao altera metodologia; supervisor monitora e nao tem modo de troca", () => {
    const runtime = multiFixture();
    expect(runtime.setSupervisorConfig({ minSamples: 12 }).minSamples).toBe(12);
    runtime.realMode.requestConfirmation({ phrase: "OPERAR CONTA REAL", acknowledgeRisk: true, realBalance: 100, realBalanceId: 777, maxStake: 2 });
    runtime.setMode("REAL");
    expect(runtime.config.mode).toBe("REAL");
    expect(String(runtime.supervisorStatus().note)).toContain("NAO troca metodologia");
    runtime.setSupervisorConfig({ mode: "AUTO_STRATEGY_SWITCH" });
    expect((runtime.supervisor.config as any).mode).toBeUndefined();
    expect(runtime.supervisorStatus().config.minSamples).toBe(12);
  });
  it("FASE 6: persistencia inclui research/supervisor (restart preserva placar, reviews e limita a geracao)", async () => {
    const runtime = multiFixture();
    runtime.research.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [{ bucketStart: 0, start: 0, open: 1, high: 1.1, low: 0.9, close: 1.05 }], index: 0, brain: { setup: "TREND_PULLBACK", action: "BUY", regime: "TREND_UP", trigger: "x" }, payout: 85, atMs: 0 });
    runtime.research.observeCandle({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL", candles: [{ bucketStart: 60_000, start: 60_000, open: 1, high: 1.2, low: 1, close: 1.15 }], index: 0, brain: null, atMs: 61_000 });
    runtime.supervisor.evaluate({ agentId: "trader:EURUSD:NORMAL", marketKey: "EURUSD:NORMAL", stats: { trades: 30, wins: 10, losses: 20, draws: 0, pnl: -10, goodDecisions: 10, badDecisions: 20, consecutiveLosses: 7, badDecisionWins: 0, goodDecisionLosses: 3 }, review: null });
    const researchSnapshot = runtime.research.toJSON();
    const supervisorSnapshot = runtime.supervisor.toJSON();
    const reloadedResearch = new (runtime.research.constructor)({ now: () => Date.now() }) as any;
    const reloadedSupervisor = new (runtime.supervisor.constructor)({ now: () => Date.now() }) as any;
    expect(reloadedResearch.loadFrom(researchSnapshot)).toBe(true);
    expect(reloadedSupervisor.loadFrom(supervisorSnapshot)).toBe(true);
    const stats = reloadedResearch.scoreboard("EURUSD:NORMAL").setups.find((row: any) => row.setup === "TREND_PULLBACK");
    expect(stats).toMatchObject({ trades: 1, wins: 1 });
    expect(reloadedSupervisor.status().reviews[0]).toMatchObject({ status: "REVIEW_REQUIRED" });
    expect(reloadedSupervisor.status().reviews[0].reasons).toContain("DRAWDOWN_EXCEDIDO");
  });
  it("FASE 5.1: mesa do aprendiz integrada (shadow-only, sem ordens) e feeds com fallback NO_FEED", () => {
    const runtime = multiFixture();
    seedMarket(runtime, "EURUSD:NORMAL", { activeId: 101, candles: 60, close: 1.2 });
    const apprentice = runtime.office().apprentice;
    expect(apprentice.execution).toBe("SHADOW_ONLY");
    expect(apprentice.techniques.length).toBeGreaterThanOrEqual(5);
    expect(apprentice.lessons).toBeDefined();
    expect(runtime.__sent).toHaveLength(0);
    const feeds = runtime.office().feeds;
    expect(String(feeds.sources.MACRO)).toContain("faireconomy");
    expect(["NO_FEED", "STALE", "OK"]).toContain(feeds.state.MACRO.status);
    expect(feeds.tradingImpact).toBe("CONTEXT_ONLY_NEVER_ORDERS");
  });
  it("FASE 6: journal registra trades por agente e supervisor pede REVIEW_REQUIRED (nunca troca estrategia)", async () => {
    const runtime = multiFixture();
    runtime.setSupervisorConfig({ minSamples: 10 });
    for (let index = 0; index < 10; index += 1) {
      await runtime.journal.recordTrade({ tradeId: `t${index}`, agentId: "trader:EURUSD:NORMAL", marketKey: "EURUSD:NORMAL", marketType: "NORMAL", settlementAt: Date.now(), result: "LOSS", profit: -1, stake: 1, direction: "CALL", snapshot: { setup: "TREND_PULLBACK", regime: "TREND_UP", marketKey: "EURUSD:NORMAL", action: "BUY", trigger: "x" }, review: { decisionQuality: "BAD_DECISION", outcome: "LOSS", mistakes: [{ code: "ENTRADA_ATRASADA", detail: "x" }], lesson: { text: "l" } } });
    }
    const memory = runtime.agentMemory("trader:EURUSD:NORMAL");
    expect(memory.stats.trades).toBe(10);
    expect(memory.stats.losses).toBe(10);
    expect(memory.mistakes.length).toBeGreaterThan(0);
    const review = runtime.supervisor.evaluate({ agentId: "trader:EURUSD:NORMAL", marketKey: "EURUSD:NORMAL", stats: memory.stats, review: null });
    expect(review.status).toBe("REVIEW_REQUIRED");
    expect(review.reasons).toContain("DRAWDOWN_EXCEDIDO");
    expect(runtime.office().supervisor.reviews.length).toBeGreaterThan(0);
  });
  it("FASE 6: knowledge base point-in-time com escopo TraceCom e cache por marketKey", async () => {
    const runtime = multiFixture();
    const rebuild = await runtime.knowledgeRebuild();
    expect(rebuild.notes).toBeGreaterThanOrEqual(30);
    const status = runtime.knowledgeStatus();
    expect(status.scope).toBe("TraceCom/");
    expect(status.notes).toBeGreaterThanOrEqual(30);
    const search = runtime.knowledgeSearch({ regime: "TREND_UP", setup: "TREND_PULLBACK", atMs: 1789600001000, limit: 5 });
    expect(search.scope).toBe("TRACECOM");
    expect(search.results.length).toBeGreaterThan(0);
    const future = runtime.knowledgeSearch({ text: "rsi", atMs: 1000, limit: 5 });
    expect(future.results).toHaveLength(0);
  });
  it("event bus: payload nunca sobrescreve o campo type do evento", () => {
    const runtime = multiFixture();
    runtime.ingestEvent("balances", { connectionId: CONNECTION_ID, receivedAt: Date.now(), msg: [{ id: 555, type: 4, currency: "USD", amount: 100, is_default: true }] });
    const event = runtime.eventsAfter(0, 100).events.find((row: any) => row.practice === true);
    expect(event?.type).toBe("account.balances");
  });
});
