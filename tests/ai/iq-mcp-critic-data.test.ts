/**
 * IQ MCP reconciliation — fresh-critic adversarial data tests.
 *
 * Proves: NORMAL/OTC can never cross-pair (even with identical canonical,
 * symbol, display, payout and is_open); wrong-but-plausible identities are
 * CONFLICT/NOT_COMPARABLE; `is_open` never becomes a 5-state; payout is exact;
 * missing timestamps are NOT_COMPARABLE; results are deterministic.
 *
 * Zero network, zero orders.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error - runtime ESM module without type declarations
import { AVAILABILITY_STATES, CLASSIFICATION, STALE_SKEW_MS, buildComparisons } from "../../relay/iq-mcp/reconciliation.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import { IQOfficialMCPAdapter } from "../../relay/iq-mcp/adapter.mjs";

type Rec = { [key: string]: any };

const NOW = 1_789_700_000_000;

const MARKET_NORMAL: Rec = { marketKey: "EURUSD:NORMAL", canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "NORMAL", availability: "OPEN", payout: 85, activeId: 80, expirations: [1, 2] };
const MARKET_OTC: Rec = { marketKey: "EURUSD:OTC", canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "OTC", availability: "OPEN", payout: 85, activeId: 76, expirations: [1, 2] };

/* Identical payout + is_open on purpose: only identity can prove the pairing. */
const ASSET_OTC: Rec = { asset_id: 76, name: "EUR/USD (OTC)", is_open: true, profit_percent: 85, expirations: [1, 2] };
const ASSET_NORMAL: Rec = { asset_id: 80, name: "EUR/USD", is_open: true, profit_percent: 85, expirations: [1, 2] };

const ACCOUNT: Rec = { at: NOW, mode: "PRACTICE", modeState: { practice: { balance: 1000, currency: "USD" } } };
const MCP_ACCOUNT: Rec = { balances: [{ balance_id: 2, type: "training", currency: "USD", amount: 1000 }] };

function run(overrides: Record<string, unknown> = {}): Rec[] {
  return buildComparisons({
    markets: [MARKET_NORMAL, MARKET_OTC],
    mcpAssets: [ASSET_NORMAL, ASSET_OTC],
    account: ACCOUNT,
    mcpAccount: MCP_ACCOUNT,
    sourceTimestamp: NOW,
    mcpTimestamp: NOW,
    now: NOW,
    ...overrides,
  }) as Rec[];
}

function field(records: Rec[], marketKey: string, name: string): Rec {
  const record = records.find((row) => row.marketKey === marketKey && row.field === name);
  expect(record, `${marketKey}/${name}`).toBeDefined();
  return record as Rec;
}

