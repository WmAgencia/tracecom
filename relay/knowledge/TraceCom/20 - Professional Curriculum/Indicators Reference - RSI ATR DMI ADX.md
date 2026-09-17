---
title: Indicators Reference - RSI ATR DMI ADX
topic: indikatoren
category: INDICATOR
sourceIds: [SRC-FIDELITY-IND, SRC-FIDELITY-RSI, SRC-FIDELITY-ATR, SRC-FIDELITY-DMI, SRC-TALIB-ADX]
sourceTier: A
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.9
status: SOURCE_KNOWLEDGE
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION]
setups: [TREND_PULLBACK, MOMENTUM_CONTINUATION]
indicators: [RSI14, ATR14, ADX14, DI_SPREAD]
markets: [EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY]
timeframes: [M1, M5]
tags: [rsi, atr, adx, dmi, formulas]
---

# Indicators Reference - RSI ATR DMI ADX

Reference note for the TraceCom feature engine. Every formula below is traceable to the
canonical source URL cited inline. No formula on this page was invented or reconstructed
from memory.

## Source retrieval note (mandatory disclosure)

- The four Fidelity Learning Center URLs returned HTTP 403 to direct fetch. Content was
  retrieved from the search-engine index snippets of those exact canonical URLs and from a
  text-extraction mirror (`r.jina.ai`) of the same canonical URLs. Effective prose
  confidence for the Fidelity pages: **0.80** (indirect retrieval), kept at 0.9 in
  frontmatter per the note contract.
- The TA-Lib pages were fetched directly (HTTP 200) and are quoted verbatim:
  - ADX: https://ta-lib.org/functions/adx.html
  - RSI (supplementary, for the exact Wilder seed): https://ta-lib.org/functions/rsi.html
  - ATR (supplementary, for the exact seed): https://ta-lib.org/functions/atr.html
  - DONCHIAN (supplementary, used by the companion audit): https://ta-lib.org/functions/donchian.html
- Source IDs `SRC-FIDELITY-IND`, `SRC-FIDELITY-RSI`, `SRC-FIDELITY-ATR`,
  `SRC-FIDELITY-DMI`, `SRC-TALIB-ADX` are not yet listed in
  `99 - Sources/SOURCE_REGISTRY.md`; that registry requires notes to reference only
  registered IDs (traceability gap, reported in the companion audit note).

Canonical URLs used:

- Guide overview: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/overview
- RSI: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi
- ATR: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr
- DMI: https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi
- TA-Lib ADX: https://ta-lib.org/functions/adx.html

Supplementary Fidelity URLs (same publisher, retrieved via search index):

- RSI in active trading: https://www.fidelity.com/viewpoints/active-investor/how-to-use-RSI
- ADX in active trading: https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX

---

## 1. Relative Strength Index (RSI)

### 1.1 What it is

The RSI, developed by J. Welles Wilder, is a momentum oscillator that measures the speed
and change of price movements; it oscillates between zero and 100
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
The Technical Indicator Guide positions RSI among momentum indicators, alongside the
Stochastic Oscillator
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/overview).
RSI considers only price (no volume) and is bounded 0-100
(https://ta-lib.org/functions/rsi.html).

### 1.2 Exact formula (with Wilder smoothing)

Fidelity publishes the basic formula
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi):

```
RSI = 100 - [100 / (1 + (Average of Upward Price Change / Average of Downward Price Change))]
```

