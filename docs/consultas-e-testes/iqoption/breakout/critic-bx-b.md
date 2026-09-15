# CRITIC BX-B — Checks 4+5+6+7: overfitting, multiple testing, frequency/independence, regime collapse, prospective blind, honesty

**Critic run:** 2026-09-15 ~23:25–23:50Z · independent adversarial pass · Method: rebuilt discovery rows (Supabase candles + combined tickAgg + GitHub run-all `buildRows` + bx-lib features) and prospective rows (raw-prosp pages only, ticks→candles→rows) from scratch; re-ran `compileBx` with self-written drivers. **No artifact in `iqopt/` was modified; the only file written there is this report.**

**Environment verified first (so every number below is traceable):**
- Supabase ref in `bx-run.cjs`/`bx-prosp.cjs`/`critic-sql.cjs`/`token-check.ps1` = `cladmauwmuoeqongxzwb`; GET `/v1/projects/cladmauwmuoeqongxzwb` → name **"Tracecom", ACTIVE_HEALTHY**. Token: 44 chars, `sbp_` prefix (`.sbp` + Credential Manager target `Supabase CLI:supabase`).
- Engine parity: GitHub `run-all.cjs` sha256 `d3f3a0ef…e2a81f86` == local copy (only `buildRows` used, prefix extracted exactly as the pipeline does).
- **Rebuild sanity (precondition):** discovery rows 7161 (BINARY) / 7114 (OTC), baseP 53.05% / 48.95%, candles 7201 — all equal stored `bx-discovery-results.json`; all **6 finalists' discovery metrics exact** (0 diffs on signals/wr/buyWR/sellWR/coverage/sigPerHour/indepN/indepWR/z/edge). Prospective rebuild from raw pages: tick md5 `86cee95f…` (BINARY) / `191bbc19…` (OTC) **exactly stored**; rows 4098/4128, indep 229/230, baseP 50.18/45.63 exact.

---

## CHECK 1 — OVERFITTING / NEIGHBOUR SENSITIVITY

**Verdict: PASS for the question asked (finalists sit on plateaus, not isolated spikes). FAIL on completeness of the frozen hypothesis set (44/92 hypotheses were dead code — see below).**

Intermediate parameters run by me on the rebuilt rows (not in the frozen grid, which only froze tl∈{0.5,0.7}, fb∈{0.1,0.25}):

| spec (OTC, discovery) | sig | WR% | z | indepN/WR% |
|---|---|---|---|---|
| fb_0.05 | 3195 | 52.26 | 2.48 | 171/52.05 |
| fb_0.15 | 2123 | 54.68 | 4.28 | 109/54.13 |
| **fb_0.25 (frozen)** | 1491 | 55.47 | 4.17 | 75/52.00 |
| fb_0.30 | 1155 | 57.18 | 4.84 | 58/50.00 |
| fb_0.40 | 662 | 58.87 | 4.54 | 35/51.43 |
| tlbrk_0.55 | 1458 | 54.48 | 3.40 | 75/58.67 |
| tlbrk_0.60 | 1337 | 54.02 | 2.95 | 72/59.72 |
| **tlbrk_0.70 (frozen)** | 982 | 54.96 | 3.11 | 52/57.69 |
| tlbrk_0.75 | 825 | 55.50 | 3.17 | 42/61.90 |
| tlbrk_0.90 | 240 | 73.95 | 7.44 | 11/81.82 |

