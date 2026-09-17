---
title: Lesson - Decision Sequence and Trade Thesis
topic: decision-sequence
category: CORE_BRAIN
sourceIds: [SRC-CME-TA, SRC-CME-SR, SRC-TRADINGVIEW-DONCHIAN]
sourceTier: A
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION]
setups: [BREAKOUT_CONTINUATION, BREAKOUT_RETEST, FAILED_BREAKOUT, RANGE_REVERSAL, REJECTION, TREND_PULLBACK]
indicators: [DONCHIAN, ATR14]
markets: [EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY]
timeframes: [M1, M5, M15]
tags: [decision-sequence, trade-thesis, location, wait-discipline, entry-quality]
---

# Lesson - Decision Sequence and Trade Thesis

A structured lesson on how a TraceCom decision should be built in order, from context to execution, and how to attack that decision with an adversarial review before acting. The mechanics of levels, breakouts, retests and ATR-normalized location measurement are defined in the companion note `20 - Professional Curriculum/Structure and Location - Support Resistance Donchian.md` (referred to below as **S&L**).

Primary sources for this lesson: CME Group's technical analysis course ([CME-TA](https://www.cmegroup.com/education/courses/trading-and-analysis/technical-analysis)), CME Group's Support and Resistance lesson ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)), and TradingView's Donchian Channels help page ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)). Secondary S/R and Donchian material from StockCharts is cited where S&L already establishes it. CME pages returned 403 to direct fetch; their text was obtained via a read-only extraction proxy and matched search-indexed text of the same URLs (disclosed in S&L, section 0).

All thresholds below are symbolic engine parameters (`theta_*`, `N_*`). No source in this lesson states a probability, win rate, expectancy or calibrated intraday number; none is invented here.

## How this lesson is organized

The sequence is a filter pipeline: **CONTEXT -> REGIME -> STRUCTURE -> LOCATION -> SETUP -> MOMENTUM -> STRENGTH -> VOLATILITY -> TRIGGER -> MICROSTRUCTURE -> TIMING -> ENTRY QUALITY -> DECISION**. Each gate is evaluated only on closed candles. A later gate can veto an earlier one; a gate cannot be skipped forward. Every gate has four questions:

- **What to look at** - the observable inputs.
- **What evidence must exist** - the minimum content required to pass the gate.
- **What invalidates it** - the observation that falsifies this gate's claim.
- **What pushes to WAIT** - the condition under which the decision is delayed rather than denied.

"WAIT" is a valid decision (see `07 - Playbooks/WAIT_DISCIPLINE.md`); "no setup" and "setup with bad location" both end in WAIT, with different reason codes.

## 1. CONTEXT

