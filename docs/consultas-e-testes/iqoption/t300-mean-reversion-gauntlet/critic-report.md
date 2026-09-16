# Independent Critic Report — z120_rev_2 T+300 Gauntlet (EUR/USD BINARY, 10h discovery)

**Critic:** independent offline re-implementation (no reuse of tr-run/tr-prosp evaluation code).
**Inputs:** `iqopt_candles_5s` / `iqopt_raw_ticks` (project `cladmauwmuoeqongxzwb`, read-only SELECTs via token from Windows Credential Manager target `Supabase CLI:supabase`, blob `sbp_a136…`, identical to the `.sbp` copy), plus `tr/signals-raw.json`, `tr/all-results.jsonl`, `tr/*-freeze.json`, `tr/p3raw/p000.json`.
**Repro scripts:** `C:\Users\junin\AppData\Local\Temp\opencode\critic-tr.cjs` (+ follow-up probes); raw results in `critic-tr-results.json` (same parent dir).
**Dataset:** IQOPTION_EURUSD_BINARY_10H = 7 201 candles, 2026-09-15T07:01:15Z → 17:01:15Z (10.0 h). Net move +0.0828% (1.15341 → 1.154365).

## Verdict summary

| # | Check | Verdict |
|---|-------|---------|
| 1 | Baseline reproduction from RAW | **PASS** |
| 2 | Causality (z120, no look-ahead) | **PASS** |
| 3 | Finalists integrity (TRAIN/VAL eval, specs, selection) | **PASS (VAL exact) — caveats** |
| 4 | Fib claim (fibOk==1 zero signals) | **PASS** |
| 5 | Independence (300s spacing) | **PASS (numbers); effective N very small** |
| 6 | Prospective honesty (P3) | **FAIL** |
| 7 | Multiple-testing sanity | **PASS (consistency) — heavy caveats** |

Overall: arithmetic is largely reproducible; **evidentiary validity is not established**. The 3 finalists do legitimately reproduce their VAL numbers from `signals-raw.json`, but those numbers are selection-biased, direction-mix-explained to a large extent, and contradicted (small-N) by the only out-of-sample tranche.

---

## Check 1 — Baseline reproduction from RAW: PASS

- Independently rebuilt 5s candles for **20 random decided signals** (seed 20260915) straight from `iqopt_candles_5s`: `z120=(close-mean120)/sd120` over the 120 buckets ending at `t0-5000`, direction = contrarian sign, settlement = close at exact `bucket+300000 ms`.
- **20/20 exact match** on `t0`, `z` (3-dp), `dir`, `l300`, `entry`. Extra isolated SELECTs for 3 of them (bucket range −119×5s…+300s, 180/180 rows each) matched again.
- Global recount from `signals-raw.json`: raw 904 → **decided 890, W=566, L=324, WR=63.60%**, draws=14, unknown=0. BUY 438 @73.29%, SELL 452 @54.20% (matches `baseline-reproduction.json`). Sig/hour 90.4 (904/10.0 h) matches the file.
- No discrepancies.

## Check 2 — Causality: PASS

- For 10 random signals (DB-derived closes): recomputed z using only closes ≤ i (truncated array) → identical to stored z; **perturbing close[i+70] (+0.01) leaves z(i) unchanged**; control perturbation of close[i] changes z(i). 10/10.
- Scope note: fuzz test covered `z120` (the base signal). Code inspection of `tr-features.cjs` shows the other features use only ≤ i windows; `l300` is the label by design.

## Check 3 — Finalists integrity: PASS for VAL/metrics, with structural discrepancies

- Split replicated exactly: `splitT=2026-09-15T12:49:50Z`, **train 535 / val 347 / gap 8** (300s embargo ≥ 300s horizon). `tr-run.cjs:33-34` implements train→val with embargo as claimed.
- **VAL recomputation from `signals-raw.json` (exact freeze match):**
  - `structDown==1`: n=103, w=82, **WR 79.61%** (BUY 92 @83.7%, SELL 11 @45.45%, indepN 12)
  - `ret90<-0.000087`: n=190, w=146, **WR 76.84%** (BUY 190 @76.84%, SELL 0)
  - `Hp>=0.781789`: n=148, w=115, **WR 77.7%** (BUY 117 @84.62%, SELL 31 @51.61%, indepN 16)
