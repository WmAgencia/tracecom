# IQ Official MCP — Capability Matrix

Status: **INSUFFICIENT_EVIDENCE** — no token was present in the session, so no authenticated
`initialize`/`tools/list` was executed. Nothing below is invented; every cell is either verified
by an unauthenticated probe or marked pending.

## Verified without authentication
| SERVER | HOST RESOLVES | TRANSPORT | AUTH SCHEME | TOOLS |
|---|---|---|---|---|
| binary-options | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |
| turbo-options | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |
| blitz-options | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |
| digital-options | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |
| marginal-cfd | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |
| marginal-crypto | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |
| marginal-forex | ✅ 45.88.36.194 | HTTPS JSON-RPC | `Authorization: Bearer` | pending token |

Unauthenticated response (all 7): `HTTP 401`, `content-type: application/json`,
body `{"error":"invalid_token: <REDACTED> bearer: <REDACTED> ..."}`.

## Inventory table (to be filled from real responses)
| SERVER | TOOL | DESCRIPTION | INPUT SCHEMA | OUTPUT | READ/WRITE | ACCOUNT REQUIRED | PRACTICE/REAL | RISK | TRACE/COM EQUIVALENT |
|---|---|---|---|---|---|---|---|---|---|
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

Classification policy: `SAFE_READ`, `ACCOUNT_READ`, `ORDER_WRITE`, `ACCOUNT_WRITE`, `UNKNOWN`
(see `relay/iq-mcp/security.mjs`). `UNKNOWN` is never executed automatically.

## Priority: Binary + Turbo
To verify once authenticated: instruments, activeId/instrumentId, market status (open/closed/
suspended), payout, expiration, server time, candles, ticks, historical prices, current price,
available expirations, balance, account mode (PRACTICE/REAL), open positions, historical positions,
order status, settlement, realized PnL, instrument metadata. Only what actually exists will be recorded.

## Digital / Blitz / Marginal
Endpoints reachable. Independent products — capability map only in this execution; assumptions about
strategy, horizon, payout, expiration or risk equivalence to Binary/Turbo are **not** made.
