# Independent Adversarial Critique — IQ Option External Validation

Critic: independent adversarial verification run 2026-09-15 ~17:30–17:35 UTC (14:30–14:35 local) with Node v24, using extracted copies of `run-all.cjs` functions (no re-execution of its fetcher; no experiment files modified). All evidence recomputed from the actual files.

(a) MISSING FILES: none at read time, none at end of analysis (all 8 declared artifacts + 70 raw pages present).
(b) ENVIRONMENT STABILITY: stable, no wipe. File snapshot (names/sizes/mtimes) identical before and after the verification run. Extra file present not in the declared set: `iqopt-pipeline.cjs` (13,041 B, mtime = manifest mtime, 30 s before run-all.cjs).

## Check results

### 1) PROVENANCE — PASS (with caveats)
- All 70 raw pages (30 binary + 40 OTC): `source_url` = `https://api.iqoption.com/v3/quotes?active_id=1|76&from=...&to=...&only_round=false&_key=<time-bucket>`; `_key` is a 300-s time bucket, not a credential.
- 246,111 quotes: 0 missing fields (`ts,n,bid,ask,value,phase,round` — plus `volume`), `value == (bid+ask)/2` (max err 2.2e-16), `bid <= ask` always.
- `run-all.cjs` sends only `User-Agent` + `Accept`; no cookie/token/authorization. The literal `credentials:"omit"` is NOT present (word "credentials" appears only in a header comment, run-all.cjs:4); however Node fetch defaults to `credentials:"same-origin"`, so cross-origin requests carry no credentials. Behavior is credential-free; the literal string claim is inaccurate.
- Live probe without auth at the experiment's own 35-min lag: **HTTP 200, 3600 quotes, same schema** (ts,n,bid,ask,value,volume,phase,round). A fresher `to` is rejected: HTTP 422 `{"to":["'to' is greater than (current time - backoff)"]}` — the API itself enforces the lag, explaining the window ending 35 min before generation.
- "Used by public iqoption.com/quotes page per the site's own JS bundle": NOT independently verified — quotes page returns HTTP 200 but its initial JS bundles do not contain `api.iqoption.com`/`v3/quotes` (SPA lazy chunks). Not falsified either; endpoint domain/schema/behavior are consistent with an official public gateway.

### 2) BINARY (active_id=1, not forex substitute) — PASS (with note)
- `IQOPTION_EURUSD_BINARY_10H`, active_id 1, `otc:false`, 105,004 ticks, values 1.15292–1.15519 (~EUR/USD 1.15), 100% `phase:"T"`.
- Spread histogram: 0 → 17.4%; (0.5–1.5)e-5 → 51.1%; (1.5–2.5)e-5 → 22.4%; (2.5–5.5)e-5 → 9.0%. Claim "≈1e-5–2e-5" holds for ~73.5% of ticks; the 17.4% zero-spread ticks are a deviation from the stated pattern (raw feed characteristic).
- No mixing: single endpoint, per-dataset fetch/array/file/entry (run-all.cjs:13, :106–109, results.datasets[0]).

### 3) OTC SEPARATE — PASS
- active_id 76, `otc:true`, own combined/out files; `results.json` has exactly 2 datasets: [0] BINARY active 1 otc:false, [1] OTC active 76 otc:true; no combined metric anywhere.
- Note: OTC raw payload includes 301 non-"T" ticks (300 phase "C", 1 "P", ~0.2%, all value 1.180415); binary is 100% "T". They are carried into candles but did not affect candle integrity (check 5).

### 4) TIMESTAMPS — PASS
- Globally monotonic non-decreasing (duplicate ts: 357 binary / 161 OTC with distinct n — allowed).
- Binary: 06:53:34Z → 16:53:33Z = 9.9997 h, median Δ 167 ms (p10 13 ms, p90 1000 ms). OTC: 9.9999 h, median Δ 211 ms.
- Window exactly 10.0000 h, ends 35.00 min before `generated_at` (17:28:33.556Z); age at analysis ≈40 min (≪ 7 days).
- `md5_ts_bid_ask` recomputed == stored (binary `489525ae...`, OTC `acd2b205...`).

### 5) CANDLES 5s — PASS
- Independent reimplementation vs `buildCandles` extracted from run-all.cjs: full datasets (7,201 candles each) **0 mismatches**; random 30-min slices (binary 09:47:25Z, OTC 11:01:15Z): 360/360 buckets identical, max abs error 0 (< 1e-12), open/high/low/close/n exact. 10 sample buckets per dataset all exact.

### 6) T+60 SETTLEMENT — PASS
- 10 random rows where a finalist fired (1,819 candidate rows): `t0 == bucket_i + 5000` ✓, settlement bucket == `bucket_i + 60000` == `candles[i+12]` ✓, independently recomputed `l60 == stored l60` 10/10, and BUY win iff settle_close > entry_close / SELL iff < (verified per sample, e.g. row 505 dir −1, ex 1.153745 < entry → WIN; row 2795 dir −1, ex > entry → LOSS).

