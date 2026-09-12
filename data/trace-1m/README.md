# TRACE_1M prospective ledger

The live dataset is intentionally excluded from Git. Only this contract, its
machine-readable schema, a redacted sample and reports belong in the repository.

Run `npm run trace1m:collect` with server-side `OANDA_API_KEY` and
`OANDA_ACCOUNT_ID`. Run `npm run trace1m:status` against the same
`DATABASE_PATH` to inspect durable progress. The collector never creates quotes,
news, macro events or trades when a source is unavailable.

Raw snapshots, decisions, outcomes and audit events are separate append-only
SQLite tables protected by UPDATE/DELETE rejection triggers. IDs are derived
from canonical content for restart-safe deduplication. A WAIT is persisted but
is not an actionable trade. Phase A starts only after the first eligible real
BUY/SELL research decision; production remains WAIT unless the independent 70%
production gate passes.

Current official source capability:

- Primary quote provider: OANDA v20 REST pricing (real bid/ask).
- Fallback quote provider: not configured; candle-only sources are rejected.
- News source: not configured; recorded as `NOT_AVAILABLE` and forces WAIT.
- Macro calendar source: not configured; recorded as `NOT_AVAILABLE` and forces WAIT.
- Microstructure: L1 bid/ask only; no trade tape/order-book depth is invented.

The collector therefore remains fail-closed until these runtime dependencies
are present. Secrets belong only in environment variables and must never be
added to this directory.
