# TRACE_1M prospective collector — readiness report

- Schema: `trace1m.snapshot.v1`
- Primary quote adapter: OANDA v20 REST pricing
- Quote kind: account pricing bid/ask (research Forex domain)
- Fallback: not configured; candle-only feeds are not accepted as quote fallback
- News: not configured
- Macro calendar: not configured
- Microstructure: not available beyond L1 bid/ask
- Storage: SQLite append-only tables with immutable triggers and atomic writes
- Dedup: source quote identity (`provider`, `pair`, provider timestamp, bid, ask, provider version)
- Horizon: executable BUY ask→bid / SELL bid→ask, first supplied quote in `[T+60s, T+90s]`
- Production: fail-closed; caller booleans cannot bypass structured 70% evidence
- IQ Option/OTC: explicitly not certified by OANDA research data
- Phase A: not started
- Snapshots in repository: 0 (live database is excluded from Git)

## Verdict

`DATA_PROVIDER_LIMITATION`

The implementation is ready to persist genuine OANDA observations when runtime
credentials are supplied. It intentionally cannot start the official 1,000
evaluated-trade phase until a causal decision/outcome scheduler plus timestamped
news, macro calendar and target-venue execution data are available.