### 7) NO LEAKAGE — **FAIL (decisive)**
- Truncation test (featuresAt on `candles[0..i]` vs stored full array): all 5/5 sampled rows differ. Changed features: `distSma20, macdHist, bbB, expansion, distPH, distPL, pos, upSwing, inZone, boUp, boDown, bigCandle`.
- Root cause: slices anchored to the start index `m` or to the array end, computed on the FULL candle array passed at run-all.cjs:79 (`featuresAt(candles, i)`):
  - :44 `atr14 = mean(cd.slice(m - 14)...)` → elements from i−13 to dataset end
  - :45 `sma20 = mean(closes.slice(-20))` → last 20 of whole dataset
  - :46 `ema(closes,12)`, `ema(closes,26)` → EMA to end of dataset (MACD)
  - :50 `sd(closes.slice(-20))` (bbB)
  - :53 `cd.slice(-4)` / `cd.slice(-20)` (expansion)
  - :54 `highs.slice(-25,-1)` (hh24 → boUp/boDown)
  - :63 `w24 = cd.slice(m - 24)` (inZone/upSwing/pos/fib)
  These should have been bounded at index i; as executed every row except the last uses future candles.
- Smoking gun: `expansion` is **constant = 0.9183673469462664 for all 7,171 binary rows** (end-anchored ratio), so `gate(struct_f|expansion>1.3)` yields **0 signals** on the BINARY holdout while the frozen manifest records 239 DISC signals (causal recompute: 526 signals, 45.78%).
- Impact on the two requested finalists (features made causal by truncation, settlement unchanged):
  - `and(fib_ctx,stoch_r_30)`: stored 366/142/208 = 40.57% → causal 493/251/218 = 53.52%; signal vectors differ on 727/7,171 rows.
  - `and(struct_f,macd_r)`: stored 1,422/613/753 = 44.88% → causal 1,473/713/704 = 50.32%; differ on 1,471/7,171 rows (20.5%).
  - `gate(struct_f|bullDiv)` is identical stored vs causal (312/130/170, 43.33%) — its inputs are causal, cross-validating the diagnosis.
- Conclusion: the claim "computes the SAME causal features as the Gauntlet" is falsified; the reported holdout numbers are not computable at signal time in a live setting.

### 8) STRATEGIES FROZEN — PASS
- sha256(local `gauntlet-compile.cjs`) == GitHub main = `e4babe79d37918092efb0b1ea2e95bcc508c6de0c849f06e804bc9e27af63b7a`; manifest == GitHub main = `f760bb83db047b1b67858574fb1a8437512118cbe90599090a11d2a711f1614b`.
- Recomputed manifest hash == field == `2a49fb3e2b80ee87331fb2edf318d0d2` == `frozen_hash` in results.
- `compile()` does not mutate specs (4/4 unchanged); results' embedded specs byte-identical to manifest; run-all passes `e.spec` directly (run-all.cjs:118).
- Caveat: on-disk manifest mtime is 30 s before run-all.cjs and run-all never writes it (writes only the compile script) — likely placed by setup (`iqopt-pipeline.cjs`). No integrity impact: byte-identical to GitHub main and hash matches. The "fetched at runtime" claim cannot be proven from disk for the manifest, only for the compile script.

### 9) WIN/LOSS RECOMPUTATION — PASS
- From-scratch rebuild (extracted `buildCandles`/`buildRows`/`stats` + compiled frozen specs):
  - `and(struct_f,macd_r)`: signals 1,422, w 613, l 753, draws 56, unknown 0, WR **44.88%** (user-round 44.9%) — exact match; indep 80/48.75% match.
  - `and(fib_ctx,stoch_r_30)`: signals 366, w 142, l 208, draws 15, unknown 1, WR **40.57%** (40.6%) — exact match; indep 18/44.44% match.
- All bookkeeping (rows 7,171; md5; OTC separation) matches.

## Overall verdict

**8 PASS / 1 FAIL → overall integrity: FAIL** as an external validation of tradeable, causal strategy performance. Provenance is real and public, data/candles/settlement reproduce bit-exactly, and the frozen artifacts are authentic and untouched. But Check 7 fails decisively: the pipeline computes features with look-ahead over the full 10-h window, so the reported holdout win rates (44.88% / 40.57%) are not causally achievable and the "same causal features as the Gauntlet" claim is false.

Strongest counterexample: `expansion` constant at 0.9183673469462664 for every one of 7,171 rows → `gate(struct_f|expansion>1.3)` = 0 external signals vs 239 DISC signals in the frozen manifest and 526 when recomputed causally. Secondary caveat: leakage here does not necessarily inflate results (causal recompute of the two finalists is higher: 53.52% / 50.32%), so it invalidates rather than proves profitability — but it does invalidate the measurement.
