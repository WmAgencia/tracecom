---
title: Structure and Location - Support Resistance Donchian
topic: structure-location
category: PLAYBOOK
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
tags: [support, resistance, donchian, breakout, retest, location]
---

# Structure and Location - Support Resistance Donchian

How support/resistance (S/R) levels and Donchian Channels should be defined, identified and used as **location** evidence: where price is inside its recent structure at the moment a setup is considered. Everything below is either quoted from a primary source or explicitly marked `[TRACECOM ADAPTATION]` where the source does not cover the TraceCom use case (FX, M1/M5/M15, closed candles only, no volume, no order book).

Companion file: `20 - Professional Curriculum/Lesson - Decision Sequence and Trade Thesis.md` consumes this note as the LOCATION and TRIGGER gates of the decision sequence.

## 0. Sources and fetch status

| Key | Source | URL | Fetch status |
|-----|--------|-----|--------------|
| CME-TA | CME Group - Technical Analysis (course overview and lesson) | https://www.cmegroup.com/education/courses/technical-analysis and https://www.cmegroup.com/education/courses/trading-and-analysis/technical-analysis | Direct fetch returned **403**; text obtained through a read-only text-extraction proxy (r.jina.ai) of the same URLs, and cross-checked against search-engine-indexed text of the same pages, which matched. Disclosed and reflected in confidence. |
| CME-SR | CME Group - Support and Resistance (technical analysis course lesson) | https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance | Direct fetch returned **403**; proxy extraction succeeded as above. Disclosed. |
| TV-DC | TradingView Help Center - Donchian Channels (DC) | https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/ | Fetched. Note: the URL shape `/43000502589-donchian-channels/` resolves to the Moving Averages help page, not Donchian; the canonical Donchian help page is `43000502253`. |
| SC-SR | StockCharts ChartSchool - Support & Resistance (secondary) | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance | Fetched. |
| SC-PC | StockCharts ChartSchool - Price Channels (secondary; documents the same Donchian indicator) | https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels | Fetched. |
| SC-DG | StockCharts ChartSchool - Donchian Trading Guidelines (secondary) | https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines | Fetched. |
| TA-LIB | TA-Lib DONCHIAN function reference (supporting; used by the repo feature audit) | https://ta-lib.org/functions/donchian.html | Referenced through `20 - Professional Curriculum/Audit - Feature Engine vs References (RSI ATR ADX Donchian).md`; not re-fetched in this session. |

No statistic, threshold or probability in this note is invented. Where a numeric rule would be needed but no source states one, a symbolic engine parameter (`theta_...`) is used and marked as calibration work, not as sourced fact.

## 1. What support and resistance is - and is not

**Is (source-backed):**

- CME Group: "Support and Resistance are common terms that traders use to describe levels where price is more likely to stop moving in one direction or change direction." Support = levels where price might reverse higher or slow a decline; resistance = the mirror. Which one a level is "is determined by whether price is above or below the level identified by the trader" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)).
- Levels form from a small set of objective references: moving averages, previous highs and lows, specific price levels, and trend lines ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)).
- StockCharts: support is the level "at which demand is thought to be strong enough to prevent the price from declining further"; resistance is where selling is thought strong enough to prevent a further rise. A break below support signals sellers willing to sell lower and/or buyers unwilling to buy; a break above resistance signals the opposite ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- Role reversal is explicit in both sources: "When price breaks through support or resistance, these levels will reverse, support will become resistance and resistance will become support" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)); "Once the price breaks below a support level, the broken support level can turn into resistance... As the price advances above resistance... support will be found" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).

**Is not (source-backed cautions):**

- Not a precise line to the penny: "support and resistance will not always hold to the penny, rather they are zones that can be identified in a market which might be favorable for traders to enter or exit a trade" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)).
- Not an exact science: "As technical analysis is not an exact science, setting precise support levels can often be difficult... price movements can be volatile and briefly dip below support" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- Not deterministic: a level "will not always hold"; once broken, "another support level will have to be established at a lower level" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- Not a forecast: CME Group's course states technical analysis "is an art not a science" and that charts (open, high, low, close) are objective while interpretation of patterns is subjective ([CME-TA](https://www.cmegroup.com/education/courses/trading-and-analysis/technical-analysis)).

