# Adversarial critique — TraceCom IQ Option 10h benchmark (BINARY + OTC)

Date: 2026-09-15 · Auditor: independent adversarial critic · Method: re-fetched Supabase data, re-ran frozen engine/compiler, recomputed metrics and BH with own code, re-ran `benchmark.cjs` end-to-end.

Engine parity first: `run-all.cjs` (local) sha256 `d3f3a0ef…`, `gauntlet-compile.cjs` `e4babe79…`, `finalists-manifest.json`, `benchmark.cjs` `5428f050…` all byte-identical to GitHub raw (mirror confirmed). `benchmark.cjs` fetches the engine from GitHub at runtime and only strips the IIFE — no modification.

## 1) FREEZE INTEGRITY — PASS
- `benchmark-freeze.json`: 972 strategies, 972 unique hashes. Recomputed `sha256(JSON.stringify(spec)).slice(0,16)` for **all 972** → 0 mismatches; 10-random sample (seed 20260915) all exact. `benchmark-combos-freeze.json`: 3,906 defs, all recompute, 10/10 sample exact.
- Code order: freeze written at `benchmark.cjs:68`, first `GC.compile` at L90; combos-freeze at L114, first combo compile at L122. Rerun file times: freeze 20:00:45 → combos-freeze 20:00:46 → results 20:00:50.
- Caveat (disclosed, not hidden): G3's **candidate set** (63 atoms = ≥100 signals in ≥1 dataset) is data-dependent; the criterion is mechanical/recorded and the 3,906 hypotheses themselves are frozen before G3 evaluation.

## 2) CAUSALITY — PASS
- Truncation test with per-index EMA rebuilt: **20/20 PASS** per dataset (`featuresAt(full,i)` deep-equal `featuresAt(candles[0..i],i)`). Naive loops without rebuilding globals can show false diffs (stale EMA arrays) — my first pass hit that harness artifact; corrected, it is not leakage.
- Strongest test — mutate **all** candles k>i (+7%), rebuild EMA, recompute: **20/20 PASS** per dataset. No future dependence.
- Static scan of `featuresAt`: only `i+1` (slice end), `j+1`/`j+2` in pivot confirmation where `j ≤ i-2`. No index > i. `benchmark.cjs`'s own test in the rerun: PASS 50/50 both datasets.

## 3) DATA INTEGRITY — PASS
- Supabase `iqopt_candles_5s`: 7,201 candles each; 0 steps ≠ 5000 ms; 0 dups; span exactly 10.00 h; 7,171 rows per dataset.
- Settlement convention verified on all rows: entry = `close[i]`, label = sign(`close[bucket+60000] − entry`): **0 mismatches** (7,171/7,171 × 2).
- Provenance: rebuilt 5s candles from `combined_binary_1.json`/`combined_otc_76.json` raw ticks → identical buckets/OHLC/tick_count to Supabase; md5(ts,bid,ask) matches `results.json`. Counts match report exactly (BIN up 3643/dn 3221/draw 295/unk 12; OTC 3445/3599/115/12).

## 4) METRIC RECOMPUTATION — PASS
Own metrics function (frozen compiler for vectors, statistics computed independently), 5 strategies, both stored sources:
- BIN `mom_r_0.0001` sig 1834/W 956/L 819/WR 53.86/buy 58.77/sell 49.23/streaks 33-44 · BIN `gate(mom_f_0.0002|h12-17)` 220/129/83/60.85/60.56/60.99/35-9 · BIN `and(rsi_s_0.22,mom_r_0.0001)` 1448/791/611/56.42/58.06/54.39/42-41 · OTC `gate(struct_f|sessMin<30)` 227/135/90/60.00/64.23/53.41/30-14 · OTC `and(rsi_s_0.44,macd_f)` 171/92/40/69.70/65.18/95.00/17-11.
- All integers exact, WRs within 0.05 pp, indep n/WR exact. GC.compile vs my manual combination: identical z for all 20 stored BIN survivors + 2 OTC.

