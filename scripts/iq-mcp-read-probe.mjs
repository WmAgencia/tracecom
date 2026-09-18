#!/usr/bin/env node
/**
 * IQ Official MCP — allowlisted READ-ONLY probe (Fase 3).
 * Calls ONLY explicitly allowlisted read tools. Never calls any order tool.
 * Token via IQ_MCP_TOKEN / IQ_MCP_TOKEN_FILE; all output redacted.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReadOnlyMethod, assertReadProbeMethod, classifyTool, redact as redactSecret } from "../relay/iq-mcp/security.mjs";

const SERVERS = {
  binary: "https://binary-options.mcp.iqoption.com",
  turbo: "https://turbo-options.mcp.iqoption.com",
};
const READ_ALLOWLIST = ["get_capabilities", "get_limits", "list_assets", "list_balances"];

let SECRET = process.env.IQ_MCP_TOKEN || "";
if (!SECRET && process.env.IQ_MCP_TOKEN_FILE) {
  try { SECRET = (await fs.readFile(process.env.IQ_MCP_TOKEN_FILE, "utf8")).trim(); } catch { /* noop */ }
}
const redact = (v) => redactSecret(v, SECRET);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "iq-mcp");

const SESSION = { id: null };

async function rpc(base, method, params, id, tool) {
  if (tool) assertReadProbeMethod(method, tool, classifyTool({ name: tool }), READ_ALLOWLIST);
  else assertReadOnlyMethod(method);
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${SECRET}` };
  if (SESSION.id) headers["mcp-session-id"] = SESSION.id;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(base, {
      method: "POST", signal: ctrl.signal, headers,
      body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) SESSION.id = sid;
    const text = await res.text();
    const ct = res.headers.get("content-type") || "";
    let parsed = null;
    if (ct.includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/).filter((l) => l.startsWith("data:"))) {
        try { const c = JSON.parse(line.slice(5).trim()); if (c && (c.result || c.error)) parsed = c; } catch { /* raw */ }
      }
    } else { try { parsed = JSON.parse(text); } catch { /* raw */ } }
    return { status: res.status, body: parsed ?? redact(text).slice(0, 1200) };
  } catch (e) {
    return { status: 0, error: `${e.name}:${e.message}` };
  } finally { clearTimeout(timer); }
}

async function callTool(base, name, args, id) {
  // hard gate: read-probe method + classification + allowlist (inside rpc)
  return rpc(base, "tools/call", { name, arguments: args }, id, name);
}

const report = { generatedAt: new Date().toISOString(), authenticated: Boolean(SECRET), servers: {} };
if (!SECRET) console.log("[read-probe] IQ_MCP_TOKEN ausente — fail-closed.");

for (const [name, base] of Object.entries(SERVERS)) {
  const entry = { results: {}, latencyMs: {} };
  SESSION.id = null;
  if (!SECRET) { report.servers[name] = { error: "NO_TOKEN" }; continue; }
  const init = await rpc(base, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tracecom-read-probe", version: "0.1.0" } }, 1);
  if (init.status !== 200) { report.servers[name] = { error: `initialize HTTP ${init.status}` }; continue; }
  await rpc(base, "notifications/initialized", {}, null);

  let id = 100;
  for (const tool of READ_ALLOWLIST) {
    const t0 = Date.now();
    const res = await callTool(base, tool, {}, id += 1);
    entry.latencyMs[tool] = Date.now() - t0;
    const out = res.body?.result ?? res.body?.error ?? res.body;
    const content = out?.content;
    let payload = content;
    if (Array.isArray(content)) {
      const textPart = content.find((c) => typeof c?.text === "string");
      if (textPart) { try { payload = JSON.parse(textPart.text); } catch { payload = { text: redact(textPart.text).slice(0, 2500) }; } }
    }
    entry.results[tool] = payload === undefined ? redact(out) : payload;
  }
  report.servers[name] = entry;
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "binary-turbo-probe.raw.json"), redact(JSON.stringify(report, null, 2)), "utf8");

const md = ["# Binary/Turbo — read-only probe (Fase 3)", "", `Generated: ${report.generatedAt}`, `Authenticated: ${report.authenticated}`, "", "Tools chamadas: `get_capabilities`, `get_limits`, `list_assets`, `list_balances` (allowlist). Nenhuma tool de ordem.", ""];
for (const [srv, data] of Object.entries(report.servers)) {
  md.push(`## ${srv}`, "");
  if (data.error) { md.push(`- error: ${redact(data.error)}`, ""); continue; }
  for (const [tool, payload] of Object.entries(data.results)) {
    const lat = data.latencyMs?.[tool];
    md.push(`### ${tool} (${lat}ms)`);
    const text = redact(JSON.stringify(payload));
    md.push("```json", text.length > 3000 ? `${text.slice(0, 3000)}…` : text, "```", "");
  }
}
await fs.writeFile(path.join(OUT_DIR, "binary-turbo-probe.md"), redact(md.join("\n")), "utf8");
console.log(`[read-probe] ${Object.entries(report.servers).map(([n, d]) => `${n}:${d.error ? d.error : Object.keys(d.results).length + " tools"}`).join(" | ")}`);
console.log(`[read-probe] wrote ${path.relative(ROOT, path.join(OUT_DIR, "binary-turbo-probe.md"))}`);
