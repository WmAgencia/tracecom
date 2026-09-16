# Cross-Family Combination Gauntlet — FINAL INDEPENDENT CRITIC report

Node v24.18.0 (`C:\Program Files\Mover\nodejs\node.exe`). All recomputation was done from raw artifacts
(`kh/candles_a*.json`, `kh/tickagg_a*.json`, `cg/p1raw_*`), with an independently written candle-rebuild,
evaluator and BH routine. No artifact was modified. Scratch scripts: `%TEMP%\opencode\cg-critic\`.

Raw pages merged exactly as `cg-prosp.fetchWin` consumers do (dedup by `n`, sort by `ts`). Dataset-level sanity matched:
a1 ticks 5148/5148, candles 650/650, rows 610/610, indep 34/34, baseP60 53.75/53.75, baseP300 55.80/55.80;
a76 ticks 12805/12805, candles 650/650, rows 610/610, indep 34/34, baseP60 46.70/46.70, baseP300 43.25/43.25.
**All 16 finalist prospective metrics reproduced exactly (integers exact, WR to 2dp).**

---

## 1) COMPONENT INTEGRITY — **PASS**

First 3000 candles of `kh/candles_a1.json` (+`tickagg_a1.json`), 2960 KH rows:

- `cg-comps.buildParts` vs `cg-run.cjs` inline components (`F(i).tlb70up` etc.), elementwise:
  `tlbrk70 400/400 nz, 0 mism | tlbrk50 621/621, 0 | fb25 459/459, 0 | z240 107/107, 0 | exrsi 1484/1484, 0 | cp 1558/1558, 0 | acfade 197/197, 0 | miimb 1718/1718, 0 | enperm 1388/1388, 0 | humr 411/411, 0`.
  Compiled Fib products (v7relaxed/v7and/v1/v3/v6): 0 mismatches.
- Feature truncation stability (rows from 3000-candle slice vs full 120,368-candle compute, first 2960 rows): 0 field mismatches.
- `rebuildVec(spec)` for frozen binary finalist `G1_AND_z240_enperm` on P1 rows rebuilt from `cg/p1raw_a1` pages:
  **0 mismatches vs `AGREE(comps.z240, comps.enperm)`** (31 nonzeros each; SHA16 1744139dccb10712 both).
- Extra provenance: frozen `mk3-table-{bin,otc}.json` equals the TRAIN-derived table recomputed from `kh` datasets (deep-equal, both markets).

## 2) CAUSALITY — **PASS**

5 rows per market, decisions recomputed with (a) candles truncated at the row's candle index i and (b) future candles
after i gutted with large deterministic perturbations. 30/30 decision comparisons bit-identical
(`G1_AND_z240_enperm`, `G4_RS_hurst_entropy`, OTC `G4_META_*`), truncated row index alignment exact, and full-prefix
comparison of the perturbed recompute (all indices ≤ i) had **0 mismatches**. OTC META logistic probability p was
bit-equal too (base and p identical), so the 0-signal P1 output is a mask/hour effect, not leakage.

## 3) FREEZE INTEGRITY — **FAIL (partial)**

- `sha256(JSON.stringify(spec)).slice(0,16)` vs stored hash: **12/16 MATCH, 4 MISMATCH**:
  `G4_META_G3_G1_AND_z240_enperm+enlow+lowvol` bin (stored feb62dd4a655287a, recomputed 8c17a372f964c3ae),
  `G4_META_G3_G1_GATE_exrsi_h11_18+hurstMR+enlow` otc (dd05d5215d886692 vs 59cdf0aa2d1be8d8),
  `G4_RS_hurst_entropy` both files (1e57ee6b66fbf667 vs fe613c7eda7786f8).
- Root cause (verified): stored hashes match generation-time preimages that do **not** include the frozen content —
  META hash = `sha16({op, base, threshold})` (weights not covered); RS hash = a canonical arch string
  ("hurstMR->z240; persist->exrsi; H>2.85 WAIT; else miimb") that differs from the stored spec string. So the freeze
  hash does not attest the META weights (a weight swap would be undetectable), though recomputation shows the stored
  weights reproduce discovery stats exactly (65.20/44.10 bin; 64.22/52.60 otc) — coverage gap, not tampering.
- Timing: earliest freeze mtime `2026-09-16T00:35:55.513Z` (mk3-table-bin) and finalists `frozen_at`
  00:35:56.839Z/00:35:59.261Z < first `fetched_at` 00:36:34.047Z (a1) / 00:36:43.112Z (a76). **PASS.**

## 4) PROSPECTIVE RECOMPUTE — **PASS**

- OTC P1 (`p1raw_a76`) `G4_RS_hurst_entropy` T+300: **sig 263, WR 53.23%, indep 15/66.67%** — exact.
- BINARY P1 (`p1raw_a1`) `G1_AND_z240_enperm` T+60: **sig 29, WR 37.93%** — exact.
- Every other finalist/horizon also matched exactly (T+60 and T+300), e.g. binary RS T+300 61.11% (n=180),
  binary G1 T+300 64.52% (n=31), OTC RS T+60 50.00% (n=284), OTC gates 0 signals.

## 5) DATA SNOOPING & MULTIPLE TESTING — **PASS with caveats**

- Code order: `cg-run.cjs` writes g1 freeze (line 78) before G1 eval (line 81), g2 freeze (94) before G2 eval (96),
  g3 freeze (103) before G3 eval (104); mk3 table frozen (65). No evaluation precedes any freeze. **PASS.**
- BH recomputed independently over all frozen hypotheses (same train p formula): top G1 OTC gate
  `G1_GATE_exrsi_h11_18` (stored top) p=4.44e-6, **computed q = 0.0008 = stored q**. Train-BH q≤0.1 survivors:
  G1 97 bin / 22 otc, G2 45 / 37, G3 22 / 24 (of Kbh 398/366, 101/102, 30/24). So yes, hypotheses "survive" BH — but
  this is in-sample train q on ~450 correlated combos, and BH is anticonservative here.
- Selection bias demonstrated independently: `G1_AND_z240_enperm` train 55.72 → val 47.56; META bin 65.20 → 44.10;
  OTC `G1_GATE_exrsi_h11_18+hurstMR` 55.03 → 49.79; and a rejected candidate `G1_GATE_z240_h11_18`
  train 61.12 → val 37.40. All 5 OTC hour-gated finalists produced **0 P1 signals** (P1 window 23:07–00:01 UTC is
  outside 11–18h: vacuous, not negative). **Caveat: the survivor filter itself consumes VAL (line 84), and G2/G3/finalist
  sets are conditioned on VAL — only P1 is untouched.**

## 6) ABLATION — **PASS (decorative masks confirmed)**

Stored ablation: `G1_AND_z240_enperm+enlow` and `+lowvol` base_wr 55.72 == without_components_wr [55.72];
G3 quartet base 55.72 == without [55.72]. Independent structural check on TRAIN: of 2188 raw nonzeros of
`z240∧enperm`, **0 blocked by enlow (H<2.7) and 0 blocked by lowvol** (z240 already requires lowVol=1). The G2/G3
"quartet" is bit-identical to the G1 pair — decorative. Counterfactual shuffle of z240 raised train WR 55.72 → 57.31,
i.e. the pair's train edge does not survive destruction of z240's information.

## 7) FREQUENCY & INDEPENDENCE — **PASS (recompute), heavy flagging**

P1 (sig | WR% | indepN/indepWR): 
- BIN G1 pair/+enlow/+lowvol/G3 (identical vectors): T60 29 | 37.93 | 0; T300 31 | 64.52 | 0.
- BIN META: 1 | 100 | 0 both horizons. BIN v7relaxed: 29 | 20.69 | 2; 32 | 34.38 | 2.
- BIN RS: 182 | 48.35 | 8; **180 | 61.11 | 6**.
- OTC hour-gated (5 finalists + META): 0 signals both horizons (vacuous).
- OTC RS: 284 | 50.00 | 17; **263 | 53.23 | 15** (66.67% indep).
- OTC v7relaxed: 16 | 43.75 | 0; 16 | 56.25 | 0.

Flags: every claim except OTC RS rides on n<30 or indepN<10. OTC RS T+300's "indep 15/66.67%" is a grid artifact of
the shipped definition (marks rows on a 90s lattice; only ~5.6% of arbitrary signals land on lattice points).
Conservative 90s non-overlap on signal windows: **BIN G1 T+60 4 kept, 50% [15,85]; T+300 4 kept, 75% [30,95];
OTC RS T+300 32 kept, 48.28% fwd / 60.71% bwd; BIN RS T+300 29 kept, 57.69% fwd / 70.83% bwd.** Independent-window
estimates are phase-sensitive and none is significant.

## 8) 70% AUDIT — **PASS**

Recursive scan of every JSON under `cg/` (discovery, prospective, freezes, ablation, raw): **0 hits of WR≥70 with
signals≥50**. Closest claims are 100% on 1 signal (BIN META), 70.83% on 24 windows (BIN RS T+300, backward-phase
independent subsample, below the 50-signal bar). Expected result confirmed.

---

## OVERALL VERDICT

The combination gauntlet is mechanically sound (components, causality, P1 reproduction, code-order freezes, ablation)
but its prospective evidence is **negative or vacuous**, not positive: the frozen OTC hour-gates made zero P1 trades,
the binary pair collapsed 55.72→47.56 going into VAL and gave 37.93% T+60 in P1, and the headline OTC RS T+300
"53.23% / indep 15 / 66.67%" is reproduced exactly yet its independence subfigure is a definition artifact
(standard non-overlap: 48.28–60.71%, n≈32, CI includes 50%). The hash of two META specs does not cover the frozen
weights (metadata weakness). No prospective edge with adequate independence survives.

**Strongest counterexample to the closing claim:** binary `G4_RS_hurst_entropy` T+300 = **61.11% on 180 signals**
(and binary `G1_AND_z240_enperm` T+300 = 64.52% on 31) — both higher than the "best ~53.2%" — but they rest on
indepN 6 and 0 respectively; conversely OTC RS's independent-window WR falls to 48.28% (forward phase). So the claim
"NO_PROSPECTIVE_70_PERCENT_EDGE; best prospective ~53.2% (T+300, RS, indep 15/66.7) with tiny tranche" is only
**partially supported**: the 70% bar holds at signals≥50, but "best ~53.2%" is false unless an unstated
`indepN≥10` filter is applied, and the "indep 15/66.7" is not robust. Verdict: **no tradable prospective edge;
tranche too tiny (0.9h) to conclude anything stronger.**