## 5) BINARY vs OTC SEPARATION — PASS
- `results.json` holds exactly 2 dataset entries (22 evaluated each), no pooled WR key anywhere.
- `iqopt_benchmark`: only the two dataset_ids, 0 mixed rows; 1,018 rows each (6 G1 + 962 G2 + 50 G3 top-50 per dataset; G0 baselines intentionally not persisted).
- Minor hygiene note: display name collision in OTC — `and(macd_f,stoch_r_25/30)` exist as both G2 (hash 877de8…/c744ed…) and G3 (f54b96…/290c9c…) rows. Distinct specs, distinct datasets — not mixed data.

## 6) STATISTICAL CALC — PASS (with a K nuance)
- z formula (`benchmark.cjs:80`) hand-checked on `mom_r_0.0001` BIN: recomputed 3.339353185 vs stored 3.339353182 → delta 0. Formula confirmed.
- OTC G3 survivor: z = 4.603976; p (engine's A&S normCdf) = 2.075e-6; p (accurate normal) = 2.072e-6. BH multiplicity is **mK = 3,383** (combos with n≥20, not 3,906 — stored `K=3906` is `arr.length`, incl. n<20). q = 2.075e-6 × 3383/2 (rank-1/2 tie) = **0.0035 = stored q**. Literal K=3906 would give ≈0.0041; magnitude sane either way. Full replication reproduces all top-20 q exactly and survivor counts (BIN 1049, OTC 2).
- Overlap caveat **is** in `benchmark-report.md` ("Aviso estatístico… SÃO OTIMISTAS"). OTC survivor `indep_n = 6` (4/6 = 66.7%) — weak independent evidence; already flagged.

## 7) REPRODUCTION — PASS
`benchmark.cjs` re-ran in 16.5 s: truncation PASS 50/50 both; FREEZE 972 (962/4/6); tested 968/invalid 0 both; G3 K=3906, survivors 1049/2, q 0.0037/0.0035. All four artifacts **byte-identical** after stripping `generated_at`; survivor lists and all 5 target strategies identical.

## 8) HONESTY — what I could NOT verify / discrepancies
- Upstream authenticity of IQ Option ticks is trusted (internal md5 chain consistent; no external source).
- Decision vectors come from the frozen compiler (permitted instrument); combination semantics re-implemented independently and matched on all stored survivors.
- G3 candidate-atom selection is data-dependent (frequency-based) — disclosed above; it inflates no WR-based claim but means G3 is not fully pre-registered.
- `K=3906` label vs effective BH mK=3,247/3,383 — presentational nuance only.
- GitHub-sourced engine at runtime = supply-chain risk if the repo changes later; hashes verified at audit time.
- TraceCon 1M exclusion is reasonable: `extension/local-engine.js` (13 KB) has no `decide*` function and no exports → "INCOMPATIVEL" as documented.
- Report says G2=962 while search-log has 968 non-prod/non-baseline entries; 6 collapsed by spec-hash dedup (977 + prod_v2fib + 4 finalists → 972 unique) — arithmetic consistent.

## FINAL VERDICT
1 PASS · 2 PASS · 3 PASS · 4 PASS · 5 PASS · 6 PASS · 7 PASS · 8 honest caveats.
The claim "968 strategies tested with 0 invalid, results reproducible, no leakage in v2" **survives** every attack: hashes verified on 100% of the freeze, causality holds under truncation and future-mutation, data reproduces from raw ticks, metrics/BH replicate exactly, and a full re-run is deterministic. No counterexample of leakage or fabrication was found.
Residual weaknesses are statistical, not procedural: overlapping 5s windows make z/q optimistic (explicitly caveated in the report), and the OTC G3 star rests on 132 resolved trades / 6 independent windows — evidence for "worth new validation", not for profitability. The only "errors" I found were in my own first replication (stale EMA globals; missing n≥20 in BH), both corrected here.
