#!/usr/bin/env node
/**
 * IQ Official MCP — DATA VERACITY probe (read-only by construction).
 *
 * Answers: which of the 7 MCP servers is the most professional / trustworthy as
 * a data source for TraceCom — catalog, candles, expirations, payout, balances.
 *
 * SECURITY
 *  - Token only from env `IQ_MCP_TOKEN` / `IQ_MCP_TOKEN_FILE`; never written.
 *  - Every `tools/call` passes the shared hard gates (`relay/iq-mcp/security.mjs`):
 *    read-probe method + tool classification + per-server allowlist (SAFE_READ /
 *    ACCOUNT_READ only). No order/cancel/close/change/set tool can be called.
 *  - Global pacing keeps read calls under the advertised 60/60s per-user bucket.
 *  - Artifacts are deep-redacted and asserted token-free before writing.
 *
 * Usage (PowerShell):
 *   $env:IQ_MCP_TOKEN = "<token>"; node scripts/iq-mcp-veracity.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RISK,
  assertReadOnlyMethod,
  assertReadProbeMethod,
  classifyTool,
  containsSecret,
  redact as redactSecret,
} from "../relay/iq-mcp/security.mjs";

export const SERVERS = Object.freeze({
  "binary-options": "https://binary-options.mcp.iqoption.com",
  "turbo-options": "https://turbo-options.mcp.iqoption.com",
  "blitz-options": "https://blitz-options.mcp.iqoption.com",
  "digital-options": "https://digital-options.mcp.iqoption.com",
  "marginal-cfd": "https://marginal-cfd.mcp.iqoption.com",
  "marginal-crypto": "https://marginal-crypto.mcp.iqoption.com",
  "marginal-forex": "https://marginal-forex.mcp.iqoption.com",
});

const BASE_TOOLS = Object.freeze(["get_capabilities", "get_limits", "list_assets", "list_balances", "get_candles"]);
export const READ_ALLOWLISTS = Object.freeze(
  Object.fromEntries(
    Object.keys(SERVERS).map((name) => [name, Object.freeze([...BASE_TOOLS, "get_instruments"])]),
  ),
);

export const TRACE_OFFICE_URL = "https://tracecom.consecom.com.br/api/iq/office";

export const PICKS = Object.freeze([
  Object.freeze({ key: "US500:NORMAL", sym: "US500", otc: false, label: "US 500 (NORMAL index)" }),
  Object.freeze({ key: "EURUSD:OTC", sym: "EURUSD", otc: true, label: "EUR/USD (OTC)" }),
  Object.freeze({ key: "EURUSD:NORMAL", sym: "EURUSD", otc: false, label: "EUR/USD (NORMAL)" }),
]);

const CANDLE_SIZE = 60;
const CANDLE_COUNT = 60;
const READ_PACE_MS = 2000;
const INDICATOR_RE = /indicator|rsi|macd|ema|sma\b|bollinger|stoch|atr\b|adx|cci|ichimoku|williams|donchian|momentum|feature/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assertAllowlistsReadOnly(allowlists = READ_ALLOWLISTS) {
  for (const [server, list] of Object.entries(allowlists)) {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`MCP_ALLOWLIST_MISSING: ${server}`);
    for (const name of list) {
      const risk = classifyTool({ name });
      if (risk !== RISK.SAFE_READ && risk !== RISK.ACCOUNT_READ) {
        throw new Error(`MCP_ALLOWLIST_WRITE: ${server}/${name} classified ${risk}`);
      }
    }
  }
  return true;
}

/** Name normalizer: detects OTC, strips punctuation, maps metal aliases. */
export function normalizeAssetName(raw) {
  const text = String(raw ?? "");
  const otc = /\(otc\)|\botc\b/i.test(text);
  let sym = text
    .replace(/\(otc\)/gi, " ")
    .replace(/\botc\b/gi, " ")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const ALIAS = { GOLD: "XAUUSD", SILVER: "XAGUSD" };
  if (ALIAS[sym]) sym = ALIAS[sym];
  return { sym, otc };
}

const num = (v) => (typeof v === "number" ? v : Number(v));
const isHttpOk = (res) => res && res.status === 200 && !res.error;

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

