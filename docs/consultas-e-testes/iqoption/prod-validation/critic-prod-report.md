# Adversarial Critic Report — Focused Prod Validation (V1/V3/V6/V7 + variants) on IQ Option 10h persisted datasets

**Date:** 2026-09-15 (local) · **Critic:** independent adversarial pass · **Artifacts inspected:** `prod-validation.cjs`, `prod-validation-manifest.json`, `prod-validation-results.json`, `gauntlet-compile.cjs`, `run-all.cjs`, GH `benchmark-freeze.json`, GH `REGISTRO-TECNICO-ESTRATEGIAS.md`, live Supabase (`iqopt_candles_5s`, `iqopt_benchmark`).
**Method:** fresh GH freeze fetched at review time; local frozen files hash-compared to GitHub; candles re-read from Supabase; own metrics code; own causality harness; 155 programmatic checks + targeted SQL.

---

## Verdict per requested check

### 1) IDENTIFICATION — **PASS**
- Freeze specs (GH, live): `prod_v1fib={"type":"prod","id":"reversion-v1-fib"}`, `prod_v3fib→reversion-v3-fib`, `prod_v6fib→reversion-v6-fib`, `prod_v7and→reversion-v7-and`, `prod_v7relaxed→reversion-v7-relaxed`, all `family=production, grp=G1_producao`; `prod_v2fib={"op":"gateFib","innerSpec":{"type":"rsi_vol","t":0.22,"v":0.0012}}`.
- `gauntlet-compile.cjs:78-82` (case `prod`) implements exactly those ids. Cross-checked line by line against the registry:
  - V1 (`REGISTRO.md:20-27`): `vol<0.0009` ∧ `|s|>0.33` ∧ fibOk (inZone + swing context) ✓
  - V3 (`:30-37`): `vol<0.0012` ∧ `s>0.22 & mom120>0` (mirror for SELL) ∧ fibOk ✓
  - V6 (`:40-47`): `vol<0.0009` ∧ `|s|∈[0.63,0.857]` ∧ fibOk ✓
  - V7-AND (`:50-56`): V1+Fib **AND** ATR-overshoot 3×ATR, same direction (`dev≤-3→BUY`, `dev≥3→SELL`, must equal V1 direction) ✓
  - V7-relaxed (`:59-63`): union ATR 1×ATR **OR** V1+Fib, conflict→WAIT, single side→that side ✓
