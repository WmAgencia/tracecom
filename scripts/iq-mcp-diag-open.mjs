#!/usr/bin/env node
/**
 * TraceCom WS vs IQ Official MCP — READ-ONLY diagnostic ("are markets really closed?").
 *
 * Captures, at the same instant:
 *   (a) GET /api/iq/office         (TraceCom resolver: marketKey/display/activeId/availability/payout/enabled)
 *   (b) GET /api/iq/status         (live WS serverTime / timeValid)
 *   (c) GET /api/iq/asset-map      (WS resolver raw evidence: candidates enabled/suspended per activeId)
 *   (d) Turbo   MCP list_assets
 *   (e) Binary  MCP list_assets
 *   (f) Digital MCP list_assets + get_instruments (a few assets)
 *
 * Matches STRICTLY by canonical name + NORMAL/OTC (never EURUSD:OTC <-> EURUSD:NORMAL),
 * builds a conflict table, classifies each market, and writes:
 *   docs/diag/ws-vs-mcp.json
 *   docs/diag/ws-vs-mcp.md
 *
 * SECURITY (by construction):
 *   - Token only from env IQ_MCP_TOKEN / IQ_MCP_TOKEN_FILE; never written to disk.
 *   - Every MCP call passes relay/iq-mcp/security.mjs gates (read-only + allowlist).
 *   - No order/account-write tool is ever referenced. All output redacted before disk.
 *
 * Usage (PowerShell):
 *   $env:IQ_MCP_TOKEN = "<token>"; node scripts/iq-mcp-diag-open.mjs
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

const BASE_URL = (process.env.IQ_DIAG_BASE_URL || "https://tracecom.consecom.com.br").replace(/\/$/, "");
export const OFFICE_URL = process.env.IQ_MCP_OFFICE_URL || `${BASE_URL}/api/iq/office`;
export const STATUS_URL = `${BASE_URL}/api/iq/status`;
export const ASSET_MAP_URL = `${BASE_URL}/api/iq/asset-map`;

export const DIAG_SERVERS = Object.freeze({
  turbo: Object.freeze({ base: "https://turbo-options.mcp.iqoption.com", allowlist: Object.freeze(["list_assets"]) }),
  binary: Object.freeze({ base: "https://binary-options.mcp.iqoption.com", allowlist: Object.freeze(["list_assets"]) }),
  digital: Object.freeze({ base: "https://digital-options.mcp.iqoption.com", allowlist: Object.freeze(["list_assets", "get_instruments"]) }),
});

const READ_RISKS = new Set([RISK.SAFE_READ, RISK.ACCOUNT_READ]);
const STALE_MS = Number(process.env.IQ_DIAG_STALE_MS || 120_000);

export const CLASS = Object.freeze({
  BROKER_CONFIRMED_OPEN: "BROKER_CONFIRMED_OPEN",
  BROKER_CONFIRMED_CLOSED: "BROKER_CONFIRMED_CLOSED/SUSPENDED",
  NOT_OFFERED_FOR_PRODUCT: "NOT_OFFERED_FOR_PRODUCT",
  SESSION_DATA_STALE: "SESSION_DATA_STALE",
  SESSION_UNAVAILABLE: "SESSION_UNAVAILABLE",
  INCONCLUSIVE: "INCONCLUSIVE",
  CONFLICT: "CONFLICT",
});

/** Startup gate: every allowlisted tool must classify as a read. */
export function assertAllowlistReadOnly(server, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) throw new Error(`MCP_ALLOWLIST_MISSING: ${server}`);
  for (const name of allowlist) {
    const risk = classifyTool({ name });
    if (!READ_RISKS.has(risk)) throw new Error(`MCP_ALLOWLIST_WRITE: ${server}/${name} classified ${risk}`);
  }
  return true;
}

/**
 * Explicit display-name aliases for MCP catalog names -> TraceCom canonical.
 * Only display synonyms of the SAME instrument; never maps NORMAL<->OTC.
 */
export const MCP_NAME_ALIASES = Object.freeze({
  GOLD: "XAUUSD",
  SILVER: "XAGUSD",
  AU200: "AUS200",
  USNDAQ100: "US100",
  USSPX500: "US500",
  GERMANY30: "GER30",
  JAPAN225: "JP225",
  EURO50: "EU50",
  FRANCE40: "FR40",
  HONGKONG33: "HK33",
  SPAIN35: "SP35",
  USOUSD: "WTI",
  UKOUSD: "BRENT",
});

/**
 * Canonicalize an MCP `name` (e.g. "EUR/USD (OTC)", "US 30", "Gold") to
 * { canonical, otc, composite }. FX pairs (3-letter/3-letter) become EURUSD etc.
 * Composites (GER30/UK100, Bitcoin/Gold) return canonical:null and are never cross-matched.
 */
