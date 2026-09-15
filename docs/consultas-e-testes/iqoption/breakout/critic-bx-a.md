# CRITIC 1+2+3 (independent) — BX breakout research falsification attempt

Date: 2026-09-15 (UTC) · Critic: opencode (deepseek-v4.1-flash) · Role: adversarial verifier (causality / geometry / settlement / freeze ordering / hashes)
Artifacts inspected (read-only): `bx-lib.cjs`, `bx-run.cjs`, `bx-prosp.cjs`, `bx-freeze.json`, `bx-discovery-results.json`, `bx-finalists-freeze.json`, `bx-prospective-results.json`, `raw-prosp/`, `combined_binary_1.json`, `combined_otc_76.json`, `run-all.cjs`.
Data: Supabase `iqopt_candles_5s` (read-only) — BINARY_10H = 7201 candles, OTC_10H = 7201 candles (07:01:15Z→17:01:15Z, no gaps); tickAgg rebuilt from the combined files exactly as `bx-run.cjs:15`.

**Ref note:** the correct project ref is `cladmauwmuoeqongxzwb` (verified char-by-char from `critic-sql.cjs`: codes 99,108,97,100,109,97,117,119,109,117,**111,101,113,111**,110,103,120,122,119,98). The ref printed in the task URL (`...oeong...`) is missing the `q` and returns 404; scripts/queries only work against the `oeqong` ref.

## Check 1 — CAUSALITY of bxFeaturesAt: **PASS**

Script: `bx-critic-a.cjs` (seed 0xBEEF01). Method: DB candles (7201) + tickAgg from `combined_binary_1.json` (same construction as bx-run.cjs:15).

- Truncation, 25/25 identical: `JSON.stringify(bxFeaturesAt(cd,i,agg)) === bxFeaturesAt(cd.slice(0,i+1),i,agg)` for i ∈ {4751,4391,1801,2731,6799,3353,1279,2202,4937,2656,740,3150,597,4854,2976,759,4636,735,6340,1677,5298,2793,6190,3516,181} → 0 failures.
- Future perturbation, 5/5 identical: mutate `candles[i+20].close *= 1.01` (i ∈ {4552,3820,3782,6106,3922}), features at i unchanged → 0 failures.
- Code audit confirms no access beyond index i (max index used: `highs[j+2]` with j ≤ i−2 → highs[i]; Donchian/retest slices end at i).

## Check 2 — GEOMETRY (brkN24up, tlUpBreak): **PASS**

Full feature scan (i = 40…7200) on BINARY candles: brkN24up fires 398×, tlUpBreak 1768×. Seeded 5+5 sample, independently recomputed:

- brkN24up (5/5): hh = max(high[i−24..i−1]) recomputed; close[i] > hh in all cases. Samples: i=3828 (hh=1.153925, close=1.153930), i=6754 (1.154065/1.154075), i=2602 (1.153985/1.153995), i=7032 (1.154125/1.154155), i=7108 (1.154165/1.154195).
- tlUpBreak (5/5): independent fractal-2 pivot scan (j=2..i−2, strict > over j±1, j±2), OLS on last ≤12 pivot highs. All: slope<0, close[i] > lineAt(i), fires independently. Max pivot index used ≤ i−2 in every sample (e.g. i=5168: maxPivot=5166=i−2). Sample slopes/lines: i=1445 slope=−3.504e−7 line=1.153428 close=1.153435; i=3440 slope=−1.110e−6 line=1.154081 close=1.154180; i=5586 slope=−1.257e−6 line=1.154217 close=1.154440; i=5168 slope=−1.789e−6 line=1.154729 close=1.154770; i=3780 slope=−1.206e−6 line=1.153929 close=1.154020.
- No pivot with index > i−2 was used, by construction and by assertion.

## Check 3 — SETTLEMENT (tlbrk_0.7, OTC_10H): **PASS**

Script: `bx-critic-a2.cjs`. Rows rebuilt exactly as bx-run.cjs:47-50 using GitHub `run-all.cjs` (`buildRows`), **identical to local** (sha256 d3f3a0ef…f86, both 14636 B).

- Metrics replication, exact match vs frozen discovery (bx-finalists-freeze, OTC tlbrk_0.7): signals 982/982, w 526/526, l 431/431, draws 25/25, unknown 0/0, wr 54.96/54.96, indepN 52/52, indepW 30/30, indepL 22/22.
- 10/10 sampled signals: entry = close[T] (true in all), settle candle found via bucket map at T+60000, **index distance = 12 buckets in all 10**, l60 recomputed = row l60 in all 10 (incl. losses; e.g. bucket 08:16:10 entry 1.153645 → 08:17:10 close 1.153365, l60=−1; bucket 13:47:40 entry 1.151945 → l60=−1).
- UNKNOWN handling: synthetic rows (l60=[1,1,0,null,1], v=[1,−1,1,−1,1]) → signals 5, w 2, l 1, draws 1, unknown 1, wr 66.67; unknown excluded from W/L (w+l=3=non-null decrements), accounting w+l+draws+unknown = signals. Real data: fb_0.25 OTC_10H rebuild matches frozen exactly (u=4, 817/656/14/4, wr 55.47) with accounting intact.
- Exhaustive invariant scan (all 92×2 discovery strategies + all prospective strategies/baselines/finalists): `w+l+draws+unknown === signals`, `buyN+sellN === signals`, `wr === w/(w+l)` — 0 violations.
- **Self-audit (disclosed):** first settlement pass used naive mapping `candleIdx = 30 + rowIdx` and produced 10/10 false mismatches; root cause was the critic script — bx-run skips rows when `bxFeaturesAt` returns null (57 skipped candles in OTC_10H: 7171 base rows → 7114 bx rows), so row index ≠ candle index − 30. Corrected run (candle index tracked at push time) passes 10/10 while the pipeline numbers reproduce exactly. No pipeline counterexample.