- OTC `fb`: entire 0.05→0.5 band is positive (52.3–58.9%, z 2.5–4.8). The frozen fb_0.25 is mid-plateau; neighbours **fb_0.2 (55.57%, z4.62)** and **fb_0.3 (57.18%, z4.84)** are *stronger*. No spike.
- OTC `tlbrk`: entire 0.4→0.85 band positive (54–62%, z 2.9–5.1). Frozen 0.5/0.7 sit mid-plateau; **tlbrk_0.6** (intermediate) still z=2.95.
- BINARY `tlbrk`: flat until 0.7; **0.75 (61.87%, z5.30, indep 28/67.9)** and **0.8 (68.12%, z7.37, indep 24/79.2)** are far stronger but were never frozen.
- BINARY `gate_fbDn_*` neighbourhood does **not** corroborate: only `rsi` is ≥50 (53.92%, z0.44, q=0.89); `imb` 50.67 (z−0.82), `mom12` 41.57 (z−2.17); the mirrored `gate_fbUp_*` family is negative. The frozen BINARY finalist is a lone insignificant cell, not a plateau.
- **Prospective neighbourhood (my extra runs):** OTC fb band collapses toward ~50 (fb_0.2 50.67, fb_0.3 50.80, fb_0.35 50.25, z≤0.8) while frozen fb_0.25 keeps 51.33 → the discovery plateau is **not replicated**; OTC tlbrk band persists overall (0.75 55.50, 0.8 57.76, 0.85 60.56) but *all* collapse on independent subsamples (24→12 samples, indepWR 33.3→41.7%).
- **MAJOR FINDING (dead grid):** `compileBx` builds the key `"brk"+"N"+ops.N+"up"` with `ops.N="N24"` → **`brkNN24up`**, but the feature is `brkN24up`. 0/7161 and 0/7114 rows contain the double-N key. Consequence: **all 36 `A_breakout` + 8 `D_compression` hypotheses emitted 0 signals in discovery and prospective** (stored `signals: 0`, z=null; they were dropped from BH). Verified on rebuilt rows: frozen `brk_24_0_none` sig=0, while 793 (BINARY) / 1048 (OTC) rows actually had a 24-break event; with a corrected lookup it gives 793 sig @50.33% and 1048 @50.00% (i.e., no edge even when fixed). The same feature is read *correctly* elsewhere (`gate_brk24up/dn` in bx-run baseFns use `f.brkN24up`), so the bug is the compiler's string concat. **The "breakout" premise was never actually tested, and K=92 is nominal (46 live non-baseline tests).**

---

## CHECK 2 — MULTIPLE TESTING (BH plausibility)

**Verdict: PASS for arithmetic (exact replication); the "K=92" framing is FALSIFIED.**

Independent BH recompute (same one-sided p=1−Φ(z), same A&S normCdf, same backward BH): **0 mismatches** against every stored q in both datasets.

OTC `fb_0.25`: z=4.1739158 → **p=1.498e-5**, rank **1**, m(tested)=**46** →
- q = p·46/1 = **0.000689 → 0.0007 = stored exactly** ✔
- With the literal frozen K=92: q = p·92/1 = **0.0014**
- Two-sided p (=2.996e-5) → q = 0.0014 (m=46) / **0.0028** (K=92)

So the stored q is internally consistent (the code used m=46 because 44 hypotheses had zero signals — the dead families above), is one-sided (optimistic vs a two-sided convention), and the description "K=92" is not what was applied. Top-5 q values (OTC: 0.0007/0.0012/0.0080/0.0107/0.1957; BINARY: 0.1352/0.1352/0.1352/0.1732/0.2077) all reproduce exactly. No material impact on `fb_0.25` significance either way, but the multiple-testing budget is overstated by 2×.

---

## CHECK 3 — FREQUENCY / INDEPENDENT SAMPLE

**Verdict: PASS (formulas verified) + 3 flags.**

Formula `sigPerHour = signals/(rows·5/3600)` verified **true for all 6 finalists in BOTH windows**; `coverage` also exact.

