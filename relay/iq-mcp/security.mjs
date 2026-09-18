/**
 * IQ Official MCP — security primitives (read-only by construction).
 *
 * Used by `scripts/iq-mcp-discover.mjs` and by the test-suite.
 * No network calls here; pure functions only.
 */

/** Redact secrets (tokens, bearer headers, api keys) from any value. */
export function redact(value, secret = "") {
  let out = typeof value === "string" ? value : JSON.stringify(value);
  if (out === undefined || out === null) return String(out);
  if (secret) {
    const bare = String(secret).replace(/^Bearer\s+/i, "");
    if (bare) out = out.split(bare).join("<REDACTED>");
    out = out.split(String(secret)).join("<REDACTED>");
  }
  return out.replace(
    /(authorization|token|bearer|api[-_]?key|secret)("?\s*[:=]\s*"?)([^\s",}]+)/gi,
    "$1$2<REDACTED>",
  );
}

/** True when the text contains anything that looks like a live secret. */
export function containsSecret(text, secret = "") {
  if (!text) return false;
  if (secret) {
    const bare = String(secret).replace(/^Bearer\s+/i, "");
    if (bare && String(text).includes(bare)) return true;
  }
  return /(authorization|bearer)\s*[:=]?\s*[A-Za-z0-9._-]{12,}/i.test(String(text));
}

export const RISK = Object.freeze({
  SAFE_READ: "SAFE_READ",
  ACCOUNT_READ: "ACCOUNT_READ",
  ORDER_WRITE: "ORDER_WRITE",
  ACCOUNT_WRITE: "ACCOUNT_WRITE",
  UNKNOWN: "UNKNOWN",
});

const ORDER_WRITE_RE = /(^|[^a-z])(buy|sell|order|open_position|place_|execute|trade|close_position|cancel)/;
const ACCOUNT_WRITE_RE = /(deposit|withdraw|change_|set_|update_|reset_|switch_)/;
const ACCOUNT_READ_RE = /(balance|position|account|portfolio|history|statement)/;

/**
 * Classify an MCP tool by name+description. Unknown names are UNKNOWN and
 * must never be auto-executed.
 */
export function classifyTool(tool = {}) {
  const hay = `${String(tool.name || "").toLowerCase()} ${String(tool.description || "").toLowerCase()}`;
  if (ORDER_WRITE_RE.test(hay)) return RISK.ORDER_WRITE;
  if (ACCOUNT_WRITE_RE.test(hay)) return RISK.ACCOUNT_WRITE;
  if (ACCOUNT_READ_RE.test(hay)) return RISK.ACCOUNT_READ;
  return RISK.SAFE_READ;
}

const READ_ONLY_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "resources/list",
  "resources/read",
  "prompts/list",
  "ping",
]);

/** Hard gate: discovery may only issue read-only JSON-RPC methods. */
export function assertReadOnlyMethod(method) {
  if (!READ_ONLY_METHODS.has(String(method))) {
    throw new Error(`MCP_READ_ONLY_VIOLATION: ${method} is not allowed during discovery`);
  }
  return true;
}

/**
 * Hard gate: no tool may be invoked in discovery/shadow unless it is an
 * explicitly allowed read tool.
 */
export function assertToolAllowed(name, risk, allowlist = []) {
  if (risk === RISK.ORDER_WRITE || risk === RISK.ACCOUNT_WRITE || risk === RISK.UNKNOWN) {
    throw new Error(`MCP_WRITE_BLOCKED: ${name} classified as ${risk}`);
  }
  if (!allowlist.includes(name)) {
    throw new Error(`MCP_TOOL_NOT_ALLOWLISTED: ${name}`);
  }
  return true;
}
