# TraceCom — Storage Audit (DB full / read-only)

- **Date:** 2026-09-18 (UTC)
- **Scope:** `tracecom-live-relay` production persistence (`iq_markets`, `iq_runtime_config`, `iq_audit_trail`)
- **Evidence:** `docs/diag/storage-audit.raw.json` (raw numbers, both snapshots, flap probe, runtime probe, supplementary schema/time probe)
- **Mode:** read-only audit + one rolled-back write probe; **zero orders; no trading logic changed**; one real probe row written only in `iq_audit_trail` (`PERSISTENCE_PROBE`, id `154328`).

## 0. Executive summary

| Item | Value |
|---|---|
| Database actually used | **Supabase Postgres 17.6** (`aws-0-us-west-2.pooler.supabase.com`), database `postgres` |
| Railway Postgres (`postgres-volume`) | **Crashed and unreferenced** by `tracecom-live-relay` / `tracecom-forward4` env vars |
| DB size (snapshot 1, 13:56Z) | `1 643 744 403` bytes = **1568 MB** |
| DB size (snapshot 2, 14:05Z) | `1 644 563 603` bytes = **1568 MB** |
| Tablespace `pg_default` | **1582 MB** (`pg_global` 0.7 MB) |
| WAL | 10 files / **128 MB** |
| Free-tier reference limit | Supabase Free = **500 MB** database size → current ≈ **313 % of the free cap** |
| Read-only state | `default_transaction_read_only=on` at 13:56Z; **insert probe → SQLSTATE `25006`**; temp-file write → **`No space left on device`**; DB later flapped (a write window at 14:02–14:03Z succeeded, read-only returned 14:05Z) |
| Last confirmed successful production writes | **2026-09-18 12:23:38Z** (`iq_runtime_config.updated_at`, `live_access_logs.max(timestamp)`) |
| Root cause | Storage exhaustion, not a code bug; write amplification + tables no longer written by the current code left unchecked |

> **Railway volume expansion is NOT the fix.** The 500 MB limit is Supabase's; the Railway Postgres service is crashed and unused by these services. Manual action = Supabase plan/disk (section 4). This must not be silently ignored: while read-only, `iq_markets`, `iq_runtime_config` and `iq_audit_trail` writes fail.

## 1. Size audit (raw)

Sizes are `pg_total_relation_size` (heap + indexes + TOAST). MB = MiB (1 048 576 bytes). Snapshot 2 (14:05Z).

### Top consumers

