/**
 * IQ Official MCP — reconciliation engine (shadow mode).
 *
 * Pure comparison between the TraceCom office snapshot and the read-only IQ
 * MCP catalog/account. No network, no trading imports, no side effects beyond
 * the explicit JSONL persistence helpers.
 *
 * Safety rules encoded here:
 * - NORMAL/OTC isolation: a market only pairs with an asset of the SAME
 *   canonical AND SAME market type. EURUSD:OTC never pairs with EURUSD
 *   (NORMAL) and vice-versa. The market identity (marketKey / marketType /
 *   OTC marker in display+symbol) must be internally consistent — any
 *   contradiction becomes CONFLICT and no pair is formed.
 * - `is_open` is a boolean: it can only confirm/deny the OPEN state. The
 *   5-state availability enum is NEVER derived from it — every other state is
 *   NOT_COMPARABLE and explicitly labeled as boolean-only.
 * - Tolerances: payout exact; practice balance is MINOR only when |Δ| ≤ 1% AND
 *   |Δ| ≤ 1 unit. Skew > 5 min marks comparable records STALE_SOURCE.
 * - A record without a source timestamp is NOT_COMPARABLE (freshness cannot be
 *   proven) — it is never silently MATCH.
 * - JSONL history is bounded: `loadHistory` reads only the last
 *   `maxBytes` (tail read) and `persistRecords` rotates the file when it
 *   exceeds `maxBytes`, retaining at most `maxRecords` lines.
 * - These records are diagnostics only: nothing is substituted automatically.
 */

import { appendFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CLASSIFICATION = Object.freeze({
  MATCH: "MATCH",
  MINOR_DIFFERENCE: "MINOR_DIFFERENCE",
  CONFLICT: "CONFLICT",
  NOT_COMPARABLE: "NOT_COMPARABLE",
  STALE_SOURCE: "STALE_SOURCE",
});

export const FIELD = Object.freeze({
  CATALOG: "CATALOG",
  PAYOUT: "PAYOUT",
  EXPIRATIONS: "EXPIRATIONS",
  AVAILABILITY: "AVAILABILITY",
  ACCOUNT: "ACCOUNT",
});

export const AVAILABILITY_STATES = Object.freeze(["OPEN", "DISABLED", "SUSPENDED", "NOT_OFFERED", "UNKNOWN"]);

export const STALE_SKEW_MS = 5 * 60_000;

export const BALANCE_TOLERANCE = Object.freeze({ ratio: 0.01, absolute: 1 });

export const DEFAULT_RECONCILIATION_PATH = "diagnostic-results/iq-mcp-reconciliation.jsonl";

/** Byte cap for a tail read of the JSONL history (default 2 MiB). */
export const DEFAULT_MAX_HISTORY_BYTES = 2 * 1024 * 1024;
/** Maximum number of retained JSONL records after rotation (default 20k). */
export const DEFAULT_MAX_HISTORY_RECORDS = 20_000;

const OTC_NAME_RE = /\(?\s*\bOTC\b\s*\)?/i;
const ACCOUNT_SCOPE = "ACCOUNT";

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round4(value) {
  return Number(Number(value).toFixed(4));
}

/** "EUR/USD (OTC)" -> "EURUSD"; "US 500" -> "US500". */
export function normalizeCanonical(name) {
  return String(name ?? "").replace(OTC_NAME_RE, "").replace(/[^a-z0-9]/gi, "").toUpperCase() || null;
}

/** Market type of an MCP asset, derived only from the "(OTC)" marker in its name. */
export function assetMarketType(asset) {
  return OTC_NAME_RE.test(String(asset?.name ?? "")) ? "OTC" : "NORMAL";
}

/** Canonical+type key of an MCP asset, e.g. "EURUSD:OTC" — mirrors TraceCom marketKey. */
export function assetMarketKey(asset) {
  const canonical = normalizeCanonical(asset?.name);
  return canonical ? `${canonical}:${assetMarketType(asset)}` : null;
}

function normalizeMarketType(value) {
  if (value === null || value === undefined) return null;
  const type = String(value).trim().toUpperCase();
  return type === "OTC" || type === "NORMAL" ? type : null;
}

/** true = explicit OTC marker, false = string present without marker, null = no text. */
function otcMarker(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return OTC_NAME_RE.test(value);
}

function marketKeyType(key) {
  const text = String(key ?? "");
  const index = text.lastIndexOf(":");
  if (index < 0) return null;
  return normalizeMarketType(text.slice(index + 1));
}

function marketKeyCanonical(key) {
  const text = String(key ?? "");
  const index = text.lastIndexOf(":");
  const prefix = (index < 0 ? text : text.slice(0, index)).trim();
  return normalizeCanonical(prefix);
}

/**
 * Resolves `{ key, conflict }` for an internal market.
 *
 * Contradictory evidence (declared marketKey type vs marketType vs explicit
 * OTC marker in display/symbol vs canonical) yields a CONFLICT identity that
 * is never paired — this is the path that used to fabricate a NORMAL key from
 * a missing/whitespace marketType and cross-match an OTC market.
 */
function marketIdentity(market) {
  const canonical = normalizeCanonical(market?.canonical ?? market?.symbol ?? market?.display);
  const declared = normalizeMarketType(market?.marketType);
  const marker = [market?.display, market?.symbol].map(otcMarker).find((value) => value !== null) ?? null;
  const rawKey = market?.marketKey;
  const explicitKey = rawKey === null || rawKey === undefined || String(rawKey).trim() === "" ? null : String(rawKey);

  if (explicitKey) {
    const keyType = marketKeyType(explicitKey);
    const keyCanonical = marketKeyCanonical(explicitKey);
    if (declared && keyType && declared !== keyType) return { key: explicitKey, conflict: "MARKET_KEY_TYPE_CONFLICT" };
    if (marker === true && keyType === "NORMAL") return { key: explicitKey, conflict: "MARKET_KEY_TYPE_CONFLICT" };
    if (canonical && keyCanonical && canonical !== keyCanonical) return { key: explicitKey, conflict: "MARKET_KEY_CANONICAL_CONFLICT" };
    return { key: explicitKey, conflict: null };
  }

  if (!canonical) return { key: null, conflict: null };
  if (declared === "NORMAL" && marker === true) return { key: `${canonical}:NORMAL`, conflict: "MARKET_TYPE_EVIDENCE_CONFLICT" };
  const type = declared ?? (marker === true ? "OTC" : "NORMAL");
  return { key: `${canonical}:${type}`, conflict: null };
}

/** Exact unless a tolerance is given (both bounds must hold). */
export function classifyNumeric(current, mcp, tolerance = null) {
  if (current === mcp) return CLASSIFICATION.MATCH;
  const delta = Math.abs(current - mcp);
  if (tolerance) {
    const base = Math.abs(mcp);
    const ratioOk = base > 0 && delta / base <= tolerance.ratio;
    if (delta <= tolerance.absolute && ratioOk) return CLASSIFICATION.MINOR_DIFFERENCE;
  }
  return CLASSIFICATION.CONFLICT;
}

export function normalizeInternalAccount(account) {
  if (!account || typeof account !== "object") return null;
  const practice = account.practice ?? account.modeState?.practice ?? null;
  const modeRaw = account.mode ?? account.modeState?.mode ?? null;
  return {
    mode: modeRaw ? String(modeRaw).toUpperCase() : null,
    balance: practice ? asNumber(practice.balance) : null,
    currency: practice?.currency ? String(practice.currency).toUpperCase() : null,
    at: asNumber(account.at ?? account.modeState?.at ?? null),
  };
}

export function normalizeMcpAccount(mcpAccount) {
  if (!mcpAccount || typeof mcpAccount !== "object") return null;
  const balances = Array.isArray(mcpAccount)
    ? mcpAccount
    : Array.isArray(mcpAccount.balances)
      ? mcpAccount.balances
      : Array.isArray(mcpAccount.data?.balances)
        ? mcpAccount.data.balances
        : [];
  const typeOf = (balance) => String(balance?.type ?? "").toLowerCase();
  const training = balances.find((balance) => typeOf(balance) === "training") ?? null;
  const regular = balances.find((balance) => typeOf(balance) === "regular") ?? null;
  const modeRaw = mcpAccount.mode ?? mcpAccount.data?.mode ?? null;
  const mode = modeRaw
    ? String(modeRaw).toUpperCase()
    : balances.length === 0
      ? "UNKNOWN"
      : training && regular
        ? "MIXED"
        : training
          ? "PRACTICE"
          : regular
            ? "REAL"
            : "UNKNOWN";
  return { balances, training, regular, mode, at: asNumber(mcpAccount.at ?? mcpAccount.data?.at ?? null) };
}

function skewBetween(sourceTimestamp, referenceTimestamp) {
  const source = asNumber(sourceTimestamp);
  const reference = asNumber(referenceTimestamp);
  if (source === null || reference === null) return 0;
  return Math.abs(reference - source);
}

function withStale(classification, skewMs, staleSkewMs) {
  if (classification === CLASSIFICATION.NOT_COMPARABLE) return classification;
  return skewMs > staleSkewMs ? CLASSIFICATION.STALE_SOURCE : classification;
}

/**
 * A missing source timestamp makes freshness unprovable: value agreement is
 * downgraded to NOT_COMPARABLE (never left as a silent MATCH/MINOR/CONFLICT).
 * Structural identity conflicts (ambiguous match, key/type contradiction) do
 * not depend on freshness and are preserved when `preserveConflict` is true.
 */
function withSourceFreshness(record, sourceTimestamp, { preserveConflict = false } = {}) {
  if (record.classification === CLASSIFICATION.NOT_COMPARABLE) return record;
  if (asNumber(sourceTimestamp) !== null) return record;
  if (preserveConflict && record.classification === CLASSIFICATION.CONFLICT) return record;
  return {
    ...record,
    difference: {
      ...(record.difference ?? {}),
      code: "SOURCE_TIMESTAMP_MISSING",
      skewMs: null,
      note: "office snapshot carries no source timestamp; freshness is unprovable",
    },
    classification: CLASSIFICATION.NOT_COMPARABLE,
  };
}

function differenceValue({ metric = null, code = "EXACT", delta = null, skewMs = null, note = null } = {}) {
  return { metric, code, delta, skewMs, note };
}

function makeRecord({ timestamp, marketKey, field, currentValue, mcpValue, sourceTimestamp, difference, classification }) {
  return { timestamp, marketKey, field, currentValue, mcpValue, sourceTimestamp, difference, classification };
}

function indexMcpAssets(mcpAssets) {
  const byId = new Map();
  const byKey = new Map();
  for (const asset of mcpAssets ?? []) {
    if (!asset || typeof asset !== "object") continue;
    if (asset.asset_id !== undefined && asset.asset_id !== null) byId.set(String(asset.asset_id), asset);
    const key = assetMarketKey(asset);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(asset);
  }
  return { byId, byKey };
}

/**
 * Pairs each internal market with at most one MCP asset. Explicit `mcpAssetId`
 * wins; otherwise the pair must match canonical AND market type exactly.
 */
function pairMarkets(markets, mcpAssets) {
  const { byId, byKey } = indexMcpAssets(mcpAssets);
  const used = new Set();
  const pairs = [];

  for (const market of markets ?? []) {
    if (!market || typeof market !== "object") continue;
    const identity = marketIdentity(market);
    const marketKey = identity.key;
    if (!marketKey) continue;
    let asset = null;
    let conflict = identity.conflict ?? null;
    let matchMode = null;
    let identityMismatch = null;

    const explicitId = market.mcpAssetId ?? null;
    if (conflict) {
      /* contradictory identity: never pair, surface the conflict */
    } else if (explicitId !== null && explicitId !== undefined) {
      matchMode = "EXPLICIT_ID";
      asset = byId.get(String(explicitId)) ?? null;
      if (!asset) conflict = "MAPPED_ASSET_ID_MISSING";
      else if (assetMarketKey(asset) !== marketKey) conflict = `MAPPED_ASSET_KEY_MISMATCH:${assetMarketKey(asset)}`;
    } else {
      const candidates = byKey.get(marketKey) ?? [];
      if (candidates.length === 1) {
        asset = candidates[0];
        matchMode = "CANONICAL_TYPE";
      } else if (candidates.length > 1) {
        conflict = "AMBIGUOUS_MCP_MATCH";
      }
    }

    if (!conflict && asset) {
      const activeId = asNumber(market.activeId);
      const assetId = asNumber(asset.asset_id);
      if (activeId !== null && assetId !== null && activeId !== assetId) identityMismatch = { delta: activeId - assetId };
    }

    if (asset?.asset_id !== undefined && asset?.asset_id !== null) used.add(String(asset.asset_id));
    pairs.push({ market, marketKey, asset, conflict, matchMode, identityMismatch });
  }

  const leftovers = [];
  for (const [key, list] of byKey) {
    for (const asset of list) {
      if (asset?.asset_id === undefined || asset?.asset_id === null || !used.has(String(asset.asset_id))) leftovers.push({ key, asset });
    }
  }
  return { pairs, leftovers };
}

function mcpCatalogValue(asset) {
  if (!asset) return null;
  return {
    marketKey: assetMarketKey(asset),
    assetId: asset.asset_id ?? null,
    name: asset.name ?? null,
    canonical: normalizeCanonical(asset.name),
    marketType: assetMarketType(asset),
  };
}

function catalogRecord(pair, context) {
  const skewMs = skewBetween(context.sourceTimestamp, context.mcpTimestamp);
  const market = pair.market;
  const currentValue = {
    marketKey: pair.marketKey,
    canonical: market.canonical ?? null,
    marketType: market.marketType ?? null,
    activeId: asNumber(market.activeId),
  };
  const mcpValue = mcpCatalogValue(pair.asset);
  const base = {
    timestamp: context.timestamp,
    marketKey: pair.marketKey,
    field: FIELD.CATALOG,
    currentValue,
    mcpValue,
    sourceTimestamp: context.sourceTimestamp,
  };

  if (pair.conflict) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "catalog", code: pair.conflict, skewMs }), classification: CLASSIFICATION.CONFLICT });
  }
  if (!pair.asset) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "catalog", code: "NO_MCP_COUNTERPART", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  const activeId = currentValue.activeId;
  const assetId = asNumber(pair.asset.asset_id);
  if (activeId !== null && assetId !== null && activeId !== assetId) {
    return makeRecord({
      ...base,
      difference: differenceValue({ metric: "catalog", code: "ASSET_ID_MISMATCH", delta: activeId - assetId, skewMs }),
      classification: withStale(CLASSIFICATION.CONFLICT, skewMs, context.staleSkewMs),
    });
  }
  return makeRecord({ ...base, difference: differenceValue({ metric: "catalog", code: "EXACT", skewMs }), classification: withStale(CLASSIFICATION.MATCH, skewMs, context.staleSkewMs) });
}

