---
title: Momentum and Trend Strength - RSI ADX Reading Guide
topic: momentum-strength
category: INDICATOR
sourceIds: [SRC-SCHWAB-ADX-RSI, SRC-CMT-EDU, SRC-CMT-ADX, SRC-CMT-RSI, SRC-STOCKCHARTS-RSI, SRC-STOCKCHARTS-ADX]
sourceTier: B
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.85
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION]
setups: [TREND_PULLBACK, BREAKOUT_CONTINUATION, MOMENTUM_CONTINUATION, REJECTION]
indicators: [RSI14, ADX14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY]
timeframes: [M1, M5]
tags: [momentum, trend-strength, regimes, divergence]
---

# Momentum and Trend Strength - RSI ADX Reading Guide

Reading guide for how RSI14, ADX14 and the DI pair (+DI/-DI, consumed in TraceCom as DI_SPREAD) should be read together as evidence about momentum and trend strength. Sources are professional-education pages (tier B). None of them validates 60-second binary entries on FX; every mapping to M1/M5 is therefore an adaptation, marked below as `[TRACECOM ADAPTATION]`.

## Source key

| Key | Source | URL | Fetch status |
|-----|--------|-----|--------------|
| SCHWAB | Charles Schwab - "Spot and Stick to Trends with ADX and RSI" (Aug 4, 2026) | https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi | Fetched |
| SC-RSI | StockCharts ChartSchool - RSI | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi | Fetched (original school.stockcharts.com/doku.php URL failed; this is the current ChartSchool URL) |
| SC-ADX | StockCharts ChartSchool - ADX | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx | Fetched (original school.stockcharts.com/doku.php URL failed; this is the current ChartSchool URL) |
| CMT-EDU | CMT Association - Education hub | https://cmtassociation.org/education | Fetched |
| CMT-RSI | CMT Association / Investopedia ChartAdvisor - "Mastering the RSI: How to Read it Correctly" (May 9, 2025) | https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly | Fetched |
| CMT-MOM | CMT Association - Market Mosaic Daily, "Momentum Indicators and their Value" (Feb 18, 2026) | https://content.cmtassociation.org/a/momentum-indicators-and-their-value | Fetched |
| CMT-GUIDE | CMT Association - 2024 CMT Program Guide (PDF), quoting CMT Level II Curriculum (2023), Ch. 38 | https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf | PDF binary not text-extractable in this session; quotes below are from the search-engine-indexed text of this exact URL |
| CMT-HILL | CMT Association - "RSI for Trend Following and Momentum Strategies" (Arthur Hill, July 2020) | https://cmtassociation.org/video/rsi-for-trend-following-and-momentum-strategies | Fetched (video landing page; linked slide deck not extracted) |

No statistic in this note was invented; every threshold, range and behavior below is stated in one of the sources above.

## 1. RSI multi-timeframe reading

