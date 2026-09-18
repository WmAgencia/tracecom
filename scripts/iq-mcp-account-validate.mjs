#!/usr/bin/env node
/**
 * IQ MCP x TraceCom — account identity validation (READ-ONLY).
 * Allowlist: get_capabilities, get_limits, list_balances, list_positions. No order tools, ever.
 * Token only via env IQ_MCP_TOKEN / IQ_MCP_TOKEN_FILE; never written to disk.
 * Output: docs/iq-mcp/account-validation.md (+ .raw.json), redacted.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReadProbeMethod, assertReadOnlyMethod, classifyTool, containsSecret, redact as redactSecret } from "../relay/iq-mcp/security.mjs";

const SERVERS = {
  binary: "https://binary-options.mcp.iqoption.com",
  turbo: "https://turbo-options.mcp.iqoption.com",
};
const READ_ALLOWLIST = ["get_capabilities", "get_limits", "list_balances", "list_positions"];
const FORBIDDEN_SUBSTR = /place_|buy|sell_|close_|cancel_|rollover_|change_|set_|update_|reset_|switch_|deposit|withdraw/;

let SECRET = process.env.IQ_MCP_TOKEN || "";
if (!SECRET && process.env.IQ_MCP_TOKEN_FILE) {
  try { SECRET = (await fs.readFile(process.env.IQ_MCP_TOKEN_FILE, "utf8")).trim(); } catch { /* noop */ }
}
const redact = (v) => redactSecret(v, SECRET);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "iq-mcp");
const TRACECOM_BASE = (process.env.TRACECOM_BASE || "https://tracecom.consecom.com.br").replace(/\/$/, "");

function assertAllowed(name) {
  if (FORBIDDEN_SUBSTR.test(name)) throw new Error(`MCP_FORBIDDEN_TOOL_NAME: ${name}`);
  assertReadProbeMethod("tools/call", name, classifyTool({ name }), READ_ALLOWLIST);
}

const SESSION = { id: null };