function leftoverCatalogRecord({ key, asset }, context) {
  const skewMs = skewBetween(context.sourceTimestamp, context.mcpTimestamp);
  return makeRecord({
    timestamp: context.timestamp,
    marketKey: key,
    field: FIELD.CATALOG,
    currentValue: null,
    mcpValue: mcpCatalogValue(asset),
    sourceTimestamp: context.sourceTimestamp,
    difference: differenceValue({ metric: "catalog", code: "NO_INTERNAL_COUNTERPART", skewMs }),
    classification: CLASSIFICATION.NOT_COMPARABLE,
  });
}

function payoutRecord(pair, context) {
  const skewMs = skewBetween(context.sourceTimestamp, context.mcpTimestamp);
  const currentValue = asNumber(pair.market.payout);
  const mcpValue = asNumber(pair.asset?.profit_percent);
  const base = {
    timestamp: context.timestamp,
    marketKey: pair.marketKey,
    field: FIELD.PAYOUT,
    currentValue,
    mcpValue,
    sourceTimestamp: context.sourceTimestamp,
  };

  if (!pair.asset || pair.conflict) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "payout", code: "NO_MCP_COUNTERPART", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  if (pair.identityMismatch) {
    return makeRecord({
      ...base,
      difference: differenceValue({ metric: "payout", code: "IDENTITY_MISMATCH", delta: pair.identityMismatch.delta, skewMs, note: "catalog asset_id disagrees with the internal activeId; payout is not compared" }),
      classification: CLASSIFICATION.NOT_COMPARABLE,
    });
  }
  if (currentValue === null || mcpValue === null) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "payout", code: "PAYOUT_ABSENT", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  const delta = currentValue - mcpValue;
  const classification = classifyNumeric(currentValue, mcpValue, null);
  return makeRecord({
    ...base,
    difference: differenceValue({ metric: "payout", code: delta === 0 ? "EXACT" : "DELTA", delta, skewMs }),
    classification: withStale(classification, skewMs, context.staleSkewMs),
  });
}