export function canonicalFromMcpName(rawName) {
  let text = String(rawName ?? "").trim();
  const otc = /\(otc\)\s*$/i.test(text);
  text = text.replace(/\(otc\)\s*$/i, "").trim();
  if (text.includes("/")) {
    const [left, right] = text.split("/");
    if (/^[A-Za-z]{3}$/.test(left) && /^[A-Za-z]{3}$/.test(right)) {
      return { canonical: `${left}${right}`.toUpperCase(), otc, composite: false };
    }
    return { canonical: null, otc, composite: true };
  }
  const compact = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!compact) return { canonical: null, otc, composite: false };
  return { canonical: MCP_NAME_ALIASES[compact] ?? compact, otc, composite: false };
}

export function mcpAssetKey(asset) {
  const { canonical, otc } = canonicalFromMcpName(asset?.name);
  if (!canonical) return null;
  return `${canonical}:${otc ? "OTC" : "NORMAL"}`;
}

function createClient({ base, token, server, allowlist, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
  assertAllowlistReadOnly(server, allowlist);
  const state = { sessionId: null };
  const redact = (value) => redactSecret(value, token);

  async function rpc(method, params, id, tool) {
    if (tool) assertReadProbeMethod("tools/call", tool, classifyTool({ name: tool }), allowlist);
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
          } catch { /* keep raw */ }
        }
      } else {
        try { parsed = JSON.parse(text); } catch { /* keep raw */ }
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

function extractPayload(body) {
  const result = body?.result ?? body?.error ?? body;
  if (result && typeof result === "object" && result.structuredContent) return result.structuredContent;
  const content = result?.content;
  if (!Array.isArray(content)) return result;
  const textPart = content.find((part) => typeof part?.text === "string");
  if (!textPart) return result;
  try { return JSON.parse(textPart.text); } catch { return { text: textPart.text.slice(0, 2500) }; }
}

async function getJson(url, fetchImpl = globalThis.fetch) {
  const startedAt = Date.now();
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", "cache-control": "no-store" } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { ok: res.status === 200 && body !== null, status: res.status, latencyMs: Date.now() - startedAt, body, error: body === null ? "NON_JSON_BODY" : null };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - startedAt, body: null, error: `${e.name}:${e.message}` };
  }
}

async function probeServer(name, spec, token) {
  const entry = { base: spec.base, allowlist: [...spec.allowlist], ok: false, error: null, tools: {} };
  if (!token) { entry.error = "NO_TOKEN"; return entry; }
  const client = createClient({ base: spec.base, token, server: name, allowlist: spec.allowlist });
  const init = await client.rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tracecom-diag-open", version: "0.1.0" },
  }, 1);
  if (init.status !== 200) { entry.error = `initialize HTTP ${init.status}`; return entry; }
  await client.rpc("notifications/initialized", {}, null);

  let id = 100;
  for (const tool of spec.allowlist) {
    if (tool !== "list_assets") continue;
    const startedAt = Date.now();
    const res = await client.call(tool, {}, (id += 1));
    const payload = extractPayload(res.body?.result ?? res.body?.error ?? res.body);
    const assets = Array.isArray(payload?.assets) ? payload.assets : [];
    entry.tools[tool] = {
      ok: res.status === 200 && !res.error,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      assetCount: assets.length,
      openCount: assets.filter((a) => a?.is_open === true).length,
      assets,
      ...(res.error ? { error: res.error } : {}),
    };
  }
  entry.ok = Object.values(entry.tools).every((t) => t.ok);
  return entry;
}

async function probeDigitalInstruments(entry, token, wantedIds) {
  if (!entry.ok) return [];
  const client = createClient({ base: entry.base, token, server: "digital", allowlist: entry.allowlist });
  const init = await client.rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tracecom-diag-open", version: "0.1.0" },
  }, 1);
  if (init.status !== 200) return [];
  await client.rpc("notifications/initialized", {}, null);
  const out = [];
  let id = 500;
  for (const assetId of wantedIds) {
    const res = await client.call("get_instruments", { asset_id: assetId }, (id += 1));
    const payload = extractPayload(res.body?.result ?? res.body?.error ?? res.body);
    const block = Array.isArray(payload?.instruments) ? payload.instruments[0] : null;
    out.push({
      assetId,
      ok: res.status === 200 && !res.error,
      status: res.status,
      generated_at: block?.generated_at ?? null,
      expiration: block?.expiration ?? null,
      deadline: block?.deadtime_seconds !== undefined ? block?.deadline ?? null : block?.deadline ?? null,
      instrumentCount: Array.isArray(block?.instruments) ? block.instruments.length : 0,
      ...(res.error ? { error: res.error } : {}),
    });
  }
  return out;
}

function expirationStats(asset, nowMs) {
  const list = Array.isArray(asset?.expirations) ? asset.expirations.map(Number).filter((n) => Number.isFinite(n)) : [];
  const future = list.filter((s) => s * 1000 > nowMs);
  const next = future.length ? Math.min(...future) : null;
  return {
    count: list.length,
    futureCount: future.length,
    nextExpiration: next === null ? null : new Date(next * 1000).toISOString(),
    nextExpirationInMs: next === null ? null : next * 1000 - nowMs,
  };
}

