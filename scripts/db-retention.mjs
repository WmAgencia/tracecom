#!/usr/bin/env node
/**
 * db-retention.mjs — retention + archival job for the TraceCom relay Postgres (Supabase).
 *
 * Safety model:
 *  - CRITICAL_HISTORY (iq_audit_trail) is ALWAYS exported to a checksummed .jsonl.gz before any
 *    partition DROP or row DELETE. Every archive is verified (row count re-read + sha256).
 *  - Never touches trading logic, never writes orders, never mutates strategy/config tables.
 *  - Partition drops only remove partitions whose upper bound is <= the retention cutoff.
 *
 * Modes:
 *   node scripts/db-retention.mjs                 # run one retention cycle
 *   node scripts/db-retention.mjs --check         # plan only, no writes
 *   node scripts/db-retention.mjs --migrate-partition  # convert iq_audit_trail to daily RANGE partitions
 *
 * Env:
 *   DATABASE_URL                      required
 *   RETENTION_ARCHIVE_DIR             default: ./.retention-archive
 *   AUDIT_RETENTION_HOURS             default: 24
 *   FRAMES_RETENTION_HOURS            default: 24
 *   EVENTS_RETENTION_HOURS            default: 48
 *   ACCESS_LOGS_RETENTION_HOURS       default: 48
 *   NONCE_GRACE_HOURS                 default: 24
 *   RETENTION_PARTITION_DAYS_AHEAD    default: 7
 *   RETENTION_ARCHIVE_NON_CRITICAL    default: 0 (1 = archive frames/events/logs too)
 *   RETENTION_VACUUM_FULL             default: 0 (1 = VACUUM FULL trimmed non-partitioned tables;
 *                                                 can be run weekly in a maintenance window)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(SCRIPT_DIR, "..", "relay", "package.json"));
const pg = require("pg");

/* ------------------------------- pure helpers ------------------------------- */

/** @param {number|string} hours @returns {number} */
export function hoursToMs(hours) { return Math.max(0, Number(hours) || 0) * 3_600_000; }

/** @param {number} nowMs @param {number|string} hours @returns {number} */
export function cutoffMs(nowMs, hours) { return Number(nowMs) - hoursToMs(hours); }

/** @param {number} ms @returns {number} UTC midnight of that day */
export function utcDayStartMs(ms) {
  const d = new Date(Number(ms));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** @param {number} ms @returns {string} e.g. iq_audit_trail_20260918 */
export function partitionNameForDay(ms) {
  const d = new Date(utcDayStartMs(ms));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `iq_audit_trail_${y}${m}${day}`;
}

/** @param {number} ms @returns {{fromIso:string,toIso:string,fromMs:number,toMs:number}} */
export function partitionBoundsForDay(ms) {
  const fromMs = utcDayStartMs(ms);
  const toMs = fromMs + 86_400_000;
  return { fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString(), fromMs, toMs };
}

/** Parse `pg_get_expr(relpartbound, oid)` text. @param {string} text */
export function parsePartitionBound(text) {
  const s = String(text ?? "");
  if (/default/i.test(s)) return { isDefault: true, fromMs: null, toMs: null };
  const m = s.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/);
  if (!m) return null;
  const norm = (v) => v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const fromMs = Date.parse(norm(m[1]));
  const toMs = Date.parse(norm(m[2]));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return { isDefault: false, fromMs, toMs };
}

/** A partition can be dropped whole when its upper bound is at or before the cutoff. */
export function isPartitionDroppable(bound, cutoff) {
  return Boolean(bound && bound.isDefault !== true && bound.toMs !== null && bound.toMs <= Number(cutoff));
}

/**
 * Split partitions into `drop` (entirely older than cutoff), `trim` (straddles the cutoff)
 * and `keep`. Default partitions are never dropped (trimmed instead).
 * @param {Array<{name:string,bound:any}>} partitions
 * @param {number} cutoff
 */
export function planAuditPartitions(partitions, cutoff) {
  const plan = { drop: [], trim: [], keep: [] };
  for (const p of partitions ?? []) {
    if (!p?.bound) { plan.keep.push(p); continue; }
    if (isPartitionDroppable(p.bound, cutoff)) plan.drop.push(p);
    else if (p.bound.isDefault) plan.trim.push(p);
    else if (p.bound.fromMs !== null && p.bound.fromMs < cutoff) plan.trim.push(p);
    else plan.keep.push(p);
  }
  return plan;
}

