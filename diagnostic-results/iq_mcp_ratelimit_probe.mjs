/** Diagnóstico: UMA requisição crua ao MCP para inspecionar status, headers e corpo do erro. */
const TOKEN = process.env.IQ_MCP_TOKEN;
const SERVER = process.env.IQ_PROBE_SERVER ?? "binary-options";
const url = `https://${SERVER}.mcp.iqoption.com`;

const t0 = Date.now();
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diag", version: "0" } } }),
});
const text = await res.text();
console.log("server:", SERVER, "elapsed_ms:", Date.now() - t0);
console.log("status:", res.status, res.statusText);
console.log("headers:");
for (const [k, v] of res.headers.entries()) console.log("  ", k, "=", v);
console.log("body:", text.slice(0, 1200));