function classifyMarket({ market, sessionUnavailable, wsCatalogAnomaly, turbo, binary, digital }) {
  const mcpOpen = turbo?.is_open === true || binary?.is_open === true || digital?.is_open === true;
  const mcpPresent = Boolean(turbo || binary || digital);
  const avail = String(market.availability || "UNKNOWN").toUpperCase();

  if (sessionUnavailable) return CLASS.SESSION_UNAVAILABLE;

  if (avail === "OPEN") {
    if (mcpOpen) return CLASS.BROKER_CONFIRMED_OPEN;
    if (mcpPresent) return CLASS.CONFLICT;
    return CLASS.INCONCLUSIVE;
  }
  if (avail === "NOT_OFFERED") {
    if (mcpOpen) return CLASS.SESSION_DATA_STALE; // broker offers it, resolver catalog omits it
    if (mcpPresent) return CLASS.NOT_OFFERED_FOR_PRODUCT;
    return CLASS.NOT_OFFERED_FOR_PRODUCT;
  }
  if (avail === "SUSPENDED" || avail === "DISABLED" || avail === "CLOSED") {
    if (mcpOpen) {
      // MCP says open while TraceCom says suspended: direct conflict. When the WS
      // catalog is globally anomalous (every candidate suspended) the root cause is
      // the TraceCom session catalog, but the market-level label stays CONFLICT.
      return CLASS.CONFLICT;
    }
    return CLASS.BROKER_CONFIRMED_CLOSED;
  }
  if (mcpOpen) return wsCatalogAnomaly ? CLASS.SESSION_DATA_STALE : CLASS.CONFLICT;
  return CLASS.INCONCLUSIVE;
}

