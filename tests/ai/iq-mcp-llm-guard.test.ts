/**
 * IQ MCP — LLM/agent isolation gateway tests.
 *
 * Proves that no AI layer (trader, critic, professor, supervisor, research) can
 * reach a write tool, regardless of name casing, unicode tricks, prototype keys
 * or passing a tool object instead of a string. Zero network, zero orders.
 */
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error - runtime ESM module without type declarations
import { AGENTS, READ_TOOL_ALLOWLIST, assertAgentAllowed, assertReadTool, createAgentToolGateway, normalizeToolName } from "../../relay/iq-mcp/llm-guard.mjs";

const AI_AGENTS = ["trader", "critic", "professor", "supervisor", "research"] as const;

const READ_TOOLS = [
  "get_capabilities",
  "get_limits",
  "list_assets",
  "list_balances",
  "list_positions",
  "get_trade_history",
  "get_candles",
  "get_instruments",
  "get_prices",
  "get_orders",
  "calculate_order_size",
];

const WRITE_TOOLS = [
  "place_trade",
  "sell_position",
  "close_position",
  "cancel_pending_order",
  "rollover_position",
  "change_position_stop_loss",
  "set_stake",
  "update_balance",
  "mystery_tool",
];

describe("IQ MCP LLM guard — allowlists", () => {
  it("exposes exactly the six AI layers and eleven read tools", () => {
    expect([...AGENTS]).toEqual(["trader", "critic", "professor", "supervisor", "research", "orchestrator"]);
    expect([...READ_TOOL_ALLOWLIST]).toEqual(READ_TOOLS);
    expect(Object.isFrozen(AGENTS)).toBe(true);
    expect(Object.isFrozen(READ_TOOL_ALLOWLIST)).toBe(true);
  });

  it("normalizes case, whitespace, full-width and zero-width variants", () => {
    expect(normalizeToolName("  GET_CANDLES ")).toBe("get_candles");
    expect(normalizeToolName("ｐｌａｃｅ＿ｔｒａｄｅ")).toBe("place_trade");
    expect(normalizeToolName("get\u200B_candles")).toBe("get_candles");
    expect(normalizeToolName("get_candles\uFEFF")).toBe("get_candles");
    expect(normalizeToolName({ toString: () => "get_candles" })).toBeNull();
    expect(normalizeToolName(null)).toBeNull();
  });
});

