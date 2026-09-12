import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

async function bridge() {
  const emitted: any[] = []; let socket: any;
  class FakeSocket { constructor() { socket = this; } addEventListener(_name: string, callback: (event: any) => void) { this.callback = callback; } send(_data: unknown) { return undefined; } emit(data: unknown) { this.callback({ data }); } callback!: (event: any) => void; }
  const context: any = { Date, JSON, Number, Set, Proxy, Reflect, String, Array, Object, Math, setTimeout: () => 0, window: { WebSocket: FakeSocket, postMessage: (value: any) => emitted.push(value), addEventListener: () => undefined, __traceconIqBridge: false }, location: { origin: "https://iqoption.com" } };
  const source = await readFile(new URL("../../extension/iq-page-bridge.js", import.meta.url), "utf8"); runInNewContext(source, context);
  new context.window.WebSocket("wss://example");
  return { emitted, socket };
}

describe("IQ page bridge metadata projection", () => {
  it("maps nested passive active metadata without exposing the raw message", async () => {
    const h = await bridge(); h.socket.emit(JSON.stringify({ name: "actives-catalog", msg: { actives: [{ active_id: 76, name: "EUR/USD OTC", secret: "must-not-leave-page" }] } }));
    const item = h.emitted.find((entry) => entry.payload?.type === "instrument")?.payload;
    expect(item).toMatchObject({ activeId: 76, symbol: "EUR/USD OTC", instrumentType: "actives-catalog" }); expect(item).not.toHaveProperty("secret");
  });

  it("projects only a recognized passive tick frame", async () => {
    const h = await bridge(); h.socket.emit(JSON.stringify({ name: "instrument-quotes-generated", msg: { active_id: 76, value: 1.1602, timestamp: 1_700_000_000 } }));
    expect(h.emitted.find((entry) => entry.payload?.kind === "tick")?.payload).toMatchObject({ activeId: 76, price: 1.1602, timestamp: 1_700_000_000_000 });
  });

  it("walks candle structure through market paths without retaining sensitive fields", async () => {
    const h = await bridge(); h.socket.emit(JSON.stringify({ name: "candle-generated", msg: { active_id: 76, size: 60, close: 1.1602, from: 1_700_000_000, secret_token: "must-not-leave-page" } }));
    const event = h.emitted.find((entry) => entry.payload?.type === "asset-debug-event" && entry.payload.eventName === "candle-generated")?.payload;
    expect(event.structure.paths).toEqual(expect.arrayContaining([expect.objectContaining({ path: "msg.active_id", value: 76 }), expect.objectContaining({ path: "msg.close", value: 1.1602 })]));
    expect(JSON.stringify(event)).not.toContain("must-not-leave-page");
  });

  it("observes only redacted market fields from an outbound subscription", async () => {
    const h = await bridge(); h.socket.send(JSON.stringify({ name: "subscribe", msg: { active_id: 76, instrument: "EUR/USD OTC", token: "must-not-leave-page" } }));
    const event = h.emitted.find((entry) => entry.payload?.type === "protocol-event" && entry.payload.direction === "OUT")?.payload;
    expect(event).toMatchObject({ transport: "ws", eventName: "subscribe", activeIds: [76], symbols: ["EUR/USD OTC"] });
    expect(JSON.stringify(event)).not.toContain("must-not-leave-page");
  });
});