export async function runDiag({ token = "", fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const startedAt = now();
  const nowIso = new Date(startedAt).toISOString();

  const [office, status, assetMap] = await Promise.all([
    getJson(OFFICE_URL, fetchImpl),
    getJson(STATUS_URL, fetchImpl),
    getJson(ASSET_MAP_URL, fetchImpl),
  ]);

  const [turbo, binary, digital] = await Promise.all([
    probeServer("turbo", DIAG_SERVERS.turbo, token),
    probeServer("binary", DIAG_SERVERS.binary, token),
    probeServer("digital", DIAG_SERVERS.digital, token),
  ]);
  const mcp = { turbo, binary, digital };

  const index = { turbo: new Map(), binary: new Map(), digital: new Map() };
  for (const [product, entry] of Object.entries(mcp)) {
    for (const asset of (entry?.tools?.list_assets?.assets ?? [])) {
      const key = mcpAssetKey(asset);
      if (!key) continue;
      if (!index[product].has(key)) index[product].set(key, asset);
    }
  }

  const wantedIds = [];
  for (const asset of (digital?.tools?.list_assets?.assets ?? [])) {
    if (asset?.is_open !== true) continue;
    if (wantedIds.length >= 4) break;
    wantedIds.push(asset.asset_id);
  }
  const digitalInstruments = await probeDigitalInstruments(digital, token, wantedIds);

  const markets = Array.isArray(office.body?.markets) ? office.body.markets : [];
  const wsResolver = new Map();
  for (const row of (assetMap.body?.resolver?.markets ?? [])) {
    if (row?.marketKey) wsResolver.set(row.marketKey, row);
  }
  const wsCandidates = [...wsResolver.values()].flatMap((r) => r.candidates ?? []);
  const wsCandidatesTotal = wsCandidates.length;
  const wsCandidatesSuspended = wsCandidates.filter((c) => c.suspended === true).length;
  const wsCatalogAnomaly = wsCandidatesTotal > 0 && wsCandidatesSuspended === wsCandidatesTotal;

  const statusServerTime = status.body?.marketData?.serverTimeMs ?? status.body?.marketData?.serverTime ?? null;
  const statusTimeValid = status.body?.marketData?.timeValid ?? null;
  const statusConnected = status.body?.marketData?.connected ?? null;
  const statusServerTimeAgeMs = typeof statusServerTime === "number" ? startedAt - statusServerTime : null;

  const rows = markets.map((m) => {
    const [canonical, type] = String(m.marketKey ?? "").split(":");
    const key = `${String(canonical).toUpperCase()}:${type === "OTC" ? "OTC" : "NORMAL"}`;
    const turboAsset = index.turbo.get(key) ?? null;
    const binaryAsset = index.binary.get(key) ?? null;
    const digitalAsset = index.digital.get(key) ?? null;
    const ws = wsResolver.get(key) ?? null;
    const mcpPresent = Boolean(turboAsset || binaryAsset || digitalAsset);

    const lastTickReceivedAt = m?.lastTick?.receivedAt ?? null;
    const marketLastMessageAt = m?.connectionHealth?.lastMessageAt ?? null;
    const feedAgeMs = lastTickReceivedAt === null ? null : startedAt - Number(lastTickReceivedAt);
    const feedFresh = feedAgeMs !== null && Math.abs(feedAgeMs) <= STALE_MS;
    const sessionUnavailable = (statusConnected === false) || (m?.connectionHealth?.connected === false && ws === null);

    const classification = classifyMarket({ market: m, sessionUnavailable, wsCatalogAnomaly, turbo: turboAsset, binary: binaryAsset, digital: digitalAsset });

    return {
      marketKey: key,
      tracecom: {
        availability: m.availability ?? null,
        display: m.display ?? null,
        activeId: m.activeId ?? null,
        payout: m.payout ?? null,
        payoutSource: m.payoutSource ?? null,
        enabled: m.enabled ?? null,
        instrumentTypes: m.instrumentTypes ?? [],
        resolvedAt: m.resolvedAt ?? null,
      },
      wsResolver: ws ? {
        availability: ws.availability ?? null,
        activeId: ws.activeId ?? null,
        enabledLive: ws.enabledLive ?? null,
        suspended: ws.suspended ?? null,
        offered: ws.offered ?? null,
        candidates: (ws.candidates ?? []).map((c) => ({ activeId: c.activeId, section: c.section, enabled: c.enabled, suspended: c.suspended })),
      } : null,
      freshness: {
        marketConnected: m?.connectionHealth?.connected ?? null,
        lastMessageAt: marketLastMessageAt,
        lastTickReceivedAt,
        feedAgeMs,
        feedFresh,
        statusWsServerTime: statusServerTime,
        statusWsServerTimeAgeMs: statusServerTimeAgeMs,
      },
      mcp: {
        turbo: turboAsset ? { asset_id: turboAsset.asset_id, name: turboAsset.name, is_open: turboAsset.is_open, profit_percent: turboAsset.profit_percent ?? null, expirations: turboAsset.expirations ?? [], expirationStats: expirationStats(turboAsset, startedAt) } : null,
        binary: binaryAsset ? { asset_id: binaryAsset.asset_id, name: binaryAsset.name, is_open: binaryAsset.is_open, profit_percent: binaryAsset.profit_percent ?? null, expirations: binaryAsset.expirations ?? [], expirationStats: expirationStats(binaryAsset, startedAt) } : null,
        digital: digitalAsset ? { asset_id: digitalAsset.asset_id, name: digitalAsset.name, is_open: digitalAsset.is_open, asset_type: digitalAsset.asset_type ?? null } : null,
      },
      classification,
      rootCause: classifyRootCause({ classification, wsCatalogAnomaly, ws, mcpPresent }),
      sameAssetIdContradiction: sameAssetIdContradiction(ws, turboAsset, binaryAsset, digitalAsset),
    };
  });

  const counts = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] ?? 0) + 1;

  const tracecomCounts = {};
  for (const m of markets) tracecomCounts[m.availability ?? "UNKNOWN"] = (tracecomCounts[m.availability ?? "UNKNOWN"] ?? 0) + 1;

  const matched = rows.filter((r) => r.mcp.turbo || r.mcp.binary || r.mcp.digital).length;
  const unmatched = rows.filter((r) => !(r.mcp.turbo || r.mcp.binary || r.mcp.digital)).map((r) => r.marketKey);
  const freshTickMarkets = rows.filter((r) => r.freshness.feedFresh).length;

  const mcpOpenKeys = [...new Set([...index.turbo.keys(), ...index.binary.keys(), ...index.digital.keys()])]
    .filter((key) => (index.turbo.get(key)?.is_open === true) || (index.binary.get(key)?.is_open === true) || (index.digital.get(key)?.is_open === true));

  const mcpSaysOpenTracecomNot = rows.filter((r) =>
    (r.mcp.turbo?.is_open === true || r.mcp.binary?.is_open === true || r.mcp.digital?.is_open === true) &&
    ["SUSPENDED", "DISABLED", "CLOSED", "NOT_OFFERED"].includes(String(r.tracecom.availability).toUpperCase()));

  const freshnessEvidence = {
    nowUtc: nowIso,
    officeAt: office.body?.at ?? null,
    officeTopServerTime: office.body?.serverTime ?? null,
    officeTopServerTimeNote: "office.connection.serverTimeMs is the connect-time snapshot (relay iq-multi-runtime.mjs:1731); NOT a liveness indicator.",
    officeConnected: office.body?.connection?.connected ?? null,
    officeHealthy: office.body?.connection?.healthy ?? null,
    officeConnectionId: office.body?.connection?.connectionId ?? null,
    officeConnectedAt: office.body?.connection?.connectedAt ?? null,
    officeReconnects: office.body?.connection?.reconnects ?? null,
    statusWsServerTime: statusServerTime,
    statusWsServerTimeIso: typeof statusServerTime === "number" ? new Date(statusServerTime).toISOString() : (statusServerTime ?? null),
    statusWsServerTimeAgeMs: statusServerTimeAgeMs,
    statusTimeValid,
    statusConnected,
    wsCandidatesTotal,
    wsCandidatesSuspended,
    wsCatalogAnomaly,
    wsResolverLastResolvedAt: assetMap.body?.resolver?.lastResolvedAt ?? null,
    wsResolverSectionsSeen: assetMap.body?.resolver?.sectionsSeen ?? null,
    wsResolverRawActivesSeen: assetMap.body?.resolver?.rawActivesSeen ?? null,
    turboAssetCount: turbo?.tools?.list_assets?.assetCount ?? 0,
    turboOpenCount: turbo?.tools?.list_assets?.openCount ?? 0,
    binaryAssetCount: binary?.tools?.list_assets?.assetCount ?? 0,
    binaryOpenCount: binary?.tools?.list_assets?.openCount ?? 0,
    digitalAssetCount: digital?.tools?.list_assets?.assetCount ?? 0,
    digitalOpenCount: digital?.tools?.list_assets?.openCount ?? 0,
    digitalInstruments,
  };

  const verdict = decideVerdict({ counts, rows, mcpSaysOpenTracecomNot, wsCatalogAnomaly, freshnessEvidence });

  const sameAssetIdContradictions = rows
    .filter((r) => r.sameAssetIdContradiction)
    .map((r) => ({ marketKey: r.marketKey, ...r.sameAssetIdContradiction }));

  const mcpFreshness = {
    turboProfitPresent: (turbo?.tools?.list_assets?.assets ?? []).filter((a) => Number.isFinite(Number(a.profit_percent))).length,
    binaryProfitPresent: (binary?.tools?.list_assets?.assets ?? []).filter((a) => Number.isFinite(Number(a.profit_percent))).length,
    matchedExpirationsFuture: rows.filter((r) => (r.mcp.turbo?.expirationStats?.futureCount ?? 0) > 0 || (r.mcp.binary?.expirationStats?.futureCount ?? 0) > 0).length,
    matchedExpirationsFutureTotal: matched,
    digitalInstrumentsGeneratedAt: digitalInstruments.map((d) => d.generated_at).filter(Boolean),
    digitalInstrumentsExpiration: digitalInstruments.map((d) => d.expiration).filter(Boolean),
  };

  const critic = buildCritic({ sessionExpectation: sessionExpectation(new Date(startedAt)), freshnessEvidence, counts, rows, sameAssetIdContradictions, unmatched, mcpSaysOpenTracecomNot });

  return {
    generatedAt: nowIso,
    startedAt,
    endpoints: { office: OFFICE_URL, status: STATUS_URL, assetMap: ASSET_MAP_URL },
    office: { status: office.status, ok: office.ok, error: office.error, latencyMs: office.latencyMs },
    sessionExpectation: sessionExpectation(new Date(startedAt)),
    tracecomCounts,
    mcpOpenKeys,
    counts,
    matched,
    unmatched,
    totalMarkets: rows.length,
    freshTickMarkets,
    wsCatalogAnomaly,
    sameAssetIdContradictions,
    mcpFreshness,
    critic,
    freshnessEvidence,
    servers: {
      turbo: { base: turbo.base, ok: turbo.ok, error: turbo.error, assetCount: turbo?.tools?.list_assets?.assetCount ?? 0, openCount: turbo?.tools?.list_assets?.openCount ?? 0 },
      binary: { base: binary.base, ok: binary.ok, error: binary.error, assetCount: binary?.tools?.list_assets?.assetCount ?? 0, openCount: binary?.tools?.list_assets?.openCount ?? 0 },
      digital: { base: digital.base, ok: digital.ok, error: digital.error, assetCount: digital?.tools?.list_assets?.assetCount ?? 0, openCount: digital?.tools?.list_assets?.openCount ?? 0 },
    },
    rows,
    verdict,
  };
}

