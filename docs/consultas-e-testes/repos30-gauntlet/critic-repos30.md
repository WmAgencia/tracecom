# Critic — "30 repositories" shadow benchmark (`repos30-bench`)

Date: 2026-09-16. Role: independent critic. Only this file was added under `iqopt\`; all verifier scripts/raw outputs live in `..\critic-repos30\` (`verify-repos30.cjs`, `verify-out.json`, `data-integrity.cjs`, `data-integrity.json`, `freq-overlap.cjs`, `freq-overlap.json`, `cred-check.ps1`, `scan-db.cjs`).

**Artifacts audited:** `iqopt\repos30-bench.cjs`, `iqopt\repos30-bench\config-freeze.json`, `iqopt\repos30-bench\benchmark-results.json`, indicators `iqopt\bench-lib.cjs`, loader `iqopt\mh-lib.cjs`; sources in `repos30\qu1|qu2|po1|po2|pine_v6|quant-trading`.

**Access & integrity preliminaries (all verified):**
- Token: Windows Credential Manager target `Supabase CLI:supabase` blob (UTF-8, 44 chars `sbp_…`) hash-matches `iqopt\.sbp` exactly (`cred-check.ps1`; value never printed). Read-only SQL used.
- Datasets `IQOPTION_EURUSD_BINARY_10H` / `OTC_10H`: 7201 candles each, **all 7200 inter-bucket deltas = 5000 ms** (no gaps/dups), span 10.001 h, T+60 bucket exists for 7189 bars (the 12 tail bars lack it, which drives the `u` counts). Labels are exact bucket `bucket+60000` close comparisons.
- Freeze↔results consistency: 10 candidates, 10 rows per market, 0 `hash` mismatches, timestamps 4 ms apart (freeze then run).
- Clone log (recovered from opencode session store) and on-disk `.git/config` agree: 27/30 repos cloned; commits for the 6 candidate repos match the freeze.

---

## CHECK 1 — AUDIT `po1_rsi35_65` (BINARY): **PASS**

Independent RSI14 (Wilder) from candles + exact `close(T+60)` labels (script `verify-repos30.cjs`, independent implementation; also bit-equal to `bench-lib` rsi14 and to the adapter's decision vector).

| metric | claimed (JSON + prompt) | recomputed | match |
|---|---|---|---|
| signals | 2034 | 2034 | ✅ |
| W/L/D/U | 1125/909/90/7 | 1125/909/90/7 | ✅ |
| WR | 55.31% | 55.31% | ✅ |
| CI95 (Wilson) | [53.14, 57.46] | [53.14, 57.46] | ✅ |
| expectancy / PnL | 0.0454 / +92.3u | 0.0454 / +92.3u | ✅ |
| long/short streaks | 26/40 | 26/40 | ✅ |

- Threshold probe: with `rsi>70` the result is **different** (1496 sig, 822/674/66, 54.95%, CI [52.42,57.45]) — the table unambiguously used `>65`, matching the frozen adapter and po1 code defaults. No mismatch.
- OTC row also exact: 1539 sig, 767/772/14/6, 49.84%, CI [47.34,52.33].
- **Fidelity defect (see Check 3): the shipped po1 code is NOT Wilder.** `services\new_signal.py:compute_rsi` is a simple mean of the last 14 diffs (Cutler-style), and `detect_signal()` gates RSI with levels/price-action confluence. With Cutler RSI the same rule yields **3216 sig / 52.24%** on BINARY. The README claims Wilder while the code does SMA — the adapter followed the README.

## CHECK 2 — AUDIT `qu1_rsi_cross` (BINARY, +OTC): **PASS**

Recomputed as `prev<=30 && cur>30 → +1 (CALL)`, `prev>=70 && cur<70 → -1 (PUT)` with Wilder RSI.

| market | claimed | recomputed | match |
|---|---|---|---|
| BINARY | 236 sig, 132/104/8/0, 55.93%, CI [49.55,62.12] | identical | ✅ |
| OTC | 191 sig, 103/88/0/0, 53.93%, CI [46.85,60.85] | identical | ✅ |

Caveat: source `rsi.py` uses pandas `ewm(alpha=1/14, adjust=False, min_periods=14)` (Wilder-recursive but seeded at the first diff, not SMA). Adapter uses Wilder/SMA seed. Decision impact measured: **BINARY 0 diffs; OTC 2 diffs** (i=21: EWM emits CALL, Wilder doesn't; i=49: Wilder emits PUT, EWM doesn't — early warm-up bars). OTC with source-exact EWM: 191 sig but 104/87, **54.45%**, CI [47.37,61.36].

## CHECK 3 — FIDELITY vs SOURCES

| candidate | verdict | evidence |
|---|---|---|
| `qu1_revert3` | **PASS** | Source `revert.py` (`all(d>0)→PUT`, `all(d<0)→CALL`, doji→NONE). Adapter returns 0 if any of the 3 candles is a doji. Decision vectors identical on 7201 bars (0 diffs); 3834 doji windows, all correctly blocked. Latent warm-up off-by-one (source allows i=3, adapter i≥4) — no signal at i=3 in data, 0 impact. |
| `qu1_rsi_cross` | **PASS (logic)** | Exit-cross semantics verified: source `prev<=low<curr` / `prev>=high>curr` = adapter `prev<=30&&cur>30` / `prev>=70&&cur<70`. RSI-kernel caveat as in Check 2. Label "EXATA" acceptable for logic, not for the RSI kernel. |
| `qu1_sma_cross` | **PASS** | Source `prev_diff<=0<curr_diff` etc. = adapter. 0 decision diffs. Latent off-by-one (adapter `i<21` vs source `len>=21`, i.e. i≥20) — no crossover at i=20 in data, 0 impact. |
| `qu2_triple_confluence` | **PASS (rule)** | Rule matches README/code (RSI<25 & MACD bull cross & close≤BBL; mirrored SELL). 0 signals reproduced on both markets (5 s stream; original TF 5 min). One JS boundary nit: at the first signal-line bar (i=33) `null<=null` is true in JS (source pandas-NaN comparison would be false); 1 bar, no decision effect (0 signals). |
| `pine_v6_st_macd_rsi_adx` | **PASS (params + decisions)** | `script.txt`: ST(10,3), RSI14 >50/<50, MACD(12,26,9) crossover, ADX(14,14)>20 — adapter/freeze params match. `stDir<0 ⟺ close>superTrend` verified exactly with a patched bench-lib (0/7201 mismatches, 3922 buy-true bars). Claimed BINARY row recomputed exactly: 148 sig, 75/73/9, 50.68%, CI [42.71,58.61]. Note: bench-lib ADX seed is non-standard (sums TR/DM j=2..14 /13 instead of 14/14; no 14-DX SMA seed) — 218 bars differ in value and 12 bars flip the `>20` mask, but **0 decision changes** for this candidate. |
| `po1_rsi35_65` | **FAIL (label overstated)** | "EXATA (README+defaults codigo)" is not accurate: (a) code RSI is Cutler, not Wilder; (b) the real signal needs multi-factor confluence (`MIN_FACTORS_STRONG_SIGNAL=1`, levels + price action + RSI with cross-cancellation). Adapter = RSI leg only. Cutler re-run: 3216 sig / 52.24% (vs 2034 / 55.31%). The frozen numbers are reproducible, but they are a README-speculation backtest, not the repo strategy. |
| `po2_ema_rsi` | **FAIL (mismatch; label APROXIMADA already)** | Source defaults: EMA 20/50, buy RSI≥52 / sell ≤48, momentum confirm, trend-streak ≥2, neutral band ±1.5, chop filter min_range_pct=0.05 (MT5 EA and `config.py` agree). Adapter frozen params are **EMA 9/21 + RSI50 crossover with no filters** — not traceable to the repo, and po2 README only says "EMA+RSI". Source-faithful re-run (300-close live window): **10 decisions (5/5) vs 313 adapter**; chop filter blocks 7182/7201 bars, streak-flip 6, neutral 1, etc. Frozen row (313 sig, 47.28%) is far from source behavior. |
| `qt_dual_thrust` | **documented approximation, PASS as labeled** | Source file uses `rg=5` (line 218) and `range=max(HH−LC, HC−LL)` with rolling closes, level-breach entries from 03:00; adapter uses `N=4`, `max(HH−prevC, prevC−LL)` and close-cross entries on 5 s bars. Frozen label "APROXIMADA (formula canonica; N=4)" — mismatch exists but is disclosed. |

## CHECK 4 — CAUSALITY / TESTS: **PASS**

- Static frontier scan of the 10 `add(...)` adapters: no future index (`I[k]`/`C[i+k]`/`slice(i+k)` with k>0). Only "hit" is `po2_ema_rsi`'s `slice(0, i + 1)` — backward-only by construction; source per-row EMA is `closes[0..i]` (and `…len-1` for the previous EMA), confirmed in `repos30-bench.cjs:26`.
- Independent future-perturbation (5 seeded random `i` = 4479, 4068, 4361, 5917, 6798; mutate `close/high/low ×1.01` on `[i+30, i+60]`, rebuild via `bench-lib`, compare decision at `i`): **0 changes for both `po1_rsi35_65` and `pine_v6_st_macd_rsi_adx`**. Stricter variant (mutate `[i+1, i+60]`): **0 changes** as well. This agrees with the run's own `perturb: "0/100"`.
- Label `l60` is computed outside the adapter lambdas and never passed to them (source read).

## CHECK 5 — HONESTY / DRIFT: **PASS (honest) — but the positive results are fragile**

- **No candidate reaches 70%.** Best point estimate anywhere: `qu1_rsi_cross` BINARY 55.93% (n=236, CI [49.55,62.12]). All 20 rows ≤ 55.93%.
- Up-drift control (60 s horizon, unconditional): BINARY **53.00%** up (3654↑/3240↓/295=, 12 missing) vs OTC **49.01%** up.

| row | overall | buys | buyWR | sells | sellWR |
|---|---|---|---|---|---|
| po1 BINARY | 55.31% (n=2034) | 984 (48.4%) | **56.81%** | 1050 | 53.90% |
| po1 OTC | 49.84% (n=1539) | 814 | 47.54% | 725 | 52.41% |
| qu1 BINARY | 55.93% (n=236) | 118 | 57.63% | 118 | 54.24% |
| qu1 OTC | 53.93% (n=191) | 96 | 55.21% | 95 | 52.63% |

- po1's BINARY "edge" tracks the up-drift: +2.3 pp over always-CALL (53.0%), and its CALL leg is only +3.8 pp over that baseline; with a neutral market (OTC, 49% up) the same rule returns 49.84% (negative after payout).
- Same-sign caveat for qu1: BINARY CI [49.55,62.12] includes breakeven; OTC is positive but n=191/CI [46.85,60.85].
- **Overlap/frequency caveat (strongest):** po1 fires ~203 signals/h at 5 s granularity (2131 non-zero decision bars), so each 60 s outcome is re-counted up to 12× and the Wilson CI in the table assumes independence. De-overlapped (≥60 s between kept signals): po1 BINARY **52.63% (n=323, CI [47.19,58.01])**; ≥300 s: **46.39% (n=97)**. qu1 BINARY de-overlapped: 52.8% (n=161) / 52.5% (n=80). The apparent po1 edge over the 52.91% breakeven does not survive de-overlapping.

## CHECK 6 — SCOPE / COVERAGE: **PASS**

30 URLs attempted; **27 cloned** (verified on disk with `.git/config` + clone log commits). **3 clone failures confirmed simultaneously in the session clone log (`FAIL`, directories absent) and by today's 404s:**
1. `ea31337` — https://github.com/EA31337/EA31337-classic → 404
2. `ping89` — https://github.com/Ping89/MT5EA-Forex-Trading → 404
3. `pandasta` — https://github.com/twopirllc/pandas-ta → 404 (moved to `freqtrade/pandas-ta`)

**24 repos produced no candidate** (only 6 repos → 10 candidates):
- **Frameworks (9):** backtrader, bt_fw (bt), btpy (backtesting.py), vectorbt, pybroker, lean, nautilus, jesse, jesse_ex — engine/example code, no portable deterministic 60 s binary rule (Lean/Nautilus polyglot, Jesse spot semantics).
- **Libraries (4):** talib, ft_tech, iqnode (IQ Option API client), yfinance — no strategy logic.
- **ML/RL (3):** finrl, qlib, ml4t — require training/data pipelines; no rule without a trained model/artifact.
- **License-restricted (2):** freqtrade, ft_strats — GPL-3.0 (verified in LICENSE); strategies also framework-bound.
- **Fake data (1):** qu3 (`main.py:62,65,124` prices from `random.uniform/gauss`) — simulated feed, nothing real to trade.
- **Non-binary/other (2):** vol-trading (equity options/vol), steve_fx (equity vector backtesters via yfinance, daily).
- **Clone failures (3):** ea31337, ping89, pandasta (above).

---

## Verdict summary

| check | verdict |
|---|---|
| 1 po1 BINARY recompute | **PASS** (exact; >70-variant shown to be rejected) |
| 2 qu1_rsi_cross recompute | **PASS** (exact BINARY and OTC) |
| 3 fidelity | PASS: revert3, rsi-cross logic, sma-cross, qu2, pine_v6. **FAIL:** po1 label overstated (Cutler/multi-factor), po2 params+logic mismatch (10 vs 313 decisions). qt approximation disclosed. |
| 4 causality | **PASS** (0 changes in independent perturbation, both regimes) |
| 5 honesty/drift | **PASS for honesty** (no ≥70%); results fragile under drift + 5 s overlap |
| 6 scope | **PASS** (3 clone failures confirmed; 24 non-candidates categorized) |

**Reproduction:** `& 'C:\Program Files\Mover\nodejs\node.exe' ...\critic-repos30\verify-repos30.cjs` (→ `verify-out.json`), `...\data-integrity.cjs`, `...\freq-overlap.cjs`; token check `powershell -File ...\cred-check.ps1`. The WR/W/L table of the frozen repos30 round is **byte-for-byte reproducible** for the audited rows (po1, qu1 both markets, pine); qu2's zero-signal rows trivially reproduce.
