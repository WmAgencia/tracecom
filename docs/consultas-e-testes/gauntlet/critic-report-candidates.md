# Independent Adversarial Audit — Shadow Research Top Candidates

Critic ran independently (no participation in the research). Date: 2026-09-15.
Method: own scripts (reproduce attacks A–G), read-only on artifacts; no production DB writes (SELECT only).

Candidates audited:
1. `and(struct_f,macd_r)` — disc 62.2% n=222 / val 63.2% n=68
2. `gate(struct_f|bullDiv)` — disc 70.7% n=92 / val 65.6% n=32
3. `and(fib_ctx,stoch_r_30)` — disc 63.7% n=80 / val 67.9% n=28
4. `gate(struct_f|expansion>1.3)` — disc 59.4% n=239 / val 62.5% n=64

## Summary

| Attack | Scope | Result |
|---|---|---|
| A Metric recomputation (independence) | 4 candidates, DISC+VAL | PASS (exact match) |
| B Hand-audit 5 rows | candidate 1 | PASS |
| C Causality spot-check (DB) | 5 snapshots / 5 sessions | PASS (bit-exact, power shown) |
| D Duplicate/correlation (indep==1) | 4 candidates | PASS per threshold; weak evidence flagged |
| E Multiple testing (own permutation) | 4 + top-15 family | PASS (reproduces ≈0.076 within MC noise); 1 bookkeeping bug found, non-fatal |
| F Selection leak (HOLD) | all builder scripts | PASS (HOLD never used); VAL used in selection — disclosed |
| G Baseline comparison | 4 vs baselines/prod/components | PASS (candidates beat baselines on DISC & VAL) |

Overall: **no counterexample found that falsifies any of the 4 candidates at the instrumentation level.** Evidence strength (not correctness) varies: candidates 1–3 survive with meaningful VAL margins; candidate 4 is the weakest (independent-subset ≈ coin flip, FW-adjusted p not significant).

## A) Metric recomputation — PASS

Command: `node C:\Users\junin\AppData\Local\Temp\opencode\attackA.cjs` (workdir `C:\tracecom-forward4`).
Loaded all 2592 `gauntlet-features.jsonl` rows, `loadCtx` + `compile` from `gauntlet-compile.cjs`, masks `split==='DISC'` / `'VAL'`, own n/w/l/d/acc counter.

| id | DISC mine vs claimed | VAL mine vs claimed |
|---|---|---|
| and(struct_f,macd_r) | sig267 w138 l84 d45 acc62.16% = claimed | sig71 w43 l25 d3 acc63.24% = claimed |
| gate(struct_f|bullDiv) | sig103 w65 l27 d11 acc70.65% = claimed | sig33 w21 l11 d1 acc65.63% = claimed |
| and(fib_ctx,stoch_r_30) | sig89 w51 l29 d9 acc63.75% = claimed | sig33 w19 l9 d5 acc67.86% = claimed |
| gate(struct_f|expansion>1.3) | sig272 w142 l97 d33 acc59.41% = claimed | sig70 w40 l24 d6 acc62.50% = claimed |

No mismatch. Registry `spec`/`disc`/`val` identical to `gauntlet-candidates.json` for all four.

## B) Hand-audit 5 rows — PASS

Command: `node ...\attackB.cjs`. Logic re-derived from raw JSON features: BUY iff `structureUp==1 && macdHist<0`, SELL iff `structureDown==1 && macdHist>0` (and() requires equality of nonzero legs).

| # | key (truncated) | structureUp/Down | macdHist | hand | compiled | l60 = snapshot |
|---|---|---|---|---|---|---|
| 1 | vision_582ddb48…a0ri 1789380930000 | 1/0 | -1.9852 | 1 | 1 | +1 = +1 |
| 2 | vision_582ddb48…a0ri 1789380935000 | 1/0 | -2.1204 | 1 | 1 | -1 = -1 |
| 3 | vision_582ddb48…6wih 1789382530000 | 0/1 | 0.4111 | -1 | -1 | +1 = +1 |
| 4 | vision_c436df7d…gmys 1789384375000 | 0/1 | 0.3960 | -1 | -1 | -1 = -1 |
| 5 | vision_01a8f226…40if 1789400620000 | 1/0 | -1.1022 | 1 | 1 | 0 = 0 |

All 5 match; no inconsistency. (Global integrity: 2592 rows, 0 duplicate keys, 0 `l60` mismatches vs snapshots, 0 eligible snapshots missing from features.)

## C) Causality spot-check (production DB, SELECT only) — PASS