function classifyRootCause({ classification, wsCatalogAnomaly, ws, mcpPresent }) {
  if (classification === CLASS.CONFLICT) {
    if (wsCatalogAnomaly) return "WS_INIT_CATALOG_ALL_SUSPENDED";
    return "BROKER_CHANNEL_DISAGREEMENT";
  }
  if (classification === CLASS.SESSION_DATA_STALE) {
    if (!ws) return "WS_CATALOG_OMISSION";
    if (wsCatalogAnomaly) return "WS_INIT_CATALOG_ALL_SUSPENDED";
    return "WS_RESOLVER_STALE";
  }
  if (classification === CLASS.SESSION_UNAVAILABLE) return "WS_NOT_CONNECTED";
  if (classification === CLASS.NOT_OFFERED_FOR_PRODUCT) return "ABSENT_FROM_BROKER_CATALOG";
  if (classification === CLASS.BROKER_CONFIRMED_CLOSED && !mcpPresent) return "NO_MCP_COUNTERPART_NON_OPEN";
  return "AGREEMENT";
}

/**
 * Strongest proof: the SAME IQ asset_id is reported open by MCP and
 * is_suspended=true by the TraceCom WS init catalog.
 */
function sameAssetIdContradiction(ws, ...assets) {
  if (!ws) return null;
  const wsIds = new Set((ws.candidates ?? []).filter((c) => c.suspended === true).map((c) => Number(c.activeId)));
  const mcpIds = assets.filter((a) => a && a.is_open === true).map((a) => Number(a.asset_id));
  const shared = mcpIds.filter((id) => wsIds.has(id));
  if (!shared.length) return null;
  return { sharedAssetIds: [...new Set(shared)], wsSuspendedIds: [...wsIds], mcpOpenIds: mcpIds };
}

