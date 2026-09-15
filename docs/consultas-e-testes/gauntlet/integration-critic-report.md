# FINAL ADVERSARIAL INTEGRATION CRITIC — TraceCom Gauntlet (shadow dataset)

- **Role:** independent final critic (built nothing in this experiment; ran own scripts, SELECT-only DB).
- **Date:** 2026-09-15. Node v22.23.2. DB: Supabase production via `DATABASE_URL` from `.env.local` (read-only).
- **Artifact state audited (sha256 first 16 / mtime):**

| artifact | sha256-16 | mtime |
|---|---|---|
| gauntlet-dataset.json | ac8058e057b95473 | 13:16:58 |
| gauntlet-snapshots.json | d4f94e47f4a4d89e | 13:16:58 |
| gauntlet-features.jsonl | 11e47db07fcd653f | 13:18:38 |
| gauntlet-search-log.jsonl | d3abf7010381e91e | 13:22:01 |
| gauntlet-registry.json | a8c5977b68527bd4 | 13:22:01 |
| gauntlet-candidates.json | 5a9624e7aed70308 | 13:22:01 |
| gauntlet-robustness.json | 3a8dbd3f269a0309 | 13:22:29 |
| finalists-manifest.json | f760bb833db0471b | 13:26:47 |
| blind-holdout-results.json | e21056af9bc0b363 | 13:26:47 |
| gauntlet-multiple-testing.json | ee90ccff01b7a514 | 13:26:47 |
| gauntlet-holdout-sidebreakdown.json | 8a3ffc94933182d1 | 13:27:07 |

