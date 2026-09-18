#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runRetention } from "./db-retention.mjs";

const ARCHIVE_DIR = process.env.RETENTION_ARCHIVE_DIR || path.join(process.cwd(), ".retention-archive");
const BUCKET = process.env.SUPABASE_BUCKET || "tracecom-archives";
const PREFIX = (process.env.RETENTION_STORAGE_PREFIX || "archives").replace(/^\/+|\/+$/g, "");
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PART_BYTES = Number(process.env.RETENTION_PART_BYTES || 45 * 1024 * 1024);
const ATTEMPTS = Number(process.env.RETENTION_UPLOAD_ATTEMPTS || 4);
const INDEX_OBJECT = `${PREFIX}/retention-index.jsonl`;
const uploadOnly = process.argv.includes("--upload-only");

function log(event, data = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }, null, 1));
}

function supabaseBase() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, "");
  const db = process.env.DATABASE_URL || "";
  const ref = db.match(/\/\/postgres\.([a-z0-9]+)[:.@]/)?.[1] || db.match(/\/\/([a-z0-9]+)\.pooler\.supabase\.com/)?.[1];
  if (!ref) throw new Error("cannot derive Supabase URL — set SUPABASE_URL");
  return `https://${ref}.supabase.co`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function storageFetch(url, options, label) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) return res;
      lastError = new Error(`${label} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < ATTEMPTS) await sleep(2000 * attempt);
  }
  throw lastError;
}

async function ensureBucket(base) {
  const res = await storageFetch(
    `${base}/storage/v1/bucket`,
    { method: "POST", headers: { apikey: SECRET, "content-type": "application/json" }, body: JSON.stringify({ name: BUCKET, public: false }) },
    "create-bucket",
  );
  if (res.ok) return { created: true };
  const text = await res.text();
  if (/exist/i.test(text)) return { created: false, existed: true };
  throw new Error(`create-bucket -> HTTP ${res.status}: ${text.slice(0, 200)}`);
}

async function listObjects(base, prefix) {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await storageFetch(
      `${base}/storage/v1/object/list/${BUCKET}`,
      {
        method: "POST",
        headers: { apikey: SECRET, "content-type": "application/json" },
        body: JSON.stringify({ prefix: `${prefix}/`, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
      },
      "list",
    );
    if (!res.ok) throw new Error(`list ${prefix} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
    offset += batch.length;
  }
  const map = new Map();
  for (const o of out) {
    const rawSize = o?.metadata?.size ?? o?.metadata?.contentLength ?? null;
    const size = rawSize === null ? null : Number(rawSize);
    const etag = String(o?.metadata?.eTag ?? o?.metadata?.etag ?? "").replaceAll('"', "").toLowerCase();
    map.set(o.name, { size: Number.isFinite(size) ? size : null, etag });
  }
  return map;
}

function encodeObjectPath(p) {
  return p.split("/").map((s) => encodeURIComponent(s)).join("/");
}