describe("IQ MCP LLM guard — agent identity", () => {
  it("rejects unknown, missing, object and __proto__ agents", () => {
    for (const agent of ["hacker", "admin", "__proto__", "constructor", "", " ", 42, null, undefined, {}, ["trader"]]) {
      expect(() => createAgentToolGateway({ agent: agent as never }), String(agent)).toThrow(/MCP_AGENT_NOT_ALLOWED/);
      expect(() => assertAgentAllowed(agent as never), String(agent)).toThrow(/MCP_AGENT_NOT_ALLOWED/);
    }
  });

  it("accepts each allowlisted agent and returns the canonical name", () => {
    for (const agent of AGENTS) {
      expect(assertAgentAllowed(agent)).toBe(agent);
      expect(createAgentToolGateway({ agent }).agent).toBe(agent);
    }
    expect(assertAgentAllowed(" Trader ")).toBe("trader");
  });

  it("tags MCP_AGENT_NOT_ALLOWED with a stable error code", () => {
    try {
      createAgentToolGateway({ agent: "intruder" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("MCP_AGENT_NOT_ALLOWED");
    }
  });
});

describe("IQ MCP LLM guard — per-layer write isolation", () => {
  for (const agent of AI_AGENTS) {
    it(`${agent}: every write tool throws MCP_WRITE_BLOCKED`, () => {
      const gateway = createAgentToolGateway({ agent });
      for (const tool of WRITE_TOOLS) {
        try {
          gateway.callTool(tool, { asset_id: 76, amount: 10 });
          expect.unreachable(`${tool} should have thrown`);
        } catch (err) {
          expect((err as Error).message, tool).toMatch(/MCP_WRITE_BLOCKED/);
        }
      }
    });

    it(`${agent}: every allowlisted read tool passes`, async () => {
      const gateway = createAgentToolGateway({ agent });
      for (const tool of READ_TOOLS) {
        const res = await gateway.callTool(tool, {});
        expect(res.ok, tool).toBe(true);
        expect(res.tool, tool).toBe(tool);
        expect(res.executed).toBe(false);
      }
    });
  }
});

describe("IQ MCP LLM guard — bypass attempts", () => {
  const gateway = createAgentToolGateway({ agent: "trader" });

  it("blocks case, full-width, zero-width and whitespace write tricks", () => {
    const tricks = [
      "PLACE_TRADE",
      "PlAcE_tRaDe",
      " place_trade ",
      "place_trade\u200B",
      "place\u200B_trade",
      "\uFEFFplace_trade",
      "ｐｌａｃｅ＿ｔｒａｄｅ",
      "SELL_POSITION",
      "сlose_position",
      "close_position\u0000",
    ];
    for (const name of tricks) {
      expect(() => gateway.callTool(name), JSON.stringify(name)).toThrow(/MCP_WRITE_BLOCKED/);
    }
  });

  it("blocks prototype keys and inherited names", () => {
    for (const name of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "__defineGetter__"]) {
      expect(() => gateway.callTool(name), name).toThrow(/MCP_WRITE_BLOCKED/);
    }
    expect(() => gateway.callTool("place_trade")).toThrow(/MCP_WRITE_BLOCKED/);
  });

  it("refuses tool objects, symbols, numbers and null without coercion", () => {
    const evil = {
      name: "get_candles",
      toString: vi.fn(() => "get_candles"),
      valueOf: vi.fn(() => "get_candles"),
    };
    for (const value of [evil, Symbol("get_candles"), 123, null, undefined, true, ["get_candles"]]) {
      expect(() => gateway.callTool(value as never), String(typeof value)).toThrow(/MCP_WRITE_BLOCKED/);
    }
    expect(evil.toString).not.toHaveBeenCalled();
    expect(evil.valueOf).not.toHaveBeenCalled();
  });

  it("blocks write-intent names even when the classifier would call them reads", () => {
    for (const name of ["set_position_stop_loss", "update_balance", "reset_account", "switch_mode", "change_stake", "cancel_pending_order", "rollover_position"]) {
      expect(() => assertReadTool(name), name).toThrow(/MCP_WRITE_BLOCKED/);
    }
    expect(() => assertReadTool("buy_now")).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => assertReadTool("deposit_funds")).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => assertReadTool("withdraw_funds")).toThrow(/MCP_WRITE_BLOCKED/);
    expect(() => assertReadTool("transfer_funds")).toThrow(/MCP_WRITE_BLOCKED/);
  });

  it("blocks read-classified tools outside the allowlist", () => {
    expect(() => assertReadTool("search_assets")).toThrow(/MCP_TOOL_NOT_ALLOWLISTED/);
    expect(() => gateway.callTool("search_assets")).toThrow(/MCP_TOOL_NOT_ALLOWLISTED/);
  });

  it("does not let the returned allowlist be mutated", () => {
    expect(() => (READ_TOOL_ALLOWLIST as unknown as string[]).push("place_trade")).toThrow();
    expect(READ_TOOL_ALLOWLIST).not.toContain("place_trade");
    expect(() => gateway.callTool("place_trade")).toThrow(/MCP_WRITE_BLOCKED/);
  });

  it("stays blocked even when Object.prototype is polluted", () => {
    const key = "__iq_mcp_guard_pollution__";
    try {
      (Object.prototype as Record<string, unknown>)[key] = "place_trade";
      expect(() => gateway.callTool("place_trade")).toThrow(/MCP_WRITE_BLOCKED/);
      expect(() => gateway.callTool(key)).toThrow(/MCP_WRITE_BLOCKED/);
    } finally {
      delete (Object.prototype as Record<string, unknown>)[key];
    }
  });
});

describe("IQ MCP LLM guard — executor wiring", () => {
  it("only invokes execute for validated read tools and forwards args", async () => {
    const execute = vi.fn(async (tool: string, args: Record<string, unknown>) => ({ ok: true, tool, args }));
    const gateway = createAgentToolGateway({ agent: "research", execute });

    const res = await gateway.callTool("Get_Candles", { asset_id: 76, size: 60 });
    expect(res).toEqual({ ok: true, tool: "get_candles", args: { asset_id: 76, size: 60 } });
    expect(execute).toHaveBeenCalledTimes(1);

    expect(() => gateway.callTool("place_trade", {})).toThrow(/MCP_WRITE_BLOCKED/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-function executor", () => {
    expect(() => createAgentToolGateway({ agent: "trader", execute: "nope" as never })).toThrow(/MCP_GUARD_INVALID_EXECUTOR/);
  });
});