| finalist | disc sig (sig/h) | prosp sig (sig/h) | prosp coverage | prosp indepN/WR | flag |
|---|---|---|---|---|---|
| BIN gate_fbDn_rsi | 658 (66.2) | 267 (46.9) | 6.52% | **13**/53.85% | **FRAGILE: indepN<20** |
| BIN tlbrk_0.7 | 695 (69.9) | 587 (103.1) | 14.32% | 32/56.25% | ok |
| BIN tlbrk_0.5 | 1441 (144.9) | 948 (166.6) | 23.13% | 52/53.85% | ok |
| OTC fb_0.25 | 1491 (150.9) | 986 (172.0) | 23.89% | 51/56.86% | ok |
| OTC tlbrk_0.5 | 1596 (161.5) | 753 (131.3) | 18.24% | 43/**39.53%** | **indepWR −13.8pp vs WR; independent sample loses** |
| OTC tlbrk_0.7 | 982 (99.4) | 468 (81.6) | 11.34% | 27/**33.33%** | **indepWR −22.2pp vs WR 55.53%; result leans on overlapping signals** |

Extra (my runs): prospective OTC tlbrk_0.75/0.8/0.85 indep = 24/33.3%, 16/37.5%, 12/41.7% — the whole family collapses on 90-s non-overlap. The claimed OTC `tlbrk_0.7` 55.53% is not supported by its 27 independent samples (9W/18L).

---

## CHECK 4 — REGIME COLLAPSE (hour buckets, discovery)

**Verdict: FAIL — no finalist is bucket-stable; the OTC edge lives in 11–18Z, and the prospective window (17–23Z) is nearly disjoint in time-of-day from discovery (07–17Z).**

Discovery WR per bucket (signals in parens); market up-share per bucket as context (BINARY 51.68/55.05/51.83; OTC 53.73/43.34/50.70 — for near-balanced strategies the drift-neutral baseline ≈50%):

| finalist | 07–11Z | 11–15Z | 15–18Z | reading |
|---|---|---|---|---|
| OTC tlbrk_0.5 | **49.66** (610) | 57.90 (743) | 58.75 (243) | morning dead; edge only 11–18Z |
| OTC tlbrk_0.7 | **49.16** (374) | 59.12 (461) | 56.16 (147) | same; morning dead |
| OTC fb_0.25 | 57.47 (527) | **50.99** (560) | 59.09 (404) | midday edge ≈0 |
| BIN gate_fbDn_rsi (100% buy) | +1.5pp vs up-share | **−1.4pp** | +3.8pp | thin, never clearly above drift |
| BIN tlbrk_0.7 | +2.9pp* | 56.82 (325) | **49.25** (138) | edge is a midday artefact; 15–18Z < drift |

(*approx vs direction-mix baseline 49.5.)

Prospective per-hour (my runs): BIN gate_fbDn_rsi 53.73/60.87/**41.67** (last bucket < its 45.68 up-share… 21–23Z is the losing bucket); BIN tlbrk_0.7 52.94/**43.15**/65.06; OTC fb_0.25 54.37/51.03/**48.13**; OTC tlbrk_0.5 59.72/50.52/51.21; OTC tlbrk_0.7 66.67/52.05/53.69. Every finalist has ≥1 bucket at ~43–52%. **Counterexample to "stable edge": OTC tlbrk_0.5's discovery WR without the 11–18Z stretch is 49.66%, and BINARY gate_fbDn_rsi flips to 41.67% in the last prospective bucket.** Also note the discovery↔prospective windows cover different hours (07:04–17:01Z vs 17:01–22:48Z), so this holdout is a different intraday regime — neither a clean confirmation nor a rejection of the discovered buckets.

---

## CHECK 5 — PROSPECTIVE BLIND (independent recompute)

**Verdict: PASS (exact).** Rebuilt ONLY from `raw-prosp/` pages (dedupe by quote `n`, sort by `ts`), then candles → `buildRows` → features → `compileBx` → metrics. **All 6 finalists and both baselines match stored `bx-prospective-results.json` with diffs=[] on signals/wr/buyWR/sellWR/coverage/sigPerHour/z/edge/draws/indepN/indepWR**, and md5 of (ts,bid,ask) matches.

Specifically the two requested:
- OTC `tlbrk_0.7`: sig=**468**, WR=**55.53**, BUY **50.31**, SELL **67.13**, indep **27/33.33** → **exact** (no mismatch).
- OTC `fb_0.25`: sig=**986**, WR=**51.33**, SELL **62.33**, indep **51/56.86** → **exact** (no mismatch).

Timeline/ordering:
- First prospective quote ts = **17:01:19.000Z**, strictly after DISC_END **17:01:18.757Z**; **0 ticks ≤ DISC_END**; discovery tick data end: BINARY 17:01:18.000Z, OTC 17:01:18.502Z (combined files), discovery candles max bucket 17:01:15 — no tick-level overlap.
- `frozen_at` = **23:23:33.196Z**; raw pages `fetched_at`: BINARY 23:23:34.373→23:23:42.045Z, OTC 23:24:36.460→23:24:52.049Z → **0 pages fetched before the freeze**; all `requested_from` = 1789491678758 (= DISC_END+1); page-0 `requested_to` = 22:48:33.202Z = stored window end. Freeze rule selection verified: exactly the top-3 by wilsonLo among {indepN≥25, signals≥100} per dataset (BINARY 21 candidates, OTC 29).
- Caveats: OTC prospective `fb_0.25` WR 51.33 has z=1.16 (not significant; edge +1.85pp); the window was bearish for OTC (up-rate 45.63%, always_sell 54.37%), which flatters sell-heavy readings (sellWR 62–67% with buyWR ≤50.3); and per Check 3–4 the tlbrk independent subsample is 33.33%.

---

## CHECK 6 — HONESTY (≥70% with n≥50)

**Verdict: PASS for the BX datasets ("NENHUMA" is supported); FAIL if the claim covers every results file in the folder.**

- `bx-discovery-results.json` + `bx-prospective-results.json`: **zero** strategies with WR≥70% and signals≥50. Max with n≥50: discovery 58.97% (BIN gate_sweepDn_imb, n=124, **indep=4**), 56.80% (OTC gate_sweepUp_rsi, n=125, indep=4); prospective 55.53% (OTC tlbrk_0.7). The pipeline's own console answer ">=70% com n>=50: NENHUMA" is data-supported for BX.
- Folder-wide scan (all \*.json, incl. older benchmark): **3 counterexamples** in `benchmark-combos-results.json` (exploratory G3, K=3906):
  - BINARY `and(atr_2,macd_f)` 70.83% n=98 (2 draws; indep 7/85.7%;
  - OTC `and(rsi_s_0.66,macd_f)` **95.83%** n=62 — but **38 draws** (only 24 resolved), indep **1**; q=0.0054
  - OTC `and(rsi_s_0.55,macd_f)` 72.46% n=107 — **38 draws** (69 resolved), indep **2**; q=0.0777
  So a literal "exists ≥70% with n≥50 anywhere?" = **yes** (two of them with ≥50 resolved trades), all from the earlier combos search with negligible independent samples. The BX-only answer ("não") is honest; a folder-wide answer ("não existe nenhuma") is not.
- Disclosure gap (honesty): the freeze/report presents K=92 hypotheses, but 44 were un-runnable (Check 1). This does not generate false positives (dead tests cannot win) but overstates breadth and the BH budget; it should be disclosed or the compiler fixed and re-run.

---

## GLOBAL VERDICT

| Check | Verdict |
|---|---|
| 1. Overfitting/neighbour | **PASS** (plateaus, not spikes) — but 44/92 hypotheses dead; BINARY gate neighbourhood is a lone noise cell |
| 2. Multiple testing | **PASS arithmetic** (0/92 mismatches) — "K=92" falsified: effective m=46, one-sided p; K=92 → q=0.0014 |
| 3. Frequency/indep | **PASS formulas** — flags: BIN gate_fbDn_rsi indepN=13; OTC tlbrk_0.5/0.7 (and 0.75–0.85) independent WR 33–40% ≪ headline |
| 4. Regime collapse | **FAIL** — every finalist bucket-dependent; OTC edge 11–18Z only; BINARY flips negative in a prospective bucket |
| 5. Prospective blind | **PASS** — bit-exact recompute from raw pages; window and freeze ordering verified |
| 6. Honesty ≥70% | **PASS for BX**, folder-wide **NOT** (3 combos ≥70% with n≥50, draw/indep-frail); dead-hypotheses gap |

**Strongest counterexamples found:** (i) `brk_24_0_none` frozen = 0 signals vs 793/1048 real break events — the breakout grid never ran; (ii) stored q=0.0007 = p·46/1, not p·92/1 (=0.0014); (iii) OTC tlbrk_0.7 prospective 55.53% overall vs **9W/18L (33.33%)** on its 27 non-overlapping samples; (iv) `and(rsi_s_0.66,macd_f)` 95.83% is 23W/1L with 38/62 draws excluded and indep=1.

**My evidence files (outside `iqopt/`, in `…/Temp/opencode/critic-bx/`):** `env-check.json`, `discovery-rebuild.json`, `prosp-rebuild.json`, `analysis-stored.json`, `followup-disc.json`, `followup-prosp.json`, `honesty-scan.json`, plus the scripts that generated them. No artifact was modified.