- **What to look at:** the state of the specific market across M15, M5 and M1 using closed candles only; the behavior of the other watched pairs (are they moving or idle); session state (Asian/London/Overlap/NY) and proximity to macro event windows; whether recent price action is being driven by identifiable one-off news, which CME lists among the reasons a trend pauses: "News. Day-to-day news items can influence buying or selling that goes against the trend" ([CME-TA](https://www.cmegroup.com/education/courses/trading-and-analysis/technical-analysis)).
- **Evidence required:** a one-sentence market-state statement, written before any setup is considered, that states the timeframe alignment or explicitly labels disagreement (for example "M15 up, M5 flat, M1 retracing"). CME's framing supports this: "Technical traders who hop on a trend play a game of follow-the-leader... to not get in the way of a trend but to go along with it" ([CME-TA](https://www.cmegroup.com/education/courses/trading-and-analysis/technical-analysis)).
- **What invalidates it:** facts that cannot be composed into one statement; the instrument behaving unlike its session norm; a scheduled event inside the trade horizon (repo gates `05 - Microstructure` and `06 - Macro`).
- **Pushes to WAIT:** context unclassifiable; imminent news window; session illiquidity (characteristic of the Sunday open or session handoff, per `07 - Playbooks/OTC_SESSION_BEHAVIOR.md`).

## 2. REGIME

- **What to look at:** Donchian width relative to ATR14 and its trajectory; slope of the Donchian middle line; which edge of the channel price has been working; repeated closes beyond an edge vs repeated failures at both edges.
- **Evidence required:** one label from {TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION} with the price facts that produced it. TradingView's reading rules apply: bands widen with high volatility and narrow with low volatility ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)); the indicator "primarily work[s] best within a clearly defined trend" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)). Continuous exceeding of one band is a strength statement, not a reversal statement ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- **What invalidates it:** the middle line's slope flips; price stops working one edge and starts working the other; width stops contracting/expanding as the label requires.
- **Pushes to WAIT:** regime unclassified, TRANSITION or CHAOTIC (matching the blocking criteria in `00 - Core Brain/Process.md`); two regime labels fit equally well. `[TRACECOM ADAPTATION]` COMPRESSION = contracting width/ATR; EXPANSION = widening width after contraction; the sources describe the volatility behavior but do not formalize these regime names for M1/M5/M15.

## 3. STRUCTURE

- **What to look at:** the objectively identified levels per S&L section 2 - pivot highs/lows, previous session extremes, channel boundaries, and levels created by prior breaks whose role has reversed ("support will become resistance and resistance will become support", [CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)). Include touch counts; StockCharts confirms resistance with failed retests ("the resistance level was confirmed when the stock failed to advance past 42.5", [SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- **Evidence required:** at least one level with a defined break rule (close-basis), a measurable distance from current price, and - for the intended direction - at least one prior reaction that created it. A price that would prove the thesis wrong must exist at this gate.
- **What invalidates it:** the only nearby level is wick-defined (ambiguous); the level exists but its break rule is undefined; the invalidation price is not expressible from OHLC.
- **Pushes to WAIT:** no defined invalidation for the intended setup - the repo already treats this as a discard ("Setup sem invalidacao clara: descartar", `00 - Core Brain/Process.md`); structure contradicts the context statement from gate 1.

## 4. LOCATION

- **What to look at:** the S&L section 4.2 metrics - `pos = (C - D_L)/(D_U - D_L)`, `headroom = (D_U - C)/ATR14` (mirrored for shorts), `ext = (C - D_M)/ATR14`, `travel = (C - level)/ATR14` with `bars_since_break`, and the retest distance after an accepted break.
- **Evidence required:** the four location archetypes judged explicitly (edge / middle / extended / already-traveled), with numbers. Sourcing: entering at a boundary or on a pullback to a level is the sourced pattern ("if price is moving up then retraces to the 55-period moving average, then starts to move back up, there is a good chance that the level will hold as support", [CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)); entering after the move has run is warned against ("Do not chase a position after a three-day move. Wait for a one-day reversal to improve the risk-reward ratio", [SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)).
- **What invalidates it:** any INVALID result on S&L rubric checks Q1-Q5, Q7 or Q12 - wrong side of structure, at/through the boundary, wick-only break, failed acceptance, no retest hold, or no definable invalidation distance.
- **Pushes to WAIT:** middle of range; extension beyond `theta_ext`; post-breakout travel beyond `theta_travel`; headroom below `theta_headroom`. The dedicated rule is in the "Entry Location Quality" section below.

## 5. SETUP

- **What to look at:** which of the six allowed setups the regime + structure + location actually describe. Setup selection uses the current regime as a filter, never the desire to trade.

| Setup | Defining evidence (close-basis) | Source anchor |
|-------|--------------------------------|---------------|
| BREAKOUT_CONTINUATION | Accepted close-basis break of a level/band edge, trend regime, price still near the break | "If price breaks through support, then it will generally continue in that direction" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)); new N-period high ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)) |
| BREAKOUT_RETEST | Prior accepted break, price returns to the broken level, closed candle holds it in the reversed role | NDX held 935 after a resistance break until "935 was established as a new support level" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)); role reversal ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)) |
| FAILED_BREAKOUT | Close-basis break, then a later closed candle closes back through the level | WorldCom poked above 62, then "a gap down a few days later nullified the breakout" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| RANGE_REVERSAL | RANGE regime; reaction at a boundary with a closed candle resuming toward the interior | "Support may be looked upon as an opportunity to buy, and resistance as an opportunity to sell" within a valid range ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| REJECTION | Wick beyond a level with a close back on the pre-level side, against the attempted break | Lucent's long lower shadows (hammers) before the resolution ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| TREND_PULLBACK | Trend regime; retracement to a reference level (mid-channel or prior level) with a closed resumption candle | CME 55-period MA retrace example ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)) |

- **Evidence required:** the setup's defining condition is present in the closed data, not anticipated. A retest setup requires the retest candle; a failed breakout requires the close back through.
- **What invalidates it:** the defining condition is absent (e.g., "retest" without a prior accepted break is just a touch); setup belongs to a regime that is not current.
- **Pushes to WAIT:** setup/regime mismatch; ambiguity between two setups that imply opposite directions.

## 6. MOMENTUM (price-derived in this lesson)

