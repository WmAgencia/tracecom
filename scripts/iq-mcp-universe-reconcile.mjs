#!/usr/bin/env node
/**
 * TASK 7 — REAL UNIVERSE RECONCILIATION (READ-ONLY, PRACTICE, ZERO ORDERS).
 *
 * Proves, at the same instant, which markets in `relay/market-universe.mjs`
 * really exist in IQ Option for a product TraceCom supports (turbo/binary):
 *
 *   (a) fresh IQ WS session restored from the vault (`loadSession`) → get-initialization-data
 *       (connect only; never places an order), plus get-instruments best-effort;
 *   (b) Turbo   MCP list_assets(only_enabled:false);
 *   (c) Binary  MCP list_assets(only_enabled:false);
 *   (d) Digital MCP list_assets(only_enabled:false) + get_instruments for matched assets.
 *
 * Matching is STRICT: canonical name + NORMAL/OTC. Never maps NORMAL→OTC and never
 * maps a composite (e.g. GER30/UK100-OTC) onto a simple asset.
 *
 * Decision rule (blueprint names are decorative, NOT authority):
 *   - KEEP every market whose existence is PROVEN (even SUSPENDED/DISABLED).
 *   - REMOVE only markets whose existence/mapping cannot be proven OR that belong
 *     exclusively to a product TraceCom does not support (digital/blitz only).
 *   - Never add markets to fill desks.
 *
 * SECURITY (by construction):
 *   - IQ_MCP_TOKEN only from env; never written to disk. All output redacted.
 *   - Every MCP call passes relay/iq-mcp/security.mjs gates (read-only + allowlist).
 *   - DATABASE_URL/TOKEN_SIGNING_SECRET are used in-process only (vault restore).
 *   - No order/account-write tool is ever referenced.
 *
 * Usage (PowerShell, production env via Railway):
 *   $env:IQ_MCP_TOKEN = "<token>"
 *   npx -y @railway/cli run -- node scripts/iq-mcp-universe-reconcile.mjs
 *
 * Offline fallback (no DB): uses the live relay read-only endpoints
 * `/api/iq/office` + `/api/iq/asset-map` as the WS evidence source.
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
import { UNIVERSE, marketKey, MAX_ACTIVE_MARKETS } from "../relay/market-universe.mjs";
import { canonicalFromName } from "../relay/asset-resolver.mjs";
import { canonicalFromMcpName } from "./iq-mcp-diag-open.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.IQ_DIAG_BASE_URL || "https://tracecom.consecom.com.br").replace(/\/$/, "");
const OFFICE_URL = process.env.IQ_MCP_OFFICE_URL || `${BASE_URL}/api/iq/office`;
const ASSET_MAP_URL = `${BASE_URL}/api/iq/asset-map`;
const OUT_JSON = path.join(ROOT, "docs", "office-v3", "universe-reconciliation.raw.json");
const OUT_MD = path.join(ROOT, "docs", "office-v3", "universe-reconciliation.md");

/** Products TraceCom actually supports (relay/iq-mcp/adapter.mjs: binary + turbo ONLY). */
export const TRACECOM_PRODUCTS = Object.freeze(["turbo", "binary"]);
/** Products visible in IQ but NOT executable by TraceCom (evidence only). */
export const UNSUPPORTED_PRODUCTS = Object.freeze(["digital", "blitz"]);

export const MCP_SERVERS = Object.freeze({
  turbo: Object.freeze({ base: "https://turbo-options.mcp.iqoption.com", allowlist: Object.freeze(["list_assets"]) }),
  binary: Object.freeze({ base: "https://binary-options.mcp.iqoption.com", allowlist: Object.freeze(["list_assets"]) }),
  digital: Object.freeze({ base: "https://digital-options.mcp.iqoption.com", allowlist: Object.freeze(["list_assets", "get_instruments"]) }),
});