/* ------------------------------- io helpers ------------------------------- */

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

async function countGzLines(file) {
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const _ of rl) n++;
  return n;
}

async function writeJsonlGz(file, rows) {
  const gz = zlib.createGzip({ level: 9 });
  const ws = fs.createWriteStream(file);
  gz.pipe(ws);
  for (const row of rows) {
    if (!gz.write(JSON.stringify(row) + "\n")) await new Promise((res) => gz.once("drain", res));
  }
  await new Promise((res, rej) => { ws.on("finish", () => res()); ws.on("error", rej); gz.on("error", rej); gz.end(); });
  const bytes = fs.statSync(file).size;
  const lines = await countGzLines(file);
  const sha256 = await fileSha256(file);
  return { file, rows: rows.length, lines, bytes, sha256 };
}

/* ------------------------------- main logic ------------------------------- */

/** @param {import('pg').Client} client @param {number} nowMs */
async function ensureAuditPartitions(client, nowMs, daysAhead, dryRun = false) {
  const kind = (await client.query(
    `select c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='iq_audit_trail'`,
  )).rows[0]?.relkind;
  if (kind !== "p") return { partitioned: false, created: [] };
  const created = [];
  for (let i = 0; i <= daysAhead; i++) {
    const dayStart = utcDayStartMs(nowMs) + i * 86_400_000;
    const bounds = partitionBoundsForDay(dayStart);
    const name = partitionNameForDay(dayStart);
    const exists = (await client.query(`select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`, [name])).rowCount > 0;
    if (exists) continue;
    if (!dryRun) await client.query(`create table public.${name} partition of public.iq_audit_trail for values from ('${bounds.fromIso}') to ('${bounds.toIso}')`);
    created.push(name);
  }
  return { partitioned: true, created, dryRun };
}

/** @param {import('pg').Client} client */
async function listAuditPartitions(client) {
  const rows = (await client.query(`
    select c.relname as name, pg_get_expr(c.relpartbound, c.oid) as bound
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relispartition
      and c.relname like 'iq_audit_trail_%'
    order by c.relname`)).rows;
  return rows.map((r) => ({ name: r.name, bound: parsePartitionBound(r.bound), boundText: r.bound }));
}

/**
 * Archive and delete audit rows older than cutoff. Partitioned tables drop whole partitions;
 * straddling/default partitions are trimmed with archive-then-delete batches.
 */
async function retainAuditTrail(client, { nowMs, hours, archiveDir, dryRun }) {
  const cutoff = cutoffMs(nowMs, hours);
  const kind = (await client.query(`select c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='iq_audit_trail'`)).rows[0]?.relkind;
  const result = { cutoff: new Date(cutoff).toISOString(), partitioned: kind === "p", dropped: [], trimmed: 0, archived: [] };
  const exportRows = async (where, label) => {
    if (dryRun) {
      const n = Number((await client.query(`select count(*)::int n from public.iq_audit_trail${where ? " where " + where : ""}`)).rows[0].n);
      return n ? { file: path.join(archiveDir, `${label}.jsonl.gz`), rows: n, lines: n, bytes: 0, sha256: null, dryRun: true } : null;
    }
    const rows = (await client.query(`select * from public.iq_audit_trail${where ? " where " + where : ""} order by id`)).rows;
    if (!rows.length) return null;
    fs.mkdirSync(archiveDir, { recursive: true });
    const file = path.join(archiveDir, `${label}.jsonl.gz`);
    const written = await writeJsonlGz(file, rows);
    if (written.lines !== rows.length) throw new Error(`archive verify failed for ${label}: ${written.lines} != ${rows.length}`);
    result.archived.push({ ...written, label });
    return written;
  };

  if (kind === "p") {
    const partitions = await listAuditPartitions(client);
    const plan = planAuditPartitions(partitions, cutoff);
    for (const p of plan.drop) {
      const rows = Number((await client.query(`select count(*)::int n from public.${p.name}`)).rows[0].n);
      if (rows > 0) await exportRows(null, `${p.name}_drop`);
      if (!dryRun) await client.query(`drop table public.${p.name}`);
      result.dropped.push({ name: p.name, rows, bound: p.boundText });
    }
    for (const p of plan.trim) {
      const archived = await exportRows(`created_at < to_timestamp(${cutoff / 1000})`, `${p.name}_trim`);
      if (!dryRun) {
        const del = await client.query(`delete from public.${p.name} where created_at < to_timestamp(${cutoff / 1000})`);
        result.trimmed += del.rowCount ?? 0;
      } else if (archived) result.trimmed += archived.rows;
    }
  } else {
    const archived = await exportRows(`created_at < to_timestamp(${cutoff / 1000})`, `iq_audit_trail_trim`);
    if (!dryRun) {
      const del = await client.query(`delete from public.iq_audit_trail where created_at < to_timestamp(${cutoff / 1000})`);
      result.trimmed += del.rowCount ?? 0;
    } else if (archived) result.trimmed += archived.rows;
  }
  return result;
}

