/** IQ MCP reconciliation — pure comparison + JSONL persistence (mocked, no network, zero orders). */
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { BALANCE_TOLERANCE, CLASSIFICATION, DEFAULT_RECONCILIATION_PATH, FIELD, STALE_SKEW_MS, assetMarketKey, buildComparisons, classifyNumeric, loadHistory, normalizeCanonical, persistRecords, summarize } from "../../relay/iq-mcp/reconciliation.mjs";

type Rec = { [key: string]: any };

const NOW = 1_789_700_000_000;

const EURUSD_OTC: Rec = { marketKey: "EURUSD:OTC", canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "OTC", availability: "OPEN", payout: 85, activeId: 76, enabled: true };
const EURUSD_NORMAL: Rec = { marketKey: "EURUSD:NORMAL", canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "NORMAL", availability: "DISABLED", payout: 70, activeId: 80, enabled: false };
const GBPUSD_OTC: Rec = { marketKey: "GBPUSD:OTC", canonical: "GBPUSD", symbol: "GBP/USD", display: "GBP/USD", marketType: "OTC", availability: "OPEN", payout: 86, activeId: 81, enabled: true };

const ASSET_EURUSD_OTC: Rec = { asset_id: 76, name: "EUR/USD (OTC)", is_open: true, profit_percent: 85, precision: 6, expirations: [1789695000, 1789695900] };
const ASSET_EURUSD_NORMAL: Rec = { asset_id: 80, name: "EUR/USD", is_open: false, profit_percent: 70, precision: 6, expirations: [1789695000] };
const ASSET_GBPUSD_OTC: Rec = { asset_id: 81, name: "GBP/USD (OTC)", is_open: true, profit_percent: 86, precision: 6, expirations: [1789695000, 1789695900] };

const MARKETS: Rec[] = [EURUSD_OTC, EURUSD_NORMAL, GBPUSD_OTC];
const ASSETS: Rec[] = [ASSET_EURUSD_OTC, ASSET_EURUSD_NORMAL, ASSET_GBPUSD_OTC];

const ACCOUNT: Rec = { at: NOW, mode: "PRACTICE", modeState: { practice: { balance: 1000, currency: "USD" }, realMode: { realModeEnabled: false } } };
const MCP_ACCOUNT: Rec = { balances: [{ balance_id: 1, type: "regular", currency: "BRL", amount: 0 }, { balance_id: 2, type: "training", currency: "USD", amount: 1000 }] };

function recordsFor(overrides: Record<string, unknown> = {}): Rec[] {
  return buildComparisons({
    markets: MARKETS,
    mcpAssets: ASSETS,
    account: ACCOUNT,
    mcpAccount: MCP_ACCOUNT,
    sourceTimestamp: NOW,
    mcpTimestamp: NOW,
    now: NOW,
    ...overrides,
  }) as Rec[];
}

function findRecord(records: Rec[], marketKey: string, field: string, metric?: string): Rec | undefined {
  return records.find(
    (record) => record.marketKey === marketKey && record.field === field && (metric === undefined || record.difference?.metric === metric),
  );
}

function one(records: Rec[], marketKey: string, field: string, metric?: string): Rec {
  const record = findRecord(records, marketKey, field, metric);
  expect(record).toBeDefined();
  return record as Rec;
}

function withPayout(assetId: number, payout: number): Rec[] {
  return ASSETS.map((asset) => (asset.asset_id === assetId ? { ...asset, profit_percent: payout } : asset));
}