function expirationSet(values) {
  if (!Array.isArray(values)) return null;
  return [...new Set(values.map(asNumber).filter((value) => value !== null))].sort((a, b) => a - b);
}

function expirationRecord(pair, context) {
  const skewMs = skewBetween(context.sourceTimestamp, context.mcpTimestamp);
  const internal = expirationSet(pair.market.expirations);
  const mcp = expirationSet(pair.asset?.expirations);
  const base = {
    timestamp: context.timestamp,
    marketKey: pair.marketKey,
    field: FIELD.EXPIRATIONS,
    currentValue: internal,
    mcpValue: mcp,
    sourceTimestamp: context.sourceTimestamp,
  };

  if (!pair.asset || pair.conflict) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "expirations", code: "NO_MCP_COUNTERPART", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  if (pair.identityMismatch) {
    return makeRecord({
      ...base,
      difference: differenceValue({ metric: "expirations", code: "IDENTITY_MISMATCH", delta: pair.identityMismatch.delta, skewMs, note: "catalog asset_id disagrees with the internal activeId; expirations are not compared" }),
      classification: CLASSIFICATION.NOT_COMPARABLE,
    });
  }
  if (!internal) {
    return makeRecord({
      ...base,
      difference: differenceValue({ metric: "expirations", code: "INTERNAL_EXPIRATIONS_NOT_EXPOSED", skewMs, note: "office market has no expirations[]; boolean is_open is not a substitute" }),
      classification: CLASSIFICATION.NOT_COMPARABLE,
    });
  }
  if (!mcp) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "expirations", code: "MCP_EXPIRATIONS_ABSENT", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }

  const internalOnly = internal.filter((value) => !mcp.includes(value));
  const mcpOnly = mcp.filter((value) => !internal.includes(value));
  if (internalOnly.length === 0 && mcpOnly.length === 0) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "expirations", code: "EXACT", skewMs }), classification: withStale(CLASSIFICATION.MATCH, skewMs, context.staleSkewMs) });
  }
  return makeRecord({
    ...base,
    difference: differenceValue({ metric: "expirations", code: "SET_MISMATCH", delta: internalOnly.length + mcpOnly.length, skewMs, note: `internalOnly=${internalOnly.length} mcpOnly=${mcpOnly.length}` }),
    classification: withStale(CLASSIFICATION.CONFLICT, skewMs, context.staleSkewMs),
  });
}

