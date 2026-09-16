/** Probe read-only dos hosts WS da IQ (sem SSID): TLS + upgrade + mensagens iniciais do servidor. */
import { RawWebSocket, IQ_WS_CANDIDATE_HOSTS } from "./iqoption-ws.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const host of IQ_WS_CANDIDATE_HOSTS) {
  const socket = new RawWebSocket({ host, timeoutMs: 10_000 });
  const messages = [];
  try {
    const started = Date.now();
    await socket.connect();
    const upgradeMs = Date.now() - started;
    socket.on("data", (chunk) => {
      try { for (const frame of socket.parser.push(chunk)) if (frame.opcode === 1) messages.push(frame.payload.toString("utf8").slice(0, 160)); } catch { /* noop */ }
    });
    await sleep(4_000);
    console.log(JSON.stringify({ host, status: "UPGRADED", upgradeMs, messages: messages.slice(0, 6) }));
  } catch (error) {
    console.log(JSON.stringify({ host, status: "FAILED", code: error?.code ?? null, detail: String(error?.message ?? error).slice(0, 120) }));
  } finally { socket.destroy(); }
}
process.exit(0);
