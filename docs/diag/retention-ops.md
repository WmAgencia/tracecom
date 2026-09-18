# TraceCom — durable archives + scheduled retention (ops finalize)

- **Date:** 2026-09-18 (UTC)
- **Scope:** Railway `tracecom-live-relay` project (`cozy-nature`, environment `production`); Supabase project ref `cladmauwmuoeqongxzwb`
- **Mode:** PRACTICE only, **zero orders**; Brain G2, Feature Engine, Critic, Consensus, Quality Gate, JIT, Entry Location, MicroVeto, Portfolio/Execution gates and strategies untouched; MCP read-only
- **Secrets:** none in this document or in the repo. Server-side only: Railway variables, GitHub secrets, local env. All verification used the secret key in the `apikey` header (the new-format `sb_secret_…` key is rejected as `Authorization: Bearer` by Storage write endpoints — `Invalid Compact JWS`).

## 1. Durable archives (Task 1)

The 14 local `.jsonl.gz` archives (342.1 MiB, sha256 recorded) moved out of
`C:\Users\junin\AppData\Local\Temp\opencode\supabase-reorg\archive\` (temp) to **Supabase Storage**.

| Item | Value |
|---|---|
| Provider / project | Supabase Storage, ref `cladmauwmuoeqongxzwb` |
| Bucket | `tracecom-archives` (**private**) |
| Prefix (reorg batch) | `archives/2026-09-18/` |
| Sha256 index | `archives/retention-index.jsonl` in the bucket (one JSON line per archive: object path, bytes, rows, sha256, parts) |
| Per-file sidecars | `<object>.meta.json` next to each archive (same fields, used to rebuild the index) |
| Original reorg manifest | `archives/2026-09-18/archive-manifest.json` (durable copy; local copy in temp is disposable) |
| Objects | 15 archives + 15 sidecars + 1 manifest = 37 objects, **358,747,529 bytes ≈ 342.1 MiB** (free tier: 1 GB) |
| Upload/verification | every object re-listed after upload; **size must match byte-for-byte**, plus MD5/etag when the API exposes a single-part etag. Files > free-tier 50 MB cap are split into 45 MiB parts (`.part-001-of-00N`, zero-padded = restore order). |
| Local temp copies | **deleted only after size/integrity verification** — the temp archive dir now holds only `archive-manifest.json` |

`live_frames_2026-09-18T14-50-56-617Z.jsonl.gz` (248,606,938 B) → 6 parts;
`live_frames_2026-09-18T14-55-51-258Z.jsonl.gz` (70,395,028 B) → 2 parts; the other 13 archives are single objects.

### Sha256 index (durable copies of these exact values live in the bucket)

| Object (`archives/2026-09-18/…`) | Rows | Bytes | sha256 | Parts |
|---|---:|---:|---|---:|
| `iqopt_raw_ticks_2026-09-18T14-43-33-908Z.jsonl.gz` | 2 104 104 | 27 856 908 | `d4fc6ad5e2ad3ab368becdc5ac5668e3c139cecf8bccbb7af26b43060932295b` | 1 |
| `live_frames_2026-09-18T14-50-56-617Z.jsonl.gz` | 7 515 | 248 606 938 | `1aebd890c35d763029dfc993c8da57c640f6043bed2421676a987eda811e0f45` | 6 |
| `live_frames_2026-09-18T14-55-51-258Z.jsonl.gz` | 1 719 | 70 395 028 | `7666648189ad9946e006f6aa203226f0823b7f9cd912add41575ce4e8503b672` | 2 |
| `iq_audit_trail_2026-09-18T14-55-08-712Z.jsonl.gz` | 15 521 | 909 214 | `649df8e91d2668c2febbf30f21c2c7999dad51213e781fa27448d5b1d80eeafe` | 1 |
| `iq_audit_trail_20260917_trim.jsonl.gz` (cron run 15:44 UTC) | 1 047 | 51 859 | `cad8c3459fd51f98ecec9cf35b0f94de3e77f961699ed1a6658e94cb453885e8` | 1 |
| `20260918T155058Z-iq_audit_trail_20260917_trim.jsonl.gz` (manual run 15:50 UTC) | 31 | 2 013 | `c8ea7248957fd5cc9f45cee11752f1fdeb8c4e9d366a4ee26b99d2d2a71237e9` | 1 |
| `iqopt_candles_5s_2026-09-18T14-56-59-616Z.jsonl.gz` | 265 955 | 3 195 210 | `fb32b07f9c81ef814b532a962e39eba254f3ccbc1d125c7f5508aeb50690f9d6` | 1 |
| `iqopt_decisions_2026-09-18T14-57-57-834Z.jsonl.gz` | 110 343 | 936 833 | `801ca6fb732d9bcefd4b8c9802a53b22ff4a5b5dc9f18222439e9277f8ab6cd8` | 1 |
| `iqopt_benchmark_2026-09-18T14-58-14-787Z.jsonl.gz` | 2 036 | 185 717 | `69a4e8d0ff16efd2a68191d75ae30cc53ec340ffaff071eb42a14165bf6149fe` | 1 |
| `iqopt_benchmark_meta_2026-09-18T14-58-19-162Z.jsonl.gz` | 18 | 4 319 | `1c065bb79b0c6793a9bf60103ebaf2a73f6fc67f8ba5fb3331c1b820cb1b6052` | 1 |
| `iqopt_datasets_2026-09-18T14-58-22-165Z.jsonl.gz` | 11 | 1 053 | `0b19f492b07ed8217d4b3aaf1764c57f02e50da1cd0181b6143d52d6ef09c1a1` | 1 |
| `live_events_2026-09-18T14-58-49-786Z.jsonl.gz` | 44 853 | 2 166 274 | `93f29421fcb3c923f31a8164a49d2b00330afb6184d81420d561f88e804d46ef` | 1 |
| `live_ingest_nonces_2026-09-18T14-59-06-680Z.jsonl.gz` | 44 855 | 1 611 156 | `d703a13b4ef58dbbff53b5e44610ca40046299de288a22df985491492ffa5e91` | 1 |
| `training_sessions_2026-09-18T14-59-42-007Z.jsonl.gz` | 1 | 113 123 | `c9f2ff76fed314ae0b6b43540bbf81c3e8f285ec2fc5d8ff8e812b47713103e4` | 1 |
| `live_access_logs_2026-09-18T14-59-50-848Z.jsonl.gz` | 260 107 | 2 698 449 | `b852298ae89111fd4cb3f630790f19efb13e19fc441e773965748a46be61c042` | 1 |

**Known loss (pre-fix collision, disclosed):** during consolidation, the reorg trim archive
`iq_audit_trail_20260917_trim.jsonl.gz` (267 rows, 14 341 B, sha256 `ca6c9ec210624092e18279569d1b115b98d8e8c0cc4ce8d9de890d2623c831eb`)
was overwritten in the bucket by the first cron trim of the **same partition label** (1 047 rows, 51 859 B) because both
used the same object name. Impact: 267 audit rows from 2026-09-17 have no durable copy (audit history only, non-trading).
Fix: `scripts/retention-cron.mjs` (commit `4658abc`) now prefixes every uploaded object with `YYYYMMDDTHHMMSSZ-`, so runs can
never collide, and the Railway volume holds a durable staging copy until the verified upload succeeds.

### Restore from archive

```bash
BASE="https://cladmauwmuoeqongxzwb.supabase.co"
BUCKET="tracecom-archives"
P="archives/2026-09-18"