`[TRACECOM ADAPTATION]` Practical consequence: TraceCom should treat a level as a **reference price with a defined break/retest rule**, never as a barrier that "must" hold. Any rule of the form "the level will hold" is unsupported by every source above.

## 2. Identifying levels objectively from OHLC

### 2.1 Swing highs and swing lows

- StockCharts: "Support can be established with the previous reaction lows, while resistance can be established by using the previous reaction highs" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- Repeated reactions define and confirm the level. In the Halliburton example, after a prior support break, "the resistance level was confirmed when the stock failed to advance past 42.5. The stock traded up to 42.5 twice after that and failed to surpass resistance" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)). In the Lucent example the "resistance level of the trading range was well-marked by three reaction peaks at 47.5" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- Donchian's own guideline: reversal or resistance is likely "upon reaching levels at which, in the past, the commodity has fluctuated for a considerable length of time within a narrow range or on approaching highs or lows" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)).
- Counter-caution from the same guideline set: be careful if a trend line is "hugged" or "has been touched too often" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)).

`[TRACECOM ADAPTATION]` Objective definition usable with OHLC only: a **pivot high** is a candle whose high is strictly greater than the highs of the K candles immediately before and after it; a **pivot low** is the mirror. The lookback K is an engine parameter (`K_pivot`); it must be fixed and audited, because K changes which levels exist. A level is "tested" each time the high (for resistance) or low (for support) of a closed candle comes within `theta_touch` ATR14 units of the level; the touch count is then a plain count over a fixed lookback.

### 2.2 Closes vs wicks

- StockCharts documents both the close-basis confirmation and the wick-only failure. Lucent: after long lower shadows and two up gaps, the stock "finally closed above resistance at 48. This was a clear indication of demand winning out over supply" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- WorldCom: "There was a false breakout in mid-June when the stock briefly poked its head above 62... This did not last long, and a gap down a few days later nullified the breakout" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)). The source's own language distinguishes *poking above* (wick/intrabar) from *closing above*.
- StockCharts on Price Channels makes the same point mechanically: replacing a high/low plot with a **close-only** plot "eliminated the intra-week highs and lows" and removed two false channel-break signals in their example ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).

`[TRACECOM ADAPTATION]` TraceCom consumes closed candles only, so the cleanest objective break rule is close-basis: a resistance level is **broken** when a closed candle's close > level; a support level is **broken** when a closed candle's close < level. A high above the level with a close back below is a **wick rejection**, not a break. This is a convention choice (the sources show but do not formalize it); it must be applied consistently.

### 2.3 Volume caveat - what TraceCom cannot do

- CME-SR, SC-SR and the Donchian guidelines all reference behavior around levels, and the Donchian material explicitly uses volume: "When prices trade in a narrow range with little volatility, look for a volume increase to confirm the direction of the next move" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)); guideline 20 adds "especially if volume declines" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)).
- TraceCom has no volume feed for spot FX pairs; the repo notes this already in `03 - Indicators/DONCHIAN.md` ("nao ha dados de volume para validar quebra de extremo").

`[TRACECOM ADAPTATION]` Volume-based confirmations in these sources are **unavailable** and must not be simulated from price. Price-only substitutes supported by the same sources: close-basis penetration, close location inside the trigger candle's own range, ATR14 expansion after a narrow range, and repeated closes beyond the level.

### 2.4 Lines vs zones

- StockCharts gives general guidance: if the range spans less than about two months and the price range is tight, exact levels work better; if the range spans many months and the price range is large, use zones ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- CME: S/R are zones "that can be identified in a market which might be favorable for traders to enter or exit a trade" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)).

`[TRACECOM ADAPTATION]` On M1/M5/M15, the analog of "tight vs wide" is the Donchian width relative to ATR14: width/ATR14 small => evaluate exact extremal prices; width/ATR14 large => evaluate a zone of +/- `theta_zone` ATR14 around the level. `theta_zone` is an engine parameter, not a sourced number.

