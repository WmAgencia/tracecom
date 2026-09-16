# CRITIC — repos-bench (repository-derived shadow benchmark) — independent adversarial review

Date: 2026-09-16 (UTC) · Critic: opencode (deepseek-v4.1-flash) · Role: fresh independent critic (fidelity / leakage / integration / audit / license / scope honesty)
Artifacts inspected (read-only): `repos-bench.cjs`, `repos-bench/benchmark-results.json`, `repos-bench/config-freeze.json`, `mh-lib.cjs`, local candle dumps `critic-candles-binary.json` / `critic-candles-otc.json` (7201 candles each), sources in `repos/binary_options_bot` (HEAD `a3c79c4ef3e3a5381c1b9479f608ff21cab8d8a7` = freeze `a3c79c4ef3e3`) and `repos/SuperThree` (HEAD `68b413e61e8df201a9a4c9ab5a7c141235555588` = freeze `68b413e61e8d`).

My scripts (evidence, outside `iqopt/`): `..\critic-repos-verify.cjs` → `..\critic-repos-verify.json`, `..\critic-repos-verify2.cjs`, plus inline EMA-seeding test. Node used: `C:\Program Files\Mover\nodejs\node.exe` (v24.18.0). No Supabase needed: all numbers below were recomputed from the local candle JSON; stream identity is proven by exact reproduction of the published rows (see Check 4).

**Bottom line up front:** the *harness mechanics* (causality, T+60 settlement, single-stream integration, freeze hashes, reproducibility) are solid — but the table is **not a faithful benchmark of the source strategies**: 2 candidates materially mis-model their repos (`deriv_psar` is a different signal universe; `superthree_trend` has 2 concrete Pine deviations), and 6+ more are "adapter variants" of the original formulas. Per-check verdicts:

| # | Check | Verdict |
|---|-------|---------|
| 1 | Fidelity of adapters vs source | **PARTIAL FAIL** — sma_rsi PASS, breakout20 PASS (nit), **psar FAIL**, **superthree_trend FAIL**; secondary deviations in ADX/ATR/STOCH/vote families |
| 2 | Leakage / causality | **PASS** (perturbation test real; my own re-run 0/20 changes; T+60 10/10 exact) |
| 3 | Integration adversary | **PASS** with 3 caveats (hardcoded `t60_exact`, vacuous vote2 sample, 1 mutant only in test harness) |
| 4 | Results audit `deriv_sma_rsi` BINARY | **PASS** — exact reproduction 492/263/229/20, WR 53.46 |
| 5 | License | **PASS** — `binary_options_bot/LICENSE.md` = MIT; `SuperThree/LICENSE` = MIT |
| 6 | Scope honesty | **PASS with flags** — 20 candidates only, non-JS/ML artifacts unbenchmarked; psar/psar-labelled rows + ADX/STOCH/vote family need re-labelling or exclusion |

---

## Check 1 — FIDELITY (condition-by-condition)

### 1a. `deriv_sma_rsi` (source `tecnhical_analysis_strategies.py:150-158`) — PASS

| Source (Python) | Adapter (`repos-bench.cjs:44`) | Match |
|---|---|---|
| `SMA_50 > SMA_200 and RSI_14 < 30 → "CALL"` | `f > s && r < 30 → 1` | yes |
| `SMA_50 < SMA_200 and RSI_14 > 70 → "PUT"` | `f < s && r > 70 → -1` | yes |
| else `None` | else `0` | yes |
| SMA = pandas-ta simple MA | `sma()` simple, 50/200 closes | yes |
| RSI_14 = pandas-ta `ewm(alpha=1/14)` (no SMA seed) | Wilder smoothing **with** classic 14-bar SMA seed (`rsiW`, line 19) | **convention differs** |

Quantified impact: 264 bars where the two RSI series differ numerically, but **0 decision differences** on BINARY; the pandas-ta-style recomputation also yields exactly 492 signals / 53.46% WR. Deviation is cosmetic on this dataset — PASS with note.

### 1b. `deriv_breakout20` (source `:237-248`) — PASS (nit)

Source: `len(df) < look+1 → None`; `high_lvl = df["high"].rolling(20).max().iloc[-2]` (bars t-20..t-1); `close > high_lvl → CALL`; `close < low_lvl → PUT`.
Adapter (line 51): `slice(i-20, i)` = same 20 prior bars, same polarity (break-up = +1/CALL). One nit: guard `i < 21` skips bar `i=20`, which the source would evaluate once `len ≥ 21` (one-bar deferral at data start). Measured at `i=20`: adapter 0, source-style 0 → **no impact on this dataset**.

