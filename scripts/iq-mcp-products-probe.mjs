#!/usr/bin/env node
/**
 * IQ Official MCP — PRODUCTS allowlisted READ-ONLY probe.
 *
 * Covers digital, blitz, marginal-cfd, marginal-crypto, marginal-forex.
 * Does NOT touch binary/turbo (see iq-mcp-read-probe.mjs).
 *
 * SECURITY
 *  - Token only from env `IQ_MCP_TOKEN` / `IQ_MCP_TOKEN_FILE`; never written.
 *  - Per-server read allowlist, validated at startup: every entry must be
 *    classified SAFE_READ or ACCOUNT_READ. Write/unknown => fail-closed.
 *  - Every call goes through `assertReadProbeMethod` (MCP_WRITE_BLOCKED).
 *  - Argument-requiring tools are skipped unless their args can be derived
 *    from that same server's own list_assets / list_balances / get_instruments.
 *  - All output is redacted before it reaches disk.
 *
 * Usage (PowerShell):
 *   $env:IQ_MCP_TOKEN = "<token>"; node scripts/iq-mcp-products-probe.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RISK,
  assertReadOnlyMethod,
  assertReadProbeMethod,
  classifyTool,
  redact as redactSecret,
} from "../relay/iq-mcp/security.mjs";

export const PRODUCT_SERVERS = Object.freeze({
  digital: "https://digital-options.mcp.iqoption.com",
  blitz: "https://blitz-options.mcp.iqoption.com",
  "marginal-cfd": "https://marginal-cfd.mcp.iqoption.com",
  "marginal-crypto": "https://marginal-crypto.mcp.iqoption.com",
  "marginal-forex": "https://marginal-forex.mcp.iqoption.com",
});

const READ_RISKS = new Set([RISK.SAFE_READ, RISK.ACCOUNT_READ]);

export const PRODUCT_READ_ALLOWLISTS = Object.freeze({
  digital: Object.freeze([
    "get_capabilities",
    "get_limits",
    "list_assets",
    "list_balances",
    "list_positions",
    "get_trade_history",
    "get_instruments",
    "get_prices",
  ]),
  blitz: Object.freeze([
    "get_capabilities",
    "get_limits",
    "list_assets",
    "list_balances",
    "list_positions",
    "get_trade_history",
  ]),
  "marginal-cfd": Object.freeze([
    "get_capabilities",
    "get_limits",
    "list_assets",
    "list_balances",
    "list_positions",
    "get_trade_history",
    "get_orders",
    "get_instruments",
    "calculate_order_size",
  ]),
  "marginal-crypto": Object.freeze([
    "get_capabilities",
    "get_limits",
    "list_assets",
    "list_balances",
    "list_positions",
    "get_trade_history",
    "get_orders",
    "get_instruments",
    "calculate_order_size",
  ]),
  "marginal-forex": Object.freeze([
    "get_capabilities",
    "get_limits",
    "list_assets",
    "list_balances",
    "list_positions",
    "get_trade_history",
    "get_orders",
    "get_instruments",
    "calculate_order_size",
  ]),
});

const assetArg = (ctx) => (ctx.assetId === undefined ? null : { asset_id: ctx.assetId });
const balanceArg = (ctx) => (ctx.balanceId === undefined ? null : { balance_id: ctx.balanceId });

const MARGINAL_PLAN = Object.freeze([
  { tool: "get_capabilities" },
  { tool: "get_limits" },
  { tool: "list_assets" },
  { tool: "list_balances", args: { types: "ALL" } },
  { tool: "list_positions", resolve: balanceArg, skipReason: "NO_BALANCE_ID_FROM_list_balances" },
  { tool: "get_trade_history", resolve: balanceArg, skipReason: "NO_BALANCE_ID_FROM_list_balances" },
  { tool: "get_orders", resolve: balanceArg, skipReason: "NO_BALANCE_ID_FROM_list_balances" },
  { tool: "get_instruments", resolve: assetArg, skipReason: "NO_ASSET_ID_FROM_list_assets" },
  {
    tool: "calculate_order_size",
    resolve: (ctx) => {
      if (ctx.assetId === undefined || !ctx.currency || ctx.minLots === undefined) return null;
      return { asset_id: ctx.assetId, balance_currency: ctx.currency, leverage: 1, lots: ctx.minLots };
    },
    skipReason: "NO_ASSET_ID/CURRENCY/MIN_LOTS_CONTEXT",
  },
]);

export const PRODUCT_PLANS = Object.freeze({
  digital: Object.freeze([
    { tool: "get_capabilities" },
    { tool: "get_limits" },
    { tool: "list_assets" },
    { tool: "list_balances" },
    { tool: "list_positions" },
    { tool: "get_trade_history" },
    { tool: "get_instruments", resolve: assetArg, skipReason: "NO_ASSET_ID_FROM_list_assets" },
    { tool: "get_prices", resolve: assetArg, skipReason: "NO_ASSET_ID_FROM_list_assets" },
  ]),
  blitz: Object.freeze([
    { tool: "get_capabilities" },
    { tool: "get_limits" },
    { tool: "list_assets" },
    { tool: "list_balances" },
    { tool: "list_positions", resolve: balanceArg, skipReason: "NO_BALANCE_ID_FROM_list_balances" },
    { tool: "get_trade_history" },
  ]),
  "marginal-cfd": MARGINAL_PLAN,
  "marginal-crypto": MARGINAL_PLAN,
  "marginal-forex": MARGINAL_PLAN,
});

/** Startup gate: every allowlisted tool must classify as a read. */
export function assertAllowlistReadOnly(server, allowlist = PRODUCT_READ_ALLOWLISTS[server]) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    throw new Error(`MCP_ALLOWLIST_MISSING: ${server}`);
  }
  for (const name of allowlist) {
    const risk = classifyTool({ name });
    if (!READ_RISKS.has(risk)) {
      throw new Error(`MCP_ALLOWLIST_WRITE: ${server}/${name} classified ${risk}`);
    }
  }
  return true;
}