Fidelity explicitly defers the averaging detail to Wilder's book ("Refer to Wilder's book
for additional calculation information"). The exact smoothing is documented on the TA-Lib
RSI page (https://ta-lib.org/functions/rsi.html), verbatim:

- `U_t = max(X_t - X_(t-1), 0)`
- `D_t = max(X_(t-1) - X_t, 0)`
- First value at `t = n`: `Ubar = SMA(U, n)`, `Dbar = SMA(D, n)` (simple average seed)
- For `t > n`: `Ubar_t = ((n-1) * Ubar_(t-1) + U_t) / n` and likewise for `Dbar`
- `RS_t = Ubar_t / Dbar_t`
- `RSI_t = 100 - (100 / (1 + RS_t))`

This recursion is what "Wilder smoothing" means in TA-Lib terms: today's smoothed value =
previous smoothed value adjusted by the new one-bar value. On the ADX page TA-Lib states
the same smoothing rule as `X = X - X/period + today's one-bar value`
(https://ta-lib.org/functions/adx.html). The running-sum form and the averaged form above
are algebraically equivalent up to a constant factor `n`.

### 1.3 Step-by-step calculation (period n = 14)

1. Fix the period. Fidelity and TA-Lib default to 14
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi,
   https://ta-lib.org/functions/rsi.html).
2. Per bar `t`, compute `diff = close_t - close_(t-1)`; gain `= max(diff, 0)`;
   loss `= max(-diff, 0)` (https://ta-lib.org/functions/rsi.html).
3. Seed: simple average of the first 14 gains and of the first 14 losses
   (https://ta-lib.org/functions/rsi.html).
4. Recursion: `avgGain = ((n-1) * avgGain_prev + gain) / n`; `avgLoss` likewise
   (https://ta-lib.org/functions/rsi.html).
5. `RS = avgGain / avgLoss`; `RSI = 100 - 100 / (1 + RS)`
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
6. Degenerate windows (`avgLoss = 0`): the standard output is RSI = 100. The cited pages
   do not define a value when both averages are zero (a perfectly flat window); no source
   value is claimed here.

### 1.4 Interpretation (levels)

- Overbought above 70, oversold below 30; levels can be adjusted per instrument (Fidelity
  gives the example of widening to 80 if 70 is repeatedly reached)
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- During strong trends the RSI may remain overbought or oversold for extended periods
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- Trend context: in an uptrend or bull market RSI tends to remain in the 40-90 range with
  the 40-50 zone acting as support; in a downtrend or bear market it tends to stay in the
  10-60 range with the 50-60 zone acting as resistance
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- RSI often forms chart patterns not visible on the price chart (double tops/bottoms,
  trend lines); support and resistance should be read on the RSI itself
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- Signals come from divergences and failure swings: price making a new high/low that the
  RSI does not confirm "can signal a price reversal"; a Top Swing Failure is RSI making a
  lower high followed by a downside move below a previous low; a Bottom Swing Failure is
  the mirror case
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).

### 1.5 Trajectory and slope reading

Operational definition used here (engineering convention): `slope_t = RSI_t - RSI_(t-k)`
and `acceleration_t = slope_t - slope_(t-k)`. The semantics must stay anchored to the
sources:

- Rising RSI that holds the 40-50 zone as support is consistent with an uptrend regime;
  falling RSI that holds the 50-60 zone as resistance is consistent with a downtrend
  regime (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- RSI is "most applicable in non-trending markets" as an oscillator
  (https://www.fidelity.com/viewpoints/active-investor/how-to-use-RSI); in a strong trend,
  extreme readings persist, so a flat or fading slope at 70/30 is **not** by itself a
  reversal signal
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- Deceleration (acceleration crossing below zero) near an extreme means the speed of the
  move is diminishing; Fidelity frames the actionable evidence as divergence or failure
  swings, not slope sign alone
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).

### 1.6 When it works

- Oscillation regimes: as a momentum oscillator, RSI is most applicable in non-trending
  markets (https://www.fidelity.com/viewpoints/active-investor/how-to-use-RSI).
- Divergence and failure-swing reads, plus S/R taken on the RSI line
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- Trend identification in broad terms: RSI "can also be used to identify the general
  trend" through its characteristic ranges (40-90 vs 10-60)
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).

### 1.7 When it FAILS

- Strong trends: "During strong trends, the RSI may remain in overbought or oversold for
  extended periods"
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- Fixed thresholds: levels may need adjustment for the security; repeated hits of 70
  weaken the fixed-level reading
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
- Divergence in isolation: the source says divergence "can signal a price reversal" - a
  warning, not a deterministic trigger
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).

### 1.8 Common mistakes

1. Reading 70/30 as mechanical buy/sell in a trending market despite the strong-trend
   caveat (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
2. Never recalibrating levels for the instrument (Fidelity's own example adjusts 70 to 80)
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
3. Treating RSI divergence as a completed reversal signal instead of a reversal warning
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi).
4. Ignoring that the averaged formula needs a correct Wilder seed; using a simple rolling
   mean instead changes the indicator family (Wilder seed per
   https://ta-lib.org/functions/rsi.html).

### 1.9 Relation to market regime

| Regime | RSI14 evidence (source-anchored) |
|---|---|
| TREND_UP | Tends to remain 40-90; 40-50 acts as support (Fidelity RSI) |
| TREND_DOWN | Tends to remain 10-60; 50-60 acts as resistance (Fidelity RSI) |
| RANGE | Oscillates across the 30/70 thresholds; most applicable in non-trending markets (Fidelity RSI, Fidelity Viewpoints RSI) |
| COMPRESSION / EXPANSION | RSI does not measure volatility directly; combine with ATR (Fidelity ATR, section 2) |

### 1.10 Combining with other evidence

- The guide's premise: use indicators "in conjunction with other technical analysis tools
  or fundamental analysis" to identify possible entry and exit points
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/overview).
- Trend-pullback composition: ADX above 25 and rising plus DI spread favoring the trend
  (section 3) plus RSI pulling back into 40-50 (uptrend) is a source-grounded
  continuation read
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi,
  https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- Reversal composition: RSI divergence plus an expanding ATR on the reversal move
  ("a reversal in price with an increase in ATR would indicate strength behind that move")
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).

---

## 2. Average True Range (ATR)

### 2.1 What it is

ATR is the average of true ranges over the specified period and measures volatility,
including gaps in price movement. Typical period is 14; 2-10 for recent volatility and
20-50 for longer-term volatility
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
TA-Lib: Wilder-smoothed average of the True Range, "measuring price volatility regardless
of direction" (https://ta-lib.org/functions/atr.html).

### 2.2 Exact formula (with Wilder smoothing)

Fidelity gives the recursion and the True Range definition
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr):

```
ATR = (Previous ATR * (n - 1) + TR) / n
```

True Range for today is the greatest of:

- Today's high minus today's low
- Absolute value of today's high minus yesterday's close
- Absolute value of today's low minus yesterday's close

TA-Lib documents the exact seed and the same recursion
(https://ta-lib.org/functions/atr.html):

```
TR_t = max(high - low, |prevClose - high|, |prevClose - low|)
ATR seed = simple average of first `period` TR values
ATR_t = (ATR_(t-1) * (period - 1) + TR_t) / period
```

The seed matters: the first ATR is a **simple average** of the first 14 TR values, and
only from bar 15 onward does the Wilder recursion take over
(https://ta-lib.org/functions/atr.html).

### 2.3 Step-by-step calculation (n = 14)

1. For each bar from the second bar onward, compute TR = max(high-low,
   |high-prevClose|, |low-prevClose|)
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr,
   https://ta-lib.org/functions/atr.html).
2. Seed: average the first 14 TR values with a simple mean
   (https://ta-lib.org/functions/atr.html).
3. For each subsequent bar: `ATR = (prevATR * 13 + TR) / 14`
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).

### 2.4 Interpretation (levels and meaning)

- Expanding ATR = increased volatility, with the range of each bar getting larger; a
  price reversal accompanied by rising ATR indicates strength behind that move. ATR is
  **not directional**: expanding ATR can indicate selling pressure or buying pressure
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- High ATR values usually result from a sharp advance or decline and are unlikely to be
  sustained for extended periods
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Low ATR = series of periods with small ranges, found during extended sideways price
  action; a prolonged period of low ATR values may indicate a consolidation area and the
  possibility of a continuation move or reversal
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- ATR is useful for stops and entry triggers; unlike fixed dollar/point/percentage stops,
  an ATR stop adapts to sharp moves and consolidation; Fidelity suggests a multiple such
  as 1.5 x ATR to catch abnormal price moves
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).

### 2.5 Trajectory and slope reading

- Slope `ATR_t - ATR_(t-k)` > 0 = expansion (ranges growing)
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Slope < 0 alongside sequential small ranges = quiet/consolidation; prolonged low values
  are the compression signature
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Acceleration: when ATR turns up from a low base, expansion is beginning; Fidelity
  explicitly pairs a price reversal with increasing ATR as evidence of strength behind the
  move. High ATR levels are self-limiting because they are unlikely to be sustained
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- ATR slope is non-directional: the same rising slope can accompany buying or selling
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).

### 2.6 When it works

- Volatility regime detection: expansion vs consolidation
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Adaptive stops and entry triggers using an ATR multiple (e.g., 1.5 x ATR)
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Comparing move size to expected range: measuring moves in ATR multiples is the natural
  use of a price-unit volatility measure
  (https://ta-lib.org/functions/atr.html).

### 2.7 When it FAILS

- Direction: ATR says nothing about direction; treating it as bullish/bearish is misuse
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Sustainability: high ATR values "are unlikely to be sustained for extended periods"
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Cross-instrument comparisons: ATR is expressed in price units; values are not directly
  comparable across instruments without normalization (implication of the price-unit
  definition, https://ta-lib.org/functions/atr.html). TraceCom already normalizes
  (`atrNormalized = atr / price`, `relay/feature-engine.mjs:104`).

### 2.8 Common mistakes

1. Using expanding ATR as a directional signal
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
2. Fixed stops in a market whose ATR changed; Fidelity's point is that ATR stops adapt
   while fixed ones do not
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
3. Using a single ATR without a multiple for abnormal moves (Fidelity's example: 1.5 x ATR)
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
4. Assuming low ATR means "stay range-bound forever" - it may precede continuation or
   reversal
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
5. Replacing the Wilder seed with a rolling mean silently changes the indicator
   (seed defined at https://ta-lib.org/functions/atr.html).

### 2.9 Relation to market regime

| Regime | ATR14 evidence (source-anchored) |
|---|---|
| COMPRESSION | Low ATR series; prolonged low values indicate consolidation (Fidelity ATR) |
| EXPANSION | Expanding ATR; bar ranges getting larger (Fidelity ATR) |
| TREND_UP / TREND_DOWN | Non-directional; a reversal with rising ATR = strength behind the move (Fidelity ATR) |
| RANGE | Low ATR found during extended sideways price action (Fidelity ATR) |

### 2.10 Combining with other evidence

- ADX + DI give direction and strength (section 3); ATR sizes the stop/trigger and flags
  the expansion/compression state
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Channel distance in ATR multiples: the repo computes `donchianWidthATR`,
  `distanceToUpperATR`, `distanceToLowerATR`
  (`relay/feature-engine.mjs:122-124`); engineering use, consistent with ATR as the
  volatility unit.
- RSI divergence + ATR expansion on the reversal = the strongest source-grounded reversal
  combination in this note set
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi,
  https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).

---

## 3. Directional Movement Index (DMI) and ADX

### 3.1 What it is

DMI assists in determining if a security is trending and attempts to measure the strength
of the trend; it disregards direction and only determines whether a trend exists and its
strength
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
The indicator comprises four lines
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi):

1. **+DMI** (Positive Directional Indicator): difference between today's high and
   yesterday's high, summed over the past 14 periods.
2. **-DMI** (Negative Directional Indicator): difference between today's low and
   yesterday's low, summed over the past 14 periods.
3. **ADX** (Average Directional Movement Index): a smoothing of the DX.
4. **ADXR** (Average Directional Movement Index Rating): simple average of today's ADX and
   the ADX from 14 periods ago.

TA-Lib describes ADX as "a smoothed measure of trend strength derived from the directional
indicators (+DI/-DI)... Higher values indicate a stronger trend (a common convention
treats >25 as trending); says nothing about direction"
(https://ta-lib.org/functions/adx.html).

### 3.2 Exact formula (with Wilder smoothing)

TA-Lib ADX formula, verbatim
(https://ta-lib.org/functions/adx.html):

```
+DI = 100 * (+DM_p / TR_p)
-DI = 100 * (-DM_p / TR_p)
DX  = 100 * |(-DI) - (+DI)| / ((-DI) + (+DI))
first ADX = mean of the first `period` DX
then ADX  = (prevADX * (period - 1) + DX) / period
```

with the smoothing note: "+DM_p / -DM_p / TR_p use Wilder smoothing:
`X = X - X/period + today's one-bar value`", and "Wilder's original integer rounding is
not applied" (https://ta-lib.org/functions/adx.html).

Fidelity's calculation steps describe the same pipeline
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi):

1. Compute True Range and +DI/-DI per period using the high/low comparisons (rules quoted
   in 3.3 below).
2. Smooth True Range, +DI and -DI using Wilder's smoothing technique.
3. +DI (plotted) = smoothed +DI / smoothed True Range * 100.
4. -DI (plotted) = smoothed -DI / smoothed True Range * 100.
5. DX = |smoothed +DI - smoothed -DI| / (smoothed +DI + smoothed -DI) * 100.
6. First ADX = average of DX over the specified period; then
   `ADX = (prevADX * (period - 1) + DX) / period`.
7. ADXR = average of current ADX and ADX n periods ago.

Note on Fidelity's wording: its steps 1-4 call the smoothed DM values "+DI/-DI" before the
division by True Range; the plotted lines after step 3-4 are the DI ratios. TA-Lib's
formula is the unambiguous final statement.

### 3.3 Step-by-step calculation (n = 14)

1. Directional movement per bar (Fidelity DMI step 1): let
   `upMove = high_t - high_(t-1)` and `downMove = low_(t-1) - low_t`.
   - If `upMove > downMove`: +DI candidate = max(upMove, 0), -DI candidate = 0.
   - If `downMove > upMove`: -DI candidate = max(downMove, 0), +DI candidate = 0.
   - If both are non-positive, both are 0.
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi)
2. True Range per bar: greatest of (high-low), |high-prevClose|, |low-prevClose|
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
3. Wilder-smooth TR, +DM and -DM
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi,
   https://ta-lib.org/functions/adx.html).
4. `+DI = 100 * smoothedPlusDM / smoothedTR`; `-DI = 100 * smoothedMinusDM / smoothedTR`
   (https://ta-lib.org/functions/adx.html).
5. `DX = 100 * |+DI - (-DI)| / (+DI + (-DI))`
   (https://ta-lib.org/functions/adx.html).
6. Seed ADX with the mean of the first 14 DX values; then apply
   `ADX = (prevADX * 13 + DX) / 14`
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi,
   https://ta-lib.org/functions/adx.html).
7. ADXR, if needed, = average of current ADX and ADX 14 periods ago
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).

### 3.4 Interpretation (levels)

- Above 25: strong trend (Fidelity: "Typically if the ADX is above 25 it indicates a
  strong trend"; TA-Lib: common convention >25 = trending)
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi,
  https://ta-lib.org/functions/adx.html).
- Below 20: trendless market
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- 20-25: no clear signal interpretation exists in this band per Fidelity's active-investor
  article on ADX (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX).
- Direction comes from the DI lines: a buy signal is given when DMI+ crosses above DMI-; a
  sell signal when DMI- crosses above DMI+. ADX and ADXR then measure the strength of
  those signals
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- High and rising ADX/ADXR = strong trend, either up or down, and a trend-following system
  may be appropriate; low and falling ADX/ADXR = trendless market
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).

### 3.5 Trajectory and slope reading

- Rising ADX: an existing trend is strengthening; trend-following systems (moving
  averages, channel breakouts) are expected to have more validity
  (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX,
  https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- Falling ADX: the trend is weak or absent; trend-following signals deserve less weight
  (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX).
- Acceleration (second difference of ADX > 0, same sign): strengthening at an increasing
  rate. The sources support rising/falling semantics directly; the second difference is an
  engineering refinement of those semantics, not a source claim.
- DI spread: sign gives direction (DMI+ above DMI- = positive trend direction; the
  reverse = negative), magnitude gives directional dominance; crossovers mark handoff
  between directional regimes
  (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX,
  https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- ADX rising while DI spread is near zero = strength without direction; do not take a
  directional trade from ADX alone
  (https://ta-lib.org/functions/adx.html: "says nothing about direction").

### 3.6 When it works

- Trend confirmation: ADX above 25 (strong) and rising supports trend-following
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- Directional entries from DI crossovers, with ADX/ADXR as strength filter
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- Any market condition: ADX works across bull/bear and high/low volatility environments
  per Fidelity's active-investor article
  (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX).

### 3.7 When it FAILS

- Direction: DMI "disregards the direction of the security. It only attempts to determine
  if there is a trend and that trend's strength"
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- Trendless markets: below 20 the indicator is in its no-trend zone; DI crossovers there
  are the weakest read
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
- Warm-up: the first ADX requires 14 DX values before the seed, then the recursion -
  TA-Lib marks ADX with an "Initial Unstable Period" property
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi,
  https://ta-lib.org/functions/adx.html). Values computed with insufficient history are
  not yet stable.

### 3.8 Common mistakes

1. Using ADX as a buy/sell trigger: it is a strength measure; direction requires DI
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
2. Overtrading the 20-25 gray zone, where no clear signal interpretation exists
   (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX).
3. Taking DI crossovers without the ADX strength filter
   (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi).
4. Forgetting the DI calculation order: smooth DM and TR first, then divide (DI), then
   compute DX, then smooth DX into ADX
   (https://ta-lib.org/functions/adx.html).
5. Ignoring that Wilder's original integer rounding is intentionally not applied by TA-Lib;
   rounding at intermediate steps changes values
   (https://ta-lib.org/functions/adx.html).

### 3.9 Relation to market regime

| Regime | ADX/DMI evidence (source-anchored) |
|---|---|
| TREND_UP | ADX above 25 and rising; DMI+ above DMI- (Fidelity DMI/ADX) |
| TREND_DOWN | ADX above 25 and rising; DMI- above DMI+ (Fidelity DMI/ADX) |
| RANGE | ADX below 20, low and falling (Fidelity DMI) |
| TRANSITION | ADX in 20-25; no clear signal interpretation (Fidelity Viewpoints ADX) |
| COMPRESSION / EXPANSION | Not measured by DMI; combine with ATR (Fidelity ATR, section 2) |

### 3.10 Combining with other evidence

- The full composition: ADX gates trend strength, DI spread gives direction, RSI locates
  the pullback (40-50 support in uptrends, 50-60 resistance in downtrends), ATR sizes risk
  and flags expansion/compression
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/rsi,
  https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi,
  https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr).
- Fidelity: if ADX suggests the trend is strong (rising), trend-following systems such as
  moving averages and channel breakouts are expected to have more validity; if ADX is
  falling, place less value on those signals
  (https://www.fidelity.com/viewpoints/active-investor/average-directional-index-ADX).
- Overview premise: use in conjunction with other tools
  (https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/overview).

---

## 4. TraceCom application map

- RSI14, ATR14, ADX14, +DI, -DI and DI spread are produced once per feature build in
  `relay/feature-engine.mjs` (`rsiWilder` line 13, `atrWilder` line 28, `adxWilder`
  line 41, wiring lines 98-117).
- Regime classification consumes ADX14, +DI, -DI, the structure label and the ATR ratio in
  `relay/price-structure.mjs:128-146`.
- Setups in frontmatter: TREND_PULLBACK and MOMENTUM_CONTINUATION map to the
  ADX-gate + DI-direction + RSI-location + ATR-state composition described in section
  3.10.
- Formula conformance and duplication checks for these implementations are in the
  companion audit note
  `20 - Professional Curriculum/Audit - Feature Engine vs References (RSI ATR ADX Donchian).md`.

## 5. Limitations

- Fidelity pages were retrieved indirectly (HTTP 403 on direct fetch); prose is traceable
  to the canonical URLs but not verbatim-fresh.
- Fidelity's RSI page does not publish the seed/averaging detail; the seed used above is
  from the TA-Lib RSI page, fetched directly.
- ADXR is described here (Fidelity DMI step 7) but is not computed by the TraceCom feature
  engine; no claim is made that it is.
- Thresholds (70/30, 25/20) are conventions, not universal constants; Fidelity itself
  notes levels can be adjusted and ADX thresholds vary by instrument.
