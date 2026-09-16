/** IQ Option WS — protocolo real (RFC6455 + canais), candles causais 5s, ARM/DISARM, ordem PRACTICE com ACK,
 * idempotencia (sem reenvio), settlement/mismatch, bloqueio REAL e nao-vazamento de segredo. */
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const ws = await import("../../relay/iqoption-ws.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const runtimeModule = await import("../../relay/iq-ws-runtime.mjs");
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const connector = await import("../../relay/iqoption-connector.mjs");
const {
  encodeFrame, FrameParser, WS_OPCODES, RawWebSocket, IqWsClient,
  normalizeCandle, validateServerTime, classifyBalances, resolveEurUsdActive, computeExpiration, parseSettlement,
} = ws as unknown as Record<string, any>;
const { IqWsRuntime, percentile, latencySummary } = runtimeModule as unknown as Record<string, any>;
const { ExecutionArmState } = connector as unknown as Record<string, any>;

const FAKE_SSID = "FAKE_SSID_DO_NOT_LEAK_1234567890";
const CONNECTION_ID = "conn-1";

type FakeSocket = EventEmitter & { written: Buffer[]; write(chunk: Buffer | string): boolean; destroy(): void };
function createFakeTransport() {
  const socket = new EventEmitter() as FakeSocket;
  socket.written = [];
  socket.write = (chunk: Buffer | string) => {
    const buffer = Buffer.from(chunk);
    const text = buffer.toString("latin1");
    if (text.startsWith("GET ")) {
      const key = (text.match(/Sec-WebSocket-Key: (\S+)/i) ?? [])[1] ?? "";
      const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      setImmediate(() => socket.emit("data", Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`, "latin1")));
    } else socket.written.push(buffer);
    return true;
  };
  socket.destroy = () => undefined;
  const frames = () => socket.written.flatMap((chunk: Buffer) => new FrameParser().push(chunk));
  const push = (object: unknown) => socket.emit("data", encodeFrame({ opcode: WS_OPCODES.TEXT, payload: Buffer.from(JSON.stringify(object)), mask: false }));
  const pushFrame = (frame: Buffer) => socket.emit("data", frame);
  const clientMessages = () => frames().filter((frame: any) => frame.opcode < 8).map((frame: any) => JSON.parse(frame.payload.toString("utf8")));
  const clientControl = () => frames().filter((frame: any) => frame.opcode >= 8);
  return { socket, push, pushFrame, clientMessages, clientControl };
}

async function connectClient({ skewMs = 0 }: { skewMs?: number } = {}) {
  const transport = createFakeTransport();
  let sequence = 0;
  const client = new IqWsClient({
    hosts: ["iqoption.com"],
    socketFactory: (options: Record<string, unknown>) => new RawWebSocket({ ...options, tlsConnect: () => transport.socket }),
    uuid: () => `${CONNECTION_ID}-${++sequence}`,
  }) as any;
  const connecting = client.connect({ ssid: FAKE_SSID, timeoutMs: 3_000 });
  setImmediate(() => transport.socket.emit("secureConnect"));
  await new Promise<void>((resolve) => {
    const check = () => (transport.clientMessages().some((message: any) => message.name === "ssid") ? resolve() : setTimeout(check, 5));
    check();
  });
  transport.push({ name: "timeSync", msg: Date.now() + skewMs });
  const ready = await connecting;
  return { client, transport, ready };
}

describe("RFC6455 — framing real (masked client frames, fragmentacao, ping/pong)", () => {
  it("encode masked -> FrameParser decodifica payload identico", () => {
    const payload = Buffer.from(JSON.stringify({ name: "ssid", msg: "x" }), "utf8");
    const parser = new FrameParser();
    const frames = parser.push(encodeFrame({ opcode: WS_OPCODES.TEXT, payload, mask: true }));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(WS_OPCODES.TEXT);
    expect(frames[0].payload.equals(payload)).toBe(true);
  });
  it("parser aceita fragmentacao (text + continuation) e control frames", () => {
    const parser = new FrameParser();
    const part1 = encodeFrame({ opcode: WS_OPCODES.TEXT, payload: Buffer.from("{\"name\":\"candle-"), fin: false, mask: false });
    const part2 = encodeFrame({ opcode: WS_OPCODES.CONTINUATION, payload: Buffer.from("generated\"}"), fin: true, mask: false });
    expect(parser.push(part1)).toHaveLength(0);
    const frames = parser.push(part2);
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString("utf8")).toBe("{\"name\":\"candle-generated\"}");
    const ping = encodeFrame({ opcode: WS_OPCODES.PING, payload: Buffer.from("hb"), mask: false });
    expect(parser.push(ping)[0].opcode).toBe(WS_OPCODES.PING);
  });
  it("handshake real + ssid + timeSync e heartbeat servidor respondido", async () => {
    const { transport, ready } = await connectClient();
    expect(ready.host).toBe("iqoption.com");
    expect(ready.timeValid).toBe(true);
    expect(transport.clientMessages()[0]).toMatchObject({ name: "ssid", msg: FAKE_SSID });
    transport.push({ name: "heartbeat", msg: { heartbeatTime: 12345 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const heartbeats = transport.clientMessages().filter((message: any) => message.name === "heartbeat");
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(heartbeats[0].msg.heartbeatTime).toBe(12345);
  });
  it("ping do servidor -> pong do cliente", async () => {
    const { transport } = await connectClient();
    transport.pushFrame(encodeFrame({ opcode: WS_OPCODES.PING, payload: Buffer.from("p"), mask: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(transport.clientControl().some((frame: any) => frame.opcode === WS_OPCODES.PONG)).toBe(true);
  });
});

describe("SERVER TIME — validacao ±2s", () => {
  it("skew dentro da tolerancia = valido; acima = invalido (nao silencia)", () => {
    expect(validateServerTime(1_000_000, 1_001_000, 2_000)).toMatchObject({ valid: true, skewMs: -1_000 });
    expect(validateServerTime(1_000_000, 995_000, 2_000)).toMatchObject({ valid: false, reason: "CLOCK_SKEW_EXCEEDED" });
    expect(validateServerTime(NaN, 5, 2_000).valid).toBe(false);
  });
  it("conexao com skew de +5s marca timeValid=false", async () => {
    const { ready } = await connectClient({ skewMs: 5_000 });
    expect(ready.timeValid).toBe(false);
    expect(Math.abs(ready.clockSkewMs - 5_000)).toBeLessThan(1_500);
  });
});

describe("CANDLES 5s — normalizacao causal (unidades, futuro, ativo cruzado)", () => {
  const base = { symbol: "EUR/USD", activeId: 1, serverTimestamp: 1_700_000_010_000, receivedAt: 1_700_000_010_300, connectionId: CONNECTION_ID };
  it("from em segundos e em ms convergem para o mesmo bucket", () => {
    const seconds = normalizeCandle({ active_id: 1, size: 5, from: 1_700_000_005, open: 1.1, high: 1.2, low: 1.0, close: 1.15, at: 1_700_000_010_000 }, base);
    const millis = normalizeCandle({ active_id: 1, size: 5, from: 1_700_000_005_000, open: 1.1, high: 1.2, low: 1.0, close: 1.15, at: 1_700_000_010_000 }, base);
    expect(seconds.bucketStart).toBe(millis.bucketStart);
    expect(seconds.bucketEnd).toBe(seconds.bucketStart + 5_000);
    expect(seconds.source).toBe("IQ_OPTION_WS");
    expect(seconds.segmentId).toBe(`EUR/USD:${seconds.bucketStart}`);
    expect(seconds.connectionId).toBe(CONNECTION_ID);
  });
  it("candle futuro e ativo cruzado sao rejeitados (nunca inventa mercado)", () => {
    expect(() => normalizeCandle({ active_id: 1, size: 5, from: 1_700_000_020_000, open: 1, high: 1, low: 1, close: 1 }, base)).toThrowError(/FUTURE_CANDLE_REJECTED/);
    expect(() => normalizeCandle({ active_id: 99, size: 5, from: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1 }, base)).toThrowError(/CROSS_ASSET_REJECTED/);
  });
});

describe("CONTA — classificacao server-side (get_balances)", () => {
  it("PRACTICE presente + REAL presente -> verificado PRACTICE, ordem usa saldo practice", () => {
    const classified = classifyBalances([
      { id: 1, type: 1, currency: "BRL", amount: 500, is_default: false },
      { id: 9, type: 4, currency: "BRL", amount: 10000, is_default: true },
    ]);
    expect(classified.type).toBe("PRACTICE");
    expect(classified.verifiedPractice).toBe(true);
    expect(classified.hasReal).toBe(true);
    expect(classified.selected).toMatchObject({ id: 9, type: "PRACTICE" });
  });
  it("somente REAL -> NAO verificado (execucao proibida)", () => {
    const classified = classifyBalances([{ id: 2, type: 1, currency: "USD", amount: 50 }]);
    expect(classified.type).toBe("REAL");
    expect(classified.verifiedPractice).toBe(false);
  });
});

describe("EUR/USD em runtime — nunca hardcodado", () => {
  it("resolve pela initialization-data (prefere nao-OTC aberto; cai para OTC suspenso o nao-OTC)", () => {
    const data = { binary: { actives: { "1": { name: "EURUSD", enabled: true, is_suspended: true }, "76": { name: "EURUSD-OTC", enabled: true, is_suspended: false } } }, turbo: { actives: {} } };
    const resolved = resolveEurUsdActive(data);
    expect(resolved.selected).toMatchObject({ activeId: 76, otc: true, open: true });
    expect(resolved.expectedFromRepo).toBe(1);
    const open = resolveEurUsdActive({ binary: { actives: { "1": { name: "EURUSD", enabled: true, is_suspended: false } } }, turbo: { actives: {} } });
    expect(open.selected).toMatchObject({ activeId: 1, otc: false });
  });
});

describe("EXPIRACAO — algoritmo da referencia (turbo/binary)", () => {
  it("horizonte de 1 min cai em turbo (option_type_id 3) e expiracao no futuro", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const oneMinute = computeExpiration(nowSec, 1);
    expect(oneMinute.expiration).toBeGreaterThan(nowSec);
    expect([1, 3]).toContain(oneMinute.optionTypeId);
    expect(oneMinute.expiration - nowSec).toBeLessThanOrEqual(6 * 60);
    const long = computeExpiration(nowSec, 15);
    expect(long.expiration - nowSec).toBeLessThanOrEqual(20 * 60);
  });
});

describe("RUNTIME — arm/disarm, ordem PRACTICE com ACK, idempotencia, settlement", () => {
  const nowMs = () => Date.now();
  function runtimeFixture(overrides: Record<string, unknown> = {}) {
    const runtime = new IqWsRuntime({ pool: null, getSsid: () => FAKE_SSID, now: nowMs, ackTimeoutMs: 60, smokeAutoDisarm: false, ...overrides }) as any;
    runtime.session = { connected: true, host: "iqoption.com", connectionId: CONNECTION_ID, connectedAt: nowMs(), serverTimeMs: nowMs(), clockSkewMs: 0, timeValid: true, lastTimeSyncAt: nowMs() };
    runtime.connection = { connectionId: CONNECTION_ID, host: "iqoption.com", serverTimeMs: nowMs(), clockSkewMs: 0, timeValid: true };
    runtime.active = { symbol: "EUR/USD", activeId: 1, expectedFromRepo: 1, actual2026: 1, section: "binary", otc: false, enabled: true, expectedVsActual: "MATCH", resolvedAt: nowMs(), candidates: [] };
    runtime.account = { verified: true, type: "PRACTICE", currency: "BRL", balance: 10_000, balanceId: 555, hasReal: true, checkedAt: nowMs() };
    const base = nowMs();
    for (let index = 0; index < 45; index += 1) {
      const bucketStart = base - (45 - index) * 5_000;
      runtime.candles.set(bucketStart, { symbol: "EUR/USD", activeId: 1, bucketStart, bucketEnd: bucketStart + 5_000, open: 1.1, high: 1.2, low: 1.0, close: 1.1 + index * 0.0001, source: "IQ_OPTION_WS", receivedAt: base, connectionId: CONNECTION_ID });
    }
    runtime.lastCandle = [...runtime.candles.values()].pop();
    runtime.lastCandleReceivedAt = nowMs();
    runtime.__sent = [];
    runtime.client = { serverNow: () => nowMs(), placeOrder: (options: Record<string, unknown>) => { runtime.__sent.push(options); return options.requestId; } };
    return runtime;
  }
  const orderEvent = (msg: unknown) => ({ connectionId: CONNECTION_ID, host: "iqoption.com", receivedAt: nowMs(), name: "buyComplete", requestId: null, msg });

  it("arm exige confirmacao explicita e pre-condicoes (conta + market data)", () => {
    const runtime = runtimeFixture();
    runtime.account = { ...runtime.account, verified: false, type: "REAL" };
    expect(() => runtime.arm(1, { confirmation: true })).toThrowError(/PRACTICE_ACCOUNT_NOT_VERIFIED/);
    const practice = runtimeFixture();
    expect(() => practice.arm(1, {})).toThrowError(/EXPLICIT_CONFIRMATION_REQUIRED/);
    const armed = practice.arm(1, { confirmation: true });
    expect(armed).toMatchObject({ armed: true, state: "ARMED", userLimitBrl: 1 });
  });
  it("ordem pratica: gate -> buyv3 -> ACK real (brokerOrderId) -> AUTO-DISARM", async () => {
    const runtime = runtimeFixture();
    runtime.arm(1, { confirmation: true });
    const pending = runtime.requestPracticeOrder({ direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "ui-smoke-1", autoDisarmAfterAck: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.__sent).toHaveLength(1);
    expect(runtime.__sent[0]).toMatchObject({ activeId: 1, direction: "CALL", price: 1, balanceId: 555 });
    runtime.ingestEvent("buyComplete", orderEvent({ isSuccessful: true, result: { id: "ORD-42" } }));
    const outcome = await pending;
    expect(outcome).toMatchObject({ state: "ACKNOWLEDGED", brokerOrderId: "ORD-42", duplicate: false });
    expect(runtime.armState.snapshot()).toMatchObject({ armed: false, disarmReason: "SMOKE_AUTO_DISARM" });
    expect(runtime.lastExecution).toMatchObject({ brokerOrderId: "ORD-42", state: "ACKNOWLEDGED" });
  });
  it("sem ACK = UNKNOWN e NUNCA reenvia (idempotencia bloqueia nova ordem)", async () => {
    const runtime = runtimeFixture({ ackTimeoutMs: 30 });
    runtime.arm(1, { confirmation: true });
    const outcome = await runtime.requestPracticeOrder({ direction: "SELL", stake: 1, horizonSeconds: 60, idempotencyKey: "ui-smoke-2" });
    expect(outcome).toMatchObject({ state: "UNKNOWN", brokerOrderId: null, timedOut: true });
    expect(runtime.__sent).toHaveLength(1);
    await expect(runtime.requestPracticeOrder({ direction: "SELL", stake: 1, horizonSeconds: 60, idempotencyKey: "ui-smoke-2" })).rejects.toThrowError(/ORDER_IN_FLIGHT/);
    expect(runtime.__sent).toHaveLength(1);
  });
  it("duplicata apos settlement retorna registro existente sem reenviar", async () => {
    const runtime = runtimeFixture();
    runtime.arm(1, { confirmation: true });
    const pending = runtime.requestPracticeOrder({ direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "ui-smoke-3" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.ingestEvent("buyComplete", orderEvent({ isSuccessful: true, result: { id: "ORD-77" } }));
    await pending;
    runtime.ingestEvent("socket-option-closed", { connectionId: CONNECTION_ID, receivedAt: nowMs(), name: "socket-option-closed", requestId: null, msg: { id: "ORD-77", win: "win", sum: 1, win_amount: 1.9 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const duplicate = await runtime.requestPracticeOrder({ direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "ui-smoke-3" });
    expect(duplicate).toMatchObject({ duplicate: true, brokerOrderId: "ORD-77" });
    expect(runtime.__sent).toHaveLength(1);
  });
  it("settlement: comparacao broker x causal + SETTLEMENT_MISMATCH visivel", async () => {
    const runtime = runtimeFixture();
    runtime.arm(1, { confirmation: true });
    const pending = runtime.requestPracticeOrder({ direction: "BUY", stake: 1, horizonSeconds: 60, idempotencyKey: "ui-smoke-4" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.ingestEvent("buyComplete", orderEvent({ isSuccessful: true, result: { id: "ORD-88" } }));
    await pending;
    const expirationMs = runtime.pendingOrder.expirationSec * 1000;
    const entry = runtime.pendingOrder.entryPrice;
    runtime.candles.set(expirationMs - 5_000, { symbol: "EUR/USD", activeId: 1, bucketStart: expirationMs - 5_000, bucketEnd: expirationMs, open: entry, high: entry + 0.001, low: entry, close: entry + 0.0005, source: "IQ_OPTION_WS", receivedAt: nowMs(), connectionId: CONNECTION_ID });
    runtime.ingestEvent("socket-option-closed", { connectionId: CONNECTION_ID, receivedAt: nowMs(), name: "socket-option-closed", requestId: null, msg: { id: "ORD-88", win: "loose", sum: 1, win_amount: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.lastExecution).toMatchObject({ state: "SETTLED", brokerResult: "LOSS", causalResult: "WIN", mismatch: true });
    expect(parseSettlement({ win: "loose", sum: 1, win_amount: 0 })).toMatchObject({ result: "LOSS", profit: -1 });
  });
  it("kill switch bloqueia ARM e REATIVAR libera", () => {
    const runtime = runtimeFixture();
    runtime.setKillSwitch(true);
    expect(() => runtime.arm(1, { confirmation: true })).toThrowError(/KILL_SWITCH_ACTIVE/);
    runtime.setKillSwitch(false);
    expect(runtime.arm(1, { confirmation: true }).armed).toBe(true);
  });
  it("WS desconectado -> auto-disarm WS_DISCONNECTED", () => {
    const runtime = runtimeFixture();
    runtime.arm(1, { confirmation: true });
    runtime.stop("TEST_DISCONNECT");
    expect(runtime.armState.snapshot()).toMatchObject({ armed: false, disarmReason: "WS_DISCONNECTED" });
  });
  it("conta REAL nunca arma (gate soberano continua no connector)", () => {
    const armState = new ExecutionArmState();
    expect(() => armState.onConnected("REAL")).toThrowError(/REAL_ACCOUNT_EXECUTION_FORBIDDEN/);
  });
  it("eventos de outra conexao sao descartados por connectionId", () => {
    const runtime = runtimeFixture();
    const before = runtime.candles.size;
    runtime.ingestEvent("candle-generated", { connectionId: "old-connection", receivedAt: nowMs(), msg: { active_id: 1, size: 5, from: Math.floor((nowMs() - 5_000) / 1000), open: 1, high: 1, low: 1, close: 1 } });
    expect(runtime.candles.size).toBe(before);
    runtime.ingestEvent("candle-generated", { connectionId: CONNECTION_ID, receivedAt: nowMs(), msg: { active_id: 1, size: 5, from: Math.floor((nowMs() - 5_000) / 1000), open: 1.3, high: 1.31, low: 1.29, close: 1.3 } });
    expect(runtime.candles.size).toBeGreaterThanOrEqual(before);
    expect(runtime.lastCandle.close).toBe(1.3);
  });
});

describe("SEGREDO — status/execucoes nunca expõem SSID", () => {
  it("status() nao contem ssid nem o valor da sessao", () => {
    const runtime = new IqWsRuntime({ pool: null, getSsid: () => FAKE_SSID, now: () => Date.now() }) as any;
    runtime.session = { connected: true, host: "iqoption.com", connectionId: CONNECTION_ID, connectedAt: Date.now(), serverTimeMs: Date.now(), clockSkewMs: 0, timeValid: true, lastTimeSyncAt: Date.now() };
    runtime.account = { verified: true, type: "PRACTICE", currency: "BRL", balance: 10, balanceId: 1, hasReal: false, checkedAt: Date.now() };
    const serialized = JSON.stringify(runtime.status());
    expect(serialized.includes(FAKE_SSID)).toBe(false);
    expect(/"ssid"/i.test(serialized)).toBe(false);
  });
});

describe("LATENCIA — p50/p95 medidos", () => {
  it("percentile/latencySummary corretos e vazios seguros", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBe(50);
    expect(percentile([], 0.5)).toBeNull();
    expect(latencySummary([])).toMatchObject({ count: 0, p50: null, p95: null });
  });
});