/** Extra display aliases seen in MCP catalogs (same instrument, never NORMAL<->OTC). */
const EXTRA_MCP_ALIASES = Object.freeze({
  AUSTRALIA200: "AUS200",
  AUSTRALIA200INDEX: "AUS200",
  WALLSTREET30: "US30",
  DOWJONES30: "US30",
  USATECH100: "US100",
  NASDAQ100: "US100",
  USA500: "US500",
  SP500: "US500",
  RUSSELL2000: "US2000",
  GERMANY40: "GER30",
  DAX40: "GER30",
  DAX30: "GER30",
  UK100GBP: "UK100",
  JAPAN225INDEX: "JP225",
  NIKKEI225: "JP225",
  HONGKONG50: "HK33",
  FRANCE40INDEX: "FR40",
  SPAIN35INDEX: "SP35",
  XAUUSDGOLD: "XAUUSD",
  XAGUSDSILVER: "XAGUSD",
});

const READ_RISKS = new Set([RISK.SAFE_READ, RISK.ACCOUNT_READ]);
const nowIso = (ms = Date.now()) => new Date(ms).toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function canonicalFromMcpNameEx(rawName) {
  const parsed = canonicalFromMcpName(rawName);
  if (!parsed.canonical) return parsed;
  const compact = String(rawName ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return { ...parsed, canonical: EXTRA_MCP_ALIASES[compact] ?? parsed.canonical };
}

export function keyFor(canonical, marketType) {
  return `${String(canonical).toUpperCase()}:${marketType === "OTC" ? "OTC" : "NORMAL"}`;
}

/** Startup gate: every allowlisted tool must classify as a read. */
export function assertAllowlistReadOnly(server, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) throw new Error(`MCP_ALLOWLIST_MISSING: ${server}`);
  for (const name of allowlist) {
    const risk = classifyTool({ name });
    if (!READ_RISKS.has(risk)) throw new Error(`MCP_ALLOWLIST_WRITE: ${server}/${name} classified ${risk}`);
  }
  return true;
}

function createClient({ base, token, server, allowlist, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
  assertAllowlistReadOnly(server, allowlist);
  const state = { sessionId: null };
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
      return { status: res.status, body: parsed ?? redactSecret(text, token).slice(0, 1200) };
    } catch (e) {
      return { status: 0, error: `${e.name}:${e.message}` };
    } finally {
      clearTimeout(timer);
    }
  }
  return { rpc, call: (tool, args, id) => rpc("tools/call", { name: tool, arguments: args }, id, tool) };
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

async function probeServer(name, spec, token) {
  const entry = { base: spec.base, allowlist: [...spec.allowlist], ok: false, error: null, at: null, tools: {} };
  if (!token) { entry.error = "NO_TOKEN"; return entry; }
  const client = createClient({ base: spec.base, token, server: name, allowlist: spec.allowlist });
  const init = await client.rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tracecom-universe-reconcile", version: "0.1.0" },
  }, 1);
  if (init.status !== 200) { entry.error = `initialize HTTP ${init.status}`; return entry; }
  await client.rpc("notifications/initialized", {}, null);
  const startedAt = Date.now();
  const res = await client.call("list_assets", { only_enabled: false }, 100);
  const payload = extractPayload(res.body?.result ?? res.body?.error ?? res.body);
  const assets = Array.isArray(payload?.assets) ? payload.assets : [];
  entry.at = nowIso(startedAt);
  entry.tools.list_assets = {
    ok: res.status === 200 && !res.error,
    status: res.status,
    latencyMs: Date.now() - startedAt,
    assetCount: assets.length,
    openCount: assets.filter((a) => a?.is_open === true).length,
    closedCount: assets.filter((a) => a?.is_open === false).length,
    assets,
    ...(res.error ? { error: res.error } : {}),
  };
  entry.ok = entry.tools.list_assets.ok;
  return entry;
}