Command: `$env:NODE_PATH='C:\tracecom-forward4\node_modules'; node ...\attackC.cjs` (DATABASE_URL parsed from `.env.local`, ssl rejectUnauthorized false). 5 deterministic-random eligible snapshots, 5 distinct sessions. Own independent candle builder + own RSI14/vol12 implementation; window filtered to `epoch_ms < bucketEnd = floor(t0/5000)*5000+5000`. Tolerance 1e-9.

| key (session/segment) | s mine vs gauntlet | vol12 mine vs gauntlet | absdiff | future obs exists / changes value |
|---|---|---|---|---|
| vision_8a952e8a…a1vv | 0.14066447399780943 = same | 2.983700797072340e-4 = same | 0 | 270 / no |
| vision_e87a27f6…gsy3 | -0.04280904280910233 = same | 1.9360426924253988e-4 = same | 0 | 51 / no |
| vision_4f382fd0…ecky | -0.17709225935447645 = same | 8.511593301494340e-4 = same | 0 | 16 / **yes** |
| vision_5a8de64b…vavg | 0.11111111111111110 = same | 2.6057467692559510e-4 = same | 0 | 8 / no |
| vision_582ddb48…a0ri | 0.59544159544146570 = same | 8.2376747529690640e-5 = same | 0 | 55 / **yes** |

Exact bit-level equality on all 5; for 2 of 5, adding the next (future) 5s bucket demonstrably changes the values, and the artifact matches the causal-only computation. No evidence of look-ahead in these features.

## D) Independent-window check (`indep==1`) — PASS by threshold, weak evidence flagged

Command: `node ...\attackDEG.cjs` (section D).

| id | DISC full → indep | VAL full → indep | COMB full → indep | collapse |
|---|---|---|---|---|
| and(struct_f,macd_r) | 62.2% n=222 → **50.0% n=18** | 63.2% n=68 → 75.0% n=4 | 62.4% n=290 → 54.5% n=22 | 7.9pp |
| gate(struct_f|bullDiv) | 70.7% n=92 → 71.4% n=7 | 65.6% n=32 → 50.0% n=4 | 69.4% n=124 → 63.6% n=11 | 5.8pp |
| and(fib_ctx,stoch_r_30) | 63.8% n=80 → 71.4% n=7 | 67.9% n=28 → 100% n=2 | 64.8% n=108 → 77.8% n=9 | -13.0pp |
| gate(struct_f|expansion>1.3) | 59.4% n=239 → **52.0% n=25** | 62.5% n=64 → **50.0% n=6** | 60.1% n=303 → **51.6% n=31** | 8.5pp |

No candidate meets the formal flag (empty or >15pp collapse with n≥8). Honest caveat: none of the independent-subset accuracies (n=9–31) is significantly above 50%; candidate 4 is statistically indistinguishable from a coin flip on non-overlapping windows. Full-sample numbers are inflated by overlapping 90s label windows (indep rows are only 267/2592).

## E) Multiple testing / permutation — PASS (with one artifact inconsistency)

Command: `node ...\attackDEG.cjs` (section E, my own mulberry seed 20260915, 1000 circular label shifts on DISC, shift shared across candidates for the family statistic).

| id | robustness p (acc, seed777) | my p (acc) | p3 p (wins, seed1234) | my p (wins) |
|---|---|---|---|---|
| and(struct_f,macd_r) | 0.02298 | 0.0230 | 0.0899 | 0.0779 |
| gate(struct_f|bullDiv) | 0.01199 | 0.0120 | 0.00699 | 0.0120 |
| and(fib_ctx,stoch_r_30) | 0.04496 | 0.0390 | 0.0569 | 0.0519 |
| gate(struct_f|expansion>1.3) | 0.04595 | 0.0480 | 0.0589 | 0.0699 |

Family-wise (max-acc across top-15 candidates; best = gate(struct_f|bullDiv) obs acc 0.7065): robustness 0.0759, **mine 0.0669**, MC se ≈ 0.008 — reproduces the ≈0.076 claim. My 4-candidate-only FW p = 0.0220.

Bookkeeping bug found: `gauntlet-multiple-testing.json` reports `"family_wise_p_best": 1`, contradicting `gauntlet-robustness.json` (0.0759). Cause: `gauntlet-factory-p3.cjs:55` divides a wins-count max by `bestPerm.obsN` (n=35) and compares it to an accuracy threshold, so the condition is always true. The later robustness script (line 51) uses the correct acc-vs-acc max-stat. Independently verified there is no fabrication — the p3 field is a units bug. K_tested=732, FDR q values (q05=211, q10=322, q20=445) and BH q for all 4 candidates reproduce exactly (own BH implementation).