## Check 4 — FREEZE ORDERING: **PASS**

- Code order, `bx-run.cjs`: freeze write line **38** < first `compileBx` line **62** < first `BX.metrics` line **63** < results write line **81**. `bx-prosp.cjs`: finalists freeze write line **27** < first `compileBx`/`BX.metrics` line **53** < results write line **69**.
- Timestamps: `bx-freeze.generated_at` 2026-09-15T23:22:39.293Z < `bx-discovery-results.generated_at` 23:22:39.297Z (note: discovery `generated_at` is set at the start of the evaluation block, immediately after the freeze write; the actual evaluation ran afterwards). `bx-finalists-freeze.frozen_at` 23:23:33.196Z < `bx-prospective-results.generated_at` 23:23:33.329Z.
- Prospective isolation: `window.from` = 17:01:18.758Z > discovery window end 17:01:18.757Z. Actual discovery last ticks: BINARY 17:01:18.000Z, OTC 17:01:18.502Z (< DISC_END). Independent recomputation from `raw-prosp/` pages: first prospective tick 17:01:19.000Z, last 22:48:33.000Z in both datasets → **zero tick overlap** (the open bucket 17:01:15Z exists in both datasets but its tick sets are disjoint; first prospective row uses candle index 30 → 17:04:45Z).
- Raw-data provenance: md5 recomputed from raw pages matches published: BINARY 86cee95ff158f0146dc8b34c50654483 (39 631 ticks), OTC 191bbc193b597d95a5716f0706f6e3a9 (81 978 ticks). First raw page fetched at 23:23:34.373Z (BINARY) and 23:24:36.460Z (OTC), i.e. **after** `frozen_at` 23:23:33.196Z.
- Frozen K: 92 hypotheses, matching `freeze_K`=92 in discovery results.

## Check 5 — HASHES after fix: **PASS**

Recomputed `sha256(JSON.stringify(spec)).slice(0,16)` for the 6 finalists; matches both the file hash and the pre-registered `bx-freeze.json` hash, and the expected values:

| dataset | id | recomputed | expected |
|---|---|---|---|
| BINARY_10H | gate_fbDn_rsi | a5682c6fe68c1a1c | — |
| BINARY_10H | tlbrk_0.7 | 312eb7290c9cc5ae | 312eb7290c9cc5ae ✔ |
| BINARY_10H | tlbrk_0.5 | d1a784eeb3573493 | d1a784eeb3573493 ✔ |
| OTC_10H | fb_0.25 | 30b478b8573c5443 | — |
| OTC_10H | tlbrk_0.5 | d1a784eeb3573493 | d1a784eeb3573493 ✔ |
| OTC_10H | tlbrk_0.7 | 312eb7290c9cc5ae | 312eb7290c9cc5ae ✔ |

`bx-fix-hashes.cjs` rewrote results files post-run (hash-patch, mtime ~23:26Z); its own validation reported 0 mismatches vs freeze, and this independent recomputation confirms the patched hashes are the true `sha16(spec)` values.

## Counterexamples found

**None.** The only discrepancies encountered were artifacts of the critic's own first-pass row↔candle indexing (Check 3, disclosed above), not violations of the researched pipeline.

## Residual observations (not failures)

1. Discovery `generated_at` is a start-of-block timestamp (set 4 ms after the freeze write), not a completion timestamp; freeze-before-evaluation still holds by code order and by subsequent data timestamps (raw fetch at 23:23:34Z+).
2. `bx-lib.clusterLevels` feeds pivot *closes* (not highs/lows) as level prices (`bx-lib.cjs:69`); this affects `distRes/distSup/resTouches` semantics but not the audited causality, brkN24/tlUpBreak geometry or settlement.
3. Check-3 metric replication is conditional on `run-all.cjs` staying byte-identical to the version used at discovery time (verified today: GH == local).
4. Out of scope of this review: economic edge/EV, payout, multiple-testing power beyond the frozen BH-FDR, OTC-vs-binary market semantics.

## Verdict

| # | Check | Result |
|---|---|---|
| 1 | Causality bxFeaturesAt | **PASS** |
| 2 | Breakout geometry (brkN24up / tlUpBreak) | **PASS** |
| 3 | Settlement + UNKNOWN accounting | **PASS** |
| 4 | Freeze ordering / prospective isolation | **PASS** |
| 5 | Finalist hashes | **PASS** |

Reproduction scripts (outside the artifact dir): `C:\Users\junin\AppData\Local\Temp\opencode\bx-critic-a.cjs` (checks 1,2,4,5 + first-pass 3), `bx-critic-a2.cjs` (corrected check 3 + line numbers), reports `bx-critic-a-report.json`, `bx-critic-a2-report.json`.