- RSI is a 0-100 momentum oscillator developed by J. Welles Wilder; above 70 is generally read as overbought, below 30 as oversold ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- The same RSI construction can be applied to daily, weekly, hourly and minute charts; the "best timeframe to use depends on your trading strategy and goals" ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- The 14-period default can be lowered to increase sensitivity or raised to decrease it; a 10-day RSI reaches overbought/oversold more often than a 20-day RSI, and short-term traders sometimes use 2-period RSI with 80/20 thresholds ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- RSI values are smoothed with a Wilder exponential-style average; values stabilize as the calculation period extends, so an intraday RSI computed from a short warm-up window will not match a long-history RSI ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- RSI can be used not only as an oscillator but also "to define the trend and identify early leaders" ([CMT-HILL](https://cmtassociation.org/video/rsi-for-trend-following-and-momentum-strategies)).
- `[TRACECOM ADAPTATION]` Read RSI on M5 for context/bias and on M1 for timing; when the two disagree (for example M5 RSI below 50 while M1 RSI is above 70), treat momentum evidence as internally conflicted and downgrade confidence instead of picking one timeframe. No source endorses this specific combination; it is derived from the general multi-timeframe statement above.

## 2. RSI divergence: regular and hidden

- Regular bullish divergence: the security makes a lower low while RSI forms a higher low (momentum does not confirm the lower low) ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- Regular bearish divergence: the security records a higher high while RSI forms a lower high (momentum does not confirm the new high) ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- Divergences "tend to be more robust when they form after an overbought or oversold reading", but "divergences are misleading in a strong trend": a strong uptrend can print numerous bearish divergences before a top, and a down-trending market can print bullish divergences while continuing lower ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- Schwab shows the same failure mode from the ADX side: in its example, the stock tests prior highs while the ADX starts to roll lower, and this combination - not the divergence alone - is presented as evidence the uptrend is weakening ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- Momentum divergence is described as price climbing "with less enthusiasm" - a car that keeps getting faster but at a slower rate ([CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)).
- Hidden divergence terminology is not used by any of these sources. The nearest sourced concepts are Andrew Cardwell's reversals, which invert the divergence logic and put price action first ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)):
  - Positive reversal: RSI makes a lower low while price makes a higher low; the RSI low is usually between 30 and 50 (not oversold) ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
  - Negative reversal: RSI makes a higher high while price makes a lower high; the RSI high is usually in the 50-70 area ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- `[TRACECOM ADAPTATION]` Map "hidden bullish" to Cardwell positive reversal and "hidden bearish" to Cardwell negative reversal for internal labeling only. Treat both as context warnings, never as entries, for the same reason regular divergences fail in strong trends.

## 3. RSI failures in strong trends - why 70 is not a sell in a trend

- Conventional lines are 30 and 70, but in strong bull markets "sometimes a move above 80 is considered overbought and a move below 40 is considered oversold"; the instrument's own historical RSI behavior should guide at which levels it tends to mean-revert within the trend ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- In a trending market (ADX above 20), overbought and oversold conditions "are common occurrences and do not always provide a reliable trade signal on their own" ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- Momentum oscillators "can become overbought (oversold) and remain so in a strong up (down) trend"; in StockCharts' McDonald's example, the first three overbought readings foreshadowed consolidations and only the fourth coincided with a significant peak ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- Mechanical threshold reading "often fails in trending markets" and leads to false signals and premature exits; overbought RSI during strong trends "signal[s] momentum, not necessarily exhaustion" ([CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly)).
- Constance Brown's range rules, as summarized by CMT Association: in an uptrend RSI tends to operate between roughly 40 and 90 with 40-50 acting as support; in a downtrend it tends to operate with lows around 20-30 and highs limited to roughly 55-65 ([CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly)); StockCharts gives the same bull range 40-90 / bear range 10-60 with 40-50 support and 50-60 resistance, and notes that pullbacks into the bull range zone provided low-risk entries in its SPY example ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- Trend reversals often begin when RSI stops reaching its prior range extremes - a range shift is described as an early clue that the market phase is transitioning ([CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly)).
- `[TRACECOM ADAPTATION]` On M1/M5, do not convert "RSI > 70" or "RSI < 30" into an entry or an exit. Use the regime-appropriate band (bull band vs bear band vs range band) and the direction of travel within the band as the evidence.

## 4. ADX measures strength, not direction

- ADX is derived from the smoothed difference between +DI and -DI and "measures the strength of the trend (regardless of direction) over time" ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- "The Average Directional Index (ADX) is used to measure the strength or weakness of a trend, not the actual direction" ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- The ADX "will rise if a trend is forming, regardless of its direction up or down" ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- "When the ADX is rising, the market is increasingly trending in either direction... A rising ADX indicates an increasing tendency to trend in the corresponding prices" (CMT Level II curriculum text quoted in the [CMT-GUIDE](https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf)); the same material's sample exam item states that when ADX rallies above both directional lines, it identifies a trending market ([CMT-GUIDE](https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf)).
- Wilder's thresholds: strong trend when ADX is above 25, no trend below 20, gray zone between 20 and 25; many analysts use 20 as the key level; ADX also has substantial lag because of the smoothing, and roughly 150 periods of data are needed for fully stable values ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Schwab's reading bands: 20-40 = trend in place and gathering strength (up or down); above 40 = very strong trending territory, but could also mean a potential top or bottom is on the horizon; 60-100 = extremely strong trend and relatively rare; below 20 = no meaningful trend ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- ADX can stay above 20 while an uptrend flips into a downtrend because both are strong trends; in StockCharts' Nordstrom example the ADX remained elevated through the direction change ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).

## 5. +DI / -DI crossover logic

- +DI and -DI "measure trend direction over time": when +DI is above -DI the trend is up; when +DI is below -DI the trend is down ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Wilder's system: first require ADX above 25 (many traders use 20) to ensure prices are trending; a buy signal occurs when +DI crosses above -DI, a sell signal when -DI crosses above +DI; the initial stop is the low (buy) or high (sell) of the signal day, and the signal stays in force while that level holds, even if the DI cross reverses ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- DI crossovers are frequent: "there are plenty of +DI and -DI crosses. Some occur with ADX above 20 to validate signals. Others occur to invalidate signals", producing whipsaws, great signals and bad signals ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Filters suggested by the source: ignore bearish DI signals inside a bullish continuation pattern; ignore buy signals directly into resistance; focus on +DI buys when the bigger trend is up and -DI sells when the bigger trend is down; use volume and chart patterns for confirmation ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Caution on the ADX filter itself: "Setting an ADX requirement will reduce signals, but this uber-smoothed indicator tends to filter as many good signals as bad"; the article suggests considering moving ADX to the back burner and letting the DI lines generate signals, then filtering with other analysis ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Schwab assigns direction differently - not via DI, but from the price chart: when ADX moves above 20, "the underlying security's price chart can help identify whether that trend is up or down" ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- `[TRACECOM ADAPTATION]` Treat a DI cross as a change of directional evidence, not as an entry trigger. Require the cross to persist for a minimum number of closed M1 candles and to agree with M5 structure before raising conviction.

## 6. ADX rising vs falling semantics

- Rising ADX = strengthening trend / increasing tendency to trend in either direction ([CMT-GUIDE](https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf)); a bullish DI signal is "reinforced if/when ADX turns up and the trend strengthens" ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- A turn lower in ADX may signal a pause in the trend, where price movements in the trend's direction become smaller but still follow the main direction; if ADX continues to fall, RSI signals "gain more credibility and usefulness" ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- The stronger reversal warnings come when ADX tops out (fading momentum) and this coincides with an overbought or oversold RSI reading ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- Falling ADX is not required for a reversal: ADX can remain high across a fast direction flip because the new direction is also a strong trend ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- The Schwab downtrend example: RSI dips below 30 and bounces quickly, "but with the ADX still rising - indicating the downtrend is strengthening - traders might remain bearish" ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- `[TRACECOM ADAPTATION]` Slope and acceleration of ADX matter more than its level: "ADX high and still rising" and "ADX high but rolling over" are different evidence states even at the same numeric value. The momentum-as-acceleration analogy is explicit in CMT material ("Decreasing acceleration therefore precedes top speed") ([CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)); applying it to ADX slope is our extension.

## 7. DI spread interpretation

- Construction: +DI = 100 x smoothed(+DM)/smoothed(TR); -DI = 100 x smoothed(-DM)/smoothed(TR); DX = 100 x |(+DI) - (-DI)| / ((+DI) + (-DI)); ADX is the smoothed DX ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- By construction, ADX rises when the +DI/-DI gap widens, regardless of which side is on top; the pair jointly gives direction and strength ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Inside days produce zero directional movement for both +DM and -DM, which cancels out ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- `[TRACECOM ADAPTATION]` Read DI_SPREAD as sign (side: positive favors long evidence, negative favors short evidence) plus magnitude (conviction), and require consistency with ADX slope: widening spread + rising ADX = strengthening directional move; widening spread + falling/peaked ADX = suspect late-stage evidence; narrow spread = no directional edge regardless of level.

## 8. Regime mapping (source-backed, then adaptation)

| Regime | Source-backed reading | TraceCom adaptation |
|--------|----------------------|---------------------|
| TREND_UP / TREND_DOWN | ADX above 25 = strong trend, below 20 = no trend, 20-25 gray zone; many use 20 ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)); 20-40 = trend in place and gathering strength, above 40 = very strong but top/bottom risk ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)). Direction from +DI/-DI above/below each other ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)). | Side = sign of DI_SPREAD; strength = ADX band; require rising/stable ADX slope for continuation evidence on M5. |
| RANGE | ADX below 20 indicates no meaningful trend ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)); RSI overbought/oversold readings work best when price moves sideways within a range ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)). | ADX < 20 + narrow/oscillating DI_SPREAD + RSI cycling between range bands = mean-reversion context, not continuation context. |
| COMPRESSION | Sources only state that ADX below 20 = no trend ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi), [SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)); they do not define compression via ADX. | `[TRACECOM ADAPTATION]` COMPRESSION fingerprint = low/declining ADX plus contracting ATR14/Donchian, consistent with the existing note `01 - Regimes/COMPRESSION.md`; ADX alone cannot identify compression. |
| EXPANSION | Rising ADX = increasing tendency to trend in either direction ([CMT-GUIDE](https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf)); ADX above 25 = strong trend ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)). | `[TRACECOM ADAPTATION]` EXPANSION = ADX rising through the trend threshold while DI_SPREAD magnitude widens out of a compression footprint. |
| TRANSITION | ADX topping out plus RSI at an extreme = stronger reversal warning ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)); reversals can begin when RSI stops reaching prior range extremes ([CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly)); ADX lags badly, so early transition calls are unreliable ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)). | `[TRACECOM ADAPTATION]` TRANSITION = ADX peak/roll-over while RSI fails a prior extreme or DI_SPREAD compresses; evidence supports reducing continuation exposure, not immediately reversing. |

