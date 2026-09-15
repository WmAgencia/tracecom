# Independent Critic Report v2 — IQ Option external validation (causal-fix verification)

Critic: fresh independent verifier (did not build v1 or the v2 fix). Method: read-only reimplementation of `run-all.cjs` v2 formulas (copied verbatim) + local frozen `gauntlet-compile.cjs` (sha256 `e4babe79…` == GitHub `scripts/gauntlet-compile.cjs`). Originals untouched (backups made outside the folder; no wipe observed during the run). Machine evidence: `critic-v2-work/verify-out.json`, scripts in `critic-v2-work/`. All 8 declared artifacts + 70 raw pages were present at read time and at end.

## A) LEAKAGE FIX — PASS (decisive)
- Truncation test, 5 seeded-random BINARY rows (i = 182, 798, 4807, 5333, 5623; all have >31 candles before i): `featuresAt(cd, i)` (full array) vs `featuresAt(cd.slice(0, i+1), i)` — **all 32 fields identical on all 5 rows**, and `EMA12[i]`, `EMA26[i]`, `MACD_SIG[i]` identical (the exact v1 bug case).
- Exhaustive scan of **all 7,171 rows (i=30..7200), all 32 fields: 0 mismatches; 0 EMA-global mismatches** (9.2 s). The fix is complete, not just sampled.

## B) METRICS RECOMPUTE — PASS
Rebuilt from `combined_binary_1.json`: candles 7,201; rows 7,171; indep 399; gaps 0 (all match). Frozen specs compiled via GC.loadCtx + GC.compile:
- `and(fib_ctx,stoch_r_30)`: sig 492, w 247, l 221, draws 24 → 52.78% (stored 52.78) — match.
- `gate(struct_f|expansion>1.3)`: sig 526, w 234, l 276, draws 16 → 45.88% (stored 45.88) — match.
- `and(struct_f,macd_r)`: sig 1481, w 717, l 706 → 50.39% — match.
- `gate(struct_f|bullDiv)`: 312/130/170 → 43.33% — match. Buy/sell/indep splits match too, for **all 44 evaluated entries (22 × 2 datasets)**.
- `expansion` is **not constant**: binary sd 0.4134 (min 0, max 3.316; 1,443 rows >1.3); OTC sd 0.2091 (372 rows >1.3). v1's constant 0.91836 artifact is gone.

## C) DIRECTION-CONDITIONED EDGE — PASS (executed)
Binary base rates among 6,864 labeled rows: **P(up)=53.07%, P(down)=46.93%** (mandate: ≈53.1/46.9 ✓). Side-conditioned deltas (pp):
| finalist | BUY acc (n) | Δ vs P(up) | SELL acc (n) | Δ vs P(down) |
|---|---|---|---|---|
| and(fib_ctx,stoch_r_30) | 58.40 (250) | **+5.33** (z 1.69) | 46.33 (218) | −0.60 |
| and(struct_f,macd_r) | 53.28 (747) | **+0.21** (z 0.11) | 47.19 (676) | **+0.26** (z 0.14) |
| gate(struct_f\|bullDiv) | 54.35 (92) | +1.27 | 38.46 (208) | −8.46 (z −2.45) |
| gate(struct_f\|expansion>1.3) | 47.92 (240) | −5.16 | 44.07 (270) | −2.85 |

OTC (P(up)=48.91%): every finalist sell-side delta is negative (−1.38 to −6.33 pp); the max buy-side delta is +0.07 pp (and(struct_f,macd_r), z 0.04).
**Clear statement:** only `and(struct_f,macd_r)` on binary is positive on BOTH sides with n≥50 (+0.21 pp / +0.26 pp) — but z=0.11/0.14, i.e., statistically indistinguishable from the directional base rates, and it vanishes on OTC (buy +0.07, sell −1.38). No finalist shows a significant two-sided edge.

## D) FROZEN/SAFETY — PASS
- Manifest hash recomputed with the freeze method (`sha256` of `{finalists:[{id,spec}],references:[{id,spec}]}`, first 32 hex) == field == `results.frozen_hash` == **2a49fb3e2b80ee87331fb2edf318d0d2**. Local manifest sha256 `f760bb83…` == GitHub main.
- Binary/OTC separate: `results.datasets` = [active 1 otc:false, active 76 otc:true], 22 entries each; per-dataset out files.
- No parameter mutation: char-identical specs before/after compile, embedded specs == manifest for all 44 evaluations, 0 mutation flags; manifest hash unchanged.
- T+60 rule present in `buildRows` (`byBucket.get(cd[i].bucket + 60000)`); empirically 10/10 signal rows per dataset: settle index gap exactly 12 candles (60 s), stored `l60` == independently recomputed sign, `entry` == close of candle i.

## E) INTEGRITY — PASS
- md5 over JSON `[ts,bid,ask]`: binary `73fa63b8…`, OTC `7d68e270…` — equals combined-file field, `results.json` field, **and an independent rebuild from the 70 raw pages** (30+40; all `source_url`s schema-valid; full row/ts/bid/ask equality).
- Window exactly 10.0000 h (07:01:18.757Z → 17:01:18.757Z), ending exactly 35.0000 min before `generated_at` (17:36:18.759Z).
- OTC `and(fib_ctx,stoch_r_30)` recomputes to signals 491, w 233, l 255, draws 2, unk 1, **47.75%** — matches stored.

Caveats (non-decisive): v2's `featuresAt` omits `er30/er60/r12/distFib/atrPct` (loadCtx → NaN), but no evaluated spec references them. v2 vs v1-critic ad-hoc causal rebuild differs by ±5 signals (492 vs 493) due to implementation details; same conclusion.

## FINAL VERDICT
A PASS, B PASS, C PASS, D PASS, E PASS. The v2 leakage fix is real and exhaustive: features are exactly causal on every row, and all stored numbers reproduce bit-exactly from the raw pages through frozen, unmutated specs. I could not falsify the conclusion: on IQ Option's own 10h feed the frozen finalists did NOT maintain edge (binary 43.3–52.8%, OTC 44.7–49.4%; best two-sided cell +0.2 pp ≈ z 0.1, absent on OTC). The one nominally positive BUY reading (binary fib/stoch, +5.33 pp, z 1.69, n=250) is not significant, is contradicted by its SELL side, and stays below typical binary breakeven. Overall v2 integrity: PASS. Limitation: a single 10h window cannot prove the strategies are impossible — only that the claimed edge does not persist here.