- **What to look at:** the progression of closes in the trade direction; the close location within the trigger candle's own range, `(C - L)/(H - L)`; whether price keeps pressing the same band; whether a close-only evaluation of the channel still registers the move. StockCharts documents that close-only channel evaluation removed intra-period false signals ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- **Evidence required:** at least `N_momentum` consecutive closed candles progressing in the trade direction (higher closes for longs), or a closed resumption candle after a pullback whose close sits in the top part of its range; band presses continue to occur on closes, not only wicks. TradingView: moving into overbought territory during a bullish trend "can indicate a strengthening trend" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- **What invalidates it:** a closed candle in the trade direction that closes in the lower part of its range (for longs); the last close fails to exceed the prior close after a run.
- **Pushes to WAIT:** flat sequence of alternating closes; momentum evidence conflicts with the LOCATION reading (for example, strong closes but at the opposite boundary).
- Note: oscillator-based momentum (RSI14/ADX14/DI_SPREAD) belongs to `20 - Professional Curriculum/Momentum and Trend Strength - RSI ADX Reading Guide.md`; this gate intentionally stays price-structural.

## 7. STRENGTH

- **What to look at:** follow-through size relative to ATR14 (range of breakout candles vs typical range), depth of pullbacks relative to the preceding impulse (in ATR14), persistence of closes beyond the level, and repeated band exceeding. StockCharts: "Price continuously exceeding the upper channel line is a sign of strength... securities that continuously break the lower channel line show weakness" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- **Evidence required:** acceptance count `>= N_accept` closes beyond the level (S&L section 3); pullback depth `<= theta_pullback` ATR14 relative to the impulse being continued; no close back through the level since acceptance.
- **What invalidates it:** a close back through the level (this is also the FAILED_BREAKOUT definition); pullbacks progressively deeper in ATR14 terms; follow-through candles progressively smaller than `ATR14`.
- **Pushes to WAIT:** acceptance count between 1 and `N_accept - 1`; strength evidence split (one pair strong, correlated pair not).

## 8. VOLATILITY

- **What to look at:** ATR14 level vs its own trailing reference; Donchian `width/ATR14`; whether expansion happened before or after the trigger; the repo condition in `02 - Setups/BREAKOUT_RETEST.md` that ATR14 must not collapse after the break.
- **Evidence required:** for breakout setups, a compression-to-expansion sequence; for pullback/retest setups, stable or gently declining ATR14 and a width that has not collapsed; volatility consistent with the setup type.
- **What invalidates it:** ATR14 collapse immediately after the breakout (the retest/continuation capability is gone); unexplained volatility explosion without structure; width/ATR at an extreme versus its own history in the direction that removes headroom.
- **Pushes to WAIT:** volatility state ambiguous or inconsistent with the setup; trigger occurred on an outlier-range candle whose close is far from the level (ties to LOCATION).

## 9. TRIGGER