## 9. Common errors

1. Using ADX as a direction indicator: it measures strength regardless of direction; direction must come from +DI/-DI or price structure ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx), [SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
2. Treating RSI 70/30 mechanically: overbought can signal strength, not exhaustion, and extreme readings persist in trends ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi), [SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi), [CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly)).
3. Ignoring slope and acceleration: static levels hide whether momentum is building or decaying; deceleration precedes tops ("decreasing acceleration therefore precedes top speed") ([CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)); ADX rising vs falling changes the meaning of the same reading ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
4. Trading DI crossovers without context: they are frequent and produce whipsaws; they need validation (ADX, bigger trend, pattern, volume) ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
5. Acting on a divergence against a strong trend: strong uptrends print repeated bearish divergences without topping; strong downtrends print bullish divergences while falling ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
6. Treating thresholds as universal constants: parameters and signal settings depend on the instrument's volatility and characteristics; Wilder's commodity-calibrated defaults may not generate valid signals in low-volatility instruments; Schwab notes there are "no set rules" and application is subjective ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx), [SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
7. Stacking redundant oscillators: adding three or four momentum indicators creates redundancy and contradiction - "analysis paralysis" - and CMT material recommends simplicity ([CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)).
8. Reading exact indicator values too early: both RSI and ADX are Wilder-smoothed; short warm-up windows produce values that differ from long-history ones (ADX needs roughly 150 periods for stability) ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi), [SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).