# single-part object (< 45 MiB) — $SUPABASE_SECRET_KEY is a server-side env var, never a repo value
curl -f -H "apikey: $SUPABASE_SECRET_KEY" "$BASE/storage/v1/object/$BUCKET/$P/<file>.jsonl.gz" -o file.jsonl.gz
sha256sum file.jsonl.gz            # must match the table/index
gunzip -c file.jsonl.gz | head

# chunked object: download parts in name order, concatenate, verify the sha256 of the whole file
for n in 001 002 003 004 005 006; do
  curl -f -H "apikey: $SUPABASE_SECRET_KEY" "$BASE/storage/v1/object/$BUCKET/$P/<file>.jsonl.gz.part-$n-of-006" -o part-$n
done
cat part-* > file.jsonl.gz
sha256sum file.jsonl.gz
# restore one row per line into the DB only if needed; the archive is gzip JSONL of the original rows
```

The source hash for each object is also in `archives/retention-index.jsonl` and in `<object>.meta.json`.

## 2. Scheduled retention (Task 2)

**Scheduler chosen: Railway cron service** (server-side, same project as the relay, no GitHub Actions secrets needed —
`git` remote exists but no `gh`/token is available to set Actions secrets, so Actions was not used).

| Setting | Value |
|---|---|
| Service | `tracecom-retention-cron` (id `0e5bb2b7-027c-4c8e-a9b6-57726e712aaa`) |
| Project / env | `cozy-nature` / `production` (same as the relay) |
| Source | Docker image `node:24-bookworm` (has `curl`) |
| Cron schedule | `0 */6 * * *` (every 6 h, **UTC**; min interval 5 min; delayed runs are skipped if the previous is still active) |
| Restart policy | `NEVER` (cron must exit) |
| Volume | `tracecom-retention-cron-volume` mounted at `/data` (durable staging) |
| Variables (server-side) | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET=tracecom-archives`, `RETENTION_ARCHIVE_DIR=/data/retention-archive`, `RETENTION_STORAGE_PREFIX=archives` |
| Start command | downloads `main` tarball, `npm i --no-save --prefix …/relay pg@8`, then `node /tmp/app/scripts/retention-cron.mjs` |
| Code | `scripts/retention-cron.mjs` (commits `b8e3885`, `4658abc`, pushed to `WmAgencia/tracecom@main`) |