- **What to look at:** the single closed candle that converts the thesis into an actionable state: close beyond the level (breakout), close back through the level (failed breakout), close on the breakout side after a return (retest), or close resuming into the range (range reversal), plus that candle's close location within its own range.
- **Evidence required:** close-basis confirmation exactly as defined for the setup in gate 5. Wicks do not trigger anything (S&L section 3; the source's own distinction between "poked its head above" and "closed above" at [SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)). `[TRACECOM ADAPTATION]` on M1/M5/M15 the equivalent of "wait for a one-day reversal" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)) is waiting for one closed resumption candle after the counter-move.
- **What invalidates it:** the trigger candle closes back through the level; the trigger candle's close location is adverse (S&L Q10 INVALID); the trigger appears after `N_fresh` candles without a pullback (chase, ties to TIMING).
- **Pushes to WAIT:** no closed trigger yet - anticipating a trigger before the candle closes is never allowed; the data note in `05 - Microstructure/FRESHNESS_STALENESS.md` applies.

## 10. MICROSTRUCTURE (OHLC-only scope)

- **What to look at:** candle anatomy from OHLC only (the engine has no order book, no spread feed, no volume for these pairs): size of the gap between the trigger candle and the previous one, whether the trigger is the last candle before a session break, whether H = L or the range is anomalous vs ATR14, and whether price is trading through a session boundary (repo `05 - Microstructure/CANDLE_CLOSE_SETTLEMENT.md`, `07 - Playbooks/OTC_SESSION_BEHAVIOR.md`).
- **Evidence required:** no unexplained gap immediately preceding or inside the trigger structure; trigger candle is not the settlement candle of a session; candle anatomy normal relative to ATR14. Donchian's own guideline warns against relying on gap fills: "Don't count on gaps being closed unless you can distinguish between breakaway gaps, normal gaps, and exhaustion gaps" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)) - TraceCom cannot make that classification from OHLC, so gaps are treated as caution, not as targets.
- **What invalidates it:** trigger placed on stale or holiday-thin candles; an unclassified gap between the level and the trigger close.
- **Pushes to WAIT:** trigger on a session-boundary candle; microstructure evidence unavailable (freshness gate failed) - matching the blocking rule in `00 - Core Brain/Process.md` ("Feature desatualizada (freshness gate reprovado): nao decidir").

## 11. TIMING

- **What to look at:** `bars_since_break`, bars since the last counter-direction extreme, whether the trigger is fresh or late, and whether setup expiry has been exceeded. `02 - Setups/BREAKOUT_RETEST.md` already requires an "expiracao coerente com o tempo de retorno ao nivel observado no ativo".
- **Evidence required:** trigger within `N_fresh` closed candles of the level event; no more than `N_chase` candles since the breakout without a reset (pullback/retest); setup not past its configured expiry.
- **What invalidates it:** the setup's expiry window elapsed; the level event is stale relative to the timeframe's normal reaction time.
- **Pushes to WAIT:** late trigger; expired setup; session timing unfavorable for the instrument (repo session notes).

## 12. ENTRY QUALITY

- **What to look at:** the structural geometry of the entry, using S&L section 7: entry position vs `D_M` and the working edge; `headroom` and `legroom` in ATR14; distance from entry to the invalidation price (stop) in ATR14; for post-breakout entries, `travel` and `bars_since_break`.
- **Evidence required:** all LOCATION gates (Q1-Q5, Q7, Q12) VALID; stop distance within `[theta_stop_min, theta_stop_max]` ATR14; `headroom / stop_distance >= theta_rr` (a structural ratio, not a probability statement).
- **What invalidates it:** any INVALID location check; an entry that sits in the middle of the range between the boundary and the invalidation.
- **Pushes to WAIT:** DEGRADED states from Q8-Q11; stop distance outside the parameter band. The dedicated rule is below.

## Entry Location Quality

**Rule: a valid setup at a bad entry price is a WAIT, not a trade.**

Formally: if gates 1-11 produce a valid setup but the S&L section 7 location rubric returns INVALID on any of Q1-Q5, Q7 or Q12, the decision is:

```
WAIT - VALID_SETUP_BUT_BAD_ENTRY_PRICE
```

Rationale, grounded in the sources rather than in outcome statistics:

- S/R levels are "zones... favorable for traders to enter or exit a trade" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)); entering away from the favorable side of the zone abandons the structural edge the setup was built on.
- Chasing is explicitly warned against, and the fix is patience, not conviction: "Do not chase a position after a three-day move. Wait for a one-day reversal to improve the risk-reward ratio" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)).
- The price paid determines both the distance to the invalidation level and the distance to the opposing boundary; a valid setup entered at a bad price has worse structural geometry on both sides, independent of whether the thesis is later proven right or wrong.

The rule cuts both ways: a bad location does not "fix itself" with more evidence at the same price; it is resolved either by price returning to the favorable zone (a retest) or by the setup expiring (WAIT reason `SETUP_EXPIRED`). No probability claim is made or implied - the rule is about geometry, not about expected outcomes.

## Building the trade thesis

A TraceCom thesis is a falsifiable statement assembled from the gate evidence, not a narrative. Template:

```
Because {CONTEXT statement} and {REGIME label with its price facts},
structure at {level(s)} supports {SETUP} in direction {D}.
Evidence: location pos={...}, headroom={...} ATR, travel={...} ATR;
momentum: {N} closes progressing {direction};
strength: {N} closes accepted beyond {level}; volatility: {state};
trigger: closed candle at {time} closed {above/below} {level}.
Invalidation: a closed candle back {through/below/above} {price}.
If that close occurs, the thesis is false and no revision is allowed
without a new trigger candle.
```

Rules for the thesis:

1. Every clause must be computable from closed OHLC candles and the engine features (DONCHIAN, ATR14). Unobservable claims (volume, order flow, "buyers are strong") are disallowed.
2. The invalidation is a specific price event, not a feeling. `00 - Core Brain/Process.md` already discards setups without clear invalidation.
3. No probabilities, no expected target claims. The sources describe behavior patterns, not frequencies.
4. The thesis is written before the ENTRY QUALITY gate is scored, so the entry-price rule can veto it without post-hoc edits.
5. The thesis references the setup's expiry; a thesis that cannot expire is a bias, not a thesis.

## The adversarial critic

Before DECISION, the thesis is attacked step by step. The critic's job is to try to refute, not to confirm; if any refutation succeeds, that gate fails and the decision is WAIT with the corresponding reason code.

