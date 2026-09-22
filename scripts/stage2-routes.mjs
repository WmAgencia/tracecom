import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
const SV = "D:/tracecom/repo/relay/server.mjs";
const API = "D:/tracecom/repo/api/http.ts";
const APPLY = process.argv.includes("--apply");
const LEGACY_ROUTE = /^\/api\/iq\/research\/(shadow-lab|scenario|agents-v4|rsi-variants|rsi-reversal|indicator-5m|five-way|four-way|rsi-agents|dual|solo|frozen)/;

const routeDel = (file, label) => {
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const del = [];
  lines.forEach((line, i) => {
    const m = line.match(/url\.pathname === '([^']+)'/);
    if (m && LEGACY_ROUTE.test(m[1])) del.push({ i, path: m[1] });
    const q = line.match(/^\s*"(\/api\/iq\/research\/[^"]+)"/);
    if (q && LEGACY_ROUTE.test(q[1])) del.push({ i, path: q[1] });
  });
  console.log(`${label}: rotas/entries legadas=${del.length} [${[...new Set(del.map((d) => d.path))].slice(0, 20).join(" ")}]`);
  if (!APPLY) return 0;
  const out = lines.filter((_, i) => !del.some((d) => d.i === i)).join(eol);
  fs.writeFileSync(file, out);
  return del.length;
};

const removeMethods = (names) => {
  const text = fs.readFileSync(RT, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const sigRe = /^  (async )?[a-zA-Z#][\w#]*\s*\(/;
  const del = new Set();
  for (const name of names) {
    const start = lines.findIndex((l) => new RegExp("^  async " + name + "\\(").test(l));
    if (start < 0) { console.log("metodo nao encontrado: " + name); continue; }
    let c = start - 1;
    while (c >= 0 && /^\s*(\/\*\*|\*|\*\/)/.test(lines[c])) c -= 1;
    let j = start + 1;
    while (j < lines.length && !sigRe.test(lines[j])) j += 1;
    let t = j - 1;
    while (t > start && (lines[t].trim() === "" || /^\s*(\/\*\*|\*|\*\/)/.test(lines[t]))) t -= 1;
    console.log(`metodo ${name}: linhas ${c + 2}-${t + 1} (${t - c} linhas)`);
    for (let k = c + 1; k <= t; k += 1) del.add(k);
  }
  if (!APPLY) return 0;
  const out = lines.filter((_, i) => !del.has(i)).join(eol);
  fs.writeFileSync(RT, out);
  return del.size;
};

const cleanImports = () => {
  const text = fs.readFileSync(RT, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const targetRe = /^import \{/;
  const moduleRe = /(shadow-lab|timing-shadow|scenario|agents-v4|dual-reasoning|dual-round-observer|solo-reasoning|four-way-experiment|indicator-5m|rsi-reversal|rsi-variants|rsi-agents-5x5|rsi-agents-v2-rsi-agents-v2\.|rsi-agents-v2-live|rsi-agents-v3|rsi-agents-v4)/;
  const classRe = /\b(ShadowLab|LateWindowTimingShadow|ScenarioShadow|ScenarioTimingIntersectionShadow|ScenarioShadowSettlement|AgentsV4Engine|AgentsV4Persistence|AgentsV4Settlement|DualReasoningEngine|DualRoundMarketDeltaObserver|SoloReasoningEngine|FourWayExperiment|Indicator5MEngine|RsiReversalExperiment|RsiVariantsRunner|RsiAgents5x5|RsiAgentsV2|RsiAgentsV3|RsiAgentsV4|RsiAgentsV2Live|FrozenStrategies)\b/;
  const isTarget = (l) => targetRe.test(l) && /from "\.\//.test(l) && classRe.test(l);
  const body = lines.filter((l) => !isTarget(l)).join(eol);
  const report = [];
  const out = lines.map((l) => {
    if (!isTarget(l)) return l;
    const left = l.match(/^import \{ (.*) \} from/);
    if (!left) return l;
    const specs = left[1].split(",").map((s) => s.trim()).filter(Boolean);
    const alive = specs.filter((spec) => {
      const local = spec.includes(" as ") ? spec.split(" as ")[1].trim() : spec;
      return new RegExp("\\b" + local + "\\b").test(body);
    });
    if (alive.length === specs.length) { report.push("MANTIDO_INTEGRAL: " + l.slice(0, 70)); return l; }
    if (!alive.length) { report.push("REMOVIDO: " + l.slice(0, 70)); return null; }
    report.push(`REDUZIDO (${alive.length}/${specs.length}): ` + l.slice(0, 70));
    return l.replace(left[1], " " + alive.join(", ") + " ");
  }).filter((l) => l !== null);
  console.log(report.join("\n"));
  if (!APPLY) return 0;
  fs.writeFileSync(RT, out.join(eol));
  return report.filter((r) => r.startsWith("REMOVIDO")).length;
};

console.log("=== ROTAS ===");
routeDel(SV, "server");
routeDel(API, "api/http.ts");
console.log("=== METODOS V3/V4 ===");
removeMethods(["submitAgentV3Order", "submitAgentV4Order"]);
console.log("=== IMPORTS ===");
cleanImports();
console.log(APPLY ? "APPLIED" : "DRY_RUN");