## 3. Breakout semantics (objective, close-basis)

The sources use different words for different failure modes; TraceCom needs fixed definitions. The following vocabulary is internally consistent with the sources and is entirely computable from OHLC:

| Term | Objective condition (close-basis, closed candles only) | Source anchor |
|------|--------------------------------------------------------|---------------|
| **Level touch** | High (resistance) or low (support) of a closed candle reaches within `theta_touch` ATR14 of the level, with close still on the pre-level side | "Markets will tend to pause at previous highs and lows" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)) |
| **Wick poke / fakeout** | High (resistance) or low (support) trades beyond the level intrabar, but the candle closes back on the pre-level side | WorldCom "briefly poked its head above 62" then "nullified" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| **Breakout (close-basis)** | A closed candle's close is beyond the level; the level is then treated as reversed in role | "If price breaks through support, then it will generally continue in that direction" ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)); Lucent "closed above resistance at 48" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| **Acceptance** | One or more subsequent closed candles close beyond the level and do not close back through it; in the strongest sourced example the market "traded just above this resistance level for over a month" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) | NASDAQ 100 at 935 ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| **Retest** | After acceptance, price returns to the broken level and a closed candle on the breakout side confirms the level now acts in the reversed role | "935 was established as a new support level... fell back to test support at 935" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)); role reversal ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)) |
| **FAILED_BREAKOUT** | A close-basis breakout occurred, then a later closed candle closes back through the level against the breakout direction | "This did not last long, and a gap down a few days later nullified the breakout" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)) |
| **Whipsaw** | Sequence of close-basis breaks in alternating directions within a short window | "Indicator signals are not perfect, and there will be whipsaws. It's part of the game" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)) |

Confirmation rules that are fully OHLC-computable:

1. **Break requires close beyond the level** by at least `theta_break` ATR14 (engine parameter; `theta_break = 0` means any close beyond).
2. **Acceptance requires N_accept consecutive closes beyond the level** (parameter), optionally plus "no close back through the level" as in the 935 example ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
3. **Retest requires**: prior accepted breakout; return of price to within `theta_retest` ATR14 of the level; a closed candle with close on the breakout side. Lucent's second test at 935 "well established" the level ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)); the repeated-test logic also appears in the "twice after that" Halliburton example ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
4. **Failed breakout is signalled by a close back through the level**; the WorldCom nullification came via a gap down, which in OHLC terms is simply a later close back below the level ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
5. **Do not anticipate the retest**: StockCharts' own sequencing is breakout -> acceptance -> return -> test. `[TRACECOM ADAPTATION]` TraceCom waits for the closed confirmation candle at the retest, never for the approach.

## 4. Entry location - where in the structure is the entry

Location is a separate question from setup validity: the same setup can be actionable at one price and a chase at another. The sources give directional guidance; the metrics below are the TraceCom formalization.

### 4.1 Location archetypes

| Archetype | Description | Source anchor |
|-----------|-------------|---------------|
| **Near extreme (edge)** | Price at/or just through a channel boundary, in the direction of the intended trade; the closest opposing level is the one just broken/being tested | "A move above the 20-day Price Channel signals a new 20-day high... A 20-week high is more consequential than a 20-day high" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)) |
| **Middle of range** | Price at/near the channel midpoint, far from both boundaries; retracement trades into the middle have no boundary edge | "Prices are more likely to touch the centerline than the upper channel line" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)) |
| **After an extended move** | Price far from the channel midpoint/mean after a run; entering in the run's direction buys the extension | "Do not chase a position after a three-day move. Wait for a one-day reversal to improve the risk-reward ratio" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)) |
| **After the breakout has already traveled** | Breakout happened several candles ago and price is now far beyond the level | "Seldom take a position in the direction of an immediately preceding three-day move. Wait for a one-day reversal" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)); initiate/add "after a one-day decline, no matter how small the decline is, especially when the decline is on lower volume" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)) |