## 10. Combining RSI + ADX + DI as evidence (explicit rules)

These rules are ordered and non-negotiable in TraceCom reading; they adapt the source guidance above to the engine's decision pipeline.

1. Regime gate first (ADX). "The ADX provides the dominant decision-making criteria" - first establish whether a trend exists and how strong it is ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)). If ADX < 20, trend-continuation evidence is weak by definition ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi), [SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
2. Direction second (DI or price structure). +DI above -DI = up-side evidence; -DI above +DI = down-side evidence ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)). If DI_SPREAD sign disagrees with M5 price structure, record conflict and wait.
3. Momentum third (RSI), read relative to the regime band, not to fixed 70/30. Bull-band 40-90, bear-band 10-60, range behavior near 30/70 ([CMT-RSI](https://cmtassociation.org/chartadvisor/mastering-the-relative-strength-index-rsi-how-to-read-it-correctly), [SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
4. Divergences are warnings, not signals, and carry less weight in strong trends and more weight after an extreme reading ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
5. Slopes modify confidence: rising ADX + widening DI spread + RSI holding trend-band highs supports continuation; peaking ADX + RSI failing a prior extreme or extreme reading supports stall/reversal evidence ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi), [CMT-GUIDE](https://cmtassociation.org/wp-content/uploads/2024/05/2024-CMT-Program-Guide.pdf), [CMT-MOM](https://content.cmtassociation.org/a/momentum-indicators-and-their-value)).
6. Any unresolved conflict between the three = WAIT; the indicators never override the absence of a trigger. This mirrors the source requirement that RSI "should be used in conjunction with other tools" ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)) and the existing TraceCom posture that RSI/ADX are context features, not isolated entry triggers (`03 - Indicators/RSI14.md`, `03 - Indicators/ADX14.md`).
7. `[TRACECOM ADAPTATION]` Log each evidence state as a tuple: regime (ADX band + slope), direction (DI sign + persistence), momentum (RSI band + direction of travel), divergence flag, conflict flag. The tuple is evidence for traders/critics; conversion into orders remains with the existing trigger and consensus pipeline.