describe("critic — NORMAL/OTC isolation is identity, not values", () => {
  it("pairs identical canonical/symbol/display/labels only by marketKey + asset_id", () => {
    const records = run();
    const normal = field(records, "EURUSD:NORMAL", "CATALOG");
    const otc = field(records, "EURUSD:OTC", "CATALOG");

    expect(normal.classification).toBe("MATCH");
    expect(normal.mcpValue.assetId).toBe(80);
    expect(normal.mcpValue.marketType).toBe("NORMAL");
    expect(otc.classification).toBe("MATCH");
    expect(otc.mcpValue.assetId).toBe(76);
    expect(otc.mcpValue.marketType).toBe("OTC");

    expect(records.some((row) => row.marketKey === "EURUSD:OTC" && row.mcpValue?.assetId === 80)).toBe(false);
    expect(records.some((row) => row.marketKey === "EURUSD:NORMAL" && row.mcpValue?.assetId === 76)).toBe(false);
    expect(field(records, "EURUSD:OTC", "PAYOUT").classification).toBe("MATCH");
    expect(field(records, "EURUSD:NORMAL", "PAYOUT").classification).toBe("MATCH");
  });

  it("derives OTC from the display/symbol marker when marketType is absent (regression)", () => {
    const markerOnly: Rec = { canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD (OTC)", availability: "OPEN", payout: 85, activeId: 76, expirations: [1, 2] };
    const records = run({ markets: [markerOnly] });
    const catalog = field(records, "EURUSD:OTC", "CATALOG");
    expect(catalog.classification).toBe("MATCH");
    expect(catalog.mcpValue.assetId).toBe(76);
    expect(records.some((row) => row.marketKey === "EURUSD:NORMAL")).toBe(false);
  });

  it("treats a marketKey/marketType contradiction as CONFLICT with no pair (never a cross-match)", () => {
    const contradictory: Rec = { marketKey: "EURUSD:NORMAL", canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD (OTC)", marketType: "OTC", availability: "OPEN", payout: 85, activeId: 76, expirations: [1, 2] };
    const records = run({ markets: [contradictory] });
    const catalog = field(records, "EURUSD:NORMAL", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toBe("MARKET_KEY_TYPE_CONFLICT");
    expect(catalog.mcpValue).toBeNull();
    expect(field(records, "EURUSD:NORMAL", "PAYOUT").classification).toBe("NOT_COMPARABLE");
    expect(field(records, "EURUSD:NORMAL", "AVAILABILITY").classification).toBe("NOT_COMPARABLE");
  });

  it("treats a canonical contradiction as CONFLICT", () => {
    const contradictory: Rec = { marketKey: "GBPUSD:OTC", canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD (OTC)", marketType: "OTC", availability: "OPEN", payout: 85, activeId: 76, expirations: [1, 2] };
    const records = run({ markets: [contradictory] });
    const catalog = field(records, "GBPUSD:OTC", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toBe("MARKET_KEY_CANONICAL_CONFLICT");
    expect(catalog.mcpValue).toBeNull();
    expect(records.some((row) => row.mcpValue?.assetId === 76)).toBe(false);
  });

  it("treats marketType NORMAL + OTC marker as an evidence conflict without a key", () => {
    const contradictory: Rec = { canonical: "EURUSD", symbol: "EUR/USD (OTC)", display: "EUR/USD (OTC)", marketType: "NORMAL", availability: "OPEN", payout: 85, activeId: 80 };
    const catalog = field(run({ markets: [contradictory] }), "EURUSD:NORMAL", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toBe("MARKET_TYPE_EVIDENCE_CONFLICT");
    expect(catalog.mcpValue).toBeNull();
  });

  it("normalizes whitespace and case in marketType instead of assuming NORMAL", () => {
    const sloppy: Rec = { canonical: "EURUSD", symbol: "EUR/USD", display: "EUR/USD", marketType: "  otc ", availability: "OPEN", payout: 85, activeId: 76, expirations: [1, 2] };
    const catalog = field(run({ markets: [sloppy] }), "EURUSD:OTC", "CATALOG");
    expect(catalog.classification).toBe("MATCH");
    expect(catalog.mcpValue.assetId).toBe(76);
  });

  it("never pairs the OTC market with an MCP asset that lacks the (OTC) suffix", () => {
    const assetWithoutSuffix: Rec = { asset_id: 76, name: "EUR/USD", is_open: true, profit_percent: 85, expirations: [1, 2] };
    const records = run({ mcpAssets: [assetWithoutSuffix] });
    const otc = field(records, "EURUSD:OTC", "CATALOG");
    expect(otc.classification).toBe("NOT_COMPARABLE");
    expect(otc.difference.code).toBe("NO_MCP_COUNTERPART");
    expect(otc.mcpValue).toBeNull();
    expect(field(records, "EURUSD:OTC", "PAYOUT").classification).toBe("NOT_COMPARABLE");
  });
});

describe("critic — wrong-but-plausible identities", () => {
  it("duplicate names with identical payout/is_open are AMBIGUOUS, never MATCH", () => {
    const duplicate: Rec[] = [ASSET_OTC, { ...ASSET_OTC, asset_id: 999 }];
    const records = run({ markets: [MARKET_OTC], mcpAssets: duplicate });
    const catalog = field(records, "EURUSD:OTC", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toBe("AMBIGUOUS_MCP_MATCH");
    for (const name of ["PAYOUT", "EXPIRATIONS", "AVAILABILITY"]) {
      expect(field(records, "EURUSD:OTC", name).classification).toBe("NOT_COMPARABLE");
    }
    expect(records.filter((row) => row.field !== "ACCOUNT").some((row) => row.classification === "MATCH")).toBe(false);
  });

  it("an explicit mcpAssetId crossing types is CONFLICT and its fields are not compared", () => {
    const crossed: Rec = { ...MARKET_NORMAL, mcpAssetId: 76 };
    const records = run({ markets: [crossed] });
    const catalog = field(records, "EURUSD:NORMAL", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toContain("MAPPED_ASSET_KEY_MISMATCH");
    expect(field(records, "EURUSD:NORMAL", "PAYOUT").classification).toBe("NOT_COMPARABLE");
  });

  it("an activeId/asset_id disagreement blocks value comparisons (regression)", () => {
    const stale: Rec = { ...MARKET_OTC, activeId: 999 };
    const records = run({ markets: [stale] });
    const catalog = field(records, "EURUSD:OTC", "CATALOG");
    expect(catalog.classification).toBe("CONFLICT");
    expect(catalog.difference.code).toBe("ASSET_ID_MISMATCH");
    expect(catalog.difference.delta).toBe(923);

    for (const name of ["PAYOUT", "EXPIRATIONS", "AVAILABILITY"]) {
      const record = field(records, "EURUSD:OTC", name);
      expect(record.classification).toBe("NOT_COMPARABLE");
      expect(record.difference.code).toBe("IDENTITY_MISMATCH");
    }
  });
});

describe("critic — is_open is a boolean, never the 5-state model", () => {
  it("never emits a state string for MCP availability and only OPEN true can MATCH", () => {
    expect([...AVAILABILITY_STATES]).toEqual(["OPEN", "DISABLED", "SUSPENDED", "NOT_OFFERED", "UNKNOWN"]);
    for (const state of AVAILABILITY_STATES) {
      for (const isOpen of [true, false]) {
        const records = run({
          markets: [{ ...MARKET_OTC, availability: state }],
          mcpAssets: [{ ...ASSET_OTC, is_open: isOpen }],
        });
        const record = field(records, "EURUSD:OTC", "AVAILABILITY");
        expect(typeof record.mcpValue === "boolean" || record.mcpValue === null, `${state}/${isOpen}`).toBe(true);
        expect(AVAILABILITY_STATES.includes(record.mcpValue)).toBe(false);

        if (state === "OPEN" && isOpen === true) expect(record.classification).toBe("MATCH");
        else if (state === "OPEN") expect(record.classification).toBe("CONFLICT");
        else {
          expect(record.classification).toBe("NOT_COMPARABLE");
          expect(record.difference.code).toBe("BOOLEAN_ONLY");
          expect(String(record.difference.note)).toContain("no state was fabricated");
        }
      }
    }
  });

  it("adapter getMarketStatus projection never emits the 5-state names", async () => {
    const assets = [
      { asset_id: 76, name: "EUR/USD (OTC)", is_open: true, profit_percent: 85 },
      { asset_id: 77, name: "EUR/GBP (OTC)", is_open: false, profit_percent: 87 },
      { asset_id: 78, name: "USD/JPY (OTC)", profit_percent: 88 },
    ];
    const fetchImpl = async (_url: string, init: { body?: string }) => {
      const req = JSON.parse(init.body ?? "{}");
      if (req.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "s" },
        });
      }
      if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: JSON.stringify({ assets }) }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const adapter = new IQOfficialMCPAdapter({ product: "binary", enabled: true, token: "t", fetchImpl });
    const status = await adapter.getMarketStatus();
    expect(status.ok).toBe(true);
    expect(status.data).toHaveLength(3);
    for (const row of status.data) {
      expect(["OPEN", "CLOSED", "NOT_OFFERED"]).toContain(row.status);
      expect(["DISABLED", "SUSPENDED", "UNKNOWN"]).not.toContain(row.status);
    }
    expect(status.data[0]).toMatchObject({ status: "OPEN", isOpen: true });
    expect(status.data[1]).toMatchObject({ status: "CLOSED", isOpen: false });
    expect(status.data[2]).toMatchObject({ status: "CLOSED", isOpen: null });

    const missing = await adapter.getMarketStatus(999);
    expect(missing.data).toEqual({ assetId: 999, status: "NOT_OFFERED" });
  });
});

describe("critic — payout is exact, tolerance is balance-only", () => {
  it.each([0.01, 0.1, 0.5, 0.9, 1])("payout delta %s stays CONFLICT (no tolerance leak)", (delta) => {
    const records = run({ markets: [{ ...MARKET_OTC, payout: 85 + delta }] });
    const payout = field(records, "EURUSD:OTC", "PAYOUT");
    expect(payout.classification).toBe("CONFLICT");
    expect(payout.difference.delta).toBeCloseTo(delta, 6);
    expect(payout.classification).not.toBe("MINOR_DIFFERENCE");
  });

  it("applies the same delta as MINOR only on the practice balance", () => {
    const records = run({
      account: { ...ACCOUNT, modeState: { practice: { balance: 1000, currency: "USD" } } },
      mcpAccount: { balances: [{ type: "training", currency: "USD", amount: 1000.5 }] },
    });
    const balance = records.find((row) => row.field === "ACCOUNT" && row.difference?.metric === "balance");
    expect(balance?.classification).toBe("MINOR_DIFFERENCE");
    expect(field(records, "EURUSD:OTC", "PAYOUT").classification).toBe("MATCH");
  });
});

describe("critic — sourceTimestamp handling", () => {
  it("downgrades every comparable record to NOT_COMPARABLE when the source timestamp is missing", () => {
    const records = run({ sourceTimestamp: null, account: null, mcpAccount: null });
    for (const name of ["CATALOG", "PAYOUT", "EXPIRATIONS", "AVAILABILITY"]) {
      const record = field(records, "EURUSD:OTC", name);
      expect(record.classification).toBe("NOT_COMPARABLE");
      expect(record.difference.code).toBe("SOURCE_TIMESTAMP_MISSING");
      expect(record.difference.skewMs).toBeNull();
    }
    expect(records.some((row) => ["MATCH", "MINOR_DIFFERENCE", "CONFLICT"].includes(row.classification))).toBe(false);
  });

  it("keeps account records comparable when the account carries its own timestamp", () => {
    const records = run({ sourceTimestamp: null });
    const balance = records.find((row) => row.field === "ACCOUNT" && row.difference?.metric === "balance");
    expect(balance?.classification).toBe("MATCH");
    expect(field(records, "EURUSD:OTC", "PAYOUT").classification).toBe("NOT_COMPARABLE");
  });

  it("fires STALE_SOURCE only past the 5 minute boundary", () => {
    const boundary = run({ sourceTimestamp: NOW - STALE_SKEW_MS, mcpTimestamp: NOW });
    expect(field(boundary, "EURUSD:OTC", "PAYOUT").classification).toBe("MATCH");

    const stale = run({ sourceTimestamp: NOW - STALE_SKEW_MS - 1, mcpTimestamp: NOW });
    expect(field(stale, "EURUSD:OTC", "PAYOUT").classification).toBe("STALE_SOURCE");
    expect(field(stale, "EURUSD:OTC", "PAYOUT").difference.skewMs).toBe(STALE_SKEW_MS + 1);
  });

  it("never upgrades a NOT_COMPARABLE record to STALE_SOURCE", () => {
    const records = run({ sourceTimestamp: NOW - STALE_SKEW_MS - 60_000, mcpTimestamp: NOW, markets: [{ ...MARKET_OTC, payout: null }] });
    const payout = field(records, "EURUSD:OTC", "PAYOUT");
    expect(payout.classification).toBe("NOT_COMPARABLE");
    expect(payout.difference.code).toBe("PAYOUT_ABSENT");
  });
});

describe("critic — determinism", () => {
  it("produces byte-identical records for identical inputs", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("changes only the timestamp field when `now` changes", () => {
    const strip = (records: Rec[]) => records.map(({ timestamp: _timestamp, ...rest }) => rest);
    const first = run({ now: NOW });
    const second = run({ now: NOW + 123_456 });
    expect(strip(second)).toEqual(strip(first));
    expect(second[0]?.timestamp).not.toBe(first[0]?.timestamp);
  });

  it("does not use Math.random anywhere in the comparison module", () => {
    const source = readFileSync(new URL("../../relay/iq-mcp/reconciliation.mjs", import.meta.url), "utf8");
    expect(source.includes("Math.random")).toBe(false);
  });
});
