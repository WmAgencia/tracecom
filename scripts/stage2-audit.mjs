import fs from "node:fs";
import path from "node:path";
const ROOT = "D:/tracecom/repo";
const scanDirs = ["relay", "src", "api", "scripts", ".github"];
const all = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "dist-dev", "dist-extension", "research", "backups", "data"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js|ts|json|yml|yaml|html|md)$/i.test(e.name)) all.push(p);
  }
};
for (const d of scanDirs) walk(path.join(ROOT, d));
const content = new Map(all.map((f) => [f, fs.readFileSync(f, "utf8")]));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const candidates = ["blitz", "rsi-agents-v2-blitz", "iq-mcp-client", "rsi-agents-v2", "rsi-agents-v3", "rsi-agents-v4", "rsi-v4", "rsi-reversal", "rsi-variants", "agents-v4", "indicator-5m", "scenario-shadow", "scenario-engine", "scenario-observation-quality", "scenario-timing-intersection", "four-way-experiment", "dual-reasoning", "solo-reasoning", "shadow-lab", "frozen-strategies", "side-preference", "experiment", "dual-report-service", "g2-audit", "market-state-classifier", "research-worker"];
const patterns = (base) => {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    importStatic: new RegExp("(from|import)\\s*[\"'][^\"']*" + esc, "i"),
    importDynamic: new RegExp("import\\([^)]*" + esc, "i"),
    require: new RegExp("require\\([^)]*" + esc, "i"),
    stringRef: new RegExp("[\"'][^\"']*" + esc + "[^\"']*[\"']", "i"),
  };
};
console.log("=== PROVA DE CONSUMIDOR (por candidato) ===");
for (const c of candidates) {
  const p = patterns(c);
  const hits = { importStatic: [], importDynamic: [], require: [], stringRef: [] };
  for (const [f, text] of content) {
    const r = rel(f);
    if (p.importStatic.test(text)) hits.importStatic.push(r);
    if (p.importDynamic.test(text)) hits.importDynamic.push(r);
    if (p.require.test(text)) hits.require.push(r);
    else if (p.stringRef.test(text) && !r.includes(c)) hits.stringRef.push(r);
  }
  const total = new Set([...hits.importStatic, ...hits.importDynamic, ...hits.require]);
  const cls = total.size ? "OPERATIONAL" : hits.stringRef.length ? "STRING-REFS" : "DEAD/ORPHAN";
  console.log(c.padEnd(30) + cls.padEnd(14) + " static=" + hits.importStatic.length + " dynamic=" + hits.importDynamic.length + " require=" + hits.require.length + " strings=" + hits.stringRef.length);
  if (hits.stringRef.length && hits.stringRef.length <= 6) console.log("    strings: " + hits.stringRef.join(", "));
}
console.log("\n=== ENV FLAGS / SCRIPTS / WORKFLOWS ===");
for (const [f, text] of content) {
  const r = rel(f);
  if (r.startsWith("scripts/") || r.startsWith(".github/") || r === "package.json" || r === "relay/package.json" || r === "railway.json") {
    const flags = [...text.matchAll(/([A-Z][A-Z0-9_]{4,})/g)].map((m) => m[1]).filter((v) => /BLITZ|RSI_AGENTS|LAB6|S04|AGENTIC|CONSENSUS|FROZEN|SHADOW_EXPERIMENT|INDICATOR|DUAL|SOLO|V4|V3|V2/.test(v));
    const uniq = [...new Set(flags)];
    if (uniq.length) console.log("  " + r + ": " + uniq.join(", "));
  }
}
