#!/usr/bin/env node
/**
 * IQ Option OFFICIAL MCP — read-only discovery.
 *
 * SECURITY
 *  - The token is read ONLY from env `IQ_MCP_TOKEN` (or `IQ_MCP_TOKEN_FILE`).
 *  - Never written to disk, logs, docs, git or screenshots.
 *  - Every outbound/inbound string is passed through `redact()` before output.
 *  - READ-ONLY: only initialize / tools/list / resources/list / prompts/list.
 *    Never calls tools/call. Fail-closed on any write capability.
 *
 * Usage (PowerShell):
 *   $env:IQ_MCP_TOKEN = "<token>"; node scripts/iq-mcp-discover.mjs
 *   # or: $env:IQ_MCP_TOKEN_FILE = "C:\path\to\token.txt"; node scripts/iq-mcp-discover.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTool, redact as redactSecret } from "../relay/iq-mcp/security.mjs";

const SERVERS = {
  binary: "https://binary-options.mcp.iqoption.com",
  turbo: "https://turbo-options.mcp.iqoption.com",
  blitz: "https://blitz-options.mcp.iqoption.com",
  digital: "https://digital-options.mcp.iqoption.com",
  "marginal-cfd": "https://marginal-cfd.mcp.iqoption.com",
  "marginal-crypto": "https://marginal-crypto.mcp.iqoption.com",
  "marginal-forex": "https://marginal-forex.mcp.iqoption.com",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "iq-mcp");
const OUT_JSON = path.join(OUT_DIR, "discovery.raw.json");
const OUT_MD = path.join(OUT_DIR, "discovery.md");

let SECRET = process.env.IQ_MCP_TOKEN || "";
if (!SECRET && process.env.IQ_MCP_TOKEN_FILE) {
  try {
    SECRET = (await fs.readFile(process.env.IQ_MCP_TOKEN_FILE, "utf8")).trim();
  } catch {
    /* handled below */
  }
}

const redact = (value) => redactSecret(value, SECRET);

const SESSION = { id: null };

async function rpc(base, method, params, id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${SECRET}`,
    };
    if (SESSION.id) headers["mcp-session-id"] = SESSION.id;
    const payload = id === null
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id, method, params };
    const res = await fetch(base, { method: "POST", signal: ctrl.signal, headers, body: JSON.stringify(payload) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) SESSION.id = sid;
    const text = await res.text();
    const ct = res.headers.get("content-type") || "";
    let parsed = null;
    if (ct.includes("text/event-stream")) {
      const dataLines = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
      for (const line of dataLines) {
        try {
          const candidate = JSON.parse(line.slice(5).trim());
          if (candidate && (candidate.result || candidate.error || candidate.id !== undefined)) parsed = candidate;
        } catch { /* keep raw */ }
      }
    } else {
      try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    }
    return { status: res.status, contentType: ct, session: sid || SESSION.id, body: parsed ?? redact(text).slice(0, 2000) };
  } catch (e) {
    return { status: 0, error: `${e.name}:${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

const classify = (tool) => classifyTool(tool);

const result = { generatedAt: new Date().toISOString(), authenticated: Boolean(SECRET), servers: {} };

if (!SECRET) {
  console.log("[iq-mcp] IQ_MCP_TOKEN ausente. Discovery autenticado NAO executado (fail-closed).");
}

for (const [name, base] of Object.entries(SERVERS)) {
  const entry = { base, reachable: false, authenticated: false, protocolVersion: null, serverInfo: null, capabilities: null, tools: [], resources: [], prompts: [], error: null };
  if (!SECRET) { entry.error = "NO_TOKEN"; result.servers[name] = entry; continue; }

  SESSION.id = null;
  const init = await rpc(base, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tracecom-discovery", version: "0.0.1" } }, 1);
  if (init.status !== 200) { entry.error = `initialize HTTP ${init.status} ${redact(init.body)}`; result.servers[name] = entry; continue; }
  entry.reachable = true;
  entry.authenticated = true;
  const r = init.body?.result || {};
  entry.protocolVersion = r.protocolVersion || null;
  entry.serverInfo = r.serverInfo || null;
  entry.capabilities = r.capabilities || null;

  await rpc(base, "notifications/initialized", {}, null);

  const tools = await rpc(base, "tools/list", {}, 2);
  if (tools.status === 200 && Array.isArray(tools.body?.result?.tools)) {
    entry.tools = tools.body.result.tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || null,
      risk: classify(t),
    }));
  } else {
    entry.toolsError = `HTTP ${tools.status} ${redact(JSON.stringify(tools.body)).slice(0, 600)}`;
  }
  const resources = await rpc(base, "resources/list", {}, 3);
  if (resources.status === 200 && Array.isArray(resources.body?.result?.resources)) entry.resources = resources.body.result.resources;
  const prompts = await rpc(base, "prompts/list", {}, 4);
  if (prompts.status === 200 && Array.isArray(prompts.body?.result?.prompts)) entry.prompts = prompts.body.result.prompts;

  result.servers[name] = entry;
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(OUT_JSON, redact(JSON.stringify(result, null, 2)), "utf8");

const lines = ["# IQ Option Official MCP — Discovery (read-only)", "", `Generated: ${result.generatedAt}`, `Authenticated: ${result.authenticated}`, "", "> Token never stored; all output redacted. Read-only: no tool was ever called.", ""];
for (const [name, e] of Object.entries(result.servers)) {
  lines.push(`## ${name} — ${e.base}`);
  lines.push(`- reachable: ${e.reachable} | authenticated: ${e.authenticated} | protocolVersion: ${e.protocolVersion}`);
  lines.push(`- serverInfo: \`${redact(e.serverInfo)}\``);
  lines.push(`- capabilities: \`${redact(e.capabilities)}\``);
  if (e.error) lines.push(`- error: ${redact(e.error)}`);
  if (e.toolsError) lines.push(`- tools/list: ${redact(e.toolsError)}`);
  if (e.tools.length) {
    lines.push("", "| TOOL | RISK | DESCRIPTION |", "|---|---|---|");
    for (const t of e.tools) lines.push(`| ${t.name} | ${t.risk} | ${redact(t.description).replace(/\|/g, "\\|").slice(0, 160)} |`);
  }
  lines.push("");
}
await fs.writeFile(OUT_MD, redact(lines.join("\n")), "utf8");

const counts = Object.entries(result.servers).map(([n, e]) => `${n}:${e.authenticated ? `${e.tools.length} tools` : "no-auth"}`);
console.log(`[iq-mcp] ${counts.join(" | ")}`);
console.log(`[iq-mcp] wrote ${path.relative(ROOT, OUT_MD)} and ${path.relative(ROOT, OUT_JSON)}`);
