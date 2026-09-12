# TRACE_1M professional research status

Generated: 2026-09-11

Mode: **SHADOW_ONLY**

Checkpoint input: `60dbc3a1746f397ce58785e3e8c94d4a13333cc5`

## Verdict

**DATA_PROVIDER_LIMITATION**

The requested 3,600-trade A/B/C/D/E experiment was **not labeled as
completed**. Current historical input supports closed one-minute Forex OHLC
and causally aggregated price features. It does not provide point-in-time FX
news, an official historical macro release archive, historical bid/ask spread,
ticks, L1 sizes or L2 order books.

Treating those fields as `NORMAL`, zero or false would leak current knowledge
and manufacture professional context. Every unavailable field is therefore
represented as `NOT_AVAILABLE`, and no signature can pass the production 70%
gate from this dataset.

| phase | requested actionable | evaluated now | status |
| --- | ---: | ---: | --- |
| A | 1,000 | 0 | BLOCKED_MANDATORY_CONTEXT_UNAVAILABLE |
| B | 1,000 | 0 | NOT_STARTED |
| C | 1,000 | 0 | NOT_STARTED |
| D | 500 | 0 | NOT_STARTED |
| E | 100 | 0 | NOT_STARTED |

## Implemented readiness

- Immutable A/B/C/D/E specifications and final-holdout learning prohibition.
- Point-in-time professional snapshot for candle sequence, body/wicks,
  rejection, range expansion/contraction, momentum alignment, trend
  efficiency, breakouts and liquidity sweeps.
- Explicit evidence availability and `asOf` timestamps; missing context is not
  encoded as a negative observation.
- WIN labeling only after the next closed one-minute candle and only when the
  directional return exceeds known cost.
- Signature statistics with support, weighted effective N, baseline lift,
  odds ratio, Wilson 95% interval and Net EV.
- Chronological phase-overlap rejection.
- Crypto news is no longer applied to Forex; missing/invalid/future article
  publication timestamps are rejected rather than replaced with `Date.now()`.

## Data required to start Phase A

1. Append-only 1m candles plus bid/ask quotes with provider timestamp,
   `receivedAt`, symbol and sequence/gap evidence.
2. A versioned FX macro archive containing `scheduledAt`, `releasedAt`,
   affected currencies, consensus/actual/previous and source revision.
3. Point-in-time news records with `publishedAt`, `firstSeenAt`, `fetchedAt`,
   source and URL, enforcing all three timestamps at or before the decision.
4. Enough strictly future, non-overlapping coverage for 1,000 + 1,000 + 1,000
   + 500 + 100 actionable signals. WAIT remains separate.

Until this exists, the honest output is `WAIT` and
`NO_ROBUST_70_1M_EDGE_FOUND`; no order execution capability is introduced.