async function probeDigitalInstruments(entry, token, wanted) {
  const out = [];
  if (!entry?.ok || !wanted.length) return out;
  const client = createClient({ base: entry.base, token, server: "digital", allowlist: entry.allowlist });
  const init = await client.rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tracecom-universe-reconcile", version: "0.1.0" },
  }, 1);
  if (init.status !== 200) return [{ error: `initialize HTTP ${init.status}` }];
  await client.rpc("notifications/initialized", {}, null);
  let id = 500;
  for (const item of wanted) {
    const startedAt = Date.now();
    const res = await client.call("get_instruments", { asset_id: item.asset_id }, (id += 1));
    const payload = extractPayload(res.body?.result ?? res.body?.error ?? res.body);
    const block = Array.isArray(payload?.instruments) ? payload.instruments[0] : (payload?.instruments && typeof payload.instruments === "object" ? payload.instruments : null);
    out.push({
      marketKey: item.marketKey,
      assetId: item.asset_id,
      name: item.name,
      at: nowIso(startedAt),
      ok: res.status === 200 && !res.error,
      generated_at: block?.generated_at ?? null,
      expiration: block?.expiration ?? block?.expiration_time ?? null,
      instrumentCount: Array.isArray(block?.instruments) ? block.instruments.length : (Array.isArray(payload?.instruments) ? payload.instruments.length : 0),
      ...(res.error ? { error: res.error } : {}),
    });
    await sleep(120);
  }
  return out;
}

async function getJson(url) {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { method: "GET", headers: { accept: "application/json", "cache-control": "no-store" } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { ok: res.status === 200 && body !== null, status: res.status, at: nowIso(startedAt), latencyMs: Date.now() - startedAt, body };
  } catch (e) {
    return { ok: false, status: 0, at: nowIso(startedAt), latencyMs: Date.now() - startedAt, body: null, error: `${e.name}:${e.message}` };
  }
}