CME's moving-average example gives the same principle in trend-pullback form: "if price is moving up then retraces to the 55-period moving average, then starts to move back up, there is a good chance that the level will hold as support, and price will start to move in the direction of the original trend again"; if price does not bounce, expect lower support and possibly a trend change ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)).

`[TRACECOM ADAPTATION]` The Donchian guidelines express the no-chase rule in days ("three-day move", "one-day reversal"). On M1/M5/M15 the equivalent is a fixed number of candles (`N_chase` and `N_reversal`), which must be calibrated per timeframe and audited; the source supports the *principle*, not any specific intraday count.

### 4.2 ATR-normalized location metrics (all computable from OHLC)

Let `D_U`, `D_L`, `D_M` be the Donchian upper, lower and middle; `C` the last closed close; `ATR14` the engine's 14-period ATR. All metrics are unitless multiples:

| Metric | Formula | Meaning |
|--------|---------|---------|
| **Donchian position** | `pos = (C - D_L) / (D_U - D_L)` (0 = at lower band, 1 = at upper band, 0.5 = mid) | Where price sits inside recent structure. Engine returns 0.5 for a zero-width window in one code path and 0 in the other (see `Audit - Feature Engine vs References (RSI ATR ADX Donchian).md`, section 5.2); treat zero-width as undefined, not mid. |
| **Headroom to boundary (long)** | `headroom = (D_U - C) / ATR14` | Distance left to the upper extreme in volatility units. Small => little space before the opposite extreme. |
| **Room to lower band (long)** | `legroom = (C - D_L) / ATR14` | Proxy for the depth of the structure beneath; also the natural invalidation distance scale. |
| **Extension from mid** | `ext = (C - D_M) / ATR14` | How far price has traveled from the mean of the range. Large positive = extended to the upside. |
| **Post-breakout travel** | `travel = (C - level) / ATR14` for a long breakout (mirror for shorts); measured from the broken level, plus `bars_since_break` | Detects the "breakout already traveled" archetype. |
| **Channel width** | `width = (D_U - D_L) / ATR14`; also the repo feature `donchianWidthATR` | Compression vs expansion context: small width relative to its own recent history = compression, large = expansion. |
| **Mid-slope** | `slope_M = (D_M[t] - D_M[t-k]) / (k * ATR14)` | Trajectory of structure: up, down or flat. |
| **Retest proximity** | `retest_dist = abs(C - level) / ATR14` after an accepted breakout | Small value + close on breakout side = retest is happening; large value = no retest yet. |

Every threshold applied to these metrics (`theta_pos`, `theta_headroom`, `theta_travel`, `theta_width`, `theta_retest`, ...) is a **calibration parameter defined by the engine**, not a number taken from any source. No source in this note states a numeric ATR-normalized cutoff.

## 5. Donchian Channels - exact definition and reading

### 5.1 Definition

- Created by Richard Donchian; TradingView's help page calls him "The Father of Trend Following" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- TradingView: "The indicator simply takes a user defined number of periods (20 Days for example) and calculates the Upper and Lower Bands. The Upper Band is the high price for the period. The Lower Band is the low price for the period. The Middle Line is simply the average of the two" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- Calculation, exactly as given: "Upper Channel = 20 Day High; Lower Channel = 20 Day Low; Middle Channel = (20 Day High + 20 Day Low)/2"; 20 is the default Length input, Offset default 0 ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- StockCharts documents the identical indicator as Price Channels: "The upper channel is set at the x-period high and the lower channel is set at the x-period low... The dotted centerline is the midpoint between the two channel lines"; default 20 in SharpCharts; "This indicator, developed by Richard Donchian, is sometimes referred to as Donchian Channels" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- Length controls sensitivity: shorter lookbacks (e.g. 10) produce tighter channels; longer lookbacks produce wider channels; usable on intraday, daily, weekly, monthly charts ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- The middle line is the channel midpoint, "not a moving average of price" (TA-Lib DONCHIAN reference, via the repo audit at https://ta-lib.org/functions/donchian.html).

### 5.2 Current-bar inclusion - two conventions, materially different

This is the detail most often glossed over, and it changes what "band breakout" means:

