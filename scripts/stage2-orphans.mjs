import fs from "node:fs";
import path from "node:path";
const ROOT = "D:/tracecom/repo/relay";
const files = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === "node_modules" || e.name.startsWith(".")) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".mjs")) files.push(p); } };
walk(ROOT);
const tops = fs.readdirSync(ROOT).filter((f) => f.endsWith(".mjs"));
const content = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const orphans = [];
for (const t of tops) {
  if (t === "server.mjs") continue;
  const base = t.replace(/\.mjs$/, "");
  let used = false;
  for (const [f, text] of content) {
    if (path.basename(f) === t) continue;
    const re = new RegExp("from\\s+[\"'][^\"']*" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\.mjs)?[\"']", "i");
    if (re.test(text)) { used = true; break; }
  }
  if (!used) orphans.push(t);
}
console.log("ORFAOS_TOPO=" + JSON.stringify(orphans));