| Table | Total MB | Heap MB | Index MB | TOAST MB | Rows (exact/bounded) | Dead tuples | Data window (UTC) |
|---|---:|---:|---:|---:|---:|---:|---|
| `iqopt_raw_ticks` | **660.26** | 419.88 | 240.23 | 0.01 | ~2 104 104 (reltuples 2 146 250) | 7 127 | 2026-09-08 → 09-16 |
| `live_frames` | **489.84** | 1.32 | 2.84 | **485.65** | 9 234 | 2 | 2026-09-14 → 09-16 |
| `iq_audit_trail` | **145.38** | 121.91 | 23.41 | 0.01 | **154 417** | 0 | 2026-09-17 → 09-18 (open) |
| `iqopt_candles_5s` | 52.97 | 28.77 | 24.16 | 0.01 | ~263 786 | 320 | 2026-09-08 → 09-16 |
| `live_events` | 52.12 | 31.23 | 20.85 | 0.01 | 44 853 | 2 | 2026-09-14 → 09-16 |
| `live_access_logs` | 46.91 | 29.95 | 16.92 | 0.01 | ~327 892 | 0 | 2026-09-14 → 09-18 |
| `iqopt_decisions` | 16.27 | 13.02 | 3.22 | 0.01 | 110 343 | 0 | 2026-09-15 |
| `price_observations` | 13.29 | 8.42 | 4.83 | 0.01 | 25 179 | 0 | 2026-09-14 → 09-16 |
| `live_ingest_nonces` | 10.26 | 5.94 | 4.28 | 0.01 | 44 855 (**all expired**) | 7 | 2026-09-14 → 09-16 |
| `training_sessions` | 8.87 | 0.01 | 0.03 | **8.80** | 1 | 0 | 2026-09-14 |
| `agent_runs` | 8.84 | 6.34 | 2.46 | 0.01 | 8 824 | 0 | 2026-09-14 → 09-15 |
| `decision_provenance` | 8.25 | 6.72 | 1.49 | 0.01 | 7 354 | 19 | 2026-09-14 → 09-15 |
| `market_observations` | 6.59 | 3.66 | 2.89 | 0.01 | 12 449 | 0 | 2026-09-14 → 09-15 |
| `shadow_trades` | 6.16 | 3.27 | 2.86 | 0.01 | 6 878 | **826 (12 %)** | 2026-09-14 |
| `diagnostic_logs` | 5.97 | 3.78 | 2.15 | 0.01 | 12 287 | 0 | 2026-09-14 → 09-16 |
| `trace_spans` | 4.73 | 3.39 | 1.30 | 0.01 | 13 477 | 0 | 2026-09-14 → 09-15 |
| `vision_market_samples` | 4.68 | 2.73 | 1.91 | 0.01 | 9 224 | 0 | 2026-09-14 → 09-16 |
| `live_decisions` | 4.20 | 2.69 | 1.47 | 0.01 | 8 906 | 0 | 2026-09-14 → 09-15 |
| `iqopt_benchmark` (+`_meta`, `_datasets`) | 2.59 | 2.24 | 0.28 | 0.01 | 2 054 | 3 | 2026-09-15 |
| `iq_runtime_config` | 1.56 | 0.27 | 0.02 | **1.26** | 1 | 0 | updated 2026-09-18 12:23 |
| `market_contexts` | 1.44 | 1.03 | 0.37 | 0.01 | 1 821 | 0 | 2026-09-14 → 09-15 |
| `fwd_*` (forward4, 6 tables) | 1.42 | — | — | — | ~2 100 | 158 | 2026-09-15 |
| `iq_trade_journal` | 0.48 | 0.12 | 0.06 | 0.28 | 68 | 0 | 2026-09-17 |
| `operational_sessions` | 0.41 | 0.18 | 0.02 | 0.19 | 31 | 7 | 2026-09-14 → 09-15 |
| `iq_executions` | 0.41 | 0.20 | 0.17 | 0.01 | 239 | 23 | 2026-09-16 → 09-17 |
| `state_transitions` | 0.24 | 0.16 | 0.05 | 0.01 | 148 | 0 | 2026-09-14 → 09-15 |
| Legacy SaaS `public.*` (users, plans, payments, customers, providers, api_keys, refresh_tokens, audit_logs, credit_ledger, stripe_events, request_logs, usage_events, models, objects, …) | ~1.2 | — | — | — | < 50 | 0 | 2026-08-29 |
| Supabase-managed `auth.*`, `storage.*`, `realtime.*`, `vault.*`, `drizzle.*` | ~1.5 | — | — | — | — | 0 | DO NOT TOUCH |

Everything else in `public` is < 0.1 MB. Full 112-relation list with heap/index/TOAST, estimates, counts, dead tuples, index scans and time ranges: `storage-audit.raw.json` (`snapshots.run2.tables`, `.indexes`, `.toast`).

### Largest indexes

