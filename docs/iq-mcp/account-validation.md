# IQ MCP x TraceCom — account identity validation (read-only)

Generated: 2026-09-18T01:30:06.891Z
Auth mode: env-only (never persisted, redacted in output). Authenticated: true.
MCP allowlist: `get_capabilities`, `get_limits`, `list_balances`, `list_positions` (no order/write tool called)

## Balances

| balance_id | type | currency | amount | source |
| --- | --- | --- | --- | --- |
| 1250741746 | regular | BRL | 0 | MCP binary+turbo |
| 1250741747 | training | USD | 60 | MCP binary+turbo |
| (not exposed) | practice | USD | 60 | TraceCom office |
| (not exposed) | real | BRL | 0 | TraceCom office |

## Verdict

`SAME_ACCOUNT_CONFIRMED`

No objective divergences found on the compared fields (mode, type mapping, currency, amount, per-server).

## Identity evidence

- Account mode: MCP balances carry `type: training` (practice funds) and `type: regular` (real funds); TraceCom reports `mode=PRACTICE`, `modeState.practice.verified=true`.
- Training <-> practice: MCP training [{"balance_id":1250741747,"type":"training","currency":"USD","amount":60,"servers":["binary","turbo"]}] vs TraceCom practice {"verified":true,"balance":60,"currency":"USD"} — MATCH (currency + amount).
- Regular <-> real: MCP regular [{"balance_id":1250741746,"type":"regular","currency":"BRL","amount":0,"servers":["binary","turbo"]}] vs TraceCom real {"available":true,"balance":0,"currency":"BRL"} — MATCH (currency + amount).
- get_capabilities scope: {"binary":{"mode":"read-write","product":"binary-options"},"turbo":{"mode":"read-write","product":"turbo-options"}} (token scope `mode`, not the account mode).
- TraceCom `modeState.realMode`: {"realModeEnabled":false,"realModeSessionId":null,"confirmedAt":null,"expiresAt":null,"maxStake":null,"realBalanceSeen":null,"lastRevokeReason":"WS_DISCONNECTED","hardCap":100,"phraseRequired":"OPERAR CONTA REAL","audit":[]}.
- TraceCom `activeCount`: 37 (relay markets, not broker positions).

### Identifier check

- MCP exposes immutable per-balance ids: `balance_id` (`1250741746` regular/BRL, `1250741747` training/USD) — stable across binary and turbo servers.
- TraceCom `GET /api/iq/office` exposes NO account/balance identifier (searched keys `balance_id`, `balanceId`, `accountId`, `userId`, `email`, `profileId`: all absent).
- Therefore the cross-system match is **balance magnitude + currency + type only**; there is no shared immutable key to compare. A same-magnitude coincidence cannot be excluded by identifiers alone.

## Stake fields (expected freeze = 10)

- `config`: {"globalMaxStake":100,"defaultStake":100,"calculatedBankrollStake":1,"hardCap":100,"maxActiveMarkets":55,"autoExecute":false,"revision":149,"brainGeneration":2,"jitEnabled":true,"entryLeadMs":1500,"entryWindowMaxDriftMs":2500,"qualityGateEnabled":true,"minTradeQualityScore":75}
- Expected frozen stake `10`: **DIVERGENCE** — `defaultStake`/`globalMaxStake` are not 10 (gauntlet contract P63/64/65/67 requires `defaultStake === 10`).
- Per-market stake distribution: {"configuredStake":{"100":55},"maxStake":{"100":55},"positionStateStake":{"10":6,"100":1},"lastTradeStake":{"10":6,"100":1}}

## Readings and skew

- MCP read window: 2026-09-18T01:30:06.893Z -> 2026-09-18T01:30:12.108Z
- TraceCom office read: 2026-09-18T01:30:12.109Z -> 2026-09-18T01:30:12.731Z (HTTP 200, 494ms)
- Secondary relay read `GET /api/iq/status`: {"state":"CONNECTED_READ_ONLY","mode":"PRACTICE","practiceOnly":true,"hasSession":true,"brokerAutomation":"WS_ONLY_PRACTICE"} (HTTP 200). `GET /api/iq/office` is itself the public read-through of the relay admin endpoint (api/http.ts:786 relays to `relayAdminJson("GET", ...)`); no separate admin credential was used and no write endpoint was called.
- Observed skew between MCP finish and TraceCom finish: 623 ms. Balances are point-in-time reads; relay gate `DISARMED` / armed=false, so no execution should have moved funds between reads.

## Still not provable

- That both surfaces are the *same user account* by an immutable shared identifier: TraceCom does not expose `balance_id`/account id, so identity rests on mode + type mapping + currency + amount (magnitude) only.
- That the TraceCom practice balance equals the MCP training balance *at the same instant*: the two reads are ~623 ms apart (portal read-through and MCP are independent paths).
- Real side (`type: regular` / `modeState.real`): both read 0 BRL, but TraceCom `realMode.realBalanceSeen` is `null` (real never observed in-session), so the regular/real correspondence is nominal, not execution-verified.

## Evidence (redacted)

- MCP raw per-server payloads: `docs/iq-mcp/account-validation.raw.json`.
- TraceCom office excerpt: {"mode":"PRACTICE","modeState":{"mode":"PRACTICE","practice":{"verified":true,"balance":60,"currency":"USD"},"real":{"available":true,"balance":0,"currency":"BRL"},"realMode":{"realModeEnabled":false,"realModeSessionId":null,"confirmedAt":null,"expiresAt":null,"maxStake":null,"realBalanceSeen":null,"lastRevokeReason":"WS_DISCONNECTED","hardCap":100,"phraseRequired":"OPERAR CONTA REAL","audit":[]}},"activeCount":37,"config":{"globalMaxStake":100,"defaultStake":100,"calculatedBankrollStake":1,"hardCap":100,"maxActiveMarkets":55,"autoExecute":false,"revision":149,"brainGeneration":2,"jitEnabled":true,"entryLeadMs":1500,"entryWindowMaxDriftMs":2500,"qualityGateEnabled":true,"minTradeQualityScore":75},"legacyAccount":{"verified":true,"type":"PRACTICE","currency":"USD","balance":60,"hasReal":true,"checkedAt":1789686354775,"balanceFailure":null,"practiceOnly":true,"realExecutionForbidden":true}}
- TraceCom status excerpt: {"state":"CONNECTED_READ_ONLY","mode":"PRACTICE","practiceOnly":true,"hasSession":true,"brokerAutomation":"WS_ONLY_PRACTICE"}