describe("IQ MCP reconciliation — catalog", () => {
  it("matches markets to assets by canonical + type and keeps the MCP asset_id", () => {
    const records = recordsFor();
    const otc = one(records, "EURUSD:OTC", "CATALOG");
    expect(otc.classification).toBe("MATCH");
    expect(otc.currentValue.marketKey).toBe("EURUSD:OTC");
    expect(otc.mcpValue.assetId).toBe(76);
    expect(otc.mcpValue.marketType).toBe("OTC");
    expect(otc.mcpValue.canonical).toBe("EURUSD");

    const normal = one(records, "EURUSD:NORMAL", "CATALOG");
    expect(normal.classification).toBe("MATCH");
    expect(normal.mcpValue.assetId).toBe(80);
    expect(normal.mcpValue.marketType).toBe("NORMAL");
  });

  it("never pairs EURUSD:OTC with the NORMAL asset (NORMAL/OTC isolation)", () => {
    const records = recordsFor();
    expect(records.some((record) => record.marketKey === "EURUSD:OTC" && record.mcpValue?.assetId === 80)).toBe(false);
    expect(records.some((record) => record.marketKey === "EURUSD:NORMAL" && record.mcpValue?.assetId === 76)).toBe(false);
    expect(one(records, "EURUSD:OTC", "PAYOUT").mcpValue).toBe(85);
    expect(one(records, "EURUSD:NORMAL", "PAYOUT").mcpValue).toBe(70);
  });

  it("is NOT_COMPARABLE (no fabricated values) when MCP has no counterpart", () => {
    const records = recordsFor({ mcpAssets: [ASSET_EURUSD_NORMAL] });
    const otc = one(records, "EURUSD:OTC", "CATALOG");
    expect(otc.classification).toBe("NOT_COMPARABLE");
    expect(otc.mcpValue).toBeNull();
    expect(otc.difference.code).toBe("NO_MCP_COUNTERPART");
    expect(one(records, "GBPUSD:OTC", "PAYOUT").classification).toBe("NOT_COMPARABLE");
  });

  it("flags CONFLICT when an explicit mcpAssetId maps to the wrong market type", () => {
    const markets = [{ ...EURUSD_NORMAL, mcpAssetId: 76 }];
    const catalog = one(recordsFor({ markets, mcpAssets: ASSETS }), "EURUSD:NORMAL", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toContain("MAPPED_ASSET_KEY_MISMATCH");

    const missing = recordsFor({ markets: [{ ...EURUSD_OTC, mcpAssetId: 9999 }], mcpAssets: ASSETS });
    expect(one(missing, "EURUSD:OTC", "CATALOG").difference.code).toBe("MAPPED_ASSET_ID_MISSING");
  });

  it("flags CONFLICT when the internal activeId disagrees with the MCP asset_id", () => {
    const catalog = one(recordsFor({ markets: [{ ...EURUSD_OTC, activeId: 999 }] }), "EURUSD:OTC", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toBe("ASSET_ID_MISMATCH");
    expect(catalog.difference.delta).toBe(923);
  });

  it("lists MCP-only assets as NOT_COMPARABLE when explicitly requested", () => {
    const extra: Rec = { asset_id: 500, name: "US 500", is_open: true, profit_percent: 91, expirations: [] };
    const records = recordsFor({ includeLeftoverAssets: true, mcpAssets: [...ASSETS, extra] });
    const leftover = one(records, "US500:NORMAL", "CATALOG");
    expect(leftover.classification).toBe("NOT_COMPARABLE");
    expect(leftover.currentValue).toBeNull();
    expect(leftover.difference.code).toBe("NO_INTERNAL_COUNTERPART");
    expect(records.filter((record) => record.field === "CATALOG")).toHaveLength(MARKETS.length + 1);
  });
});

describe("IQ MCP reconciliation — payout (exact, no tolerance)", () => {
  it("MATCH on identical payout", () => {
    const payout = one(recordsFor(), "EURUSD:OTC", "PAYOUT");
    expect(payout.classification).toBe("MATCH");
    expect(payout.currentValue).toBe(85);
    expect(payout.mcpValue).toBe(85);
    expect(payout.difference.delta).toBe(0);
  });

  it("CONFLICT when payout differs even by one point", () => {
    const payout = one(recordsFor({ mcpAssets: withPayout(76, 86) }), "EURUSD:OTC", "PAYOUT");
    expect(payout.classification).toBe("CONFLICT");
    expect(payout.difference.delta).toBe(-1);
  });

  it("NOT_COMPARABLE when either side has no payout", () => {
    const payout = one(recordsFor({ markets: [{ ...EURUSD_OTC, payout: null }] }), "EURUSD:OTC", "PAYOUT");
    expect(payout.classification).toBe("NOT_COMPARABLE");
    expect(payout.difference.code).toBe("PAYOUT_ABSENT");
  });
});

describe("IQ MCP reconciliation — expirations", () => {
  it("NOT_COMPARABLE while the internal side does not expose expirations[]", () => {
    const record = one(recordsFor(), "EURUSD:OTC", "EXPIRATIONS");
    expect(record.classification).toBe("NOT_COMPARABLE");
    expect(record.currentValue).toBeNull();
    expect(record.mcpValue.length).toBeGreaterThan(0);
    expect(record.difference.code).toBe("INTERNAL_EXPIRATIONS_NOT_EXPOSED");
    expect(record.difference.note).toContain("not a substitute");
  });

  it("MATCH on identical sets and CONFLICT on mismatch when both sides expose them", () => {
    const markets = [{ ...EURUSD_OTC, expirations: [1789695000, 1789695900] }];
    const match = one(recordsFor({ markets }), "EURUSD:OTC", "EXPIRATIONS");
    expect(match.classification).toBe("MATCH");

    const assets = withPayout(76, 85).map((asset) => (asset.asset_id === 76 ? { ...asset, expirations: [1789695000] } : asset));
    const conflict = one(recordsFor({ markets, mcpAssets: assets }), "EURUSD:OTC", "EXPIRATIONS");
    expect(conflict.classification).toBe("CONFLICT");
    expect(conflict.difference.code).toBe("SET_MISMATCH");
    expect(conflict.difference.note).toContain("internalOnly=1");
  });
});

describe("IQ MCP reconciliation — availability (boolean is never a 5-state)", () => {
  it("OPEN + is_open true = MATCH; OPEN + is_open false = CONFLICT", () => {
    expect(one(recordsFor(), "EURUSD:OTC", "AVAILABILITY").classification).toBe("MATCH");
    const assets = ASSETS.map((asset) => (asset.asset_id === 76 ? { ...asset, is_open: false } : asset));
    const conflict = one(recordsFor({ mcpAssets: assets }), "EURUSD:OTC", "AVAILABILITY");
    expect(conflict.classification).toBe("CONFLICT");
    expect(conflict.difference.code).toBe("OPEN_BUT_IS_OPEN_FALSE");
  });

  it("keeps non-OPEN states NOT_COMPARABLE and exposes the raw boolean, not a state", () => {
    const disabled = one(recordsFor(), "EURUSD:NORMAL", "AVAILABILITY");
    expect(disabled.classification).toBe("NOT_COMPARABLE");
    expect(disabled.currentValue).toBe("DISABLED");
    expect(disabled.mcpValue).toBe(false);
    expect(disabled.difference.code).toBe("BOOLEAN_ONLY");
    expect(disabled.mcpValue).not.toBe("DISABLED");
  });

  it("does not fabricate OPEN from is_open=true when the internal state is SUSPENDED", () => {
    const markets = [{ ...EURUSD_OTC, availability: "SUSPENDED" }];
    const record = one(recordsFor({ markets }), "EURUSD:OTC", "AVAILABILITY");
    expect(record.classification).toBe("NOT_COMPARABLE");
    expect(record.currentValue).toBe("SUSPENDED");
    expect(record.mcpValue).toBe(true);
    expect(record.difference.note).toContain("no state was fabricated");
  });
});

describe("IQ MCP reconciliation — account", () => {
  it("balance MATCH exact, MINOR within tolerance, CONFLICT beyond it", () => {
    expect(one(recordsFor(), "ACCOUNT", "ACCOUNT", "balance").classification).toBe("MATCH");

    const minor = recordsFor({ mcpAccount: { balances: [{ type: "training", currency: "USD", amount: 1000.5 }] } });
    expect(one(minor, "ACCOUNT", "ACCOUNT", "balance").classification).toBe("MINOR_DIFFERENCE");

    const overAbsolute = recordsFor({ mcpAccount: { balances: [{ type: "training", currency: "USD", amount: 1002 }] } });
    expect(one(overAbsolute, "ACCOUNT", "ACCOUNT", "balance").classification).toBe("CONFLICT");

    const tenDollars: Rec = { at: NOW, mode: "PRACTICE", modeState: { practice: { balance: 10, currency: "USD" } } };
    const overRatio = recordsFor({ account: tenDollars, mcpAccount: { balances: [{ type: "training", currency: "USD", amount: 10.5 }] } });
    expect(one(overRatio, "ACCOUNT", "ACCOUNT", "balance").classification).toBe("CONFLICT");
  });

  it("currency and balance type must agree with the training balance", () => {
    const records = recordsFor();
    expect(one(records, "ACCOUNT", "ACCOUNT", "currency").classification).toBe("MATCH");
    expect(one(records, "ACCOUNT", "ACCOUNT", "type").classification).toBe("MATCH");

    const wrongCurrency = recordsFor({ mcpAccount: { balances: [{ type: "training", currency: "BRL", amount: 1000 }] } });
    expect(one(wrongCurrency, "ACCOUNT", "ACCOUNT", "currency").classification).toBe("CONFLICT");

    const realMode = recordsFor({ account: { ...ACCOUNT, mode: "REAL" }, mcpAccount: { balances: [{ type: "training", currency: "USD", amount: 1000 }] } });
    expect(one(realMode, "ACCOUNT", "ACCOUNT", "type").classification).toBe("CONFLICT");
    expect(one(realMode, "ACCOUNT", "ACCOUNT", "mode").classification).toBe("CONFLICT");
  });

  it("mode accepts MIXED when the required balance type is present", () => {
    const mixed = recordsFor();
    const mode = one(mixed, "ACCOUNT", "ACCOUNT", "mode");
    expect(mode.classification).toBe("MATCH");
    expect(mode.difference.code).toBe("MIXED_CONSISTENT");
    expect(one(mixed, "ACCOUNT", "ACCOUNT", "type").classification).toBe("MATCH");
  });

  it("is NOT_COMPARABLE when the MCP account is missing", () => {
    const records = recordsFor({ mcpAccount: null });
    for (const metric of ["balance", "currency", "type", "mode"]) {
      expect(one(records, "ACCOUNT", "ACCOUNT", metric).classification).toBe("NOT_COMPARABLE");
    }
  });
});

describe("IQ MCP reconciliation — staleness", () => {
  it("marks comparable records STALE_SOURCE when source skew > 5 minutes", () => {
    const aged = NOW - STALE_SKEW_MS - 60_000;
    const stale = recordsFor({ sourceTimestamp: aged, mcpTimestamp: NOW, account: { ...ACCOUNT, at: aged } });
    const payout = one(stale, "EURUSD:OTC", "PAYOUT");
    expect(payout.classification).toBe("STALE_SOURCE");
    expect(payout.difference.skewMs).toBeGreaterThan(STALE_SKEW_MS);
    expect(one(stale, "EURUSD:OTC", "CATALOG").classification).toBe("STALE_SOURCE");
    expect(one(stale, "ACCOUNT", "ACCOUNT", "balance").classification).toBe("STALE_SOURCE");
    expect(one(stale, "EURUSD:OTC", "EXPIRATIONS").classification).toBe("NOT_COMPARABLE");
  });

  it("stays fresh inside the 5 minute window", () => {
    const fresh = recordsFor({ sourceTimestamp: NOW - STALE_SKEW_MS + 1000, mcpTimestamp: NOW });
    expect(one(fresh, "EURUSD:OTC", "PAYOUT").classification).toBe("MATCH");
  });
});

describe("IQ MCP reconciliation — summarize", () => {
  it("computes per-field counts and agreement = (MATCH + MINOR) / comparable", () => {
    const synthetic: Rec[] = [
      { field: "PAYOUT", classification: "MATCH" },
      { field: "PAYOUT", classification: "MINOR_DIFFERENCE" },
      { field: "PAYOUT", classification: "CONFLICT" },
      { field: "PAYOUT", classification: "NOT_COMPARABLE" },
      { field: "CATALOG", classification: "MATCH" },
      { field: "CATALOG", classification: "STALE_SOURCE" },
    ];
    const summary = summarize(synthetic);
    expect(summary.total).toBe(6);
    expect(summary.comparable).toBe(4);
    expect(summary.agreementRate).toBe(0.75);
    expect(summary.counts.MATCH).toBe(2);
    expect(summary.counts.STALE_SOURCE).toBe(1);
    expect(summary.notComparable).toBe(1);
    expect(summary.perField.PAYOUT.total).toBe(4);
    expect(summary.perField.PAYOUT.comparable).toBe(3);
    expect(summary.perField.PAYOUT.agreementRate).toBeCloseTo(0.6667, 4);
    expect(summary.perField.CATALOG.comparable).toBe(1);
    expect(summary.perField.CATALOG.agreementRate).toBe(1);
  });

  it("summarizes a real run without dropping fields", () => {
    const summary = summarize(recordsFor());
    expect(summary.total).toBe(16);
    for (const field of ["CATALOG", "PAYOUT", "EXPIRATIONS", "AVAILABILITY", "ACCOUNT"]) {
      expect(summary.perField[field]).toBeDefined();
    }
    expect(summary.agreementRate).toBeGreaterThan(0);
    expect(summary.agreementRate).toBeLessThanOrEqual(1);
  });
});

describe("IQ MCP reconciliation — persistence", () => {
  it("appends JSONL and round-trips through loadHistory (corrupt lines skipped)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-mcp-recon-"));
    const file = join(dir, "nested", "reconciliation.jsonl");
    try {
      const records = recordsFor();
      const first = await persistRecords(records.slice(0, 3), { path: file });
      expect(first).toEqual({ path: file, written: 3 });
      const second = await persistRecords(records.slice(3, 5), { path: file });
      expect(second.written).toBe(2);

      const loaded = await loadHistory({ path: file });
      expect(loaded).toHaveLength(5);
      expect(loaded[0]).toEqual(records[0]);
      expect(loaded[4]).toEqual(records[4]);

      const lastTwo = await loadHistory({ path: file, limit: 2 });
      expect(lastTwo).toHaveLength(2);
      expect(lastTwo[1]).toEqual(records[4]);

      await appendFile(file, "{corrupt-json\n\n", "utf8");
      expect(await loadHistory({ path: file })).toHaveLength(5);
      expect(await loadHistory({ path: join(dir, "missing.jsonl") })).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exposes the default diagnostic path and pure helpers", () => {
    expect(DEFAULT_RECONCILIATION_PATH).toBe("diagnostic-results/iq-mcp-reconciliation.jsonl");
    expect(normalizeCanonical("EUR/USD (OTC)")).toBe("EURUSD");
    expect(normalizeCanonical("US 500")).toBe("US500");
    expect(assetMarketKey({ name: "US 500" })).toBe("US500:NORMAL");
    expect(classifyNumeric(10, 10.5, BALANCE_TOLERANCE)).toBe("CONFLICT");
    expect(classifyNumeric(1000, 1000.5, BALANCE_TOLERANCE)).toBe("MINOR_DIFFERENCE");
    expect(classifyNumeric(85, 86)).toBe("CONFLICT");
    expect(classifyNumeric(85, 85)).toBe("MATCH");
    expect(CLASSIFICATION.MATCH).toBe("MATCH");
    expect(FIELD.ACCOUNT).toBe("ACCOUNT");
  });
});


