# CURRENT vs Official MCP

Status: **INSUFFICIENT_EVIDENCE** — every `OFFICIAL MCP` column requires an authenticated
`tools/list`, which could not run (no token in session). No result is assumed.

Decision vocabulary: `MCP_CAN_REPLACE` · `MCP_CAN_VALIDATE` · `MCP_COMPLEMENTS` ·
`CURRENT_STILL_REQUIRED` · `INSUFFICIENT_EVIDENCE`.

| CAPABILITY | TRACE/COM ATUAL | OFFICIAL MCP | RESULTADO |
|---|---|---|---|
| Market catalog / canonical identity | `relay/asset-resolver.mjs` `canonicalFromName` (`-op`, `:N`, OTC aliases, compound rejection) + `scripts/iq-catalog.mjs` (774 instruments) | unknown | INSUFFICIENT_EVIDENCE |
| Instrument / activeId | resolver + `initialization-data` (`get-instruments v4` timeouts on this account) | unknown | INSUFFICIENT_EVIDENCE |
| Availability states | `OPEN` / `DISABLED` / `SUSPENDED` / `NOT_OFFERED` / `UNKNOWN`, refresh 60s/20s, stale→UNKNOWN | unknown | INSUFFICIENT_EVIDENCE |
| Payout | `initialization-data.option.profit.commission` | unknown | INSUFFICIENT_EVIDENCE |
| Server time (JIT) | internal JIT time source, drift measured (−1327ms..+272ms, p50 −473ms) | unknown | INSUFFICIENT_EVIDENCE |
| Candles / ticks / current price | IQ WS stream + Feature Engine | unknown | INSUFFICIENT_EVIDENCE |
| Settlement (WIN/LOSS/DRAW, realized PnL) | internal settlement from IQ price labels | unknown | INSUFFICIENT_EVIDENCE |
| Account mode PRACTICE/REAL | explicit (`modeState`, `realModeEnabled=false`, balance sources) | unknown | INSUFFICIENT_EVIDENCE |
| Open/historical positions | journal + broker reconciliation | unknown | INSUFFICIENT_EVIDENCE |
| Order status / order tools | `brokerAutomation=WS_ONLY_PRACTICE`; Execution Gate is the only writer | unknown (execution tools only catalogued, never called) | INSUFFICIENT_EVIDENCE |

## How the comparison will be produced
1. `node scripts/iq-mcp-discover.mjs` (token via env) → real capabilities and tool schemas.
2. Shadow-only sampling: for each of the 55 markets, record `status`, `activeId`, `payout`,
   `serverTime`, `price`, `expiration`; compare against the incumbent values.
3. Divergence = per-field absolute/relative delta + agreement rate; settlement compared only after
   settled trades accumulate (no synthetic samples).

## Current state preserved
The existing WS/resolver/catalog path remains the executor and the fallback. Nothing was removed,
migrated, or promoted. PRACTICE only, stake R$10, ZERO REAL.