- Manifest relations: `prod_v7and` = "principal (V7-AND)"; `prod_v7relaxed` = "VARIANTE DE V7 (união relaxada ATR 1x OU V1fib)" — V7 main vs variant correctly split. ✓
- V4/V5: 0 occurrences in freeze (972 strategy_ids scanned, 0 matches `/v4|v5/`) and 0 lines in the registry; registry sections are 1..5 = V1, V3, V6, V7-AND, V7-relaxado. **V4/V5 do not exist in this lineage.** ✓
- Minor doc gap: registry has no standalone V2 section (only "V2+Fib" mentioned as V3's base, `:32`); the distinct `prod_v2fib` spec in the freeze is consistent with V3 minus the 120s momentum filter. No integrity issue.

### 2) HASHES — **PASS**
- Recomputed `sha256(JSON.stringify(spec)).slice(0,16)` from the live GH freeze for all 10 manifest entries: **10/10 match** both `freeze.hash` and manifest, incl. `prod_v1fib=70a7bfcb568bec8c`, `prod_v3fib=acf733a866146537`, `prod_v6fib=4acbfbe1477cff67`, `prod_v7and=53173d3e4f31fb4e`, `prod_v7relaxed=853c0fb29b71ea6c`, `prod_v2fib=6f8b9001c63b7597`; baselines also 4/4. `freeze.hash_rule` equals this algorithm.
- Provenance note: local `benchmark-freeze.json` ≠ GH byte-wise **only** in `generated_at` (local 23:00:45Z vs GH 22:51:41Z); after dropping it, top-level fields and all 972 strategy entries are identical. The script reads GH at runtime, so this has no semantic impact.

### 3) NO PARAMETER CHANGES — **PASS**
- `prod-validation.cjs:27` does `m.spec = d.spec; m.hash = d.hash` directly from the GH freeze; the manifest's `spec` objects are the freeze objects, unaltered.
- Static scan of `prod-validation.cjs` for threshold/feature literals (`0.0009|0.0012|0.33|0.22|0.63|0.857|vol12|distSma20|threshold`): **zero matches**.
- `prod-validation.cjs:36` requires `gauntlet-compile.cjs`; that local file is **byte-identical to GitHub** (sha256 prefix `e4babe79d3791809` both). `run-all.cjs` also byte-identical (`d3f3a0efc548a422`). `compile()` is used as-is (`:56`), no wrappers.
- Purity: re-hashing every spec after `compile()` → unchanged; `compile()` has zero side effects.

### 4) CAUSALITY — **PASS**
Harness: engine extracted verbatim from the frozen `run-all.cjs` (prefix up to the IIFE), `precomputeEma` re-run before each `featuresAt` call (EMA arrays are module globals).
- **Truncation:** 20 random indices per dataset — `featuresAt(candles,i)` deep-equals `featuresAt(candles.slice(0,i+1),i)`: **20/20 BINARY, 20/20 OTC**.
- **Future perturbation:** 5 indices per dataset, mutated candle appended at `i+30` (open/high/low/close/n wildly altered) — `featuresAt` at `i` unchanged: **5/5 BINARY, 5/5 OTC**.

### 5) T+60 CONVENTION — **PASS**
- `run-all.cjs:78-80` (`buildRows`): `entry = cd[i].close` (bucket T), `si = byBucket.get(bucket+60000)`, label `0` if equal, `1` if settle>entry, `-1` if settle<entry, `null` if missing bucket.
- `prod-validation.cjs:40-43` (metrics): `null→unknown` (excluded), `0→draw` (excluded from n), WIN iff `x===y`.
- Numeric verification over **all** rows: **7171/7171 per dataset** match `sign(close[bucket+60000]−entry)`; 12 missing-settlement rows per dataset → `null`; `gaps=0` so bucket+60000 is exactly 12×5s; `entry===close[T]` and `t0===T+5000` on every row.

### 6) BINARY/OTC SEPARATION — **PASS**
- Results JSON is keyed solely by `dataset_id`; recursive scan for `pool|overall|combinad|global|total_w` keys → **none found**. No pooled WR anywhere.
- Recomputed independently: **BINARY prod_v1fib s=148, W=88, L=54, WR=61.97%** (6 draws); **OTC s=101, W=49, L=49, WR=50.00%** (2 draws, 1 unknown). Exact.

### 7) METRIC REPRODUCIBILITY — **PASS**
Own metrics code + frozen engine/compile + live GH freeze + candles re-read from Supabase. All 6 strategies × both datasets × `{signals,w,l,draws,unknown,wr,indepN,indepWR}` exact vs `prod-validation-results.json` (96/96 field comparisons).
- BINARY prod_v3fib: W=115 L=112 **WR=50.66** ✓ · BINARY prod_v7relaxed: W=164 L=130 **WR=55.78, indep 16/56.25** ✓ · OTC prod_v6fib: **4 signals, 3W/0L, 1 unknown, 100%** ✓ · OTC prod_v7and: **0 signals** ✓.
- SQL `iqopt_benchmark` (`grp='G1_producao'`): exactly the 6 prod ids per dataset; DB `metrics.signals/w/l` equal my recompute and equal JSON bench values (6/6 both datasets); JSON `cross_check` flags genuinely match DB. DB `spec_hash` equals the freeze hash for all 12 rows; DB specs deep-equal the freeze.
- Transparency note on my own first pass: 12 apparent hash "FAIL"s were **my** artifact — Postgres `jsonb` canonicalizes key order, so re-hashing the API-returned object differs from the freeze-authored serialization. The stored `spec_hash` matches the freeze exactly and specs are semantically identical. Not a validation defect.

### 8) VARIANTS vs MAINS — **PASS**
- `prod_v7and` (V7 main) and `prod_v7relaxed` (V7 variant) remain separate strategy_ids, separate entries in both dataset tables, and separate lines in the comparison table; nothing merged.
- `prod_v2fib` is version "V2 (variante)" with its own id — never merged into V1/V3 numbers. (Registry doc gap re: no V2 section, as noted.)

---

## Prominent small-sample caveats (do NOT read any WR as validated edge)
| Case | n (W/L/D/unk) | WR | Wilson 95% | indep n/WR |
|---|---|---|---|---|
| OTC prod_v6fib | 3/0/0/1 | 100% | [43.8, 100] | 0 — **not evidence** |
| OTC prod_v7and | 0/0/0/0 | — | — | **not validated on OTC at all** |
| BINARY prod_v7and | 3/2/0/0 | 60% | [23.1, 88.2] | 1/100% |
| BINARY prod_v6fib | 6/10/0/0 | 37.5% | [18.5, 61.4] | 2 |
| BINARY prod_v1fib | 88/54/6/0 | 61.97% | [53.8, 69.5] | **6/50%** (edge rests on overlapping signals) |
| BINARY prod_v7relaxed | 164/130/16/0 | 55.78% | [50.1, 61.3] | 16/56.25% [33.2, 76.9] — best of the set, still one 10h window |
| OTC prod_v3fib | 110/100/3/2 | 52.38% | [45.6, 59.0] | 12/41.67% |

Historical comparison values (`comparison.previous_hold_blind`: 75%/100%/100% etc.) carry n=1..20 and are honestly reported with n; no overclaiming observed, but they are not corroboration.

## Overall integrity verdict — **PASS**
The focused validation is internally faithful: identification, hashes, freeze provenance, no-parameter-change, causality, T+60 settlement, dataset separation, metric reproducibility and SQL cross-check all verify against independently obtained evidence. The only anomalies found were an explained `jsonb` re-serialization artifact on my side and two documentation gaps (no standalone V2 registry section; local freeze copy differs only in `generated_at`). **The numbers are trustworthy as computed; the trading edge is not established** — V6 OTC (n=3), V7and (n=5 binary / 0 OTC) and all independent subsamples are too small to support the headline WRs.

Artifacts: `critic-prod/repro-log.txt` (155 checks), `critic-prod/` scripts, `gh-freeze.json`, `gh-gauntlet-compile.cjs`, `gh-run-all.cjs`.
