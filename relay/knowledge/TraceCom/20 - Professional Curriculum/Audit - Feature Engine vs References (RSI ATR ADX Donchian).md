---
title: Audit - Feature Engine vs References (RSI ATR ADX Donchian)
topic: indicatoren
category: AUDIT
sourceIds: [SRC-FIDELITY-IND, SRC-FIDELITY-RSI, SRC-FIDELITY-ATR, SRC-FIDELITY-DMI, SRC-TALIB-ADX]
sourceTier: A
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.9
status: AUDIT
tracecomApplicability: DIRECT
regimes: [TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION]
setups: [TREND_PULLBACK, MOMENTUM_CONTINUATION]
indicators: [RSI14, ATR14, ADX14, DI_SPREAD, DONCHIAN]
markets: [EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY]
timeframes: [M1, M5]
tags: [audit, rsi, atr, adx, dmi, donchian, feature-engine, formula-parity]
---

# Audit - Feature Engine vs References (RSI ATR ADX Donchian)

Audit-only note. **No code was modified.** Every implementation claim below carries a
`file:line` reference; every reference formula carries its source URL.

## 1. Scope and method

Files inspected line-by-line:

- `relay/feature-engine.mjs` - `rsiWilder` (13), `atrWilder` (28), `adxWilder` (41),
  `donchian` (68), `buildFeatureContext` (95).
- `relay/price-structure.mjs` - `computeStructureFeatures` (45), `averageRange` (116),
  `classifyRegime` (128).
- Duplication sweep across `relay/*.mjs`: `frozen-strategies.mjs`, `experiment.mjs`,
  `iq-ws-runtime.mjs`, `iq-multi-runtime.mjs` (call sites), `professional-brain.mjs`,
  `trade-quality.mjs`, `agent-pair.mjs`, `apprentice.mjs`, `g2-audit.mjs`,
  `opencode-go.mjs` (vision only, no computation).

Reference sources (retrieval state):

- Fidelity pages: direct fetch returned HTTP 403; content obtained from search-index
  snippets of the exact canonical URLs and a text mirror (`r.jina.ai`). Prose confidence
  0.8 (indirect).