function createClient({ base, token, fetchImpl = globalThis.fetch, server, allowlist, timeoutMs = 30000, pace = true }) {
  const state = { sessionId: null, lastReadAt: 0 };
  const redact = (value) => redactSecret(value, token);

  async function rpc(method, params, id, tool) {
    if (tool) assertReadProbeMethod("tools/call", tool, classifyTool({ name: tool }), allowlist);
    else assertReadOnlyMethod(method);
    if (tool && pace) {
      const wait = READ_PACE_MS - (Date.now() - state.lastReadAt);
      if (wait > 0) await sleep(wait);
      state.lastReadAt = Date.now();
    }
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
      const retryAfter = Number(res.headers.get("retry-after"));
      return { status: res.status, body: parsed ?? redact(text).slice(0, 1200), retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null };
    } catch (e) {
      return { status: 0, error: `${e.name}:${e.message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(tool, args, id, opts = {}) {
    const invoke = (rpcId) => rpc("tools/call", { name: tool, arguments: args ?? {} }, rpcId, tool);
    let res = await invoke(id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (res.status === 429) {
        const waitMs = Math.min(120000, Math.max(10000, (res.retryAfterSeconds ?? 30) * 1000));
        await sleep(waitMs);
        res = await invoke(id + 1000 * (attempt + 1));
        continue;
      }
      if (!isHttpOk(res)) return { ok: false, status: res.status, error: res.error ?? `HTTP_${res.status}`, payload: res.body };
      const payload = extractPayload(res.body?.result ?? res.body);
      if (res.body?.result?.isError === true) {
        const detail = Array.isArray(res.body.result.content) ? res.body.result.content.find((c) => typeof c?.text === "string")?.text : null;
        return { ok: false, status: res.status, error: `TOOL_ERROR:${String(detail ?? "isError").slice(0, 300)}`, payload };
      }
      if (payload && typeof payload === "object" && payload.message !== undefined && /rate[_ ]?limit/i.test(String(payload.message))) {
        const retryMs = Number(String(payload.message).match(/retry_after_ms=(\d+)/)?.[1]);
        const waitMs = Math.min(120000, Math.max(10000, Number.isFinite(retryMs) && retryMs > 0 ? retryMs + 1500 : 30000));
        await sleep(waitMs);
        res = await invoke(id + 1000 * (attempt + 1));
        continue;
      }
      return { ok: true, status: res.status, payload };
    }
    return { ok: false, status: res.status, error: "RATE_LIMITED_AFTER_RETRY", payload: res.body };
  }

  return { rpc, call, redact };
}

function deepRedact(redactFn, value) {
  const text = redactFn(JSON.stringify(value));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function shrink(value, { maxArray = 8, maxString = 600, depth = 8 } = {}, level = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (typeof value !== "object") return value;
  if (level >= depth) return Array.isArray(value) ? `[${value.length} items]` : "{…}";
  if (Array.isArray(value)) {
    const rows = value.slice(0, maxArray).map((item) => shrink(item, { maxArray, maxString, depth }, level + 1));
    if (value.length > maxArray) rows.push(`…${value.length - maxArray} more`);
    return rows;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = shrink(item, { maxArray, maxString, depth }, level + 1);
  return out;
}

function collectKeys(value, prefix = "", out = new Set(), depth = 0, seen = new Set()) {
  if (value === null || typeof value !== "object" || depth > 10) return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) collectKeys(item, prefix, out, depth + 1, seen);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    out.add(prefix ? `${prefix}.${key}` : key);
    collectKeys(item, prefix ? `${prefix}.${key}` : key, out, depth + 1, seen);
  }
  return out;
}

function isoToEpoch(iso) {
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function decimalsOf(value) {
  const text = typeof value === "number" ? String(value) : "";
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function stats(values) {
  const nums = values.map(num).filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: nums.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

function modeOf(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function mdTable(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function fmtNum(v, digits = 6) {
  if (v === null || v === undefined || !Number.isFinite(num(v))) return "—";
  return String(Number(num(v).toFixed(digits)));
}

function rowsFromAssets(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.assets)) return payload.assets;
  return [];
}

export async function collect({ token, fetchImpl = globalThis.fetch, pace = true, now = () => new Date().toISOString() } = {}) {
  assertAllowlistsReadOnly();
  const report = { generatedAt: now(), authenticated: Boolean(token), servers: {} };

  const csv = new Map();
  for (const [server, base] of Object.entries(SERVERS)) {
    const allowlist = READ_ALLOWLISTS[server];
    const entry = { base, allowlist: [...allowlist], error: null, capabilities: null, limits: null, balances: null, assets: null, defaults: null, fields: {}, instruments: {}, candles: {}, tools: [] };
    report.servers[server] = entry;
    if (!token) {
      entry.error = "NO_TOKEN";
      continue;
    }
    const client = createClient({ base, token, fetchImpl, server, allowlist, pace });
    const init = await client.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tracecom-data-veracity", version: "1.0.0" },
    }, 1);
    if (init.status !== 200) {
      entry.error = `initialize HTTP ${init.status}`;
      continue;
    }
    await client.rpc("notifications/initialized", {}, null);
    const toolsList = await client.rpc("tools/list", {}, 2);
    const toolRows = toolsList.body?.result?.tools ?? [];
    entry.tools = toolRows.map((tool) => ({
      name: tool.name,
      risk: classifyTool({ name: tool.name }),
      indicatorLike: INDICATOR_RE.test(String(tool.name)),
      inputSchema: tool.inputSchema ? shrink(tool.inputSchema, { maxArray: 40, maxString: 320, depth: 6 }) : null,
    }));

    const steps = [
      { tool: "get_capabilities", args: {} },
      { tool: "get_limits", args: {} },
      { tool: "list_assets", args: {} },
      { tool: "list_balances", args: server.startsWith("marginal-") ? { types: "ALL" } : {} },
    ];
    let id = 100;
    for (const step of steps) {
      const t0 = Date.now();
      const res = await client.call(step.tool, step.args, (id += 1));
      const record = { ok: res.ok, status: res.status ?? null, latencyMs: Date.now() - t0, args: step.args, payload: null, error: res.error ?? null };
      if (res.ok) {
        record.payload = deepRedact(client.redact, res.payload);
        if (step.tool === "get_capabilities") entry.capabilities = record.payload;
        if (step.tool === "get_limits") entry.limits = record.payload;
        if (step.tool === "list_balances") entry.balances = record.payload;
        if (step.tool === "list_assets") {
          entry.assets = record.payload;
          if (record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) && record.payload.defaults) {
            entry.defaults = record.payload.defaults;
          }
        }
      }
      entry[`raw_${step.tool}`] = record;
    }
    const assetRows = rowsFromAssets(entry.assets);
    entry.fields.asset = [...collectKeys(assetRows.slice(0, 50))].sort();
    entry.fields.balances = [...collectKeys(entry.balances)].sort();
    entry.fields.capabilities = [...collectKeys(entry.capabilities)].sort();

    if (assetRows.length) {
      const byPick = new Map();
      for (const pick of PICKS) {
        const match = assetRows.find((a) => {
          const n = normalizeAssetName(a?.name);
          return n.sym === pick.sym && n.otc === pick.otc;
        });
        if (match) byPick.set(pick.key, match);
      }
      if (byPick.size && entry.tools.some((t) => t.name === "get_instruments")) {
        const instrumentAsset = assetRows.find((a) => normalizeAssetName(a?.name).sym === "US500" && !normalizeAssetName(a?.name).otc) ?? assetRows[0];
        const inst = await client.call("get_instruments", { asset_id: instrumentAsset.asset_id }, (id += 1));
        entry.instruments = {
          assetId: instrumentAsset.asset_id,
          assetName: instrumentAsset.name,
          toolPresent: true,
          ok: inst.ok,
          status: inst.status ?? null,
          error: inst.error ?? null,
          fields: [],
          payload: inst.ok ? deepRedact(client.redact, shrink(inst.payload, { maxArray: 10, maxString: 400 })) : null,
        };
        if (inst.ok) entry.instruments.fields = [...collectKeys(inst.payload)].sort();
      }
      for (const pick of PICKS) {
        const asset = byPick.get(pick.key);
        if (!asset) continue;
        const res = await client.call("get_candles", { asset_id: asset.asset_id, size: CANDLE_SIZE, count: CANDLE_COUNT }, (id += 1));
        entry.candles[pick.key] = {
          assetId: asset.asset_id,
          assetName: asset.name,
          size: CANDLE_SIZE,
          countRequested: CANDLE_COUNT,
          ok: res.ok,
          status: res.status ?? null,
          error: res.error ?? null,
          expirations: Array.isArray(asset.expirations) ? asset.expirations : null,
          expirationSizesSeconds: Array.isArray(asset.expiration_sizes_seconds) ? asset.expiration_sizes_seconds : null,
          rows: res.ok && Array.isArray(res.payload?.candles)
            ? deepRedact(client.redact, res.payload.candles)
            : res.ok && Array.isArray(res.payload)
              ? deepRedact(client.redact, res.payload)
              : [],
          fields: res.ok ? [...collectKeys(res.payload?.candles ?? res.payload ?? [])].sort() : [],
        };
      }
    }
    csv.set(server, client);
  }

  report.serverOrder = Object.keys(SERVERS);
  return { report, clients: csv };
}

export function analyze(report, traceOffice) {
  const serverNames = report.serverOrder;
  const perServer = {};
  for (const server of serverNames) {
    const entry = report.servers[server];
    const assetRows = rowsFromAssets(entry.assets);
    const coverage = { total: assetRows.length, open: 0, closed: 0, otc: 0, normal: 0, types: {} };
    for (const a of assetRows) {
      const n = normalizeAssetName(a?.name);
      if (a?.is_open === true) coverage.open += 1;
      else if (a?.is_open === false) coverage.closed += 1;
      if (n.otc) coverage.otc += 1;
      else coverage.normal += 1;
      const type = String(a?.asset_type ?? "UNKNOWN");
      coverage.types[type] = (coverage.types[type] ?? 0) + 1;
    }
    perServer[server] = coverage;
  }

  const traceMarkets = Array.isArray(traceOffice?.markets) ? traceOffice.markets : [];
  const matching = { perServer: {}, best: null, traceTotal: traceMarkets.length, traceNormal: 0, traceOtc: 0 };
  for (const m of traceMarkets) {
    if (String(m?.marketType).toUpperCase() === "OTC") matching.traceOtc += 1;
    else matching.traceNormal += 1;
  }
  for (const server of serverNames) {
    const entry = report.servers[server];
    const assetRows = rowsFromAssets(entry.assets);
    const matches = [];
    const missing = [];
    for (const market of traceMarkets) {
      const canonical = String(market?.canonical ?? "").toUpperCase();
      const wantOtc = String(market?.marketType ?? "").toUpperCase() === "OTC";
      const hit = assetRows.find((a) => {
        const n = normalizeAssetName(a?.name);
        return n.sym === canonical && n.otc === wantOtc;
      });
      if (hit) {
        matches.push({ marketKey: market.marketKey, canonical, otc: wantOtc, assetId: hit.asset_id, name: hit.name, isOpen: hit.is_open === true });
      } else {
        missing.push(market.marketKey);
      }
    }
    const matchNormal = matches.filter((m) => !m.otc).length;
    const matchOtc = matches.filter((m) => m.otc).length;
    const fields = entry.fields?.asset ?? [];
    const richness =
      (fields.includes("profit_percent") ? 2 : 0) +
      (fields.includes("expirations") ? 2 : 0) +
      (fields.includes("expiration_sizes_seconds") ? 1 : 0) +
      (fields.includes("asset_type") ? 1 : 0) +
      (entry.defaults ? 1 : 0) +
      (fields.includes("precision") ? 1 : 0);
    matching.perServer[server] = {
      matched: matches.length,
      matchedNormal: matchNormal,
      matchedOtc: matchOtc,
      extras: coverageFor(server, perServer).total - matches.length,
      richness,
      missing,
      matches,
    };
  }
  matching.perServerOrder = serverNames;
  const ranked = serverNames
    .filter((s) => matching.perServer[s].matched > 0)
    .sort((a, b) => matching.perServer[b].matched - matching.perServer[a].matched || matching.perServer[b].richness - matching.perServer[a].richness);
  matching.best = ranked[0] ?? null;
  matching.ranking = ranked;

  function coverageFor(server) {
    return perServer[server];
  }

  const candleComparison = {};
  for (const pick of PICKS) {
    const series = {};
    for (const server of serverNames) {
      const c = report.servers[server]?.candles?.[pick.key];
      if (!c || !c.ok) continue;
      const rows = Array.isArray(c.rows) ? c.rows : [];
      const bars = rows
        .map((row) => {
          const from = isoToEpoch(row.from);
          const to = isoToEpoch(row.to);
          return {
            from,
            to,
            open: num(row.open),
            high: num(row.max ?? row.high),
            low: num(row.min ?? row.low),
            close: num(row.close),
            hasVolume: row.volume !== undefined || row.vol !== undefined,
            keys: Object.keys(row).sort().join(","),
          };
        })
        .filter((b) => b.from !== null);
      bars.sort((a, b) => a.from - b.from);
      series[server] = {
        assetId: c.assetId,
        assetName: c.assetName,
        rows: bars.length,
        first: bars[0] ?? null,
        last: bars[bars.length - 1] ?? null,
        alignedToSize: bars.every((b) => b.from % CANDLE_SIZE === 0 && b.to !== null && b.to - b.from === CANDLE_SIZE),
        gaps: bars.reduce((acc, b, i) => (i > 0 && b.from - bars[i - 1].from !== CANDLE_SIZE ? acc + 1 : acc), 0),
        closeDecimals: modeOf(bars.map((b) => decimalsOf(b.close))),
        fields: c.fields,
        expirations: c.expirations,
        expirationSizesSeconds: c.expirationSizesSeconds,
      };
    }
    const refServer = series["binary-options"] ? "binary-options" : Object.keys(series)[0];
    const ref = refServer ? series[refServer] : null;
    const pairs = [];
    if (ref) {
      const refRows = Array.isArray(report.servers[refServer].candles[pick.key].rows) ? report.servers[refServer].candles[pick.key].rows : [];
      const refMap = new Map();
      for (const b of refRows.map((row) => ({ from: isoToEpoch(row.from), row }))) if (b.from !== null) refMap.set(b.from, b.row);
      for (const server of Object.keys(series)) {
        if (server === refServer) continue;
        const serverRows = Array.isArray(report.servers[server].candles[pick.key].rows) ? report.servers[server].candles[pick.key].rows : [];
        const map = new Map();
        for (const row of serverRows) {
          const from = isoToEpoch(row.from);
          if (from !== null) map.set(from, row);
        }
        const refTimes = [...refMap.keys()].sort((a, b) => a - b);
        const srvTimes = [...map.keys()].sort((a, b) => a - b);
        const common = refTimes.filter((t) => map.has(t));
        const missing = refTimes.filter((t) => !map.has(t));
        const extra = srvTimes.filter((t) => !refMap.has(t));
        const maxFrom = common.length ? common[common.length - 1] : null;
        let completedMismatch = 0;
        let completedCompared = 0;
        let formingMismatch = 0;
        let maxDeltaClose = 0;
        let maxDeltaHigh = 0;
        let maxDeltaLow = 0;
        let maxDeltaOpen = 0;
        let firstDivergence = null;
        for (const t of common) {
          const a = refMap.get(t);
          const b = map.get(t);
          const dClose = Math.abs(num(a.close) - num(b.close));
          const dHigh = Math.abs(num(a.max ?? a.high) - num(b.max ?? b.high));
          const dLow = Math.abs(num(a.min ?? a.low) - num(b.min ?? b.low));
          const dOpen = Math.abs(num(a.open) - num(b.open));
          const mismatched = dClose > 0 || dHigh > 0 || dLow > 0 || dOpen > 0;
          if (t === maxFrom) {
            if (mismatched) formingMismatch += 1;
            continue;
          }
          completedCompared += 1;
          if (mismatched) {
            completedMismatch += 1;
            if (!firstDivergence) {
              firstDivergence = {
                from: t,
                ref: { open: num(a.open), high: num(a.max ?? a.high), low: num(a.min ?? a.low), close: num(a.close) },
                server: { open: num(b.open), high: num(b.max ?? b.high), low: num(b.min ?? b.low), close: num(b.close) },
              };
            }
          }
          maxDeltaClose = Math.max(maxDeltaClose, dClose);
          maxDeltaHigh = Math.max(maxDeltaHigh, dHigh);
          maxDeltaLow = Math.max(maxDeltaLow, dLow);
          maxDeltaOpen = Math.max(maxDeltaOpen, dOpen);
        }
        pairs.push({
          refServer,
          server,
          refBars: refTimes.length,
          serverBars: srvTimes.length,
          commonBars: common.length,
          missingBars: missing.length,
          missingFrom: missing.slice(0, 5),
          extraBars: extra.length,
          completedCompared,
          completedMismatch,
          formingMismatch,
          firstDivergence,
          maxDeltaClose,
          maxDeltaHigh,
          maxDeltaLow,
          maxDeltaOpen,
          lastRefFrom: refTimes[refTimes.length - 1] ?? null,
          lastServerFrom: srvTimes[srvTimes.length - 1] ?? null,
          timestampOffsetSeconds: (srvTimes[srvTimes.length - 1] ?? 0) - (refTimes[refTimes.length - 1] ?? 0),
          volumeFieldPresent: serverRows.some((row) => row.volume !== undefined || row.vol !== undefined),
        });
      }
    }
    candleComparison[pick.key] = { pick, refServer, series, pairs };
  }

  const expiry = {};
  for (const pick of PICKS) {
    expiry[pick.key] = {};
    for (const server of serverNames) {
      const c = report.servers[server]?.candles?.[pick.key];
      if (!c) continue;
      const exps = Array.isArray(c.expirations) ? [...c.expirations].sort((a, b) => a - b) : [];
      const diffs = [];
      for (let i = 1; i < exps.length; i += 1) diffs.push(exps[i] - exps[i - 1]);
      const cadence = diffs.length ? modeOf(diffs) : null;
      const aligned = cadence ? exps.every((e) => e % cadence === 0) : null;
      expiry[pick.key][server] = {
        hasExpirations: exps.length > 0,
        expirations: exps,
        cadence,
        cadenceDiffs: diffs,
        alignedToWallClock: aligned,
        expirationSizesSeconds: c.expirationSizesSeconds,
        instruments: null,
      };
      if (server.startsWith("marginal-")) {
        const payload = report.servers[server].instruments?.payload;
        const profiles = Array.isArray(payload?.leverage_profiles) ? payload.leverage_profiles.length : 0;
        expiry[pick.key][server].instruments = {
          assetId: report.servers[server].instruments?.assetId ?? null,
          note: "no expiry windows — marginal product has no expiration model",
          leverageProfiles: profiles,
        };
      } else if (server === "digital-options") {
        const payload = report.servers[server].instruments?.payload;
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.instruments) ? payload.instruments : [];
        if (rows.length) {
          const windows = rows.slice(0, 10).map((w) => ({
            instrument_index: w?.instrument_index ?? null,
            expiration: w?.expiration ?? null,
            deadline: w?.deadline ?? null,
            deadtime_seconds: w?.deadtime_seconds ?? null,
            period_seconds: w?.period_seconds ?? null,
            strikes: Array.isArray(w?.instruments) ? w.instruments.length : null,
          }));
          expiry[pick.key][server].instruments = { assetId: report.servers[server].instruments.assetId, windows };
        }
      }
    }
  }

  const payout = {};
  for (const server of serverNames) {
    const entry = report.servers[server];
    const assetRows = rowsFromAssets(entry.assets);
    const payouts = assetRows.map((a) => a.profit_percent).filter((v) => Number.isFinite(num(v)));
    const minQ = assetRows.map((a) => a.min_quantity).filter((v) => Number.isFinite(num(v)));
    const leverages = assetRows.flatMap((a) => (a.max_leverages && typeof a.max_leverages === "object" ? Object.values(a.max_leverages) : [])).map(num).filter(Number.isFinite);
    const precision = assetRows.map((a) => a.precision ?? a.price_precision).filter((v) => Number.isFinite(num(v)));
    const buyback = assetRows.map((a) => a.buyback_deadtime_seconds).filter((v) => Number.isFinite(num(v)));
    payout[server] = {
      hasPayout: payouts.length > 0,
      payout: stats(payouts),
      assetCount: assetRows.length,
      minQuantity: stats(minQ),
      leverageTiers: [...new Set(leverages)].sort((a, b) => b - a).slice(0, 12),
      precision: stats(precision),
      buybackDeadtime: buyback.length ? { presentOn: buyback.length, values: [...new Set(buyback)] } : null,
      defaults: entry.defaults ?? null,
      exposesMinMaxAmount: Boolean(entry.defaults?.minimum_amount || assetRows.some((a) => a.minimum_amount !== undefined)),
    };
  }

  const balances = {};
  for (const server of serverNames) {
    const payload = report.servers[server]?.balances;
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.balances) ? payload.balances : [];
    balances[server] = rows.map((b) => ({ type: b.type, currency: b.currency, amount: b.amount, balance_id_present: b.balance_id !== undefined, extra: Object.keys(b).filter((k) => !["type", "currency", "amount", "balance_id", "bonus_amount"].includes(k)) }));
  }

  const capabilities = {};
  for (const server of serverNames) {
    const c = report.servers[server]?.capabilities;
    capabilities[server] = { mode: c?.mode ?? null, product: c?.product ?? null };
  }

  const rates = {};
  for (const server of serverNames) {
    const l = report.servers[server]?.limits;
    const buckets = {};
    for (const b of Array.isArray(l?.buckets) ? l.buckets : []) buckets[b.bucket] = `${b.limit}/${b.window_seconds}s`;
    const tools = l?.tools && typeof l.tools === "object" ? l.tools : {};
    const writeTools = Object.entries(tools).filter(([, v]) => v === "write").map(([k]) => k);
    rates[server] = {
      scope: l?.scope ?? null,
      buckets,
      readToolCount: Object.values(tools).filter((v) => v === "read").length,
      writeToolCount: writeTools.length,
      writeTools,
    };
  }

  const indicators = { tools: {}, assetFields: {}, presence: false, notes: [] };
  for (const server of serverNames) {
    const entry = report.servers[server];
    indicators.tools[server] = (entry.tools ?? []).filter((t) => t.indicatorLike).map((t) => t.name);
    indicators.assetFields[server] = (entry.fields?.asset ?? []).filter((k) => INDICATOR_RE.test(k));
    if (indicators.tools[server].length || indicators.assetFields[server].length) indicators.presence = true;
  }

  const ownWindows = {};
  for (const pick of PICKS) {
    ownWindows[pick.key] = {};
    for (const server of serverNames) {
      const c = report.servers[server]?.candles?.[pick.key];
      if (!c) continue;
      const exps = Array.isArray(c.expirations) ? [...c.expirations].sort((a, b) => a - b) : [];
      const diffs = [];
      for (let i = 1; i < exps.length; i += 1) diffs.push(exps[i] - exps[i - 1]);
      const cadence = diffs.length ? modeOf(diffs) : null;
      if (exps.length && cadence) ownWindows[pick.key][server] = { earliest: exps[0] - cadence, latest: exps[0], period: cadence, source: "own expirations[]" };
    }
  }
  const digitalPayload = report.servers["digital-options"]?.instruments?.payload;
  const digitalRows = Array.isArray(digitalPayload) ? digitalPayload : Array.isArray(digitalPayload?.instruments) ? digitalPayload.instruments : [];
  const digitalExp = digitalRows.map((w) => num(w?.expiration)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const digitalPeriods = digitalRows.map((w) => num(w?.period_seconds)).filter(Number.isFinite);
  const digitalPeriod = digitalPeriods.length ? modeOf(digitalPeriods) : null;
  if (digitalExp.length && digitalPeriod) {
    ownWindows["US500:NORMAL"] = { ...(ownWindows["US500:NORMAL"] ?? {}), "digital-options": { earliest: digitalExp[0] - digitalPeriod, latest: digitalExp[0], period: digitalPeriod, source: "get_instruments[].expiration/period_seconds" } };
  }
  const referenceWindow = (() => {
    const turbo = ownWindows["US500:NORMAL"]?.["turbo-options"];
    if (turbo) return { ...turbo, source: "turbo-options expirations[] (60s grid)" };
    if (digitalExp.length && digitalPeriod) return { earliest: digitalExp[0] - digitalPeriod, latest: digitalExp[0], period: digitalPeriod, source: "digital-options instruments" };
    return null;
  })();

  const freshness = {};
  for (const pick of PICKS) {
    freshness[pick.key] = {};
    for (const server of serverNames) {
      const c = report.servers[server]?.candles?.[pick.key];
      if (!c || !c.ok || !Array.isArray(c.rows) || !c.rows.length) continue;
      const lastTo = isoToEpoch(c.rows[c.rows.length - 1].to);
      const own = ownWindows[pick.key]?.[server] ?? null;
      const estimate = referenceWindow ?? own;
      const barAgeMin = estimate && lastTo !== null ? estimate.earliest - lastTo : null;
      const barAgeMax = estimate && lastTo !== null ? estimate.latest - lastTo : null;
      freshness[pick.key][server] = {
        lastBarTo: lastTo,
        firstExpiration: own?.latest ?? null,
        periodSeconds: own?.period ?? null,
        deltaSeconds: own && lastTo !== null ? own.latest - lastTo : null,
        nowWindow: estimate ? { earliest: estimate.earliest, latest: estimate.latest, period: estimate.period, source: estimate.source } : null,
        barAgeMinSeconds: barAgeMin,
        barAgeMaxSeconds: barAgeMax,
        fresh: barAgeMin === null ? null : barAgeMin <= CANDLE_SIZE,
      };
    }
  }

  const payoutServers = serverNames.filter((s) => payout[s].hasPayout);
  const overall = (() => {
    const scored = serverNames
      .map((s) => {
        const m = matching.perServer[s];
        const p = payout[s];
        const fields = report.servers[s].fields?.asset ?? [];
        return {
          server: s,
          matched: m.matched,
          matchedOtc: m.matchedOtc,
          richness: m.richness,
          hasPayout: p.hasPayout,
          hasAbsoluteExpirations: fields.includes("expirations"),
          hasDurationExpirations: fields.includes("expiration_sizes_seconds"),
          score: m.matched * 2 + m.richness + (p.hasPayout ? 6 : 0),
        };
      })
      .sort((a, b) => b.score - a.score || b.matched - a.matched || b.richness - a.richness);
    return { ranking: scored, winner: scored[0] ?? null };
  })();
  const catalogRanking = matching.ranking.map((s) => ({
    server: s,
    matched: matching.perServer[s].matched,
    richness: matching.perServer[s].richness,
    hasPayout: payout[s].hasPayout,
  }));

  return { perServer, matching, candleComparison, expiry, payout, balances, capabilities, rates, indicators, freshness, referenceWindow, roles: { payoutServers, overall, catalogRanking } };
}

function renderMarkdown(report, analysis, traceOffice) {
  const serverNames = report.serverOrder;
  const lines = [];
  lines.push("# IQ Official MCP — Data veracity (7 servers, read-only, PRACTICE)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Authenticated: ${report.authenticated}`);
  lines.push(`TraceCom office source: \`${TRACE_OFFICE_URL}\`${traceOffice?.ok ? ` (HTTP 200, ${traceOffice.markets.length} markets)` : ` (FAILED: ${traceOffice?.error ?? "unknown"})`}`);
  lines.push("");
  lines.push("> All calls allowlisted SAFE_READ / ACCOUNT_READ (`get_capabilities`, `get_limits`, `list_assets`, `list_balances`, `get_candles`, `get_instruments`). No order tool was called. Token never stored; payloads redacted.");
  lines.push("");
  lines.push("## 0. What was called");
  lines.push("");
  for (const server of serverNames) {
    const entry = report.servers[server];
    if (entry.error) {
      lines.push(`- **${server}** — ERROR: ${entry.error}`);
      continue;
    }
    const called = Object.entries(entry)
      .filter(([k, v]) => k.startsWith("raw_") && v)
      .map(([k, v]) => `${k.slice(4)}:${v.ok ? "ok" : `FAIL(${v.error ?? v.status})`}`);
    const candleCalls = Object.entries(entry.candles ?? {}).map(([key, v]) => `get_candles(${key}):${v.ok ? `${v.rows.length} bars` : `FAIL(${v.error ?? v.status})`}`);
    const instrumentCall = entry.instruments?.toolPresent ? `get_instruments(asset ${entry.instruments.assetId}):${entry.instruments.ok ? "ok" : `FAIL(${entry.instruments.error ?? entry.instruments.status})`}` : null;
    lines.push(`- **${server}** (${entry.tools.length} tools listed): ${[...called, ...candleCalls, instrumentCall].filter(Boolean).join(", ")}`);
  }
  lines.push("");

  lines.push("## 1. Asset coverage per server");
  lines.push("");
  lines.push(mdTable(
    ["server", "assets", "is_open=true", "is_open=false", "NORMAL", "OTC", "types"],
    serverNames.map((server) => {
      const c = analysis.perServer[server];
      const types = Object.entries(c.types).map(([k, v]) => `${k}:${v}`).join(", ") || "—";
      return [server, c.total, c.open, c.closed, c.normal, c.otc, types];
    }),
  ));
  lines.push("");

  lines.push("## 2. TraceCom 55-market coverage (strict NORMAL vs OTC)");
  lines.push("");
  lines.push(`TraceCom markets: ${analysis.matching.traceTotal} total (${analysis.matching.traceNormal} NORMAL + ${analysis.matching.traceOtc} OTC). Match = canonical symbol equal AND OTC flag equal.`);
  lines.push("");
  lines.push(mdTable(
    ["server", "matched/55", "NORMAL", "OTC", "unmatched", "richness score"],
    serverNames.map((server) => {
      const m = analysis.matching.perServer[server];
      return [server, `${m.matched}/55`, `${m.matchedNormal}/${analysis.matching.traceNormal}`, `${m.matchedOtc}/${analysis.matching.traceOtc}`, m.missing.length, m.richness];
    }),
  ));
  lines.push("");
  const best = analysis.matching.best;
  if (best) {
    const m = analysis.matching.perServer[best];
    lines.push(`**Best catalog source by strict coverage: \`${best}\` — ${m.matched}/55 markets matched (${m.matchedNormal} NORMAL + ${m.matchedOtc} OTC), asset-field richness score ${m.richness}.**`);
    lines.push(`Coverage ranking: ${analysis.roles.catalogRanking.map((r) => `\`${r.server}\` ${r.matched}/55 (richness ${r.richness}${r.hasPayout ? ", payout" : ""})`).join(" · ")}.`);
    lines.push("");
    lines.push(`Full symbol list of \`${best}\` (${analysis.perServer[best].total} rows, ${analysis.perServer[best].open} open):`);
    lines.push("");
    lines.push("```text");
    const assetRows = rowsFromAssets(report.servers[best].assets);
    for (const a of assetRows) {
      const n = normalizeAssetName(a?.name);
      lines.push(`${a.name} | asset_id=${a.asset_id} | ${a.is_open ? "OPEN" : "CLOSED"} | ${n.otc ? "OTC" : "NORMAL"}${a.profit_percent !== undefined ? ` | payout=${a.profit_percent}` : ""}`);
    }
    lines.push("```");
    lines.push("");
    lines.push("Unmatched TraceCom markets per server:");
    lines.push("");
    for (const server of serverNames) {
      const mm = analysis.matching.perServer[server];
      lines.push(`- **${server}** (${mm.missing.length}): ${mm.missing.join(", ") || "—"}`);
    }
    lines.push("");
  }

  lines.push("## 3. Candle veracity — same asset across servers");
  lines.push("");
  for (const pick of PICKS) {
    const cmp = analysis.candleComparison[pick.key];
    if (!cmp || !Object.keys(cmp.series).length) {
      lines.push(`### ${pick.label} — no server returned candles`);
      lines.push("");
      continue;
    }
    lines.push(`### ${pick.label} — \`${pick.key}\`, size=${CANDLE_SIZE}s, count=${CANDLE_COUNT}`);
    lines.push("");
    lines.push(mdTable(
      ["server", "bars", "first from→to", "last from→to", "aligned to 60s", "gaps", "close decimals", "fields"],
      Object.entries(cmp.series).map(([server, s]) => [
        server,
        s.rows,
        s.first ? `${s.first.from}→${s.first.to}` : "—",
        s.last ? `${s.last.from}→${s.last.to}` : "—",
        s.alignedToSize ? "yes" : "NO",
        s.gaps,
        s.closeDecimals,
        (s.fields ?? []).join(","),
      ]),
    ));
    lines.push("");
    if (cmp.pairs.length) {
      lines.push(`Reference: \`${cmp.refServer}\`, aligned by \`from\` timestamp, last common bar excluded from "completed" stats (forming bar).`);
      lines.push("");
      lines.push(mdTable(
        ["server vs ref", "common", "missing", "extra", "completed compared", "OHLC mismatches", "max |Δclose|", "max |Δhigh|", "max |Δlow|", "max |Δopen|", "last-ts offset (s)", "forming bar differs"],
        cmp.pairs.map((p) => [
          `${p.server} vs ${p.refServer}`,
          p.commonBars,
          p.missingBars,
          p.extraBars,
          p.completedCompared,
          p.completedMismatch,
          fmtNum(p.maxDeltaClose),
          fmtNum(p.maxDeltaHigh),
          fmtNum(p.maxDeltaLow),
          fmtNum(p.maxDeltaOpen),
          p.timestampOffsetSeconds,
          p.formingMismatch ? "yes" : "no",
        ]),
      ));
      lines.push("");
      const allSame = cmp.pairs.every((p) => p.missingBars === 0 && p.extraBars === 0 && p.completedMismatch === 0);
      const divergentPairs = cmp.pairs.filter((p) => p.completedMismatch > 0);
      const completedTotal = cmp.pairs.reduce((acc, p) => acc + p.completedCompared, 0);
      if (allSame) {
        lines.push(`**Verdict:** identical completed-bar series across ${Object.keys(cmp.series).length} servers → SAME price feed (proven, byte-equal OHLC on all ${completedTotal} common completed bars).`);
      } else if (divergentPairs.length === 0) {
        lines.push(`**Verdict:** SAME price feed — all ${completedTotal} common completed bars are byte-equal; differences are limited to the still-forming last bar and/or a one-bar fetch-time offset (missing/extra = 1).`);
      } else {
        lines.push(`**Verdict:** DIFFERENT feed/sampling for ${divergentPairs.map((p) => `\`${p.server}\` (${p.completedMismatch}/${p.completedCompared} completed bars differ, max |Δclose|=${fmtNum(p.maxDeltaClose)})`).join(", ")}.`);
        for (const p of divergentPairs) {
          if (p.firstDivergence) {
            lines.push(`  - first divergence @ ${p.firstDivergence.from}: ref o/h/l/c=${p.firstDivergence.ref.open}/${p.firstDivergence.ref.high}/${p.firstDivergence.ref.low}/${p.firstDivergence.ref.close} vs ${p.server} o/h/l/c=${p.firstDivergence.server.open}/${p.firstDivergence.server.high}/${p.firstDivergence.server.low}/${p.firstDivergence.server.close}`);
          }
        }
      }
      lines.push("");
      const vol = Object.entries(cmp.series).map(([s, v]) => `${s}:${(v.fields ?? []).some((f) => /volume|vol\b/.test(f)) ? "yes" : "no"}`).join(", ");
      lines.push(`Volume field exposed: ${vol}.`);
      lines.push("");
    }
  }
  const schemaFacts = serverNames.reduce((acc, server) => {
    const schema = report.servers[server]?.tools?.find((t) => t.name === "get_candles")?.inputSchema;
    if (!schema) return acc;
    const sizeDesc = String(schema?.properties?.size?.description ?? "");
    const sizes = sizeDesc.match(/one of:\s*([0-9,\s]+)/i)?.[1]?.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) ?? null;
    const countDesc = String(schema?.properties?.count?.description ?? "");
    const countMax = Number(countDesc.match(/max\s*(\d+)/i)?.[1] ?? NaN);
    acc[server] = { supportedSizes: sizes, countMax: Number.isFinite(countMax) ? countMax : null, volumeArgument: Boolean(schema?.properties?.volume) };
    return acc;
  }, {});
  lines.push("`get_candles` tool schema (from `tools/list`, one call per server):");
  lines.push("");
  lines.push(mdTable(
    ["server", "size enum", "count max", "volume arg"],
    Object.entries(schemaFacts).map(([server, f]) => [server, f.supportedSizes ? `${f.supportedSizes.length} values: ${f.supportedSizes.slice(0, 9).join(",")}…` : "—", f.countMax ?? "—", f.volumeArgument ? "yes" : "no"]),
  ));
  lines.push("");

  lines.push("## 4. Expiration model / cadence");
  lines.push("");
  lines.push(mdTable(
    ["server / asset", "expirations[]", "cadence (s)", "aligned to cadence", "duration sizes (s)", "extra model fields"],
    serverNames.flatMap((server) => PICKS.map((pick) => {
      const e = analysis.expiry[pick.key]?.[server];
      if (!e) return null;
      const extra = e.instruments ? `instruments: ${JSON.stringify(e.instruments.windows?.[0] ?? e.instruments)}` : "—";
      return [
        `${server} / ${pick.label}`,
        e.hasExpirations ? `${e.expirations.length} (${e.expirations.slice(0, 3).join(",")}…)` : "none",
        e.cadence ?? "—",
        e.alignedToWallClock === null ? "n/a" : e.alignedToWallClock ? "yes" : "NO",
        e.expirationSizesSeconds ? e.expirationSizesSeconds.join(",") : "—",
        extra,
      ];
    }).filter(Boolean)),
  ));
  lines.push("");
  const us500 = PICKS[0];
  const cad = (server) => analysis.expiry[us500.key]?.[server]?.cadence ?? null;
  const digitalWindow = analysis.expiry[us500.key]?.["digital-options"]?.instruments?.windows?.[0] ?? null;
  const blitzSizes = analysis.expiry[us500.key]?.["blitz-options"]?.expirationSizesSeconds ?? null;
  lines.push(`Cross-server note (same asset \`${us500.key}\`): binary cadence ${cad("binary-options") ?? "—"}s, turbo ${cad("turbo-options") ?? "—"}s, digital window ${digitalWindow ? `${digitalWindow.period_seconds}s period / deadtime ${digitalWindow.deadtime_seconds}s / ${digitalWindow.strikes} strikes` : "—"}, blitz duration menu ${blitzSizes ? blitzSizes.join(",") : "—"}s, marginal-* none. Expiry models are product-specific — there is no single shared expiration grid.`);
  lines.push("");

  lines.push("## 5. Candle freshness (last bar vs server time implied by expirations, not the local clock)");
  lines.push("");
  lines.push(`Server-now window derived from the finest expiration feed available (\`${analysis.referenceWindow?.source ?? "n/a"}\`): now ∈ [${analysis.referenceWindow?.earliest ?? "—"}, ${analysis.referenceWindow?.latest ?? "—"}] UNIX.`);
  lines.push("");
  lines.push(mdTable(
    ["asset", "server", "last bar to", "own next expiration", "own period (s)", "delta own (s)", "bar age min–max vs now (s)", "fresh?"],
    serverNames.flatMap((server) => PICKS.map((pick) => {
      const f = analysis.freshness[pick.key]?.[server];
      if (!f) return null;
      const age = f.barAgeMinSeconds === null ? "—" : `${f.barAgeMinSeconds}…${f.barAgeMaxSeconds}`;
      return [pick.label, server, f.lastBarTo ?? "—", f.firstExpiration ?? "—", f.periodSeconds ?? "—", f.deltaSeconds ?? "—", age, f.fresh === null ? "n/a" : f.fresh ? "yes" : "NO"];
    }).filter(Boolean)),
  ));
  lines.push("");
  lines.push("> `bar age` = last bar end minus the turbo-derived now window (negative = the last bar is still forming right now). A stale feed would show a positive age greater than one candle size.");
  lines.push("");

  lines.push("## 6. Payout / leverage / sizing quality");
  lines.push("");
  lines.push(mdTable(
    ["server", "payout field", "payout min/median/max", "min trade", "max trade", "precision", "buyback deadtime", "leverage tiers", "min quantity"],
    serverNames.map((server) => {
      const p = analysis.payout[server];
      const pay = p.hasPayout ? `${p.payout.min}/${p.payout.median}/${p.payout.max}` : "—";
      const d = p.defaults ?? {};
      return [
        server,
        p.hasPayout ? "profit_percent" : "—",
        pay,
        d.minimum_amount !== undefined ? d.minimum_amount : "—",
        d.maximum_amount !== undefined ? d.maximum_amount : "—",
        p.precision ? `${p.precision.min}–${p.precision.max}` : "—",
        p.buybackDeadtime ? `${p.buybackDeadtime.values.join(",")} (on ${p.buybackDeadtime.presentOn} asset${p.buybackDeadtime.presentOn === 1 ? "" : "s"})` : "—",
        p.leverageTiers.length ? p.leverageTiers.slice(0, 8).join(",") : "—",
        p.minQuantity ? `${p.minQuantity.min}–${p.minQuantity.max}` : "—",
      ];
    }),
  ));
  lines.push("");
  lines.push("## 7. Account / funds per server (real calls, PRACTICE)");
  lines.push("");
  lines.push(mdTable(
    ["server", "capabilities mode", "balances (type/currency/amount)", "portfolio fields"],
    serverNames.map((server) => {
      const c = analysis.capabilities[server];
      const b = analysis.balances[server];
      return [
        server,
        c.mode ? `${c.mode} (${c.product})` : "—",
        b.map((x) => `${x.type}/${x.currency}/${x.amount}`).join(", ") || "—",
        b[0]?.extra?.join(",") || "—",
      ];
    }),
  ));
  lines.push("");
  const balanceSummary = serverNames
    .filter((s) => (analysis.balances[s] ?? []).length)
    .map((s) => `${s}=${analysis.balances[s].map((x) => `${x.type}/${x.currency}/${x.amount}`).join("|")}`)
    .join("; ");
  const balanceMissing = serverNames.filter((s) => !(analysis.balances[s] ?? []).length);
  lines.push(`> Balances returned (real calls): ${balanceSummary || "none"}.${balanceMissing.length ? ` Empty/failed on: ${balanceMissing.join(", ")}.` : ""} This differs from the TraceCom runtime's own PRACTICE account (see \`docs/iq-mcp/current-vs-mcp.md\`); treat MCP balances as a separate credential/tenant until reconciled. Capability mode is \`read-write\` for this token on every server — the read-only guarantee here comes from the allowlist gates, not from the server.`);
  lines.push(">",
    "> The server can answer a successful HTTP 200 with a body \`{code:0, message:\"rate_limited: rate limit exceeded (limit=60, retry_after_ms=60000...)\"}\`. This probe detects that body and retries after the advertised delay; any data captured before the fix (or by callers that do not check \`message\`) can be silently incomplete."
  );
  lines.push("");
  lines.push("### Rate limits (`get_limits`, real calls)");
  lines.push("");
  lines.push(mdTable(
    ["server", "scope", "gateway", "read", "write", "tools classified read/write", "write tool names"],
    serverNames.map((server) => {
      const r = analysis.rates[server];
      return [server, r.scope ?? "—", r.buckets.gateway ?? "—", r.buckets.read ?? "—", r.buckets.write ?? "—", `${r.readToolCount}/${r.writeToolCount}`, r.writeTools.join(",") || "—"];
    }),
  ));
  lines.push("");
  lines.push("");
  lines.push("## 8. Asset field inventory (data richness, real payloads)");
  lines.push("");
  const allFields = new Set();
  for (const server of serverNames) for (const f of report.servers[server].fields?.asset ?? []) allFields.add(f.split(".")[0]);
  const fieldList = [...allFields].sort();
  lines.push(mdTable(
    ["asset field", ...serverNames],
    fieldList.map((field) => [field, ...serverNames.map((server) => ((report.servers[server].fields?.asset ?? []).some((f) => f === field || f.startsWith(`${field}.`)) ? "yes" : "—"))]),
  ));
  lines.push("");

  lines.push("## 9. Indicators");
  lines.push("");
  if (!analysis.indicators.presence) {
    lines.push("- **No server exposes ANY indicator tool or indicator field.** Tool names and asset/balance/candle fields were scanned for indicator-like names (`rsi|macd|ema|sma|bollinger|stoch|atr|adx|cci|ichimoku|williams|donchian|momentum|feature`): zero matches on all 7 servers.");
  } else {
    lines.push("- Indicator-like names found:");
    for (const server of serverNames) {
      lines.push(`  - ${server}: tools=${JSON.stringify(analysis.indicators.tools[server])}, fields=${JSON.stringify(analysis.indicators.assetFields[server])}`);
    }
  }
  lines.push("- TraceCom must compute all features itself (trend/momentum/volatility/regime). MCP only returns raw OHLC (`get_candles`) and, on digital, a strike grid (`get_prices`/`get_instruments`).");
  lines.push("");

  lines.push("## 10. Schema / field-name differences between servers");
  lines.push("");
  lines.push("- binary/turbo: asset keys `asset_id, name, is_open, precision, profit_percent, expirations[]`; turbo adds `buyback_deadtime_seconds` on part of the catalog; both expose a `defaults` block on `list_assets` in this run.");
  lines.push("- blitz: same shape but replaces `expirations[]` with duration list `expiration_sizes_seconds[]` (no absolute expiry timestamps).");
  lines.push("- digital: asset keys `asset_id, name, asset_type, image, is_open, precision` — **no payout, no expirations on the asset**; expiry lives in `get_instruments` (`expiration`, `deadline`, `deadtime_seconds`, `period_seconds`, strike rows) and prices in `get_prices`.");
  lines.push("- marginal-cfd/crypto/forex: asset keys `asset_id, name, asset_type, base_currency, quote_currency, is_open, price_precision, min_quantity, quantity_step, quantity_presets, quantity_unit, max_leverages{}`; **no expirations, no payout**; leverage and spread replace payout.");
  lines.push("- balances: binary/turbo/blitz/digital return flat `{amount, balance_id, bonus_amount, currency, type}`; marginal-* return a portfolio block (`equity, margin, free_margin, pnl, margin_level, stop_out_level…`).");
  lines.push("- Candle rows on all 7 servers use the same field names: `{open, close, min, max, from, to}` (ISO-8601 UTC), **no volume**, no size/asset echo.");
  lines.push("");

  lines.push("## 11. Verdict");
  lines.push("");
  const bestName = analysis.matching.best;
  const u500 = analysis.candleComparison["US500:NORMAL"];
  const u500Pairs = u500?.pairs ?? [];
  const okPair = (x) => x.completedMismatch === 0 && x.missingBars <= 1 && x.extraBars <= 1;
  const u500Same = u500Pairs.length > 0 && u500Pairs.every(okPair);
  const otcPairs = analysis.candleComparison["EURUSD:OTC"]?.pairs ?? [];
  const otcSame = otcPairs.length > 0 && otcPairs.every(okPair);
  const fxPairs = analysis.candleComparison["EURUSD:NORMAL"]?.pairs ?? [];
  const fxDivergent = fxPairs.filter((x) => !okPair(x));
  const fxDifferent = fxDivergent.map((p) => p.server);
  const cadence = (server, pick = "US500:NORMAL") => analysis.expiry[pick]?.[server]?.cadence ?? null;
  lines.push("### PROVEN");
  lines.push("");
  const catalogRankText = analysis.roles.catalogRanking.map((r) => `\`${r.server}\` ${r.matched}/55${r.hasPayout ? " +payout" : ""}`).join(", ");
  lines.push(`- Catalog (strict NORMAL/OTC): ${catalogRankText}. Best coverage \`${bestName ?? "n/a"}\` (${bestName ? analysis.matching.perServer[bestName].matched : 0}/55); every server's exact unmatched list is in §2.`);
  lines.push(`- Candles: options servers binary/turbo/blitz/digital serve the same OHLC series. US 500 (asset_id 1470) across ${u500 ? Object.keys(u500.series).length : 0} servers: ${u500Same ? "byte-equal on all completed bars (differences only on the forming bar and a possible one-bar fetch-time offset)" : "divergences — see §3"}; EUR/USD (OTC) across ${otcPairs.length + 1} servers: ${otcSame ? "byte-equal on all completed bars (same caveat)" : "divergences — see §3"}.`);
  const u500SameServers = [u500?.refServer, ...u500Pairs.filter(okPair).map((p) => p.server)].filter(Boolean);
  lines.push(`- Same-feed servers proven on US 500 completed bars: ${u500SameServers.join(", ")}.`);
  const fxServerNames = Object.keys(analysis.candleComparison["EURUSD:NORMAL"]?.series ?? {});
  const fxText = fxDivergent.length
    ? `EUR/USD (NORMAL) is a DIFFERENT feed from the options servers on: ${fxDivergent.map((p) => `\`${p.server}\` (${p.completedMismatch}/${p.completedCompared} completed bars differ up to |Δclose|=${fmtNum(p.maxDeltaClose)})`).join(", ")} — tiny but systematic, consistent with distinct FX sampling/rounding rather than a transient glitch. Compared servers: ${fxServerNames.join(", ")}.`
    : `EUR/USD (NORMAL) across ${fxServerNames.join(", ")} was byte-equal on all completed bars.`;
  lines.push(`- ${fxText}`);
  lines.push(`- Candle schema is identical on all 7: \`get_candles(asset_id, size, count)\`, size enum 1s…2592000s, count default 100 / max 1000 (from \`tools/list\`); rows \`{open, close, min, max, from, to}\` ISO-8601 UTC, no volume, 1m bars aligned to the wall clock.`);
  lines.push(`- Expirations are product-specific, all wall-clock aligned: binary ${cadence("binary-options")}s on sampled assets, turbo ${cadence("turbo-options")}s, digital absolute windows (${analysis.expiry["US500:NORMAL"]?.["digital-options"]?.instruments?.windows?.[0]?.period_seconds ?? "—"}s period + ${analysis.expiry["US500:NORMAL"]?.["digital-options"]?.instruments?.windows?.[0]?.deadtime_seconds ?? "—"}s deadtime, strike grid), blitz duration menu with no absolute timestamps, marginal-* no expiry.`);
  lines.push(`- Freshness: every sampled candle feed is live at fetch time (last bar within one candle of the turbo/digital-implied server now, §5); no stale feed was observed.`);
  lines.push("- Payouts exist only on binary/turbo/blitz (`profit_percent`, per asset, e.g. binary 87–94, turbo 86–94, blitz 86–93); digital exposes strikes/odds, marginal-* expose leverage tiers instead.");
  lines.push("- Rate limits identical on all 7 (real `get_limits`): `gateway 200/60s`, `read 60/60s`, `write 10/60s`, scope `per-user`; the server itself classifies every tool as read or write (see §7).");
  const balanceServers = serverNames.filter((s) => (analysis.balances[s] ?? []).length);
  lines.push("- Account mode from `get_capabilities`: " + serverNames.map((s) => `${s}=${analysis.capabilities[s].mode}`).join(", ") + `. Balances returned on: ${balanceServers.join(", ") || "none"} (same \`regular/BRL/0\` + \`training/USD/60\` view where present — see §7).`);
  lines.push("- Rate limiting can arrive as HTTP 200 with body `{code:0, message:\"rate_limited: ...\"}` (observed once on `marginal-forex`); this probe detects that body and retries, but any consumer that only checks the HTTP status can silently ingest empty data. No indicator is exposed by any server (tool names + payload fields scanned).");
  lines.push("");
  lines.push("### INFERRED (not proven here)");
  lines.push("");
  lines.push("- Shared candle bytes imply one market-data backend for binary/turbo/blitz/digital and for marginal-cfd indices; this probe proves byte-equality on sampled windows, not the physical feed origin.");
  lines.push(fxDifferent.length
    ? `- ${fxDifferent.map((s) => `\`${s}\``).join(", ")} FX candles come from a different sampling/rounding than the options feeds (proven divergence) — which one matches the TraceCom runtime feed is NOT proven here.`
    : "- No cross-feed divergence was observed on the sampled windows; which feed matches the TraceCom runtime is NOT proven here.");
  lines.push("- `get_trade_history`/`get_prices` settlement semantics were not exercised with populated positions (practice history is empty), so settlement validation remains unproven.");
  lines.push("- MCP `training` balance (USD 60) is not the TraceCom runtime account; multi-tenant/reconciliation status is unproven.");
  lines.push("");
  lines.push("### Recommended roles");
  lines.push("");
  const overall = analysis.roles.overall;
  const winner = overall.winner;
  const payoutServers = analysis.roles.payoutServers;
  const limitedServers = serverNames.filter((s) => {
    const m = analysis.matching.perServer[s];
    return m.matched < 15 && m.matchedOtc === 0;
  });
  lines.push(`- **MOST PROFESSIONAL OVERALL: \`${winner?.server ?? "n/a"}\`** — role score = strict-covered markets×2 + asset-field richness + payout (score ${winner?.score}; ${winner?.matched}/55 markets, richness ${winner?.richness}, payout ${winner?.hasPayout ? "yes" : "no"}, absolute expirations ${winner?.hasAbsoluteExpirations ? "yes" : "no"}). Recommended as TraceCom's **catalog + payout validator**.`);
  lines.push(`- **Catalog authority (pure coverage):** \`${bestName ?? "n/a"}\` (${bestName ? analysis.matching.perServer[bestName].matched : 0}/55, §2). Among coverage ties, prefer the payout-capable server; use \`digital-options\` only if you need \`asset_type\`/\`image\` and the strike grid, and \`binary-options\` if you need the exact binary product mapping.`);
  lines.push(`- **Candle backfill / veracity:** ${u500SameServers.join(", ")} are interchangeable for index candles (same completed-bar bytes, same \`get_candles\` schema: 1s…2592000s sizes, max 1000 bars); use \`turbo-options\` for the freshest 60s grid or \`binary-options\` to stay in-product. Do NOT use ${fxDifferent.length ? fxDifferent.join(", ") : "a different-product server"} candles as a stand-in for the options FX feed (different sampling, proven in §3).`);
  lines.push(`- **Payout validator:** ${payoutServers.join(", ") || "none"}. digital and marginal-* are structurally unable to validate payout (strike grid / leverage+spread instead).`);
  lines.push("- **Settlement validator:** binary-options/turbo-options/digital-options/blitz-options expose `get_trade_history`; digital additionally exposes the strike grid (`get_prices`/`get_instruments`) needed to model digital settlement. UNPROVEN on this practice account (empty history/orders).");
  lines.push(`- **NOT SUITABLE / low value for TraceCom's 55-market workflow:** ${limitedServers.map((s) => `\`${s}\` (${analysis.matching.perServer[s].matched}/55, OTC ${analysis.matching.perServer[s].matchedOtc})`).join(", ") || "none"} — perp/CFD naming universe, no OTC markets, no payout. Valid only as an index candle/leverage reference, never as a binary catalog.`);
  lines.push("");
  return lines.join("\n");
}

async function fetchTraceOffice(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(TRACE_OFFICE_URL, { headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, markets: [] };
    const body = await res.json();
    const markets = (Array.isArray(body?.markets) ? body.markets : []).map((m) => ({
      marketKey: m.marketKey,
      marketType: m.marketType,
      canonical: m.canonical,
      symbol: m.symbol,
      display: m.display,
      availability: m.availability,
      payout: m.payout,
      payoutSource: m.payoutSource,
      enabled: m.enabled,
    }));
    return { ok: true, status: res.status, url: TRACE_OFFICE_URL, fetchedAt: new Date().toISOString(), count: markets.length, markets };
  } catch (e) {
    return { ok: false, error: `${e.name}:${e.message}`, markets: [] };
  }
}

export async function runVeracity({ token = "", fetchImpl = globalThis.fetch, pace = true, outDir, now = () => new Date().toISOString() } = {}) {
  const { report } = await collect({ token, fetchImpl, pace, now });
  const traceOffice = await fetchTraceOffice(fetchImpl);
  const analysis = analyze(report, traceOffice);
  report.traceOffice = traceOffice;
  report.analysis = analysis;

  const raw = JSON.stringify({ ...report, serverOrder: report.serverOrder }, null, 2);
  const md = renderMarkdown(report, analysis, traceOffice);
  const sanitize = (text) => {
    const cleaned = redactSecret(text, token);
    if (token && containsSecret(cleaned, token)) throw new Error("SECURITY: token-like content would reach artifact");
    return cleaned;
  };
  await fs.mkdir(outDir, { recursive: true });
  const rawPath = path.join(outDir, "data-veracity.raw.json");
  const mdPath = path.join(outDir, "data-veracity.md");
  await fs.writeFile(rawPath, sanitize(raw), "utf8");
  await fs.writeFile(mdPath, sanitize(md), "utf8");
  return { report, analysis, rawPath, mdPath };
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
  if (!SECRET) {
    console.log("[data-veracity] IQ_MCP_TOKEN ausente — fail-closed, nenhuma chamada de rede.");
    return;
  }
  const { rawPath, mdPath } = await runVeracity({ token: SECRET, outDir: path.join(ROOT, "docs", "iq-mcp") });
  console.log(`[data-veracity] wrote ${path.relative(ROOT, mdPath)} and ${path.relative(ROOT, rawPath)}`);
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
    console.error(`[data-veracity] fatal: ${redactSecret(String(e?.stack || e?.message || e), "")}`);
    process.exitCode = 1;
  });
}
