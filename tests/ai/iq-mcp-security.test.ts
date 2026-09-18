import { describe, expect, it } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { RISK, assertReadOnlyMethod, assertReadProbeMethod, assertToolAllowed, classifyTool, containsSecret, redact } from "../../relay/iq-mcp/security.mjs";

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRET-PAYLOAD-REDACT-ME.sig";

describe("IQ Official MCP — security primitives", () => {
  it("redacts authorization headers and bearer tokens", () => {
    const out = redact(`Authorization: Bearer ${TOKEN}`, TOKEN);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("<REDACTED>");
  });

  it("redacts token-shaped assignments even without the known secret", () => {
    const out = redact("api_key=super-secret-value-123");
    expect(out).not.toContain("super-secret-value-123");
    expect(out).toMatch(/<REDACTED>/);
  });

  it("detects leaked secrets", () => {
    expect(containsSecret(`token ${TOKEN}`, TOKEN)).toBe(true);
    expect(containsSecret("nothing secret here")).toBe(false);
  });

  it("classifies order tools as ORDER_WRITE and blocks them", () => {
    expect(classifyTool({ name: "buy", description: "place a buy order" })).toBe(RISK.ORDER_WRITE);
    expect(classifyTool({ name: "sell", description: "close position" })).toBe(RISK.ORDER_WRITE);
    expect(() => assertToolAllowed("buy", RISK.ORDER_WRITE)).toThrow(/MCP_WRITE_BLOCKED/);
  });

  it("classifies account mutations as ACCOUNT_WRITE and blocks them", () => {
    expect(classifyTool({ name: "set_stake", description: "set stake" })).toBe(RISK.ACCOUNT_WRITE);
    expect(() => assertToolAllowed("set_stake", RISK.ACCOUNT_WRITE)).toThrow(/MCP_WRITE_BLOCKED/);
  });

  it("classifies reads and never auto-allows non-allowlisted tools", () => {
    expect(classifyTool({ name: "get_balance", description: "account balance" })).toBe(RISK.ACCOUNT_READ);
    expect(classifyTool({ name: "get_candles", description: "historical candles" })).toBe(RISK.SAFE_READ);
    expect(() => assertToolAllowed("get_candles", RISK.SAFE_READ)).toThrow(/MCP_TOOL_NOT_ALLOWLISTED/);
    expect(assertToolAllowed("get_candles", RISK.SAFE_READ, ["get_candles"])).toBe(true);
  });

  it("does not false-positive on real IQ tool names (asset_id / cross-references)", () => {
    expect(classifyTool({ name: "get_candles", description: "Required: asset_id and size" })).toBe(RISK.SAFE_READ);
    expect(classifyTool({ name: "list_assets", description: "asset_id (pass to place_trade), name, is_open" })).toBe(RISK.SAFE_READ);
    expect(classifyTool({ name: "list_balances", description: "balance_id, type regular/training" })).toBe(RISK.ACCOUNT_READ);
    expect(classifyTool({ name: "get_trade_history", description: "closed positions with paging" })).toBe(RISK.ACCOUNT_READ);
    expect(classifyTool({ name: "place_trade", description: "open a position" })).toBe(RISK.ORDER_WRITE);
    expect(classifyTool({ name: "sell_position", description: "close early" })).toBe(RISK.ORDER_WRITE);
    expect(classifyTool({ name: "rollover_position", description: "move to next expiry" })).toBe(RISK.ORDER_WRITE);
    expect(classifyTool({ name: "place_market_order", description: "fills immediately" })).toBe(RISK.ORDER_WRITE);
  });

  it("treats unknown tools as UNKNOWN and blocks them", () => {
    expect(() => assertToolAllowed("mystery", RISK.UNKNOWN)).toThrow(/MCP_WRITE_BLOCKED/);
  });

  it("enforces read-only JSON-RPC methods during discovery", () => {
    expect(assertReadOnlyMethod("tools/list")).toBe(true);
    expect(() => assertReadOnlyMethod("tools/call")).toThrow(/MCP_READ_ONLY_VIOLATION/);
  });

  it("read-probe allows tools/call only with allowlisted read tools", () => {
    expect(assertReadProbeMethod("tools/call", "get_candles", RISK.SAFE_READ, ["get_candles"])).toBe(true);
    expect(() => assertReadProbeMethod("tools/call", "place_trade", RISK.ORDER_WRITE, ["place_trade"])).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => assertReadProbeMethod("tools/call", "get_candles", RISK.SAFE_READ, [])).toThrow(/MCP_TOOL_NOT_ALLOWLISTED/);
    expect(() => assertReadProbeMethod("resources/subscribe", "get_candles", RISK.SAFE_READ, ["get_candles"])).toThrow(/MCP_READ_ONLY_VIOLATION/);
  });
});
