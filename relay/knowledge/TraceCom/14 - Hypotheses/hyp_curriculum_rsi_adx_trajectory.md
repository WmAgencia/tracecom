---
title: hyp_curriculum_rsi_adx_trajectory
topic: momentum-strength
category: HYPOTHESIS
sourceIds: [SRC-SCHWAB-ADX-RSI, SRC-CMT-EDU, SRC-CMT-ADX, SRC-CMT-RSI, SRC-STOCKCHARTS-RSI, SRC-STOCKCHARTS-ADX]
sourceTier: B
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.4
status: CANDIDATE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, MOMENTUM_CONTINUATION, REJECTION]
indicators: [RSI14, ADX14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY]
timeframes: [M1, M5]
tags: [hypothesis, momentum, trajectory, slope, acceleration, critics, promotion-gate]
---

# hyp_curriculum_rsi_adx_trajectory

**State: CANDIDATE_KNOWLEDGE. Observation only. This hypothesis MUST NOT be promoted, enforced by critics, or used to filter entries without prospective evidence. Promotion is owned exclusively by the existing HypothesisRegistry promotion gate.**

## Statement

RSI/ADX/DI trajectory (slope + acceleration) carries more decision value than static thresholds for 60s binary entries; entries with RSI already at extremes and rising against the position, or ADX falling while DI conflicts, should be filtered by the critics.

## Definitions (test design, not implementation)

- Trajectory = slope and acceleration of RSI14, ADX14 and DI_SPREAD computed on closed candles at decision time, over windows consistent with the existing feature engine (`relay/feature-engine.mjs`). Exact window lengths are to be fixed and frozen before testing begins; they must not be tuned after seeing outcomes.
- "RSI already at an extreme and rising against the position": for a proposed long, RSI at or above the regime-appropriate high band while its slope is positive and M1/M5 momentum is deteriorating; for a proposed short, the mirror condition. Band definition comes from the range rules in the reading guide, not from a fixed 70/30.
- "ADX falling while DI conflicts": ADX slope negative (or peaked) while the sign of DI_SPREAD disagrees with the intended position direction, or DI_SPREAD compresses across zero.
- Filter effect = critics would add a veto/contest condition on the above states; this must remain a *candidate* veto until the sample requirement below is met.

## Rationale from sources

- Momentum is explicitly described as the acceleration of price movement; decreasing acceleration precedes top speed, and a divergence is price climbing "with less enthusiasm" ([CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)). This supports testing slope/acceleration rather than only levels.
- "When the ADX is rising, the market is increasingly trending in either direction... A rising ADX indicates an increasing tendency to trend in the corresponding prices" ([CMT-GUIDE](https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf), indexed excerpt). Rising vs falling ADX therefore carries information beyond the ADX value itself.
- Schwab: defer to ADX first for the existence and strength of a trend; RSI provides secondary timing evidence; a turn lower in ADX may signal a pause, and if ADX keeps falling, RSI signals gain credibility; the stronger reversal warnings combine ADX topping out with an extreme RSI ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)). This is the direct source basis for "ADX falling while DI conflicts" as a de-risking state, and for treating RSI extremes differently depending on ADX phase.
- Mechanical overbought/oversold reading "often fails in trending markets"; overbought during strong trends signals momentum, not exhaustion; range rules replace fixed thresholds ([CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly)). This supports filtering entries taken *into* an extreme that is still moving against the position.
- RSI overbought/oversold readings are unreliable alone in a trending market (ADX above 20) ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)), and momentum oscillators can remain extreme in strong trends ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- DI crossovers are frequent and produce whipsaws; the ADX filter itself "tends to filter as many good signals as bad" ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)). This cuts both ways for the hypothesis: trajectory may help, but static ADX gating is explicitly not a solved problem - the test must compare against that baseline, not assume it.
- Divergences are misleading in strong trends ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)), so any trajectory filter must be regime-conditional; a flat filter would be contradicted by the sources.
- Stacking more momentum indicators creates redundancy and contradiction ([CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)); the hypothesis should be tested as a small set of trajectory features layered onto the existing critics, not as a new indicator stack.

## Falsification criteria (what data would disprove it)

1. If, over the prospective sample, entries with the filtered states (RSI extreme rising against position, or ADX falling with DI conflict) do not perform materially worse than matched unfiltered entries, then the filter has no decision value and must be rejected.
2. If the trajectory-filtered arm fails to beat the static-threshold arm by at least the promotion gate's minimum performance delta when the gate is evaluated, the central claim ("more decision value than static thresholds") is not supported.
3. If slope/acceleration states flip signs faster than the 60s settlement horizon (state is unstable at decision time), the features cannot be acted on causally and the hypothesis is infeasible as stated.
4. If the effect appears only in retrospective/backtest analysis and disappears in prospective settled results, reject (the gate already enforces `requireProspective: true`).
5. If the effect is regime-specific (for example only valid in TREND_UP) it must be restated as a narrower hypothesis; the general claim as written would be falsified.

## Sample requirement

- Absolute floor: the existing promotion gate defaults - `minSamples: 30`, `minPerformanceDelta: 0.10`, `maxDrawdown: 8`, `requireProspective: true` (`relay/professor.mjs`, `HYPOTHESIS_DEFAULTS`). Evaluation below 30 decided prospective samples returns HOLD by construction.
- Pre-registered requirement for this hypothesis (stricter than the floor, to be frozen before testing):
  - at least 30 decided prospective 60s entries in each condition arm (extreme-rising-against arm; ADX-falling-DI-conflict arm; matched control arm with neither condition);
  - spread across at least two regimes (for example TREND_UP/TREND_DOWN vs RANGE) and at least two of the listed markets;
  - features logged on both M1 and M5 with causal, closed-candle inputs only;
  - one sample per independent setup event; no overlapping duplicate windows for the same event.
- Context: the system's own daily report flags fewer than 30 decided trades as "AMOSTRA PEQUENA - nao tratar como vantagem comprovada" (`relay/professor.mjs`, `dailyReport`). Any promote decision also requires the prospective PnL-per-trade criterion, not win rate alone.

## Promotion gate - explicit note

- This file is CANDIDATE_KNOWLEDGE. `relay/knowledge-base.mjs` excludes CANDIDATE_KNOWLEDGE notes from default retrieval and applies a score penalty; `relay/second-brain.mjs` requires the promotion flag for protected knowledge paths; gauntlet check P6-HYP-03 (`relay/gauntlet-phase6.mjs`) explicitly asserts that the Promotion Gate does not promote without prospective evidence.
- It must NOT be promoted to `15 - Validated Knowledge` (or into critic logic) without prospective evidence collected through `HypothesisRegistry.observe/evaluate` (`relay/professor.mjs`). No code change, no critic rule, no filter may cite this hypothesis as authority until then.
- If and when the gate returns REJECT, the correct action is to archive this hypothesis as rejected, not to silently retune the windows and retry without a new statement.

## Current status and next steps

- 2026-09-17: created from source reading only; zero prospective observations; confidence 0.4 (rationale plausible, no TraceCom evidence).
- Next step (observation only): log the trajectory tuple (RSI band + slope, ADX level + slope + acceleration, DI_SPREAD sign + magnitude) alongside existing decision records without changing behavior. No execution impact.
- Any subsequent change to definitions must be versioned here before new data is collected.