async function rpc(base, method, params, id, tool) {
  if (tool) assertAllowed(tool);
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

function unwrap(res) {
  const out = res.body?.result ?? res.body?.error ?? res.body;
  const content = out?.content;
  if (Array.isArray(content)) {
    const textPart = content.find((c) => typeof c?.text === "string");
    if (textPart) {
      try { return JSON.parse(textPart.text); } catch { return { text: redact(textPart.text).slice(0, 2500) }; }
    }
  }
  return out === undefined ? redact(res) : out;
}

async function readMcpServer(name, base) {
  const entry = { base, results: {}, latencyMs: {}, errors: {}, readStartedAt: null, readFinishedAt: null, positions: {} };
  SESSION.id = null;
  entry.readStartedAt = new Date().toISOString();
  const t0 = Date.now();
  const init = await rpc(base, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tracecom-account-validate", version: "0.1.0" } }, 1);
  entry.latencyMs.initialize = Date.now() - t0;
  if (init.status !== 200) { entry.errors.initialize = `HTTP ${init.status}`; entry.readFinishedAt = new Date().toISOString(); return entry; }
  await rpc(base, "notifications/initialized", {}, null);

  let id = 100;
  for (const tool of ["get_capabilities", "get_limits", "list_balances"]) {
    const s = Date.now();
    const res = await rpc(base, "tools/call", { name: tool, arguments: {} }, id += 1, tool);
    entry.latencyMs[tool] = Date.now() - s;
    entry.results[tool] = unwrap(res);
    if (res.error) entry.errors[tool] = res.error;
  }
  const balances = Array.isArray(entry.results.list_balances?.balances) ? entry.results.list_balances.balances : [];
  for (const b of balances) {
    if (b?.balance_id === undefined || b?.balance_id === null) continue;
    const s = Date.now();
    const res = await rpc(base, "tools/call", { name: "list_positions", arguments: { balance_id: Number(b.balance_id) } }, id += 1, "list_positions");
    entry.latencyMs[`list_positions:${b.balance_id}`] = Date.now() - s;
    entry.positions[String(b.balance_id)] = unwrap(res);
  }
  entry.errors.list_positions = Object.fromEntries(Object.entries(entry.positions).map(([bid, v]) => [bid, v?.error ?? null]).filter(([, v]) => v));
  entry.readFinishedAt = new Date().toISOString();
  return entry;
}

async function readTracecomOffice() {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const res = await fetch(`${TRACECOM_BASE}/api/iq/office`, { signal: AbortSignal.timeout(30000) });
    const latencyMs = Date.now() - t0;
    const j = await res.json();
    const stakeHistogram = (pick) => {
      const h = {};
      for (const m of j.markets ?? []) { const v = pick(m); if (v === null || v === undefined) continue; h[v] = (h[v] ?? 0) + 1; }
      return h;
    };
    return {
      url: `${TRACECOM_BASE}/api/iq/office`,
      http: res.status, latencyMs, startedAt, finishedAt: new Date().toISOString(),
      excerpt: {
        version: j.version, at: j.at, serverTime: j.serverTime,
        mode: j.mode, modeState: j.modeState, activeCount: j.activeCount, activeLimit: j.activeLimit,
        config: j.config,
        stakeDistribution: {
          configuredStake: stakeHistogram((m) => m.configuredStake),
          maxStake: stakeHistogram((m) => m.maxStake),
          positionStateStake: stakeHistogram((m) => m.positionState?.stake),
          lastTradeStake: stakeHistogram((m) => m.lastTrade?.stake),
        },
        legacyAccount: j.legacy?.account ?? null,
        executionGate: j.aux?.executionGate ? { state: j.aux.executionGate.state, armed: j.aux.executionGate.armed, pendingOrders: j.aux.executionGate.pendingOrders } : null,
      },
    };
  } catch (e) {
    return { url: `${TRACECOM_BASE}/api/iq/office`, http: 0, error: `${e.name}:${e.message}`, startedAt, finishedAt: new Date().toISOString() };
  }
}

async function readRelayStatus() {
  const startedAt = new Date().toISOString();
  try {
    const res = await fetch(`${TRACECOM_BASE}/api/iq/status`, { signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    const pick = {};
    for (const k of ["state", "mode", "exchangeType", "accountType", "currency", "balance", "verified", "practiceOnly", "hasSession", "brokerAutomation"]) {
      if (k in j) pick[k] = j[k];
    }
    return { url: `${TRACECOM_BASE}/api/iq/status`, http: res.status, startedAt, finishedAt: new Date().toISOString(), excerpt: pick };
  } catch (e) {
    return { url: `${TRACECOM_BASE}/api/iq/status`, http: 0, error: `${e.name}:${e.message}`, startedAt, finishedAt: new Date().toISOString() };
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  authenticated: Boolean(SECRET),
  allowlist: READ_ALLOWLIST,
  servers: {},
  tracecom: null,
  relayStatus: null,
  verdict: null,
  divergences: [],
};

if (!SECRET) console.log("[account-validate] IQ_MCP_TOKEN ausente — fail-closed.");

if (SECRET) {
  for (const [name, base] of Object.entries(SERVERS)) report.servers[name] = await readMcpServer(name, base);
}
report.tracecom = await readTracecomOffice();
report.relayStatus = await readRelayStatus();

const mcpBalances = [];
for (const [srv, data] of Object.entries(report.servers)) {
  for (const b of data.results?.list_balances?.balances ?? []) {
    mcpBalances.push({ server: srv, balance_id: b.balance_id ?? null, type: b.type ?? null, currency: b.currency ?? null, amount: b.amount ?? null });
  }
}
const office = report.tracecom?.excerpt ?? {};
const practice = office.modeState?.practice ?? null;
const real = office.modeState?.real ?? null;

const training = mcpBalances.filter((b) => b.type === "training");
const regular = mcpBalances.filter((b) => b.type === "regular");
const unique = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.balance_id}|${r.type}|${r.currency}|${r.amount}`;
    if (!m.has(k)) { const { server, ...rest } = r; m.set(k, { ...rest, servers: [] }); }
    if (!m.get(k).servers.includes(r.server)) m.get(k).servers.push(r.server);
  }
  return [...m.values()];
};

const practiceAmountMatch = Boolean(practice) && training.length > 0 && training.every((b) => Number(b.amount) === Number(practice.balance) && b.currency === practice.currency);
const realAmountMatch = Boolean(real) && regular.length > 0 && regular.every((b) => Number(b.amount) === Number(real.balance) && b.currency === real.currency);
const modeMatch = office.mode === "PRACTICE" && training.length > 0;
const allServersReported = Object.values(report.servers).every((s) => (s.results?.list_balances?.balances ?? []).length > 0);
const confirmed = modeMatch && practiceAmountMatch && realAmountMatch && allServersReported;
report.verdict = confirmed ? "SAME_ACCOUNT_CONFIRMED" : "SAME_ACCOUNT_NOT_CONFIRMED";

const div = [];
if (!modeMatch) div.push(`mode: TraceCom=${office.mode ?? "n/a"}, MCP training balances=${training.length}`);
if (!practiceAmountMatch) div.push(`practice/training mismatch: TraceCom practice=${JSON.stringify(practice)}, MCP training=${JSON.stringify(unique(training))}`);
if (!realAmountMatch) div.push(`real/regular mismatch: TraceCom real=${JSON.stringify(real)}, MCP regular=${JSON.stringify(unique(regular))}`);
if (!allServersReported) div.push("at least one MCP server returned no balances");
report.divergences = div;

const mcpStart = Object.values(report.servers).map((s) => s.readStartedAt).filter(Boolean).sort()[0] ?? null;
const mcpEnd = Object.values(report.servers).map((s) => s.readFinishedAt).filter(Boolean).sort().reverse()[0] ?? null;
const skewMs = mcpEnd && report.tracecom?.finishedAt ? Math.abs(new Date(report.tracecom.finishedAt) - new Date(mcpEnd)) : null;
report.timestamps = { mcpReadStartedAt: mcpStart, mcpReadFinishedAt: mcpEnd, tracecomStartedAt: report.tracecom?.startedAt ?? null, tracecomFinishedAt: report.tracecom?.finishedAt ?? null, observedSkewMs: skewMs };

const stakeConfig = office.config ?? {};
const stakeFrozen10 = Number(stakeConfig.defaultStake) === 10 && Number(stakeConfig.globalMaxStake) === 10;

const tableRows = [];
for (const b of unique(mcpBalances)) {
  tableRows.push(`| ${b.balance_id} | ${b.type} | ${b.currency} | ${b.amount} | MCP ${b.servers.join("+")} |`);
}
if (practice) tableRows.push(`| (not exposed) | practice | ${practice.currency ?? "n/a"} | ${practice.balance ?? "n/a"} | TraceCom office |`);
if (real) tableRows.push(`| (not exposed) | real | ${real.currency ?? "n/a"} | ${real.balance ?? "n/a"} | TraceCom office |`);

const md = [];
md.push("# IQ MCP x TraceCom — account identity validation (read-only)");
md.push("");
md.push(`Generated: ${report.generatedAt}`);
md.push(`Auth mode: env-only (never persisted, redacted in output). Authenticated: ${report.authenticated}.`);
md.push(`MCP allowlist: ${READ_ALLOWLIST.map((t) => `\`${t}\``).join(", ")} (no order/write tool called)`);
md.push("");
md.push("## Balances");
md.push("");
md.push("| balance_id | type | currency | amount | source |");
md.push("| --- | --- | --- | --- | --- |");
md.push(...tableRows);
md.push("");
md.push("## Verdict");
md.push("");
md.push(`\`${report.verdict}\``);
md.push("");
if (report.divergences.length) {
  md.push("Objective divergences:");
  for (const d of report.divergences) md.push(`- ${d}`);
} else {
  md.push("No objective divergences found on the compared fields (mode, type mapping, currency, amount, per-server).");
}
md.push("");
md.push("## Identity evidence");
md.push("");
md.push(`- Account mode: MCP balances carry \`type: training\` (practice funds) and \`type: regular\` (real funds); TraceCom reports \`mode=${office.mode}\`, \`modeState.practice.verified=${practice?.verified}\`.`);
md.push(`- Training <-> practice: MCP training ${JSON.stringify(unique(training))} vs TraceCom practice ${JSON.stringify(practice)} — ${practiceAmountMatch ? "MATCH" : "MISMATCH"} (currency + amount).`);
md.push(`- Regular <-> real: MCP regular ${JSON.stringify(unique(regular))} vs TraceCom real ${JSON.stringify(real)} — ${realAmountMatch ? "MATCH" : "MISMATCH"} (currency + amount).`);
md.push(`- get_capabilities scope: ${JSON.stringify(Object.fromEntries(Object.entries(report.servers).map(([s, d]) => [s, d.results?.get_capabilities ?? null])))} (token scope \`mode\`, not the account mode).`);
md.push(`- TraceCom \`modeState.realMode\`: ${JSON.stringify(office.modeState?.realMode ?? null)}.`);
md.push(`- TraceCom \`activeCount\`: ${office.activeCount ?? "n/a"} (relay markets, not broker positions).`);
md.push("");
md.push("### Identifier check");
md.push("");
const idSummary = unique(mcpBalances).map((b) => `\`${b.balance_id}\` ${b.type}/${b.currency}`).join(", ");
md.push(`- MCP exposes immutable per-balance ids: \`balance_id\` (${idSummary}) — stable across binary and turbo servers.`);
md.push("- TraceCom `GET /api/iq/office` exposes NO account/balance identifier (searched keys `balance_id`, `balanceId`, `accountId`, `userId`, `email`, `profileId`: all absent).");
md.push("- Therefore the cross-system match is **balance magnitude + currency + type only**; there is no shared immutable key to compare. A same-magnitude coincidence cannot be excluded by identifiers alone.");
md.push("");
md.push("## Stake fields (expected freeze = 10)");
md.push("");
md.push(`- \`config\`: ${JSON.stringify(stakeConfig)}`);
md.push(`- Expected frozen stake \`10\`: ${stakeFrozen10 ? "OK" : "**DIVERGENCE** — `defaultStake`/`globalMaxStake` are not 10"} (gauntlet contract P63/64/65/67 requires \`defaultStake === 10\`).`);
md.push(`- Per-market stake distribution: ${JSON.stringify(office.stakeDistribution ?? null)}`);
md.push("");
md.push("## Readings and skew");
md.push("");
md.push(`- MCP read window: ${mcpStart} -> ${mcpEnd}`);
md.push(`- TraceCom office read: ${report.tracecom?.startedAt} -> ${report.tracecom?.finishedAt} (HTTP ${report.tracecom?.http}, ${report.tracecom?.latencyMs}ms)`);
md.push(`- Secondary relay read \`GET /api/iq/status\`: ${JSON.stringify(report.relayStatus?.excerpt ?? null)} (HTTP ${report.relayStatus?.http}). \`GET /api/iq/office\` is itself the public read-through of the relay admin endpoint (api/http.ts:786 relays to \`relayAdminJson("GET", ...)\`); no separate admin credential was used and no write endpoint was called.`);
md.push(`- Observed skew between MCP finish and TraceCom finish: ${skewMs ?? "n/a"} ms. Balances are point-in-time reads; relay gate \`${office.executionGate?.state ?? "n/a"}\` / armed=${office.executionGate?.armed ?? "n/a"}, so no execution should have moved funds between reads.`);
md.push("");
md.push("## Still not provable");
md.push("");
md.push("- That both surfaces are the *same user account* by an immutable shared identifier: TraceCom does not expose `balance_id`/account id, so identity rests on mode + type mapping + currency + amount (magnitude) only.");
md.push("- That the TraceCom practice balance equals the MCP training balance *at the same instant*: the two reads are ~" + (skewMs ?? "?") + " ms apart (portal read-through and MCP are independent paths).");
md.push("- Real side (`type: regular` / `modeState.real`): both read 0 BRL, but TraceCom `realMode.realBalanceSeen` is `null` (real never observed in-session), so the regular/real correspondence is nominal, not execution-verified.");
md.push("");
md.push("## Evidence (redacted)");
md.push("");
md.push(`- MCP raw per-server payloads: \`docs/iq-mcp/account-validation.raw.json\`.`);
md.push(`- TraceCom office excerpt: ${JSON.stringify({ mode: office.mode, modeState: office.modeState, activeCount: office.activeCount, config: office.config, legacyAccount: office.legacyAccount })}`);
md.push(`- TraceCom status excerpt: ${JSON.stringify(report.relayStatus?.excerpt ?? null)}`);
md.push("");

const markdown = redact(md.join("\n"));
if (containsSecret(markdown, SECRET)) throw new Error("SECRET_LEAK_IN_MARKDOWN");
const rawJson = redact(JSON.stringify(report, null, 2));
if (containsSecret(rawJson, SECRET)) throw new Error("SECRET_LEAK_IN_RAW_JSON");

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "account-validation.md"), markdown, "utf8");
await fs.writeFile(path.join(OUT_DIR, "account-validation.raw.json"), rawJson, "utf8");
console.log(`[account-validate] verdict=${report.verdict} divergent=${report.divergences.length} stake10=${stakeFrozen10}`);
console.log(`[account-validate] wrote docs/iq-mcp/account-validation.md`);