The wrapper runs the existing `scripts/db-retention.mjs` (unchanged safety model: archive + re-read + sha256 **before**
any drop/delete), then uploads every archive to the bucket, verifies it (size + md5/etag), and only then deletes the local
staging copy. Pending files from a previous failed upload are retried on the next run (idempotent). If upload fails, the
file survives on the Railway volume and the run exits non-zero.

**How to change the retention window:** Railway dashboard → project `cozy-nature` → service `tracecom-retention-cron` →
**Variables** → set e.g. `AUDIT_RETENTION_HOURS=12` (also `FRAMES_RETENTION_HOURS`, `EVENTS_RETENTION_HOURS`,
`ACCESS_LOGS_RETENTION_HOURS`, `NONCE_GRACE_HOURS`, `RETENTION_PARTITION_DAYS_AHEAD`, `RETENTION_VACUUM_FULL=1`,
`RETENTION_ARCHIVE_NON_CRITICAL=1`). No code change, no redeploy of the relay; the next scheduled run picks it up.
Cron schedule itself: service → Settings → Cron Schedule.

**Proof of one run (Run Now via API `deploymentInstanceExecutionCreate`):**

- execution `1bde9829-192a-49e0-acd0-937289392776` → `EXITED` on deployment `662769fc-caba-4d7e-9276-d508ee95081e`.
- logs: `bucket existed` → `pending-uploaded: 0` → retention `auditTrimmed: 1047`, `accessLogsDeleted: 5339`,
  `framesDeleted/eventsDeleted/noncesDeleted: 0` → uploaded 1 object
  `archives/2026-09-18/iq_audit_trail_20260917_trim.jsonl.gz` (51 859 B, sha256 `cad8c3…`) → `done`.
- a first attempt with image `node:24-bookworm-slim` crashed (`curl: not found`); the image was switched to `node:24-bookworm`.

## 3. Verification (Task 3)

| Check | Result |
|---|---|
| `node scripts/db-retention.mjs` (manual, 15:50:16 UTC) | archived + trimmed 31 `iq_audit_trail` rows (sha256 `c8ea72…`, uploaded); deleted 951 `live_access_logs` rows; frames/events/nonces 0; `VACUUM (ANALYZE)` on 5 tables; no partition drops |
| DB size | **223.7 MiB → 224.0 MiB** (writes continue at ~96 MB/day; pages are reused, no `VACUUM FULL`) |
| `default_transaction_read_only` | `off` |
| `iq_markets` | 55 rows, latest `2026-09-18T15:10:12Z` — persists |
| `iq_runtime_config` | 1 row, updated at `2026-09-18T15:49:38Z` — persists |
| `iq_audit_trail` | partitioned (`relkind=p`), 148 400 rows, latest `2026-09-18T15:51:08Z`, 17 partitions (2026-09-17…10-02 + default) — persists |
| `GET /health` | 200, `ok=true`, `alerts=[]`, `persistence.state=HEALTHY`, `auditPersisting=true`, `readOnly=false` |
| `PUT /api/ai/provider` | **200** `CONFIGURED`, provider `openCodeGo`, model `deepseek-v4.1-flash`, key masked |
| `npx vitest run tests/ai/db-retention.test.ts` | **7 passed (7)** |
| `npx vitest run tests/ai` | **46 files / 636 tests passed**, 0 failed |
| `npx tsc -p tsconfig.json --noEmit` | exit 0 |

## 4. Manual steps left for the user

1. **None required** for the pipeline to keep working: cron runs every 6 h UTC, archives to the private bucket, DB stays under quota.
2. Optional: review the (tiny) Railway usage for `tracecom-retention-cron` + `tracecom-retention-cron-volume` and enable
   Railway failure notifications for that service.
3. If the Supabase secret key is rotated: update only the Railway variable `SUPABASE_SECRET_KEY` on the cron service (no repo change).
4. If audit history must be online for more than 24 h, raise `AUDIT_RETENTION_HOURS` (watch the 500 MB free-tier DB cap);
   the offline copies are always in the bucket.
5. The temp file `…\supabase-reorg\archive\archive-manifest.json` is redundant now (durable copy in the bucket) and can be deleted at will.
