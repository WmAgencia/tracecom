# TraceCon hypothesis registry

Entries are registered before the experiment run. A negative result remains in
the registry; no outcome-based rewrite is permitted.

| ID | rationale and pre-registered feature | expected direction | horizons | market | primary metric | success / rejection |
| --- | --- | --- | --- | --- | --- | --- |
| H001 | Closed-candle momentum (5/20-bar normalized return) may contain short-horizon directional information. | Positive net EV after conservative Forex proxy cost. | 60–300s | Seven FX majors, Yahoo 1m | Locked-holdout net EV | Success only if holdout net EV > 0 with adequate N; otherwise reject/no evidence. |
| H002 | Trend plus London or London/New York overlap may improve on unconditional momentum. | Filter improves future, not historical, net EV. | 60–300s | Seven FX majors | Prequential batch net EV, then locked holdout | Candidate requires prior support ≥50 and a net-EV margin before use; frozen at trade 800. |
| H003 | Removing high-volatility regimes may reduce adverse selection. | Lower drawdown without worsening future net EV. | 60–300s | Seven FX majors | Locked-holdout net EV and DD | Reject when benefit does not persist in locked holdout. |
| H004 | Sub-minute prediction needs native quote/tick/second data. | No certification from 1m OHLC. | 30s, 45s | FX | Provider resolution audit | Reject any interpolation or derived subminute outcome. |
| H005 | L2 order-flow imbalance cannot be inferred from Yahoo OHLC. | Feature unavailable, not neutral/positive. | 30–60s | FX | Data provenance | Reject any claim of true OFI without order-book events. |

## Anti-hindsight rules

- Entry uses only a closed one-minute candle and the preceding 20 continuous
  bars. Outcome is released only after the corresponding future close.
- Candidate strategies are fixed in source: `BASELINE`, `LONDON_TREND`, and
  `NO_HIGH_VOL`. The selector only sees labels released before the next entry.
- A per-pair horizon embargo prevents overlapping outcome windows. The last 200
  accepted trades are locked holdout; strategy and version cannot change there.
- Data gaps, duplicates, incomplete bars, missing native resolution and poor
  data quality yield exclusion/`WAIT`, never invented WIN/LOSS.