### 1c. `deriv_psar` (source `:361-372`) — **FAIL (structural)**

Source: `psar = df["PSARl_0.02_0.2"].iloc[-1]`; `if not np.isnan(psar): close > psar → CALL; else PUT; return None`. In pandas-ta, `PSARl_*` is non-NaN **only while the trend is long** (`PSARs_*` carries the short regime; this is the documented psarl/psars behavior and is directly implied by the source's own `isnan` guard). So the original rule *never fires during short regime*.
Adapter (line 57 + `psar` block line 31): computes a standard bidirectional SAR and returns `close > psar ? +1 : -1` on **every** bar.

Recomputed from candles (BINARY):

| Variant | signals | W/L | draws | WR | PnL@0.89 |
|---|---|---|---|---|---|
| adapter as-shipped (== JSON row) | 6892 | 3442/3450 | 295 | 49.94% | -386.6 |
| source-faithful (long-mode only) | 3535 | 1867/1668 | 171 | **52.81%** | -6.4 |

The adapter's 3481 down-mode bars produce PUT signals that the repository code would return as `None`. This is not a cosmetic deviation: source-faithful PSAR would rank ~3rd in BINARY (52.81%) instead of 18th (49.94%). **Caveat of my method:** pandas-ta is not installed here (no Python runtime); the psarl/psars NaN semantics are taken from pandas-ta's documented API contract + the source's NaN guard, not executed. The *direction* of the discrepancy is robust; exact source-faithful numbers could shift by pandas-ta's flip-bar details, but not back to the adapter's regime.

### 1d. `superthree_trend` (pine `SuperThree.pine`) — **FAIL (two concrete deviations)**

Verified against `SuperThree.pine` + `Calculation.md`:

- **Band ratchet (pine 31-35) — PASS.** Adapter (line 35): `lower = (l > pL) || (close[i-1] < pL) ? l : pL` with `nz(na)=0` emulated by `pL ?? l`; on bar 0 Pine's `nz→0` keeps the basic band, adapter keeps `l` — equivalent. Uppercase symmetric. Bars 0-8 skipped but Pine's bands are `na` there too (`atr` na) → ratchet start equivalent.
- **Direction state machine (pine 37-47) — PASS.** `i<10 || prevDir==0 → 1` emulates `na(atr[1])`; `prevSuperTrend == prevUpperBand` checked via `superTrend === pU`; `close > upper ? -1 : 1` / `close < lower ? 1 : -1` and `superTrend = direction<0 ? lower : upper` all match. No inversion: trend "up" = direction<0 = bullish → +1, correct.
- **Quick-mode trend triggers (pine 58-65) — PASS.** `tb/tb1/tb2` = `lower/upper` by direction; sideways/up/down equalities and candle-color + `close vs close[1]` conditions match exactly.
- **Trend extension (pine 66-71) — FAIL.** Pine: `else if trend[1]=="sideways" → sideways; else if trend[1]=="up" and direction==direction[1] → up; else if "down" and direction==direction[1] → down; else trend = na`. Adapter line 35: `else trend = prevTrend;` — **always extends**, dropping both the `direction==direction[1]` gate and the na fallback. Stale "up"/"down" states survive direction flips.
- **ATR (pine 24 `ta.atr(10)`) — FAIL.** Pine `ta.atr` = RMA(TR,10) seeded with SMA; adapter computes `atr10 = SMA(TR,10)` (line 35: `s/10` sliding window). Comment "pine exato" is inaccurate.

Recomputed (BINARY), adapter replica vs Pine-faithful rebuild (RMA ATR + corrected extension):

| Variant | signals | W/L | draws | WR | PnL |
|---|---|---|---|---|---|
| adapter (== JSON row) | 3386 | 1639/1747 | 152 | 48.41% | -288.3 |
| Pine-faithful | 3272 | 1586/1686 | 142 | 48.47% | -274.5 |

Decision diffs: **1164/7201** total (adapter-only non-zero vs Pine-faithful zero: **620**). Isolation: extension bug alone 210 diffs (SMA-ATR basis); ATR convention alone 1095 (buggy-extension basis); both 1164; RMA-buggy vs RMA-fixed 163. Conclusion for this candidate survives (≈48.4-48.5% either way) — but the adapter is not the Pine indicator.

### 1e. Other candidates — secondary deviations found (not all quantified, all real)

- **ADX family** (`deriv_adx_trend:49`, `deriv_trend_follow:52`, `deriv_ema_cross_adx:58`, `deriv_stoch_rsi_reversal:60`): adapter's "ADX/±DI" are 14-bar simple-average ratios of TR/upM/dnM, and `adx.a` is the **unsmoothed** DX — not Wilder RMA ADX. Quantified for `adx_trend`: adapter replica 4303 signals / 48.01% (== JSON); Wilder-RMA recompute 3591 signals / 46.84%; **2709/7201 decisions differ**.
- **`deriv_stoch_rsi_reversal`** (source `:34-63`): source ADX filter is `adx < 25 → skip`; adapter line 60 uses `< 20`. Source `STOCHk_14_3_3` is SMA3-smoothed %K; adapter uses raw 14-bar %K. Quantified: threshold-only change → 16 decision diffs (990 vs 1005 signals); full source-faithful → 860 signals, 226 diffs vs adapter. Params `{adx_filter:true}` don't record the 20 value.
- **`deriv_stoch_rsi`**: same raw-%K vs smoothed-%K issue (source `:265-291`).
- **`deriv_atr_breakout`** (source `:347-358`): source `ATRr_14` = pandas-ta RMA ATR; adapter uses SMA(TR,14) (line 27).
- **`deriv_macd_cross`/`combo`**: adapter EMA is SMA-seeded (`ema()` line 18); pandas-ta uses `ewm(adjust=False)` from the first value. Quantified: 33 decision diffs (6894 vs 6861 signals); adapter replica == JSON exactly.
- **`deriv_vote2`** (line 64): source ensembles are `strategy.py:48-70` (`collect_rule_signals` over **all 20** `RULE_BASED_STRATEGIES`, `min_agree=2` default) and `backtest_voting.py:15` (`MIN_AGREEMENT = 3`). Adapter votes only **12 of 20** strategies (drops combo, candle_reversal, ema_cross_adx, bollinger_breakout, stoch_rsi_reversal, harmonic, squeeze, multi_confirm) at threshold 2. Result: 6887 signals = 95.6% of all bars (driven by near-always-on members psar/ichimoku/macd), so the vote is nearly degenerate.
- **`deriv_candle_reversal`**: simplified rule-based engulfing/hammer/shooting-star vs TA-Lib `CDLENGULFING/CDLHAMMER/CDLSHOOTINGSTAR` (`any(patterns == 100)`). Approximate by design; not quantified.
- **`deriv_macd_cross` equality edge**: adapter returns `-1` when `macd == signal`; source returns `None`. 0 such bars in BINARY → no impact.
- **`superthree_ctm`**: warm-up of `count/gapSum` differs from Pine 74-78 (adapter starts at i=9 with count=1; Pine accumulates from bar 0, where `gapSum` is `na` until the first direction flip) — threshold not comparable pre-flip; candidate produced **0 signals** in both markets, so it was never exercised.

---

## Check 2 — LEAKAGE / CAUSALITY

**(a) Backward-only indicator windows — PASS.** Reviewed every window in `buildInd` (lines 15-36): SMA/EMA/RSI one-pass forward recurrences; stoch `i-13..i`; BB `i-19..i`; ATR `i-13..i`; ADX sliding `trW` oldest-shifted; KC `e21[i], atr14[i]`; Ichimoku `i-8..i` / `i-25..i`; PSAR forward recurrence from bar 2; HA forward; `eo8` EMA forward; SuperThree forward with `lowers/uppers[i-1..i-2]`. No reference to index `> i`. Decision lambdas read only index `i` and `i-1/i-2`. No `l60` reference in any candidate.

**(b) Future-perturbation test is real — PASS, independently reproduced.**
`repos-bench.cjs:81` copies candles, mutates `[i+30..i+60]` by ×1.01 (close/high/low), calls `buildInd(cd2)` (full rebuild), compares `fn(i, I2, cd2, vecs)` vs `fn(i, I, cd, vecs)` for all 20 candidates; 10 samples × 20 = 200/dataset; JSON says `future_perturb_changes: 0` in both.
My own re-run (seed 1337, 10 random `i` per candidate, my replicated `buildInd` logic), two regimes — exact replica (×1.01 on close/high/low over `[i+30, i+60]`) and a **stronger** one (alternating ±1% on **open**+close/high/low over `[i+5, i+120]`):

```
deriv_macd_cross : changes 0/10 (replica) and 0/10 (stronger)
superthree_trend : changes 0/10 (replica) and 0/10 (stronger)
```
Caveats: `deriv_vote2` is **vacuous** in the script's test (it reads the cached `vecs`, never `I2`), and `superthree_ctm` has 0 signals; the other 18 candidates are genuinely tested. My strong-regime test closes the "insensitive mutation" gap.

**(c) T+60 labels — PASS.** `bucket+60000` direct linear lookup for 10 random rows (seed 42): exactly 1 hit each, labels equal to the map-based `l60` — 10/10 identical; **0** consecutive bucket gaps ≠ 5000 ms in the whole 7201-candle stream (so `byB` lookups are exact). Note: the script's own `tests.t60_exact: true` is **hardcoded** (`repos-bench.cjs:79`), not computed — this independent test is what backs it.

---

## Check 3 — INTEGRATION ADVERSARY

- **Same candle stream/arrays — PASS.** Single `cd` + single `I` per dataset, one `vecs` map; loop `v[i] = c.fn(i, I, cd, vecs)` (line 77) for every candidate. `deriv_vote2` is the only cross-candidate read (through `vecs`, same stream, same index `i`).
- **No shared-state mutation — PASS.** Scanned all 20 `add(...)` lambdas and the whole file for assignments to `I.*`, `I[...]`, `cd.*`, `cd[...]`, `vecs.*`: the only write found anywhere is the **test harness** line 81 (`cd2[j].close *= 1.01` on the copy, plus `cd2.length=0/push` reset). No candidate writes.
- **No settlement visibility before T+60 — PASS.** `l60` is built at line 74 but is never passed to decision functions (call signature `(i, I, cd, vecs)`); `0` lambda references to `l60`. Winners counted only in the later metrics loop (line 84).
- **Equal row counts / same N — PASS.** 20 rows in both datasets, identical id sets, `candles: 7201` both; every candidate is evaluated over all `i<N`; freeze hashes in results == freeze file (0 mismatches). Last 12 bars have no T+60 (`u=12` rows) and are correctly excluded from W/L, not settled.
- Caveats: `t60_exact` hardcoded (see 2c); vote2's perturbation test vacuous (see 2b); the label map is recomputed per dataset (correct), not shared.

---

## Check 4 — RESULTS AUDIT (`deriv_sma_rsi`, BINARY)

Independent recompute from raw candles: simple SMA50/200, Wilder RSI14, same gate, same `close(T+60s)` settlement with zero-draw on equality:

| | signals | W | L | draws | unknown | WR | PnL |
|---|---|---|---|---|---|---|---|
| **Claimed (JSON)** | 492 | 263 | 229 | 20 | 0 | 53.46% | +5.1 |
| **Recomputed** | 492 | 263 | 229 | 20 | 0 | 53.46% | +5.1 |

Exact match (also maxWinStreak 20 / maxLossStreak 23, CI 49.04-57.82 basis). Sensitivity: pandas-ta-style RSI (unseeded ewm) gives the **same 492 signals** (0 decision diffs despite 264 numerically-different RSI bars). This exact reproduction also proves the local candle dump is the same stream the benchmark published. **PASS.**

---

## Check 5 — LICENSE

- `C:\Users\junin\AppData\Local\Temp\opencode\repos\binary_options_bot\LICENSE.md` — **MIT License**, "Copyright (c) [2025] [Alexis S. G-K]" (only license file in the repo; recursive search). Freeze label "MIT(ver arquivo)" is accurate.
- `C:\Users\junin\AppData\Local\Temp\opencode\repos\SuperThree\LICENSE` — **MIT License**, "Copyright (c) 2024 Anish Manissery"; pine header line 2 also states MIT. Claim confirmed. **PASS.**

---

## Check 6 — SCOPE HONESTY

- **Only 20 deterministic-rule candidates ran — CONFIRMED.** `config-freeze.json` lists exactly 20, all from `binary_options_bot` (17+ensemble) and `SuperThree` (2), commits matching clone HEADs. Results contain the same 20 in both markets.
- **Non-JS / non-rule artifacts were not benchmarked — CONFIRMED.** Cloned set = 24 repos; unbenchmarked artifacts include WinstonAI `*.pth` (32 files), `IQOPTION-ML-TRADER/IQOption_model.h5`, `Binary-bot/*.joblib` trees, 11 `*.mq5` (incl. `binary_options_bot/MT5_Signal_EA.mq5`, `cortex5-*`), 61 notebooks, LLM/agent repos (FinGPT, TradingAgents, …). None appear in freeze/results.
- **Should-have-been-excluded / re-labelled list:**
  1. `deriv_psar` — as adapted it is **not** the repo's PSAR rule (short-regime PUTs never existed in the source). Exclude or re-adapt + rerun before citing.
  2. `deriv_stoch_rsi_reversal` — wrong ADX threshold (20 vs 25) and unsmoothed %K. Re-label as variant.
  3. `deriv_vote2` — ensemble membership (12 vs 20) and basis thresholds differ from `strategy.py`/`backtest_voting.py`; near-degenerate signal rate. Re-label.
  4. `superthree_trend` (and ctm) — ATR convention + extension rule deviate from `SuperThree.pine`. Re-label "pine-approx".
  5. ADX family (`adx_trend`, `trend_follow`, `ema_cross_adx`), `atr_breakout`, `stoch_rsi` — indicator formulas are approximations (SMA-based ADX/ATR, raw %K). Re-label.
  6. No included candidate has hardcoded price zones; the one source strategy with hardcoded zones (`harmonic_rsi_divergence`, 311.00-312.30) was correctly **not** adapted, as were `squeeze_momentum_breakout`/`multi_confirm`.

---

## Discrepancy ledger (severity order)

1. **`deriv_psar` mis-models its source** (bidirectional vs long-only PSARl): 6892 vs 3535 signals; 49.94% vs 52.81% WR. Ranking-changing counterexample.
2. **`superthree_trend` deviates from the Pine**: extension without direction gate (210 diffs isolated) and SMA-vs-RMA ATR (1095 diffs isolated); 1164/7201 total decisions differ; 620 adapter-only signals. Outcome not ranking-changing.
3. **ADX family**: adapter ADX is not Wilder; 2709/7201 decisions differ for `adx_trend` (4303 vs 3591 signals; 48.01 vs 46.84%).
4. **`deriv_stoch_rsi_reversal`**: threshold 20 vs 25 (+16 diffs) and raw vs SMA3 %K (+224 diffs); 226 total.
5. **`deriv_vote2`**: 12-of-20 ensemble, both-market 95%+ signal rate; spec not traceable to a single repo function.
6. Minor: MACD EMA seeding (33 diffs), RSI seeding (0 diffs here), ATR SMA vs RMA (`atr_breakout`), raw %K (`stoch_rsi`), simplified candlestick patterns, `breakout20` one-bar start guard (0 impact), MACD equality edge (0 occurrences), `superthree_ctm` warm-up + never fires.
7. Harness: `t60_exact` flag hardcoded; vote2 perturbation sample vacuous; 200/200 claim is per dataset (400 total) but effectively covers 18/20 candidates.

## Limits of this review

- No Python/pandas-ta runtime available: pandas-ta-specific conventions (RSI/ATR/ADX/EMA/STOCH/PSAR/TA-Lib) were compared against their documented implementations/contracts, not executed. All *adapter-side* reproductions are exact (they match the published rows to the digit).
- OTC results were not independently recomputed (BINARY fully audited; OTC checked for row-count/id/hash consistency only).
- Single asset (EURUSD), single 10h window per market, 5s bars with 60s horizons (overlapping/pseudo-replicated windows — CIs and streaks are optimistic; the project's own reports note this), no multiple-testing correction, and the top BINARY row (`sma_rsi_macd_combo`, 62.5%) is n=8 noise.

## Verdict

As an **initial shadow benchmark of the harness**, this is trustworthy: causal, leak-free, single-stream, hash-frozen, and bit-reproducible (I reproduced the audited row exactly). As a **benchmark of the repo strategies**, it is only trustworthy for ~12-13 candidates; `deriv_psar` is invalid as attributed, `superthree_trend` is an approximation with a real state-machine bug, and the ADX/STOCH/ATR family are adapter variants. Cite per-candidate numbers with the `adapterVersion: tc-1.0.0` qualifier, never as "the repo's strategy performance".
