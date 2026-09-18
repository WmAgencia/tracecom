# IQ Official MCP — Integration Plan (shadow-first, no production migration)

## Phase status
| Phase | Status |
|---|---|
| 1 — Identify real MCP (transport/handshake/auth) | **BLOCKED: no token in session.** Unauthenticated probe done: 7/7 hosts resolve to `45.88.36.194` and answer `401 {"error":"invalid_token: ... bearer: ..."}` → auth scheme is `Authorization: Bearer <token>` over HTTPS JSON-RPC. |
| 2 — Full inventory | Pending token (`scripts/iq-mcp-discover.mjs` generates it) |
| 3 — Binary/Turbo deep dive | Pending token |
| 4 — Matrix vs current integration | Pending token |
| 5 — Adapter `relay/iq-mcp/` | Not started (only after real capability evidence) |
| 6 — Shadow mode | Designed, see below |
| 7 — Execution security | Implemented gates: `relay/iq-mcp/security.mjs` |
| 8 — Digital/Blitz/Marginal | Endpoints reachable; capability map pending token |
| 9 — Tests (no orders) | Security/redaction tests green (8/8). Handshake/timeout/reconnect/rate-limit/auth-failure tests pending token |
| 10 — MCP is not intelligence | Documented policy: no strategy/win-rate assumptions without separate prospective evidence |

## Discovery procedure (no orders, ever)
```powershell
$env:IQ_MCP_TOKEN = "<token>"          # never committed, never logged
node scripts/iq-mcp-discover.mjs       # initialize → tools/list → resources/list → prompts/list
```
Outputs: `docs/iq-mcp/discovery.md`, `docs/iq-mcp/discovery.raw.json` (both redacted).
The script **never** calls `tools/call`; read-only methods are enforced by `assertReadOnlyMethod`.

## Shadow mode design
```
IQ_MCP_ENABLED=false                 # master switch, default OFF
IQ_MCP_SHADOW=true                   # observe + compare only
IQ_MCP_TOKEN_FILE=<path>             # secret file, not inline env, preferred in prod
```
In shadow: the MCP may be queried and diffed against the incumbent infrastructure, but it **cannot**
control decisions, mutate the MarketCatalog, open positions, alter settlement, or touch
Brain G2 / JIT / Quality Gate / Portfolio Gate / Execution Gate.

Comparison dimensions: market status (`OPEN/DISABLED/SUSPENDED/NOT_OFFERED/UNKNOWN`), `activeId`,
payout, server time (JIT-relevant), price, expiration, settlement (`WIN/LOSS/DRAW`, realized PnL).
Divergence is computed objectively per sample.

## Candidate replacement analysis (to be completed with real data)
| Capability | Hypothesis to test in shadow | Decision rule |
|---|---|---|
| Market catalog / canonical identity (`-op`, `:N`, OTC aliases) | MCP may expose canonical instrument ids | If canonical ids cover 100% of the 55 markets → `MCP_CAN_REPLACE` parser subset |
| Availability states | Compare to current `OPEN/DISABLED/SUSPENDED/NOT_OFFERED/UNKNOWN` | `MCP_CAN_VALIDATE` unless it also exposes payout+expiration |
| Payout | Compare to `initialization-data.option.profit.commission` | `MCP_CAN_VALIDATE` |
| Server time | Compare to JIT time source | `MCP_COMPLEMENTS` / `MCP_CAN_REPLACE` if monotonic and low-latency |
| Candles / ticks / current price | Compare to WS stream | `CURRENT_STILL_REQUIRED` if latency ≥ WS |
| Settlement | Compare to internal settlement | `MCP_CAN_VALIDATE`; replacement only with sustained agreement |
| Account mode PRACTICE/REAL | Must be unambiguous | If ambiguous → keep current, `INSUFFICIENT_EVIDENCE` |

## Non-negotiables
- No order, no BUY/SELL, no R$1 test order, no REAL change, no stake change.
- MCP stays SHADOW/READ-ONLY; incumbent WS path remains the executor and fallback.
- Digital/Blitz/Marginal are independent products — capability map only, no Brain G2 integration.
