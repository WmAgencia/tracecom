import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
const ROOT = "D:/tracecom/repo";
const OUT_DIR = path.join(ROOT, "backups");
fs.mkdirSync(OUT_DIR, { recursive: true });
const STAMP = "pre-reconstrucao-2026-09-22";
const INCLUDE = ["relay", "src", "scripts", "api", "docs", ".github"];
const INCLUDE_FILES = ["AGENTS.md", "agent-policy.yaml", "package.json", "vercel.json", "tsconfig.json"];
const EXCLUDE_DIRS = new Set(["node_modules", ".next", "dist", "dist-dev", "dist-extension", "research", ".vercel", ".git"]);
const walk = (dir, rel = "") => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const r = rel ? rel + "/" + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, r));
    else if (entry.isFile()) out.push(r);
  }
  return out;
};
const files = [];
for (const dir of INCLUDE) { const abs = path.join(ROOT, dir); if (fs.existsSync(abs)) files.push(...walk(abs, dir)); }
for (const file of INCLUDE_FILES) { if (fs.existsSync(path.join(ROOT, file))) files.push(file); }
const manifest = [];
let totalBytes = 0;
for (const rel of files.sort()) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  totalBytes += buf.length;
  manifest.push(`${crypto.createHash("sha256").update(buf).digest("hex")}  ${String(buf.length).padStart(9)}  ${rel}`);
}
const manifestPath = path.join(OUT_DIR, `manifest-${STAMP}.txt`);
fs.writeFileSync(manifestPath, `# TraceCom — manifesto de backup ${STAMP}\n# gerado ${new Date().toISOString()}\n# arquivos: ${manifest.length} · bytes: ${totalBytes}\n\n` + manifest.join("\n") + "\n");
console.log("MANIFEST=" + manifestPath + " arquivos=" + manifest.length + " bytes=" + totalBytes);
// zip (formato store simples via gzip de tar nao existe no node; usamos zip por entradas)
const zipPath = path.join(OUT_DIR, `tracecom-${STAMP}.zip`);
const chunks = [];
const central = [];
let offset = 0;
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
for (const rel of files.sort()) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  const compressed = zlib.deflateRawSync(buf, { level: 9 });
  const name = Buffer.from(rel, "utf8");
  const crc = crc32(buf);
  const now = new Date();
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime(now), 10); local.writeUInt16LE(dosDate(now), 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(buf.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  chunks.push(local, name, compressed);
  const centralEntry = Buffer.alloc(46);
  centralEntry.writeUInt32LE(0x02014b50, 0); centralEntry.writeUInt16LE(20, 4); centralEntry.writeUInt16LE(20, 6); centralEntry.writeUInt16LE(0, 8); centralEntry.writeUInt16LE(8, 10);
  centralEntry.writeUInt16LE(dosTime(now), 12); centralEntry.writeUInt16LE(dosDate(now), 14); centralEntry.writeUInt32LE(crc, 16);
  centralEntry.writeUInt32LE(compressed.length, 20); centralEntry.writeUInt32LE(buf.length, 24); centralEntry.writeUInt16LE(name.length, 28);
  centralEntry.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([centralEntry, name]));
  offset += local.length + name.length + compressed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
console.log("ZIP=" + zipPath + " bytes=" + fs.statSync(zipPath).size);