/** Archive (optional) then delete rows older than cutoff from an id-keyed table. */
async function retainIdTable(client, { table, column, hours, nowMs, archiveDir, dryRun, archive }) {
  const cutoff = cutoffMs(nowMs, hours);
  const total = Number((await client.query(`select count(*)::int n from public.${table} where ${column} < to_timestamp(${cutoff / 1000})`)).rows[0].n);
  const result = { table, cutoff: new Date(cutoff).toISOString(), candidates: total, deleted: 0, archived: null };
  if (total === 0) return result;
  if (archive && !dryRun) {
    fs.mkdirSync(archiveDir, { recursive: true });
    const rows = (await client.query(`select * from public.${table} where ${column} < to_timestamp(${cutoff / 1000}) order by id`)).rows;
    const written = await writeJsonlGz(path.join(archiveDir, `${table}_${nowMs}.jsonl.gz`), rows);
    if (written.lines !== rows.length) throw new Error(`archive verify failed for ${table}`);
    result.archived = { ...written };
  }
  if (!dryRun) {
    const del = await client.query(`delete from public.${table} where ${column} < to_timestamp(${cutoff / 1000})`);
    result.deleted = del.rowCount ?? 0;
  } else {
    result.deleted = total;
  }
  return result;
}

/** Non-critical diagnostic windows (PRE/POST SHADOW LAB): plain row retention, no archive needed. */
async function retainMarketWindows(client, { hours, nowMs, dryRun }) {
  const cutoff = cutoffMs(nowMs, hours);
  const tableExists = Number((await client.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='iq_trade_market_windows'`)).rows[0].n) > 0;
  if (!tableExists) return { table: "iq_trade_market_windows", cutoff: new Date(cutoff).toISOString(), candidates: 0, deleted: 0, skipped: "TABLE_ABSENT" };
  const total = Number((await client.query(`select count(*)::int n from public.iq_trade_market_windows where created_at < to_timestamp(${cutoff / 1000})`)).rows[0].n);
  if (total === 0) return { table: "iq_trade_market_windows", cutoff: new Date(cutoff).toISOString(), candidates: 0, deleted: 0 };
  if (dryRun) return { table: "iq_trade_market_windows", cutoff: new Date(cutoff).toISOString(), candidates: total, deleted: total };
  const del = await client.query(`delete from public.iq_trade_market_windows where created_at < to_timestamp(${cutoff / 1000})`);
  return { table: "iq_trade_market_windows", cutoff: new Date(cutoff).toISOString(), candidates: total, deleted: del.rowCount ?? 0 };
}

/** LATE WINDOW TIMING (030): observacoes SHADOW da politica de timing. Retencao simples, sem arquivo. */
async function retainTimingPolicyObservations(client, { hours, nowMs, dryRun }) {
  const cutoff = cutoffMs(nowMs, hours);
  const tableExists = Number((await client.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='iq_timing_policy_observations'`)).rows[0].n) > 0;
  if (!tableExists) return { table: "iq_timing_policy_observations", cutoff: new Date(cutoff).toISOString(), candidates: 0, deleted: 0, skipped: "TABLE_ABSENT" };
  const total = Number((await client.query(`select count(*)::int n from public.iq_timing_policy_observations where created_at < to_timestamp(${cutoff / 1000})`)).rows[0].n);
  if (total === 0) return { table: "iq_timing_policy_observations", cutoff: new Date(cutoff).toISOString(), candidates: 0, deleted: 0 };
  if (dryRun) return { table: "iq_timing_policy_observations", cutoff: new Date(cutoff).toISOString(), candidates: total, deleted: total };
  const del = await client.query(`delete from public.iq_timing_policy_observations where created_at < to_timestamp(${cutoff / 1000})`);
  return { table: "iq_timing_policy_observations", cutoff: new Date(cutoff).toISOString(), candidates: total, deleted: del.rowCount ?? 0 };
}