/**
 * `is_open` only validates OPEN. Other internal states (DISABLED, SUSPENDED,
 * NOT_OFFERED, UNKNOWN) are labeled boolean-only and stay NOT_COMPARABLE — the
 * boolean never becomes a fabricated state.
 */
function availabilityRecord(pair, context) {
  const skewMs = skewBetween(context.sourceTimestamp, context.mcpTimestamp);
  const state = pair.market.availability === undefined || pair.market.availability === null ? null : String(pair.market.availability).toUpperCase();
  const isOpen = typeof pair.asset?.is_open === "boolean" ? pair.asset.is_open : null;
  const base = {
    timestamp: context.timestamp,
    marketKey: pair.marketKey,
    field: FIELD.AVAILABILITY,
    currentValue: state,
    mcpValue: isOpen,
    sourceTimestamp: context.sourceTimestamp,
  };

  if (!pair.asset || pair.conflict) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "availability", code: "NO_MCP_COUNTERPART", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  if (pair.identityMismatch) {
    return makeRecord({
      ...base,
      difference: differenceValue({ metric: "availability", code: "IDENTITY_MISMATCH", delta: pair.identityMismatch.delta, skewMs, note: "catalog asset_id disagrees with the internal activeId; availability is not compared" }),
      classification: CLASSIFICATION.NOT_COMPARABLE,
    });
  }
  if (state === null || !AVAILABILITY_STATES.includes(state)) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "availability", code: "UNKNOWN_INTERNAL_STATE", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  if (isOpen === null) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "availability", code: "IS_OPEN_ABSENT", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  if (state === "OPEN") {
    const matches = isOpen === true;
    return makeRecord({
      ...base,
      difference: differenceValue({ metric: "availability", code: matches ? "OPEN_AND_IS_OPEN_TRUE" : "OPEN_BUT_IS_OPEN_FALSE", skewMs }),
      classification: withStale(matches ? CLASSIFICATION.MATCH : CLASSIFICATION.CONFLICT, skewMs, context.staleSkewMs),
    });
  }
  return makeRecord({
    ...base,
    difference: differenceValue({
      metric: "availability",
      code: "BOOLEAN_ONLY",
      skewMs,
      note: `is_open=${isOpen} cannot validate state ${state}; no state was fabricated from the boolean`,
    }),
    classification: CLASSIFICATION.NOT_COMPARABLE,
  });
}