async function uploadBuffer(base, objectPath, buffer, contentType) {
  const res = await storageFetch(
    `${base}/storage/v1/object/${BUCKET}/${encodeObjectPath(objectPath)}`,
    { method: "POST", headers: { apikey: SECRET, "content-type": contentType, "x-upsert": "true", "cache-control": "no-store" }, body: buffer },
    `upload ${objectPath}`,
  );
  if (!res.ok) throw new Error(`upload ${objectPath} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function md5Hex(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

function splitToParts(file) {
  const size = fs.statSync(file).size;
  const count = Math.max(1, Math.ceil(size / PART_BYTES));
  const base = path.basename(file);
  const fd = fs.openSync(file, "r");
  const parts = [];
  try {
    for (let i = 0; i < count; i++) {
      const start = i * PART_BYTES;
      const length = Math.min(PART_BYTES, size - start);
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, start);
      const name = `${base}.part-${String(i + 1).padStart(3, "0")}-of-${String(count).padStart(3, "0")}`;
      const partFile = path.join(path.dirname(file), `.upload-${name}`);
      fs.writeFileSync(partFile, buffer);
      parts.push({ name, file: partFile, bytes: length, md5: md5Hex(buffer) });
    }
  } finally {
    fs.closeSync(fd);
  }
  return parts;
}

async function verifyRemote(base, objectPath, local) {
  const dir = path.dirname(objectPath);
  const name = path.basename(objectPath);
  const map = await listObjects(base, dir);
  const entry = map.get(name);
  if (!entry) return { ok: false, reason: "missing" };
  if (entry.size !== local.bytes) return { ok: false, reason: `size ${entry.size} != ${local.bytes}` };
  const multipart = /-\d+$/.test(entry.etag);
  if (local.md5 && entry.etag && !multipart && entry.etag !== local.md5) return { ok: false, reason: `md5 ${entry.etag} != ${local.md5}` };
  return { ok: true, size: entry.size, etag: entry.etag || null, integrity: multipart ? "size-only(multipart-etag)" : "size+md5" };
}

async function appendIndex(base, entries) {
  const existing = await storageFetch(
    `${base}/storage/v1/object/${BUCKET}/${encodeObjectPath(INDEX_OBJECT)}`,
    { headers: { apikey: SECRET } },
    "download-index",
  );
  let body = "";
  if (existing.ok) body = await existing.text();
  const lines = body.split("\n").filter(Boolean);
  lines.push(...entries.map((e) => JSON.stringify(e)));
  await uploadBuffer(base, INDEX_OBJECT, Buffer.from(lines.join("\n") + "\n", "utf8"), "application/x-ndjson");
}

async function uploadOne(base, file, meta, indexEntries) {
  const size = fs.statSync(file).size;
  const sha256 = await sha256File(file);
  const objectPath = `${PREFIX}/${meta.dateKey}/${path.basename(file)}`;
  const record = {
    at: new Date().toISOString(),
    source: path.basename(file),
    object: objectPath,
    bytes: size,
    sha256,
    rows: meta.rows ?? null,
    label: meta.label ?? null,
    parts: [],
  };
  if (size <= PART_BYTES) {
    const buffer = fs.readFileSync(file);
    await uploadBuffer(base, objectPath, buffer, "application/gzip");
    const check = await verifyRemote(base, objectPath, { bytes: size, md5: md5Hex(buffer) });
    if (!check.ok) throw new Error(`verify failed for ${objectPath}: ${check.reason}`);
    record.parts.push({ name: path.basename(objectPath), bytes: size, md5: md5Hex(buffer) });
  } else {
    const parts = splitToParts(file);
    try {
      for (const part of parts) {
        const suffix = part.name.slice(path.basename(file).length);
        const partPath = `${objectPath}${suffix}`;
        const buffer = fs.readFileSync(part.file);
        await uploadBuffer(base, partPath, buffer, "application/octet-stream");
        const check = await verifyRemote(base, partPath, part);
        if (!check.ok) throw new Error(`verify failed for ${partPath}: ${check.reason}`);
        record.parts.push({ name: path.basename(partPath), bytes: part.bytes, md5: part.md5 });
      }
    } finally {
      for (const part of parts) fs.rmSync(part.file, { force: true });
    }
  }
  await uploadBuffer(base, `${objectPath}.meta.json`, Buffer.from(JSON.stringify(record, null, 1), "utf8"), "application/json");
  indexEntries.push(record);
  fs.rmSync(file, { force: true });
  return record;
}

function loadManifestRows(dir) {
  const map = new Map();
  const manifestFile = path.join(dir, "archive-manifest.json");
  if (!fs.existsSync(manifestFile)) return map;
  try {
    const arr = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    for (const entry of arr) map.set(path.basename(entry.file ?? ""), { rows: entry.rows ?? entry.verified ?? entry.rowsDeleted ?? null, label: entry.table ?? entry.kind ?? null });
  } catch { /* ignore malformed manifest */ }
  return map;
}

async function uploadPending(base, archiveDir, summary) {
  if (!fs.existsSync(archiveDir)) return [];
  const manifestRows = loadManifestRows(archiveDir);
  const summaryRows = new Map();
  const archived = [...(summary?.audit?.archived ?? []), summary?.frames?.archived ?? null, summary?.events?.archived ?? null, summary?.accessLogs?.archived ?? null].filter(Boolean);
  for (const a of archived) if (a.file) summaryRows.set(a.file, { rows: a.rows ?? a.lines ?? null, label: a.label ?? null });
  const dateKey = new Date().toISOString().slice(0, 10);
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".jsonl.gz")).sort();
  const indexEntries = [];
  const done = [];
  for (const name of files) {
    const file = path.join(archiveDir, name);
    const meta = summaryRows.get(file) ?? manifestRows.get(name) ?? {};
    const record = await uploadOne(base, file, { dateKey, rows: meta.rows, label: meta.label }, indexEntries);
    done.push({ object: record.object, bytes: record.bytes, sha256: record.sha256, parts: record.parts.length });
  }
  const manifestFile = path.join(archiveDir, "archive-manifest.json");
  if (fs.existsSync(manifestFile)) {
    await uploadBuffer(base, `${PREFIX}/${dateKey}/archive-manifest.json`, fs.readFileSync(manifestFile), "application/json");
  }
  if (indexEntries.length) await appendIndex(base, indexEntries);
  return done;
}

async function main() {
  if (!SECRET) throw new Error("SUPABASE_SECRET_KEY missing");
  const base = supabaseBase();
  const bucket = await ensureBucket(base);
  log("bucket", { bucket: BUCKET, base, ...bucket });
  const pre = await uploadPending(base, ARCHIVE_DIR, null);
  log("pending-uploaded", { count: pre.length, files: pre });
  if (uploadOnly) return { uploaded: pre.length };
  const summary = await runRetention({ databaseUrl: process.env.DATABASE_URL, archiveDir: ARCHIVE_DIR, dryRun: false });
  log("retention", {
    auditDropped: summary.audit?.dropped?.length ?? 0,
    auditTrimmed: summary.audit?.trimmed ?? 0,
    framesDeleted: summary.frames?.deleted ?? 0,
    eventsDeleted: summary.events?.deleted ?? 0,
    accessLogsDeleted: summary.accessLogs?.deleted ?? 0,
    noncesDeleted: summary.nonces?.deleted ?? 0,
    partitionsCreated: summary.ensurePartitions?.created ?? [],
  });
  const post = await uploadPending(base, ARCHIVE_DIR, summary);
  log("uploaded", { count: post.length, files: post });
  return { uploaded: pre.length + post.length };
}

main()
  .then((result) => { log("done", result); process.exit(0); })
  .catch((error) => { console.error(JSON.stringify({ at: new Date().toISOString(), event: "error", message: String(error?.message ?? error).slice(0, 400) })); process.exit(1); });
