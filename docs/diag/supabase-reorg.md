# TraceCom — Supabase credential reconciliation + storage reorg

- **Date:** 2026-09-18 (UTC)
- **Scope:** Railway service `tracecom-live-relay`, environment `production`; Supabase project (corrected ref) `cladmauwmuoeqongxzwb`
- **Mode:** PRACTICE only, **zero orders**, no trading logic changed (Brain G2, Feature Engine, Critic, Consensus, Quality Gate, JIT, Entry Location, MicroVeto, Portfolio/Execution gates and strategies untouched)
- **Raw evidence:** `docs/diag/supabase-reorg.raw.json`
- **Secrets:** no keys or passwords are recorded in this document or in the raw JSON

## 0. Phase 0 — reconciliation (which DB the relay actually used)

| Check | Result |
|---|---|
| Effective `DATABASE_URL` host (production) | `aws-0-us-west-2.pooler.supabase.com:5432` (Supabase pooler; host only quoted) |
| Pooler user | `postgres.<project-ref>` where `<project-ref>` is the **corrected** ref `cladmauwmuoeqongx**z**wb` |
| Database | `postgres` (Postgres 17.6 on Supabase) |
| Provided ref `cladmauwmuoeqongxwb` | **NXDOMAIN** — the ref as pasted is one character short (missing `z`) |
| Corrected ref `cladmauwmuoeqongxzwb` | resolves (Cloudflare edge) and is the project behind the live `DATABASE_URL` |
| Publishable key (`sb_publishable_…`) | validated against `auth/v1/settings` → HTTP 200 on the corrected project |
| Secret key (`sb_secret_…`) | validated against `storage/v1/bucket` → HTTP 200; **the single-line form as pasted worked** (no re-join of halves required) |
| Legacy anon JWT | `ref` claim carries the 19-char ref (typo); rejected by the real project — do not use |
| Legacy service_role JWT | not provided in full; not required (direct DB + new keys validated) |
| Railway Postgres | service `Postgres` exists but its deployment is **CRASHED** and no relay variable references it |

**Verdict:** the relay was **already pointing to this Supabase project** (corrected ref). It was not pointing to a different project and not to Railway Postgres. No credential migration was required; the only real problem was Supabase **read-only mode caused by exceeding the 500 MB free-tier database quota** (database was 1568 MB).

## 1. Phase 1 — credentials (server-side)

- `DATABASE_URL` was left **unchanged**: it already resolves to the correct project pooler with a working DB password (verified by connecting).
- `SUPABASE_URL` / server-side secret key were **not added**: no code reads them (`src/**`, `relay/**`, `api/**` checked; only `.env.example` placeholders exist for a future repository adapter). Adding unused secrets would only widen the attack surface.
- Variable names present on the service (names only): `DATABASE_URL`, `TOKEN_SIGNING_SECRET`, `RELAY_API_KEY`, `API_KEY_PEPPER`, `OPENCODE_GO_API_KEY`, `AI_MODEL`, `AI_PROVIDER`, `ALLOWED_ORIGINS`, `SHADOW_EXPERIMENT_ASSET`, `RAILWAY_*`.
- The relay was **redeployed once** with the current repo build (health/persistence-probe code); deployment `SUCCESS`, instance `RUNNING`. No env change was applied.

## 2. Phase 2 — storage audit and classification

Quota: Supabase Free = **500 MB database size**. Measured before: `1 644 588 179` bytes = **1568.4 MiB** (≈314 % of the cap) with `default_transaction_read_only=on` (writes failing with SQLSTATE `25006`; even temp files failed with `No space left on device`).