function accountBalanceRecord(internal, mcp, context, skewMs) {
  const base = {
    timestamp: context.timestamp,
    marketKey: ACCOUNT_SCOPE,
    field: FIELD.ACCOUNT,
    sourceTimestamp: context.sourceTimestamp,
  };
  const currentValue = internal?.balance ?? null;
  const mcpValue = mcp?.training ? asNumber(mcp.training.amount) : null;
  if (currentValue === null || mcpValue === null) {
    return makeRecord({
      ...base,
      currentValue,
      mcpValue,
      difference: differenceValue({ metric: "balance", code: currentValue === null ? "PRACTICE_BALANCE_ABSENT" : "TRAINING_BALANCE_ABSENT", skewMs }),
      classification: CLASSIFICATION.NOT_COMPARABLE,
    });
  }
  const delta = currentValue - mcpValue;
  const classification = classifyNumeric(currentValue, mcpValue, BALANCE_TOLERANCE);
  return makeRecord({
    ...base,
    currentValue,
    mcpValue,
    difference: differenceValue({ metric: "balance", code: delta === 0 ? "EXACT" : "DELTA", delta, skewMs }),
    classification: withStale(classification, skewMs, context.staleSkewMs),
  });
}

function accountCurrencyRecord(internal, mcp, context, skewMs) {
  const currentValue = internal?.currency ?? null;
  const mcpValue = mcp?.training?.currency ? String(mcp.training.currency).toUpperCase() : null;
  const base = {
    timestamp: context.timestamp,
    marketKey: ACCOUNT_SCOPE,
    field: FIELD.ACCOUNT,
    currentValue,
    mcpValue,
    sourceTimestamp: context.sourceTimestamp,
  };
  if (currentValue === null || mcpValue === null) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "currency", code: currentValue === null ? "PRACTICE_CURRENCY_ABSENT" : "TRAINING_CURRENCY_ABSENT", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  const matches = currentValue === mcpValue;
  return makeRecord({
    ...base,
    difference: differenceValue({ metric: "currency", code: matches ? "EXACT" : "CURRENCY_MISMATCH", skewMs }),
    classification: withStale(matches ? CLASSIFICATION.MATCH : CLASSIFICATION.CONFLICT, skewMs, context.staleSkewMs),
  });
}

