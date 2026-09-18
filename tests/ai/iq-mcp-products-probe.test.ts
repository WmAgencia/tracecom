import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import * as productsProbe from "../../scripts/iq-mcp-products-probe.mjs";
// @ts-expect-error - runtime ESM module without type declarations
import { RISK, classifyTool } from "../../relay/iq-mcp/security.mjs";

const {
  PRODUCT_PLANS,
  PRODUCT_READ_ALLOWLISTS,
  assertAllowlistReadOnly,
  assertProbeToolAllowed,
  runProductsProbe,
  writeProbeArtifacts,
} = productsProbe;

const TOKEN = "PRODUCTS-PROBE-TEST-TOKEN-DO-NOT-LEAK";
const READ_RISKS = new Set([RISK.SAFE_READ, RISK.ACCOUNT_READ]);
const WRITE_TOOLS = [
  "place_trade",
  "place_market_order",
  "place_limit_order",
  "place_stop_order",
  "sell_position",
  "close_position",
  "cancel_pending_order",
  "change_position_stop_loss",
  "change_position_take_profit",
  "rollover_position",
];

type RpcRequest = { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
type ContentPayload = Record<string, unknown>;

function jsonRpc(id: number | undefined, result: ContentPayload) {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
}

function createMockFetch(handler: (req: RpcRequest) => ContentPayload) {
  const requests: RpcRequest[] = [];
  const fetchImpl = async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as RpcRequest;
    requests.push(req);
    const result = req.method === "initialize" ? { protocolVersion: "2024-11-05" } : handler(req);
    return {
      status: 200,
      headers: { get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify(jsonRpc(req.id, result)),
    };
  };
  return { fetchImpl, requests };
}

const digitalAllowlist = ["get_capabilities", "list_assets", "list_balances", "get_instruments"];
const digitalPlan = [
  { tool: "get_capabilities" },
  { tool: "list_assets" },
  { tool: "list_balances" },
  {
    tool: "get_instruments",
    resolve: (ctx: { assetId?: number }) => (ctx.assetId === undefined ? null : { asset_id: ctx.assetId }),
    skipReason: "NO_ASSET_ID_FROM_list_assets",
  },
];

afterEach(() => vi.restoreAllMocks());

describe("IQ MCP products probe — allowlists & gates", () => {
  it("keeps every per-server allowlist read-only (SAFE_READ/ACCOUNT_READ, no writer)", () => {
    for (const [server, allowlist] of Object.entries(PRODUCT_READ_ALLOWLISTS) as [string, string[]][]) {
      expect(allowlist.length, `${server} allowlist empty`).toBeGreaterThan(0);
      for (const tool of allowlist) {
        const risk = classifyTool({ name: tool });
        expect(READ_RISKS.has(risk), `${server}/${tool} classified ${risk}`).toBe(true);
        expect(WRITE_TOOLS, `${server} must not allowlist ${tool}`).not.toContain(tool);
      }
    }
  });

  it("rejects a tampered allowlist that contains a write tool", () => {
    expect(() => assertAllowlistReadOnly("digital", ["place_market_order"])).toThrow(/MCP_ALLOWLIST_WRITE/);
    expect(() => assertAllowlistReadOnly("marginal-cfd", ["close_position"])).toThrow(/MCP_ALLOWLIST_WRITE/);
    expect(() => assertAllowlistReadOnly("digital", [])).toThrow(/MCP_ALLOWLIST_MISSING/);
  });

  it("throws MCP_WRITE_BLOCKED for any write tool request", () => {
    expect(() => assertProbeToolAllowed("marginal-cfd", "place_market_order")).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => assertProbeToolAllowed("blitz", "sell_position")).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => assertProbeToolAllowed("digital", "get_capabilities")).not.toThrow();
  });

  it("plans only reference allowlisted read tools", () => {
    for (const [server, plan] of Object.entries(PRODUCT_PLANS) as [string, { tool: string }[]][]) {
      const allowlist = PRODUCT_READ_ALLOWLISTS[server as keyof typeof PRODUCT_READ_ALLOWLISTS] as string[];
      for (const step of plan) expect(allowlist).toContain(step.tool);
    }
  });
});

