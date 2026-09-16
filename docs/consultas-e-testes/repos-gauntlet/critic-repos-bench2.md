# CRITIC — repos-bench, round 2 (post-fix) — independent adversarial re-review

Date: 2026-09-16 (UTC) · Critic: opencode (deepseek-v4.1-flash) · Role: fresh critic, second round (fix verification / regression / new-candidate audit / integrity / scope)
Artifacts inspected (read-only): `repos-bench.cjs` (22 086 B, 01:19:37Z), `repos-bench/benchmark-results.json` (generated_at 2026-09-16T04:19:49Z), `repos-bench/config-freeze.json`, sources `repos/binary_options_bot/trading/tecnhical_analysis_strategies.py` (HEAD `a3c79c4ef3e3`), `repos/SuperThree/SuperThree.pine` (HEAD `68b413e61e8d`), prior `critic-repos-bench.md`, Supabase dataset `IQOPTION_EURUSD_BINARY_10H` / `IQOPTION_EURUSD_OTC_10H` (live SQL re-fetch).

My artifacts (outside `iqopt/`, per scope rule): `C:\Users\junin\AppData\Local\Temp\opencode\critic-v2-work\` — `make-repro.cjs` + `repro/repos-bench-repro.cjs` (instrumented copy), `repro-run.log`, `verify-core.cjs` + `verify-core.json`, `residuals.cjs`, `vote2-cascade.cjs`, `scope-audit.cjs` + `scope.json`, pandas_ta wheel 0.4.71b0 extracted to `pandas_ta_pkg/`. Node `C:\Program Files\Mover\nodejs\node.exe` v24.18.0. Method: live Supabase re-fetch (token verified OK), full independent re-run of the pipeline, code extraction + numeric reconstruction, pandas_ta source inspection (no Python runtime; 0.4.x wheel downloaded from PyPI, 0.3.14b0 semantics from the published source reproduction of the pinned version).

**Bottom line up front:** the SuperThree rebuild and the ADX/STOCH/ATR indicator fixes are real and verified — `superthree_trend` now reproduces the round-1 "Pine-faithful" rebuild to the signal; `deriv_sma_rsi` is bit-stable. **But the `deriv_psar` fix never landed: `psarUp` is computed but not exported from `buildInd()`, so the guard `I.psarUp[i] !== 1` is true on every bar and the candidate emits 0 signals in both markets.** That is a plumbing bug, not the source rule; it also silently removes PSAR as a live member of `deriv_vote2`. Round-2 table is mechanically clean (full re-run reproduced every published number), but it cannot be released as-is: `deriv_psar` must be re-fixed (one-line export) and re-run, or removed.

Per-check verdicts:

| # | Check | Verdict |
|---|-------|---------|
| 1 | Fix verification (code + numeric) | **PARTIAL FAIL** — (i)(ii)(iii)(v) PASS; **(iv) psarUp/deriv_psar FAIL** (missing export → 0 signals) |
| 2 | Regression `deriv_sma_rsi` BINARY | **PASS** — 492 / 263-229-20 / 53.46 vs round 1, exact, from live Supabase candles |
| 3 | New audit `deriv_psar` = 0 | **FAIL (degenerate/broken)** — 0 not plausible under the source; intended guard would yield 3535 / 52.81% |
| 4 | Integrity (JSON, hashes, causality) | **PASS** — full re-run 0 field diffs on 40 rows; perturb 0/200; dups 0; hashes 20/20; 2 cavetas (hardcoded `t60_exact`; freeze hash blind to code changes) |
| 5 | Scope / honesty | **PASS with flags** — 22/24 repos unbenchmarked (categorized); no asset-specific constants in the 20; residual flags listed (stoch_rsi_reversal 20 vs 25, vote2 membership, ctm warm-up) |

---

## Check 1 — FIX VERIFICATION (code inspection + numeric reconstruction)

### (i) RMA ATR14 — PASS

`repos-bench.cjs:28` `rmaHelper(values)`: seeds `prev = mean(vals[i-13..i])` when `i >= 14`, then `prev = (prev*13 + v)/14` for every later bar. `repos-bench.cjs:29-30`: `trArr` = true range, `atr14 = rmaHelper(trArr)`. This is RMA/Wilder(14), not the previous sliding SMA. Consumed by `deriv_atr_breakout`, the Keltner channel (`:31`) and the ADX gate of `deriv_ema_cross_adx`; all three rows moved versus round 1 (e.g. `deriv_atr_breakout` now 992 signals / 49.9%, and its values now feed `deriv_vote2`).

### (ii) Wilder ADX — PASS (one seed nuance, see table)

`repos-bench.cjs:32`: TR / +DM / -DM are smoothed with a Wilder recurrence — seed at `i=14` = mean of bars `j=2..14` (13 values), then `trS = (trS*13 + tr)/14`; `pdi/ndi` are 100·RMA ratios; `dxS` seeded with the first DX at `i=14`, then `adx.a = (dxS*13 + dx)/14`. My independent implementation of **exactly this convention** matches `I.adx.a` on all bars (max diff `0.00e+0`). Against a pure-Wilder 14-value seed the two agree on 7137/7171 bars within 2% (max relative divergence 18% in early bars, decaying) — the residual is genuinely just the seed length. The round-1 complaint ("unsmoothed DX, SMA ratios") is resolved.

### (iii) stochK = SMA3 of raw %K — PASS

`repos-bench.cjs:25-26`: `rawK` = 14-bar stochastic, then `stochK[i] = (rawK[i]+rawK[i-1]+rawK[i-2])/3`. Recomputed independently: **0 mismatches on 7186 bars**, first non-null at `i=15` exactly like pandas-ta `STOCHk_14_3_3`. `deriv_stoch_rsi_reversal` moved from 1005 signals in round 1 (raw %K) to 980 now (SMA3 %K, same threshold 20).

### (iv) psarUp + deriv_psar guard — **FAIL (broken, not conservative)**

- `repos-bench.cjs:34` declares and fills `psarUp`; `repos-bench.cjs:60` guards `if (I.psarUp[i] !== 1 || I.psar[i] === null) return 0;`.
- **`repos-bench.cjs:39` return object omits `psarUp`** → `I.psarUp === undefined` → `undefined !== 1` is true on every bar → **0 signals**. Grep: `psarUp` occurs 3× (declaration+fill, guard); zero in the return.
- Evidence: shipped rows `deriv_psar | 0 | 0 | 0/0/0/0 | null` in **both** BINARY and OTC; my replica of the shipped guard counts 0.
- The intended guard is not degenerate: I re-implemented the line-34 PSAR state machine and applied the long-only guard — **3535 signals, 1867/1668, 171 draws, WR 52.81%, PnL -6.4** — identical to the round-1 "source-faithful" counterfactual (a strong cross-check that both critics modelled the same machine). The bidirectional pre-fix replica also reproduces round 1 exactly (6892 / 3442-3450 / 295 / 49.94% / -386.6).
- Cascade: `deriv_vote2` (line 67) still lists `deriv_psar` among its 12 members; with the dead member, 0 contribution. If a working long-only psar were restored, vote2 would change on **445/7201 BINARY bars** (`vote2-cascade.cjs`). The published vote2 row (6877, 95.5%) is therefore computed with 11 effective members.

### (v) SuperThree — PASS (band ratchet, RMA-ATR, continuation gates)

- **ATR**: `repos-bench.cjs:38` `rma10` seeds at `i=10` with `mean(TR[1..10])` then `(prev*9+TR)/10`; my checks `seedOk=true`, `recursive9/10=true`.
- **State machine / trends**: I extracted line 38 and rebuilt it independently; `stDir` and `stTrend` match the shipped arrays on **7201/7201 bars** (0 mismatches).
- **Band ratchet vs pine 31-35**: spot-simulated 3 direction-flip rows with full arithmetic (raw band = `src ± 3·atr10`, ratchet vs previous stored band):

| i | close(t-1) | rawLower | prevLower | ratcheted lower (Pine) | shipped | rawUpper | prevUpper | ratcheted upper (Pine) | shipped |
|---|---|---|---|---|---|---|---|---|---|
| 30 | 1.153295 | 1.153214 | 1.153156 | 1.153214 (`l>pL`) | 1.153214 | 1.153431 | 1.153342 | **1.153342** (`u<pU`) | 1.153342 |
| 3217 | 1.154125 | 1.154072 | 1.154067 | 1.154072 (`l>pL`) | 1.154072 | 1.154183 | 1.154129 | **1.154129** (`u<pU`) | 1.154129 |
| 7172 | 1.154285 | 1.154237 | 1.154233 | 1.154237 (`l>pL`) | 1.154237 | 1.154343 | 1.154296 | **1.154296** (both clauses false → keep prev) | 1.154296 |

  (row i=30: `direction=-1/prev=+1`, `trend=sideways`; i=3217: `direction=-1`, `trend="up"` via primary branch; i=7172: `direction=-1`, prev trend `down` → primary branch. All consistent with pine 31-47, 58-65.)
- **Continuation gates (pine 66-71)**: gated vs pre-fix "always extend" variant differ on **163 bars**; on **57** bars the legacy variant kept a stale `up` while the shipped code correctly yields `na`; **0 gate violations** (no primary-less flip bar retains `up`/`down`).
- **Outcome**: `superthree_trend` BINARY = **3272 / 1586-1686-142 / 48.47% / -274.5** — exactly the round-1 Pine-faithful rebuild (round-1 shipped adapter was 3386 / 48.41%). The candidate is now faithful to the Pine text as ported (B phase: Pine executed by hand, no TradingView runtime).

---

## Check 2 — REGRESSION `deriv_sma_rsi` BINARY — PASS

Live Supabase re-fetch (3000-row pages) **identical to the local round-1 dump**: 7201 rows, 0 bucket diffs, 0 OHLC diffs. Independent recompute (SMA50/200 + Wilder RSI14 with SMA seed, adapter gate, close(T+60s) settlement, equality=draw):

| | signals | W | L | draws | unknown | WR | PnL | maxW/​maxL streak |
|---|---|---|---|---|---|---|---|---|
| published (2nd run) | 492 | 263 | 229 | 20 | 0 | 53.46% | +5.1 | 20/23 |
| my recompute | 492 | 263 | 229 | 20 | 0 | 53.46% | +5.1 | 20/23 |

pandas-ta-style RSI (unseeded `ewm(alpha=1/14, adjust=False)`) yields the same 492 decisions (4357 bar-level numeric differences, 0 decision differences). Round-1 → round-2 unchanged, as intended. **PASS.**

---

## Check 3 — NEW AUDIT `deriv_psar` = 0 — FAIL (degenerate)

**Is 0 plausible under the source's PSARl-only rule? No.**

1. Source path: `tecnhical_analysis_strategies.py:361-372` — `df.ta.psar(append=True)`; reads **only** `PSARl_0.02_0.2`; `if not np.isnan(psar): close > psar → CALL else PUT`; `None` on NaN.
2. pandas_ta contract (verified from the actual package wheel, `pandas_ta/trend/psar.py`, v0.4.71b0; the repo pins `pandas_ta==0.3.14b0`, whose published source has the same long/short split): `long` and `short` are NaN series; each bar assigns `long[i]` **only when `falling==False`**, `short[i]` only when falling; bar 0 is NaN in both. Therefore `PSARl` is NaN for **every bar of a short regime** — the rule fires only in long regime, and the count of such bars is large: in the adapter's own state machine **3718/7201 BINARY bars are in long state**.
3. The shipped 0 is caused solely by the missing `psarUp` export (Check 1.iv). Under the intended guard the candidate would produce ≈3535 signals / 52.81% WR (adapter-state-machine basis; exact pandas_ta execution could shift the flip boundaries slightly because pandas_ta's state machine differs structurally from the adapter's classic SAR — init via `-DM` on bars 0-1, `sar[0]=close[0]`, prior-bar clamp rules, reversal handling). **The faithful behavior per the source code path** is: for every bar, if `PSARl` is not NaN (long regime) → `CALL` when `close > PSARl`, `PUT` otherwise; `None` when NaN. The current adapter is neither faithful nor merely conservative — it is non-functional (and, worse, it silently changes `deriv_vote2`).
4. Note the source *can* return PUT in long regime (line 371) on flip bars; the adapter's `close > psar ? 1 : -1` matches that.

---

## Check 4 — INTEGRITY — PASS (2 caveats)

- **Full independent re-run.** I patched a copy of the shipped script (only: absolute `mh-lib` path, expose globals, disable the final `iqopt_benchmark_meta` insert) and ran it end-to-end against **live Supabase** data. Comparison vs published `benchmark-results.json`: **40/40 rows, 15 fields each (signals, eligible, W/L/D/U, WR, CI95, sig/h, streaks, expectancy, PnL, DD, hash) — 0 differences.** The run's own tests re-computed `t60=true, dups=0, perturb=0/200` for **both** datasets (the 0/200 is now additionally evidenced by my own re-run, not just the JSON claim). (`repro-run.log`, exit 0.)
- **Printed claims vs JSON** (5 sampled candidates: macd_cross, stoch_rsi, superthree_trend, breakout20, ichimoku_tk): signal/W/L/D/U counts parse-equal between the run log and the JSON. Note: the original generation log was not persisted; my faithful re-run's log is the substitute — and it is byte-equivalent in outcomes.
- **Freeze hashes.** Recomputing `sha16({id, repo, commit, params})` from the **source `add()` literals** (repo/commit constants + params expressions): 20/20 match `config-freeze.json` **and** every row in the results JSON; params match too. Repo HEADs: `a3c79c4ef3e3a5381c1b9479f608ff21cab8d8a7`, `68b413e61e8df201a9a4c9ab5a7c141235555588` (clean worktrees) — prefixes equal the freeze commits.
- **t60 / causality.** 0 consecutive-bucket gaps ≠ 5000 ms; every bar with a `bucket+60000` successor resolves to exactly one index and a label; the last 12 bars have no successor, so candidates that signal there show `u` up to 12 (e.g. `deriv_macd_cross` u=12; the sparse `deriv_psar` row shows u=0 only because it emits nothing). Code path re-inspected: `repos-bench.cjs:77` labels built from `bucket+60000`; decision lambdas never receive `l60`; only write in the file is the perturbation harness on a copy (`:84`).
- **Caveat 1.** `t60_exact: true` is still a hardcoded literal (`:82`); it is correct, but only my independent check backs it.
- **Caveat 2.** The perturbation test remains vacuous for `deriv_vote2` (it reads the cached `vecs` on both calls), so 200/200 genuinely covers 18/20 candidates; and **the freeze hash is blind to adapter code changes** — `{id,repo,commit,params}` + hardcoded `adapterVersion: "tc-1.0.0"` were unchanged despite formula changes, so round-1 and round-2 result files cannot be distinguished from freeze metadata alone (only `deriv_psar`'s params changed, because a new `regra_fonte` key was added). Round 2 changes should have bumped an implementation version (e.g. `tc-1.0.1`) or included a code hash.

---

## Check 5 — SCOPE / HONESTY — PASS with flags

- **24 cloned repos; 20 candidates from exactly 2.** Benchmarked: `binary_options_bot` (rule catalog only) and `SuperThree` (Pine hand-ported). **22 repos unbenchmarked**, by category:
  - *No runtime for trained/ML artifacts:* `WinstonAI` (32 `*.pth`), `IQOPTION-ML-TRADER` (`IQOption_model.h5`), `Binary-bot` (3 `*.joblib`), `iqoption_bot` (LSTM), `BinaryOptions_DeepLearning` (7 notebooks), `RL-FX-Trading` (12 notebooks), `Transformer-Trader` (3 notebooks), `forex-ai-trader` (4 `*.pkl` + scripts), `BOTAI` (LSTM dir), `IQ_Options_Binary_Bot` (models + `training.py`), `Forex-ML` (README-only transformer description).
  - *No MQL5/MetaTrader runtime:* `cortex5-ai-trading` (5 `.mq5`), `GGTH-Forex-Predictor` (4 `.mq5`). (`binary_options_bot`'s own `MT5_Signal_EA.mq5`/`Indicator.mq5` and `models/*.keras` also unbenchmarked.)
  - *LLM/agent systems (API-dependent, non-deterministic):* `FinGPT`, `TradingAgents`, `vibe-trading`, `AgentFxTrading`, `forex-ai-agent`.
  - *No single deterministic binary-options rule extractable / other assets:* `deterministic-trading-engine` (OKX crypto engine, 518 py), `KJStockScreener` (stocks), `TodoQuant`, `forex-stgfx` (README-only).
- **Hardcoded asset-specific constants:** none of the 20 candidates contains price-level-zone logic. The one source strategy with hardcoded zones — `harmonic_rsi_divergence` (`:446-450`, bear 311.70-312.30, bull 311.00-311.70) — was **correctly excluded**; `squeeze_momentum_breakout` and `multi_confirm` also excluded. Scanner: no decimal literals in params; adapter file contains no "harmonic"/311./312. strings. **No flags on this item.**
- **Residual flags in included candidates (new quantification on the post-fix indicator basis):**
  1. `deriv_psar` — broken (Check 1.iv / 3): must be re-fixed or removed; currently also poisons `deriv_vote2`.
  2. `deriv_stoch_rsi_reversal` — ADX gate still `< 20` while source `:55` is `< 25`: **980 vs 858 signals, 124 deviating bars** (WR 52.45 → 52.68 source-style). Params `{adx_filter:true}` still doesn't record the 20.
  3. `deriv_vote2` — still 12-of-20 members (`strategy.py` enumerates all 20 `RULE_BASED_STRATEGIES`, `min_agree=2`; `backtest_voting.py` uses 3); 95.5% of bars give a signal; the psar member is dead.
  4. `superthree_ctm` — warm-up of `count/gapSum` still starts at `i=10` and treats the warm-up entry as a direction change (`prevDir=0`), while Pine accumulates from bar 0 with `na` propagation until the first flip; now emits 1 BINARY signal (0/1), 0 OTC — essentially unexercised, still not threshold-comparable.

---

## Remaining approximations table (formula-level)

| # | Candidate(s) | Source formula | Shipped formula | Status / measured impact (BINARY) |
|---|---|---|---|---|
| 1 | `deriv_sma_rsi`, combos | RSI: `ewm(alpha=1/14, adjust=False)`, no SMA seed | Wilder RSI **with** SMA(14) seed (`:19`) | Remains; 4357 bar-level numeric diffs, **0 decision diffs**; 492/263/229 exact |
| 2 | `deriv_macd_cross`, `_combo`, `ema_cross_adx` (open EMA) | EMA seeded from first value (`ewm adjust=False`) | EMA seeded SMA(p) at bar p-1 (`:18`) | Remains; round-1 measured 33 decision diffs (macd_cross); code unchanged |
| 3 | ADX family (`adx_trend`, `trend_follow`, `ema_cross_adx`) | pandas-ta `ADX_14` = RMA of TR/DM then RMA of DX | same class, seed = 13 TR/DM bars `j=2..14`, DX-RMA from first DX (`:32`) | **FIXED to Wilder**; adapter-convention recompute = 0.0; pure-14-seed variant within 2% on 7137/7171 bars (seed nuance only) |
| 4 | `deriv_atr_breakout`, SuperThree-KC | `ATRr_14` = RMA(TR,14) (pandas-ta tr[0]=H-L) | RMA(TR,14) seeded `TR[1..14]` (`:28-30`) | **FIXED to RMA**; residual: one-bar seed shift / tr[0] convention |
| 5 | `deriv_stoch_rsi`, `_reversal` | `STOCHk_14_3_3` = SMA3 of raw %K(14) | SMA3 of raw %K (`:25-26`) | **FIXED**; exact (0/7186 mismatches) |
| 6 | `deriv_stoch_rsi_reversal` | ADX filter `< 25` (`:55`) | ADX filter `< 20` (`:63`) | Remains; 980 vs 858 signals, 124 diffs, WR 52.45 vs 52.68 |
| 7 | `deriv_psar` | PSARl long-state only; NaN → None (`:361-372`) | guard written but **`psarUp` not exported** (`:39`) → 0 signals | **BROKEN**; intended guard ≈3535 / 52.81%; also degrades `deriv_vote2` (445 bars) |
| 8 | `superthree_trend` | Pine `ta.atr(10)` + Quick bands + gates (pine 24-71) | rma10 + Quick + `stDir[i]===stDir[i-1]` gates (`:38`) | **FIXED**; independent rebuild 0 mismatches; ratchet rows match pine 31-35; row == round-1 Pine-faithful (3272 / 48.47%) |
| 9 | `superthree_ctm` | Pine 74-90, `count/gapSum` from bar 0, `na` propagation | starts `i=10`; warm-up treated as flip (`:38`) | Remains; 1 (0/1) BINARY signal, 0 OTC — effectively unexercised |
| 10 | `deriv_vote2` | all-20 ensemble, `min_agree=2` (+ separate `MIN_AGREEMENT=3` runner) | 12-of-20 members, min 2, dead psar member (`:67`) | Remains; 6877/7201 (95.5%) signals |
| 11 | `deriv_candle_reversal` | TA-Lib `cdl_pattern` == ±100 | simplified engulfing/hammer/shooting-star (`:41`) | Remains; approximate by design |
| 12 | `deriv_breakout20` | `len<look+1 → None`; window t-20..t-1 | same window; `i<21` guard defers bar 20 (`:54`) | Remains; round-1 measured 0 impact |
| 13 | `deriv_macd_cross` equality edge | equality → None | equality → -1 (`:48`) | Remains; 0 occurrences on this data |
| 14 | Harness | — | `t60_exact` hardcoded; vote2 perturb sample vacuous; 60 s overlapping windows; one asset/window; no multiple-testing correction | Remains; independent t60 check passes (innerMissing=0, u=12 tail) |

---

## Limits of this review

- No Python/pandas-ta runtime: pandas-ta semantics were verified from the **actual wheel source** (0.4.71b0, downloaded) plus the published 0.3.14b0-era `psar.py` reproduction; nothing was executed in pandas-ta. All adapter-side numbers were executed here (exact reproductions of the published rows).
- OTC was covered by the same full re-run (0 field diffs) and the psar/vote/ctm audits, but no hand-recompute of OTC indicator rows was done beyond that.
- The previous critic's report and mine share the same local candle dump provenance; identity with live Supabase was re-proven today (0 diffs).
- `deriv_psar`'s "intended" 3535/52.81% is an adapter-state-machine counterfactual, not pandas_ta-executed; treat it as directional, not exact.

## Verdict

Round 2 is a **substantive improvement**: SuperThree is now genuinely Pine-faithful (verified by independent rebuild, ratchet spot-sim and gate counterfactual), the ADX/STOCH/ATR families moved into the correct formula class, `deriv_sma_rsi` is stable, and the harness remains causal, leak-free and bit-reproducible (my end-to-end re-run matched all 40 published rows and re-derived hashes/causality). **But the `deriv_psar` fix is non-functional** — a missing `psarUp` export makes the candidate empty in both markets and silently edits the `deriv_vote2` ensemble. As an *initial shadow benchmark*, the second-round table is defensible only with these explicit caveats: exclude/repair `deriv_psar`, re-label `stoch_rsi_reversal` (ADX 20 vs 25), `vote2` (12-of-20, 95.5% signal rate), `superthree_ctm` (warm-up), and cite every number with the adapter qualifier — and note the freeze metadata cannot distinguish round-1 from round-2 code.