- TA-Lib pages: fetched directly, HTTP 200. ADX
  (https://ta-lib.org/functions/adx.html), plus supplementary RSI
  (https://ta-lib.org/functions/rsi.html), ATR (https://ta-lib.org/functions/atr.html) and
  DONCHIAN (https://ta-lib.org/functions/donchian.html) for seed/band definitions.
- Fidelity RSI/ATR/DMI/overview URLs are the same as in the companion reference note
  `Indicators Reference - RSI ATR DMI ADX.md`.

Verdict vocabulary used: **MATCH** (formula equivalent), **DEVIATION** (different
formula/semantics), **GUARD** (defensive handling not specified by the references),
**DUPLICATE** (same indicator implemented in more than one place).

## 2. RSI14 - `rsiWilder` (`relay/feature-engine.mjs:13-25`)

Implementation, exact lines:

- Guard (14): `closes.length <= period` -> `null` (period defaults to 14, line 13).
- Seed (16-17): loop `index = 1..period`, `diff = closes[index] - closes[index-1]`;
  `diff >= 0` adds to `gains`, else `losses -= diff`; then `avgGain = gains/period`,
  `avgLoss = losses/period`.
- Recursion (18-22): for `index = period+1..end`,
  `avgGain = (avgGain*(period-1) + max(diff,0))/period`; same for `avgLoss` with
  `max(-diff,0)`.
- Output (23-24): `if (avgLoss === 0) return 100;` else
  `return 100 - 100/(1 + avgGain/avgLoss)`.

| Check | Implementation | Reference | Verdict |
|---|---|---|---|
| Gain/loss split | `diff>=0` gain, else loss; `max(diff,0)` / `max(-diff,0)` (16, 20-21) | `U_t=max(X_t-X_(t-1),0)`, `D_t=max(X_(t-1)-X_t,0)` (https://ta-lib.org/functions/rsi.html) | MATCH |
| Wilder seed | SMA of first 14 changes (16-17) | "if t = n: SMA(U,n)" seed (https://ta-lib.org/functions/rsi.html) | MATCH |
| Smoothing recursion | `(avg*(n-1)+new)/n` (20-21) | `((n-1)*Ubar_(t-1)+U_t)/n` (https://ta-lib.org/functions/rsi.html) | MATCH |
| Basic formula | `100 - 100/(1+avgGain/avgLoss)` (24) | `RSI = 100 - [100/(1 + (avg up change / avg down change))]` (Fidelity RSI page) and `RSI=100-100/(1+RS)` (TA-Lib RSI) | MATCH |
| Warm-up | requires `closes.length > period` (14) -> first value at bar 15 | first RSI at t = n (TA-Lib RSI) | MATCH |
| `avgLoss===0` | returns 100 (23) | references do not define the value; 100 is the all-gain convention | GUARD (undocumented; when both averages are 0 the return is 100, whereas a strict `100*U/(U+D)` gives 0/0) |

Impact: RSI14 in the feature engine is formula-conformant with the Wilder/TA-Lib family.
The only edge divergence is a dead-flat window returning 100 instead of an undefined
value; on FX 5s candles this is practically unreachable.

### 2.1 RSI duplication (DEFECT)

Two additional, **different** RSI implementations exist:

- `relay/frozen-strategies.mjs:23-29` `cutlerRsi`: simple (non-recursive) mean of the
  last 14 changes: `gains/period`, `losses/period`, `100 - 100/(1+gains/losses)`.
  This is the Cutler RSI form, not Wilder. Used at `frozen-strategies.mjs:69`.
- `relay/experiment.mjs:43` `rsiOver`: same simple-mean form over the last `p` changes.
  Used at `experiment.mjs:45-46`, `206`, `269`.

Both consume a **different smoothing** than `rsiWilder` and than the reference
(https://ta-lib.org/functions/rsi.html). `frozen-strategies.mjs:1-6` declares the engines
shadow-only ("Somente shadow; nenhuma ordem"), so order flow is unaffected, but any
comparison between shadow RSI and feature-engine RSI compares two different indicators.
Severity: medium (shadow path only; parity tests, per `frozen-strategies.mjs:3-5`, are
internal to the TS/JS shadow pair, not against the feature engine).

## 3. ATR14

### 3.1 `atrWilder` (`relay/feature-engine.mjs:28-38`) - MATCH

- Guard (29): `candles.length <= period` -> `null`.
- True Range (31-34): for `index = 1..end`,
  `max(high-low, |high-prevClose|, |low-prevClose|)`.
- Seed (35): `mean(ranges.slice(0, period))` (simple average of first 14 TRs).
- Recursion (36): `atr = (atr*(period-1) + ranges[index]) / period` for
  `index = period..ranges.length-1`.

| Check | Implementation | Reference | Verdict |
|---|---|---|---|
| True Range | line 33, greatest of the three terms | Fidelity ATR page calculation and `TR_t = max(high-low, abs(prevClose-high), abs(prevClose-low))` (https://ta-lib.org/functions/atr.html) | MATCH |
| Seed | simple mean of first 14 TRs (35) | "ATR seed = simple average of first period TR values" (https://ta-lib.org/functions/atr.html) | MATCH |
| Recursion | `(prev*(n-1)+TR)/n` (36) | Fidelity ATR page: `ATR = (Previous ATR*(n-1)+TR)/n`; TA-Lib ATR same | MATCH |
| Warm-up | first value at bar 15 (guard 29) | TA-Lib first ATR at index n | MATCH |

Impact: no deviation. RSI/ATR/ADX seeds are consistent with the canonical Wilder family.

### 3.2 `averageRange` (`relay/price-structure.mjs:116-125`) - DEVIATION (high impact)

- Guard (117): `candles.length < period+1` -> `null`.
- Window (118): `slice = candles.slice(-(period+1))` (the last 15 candles).
- TR sum (120-123): same True Range formula as above.
- Output (124): `return sum/period` - a **simple rolling mean of the last 14 TRs**.

Reference: Wilder's ATR is recursive with an SMA seed
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr,
https://ta-lib.org/functions/atr.html). `averageRange` implements an SMA-ATR: no
recursion, no seed, every call recomputed from a fixed window.

Usage:

- `price-structure.mjs:50` - `atr = averageRange(list, 14)` feeds all structure features.
- `price-structure.mjs:90-95` - `atrHistory` (6 rolling SMA-ATRs) -> `atrBaseline` ->
  `atrRatio = atr/atrBaseline`, with `compression = atrRatio < 0.7` and
  `expansion = atrRatio > 1.4`.
- `price-structure.mjs:107` - `distanceToUpperATR` / `distanceToLowerATR` on the SMA-ATR.
- `price-structure.mjs:128-146` - `classifyRegime` consumes those flags.

Impact (high): in the same decision cycle (`relay/iq-multi-runtime.mjs:518` builds the
feature context with Wilder ATR, `:572` builds structure features with SMA ATR), TraceCom
holds **two different "ATR" values**. The SMA variant reacts faster to volatility spikes
than Wilder's, so `compression`/`expansion` boundaries (0.7 / 1.4) and
`trade-quality.mjs:101` `ATR_SPIKE` (`atrRatio > 2.5`) can flip one evaluation earlier
than they would on the canonical Wilder ATR, while `atr14` / `atrNormalized`
(`feature-engine.mjs:99`, `104`) use Wilder. Consequence: cross-module inconsistency in
volatility reads (regime, spike filters, channel distances) rather than a wrong number in
a single field.

### 3.3 ATR duplication summary

ATR is implemented twice with different smoothing (Wilder in
`feature-engine.mjs:28-38`; rolling SMA in `price-structure.mjs:116-125`). This is the
highest-severity finding of this audit. There is no third ATR implementation; other files
only read ATR/atrRatio values (`professional-brain.mjs:156`, `trade-quality.mjs:50`,
`entry-timing.mjs:62`, `g2-audit.mjs:29-38`).

## 4. ADX / DMI - `adxWilder` (`relay/feature-engine.mjs:41-65`) - MATCH

Implementation, exact lines:

- Guard (42): `candles.length < period*2+1` -> `null`.
- DM/TR (44-51): `upMove = high_t-high_(t-1)`, `downMove = low_(t-1)-low_t`;
  `plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)`;
  `minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)`;
  TR same as ATR (50).
- Wilder running-sum smooth (52): `acc = sum(values.slice(0, period))`;
  then `acc = acc - acc/period + values[index]` for `index = period..end`.
- DI/DX (55-60): `p = 100*plusS/trS`, `m = 100*minusS/trS`;
  `dx = p+m===0 ? 0 : 100*|p-m|/(p+m)`; bars with `trS[index]===0` are skipped (56).
- ADX (61-63): `adx = mean(dx.slice(0, period))`; then
  `adx = (adx*(period-1)+dx[index])/period`.
- Return (64): `{ adx, plusDI: last plusDI, minusDI: last minusDI }`.

| Check | Implementation | Reference | Verdict |
|---|---|---|---|
| +DM/-DM rules | strict `>` comparisons, zero otherwise (48-49) | Fidelity DMI step 1: greater of current-prev high/low or 0; both negative -> both 0; ties -> both 0 (Fidelity DMI page) | MATCH |
| TR | line 50 | Fidelity DMI step 1 (same three terms) | MATCH |
| Wilder smoothing of DM/TR | running sum `X = X - X/n + value` (52) | TA-Lib ADX: "`X = X - X/period + today's one-bar value`" (https://ta-lib.org/functions/adx.html); Fidelity DMI step 2 | MATCH |
| +DI/-DI | `100*smoothedDM/smoothedTR` (57) | TA-Lib ADX: `+DI = 100*(+DM_p/TR_p)`; Fidelity DMI steps 3-4 | MATCH |
| DX | `100*|p-m|/(p+m)` (59) | TA-Lib ADX: `DX = 100*|(-DI)-(+DI)|/((-DI)+(+DI))`; Fidelity DMI step 5 | MATCH |
| ADX seed | mean of first 14 DX (62) | TA-Lib ADX: "first ADX = mean of the first `period` DX"; Fidelity DMI step 6 | MATCH |
| ADX recursion | `(prev*(n-1)+DX)/n` (63) | TA-Lib ADX and Fidelity DMI step 6 (identical) | MATCH |
| Integer rounding | none | TA-Lib ADX notes: "Wilder's original integer rounding is not applied" | MATCH |

Running-sum vs averaged-form equivalence: `plusS`, `minusS`, `trS` are sums scaled by
`period` relative to Wilder averages; the DI ratio cancels the factor, and DX is
scale-free, so the smoothed sums yield identical DI/DX values to the averaged recursion
described by Fidelity.

### 4.1 ADX DEVIATIONs and guards

| # | Location | Behavior | Reference | Verdict | Impact |
|---|---|---|---|---|---|
| 1 | `feature-engine.mjs:42` | requires `candles.length >= 2n+1` (29 for n=14) | canonical first ADX at 2n bars (28); TA-Lib lookback 2n-1 | DEVIATION (conservative) | the seed-only first ADX can never be returned; output is always post-recursion. Values are canonical for the latest bar; availability is one bar later. Low |
| 2 | `feature-engine.mjs:56` | bars with `trS === 0` are skipped; the bar contributes no DI/DX | not specified; TA-Lib ADX is marked as not outputting NaN/Inf | GUARD | if a zero-TR bar ever occurs, dx alignment shifts for that bar; last DI still comes from the last valid bar. Low, unreachable on live FX 5s candles |
| 3 | `feature-engine.mjs:59` | `p+m===0` -> DX = 0 | DX is 0/0 there; references silent | GUARD | correct convention (no directional movement = no directional index). Low |

### 4.2 DI calculation order - MATCH

Order in the implementation: DM +/- and TR computed per bar first (44-50), smoothed
independently (52-53), DI ratios (57), DX (59), then ADX smoothing of DX (62-63). This
matches Fidelity DMI steps 1-6 and the TA-Lib ADX formula order
(https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/dmi,
https://ta-lib.org/functions/adx.html). No transposed or reversed step was found.

### 4.3 ADX duplication - NONE

`adxWilder` is the only ADX/DI computation in the repo. `diSpread` is computed once at
`feature-engine.mjs:117` from the returned `plusDI`/`minusDI`. Other modules only consume
these values (`professional-brain.mjs`, `entry-timing.mjs:62`, `iq-multi-runtime.mjs:594`,
`trade-quality.mjs`). `opencode-go.mjs:68` reads displayed ADX/DI values from vision
output; it does not compute them.

## 5. Donchian (channel) audit

### 5.1 `donchian` (`relay/feature-engine.mjs:68-77`) vs TA-Lib DONCHIAN

| Check | Implementation | Reference | Verdict |
|---|---|---|---|
| Window | `candles.slice(-period)`, period 20, includes the current candle (70) | "Window = the optInTimePeriod bars ending at the current bar"; "The window includes the current bar" (https://ta-lib.org/functions/donchian.html) | MATCH |
| Upper/Lower | `max(high)`, `min(low)` over the window (71-72) | Upper = highest high, Lower = lowest low | MATCH |
| Middle | `(upper+lower)/2` (73) | Middle = (Upper+Lower)/2; "channel midpoint, not a moving average of price" | MATCH |
| Position | `(close-lower)/width`, `width>0 ? ... : 0.5` (76) | no position output in the reference; engineering extension | GUARD (only definition) |

### 5.2 Inline channel in `computeStructureFeatures` (`price-structure.mjs:55-59`) - DUPLICATE

- `window = list.slice(-20)`, `channelHigh = max(high)`, `channelLow = min(low)`,
  `channelWidth = max(1e-9, channelHigh-channelLow)`, `position = (close-channelLow)/width`.
- Same band values as `donchian`; different code path (no shared function).

Differences between the two implementations:

| Aspect | `feature-engine.mjs:68-77` | `price-structure.mjs:55-59` | Impact |
|---|---|---|---|
| Zero-width window | position = 0.5 (76) | denominator floored at 1e-9 -> position = 0 (58-59) | divergent zone labels on flat windows (`MID` vs `AT_BOTTOM`); rare on live data |
| Rounding | none | `donchianPosition` rounded to 4 dp (107) | cosmetic |
| Consumers | `deterministicIndicators.donchian*` (118-124); used by `agent-pair.mjs:27,42`, `apprentice.mjs:57`, `iq-ws-runtime.mjs:596` | `structureFeatures.location.donchianPosition`; used by `professional-brain.mjs:83`, `trade-quality.mjs:46,189`, `g2-audit.mjs` via structure | two sources of the same-named feature, normally equal |

### 5.3 Breakout offset convention - MATCH

The reference warns that a breakout must compare the current bar against the previous
bar's band: `High[t] > Upper[t-1]` (https://ta-lib.org/functions/donchian.html).
`price-structure.mjs:61-63` computes `previousHigh`/`previousLow` from
`list.slice(-21, -1)` (window ending one bar before the current) and compares the current
close against it (66-69), i.e., the correct one-bar offset. `feature-engine.mjs:68-77`
contains no breakout rule, so nothing to fault there.

## 6. Cross-cutting checks

### 6.1 Wilder smoothing seeds

| Series | Implementation | Reference | Verdict |
|---|---|---|---|
| RSI gains/losses | SMA of first 14 changes (`feature-engine.mjs:16-17`) | SMA seed at t=n (https://ta-lib.org/functions/rsi.html) | MATCH |
| ATR TR | simple mean of first 14 TRs (`feature-engine.mjs:35`) | simple average of first `period` TRs (https://ta-lib.org/functions/atr.html) | MATCH |
| ADX DM/TR | running sum of first 14 (`feature-engine.mjs:52`) | running sum form per TA-Lib ADX; ratio-equivalent to avg seed | MATCH |
| ADX DX->ADX | mean of first 14 DX (`feature-engine.mjs:62`) | mean of first period DX (TA-Lib ADX; Fidelity DMI step 6) | MATCH |
| Structure ATR | no seed, no recursion; rolling SMA (`price-structure.mjs:116-125`) | not the reference ATR at all | DEVIATION |

### 6.2 Division-by-zero handling

| Location | Guard | Assessment |
|---|---|---|
| `feature-engine.mjs:23` | `avgLoss===0` -> RSI 100 | DEVIATION-edge; references silent; strict formula gives 0/0 for a flat window |
| `feature-engine.mjs:35` | `mean(...) ?? 0` | unreachable given guard line 29; harmless NOTE |
| `feature-engine.mjs:56` | `trS===0` -> skip bar | GUARD; shifts DX alignment on degenerate data |
| `feature-engine.mjs:59` | `p+m===0` -> DX 0 | GUARD; reasonable convention |
| `feature-engine.mjs:76` | `width>0` else position 0.5 | GUARD; inconsistent with price-structure |
| `price-structure.mjs:58` | `max(1e-9, width)` | DEVIATION vs `feature-engine.mjs:76` (0 vs 0.5 on zero width) |
| `price-structure.mjs:74-75, 87-88` | `range>0` checks for wick ratios | GUARD; fine |
| `price-structure.mjs:93` | `atrBaseline>0` else ratio 1 | GUARD; fine |
| `feature-engine.mjs:104` | `price && ... price!==0` | GUARD; fine |
| `feature-engine.mjs:122-124` | `atrValue` truthy -> 0 yields `null` field | GUARD; fine |

### 6.3 Duplicated implementations - consolidated

| Indicator | Sites | Same formula? | Severity |
|---|---|---|---|
| RSI14 | `feature-engine.mjs:13-25` (Wilder); `frozen-strategies.mjs:23-29` (Cutler); `experiment.mjs:43` (Cutler) | NO - different smoothing | medium (shadow engines only) |
| ATR14 | `feature-engine.mjs:28-38` (Wilder); `price-structure.mjs:116-125` (SMA) | NO - different smoothing | **high** (both live in the same cycle) |
| ADX14 / DI_SPREAD | `feature-engine.mjs:41-65`, `:117` | single implementation | none |
| DONCHIAN20 | `feature-engine.mjs:68-77`; inline `price-structure.mjs:55-59` | YES on bands/window; NO on zero-width handling and rounding | medium |

Live call sites proving the divergence is co-resident in one decision cycle:
`relay/iq-multi-runtime.mjs:518` (`buildFeatureContext`, Wilder ATR + Donchian) and
`relay/iq-multi-runtime.mjs:572` (`computeStructureFeatures`, SMA ATR + inline channel)
run in the same `#maybeEvaluate` invocation.

## 7. Summary table

| # | Indicator / check | Implementation (file:line, formula) | Reference formula | Verdict | Impact |
|---|---|---|---|---|---|
| 1 | RSI gain/loss + seed | `feature-engine.mjs:16-17`, SMA of first 14 changes | TA-Lib RSI: `U=max(dX,0)`, SMA seed at t=n | MATCH | none |
| 2 | RSI recursion + output | `feature-engine.mjs:20-24`, `(avg*(n-1)+x)/n`, `100-100/(1+RS)` | Fidelity RSI basic formula; TA-Lib RSI recursion | MATCH | none |
| 3 | RSI flat-window edge | `feature-engine.mjs:23`, `avgLoss===0 -> 100` | undefined in references | GUARD | low |
| 4 | RSI duplicate variants | `frozen-strategies.mjs:23-29`; `experiment.mjs:43` | Wilder RSI (TA-Lib) | DEVIATION | medium (shadow) |
| 5 | ATR True Range | `feature-engine.mjs:33` | Fidelity ATR; TA-Lib ATR TR | MATCH | none |
| 6 | ATR seed + recursion | `feature-engine.mjs:35-36`, SMA seed then `(prev*(n-1)+TR)/n` | TA-Lib ATR seed; Fidelity ATR recursion | MATCH | none |
| 7 | Structure ATR | `price-structure.mjs:124`, rolling SMA of last 14 TRs | Wilder ATR (Fidelity/TA-Lib) | DEVIATION | high |
| 8 | ADX DM/TR + smoothing | `feature-engine.mjs:44-53`, strict `>` rules; `acc - acc/n + v` | Fidelity DMI step 1-2; TA-Lib ADX smoothing | MATCH | none |
| 9 | ADX DI, DX, seed, recursion | `feature-engine.mjs:57-63` | Fidelity DMI steps 3-6; TA-Lib ADX formula | MATCH | none |
| 10 | ADX data guard | `feature-engine.mjs:42`, needs 2n+1 candles | canonical first ADX at 2n candles | DEVIATION (1-bar conservative) | low |
| 11 | ADX zero-TR / zero-DX | `feature-engine.mjs:56`, `:59` | references silent | GUARD | low |
| 12 | DI calculation order | `feature-engine.mjs:44-63`: DM/TR -> smooth -> DI -> DX -> ADX | Fidelity DMI steps 1-6; TA-Lib ADX order | MATCH | none |
| 13 | Donchian window/bands/middle | `feature-engine.mjs:70-73` | TA-Lib DONCHIAN: period window ending current bar; HH/LL/midpoint | MATCH | none |
| 14 | Donchian duplicate | inline `price-structure.mjs:55-59` | same as #13 | DUPLICATE | medium |
| 15 | Donchian zero-width position | `:76` -> 0.5 vs `:58-59` -> 0 | no position defined in reference | DEVIATION (internal) | low |
| 16 | Donchian breakout offset | `price-structure.mjs:61-69` uses bar t-1 band | TA-Lib: compare against `Upper[t-1]` | MATCH | none |
| 17 | Duplication overall | RSI x3, ATR x2, Donchian x2, ADX x1 | - | DEFECT | high (ATR); medium (RSI/Donchian) |

## 8. Findings ranked

1. **HIGH - Two ATR semantics live simultaneously.** Wilder ATR (`feature-engine.mjs:28-38`)
   and SMA ATR (`price-structure.mjs:116-125`) are both computed each cycle
   (`iq-multi-runtime.mjs:518` and `:572`). Volatility regime flags, spike filters and
   channel distances that reference "ATR" disagree by construction; SMA reacts faster to
   spikes, so compression/expansion thresholds (`price-structure.mjs:94-95`) and
   `ATR_SPIKE` (`trade-quality.mjs:101`) can trigger earlier than the canonical ATR would.
2. **MEDIUM - Duplicate Donchian code path.** `feature-engine.mjs:68-77` and
   `price-structure.mjs:55-59` implement the same 20-bar channel; values agree on live
   data but zero-width handling and rounding diverge, and fixes must be applied twice.
3. **MEDIUM - Shadow RSI variant is Cutler, not Wilder.** `frozen-strategies.mjs:23-29`
   and `experiment.mjs:43` use simple-average RSI while the feature engine and the
   reference use Wilder smoothing; cross-engine comparisons are not apples-to-apples.
4. **LOW - ADX warm-up guard is one bar conservative** (`feature-engine.mjs:42`), and the
   seed-only first ADX is never returned; values themselves are canonical.
5. **LOW - Zero-TR bar skip in ADX** (`feature-engine.mjs:56`) shifts DX alignment on
   degenerate data; references do not define this case.
6. **KNOWLEDGE - Source registry gap.** `99 - Sources/SOURCE_REGISTRY.md:43` states that
   notes may reference only IDs registered there. `SRC-FIDELITY-IND`, `SRC-FIDELITY-RSI`,
   `SRC-FIDELITY-ATR`, `SRC-FIDELITY-DMI`, `SRC-TALIB-ADX` are used by the companion
   reference note but are not in the registry table (lines 27-40). Registry update needed
   (not performed here; this audit is read-only).
7. **INFO - Vision ADX/RSI/ATR are OCR reads, not computations.** `opencode-go.mjs:68`
   normalizes displayed values (`displayedValue`, `plusDI`, `minusDI`, `slopeVisual`) from
   screenshots; they must not be confused with the deterministic fields audited here.

## 9. Fetch failures

- `https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/` -> HTTP 403 (direct).
- `.../technical-indicator-guide/rsi` -> HTTP 403 (direct); content obtained indirectly.
- `.../technical-indicator-guide/atr` -> HTTP 403 (direct); content obtained indirectly.
- `.../technical-indicator-guide/dmi` -> HTTP 403 (direct); content obtained indirectly.
- `.../technical-indicator-guide/overview` -> HTTP 403 (direct); content obtained via search index.
- `https://ta-lib.org/functions/adx.html` -> HTTP 200 (direct). Supplementary RSI, ATR and
  DONCHIAN pages -> HTTP 200 (direct).

All Fidelity formula quotes in this audit were cross-checked against the TA-Lib pages
retrieved directly, which is why the formula-parity verdicts above keep confidence 0.9.