- **TRAIN** (n=106/133/134) also reproduces exactly **only with the full-precision thresholds** stored in `g1-freeze.json` (`ret90 th=-0.00008667313826098061` → 107/133=80.45; `Hp th=0.7817885815245882` → 108/134=80.6). Using the 6-dp values embedded in the gate ids gives n=132/133 (off-by-one boundary signals). The ids are lossy labels, not thresholds.
- Selection replication: candidates = top-10 G1 by TRAIN wilsonLo (G2/G3 empty — see below); top-3 by VAL wilsonLo = the frozen trio. Match with the implementation.
- **Discrepancies:**
  1. **Specs not self-contained.** `finalists-freeze.json` specs are `{"id": ...}` only — `feat/op/th` were dropped (`tr-run.cjs:55` pushes rows without them; `:105` serializes `undefined` away). The frozen spec cannot be re-evaluated without opening `g1-freeze.json`.
  2. **Hash cosmetics.** Freeze `hash` = `sha16(id-string)` (e.g. `036122155802f739 = sha16("structDown==1")`), **not** the `g1-freeze` gate hash (`952bd6e1e6e0f291`). It certifies the label, not the spec.
  3. **Stated rule is incomplete/misleading.** "top3 por val wilsonLo" is only true *within the 10 train-selected candidates*. `cpVar<0.848044` (val 85.29%, n=102, wilsonLo 77.15) beats every finalist on val but was never a candidate. Final trio was ranked on VAL → optimistic selection among 10 (see Check 7).
  4. **Combination stages are dead.** `g2-freeze.json` and `g3-freeze.json` are **K=0, gates=[]**; `all-results.jsonl` has **only 382 G1 rows**. Root cause (code + data): `topFeats` dedupe in `tr-run.cjs:69` compares `r.feat` which is `undefined` for every row, so only 1 "distinct" feature is kept → 0 pairs, 0 trios. The claimed G1–G4 pipeline collapsed to G1 only. (G4's val result is stored nowhere either.)

## Check 4 — Fib claim: PASS

- `fibOk` distribution: `{0: 904}` — **zero signals with `fibOk==1`** (890 decided also all 0). Claim verified.
- Recompute for 10 random signals from candles (24-candle swing, first-low-vs-first-high rule, direction context): 10/10 exact.
- Contingency explains it: `inZone==1` occurs only **3 times in 904** (all SELL with upSwing=1 → fibOk 0); no in-zone BUY-context case exists. The zero is a genuine data property, not a coding artifact.
- Consequence: the `fibOk==1` G1 gate selected n=0 (dead gate) — honestly labeled, but it inflates the K=382 gate count.

## Check 5 — Independence: PASS (numbers), but effective N tiny

| Finalist | Full 10h raw → indep | VAL raw → indep | VAL indep WR | VAL indep 95% Wilson |
|---|---|---|---|---|
| `structDown==1` | 209 → 26 | 103 → **12** | 66.67% | [39.1, 86.2] |
| `ret90<-0.000087` | 322 → 28 | 190 → **13** | 53.85% | [29.1, 76.8] |
| `Hp>=0.781789` | 281 → 35 | 148 → **16** | 62.5% | [38.6, 81.5] |

Freeze `indepN` values (14/12, 15/13, 19/16) reproduced exactly. The 300s-spaced number of genuinely independent val observations is 12–16, so the headline val WRs carry CIs fully compatible with ~50–60%.

## Check 6 — Prospective honesty: FAIL

- Timing: `p3raw/p000.json fetched_at = 2026-09-16T01:21:24.730Z` **after** `frozen_at = 2026-09-16T01:20:43.421Z` → **PASS** on that item.
- **But the P3 data window (00:20:00–00:46:20Z) ended ~34 min BEFORE the freeze** → not prospective in the strict post-freeze sense; it is only "after the discovery dataset".
- **The finalists' `n=0` is an artifact, not an evaluation.** Because the frozen specs lost `feat/op/th`, `tr-prosp.cjs:46` builds `{feat:undefined,op:undefined,th:undefined}`; `evalGate` falls through to `s[undefined]===0` → selects nothing. `prospective-results.json` shows empty `"gate": {}` objects and `n=0` for all three. No status/notes field exists in the file (neither "insufficient" nor otherwise); tr-run's DB meta row said `PROSPECTIVE_EVIDENCE_INSUFFICIENT`, while tr-prosp's meta row lists the finalists as `null%|n=0|indep=0` as if evaluated.
- **Base z120 independently rebuilt from `p3raw`**: 3 014 ticks, 317 candles, 35 signals, **20 decided, 0/20 wins, WR 0.00%, all 20 BUY** (net window move −0.0373%). Reported numbers match exactly; DB P3 candles cross-check (317 rows, first 5 closes) identical.
- **True evaluation of the intended gates on P3** (independent implementation): `structDown==1` → **0/18**; `ret90<-0.000087` → **0/3**; `Hp>=0.781789` → **0/16**. The finalists would have failed the prospective tranche anyway; the published `n=0` is vacuous ("never evaluated") and hides a 0/18-type result. Sample is tiny (26 min, ~5–6 independent clusters), but it is not success and not evidence.

## Check 7 — Multiple-testing sanity: PASS (consistency), caveats

- Best TRAIN gate `ret180<-0.000104`: **n=133, w=113, WR 84.96%, wilsonLo 77.91** stored == recomputed 77.91 (consistent). Its VAL result is 70.23% (n=215) — best-train ≠ best-val, as expected under selection.
- `q` fields: present for **382/382** G1 rows; **324 with q≤0.05**, 213 q=0. Caveat: p/q are TRAIN binomial tests vs **p=0.5** (train base WR = 63.18%), so nearly every gate "rejects 50%" regardless of drift; q does not cover VAL or correlation.
- Perm max-stat p=0.0025 claimed: **not stored in `g1-freeze.json`** (keys: generated_at/parent/note/K/gates), but stored in DB `iqopt_benchmark_meta` (`run_id='tr-z120-t300-2026-09-16'` → `totals.perm_p=0.0025`). Independent light re-run (label permutation within TRAIN, 400 perms, max WR over top-60 gates, n≥30) → **p=0.0025**, same value (resolution floor 1/401).
- VAL >70% plausibility: **35 of 111** gates with val n∈[100,190] have val WR ≥70%. Expected counts: **≈0** under 50/50; **≈5.9** under drift-only (p=0.634); **≈18.7** under a direction-mix null (each gate's own BUY/SELL composition at base rates 71.18%/48.31%). So the >70% cluster is *not coin-flip chance*, but it is largely a BUY-tilt/drift phenomenon; the residual excess is confounded by train-selection and massive gate correlation (the list is dominated by near-duplicate oversold-BUY gates: ret30/60/90/300, rsi, stoch, cci, wpr, 16/35 exactly 100% BUY).
- Finalist significance after adjustment: single-gate p under the direction-mix null = 9.5e-3 (structDown), 4.8e-2 (ret90), 1.8e-3 (Hp); ×10 candidates → 0.095 / 0.48 / 0.018; ×382 gates → 3.6 / 18.3 / 0.69. No finalist clears multiplicity convincingly, and at cluster level (Check 5) all are inconclusive.

---

## Discrepancy register (all confirmed with evidence)

| # | Finding | Evidence |
|---|---------|----------|
| D1 | Finalist specs not self-contained (`{id}` only) → caused P3 `n=0` artifact | `finalists-freeze.json`; `tr-run.cjs:55,105`; `tr-prosp.cjs:46` |
| D2 | Freeze hash = `sha16(id)`, not gate hash | `036122155802f739 == sha16("structDown==1")` vs g1 hash `952bd6e1e6e0f291` |
| D3 | G2/G3 stages vacuous (K=0), all-results = 382 G1 only; G4 val not persisted | `g2-freeze.json`, `g3-freeze.json`; `tr-run.cjs:69` (undefined-feat dedupe) |
| D4 | Gate ids round thresholds to 6 dp (off-by-one boundary signals in TRAIN recount) | `ret90 th=-0.0000866731…`, `Hp th=0.7817885815…` vs ids |
| D5 | P3 "prospective" window is pre-freeze; finalists never actually evaluated; no status field; intended gates truly 0/18, 0/3, 0/16 | `prospective-results.json`; `p3raw/p000.json`; independent rebuild |
| D6 | Finalists' reported VAL numbers are selected on VAL (3 of 10 train-candidates) and not multiplicity-cleared | Check 7 numbers; `cpVar<0.848044` (val 85.29%) excluded from candidacy |
| D7 | Minor: baseline `expected.sigPerHour=89.5` vs computed 90.4 (cosmetic); perm p at resolution floor | `baseline-reproduction.json`; `tr-run.cjs:63-65` |

## Overall verdict

- **Reproducible:** baseline counts (890/566/63.60%), z120 causality, split (535/347, embargo 8), finalist TRAIN/VAL metrics (with exact thresholds), fib zero-coexistence, indepN, and the perm p=0.0025.
- **Not established:** that any finalist has a genuine, tradeable edge. The VAL numbers are legitimate *arithmetic* but selection-biased and direction-mix/drift-loaded; the prospective test was never actually executed for the finalists (bug) and, when executed independently, fails (0/18, 0/3, 0/16 on 20 decided P3 signals); the gauntlet's combination stages never ran (K=0); and the strategy's asymmetry (discovery BUY WR 73.29% vs SELL 54.2%; finalists 89–100% BUY) makes it a regime bet, not a validated mean-reversion edge.