function accountTypeRecord(internal, mcp, context, skewMs) {
  const expectedType = internal?.mode === "PRACTICE" ? "training" : internal?.mode === "REAL" ? "regular" : null;
  const presentTypes = (mcp?.balances ?? []).map((balance) => String(balance?.type ?? "").toLowerCase()).filter(Boolean);
  const base = {
    timestamp: context.timestamp,
    marketKey: ACCOUNT_SCOPE,
    field: FIELD.ACCOUNT,
    currentValue: expectedType,
    mcpValue: presentTypes,
    sourceTimestamp: context.sourceTimestamp,
  };
  if (!expectedType || presentTypes.length === 0) {
    return makeRecord({ ...base, difference: differenceValue({ metric: "type", code: "ACCOUNT_TYPE_UNDETERMINED", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  const matches = presentTypes.includes(expectedType);
  return makeRecord({
    ...base,
    difference: differenceValue({ metric: "type", code: matches ? "EXACT" : "EXPECTED_BALANCE_TYPE_MISSING", skewMs }),
    classification: withStale(matches ? CLASSIFICATION.MATCH : CLASSIFICATION.CONFLICT, skewMs, context.staleSkewMs),
  });
}

function accountModeRecord(internal, mcp, context, skewMs) {
  const currentValue = internal?.mode ?? null;
  const mcpValue = mcp?.mode ?? null;
  const base = {
    timestamp: context.timestamp,
    marketKey: ACCOUNT_SCOPE,
    field: FIELD.ACCOUNT,
    currentValue,
    mcpValue,
    sourceTimestamp: context.sourceTimestamp,
  };
  if (!currentValue || !mcpValue || mcpValue === "UNKNOWN") {
    return makeRecord({ ...base, difference: differenceValue({ metric: "mode", code: "MODE_UNDETERMINED", skewMs }), classification: CLASSIFICATION.NOT_COMPARABLE });
  }
  const mixedConsistent = mcpValue === "MIXED" && (currentValue === "PRACTICE" || currentValue === "REAL");
  const matches = currentValue === mcpValue || mixedConsistent;
  return makeRecord({
    ...base,
    difference: differenceValue({ metric: "mode", code: matches ? (mixedConsistent ? "MIXED_CONSISTENT" : "EXACT") : "MODE_MISMATCH", skewMs }),
    classification: withStale(matches ? CLASSIFICATION.MATCH : CLASSIFICATION.CONFLICT, skewMs, context.staleSkewMs),
  });
}

function accountRecords(account, mcpAccount, context) {
  const internal = normalizeInternalAccount(account);
  const mcp = normalizeMcpAccount(mcpAccount);
  const accountTimestamp = internal?.at ?? context.sourceTimestamp;
  const skewMs = skewBetween(accountTimestamp, context.mcpTimestamp);
  return [
    accountBalanceRecord(internal, mcp, context, skewMs),
    accountCurrencyRecord(internal, mcp, context, skewMs),
    accountTypeRecord(internal, mcp, context, skewMs),
    accountModeRecord(internal, mcp, context, skewMs),
  ].map((record) => withSourceFreshness(record, accountTimestamp));
}

/**
 * Builds one comparison record per market x field, plus four ACCOUNT records.
 * Pure function: same inputs -> same records (given the same `now`).
 */
export function buildComparisons({
  markets = [],
  mcpAssets = [],
  account = null,
  mcpAccount = null,
  sourceTimestamp = null,
  mcpTimestamp = null,
  now = Date.now(),
  staleSkewMs = STALE_SKEW_MS,
  includeLeftoverAssets = false,
} = {}) {
  const timestamp = asNumber(now) ?? Date.now();
  const context = {
    timestamp,
    sourceTimestamp: asNumber(sourceTimestamp),
    mcpTimestamp: asNumber(mcpTimestamp) ?? timestamp,
    staleSkewMs: asNumber(staleSkewMs) ?? STALE_SKEW_MS,
  };

  const { pairs, leftovers } = pairMarkets(markets, mcpAssets);
  const records = [];
  for (const pair of pairs) {
    records.push(withSourceFreshness(catalogRecord(pair, context), context.sourceTimestamp, { preserveConflict: true }));
    records.push(withSourceFreshness(payoutRecord(pair, context), context.sourceTimestamp));
    records.push(withSourceFreshness(expirationRecord(pair, context), context.sourceTimestamp));
    records.push(withSourceFreshness(availabilityRecord(pair, context), context.sourceTimestamp));
  }
  if (includeLeftoverAssets) {
    for (const leftover of leftovers) records.push(leftoverCatalogRecord(leftover, context));
  }
  records.push(...accountRecords(account, mcpAccount, context));
  return records;
}

/**
 * Per-field classification counts. Agreement = (MATCH + MINOR_DIFFERENCE) /
 * comparable, where comparable = MATCH + MINOR_DIFFERENCE + CONFLICT.
 * STALE_SOURCE and NOT_COMPARABLE are excluded from the denominator.
 */
export function summarize(records = []) {
  const counts = {
    [CLASSIFICATION.MATCH]: 0,
    [CLASSIFICATION.MINOR_DIFFERENCE]: 0,
    [CLASSIFICATION.CONFLICT]: 0,
    [CLASSIFICATION.NOT_COMPARABLE]: 0,
    [CLASSIFICATION.STALE_SOURCE]: 0,
  };
  const perField = {};

  for (const record of records ?? []) {
    const field = String(record?.field ?? "UNKNOWN");
    const classification = String(record?.classification ?? "UNKNOWN");
    if (counts[classification] === undefined) counts[classification] = 0;
    counts[classification] += 1;

    if (!perField[field]) perField[field] = { total: 0, counts: {}, comparable: 0, agreementRate: 0 };
    const bucket = perField[field];
    bucket.total += 1;
    bucket.counts[classification] = (bucket.counts[classification] ?? 0) + 1;
  }

  const comparableOf = (bucket) =>
    (bucket.counts[CLASSIFICATION.MATCH] ?? 0) + (bucket.counts[CLASSIFICATION.MINOR_DIFFERENCE] ?? 0) + (bucket.counts[CLASSIFICATION.CONFLICT] ?? 0);
  const rateOf = (bucket) =>
    bucket.comparable ? round4(((bucket.counts[CLASSIFICATION.MATCH] ?? 0) + (bucket.counts[CLASSIFICATION.MINOR_DIFFERENCE] ?? 0)) / bucket.comparable) : 0;

  for (const bucket of Object.values(perField)) {
    bucket.comparable = comparableOf(bucket);
    bucket.agreementRate = rateOf(bucket);
  }

  const comparable = Object.values(perField).reduce((sum, bucket) => sum + bucket.comparable, 0);
  const agreed = counts[CLASSIFICATION.MATCH] + counts[CLASSIFICATION.MINOR_DIFFERENCE];
  return {
    total: Array.isArray(records) ? records.length : 0,
    comparable,
    notComparable: counts[CLASSIFICATION.NOT_COMPARABLE],
    stale: counts[CLASSIFICATION.STALE_SOURCE],
    counts,
    agreementRate: comparable ? round4(agreed / comparable) : 0,
    perField,
  };
}

function historyIo(fsImpl) {
  const overrides = fsImpl && typeof fsImpl === "object" ? fsImpl : {};
  return { appendFile, mkdir, open, rename, stat, writeFile, ...overrides };
}

/** Reads at most `maxBytes` from the END of a file (drops a cut first line). */
async function readTailText(path, io, maxBytes) {
  const info = await io.stat(path);
  const size = Math.max(0, Math.trunc(Number(info?.size) || 0));
  if (size === 0) return "";
  const byteCap = Math.max(1, Math.trunc(Number(maxBytes) || DEFAULT_MAX_HISTORY_BYTES));
  const start = Math.max(0, size - byteCap);
  const length = size - start;
  const handle = await io.open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const chunk = await handle.read(buffer, offset, length - offset, start + offset);
      if (!chunk || !Number.isFinite(chunk.bytesRead) || chunk.bytesRead <= 0) break;
      offset += chunk.bytesRead;
    }
    let text = buffer.subarray(0, offset).toString("utf8");
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    return text;
  } finally {
    await handle.close();
  }
}

/** Keeps the last `maxRecords` complete lines, then the last `maxBytes` bytes. */
function trimHistoryPayload(text, maxBytes, maxRecords) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  const recordCap = Math.max(1, Math.trunc(Number(maxRecords) || DEFAULT_MAX_HISTORY_RECORDS));
  let kept = lines.slice(-recordCap);
  const byteCap = Math.max(1, Math.trunc(Number(maxBytes) || DEFAULT_MAX_HISTORY_BYTES));
  while (kept.length > 1 && Buffer.byteLength(`${kept.join("\n")}\n`, "utf8") > byteCap) kept = kept.slice(1);
  return kept.length ? `${kept.join("\n")}\n` : "";
}

/** Rewrites the JSONL tail-in-place when the file exceeds `maxBytes`. */
async function rotateHistory(path, io, maxBytes, maxRecords) {
  const info = await io.stat(path);
  const size = Number(info?.size) || 0;
  if (size <= maxBytes) return false;
  const tail = await readTailText(path, io, maxBytes);
  const payload = trimHistoryPayload(tail, maxBytes, maxRecords);
  const tmp = `${path}.rotating`;
  await io.writeFile(tmp, payload, "utf8");
  await io.rename(tmp, path);
  return true;
}

/**
 * Appends records as JSONL (one JSON object per line), creating the dir, then
 * rotates the file when it exceeds `maxBytes` (keeps the last `maxRecords`).
 */
export async function persistRecords(
  records,
  { path = DEFAULT_RECONCILIATION_PATH, fsImpl = null, maxBytes = DEFAULT_MAX_HISTORY_BYTES, maxRecords = DEFAULT_MAX_HISTORY_RECORDS } = {},
) {
  const list = Array.isArray(records) ? records : [records];
  if (list.length === 0) return { path, written: 0 };
  const io = historyIo(fsImpl);
  const dir = dirname(path);
  if (dir && dir !== ".") await io.mkdir(dir, { recursive: true });
  const payload = `${list.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await io.appendFile(path, payload, "utf8");
  try {
    await rotateHistory(path, io, maxBytes, maxRecords);
  } catch {
    /* append already succeeded; rotation is best-effort maintenance */
  }
  return { path, written: list.length };
}

/**
 * Reads back JSONL history from a bounded tail (`maxBytes`, default 2 MiB);
 * corrupt/blank lines are skipped. `limit` keeps the last N parsed records.
 */
export async function loadHistory({ path = DEFAULT_RECONCILIATION_PATH, limit = 0, maxBytes = DEFAULT_MAX_HISTORY_BYTES, fsImpl = null } = {}) {
  const io = historyIo(fsImpl);
  let text = "";
  try {
    text = await readTailText(path, io, maxBytes);
  } catch {
    return [];
  }
  const records = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      /* corrupt line is skipped, never thrown */
    }
  }
  const n = Math.max(0, Math.trunc(Number(limit) || 0));
  return n > 0 ? records.slice(-n) : records;
}