## F) Selection leak / HOLD — PASS, one process disclosure

- `gauntlet-factory-p1.cjs:2` loads features filtered to `split === "DISC" || split === "VAL"`; p2/p3/robustness consume only `P.rows`. Grep for HOLD across all `*.cjs`: only `gauntlet-dataset.cjs` (split creation + count reporting). **HOLD (517 rows, 65 indep) was never used to build or rank strategies.**
- Splits derive only from t0 quantiles of eligible snapshots: `gauntlet-dataset.cjs:66-68` (`q(0.6)=tA=1789408869732`, `q(0.8)=tB=1789417170859`, 90s embargo). No label-based split.
- Disclosure (not HOLD): VAL is used inside the selection pipeline — candidate status rule `gauntlet-factory-p3.cjs:42` (`val.n>=8 && val.acc>=0.52`), stage-5 refinement screening (`val.n>=10`, line 19), and final ranking (line 44, `min(disc.wilson_lo, val.wilson_lo)`). Therefore VAL numbers of these candidates are partially selection-biased; HOLD remains the only clean holdout and is untouched by the artifacts.

## G) Baseline comparison — PASS

Baselines / production (from `gauntlet-baselines.json`):

| strategy | DISC | VAL |
|---|---|---|
| always_buy | 50.1% n=1383 | 49.1% n=379 |
| always_sell | 49.9% n=1383 | 50.9% n=379 |
| last_candle | 49.3% n=1300 | 51.2% n=377 |
| random42 | 48.5% n=1383 | 50.7% n=379 |
| prod_v7relaxed | 58.2% n=91 | 69.2% n=26 |
| prod_v1fib | 70.6% n=17 | 85.7% n=7 |
| prod_v3fib | 53.8% n=39 | 100% n=8 (n too small) |

All 4 candidates beat every coin-flip baseline on both DISC and VAL by +9.3 to +21.4pp / +12.3 to +17.9pp and beat/tie all production references except tiny-n prod_v1fib on DISC. Consistency caveats (from `gauntlet-robustness.json`): fold min — c1 0.549, c2 0.571, c3 0.588, c4 0.463 (fold 1 below baseline); by-asset — c1 NZD/USD 49.3% (n=71), c4 NZD/USD 47.5% (n=59), while c2 (56–80%) and c3 (61.5–68.8%) are consistent across all three assets. Ablations: c1 = and(struct_f 55.7%, macd_r 49.1%); c2/c4 = gate over struct_f (55.7% DISC / 52.5% VAL), so the lift comes entirely from the AND/gate intersections (e.g. div_r alone 51.3% + struct_f 55.7% → 70.7% at n=92), which is the main overfitting surface (216 gates searched in stage 4).

## Per-candidate verdict

| id | Verdict | Note |
|---|---|---|
| and(struct_f,macd_r) | PASS | Exact metrics, causal, VAL 63.2%; indep acc drops to 50% (n=18), NZD/USD flat |
| gate(struct_f|bullDiv) | PASS | Best candidate; FW p ≈ 0.067–0.076, VAL 65.6%, consistent by asset; n small (indep 11) |
| and(fib_ctx,stoch_r_30) | PASS | Most consistent by asset and folds; indep n=9 only |
| gate(struct_f|expansion>1.3) | PASS (weakest) | Largest n but indep ≈ 51.6% (n=31), FW-adjusted p n.s., fold min 0.463, NZD/USD 47.5% |

**Overall verdict: candidate set survives all falsification attacks (A–G); no counterexample of metric, label, feature or causality error was found.** The separate question of real-world edge: at family level, FW p ≈ 0.067–0.076 is not significant at 5%, and candidate 4 is not distinguishable from chance on independent windows — candidates 1–3 warrant HOLD-set validation, candidate 4 should be treated as unproven.

## Attacks not completed / limitations

- Upstream data generation (`shadow_trades`, `price_observations` ingestion) not audited; DB treated as given (SELECT-only).
- Causality verified on 2 features across 5 snapshots (sample, not exhaustive); other features only spot-inspected.
- Permutation null assumes circular exchangeability of labels within the concatenated DISC sequence; session boundaries are crossed by shifts (approximate). MC noise ±~0.009 at p≈0.07.
- No HOLD evaluation performed (HOLD is unused by design; report stays on DISC/VAL).
- `l45` and `entry` semantics not independently validated beyond snapshot/features consistency.
