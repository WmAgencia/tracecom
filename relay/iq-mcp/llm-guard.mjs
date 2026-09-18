/**
 * IQ Official MCP — LLM/agent isolation gateway.
 *
 * Single entry point for every AI layer (trader, critic, professor, supervisor,
 * research, orchestrator). No AI layer may ever see the adapter, the token or a
 * write path: `createAgentToolGateway({ agent })` is the only door.
 *
 * Fail-closed rules:
 *  - unknown agents throw `MCP_AGENT_NOT_ALLOWED` at construction;
 *  - only names in `READ_TOOL_ALLOWLIST` pass;
 *  - any name matching write intent (`place_`, `sell`, `close_`, `cancel_`,
 *    `rollover_`, `change_`, `set_`, `update_`, `reset_`, `switch_`, plus
 *    `buy`/`deposit`/`withdraw`/`transfer`) or classified ORDER_WRITE /
 *    ACCOUNT_WRITE / UNKNOWN throws `MCP_WRITE_BLOCKED`;
 *  - read-classified but non-allowlisted names throw
 *    `MCP_TOOL_NOT_ALLOWLISTED`;
 *  - names are NFKC-normalized, lowercased and stripped of zero-width/control
 *    characters before classification, so case tricks, full-width lookalikes
 *    and `__proto__`/`constructor` keys resolve to UNKNOWN and stay blocked;
 *  - non-string names (objects, symbols, numbers) are refused without invoking
 *    attacker-controlled `toString()`, so a tool object can never be smuggled
 *    through type coercion;
 *  - the gateway never uses inherited object lookups, so prototype pollution
 *    cannot widen the allowlist.
 *
 * The gateway performs NO I/O by itself. Pass `execute(tool, args)` to wire the
 * verified transport; when omitted, `callTool` returns a policy envelope with
 * `executed:false` and `data:null` (a read that was allowed, but not issued).
 */

import { RISK, classifyTool } from "./security.mjs";

export const AGENTS = Object.freeze([
  "trader",
  "critic",
  "professor",
  "supervisor",
  "research",
  "orchestrator",
]);

export const READ_TOOL_ALLOWLIST = Object.freeze([
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
]);

const READ_TOOLS = new Set(READ_TOOL_ALLOWLIST);

const WRITE_INTENT_RE =
  /^(place_|sell|close_|cancel_|rollover_|change_|set_|update_|reset_|switch_|buy|deposit|withdraw|transfer)/;

const ZERO_WIDTH_RE = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;

function safeLabel(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return `[${typeof value}]`;
}

/** NFKC + case + whitespace + zero-width normalization. Non-strings → null. */
export function normalizeToolName(name) {
  if (typeof name !== "string") return null;
  return name.normalize("NFKC").replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, "").trim().toLowerCase();
}

function blockedError(label, reason) {
  const err = new Error(`MCP_WRITE_BLOCKED: ${label} — ${reason}`);
  err.code = "MCP_WRITE_BLOCKED";
  return err;
}

function agentError() {
  const err = new Error("MCP_AGENT_NOT_ALLOWED: agent is not in the AI-layer allowlist");
  err.code = "MCP_AGENT_NOT_ALLOWED";
  return err;
}

/** Asserts + returns the canonical agent name. Throws MCP_AGENT_NOT_ALLOWED. */
export function assertAgentAllowed(agent) {
  const normalized = normalizeToolName(agent);
  if (normalized === null || !AGENTS.includes(normalized)) throw agentError();
  return normalized;
}

/** Asserts + returns the canonical read tool name. Throws on any write intent. */
export function assertReadTool(name) {
  if (typeof name !== "string") throw blockedError(safeLabel(name), "non-string tool name refused");
  const normalized = normalizeToolName(name);
  if (!normalized) throw blockedError(safeLabel(name), "empty tool name refused");
  const risk = classifyTool({ name: normalized });
  if (
    WRITE_INTENT_RE.test(normalized) ||
    risk === RISK.ORDER_WRITE ||
    risk === RISK.ACCOUNT_WRITE ||
    risk === RISK.UNKNOWN
  ) {
    throw blockedError(normalized, `write intent or risk ${risk}`);
  }
  if (!READ_TOOLS.has(normalized)) {
    const err = new Error(`MCP_TOOL_NOT_ALLOWLISTED: ${normalized}`);
    err.code = "MCP_TOOL_NOT_ALLOWLISTED";
    throw err;
  }
  return normalized;
}

/**
 * Creates the single AI-layer gateway. `agent` must be one of `AGENTS`;
 * `execute` is an optional `(tool, args) => Promise<result>` transport hook.
 */
export function createAgentToolGateway({ agent, execute } = {}) {
  const agentName = assertAgentAllowed(agent);
  if (execute !== undefined && typeof execute !== "function") {
    throw new Error("MCP_GUARD_INVALID_EXECUTOR: execute must be a function");
  }

  const gateway = {
    agent: agentName,
    allowedTools: READ_TOOL_ALLOWLIST,
    callTool(name, args = {}) {
      const tool = assertReadTool(name);
      const callArgs = args && typeof args === "object" && !Array.isArray(args) ? args : {};
      if (execute) return Promise.resolve(execute(tool, callArgs));
      return Promise.resolve({
        ok: true,
        agent: agentName,
        tool,
        args: callArgs,
        data: null,
        executed: false,
        policy: "READ_ALLOWED",
      });
    },
  };

  return Object.freeze(gateway);
}

export default createAgentToolGateway;