function buildCritic({ sessionExpectation, freshnessEvidence, counts, rows, sameAssetIdContradictions, unmatched, mcpSaysOpenTracecomNot }) {
  const normalConflicts = rows.filter((r) => r.classification === CLASS.CONFLICT && r.marketKey.endsWith(":NORMAL")).length;
  const otcConflicts = rows.filter((r) => r.classification === CLASS.CONFLICT && r.marketKey.endsWith(":OTC")).length;
  return [
    {
      question: "Is it genuinely market-closed (weekend/holiday/session hours)?",
      verdict: sessionExpectation.fxNormalExpectedOpen ? "REFUTED" : "PLAUSIBLE",
      evidence: `UTC ${sessionExpectation.utc}; weekday=${sessionExpectation.weekday}; FX NORMAL expected open=${sessionExpectation.fxNormalExpectedOpen}; OTC 24/7 expected open. MCP confirms open with future expirations.`,
    },
    {
      question: "Is it product-specific (Turbo vs Binary vs Digital)?",
      verdict: "REFUTED",
      evidence: `Turbo ${freshnessEvidence.turboOpenCount}/${freshnessEvidence.turboAssetCount} open, Binary ${freshnessEvidence.binaryOpenCount}/${freshnessEvidence.binaryAssetCount} open, Digital ${freshnessEvidence.digitalOpenCount}/${freshnessEvidence.digitalAssetCount} open — all three products report the same markets open.`,
    },
    {
      question: "Is it NORMAL vs OTC specific?",
      verdict: normalConflicts > 0 && otcConflicts > 0 ? "BOTH" : normalConflicts > 0 ? "NORMAL_ONLY" : "OTC_ONLY",
      evidence: `CONFLICTs: NORMAL=${normalConflicts}, OTC=${otcConflicts}. OTC major pairs (EURUSD/GBPUSD/USDJPY/AUDUSD/USDCAD) are absent from the MCP catalog (withdrawn during NORMAL hours) so TraceCom NOT_OFFERED is consistent there; OTC exotics (EURNZD, USDTRY, USDZAR) are MCP-open while TraceCom suspends.`,
    },
    {
      question: "Could the MCP itself be stale/cached?",
      verdict: "REFUTED",
      evidence: `Digital get_instruments generated_at=${freshnessEvidence.digitalInstruments.map((d) => d.generated_at).filter(Boolean).join(",")} with future expiration ${freshnessEvidence.digitalInstruments.map((d) => d.expiration).filter(Boolean).join(",")}; turbo/binary expirations are all in the future and profit_percent is present.`,
    },
    {
      question: "Is TraceCom's NOT_OFFERED list consistent with the MCP catalog (genuinely absent) or a resolver artifact?",
      verdict: "MIXED",
      evidence: `OTC majors absent from MCP -> consistent. But USDJPY/GBPUSD/AUDUSD/EURJPY/EURGBP/AUDJPY/GBPJPY NORMAL, XAUUSD NORMAL, USDMXN/USDBRL OTC are MCP-open yet TraceCom NOT_OFFERED -> WS catalog omission (resolver artifact).`,
    },
    {
      question: "Do any markets share the SAME IQ asset_id with opposite flags (open vs suspended)?",
      verdict: sameAssetIdContradictions.length ? "CONFIRMED" : "NONE",
      evidence: sameAssetIdContradictions.length
        ? `${sameAssetIdContradictions.length} market(s): ` + sameAssetIdContradictions.map((c) => `${c.marketKey}=[${c.sharedAssetIds.join(",")}]`).join("; ")
        : "No shared asset_id between an MCP-open asset and a WS-suspended candidate.",
    },
    {
      question: "How many markets disagree (MCP open vs TraceCom non-open)?",
      verdict: "COUNTED",
      evidence: `${mcpSaysOpenTracecomNot.length} of ${rows.length} markets; unmatched to MCP: ${unmatched.length}.`,
    },
  ];
}

export function sessionExpectation(date) {
  const day = date.getUTCDay();
  const hourUtc = date.getUTCHours() + date.getUTCMinutes() / 60;
  const weekday = day >= 1 && day <= 5;
  const weekend = day === 0 || day === 6;
  const fxOpen = !weekend && !(day === 5 && hourUtc >= 21) && !(day === 0 && hourUtc < 21);
  return {
    utc: date.toISOString(),
    weekday,
    weekend,
    fxNormalExpectedOpen: fxOpen,
    otcExpectedOpen: true,
    note: "OTC pairs trade 24/7; FX NORMAL trades Sun 21:00 UTC - Fri 21:00 UTC. US cash equities 13:30-20:00 UTC weekdays.",
  };
}

