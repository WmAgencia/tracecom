/**
 * DATAHUB EVENT BUS — ordenacao, isolamento (mercado/NORMAL-OTC/conta), availableAt,
 * subscriber lento, restart, duplicata e gap de sequencia.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const hub = await import("../../relay/datahub/index.mjs");

const NOW = 1_800_000_000_000;
const makeBus = () => new hub.EventBus({ now: () => NOW });

function event(overrides: any = {}) {
  return {
    eventType: "CANDLE_5S", marketKey: "EURUSD:OTC", marketType: "OTC", activeId: 76,
    producer: "iq-multi-runtime", source: "IQ_OPTION_WS", accountContext: "PRACTICE",
    localTime: NOW, receivedAt: NOW - 500, availableAt: NOW - 500,
    payload: { close: 1.1 }, ...overrides,
  };
}

describe("DataHub event bus", () => {
  it("preserva ordem por subscriber e sequencia monotona por mercado", async () => {
    const bus = makeBus();
    const sequences: number[] = [];
    bus.subscribe({ id: "ordered", marketKey: "EURUSD:OTC", handler: (row: any) => sequences.push(row.sequence) });
    for (let index = 0; index < 5; index += 1) bus.publish(event({ payload: { close: 1.1 + index } }));
    await bus.flush();
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });

  it("isola mercados: subscriber de EURUSD:OTC nunca recebe GBPUSD", async () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe({ id: "eur", marketKey: "EURUSD:OTC", handler: (row: any) => received.push(row.marketKey) });
    bus.publish(event());
    bus.publish(event({ marketKey: "GBPUSD:OTC" }));
    bus.publish(event({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL" }));
    await bus.flush();
    expect(received).toEqual(["EURUSD:OTC"]);
  });

  it("isola NORMAL/OTC pelo tipo de mercado", async () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe({ id: "otc", marketType: "OTC", handler: (row: any) => received.push(row.marketKey) });
    bus.publish(event());
    bus.publish(event({ marketKey: "EURUSD:NORMAL", marketType: "NORMAL" }));
    await bus.flush();
    expect(received).toEqual(["EURUSD:OTC"]);
  });

  it("isola PRACTICE/REAL por accountContext", async () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe({ id: "practice", accountContext: "PRACTICE", handler: (row: any) => received.push(row.accountContext) });
    bus.publish(event());
    bus.publish(event({ accountContext: "REAL" }));
    await bus.flush();
    expect(received).toEqual(["PRACTICE"]);
  });

  it("exige availableAt >= receivedAt e rejeita evento com future flag temporal invalida", () => {
    const bus = makeBus();
    expect(() => bus.publish(event({ availableAt: NOW - 1_000, receivedAt: NOW - 500 }))).toThrowError(/EVENT_INVALID/);
    expect(() => bus.publish({ ...event(), eventType: "NOT_AN_EVENT" })).toThrowError(/EVENT_INVALID/);
  });

  it("rejeita payload com chave sensivel (segredos nunca entram no DataHub)", () => {
    const bus = makeBus();
    expect(() => bus.publish(event({ payload: { ssid: "secret-value" } }))).toThrowError(/SECRETS_FORBIDDEN/);
  });

  it("subscriber lento NAO bloqueia o publish e a fila descarta o mais antigo", async () => {
    const bus = makeBus();
    const slow = bus.subscribe({
      id: "slow", maxQueue: 8,
      handler: () => { const start = Date.now(); while (Date.now() - start < 5) { /* busy */ } },
    });
    const publishStart = Date.now();
    for (let index = 0; index < 300; index += 1) bus.publish(event({ payload: { close: index } }));
    const publishMs = Date.now() - publishStart;
    expect(publishMs).toBeLessThan(250);
    await bus.flush();
    const stats = slow.stats();
    expect(stats.dropped).toBeGreaterThan(0);
    expect(stats.delivered + stats.dropped + stats.queued).toBeGreaterThanOrEqual(300 - 16);
  });

  it("detecta duplicata por eventId e nao entrega duas vezes", async () => {
    const bus = makeBus();
    let deliveries = 0;
    bus.subscribe({ id: "dedupe", handler: () => { deliveries += 1; } });
    const original = hub.makeEvent(event());
    const first = bus.ingest(original);
    const second = bus.ingest(original);
    await bus.flush();
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(deliveries).toBe(1);
  });

  it("detecta gap de sequencia explicitamente (nunca corrige em silencio)", () => {
    const bus = makeBus();
    bus.ingest(hub.makeEvent({ ...event(), sequence: 1, eventId: "n1" }));
    const result = bus.ingest(hub.makeEvent({ ...event(), sequence: 4, eventId: "n4" }));
    expect(result.gap).not.toBeNull();
    expect(result.gap.missing).toBe(2);
    expect(bus.stats().sequenceGaps).toBe(2);
  });

  it("restart limpa filas/dedupe/sequencias sem contaminar mercados", async () => {
    const bus = makeBus();
    const received: number[] = [];
    bus.subscribe({ id: "restart", marketKey: "EURUSD:OTC", handler: (row: any) => received.push(row.sequence) });
    bus.publish(event());
    await bus.flush();
    bus.restart("TEST_RESTART");
    bus.publish(event({ payload: { close: 9 } }));
    await bus.flush();
    expect(received).toEqual([1, 1]);
    expect(bus.stats().restarts).toBe(1);
    expect(bus.epochNumber).toBe(2);
  });

  it("mede latencia de entrega p50/p95/p99 e events/sec", async () => {
    const bus = makeBus();
    bus.subscribe({ id: "metrics", handler: () => {} });
    for (let index = 0; index < 20; index += 1) bus.publish(event());
    await bus.flush();
    const stats = bus.stats();
    expect(stats.deliveryLatencyMs.count).toBe(20);
    expect(stats.published).toBe(20);
    expect(stats.eventsPerSecond).toBeGreaterThan(0);
    expect(stats.process.memory.rssMb).toBeGreaterThan(0);
  });
});