| Classification | Tables | Action |
|---|---|---|
| **CRITICAL_HISTORY** | `iq_audit_trail`, `iq_trade_journal`, `iq_executions`, `iq_strategy_reviews`, `iq_legacy_strategy_audit`, `iq_auth_session`, `schema_migrations` | Kept. `iq_audit_trail` trimmed/partitioned **only after verified archive**. Nothing dropped. |
| **OPERATIONAL** | `iq_markets`, `iq_runtime_config`, `live_frames`, `live_sessions`, `live_events`, `live_access_logs`, `live_api_keys`, `ai_provider_config`, `strategy_selection(+_audit)`, `price_observations`, `market_contexts`, `ground_truths`, `vision_market_samples`, `live_decisions`, `live_settlements`, `state_transitions`, `shadow_*`, `quant_*`, `frozen_*`, `operational_sessions`, `fwd_*`, `agent_runs`, `decision_provenance`, `trace_spans`, `network_hops`, `diagnostic_logs` | Kept. Only retention windows applied where documented. |
| **REGENERABLE** | `iqopt_raw_ticks`, `iqopt_candles_5s`, `iqopt_decisions`, `iqopt_benchmark(+_meta)`, `iqopt_datasets`, `training_sessions` | Archived to `.jsonl.gz` + checksums, then dropped/deleted. No runtime code references (`relay/**`, `src/**`); collectors/reprocessors live only under `docs/consultas-e-testes/**`. |
| **DISPOSABLE** | `live_ingest_nonces` (expired), `live_access_logs`, `live_events`, `live_frames` payloads | Archived where useful, then trimmed by retention window. |
| **PLATFORM (do not touch)** | `auth.*`, `storage.*`, `realtime.*`, `vault.*`, `drizzle.*`, legacy SaaS `public.*` (users/plans/payments/…) | Untouched. |

## 3. Archives (archive-first, verified)