| Table | Index | MB | idx_scan |
|---|---|---:|---:|
| `iqopt_raw_ticks` | `iqopt_raw_ticks_ds_ts` | 194.91 | 167 |
| `iqopt_raw_ticks` | `iqopt_raw_ticks_pkey` | 45.27 | 0 |
| `iqopt_candles_5s` | `iqopt_candles_5s_pkey` | 24.16 | 211 |
| `iq_audit_trail` | `iq_audit_trail_market_idx` | 10.52 | 3 |
| `live_access_logs` | `live_access_logs_key_timestamp_idx` | 9.88 | 0 |
| `iq_audit_trail` | `iq_audit_trail_correlation_idx` | 9.45 | 3 |
| `live_events` | `live_events_session_sequence_idx` | 8.99 | 5 |
| `live_access_logs` | `live_access_logs_pkey` | 7.04 | 0 |
| `live_events` | `live_events_sequence_id_key` | 5.22 | 0 |

### Bloat / activity notes

- `pg_stat_user_tables.n_dead_tup`: `iqopt_raw_ticks` 7 127, `shadow_trades` 826 (12 %), `fwd_events` 90, `fwd_profile_events` 58, `iq_markets` 29, `iq_executions` 23, `decision_provenance` 19.
- `pg_stat_database`: `xact_commit` 1 672 408, `tup_inserted` 7 923 459, `tup_deleted` 4 497 627, `temp_files` 4 472 / **23.3 GB temp bytes** (temp spills), `deadlocks` 0.
- **Write amplification:** `iq_runtime_config` is a 1-row table whose TOAST is 1.26 MB (apprentice_json 365 kB + research_json 196 kB) and is re-written by `office()` every ~60 s. Each rewrite creates new TOAST versions + WAL (~1.8 MB/min). This is a major WAL/IO churn source (see proposal B6).
- `iq_audit_trail` growth: 154 417 rows / 145 MB in ~36 h → **~102 k rows/day, ~96 MB/day**. Top stages: `CANDIDATE_UPDATED` (66 174 rows / 55.7 MB), `AGENTS` (42 980 / 24.7 MB), `CANDIDATE_CANCELLED` (6 715 / 10.9 MB), `FINAL_REVALIDATION` (6 688 / 9.3 MB). Average `detail` 723 B, max 1 945 B.

## 2. Table classification

**CRITICAL_HISTORY** (audit/legal — keep; archive before any deletion)

| Table | Why |
|---|---|
| `iq_audit_trail` | Immutable decision-stage trail (who/why/when). Legal/forensic. |
| `iq_trade_journal` | Per-trade structured journal (source of truth). |
| `iq_executions` | Broker executions, acknowledgements and settlements (reconciliation evidence). |
| `iq_strategy_reviews`, `iq_legacy_strategy_audit` | Strategy review history + pre-G2 config snapshot. |
| `iq_auth_session` | Encrypted IQ session (`ssid_enc`/`iv`/`tag`) — custody/credential, 1 row. Never log/export plaintext. |
| `schema_migrations` | Migration ledger. |

**OPERATIONAL** (needed for runtime correctness / startup)

| Table | Why |
|---|---|
| `iq_runtime_config` | Single-row runtime state read on boot (mode, stakes, JIT/quality flags, resolver/research/supervisor/apprentice/hypotheses JSON). |
| `iq_markets` | 55 rows: enablement, paused, `configured_stake`, caps, revision, active_id/availability cache read on boot. |
| `live_api_keys`, `live_sessions`, `operational_sessions`, `ai_provider_config`, `strategy_selection(+_audit)` | Auth/session/resume/config state. |
| `price_observations`, `market_contexts`, `ground_truths`, `vision_market_samples`, `live_decisions`, `live_settlements`, `state_transitions` | Decision provenance chain for the live pipeline; recent window needed for replay/audit. |
| `shadow_experiments`, `shadow_experiment_checkpoints`, `shadow_trades`, `shadow_jobs`, `quant_decisions`, `quant_model_versions` | Quant shadow experiment state (10 k-trade target); keep until experiment closes. |
| `agent_runs`, `decision_provenance`, `trace_spans`, `network_hops`, `diagnostic_logs`, `live_events` | Observability for a specific decision; needed only for a recent window. |
| `promotion_audit`, `promotion_state`, `frozen_signals`, `frozen_latest_signal` | Frozen-strategy audit/state (legacy, small). |