- **Window includes the current bar** (TA-Lib DONCHIAN: "The window includes the current bar", cited in the repo audit; the repo's `donchian` feature uses `candles.slice(-period)` with period 20, current candle included). Consequence: at any closed bar, `close <= D_U` and `close >= D_L` **by construction** - the close can never be beyond the band. A "breakout" under this convention is *price making a new N-period extreme*, detected by comparing the current bar against the **previous bar's band** (TA-Lib: `High[t] > Upper[t-1]`, and the repo's `price-structure.mjs` does exactly this comparison). TradingView's help page describes the same family of behavior when it says a move "reaches or breaks through one of the bands" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)): the band updates to the new extreme as it is set.
- **Window excludes the most recent period** (StockCharts, explicitly): "The Price Channel formula doesn't include the most recent period. Price Channels are based on prices prior to the current period. A 20-day Price Channel for October 21 would be based on the 20-day high and 20-day low ending the day before, October 20. A channel break would not be possible if the most recent period was used" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)). Consequence: price can visibly protrude beyond a static band, and "price broke above the upper channel" is directly observable ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- The TradingView DC help page itself does not spell out the current-bar question in the sentence "the Upper Band is the high price for the period" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)); the inclusive convention is established by the TA-Lib reference and the repo audit, while the exclusive convention is established by StockCharts.

`[TRACECOM ADAPTATION]` TraceCom must fix **one** convention and never mix them. The engine currently computes bands with the current closed candle included and detects breakouts against the previous bar's band (repo audit, sections 5.1-5.3). Under this convention the correct objective breakout rule is `close[t] > D_U[t-1]` (high-based per TA-Lib; the repo uses close-based, which is stricter) - not "close above the current band", which is mathematically impossible. Any note or downstream rule assuming "close outside the band" is using the StockCharts convention and is inconsistent with the engine.

### 5.3 Reading position and trajectory inside the channel

- **Volatility**: "When volatility is high, the bands will widen and when volatility is low, the bands become more narrow" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- **Overbought/oversold semantics depend on regime**: during a bullish trend, movement into the upper band "can indicate a strengthening trend"; during a bearish trend, movement into the lower band likewise. Counter-trend band touches (oversold in an uptrend) "may just be temporary and the overall trend will continue". And the summary states the indicator "primarily works best within a clearly defined trend" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- **Persistence = strength, not exhaustion**: "Price continuously exceeding the upper channel line is a sign of strength... securities that continuously break the lower channel line show weakness"; securities "can become overbought and remain overbought in a strong uptrend" and "oversold and remain oversold in a strong downtrend" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- **Position inside the band** is the TraceCom `donchianPosition` feature: 0 at the lower band, 1 at the upper band (engine extension; the reference calculator defines no position output - repo audit 5.1). Mid line as "equilibrium" reference: "prices are more likely to touch the centerline than the upper channel line" in a pullback context ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
- **Trajectory**: the repo feature `slope` of the mid line, ATR-normalized (section 4.2), reads the channel's direction. When price rides a band, the band itself rises/falls with price, which the sources describe as a sign of strength ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels), [TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).

### 5.4 Breakout and retest usage

- Primary purpose: the indicator is "primarily used to identify potential breakouts or overbought/oversold conditions when price reaches either the Upper or Lower Band" ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
- A channel break has two possible meanings in the source: either the trend is confirmed and the move continues in the break direction, or the trend is already confirmed and the break is a small counter-move before continuation ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)). The source pairs the indicator with trend lines or DMI to separate these ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)); TraceCom's regime/strength gates play that role.
- Same-bar vs prior-bar reference: see 5.2. For a retest pattern, the reference level after a breakout is the band value that was broken (the prior extreme), which coincides with the S/R role-reversal logic of CME ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)) and StockCharts ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
- Close-only evaluation reduces false signals: StockCharts' close-only channel comparison removed two whipsaw signals present on the high/low version ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).

### 5.5 Failure modes