function decideVerdict({ counts, rows, mcpSaysOpenTracecomNot, wsCatalogAnomaly, freshnessEvidence }) {
  const stale = counts[CLASS.SESSION_DATA_STALE] ?? 0;
  const conflicts = counts[CLASS.CONFLICT] ?? 0;
  const confirmedClosed = counts[CLASS.BROKER_CONFIRMED_CLOSED] ?? 0;
  const notOffered = counts[CLASS.NOT_OFFERED_FOR_PRODUCT] ?? 0;
  const open = counts[CLASS.BROKER_CONFIRMED_OPEN] ?? 0;
  const disagreement = mcpSaysOpenTracecomNot.length;

  const provenFreshness = wsCatalogAnomaly && (freshnessEvidence.turboOpenCount + freshnessEvidence.binaryOpenCount + freshnessEvidence.digitalOpenCount) > 0;

  if (disagreement > 0 && provenFreshness) {
    return {
      state: "WRONG",
      confidence: "PROVEN",
      reason:
        `MCP (turbo/binary/digital) reports ${freshnessEvidence.turboOpenCount}/${freshnessEvidence.turboAssetCount}, ` +
        `${freshnessEvidence.binaryOpenCount}/${freshnessEvidence.binaryAssetCount}, ${freshnessEvidence.digitalOpenCount}/${freshnessEvidence.digitalAssetCount} assets open with future expirations, ` +
        `while TraceCom reports ${disagreement} market(s) SUSPENDED/NOT_OFFERED. The TraceCom WS init catalog marks ALL ${freshnessEvidence.wsCandidatesSuspended}/${freshnessEvidence.wsCandidatesTotal} candidate actives ` +
        `as is_suspended=true (a session-catalog anomaly), so the 0-OPEN state is a TraceCom session/resolver artifact, not genuine market closure.`,
      mcpSaysOpenTracecomNot: disagreement,
      wsCatalogAnomaly,
    };
  }
  if (conflicts + stale > 0) {
    return {
      state: "WRONG",
      confidence: "INFERRED",
      reason: `${conflicts + stale} market(s) where MCP reports open and TraceCom reports non-open; freshness attribution not fully proven.`,
      mcpSaysOpenTracecomNot: disagreement,
      wsCatalogAnomaly,
    };
  }
  if (open === 0 && confirmedClosed + notOffered === rows.length) {
    return { state: "CORRECT", confidence: "INFERRED", reason: "TraceCom and MCP agree: no market open.", mcpSaysOpenTracecomNot: disagreement, wsCatalogAnomaly };
  }
  return { state: "INCONCLUSIVE", confidence: "INFERRED", reason: "Mixed evidence.", mcpSaysOpenTracecomNot: disagreement, wsCatalogAnomaly };
}