/** Per-call gate: allowlist + classification via the shared read-probe guard. */
export function assertProbeToolAllowed(server, tool, allowlist = PRODUCT_READ_ALLOWLISTS[server]) {
  assertAllowlistReadOnly(server, allowlist);
  return assertReadProbeMethod("tools/call", tool, classifyTool({ name: tool }), allowlist);
}

function isPositiveNumberish(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return /^\d+$/.test(value) && Number(value) > 0;
  return false;
}

function toNumber(value) {
  return typeof value === "number" ? value : Number(value);
}

function findFirst(payload, key, predicate, depth = 0, seen = new Set()) {
  if (payload === null || typeof payload !== "object" || depth > 12) return undefined;
  if (seen.has(payload)) return undefined;
  seen.add(payload);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const hit = findFirst(item, key, predicate, depth + 1, seen);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(payload, key)) {
    const value = payload[key];
    if (predicate(value)) return value;
  }
  for (const value of Object.values(payload)) {
    const hit = findFirst(value, key, predicate, depth + 1, seen);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Redacts a structured payload while keeping its JSON shape when possible. */
function deepRedact(redactFn, value) {
  const text = redactFn(JSON.stringify(value));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractPayload(body) {
  const result = body?.result ?? body?.error ?? body;
  if (result && typeof result === "object" && result.structuredContent) return result.structuredContent;
  const content = result?.content;
  if (!Array.isArray(content)) return result;
  const textPart = content.find((part) => typeof part?.text === "string");
  if (!textPart) return result;
  try {
    return JSON.parse(textPart.text);
  } catch {
    return { text: textPart.text.slice(0, 2500) };
  }
}

/** Accumulate derived context from this server's own read responses. */
export function absorbContext(ctx, tool, payload) {
  if (tool === "list_assets") {
    const id = findFirst(payload, "asset_id", isPositiveNumberish);
    if (id !== undefined) ctx.assetId = toNumber(id);
    const assetType = findFirst(payload, "asset_type", (v) => typeof v === "string" && v.length > 0);
    if (assetType !== undefined) ctx.assetType = String(assetType);
  } else if (tool === "list_balances") {
    const id = findFirst(payload, "balance_id", isPositiveNumberish);
    if (id !== undefined) ctx.balanceId = toNumber(id);
    const currency = findFirst(payload, "currency", (v) => typeof v === "string" && /^[A-Za-z]{3,4}$/.test(v));
    if (currency !== undefined) ctx.currency = String(currency).toUpperCase();
  } else if (tool === "get_instruments") {
    const lots =
      findFirst(payload, "min_quantity", isPositiveNumberish) ??
      findFirst(payload, "min_size", isPositiveNumberish) ??
      findFirst(payload, "min_lots", isPositiveNumberish);
    if (lots !== undefined) ctx.minLots = toNumber(lots);
  }
  return ctx;
}

function createClient({ base, token, fetchImpl, server, allowlist, timeoutMs = 20000 }) {
  const state = { sessionId: null };
  const redact = (value) => redactSecret(value, token);

  async function rpc(method, params, id, tool) {
    if (tool) assertProbeToolAllowed(server, tool, allowlist);
    else assertReadOnlyMethod(method);
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    };
    if (state.sessionId) headers["mcp-session-id"] = state.sessionId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) state.sessionId = sid;
      const text = await res.text();
      const contentType = res.headers.get("content-type") || "";
      let parsed = null;
      if (contentType.includes("text/event-stream")) {
        for (const line of text.split(/\r?\n/).filter((l) => l.startsWith("data:"))) {
          try {
            const candidate = JSON.parse(line.slice(5).trim());
            if (candidate && (candidate.result || candidate.error)) parsed = candidate;
          } catch {
            /* keep raw */
          }
        }
      } else {
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep raw */
        }
      }
      return { status: res.status, body: parsed ?? redact(text).slice(0, 1200) };
    } catch (e) {
      return { status: 0, error: `${e.name}:${e.message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    redact,
    rpc,
    call: (tool, args, id) => rpc("tools/call", { name: tool, arguments: args }, id, tool),
  };
}

/**
 * Runs the read-only probe. Pure network/aggregation logic; NO file writes.
 * Injectable fetch/servers/allowlists/plans so tests can run fully mocked.
 */
export async function runProductsProbe({
  token = "",
  fetchImpl = globalThis.fetch,
  servers = PRODUCT_SERVERS,
  allowlists = PRODUCT_READ_ALLOWLISTS,
  plans = PRODUCT_PLANS,
  now = () => new Date().toISOString(),
} = {}) {
  const report = { generatedAt: now(), authenticated: Boolean(token), servers: {} };

  for (const [server, base] of Object.entries(servers)) {
    const allowlist = Array.isArray(allowlists[server]) ? [...allowlists[server]] : [];
    const entry = { base, allowlist, results: {}, skipped: [], error: null };
    report.servers[server] = entry;
    if (!token) {
      entry.error = "NO_TOKEN";
      continue;
    }
    try {
      assertAllowlistReadOnly(server, allowlist);
    } catch (e) {
      entry.error = e.message;
      continue;
    }

    const client = createClient({ base, token, fetchImpl, server, allowlist });
    const init = await client.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tracecom-products-probe", version: "0.1.0" },
    }, 1);
    if (init.status !== 200) {
      entry.error = `initialize HTTP ${init.status}`;
      continue;
    }
    await client.rpc("notifications/initialized", {}, null);

    const ctx = {};
    let id = 100;
    for (const step of plans[server] || []) {
      const args = step.resolve ? step.resolve(ctx) : (step.args ?? {});
      if (args === null) {
        entry.skipped.push({ tool: step.tool, reason: step.skipReason || "UNSATISFIED_ARGUMENTS" });
        continue;
      }
      const startedAt = Date.now();
      let res;
      try {
        res = await client.call(step.tool, args, (id += 1));
      } catch (e) {
        entry.results[step.tool] = { args, ok: false, latencyMs: Date.now() - startedAt, error: `${e.name}:${e.message}` };
        continue;
      }
      const payload = extractPayload(res.body?.result ?? res.body?.error ?? res.body);
      absorbContext(ctx, step.tool, payload);
      entry.results[step.tool] = {
        args,
        ok: res.status === 200 && !res.error,
        status: res.status,
        latencyMs: Date.now() - startedAt,
        ...(res.error ? { error: res.error } : {}),
        payload: deepRedact(client.redact, payload),
      };
    }
  }

  return report;
}

/** Writes products-probe.raw.json + products-probe.md, redacted. */
export async function writeProbeArtifacts(report, { outDir, redact = (v) => v } = {}) {
  await fs.mkdir(outDir, { recursive: true });
  const rawPath = path.join(outDir, "products-probe.raw.json");
  const mdPath = path.join(outDir, "products-probe.md");
  const raw = redact(JSON.stringify(report, null, 2));

  const lines = [
    "# Products (digital / blitz / marginal-*) — read-only probe",
    "",
    `Generated: ${report.generatedAt}`,
    `Authenticated: ${report.authenticated}`,
    "",
    "> Token never stored; all payloads redacted. Only explicitly allowlisted",
    "> SAFE_READ/ACCOUNT_READ tools were called. No order tool was ever called.",
    "",
  ];
  for (const [server, data] of Object.entries(report.servers)) {
    lines.push(`## ${server} — ${data.base}`, "");
    lines.push(`- allowlist: \`${data.allowlist.join(", ")}\``);
    if (data.error) {
      lines.push(`- error: ${data.error}`, "");
      continue;
    }
    for (const [tool, result] of Object.entries(data.results)) {
      lines.push(`### ${tool} (${result.latencyMs}ms, status ${result.status ?? "-"})`, "");
      lines.push(`args: \`${JSON.stringify(result.args)}\``, "");
      const text = redact(JSON.stringify(result.payload ?? result.error ?? null, null, 2));
      lines.push("```json", text.length > 4000 ? `${text.slice(0, 4000)}…` : text, "```", "");
    }
    if (data.skipped.length) {
      lines.push(`- skipped: ${data.skipped.map((s) => `\`${s.tool}\` (${s.reason})`).join(", ")}`);
    }
    lines.push("");
  }

  await fs.writeFile(rawPath, raw, "utf8");
  await fs.writeFile(mdPath, redact(lines.join("\n")), "utf8");
  return { rawPath, mdPath };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  let SECRET = process.env.IQ_MCP_TOKEN || "";
  if (!SECRET && process.env.IQ_MCP_TOKEN_FILE) {
    try {
      SECRET = (await fs.readFile(process.env.IQ_MCP_TOKEN_FILE, "utf8")).trim();
    } catch {
      /* handled below */
    }
  }
  if (!SECRET) console.log("[products-probe] IQ_MCP_TOKEN ausente — fail-closed, nenhuma chamada de rede.");

  const report = await runProductsProbe({ token: SECRET });
  const outDir = path.join(ROOT, "docs", "iq-mcp");
  const { rawPath, mdPath } = await writeProbeArtifacts(report, {
    outDir,
    redact: (value) => redactSecret(value, SECRET),
  });

  const summary = Object.entries(report.servers).map(([name, data]) =>
    `${name}:${data.error ? data.error : `${Object.keys(data.results).length} tools, ${data.skipped.length} skipped`}`,
  );
  console.log(`[products-probe] ${summary.join(" | ")}`);
  console.log(`[products-probe] wrote ${path.relative(ROOT, mdPath)} and ${path.relative(ROOT, rawPath)}`);
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((e) => {
    console.error(`[products-probe] fatal: ${redactSecret(String(e?.message || e), "")}`);
    process.exitCode = 1;
  });
}
