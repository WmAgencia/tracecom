import fs from "node:fs";
import path from "node:path";
const ROOT = "D:/tracecom/repo/relay";
const files = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === "node_modules" || e.name.startsWith(".")) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".mjs")) files.push(p); } };
walk(ROOT);
const modules = ["rsi-agents-v2-blitz", "iq-mcp-client", "blitz-lab", "rsi-v4", "rsi-agents-v4", "rsi-agents-v3", "rsi-agents-v2", "rsi-reversal", "rsi-variants", "agents-v4", "indicator-5m", "scenario-shadow", "four-way-experiment", "dual-reasoning", "solo-reasoning", "shadow-lab", "frozen-strategies", "agents/side-preference", "agents/candle.agent", "candles-archive"];
const content = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
for (const mod of modules) {
  const base = mod.split("/").pop();
  const importers = [];
  for (const [f, text] of content) {
    const re = new RegExp("from\\s+[\"'][^\"']*" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\.mjs)?[\"']", "i");
    if (re.test(text)) importers.push(path.relative(ROOT, f));
  }
  console.log((importers.length ? "USADO   " : "ORFAO   ") + mod.padEnd(24) + " <- " + (importers.join(", ") || "(sem importadores)"));
}
console.log("\n=== REFS BLITZ POR ARQUIVO (operacional) ===");
const blitz = [];
for (const [f, text] of content) { const n = (text.match(/blitz/gi) ?? []).length; if (n) blitz.push({ f: path.relative(ROOT, f), n }); }
blitz.sort((a, b) => b.n - a.n);
for (const b of blitz.slice(0, 20)) console.log("  " + String(b.n).padStart(4) + "  " + b.f);
console.log("ARQUIVOS_COM_BLITZ=" + blitz.length);
