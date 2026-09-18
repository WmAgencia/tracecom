# IQ Official MCP — Security (read-only discovery)

## Credential handling
- Token is read **only** from `IQ_MCP_TOKEN` (or `IQ_MCP_TOKEN_FILE`) at process start.
- Never written to: source, git, commits, docs, screenshots, logs, replies, frontend, Vercel client env, database, fixtures.
- Every string emitted by `scripts/iq-mcp-discover.mjs` passes through `relay/iq-mcp/security.mjs#redact()` (token, `Bearer`, `authorization`, `api_key`, `secret`).
- Raw artifacts (`docs/iq-mcp/discovery.raw.json`) are redacted before write.
- The temporary token is expected to be **revoked** after the tests.

## Hard gates (fail-closed)
| Gate | Function | Behavior |
|---|---|---|
| Read-only JSON-RPC | `assertReadOnlyMethod(method)` | allows only `initialize`, `notifications/initialized`, `tools/list`, `resources/list`, `resources/read`, `prompts/list`, `ping`; anything else throws `MCP_READ_ONLY_VIOLATION` |
| Write blocking | `assertToolAllowed(name, risk, allowlist)` | throws `MCP_WRITE_BLOCKED` for `ORDER_WRITE`, `ACCOUNT_WRITE`, `UNKNOWN`; throws `MCP_TOOL_NOT_ALLOWLISTED` unless explicitly allowlisted |
| Classification | `classifyTool(tool)` | `SAFE_READ` / `ACCOUNT_READ` / `ORDER_WRITE` / `ACCOUNT_WRITE` / `UNKNOWN` from real tool name+description |

## Risk classes
- `SAFE_READ` — market data / metadata. Read-only.
- `ACCOUNT_READ` — balance, positions, history, statement. Read-only, account-scoped.
- `ORDER_WRITE` — buy/sell/order/open/close/cancel. **Never auto-executed.**
- `ACCOUNT_WRITE` — deposit/withdraw/set/change/update/reset/switch (stake, mode). **Never auto-executed.**
- `UNKNOWN` — unclassified. **Never auto-executed.**

## Execution architecture (write authority)
Only the deterministic **Execution Gate** may ever hold write permission:

```
Market Data → Feature Engine → Trader → Critic → Consensus → Quality Gate
  → JIT Final Revalidation → Portfolio Gate → Execution Gate (deterministic)
  → IQ MCP
```

No LLM (Trader, Critic, Consensus, Professor) receives direct execution authority. The MCP adapter is data/transport only.

## Operational invariants preserved
- PRACTICE ONLY, stake **R$10**, **ZERO REAL**.
- No order executed during any phase of this discovery.
- An unavailable MCP must never take TraceCom down: the existing WS/resolver/catalog path remains the fallback.

## Tests
`tests/ai/iq-mcp-security.test.ts` — 8 tests covering: redaction of bearer/authorization/api_key, secret detection, ORDER_WRITE classification + blocking, ACCOUNT_WRITE blocking, read classification, non-allowlisted blocking, UNKNOWN blocking, read-only method enforcement.
