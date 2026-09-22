import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
const APPLY = process.argv.includes("--apply");
let src = fs.readFileSync(RT, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
let lines = src.split(eol);

const families = ["rsiAgentsV2Live", "rsiAgentsV2", "rsiAgentsV3", "rsiAgentsV4", "rsiAgents", "agentsV4Persistence", "agentsV4Settlement", "agentsV4", "scenarioTimingIntersection", "scenarioSettlement", "scenarioShadow", "dualObserver", "dual", "solo", "fourWay", "indicator5m", "rsiReversal", "rsiVariants", "shadowLab", "timingShadow"];
const flags = ["scenarioShadowEnabled", "scenarioTimingIntersectionEnabled", "agentsV4Enabled", "dualReasoningEnabled", "soloReasoningEnabled", "indicator5mEnabled", "rsiReversalEnabled", "rsiVariantsEnabled", "rsiAgentsEnabled", "rsiAgentsV2Enabled", "rsiAgentsV3Enabled", "rsiAgentsV4Enabled", "rsiAgentsV2LiveEnabled"];
const staleComments = ["DUAL_REASONING_V1_SHADOW", "V2: 50/50 dinamico", "V3: estrategia unica no universo elegivel"];

const del = new Set(); const reports = [];
const byName = new Map(families.map((f) => [f, { inst: 0, multi: 0, props: 0, bare: 0 }]));
lines.forEach((line, i) => {
  for (const f of families) {
    const rec = byName.get(f);
    const instRe = new RegExp("^\\s*this\\." + f + "\\s*=\\s*new ");
    if (instRe.test(line)) {
      if (line.trimEnd().endsWith(";")) { del.add(i); rec.inst += 1; }
      else {
        let j = i; while (j < lines.length && lines[j].trim() !== "});") j += 1;
        if (j < lines.length) { for (let k = i; k <= j; k += 1) del.add(k); rec.inst += 1; rec.multi += 1; }
        else reports.push(`MULTILINHA SEM FECHO: ${f} linha ${i + 1}`);
      }
      return;
    }
    if (new RegExp("this\\." + f + "\\.").test(line)) rec.props += 1;
    if (new RegExp("this\\." + f + "(?![\\w.?])").test(line)) rec.bare += 1;
  }
});
lines.forEach((line, i) => { if (staleComments.some((c) => line.includes(c))) { del.add(i); reports.push(`COMENTARIO_STALE removido: ${i + 1}`); } });
for (const [f, r] of byName) reports.push(`${f}: inst=${r.inst} multi=${r.multi} props=${r.props} bare=${r.bare}`);
const flagReport = flags.map((fl) => `${fl}=${(src.match(new RegExp(fl, "g")) ?? []).length}`).join(" ");
reports.push("FLAGS: " + flagReport);
const mcpRefs = lines.map((l, i) => ({ l, i })).filter(({ l }) => /this\.iqMcp(Binary)?\./.test(l)).slice(0, 12).map(({ l, i }) => `  ${i + 1}: ${l.trim().slice(0, 120)}`);
reports.push("IQMCP_REFS:\n" + mcpRefs.join("\n"));
console.log(reports.join("\n"));
console.log("DELETIONS=" + del.size);
if (!APPLY) { console.log("DRY_RUN"); process.exit(0); }
let out = lines.filter((_, i) => !del.has(i)).join(eol);
for (const f of families) {
  out = out.replace(new RegExp("this\\." + f + "\\.", "g"), `this.${f}?.`);
  out = out.replace(new RegExp("this\\." + f + "(?![\\w.?])", "g"), "null");
}
for (const fl of flags) {
  const total = (out.match(new RegExp(fl, "g")) ?? []).length;
  if (total === 1) out = out.replace(new RegExp(fl + "\\s*=\\s*[^,}]+,\\s*", "g"), "");
  else if (total > 1) console.log(`FLAG_MANTIDA (${total} usos): ${fl}`);
}
fs.writeFileSync(RT, out);
console.log("APPLIED deletions=" + del.size);