## 11. When NOT to trade

- ADX below 20: no meaningful trend; do not present trend-continuation setups as high-conviction ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- ADX in the 20-25 gray zone without a clearly rising slope and aligned DI: source calls this a gray zone; a trend may not be established ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- ADX has peaked or is falling while RSI sits at an extreme but price has not confirmed the turn: Schwab describes this as a stronger reversal warning and a potential exit consideration, not an entry ([SCHWAB](https://www.schwab.com/learn/story/spot-and-stick-to-trends-with-adx-and-rsi)).
- DI crossover against the larger trend, or inside a consolidation/flag: source explicitly calls these whipsaw zones to be ignored ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- RSI divergence against a strong trend used as a standalone countertrend entry ([SC-RSI](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)).
- Instruments/sessions where Wilder's parameters do not produce signals (low-volatility conditions): adjust settings or stand down rather than force reads ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).
- Pending hypothesis, not yet validated - RSI already at an extreme and moving against the intended position direction, or ADX falling while DI conflicts, should be filtered by the critics. This filter is CANDIDATE knowledge only and MUST NOT be enforced until prospectively tested: see `14 - Hypotheses/hyp_curriculum_rsi_adx_trajectory.md`.
- Missing, stale or insufficiently warmed-up indicator data: stand down (existing TraceCom freshness discipline; smoothed indicators need long warm-up) ([SC-ADX](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)).

## Provenance notes

- Schwab article retrieved 2026-09-17 (article dated 2026-08-04); quotes are from the page body; the article's chart examples use a generic "stock ZYX" and thinkorswim screenshots (illustrative only).
- The two StockCharts pages were retrieved from the current ChartSchool domain (`chartschool.stockcharts.com`). The legacy `school.stockcharts.com/doku.php?id=...` URLs named in the task did not resolve from this environment; the ChartSchool content is the same body of documentation published under a new domain.
- CMT Association pages retrieved: `education`, ChartAdvisor RSI article (May 9, 2025), Market Mosaic momentum article (Feb 18, 2026), Arthur Hill webcast page (July 2020). The 2024 CMT Program Guide PDF could not be text-extracted in this session; the two quoted lines are from the search-indexed text of that exact PDF URL and are attributed to the CMT Level II curriculum, Chapter 38. Treat those two lines as index-verified rather than fully fetched.
- No numerical statistic, backtest result or performance figure has been invented or imported into this note.

## Limitations

- None of the sources tests 60-second binary FX entries; application to M1/M5 TraceCom entries is adaptation and requires engine-side calibration.
- CMT Association material mixes credentialing content and practitioner commentary; curriculum documents change between administrations, and the quoted program guide is the 2024 edition.
- Threshold bands (ADX 20/25/40, RSI 70/30 and Brown ranges) are stated for equities/commodities on daily-higher timeframes; their M1/M5 FX behavior is unknown from these sources.
- "Hidden divergence" is not a term used by these sources; the mapping to Cardwell positive/negative reversals is an interpretation.
- ADX filtering quality is explicitly questioned by StockCharts ("filters as many good signals as bad"); this note therefore treats ADX as context, never as a standalone gate.