**REGENERABLE** (rebuildable from broker/reference/reprocessing)

| Table | Justification |
|---|---|
| `iqopt_raw_ticks` | Orphaned raw tick capture (2026-09-08→16). **No `*.mjs`/`*.ts` in the repo references it**; source was a removed collector. Re-collectable from the broker feed; not required by the current runtime. |
| `iqopt_candles_5s` | Derived from `iqopt_raw_ticks` (bucket OHLC + tick_count). |
| `iqopt_decisions`, `iqopt_benchmark`, `iqopt_benchmark_meta`, `iqopt_datasets` | Offline research outputs; recomputable from datasets/strategies. |
| `fwd_events`, `fwd_profile_events`, `fwd_profile_decisions`, `fwd4_trades`, `fwd*_runs` | Forward-test shadow records; recomputable from observations + frozen strategies. Small. |
| `training_sessions` | One 8.8 MB payload row; the training set is reproducible (dataset export). |
| `shadow_*`, `quant_*` | Recomputable from stored feature snapshots if required. |

**DISPOSABLE** (logs/scratch/duplicated)

| Table | Justification |
|---|---|
| `live_ingest_nonces` | Anti-replay nonces; **all 44 855 rows are expired** (`expires_at < now()`). |
| `live_access_logs` | API access log (endpoint/status/latency). Regenerable as noise; security retention window only. |
| `diagnostic_logs`, `trace_spans`, `network_hops` | Diagnostic logs/traces; retention window only. |
| `live_frames` | Raw vision crop payloads already consumed by the vision pipeline (9 234 rows × ~53 kB). No reader since 2026-09-16. Archive if reprocessing is desired. |
| Legacy SaaS `public.*` (2026-08-29) | Orphan tables from a previous product (`users`, `plans`, `payments`, `subscriptions`, `customers`, `providers`, `api_keys`, `refresh_tokens`, `audit_logs`, `credit_ledger`, `credit_balances`, `stripe_events`, `request_logs`, `usage_events`, `models`, `objects`). Confirm owner before dropping. |
| Supabase-managed `auth.*`, `storage.*`, `realtime.*`, `vault.*`, `drizzle.*` | Platform-owned. **Protected — never drop.** |

## 3. Retention / archival / partitioning proposal (no execution)

Ordering matters: **free space first, then compact/index, then partition, then continuous retention.**

| # | Action | Recovered (MB) | Risk | Notes |
|---|---|---:|---|---|
| **A1** | Export `iqopt_raw_ticks` to object storage (Parquet/JSONL.gz, checksum + manifest), verify, then `DROP TABLE iqopt_raw_ticks` | **-660** | MEDIUM | Instant reclaim (no vacuum needed). Data is orphaned/re-collectable. Keep compressed archive ≥ 90 d. |
| **A2** | Export `live_frames` payloads, then `DELETE`/`TRUNCATE` frames older than 7 d; `VACUUM FULL live_frames` (or `pg_repack`) | **-486** | MEDIUM | All rows are > 2 d old; consumer is the vision pipeline (stopped 09-16). TRUNCATE is instant; VACUUM FULL needs ~486 MB free — do it **after A1**. |
| **A3** | `DELETE FROM live_ingest_nonces WHERE expires_at < now()` then `VACUUM FULL` | **-10** | LOW | 100 % expired; anti-replay unaffected. Keep a TTL purge job afterwards. |
| **A4** | Archive + `DROP` legacy `iqopt_candles_5s`, `iqopt_decisions`, `iqopt_benchmark`, `iqopt_benchmark_meta`, `iqopt_datasets` | **-72** | MEDIUM | No code references; regenerable from archived ticks. |
| **A5** | Export `training_sessions` payload to object storage, `DELETE` row | **-9** | LOW | Reproducible dataset. |
| **A6** | Drop unused indexes: `live_access_logs_key_timestamp_idx` (0 scans, 9.9 MB), `iq_audit_trail_market_idx` (3 scans, 10.5 MB), `live_ingest_nonces_expiry_idx` after A3 (0.98 MB) | **-21** | LOW | Keep `correlation_idx` for forensics. Recreate per-partition later if needed. |
| **A7** | Legacy SaaS public tables (owner sign-off) | **-1** | MEDIUM | Not TraceCom data. |
| **A8** | `VACUUM FULL`/`pg_repack` tables with dead tuples (`shadow_trades` 826, `iq_executions` 23, `decision_provenance` 19, `iq_markets` 29, `fwd_*` 148) | **-5…8** | LOW | Do not use `VACUUM FULL` while disk is full. |
| — | **Subtotal immediate** | **≈ -1 250** | — | 1568 MB → **≈ 320 MB** |