Location: `C:\Users\junin\AppData\Local\Temp\opencode\supabase-reorg\archive\` (outside the repo). Each archive is gzip JSONL, re-read to count rows, sha256 recorded in `archive-manifest.json` (full hash in the raw JSON). Total **342.1 MiB / 14 files**.

| File | Content | Rows | MiB |
|---|---|---:|---:|
| `iqopt_raw_ticks_…jsonl.gz` | full orphan tick table | 2 104 104 | 26.57 |
| `live_frames_…(48h)…jsonl.gz` | frames older than 48 h | 7 515 | 237.09 |
| `live_frames_…(24h)…jsonl.gz` | remaining frames older than 24 h | 1 719 | 67.13 |
| `iq_audit_trail_…jsonl.gz` | audit rows older than 24 h (first pass) | 15 521 | 0.87 |
| `iq_audit_trail_20260917_trim.jsonl.gz` | audit rows trimmed by the retention job | 267 | 0.01 |
| `iqopt_candles_5s…` / `iqopt_decisions…` / `iqopt_benchmark…` / `_meta` / `_datasets` | research outputs | 265 955 / 110 343 / 2 036 / 18 / 11 | 4.12 |
| `live_events_…jsonl.gz` | all live events | 44 853 | 2.07 |
| `live_ingest_nonces_…jsonl.gz` | expired anti-replay nonces | 44 855 | 1.54 |
| `live_access_logs_…jsonl.gz` | access logs older than 48 h | 260 107 | 2.57 |
| `training_sessions_…jsonl.gz` | single payload row | 1 | 0.11 |

> Move these to durable object storage; the retention job reads `RETENTION_ARCHIVE_DIR` and can write to any mounted path.

## 4. Pruning steps and space recovered

MB = MiB. “DB after” is `pg_database_size` right after the step.

| # | Step | Recovered | DB after |
|---|---|---:|---:|
| 1 | `DROP iqopt_raw_ticks` (archived first) | 660.26 | 908.1 |
| 2 | `live_frames` trim >48 h + `VACUUM FULL` | 380.55 | 527.6 |
| 3 | `live_frames` trim >24 h + `VACUUM FULL` | 109.36 | 418.3 |
| 4 | `iq_audit_trail` trim >24 h (archived) + `VACUUM FULL` | 21.28 | 397.1 |
| 5 | `DROP iqopt_candles_5s` (archived) | 52.97 | 344.1 |
| 6 | `DROP iqopt_decisions` (archived) | 16.27 | 327.8 |
| 7 | `DROP iqopt_benchmark` + `_meta` + `_datasets` (archived) | 2.58 | 325.2 |
| 8 | `TRUNCATE live_events` (all archived) | 52.12 | 273.3 |
| 9 | `TRUNCATE live_ingest_nonces` (all expired, archived) | 10.26 | 263.1 |
| 10 | `training_sessions` row archived + deleted + `VACUUM FULL` | ≤8.9 | ~262 |
| 11 | `live_access_logs` trim >48 h (archived) + `VACUUM FULL` | 37.99 | 216.9 |
| 12 | Drop unused indexes (`live_access_logs_key_timestamp_idx`, `iq_audit_trail_market_idx`) | 7.54 | — |
| 13 | `VACUUM FULL` bloat leftovers (`shadow_trades`, `iq_executions`, `decision_provenance`, `iq_markets`, `fwd_*`) | ~2.3 | 207.1 |
| 14 | `iq_audit_trail` → daily RANGE partitions (data moved, legacy dropped after 0-missing check) | data retained | ~216 |
| 15 | Retention job live run: dropped empty `…_20260916`, archived+deleted 267 audit rows, deleted 930 access logs | — | — |

**Result: 1568.4 MiB → 217.9 MiB (−1350.5 MiB, −86 %)** with headroom under the 500 MB quota; writes/read-only state recovered automatically (`default_transaction_read_only=off`).

## 5. Retention policy (implemented in `scripts/db-retention.mjs`)

| Table | Window | Mechanism |
|---|---|---|
| `iq_audit_trail` (CRITICAL_HISTORY) | 24 h hot | daily RANGE partitions; **archive (verified) → DROP PARTITION**; straddling/default partitions archive → `DELETE`; upcoming partitions auto-created; `DEFAULT` partition guarantees inserts never fail |
| `live_frames` | 24 h | archive → delete; `TRUNCATE`/`VACUUM FULL` reclaim; move to object storage if the vision pipeline resumes |
| `live_events` | 48 h | delete (optional archive via `RETENTION_ARCHIVE_NON_CRITICAL=1`) |
| `live_access_logs` | 48 h | delete (same flag) |
| `live_ingest_nonces` | expiry + 24 h | delete |

- Run: `DATABASE_URL=… RETENTION_ARCHIVE_DIR=… node scripts/db-retention.mjs` — schedule every 1–6 h (Railway cron service or GitHub Action). `--check` plans without writing; `--migrate-partition` performs the partitioned swap safely (initial copy + incremental copy under `ACCESS EXCLUSIVE`, integrity check, legacy dropped only if no row is missing).
- Vacuum: every run does `VACUUM (ANALYZE)`; set `RETENTION_VACUUM_FULL=1` weekly for non-partitioned tables (partitioned audit needs no `VACUUM FULL`).
- Migration `relay/migrations/028_iq_audit_trail_partitioning.sql` is safe on fresh databases (no-op if already partitioned; aborts if an unpartitioned table has rows so an operator runs the maintenance path).
- **Monitoring:** audit growth is currently ~8–14 k rows/h (~10–15 MB/h compressed by retention). If the 24 h window ever pushes the DB near 500 MB, reduce `AUDIT_RETENTION_HOURS` to 12 before considering a plan upgrade.

## 6. Phase 3 — proof (before → after)

| Check | Before | After |
|---|---|---|
| `PUT /api/ai/provider` | failing (`read-only transaction`, `25006`) | **HTTP 200 `CONFIGURED`** (existing key re-written unchanged; mask unchanged) |
| `POST /api/iq/persistence-probe` | endpoint absent in the deployed build | **HTTP 200, `ok=true`, `readBackOk=true`** |
| `GET /health` | `ok:true` hardcoded, no persistence block | **`ok=true`, `alerts=[]`, `persistence.state=HEALTHY`, `auditPersisting=true`, `readOnly=false`** |
| `iq_audit_trail` write→read | `25006` | probe row `PERSISTENCE_PROBE` written + read back; `max(created_at)` advancing |
| `iq_markets` | read-only | revision bumped by `IqMultiRuntime.setMarket` (same value) and persisted |
| `iq_runtime_config` | read-only | `updated_at`/`revision` advancing through the normal runtime path |
| DB size | 1568.4 MiB | 217.9 MiB |

Regression tests: `tests/ai/db-retention.test.ts` (7/7) for retention windows/partition math; full suite **1424 passed / 3 skipped**; `npm run typecheck` clean.

## 7. What the user still needs to do

1. **Schedule `scripts/db-retention.mjs`** (Railway cron or GitHub Action) with `DATABASE_URL` and a durable `RETENTION_ARCHIVE_DIR`. Without it the 24 h audit window is not enforced.
2. **Move the 342 MiB of archives** (local temp path above) to durable storage.
3. If any client still uses the **legacy anon/service_role JWTs**, regenerate them from the Supabase dashboard — the copies in circulation carry the mistyped ref and are rejected.
4. Optionally upgrade to Pro if >24 h of audit history must stay online; otherwise the retention job keeps the DB comfortably under 500 MB.