/** Fresh WS session from the vault. CONNECT ONLY + init-data read; never places an order. */
export async function probeWsFromVault({ secret }) {
  const entry = {
    mode: "VAULT_FRESH",
    ok: false,
    error: null,
    vault: null,
    connect: null,
    init: [],
    sections: {},
    actives: [],
    instruments: {},
  };
  if (!process.env.DATABASE_URL) { entry.error = "NO_DATABASE_URL"; return entry; }
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=require/i.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 8000,
  });
  try {
    const { loadSession } = await import("../relay/iq-session-vault.mjs");
    const session = await loadSession(pool, secret);
    entry.vault = session ? { emailMasked: session.emailMasked, connectedAt: session.connectedAt, connectedAtIso: session.connectedAt ? nowIso(session.connectedAt) : null } : null;
    if (!session?.ssid) { entry.error = "NO_SESSION"; return entry; }
    const { IqWsClient } = await import("../relay/iqoption-ws.mjs");
    const client = new IqWsClient({ log: () => {} });
    const connectAt = Date.now();
    const ready = await client.connect({ ssid: session.ssid });
    entry.connect = {
      requestedAt: nowIso(connectAt),
      readyAt: nowIso(),
      host: ready?.host ?? null,
      serverTimeMs: ready?.serverTimeMs ?? null,
      serverTimeIso: ready?.serverTimeMs ? nowIso(ready.serverTimeMs) : null,
      clockSkewMs: ready?.clockSkewMs ?? null,
      timeValid: ready?.timeValid ?? null,
    };
    const ingest = async (label) => {
      const t0 = Date.now();
      try {
        const response = await client.getInitializationData();
        const receivedAt = Date.now();
        const msg = response?.response?.msg ?? response?.msg ?? {};
        const sections = Object.keys(msg).filter((key) => msg?.[key]?.actives && typeof msg[key].actives === "object");
        const actives = [];
        for (const section of sections) {
          for (const [id, active] of Object.entries(msg[section]?.actives ?? {})) {
            const { canonical, otc } = canonicalFromName(active?.name);
            if (!canonical) continue;
            actives.push({
              section,
              activeId: Number(id),
              name: String(active?.name ?? ""),
              canonical,
              otc,
              marketType: otc ? "OTC" : "NORMAL",
              enabled: active?.enabled === true,
              suspended: active?.is_suspended === true,
            });
          }
        }
        entry.init.push({ label, requestedAt: nowIso(t0), receivedAt: nowIso(receivedAt), latencyMs: receivedAt - t0, msgName: response?.response?.name ?? response?.name ?? null, sections, activeCount: actives.length });
        entry.sections[label] = sections;
        entry.actives = actives;
      } catch (error) {
        entry.init.push({ label, requestedAt: nowIso(t0), error: String(error?.code ?? error?.message ?? error).slice(0, 160) });
      }
    };
    await ingest("t0");
    await sleep(4000);
    await ingest("t4s");
    for (const type of ["turbo-option", "binary-option", "digital-option", "blitz-option"]) {
      try {
        const t0 = Date.now();
        const { response } = await client.getInstruments({ type, timeoutMs: 8_000 });
        const msg = response?.msg ?? {};
        const rows = Array.isArray(msg) ? msg : (msg.instruments ?? msg.instruments_list ?? msg.data ?? []);
        entry.instruments[type] = { ok: true, at: nowIso(t0), count: rows.length };
      } catch (error) {
        entry.instruments[type] = { ok: false, error: String(error?.code ?? error?.message ?? error).slice(0, 80) };
      }
    }
    entry.ok = entry.init.some((row) => !row.error);
    try { client.close("UNIVERSE_RECONCILE_DONE"); } catch { /* noop */ }
    return entry;
  } catch (error) {
    entry.error = String(error?.code ?? error?.message ?? error).slice(0, 200);
    return entry;
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Fallback WS evidence via the live relay read-only endpoints (production resolver). */
export async function probeWsFromRelay() {
  const entry = { mode: "RELAY_ASSET_MAP", ok: false, error: null, officeAt: null, resolverAt: null, actives: [] };
  const [office, assetMap] = await Promise.all([getJson(OFFICE_URL), getJson(ASSET_MAP_URL)]);
  if (!assetMap.ok) { entry.error = `asset-map HTTP ${assetMap.status}`; return entry; }
  entry.officeAt = office.body?.at ? nowIso(Number(office.body.at)) : null;
  const resolver = assetMap.body?.resolver ?? {};
  entry.resolverAt = resolver.lastResolvedAt ? nowIso(Number(resolver.lastResolvedAt)) : null;
  for (const row of resolver.markets ?? []) {
    const [canonical, type] = String(row.marketKey ?? "").split(":");
    if (!canonical) continue;
    const candidates = (row.candidates ?? []).map((c) => ({ section: c.section, activeId: Number(c.activeId), enabled: c.enabled === true, suspended: c.suspended === true }));
    if (!candidates.length && row.activeId === null) continue;
    entry.actives.push({
      section: candidates[0]?.section ?? "binary",
      activeId: Number(row.activeId ?? candidates[0]?.activeId),
      name: `${canonical}${type === "OTC" ? "-OTC" : ""}`,
      canonical: canonical.toUpperCase(),
      otc: type === "OTC",
      marketType: type === "OTC" ? "OTC" : "NORMAL",
      enabled: row.enabledLive === true,
      suspended: row.suspended === true,
      availability: row.availability ?? null,
      candidates,
    });
  }
  entry.ok = entry.actives.length > 0;
  return entry;
}

function indexByKey(actives) {
  const index = new Map();
  for (const row of actives) {
    const key = keyFor(row.canonical, row.marketType);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
  return index;
}

function pickActive(rows) {
  if (!rows?.length) return null;
  const open = rows.filter((r) => r.enabled && !r.suspended);
  return open[0] ?? rows[0];
}

export function classifyMarket({ entry, wsRows, turbo, binary, digital }) {
  const key = marketKey(entry.canonical, entry.marketType);
  const wsSections = [...new Set((wsRows ?? []).map((r) => r.section))];
  const products = [];
  for (const p of ["turbo", "binary", "digital"]) if (wsSections.includes(p)) products.push(p);
  if (wsSections.length) products.push(...wsSections.filter((s) => !products.includes(s)));
  const mcpProducts = [];
  if (turbo) mcpProducts.push("turbo");
  if (binary) mcpProducts.push("binary");
  if (digital) mcpProducts.push("digital");

  const supported = products.some((p) => TRACECOM_PRODUCTS.includes(p)) || mcpProducts.some((p) => TRACECOM_PRODUCTS.includes(p));
  const exists = Boolean(wsRows?.length) || mcpProducts.length > 0;
  const wsSupportedRows = (wsRows ?? []).filter((r) => TRACECOM_PRODUCTS.includes(r.section));
  const selected = pickActive(wsSupportedRows) ?? pickActive(wsRows);
  const wsOpen = wsSupportedRows.some((r) => r.enabled && !r.suspended);
  const mcpOpen = [turbo, binary].some((a) => a?.is_open === true);
  const currentlyOpen = wsOpen || mcpOpen;
  const currentlyOffered = wsSupportedRows.length > 0 || Boolean(turbo || binary);
  const activeId = selected?.activeId ?? turbo?.asset_id ?? binary?.asset_id ?? digital?.asset_id ?? null;
  const canonicalNames = [...new Set([
    ...(wsRows ?? []).map((r) => r.name),
    ...[turbo, binary, digital].filter(Boolean).map((a) => a.name),
  ])];

  const conflicts = [];
  const productNotes = [];
  if (!exists) conflicts.push("NO_EVIDENCE_ANY_SOURCE");
  if ((wsRows ?? []).length && !supported && mcpProducts.length === 0) conflicts.push("WS_ONLY_UNSUPPORTED_SECTION");
  if (!(wsRows ?? []).length && mcpProducts.length > 0) conflicts.push("MCP_ONLY_NOT_IN_WS_CATALOG");
  if (wsOpen && !mcpOpen && (turbo || binary)) conflicts.push("WS_OPEN_MCP_CLOSED");
  if (!wsOpen && mcpOpen) conflicts.push("WS_CLOSED_MCP_OPEN");
  if (turbo && binary && turbo.is_open !== binary.is_open) productNotes.push("TURBO_BINARY_STATE_DIFF");

  let decision = "KEEP";
  let reason = "PROVEN";
  if (!exists) { decision = "REMOVE"; reason = "EXISTENCE_UNPROVEN"; }
  else if (!supported) { decision = "REMOVE"; reason = "PRODUCT_UNSUPPORTED"; }

  return {
    marketKey: key,
    canonical: entry.canonical,
    marketType: entry.marketType,
    exists,
    products: [...new Set([...products, ...mcpProducts])],
    supportedProducts: [...new Set([...products, ...mcpProducts])].filter((p) => TRACECOM_PRODUCTS.includes(p)),
    unsupportedProducts: [...new Set([...products, ...mcpProducts])].filter((p) => UNSUPPORTED_PRODUCTS.includes(p)),
    supported,
    activeId,
    canonicalName: canonicalNames[0] ?? null,
    canonicalNames,
    currentlyOffered,
    currentlyOpen,
    wsState: selected ? { enabled: selected.enabled, suspended: selected.suspended, section: selected.section, availability: selected.availability ?? null } : null,
    wsCandidates: (wsRows ?? []).map((r) => ({ activeId: r.activeId, section: r.section, enabled: r.enabled, suspended: r.suspended })),
    mcp: {
      turbo: turbo ? { asset_id: turbo.asset_id, name: turbo.name, is_open: turbo.is_open, profit_percent: turbo.profit_percent ?? null } : null,
      binary: binary ? { asset_id: binary.asset_id, name: binary.name, is_open: binary.is_open, profit_percent: binary.profit_percent ?? null } : null,
      digital: digital ? { asset_id: digital.asset_id, name: digital.name, is_open: digital.is_open, asset_type: digital.asset_type ?? null } : null,
    },
    decision,
    reason,
    conflicts,
    productNotes,
  };
}

export async function runReconcile({ token = "", wsOverride = null } = {}) {
  const startedAt = Date.now();
  const secret = process.env.TOKEN_SIGNING_SECRET || "";
  const wsPromise = wsOverride
    ? Promise.resolve(wsOverride)
    : (process.env.DATABASE_URL && secret ? probeWsFromVault({ secret }) : probeWsFromRelay());
  // Same instant: fresh WS session (connect + init-data) and all MCP list_assets run concurrently.
  const [wsRaw, turbo, binary, digital] = await Promise.all([
    wsPromise,
    probeServer("turbo", MCP_SERVERS.turbo, token),
    probeServer("binary", MCP_SERVERS.binary, token),
    probeServer("digital", MCP_SERVERS.digital, token),
  ]);
  const ws = wsRaw;
  if (!ws.ok && ws.mode === "VAULT_FRESH") {
    const fallback = await probeWsFromRelay();
    ws.fallback = fallback;
  }
  const mcp = { turbo, binary, digital };

  const mcpIndex = { turbo: new Map(), binary: new Map(), digital: new Map() };
  for (const [product, server] of Object.entries(mcp)) {
    for (const asset of (server?.tools?.list_assets?.assets ?? [])) {
      const parsed = canonicalFromMcpNameEx(asset?.name);
      if (!parsed.canonical) continue;
      const key = keyFor(parsed.canonical, parsed.otc ? "OTC" : "NORMAL");
      if (!mcpIndex[product].has(key)) mcpIndex[product].set(key, asset);
    }
  }

  const digitalWanted = [];
  for (const entry of UNIVERSE) {
    const key = marketKey(entry.canonical, entry.marketType);
    const asset = mcpIndex.digital.get(key);
    if (asset) digitalWanted.push({ marketKey: key, asset_id: asset.asset_id, name: asset.name });
  }
  digitalWanted.sort((a, b) => a.marketKey.localeCompare(b.marketKey));
  const digitalInstruments = await probeDigitalInstruments(digital, token, digitalWanted);

  const actives = ws.actives ?? ws.fallback?.actives ?? [];
  const wsIndex = indexByKey(actives);

  const markets = UNIVERSE.map((entry) => {
    const key = marketKey(entry.canonical, entry.marketType);
    return classifyMarket({
      entry,
      wsRows: wsIndex.get(key) ?? [],
      turbo: mcpIndex.turbo.get(key) ?? null,
      binary: mcpIndex.binary.get(key) ?? null,
      digital: mcpIndex.digital.get(key) ?? null,
    });
  });

  const removed = markets.filter((m) => m.decision === "REMOVE");
  const kept = markets.filter((m) => m.decision === "KEEP");
  const conflicts = markets.filter((m) => m.conflicts.length > 0);
  const unresolved = markets.filter((m) => !m.exists || !m.supported).map((m) => ({ marketKey: m.marketKey, reason: m.reason, products: m.products, conflicts: m.conflicts, productNotes: m.productNotes }));

  const report = {
    version: "universe-reconciliation-v1",
    generatedAt: nowIso(startedAt),
    finishedAt: nowIso(),
    startedAt,
    endpoints: { office: OFFICE_URL, assetMap: ASSET_MAP_URL },
    tracecomProducts: [...TRACECOM_PRODUCTS],
    universeBefore: { count: UNIVERSE.length, maxActiveMarkets: MAX_ACTIVE_MARKETS },
    ws: {
      mode: ws.mode,
      ok: ws.ok,
      error: ws.error ?? null,
      vault: ws.vault ?? null,
      connect: ws.connect ?? null,
      init: ws.init ?? [],
      sections: ws.sections ?? {},
      activeRowCount: actives.length,
      instruments: ws.instruments ?? {},
      fallback: ws.fallback ? { mode: ws.fallback.mode, ok: ws.fallback.ok, error: ws.fallback.error ?? null, resolverAt: ws.fallback.resolverAt ?? null, activeRowCount: ws.fallback.actives?.length ?? 0 } : null,
    },
    mcp: {
      turbo: { base: turbo.base, ok: turbo.ok, error: turbo.error, at: turbo.at, assetCount: turbo?.tools?.list_assets?.assetCount ?? 0, openCount: turbo?.tools?.list_assets?.openCount ?? 0, closedCount: turbo?.tools?.list_assets?.closedCount ?? 0 },
      binary: { base: binary.base, ok: binary.ok, error: binary.error, at: binary.at, assetCount: binary?.tools?.list_assets?.assetCount ?? 0, openCount: binary?.tools?.list_assets?.openCount ?? 0, closedCount: binary?.tools?.list_assets?.closedCount ?? 0 },
      digital: { base: digital.base, ok: digital.ok, error: digital.error, at: digital.at, assetCount: digital?.tools?.list_assets?.assetCount ?? 0, openCount: digital?.tools?.list_assets?.openCount ?? 0, closedCount: digital?.tools?.list_assets?.closedCount ?? 0 },
      digitalGetInstruments: digitalInstruments,
    },
    counts: {
      total: markets.length,
      exists: markets.filter((m) => m.exists).length,
      supported: markets.filter((m) => m.supported).length,
      currentlyOpen: markets.filter((m) => m.currentlyOpen).length,
      keep: kept.length,
      remove: removed.length,
      conflicts: conflicts.length,
    },
    markets,
    finalUniverse: kept.map((m) => ({ canonical: m.canonical, marketType: m.marketType, marketKey: m.marketKey, products: m.supportedProducts, activeId: m.activeId, currentlyOpen: m.currentlyOpen })),
    removed: removed.map((m) => ({ marketKey: m.marketKey, reason: m.reason, products: m.products, conflicts: m.conflicts, productNotes: m.productNotes })),
    keptSuspended: kept.filter((m) => !m.currentlyOpen).map((m) => ({ marketKey: m.marketKey, activeId: m.activeId, wsState: m.wsState })),
    unresolved,
  };
  return report;
}

export function renderMarkdown(report) {
  const L = [];
  L.push("# UNIVERSE RECONCILIATION — REAL IQ EXISTENCE (READ-ONLY)");
  L.push("");
  L.push("> Blueprint desk names are decorative, NOT authority. This artifact only keeps markets with PROVEN existence in IQ Option for a product TraceCom actually supports (turbo/binary). `SUSPENDED` ≠ nonexistent. ZERO orders. PRACTICE only. Token never stored; output redacted.");
  L.push("");
  L.push(`Generated: ${report.generatedAt}`);
  L.push("");
  L.push("## Evidence at the same instant");
  L.push("");
  L.push(`- WS source: **${report.ws.mode}** (ok=${report.ws.ok}${report.ws.error ? `, error=${report.ws.error}` : ""})`);
  if (report.ws.connect) {
    L.push(`  - vault session connectedAt: ${report.ws.vault?.connectedAtIso ?? "-"}`);
    L.push(`  - fresh connect ready: ${report.ws.connect.readyAt} (host ${report.ws.connect.host}, serverTime ${report.ws.connect.serverTimeIso}, timeValid=${report.ws.connect.timeValid})`);
    for (const init of report.ws.init) L.push(`  - get-initialization-data ${init.label}: received ${init.receivedAt ?? "-"} (${init.activeCount ?? 0} actives; sections ${JSON.stringify(init.sections ?? [])})${init.error ? ` error=${init.error}` : ""}`);
    L.push(`  - get-instruments WS: ${JSON.stringify(report.ws.instruments)}`);
  } else {
    L.push(`  - resolver lastResolvedAt: ${report.ws.fallback?.resolverAt ?? report.ws.resolverAt ?? "-"}`);
  }
  L.push(`- MCP turbo: ${report.mcp.turbo.assetCount} assets (${report.mcp.turbo.openCount} open / ${report.mcp.turbo.closedCount} closed) @ ${report.mcp.turbo.at ?? "-"}${report.mcp.turbo.error ? ` error=${report.mcp.turbo.error}` : ""}`);
  L.push(`- MCP binary: ${report.mcp.binary.assetCount} assets (${report.mcp.binary.openCount} open / ${report.mcp.binary.closedCount} closed) @ ${report.mcp.binary.at ?? "-"}${report.mcp.binary.error ? ` error=${report.mcp.binary.error}` : ""}`);
  L.push(`- MCP digital: ${report.mcp.digital.assetCount} assets (${report.mcp.digital.openCount} open / ${report.mcp.digital.closedCount} closed) @ ${report.mcp.digital.at ?? "-"}${report.mcp.digital.error ? ` error=${report.mcp.digital.error}` : ""}`);
  L.push(`- Digital get_instruments matched assets: ${report.mcp.digitalGetInstruments.length}`);
  L.push("");
  L.push("## Per-market table (7 fields)");
  L.push("");
  L.push("| marketKey | EXISTS | PRODUCT(s) | NORMAL/OTC | activeId | canonicalName | currentlyOffered | currentlyOpen | decision | reason |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const m of report.markets) {
    L.push(`| ${m.marketKey} | ${m.exists ? "YES" : "NO"} | ${m.products.join("+") || "-"} | ${m.marketType} | ${m.activeId ?? "-"} | ${m.canonicalName ?? "-"} | ${m.currentlyOffered ? "YES" : "NO"} | ${m.currentlyOpen ? "YES" : "NO"} | ${m.decision} | ${m.reason} |`);
  }
  L.push("");
  L.push("## Final universe (evidence-backed)");
  L.push("");
  L.push(`Before: ${report.universeBefore.count} markets (MAX_ACTIVE_MARKETS=${report.universeBefore.maxActiveMarkets}). After: **${report.finalUniverse.length}** markets.`);
  L.push("");
  L.push(report.finalUniverse.map((m) => `- ${m.marketKey} [${m.products.join("+")}] activeId=${m.activeId ?? "-"} open=${m.currentlyOpen ? "YES" : "NO"}`).join("\n"));
  L.push("");
  L.push("## Removed / kept and why (PROVEN vs INFERRED)");
  L.push("");
  if (report.removed.length) {
    L.push("### Removed");
    L.push("");
    for (const m of report.removed) L.push(`- **${m.marketKey}** — ${m.reason} (products: ${m.products.join("+") || "none"}; conflicts: ${m.conflicts.join(",") || "none"})`);
  } else {
    L.push("### Removed");
    L.push("");
    L.push("- none (all 55 proven, supported and kept)");
  }
  L.push("");
  L.push(`### Kept but not currently open (SUSPENDED/DISABLED — existence PROVEN, NOT removed)`);
  L.push("");
  if (report.keptSuspended.length) {
    for (const m of report.keptSuspended) L.push(`- ${m.marketKey} activeId=${m.activeId ?? "-"} wsState=${JSON.stringify(m.wsState)}`);
  } else {
    L.push("- none");
  }
  L.push("");
  L.push("## Unresolved mapping / CONFLICTs");
  L.push("");
  if (report.unresolved.length || report.counts.conflicts) {
    for (const m of report.unresolved) L.push(`- ${m.marketKey}: ${m.reason}${m.conflicts.length ? ` (${m.conflicts.join(", ")})` : ""}`);
    const flagged = report.markets.filter((m) => m.conflicts.length && m.exists && m.supported);
    for (const m of flagged) L.push(`- ${m.marketKey}: ${m.conflicts.join(", ")}`);
    const notes = report.markets.filter((m) => (m.productNotes ?? []).length);
    for (const m of notes) L.push(`- ${m.marketKey} (product note): ${m.productNotes.join(", ")}`);
  } else {
    L.push("- none");
  }
  L.push("");
  L.push("## Digital get_instruments (matched assets)");
  L.push("");
  for (const d of report.mcp.digitalGetInstruments) L.push(`- ${d.marketKey} asset_id=${d.assetId} ok=${d.ok} generated_at=${d.generated_at ?? "-"} instruments=${d.instrumentCount}`);
  L.push("");
  L.push("> READ-ONLY evidence artifact. No trading/relay logic modified here. Token never stored; output redacted.");
  return L.join("\n");
}

async function main() {
  const token = process.env.IQ_MCP_TOKEN || "";
  if (!token) console.log("[universe-reconcile] IQ_MCP_TOKEN ausente — MCP fail-closed.");
  const wsFile = process.argv.find((arg) => arg.startsWith("--ws-file="))?.slice("--ws-file=".length) ?? null;
  const wsOverride = wsFile ? JSON.parse(await fs.readFile(path.resolve(ROOT, wsFile), "utf8")) : null;
  const report = await runReconcile({ token, wsOverride });
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  const redact = (value) => redactSecret(value, token);
  await fs.writeFile(OUT_JSON, redact(JSON.stringify(report, null, 2)), "utf8");
  await fs.writeFile(OUT_MD, redact(renderMarkdown(report)), "utf8");
  console.log(`[universe-reconcile] ws=${report.ws.mode} counts=${JSON.stringify(report.counts)}`);
  console.log(`[universe-reconcile] removed=${report.removed.map((m) => `${m.marketKey}(${m.reason})`).join(",") || "none"} conflicts=${report.counts.conflicts}`);
  console.log(`[universe-reconcile] wrote docs/office-v3/universe-reconciliation.md and .raw.json`);
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
})();

if (isMain) {
  main().catch((error) => {
    console.error(`[universe-reconcile] fatal: ${redactSecret(String(error?.message || error), "")}`);
    process.exitCode = 1;
  });
}