1. **Whipsaws are inherent**: "Indicator signals are not perfect, and there will be whipsaws. It's part of the game" ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
2. **Fading a riding market**: price can stay beyond a band for an extended period in a strong trend; overbought/oversold band touches are not reversal signals ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels), [TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
3. **Regime dependence**: the indicator works best in a clearly defined trend; the same band touch means strength in a trend and noise in a range ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)).
4. **Convention mismatch**: mixing current-bar-inclusive bands with "close outside the band" logic silently disables breakouts (see 5.2).
5. **Parameter sensitivity**: shorter lookback = tighter channel = more touches/breaks; longer = wider and fewer ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)). On M1/M5/M15 the choice of 20 must be treated as an engine parameter, not as a default truth; the sources only state that 20 is the common default ([TV-DC](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/), [SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
6. **Midline is not an average**: the midpoint moves with the extremes, not with the average price ([TA-Lib](https://ta-lib.org/functions/donchian.html) via repo audit); treating it as a mean-reversion anchor is a misuse.
7. **Overbought/oversold in a range**: StockCharts' own recommended sequence is to establish the larger trend, then use a smaller timeframe's channel touches as pullback/overshoot signals - not to trade band touches standalone ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).

## 6. Common errors

1. **Trading mid-range.** Entering with price at/near the centerline gives up the distance to both boundaries; the sources treat the centerline as the most-touched reference, not as an edge ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
2. **Chasing extended moves.** "Do not chase a position after a three-day move"; "Seldom take a position in the direction of an immediately preceding three-day move" ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)).
3. **Treating wicks as breaks.** A brief poke that closes back inside is documented as a false breakout that was later "nullified" ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)); close-basis breaks and close-only channel plots filtered out false signals ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
4. **Assuming levels hold to the penny.** Levels are zones; brief violations are documented as normal ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance), [SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
5. **Fading persistent band riding.** Continuous band exceeding is strength, not exhaustion ([SC-PC](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/price-channels)).
6. **Ignoring role reversal.** Broken support becomes resistance and vice versa; the retest is a first-class event, not noise ([CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance), [SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)).
7. **Using volume confirmation that does not exist in the data.** Volume appears in the Donchian guidelines and in general S/R practice ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines), [CME-SR](https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance)); TraceCom spot FX has no volume feed.
8. **Mixing Donchian conventions.** See 5.2.
9. **Treating one touch as a level.** The sourced examples confirm resistance with two or three failed attempts ([SC-SR](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/support-and-resistance)); the mirror caution about "touched too often" also exists ([SC-DG](https://chartschool.stockcharts.com/table-of-contents/overview/donchian-trading-guidelines)), so touch count is evidence in both directions and must be read with the other gates.
10. **Calling a setup invalid because the retest never came.** The sources never require a retest; a breakout can continue directly. A missing retest eliminates the RETEST setup, not the market's trend.

## 7. Location quality rubric (all checks computable from OHLC only)

Scored as binary gates or ordered labels; no probabilities. `theta_*` are engine calibration parameters. A location can be VALID, DEGRADED or INVALID for a proposed direction.

| # | Check | Formula / rule | VALID | DEGRADED | INVALID |
|---|-------|----------------|-------|----------|---------|
| Q1 | **Side of structure** | Long requires `C > D_M` and last pivot low below `C`; short requires `C < D_M` and last pivot high above `C` | Condition holds | `C` within `theta_mid` ATR14 of `D_M` (mid-range) | Condition fails |
| Q2 | **Channel position** | `pos = (C - D_L)/(D_U - D_L)`; width > 0 | Long: `pos >= theta_pos`; short: `pos <= 1 - theta_pos` | `theta_mid < pos < theta_pos` (middle band) | width = 0 (undefined) or wrong side |
| Q3 | **Headroom to opposite boundary** | `headroom = (D_U - C)/ATR14` for longs (mirror shorts) | `headroom >= theta_headroom` | `0 < headroom < theta_headroom` | `headroom <= 0` (at/through boundary) |
| Q4 | **Post-breakout travel** | `travel = (C - level)/ATR14`, `bars_since_break` | `travel <= theta_travel` or a retest has reset proximity | `theta_travel < travel <= theta_chase` | `travel > theta_chase` with no retest (chase) |
| Q5 | **Break basis** | Break = close beyond level by `>= theta_break` ATR14; wick-only = high/low beyond, close not | Close-basis | Close-basis within `theta_break` (marginal) | Wick-only poke (no close beyond) |
| Q6 | **Acceptance** | Count consecutive closed candles beyond level | `>= N_accept` | `1..N_accept-1` | close back through level (FAILED_BREAKOUT) |
| Q7 | **Retest proximity and hold** | `retest_dist = abs(C - level)/ATR14`; close on breakout side | `retest_dist <= theta_retest` and close on breakout side | approaching but not yet within zone | close back on pre-break side |
| Q8 | **Extension from mean** | `ext = (C - D_M)/ATR14` | `abs(ext) <= theta_ext` | `theta_ext < abs(ext) <= theta_ext_max` | `abs(ext) > theta_ext_max` (extended) |
| Q9 | **Volatility context** | `width = (D_U - D_L)/ATR14` vs its own trailing average/percentile; `slope_M` | Compression before breakout, or expansion in the trade's direction | flat/ambiguous width | width collapsed post-break (volatility collapse) or opposite-direction slope while long/short |
| Q10 | **Trigger candle anatomy** | Close location in the candle's own range: `(C - L)/(H - L)` (define 0.5 when H = L) | Long: `>= theta_close_loc` (close near high) | middle | Long: `<= 1 - theta_close_loc` (close near low) |
| Q11 | **Time since extreme** | Consecutive closed candles beyond level or since the last opposite-side close; `bars_since_break` | Fresh (<= N_chase candles) | mid-range count | beyond N_chase without pullback (links to SC-DG no-chase guidance) |
| Q12 | **Defined invalidation price** | A price exists from OHLC (pivot low/high, broken level, Donchian band) within `theta_inval` ATR14 of entry | Exists and distance <= theta_inval | exists but far | no OHLC-definable invalidation |

Rubric usage: any INVALID check on Q1-Q5, Q7 or Q12 downgrades the location to "bad entry price" regardless of how good the setup looks (see companion lesson, `VALID_SETUP_BUT_BAD_ENTRY_PRICE`). Q8-Q11 DEGRADED states are WAIT triggers, not entry disqualifiers.

## 8. TraceCom applicability notes

- All machinery here reduces to four engine features: Donchian upper/lower/mid (period 20, current closed candle included), `donchianPosition`, `donchianWidthATR`, and ATR14. The repo audit confirms these exist and match TA-Lib band definitions (repo audit, section 5).
- Breakout detection must use the one-bar-offset comparison (`close[t]` vs prior-bar band), per the repo's existing `price-structure.mjs` convention and TA-Lib's warning (repo audit, section 5.3).
- The ATR-normalized metrics in 4.2 mirror the repo's existing style (`donchianWidthATR`), so the rubric in section 7 is implementable without new data.
- Sources are education pages for discretionary traders; none validates 60-second binary entries on FX. Every threshold is therefore an engine parameter requiring calibration and audit, consistent with `tracecomApplicability: ADAPTATION_REQUIRED`.
- No probability, win-rate or expectancy statement from the sources is reproduced here as a trading expectation.

## 9. Limitations and confidence

- CME pages were **403** to direct fetch; their text was obtained via a read-only extraction proxy and matched search-indexed text of the same URLs. Confidence reduced accordingly (0.85 as recorded in frontmatter).
- The TradingView URL supplied in the task (`43000502589`) is the Moving Averages page; Donchian Channels live at `43000502253`. This is disclosed rather than silently substituted.
- The "window includes the current bar" statement is established by the TA-Lib reference (via the repo audit) and the StockCharts page establishes the opposite convention explicitly; the TradingView help page does not address the question verbatim. The distinction is documented in 5.2 instead of being papered over.
- No volume data exists in TraceCom for these markets; all volume-dependent source guidance is flagged as unavailable.
- Numeric thresholds (`theta_*`, `N_*`, `K_pivot`) are deliberately symbolic: the sources state the principles but no calibrated intraday values.