describe("IQ MCP products probe — read-only run (mocked fetch)", () => {
  it("fails closed without a token: zero network calls, NO_TOKEN", async () => {
    const { fetchImpl, requests } = createMockFetch(() => ({}));
    const report = await runProductsProbe({
      token: "",
      fetchImpl,
      servers: { digital: "https://digital.test.local" },
      allowlists: { digital: digitalAllowlist },
      plans: { digital: digitalPlan },
    });
    expect(requests).toHaveLength(0);
    expect(report.authenticated).toBe(false);
    expect(report.servers.digital.error).toBe("NO_TOKEN");
  });

  it("calls only allowlisted read tools and derives args from the server's own list_assets", async () => {
    const { fetchImpl, requests } = createMockFetch((req) => {
      const name = req.params?.name;
      if (name === "get_capabilities") return { mode: "read-only" };
      if (name === "list_assets") return { assets: [{ asset_id: 42, asset_type: "Forex" }] };
      if (name === "list_balances") return { balances: [{ balance_id: 7, currency: "USD" }] };
      if (name === "get_instruments") return { instruments: [] };
      return {};
    });
    const report = await runProductsProbe({
      token: TOKEN,
      fetchImpl,
      servers: { digital: "https://digital.test.local" },
      allowlists: { digital: digitalAllowlist },
      plans: { digital: digitalPlan },
    });

    const entry = report.servers.digital;
    expect(entry.error).toBeNull();
    expect(Object.keys(entry.results)).toEqual(digitalAllowlist);
    expect(entry.results.get_instruments.args).toEqual({ asset_id: 42 });

    const calledTools = requests.filter((r) => r.method === "tools/call").map((r) => r.params?.name);
    expect(new Set(calledTools)).toEqual(new Set(digitalAllowlist));
    const serialized = JSON.stringify(requests);
    for (const writer of WRITE_TOOLS) expect(serialized).not.toContain(writer);
  });

  it("skips argument-requiring tools it cannot satisfy safely", async () => {
    const { fetchImpl, requests } = createMockFetch((req) => {
      if (req.params?.name === "list_assets") return { assets: [] };
      return {};
    });
    const report = await runProductsProbe({
      token: TOKEN,
      fetchImpl,
      servers: { digital: "https://digital.test.local" },
      allowlists: { digital: digitalAllowlist },
      plans: { digital: digitalPlan },
    });
    expect(report.servers.digital.skipped).toEqual([
      { tool: "get_instruments", reason: "NO_ASSET_ID_FROM_list_assets" },
    ]);
    const calledTools = requests.filter((r) => r.method === "tools/call").map((r) => r.params?.name);
    expect(calledTools).not.toContain("get_instruments");
  });

  it("redacts the token from every payload kept in the report", async () => {
    const { fetchImpl } = createMockFetch((req) => {
      if (req.params?.name === "get_capabilities") {
        return { mode: "read-only", echo: `Authorization: Bearer ${TOKEN}` };
      }
      return {};
    });
    const report = await runProductsProbe({
      token: TOKEN,
      fetchImpl,
      servers: { digital: "https://digital.test.local" },
      allowlists: { digital: digitalAllowlist },
      plans: { digital: digitalPlan },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).toContain("<REDACTED>");
  });

  it("fails closed when a custom allowlist carries a write tool (no tools/call issued)", async () => {
    const { fetchImpl, requests } = createMockFetch(() => ({}));
    const report = await runProductsProbe({
      token: TOKEN,
      fetchImpl,
      servers: { digital: "https://digital.test.local" },
      allowlists: { digital: ["get_capabilities", "place_market_order"] },
      plans: { digital: digitalPlan },
    });
    expect(report.servers.digital.error).toMatch(/MCP_ALLOWLIST_WRITE/);
    expect(requests.filter((r) => r.method === "tools/call")).toHaveLength(0);
  });

  it("writes redacted artifacts to disk", async () => {
    const { fetchImpl } = createMockFetch((req) => {
      if (req.params?.name === "get_capabilities") return { echo: `token=${TOKEN}` };
      return {};
    });
    const report = await runProductsProbe({
      token: TOKEN,
      fetchImpl,
      servers: { digital: "https://digital.test.local" },
      allowlists: { digital: digitalAllowlist },
      plans: { digital: digitalPlan },
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "iq-products-probe-"));
    try {
      const { rawPath, mdPath } = await writeProbeArtifacts(report, { outDir: dir });
      const [raw, md] = await Promise.all([fs.readFile(rawPath, "utf8"), fs.readFile(mdPath, "utf8")]);
      expect(raw).not.toContain(TOKEN);
      expect(md).not.toContain(TOKEN);
      expect(md).toContain("read-only probe");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
