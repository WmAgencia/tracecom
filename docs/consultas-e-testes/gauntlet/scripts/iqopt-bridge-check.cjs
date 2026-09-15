const fs = require("fs");
const b = fs.readFileSync("C:/tracecom-recovered/src/extension/iq-page-bridge.js", "utf8");
const keys = ["WebSocket", "fetch(", "XMLHttpRequest", "addEventListener(\"message\"", "candle-generated", "quotes", "onmessage", "open("];
const hooks = keys.map((k) => { const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"); return k + ": " + ((b.match(re) || []).length); });
console.log("BRIDGE HOOKS -> " + hooks.join(" | "));
for (const d of ["C:/tracecom-recovered/src/dist-extension", "C:/tracecom-recovered/src/extension"]) {
  try { console.log(d + " => " + fs.readdirSync(d).join(", ")); } catch (e) { console.log(d + " ERRO " + e.message); }
}
let hits = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + "/" + e.name; if (e.isDirectory()) { if (!/node_modules/.test(p)) walk(p); } else if (/\.(js|json)$/.test(e.name)) { const c = fs.readFileSync(p, "utf8"); if (/historical|quotes/i.test(c)) hits.push(p); } } }
walk("C:/tracecom-recovered/src/extension");
walk("C:/tracecom-recovered/src/dist-extension");
console.log("grep historical/quotes: " + (hits.join("\n") || "nenhum match"));
