import { EventEmitter } from "node:events";
import { IqWsClient, envelope } from "../relay/iqoption-ws.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

class FakeSocket extends EventEmitter {
  constructor() { super(); this.parser = { push: (chunk) => [{ opcode: 1, payload: Buffer.from(chunk) }] }; this.sent = []; }
  async connect() { return { host: "iqoption.test" }; }
  sendText(text) { this.sent.push(JSON.parse(text)); }
  close() { this.emit("close"); }
  destroy() { this.emit("close"); }
}

const socket = new FakeSocket();
const client = new IqWsClient({ hosts: ["iqoption.test"], socketFactory: () => socket, uuid: (() => { let n = 0; return () => `${(++n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`; })() });
const connecting = client.connect({ ssid: "session-test" });
await new Promise((resolve) => setImmediate(resolve));
socket.emit("data", Buffer.from(envelope("timeSync", Date.now())));
await connecting;

const first = client.request("sendMessage", { name: "get-candles" }, { predicate: (message) => message?.name === "candles", timeoutMs: 1000 });
const second = client.request("sendMessage", { name: "get-balances" }, { predicate: (message) => message?.name === "balances", timeoutMs: 1000 });
await new Promise((resolve) => setImmediate(resolve));
const [firstRequest, secondRequest] = socket.sent.slice(-2);
socket.emit("data", Buffer.from(envelope("balances", [{ id: 4 }], secondRequest.request_id)));
socket.emit("data", Buffer.from(envelope("candles", { candles: [] }, firstRequest.request_id)));
const [firstResult, secondResult] = await Promise.all([first, second]);
ok("duas requisicoes simultaneas recebem suas proprias respostas", firstResult.response.name === "candles" && secondResult.response.name === "balances");

const closed = client.request("sendMessage", { name: "get-options" }, { predicate: (message) => message?.name === "options", timeoutMs: 10_000 });
await new Promise((resolve) => setImmediate(resolve));
socket.emit("close");
const error = await closed.catch((reason) => reason);
ok("fechamento rejeita pendencia imediatamente", error?.code === "WS_CLOSED");

console.log(fail === 0 ? `IQ_WS_MULTIPLEX_TESTS ALL_PASS (${pass}/${pass})` : `IQ_WS_MULTIPLEX_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
