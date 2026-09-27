import fs from "node:fs/promises";
import path from "node:path";

const token = String(process.env.IQ_MCP_TOKEN ?? "").trim();
if (!token) throw new Error("IQ_MCP_TOKEN_MISSING");
const targets = [
  { product: "binary", url: "https://binary-options.mcp.iqoption.com" },
  { product: "blitz", url: "https://blitz-options.mcp.iqoption.com" },
];
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` };
const dir = path.resolve("data/otc-lab/raw");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(target, id, method, params, session = null) {
  const response = await fetch(target.url, { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const text = await response.text();
  if (!text.trim()) return { session: response.headers.get("mcp-session-id") ?? session, result: null };
  let message; try { message = JSON.parse(text); } catch { const line = text.split(/\r?\n/).find((row) => row.startsWith("data:")); message = line ? JSON.parse(line.slice(5)) : null; }
  if (message?.error) throw new Error(`MCP_${message.error.code ?? "ERROR"}`);
  return { session: response.headers.get("mcp-session-id") ?? session, result: message?.result ?? null };
}
const unwrap = (result) => { const text = result?.content?.[0]?.text; if (text) { try { return JSON.parse(text); } catch {} } return result?.structuredContent ?? result ?? {}; };
async function collect(target) {
  let response = await rpc(target, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "OTC_BLACKBOX_LAB_V1", version: "continuous-read-only" } });
  const session = response.session;
  await rpc(target, 2, "notifications/initialized", {}, session);
  response = await rpc(target, 3, "tools/call", { name: "get_candles", arguments: { asset_id: 76, size: 60, count: 1000 } }, session);
  const rows = unwrap(response.result).candles ?? [];
  const file = path.join(dir, `${target.product}-eurusd-otc-1m-live.json`);
  let existing = [];
  try { existing = JSON.parse(await fs.readFile(file, "utf8")).candles ?? []; } catch {}
  const byTo = new Map([...existing, ...rows].map((row) => [String(row.to), row]));
  const candles = [...byTo.values()].sort((a, b) => String(a.to).localeCompare(String(b.to))).slice(-100_000);
  await fs.writeFile(file, `${JSON.stringify({ lab: "OTC_BLACKBOX_LAB_V1", product: target.product, assetId: 76, assetName: "EUR/USD (OTC)", intervalSeconds: 60, synthetic: false, updatedAt: new Date().toISOString(), candles }, null, 2)}\n`, "utf8");
  return { product: target.product, received: rows.length, stored: candles.length, last: candles.at(-1)?.to ?? null };
}
await fs.mkdir(dir, { recursive: true });
const once = async () => { for (const target of targets) { try { console.log(JSON.stringify(await collect(target))); } catch (error) { console.log(JSON.stringify({ product: target.product, error: String(error?.message ?? error).slice(0, 160) })); } await sleep(1500); } };
await once();
setInterval(() => { void once(); }, 60_000);
await new Promise(() => {});