| Step | Critic's refutation question | Refutation succeeds if... |
|------|------------------------------|---------------------------|
| CONTEXT | "Is there a fact that makes the one-sentence context statement false (conflicting timeframe, news window, session anomaly)?" | Any part of the statement cannot be shown from closed candles |
| REGIME | "Can the same data support a different regime label equally well?" | Two labels remain viable after listing the price facts |
| STRUCTURE | "Does the identified level survive re-derivation (pivot definition, touch count, close-basis rule)?" | The level depends on a wick, an arbitrary lookback, or an undefined break rule |
| LOCATION | "Compute the S&L rubric as a hostile reviewer: is any of Q1-Q5, Q7, Q12 INVALID?" | Any INVALID result stands after re-check |
| SETUP | "Is the defining condition actually present on closed candles, or is it assumed?" | The condition requires an unfinished candle or an interpretation |
| MOMENTUM | "Does the last closed candle contradict the momentum claim?" | The latest close is adverse or the progression claim fails recount |
| STRENGTH | "Is the pullback deeper in ATR14 than the parameter allows, or is acceptance short of N_accept?" | Either check fails |
| VOLATILITY | "Is the volatility state inconsistent with the setup (collapse after break, no compression before expansion)?" | Inconsistency confirmed |
| TRIGGER | "Was the trigger a close-basis event, or a wick?" | The trigger candle closes back inside the level zone |
| MICROSTRUCTURE | "Is the trigger affected by a gap, session boundary, or stale data?" | Any anomaly is present and unexplained |
| TIMING | "Is this a fresh trigger or a chase past N_chase / an expired setup?" | `bars_since_break > N_chase` without a reset, or expiry exceeded |
| ENTRY QUALITY | "If entry is taken at the current price, what is the distance to invalidation and to the opposing boundary in ATR14?" | Structural geometry violates `theta_rr` or any INVALID location check |
| DECISION | "If every gate is re-run on the raw closed-candle data, does the decision survive?" | Any gate status changes on re-run |

A refutation that cannot be resolved with current data is not ignored; it becomes a WAIT. This mirrors the repo's review principle of comparing the outcome to the original hypothesis rather than to the profit (`00 - Core Brain/Process.md`).

## WAIT reason codes

| Code | Triggered at gate | Meaning |
|------|-------------------|---------|
| CONTEXT_UNCLASSIFIED | 1 | Market state cannot be stated in one sentence from closed candles |
| REGIME_UNCONFIRMED | 2 | Regime label ambiguous, TRANSITION or CHAOTIC |
| NO_DEFINED_INVALIDATION | 3 | No OHLC-definable price that falsifies the thesis |
| MID_RANGE_LOCATION | 4 | `pos` in the middle band around `D_M` |
| EXTENDED_FROM_BOUNDARY | 4 | `abs(ext) > theta_ext_max` |
| BREAKOUT_ALREADY_TRAVELED | 4, 11 | `travel > theta_chase` and/or `bars_since_break > N_chase` without a reset |
| WICK_ONLY_BREAK | 9 | Level touched intrabar, no close-basis confirmation |
| FAILED_ACCEPTANCE | 7, 9 | Close back through the level after a break |
| VOLATILITY_COLLAPSE | 8 | ATR14/width collapse after the break |
| TRIGGER_NOT_CLOSED | 9 | Trigger candle still forming |
| MICROSTRUCTURE_ANOMALY | 10 | Gap, session-boundary candle or stale data at the trigger |
| SETUP_EXPIRED | 11 | Configured expiry elapsed |
| VALID_SETUP_BUT_BAD_ENTRY_PRICE | 12 | Setup gates pass, location rubric INVALID on the entry price |

## What this lesson does not claim

- No probabilities, win rates, expectancy numbers or target statistics; none exist in the cited sources and none are added here.
- No validation of 60-second binary entries on FX: the sources are general, discretionary trading-education pages. Every M1/M5/M15 mapping is marked `[TRACECOM ADAPTATION]`.
- No volume confirmation, order-flow confirmation or spread analysis: those inputs do not exist in TraceCom's data for these pairs.
- No replacement for the engine's risk gates (`04 - Risk/`) or freshness checks (`05 - Microstructure/`); this lesson sits between them.

## Limitations

- CME source pages were 403 to direct fetch; text via read-only proxy, cross-checked against search-indexed text of the same URLs (see S&L section 0). Confidence 0.85 reflects this and the adaptation load.
- All `theta_*` and `N_*` parameters are placeholders requiring offline calibration and audit; the sources establish principles, not intraday values.
- The sequence's ordering (LOCATION before SETUP, TIMING near the end) is a TraceCom design choice, not a sourced procedure; it is marked as adaptation throughout.
- The adversarial critic table is an internal review method; no source prescribes it.
