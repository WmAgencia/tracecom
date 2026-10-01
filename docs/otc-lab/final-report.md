# OTC BLACK BOX — 26H ALGORITHM INVESTIGATION

## Dataset audit

| Property | Result |
|---|---|
| Asset | Blitz EUR/USD OTC, ID 76 |
| Source | `data\otc-lab\raw\blitz-eurusd-otc-1m-live.json` |
| Frozen SHA-256 | `fae9f037647a0bf4d38619d6a1ae7e6322e381ace1c81e07ccf363ab449f7896` |
| Candles / resolution | 1607 / 60s |
| Period | 2026-09-26T09:16:00.000Z to 2026-09-27T12:07:00.000Z (26.85h elapsed) |
| Duplicated timestamps | 0 |
| Gaps | 1 (5 missing expected candles) |
| Continuity at exact 60s | 99.938% |
| Price precision | 6–6 decimals; min observed close increment 0.00001 |
| Payout | Not returned with this candle dataset |
| Supabase | No OTC-specific schema/table reference in repository search; no live query made |
| Upper bound independent 300s outcomes | 322 (before signal overlap/regime dependence) |

## Findings

This record contains 320 exact, non-overlapping 300-second direction observations. Treat this as a descriptive effective sample, not thousands of independent 1-minute labels. Earlier experiments inspected this entire collection, so its final fifth cannot serve as a blind test.

The prior V1 method reproduces 19/27 (70.37%), with 19 signal windows crossing the 6-minute gap and 0 expiries settled late. Requiring continuous inputs and exact 300s settlement leaves 3/8 signals (37.50%) and 2 non-overlapping events. This invalidates the apparent 70% result. Payout remains unavailable.

The source cadence is one minute. Returns at 5, 10, 15, and 30 seconds and periodicities below one minute are unobservable. The +45s score previously reported from this source is only a first-close proxy and is not an exact 45-second outcome.

## Forecast benchmark

On the nominal last 20% (62 non-overlapping test cases, already contaminated by earlier inspection), logistic regression scored WR 62.9%, balanced accuracy 53.6%, AUC 0.653, Brier 0.221, and log loss 0.632. Its moving-block bootstrap 95% WR interval is 53.2–72.6%, but this uses only about 5 hour-sized blocks.

The 2-state Gaussian HMM scored 51.6% WR and AUC 0.605. Training BIC preferred 2 states over 3; the test is not blind. Logistic coverage of 5% and 1% contains only 4 and 1 cases; their apparent high accuracy is too small to infer a strategy.

## Answers to the research questions

1. Random or state-conditioned: insufficient evidence to identify the hidden process. Changing realized volatility is visible descriptively; it does not prove states inside the broker.
2. Return memory: see `autocorrelation.json`; pointwise ACF flags are exploratory and multiple-tested.
3. Mean reversion and momentum: no robust predictive effect established.
4. Periodicity: unresolved at this resolution; spectral peaks require independent replication.
5. Repeated motifs: nearest non-overlapping normalized subsequences were evaluated; accuracy stayed near chance. See motif-analysis.json.
6. Distribution: empirical moments and quantiles are in `returns-analysis.json`; tails alone do not identify a generator.
7. Regime changes: descriptive volatility blocks and 2/3-state Gaussian HMMs are in regime-analysis.json and model-benchmark.json; no prospective hidden state was confirmed.
8. Generative family: empirical bootstrap, Gaussian random walk, AR(1), and two-state volatility models were simulated 30 times each; the closest summary fit is not identification of the generator.
9. Predicting T+300: V1 had 8 selected signals, too few and contaminated for evidence of predictive value.
10. Out-of-sample performance: unavailable; the whole history was previously inspected.
11. Payout-adjusted value: unavailable because payout metadata is absent.
12. Rejected claims: no evidence currently supports a secret algorithm reconstruction or stable 70% forecast.
13. Next data: freeze this protocol and gather a new prospective window, ideally at 5-second resolution for sub-minute behavior, with payout and synchronized timestamps.

## Researcher and critic

Researcher: a volatility expansion condition may be worth future prospective observation. Critic: the headline 19 wins depended on windows crossing a six-minute gap. V1 status is `INVALIDATED_AFTER_CONTINUITY_AUDIT`.

## Reproduction and artifacts

Snapshot: `data\otc-lab\frozen\blitz-eurusd-otc-1m-fae9f037647a.json`. SHA-256: `fae9f037647a0bf4d38619d6a1ae7e6322e381ace1c81e07ccf363ab449f7896`. Machine-readable artifacts, the reconstructed series, and price/ACF charts sit beside this report. All work is isolated in `relay/otc-lab/`, `tests/otc-lab/`, and `docs/otc-lab/`; no orders were placed.