Estimated immediate recovery: `660 + 486 + 10 + 72 + 9 + 21 + 1 + 6 ≈ 1 265 MB`, DB → ~303–320 MB (under the 500 MB free cap again).

**Continuous policy (per table)** — with observed rates, no retention = ~160 MB/day refill while the full pipeline runs:

| Table | Policy | Steady-state size | Reclaimed/day |
|---|---|---:|---:|
| `iq_audit_trail` | Monthly/day partitions by `created_at`; keep **48 h hot** (24 h on free 500 MB); nightly compressed archive; drop oldest partition after archive verification | ~190 MB (48 h) / ~95 MB (24 h) | ~96 MB/day |
| `live_events` | Monthly partitions; keep **24 h** | ~23 MB | ~23 MB/day |
| `live_access_logs` | Weekly partitions; keep **7 d** (48 h if free tier) | ~80 MB / ~23 MB | ~11 MB/day |
| `price_observations`, `market_observations`, `vision_market_samples` | Monthly partitions; keep **3–7 d** | ~20 MB | ~14 MB/day |
| `diagnostic_logs`, `trace_spans`, `network_hops`, `agent_runs`, `decision_provenance`, `live_decisions` | Keep **48 h–7 d** (only when the live pipeline is active) | ~20–45 MB | ~26 MB/day |
| `live_frames` | **Do not retain in Postgres**: write to object storage, keep ≤ 24 h or nothing | ~0–50 MB | ~100+ MB/day |
| `live_ingest_nonces` | Hourly `DELETE WHERE expires_at < now() - interval '24 hours'` | < 2 MB | ~10 MB once |
| `iq_trade_journal`, `iq_executions`, `iq_strategy_reviews`, `iq_legacy_strategy_audit`, `iq_auth_session`, `iq_markets`, `iq_runtime_config`, `shadow_*`, `quant_*` | Keep (small, auditable); partition only `iq_executions`/`iq_trade_journal` if volume grows | ~10 MB | — |

**Partitioning mechanics (example, `iq_audit_trail`)** — needs headroom ≈ table size; run in a maintenance window:

```sql
CREATE TABLE iq_audit_trail_p (LIKE iq_audit_trail INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
  PARTITION BY RANGE (created_at);
CREATE TABLE iq_audit_trail_2026_09 PARTITION OF iq_audit_trail_p
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
INSERT INTO iq_audit_trail_p SELECT * FROM iq_audit_trail;
ALTER TABLE iq_audit_trail RENAME TO iq_audit_trail_old;
ALTER TABLE iq_audit_trail_p RENAME TO iq_audit_trail;
-- recreate correlation index on the parent; verify counts/checksums
-- DROP TABLE iq_audit_trail_old;   -- only after verification
```

**Compaction guidance**