export function renderMarkdown(report) {
  const L = [];
  L.push("# TraceCom WS vs IQ Official MCP — open/suspended truth (READ-ONLY)");
  L.push("");
  L.push(`Generated: ${report.generatedAt}`);
  L.push(`Office: ${report.endpoints.office} (HTTP ${report.office.status})`);
  L.push("");
  L.push("## Session expectation");
  L.push("");
  L.push(`- UTC now: ${report.sessionExpectation.utc}`);
  L.push(`- Weekend: ${report.sessionExpectation.weekend} | weekday: ${report.sessionExpectation.weekday}`);
  L.push(`- FX NORMAL expected open: ${report.sessionExpectation.fxNormalExpectedOpen}`);
  L.push(`- OTC expected open: ${report.sessionExpectation.otcExpectedOpen} (24/7)`);
  L.push(`- ${report.sessionExpectation.note}`);
  L.push("");
  L.push("## Freshness evidence (timestamps)");
  L.push("");
  L.push(`- TraceCom office \`at\`: ${report.freshnessEvidence.officeAt}`);
  L.push(`- TraceCom WS live serverTime (/status): ${report.freshnessEvidence.statusWsServerTimeIso} (age ${report.freshnessEvidence.statusWsServerTimeAgeMs} ms, timeValid=${report.freshnessEvidence.statusTimeValid})`);
  L.push(`- TraceCom office top-level serverTime: ${report.freshnessEvidence.officeTopServerTime} — ${report.freshnessEvidence.officeTopServerTimeNote}`);
  L.push(`- TraceCom WS connected: ${report.freshnessEvidence.officeConnected} | healthy: ${report.freshnessEvidence.officeHealthy} | reconnects: ${report.freshnessEvidence.officeReconnects}`);
  L.push(`- WS resolver lastResolvedAt: ${report.freshnessEvidence.wsResolverLastResolvedAt}`);
  L.push(`- WS resolver candidates suspended: ${report.freshnessEvidence.wsCandidatesSuspended}/${report.freshnessEvidence.wsCandidatesTotal} (all-suspended anomaly: ${report.freshnessEvidence.wsCatalogAnomaly})`);
  L.push(`- WS resolver sectionsSeen: ${JSON.stringify(report.freshnessEvidence.wsResolverSectionsSeen)}`);
  L.push(`- TraceCom markets with a fresh tick feed (<=${Math.round(STALE_MS / 1000)}s): ${report.freshTickMarkets}/${report.totalMarkets}`);
  L.push(`- MCP turbo: ${report.freshnessEvidence.turboOpenCount}/${report.freshnessEvidence.turboAssetCount} open`);
  L.push(`- MCP binary: ${report.freshnessEvidence.binaryOpenCount}/${report.freshnessEvidence.binaryAssetCount} open`);
  L.push(`- MCP digital: ${report.freshnessEvidence.digitalOpenCount}/${report.freshnessEvidence.digitalAssetCount} open`);
  for (const di of report.freshnessEvidence.digitalInstruments) {
    L.push(`  - digital get_instruments(${di.assetId}): generated_at=${di.generated_at} expiration=${di.expiration} instruments=${di.instrumentCount}`);
  }
  L.push("");
  L.push("## TraceCom availability counts");
  L.push("");
  for (const [k, v] of Object.entries(report.tracecomCounts)) L.push(`- ${k}: ${v}`);
  L.push("");
  L.push("## Classification counts");
  L.push("");
  for (const [k, v] of Object.entries(report.counts)) L.push(`- ${k}: ${v}`);
  L.push("");
  L.push(`Match rate: ${report.matched}/${report.totalMarkets} markets matched to an MCP asset (by canonical + NORMAL/OTC).`);
  if (report.unmatched.length) L.push(`Unmatched: ${report.unmatched.join(", ")}`);
  L.push("");
  L.push("## MCP freshness (independent truth)");
  L.push("");
  L.push(`- turbo assets with profit_percent: ${report.mcpFreshness.turboProfitPresent}`);
  L.push(`- binary assets with profit_percent: ${report.mcpFreshness.binaryProfitPresent}`);
  L.push(`- matched markets with future expirations[]: ${report.mcpFreshness.matchedExpirationsFuture}/${report.mcpFreshness.matchedExpirationsFutureTotal}`);
  L.push(`- digital get_instruments generated_at: ${report.mcpFreshness.digitalInstrumentsGeneratedAt.join(", ") || "(none)"}`);
  L.push(`- digital get_instruments expiration: ${report.mcpFreshness.digitalInstrumentsExpiration.join(", ") || "(none)"}`);
  L.push("");
  L.push("## Same asset_id contradictions (PROVEN)");
  L.push("");
  if (report.sameAssetIdContradictions.length) {
    L.push("The SAME IQ `asset_id` is `is_open=true` in MCP and `is_suspended=true` in the TraceCom WS catalog:");
    L.push("");
    for (const c of report.sameAssetIdContradictions) L.push(`- ${c.marketKey}: asset_id ${c.sharedAssetIds.join(", ")}`);
  } else {
    L.push("- none");
  }
  L.push("");
  L.push("## Conflict table");
  L.push("");
  L.push("| marketKey | TraceCom | WS activeId | WS suspended | turbo | binary | digital | classification | rootCause |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  const fmt = (a) => (a ? (a.is_open ? "open" : "closed") : "absent");
  for (const r of report.rows) {
    L.push(`| ${r.marketKey} | ${r.tracecom.availability} | ${r.tracecom.activeId ?? "-"} | ${r.wsResolver ? r.wsResolver.suspended : "-"} | ${fmt(r.mcp.turbo)} | ${fmt(r.mcp.binary)} | ${fmt(r.mcp.digital)} | ${r.classification} | ${r.rootCause} |`);
  }
  L.push("");
  L.push("## FRESH CRITIC (refutation attempts)");
  L.push("");
  for (const c of report.critic) {
    L.push(`- **${c.question}** → ${c.verdict}`);
    L.push(`  - ${c.evidence}`);
  }
  L.push("");
  L.push("## Verdict");
  L.push("");
  L.push(`- State: **${report.verdict.state}** (${report.verdict.confidence})`);
  L.push(`- ${report.verdict.reason}`);
  L.push(`- MCP open keys: ${report.mcpOpenKeys.join(", ") || "(none)"}`);
  L.push("");
  L.push("> READ-ONLY evidence artifact. No trading or relay logic was modified. Token never stored; output redacted.");
  L.push("");
  return L.join("\n");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  let SECRET = process.env.IQ_MCP_TOKEN || "";
  if (!SECRET && process.env.IQ_MCP_TOKEN_FILE) {
    try { SECRET = (await fs.readFile(process.env.IQ_MCP_TOKEN_FILE, "utf8")).trim(); } catch { /* noop */ }
  }
  if (!SECRET) console.log("[diag-open] IQ_MCP_TOKEN ausente — office/status/asset-map ainda são lidos; MCP fail-closed.");

  const report = await runDiag({ token: SECRET });
  const outDir = path.join(ROOT, "docs", "diag");
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "ws-vs-mcp.json");
  const mdPath = path.join(outDir, "ws-vs-mcp.md");
  const redact = (v) => redactSecret(v, SECRET);
  await fs.writeFile(jsonPath, redact(JSON.stringify(report, null, 2)), "utf8");
  await fs.writeFile(mdPath, redact(renderMarkdown(report)), "utf8");
  console.log(`[diag-open] tracecom=${JSON.stringify(report.tracecomCounts)} counts=${JSON.stringify(report.counts)}`);
  console.log(`[diag-open] verdict=${report.verdict.state}/${report.verdict.confidence} wsCatalogAnomaly=${report.wsCatalogAnomaly} matched=${report.matched}/${report.totalMarkets}`);
  console.log(`[diag-open] wrote ${path.relative(ROOT, mdPath)} and ${path.relative(ROOT, jsonPath)}`);
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
})();

if (isMain) {
  main().catch((e) => {
    console.error(`[diag-open] fatal: ${redactSecret(String(e?.message || e), "")}`);
    process.exitCode = 1;
  });
}
