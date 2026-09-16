# critic-kh-report.md — Final Independent Critique (falsification attempt)

**Run:** KH experiment — 167h IQ Option EUR/USD BINARY(1) + OTC(76), 17 strategy families (K=70 hypotheses).
**Critic:** independent final review. **Date:** 2026-09-15/16. **Node:** `C:\Program Files\Mover\nodejs\node.exe`.
**Rule followed:** artifacts were not modified; all scratch work lives in `C:\Users\junin\AppData\Local\Temp\opencode\kh-critic\` (c1…c9 scripts + JSON evidence). Only this report was written into the artifact directory.

---

## Verdict summary

| # | Check | Result |
|---|-------|--------|
| 1 | Data integrity vs raw | **PASS** (full 100% candle rebuild exact; one material data caveat found — weekend flatline) |
| 2 | Causality (future perturbation) | **PASS** |
| 3 | Label T+60 | **PASS** |
| 4 | Freeze ordering & splits | **PASS** (nuance: walk-forward blocks include 48/72 embargo rows; diagnostic only) |
| 5 | Stats / reproducibility | **PASS** (all 70×2 train/val + 9 finalists × all splits reproduced exactly) |
| 6 | 70% audit | **PASS** (no hit ≥70% with n≥50; BINARY empty explained structurally) |
| 7 | Honesty | Conclusion "no ≥70% edge" supported. "BINARY nothing" is a *data artifact*, not evidence of no edge. |

**Overall verdict: no falsifier of the headline conclusion was found.** No stored artifact was shown to be wrong, fabricated, or non-reproducible. The strongest counter-finding is data-quality: the BINARY VAL block is a 48h Forex-weekend flatline, which makes the BINARY branch structurally unevaluable in VAL (and therefore guarantees 0 BINARY finalists regardless of any edge).

---

## Check 1 — DATA INTEGRITY vs RAW: **PASS**

Method: independent parser of all 1,062 raw pages (404 × a1, 658 × a76) rebuilt the full 5s candle series from mid prices (`value ?? (bid+ask)/2`), replicating only the documented per-page dedup on tick id `n`.

- **Exact rebuild:** 120,368 / 120,368 candles per instrument matched `kh/candles_a*.json` with **strict float equality** (`===`) on `bucket, open, high, low, close, n` — 0 mismatches. (Evidence: `kh-critic/c1-integrity.json`.)
- **Counts:** pages 404/658 = manifest; ticks 1,453,512 (BINARY) and 2,368,670 (OTC) = manifest; `duplicates_in_pages` = 0 reproduced; 0 unsorted timestamps; 0 bad JSON; every page's `count` = payload length; `active_id` consistent.
- **Untouched pages (all, not just spots):** recomputed per-page sha256 (fetch-style, first 16 hex) over file text, joined and hashed → `fc61200053f8f793` (a1) and `9b71d963069c2a72` (a76) = manifest `page_sha16_agg`. Any edited byte would break this. Spot file-byte hashes also equal re-serialized JSON hashes (no hand edits):
  - `a1/p0123.json` sha256 `f6bcfd42fee3f5b31e470a1aa1d205524df220b15394cea49b1b7ade0bb4c228`
  - `a1/p0175.json` sha256 `875db581dfb74c494bc66ecd3c9ac7cb52abf45bf184a6b8bd95671fd04d6838`
  - `a76/p0217.json` sha256 `8cd389ce0c4846a175397dfe925390bc24a73a12f782b5e4d732fe3fb7f6b334`
  - `a76/p0215.json` sha256 `778c3dd2b5c74e042abb5216df41daab57cd6afffd74be9a93fec10238de7e09`
- **Random pages:** 3 per instrument (seeded) rebuilt over their span — exact match on all candles the page covers.
- **0 gaps claim:** verified over the **entire** dataset, not a sample: every consecutive bucket differs by exactly 5,000 ms; gap list empty for both.
- **Supabase cross-check (read-only SELECT via Management API):** `iqopt_candles_5s` holds exactly 120,368 rows per 7D dataset, windows match the manifest; `iqopt_raw_ticks` BINARY = 1,453,512 (complete) but OTC = 250,000 of 2,368,670 — the documented 20-minute persistence budget in `kh-fetch.cjs:62` stopped OTC tick storage early ("raw complete em disco"). Local raw/OТC data is complete; the DB tick table for OTC is partial by design, not an artifact lie.

**Material caveat found (not a fabrication):** BINARY raw contains a **48.02h closed-market flatline** — 2026-09-11T20:59:55Z → 2026-09-13T21:00:55Z, 34,573 consecutive candles with close = 1.159945 (Friday 21:00 UTC → Sunday 21:00 UTC). The raw API itself emitted 172,871 quotes in that window, 172,864 at exactly 1.159945 (≈1 Hz frozen quotes), so candles are a faithful rendering of the official API. Consequences:
- VAL rows [60188, 84229) are **100% inside the flatline** (base rate = 0.5, all labels = draw, `l60=0`).
- TRAIN overlap: 10,486 of 60,164 rows (17.4%) are flatline.
- OTC has no long flat run (`candles_a76` max run < 2,000; VAL distinct closes 23,199/24,041).
- The manifest's "0 gaps / 167.18h" for BINARY is literally true but includes this dead period.

## Check 2 — CAUSALITY: **PASS**

`kh-features.cjs:computeKh` on the first 5,000 BINARY candles (with real tickagg map). For 5 seeded `i ∈ [200,4000]`: copy, mutate `candles[i+30].close *= 1.01`, recompute. At row `i` (rows index `i-40`):
- features deep-equal (all ~40 keys, JSON-equal), `entry`/`t0` identical — **same object content**;
- the mutated row `i+30` *does* change (perturbation is real).
Mutating the last candle (index 4999) changes **only** row 4959 (= candle 4999); every earlier row is byte-identical. No look-ahead in feature computation. (Evidence: `kh-critic/c2-causality.json`.)

## Check 3 — LABEL T+60: **PASS**

Independent label function (own bucket map: entry = close of candle at T; exit = close of the candle with bucket = entryBucket+60000):
- **All 120,328 rows × 2 datasets** reproduce `labelRows`'s `l60` with 0 mismatches; only the last 12 rows per dataset are `null` (no T+60 candle), as designed.
- 18 sampled signal rows (2 per OTC finalist) in BLIND: all labels matched, including a draw (`hu_mr`, 2026-09-15T19:47:40Z, entry = exit = 1.143995) and wins/losses.
- Metrics side: W/L only use `l60 ∈ {+1,−1}`; draws and unknowns are excluded. Example `cp_mean_0.5` blind: 10,598 signals = 5,293 W + 5,184 L + 111 draws + 10 unknown.
- Caveat: label uses the 5s candle close nearest to T+60s (ticks ~1 Hz), not the exact expiry quote; no payout/spread modeling.

## Check 4 — FREEZE ORDERING & SPLITS: **PASS**

Code order in `kh-run.cjs`: freeze written at line 109 → TRAIN/VAL evaluation 111–126 → finalists freeze line 128 → HOLDOUT/WALK-FORWARD 129–143 → BLIND 144–155 (blind opened once, after freeze).
Timestamps (all consistent):
- `kh-freeze.json` generated_at 00:18:54.418Z (mtime …:54.420)
- `kh-finalists-freeze.json` frozen_at 00:19:01.482Z (mtime …:01.485) — contains only TRAIN/VAL fields
- `kh-validation-results.json` mtime 00:19:02.067
- `kh-blind-results.json` generated_at 00:19:02.067Z (mtime …:02.586)
- Supabase `iqopt_benchmark_meta` row inserted 00:19:03.419Z
Finalists freeze precedes blind results by 0.6 s; holdout was computed only after finalists were frozen.

Splits (N = 120,328 rows = 120,368 candles − 40 warm-up; identical both instruments):
TRAIN 60,164 `[0,60164)` · EMBARGO 24 · VAL 24,041 `[60188,84229)` · EMBARGO 24 · HOLD 18,025 `[84253,102278)` · EMBARGO 24 · BLIND 18,026 `[102302,120328)`. Sum = 120,328.
- The 3 embargo zones are disjoint from all four stat ranges (checked programmatically: zero overlaps), and my independent recount *using exactly these ranges* reproduced every stored metric, proving no embargo row entered any split stat.
- **Nuance (reported, not hidden):** the walk-forward diagnostic blocks span `[0,102278)` and therefore include 48 of the 72 embargo rows (EMB1+EMB2; EMB3 excluded). Walk-forward is report-only and was never used for selection or the blind.

## Check 5 — STATS / REPRODUCIBILITY: **PASS**

Independent recompile of the entire hypothesis list from the frozen specs (`kh-critic/c3-recompile.cjs`), reusing `kh-features.cjs` and the compile table but re-deriving rows, indep flags, splits, base rates, selection rule and metrics:
- **All 70 hypotheses × 2 datasets:** `kh-validation-results.json` train+val reproduced **exactly** — every field (`signals, sigPerHour, w, l, draws, wr, buyN/WR, sellN/WR, indepN/WR/W/L, edge_pp, ci95, wilsonLo, max streaks`): 0 mismatches.
- **All 9 OTC finalists:** `kh-finalists-freeze.json`, `kh-blind-results.json` (train, val, holdout, blind) and the 7 walk-forward blocks reproduced exactly: 0 mismatches.
- Headline numbers confirmed end-to-end (own vecFn/compile, blinds only):
  - `fib_v7relaxed` blind: **449 signals, 241 W / 205 L / 3 draws, WR 54.04%, indep 28 = 42.86%** — exact match to JSON.
  - `cp_mean_0.5` blind: 10,598 sig, 5,293/5,184/111, WR 50.52%, indep 598 = 51.84% — exact match.
- Spec/freeze integrity: all 70 `sha16(spec)` values match `kh-freeze.json`; K=70; by-family counts match (F01 30, F02 8, F03 2, F04 7, F05 2, F06 3, F07 4, F08 2, F09 3, F10 1, F11 2, F12 1, F13_17_fib 5). Finalist rule reproduced byte-for-byte in outcome: BINARY `[]`, OTC the same ordered 9 ids.
- Engine parity independently re-run with the upstream `run-all.cjs` (fetched): 96 samples, **0 mismatches** on the 6 Fib parity keys (`s, vol12, r24, inZone, upSwing, distSma20`).
- Full `kh-run.cjs` re-run was deliberately **not** performed (it overwrites artifacts and needs the DB token/GitHub). Justification: every stored quantity was independently recomputed above; the marginal test would be byte-formatting only.

## Check 6 — 70% AUDIT: **PASS** (with notes)

Recursive scan of every numeric `wr` in `kh-validation-results.json`, `kh-blind-results.json`, `kh-finalists-freeze.json`, `kh-freeze.json`:
- **No entry with WR ≥ 70% and signals ≥ 50.** (Also none with indepWR ≥ 70% and indepN ≥ 50.)
- Highest stored WR overall: **75.0% but n = 13** (`fib_v6`, OTC VAL, not a finalist; its family winner was chosen on TRAIN, and the n≥50 bar is not met). Highest with n ≥ 50: 57.73% (a walk-forward block); best blind finalist 54.04%.
- BINARY finalists list is empty and this is **reproduced by the frozen rule** (best per family by TRAIN wilsonLo, then `train.sig≥200 ∧ indepN≥30 ∧ val.sig≥40 ∧ val.wilsonLo≥40`). Root cause table (c6-audit.json):
  - 8 families with TRAIN activity produced **0 VAL signals** (flat market ⇒ z=0, no runs, no accel, etc.) ⇒ fail;
  - F02 (`ex_rsi_0.55`) and F12 (`ens_vote`) fired 24,041 VAL signals but **all are draws** (24,041/24,041) ⇒ w=l=0 ⇒ wr null ⇒ wilsonLo 0 ⇒ fail;
  - F05/F10/F11 produced 0 signals on both datasets (dead hypotheses), so they could never qualify.
  - Therefore "BINARY nothing" is a **structural artifact of the flatline VAL block**, not an empirical failure of BINARY strategies.
- Additional code finding: F09 `pt_5_0.03` references feature `dir5`, which `kh-features.cjs` never computes (`dir3`, `dir10` only) — it degenerates to a single global TRAIN-base-rate bet; it happened to fire 0 signals (base rate within ±3pp). Harmless here, but a bug in the study design.

## Check 7 — HONESTY: what could NOT be verified / limits

1. **No full byte-level re-run** of `kh-run.cjs` (see 5); all stored numbers were nevertheless independently reproduced.
2. **DB persistence:** OTC tick rows in Supabase are partial (250k/2.37M) by the fetch script's documented time budget; only local raw pages are complete. Candle rows are complete for both datasets.
3. **Execution realism not tested:** entry = 5s candle close, exit = candle close nearest T+60s (≈1 Hz tick data); no payout %, spread, slippage, or order latency model. Draws (~0.1–2% of signals) are excluded from W/L, which can flatter WR slightly.
4. **Coverage claim:** of the advertised "17 families", F05 (Markov), F10 (regime), F11 (ML) produced **zero** signals on both datasets and F09 zero on OTC — i.e., 4 families were effectively untested. F12 is a vote of F01–F04/F06–F08 only.
5. **Multiple testing:** 70 hypotheses → 13 family winners → 9 OTC finalists selected on TRAIN/VAL; no multiplicity correction. The best blind WR (54.04%) is **not** statistically distinguishable from 50% (Wilson CI 49.4–58.61; independent subset 42.86%, n=28).
6. **Market-closed inference:** the flatline matches Forex weekend hours (Fri 21:00 → Sun 21:00 UTC); the raw API returned frozen quotes, so the candles are faithful, but the period is not tradable market data.

**Conclusion statement check:** the data support "**no demonstrated ≥70% edge; BINARY produced no finalists; OTC best blind = fib_v7relaxed 54.04% (n=449, indep 28/42.86)**" — with the explicit corrections that (a) BINARY VAL was a 100%-flat weekend window, so "BINARY nothing" must not be read as evidence about BINARY markets, and (b) 4 of 17 families never fired. The strongest counterexample to the experiment's framing is the flatline itself; the strongest numerical near-miss is `fib_v6` OTC VAL 75% at n=13, far below the audit bar and not selected.

**No artifact was found to be fabricated, miscomputed, or non-reproducible. Falsification attempt failed.**
