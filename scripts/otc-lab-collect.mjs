import fs from "node:fs/promises";
import path from "node:path";

const token = String(process.env.IQ_MCP_TOKEN ?? "").trim();
if (!token) throw new Error("IQ_MCP_TOKEN_MISSING");
const targets = [
  { product: "binary", url: "https://binary-options.mcp.iqoption.com", assetId: 76, assetName: "EUR/USD (OTC)" },
  { product: "blitz", url: "https://blitz-options.mcp.iqoption.com", assetId: 76, assetName: "EUR/USD (OTC)" },
];
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` };
async function rpc(target, id, method, params, session = null) {
  const response = await fetch(target.url, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const text = await response.text();
  if (!text.trim()) return { session: response.headers.get("mcp-session-id") ?? session, result: null };
  let message;
  try { message = JSON.parse(text); } catch { const line = text.split(/\r?\n/).find((row) => row.startsWith("data:")); message = line ? JSON.parse(line.slice(5)) : null; }
  if (message?.error) throw new Error(`MCP_${message.error.code ?? "ERROR"}`);
  return { session: response.headers.get("mcp-session-id") ?? session, result: message?.result ?? null };
}
const unwrap = (result) => { const text = result?.content?.[0]?.text; if (text) { try { return JSON.parse(text); } catch {} } return result?.structuredContent ?? result ?? {}; };
const outDir = path.resolve("data/otc-lab/raw");
await fs.mkdir(outDir, { recursive: true });
for (const target of targets) {
  let response = await rpc(target, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "OTC_BLACKBOX_LAB_V1", version: "1" } });
  await rpc(target, 2, "notifications/initialized", {} , response.session);
  response = await rpc(target, 3, "tools/call", { name: "get_candles", arguments: { asset_id: target.assetId, size: 5, count: 1000 } }, response.session);
  const data = unwrap(response.result);
  const candles = Array.isArray(data.candles) ? data.candles : [];
  const payload = { lab: "OTC_BLACKBOX_LAB_V1", product: target.product, assetId: target.assetId, assetName: target.assetName, collectedAt: new Date().toISOString(), source: target.url, intervalSeconds: 5, synthetic: false, candles };
  await fs.writeFile(path.join(outDir, `${target.product}-eurusd-otc.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ product: target.product, assetId: target.assetId, candles: candles.length, first: candles[0]?.to ?? null, last: candles.at(-1)?.to ?? null }));
}