/** @param {import('pg').Client} client */
async function purgeNonces(client, { nowMs, graceHours, dryRun }) {
  const cutoff = cutoffMs(nowMs, graceHours);
  const total = Number((await client.query(`select count(*)::int n from public.live_ingest_nonces where expires_at < to_timestamp(${cutoff / 1000})`)).rows[0].n);
  if (dryRun || total === 0) return { candidates: total, deleted: dryRun ? total : 0 };
  const del = await client.query(`delete from public.live_ingest_nonces where expires_at < to_timestamp(${cutoff / 1000})`);
  return { candidates: total, deleted: del.rowCount ?? 0 };
}

/* ------------------------------- entrypoints ------------------------------- */

/** @param {import('pg').Client} client */
export async function migrateAuditPartition(client) {
  const kind = (await client.query(`select c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='iq_audit_trail'`)).rows[0]?.relkind;
  if (kind === "p") return { alreadyPartitioned: true };
  if (kind !== "r") throw new Error("iq_audit_trail not found");
  const before = Number((await client.query("select count(*)::int n from public.iq_audit_trail")).rows[0].n);

  await client.query("begin");
  try {
    await client.query(`create table public.iq_audit_trail_p (
      like public.iq_audit_trail including defaults including constraints
    ) partition by range (created_at)`);
    await client.query(`alter table public.iq_audit_trail_p add primary key (id, created_at)`);
    await client.query(`create index iq_audit_trail_p_correlation_idx on public.iq_audit_trail_p (correlation_id, id)`);
    const nowMs = Date.now();
    for (let i = -2; i <= 14; i++) {
      const dayStart = utcDayStartMs(nowMs) + i * 86_400_000;
      const bounds = partitionBoundsForDay(dayStart);
      const name = partitionNameForDay(dayStart);
      await client.query(`create table public.${name} partition of public.iq_audit_trail_p for values from ('${bounds.fromIso}') to ('${bounds.toIso}')`);
    }
    await client.query(`create table public.iq_audit_trail_p_default partition of public.iq_audit_trail_p default`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  // Initial copy outside the swap lock, then a final delta copy under ACCESS EXCLUSIVE so no
  // row committed in between can be lost.
  await client.query(`insert into public.iq_audit_trail_p select * from public.iq_audit_trail`);
  await client.query("begin");
  try {
    await client.query(`lock table public.iq_audit_trail in access exclusive mode`);
    await client.query(`insert into public.iq_audit_trail_p
      select * from public.iq_audit_trail t
      where t.id > coalesce((select max(id) from public.iq_audit_trail_p), 0)`);
    await client.query(`alter sequence public.iq_audit_trail_id_seq owned by none`);
    await client.query(`alter table public.iq_audit_trail rename to iq_audit_trail_legacy`);
    await client.query(`alter table public.iq_audit_trail_p rename to iq_audit_trail`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  const after = Number((await client.query("select count(*)::int n from public.iq_audit_trail")).rows[0].n);
  const legacyCount = Number((await client.query("select count(*)::int n from public.iq_audit_trail_legacy")).rows[0].n);
  const missingInNew = Number((await client.query(
    `select count(*)::int n from public.iq_audit_trail_legacy l
     where not exists (select 1 from public.iq_audit_trail p where p.id = l.id)`,
  )).rows[0].n);
  if (missingInNew > 0 || after < legacyCount) {
    throw new Error(`row integrity check failed after swap: new=${after} legacy=${legacyCount} missingInNew=${missingInNew} — legacy table kept`);
  }
  await client.query("drop table public.iq_audit_trail_legacy");
  await client.query("analyze public.iq_audit_trail");
  return { alreadyPartitioned: false, rowsBefore: before, rowsAfter: after, legacyRows: legacyCount };
}

/** @param {{databaseUrl:string, archiveDir:string, dryRun?:boolean, nowMs?:number, env?:Record<string,string|undefined>}} cfg */
export async function runRetention(cfg) {
  const env = cfg.env ?? process.env;
  const nowMs = cfg.nowMs ?? Date.now();
  const dryRun = cfg.dryRun === true;
  const opts = {
    auditHours: Number(env.AUDIT_RETENTION_HOURS ?? 24),
    framesHours: Number(env.FRAMES_RETENTION_HOURS ?? 24),
    eventsHours: Number(env.EVENTS_RETENTION_HOURS ?? 48),
    logsHours: Number(env.ACCESS_LOGS_RETENTION_HOURS ?? 48),
    nonceGraceHours: Number(env.NONCE_GRACE_HOURS ?? 24),
    marketWindowHours: Number(env.MARKET_WINDOW_RETENTION_HOURS ?? 168),
    timingPolicyHours: Number(env.TIMING_POLICY_RETENTION_HOURS ?? 168),
    partitionDaysAhead: Number(env.RETENTION_PARTITION_DAYS_AHEAD ?? 7),
    archiveNonCritical: env.RETENTION_ARCHIVE_NON_CRITICAL === "1",
    vacuumFull: env.RETENTION_VACUUM_FULL === "1",
  };
  const archiveDir = cfg.archiveDir;
  const client = new pg.Client({ connectionString: cfg.databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("set statement_timeout=0; set default_transaction_read_only=off; set work_mem='64MB'; set max_parallel_workers_per_gather=0");
  const summary = { at: new Date(nowMs).toISOString(), dryRun, opts, ensurePartitions: null, audit: null, frames: null, events: null, accessLogs: null, nonces: null, marketWindows: null, timingPolicy: null, vacuum: [] };
  try {
    summary.ensurePartitions = await ensureAuditPartitions(client, nowMs, opts.partitionDaysAhead, dryRun);
    summary.audit = await retainAuditTrail(client, { nowMs, hours: opts.auditHours, archiveDir, dryRun });
    summary.frames = await retainIdTable(client, { table: "live_frames", column: "created_at", hours: opts.framesHours, nowMs, archiveDir, dryRun, archive: true });
    summary.events = await retainIdTable(client, { table: "live_events", column: "event_timestamp", hours: opts.eventsHours, nowMs, archiveDir, dryRun, archive: opts.archiveNonCritical });
    summary.accessLogs = await retainIdTable(client, { table: "live_access_logs", column: "timestamp", hours: opts.logsHours, nowMs, archiveDir, dryRun, archive: opts.archiveNonCritical });
    summary.marketWindows = await retainMarketWindows(client, { hours: opts.marketWindowHours, nowMs, dryRun });
    summary.timingPolicy = await retainTimingPolicyObservations(client, { hours: opts.timingPolicyHours, nowMs, dryRun });
    summary.nonces = await purgeNonces(client, { nowMs, graceHours: opts.nonceGraceHours, dryRun });
    if (!dryRun) {
      const touched = ["iq_audit_trail", "live_frames", "live_events", "live_access_logs", "live_ingest_nonces", "iq_trade_market_windows", "iq_timing_policy_observations"];
      for (const table of touched) {
        try {
          if (opts.vacuumFull && !["iq_audit_trail"].includes(table)) await client.query(`vacuum (full, analyze) public.${table}`);
          else await client.query(`vacuum (analyze) public.${table}`);
          summary.vacuum.push({ table, mode: opts.vacuumFull && table !== "iq_audit_trail" ? "FULL" : "ANALYZE" });
        } catch (error) { summary.vacuum.push({ table, error: String(error?.message ?? error).slice(0, 120) }); }
      }
    }
  } finally {
    await client.end();
  }
  return summary;
}


const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error(JSON.stringify({ error: "DATABASE_URL missing" })); process.exit(2); }
  const archiveDir = process.env.RETENTION_ARCHIVE_DIR || path.join(process.cwd(), ".retention-archive");
  const dryRun = args.includes("--check");
  if (args.includes("--migrate-partition")) {
    const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query("set statement_timeout=0; set default_transaction_read_only=off");
    const result = await migrateAuditPartition(client);
    await client.end();
    console.log(JSON.stringify({ mode: "migrate-partition", ...result }, null, 1));
    process.exit(0);
  }
  const summary = await runRetention({ databaseUrl, archiveDir, dryRun });
  console.log(JSON.stringify(summary, null, 1));
  if (dryRun) process.exit(0);
}