**Method note:** verification 1 was executed in a **path-patched copy** at `C:\Users\junin\AppData\Local\Temp\opencode\critic\repro` (the 5 pipeline scripts copied and the absolute prefix `C:/tracecom-forward4/` rewritten to the temp path). Originals were **not overwritten**. All my own scripts live under `…\Temp\opencode\critic\`.

---

## Mandatory verifications — results

| # | check | verdict |
|---|---|---|
| 1 | Reproducibility from scratch (factory-p2, p3, robustness) | **PASS** |
| 2 | Freeze integrity (hash, ordering, no HOLD reads) | **PASS** (2b: literal grep exception, disclosed) |
| 3 | Dataset integrity re-derived from DB | **PASS** |
| 4 | Leakage spot-check (3 random snapshots) | **PASS** |
| 5 | Holdout claims independently recomputed | **PASS** (limitations below) |
| 6 | No production changes / deploys | **PASS** |
| 7 | 3 random eliminated strategies spot-check | **PASS** |
| 8 | Honesty audit | see list below |

---

### 1) Reproducibility from scratch — PASS

Ran patched copies: `gauntlet-factory-p2.cjs` → `gauntlet-factory-p3.cjs` → `gauntlet-robustness.cjs` (originals untouched; no overwrite of `C:\tracecom-forward4` artifacts).

- 977 strategies total (81 atoms + 380 pairs + 240 trios + 228 gates + 18 refinements + 30 weighted ensembles); 701 p2 entries; 97 candidates; FDR input K=732 with q≤0.05:211 / q≤0.10:322 / q≤0.20:445 — identical to originals; our own BH recomputation from the search log matched all four numbers exactly.
- `and(struct_f,macd_r)` DISC n=222 acc=62.16%, VAL n=68 acc=63.24%; `gate(struct_f|bullDiv)` DISC n=92 acc=70.65%, VAL n=32 acc=65.63% — exact.
- Family-wise permutation: **0.07592407592407592** reproduced exactly (same fixed seeds; deterministic). Method-sensitivity analysis in §Limitations.
- Artifact-level comparison (excluding only wall-clock `ms`/`generated_at`): `gauntlet-results-p1.json`, `gauntlet-vectors-p1.json` (701/701 vectors byte-equal), `gauntlet-search-log.jsonl` (977 lines), `gauntlet-candidates.json`, `gauntlet-baselines.json`, `gauntlet-coverage-accuracy.json`, `gauntlet-registry.json`, `gauntlet-robustness.json` — **all payload-equal**.
- Only expected difference: the original `gauntlet-multiple-testing.json` contains the freeze-side patch (`note_units_bug`, `family_wise_p_best_corrected`) added by `gauntlet-freeze.cjs`; a fresh p3 run produces the unpatched file (`family_wise_p_best: 1` units bug reproduced). This confirms the documented provenance, no fabrication.

### 2) Freeze integrity — PASS (with a literal exception, 2b)

- Recomputed `sha256(JSON.stringify({finalists:[{id,spec}…],references:[{id,spec}…]}))` from `finalists-manifest.json` itself → `2a49fb3e2b80ee87331fb2edf318d0d2` = stored hash = `blind-holdout-results.manifest_hash`. **PASS.**
- `frozen_at` 2026-09-15T16:26:47.795Z < `executed_at` 16:26:47.977Z (182 ms). Holdout loads the frozen manifest (specs shown identical to registry specs; `pre_holdout` fields in results equal manifest).
- Gap is only 182 ms — the freeze→holdout sequence is fully scripted; see Limitations (process trust).
- **2b (literal):** grep over all `.cjs`/`.mjs` for `"HOLD"`: readings occur in `gauntlet-dataset.cjs` (split definition, lines 68/74/79 — not evidence), `gauntlet-holdout.cjs:5` (allowed), and `gauntlet-holdout-sidebreakdown.cjs:5` (**post-hoc**, generated 13:27:07 > 13:26:47, explicitly labelled POST-HOC, does not alter frozen specs). So the literal condition "only holdout.cjs reads HOLD as evidence" **fails narrowly**; no HOLD data was used for selection, ranking, or freezing (factory-p1 filters DISC|VAL at line 2; p2/p3/robustness consume only those rows). Builder-side PASS; literal wording FAIL-by-exception.
- Extra transparency: `gauntlet-holdout.cjs` writes `manifest.hash` into its output but does **not itself verify** the hash; the check was performed externally (this report).

### 3) Dataset integrity from DB (own SQL/JS implementation) — PASS

- `shadow_trades` count = **6878**, distinct `trade_id` = **6878**.
- Unique snapshot keys (own key = `session|segment|floor(t0/5000)*5000`) = **3212**.
- Eligible (own warm-up: ≥31 five-second candles from `price_observations` where status=ACCEPTED, market_type=OTC, context_validation_status=VALID, same group, obs < bucketEnd) = **2592**; skipped = 620.
- Boundaries exactly **tA=1789408869732, tB=1789417170859**; splits **DISC 1555 / EMBARGO 7 / VAL 513 / HOLD 517**; independent windows 151/49/65 (267).
- label60 recomputed over all 3212 keys exactly matches `gauntlet-dataset.json` (1270 up / 1395 down / 207 draw / 340 missing; eligible-only 1058/1136/162/236).
- 55 (session,segment) groups; **no group contains >1 asset** (official asset-filter variant ≡ per-snapshot asset variant: both give 2592), so no cross-asset candle contamination.
- 11 400 ACCEPTED/OTC/VALID observations in the covered sessions.

### 4) Leakage — PASS

3 crypto-random snapshots (feature indices 679, 348, 246) re-queried from DB and recomputed with my own code:
all of `s`, `vol12`, `macdHist/atr14`, `inZone`, `upSwing`, `bullDiv` **bit-exact**; the last observation used was < bucketEnd in all 3; future observations exist and demonstrably change `s` (e.g. 0.3774 → 0.0801) — the causal cut is real. Labels: first observation in **[t0+60 s, t0+90 s]** exists, and its sign equals `l60` in both snapshots and features (3/3).

### 5) Holdout claims — PASS (numbers), limitations stated

Own re-implementation (raw features, no `gauntlet-compile`) of the 4 finalists + 18 references:
all `n/w/l/d/acc/coverage/indep` matched the JSON (rounded display). Side breakdown matched exactly: `and(struct_f,macd_r)` sell **50/59 = 84.7%**, buy **14/26 = 53.8%** vs bases **sell 59.0% / buy 41.0%** (252/427, 175/427); asset mix **517/517 EUR/NZD**; labels 427 of 517.
Adversarial follow-ups: sell-vs-buy Fisher exact p=0.0052; direction-adjusted edge (observed vs signal-mix base) **+21.8 pp, z=4.03**; but cluster bootstrap (10 000 resamples of session|segment clusters, 5 clusters) 95% CI **[+7.3 pp, +29.3 pp]**; independent-window subset n=6, 3/6. `and(fib_ctx,stoch_r_30)` 81% is 17/21 rows from a single segment. Period 2026-09-14 20:28 → 09-15 06:37 UTC (**≈10 h, one asset**).

### 6) No production changes — PASS

- Only gauntlet artifacts changed after 13:00; production files predate the research window: `index-profiles.mjs` 11:36:07, `index.mjs` 03:23:27, `index-events.mjs` 09:42:02, `evidence-profiles.mjs` 11:36:10, `regression-v7.mjs` 11:36:08, `package.json` 10:18:47 (research started 13:16). No web-app directory exists in the workspace.
- All `writeFileSync` targets in gauntlet scripts are gauntlet artifacts only; no `vercel|railway|spawn|exec|child_process|fetch|http` references; no INSERT/UPDATE/DELETE/DROP/ALTER in gauntlet scripts (only `crypto…update` false positive).

### 7) Spot-check of eliminated strategies — PASS

Crypto-random eliminated lines: **940** `refine(stoch_r_20|t-5)` (disc 720/47.78%, val 172/55.23%), **24** `atr_1` (1204/47.84%, 310/54.84%), **229** `union(mom_f_0.0004,macd_f)` (1110/51.71%, 297/42.76%) — recomputed with my own from-scratch mini-compiler on raw features: **exact match** on n/w/l/d/acc, DISC and VAL. (The same mini-compiler reproduced all 15 robustness candidates’ DISC stats exactly, incl. gates/vote3/weighted.)

### 8) Honesty audit — claims NOT verifiable / discrepancies

Not verifiable from artifacts:
- `executed_once: true` — declarative only; mtimes and the 182 ms gap are consistent but cannot prove a single execution.
- Upstream DB ingestion/shadow experiment internals (treated as given; SELECT-only audit).
- `decision_counts` per strategy/ref (not recomputed); `by_hour` / `by_vol` of robustness (only `by_asset`, `by_regime`, folds, ablation recomputed — matching); `indep_combined` for all 15 robustness candidates (finalists’ HOLD indep verified).
- Exact rerun determinism relies on fixed seeds; a different-seed rerun of the FW statistic changes the value (see below).

Discrepancies/observations (none falsifying the metric chain):
1. **FW p is method-dependent:** 0.0759 is the shared-shift variant (same mulberry32(777) shift stream per candidate — reproduced exactly by me). With different shared seed: 0.0669; with independent per-candidate shift streams: **0.1089 / 0.1179** (two seeds). So "family-wise p≈0.076" is one valid convention, but family-level significance at 5% is **not** established, and the FW correction covers only the top-15 (of 977 searched; 732 FDR-tested).
2. **BH vs permutation tension:** `gauntlet-multiple-testing.json` reports 211 strategies at q≤0.05 (BH, z-test assuming near-independence) while permutation FW is borderline — BH ignores label autocorrelation/overlap.
3. `gauntlet-robustness.json` `by_asset/by_hour/by_regime/by_vol` are computed **pooled DISC+VAL** (not stated in the artifact); values check out.
4. The pre-sidebreakdown claim "HOLD was NEVER used by any builder/critic script" was true at freeze time but is now narrowly false (post-hoc side breakdown, disclosed).
5. `gauntlet-multiple-testing.json` mtime/content include the freeze-side patch (documented in the file itself).
6. Dataset `label60` counts cover all 3212 keys while feature labels cover 2592 eligible rows (398 zeros = 162 draws + 236 missing labels treated as draws in scoring).

---

## Strongest counterexamples / limitations (summary)

1. **Borderline, method-sensitive family-wise significance** (0.067–0.118 depending on permutation convention).
2. **Effective n far below nominal:** only 267/2592 windows are non-overlapping; finalists’ HOLD independent subsets are n=3–6 (acc 33%/50%/80%/33%); cluster bootstrap excludes zero for only 2 of 4 finalists, and `and(fib_ctx,stoch_r_30)` is one-cluster-dominated.
3. **Post-hoc direction conditioning:** raw HOLD accuracies are inflated by a sell-biased period (sell base 59%); the fair metric is the direction-adjusted edge, which for `and(struct_f,macd_r)` is +21.8 pp (CI +7.3…+29.3 pp).
4. **Single-asset, single-day holdout:** 100% EUR/NZD, ≈10 h — external validity unproven (though EUR/NZD was also the best train asset for `and(struct_f,macd_r)`: 74.2% n=31 DISC).
5. **Process trust:** freeze and blind run are 182 ms apart; no independent proof of single execution beyond hash/order evidence.

## Verdict: **PASS** for the experiment’s integrity as an instrument (no metric, label, causality, reproducibility or hash falsifier was found), with the limitations above; external validity remains unproven and significance is borderline.

**Strongest claim the data supports:**
> `and(struct_f,macd_r)` (swing-structure ∧ MACD-histogram fade) showed a **direction-adjusted edge of +21.8 pp** (z=4.03; cluster-bootstrap 95% CI **+7.3 to +29.3 pp**) on the pre-frozen, never-used HOLD period (EUR/NZD only, ≈10 h, n=85 signals), consistent with its DISC 62.2% (n=222) and VAL 63.2% (n=68) accuracy — a strong candidate hypothesis for prospective multi-asset validation.

**Strongest claim NOT supported:**
> That the finalists are validated, production-ready, generalizable signals — or that any side-conditioned figure (e.g. 84.7% sell-side, 81% for `and(fib_ctx,stoch_r_30)`) is an expected long-run hit rate. Family-wise p≈0.076 (0.067–0.118 across conventions) is not significant at 5%, non-overlapping-window subsets are at/near coin flip (n=3–6), and the 517-row holdout is a single asset in a single 10-hour window.