- `DROP`/`TRUNCATE`: instant, returns files to the OS. Preferred for orphan tables.
- `VACUUM FULL`: `AccessExclusiveLock`, rewrites the table, needs free space ≈ heap+TOAST. Use for cold tables **after A1/A3**.
- `pg_repack`: online rewrite, no long lock; use for hot tables (`iq_audit_trail`, `live_*`) if the extension is available on the Supabase plan. Do **not** attempt either while the DB reports read-only/full.
- Optional **B6**: reduce `iq_runtime_config` write amplification (persist only on revision change or every 15 min; move `apprentice_json`/`research_json` to dedicated rows/table). LOW risk (persistence cadence only, not trading logic) and saves WAL/IO churn.

## 4. What the user must do manually (exact actions)

1. **Identify the real limit (Supabase, not Railway).**
   - Open `https://supabase.com/dashboard/project/_/settings/infrastructure` for the project behind `aws-0-us-west-2.pooler.supabase.com` and read **Disk size** / **Database size**.
   - Also check `Billing → Usage` (Database size, Disk usage).
   - Current measured: **1 644 563 603 bytes (1568 MB)** in database `postgres` + **128 MB WAL**; `pg_default` 1582 MB. If the plan is Free (500 MB), usage is **~313 % of the cap** and read-only is expected. If Pro, compare against the project's configured disk add-on.
2. **Decide expansion vs cleanup.**
   - Sustainable fix: **upgrade/expand in Supabase** (Pro includes 8 GB database; add Disk in `Settings → Infrastructure` / compute add-on if needed). At the observed audit growth (~96 MB/day) cleanup alone is a short-term fix.
   - Because DB exceeds 500 MB by 3×, freeing space requires plan section 3 (A1–A8). Even so, **B1 partition/retention is mandatory** to avoid recurrence.
3. **Do NOT “fix” it by pointing `DATABASE_URL` at Railway Postgres.** The Railway `postgres-volume` is crashed and no service references it; switching without restoring/rebuilding would silently lose all current data.
4. **After space/plan is restored:** confirm `SELECT current_setting('default_transaction_read_only')` returns `off`; then run section 5 probe with `PROBE_CONFIG_MARKET=1` and confirm all three tables persist.
5. **Do not delete anything without an archive** (checksummed export + manifest). Steps A1–A5 in section 3 are archive-then-drop, in that order.

## 5. Persistence probe — evidence (task 5)

Task 5 is conditional (“only if it becomes available”). Space did **not** become durably available; the write state is **intermittent** (Supabase toggles `default_transaction_read_only` while the disk is over capacity):

| Time (UTC) | Event | Evidence |
|---|---|---|
| 12:23:38 | Last successful production writes | `iq_runtime_config.updated_at=12:23:38.23566`, `live_access_logs.max=12:23:38.136375` |
| 13:56:34 | Read-only confirmed | `default_transaction_read_only=on`, probe INSERT → `25006` |
| 13:56:35 | Disk-full confirmed | `could not write to file base/pgsql_tmp/pgsql_tmp448422.0: No space left on device` |
| **14:02:41** | **Audit probe SUCCEEDED** | Normal path `IqMultiRuntime.persistProbe()` inserted `iq_audit_trail` **id 154328** and read it back (`stage=PERSISTENCE_PROBE`, `readBackOk=true`); health `HEALTHY` |
| 14:03:05 | Momentary read-write | `dro=off/tro=off`, `count=154366`, last audit 14:03:01 |
| 14:05:22 | Read-only again | INSERT probe → `25006` |
| 14:05:40–14:06:14 | Flap test 8/8 | all INSERTs → `25006`, `dro=on/tro=on` |
| 14:06:50 | Runtime probe FAILED (current state) | `persistProbe` → `25006`; `persistenceHealth = UNAVAILABLE`, `alerts=[PERSISTENCE_UNAVAILABLE, DB_DEGRADED]`, `auditPersisting=false` |

`iq_markets` and `iq_runtime_config` could not be probed safely during read-only windows without risking config overwrite. The ready-to-run probe (`persistence-probe.mjs`, value-preserving: reloads production config, re-persists the same values, reads `updated_at`/`revision` back) must be run with `PROBE_CONFIG_MARKET=1` **after** space/plan is restored:

```
$env:NODE_PATH="<repo>\node_modules"; $env:RELAY_DIR="<repo>"; $env:PROBE_CONFIG_MARKET="1"
npx --yes @railway/cli@latest run --service tracecom-live-relay --environment production -- node <temp>\persistence-probe.mjs
```

## 6. Health / alerting (implemented)

Requirement: read-only tolerance may remain for **availability**, but health must expose explicit operational alerts and must **never** report fully healthy while audit is not persisting.

**`relay/iq-multi-runtime.mjs`**

- Tracks every persistence outcome (`audit`, `config`, `market`, `execution`): last success/failure, consecutive failures, sanitized error `{kind, code, message}`.
- Detects read-only via `current_setting('transaction_read_only')` and via write errors (`25006` / “read-only transaction”).
- `persistenceHealth()` → `{ ok, state: HEALTHY|DEGRADED|UNAVAILABLE|UNKNOWN, alerts, dbReady, readOnly, auditPersisting, audit|config|market last-ok/last-error }`.
  - `UNAVAILABLE` → alert **`PERSISTENCE_UNAVAILABLE`** (no pool / DB not ready / read-only).
  - Audit failing or any write failing → `DEGRADED` (or `UNAVAILABLE` when read-only) → alert **`DB_DEGRADED`**.
  - `ok === true` **only** when state is `HEALTHY`.
- `office()` now includes `health`; `brokerAudit()` includes `persistence`; `status()` exposes the office payload.
- New public `persistProbe()` writes one `PERSISTENCE_PROBE` row through the normal SQL path and reads it back (used by the manual probe and by the API).

**`relay/server.mjs`**

- `GET /health` no longer hardcodes `{ ok:true, db:true }`. It returns HTTP **200** (keeps Railway availability/healthcheck) with `{ ok, db, alerts, persistence }`; `ok` is `false` whenever persistence is not `HEALTHY`.
- `GET /api/iq/office` → adds `health` (see `office()`).
- `GET /api/iq/broker-audit` → adds `persistence`.
- `POST /api/iq/persistence-probe` (admin header `x-relay-admin`) → one real probe row + read-back; HTTP 200 on success, 503 with the exact error otherwise.

**Regression test:** `tests/ai/persistence-health.test.ts` (4 cases)

- Read-only (`25006`) → `UNAVAILABLE` + `PERSISTENCE_UNAVAILABLE` + `DB_DEGRADED`, `auditPersisting=false`, `office().health.ok=false`.
- Disk-full (`53100`) → `DEGRADED` + `DB_DEGRADED` (never `HEALTHY`).
- Healthy insert + read-back → `HEALTHY`, `ok=true`.
- No pool → `PERSISTENCE_UNAVAILABLE`.

## 7. Verification

| Check | Result |
|---|---|
| `npx vitest run tests/ai` | **608/608 pass, 43/43 files** (final run). One intermediate parallel run flaked on `tests/ai/office-v3-perf.test.ts` (p95 34.05 ms vs < 33.33 ms budget); it passes 8/8 in isolation and on the final run — pre-existing flaky perf test, unrelated to this change |
| `npx tsc -p tsconfig.json --noEmit` | **exit 0** |
| New tests | `tests/ai/persistence-health.test.ts` 4/4 pass |
| Read-only evidence | SQLSTATE `25006`; `No space left on device`; flap test 8/8 |
| Probe evidence | success id `154328` (14:02:41Z, read back); failure `25006` (14:06:50Z) with expected alerts |

**Bottom line:** free ~1.25 GB immediately via section 3 (A1–A8) and/or expand the Supabase plan; then enable the continuous retention policy (B1–B5). The health endpoint now reports `DB_DEGRADED` / `PERSISTENCE_UNAVAILABLE` instead of the previous hardcoded `{ ok:true, db:true }`.
